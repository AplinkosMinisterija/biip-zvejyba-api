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
let headers: Record<string, string>;
// Built in fishing #1 and left in the water — the net the angler has to check
// before dropping new gear into the same bar.
let leftoverGroupId: number;

async function seedToolGroup(sealNr: string): Promise<number> {
  const toolTypes: any[] = await broker.call('toolTypes.find');
  await broker.call(
    'tools.create',
    { sealNr, toolType: toolTypes[0].id, data: { eyeSize: 60, netLength: 30 } },
    { meta: ownerMeta },
  );
  const tool: any = await broker.call(
    'tools.findOne',
    { query: { sealNr }, populate: ['toolsGroup'] },
    { meta: ownerMeta },
  );
  return tool.toolsGroup?.id ?? tool.toolsGroup;
}

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
  headers = apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id);

  // Fishing #1 — drop a net and go home. No weights, so the trip ends fine and
  // the net stays deployed.
  leftoverGroupId = await seedToolGroup('S-LEFTOVER-1');
  await broker.call(
    'fishings.startFishing',
    { type: 'ESTUARY', coordinates: sampleCoords },
    { meta: ownerMeta },
  );
  await request(apiService.server)
    .post(`/zvejyba/api/toolsGroups/build/${leftoverGroupId}`)
    .set(headers)
    .send({ coordinates: sampleCoords, location: sampleLocation })
    .expect(200);
  await broker.call('fishings.endFishing', { coordinates: sampleCoords }, { meta: ownerMeta });
});
afterAll(() => broker.stop());

describe('fishings.endFishing — trip that only sets new tools', () => {
  it("closes the fishing when the only empty check belongs to a previous trip's net", async () => {
    // Fishing #2 — the real-world trip: drop a fresh net in the same bar and
    // check the leftover one, which the app demands. Nothing is caught, so no
    // weight is ever recorded.
    await broker.call(
      'fishings.startFishing',
      { type: 'ESTUARY', coordinates: sampleCoords },
      { meta: ownerMeta },
    );
    const newGroupId = await seedToolGroup('S-FRESH-1');
    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/build/${newGroupId}`)
      .set(headers)
      .send({ coordinates: sampleCoords, location: sampleLocation })
      .expect(200);
    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/weigh/${leftoverGroupId}`)
      .set(headers)
      .send({ coordinates: sampleCoords, location: sampleLocation, data: {} })
      .expect(200);

    // The FE mirrors the same guard through this flag — a `true` here disables
    // "Pabaigti žvejybą" before the request is ever made.
    const weights = await request(apiService.server)
      .get('/zvejyba/api/fishings/weights')
      .set(headers)
      .expect(200);
    expect(weights.body.hasUncompletedTools).toBeFalsy();

    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/end')
      .set(headers)
      .send({ coordinates: sampleCoords })
      .expect(200);
    expect(res.body.endEvent).toBeTruthy();
  });

  it('still refuses when a net built on this trip is marked checked with no fish', async () => {
    // Fishing #3 — the shortcut the guard exists for: build a net, tap
    // "Patikrinta" on it, close the journal with zero catch.
    await broker.call(
      'fishings.startFishing',
      { type: 'ESTUARY', coordinates: sampleCoords },
      { meta: ownerMeta },
    );
    const ownGroupId = await seedToolGroup('S-OWN-1');
    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/build/${ownGroupId}`)
      .set(headers)
      .send({ coordinates: sampleCoords, location: sampleLocation })
      .expect(200);
    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/weigh/${ownGroupId}`)
      .set(headers)
      .send({ coordinates: sampleCoords, location: sampleLocation, data: {} })
      .expect(200);

    const weights = await request(apiService.server)
      .get('/zvejyba/api/fishings/weights')
      .set(headers)
      .expect(200);
    expect(weights.body.hasUncompletedTools).toBe(true);

    const res = await request(apiService.server)
      .post('/zvejyba/api/fishings/end')
      .set(headers)
      .send({ coordinates: sampleCoords });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/patikrinti, bet žuvies svoris/);

    const current: any = await broker.call('fishings.currentFishing', {}, { meta: ownerMeta });
    expect(current.endEvent).toBeFalsy();
  });
});
