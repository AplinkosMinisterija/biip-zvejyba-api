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
      { label: 'Statomieji tinklaičiai 45-50 mm', type: ToolCategory.NET },
      { label: 'Statomieji tinklaičiai 70-80 mm', type: ToolCategory.NET },
      { label: 'Statomieji stintiniai tinklaičiai 10-12 mm', type: ToolCategory.NET },
      { label: 'Traukiamas tinklas (Nemuno žemupyje)', type: ToolCategory.NET },
      { label: 'Traukiamas tinklas (ežeruose)', type: ToolCategory.NET },
      { label: 'Marinė gaudyklė 18-30 mm', type: ToolCategory.CATCHER },
      { label: 'Marinė gaudyklė 20-30 mm', type: ToolCategory.CATCHER },
      { label: 'Marinė gaudyklė 28-34 mm', type: ToolCategory.CATCHER },
      { label: 'Stambiaakė gaudyklė 30-32 mm', type: ToolCategory.CATCHER },
      { label: 'Stambiaakė gaudyklė 30-36 mm', type: ToolCategory.CATCHER },
      { label: 'Stambiaakė gaudyklė 40-45 mm', type: ToolCategory.CATCHER },
      { label: 'Nėgių gaudyklė 5-10 mm', type: ToolCategory.CATCHER },
      { label: 'Nėgių gaudyklė 10-16 mm', type: ToolCategory.CATCHER },
      { label: 'Nėgių gaudyklė 12-16 mm', type: ToolCategory.CATCHER },
      { label: 'Stintų gaudyklė 12 mm', type: ToolCategory.CATCHER },
      { label: 'Stintų gaudyklė 12-16 mm', type: ToolCategory.CATCHER },
      { label: 'Stintų gaudyklė 14-20 mm', type: ToolCategory.CATCHER },
    ]);
  }
}
