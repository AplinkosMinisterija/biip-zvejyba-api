'use strict';

import moleculer from 'moleculer';
import { Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  Table,
} from '../types';

export enum ToolCategory {
  NET = 'NET',
  CATCHER = 'CATCHER',
}

interface Fields extends CommonFields {
  id: number;
  label: string;
  type: ToolCategory;
}

interface Populates extends CommonPopulates {}

export type ToolType<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'toolTypes',
  mixins: [DbConnection()],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      label: 'string|required',
      type: 'string',
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
      { label: 'Statomasis tinklaitis', type: ToolCategory.NET },
      { label: 'Stintinis tinklaitis', type: ToolCategory.NET },
      { label: 'Traukiamasis tinklas', type: ToolCategory.NET },
      { label: 'Marinė gaudyklė', type: ToolCategory.CATCHER },
      { label: 'Nėginė gaudyklė', type: ToolCategory.CATCHER },
      { label: 'Stambiaakė gaudyklė', type: ToolCategory.CATCHER },
      { label: 'Stintinė gaudyklė', type: ToolCategory.CATCHER },
      { label: 'Ungurinė gaudyklė', type: ToolCategory.CATCHER },
    ]);
  }
}
