'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import ProfileMixin from '../mixins/profile.mixin';
import { coordinatesToGeometry } from '../modules/geometry';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  FieldHookCallback,
  Table,
} from '../types';
import { UserAuthMeta } from './api.service';
import { FishType } from './fishTypes.service';
import { Fishing } from './fishings.service';
import { Tenant } from './tenants.service';
import { ToolCategory } from './toolTypes.service';
import { Tool } from './tools.service';
import { ToolsGroupHistoryTypes, ToolsGroupsHistory } from './toolsGroupsHistories.service';
import { User } from './users.service';

const CoordinatesProp = {
  type: 'object',
  properties: {
    x: 'number',
    y: 'number',
  },
};
type Coordinates = {
  x: number;
  y: number;
};

const LocationProp = {
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
};
type Location = {
  id: string;
  name: string;
  municipality: {
    id: number;
    name: string;
  };
};

interface Fields extends CommonFields {
  id: number;
  tools: any[];
  tenant: Tenant['id'];
  user: User['id'];
  buildEvent: ToolsGroupsHistory;
  removeEvent: ToolsGroupsHistory;
}

interface Populates extends CommonPopulates {}

export type ToolsGroup<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'toolsGroups',
  mixins: [DbConnection(), ProfileMixin],
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
      buildEvent: {
        type: 'number',
        virtual: true,
        readonly: true,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('toolsGroupsHistories.findOne', {
            query: {
              toolsGroup: entity.id,
              type: ToolsGroupHistoryTypes.BUILD_TOOLS,
            },
            sort: '-createdAt',
          });
        },
      },
      removeEvent: {
        type: 'number',
        virtual: true,
        readonly: true,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('toolsGroupsHistories.findOne', {
            query: {
              toolsGroup: entity.id,
              type: ToolsGroupHistoryTypes.REMOVE_TOOLS,
            },
            sort: '-createdAt',
          });
        },
      },
      weighingEvent: {
        type: 'number',
        virtual: true,
        readonly: true,
        async get({ entity, ctx }: FieldHookCallback) {
          const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
          if (currentFishing) {
            return ctx.call('toolsGroupsHistories.findOne', {
              query: {
                toolsGroup: entity.id,
                fishing: currentFishing.id,
                type: ToolsGroupHistoryTypes.WEIGH_FISH,
              },
              sort: '-createdAt',
            });
          }
        },
      },
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: ['toolType', 'tools'],
  },
  hooks: {
    before: {
      buildTools: ['beforeCreate'],
      list: ['beforeSelect'],
      find: ['beforeSelect'],
      count: ['beforeSelect'],
      get: ['beforeSelect'],
      all: ['beforeSelect'],
    },
  },
  actions: {
    create: {
      rest: null,
    },
  },
})
export default class ToolsGroupsService extends moleculer.Service {
  @Action({
    rest: 'POST /build',
    params: {
      tools: { type: 'array', item: 'number' },
      coordinates: CoordinatesProp,
      location: LocationProp,
    },
  })
  async buildTools(
    ctx: Context<{
      tools: number[];
      coordinates: Coordinates;
      location: Location;
    }>,
  ) {
    // fishing validation
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }

    // Tools validation
    const tools: Tool<'toolsGroup' | 'toolType'>[] = await ctx.call('tools.find', {
      query: {
        id: { $in: ctx.params.tools },
      },
      populate: ['toolsGroup', 'toolType'],
    });

    // if tools do not exist or do not belong to user/tenant
    if (tools.length !== ctx.params.tools.length) {
      throw new moleculer.Errors.ValidationError('Tools do not exist');
    }
    // if tools in the water
    const builtTools = tools.filter((tool) => tool.toolsGroup && !tool.toolsGroup.removeEvent);
    if (builtTools.length) {
      throw new moleculer.Errors.ValidationError('Tools is in use');
    }
    // validate if multiple tools connected
    if (ctx.params.tools.length > 1) {
      //number of tool types
      const uniqueToolTypes = tools.reduce((toolTypes, tool) => {
        if (!toolTypes.includes(tool.toolType.id)) {
          toolTypes.push(tool.toolType.id);
        }
        return toolTypes;
      }, []);
      if (uniqueToolTypes.length > 1) {
        throw new moleculer.Errors.ValidationError('To many tool types');
      }
      //is valid tool category
      if (tools[0].toolType.type !== ToolCategory.NET) {
        throw new moleculer.Errors.ValidationError('Invalid tool category');
      }
    }
    const geom = coordinatesToGeometry(ctx.params.coordinates);

    const group = await this.createEntity(ctx, {
      ...ctx.params,
      tools: ctx.params.tools,
    });

    try {
      await ctx.call('toolsGroupsHistories.create', {
        type: ToolsGroupHistoryTypes.BUILD_TOOLS,
        geom,
        location: ctx.params.location,
        toolsGroup: group.id,
        fishing: currentFishing.id,
      });
    } catch (e) {
      await this.removeEntity(ctx, { id: group.id });
      throw e;
    }

    return this.findEntity(ctx, { id: group.id });
  }

  @Action({
    rest: 'POST /remove/:id',
    params: {
      id: 'number|convert',
      coordinates: CoordinatesProp,
      location: LocationProp,
    },
  })
  async removeTools(
    ctx: Context<{
      id: number;
      coordinates: Coordinates;
      location: Location;
    }>,
  ) {
    const group = await this.findEntity(ctx, { id: ctx.params.id });
    if (!group) {
      throw new moleculer.Errors.ValidationError('Invalid group');
    }

    if (!group.removeEvent) {
      const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
      if (!currentFishing) {
        throw new moleculer.Errors.ValidationError('Fishing not started');
      }

      const geom = coordinatesToGeometry(ctx.params.coordinates);

      await ctx.call('toolsGroupsHistories.create', {
        type: ToolsGroupHistoryTypes.REMOVE_TOOLS,
        geom,
        location: ctx.params.location,
        toolsGroup: group.id,
        fishing: currentFishing.id,
      });
    }

    return this.findEntity(ctx, { id: group.id });
  }

  @Action({
    rest: 'POST /weigh/:id',
    params: {
      id: 'number|convert',
      coordinates: CoordinatesProp,
      location: LocationProp,
      data: 'object',
    },
  })
  async weighFish(
    ctx: Context<
      {
        id: number;
        coordinates: Coordinates;
        location: Location;
        data: { [key: FishType['id']]: number };
      },
      UserAuthMeta
    >,
  ) {
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }
    const geom = coordinatesToGeometry(ctx.params.coordinates);

    //toolsGroup validation
    const group = await this.findEntity(ctx, {
      id: ctx.params.id,
      query: {
        user: ctx.meta.user.id,
        tenant: ctx.meta.profile ? ctx.meta.profile : { $exists: false },
      },
    });
    if (!group) {
      throw new moleculer.Errors.ValidationError('Invalid group');
    }

    //fishTypes validation
    const fishTypesIds = Object.keys(ctx.params.data);
    const fishTypes: FishType[] = await ctx.call('fishTypes.find', {
      query: {
        id: { $in: fishTypesIds },
      },
    });
    if (fishTypesIds.length !== fishTypes.length) {
      throw new moleculer.Errors.ValidationError('Invalid fishTypes');
    }

    if (!group.weighingEvent) {
      await ctx.call('toolsGroupsHistories.create', {
        type: ToolsGroupHistoryTypes.WEIGH_FISH,
        geom,
        location: ctx.params.location,
        toolsGroup: ctx.params.id,
        fishing: currentFishing.id,
        data: ctx.params.data,
      });
    } else {
      await ctx.call('toolsGroupsHistories.update', {
        id: group.id,
        data: ctx.params.data,
      });
    }

    return this.findEntity(ctx, { id: group.id });
  }
}
