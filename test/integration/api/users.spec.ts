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

describe('users.service', () => {
  it('PATCH /users/me updates email and phone', async () => {
    const res = await request(apiService.server)
      .patch('/zvejyba/api/users/me')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ email: 'new@test.lt', phone: '+37060099887' })
      .expect(200);
    expect(res.body.email).toBe('new@test.lt');
    expect(res.body.phone).toBe('+37060099887');
  });

  it('PATCH /users/me requires Bearer token', async () => {
    const res = await request(apiService.server)
      .patch('/zvejyba/api/users/me')
      .send({ email: 'noauth@test.lt' });
    expect(res.status).toBe(401);
  });

  it('GET /users/byTenant/:tenant returns members of that tenant for an admin', async () => {
    const res = await request(apiService.server)
      .get(`/zvejyba/api/users/byTenant/${apiHelper.tenantA.tenant.id}`)
      .set(apiHelper.getHeaders(apiHelper.superAdmin.token))
      .expect(200);
    const userIds = res.body.rows.map((r: any) => r.id);
    expect(userIds).toEqual(expect.arrayContaining([apiHelper.ownerA.user.id, apiHelper.userA.user.id]));
  });

  it('filterTenant: USER without profile is rejected with NO_RIGHTS', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/users')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token)); // no x-profile
    expect([401, 403]).toContain(res.status);
  });

  it('POST /users/invite (ADMIN) creates a freelancer mirror', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/users/invite')
      .set(apiHelper.getHeaders(apiHelper.superAdmin.token))
      .send({
        personalCode: '39001011111',
        firstName: 'Frelans',
        lastName: 'Erys',
        email: 'frelans@test.lt',
        phone: '+37060011223',
        isInvestigator: false,
      })
      .expect(200);
    expect(res.body.isFreelancer).toBe(true);
    expect(res.body.email).toBe('frelans@test.lt');
  });

  it('email is lower-cased on set', async () => {
    const created: any = await broker.call(
      'users.create',
      {
        authUser: 99001,
        firstName: 'Mixed',
        lastName: 'Case',
        email: 'MixedCase@TEST.LT',
        type: 'USER',
      },
      { meta: { authToken: apiHelper.superAdmin.token } },
    );
    expect(created.email).toBe('mixedcase@test.lt');
  });

  it('POST /users/:id/impersonate produces a token for the target user', async () => {
    const res = await request(apiService.server)
      .post(`/zvejyba/api/users/${apiHelper.ownerA.user.id}/impersonate`)
      .set(apiHelper.getHeaders(apiHelper.superAdmin.token))
      .expect(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.id).toBe(apiHelper.ownerA.authUser.id);
  });
});
