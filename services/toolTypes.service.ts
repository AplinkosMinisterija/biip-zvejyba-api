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

enum Type {
  NET = "NET",
  CATCHER = "CATCHER",
}

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
      type: "string",
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
      { label: "Statomasis tinklaitis", type: Type.NET },
      { label: "Stintinis tinklaitis", type: Type.NET },
      { label: "Traukiamasis tinklas", type: Type.NET },
      { label: "Marinė gaudyklė", type: Type.CATCHER },
      { label: "Nėginė gaudyklė", type: Type.CATCHER },
      { label: "Stambiaakė gaudyklė", type: Type.CATCHER },
      { label: "Stintinė gaudyklė", type: Type.CATCHER },
      { label: "Ungurinė gaudyklė", type: Type.CATCHER },
    ]);
  }
}
