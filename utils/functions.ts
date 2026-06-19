import { Context } from 'moleculer';
import { AuthUserRole, UserAuthMeta } from '../services/api.service';
import { TenantUserRole } from '../services/tenantUsers.service';
import { throwNoRightsError } from '../types';

export const validateCanEditTenantUser = (ctx: Context<any, UserAuthMeta>, err: string) => {
  const { profile } = ctx.meta;

  if (
    ctx.meta.authUser?.type === AuthUserRole.USER &&
    ![TenantUserRole.OWNER, TenantUserRole.USER_ADMIN].includes(ctx.meta.user.tenants[profile])
  ) {
    throwNoRightsError(err);
  }
};

export const isInGroup = (groups: any, groupId: string) =>
  groups?.some((group: any) => group.id === Number(groupId));

// Recursively remove every `$raw` key from a user-supplied query. `$raw` is
// the `@moleculer/database` knex adapter's raw-SQL sink (`whereRaw`), and the
// adapter recurses into every nested object/array — so stripping it only at
// the top level is bypassed by `query[$or][0][id][$raw]`. Server-built `$raw`
// clauses are added AFTER sanitization, so they are never seen here. Single
// source of truth for both `profile.mixin` and `users.service`; do NOT inline
// a second copy (a divergence would silently re-open SQL injection).
export function stripRawDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripRawDeep) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      if (key === '$raw') continue;
      out[key] = stripRawDeep((value as Record<string, any>)[key]);
    }
    return out as T;
  }
  return value;
}
