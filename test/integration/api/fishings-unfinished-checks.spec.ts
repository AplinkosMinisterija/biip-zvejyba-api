'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

const coordinates = { x: 21.13, y: 55.71 };
const bar = {
  id: '7',
  name: '7 baras',
  type: 'ESTUARY',
  municipality: { id: 41, name: 'Klaipėda' },
};

let ownerMeta: any;
let headers: Record<string, string>;
let fishId: number;
let trap1: number;
let trap2: number;
let net1: number;

async function createTool(sealNr: string, toolType: number): Promise<number> {
  await broker.call(
    'tools.create',
    { sealNr, toolType, data: { eyeSize: 60, netLength: 30 } },
    { meta: ownerMeta },
  );
  const tool: any = await broker.call('tools.findOne', { query: { sealNr } }, { meta: ownerMeta });
  const stored: any[] = await broker.call(
    'toolsGroups.find',
    { query: { removeEvent: { $exists: false } } },
    { meta: ownerMeta },
  );
  return stored.find((group) => group.tools?.some((t: any) => t.id === tool.id)).id;
}

const build = (id: number) =>
  request(apiService.server)
    .post(`/zvejyba/api/toolsGroups/build/${id}`)
    .set(headers)
    .send({ coordinates, location: bar })
    .expect(200);

const weigh = (id: number, data: Record<number, number>) =>
  request(apiService.server)
    .post(`/zvejyba/api/toolsGroups/weigh/${id}`)
    .set(headers)
    .send({ coordinates, location: bar, data })
    .expect(200);

const getWeights = () =>
  request(apiService.server).get('/zvejyba/api/fishings/weights').set(headers).expect(200);

const weighOnShore = () =>
  request(apiService.server)
    .post('/zvejyba/api/fishings/weight')
    .set(headers)
    .send({ coordinates, data: { [fishId]: 5 }, preliminaryData: { [fishId]: 5 } });

const endFishing = () =>
  request(apiService.server).post('/zvejyba/api/fishings/end').set(headers).send({ coordinates });

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
  headers = apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id);

  const toolTypes: any[] = await broker.call('toolTypes.find');
  const trapType = toolTypes.find((t) => t.type === 'CATCHER').id;
  const netType = toolTypes.find((t) => t.type === 'NET').id;
  const fishTypes: any[] = await broker.call('fishTypes.find');
  fishId = fishTypes[0].id;

  trap1 = await createTool('UC-TRAP-1', trapType);
  trap2 = await createTool('UC-TRAP-2', trapType);
  net1 = await createTool('UC-NET-1', netType);
  const net2 = await createTool('UC-NET-2', netType);

  await broker.call('fishings.startFishing', { type: 'ESTUARY', coordinates }, { meta: ownerMeta });
  await build(trap1);
  await build(trap2);
  await build(net1);
  await build(net2);
  await endFishing().expect(200);

  const newTrap = await createTool('UC-TRAP-NEW', trapType);
  await broker.call('fishings.startFishing', { type: 'ESTUARY', coordinates }, { meta: ownerMeta });
  await build(newTrap);
});
afterAll(() => broker.stop());

const barWarning = [{ id: bar.id, name: bar.name }];

describe('fishings/weights — unfinishedCheckLocations', () => {
  it('reports nothing before any tool is checked', async () => {
    const res = await getWeights();
    expect(res.body.unfinishedCheckLocations).toEqual([]);
  });

  it('reports the bar once one tool of a type is checked and another is not', async () => {
    await weigh(trap1, { [fishId]: 5 });

    const res = await getWeights();
    expect(res.body.unfinishedCheckLocations).toEqual(barWarning);
  });

  it('keeps reporting after the checked tool is returned to the warehouse', async () => {
    await request(apiService.server)
      .post(`/zvejyba/api/toolsGroups/remove/${trap1}`)
      .set(headers)
      .send({ coordinates, location: bar })
      .expect(200);

    const res = await getWeights();
    expect(res.body.unfinishedCheckLocations).toEqual(barWarning);
  });

  it('clears once the type is fully checked, ignoring untouched types and gear set this trip', async () => {
    await weigh(trap2, {});

    const res = await getWeights();
    expect(res.body.unfinishedCheckLocations).toEqual([]);
  });

  it('is only a warning: shore weighing and ending still succeed', async () => {
    await weigh(net1, {});
    const res = await getWeights();
    expect(res.body.unfinishedCheckLocations).toEqual(barWarning);

    await weighOnShore().expect(200);
    await endFishing().expect(200);
  });
});
