'use strict';

import helmet from 'helmet';
import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import ApiGateway from 'moleculer-web';
import { RequestMessage, RestrictionType } from '../types';
import { User } from './users.service';

export interface UserAuthMeta {
  user: User;
  app: any;
  authToken: string;
  authUser: any;
  profile: any;
}

export enum AuthUserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

@Service({
  name: 'api',
  mixins: [ApiGateway],
  // More info about settings: https://moleculer.services/docs/0.14/moleculer-web.html
  settings: {
    port: process.env.PORT || 3000,
    path: '/zvejyba',

    // Global CORS settings for all routes. Stays `*` intentionally —
    // this API serves an unknown set of third-party clients, so a
    // closed allowlist would break consumers we don't have an inventory
    // of. Bearer-token auth (not cookies) means the browser doesn't
    // auto-send credentials cross-origin, which limits the blast
    // radius of `*`.
    cors: {
      origin: '*',
      methods: ['GET', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: '*',
      maxAge: 3600,
    },

    routes: [
      {
        path: '/api',
        whitelist: [
          // Access to any actions in all services under "/api" URL
          '**',
        ],

        // Route-level Express middlewares. Helmet adds standard security
        // headers (X-Content-Type-Options, Referrer-Policy, HSTS in prod,
        // etc.). CSP is intentionally disabled — this is a JSON API, not
        // an HTML surface, and a wrong CSP here breaks the `minio.getFile`
        // file proxy / xlsx export response without protecting anything.
        use: [helmet({ contentSecurityPolicy: false })],

        // Enable/disable parameter merging method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Disable-merging
        mergeParams: true,

        // Enable authentication. Implement the logic into `authenticate` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authentication
        authentication: true,

        // Enable authorization. Implement the logic into `authorize` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authorization
        authorization: true,

        // The auto-alias feature allows you to declare your route alias directly in your services.
        // The gateway will dynamically build the full routes from service schema.
        autoAliases: true,

        aliases: {
          'GET /ping': 'api.ping',
        },

        // Calling options. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Calling-options
        callingOptions: {},

        bodyParsers: {
          json: {
            strict: false,
            limit: '1MB',
          },
          urlencoded: {
            extended: true,
            limit: '1MB',
          },
        },

        // Mapping policy setting. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Mapping-policy
        mappingPolicy: 'all', // Available values: "all", "restrict"

        // Enable/disable logging
        logging: true,
      },
    ],
    // Do not log client side errors (does not log an error response when the error.code is 400<=X<500)
    log4XXResponses: false,
    // Logging the request parameters. Set to any log level to enable it. E.g. "info"
    logRequestParams: null,
    // Logging the response data. Set to any log level to enable it. E.g. "info"
    logResponseData: null,
    // Serve assets from "public" folder
    assets: {
      folder: 'public',
      // Options to `server-static` module
      options: {},
    },
  },
})
export default class ApiService extends moleculer.Service {
  @Method
  getRestrictionType(req: RequestMessage) {
    return req.$action.auth || req.$action.service?.settings?.auth || RestrictionType.DEFAULT;
  }

  @Method
  async authenticate(
    ctx: Context<Record<string, unknown>, UserAuthMeta>,
    _route: any,
    req: RequestMessage,
  ): Promise<unknown> {
    const restrictionType = this.getRestrictionType(req);

    if (restrictionType === RestrictionType.PUBLIC) {
      return null;
    }

    // Read the token from header
    const auth = req.headers.authorization;
    if (!auth?.startsWith?.('Bearer')) {
      throw new ApiGateway.Errors.UnAuthorizedError(ApiGateway.Errors.ERR_INVALID_TOKEN, null);
    }

    const token = auth.slice(7);

    // it will throw error if token not valid
    const authUser: any = await ctx.call('auth.users.resolveToken', null, {
      meta: { authToken: token },
    });

    let user: User;
    if (authUser.type === AuthUserRole.USER) {
      user = await ctx.call('users.findOne', {
        query: { authUser: authUser.id },
      });
    }

    ctx.meta.authUser = authUser;
    ctx.meta.authToken = token;
    ctx.meta.user = user;

    // Validate `x-profile` (tenant id) membership at the gateway. Without
    // this, any USER could set the header to an arbitrary tenant id and
    // ProfileMixin would silently scope every read/write to that tenant.
    // Only USER-type callers (those with a local `user` mirror + `tenants`
    // map) are checked — ADMIN/SUPER_ADMIN have no per-tenant scope.
    // Freelancer mode sends no `x-profile` header at all (FE skips it when
    // `isNaN(profileId)`), so missing/empty header is the freelancer path.
    const profileHeader = req.headers['x-profile'];
    if (
      profileHeader != null &&
      profileHeader !== '' &&
      authUser.type === AuthUserRole.USER
    ) {
      const tenantsMap = (user as any)?.tenants || {};
      if (!Object.prototype.hasOwnProperty.call(tenantsMap, String(profileHeader))) {
        throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
          error: 'Profile not accessible',
        });
      }
    }
    ctx.meta.profile = profileHeader;

    return user;
  }

  @Method
  async authorize(
    ctx: Context<Record<string, unknown>, UserAuthMeta>,
    _route: any,
    req: RequestMessage,
  ): Promise<unknown> {
    const restrictionType = this.getRestrictionType(req);

    if (restrictionType === RestrictionType.PUBLIC) {
      return;
    }

    // Get the authenticated user.
    const authUser = ctx.meta.authUser;

    if (
      restrictionType === RestrictionType.ADMIN &&
      ![AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].includes(authUser.type)
    ) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'Unauthorized',
      });
    }

    if (
      restrictionType === RestrictionType.SUPER_ADMIN &&
      authUser.type !== AuthUserRole.SUPER_ADMIN
    ) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'Unauthorized',
      });
    }

    if (restrictionType === RestrictionType.USER && authUser.type !== AuthUserRole.USER) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'Unauthorized',
      });
    }
    const accesses = authUser?.permissions?.FISHING?.accesses || [];

    function hasAccess(access: string, accesses: string[]) {
      return accesses.includes(access) || accesses.includes('*');
    }

    if (restrictionType === RestrictionType.INVESTIGATOR && !hasAccess('INVESTIGATOR', accesses)) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'Unauthorized',
      });
    }
  }

  @Action({
    auth: RestrictionType.PUBLIC,
  })
  ping() {
    return {
      timestamp: Date.now(),
    };
  }
}
