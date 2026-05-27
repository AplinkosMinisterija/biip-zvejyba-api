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
import { throwNoRightsError } from '../types';

// Strip security-sensitive keys from user-supplied query before merging
// with our enforced tenant scope. Mirrors `sanitizeUserQuery` in
// profile.mixin.ts — caller-controlled `$raw` is especially dangerous
// because moleculer-knex-filters executes it as raw SQL.
const TENANT_SCOPE_FORBIDDEN_KEYS = ['$raw', 'tenants'] as const;
function sanitizeQueryForTenantScope(query: any) {
  if (!query || typeof query !== 'object') return {};
  const clean: Record<string, any> = {};
  for (const key of Object.keys(query)) {
    if ((TENANT_SCOPE_FORBIDDEN_KEYS as readonly string[]).includes(key)) continue;
    clean[key] = query[key];
  }
  return clean;
}

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

    // moleculer-web's `mappingPolicy: 'all'` auto-publishes every default
    // @moleculer/database action — including `resolve`, which fetches by
    // primary key without going through the `filterTenant` hook (hooks
    // only cover count/list/find/get/all). That meant a USER calling
    // `POST /api/users/resolve {id: <other-tenant-userId>}` got the full
    // record (see security audit #H1). Drop visibility to `protected` so
    // internal `ctx.call('users.resolve', ...)` keeps working but HTTP
    // can't reach it.
    resolve: { visibility: 'protected' },
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
      // Security $raw clause must be spread LAST so a user-supplied
      // `query.$raw` cannot replace the tenant scope and read users
      // outside their tenant.
      const userQuery = sanitizeQueryForTenantScope(ctx.params.query);
      ctx.params.query = {
        ...userQuery,
        $raw: {
          condition: `?? \\? ?`,
          bindings: ['tenants', Number(ctx.meta.profile)],
        },
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
          const adminQuery = sanitizeQueryForTenantScope(ctx.params.query);
          ctx.params.query = {
            ...adminQuery,
            $raw,
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


  @Action({
    rest: 'POST /:id/impersonate',
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
  })
  async impersonate(ctx: Context<{ id: number }, UserAuthMeta>) {
    // SUPER_ADMIN only. `auth: ADMIN` falls back to the service-level
    // restriction, which permits any ROLE_ADMIN to mint a session for
    // any target user — including other admins or company OWNERs (see
    // security audit #C7). Tighten here, in the action body, because
    // moleculer-web's authorize() treats ADMIN and SUPER_ADMIN as
    // interchangeable for `RestrictionType.ADMIN`.
    if (ctx.meta?.authUser?.type !== AuthUserRole.SUPER_ADMIN) {
      throwNoRightsError('Only SUPER_ADMIN may impersonate.');
    }

    const { id } = ctx.params;
    const user: User = await ctx.call('users.resolve', { id });

    this.logger.warn(
      `[impersonate] SUPER_ADMIN authUserId=${ctx.meta.authUser.id} impersonating userId=${id} authUserId=${user?.authUser}`,
    );

    return ctx.call('auth.users.impersonate', { id: user.authUser });
  }

  @Action({
    rest: 'GET /byTenant/:tenant',
    // ADMIN-only: this endpoint rewrites the tenant scope `$raw` from the
    // URL param, bypassing `filterTenant`. Allowing USER role here let any
    // member of any tenant enumerate users of any other tenant (see
    // security audit #C2). Cross-tenant USER queries belong to
    // `tenantUsers.list`, which is ProfileMixin-scoped.
    auth: RestrictionType.ADMIN,
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

    const byTenantQuery = sanitizeQueryForTenantScope(params.query);
    params.query = {
      ...byTenantQuery,
      $raw,
    };

    const rows = await this.findEntities(ctx, params);
    const total = await this.countEntities(ctx, params);

    return this.returnList(rows, total, params.page, params.pageSize);
  }

  @Action({
    // ADMIN-only: same reason as `byTenant` above — when `tenants[]` is
    // supplied the action wipes the `filterTenant`-installed `$raw` clause
    // and replaces it with a user-controlled tenant list, allowing
    // cross-tenant enumeration.
    auth: RestrictionType.ADMIN,
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

      const listQuery = sanitizeQueryForTenantScope(params.query);
      params.query = {
        ...listQuery,
        $raw,
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

    // Use parameterized bindings, not string interpolation. Today both
    // values are validated (enum role, numeric tenant FK), but interpolating
    // into raw SQL is a time-bomb — anyone wiring a `permissive: true`
    // path on `tenantUsers.create/update` would turn this into SQL
    // injection through the `role` string.
    switch (type) {
      case 'create':
      case 'update':
      case 'replace':
        $set.tenants = table.client.raw(`tenants || ?::jsonb`, [
          JSON.stringify({ [String(tenantUser.tenant)]: tenantUser.role }),
        ]);
        break;

      case 'remove':
        $set.tenants = table.client.raw(`tenants - ?`, [String(tenantUser.tenant)]);
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
