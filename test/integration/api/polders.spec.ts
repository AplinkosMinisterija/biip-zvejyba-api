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

describe('polders.service', () => {
  it('seedDB populated the 13 Nemuno polderiai', async () => {
    const polders: any[] = await broker.call('polders.find');
    expect(polders.length).toBeGreaterThanOrEqual(13);
    const names = polders.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Alkos', 'Minijos', 'Šyšos']));
  });

  it('USER can list polders via HTTP', async () => {
    // moleculer-db's autoAlias is `GET /` (= `/polders` at the route root);
    // there is no `/polders/list` alias by default.
    const res = await request(apiService.server)
      .get('/zvejyba/api/polders')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .expect(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
  });

  it('USER cannot create polders (ADMIN only)', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/polders')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ name: 'NewPolder', area: 1234 });
    expect([401, 403]).toContain(res.status);
  });

  it('ADMIN can create polders', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/polders')
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({ name: 'TestPolder', area: 999 })
      .expect(200);
    expect(res.body.name).toBe('TestPolder');
    expect(res.body.area).toBe(999);
  });
});
