'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  EntityChangedParams,
  FieldHookCallback,
  RestrictionType,
} from '../types';
import { TenantUser, TenantUserRole } from './tenantUsers.service';

import ApiGateway from 'moleculer-web';
import DbConnection, { PopulateHandlerFn } from '../mixins/database.mixin';
import { isInGroup } from '../utils';
import { AuthUserRole, UserAuthMeta } from './api.service';

export enum UserRole {
  ADMIN = 'ROLE_ADMIN',
  USER = 'ROLE_USER',
  INSPECTOR = 'ROLE_INSPECTOR',
}

export enum UserType {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

export interface User {
  id: number;
  authUser: number;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  active: boolean;
  roles: UserRole[];
  type: UserType;
  isFreelancer: boolean;
  isInvestigator: boolean;
  tenantUsers: Array<TenantUser['id']>;
  tenants: Record<string | number, TenantUserRole>;
}

@Service({
  name: 'users',
  mixins: [
    DbConnection({
      collection: 'users',
      entityChangedOldEntity: true,
      createActions: {
        createMany: false,
      },
    }),
  ],

  settings: {
    auth: RestrictionType.ADMIN,
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      firstName: 'string',
      lastName: 'string',
      fullName: {
        type: 'string',
        readonly: true,
      },
      email: {
        type: 'email',
        set: ({ value }: FieldHookCallback) => value?.toLowerCase(),
      },
      phone: 'string',
      type: {
        type: 'string',
        enum: Object.values(UserType),
        default: UserType.USER,
      },
      authUser: {
        type: 'number',
        columnType: 'integer',
        columnName: 'authUserId',
        required: true,
        populate: async (ctx: Context, values: number[]) => {
          return Promise.all(
            values.map((value) => {
              try {
                const data = ctx.call('auth.users.get', {
                  id: value,
                  scope: false,
                });
                return data;
              } catch (e) {
                return value;
              }
            }),
          );
        },
      },
      lastLogin: 'date',
      isFreelancer: {
        type: 'boolean',
        default: false,
      },
      isInvestigator: {
        type: 'boolean',
        default: false,
      },
      tenants: {
        type: 'object',
        readonly: true,
        default: () => ({}),
      },
      tenantUsers: {
        type: 'array',
        readonly: true,
        virtual: true,
        default: (): any[] => [],
        populate: {
          keyField: 'id',
          handler: PopulateHandlerFn('tenantUsers.populateByProp'),
          params: {
            queryKey: 'user',
            mappingMulti: true,
            populate: ['tenant'],
          },
        },
      },
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },

  hooks: {
    before: {
      count: 'filterTenant',
      list: 'filterTenant',
      find: 'filterTenant',
      get: 'filterTenant',
      all: 'filterTenant',
    },
  },

  actions: {
    find: {
      auth: RestrictionType.DEFAULT,
    },
    create: {
      rest: null,
    },

    all: {
      auth: RestrictionType.DEFAULT,
    },
  },
})
export default class UsersService extends moleculer.Service {
  @Method
  async filterTenant(ctx: Context<any, UserAuthMeta>) {
    if (ctx.meta.user && !ctx.meta.profile) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'Unauthorized',
      });
    }
    if (ctx.meta.user && ctx.meta.profile) {
      ctx.params.query = {
        $raw: {
          condition: `?? \\? ?`,
          bindings: ['tenants', Number(ctx.meta.profile)],
        },
        ...ctx.params.query,
      };
    } else if (
      !ctx.meta.user &&
      ctx.meta.authUser &&
      (ctx.meta.authUser.type === AuthUserRole.ADMIN ||
        ctx.meta.authUser.type === AuthUserRole.SUPER_ADMIN)
    ) {
      if (ctx.params.filter) {
        if (typeof ctx.params.filter === 'string') {
          ctx.params.filter = JSON.parse(ctx.params.filter);
        }
        if (ctx.params.filter.tenantId) {
          let $raw;

          if (ctx.params.filter.role) {
            $raw = {
              condition: `?? @> ?::jsonb`,
              bindings: ['tenants', { [ctx.params.filter.tenantId]: ctx.params.filter.role }],
            };
          } else {
            $raw = {
              condition: `?? \\? ?`,
              bindings: ['tenants', ctx.params.filter.tenantId],
            };
          }
          ctx.params.query = {
            $raw,
            ...ctx.params.query,
          };
          delete ctx.params.filter.tenantId;
          delete ctx.params.filter.role;
        }
      }
    }
  }

  @Action({
    rest: 'PATCH /me',
    auth: RestrictionType.USER,
    params: {
      email: 'string|optional',
      phone: 'string|optional',
    },
  })
  async updateMyProfile(ctx: Context<{ email?: string; phone?: string }, UserAuthMeta>) {
    if (!ctx.meta.user) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'Not logged in',
      });
    }
    return this.updateEntity(ctx, { id: ctx.meta.user.id, ...ctx.params });
  }
  @Action({
    params: {
      tenantId: 'string|optional',
    },
  })
  async all(ctx: Context) {
    return this.findEntities(ctx);
  }

  @Action()
  async test(ctx: Context) {
    const adapter = await this.getAdapter(ctx);
    const knex = adapter.client;
    const response = await knex.raw('select * from users where id = ?', [1]);
    return response.rows;
  }

  @Action({
    rest: 'GET /byTenant/:tenant',
    auth: RestrictionType.DEFAULT,
    params: {
      tenant: {
        type: 'number',
        convert: true,
      },
      role: {
        type: 'string',
        optional: true,
        convert: true,
      },
    },
  })
  async byTenant(
    ctx: Context<
      { query?: object } & {
        tenant: number;
        role?: TenantUserRole;
      }
    >,
  ) {
    const { tenant, role, ...listParams } = ctx.params;
    const params = this.sanitizeParams(listParams, {
      list: true,
    });
    let $raw;

    if (role) {
      $raw = {
        condition: `?? @> ?::jsonb`,
        bindings: ['tenants', { [tenant]: role }],
      };
    } else {
      $raw = {
        condition: `?? \\? ?`,
        bindings: ['tenants', tenant],
      };
    }

    params.query = {
      $raw,
      ...params.query,
    };

    const rows = await this.findEntities(ctx, params);
    const total = await this.countEntities(ctx, params);

    return this.returnList(rows, total, params.page, params.pageSize);
  }

  @Action({
    auth: RestrictionType.DEFAULT,
    params: {
      tenants: {
        type: 'array',
        optional: true,
        items: {
          type: 'number',
          convert: true,
        },
      },
    },
  })
  async list(ctx: Context<{ query?: object } & { tenants?: number[] }>) {
    const { tenants, ...listParams } = ctx.params;
    const params = this.sanitizeParams(listParams, {
      list: true,
    });

    if (tenants) {
      const ids = tenants.map((id) => Number(id));

      const $raw = {
        condition: `?? \\?| array[${ids.map((_) => '?')}]`,
        bindings: ['tenants', ...ids],
      };

      params.query = {
        $raw,
        ...params.query,
      };
    }

    const rows = await this.findEntities(ctx, params);
    const total = await this.countEntities(ctx, params);

    return this.returnList(rows, total, params.page, params.pageSize);
  }

  @Action({
    rest: 'POST /invite',
    params: {
      personalCode: 'string',
      firstName: 'string',
      lastName: 'string',
      email: 'string',
      phone: 'string',
      isInvestigator: 'boolean',
    },
  })
  async invite(
    ctx: Context<{
      personalCode: string;
      email: string;
      phone: string;
      firstName: string;
      lastName: string;
      isInvestigator: boolean;
    }>,
  ) {
    const { personalCode, email, phone, firstName, lastName, isInvestigator } = ctx.params;
    // it will throw error if user already exists
    const authUser: any = await ctx.call('auth.users.invite', {
      personalCode,
      notify: [email],
      throwErrors: true,
    });
    //add to freelancer group
    await ctx.call('auth.users.assignToGroup', {
      id: authUser.id,
      groupId: Number(process.env.FREELANCER_GROUP_ID),
    });

    return this.createEntity(ctx, {
      authUser: authUser.id,
      firstName,
      lastName,
      email,
      phone,
      isFreelancer: true,
      isInvestigator,
    });
  }

  // CQRS - readonly cache for tenantUsers
  @Event()
  async 'tenantUsers.*'(ctx: Context<EntityChangedParams<TenantUser>>) {
    const type = ctx.params.type;
    const tenantUser = ctx.params.data as TenantUser;

    if (!tenantUser?.user) {
      return;
    }

    const $set: { tenants?: any } = {};

    const adapter = await this.getAdapter(ctx);
    const table = adapter.getTable();

    switch (type) {
      case 'create':
      case 'update':
      case 'replace':
        $set.tenants = table.client.raw(
          `tenants || '{"${tenantUser.tenant}":"${tenantUser.role}"}'::jsonb`,
        );
        break;

      case 'remove':
        $set.tenants = table.client.raw(`tenants - '${tenantUser.tenant}'`);
        break;
    }

    const user = await this.resolveEntities(ctx, { id: tenantUser.user });

    if (user) {
      await this.updateEntity(
        ctx,
        {
          id: tenantUser.user,
          $set,
        },
        {
          raw: true,
          permissive: true,
        },
      );
    }
  }

  @Method
  returnList(rows: User[], total: number, page: number, pageSize: number) {
    return {
      rows,
      total,
      page: page,
      pageSize: pageSize,
      totalPages: Math.floor((total + pageSize - 1) / pageSize),
    };
  }

  @Method
  async seedDB() {
    await this.broker.waitForServices(['auth']);
    const data: Array<any> = await this.broker.call('auth.getSeedData', {
      timeout: 120 * 1000,
    });

    for (const authUser of data) {
      await this.createEntity(null, {
        firstName: authUser.firstName,
        lastName: authUser.lastName,
        // TODO: we sync USERS only, `type` could be removed
        type: authUser.type === 'SUPER_ADMIN' ? UserType.ADMIN : authUser.type,
        email: authUser.email?.trim?.(),
        phone: authUser.phone,
        authUser: authUser.id,
        isFreelancer: isInGroup(authUser.groups, process.env.FREELANCER_GROUP_ID),
        isInvestigator: isInGroup(authUser.groups, process.env.AUTH_INVESTIGATOR_GROUP_ID),
      });
    }
  }
}
