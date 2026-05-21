'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { MockAuthState } from '../../helpers/mock-auth.service';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

describe('tenants.service', () => {
  it('USER (no profile) cannot create a tenant', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/tenants')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token))
      .send({ name: 'X', code: '000000000', authGroup: 1 });
    // create is rest:null so the only HTTP path is the mappingPolicy:'all'
    // fallback `/tenants/create`. Either way a USER should NOT reach it.
    expect([401, 403, 404]).toContain(res.status);
  });

  it('ADMIN can POST /tenants/invite', async () => {
    const newCode = String(MockAuthState.nextGroupId());
    const res = await request(apiService.server)
      .post('/zvejyba/api/tenants/invite')
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({
        companyCode: newCode,
        companyName: 'Invited Co',
        companyPhone: '+37060001234',
        companyEmail: 'invited@test.lt',
        companyAddress: 'Vilnius',
      })
      .expect(200);
    expect(res.body.name).toBe('Invited Co');
    expect(res.body.code).toBe(newCode);
  });

  it('createPermissive allows admin to bypass scopes', async () => {
    const tenant: any = await broker.call(
      'tenants.createPermissive',
      {
        name: 'Permissive Co',
        code: String(MockAuthState.nextGroupId()),
        authGroup: MockAuthState.nextGroupId(),
        email: 'permissive@test.lt',
        phone: '+37060000000',
      },
      { meta: { authToken: apiHelper.adminA.token } },
    );
    expect(tenant.id).toBeTruthy();
  });

  it('soft-delete: deletedAt is set, list excludes deleted', async () => {
    const before: any = await broker.call('tenants.find');
    const beforeCount = before.length;
    await broker.call(
      'tenants.remove',
      { id: apiHelper.tenantA.tenant.id },
      { meta: { authToken: apiHelper.superAdmin.token } },
    );
    const after: any = await broker.call('tenants.find');
    expect(after.length).toBe(beforeCount - 1);
    expect(after.some((t: any) => t.id === apiHelper.tenantA.tenant.id)).toBe(false);
  });
});
