'use strict';

import moleculer, { Context } from 'moleculer';
import { Service } from 'moleculer-decorators';

import PostgisMixin from 'moleculer-postgis';
import DbConnection from '../mixins/database.mixin';
import ProfileMixin from '../mixins/profile.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  Table,
} from '../types';
import { Fishing } from './fishings.service';
import { Tenant } from './tenants.service';
import { Tool } from './tools.service';
import { ToolsGroup } from './toolsGroups.service';
import { ToolsGroupsHistory } from './toolsGroupsHistories.service';
import { User } from './users.service';

export enum ToolsGroupHistoryTypes {
  BUILD_TOOLS = 'BUILD_TOOLS',
  REMOVE_TOOLS = 'REMOVE_TOOLS',
  WEIGH_FISH = 'WEIGH_FISH',
}

interface Fields extends CommonFields {
  id: number;
  tools: any[];
  tenant: Tenant['id'];
  user: User['id'];
  buildEvent: ToolsGroupsHistory;
  removeEvent: ToolsGroupsHistory;
  weighingEvent: ToolsGroupsHistory;
  fishing: Fishing['id'];
  location: string;
}

interface Populates extends CommonPopulates {}

export type BuiltToolsGroup<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'builtToolsGroups',
  mixins: [
    DbConnection({
      rest: false,
    }),
    PostgisMixin({
      srid: 3346,
    }),
    ProfileMixin,
  ],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      tools: {
        type: 'array',
        columnName: 'tools',
        default: () => [],
        async populate(ctx: Context, values: number[], entities: ToolsGroup[]) {
          try {
            const tools: Tool[] = await ctx.call('tools.find', {
              query: {
                id: { $in: values },
              },
              populate: ['toolType'],
            });
            return entities?.map((entity) => {
              return entity.tools?.map((toolId) => {
                const tool = tools.find((t) => t.id === toolId);
                return tool;
              });
            });
          } catch (e) {
            return entities;
          }
        },
      },
      tenant: {
        type: 'number',
        columnType: 'integer',
        columnName: 'tenantId',
        populate: {
          action: 'tenants.resolve',
          params: {
            scope: false,
          },
        },
      },
      user: {
        type: 'number',
        columnType: 'integer',
        columnName: 'userId',
        populate: {
          action: 'users.resolve',
          params: {
            scope: false,
          },
        },
      },
      buildEvent: 'object', // ToolsGroupsHistory structure
      removeEvent: 'object', // ToolsGroupsHistory structure
      weighingEvent: 'object', // ToolsGroupsHistory structure
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
      location: {
        type: 'string',
        columnName: 'locationId',
      },
      locationType: 'string',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
  hooks: {
    before: {
      list: ['beforeSelect'],
      find: ['beforeSelect'],
      count: ['beforeSelect'],
      get: ['beforeSelect'],
      all: ['beforeSelect'],
    },
  },
})
export default class ToolsGroupsHistoriesService extends moleculer.Service {}
