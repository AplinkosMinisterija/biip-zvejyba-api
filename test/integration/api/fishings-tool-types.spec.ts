'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

// The admin journal shows one "Žvejybos įrankių tipas" column per fishing, fed
// by the `toolTypes` virtual field. It must list each tool type used in the
// fishing exactly once (a fishing usually deploys several groups of the same
// type) and stay empty for a fishing with no tools in the water.
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
let fishingId: any;
let labelA: string;
let labelB: string;

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);

  const toolTypes: any[] = await broker.call('toolTypes.find');
  labelA = toolTypes[0].label;
  labelB = toolTypes[1].label;

  // Two tools of type A and one of type B — the duplicate proves de-duplication.
  const seals = [
    { sealNr: 'S-TT-1', toolType: toolTypes[0].id },
    { sealNr: 'S-TT-2', toolType: toolTypes[0].id },
    { sealNr: 'S-TT-3', toolType: toolTypes[1].id },
  ];
  for (const tool of seals) {
    await broker.call(
      'tools.create',
      { ...tool, data: { eyeSize: 60, netLength: 30 } },
      { meta: ownerMeta },
    );
  }

  const fishing: any = await broker.call(
    'fishings.startFishing',
    { type: 'ESTUARY', coordinates: sampleCoords },
    { meta: ownerMeta },
  );
  fishingId = fishing.id;

  // Each tool create auto-creates a toolsGroup; building it stamps the
  // BUILD_TOOLS event that ties the group to this fishing.
  const groups: any[] = await broker.call('toolsGroups.find', {}, { meta: ownerMeta });
  for (const group of groups) {
    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/build/${group.id}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ coordinates: sampleCoords, location: sampleLocation })
      .expect(200);
  }
});
afterAll(() => broker.stop());

const rowOf = (res: any, id: any) => (res.body.rows ?? []).find((r: any) => r.id === id);

describe('fishings — toolTypes virtual field', () => {
  it('lists each deployed tool type once, alphabetically', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .query({ populate: 'toolTypes' })
      .expect(200);

    const row = rowOf(res, fishingId);
    expect(row).toBeTruthy();
    expect(row.toolTypes).toEqual([labelA, labelB].sort());
  });

  it('is an empty array for a fishing with no tools in the water', async () => {
    const bare: any = await broker.call(
      'fishings.create',
      {
        type: 'INLAND_WATERS',
        tenant: apiHelper.tenantA.tenant.id,
        user: apiHelper.ownerA.user.id,
      },
      { meta: { authToken: apiHelper.superAdmin.token } },
    );

    const res = await request(apiService.server)
      .get('/zvejyba/api/fishings')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .query({ populate: 'toolTypes' })
      .expect(200);

    expect(rowOf(res, bare.id)?.toolTypes).toEqual([]);
  });
});
