'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

// The admin journal shows one "Žvejybos įrankių tipas" column per fishing, fed
// by the `toolCategories` virtual field. It carries the gear KIND (NET /
// CATCHER) — never the `toolTypes.label` taxonomy, whose names bake in mesh
// sizes. A fishing may show one category, both, or none.
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

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);

  const toolTypes: any[] = await broker.call('toolTypes.find');
  const nets = toolTypes.filter((t) => t.type === 'NET');
  const catcher = toolTypes.find((t) => t.type === 'CATCHER');

  // Five tools, two categories. Deliberately covers both ways a duplicate can
  // arise: two tools of the SAME tool type (S-TC-1 / S-TC-2, S-TC-4 / S-TC-5)
  // and two DIFFERENT net types (S-TC-1 / S-TC-3). The column must still read
  // "Gaudyklė, Tinklas" — never "Tinklas, Tinklas, Gaudyklė, Gaudyklė".
  const seals = [
    { sealNr: 'S-TC-1', toolType: nets[0].id },
    { sealNr: 'S-TC-2', toolType: nets[0].id },
    { sealNr: 'S-TC-3', toolType: nets[1].id },
    { sealNr: 'S-TC-4', toolType: catcher.id },
    { sealNr: 'S-TC-5', toolType: catcher.id },
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

const journal = () =>
  request(apiService.server)
    .get('/zvejyba/api/fishings')
    .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
    .query({ populate: 'toolCategories' })
    .expect(200);

describe('fishings — toolCategories virtual field', () => {
  it('lists each category once, however many tools share it', async () => {
    const row = rowOf(await journal(), fishingId);
    expect(row).toBeTruthy();
    // Five tools -> exactly two entries, no repeats.
    expect(row.toolCategories).toEqual(['CATCHER', 'NET']);
    expect(new Set(row.toolCategories).size).toBe(row.toolCategories.length);
  });

  it('never leaks the tool-type label (which carries mesh sizes)', async () => {
    const row = rowOf(await journal(), fishingId);
    for (const value of row.toolCategories) {
      expect(['NET', 'CATCHER']).toContain(value);
    }
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

    expect(rowOf(await journal(), bare.id)?.toolCategories).toEqual([]);
  });
});
