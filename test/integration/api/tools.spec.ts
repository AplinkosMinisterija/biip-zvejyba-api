'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

let ownerMeta: any;

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
});
afterAll(() => broker.stop());

async function newTool(opts: Partial<{ sealNr: string }> = {}) {
  const types: any[] = await broker.call('toolTypes.find');
  const sealNr = opts.sealNr ?? `S-${Math.floor(Math.random() * 1_000_000)}`;
  // tools.create returns void thanks to afterCreate not echoing the
  // entity; round-trip via findOne for an entity our tests can read.
  await broker.call(
    'tools.create',
    { sealNr, toolType: types[0].id, data: { eyeSize: 60, netLength: 30 } },
    { meta: ownerMeta },
  );
  return broker.call('tools.findOne', { query: { sealNr } }, { meta: ownerMeta });
}

describe('tools.service', () => {
  it('rejects creating a tool without a seal number', async () => {
    await expect(
      broker.call(
        'tools.create',
        {
          // sealNr missing
          toolType: 1,
          data: { eyeSize: 60, netLength: 30 },
        },
        { meta: ownerMeta },
      ),
    ).rejects.toThrow();
  });

  it('rejects a duplicate seal number', async () => {
    const sealNr = `S-dup-${Math.floor(Math.random() * 1_000_000)}`;
    await newTool({ sealNr });
    await expect(newTool({ sealNr })).rejects.toThrow();
  });

  it('auto-creates a toolsGroup containing the new tool (afterCreate)', async () => {
    const tool: any = await newTool();
    const groups: any[] = await broker.call(
      'toolsGroups.find',
      { query: { $raw: `${tool.id} = ANY(tools)` } },
      { meta: ownerMeta },
    );
    expect(groups.length).toBeGreaterThan(0);
  });

  it('GET /tools/available lists tools whose group is not built', async () => {
    await newTool();
    const res = await request(apiService.server)
      .get('/zvejyba/api/tools/available')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('beforeDelete refuses to delete tools in use', async () => {
    const tool: any = await newTool();
    // Start a fishing so buildTools has a `currentFishing` to attach to,
    // then move the new tool's group into the water.
    await broker.call(
      'fishings.startFishing',
      { type: 'INLAND_WATERS', coordinates: { x: 21.13, y: 55.71 } },
      { meta: ownerMeta },
    );
    const groups: any[] = await broker.call(
      'toolsGroups.find',
      { query: { $raw: `${tool.id} = ANY(tools)` } },
      { meta: ownerMeta },
    );
    expect(groups.length).toBeGreaterThan(0);
    await broker.call(
      'toolsGroups.buildTools',
      {
        id: groups[0].id,
        coordinates: { x: 21.13, y: 55.71 },
        location: { id: 'X', name: 'X', municipality: { id: 1, name: 'Test' } },
      },
      { meta: ownerMeta },
    );
    await expect(
      broker.call('tools.remove', { id: tool.id }, { meta: ownerMeta }),
    ).rejects.toThrow(/Tools is in use|Cannot delete tool/);
  });
});
