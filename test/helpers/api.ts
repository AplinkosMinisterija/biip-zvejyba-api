'use strict';

import { ServiceBroker } from 'moleculer';
import config from '../../moleculer.config';
import { Tenant } from '../../services/tenants.service';
import { TenantUserRole } from '../../services/tenantUsers.service';
import { User } from '../../services/users.service';
import MockAuthService, { MockAuthState, MockAuthUserType } from './mock-auth.service';
import MockMinioService, { MockMinioState } from './mock-minio.service';

// We deliberately do NOT load the real services/auth.service.ts here —
// the mock above shadows the `auth` service name. Same for minio.
const ApiSchema = require('../../services/api.service').default;
const UsersSchema = require('../../services/users.service').default;
const TenantsSchema = require('../../services/tenants.service').default;
const TenantUsersSchema = require('../../services/tenantUsers.service').default;
const FishingsSchema = require('../../services/fishings.service').default;
const FishingEventsSchema = require('../../services/fishingEvents.service').default;
const ToolsSchema = require('../../services/tools.service').default;
const ToolsGroupsSchema = require('../../services/toolsGroups.service').default;
const ToolsGroupsEventsSchema = require('../../services/toolsGroupsEvents.service').default;
const ToolTypesSchema = require('../../services/toolTypes.service').default;
const WeightEventsSchema = require('../../services/weightEvents.service').default;
const FishTypesSchema = require('../../services/fishTypes.service').default;
const PoldersSchema = require('../../services/polders.service').default;
const LocationsSchema = require('../../services/location.service').default;
const ResearchesSchema = require('../../services/researches.service').default;
const ResearchesFishesSchema = require('../../services/researches.fishes.service').default;

// Services we wipe at the start of every spec. seedDB-driven tables
// (toolTypes/fishTypes/polders) are intentionally left alone — their
// content is reference data populated once when the broker boots, and
// rebuilding it on every spec would require running the private `seedDB`
// method by hand (it isn't a registered action).
const SERVICES_WITH_TABLES = [
  'users',
  'tenants',
  'tenantUsers',
  'fishings',
  'fishingEvents',
  'tools',
  'toolsGroups',
  'toolsGroupsEvents',
  'weightEvents',
  'researches',
  'researches.fishes',
];
const SEED_BACKED_SERVICES = ['toolTypes', 'fishTypes', 'polders'];

export const serviceBrokerConfig = {
  ...config,
  logLevel: 'warn' as const,
  metrics: { enabled: false },
  tracing: { enabled: false },
  cacher: 'Memory' as const,
};

export interface FixtureUser {
  user: User;
  authUser: { id: number; type: MockAuthUserType };
  token: string;
}

export interface FixtureTenant {
  tenant: Tenant;
  owner: FixtureUser;
  authGroupId: number;
}

export class ApiHelper {
  broker: ServiceBroker;
  apiService: any;

  superAdmin!: FixtureUser;
  adminA!: FixtureUser;
  freelancerA!: FixtureUser;
  freelancerB!: FixtureUser;
  tenantA!: FixtureTenant;
  tenantB!: FixtureTenant;
  ownerA!: FixtureUser; // OWNER of tenantA
  userA!: FixtureUser;  // USER member of tenantA
  ownerB!: FixtureUser; // OWNER of tenantB

  constructor(broker: ServiceBroker) {
    this.broker = broker;
  }

  initializeServices() {
    // Mock services must be created first so they "win" the name slot.
    this.broker.createService(MockAuthService);
    this.broker.createService(MockMinioService);
    const apiService = this.broker.createService(ApiSchema);
    [
      UsersSchema,
      TenantsSchema,
      TenantUsersSchema,
      FishingsSchema,
      FishingEventsSchema,
      ToolsSchema,
      ToolsGroupsSchema,
      ToolsGroupsEventsSchema,
      ToolTypesSchema,
      WeightEventsSchema,
      FishTypesSchema,
      PoldersSchema,
      LocationsSchema,
      ResearchesSchema,
      ResearchesFishesSchema,
    ].forEach((s) => this.broker.createService(s));
    this.apiService = apiService;
    return apiService;
  }

  async setup() {
    await this.broker.waitForServices([
      'api',
      'auth',
      'minio',
      ...SERVICES_WITH_TABLES,
      ...SEED_BACKED_SERVICES,
    ]);

    // moleculer-web rebuilds autoAliases on a 500 ms debounce after services
    // mount, so we have to wait for the regeneration to land before the
    // first HTTP request — otherwise routes like `GET /fishings` come back
    // as a `ServiceNotFoundError` even though the service IS registered.
    await new Promise<void>((resolve) => {
      const handler = () => {
        this.broker.localBus.off('$api.aliases.regenerated', handler);
        resolve();
      };
      this.broker.localBus.on('$api.aliases.regenerated', handler);
      // Safety net: in case the event already fired before we got here.
      setTimeout(() => {
        this.broker.localBus.off('$api.aliases.regenerated', handler);
        resolve();
      }, 1500);
    });

    // Wipe both auth state and tenant-scoped DB rows so every spec
    // starts clean. Reference tables (fishTypes/polders/toolTypes) stay
    // populated from seed.
    MockAuthState.reset();
    MockMinioState.reset();
    for (const s of SERVICES_WITH_TABLES) {
      try {
        await this.broker.call(`${s}.removeAllEntities`);
      } catch (_) {
        // Some services may not expose `removeAllEntities` — ignore.
      }
    }

    // ── fixture set ─────────────────────────────────────────────────
    this.superAdmin = await this.makeAuthUser(MockAuthUserType.SUPER_ADMIN);
    this.adminA = await this.makeAuthUser(MockAuthUserType.ADMIN);
    this.freelancerA = await this.makeLocalUser(MockAuthUserType.USER, { isFreelancer: true });
    this.freelancerB = await this.makeLocalUser(MockAuthUserType.USER, { isFreelancer: true });

    this.tenantA = await this.makeTenantWithOwner('Company-A', '111111119');
    this.ownerA = this.tenantA.owner;
    this.tenantB = await this.makeTenantWithOwner('Company-B', '222222227');
    this.ownerB = this.tenantB.owner;

    // A USER-role member of tenantA so we can test role gating.
    this.userA = await this.makeTenantMember(this.tenantA, TenantUserRole.USER);
  }

  // ── helpers ────────────────────────────────────────────────────────

  async makeAuthUser(
    type: MockAuthUserType = MockAuthUserType.USER,
    overrides: Partial<User> = {},
  ): Promise<FixtureUser> {
    const reg = MockAuthState.register({ type });
    const user: User = await this.broker.call('users.create', {
      authUser: reg.user.id,
      firstName: reg.user.firstName,
      lastName: reg.user.lastName,
      email: reg.user.email,
      phone: reg.user.phone,
      type: type === MockAuthUserType.USER ? 'USER' : 'ADMIN',
      ...overrides,
    });
    return { user, authUser: reg.user, token: reg.token };
  }

  async makeLocalUser(
    type: MockAuthUserType = MockAuthUserType.USER,
    overrides: Partial<User> = {},
  ): Promise<FixtureUser> {
    return this.makeAuthUser(type, overrides);
  }

  async makeTenantWithOwner(name: string, code: string): Promise<FixtureTenant> {
    const authGroupId = MockAuthState.nextGroupId();
    const owner = await this.makeAuthUser(MockAuthUserType.USER);
    const tenant: Tenant = await this.broker.call('tenants.create', {
      name,
      code,
      authGroup: authGroupId,
      email: `${code}@test.lt`,
      phone: '+37060000000',
    });
    // Direct tenantUsers.create through admin meta so beforeCreate is happy
    // about the auth assignment (mock simply records it).
    await this.broker.call(
      'tenantUsers.create',
      { tenant: tenant.id, user: owner.user.id, role: TenantUserRole.OWNER },
      { meta: { authToken: owner.token } },
    );
    return { tenant, owner, authGroupId };
  }

  async makeTenantMember(tenant: FixtureTenant, role: TenantUserRole): Promise<FixtureUser> {
    const member = await this.makeAuthUser(MockAuthUserType.USER);
    await this.broker.call(
      'tenantUsers.create',
      { tenant: tenant.tenant.id, user: member.user.id, role },
      { meta: { authToken: member.token } },
    );
    return member;
  }

  getHeaders(token?: string, profileId?: any) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (profileId !== undefined && profileId !== null) headers['x-profile'] = String(profileId);
    return headers;
  }

  // Helper for direct `broker.call(...)` test paths: builds the same
  // `ctx.meta` shape that `api.service.ts.authenticate()` would attach
  // on an HTTP request. The real authenticate only sets `ctx.meta.user`
  // for `USER`-type accounts (not ADMIN/SUPER_ADMIN) — `users.filterTenant`
  // relies on that distinction to differentiate between "user needs a
  // tenant profile" and "admin can see everything". Mirror that here so
  // tests don't see a phantom UnAuthorizedError when an admin path is
  // exercised via broker.call.
  meta(user: FixtureUser, profile?: any) {
    const isAdminLike =
      user.authUser?.type === ('ADMIN' as any) ||
      user.authUser?.type === ('SUPER_ADMIN' as any);
    return {
      authToken: user.token,
      authUser: user.authUser,
      user: isAdminLike ? undefined : user.user,
      profile: profile ?? null,
    };
  }
}

export async function startBroker(): Promise<{ broker: ServiceBroker; apiHelper: ApiHelper }> {
  const broker = new ServiceBroker(serviceBrokerConfig);
  const apiHelper = new ApiHelper(broker);
  apiHelper.initializeServices();
  await broker.start();
  await apiHelper.setup();
  return { broker, apiHelper };
}
