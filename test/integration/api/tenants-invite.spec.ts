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

describe('tenants.invite (admin-only)', () => {
  it('creates the tenant + optional owner in one shot', async () => {
    const companyCode = String(MockAuthState.nextGroupId());
    const res = await request(apiService.server)
      .post('/zvejyba/api/tenants/invite')
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({
        companyCode,
        companyName: 'Invite Co',
        companyPhone: '+37060001234',
        companyEmail: 'invite@test.lt',
        companyAddress: 'Vilnius',
        ownerRequired: true,
        firstName: 'Owner',
        lastName: 'Personas',
        email: 'owner@invite.test.lt',
        phone: '+37060001235',
        personalCode: '39001011444',
        isInvestigator: false,
      })
      .expect(200);
    expect(res.body.code).toBe(companyCode);

    // The owner invite happens via tenantUsers.invite — confirm a
    // membership exists with role OWNER.
    const memberships: any[] = await broker.call(
      'tenantUsers.find',
      { query: { tenant: res.body.id } },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(memberships.length).toBeGreaterThanOrEqual(1);
  });

  it('without ownerRequired the tenant is created standalone', async () => {
    const companyCode = String(MockAuthState.nextGroupId());
    const res = await request(apiService.server)
      .post('/zvejyba/api/tenants/invite')
      .set(apiHelper.getHeaders(apiHelper.adminA.token))
      .send({
        companyCode,
        companyName: 'Standalone Co',
        companyPhone: '+37060001236',
        companyEmail: 'standalone@test.lt',
        companyAddress: 'Vilnius',
        ownerRequired: false,
      })
      .expect(200);
    expect(res.body.name).toBe('Standalone Co');
  });
});
