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
} from '../types';
import { UserAuthMeta } from './api.service';
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
    update: {
      auth: RestrictionType.DEFAULT,
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

    const currentUser = tenantUser.user;
    const currentTenant: Tenant = await ctx.call('tenants.resolve', {
      throwIfNotExist: true,
      id: profile,
    });

    if (role) {
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
        tenant: number;
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
    validateCanEditTenantUser(ctx, 'Only OWNER and USER_ADMIN can add users to tenant.');

    const { firstName, lastName, personalCode, role, email, phone, tenant } = ctx.params;
    // OWNER and USER_ADMIN can invite users

    const tenantId = ctx.meta.profile || tenant;

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
