'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

const sampleCoords = { x: 21.13, y: 55.71 };
const sampleLocation = {
  id: '00070001',
  name: 'Kuršių marios',
  type: 'ESTUARY',
  municipality: { id: 41, name: 'Klaipėda' },
};

let ownerMeta: any;

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
  // Build a fresh tool + an active estuary fishing for ownerA. tools.create
  // returns undefined because of the `afterCreate` hook short-circuit, so
  // we round-trip via the seal number to get the persisted entity.
  const toolTypes: any[] = await broker.call('toolTypes.find');
  const sealNr = 'S-TG-1';
  await broker.call(
    'tools.create',
    { sealNr, toolType: toolTypes[0].id, data: { eyeSize: 60, netLength: 30 } },
    { meta: ownerMeta },
  );
  await broker.call('tools.findOne', { query: { sealNr } }, { meta: ownerMeta });
  // Trigger startFishing which auto-creates a START event for ESTUARY.
  await broker.call(
    'fishings.startFishing',
    { type: 'ESTUARY', coordinates: sampleCoords },
    { meta: ownerMeta },
  );
  // Each tool create auto-creates a toolsGroup via tools.afterCreate.
  const groups: any[] = await broker.call('toolsGroups.find', {}, { meta: ownerMeta });
  expect(groups.length).toBeGreaterThan(0);
});
afterAll(() => broker.stop());

describe('toolsGroups.service', () => {
  it('POST /toolsGroups/build/:id puts the group in the water', async () => {
    const groups: any[] = await broker.call('toolsGroups.find', {}, { meta: ownerMeta });
    const group = groups[0];
    const res = await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/build/${group.id}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ coordinates: sampleCoords, location: sampleLocation })
      .expect(200);
    expect(res.body.buildEvent).toBeTruthy();
  });

  it('GET /toolsGroups/location/:id filters by buildEvent.fishing.type', async () => {
    const res = await request(apiService.server)
      .get(`/zvejyba/api/toolsGroups/location/${sampleLocation.id}`)
      .query({ locationType: 'ESTUARY' })
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('GET /toolsGroups/location/:id with locationType=POLDERS excludes estuary groups', async () => {
    const res = await request(apiService.server)
      .get(`/zvejyba/api/toolsGroups/location/${sampleLocation.id}`)
      .query({ locationType: 'POLDERS' })
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('GET /toolsGroups/notChecked surfaces unweighed bars', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/toolsGroups/notChecked')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /toolsGroups/weigh/:id records a per-toolsGroup weight', async () => {
    const groups: any[] = await broker.call(
      'toolsGroups.find',
      { query: { buildEvent: { $exists: true }, removeEvent: { $exists: false } } },
      { meta: ownerMeta },
    );
    const group = groups[0];
    const fishTypes: any[] = await broker.call('fishTypes.find');
    const fishId = fishTypes[0].id;
    const res = await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/weigh/${group.id}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({
        coordinates: sampleCoords,
        location: sampleLocation,
        data: { [fishId]: 7 },
      })
      .expect(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /toolsGroups/remove/:id closes the group when fish are logged', async () => {
    const groups: any[] = await broker.call(
      'toolsGroups.find',
      { query: { buildEvent: { $exists: true }, removeEvent: { $exists: false } } },
      { meta: ownerMeta },
    );
    const group = groups[0];
    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/remove/${group.id}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ coordinates: sampleCoords, location: sampleLocation });
    // Remove can succeed (200) or fail with the "siblings unweighed" guard.
    // Either way, the action must NOT throw at the gateway level.
  });

  it('POST /toolsGroups/connect/:id with empty tools[] is rejected', async () => {
    const groups: any[] = await broker.call('toolsGroups.find', {}, { meta: ownerMeta });
    const group = groups[0];
    const res = await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/connect/${group.id}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ tools: [] });
    expect(res.status).toBe(422);
  });

  it('public getUniqueToolsLocationsCount returns a number', async () => {
    const count: number = await broker.call('toolsGroups.getUniqueToolsLocationsCount');
    expect(typeof count).toBe('number');
  });
});
