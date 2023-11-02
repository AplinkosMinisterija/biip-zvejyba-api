import { Context } from 'moleculer';
import { AuthUserRole, UserAuthMeta } from '../services/api.service';
import { TenantUserRole } from '../services/tenantUsers.service';
import { throwNoRightsError } from '../types';

export const validateCanEditTenantUser = (
  ctx: Context<any, UserAuthMeta>,
  err: string
) => {
  const { profile } = ctx.meta;

  console.log(ctx.meta.authUser, ' ctx.meta.authUser');

  if (
    ctx.meta.authUser?.type === AuthUserRole.USER &&
    ![TenantUserRole.OWNER, TenantUserRole.USER_ADMIN].includes(
      ctx.meta.user.tenants[profile]
    )
  ) {
    throwNoRightsError(err);
  }
};
