'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';
import {
  EntityChangedParams,
  INNER_AUTH_GROUP_IDS,
  RestrictionType,
  throwUnauthorizedError,
} from '../types';
import { AuthGroupRole, TenantUser, TenantUserRole } from './tenantUsers.service';
import { User, UserType } from './users.service';

import authMixin from 'biip-auth-nodejs/mixin';
import { isInGroup } from '../utils';
import { UserAuthMeta } from './api.service';
import { Tenant } from './tenants.service';

@Service({
  name: 'auth',
  mixins: [
    authMixin(process.env.AUTH_API_KEY, {
      host: process.env.AUTH_HOST || '',
      appHost: process.env.URL, // after evartai successful login
    }),
  ],
  hooks: {
    after: {
      login: 'afterUserLoggedIn',
      'evartai.login': 'afterUserLoggedIn',
    },
    before: {
      'evartai.login': 'beforeUserLogin',
      login: 'beforeUserLogin',
    },
  },
  actions: {
    login: {
      auth: RestrictionType.PUBLIC,
    },
    refreshToken: {
      auth: RestrictionType.PUBLIC,
    },
    'evartai.login': {
      auth: RestrictionType.PUBLIC,
    },
    'evartai.sign': {
      auth: RestrictionType.PUBLIC,
    },
  },
})
export default class AuthService extends moleculer.Service {
  @Action({
    auth: RestrictionType.USER,
  })
  async me(ctx: Context<{}, UserAuthMeta>) {
    const user: User = await ctx.call('users.resolve', {
      id: ctx.meta.user.id,
      populate: 'tenantUsers',
    });

    const data: any = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      type: user.type,
    };

    if (ctx.meta?.authUser?.permissions?.FISHING) {
      data.permissions = {
        FISHING: ctx.meta.authUser.permissions.FISHING,
      };
    }

    if (user.type === UserType.USER) {
      data.profiles = await ctx.call('tenantUsers.getProfiles');
    }

    return data;
  }

  @Method
  async afterUserLoggedIn(ctx: any, data: any) {
    if (!data || !data.token) {
      return data;
    }

    const meta = { authToken: data.token };

    const authUser: any = await ctx.call('auth.users.resolveToken', null, {
      meta,
    });

    if (authUser?.type !== UserType.USER) {
      if (process.env.NODE_ENV === 'local') {
        return data;
      }

      throwUnauthorizedError('Invalid user type.');
    }

    let user: User = await ctx.call('users.findOne', {
      query: {
        authUser: authUser.id,
      },
    });

    if (!user) {
      // First-time login via E-vartai (auth side has `createUserOnEvartaiLogin`
      // enabled, so the auth user already exists by this point — we just need
      // the local mirror).
      user = await ctx.call('users.create', {
        authUser: authUser.id,
        firstName: authUser.firstName,
        lastName: authUser.lastName,
        email: authUser.email,
        phone: authUser.phone,
      });
    }

    // update tenants info from e-vartai
    const authUserGroups: any = await ctx.call(
      'auth.users.get',
      {
        id: authUser?.id,
        populate: 'groups',
      },
      { meta },
    );
    const authGroups: any[] = authUserGroups?.groups || [];

    // update user info from e-vartai
    await ctx.call('users.update', {
      id: user.id,
      firstName: authUser.firstName,
      lastName: authUser.lastName,
      lastLogin: Date.now(),
      isFreelancer: isInGroup(authGroups, process.env.FREELANCER_GROUP_ID),
      isInvestigator: isInGroup(authGroups, process.env.AUTH_INVESTIGATOR_GROUP_ID),
    });

    for (const authGroup of authGroups) {
      if (!authGroup.id) {
        continue;
      }

      // Skip non-company groups (FREELANCER, INVESTIGATOR) and any auth group
      // that is not tied to a real company.
      if (INNER_AUTH_GROUP_IDS.includes(authGroup.id) || !authGroup.companyCode) {
        continue;
      }

      const tenant: Tenant = await ctx.call('tenants.findOne', {
        query: {
          authGroup: authGroup.id,
        },
      });

      // Tenants are bulk-imported separately; if there is no match here the
      // company simply isn't onboarded into Žvejyba yet — nothing to attach.
      if (!tenant) {
        continue;
      }

      await ctx.call('tenants.update', {
        id: tenant.id,
        name: authGroup.name,
        code: authGroup.companyCode,
        email: authGroup.companyEmail,
        phone: authGroup.companyPhone,
      });

      const tenantUser: TenantUser = await ctx.call('tenantUsers.findOne', {
        query: {
          tenant: tenant.id,
          user: user.id,
        },
      });

      if (!tenantUser) {
        // First juridical-person login for this user/tenant pair — create the
        // local tenantUser link. The `tenantUsers.beforeCreate` hook also
        // re-asserts the auth-side group assignment, so we must propagate the
        // freshly issued auth token via meta — the original login ctx is
        // anonymous and would 401 the inner auth.users.assignToGroup call.
        await ctx.call(
          'tenantUsers.create',
          {
            tenant: tenant.id,
            user: user.id,
            role:
              authGroup.role === AuthGroupRole.ADMIN ? TenantUserRole.OWNER : TenantUserRole.USER,
          },
          { meta },
        );
      } else {
        if (authGroup.role === AuthGroupRole.ADMIN && tenantUser.role !== TenantUserRole.OWNER) {
          // After login with "juridinis asmuo" auth changes relation to ADMIN
          // So we have to change it to OWNER
          await ctx.call(
            'tenantUsers.update',
            {
              id: tenantUser.id,
              role: TenantUserRole.OWNER,
            },
            { meta },
          );
        }

        if (authGroup.role === AuthGroupRole.USER && tenantUser.role === TenantUserRole.OWNER) {
          // Changing from OWNER to other roles SHOULD NOT happen without our app
          // But again, just in case
          await ctx.call(
            'tenantUsers.update',
            {
              id: tenantUser.id,
              role: TenantUserRole.USER,
            },
            { meta },
          );
        }
      }
    }

    return data;
  }

  @Method
  async beforeUserLogin(ctx: any) {
    ctx.params = ctx.params || {};
    ctx.params.refresh = true;
    return ctx;
  }

  @Event()
  async 'users.updated'(ctx: Context<EntityChangedParams<User>>) {
    const user = ctx.params.data as User;
    const oldUser = ctx.params.oldData as User;
    const isFreelancerChanged = oldUser.isFreelancer !== user.isFreelancer;
    const isInvestigatorChanged = oldUser.isInvestigator !== user.isInvestigator;

    if (!isFreelancerChanged && !isInvestigatorChanged) {
      return;
    }

    const handleSetGroup = async (
      isPermissionChanged: boolean,
      hasPermission: boolean,
      groupId: string,
    ) => {
      if (isPermissionChanged) {
        if (hasPermission) {
          return await ctx.call('auth.users.assignToGroup', {
            id: user.authUser,
            groupId: Number(groupId),
          });
        }

        return await ctx.call('auth.users.unassignFromGroup', {
          id: user.authUser,
          groupId: Number(groupId),
        });
      }
    };

    handleSetGroup(isFreelancerChanged, user.isFreelancer, process.env.FREELANCER_GROUP_ID);
    handleSetGroup(
      isInvestigatorChanged,
      user.isInvestigator,
      process.env.AUTH_INVESTIGATOR_GROUP_ID,
    );

    return;
  }

  @Event()
  async 'users.removed'(ctx: Context<EntityChangedParams<User>>) {
    const user = ctx.params.data as User;

    await ctx.call('auth.users.remove', { id: user.authUser }, { meta: ctx.meta });
  }

  @Event()
  async 'tenantUsers.removed'(ctx: Context<EntityChangedParams<TenantUser>>) {
    const tenantUser = ctx.params.data as TenantUser;

    const entity: TenantUser<'tenant' | 'user'> = await ctx.call('tenantUsers.resolve', {
      id: tenantUser.id,
      populate: 'user,tenant',
      scope: false,
    });

    await ctx.call('auth.users.unassignFromGroup', {
      id: entity.user.authUser,
      groupId: entity.tenant.authGroup,
    });
  }

  @Event()
  async 'tenantUsers.updated'(ctx: Context<EntityChangedParams<TenantUser>>) {
    const tenantUser = ctx.params.data as TenantUser;
    const oldTenantUser = ctx.params.oldData as TenantUser;

    const roleToAuthGroupRole = (role: TenantUserRole): AuthGroupRole =>
      role === TenantUserRole.OWNER ? AuthGroupRole.ADMIN : AuthGroupRole.USER;

    const authRole = roleToAuthGroupRole(tenantUser.role);
    const oldAuthRole = roleToAuthGroupRole(oldTenantUser.role);

    if (authRole === oldAuthRole) {
      return;
    }

    const entity: TenantUser<'tenant' | 'user'> = await ctx.call('tenantUsers.resolve', {
      id: tenantUser.id,
      populate: 'user,tenant',
      scope: false,
    });

    await ctx.call('auth.users.assignToGroup', {
      id: entity.user.authUser,
      groupId: entity.tenant.authGroup,
      role: authRole,
    });
  }
}
