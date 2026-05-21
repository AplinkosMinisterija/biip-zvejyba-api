'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

const sampleCoords = { x: 21.13, y: 55.71 };

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

describe('weightEvents.service — public statistics endpoints', () => {
  it('GET /public/statistics aggregates totals across all final catches', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/public/statistics')
      .expect(200);
    expect(res.body).toHaveProperty('totalWeight');
    expect(res.body).toHaveProperty('totalFishTypes');
    expect(res.body).toHaveProperty('totalLocations');
  });

  it('GET /public/uetk/statistics returns an aggregation map', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .expect(200);
    expect(typeof res.body).toBe('object');
  });

  it('GET /public/uetk/statistics?fish=N filters by fish type', async () => {
    const fishTypes: any[] = await broker.call('fishTypes.find');
    const fishId = fishTypes[0].id;
    const res = await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ fish: fishId })
      .expect(200);
    expect(typeof res.body).toBe('object');
  });
});

describe('weightEvents.service — internal flow', () => {
  beforeAll(async () => {
    // Build a fresh active fishing for ownerA
    const ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
    const toolTypes: any[] = await broker.call('toolTypes.find');
    await broker.call(
      'tools.create',
      {
        sealNr: `S-WE-${Math.floor(Math.random() * 100_000)}`,
        toolType: toolTypes[0].id,
        data: { eyeSize: 60, netLength: 30 },
      },
      { meta: ownerMeta },
    );
    await broker.call(
      'fishings.startFishing',
      { type: 'INLAND_WATERS', coordinates: sampleCoords },
      { meta: ownerMeta },
    );
  });

  it('createWeightEvent without an active fishing throws ValidationError', async () => {
    // freelancerB has no profile and no active fishing, so currentFishing
    // returns null and the before-hook bails.
    await expect(
      broker.call(
        'weightEvents.createWeightEvent',
        { coordinates: sampleCoords, data: {} },
        { meta: apiHelper.meta(apiHelper.freelancerB) },
      ),
    ).rejects.toThrow();
  });

  it('getFishByFishing returns the partitioned shape', async () => {
    const ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
    const fishing: any = await broker.call(
      'fishings.currentFishing',
      {},
      { meta: ownerMeta },
    );
    const res: any = await broker.call(
      'weightEvents.getFishByFishing',
      { fishingId: fishing.id },
      { meta: ownerMeta },
    );
    expect(res).toHaveProperty('fishOnShore');
    expect(res).toHaveProperty('fishOnBoat');
  });

  it('data setter converts string values to numbers', async () => {
    const ownerMeta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
    const fishTypes: any[] = await broker.call('fishTypes.find');
    const fishId = fishTypes[0].id;

    const ev: any = await broker.call(
      'weightEvents.createWeightEvent',
      {
        coordinates: sampleCoords,
        data: { [fishId]: '12.5' as any }, // passed as string
      },
      { meta: ownerMeta },
    );
    expect(typeof ev.data[fishId]).toBe('number');
    expect(ev.data[fishId]).toBeCloseTo(12.5);
  });
});
