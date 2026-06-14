'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

// `fishings.fishingLocations` powers the journal "location" filter. The
// granular location (estuary bar, inland water body, polder) lives in
// `tools_groups_events.location` — NOT on the fishing row — so the options are
// the distinct event locations, scoped like the journal, and the filter
// (?query={locationId,locationName}) returns the fishings that have an event
// there. Seeded with the real build flow so a real tools_groups_event exists.
const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

const sampleCoords = { x: 21.13, y: 55.71 };
const barFive = { id: '5', name: 'baras 5', type: 'ESTUARY', municipality: { id: 41, name: 'Klaipėda' } };
const barSix = { id: '6', name: 'baras 6', type: 'ESTUARY', municipality: { id: 41, name: 'Klaipėda' } };

let ownerAFishingId: any;
let ownerBFishingId: any;

// Start an ESTUARY fishing for `owner` and build a net at `location`, which
// creates the tools_groups_event carrying that location. Returns the fishing id.
async function buildAt(owner: any, tenantId: any, sealNr: string, location: any) {
  const meta = apiHelper.meta(owner, tenantId);
  const headers = apiHelper.getHeaders(owner.token, tenantId);
  const toolTypes: any[] = await broker.call('toolTypes.find');
  await broker.call(
    'tools.create',
    { sealNr, toolType: toolTypes[0].id, data: { eyeSize: 60, netLength: 30 } },
    { meta },
  );
  await broker.call('fishings.startFishing', { type: 'ESTUARY', coordinates: sampleCoords }, { meta });
  const fishing: any = await broker.call('fishings.currentFishing', {}, { meta });
  const groups: any[] = await broker.call(
    'toolsGroups.find',
    { query: { removeEvent: { $exists: false } } },
    { meta },
  );
  await request(apiService.server)
    .post(`/zvejyba/api/toolsGroups/build/${groups[0].id}`)
    .set(headers)
    .send({ coordinates: sampleCoords, location })
    .expect(200);
  return fishing.id;
}

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  ownerAFishingId = await buildAt(apiHelper.ownerA, apiHelper.tenantA.tenant.id, 'S-LA-1', barFive);
  ownerBFishingId = await buildAt(apiHelper.ownerB, apiHelper.tenantB.tenant.id, 'S-LB-1', barSix);
});
afterAll(() => broker.stop());

const names = (res: any[]) => res.map((o) => o.name);
const rowIds = (res: any) => (res.body.rows ?? []).map((r: any) => r.id);

describe('fishings.fishingLocations — granular event-location options', () => {
  it('a company sees only the locations its own tenant fished', async () => {
    const res: any[] = await broker.call(
      'fishings.fishingLocations',
      {},
      { meta: apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id) },
    );
    expect(names(res)).toContain('baras 5');
    expect(names(res)).not.toContain('baras 6'); // never another tenant's bar
    expect(res.find((o) => o.name === 'baras 5')).toMatchObject({ id: '5' });
  });

  it('an admin sees event locations across all tenants', async () => {
    const res: any[] = await broker.call(
      'fishings.fishingLocations',
      {},
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(names(res)).toEqual(expect.arrayContaining(['baras 5', 'baras 6']));
  });

  it('a freelancer with no tool events gets an empty list', async () => {
    const res: any[] = await broker.call(
      'fishings.fishingLocations',
      {},
      { meta: apiHelper.meta(apiHelper.freelancerA) },
    );
    expect(res).toEqual([]);
  });
});

describe('fishings journal — location filter', () => {
  it('returns the fishings that have an event at the picked location', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .query({ query: JSON.stringify({ locationId: '5', locationName: 'baras 5' }) })
      .expect(200);
    expect(rowIds(res)).toContain(ownerAFishingId);
  });

  it('excludes fishings that were not at that location', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .query({ query: JSON.stringify({ locationId: '6', locationName: 'baras 6' }) })
      .expect(200);
    expect(rowIds(res)).not.toContain(ownerAFishingId);
  });

  it('cannot reach another tenant via the location filter', async () => {
    // ownerB filters by ownerA's bar → tenant scope keeps ownerA's fishing out.
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.ownerB.token, apiHelper.tenantB.tenant.id))
      .query({ query: JSON.stringify({ locationId: '5', locationName: 'baras 5' }) })
      .expect(200);
    expect(rowIds(res)).not.toContain(ownerAFishingId);
    expect(rowIds(res)).not.toContain(ownerBFishingId); // ownerB wasn't at baras 5
  });
});
