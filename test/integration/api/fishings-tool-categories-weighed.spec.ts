'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

// Gear stays in the water between trips. The angler builds a catcher on day 1,
// ends the trip, and on day 2 only weighs what it caught — no build, no remove.
// `toolCategories` used to read `tools_groups_events` alone, so day 2 showed
// "-" in the admin journal even though the catch is recorded against it.
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
let headers: Record<string, string>;
let buildFishingId: any;
let weighFishingId: any;
let groupId: number;

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
  headers = apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id);

  const toolTypes: any[] = await broker.call('toolTypes.find');
  const catcher = toolTypes.find((t) => t.type === 'CATCHER');
  await broker.call(
    'tools.create',
    { sealNr: 'S-TCW-1', toolType: catcher.id, data: { eyeSize: 60, netLength: 30 } },
    { meta: ownerMeta },
  );

  // Trip 1 — deploy the catcher, then end the trip with it still in the water
  // and nothing weighed.
  const buildFishing: any = await broker.call(
    'fishings.startFishing',
    { type: 'ESTUARY', coordinates: sampleCoords },
    { meta: ownerMeta },
  );
  buildFishingId = buildFishing.id;

  const groups: any[] = await broker.call(
    'toolsGroups.find',
    { query: { removeEvent: { $exists: false } } },
    { meta: ownerMeta },
  );
  groupId = groups[0].id;
  await request(apiService.server)
    .post(`/zvejyba/api/toolsGroups/build/${groupId}`)
    .set(headers)
    .send({ coordinates: sampleCoords, location: sampleLocation })
    .expect(200);
  await broker.call('fishings.endFishing', { coordinates: sampleCoords }, { meta: ownerMeta });

  // Trip 2 — weigh the leftover catcher. No build, no remove, so this fishing
  // owns no `tools_groups_events` row at all.
  const weighFishing: any = await broker.call(
    'fishings.startFishing',
    { type: 'ESTUARY', coordinates: sampleCoords },
    { meta: ownerMeta },
  );
  weighFishingId = weighFishing.id;

  const fishTypes: any[] = await broker.call('fishTypes.find');
  await request(apiService.server)
    .post(`/zvejyba/api/toolsGroups/weigh/${groupId}`)
    .set(headers)
    .send({
      coordinates: sampleCoords,
      location: sampleLocation,
      data: { [fishTypes[0].id]: 4 },
    })
    .expect(200);
});
afterAll(() => broker.stop());

const rowOf = (res: any, id: any) => (res.body.rows ?? []).find((r: any) => r.id === id);

const journal = () =>
  request(apiService.server)
    .get('/zvejyba/api/fishings')
    .set(headers)
    .query({ populate: 'toolCategories' })
    .expect(200);

describe('fishings — toolCategories on a weigh-only trip', () => {
  it('reports the gear kind for a fishing that only weighed it', async () => {
    expect(rowOf(await journal(), weighFishingId)?.toolCategories).toEqual(['CATCHER']);
  });

  it('still reports the gear kind for the fishing that built it', async () => {
    expect(rowOf(await journal(), buildFishingId)?.toolCategories).toEqual(['CATCHER']);
  });

  it('lists the category once even though build and weigh both point at it', async () => {
    // The build trip and the weigh trip hit the same group; within one fishing
    // the two sources must not double up.
    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/remove/${groupId}`)
      .set(headers)
      .send({ coordinates: sampleCoords, location: sampleLocation })
      .expect(200);

    const row = rowOf(await journal(), weighFishingId);
    expect(row.toolCategories).toEqual(['CATCHER']);
  });
});
