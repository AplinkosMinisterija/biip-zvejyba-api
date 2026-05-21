'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { TenantUserRole } from '../../../services/tenantUsers.service';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

describe('users.service — list / filter shapes', () => {
  it('list with `tenants` array filter returns the union', async () => {
    const tenantIds = [apiHelper.tenantA.tenant.id, apiHelper.tenantB.tenant.id];
    const rows: any = await broker.call(
      'users.list',
      { tenants: tenantIds },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(rows.total).toBeGreaterThanOrEqual(2);
    const ids = rows.rows.map((r: any) => r.id);
    expect(ids).toEqual(expect.arrayContaining([apiHelper.ownerA.user.id, apiHelper.ownerB.user.id]));
  });

  it('byTenant + role filter narrows to that role', async () => {
    const res = await request(apiService.server)
      .get(`/zvejyba/api/users/byTenant/${apiHelper.tenantA.tenant.id}`)
      .query({ role: TenantUserRole.OWNER })
      .set(apiHelper.getHeaders(apiHelper.superAdmin.token))
      .expect(200);
    const ids = res.body.rows.map((r: any) => r.id);
    expect(ids).toContain(apiHelper.ownerA.user.id);
    // USER-role member should NOT be there
    expect(ids).not.toContain(apiHelper.userA.user.id);
  });

  it('filterTenant ADMIN path with filter.tenantId narrows the list', async () => {
    const rows: any = await broker.call(
      'users.list',
      { filter: { tenantId: apiHelper.tenantA.tenant.id } },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    const ids = rows.rows.map((r: any) => r.id);
    expect(ids).toContain(apiHelper.ownerA.user.id);
    expect(ids).not.toContain(apiHelper.ownerB.user.id);
  });

  it('filterTenant ADMIN path accepts filter as a JSON string', async () => {
    const rows: any = await broker.call(
      'users.list',
      { filter: JSON.stringify({ tenantId: apiHelper.tenantA.tenant.id }) },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(rows.total).toBeGreaterThanOrEqual(1);
  });
});
