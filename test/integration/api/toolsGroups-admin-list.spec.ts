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
let ownerHeaders: Record<string, string>;
let adminHeaders: Record<string, string>;
let builtGroupId: number;
let fishId: number;

// Regression for the admin įrankiai page (`imones/:id/irankiai`). It lists a
// tenant's built tools via `GET /toolsGroups/all?populate[]=weightEvent`. The
// `weightEvent` virtual populate calls `weightEvents.getFishByToolsGroup`,
// which used to throw "Fishing not started" whenever the caller had no active
// fishing — always the case for an admin — and that 422'd the whole list.
// An admin must see every built tool (and its weighed catch) regardless of
// any fishing session.
beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
  ownerHeaders = apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id);
  adminHeaders = apiHelper.getHeaders(apiHelper.superAdmin.token);

  const toolTypes: any[] = await broker.call('toolTypes.find');
  const fishTypes: any[] = await broker.call('fishTypes.find');
  fishId = fishTypes[0].id;

  await broker.call(
    'tools.create',
    { sealNr: 'S-ADM-1', toolType: toolTypes[0].id, data: { eyeSize: 60, netLength: 30 } },
    { meta: ownerMeta },
  );

  await broker.call(
    'fishings.startFishing',
    { type: 'ESTUARY', coordinates: sampleCoords },
    { meta: ownerMeta },
  );

  const groups: any[] = await broker.call(
    'toolsGroups.find',
    { query: { removeEvent: { $exists: false } } },
    { meta: ownerMeta },
  );
  builtGroupId = groups[0].id;

  // Build the net and weigh a real catch on it (preliminary).
  await request(apiService.server)
    .post(`/zvejyba/api/toolsGroups/build/${builtGroupId}`)
    .set(ownerHeaders)
    .send({ coordinates: sampleCoords, location: sampleLocation })
    .expect(200);

  await request(apiService.server)
    .post(`/zvejyba/api/toolsGroups/weigh/${builtGroupId}`)
    .set(ownerHeaders)
    .send({ coordinates: sampleCoords, location: sampleLocation, data: { [fishId]: 12 } })
    .expect(200);
});
afterAll(() => broker.stop());

describe('toolsGroups weightEvent populate — angler vs admin context', () => {
  it('still scopes the catch to the active session for the angler', async () => {
    // ownerA has an active fishing → the populate must return the catch it
    // logged this session. This pins the unchanged angler behaviour.
    const fish: any = await broker.call(
      'weightEvents.getFishByToolsGroup',
      { toolsGroup: builtGroupId },
      { meta: ownerMeta },
    );
    expect(fish).toBeTruthy();
    expect(fish.data[fishId]).toBe(12);
  });

  it('admin GET /toolsGroups/all?populate[]=weightEvent returns 200 with no active fishing', async () => {
    // Close out the fishing so NO fishing is active when the admin queries —
    // exactly the staging state that produced the 422. A final shore weight
    // is required before a fishing with a preliminary catch can end.
    await broker.call(
      'weightEvents.createWeightEvent',
      { coordinates: sampleCoords, data: { [fishId]: 12 } },
      { meta: ownerMeta },
    );
    await request(apiService.server)
      .post('/zvejyba/api/fishings/end')
      .set(ownerHeaders)
      .send({ coordinates: sampleCoords })
      .expect(200);

    // Sanity: the admin genuinely has no current fishing — the exact
    // precondition that used to throw "Fishing not started".
    const current: any = await broker.call(
      'fishings.currentFishing',
      {},
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(current).toBeFalsy();

    const res = await request(apiService.server)
      .get('/zvejyba/api/toolsGroups/all')
      .query({
        populate: ['tools', 'buildEvent', 'weightEvent'],
        query: JSON.stringify({
          removeEvent: { $exists: false },
          buildEvent: { $exists: true },
          tenant: String(apiHelper.tenantA.tenant.id),
        }),
      })
      .set(adminHeaders)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const group = res.body.find((g: any) => g.id === builtGroupId);
    expect(group).toBeTruthy();
    // The weighed catch is surfaced even though the admin has no session.
    expect(group.weightEvent).toBeTruthy();
    expect(group.weightEvent.data[fishId]).toBe(12);
  });

  it('does not leak another tenant’s catch to a non-admin (in-action tenant scope)', async () => {
    // ownerB (tenant B) asking for tenant A's tool group must get nothing —
    // dropping the in-session `fishing` filter must not become a cross-tenant
    // read. ProfileMixin scoping inside the action enforces this.
    const fish: any = await broker.call(
      'weightEvents.getFishByToolsGroup',
      { toolsGroup: builtGroupId },
      { meta: apiHelper.meta(apiHelper.ownerB, apiHelper.tenantB.tenant.id) },
    );
    expect(fish).toBeFalsy();
  });
});
