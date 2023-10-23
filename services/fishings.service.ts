"use strict";

import moleculer, { Context } from "moleculer";
import { Action, Method, Service } from "moleculer-decorators";
import PostgisMixin from "moleculer-postgis";
import DbConnection from "../mixins/database.mixin";
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  Table,
} from "../types";

import transformation from "transform-coordinates";
import ProfileMixin from "../mixins/profile.mixin";
import { AuthUserRole, UserAuthMeta } from "./api.service";
import { coordinatesToGeometry } from "./location.service";

interface Fields extends CommonFields {
  id: number;
  label: string;
}

interface Populates extends CommonPopulates {}

export type FishingType<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields
> = Table<Fields, Populates, P, F>;

@Service({
  name: "fishings",
  mixins: [
    DbConnection(),
    PostgisMixin({
      srid: 3346,
    }),
    ProfileMixin,
  ],
  settings: {
    fields: {
      id: {
        type: "number",
        primaryKey: true,
        secure: true,
      },
      startDate: {
        type: "date",
        columnType: "datetime",
        readonly: true,
        onCreate: () => new Date(),
      },
      endDate: "date",
      skipDate: "date",
      geom: {
        type: "any",
        geom: {
          types: ["Point"],
        },
      },
      type: "string",
      tenant: {
        type: "number",
        columnType: "integer",
        columnName: "tenantId",
        populate: {
          action: "tenants.resolve",
          params: {
            scope: false,
          },
        },
      },
      user: {
        type: "number",
        columnType: "integer",
        columnName: "userId",
        populate: {
          action: "users.resolve",
          params: {
            scope: false,
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
  actions: {
    create: {
      rest: null,
    },
  },
  hooks: {
    before: {
      newFishing: ["beforeCreateFishing"],
      skipFishing: ["beforeCreateFishing"],
      list: ["beforeSelect"],
      find: ["beforeSelect"],
      count: ["beforeSelect"],
      get: ["beforeSelect"],
      all: ["beforeSelect"],
    },
  },
})
export default class FishTypesService extends moleculer.Service {
  @Action({
    rest: "POST /",
    params: {
      type: "string",
      coordinates: "object",
    },
  })
  async newFishing(ctx: Context<any>) {
    const params = {
      ...ctx.params,
      startDate: new Date(),
    };
    if (ctx.params.coordinates) {
      const transform = transformation("EPSG:4326", "3346");
      const transformed = transform.forward(ctx.params.coordinates);
      params.geom = coordinatesToGeometry(transformed);
    }
    return this.createEntity(ctx, params);
  }
  @Action({
    rest: "POST /skip",
    params: {
      type: "string",
    },
  })
  async skipFishing(ctx: Context<any>) {
    return this.createEntity(ctx, {
      ...ctx.params,
      skipDate: new Date(),
    });
  }

  @Action({
    rest: "PATCH /:id/finish",
    params: {
      id: "number|convert",
    },
  })
  async finishFishing(ctx: Context<any>) {
    return this.updateEntity(ctx, {
      id: ctx.params.id,
      endDate: new Date(),
    });
  }

  @Action({
    rest: "GET /current",
  })
  async currentFishing(ctx: Context<{}, UserAuthMeta>) {
    let entities = [];
    if (!!ctx.meta?.profile) {
      entities = await this.findEntities(ctx, {
        query: {
          tenant: ctx.meta.profile,
          user: ctx.meta.user.id,
          $raw: "end_date is null",
        },
      });
    } else {
      entities = await this.findEntities(ctx, {
        query: {
          user: ctx.meta.user.id,
          $raw: "tenant_id is null AND end_date is null",
        },
      });
    }
    return entities[0];
  }

  @Method
  async beforeCreateFishing(ctx: Context<any, UserAuthMeta>) {
    if (
      ![AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].some(
        (role) => role === ctx.meta.authUser.type
      )
    ) {
      const profile = ctx.meta.profile;
      const userId = ctx.meta.user.id;
      ctx.params.tenant = profile || null;
      ctx.params.user = userId;
    }
    return ctx;
  }
}