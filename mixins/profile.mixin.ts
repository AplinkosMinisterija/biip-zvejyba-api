import { Context } from 'moleculer';
import { AuthUserRole, UserAuthMeta } from '../services/api.service';
import { throwNoRightsError } from '../types';
import { stripRawDeep } from '../utils';

// Drop keys that would bypass the tenant/user scope or smuggle raw SQL
// through moleculer-knex-filters. User-supplied query may still include
// arbitrary filter fields (label, type, etc.) — we only strip the ones
// that overlap with what this mixin enforces.
const FORBIDDEN_USER_QUERY_KEYS = ['tenant', 'user', '$raw'] as const;

// `$raw` (the knex adapter's `whereRaw` sink) must be stripped at EVERY depth —
// `query[$or][0][id][$raw]` reaches raw SQL otherwise. Shared with
// users.service via `stripRawDeep` so the two scope sanitizers can't diverge.
function sanitizeUserQuery(query: any) {
  if (!query || typeof query !== 'object') return {};
  const clean: Record<string, any> = {};
  for (const key of Object.keys(query)) {
    if ((FORBIDDEN_USER_QUERY_KEYS as readonly string[]).includes(key)) continue;
    clean[key] = stripRawDeep(query[key]);
  }
  return clean;
}

export default {
  methods: {
    beforeSelect(ctx: Context<any, UserAuthMeta>) {
      if (ctx.meta) {
        if (
          ![AuthUserRole.SUPER_ADMIN, AuthUserRole.ADMIN].some(
            (r) => r === ctx.meta?.authUser?.type,
          )
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
    // Ownership guard for id-based mutations (`update`/`remove` and custom
    // actions that mutate a row by `:id`). The read scope lives in
    // `beforeSelect`, but the default db `update`/`remove` actions never run
    // it, so without this a USER can edit/delete another tenant's row by id
    // (cross-tenant IDOR). Mirrors the scope query in `beforeSelect` /
    // `tools.beforeDelete`: tenant members are scoped to the tenant, a
    // freelancer to their own personal (tenant-less) rows.
    async beforeMutate(ctx: Context<{ id?: number | string }, UserAuthMeta>) {
      // Internal/service calls (events, cron) carry no auth meta — leave them
      // alone, exactly like `beforeCreate`.
      if (!ctx.meta?.authUser) return ctx;
      if (
        [AuthUserRole.SUPER_ADMIN, AuthUserRole.ADMIN].some(
          (role) => role === ctx.meta.authUser.type,
        )
      ) {
        return ctx;
      }
      const id = ctx.params?.id;
      if (id == null) return ctx;
      const owned = await (this as any).findEntity(ctx, {
        query: {
          id,
          tenant: ctx.meta.profile ? ctx.meta.profile : { $exists: false },
          user: ctx.meta.profile ? { $exists: true } : ctx.meta.user?.id,
        },
      });
      if (!owned) {
        throwNoRightsError('Resource is not in your scope.');
      }
      return ctx;
    },
  },
};
