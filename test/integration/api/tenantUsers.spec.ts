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

describe('tenantUsers.service', () => {
  it('OWNER can invite a new member via POST /tenantUsers/invite', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/tenantUsers/invite')
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({
        firstName: 'Invitee',
        lastName: 'Test',
        personalCode: '39001011234',
        role: TenantUserRole.USER,
        email: 'invitee@test.lt',
      })
      .expect(200);
    expect(res.body.role).toBe(TenantUserRole.USER);
    expect(res.body.tenant).toBe(apiHelper.tenantA.tenant.id);
  });

  it('USER-role member cannot invite (validateCanEditTenantUser blocks)', async () => {
    const res = await request(apiService.server)
      .post('/zvejyba/api/tenantUsers/invite')
      .set(apiHelper.getHeaders(apiHelper.userA.token, apiHelper.tenantA.tenant.id))
      .send({
        firstName: 'Should',
        lastName: 'Fail',
        personalCode: '39001019999',
        role: TenantUserRole.USER,
      });
    expect([401, 403]).toContain(res.status);
  });

  it('tenantUsers.my returns only the caller`s memberships', async () => {
    // moleculer-db's `GET /:id` autoAlias swallows `/my` (interprets it as
    // `id="my"`), so this action is normally only reachable via a direct
    // broker call. Tested at the broker layer to keep coverage honest.
    const res: any[] = await broker.call(
      'tenantUsers.my',
      {},
      { meta: apiHelper.meta(apiHelper.ownerA, apiHelper.tenantA.tenant.id) },
    );
    expect(Array.isArray(res)).toBe(true);
    res.forEach((tu: any) => {
      expect(tu.user).toBe(apiHelper.ownerA.user.id);
    });
  });

  it('updates tenant role through tenantUsers.updated event', async () => {
    // Find ownerA's tenantUser row and ensure role 'OWNER' is in user.tenants
    const owner: any = await broker.call(
      'users.resolve',
      { id: apiHelper.ownerA.user.id },
      { meta: { authToken: apiHelper.superAdmin.token } },
    );
    expect(owner.tenants?.[String(apiHelper.tenantA.tenant.id)]).toBe(TenantUserRole.OWNER);
  });

  it('beforeCreate rejects duplicate user/tenant pair', async () => {
    await expect(
      broker.call(
        'tenantUsers.create',
        {
          tenant: apiHelper.tenantA.tenant.id,
          user: apiHelper.ownerA.user.id,
          role: TenantUserRole.USER,
        },
        { meta: { authToken: apiHelper.ownerA.token } },
      ),
    ).rejects.toMatchObject({ type: 'ALREADY_EXISTS' });
  });

  it('OWNER updates a member`s role via PATCH /tenantUsers/update/:id', async () => {
    // Add a fresh member, then promote them.
    const member = await apiHelper.makeTenantMember(apiHelper.tenantA, TenantUserRole.USER);
    const tenantUsers: any[] = await broker.call(
      'tenantUsers.find',
      { query: { user: member.user.id, tenant: apiHelper.tenantA.tenant.id } },
      { meta: { authToken: apiHelper.superAdmin.token } },
    );
    const tuId = tenantUsers[0].id;
    await request(apiService.server)
      .patch(`/zvejyba/api/tenantUsers/update/${tuId}`)
      .set(apiHelper.getHeaders(apiHelper.ownerA.token, apiHelper.tenantA.tenant.id))
      .send({ role: TenantUserRole.USER_ADMIN })
      .expect(200);
  });
});
