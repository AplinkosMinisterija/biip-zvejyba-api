'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import { CommonFields, CommonPopulates, FieldHookCallback, Table } from '../types';

import ProfileMixin from '../mixins/profile.mixin';
import { Tenant } from './tenants.service';
import { ToolsGroup } from './toolsGroups.service';
import { User } from './users.service';

enum FishingEventType {
  START_FISHING = 'START_FISHING',
  END_FISHING = 'END_FISHING',
  BUILD_TOOLS = 'BUILD_TOOLS',
  REMOVE_TOOLS = 'TOOLS_GROUP_REMOVE',
  WEIGH_TOOLS = 'TOOLS_GROUP_WEIGHT',
  WEIGH_TOTAL = 'TOTAL_WEIGHT',
}

interface Fields extends CommonFields {
  id: number;
  type: FishingEventType;
  fishing: Fishing['id'];
  tools_Group: ToolsGroup['id'];
  user: User['id'];
  tenant: Tenant['id'];
}

interface Populates extends CommonPopulates {}

export type Fishing<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'fishingEvents',
  mixins: [DbConnection(), ProfileMixin],
  settings: {
    fields: {
      type: 'string',
      date: {
        type: 'date',
        columnType: 'datetime',
        readonly: true,
        onCreate: () => new Date(),
      },
      fishWeight: {
        type: 'number',
        columnType: 'integer',
        columnName: 'fishWeightId',
        async get({ entity, ctx }: FieldHookCallback<Fields>) {
          if (entity.fishWeightId)
            return await ctx.call('fishWeights.get', { id: entity.fishWeightId });
        },
      },
      toolsGroupsHistory: {
        type: 'number',
        columnType: 'integer',
        columnName: 'toolsGroupsHistoryId',
        async get({ entity, ctx }: FieldHookCallback<Fields>) {
          if (entity.toolsGroupsHistoryId)
            return await ctx.call('toolsGroupsHistories.get', { id: entity.toolsGroupsHistoryId });
        },
      },
      toolsGroup: {
        type: 'number',
        columnType: 'integer',
        columnName: 'toolsGroupId',
        async get({ entity, ctx }: FieldHookCallback<Fields>) {
          if (entity.toolsGroupId)
            return await ctx.call('toolsGroups.get', { id: entity.toolsGroupId });
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
    },
    // defaultPopulates: ['fishWeight', 'toolsGroupsHistory', 'toolsGroup'],
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
  action: {
    create: {
      rest: null,
    },
    update: {
      rest: null,
    },
    remove: {
      rest: null,
    },
  },
})
export default class FishTypesService extends moleculer.Service {}
