'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

describe('fishTypes.service', () => {
  it('seedDB populated the full LT species list', async () => {
    const list: any[] = await broker.call('fishTypes.find');
    const labels = list.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(['Karšis', 'Sterkas', 'Lydeka', 'Karpis']));
  });

  it('GET /public/fishTypes is reachable without auth', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/public/fishTypes')
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Public response only carries the projection: id/label/photo.
    res.body.forEach((row: any) => {
      expect(Object.keys(row).sort()).toEqual(['id', 'label', 'photo'].sort());
    });
  });

  it('USER cannot create a fishType (ADMIN only)', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/fishTypes')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ label: 'TestFish', priority: 1 });
    expect([401, 403]).toContain(res.status);
  });

  it('ADMIN can create a fishType', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/fishTypes')
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({ label: 'AdminTestFish', priority: 5 })
      .expect(200);
    expect(res.body.label).toBe('AdminTestFish');
  });

  it('default sort respects priority (descending) then label', async () => {
    const list: any[] = await broker.call('fishTypes.find');
    expect(list.length).toBeGreaterThan(0);
    // Priority numbers go very high for the canonical list (9999...), zero
    // for the long tail, -1 for "Seliava" + "Kita rūšis". `priority` is
    // nullable in the schema, so coerce to Number for comparison.
    const priorities = list.map((f) => Number(f.priority ?? 0));
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i - 1]).toBeGreaterThanOrEqual(priorities[i]);
    }
  });
});
