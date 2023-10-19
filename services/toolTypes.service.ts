"use strict";

import moleculer from "moleculer";
import { Method, Service } from "moleculer-decorators";

import DbConnection from "../mixins/database.mixin";
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

export type ToolType<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields
> = Table<Fields, Populates, P, F>;

@Service({
  name: "toolTypes",
  mixins: [DbConnection()],
  settings: {
    fields: {
      id: {
        type: "number",
        primaryKey: true,
        secure: true,
      },
      label: "string|required",
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
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
