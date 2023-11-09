import { Context } from 'moleculer';
import { AuthUserRole, UserAuthMeta } from '../services/api.service';

export default {
  methods: {
    beforeSelect(ctx: Context<any, UserAuthMeta>) {
      if (ctx.meta) {
        if (
          ![AuthUserRole.SUPER_ADMIN, AuthUserRole.ADMIN].some((r) => r === ctx.meta?.authUser?.type)
        ) {
          const q = ctx.params.query;
          // tenant profile
          if (ctx.meta.profile && ctx.meta?.user) {
            ctx.params.query = {
              tenant: ctx.meta.profile,
              ...q,
            };
          }
          // personal profile
          if (!ctx.meta.profile && ctx.meta.user) {
            ctx.params.query = {
              user: ctx.meta.user.id,
              tenant: { $exists: false },
              ...q,
            };
          }
        }
      }
      ctx.params.sort = ctx.params.sort || '-createdAt';
      return ctx;
    },
    beforeCreate(ctx: Context<any, UserAuthMeta>) {
      if (
        ![AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].some(
          (role) => role === ctx.meta.authUser.type,
        )
      ) {
        const profile = ctx.meta.profile;
        const userId = ctx.meta.user.id;
        ctx.params.tenant = profile || null;
        ctx.params.user = userId;
      }
      return ctx;
    },
  },
};
