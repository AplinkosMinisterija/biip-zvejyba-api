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
// A net built during the CURRENT fishing and not yet checked/weighed.
let groupId: number;

// Scenario: within a single, still-running fishing the angler builds a net and
// immediately tries to return it to the warehouse without pressing "Patikrinta"
// or weighing. The catch (if any) would be lost — so `removeTools` must block
// in-session tools too, not only leftovers from a previous trip.
beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
  headers = apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id);

  const toolTypes: any[] = await broker.call('toolTypes.find');
  await broker.call(
    'tools.create',
    { sealNr: 'S-CUR-1', toolType: toolTypes[0].id, data: { eyeSize: 60, netLength: 30 } },
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
  groupId = groups[0].id;
  await request(apiService.server)
    .post(`/zvejyba/api/toolsGroups/build/${groupId}`)
    .set(headers)
    .send({ coordinates: sampleCoords, location: sampleLocation })
    .expect(200);
});
afterAll(() => broker.stop());

describe('toolsGroups.removeTools — tool built in the current fishing', () => {
  it('rejects returning an in-session tool before it is checked/weighed', async () => {
    const res = await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/remove/${groupId}`)
      .set(headers)
      .send({ coordinates: sampleCoords, location: sampleLocation });
    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Previous fishing tool not weighted');
    const group: any = await broker.call(
      'toolsGroups.resolve',
      { id: groupId },
      { meta: ownerMeta },
    );
    expect(group.removeEvent).toBeFalsy();
  });

  it('allows the return once the tool is checked ("Patikrinta", empty weight)', async () => {
    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/weigh/${groupId}`)
      .set(headers)
      .send({ coordinates: sampleCoords, location: sampleLocation, data: {} })
      .expect(200);

    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/remove/${groupId}`)
      .set(headers)
      .send({ coordinates: sampleCoords, location: sampleLocation })
      .expect(200);

    const group: any = await broker.call(
      'toolsGroups.resolve',
      { id: groupId },
      { meta: ownerMeta },
    );
    expect(group.removeEvent).toBeTruthy();
  });
});
