"use strict";

import moleculer from "moleculer";
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
      eyeSize: "number",
      netLength: "number",
      toolType: {
        type: "number",
        columnType: "integer",
        columnName: "tenantId",
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
  },
  hooks: {
    before: {
      create: ["beforeCreate"],
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
  async seedDB() {
    await this.createEntities(null, [
      { label: "Statomieji tinklaičiai" },
      { label: "Marinės gaudyklės" },
      { label: "Nėginės gaudyklės" },
      { label: "Stambiaakės gaudyklės" },
      { label: "Stintinės gaudyklės" },
      { label: "Pūgžlinės-dyglinės gaudyklės" },
      { label: "Stintų tinklaičiai" },
      { label: "Ūdos" },
      { label: "Traukiamasis tinklas" },
      { label: "Nėgių gaudymo bučiukai" },
      { label: "Traukiamasis tinklas stintų žvejybai" },
      { label: "Ungurinė gaudyklė" },
    ]);
  }
}
