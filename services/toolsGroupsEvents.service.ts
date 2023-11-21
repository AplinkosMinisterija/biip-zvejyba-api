'use strict';
import moleculer from 'moleculer';
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

export enum ToolsGroupHistoryTypes {
  BUILD_TOOLS = 'BUILD_TOOLS',
  REMOVE_TOOLS = 'REMOVE_TOOLS',
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
}

interface Populates extends CommonPopulates {}

export type ToolsGroupsEvent<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'toolsGroupsEvents',
  mixins: [
    DbConnection(),
    PostgisMixin({
      srid: 3346,
    }),
    ProfileMixin,
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
      toolsGroup: {
        type: 'array',
        readonly: true,
        virtual: true,
        async populate(ctx: any, _values: any, entities: ToolsGroupsEvent[]) {
          const fieldNames = {
            [ToolsGroupHistoryTypes.BUILD_TOOLS]: 'buildEvent',
            [ToolsGroupHistoryTypes.REMOVE_TOOLS]: 'removeEvent',
          };
          return Promise.all(
            entities.map((entity: ToolsGroupsEvent) => {
              return ctx.call('toolsGroups.findOne', {
                query: {
                  [fieldNames[entity.type]]: entity.id,
                },
              });
            }),
          );
        },
      },
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: ['geom'],
  },
  actions: {
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
  hooks: {
    before: {
      create: ['beforeCreate'],
      list: ['beforeSelect'],
      find: ['beforeSelect'],
      count: ['beforeSelect'],
      get: ['beforeSelect'],
      all: ['beforeSelect'],
    },
  },
})
export default class ToolsGroupsEventsService extends moleculer.Service {}
