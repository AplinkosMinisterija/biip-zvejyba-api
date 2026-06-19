'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';
import ProfileMixin from '../mixins/profile.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  INNER_AUTH_GROUP_IDS,
  RestrictionType,
  Table,
  throwNoRightsError,
} from '../types';
import { AuthUserRole, UserAuthMeta } from './api.service';
import { User, UserType } from './users.service';

import DbConnection from '../mixins/database.mixin';
import { validateCanEditTenantUser } from '../utils';
import { Tenant } from './tenants.service';

export enum AuthGroupRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

export enum TenantUserRole {
  USER = 'USER',
  USER_ADMIN = 'USER_ADMIN',
  OWNER = 'OWNER',
}

interface Fields extends CommonFields {
  id: string;
  tenant: Tenant['id'];
  user: User['id'];
  role: TenantUserRole;
}

interface Populates extends CommonPopulates {
  user: User;
  tenant: Tenant;
}

export type TenantUser<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'tenantUsers',

  mixins: [
    DbConnection({
      collection: 'tenantUsers',
      entityChangedOldEntity: true,
      createActions: {
        createMany: false,
      },
    }),
    ProfileMixin,
  ],

  settings: {
    auth: RestrictionType.ADMIN,

    plantuml: {
      relations: {
        tenants: 'zero-or-many-to-one',
        users: 'zero-or-many-to-one',
      },
    },

    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      tenant: {
        type: 'number',
        columnType: 'integer',
        columnName: 'tenantId',
        required: true,
        immutable: true,
        populate: {
          action: 'tenants.resolve',
          params: {
            scope: false,
          },
        },
      },
      user: {
        type: 'number',
        columnType: 'integer',
        columnName: 'userId',
        required: true,
        immutable: true,
        populate: {
          action: 'users.resolve',
          params: {
            scope: false,
          },
        },
        // validate: "validateTenant",
      },
      role: {
        type: 'string',
        enum: Object.values(TenantUserRole),
        default: TenantUserRole.USER,
      },

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulate: ['user'],
  },

  // TODO: list action - hooksu apriboti tik useriui priklausancius
  hooks: {
    before: {
      create: ['beforeCreate'],
      list: ['beforeSelect'],
      find: ['beforeSelect'],
      count: ['beforeSelect'],
      get: ['beforeSelect'],
      all: ['beforeSelect'],
      // The generic `remove` stays USER-callable (the web app deletes a
      // member via `DELETE /tenantUsers/:id`), so it MUST be guarded — see
      // `beforeRemove`. Internal cascades (`users.removed`/`tenants.removed`)
      // use `removeEntities` directly and skip this action hook.
      remove: ['beforeRemove'],
    },
  },

  actions: {
    find: {},
    list: {
      auth: RestrictionType.DEFAULT,
    },
    count: {},
    get: { auth: RestrictionType.DEFAULT },
    create: {
      auth: RestrictionType.ADMIN,
    },
    // The generic db `update` has NO ownership/tenant scope and accepts any
    // `role`, so it must not be reachable by a USER — that is a self-promotion
    // / cross-tenant privilege escalation (a USER could `POST
    // /tenantUsers/update {id, role:"OWNER"}` via the mappingPolicy:'all'
    // fallback). Members are edited through the guarded `updateTenantUser`
    // (`PATCH /update/:id`), which OWNER/USER_ADMIN use; internal callers
    // (`updateTenantUser`, `afterUserLoggedIn`) reach this via local ctx.call,
    // which bypasses the gateway auth.
    update: {
      auth: RestrictionType.ADMIN,
    },
    remove: {
      auth: RestrictionType.DEFAULT,
    },
  },
})
export default class TenantUsersService extends moleculer.Service {
  @Action({
    auth: RestrictionType.USER,
  })
  my(ctx: Context<null, UserAuthMeta>) {
    return this.findEntities(ctx, {
      query: {
        user: ctx.meta.user.id,
      },
    });
  }

  @Action({
    rest: 'PATCH /update/:id',
    auth: RestrictionType.USER,
    params: {
      id: { type: 'number', convert: true },
      role: {
        type: 'string',
        optional: true,
      },
      email: {
        type: 'string',
        optional: true,
      },
      phone: {
        type: 'string',
        optional: true,
      },
    },
  })
  async updateTenantUser(
    ctx: Context<
      {
        id: number;
        role: string;
        email: string;
        phone: string;
      },
      UserAuthMeta
    >,
  ) {
    validateCanEditTenantUser(ctx, 'Only OWNER and USER_ADMIN can update users to tenant.');
    const { profile } = ctx.meta;
    const { id, email, phone, role } = ctx.params;
    const tenantUser: TenantUser<'user'> = await ctx.call('tenantUsers.resolve', {
      id,
      throwIfNotExist: true,
      populate: ['user'],
    });

    // `tenantUsers.resolve` is not tenant-scoped, so a USER_ADMIN/OWNER of one
    // tenant could otherwise pass another tenant's membership id and edit it
    // (IDOR). Pin the target to the caller's active tenant via a raw scoped
    // lookup on the `tenantId` column (do NOT compare the serialized
    // `tenantUser.tenant`, which can be a populated/encoded reference).
    const ownedInTenant = await this.findEntity(ctx, {
      query: { id, tenant: profile },
    });
    if (!ownedInTenant) {
      throwNoRightsError('Cannot edit a user from another tenant.');
    }

    const currentUser = tenantUser.user;

    // Only touch the auth group when the role ACTUALLY changes. The web form
    // resubmits the member's current role on every email/phone edit, and a
    // needless `auth.users.assignToGroup` (which requires auth-API group-admin
    // rights and can 401) would then break an otherwise valid contact edit.
    if (role && role !== tenantUser.role) {
      const currentTenant: Tenant = await ctx.call('tenants.resolve', {
        throwIfNotExist: true,
        id: profile,
      });

      await ctx.call('tenantUsers.update', {
        id,
        tenant: profile,
        role,
      });

      const authRole =
        role === TenantUserRole.USER_ADMIN ? AuthGroupRole.ADMIN : AuthGroupRole.USER;

      await ctx.call('auth.users.assignToGroup', {
        id: currentUser.authUser,
        groupId: currentTenant.authGroup,
        role: authRole,
      });
    }

    return ctx.call('users.update', {
      id: currentUser?.id,
      email,
      phone,
    });
  }

  @Action({
    rest: 'POST /invite',
    auth: RestrictionType.DEFAULT,
    params: {
      firstName: 'string',
      lastName: 'string',
      personalCode: 'string',
      phone: {
        type: 'string',
        optional: true,
      },
      role: {
        type: 'enum',
        values: Object.values(TenantUserRole),
      },
      tenant: 'number|optional',
      email: {
        type: 'string',
        optional: true,
      },
    },
  })
  async invite(
    ctx: Context<
      {
        tenant?: number;
        role: TenantUserRole;
        firstName: string;
        lastName: string;
        personalCode: string;
        email: string;
        phone: string;
      },
      UserAuthMeta
    >,
  ) {
    // USER callers (mobile app) MUST identify the target tenant via
    // `x-profile` — the gateway has already validated their membership
    // there. They cannot smuggle a different tenant via the body
    // (audit security #A6/#M9). ADMIN / internal callers (e.g.
    // `tenants.invite` creating the seed OWNER alongside a brand-new
    // tenant) don't have `x-profile`, so the body fallback stays open
    // only for them.
    const isUserCaller = !!ctx.meta?.user && ctx.meta?.authUser?.type === AuthUserRole.USER;

    let tenantId: number | undefined | null;
    if (isUserCaller) {
      validateCanEditTenantUser(ctx, 'Only OWNER and USER_ADMIN can add users to tenant.');
      tenantId = ctx.meta.profile;
    } else {
      tenantId = ctx.meta.profile ?? ctx.params.tenant;
    }

    if (!tenantId) {
      throwNoRightsError('Tenant not specified.');
    }

    const { firstName, lastName, personalCode, role, email, phone } = ctx.params;

    const currentTenant: Tenant = await ctx.call('tenants.resolve', {
      id: tenantId,
    });

    const authRole = role === TenantUserRole.OWNER ? AuthGroupRole.ADMIN : AuthGroupRole.USER;

    const inviteData: any = {
      personalCode,
      companyId: currentTenant.authGroup,
      role: authRole,
    };

    if (email) {
      inviteData.notify = [email];
    }

    // if user aleady in group - it will throw error
    const authUser: any = await ctx.call('auth.users.invite', inviteData);

    let user: User = await ctx.call('users.findOne', {
      query: {
        authUser: authUser.id,
      },
    });

    if (!user) {
      user = await ctx.call('users.create', {
        authUser: authUser.id,
        firstName,
        lastName,
        email,
        phone,
      });
    }

    return this.createEntity(ctx, {
      tenant: currentTenant.id,
      user: user.id,
      role,
    });
  }

  @Action({})
  async getProfiles(ctx: Context<{}, UserAuthMeta>) {
    const { user } = ctx.meta;
    if (!user?.id || user?.type === UserType.ADMIN) return [];
    const tenantUsers: TenantUser[] = await this.findEntities(null, {
      query: {
        user: user.id,
      },
      scopes: false,
      populate: 'tenant',
    });

    const profiles: any[] = tenantUsers?.map((tenantUser: any) => {
      return {
        id: tenantUser.tenant.id,
        name: tenantUser.tenant.name,
        freelancer: false,
        email: user.email,
        phone: user.phone,
        role: tenantUser.role,
        isInvestigator: tenantUser.tenant.isInvestigator,
        code: tenantUser.tenant.code,
      };
    });
    if (user.isFreelancer) {
      profiles.push({
        id: 'freelancer',
        name: `${user.firstName} ${user.lastName}`,
        freelancer: true,
        isInvestigator: user.isInvestigator,
        email: user.email,
        phone: user.phone,
      });
    }

    return profiles;
  }

  @Method
  async beforeCreate(ctx: Context<any>) {
    const { user, tenant } = ctx.params;

    const tenantUsersCount = await ctx.call('tenantUsers.count', {
      query: {
        tenant,
        user,
      },
    });

    if (tenantUsersCount) {
      throw new moleculer.Errors.MoleculerClientError('Already exists', 422, 'ALREADY_EXISTS');
    }

    const userEntity: User = await ctx.call('users.get', { id: user });
    const tenantEntity: Tenant = await ctx.call('tenants.get', { id: tenant });

    await ctx.call('auth.users.assignToGroup', {
      id: userEntity.authUser,
      groupId: tenantEntity.authGroup,
    });
  }

  @Method
  async beforeRemove(ctx: Context<{ id: number }, UserAuthMeta>) {
    // Internal callers (the `users.removed`/`tenants.removed` cascades use
    // `removeEntities`, not this action; seeds/ticks carry no auth) pass
    // through untouched.
    if (!ctx.meta?.authUser) return ctx;

    // Platform admins manage any membership.
    if (
      [AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].some((role) => role === ctx.meta.authUser.type)
    ) {
      return ctx;
    }

    // A USER may remove members only if they are OWNER/USER_ADMIN of their
    // active tenant, and only members that belong to that same tenant — the
    // generic `remove` is otherwise an unscoped cross-tenant delete (IDOR).
    validateCanEditTenantUser(ctx, 'Only OWNER and USER_ADMIN can remove users from tenant.');

    const target: TenantUser = await ctx.call('tenantUsers.resolve', {
      id: ctx.params.id,
      throwIfNotExist: true,
    });
    if (String(target.tenant) !== String(ctx.meta.profile)) {
      throwNoRightsError('Cannot remove a user from another tenant.');
    }

    return ctx;
  }

  @Method
  async seedDB() {
    await this.broker.waitForServices(['auth', 'tenants', 'users']);

    const data: Array<any> = await this.broker.call('auth.getSeedData', {
      timeout: 120 * 1000,
    });

    for (const authUser of data) {
      const user: User = await this.broker.call('users.findOne', {
        query: {
          authUser: authUser.id,
        },
      });

      if (authUser.groups?.length) {
        for (const group of authUser.groups) {
          if (group.id && !INNER_AUTH_GROUP_IDS.includes(group.id)) {
            const tenant: Tenant = await this.broker.call('tenants.findOne', {
              query: {
                authGroup: group.id,
              },
            });

            if (!tenant) {
              return;
            }

            let role = TenantUserRole.USER;
            if (group.role === AuthGroupRole.ADMIN) {
              role = TenantUserRole.OWNER;
            }

            await this.createEntity(null, {
              user: user.id,
              tenant: tenant.id,
              role,
            });
          }
        }
      }
    }
  }

  @Event()
  async 'users.removed'(ctx: Context<{ data: User }>) {
    const user = ctx.params.data;

    return this.removeEntities(ctx, {
      query: {
        user: user.id,
      },
    });
  }

  @Event()
  async 'tenants.removed'(ctx: Context<{ data: Tenant }>) {
    const tenant = ctx.params.data;

    return this.removeEntities(ctx, {
      query: {
        tenant: tenant.id,
      },
    });
  }
}
