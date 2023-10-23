"use strict";

import moleculer, { Context } from "moleculer";
import { Method, Service } from "moleculer-decorators";
import DbConnection from "../mixins/database.mixin";
import ProfileMixin from "../mixins/profile.mixin";
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  Table,
} from "../types";
import { TenantUser } from "./tenantUsers.service";

interface Fields extends CommonFields {
  id: number;
  label: string;
}

interface Populates extends CommonPopulates {}

export type Tool<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields
> = Table<Fields, Populates, P, F>;

@Service({
  name: "tools",
  mixins: [DbConnection(), ProfileMixin],
  settings: {
    fields: {
      id: {
        type: "number",
        primaryKey: true,
        secure: true,
      },
      sealNr: "string",
      eyeSize: "number|convert",
      eyeSize2: "number|convert",
      netLength: "number|convert",
      toolType: {
        type: "number",
        columnType: "integer",
        columnName: "toolTypeId",
        populate: {
          action: "toolTypes.resolve",
          params: {
            scope: false,
          },
        },
      },
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
    defaultPopulates: ["toolType"],
  },
  hooks: {
    before: {
      create: ["beforeCreate", "validateTool"],
      list: ["beforeSelect"],
      find: ["beforeSelect"],
      count: ["beforeSelect"],
      get: ["beforeSelect"],
      all: ["beforeSelect"],
    },
  },
})
export default class ToolTypesService extends moleculer.Service {
  @Method
  async validateTool(ctx: Context<any>) {
    console.log("new tool", ctx.params);
    const existing: TenantUser[] = await this.findEntities(null, {
      query: {
        sealNr: ctx.params.sealNr,
      },
    });

    if (existing?.length) {
      throw new moleculer.Errors.MoleculerClientError(
        "Already exists",
        422,
        "ALREADY_EXISTS"
      );
    }
  }
}
