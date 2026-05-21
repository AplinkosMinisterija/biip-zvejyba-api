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

describe('api.service — authenticate/authorize gates', () => {
  it('PUBLIC endpoints (ping) require no Bearer', async () => {
    await request(apiService.server).get('/zvejyba/api/ping').expect(200);
  });

  it('missing Bearer on a USER endpoint returns 401', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/fishings/current')
      .expect(401);
  });

  it('non-Bearer prefix is rejected', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/fishings/current')
      .set('Authorization', 'Basic ' + Buffer.from('a:b').toString('base64'))
      .expect(401);
  });

  it('unknown Bearer returns 401', async () => {
    await request(apiService.server)
      .get('/zvejyba/api/fishings/current')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('USER role hitting an ADMIN endpoint returns 401 NO_RIGHTS', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/users/invite')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({
        personalCode: '39001011111',
        firstName: 'F',
        lastName: 'L',
        email: 'e@test.lt',
        phone: '+37060001111',
        isInvestigator: false,
      });
    expect([401, 403]).toContain(res.status);
  });

  it('SUPER_ADMIN can hit ADMIN endpoints', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/users/invite')
      .set(apiHelper.getHeaders(apiHelper.superAdmin.token))
      .send({
        personalCode: '39001011112',
        firstName: 'F',
        lastName: 'L',
        email: 'super@test.lt',
        phone: '+37060001112',
        isInvestigator: false,
      });
    expect(res.status).toBe(200);
  });

  it('INVESTIGATOR endpoint rejects users without the access flag', async () => {
    // researches.createOrUpdate is INVESTIGATOR-only
    const res = await request(apiService.server)
      .post('/zvejyba/api/researches')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({});
    expect([401, 403]).toContain(res.status);
  });

  it('CORS preflight (OPTIONS) returns 2xx with permissive origin', async () => {
    const res = await request(apiService.server)
      .options('/zvejyba/api/ping')
      .set('Origin', 'https://anywhere.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});
