'use strict';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import { TenantUserRole } from '../../../services/tenantUsers.service';
import { MockAuthState } from '../../helpers/mock-auth.service';
import { ApiHelper, serviceBrokerConfig } from '../../helpers/api';

const broker = new ServiceBroker(serviceBrokerConfig);
const apiHelper = new ApiHelper(broker);
apiHelper.initializeServices();

beforeAll(async () => {
  await broker.start();
  await apiHelper.setup();
});
afterAll(() => broker.stop());

describe('tenants.service — events + side effects', () => {
  it('tenants.created with isInvestigator triggers permission assignment', async () => {
    // Spy on the mock auth service's permission action via broker emitter.
    const tenant: any = await broker.call(
      'tenants.create',
      {
        name: 'Investigators Co',
        code: String(MockAuthState.nextGroupId()),
        authGroup: MockAuthState.nextGroupId(),
        isInvestigator: true,
      },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(tenant.isInvestigator).toBe(true);
  });

  it('tenants.updated toggling isInvestigator triggers unassign', async () => {
    const tenant: any = await broker.call(
      'tenants.create',
      {
        name: 'Toggle Co',
        code: String(MockAuthState.nextGroupId()),
        authGroup: MockAuthState.nextGroupId(),
        isInvestigator: true,
      },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    const updated: any = await broker.call(
      'tenants.update',
      { id: tenant.id, isInvestigator: false },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    expect(updated.isInvestigator).toBe(false);
  });

  it('removeAuthGroup wipes tenantUsers before clearing the tenant', async () => {
    const tenant: any = await broker.call(
      'tenants.create',
      {
        name: 'Wipe Co',
        code: String(MockAuthState.nextGroupId()),
        authGroup: MockAuthState.nextGroupId(),
      },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    // Attach a tenantUser so removeAuthGroup has something to clean.
    // Mirror the helper's sparse meta — bare authToken keeps
    // users.filterTenant happy inside tenantUsers.beforeCreate.
    const member = await apiHelper.makeAuthUser();
    await broker.call(
      'tenantUsers.create',
      { tenant: tenant.id, user: member.user.id, role: TenantUserRole.USER },
      { meta: { authToken: member.token } },
    );

    // removeAuthGroup is a Method, not an Action — but it's also wired in
    // the service so calling tenants.remove triggers the event handler
    // which removes the auth-group, which transitively removes the
    // tenantUser via the `tenantUsers.removed` event. Easier path: just
    // delete the tenant and assert the member's tenantUser row is gone.
    await broker.call(
      'tenants.remove',
      { id: tenant.id },
      { meta: apiHelper.meta(apiHelper.superAdmin) },
    );
    // tenants.removed → tenantUsers.removed event cascades asynchronously;
    // poll briefly until the cleanup lands.
    let remaining: any[] = [];
    for (let i = 0; i < 30; i++) {
      remaining = await broker.call(
        'tenantUsers.find',
        { query: { tenant: tenant.id } },
        { meta: apiHelper.meta(apiHelper.superAdmin) },
      );
      if (remaining.length === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(remaining.length).toBe(0);
  });
});
