'use strict';
// Regression: admin actions left createdBy/updatedBy/deletedBy NULL because
// api.service resolves `ctx.meta.user` only for authUser.type === USER, so the
// COMMON_FIELDS hooks had no id to write. Admins are now mirrored into a local
// `users` row (type ADMIN) purely to fill those audit columns.

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { TenantUserRole } from '../../../services/tenantUsers.service';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';
import { MockAuthState, MockAuthUserType } from '../../helpers/mock-auth.service';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

async function knexClient() {
  const usersService: any = broker.getLocalService('users');
  const adapter: any = await usersService.getAdapter();
  return adapter.client;
}

async function makeRemovableTenantUser() {
  const member = await apiHelper.makeTenantMember(apiHelper.tenantA, TenantUserRole.USER);
  const knex = await knexClient();
  const row = await knex('tenant_users')
    .where({ userId: Number(member.user.id) })
    .first();

  return { tenantUserId: Number(row.id) };
}

describe('audit columns', () => {
  it('fills deletedBy with the admin local user when an admin removes a row', async () => {
    const { tenantUserId } = await makeRemovableTenantUser();

    const res = await request(apiService.server)
      .delete(`/zvejyba/api/tenantUsers/${tenantUserId}`)
      .set(apiHelper.getHeaders(apiHelper.adminA.token));

    expect(res.statusCode).toBe(200);

    const knex = await knexClient();
    const row = await knex('tenant_users').where({ id: tenantUserId }).first();

    expect(row.deletedAt).not.toBeNull();
    expect(Number(row.deletedBy)).toBe(Number(apiHelper.adminA.user.id));
  });

  it('creates a local ADMIN row for an admin that has none yet', async () => {
    const { tenantUserId } = await makeRemovableTenantUser();
    const freshAdmin = MockAuthState.register({ type: MockAuthUserType.ADMIN });

    const knex = await knexClient();
    const before = await knex('users').where({ authUserId: freshAdmin.user.id }).first();
    expect(before).toBeUndefined();

    const res = await request(apiService.server)
      .patch(`/zvejyba/api/tenantUsers/${tenantUserId}`)
      .set(apiHelper.getHeaders(freshAdmin.token))
      .send({ role: TenantUserRole.USER_ADMIN });

    expect(res.statusCode).toBe(200);

    const mirrored = await knex('users').where({ authUserId: freshAdmin.user.id }).first();
    expect(mirrored).toBeDefined();
    expect(mirrored.type).toBe('ADMIN');
    expect(mirrored.email).toBeNull();
    expect(mirrored.phone).toBeNull();

    const row = await knex('tenant_users').where({ id: tenantUserId }).first();
    expect(Number(row.updatedBy)).toBe(Number(mirrored.id));
  });

  it('still writes the acting USER id, not an admin mirror', async () => {
    const { tenantUserId } = await makeRemovableTenantUser();

    const res = await request(apiService.server)
      .delete(`/zvejyba/api/tenantUsers/${tenantUserId}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id));

    expect(res.statusCode).toBe(200);

    const knex = await knexClient();
    const row = await knex('tenant_users').where({ id: tenantUserId }).first();

    expect(Number(row.deletedBy)).toBe(Number(apiHelper.ownerA.user.id));
  });

  it('does not expose mirrored admins in the users list', async () => {
    const res = await request(apiService.server)
      .get('/zvejyba/api/users')
      .set(apiHelper.getHeaders(apiHelper.adminA.token));

    expect(res.statusCode).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.rows.every((user: any) => user.type === 'USER')).toBe(true);
  });
});
