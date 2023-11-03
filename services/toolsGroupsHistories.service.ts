'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import PostgisMixin from 'moleculer-postgis';
import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  Table,
} from '../types';
import { Fishing } from './fishings.service';
import { ToolsGroup } from './toolsGroups.service';

export enum ToolsGroupHistoryTypes {
  BUILD_TOOLS = 'BUILD_TOOLS',
  REMOVE_TOOLS = 'REMOVE_TOOLS',
  WEIGH_FISH = 'WEIGH_FISH',
}

interface Fields extends CommonFields {
  id: number;
  type: ToolsGroupHistoryTypes;
  geom: any;
  location: {
    id: string;
    name: string;
    municipality: {
      id: number;
      name: string;
    };
  };
  data: any;
  fishing: Fishing['id'];
  toolsGroup: ToolsGroup['id'];
}

interface Populates extends CommonPopulates {}

export type ToolsGroupsHistory<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'toolsGroupsHistories',

  mixins: [
    DbConnection({
      collection: 'toolsGroupsHistories',
      rest: false,
    }),
    PostgisMixin({
      srid: 3346,
    }),
  ],
  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      type: {
        type: 'string',
        enum: Object.values(ToolsGroupHistoryTypes),
      },
      geom: {
        type: 'any',
        geom: {
          types: ['Point'],
        },
      },
      location: {
        type: 'object',
        properties: {
          id: 'string',
          name: 'string',
          municipality: {
            type: 'object',
            properties: {
              id: 'number',
              name: 'string',
            },
          },
        },
      },
      data: 'any', // Type is not clear yet
      toolsGroup: {
        type: 'number',
        columnType: 'integer',
        columnName: 'toolsGroupId',
        populate: {
          action: 'toolsGroups.resolve',
          params: {
            scope: false,
          },
        },
      },
      fishing: {
        type: 'number',
        columnType: 'integer',
        columnName: 'fishingId',
        populate: {
          action: 'fishings.resolve',
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
})
export default class ToolsGroupsHistoriesService extends moleculer.Service {}
