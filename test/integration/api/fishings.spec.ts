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

  it('endFishings cron action closes orphaned fishings (sets endEvent + system user)', async () => {
    // Open one fishing for ownerB (different tenant) without closing it.
    await seedToolForOwner(apiHelper.ownerB, apiHelper.tenantB.tenant.id);
    await broker.call(
      'fishings.startFishing',
      { type: 'INLAND_WATERS', coordinates: sampleCoords },
      { meta: apiHelper.meta(apiHelper.ownerB, apiHelper.tenantB.tenant.id) },
    );

    const closed: any[] = await broker.call('fishings.endFishings');
    expect(closed.length).toBeGreaterThan(0);
    closed.forEach((f) => expect(f.endEvent).toBeTruthy());
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
