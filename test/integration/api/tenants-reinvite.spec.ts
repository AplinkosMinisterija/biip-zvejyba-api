'use strict';
// Regression: inviting a company again after it was deleted created a SECOND tenant
// row for the same auth group, empty of members — the auth server hands back the
// existing company group, so the old tenant and the new one pointed at one group.
// The deleted tenant is now restored instead, together with the members that the
// tenant-removal cascade took out. Members removed before the deletion (i.e. removed
// deliberately) stay out.

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import request from 'supertest';
import { TenantUserRole } from '../../../services/tenantUsers.service';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';
import { MockAuthState } from '../../helpers/mock-auth.service';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
const apiService = apiHelper.initializeServices();

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

const COMPANY_CODE = '133333336';

async function knexClient() {
  const usersService: any = broker.getLocalService('users');
  const adapter: any = await usersService.getAdapter();
  return adapter.client;
}

function adminHeaders() {
  return apiHelper.getHeaders(apiHelper.adminA.token);
}

function invitePayload() {
  return {
    companyCode: COMPANY_CODE,
    companyName: 'Reinvite Company',
    companyPhone: '+37060012345',
    companyEmail: 'reinvite@test.lt',
    companyAddress: 'Vilnius',
  };
}

async function waitForCascade(tenantId: number) {
  const knex = await knexClient();
  for (let i = 0; i < 25; i++) {
    const rows = await knex('tenant_users').where({ tenantId });
    if (rows.length && rows.every((row: any) => row.deletedAt)) return rows;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('tenant removal cascade did not finish');
}

describe('tenants.invite for a deleted company', () => {
  it('restores the tenant and the members removed with it', async () => {
    const knex = await knexClient();

    const invited = await request(apiService.server)
      .post('/zvejyba/api/tenants/invite')
      .set(adminHeaders())
      .send(invitePayload());
    expect(invited.statusCode).toBe(200);
    const tenantId = Number(invited.body.id);

    // Two members: one is removed deliberately before the company is deleted.
    const owner = await apiHelper.makeAuthUser();
    const leaver = await apiHelper.makeAuthUser();
    for (const [member, role] of [
      [owner, TenantUserRole.OWNER],
      [leaver, TenantUserRole.USER],
    ] as const) {
      await broker.call('tenantUsers.create', {
        tenant: tenantId,
        user: member.user.id,
        role,
      });
    }

    const leaverRow = await knex('tenant_users')
      .where({ tenantId, userId: Number(leaver.user.id) })
      .first();
    await broker.call(
      'tenantUsers.remove',
      { id: leaverRow.id },
      { meta: apiHelper.meta(apiHelper.adminA) },
    );

    // A second apart, so the restore window cannot reach back to it.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const removed = await request(apiService.server)
      .delete(`/zvejyba/api/tenants/${tenantId}`)
      .set(adminHeaders());
    expect(removed.statusCode).toBe(200);
    await waitForCascade(tenantId);

    const reinvite = await request(apiService.server)
      .post('/zvejyba/api/tenants/invite')
      .set(adminHeaders())
      .send(invitePayload());

    expect(reinvite.statusCode).toBe(200);
    // Same row, not a duplicate.
    expect(Number(reinvite.body.id)).toBe(tenantId);

    const tenantRow = await knex('tenants').where({ id: tenantId }).first();
    expect(tenantRow.deletedAt).toBeNull();

    const tenantCount = await knex('tenants')
      .where({ authGroupId: tenantRow.authGroupId })
      .whereNull('deletedAt')
      .count('* as c')
      .first();
    expect(Number(tenantCount.c)).toBe(1);

    const ownerRow = await knex('tenant_users')
      .where({ tenantId, userId: Number(owner.user.id) })
      .first();
    expect(ownerRow.deletedAt).toBeNull();

    // Removed before the company was deleted — stays out.
    const leaverRowAfter = await knex('tenant_users').where({ id: leaverRow.id }).first();
    expect(leaverRowAfter.deletedAt).not.toBeNull();

    // And the auth-side membership is back, with the role mapped as on invite.
    const authOwner = MockAuthState.getUser(owner.authUser.id);
    expect(authOwner?.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: Number(tenantRow.authGroupId), role: 'ADMIN' }),
      ]),
    );
  });

  it('refuses to create a second tenant for a live company', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/tenants/invite')
      .set(adminHeaders())
      .send(invitePayload());

    expect(res.statusCode).toBe(422);
    expect(res.body.type).toBe('ALREADY_EXISTS');
  });
});
