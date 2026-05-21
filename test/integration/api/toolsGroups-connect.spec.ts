'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
apiHelper.initializeServices();

const coords = { x: 21.13, y: 55.71 };
const location = { id: 'L1', name: 'L1', municipality: { id: 1, name: 'M' } };

let ownerMeta: any;

async function newTool(seal?: string): Promise<number> {
  const types: any[] = await broker.call('toolTypes.find');
  const sealNr = seal ?? `S-${Math.floor(Math.random() * 1_000_000)}`;
  await broker.call(
    'tools.create',
    { sealNr, toolType: types[0].id, data: { eyeSize: 60, netLength: 30 } },
    { meta: ownerMeta },
  );
  const tool: any = await broker.call(
    'tools.findOne',
    { query: { sealNr } },
    { meta: ownerMeta },
  );
  return tool.id;
}

async function groupOf(toolId: number): Promise<any> {
  return broker.call(
    'toolsGroups.findOne',
    { query: { $raw: `${toolId} = ANY(tools)` } },
    { meta: ownerMeta },
  );
}

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
});
afterAll(() => broker.stop());

describe('toolsGroups.connectTools / disconnectTools', () => {
  it('connectTools merges two compatible single-tool groups', async () => {
    const t1 = await newTool();
    const t2 = await newTool();

    const g1 = await groupOf(t1);
    const g2 = await groupOf(t2);
    expect(g1?.id).toBeTruthy();
    expect(g2?.id).toBeTruthy();

    const result: any = await broker.call(
      'toolsGroups.connectTools',
      { id: g1.id, tools: [t2] },
      { meta: ownerMeta },
    );
    // `tools` may come back as either raw IDs or populated Tool objects
    // depending on `defaultPopulates`; normalise to IDs for the assertion.
    const ids = (result.tools as any[]).map((t: any) => (typeof t === 'object' ? t.id : t));
    expect(ids).toEqual(expect.arrayContaining([t1, t2]));
  });

  it('connectTools throws on a mismatched tool type', async () => {
    // Create a second tool type so we can build a mismatched tool.
    const otherType: any = await broker.call(
      'toolTypes.create',
      { label: 'Gaudyklė', type: 'CATCHER' },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    const t1 = await newTool();
    const sealNr = `S-mismatch-${Math.floor(Math.random() * 1_000_000)}`;
    await broker.call(
      'tools.create',
      { sealNr, toolType: otherType.id, data: { eyeSize: 60 } },
      { meta: ownerMeta },
    );
    const t2: any = await broker.call(
      'tools.findOne',
      { query: { sealNr } },
      { meta: ownerMeta },
    );
    const g1 = await groupOf(t1);
    await expect(
      broker.call(
        'toolsGroups.connectTools',
        { id: g1.id, tools: [t2.id] },
        { meta: ownerMeta },
      ),
    ).rejects.toThrow(/Too many tool types/);
  });

  it('disconnectTools spins a fresh single-tool group off the source', async () => {
    const t1 = await newTool();
    const t2 = await newTool();
    const g1 = await groupOf(t1);
    await broker.call(
      'toolsGroups.connectTools',
      { id: g1.id, tools: [t2] },
      { meta: ownerMeta },
    );
    await broker.call(
      'toolsGroups.disconnectTools',
      { id: g1.id, tools: [t2] },
      { meta: ownerMeta },
    );
    const remaining: any = await broker.call(
      'toolsGroups.resolve',
      { id: g1.id },
      { meta: ownerMeta },
    );
    const remainingIds = (remaining.tools as any[]).map((t: any) =>
      typeof t === 'object' ? t.id : t,
    );
    expect(remainingIds).toEqual([t1]);
  });

  it('weighFish action stores a per-toolsGroup weight via the broker call', async () => {
    // Need an active fishing
    const tool = await newTool();
    await broker.call(
      'fishings.startFishing',
      { type: 'INLAND_WATERS', coordinates: coords },
      { meta: ownerMeta },
    );
    const g = await groupOf(tool);
    await broker.call(
      'toolsGroups.buildTools',
      { id: g.id, coordinates: coords, location },
      { meta: ownerMeta },
    );

    const fishTypes: any[] = await broker.call('fishTypes.find');
    const res: any = await broker.call(
      'toolsGroups.weighFish',
      {
        id: g.id,
        coordinates: coords,
        location,
        data: { [fishTypes[0].id]: 3 },
      },
      { meta: ownerMeta },
    );
    expect(res.success).toBe(true);
  });
});
