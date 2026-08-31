'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

const coords = { x: 21.13, y: 55.71 };

let fishTypes: any[];
let fishingId: number;
let shoreEventId: number;

const correctUrl = (id: number) => `/zvejyba/api/weightEvents/${id}/correct`;

// One onshore weigh-in by the fisher, which the AAD officer then corrects.
async function seedShoreWeighIn() {
  const meta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
  // `fishings.startFishing` refuses to open a session with an empty tool
  // inventory, so the tenant needs at least one sealed tool.
  const toolTypes: any[] = await broker.call('toolTypes.find');
  await broker.call(
    'tools.create',
    {
      sealNr: `S-WEC-${Math.floor(Math.random() * 100_000)}`,
      toolType: toolTypes[0].id,
      data: { eyeSize: 60, netLength: 30 },
    },
    { meta },
  );
  const fishing: any = await broker.call(
    'fishings.startFishing',
    { type: 'ESTUARY', coordinates: coords },
    { meta },
  );
  fishingId = fishing.id;
  const event: any = await broker.call(
    'weightEvents.createWeightEvent',
    { coordinates: coords, data: { [fishTypes[0].id]: 10 } },
    { meta },
  );
  shoreEventId = event.id;
}

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
  fishTypes = await broker.call('fishTypes.find');
  await seedShoreWeighIn();
});
afterAll(() => broker.stop());

describe('weightEvents.correctWeights', () => {
  it('lets an admin rewrite the weights and records the AAD PPT report number', async () => {
    const res = await request(apiService.server)
      .post(correctUrl(shoreEventId))
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({
        data: { [fishTypes[0].id]: 4.5 },
        reportNumber: 'PPT-2026-0001',
        note: 'Žvejys nurodė klaidingą svorį',
      })
      .expect(200);

    expect(res.body.data).toEqual({ [`${fishTypes[0].id}`]: 4.5 });
    expect(res.body.corrections).toHaveLength(1);

    const [correction] = res.body.corrections;
    expect(correction.previousData).toEqual({ [`${fishTypes[0].id}`]: 10 });
    expect(correction.reportNumber).toBe('PPT-2026-0001');
    expect(correction.note).toBe('Žvejys nurodė klaidingą svorį');
    expect(correction.correctedBy.authUserId).toBe(apiHelper.adminA.authUser.id);
    expect(typeof correction.correctedAt).toBe('string');
  });

  it('lets an admin swap the species — the mixed-up-fish case', async () => {
    const res = await request(apiService.server)
      .post(correctUrl(shoreEventId))
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({
        data: { [fishTypes[1].id]: 4.5 },
        reportNumber: 'PPT-2026-0002',
      })
      .expect(200);

    expect(res.body.data).toEqual({ [`${fishTypes[1].id}`]: 4.5 });
    // Append-only: the first correction and the fisher's original entry
    // both survive the second amendment.
    expect(res.body.corrections).toHaveLength(2);
    expect(res.body.corrections[0].previousData).toEqual({ [`${fishTypes[0].id}`]: 10 });
    expect(res.body.corrections[1].previousData).toEqual({ [`${fishTypes[0].id}`]: 4.5 });
  });

  it('rejects a fisher — only AAD officers may amend a catch entry', async () => {
    await request(apiService.server)
      .post(correctUrl(shoreEventId))
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ data: { [fishTypes[0].id]: 1 }, reportNumber: 'PPT-2026-0003' })
      .expect(401);
  });

  it('requires the report number', async () => {
    await request(apiService.server)
      .post(correctUrl(shoreEventId))
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({ data: { [fishTypes[0].id]: 1 } })
      .expect(422);
  });

  it('rejects an unknown fish type', async () => {
    const res = await request(apiService.server)
      .post(correctUrl(shoreEventId))
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({ data: { 999999: 1 }, reportNumber: 'PPT-2026-0004' });

    expect(res.status).toBe(422);
  });

  it('rejects a non-positive weight', async () => {
    await request(apiService.server)
      .post(correctUrl(shoreEventId))
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({ data: { [fishTypes[0].id]: 0 }, reportNumber: 'PPT-2026-0005' })
      .expect(422);
  });

  it('surfaces the corrections trail in the fishing journal history', async () => {
    const res = await request(apiService.server)
      .get(`/zvejyba/api/fishings/history/${fishingId}`)
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .expect(200);

    const shoreEvent = res.body.history.find((e: any) => e.type === 'WEIGHT_ON_SHORE');
    expect(shoreEvent).toBeTruthy();
    expect(shoreEvent.corrections).toHaveLength(2);
    expect(shoreEvent.corrections[0].reportNumber).toBe('PPT-2026-0001');
  });
});

describe('weightEvents generic mutations', () => {
  // `mappingPolicy: 'all'` publishes update/remove at the fallback URL even
  // with `rest: null`; without the ADMIN gate a fisher could rewrite their own
  // catch record and leave no corrections trail behind.
  it('blocks a fisher from the update fallback URL', async () => {
    await request(apiService.server)
      .post('/zvejyba/api/weightEvents/update')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ id: shoreEventId, data: { [fishTypes[0].id]: 1 } })
      .expect(401);
  });

  it('blocks a fisher from the remove fallback URL', async () => {
    await request(apiService.server)
      .post('/zvejyba/api/weightEvents/remove')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ id: shoreEventId })
      .expect(401);
  });
});
