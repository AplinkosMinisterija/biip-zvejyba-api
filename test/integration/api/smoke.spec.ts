'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

describe('Smoke: broker boots and fixtures load', () => {
  beforeAll(async () => {
    await broker.start();
    await apiHelper.setup();
  });
  afterAll(() => broker.stop());

  it('creates superAdmin, adminA, two tenants', () => {
    expect(apiHelper.superAdmin.user.id).toBeTruthy();
    expect(apiHelper.adminA.user.id).toBeTruthy();
    expect(apiHelper.tenantA.tenant.id).toBeTruthy();
    expect(apiHelper.tenantB.tenant.id).toBeTruthy();
    expect(apiHelper.tenantA.owner.user.id).not.toEqual(apiHelper.tenantB.owner.user.id);
  });

  it('ping action returns timestamp', async () => {
    const res: any = await broker.call('api.ping');
    expect(typeof res.timestamp).toBe('number');
  });

  it('mock auth.users.resolveToken returns the fixture user for a known token', async () => {
    const res: any = await broker.call(
      'auth.users.resolveToken',
      null,
      { meta: { authToken: apiHelper.ownerA.token } },
    );
    expect(res.id).toBe(apiHelper.ownerA.authUser.id);
  });

  it('HTTP GET /zvejyba/api/ping returns 200 (no auth)', async () => {
    const res = await request(apiService.server).get('/zvejyba/api/ping').expect(200);
    expect(typeof res.body.timestamp).toBe('number');
  });

});
