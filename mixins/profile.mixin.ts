import { Context } from 'moleculer';
import { AuthUserRole, UserAuthMeta } from '../services/api.service';

// Drop keys that would bypass the tenant/user scope or smuggle raw SQL
// through moleculer-knex-filters. User-supplied query may still include
// arbitrary filter fields (label, type, etc.) — we only strip the ones
// that overlap with what this mixin enforces.
const FORBIDDEN_USER_QUERY_KEYS = ['tenant', 'user', '$raw'] as const;

function sanitizeUserQuery(query: any) {
  if (!query || typeof query !== 'object') return {};
  const clean: Record<string, any> = {};
  for (const key of Object.keys(query)) {
    if ((FORBIDDEN_USER_QUERY_KEYS as readonly string[]).includes(key)) continue;
    clean[key] = query[key];
  }
  return clean;
}

export default {
  methods: {
    beforeSelect(ctx: Context<any, UserAuthMeta>) {
      if (ctx.meta) {
        if (
          ![AuthUserRole.SUPER_ADMIN, AuthUserRole.ADMIN].some((r) => r === ctx.meta?.authUser?.type)
        ) {
          // Security clauses MUST be spread last so user-supplied query
          // (`?query[tenant]=99`, `query.user=99`, or `query.$raw`) cannot
          // override the tenant/user scope. The previous spread order
          // (`{ tenant: profile, ...q }`) allowed horizontal privilege
          // escalation across tenants for every entity that mixes this in.
          // We also drop `tenant`/`user`/`$raw` keys from `q` defensively,
          // so the security fields can't be re-injected via `q.<sec-key>`.
          const q = sanitizeUserQuery(ctx.params.query);
          // tenant profile
          if (ctx.meta.profile && ctx.meta?.user) {
            ctx.params.query = {
              ...q,
              tenant: ctx.meta.profile,
            };
          }
          // personal profile
          if (!ctx.meta.profile && ctx.meta.user) {
            ctx.params.query = {
              ...q,
              user: ctx.meta.user.id,
              tenant: { $exists: false },
            };
          }
        }
      }
      ctx.params.sort = ctx.params.sort || '-createdAt';
      return ctx;
    },
    beforeCreate(ctx: Context<any, UserAuthMeta>) {
      // Vidiniai service-to-service call'ai (pvz., cron tick'as) gali kviesti
      // be auth meta — tokiu atveju paliekam params nepakeistus, kad caller
      // pats nuspręstų tenant/user reikšmes (žr. fishings.endFishings).
      if (!ctx.meta?.authUser) {
        return ctx;
      }
      if (
        ![AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].some(
          (role) => role === ctx.meta.authUser.type,
        )
      ) {
        const profile = ctx.meta.profile;
        const userId = ctx.meta.user?.id;
        ctx.params.tenant = profile || null;
        ctx.params.user = userId;
      }
      return ctx;
    },
  },
};
