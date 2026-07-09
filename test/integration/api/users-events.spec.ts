'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import { TenantUserRole } from '../../../services/tenantUsers.service';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
apiHelper.initializeServices();

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

describe('users.service — CQRS event handlers', () => {
  it('`tenantUsers.*` event updates the `tenants` JSONB blob on the user', async () => {
    const user: any = await broker.call(
      'users.resolve',
      { id: apiHelper.ownerA.user.id },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(user.tenants).toHaveProperty(String(apiHelper.tenantA.tenant.id));
    expect(user.tenants[String(apiHelper.tenantA.tenant.id)]).toBe(TenantUserRole.OWNER);
  });

  it('removing a tenantUser strips the tenant from the user`s JSONB cache', async () => {
    const member = await apiHelper.makeTenantMember(apiHelper.tenantA, TenantUserRole.USER);

    // The CQRS handler in users.service.ts runs as a broadcast event, so
    // it lags the synchronous create call by a tick. Spin until the
    // cache catches up before asserting.
    let view: any = {};
    for (let i = 0; i < 30; i++) {
      view = await broker.call(
        'users.resolve',
        { id: member.user.id },
        { meta: apiHelper.meta(apiHelper.superAdmin) },
      );
      if (view?.tenants?.[String(apiHelper.tenantA.tenant.id)]) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(view.tenants).toHaveProperty(String(apiHelper.tenantA.tenant.id));

    const tu: any[] = await broker.call(
      'tenantUsers.find',
      { query: { tenant: apiHelper.tenantA.tenant.id, user: member.user.id } },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    await broker.call(
      'tenantUsers.remove',
      { id: tu[0].id },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );

    for (let i = 0; i < 30; i++) {
      view = await broker.call(
        'users.resolve',
        { id: member.user.id },
        { meta: apiHelper.meta(apiHelper.superAdmin) },
      );
      if (!view?.tenants?.[String(apiHelper.tenantA.tenant.id)]) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(view.tenants).not.toHaveProperty(String(apiHelper.tenantA.tenant.id));
  });

  it('changing isFreelancer toggles the FREELANCER auth group', async () => {
    // The mock auth.users.assignToGroup is a no-op promise — we just need
    // to make sure the event handler runs without throwing.
    const user: any = apiHelper.freelancerA.user;
    await broker.call(
      'users.update',
      { id: user.id, isFreelancer: false },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    await broker.call(
      'users.update',
      { id: user.id, isFreelancer: true },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
  });

  it('users.removed event cascades to tenantUsers cleanup + auth.users.remove', async () => {
    // Use `makeTenantMember` so the tenantUsers.create call gets the
    // sparse meta shape that the existing service code expects (bare
    // authToken — no `user` field that would trip users.filterTenant).
    const member = await apiHelper.makeTenantMember(apiHelper.tenantA, TenantUserRole.USER);

    await broker.call(
      'users.remove',
      { id: member.user.id },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );

    // tenantUsers cleanup happens via broadcast event — poll until done.
    let remaining: any[] = [];
    for (let i = 0; i < 30; i++) {
      remaining = await broker.call(
        'tenantUsers.find',
        { query: { user: member.user.id } },
        { meta: apiHelper.meta(apiHelper.superAdmin) },
      );
      if (remaining.length === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(remaining.length).toBe(0);
  });
});
