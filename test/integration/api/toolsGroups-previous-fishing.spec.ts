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
// The tool deployed in the first (now-ended) fishing and never pulled out.
let leftoverGroupId: number;

// Scenario: a net is built in fishing #1, the angler ends the trip WITHOUT
// weighing or pulling it out, then starts fishing #2 the next day and tries
// to return the leftover net straight to the warehouse. The catch would be
// lost — so `removeTools` must block until the fish is checked/weighed in the
// current session.
beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
  headers = apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id);

  const toolTypes: any[] = await broker.call('toolTypes.find');
  const sealNr = 'S-PREV-1';
  await broker.call(
    'tools.create',
    { sealNr, toolType: toolTypes[0].id, data: { eyeSize: 60, netLength: 30 } },
    { meta: ownerMeta },
  );

  // Fishing #1 — build the net, then end the trip with no weights logged.
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
  leftoverGroupId = groups[0].id;
  await request(apiService.server)
    .post(`/zvejyba/api/toolsGroups/build/${leftoverGroupId}`)
    .set(headers)
    .send({ coordinates: sampleCoords, location: sampleLocation })
    .expect(200);
  // No weight events at all → endFishing is allowed and the net stays in the water.
  await broker.call('fishings.endFishing', { coordinates: sampleCoords }, { meta: ownerMeta });

  // Fishing #2 — fresh trip, the leftover net is still deployed.
  await broker.call(
    'fishings.startFishing',
    { type: 'ESTUARY', coordinates: sampleCoords },
    { meta: ownerMeta },
  );
});
afterAll(() => broker.stop());

describe('toolsGroups.removeTools — leftover tool from a previous fishing', () => {
  it('rejects returning a previous-fishing tool before its fish is checked/weighed', async () => {
    const res = await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/remove/${leftoverGroupId}`)
      .set(headers)
      .send({ coordinates: sampleCoords, location: sampleLocation });
    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Previous fishing tool not weighted');
    // Still deployed — the remove must not have gone through.
    const group: any = await broker.call(
      'toolsGroups.resolve',
      { id: leftoverGroupId },
      { meta: ownerMeta },
    );
    expect(group.removeEvent).toBeFalsy();
  });

  it('allows the return once the tool is checked ("Patikrinta", empty weight) this session', async () => {
    // An empty check writes a weight_event with `data: {}` scoped to the
    // current fishing — per spec, checking OR weighing unblocks the return.
    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/weigh/${leftoverGroupId}`)
      .set(headers)
      .send({ coordinates: sampleCoords, location: sampleLocation, data: {} })
      .expect(200);

    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/remove/${leftoverGroupId}`)
      .set(headers)
      .send({ coordinates: sampleCoords, location: sampleLocation })
      .expect(200);

    const group: any = await broker.call(
      'toolsGroups.resolve',
      { id: leftoverGroupId },
      { meta: ownerMeta },
    );
    expect(group.removeEvent).toBeTruthy();
  });
});
