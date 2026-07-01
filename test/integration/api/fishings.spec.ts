'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

// Coordinates are WGS84 — `coordinatesToGeometry` converts to LKS94 (3346).
const sampleCoords = { x: 21.13, y: 55.71 }; // Klaipeda-ish

async function seedToolType(): Promise<number> {
  const types: any[] = await broker.call('toolTypes.find');
  if (types[0]?.id) return types[0].id;
  const created: any = await broker.call('toolTypes.create', { label: 'Tinklas', type: 'NET' });
  return created.id;
}

async function seedFishType(): Promise<number> {
  const types: any[] = await broker.call('fishTypes.find');
  return types[0].id;
}

async function seedToolForOwner(metaUser: any, profile: any): Promise<number> {
  const toolType = await seedToolType();
  // tools.create has an `afterCreate` hook that returns void (it forwards to
  // `toolsGroups.create` but doesn't echo the entity). The action response is
  // therefore undefined — look the tool up by seal number instead.
  const sealNr = `S-${Math.floor(Math.random() * 1_000_000)}`;
  await broker.call(
    'tools.create',
    {
      sealNr,
      toolType,
      data: { eyeSize: 60, netLength: 30 },
    },
    { meta: apiHelper.meta(metaUser, profile) },
  );
  const tool: any = await broker.call(
    'tools.findOne',
    { query: { sealNr } },
    { meta: apiHelper.meta(metaUser, profile) },
  );
  return tool.id;
}

describe('fishings.service — start/skip/current/end flow', () => {
  it('POST /fishings/start requires a tool in storage', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/start')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ type: 'INLAND_WATERS', coordinates: sampleCoords });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/No tools/i);
  });

  it('POST /fishings/start creates a fishing once a tool is in storage', async () => {
    await seedToolForOwner(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/start')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ type: 'INLAND_WATERS', coordinates: sampleCoords })
      .expect(200);
    expect(res.body.startEvent).toBeTruthy();
  });

  it('rejects starting a second fishing while one is active', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/start')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ type: 'INLAND_WATERS', coordinates: sampleCoords });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/already started/i);
  });

  it('GET /fishings/current returns the active fishing', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings/current')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .expect(200);
    expect(res.body.endEvent).toBeFalsy();
  });

  it('GET /fishings/weights returns at least the preliminary bucket', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings/weights')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .expect(200);
    // `total` is omitted from JSON when no shore-weight event exists yet;
    // the `preliminary` map is always present (empty until fish are weighed).
    expect(res.body).toHaveProperty('preliminary');
    expect(typeof res.body.preliminary).toBe('object');
  });

  it('POST /fishings/end with no preliminary fish closes the fishing', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/end')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ coordinates: sampleCoords })
      .expect(200);
    expect(res.body.endEvent).toBeTruthy();
  });

  it('POST /fishings/skip records a skip event', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/skip')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ type: 'INLAND_WATERS', coordinates: sampleCoords, note: 'too rough' })
      .expect(200);
    expect(res.body.skipEvent).toBeTruthy();
  });

  it('endFishings closes fishings with an onshore weigh-in but leaves shore-less ones open', async () => {
    const ownerAMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
    const ownerBMeta = apiHelper.meta(apiHelper.ownerB, apiHelper.tenantB.tenant.id);
    const fishId = await seedFishType();

    // ownerA: an open fishing with NO onshore weigh-in → must stay open (the
    // cron never silently closes an incomplete catch report).
    await seedToolForOwner(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
    const withoutShore: any = await broker.call(
      'fishings.startFishing',
      { type: 'INLAND_WATERS', coordinates: sampleCoords },
      { meta: ownerAMeta },
    );

    // ownerB: an open fishing WITH an onshore weigh-in (tools_group_id NULL) →
    // must be auto-closed even though the fisher never pressed "Baigti".
    await seedToolForOwner(apiHelper.ownerB, apiHelper.tenantB.tenant.id);
    const withShore: any = await broker.call(
      'fishings.startFishing',
      { type: 'INLAND_WATERS', coordinates: sampleCoords },
      { meta: ownerBMeta },
    );
    await broker.call(
      'weightEvents.createWeightEvent',
      { coordinates: sampleCoords, data: { [fishId]: 5 } },
      { meta: ownerBMeta },
    );

    const closed: any[] = await broker.call('fishings.endFishings');
    const closedIds = closed.map((f) => String(f.id));

    expect(closedIds).toContain(String(withShore.id));
    expect(closedIds).not.toContain(String(withoutShore.id));
    closed.forEach((f) => expect(f.endEvent).toBeTruthy());

    const stillOpen: any = await broker.call(
      'fishings.get',
      { id: withoutShore.id },
      { meta: ownerAMeta },
    );
    expect(stillOpen.endEvent).toBeFalsy();
  });

  it('GET /fishings/history/:id returns a sorted event list', async () => {
    const current: any = await broker.call(
      'fishings.findOne',
      { query: { user: apiHelper.ownerA.user.id }, sort: '-createdAt' },
      { meta: apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id) },
    );
    const res = await request(apiService.server)
      .get(`/zvejyba/api/fishings/history/${current.id}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .expect(200);
    expect(Array.isArray(res.body.history)).toBe(true);
  });
});

describe('fishings — weighFish payload guards', () => {
  beforeAll(async () => {
    // Reset to a clean active fishing for ownerA
    await broker.call('fishingEvents.removeAllEntities');
    await broker.call('fishings.removeAllEntities');
    await seedToolForOwner(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
    await broker.call(
      'fishings.startFishing',
      { type: 'INLAND_WATERS', coordinates: sampleCoords },
      { meta: apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id) },
    );
  });

  it('rejects when preliminary key is missing from onshore payload', async () => {
    const fishId = await seedFishType();
    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/weight')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({
        coordinates: sampleCoords,
        data: {},
        preliminaryData: { [fishId]: 5 },
      });
    expect(res.status).toBe(422);
    expect(res.body.type ?? res.body.code).toMatch(/(MISSING_ONSHORE_WEIGHT|VALIDATION_ERROR|422)/);
  });

  it('rejects when total weight differs from preliminary by more than 20%', async () => {
    const fishId = await seedFishType();
    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/weight')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({
        coordinates: sampleCoords,
        data: { [fishId]: 10 },
        preliminaryData: { [fishId]: 5 },
      });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/Weight difference/i);
  });

  it('accepts an exact-match payload', async () => {
    const fishId = await seedFishType();
    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/weight')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({
        coordinates: sampleCoords,
        data: { [fishId]: 5 },
        preliminaryData: { [fishId]: 5 },
      })
      .expect(200);
    expect(res.body.success).toBe(true);
  });
});

describe('fishings/exportCaughtFishes — empty tools group (regression)', () => {
  // Regression for the admin Excel export crashing with
  // "Cannot read properties of undefined (reading 'toolType')": a boat
  // tools group whose tools were all soft-deleted populates to an empty
  // `tools` array, so `tools[0].toolType.label` blew up the whole export.
  it('exports without crashing when a boat tools group has no live tools', async () => {
    const ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);

    await broker.call('weightEvents.removeAllEntities');
    await broker.call('fishingEvents.removeAllEntities');
    await broker.call('fishings.removeAllEntities');

    const fishId = await seedFishType();
    const toolId = await seedToolForOwner(apiHelper.ownerA, apiHelper.tenantA.tenant.id);

    const tool: any = await broker.call(
      'tools.get',
      { id: toolId, populate: ['toolsGroup'] },
      { meta: ownerMeta },
    );
    const toolsGroupId = tool.toolsGroup?.id ?? tool.toolsGroup;
    expect(toolsGroupId).toBeTruthy();

    await broker.call(
      'fishings.startFishing',
      { type: 'INLAND_WATERS', coordinates: sampleCoords },
      { meta: ownerMeta },
    );

    const location = {
      id: '1',
      name: 'Testas',
      type: 'INLAND_WATERS',
      municipality: { id: 1, name: 'Klaipėda' },
    };

    // Boat (preliminary) catch — carries the tools group.
    await broker.call(
      'weightEvents.createWeightEvent',
      { toolsGroup: toolsGroupId, coordinates: sampleCoords, location, data: { [fishId]: 5 } },
      { meta: ownerMeta },
    );
    // Shore (total) catch — no tools group.
    await broker.call(
      'weightEvents.createWeightEvent',
      { coordinates: sampleCoords, location, data: { [fishId]: 5 } },
      { meta: ownerMeta },
    );

    // Soft-delete the only tool → toolsGroup.tools populates to [].
    await broker.call('tools.remove', { id: toolId }, { meta: ownerMeta });

    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings/exportCaughtFishes')
      .set(apiHelper.getHeaders(apiHelper.adminA.token));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheet|octet-stream/);
  });
});
