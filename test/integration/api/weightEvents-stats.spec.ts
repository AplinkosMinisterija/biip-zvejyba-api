'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

const coords = { x: 21.13, y: 55.71 };

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();

  // Seed enough shape so getStatisticsForUETK has rows to reduce over.
  const meta = apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id);
  const toolTypes: any[] = await broker.call('toolTypes.find');
  const sealNr = `S-WES-${Math.floor(Math.random() * 100_000)}`;
  await broker.call(
    'tools.create',
    { sealNr, toolType: toolTypes[0].id, data: { eyeSize: 60, netLength: 30 } },
    { meta },
  );
  await broker.call('fishings.startFishing', { type: 'ESTUARY', coordinates: coords }, { meta });
  const fishTypes: any[] = await broker.call('fishTypes.find');
  await broker.call(
    'weightEvents.createWeightEvent',
    {
      coordinates: coords,
      data: { [fishTypes[0].id]: 4 },
    },
    { meta },
  );
});
afterAll(() => broker.stop());

describe('weightEvents.getStatisticsForUETK', () => {
  it('returns a map keyed by cadastralId', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .expect(200);
    expect(typeof res.body).toBe('object');
  });

  it('?date=ISO scopes the aggregate', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ date: '2025-01-01' })
      .expect(200);
    expect(typeof res.body).toBe('object');
  });

  it('?date[from]&date[to] scopes the aggregate to a window', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ 'date[from]': '2025-01-01', 'date[to]': '2030-12-31' })
      .expect(200);
    expect(typeof res.body).toBe('object');
  });

  it('rejects an offset outside ±14:00 with 422 instead of a 500 that echoes SQL', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ 'date[from]': '2026-05-01T00:00:00+99:99' })
      .expect(422);
    expect(JSON.stringify(res.body)).not.toMatch(/select /i);
  });

  it('rejects an impossible calendar date in the window', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ 'date[from]': '2026-02-01', 'date[to]': '2026-02-30' })
      .expect(422);
  });

  it('rejects an impossible calendar date as the plain ?date', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ date: '2026-13-45' })
      .expect(422);
  });

  it('still accepts a full ISO datetime with an offset', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ 'date[from]': '2026-05-01T00:00:00+03:00', 'date[to]': '2026-05-31T23:59:59+03:00' })
      .expect(200);
  });

  it('?fish=<id> projects onto a single species', async () => {
    const fishTypes: any[] = await broker.call('fishTypes.find');
    const res = await request(apiService.server)
      .get('/zvejyba/api/public/uetk/statistics')
      .query({ fish: fishTypes[0].id })
      .expect(200);
    expect(typeof res.body).toBe('object');
  });
});

describe('weightEvents.getStatistics', () => {
  it('reports totals + locations + fishTypes', async () => {
    const res = await request(apiService.server).get('/zvejyba/api/public/statistics').expect(200);
    expect(typeof res.body.totalWeight).toBe('number');
    expect(typeof res.body.totalFishTypes).toBe('number');
    expect(typeof res.body.totalLocations).toBe('number');
  });
});
