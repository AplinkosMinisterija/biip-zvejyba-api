'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import { CommonFields, CommonPopulates, RestrictionType, Table } from '../types';

import ProfileMixin from '../mixins/profile.mixin';
import { Tenant } from './tenants.service';
import { ToolsGroup } from './toolsGroups.service';
import { User } from './users.service';

enum FishingEventType {
  START_FISHING = 'START_FISHING',
  END_FISHING = 'END_FISHING',
  BUILD_TOOLS = 'BUILD_TOOLS',
  REMOVE_TOOLS = 'REMOVE_TOOLS',
  WEIGH_FISH = 'WEIGH_FISH',
  WEIGHT_TOTAL = 'WEIGHT_TOTAL',
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
    type: 'string',
    date: {
      type: 'date',
      columnType: 'datetime',
      readonly: true,
      onCreate: () => new Date(),
    },
    fields: {
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
      toolsGroupsHistories: {
        type: 'array',
        readonly: true,
        virtual: true,
        async populate(ctx: any, _values: any, fishings: Fishing[]) {
          return Promise.all(
            fishings.map((fishing: any) => {
              return ctx.call('toolsGroupsHistories.find', {
                query: {
                  fishing: fishing.id,
                },
              });
            }),
          );
        },
      },
      fishWeight: {
        type: 'array',
        readonly: true,
        virtual: true,
        async populate(ctx: any, _values: any, fishings: Fishing[]) {
          return Promise.all(
            fishings.map((fishing: any) => {
              return ctx.call('fishWeights.findOne', {
                query: {
                  fishing: fishing.id,
                },
              });
            }),
          );
        },
      },
    },
  },
  actions: {
    create: {
      rest: null,
    },
    update: {
      auth: RestrictionType.ADMIN,
    },
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
