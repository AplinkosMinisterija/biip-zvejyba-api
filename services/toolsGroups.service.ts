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
  Table,
} from '../types';
import { UserAuthMeta } from './api.service';
import { FishType } from './fishTypes.service';
import { Fishing } from './fishings.service';
import { Tenant } from './tenants.service';
import { ToolCategory } from './toolTypes.service';
import { Tool } from './tools.service';
import { ToolsGroupHistoryTypes, ToolsGroupsEvent } from './toolsGroupsEvents.service';
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
  buildEvent: ToolsGroupsEvent['id'];
  removeEvent: ToolsGroupsEvent['id'];
  weightEvent: ToolsGroupsEvent['id'];
  tenant: Tenant['id'];
  user: User['id'];
}

interface Populates extends CommonPopulates {
  tools: Tool[];
  buildEvent: ToolsGroupsEvent;
  removeEvent: ToolsGroupsEvent;
  weightEvent: ToolsGroupsEvent;
  tenant: Tenant;
  user: User;
}

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
        type: 'any',
        columnType: 'integer[]',
        columnName: 'tools',
        default: () => [],
        async populate(ctx: Context, values: number[], entities: ToolsGroup[]) {
          const tools: Tool[] = await ctx.call('tools.find', {
            query: {
              id: { $in: values },
            },
            populate: ['toolType'],
          });

          return entities?.map((entity) => {
            const t = entity.tools?.map((toolId) => {
              const tool = tools.find((t) => t.id === toolId);
              return tool;
            });
            if (t.length) {
              return t;
            }
            return entity.tools;
          });
        },
      },
      buildEvent: {
        type: 'number',
        columnType: 'integer',
        columnName: 'buildEventId',
        populate: {
          action: 'toolsGroupsEvents.resolve',
          params: {
            scope: false,
          },
        },
      },
      removeEvent: {
        type: 'number',
        columnType: 'integer',
        columnName: 'removeEventId',
        populate: {
          action: 'toolsGroupsEvents.resolve',
          params: {
            scope: false,
          },
        },
      },
      weightEvent: {
        type: 'object',
        readonly: true,
        virtual: true,
        default: (): any[] => null,
        async populate(ctx: Context, values: number[], entities: ToolsGroup[]) {
          return Promise.all(
            entities?.map(async (entity) => {
              const f = await ctx.call('fishWeights.getFishByToolsGroup', {
                toolsGroup: entity.id,
              });
              return f;
            }),
          );
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
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: ['tools'],
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
      tools: {
        type: 'array',
        items: 'number',
      },
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
    if (!ctx.params.tools.length) {
      throw new moleculer.Errors.ValidationError('No tools');
    }
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
    if (tools.length && tools.length !== ctx.params.tools.length) {
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

    const buildEvent: ToolsGroupsEvent = await ctx.call('toolsGroupsEvents.create', {
      type: ToolsGroupHistoryTypes.BUILD_TOOLS,
      geom,
      location: ctx.params.location,
      fishing: currentFishing.id,
    });

    try {
      return await this.createEntity(ctx, {
        ...ctx.params,
        buildEvent: buildEvent.id,
      });
    } catch (e) {
      await ctx.call('toolsGroupsEvents.remove', {
        id: buildEvent.id,
      });
      throw e;
    }
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
    const group: ToolsGroup = await ctx.call('toolsGroups.resolve', {
      id: ctx.params.id,
    });
    if (!group) {
      throw new moleculer.Errors.ValidationError('Invalid group');
    }
    if (group.removeEvent) {
      throw new moleculer.Errors.ValidationError('Group already removed');
    }
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }
    const geom = coordinatesToGeometry(ctx.params.coordinates);
    const removeEvent: ToolsGroupsEvent = await ctx.call('toolsGroupsEvents.create', {
      type: ToolsGroupHistoryTypes.REMOVE_TOOLS,
      geom,
      location: ctx.params.location,
      fishing: currentFishing.id,
    });
    try {
      return await this.updateEntity(ctx, {
        id: ctx.params.id,
        removeEvent: removeEvent.id,
      });
    } catch (e) {
      await ctx.call('toolsGroupsEvents.remove', {
        id: removeEvent.id,
      });
      throw e;
    }
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
    const group: ToolsGroup = await ctx.call('toolsGroups.get', {
      id: ctx.params.id,
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
    await ctx.call('fishWeights.create', {
      type: ToolsGroupHistoryTypes.WEIGH_FISH,
      geom,
      location: ctx.params.location,
      fishing: currentFishing.id,
      data: ctx.params.data,
      toolsGroup: group.id,
    });
    return this.findEntity(ctx, { id: group.id });
  }

  @Action({
    rest: 'GET /location/:id',
    params: {
      id: 'string',
    },
  })
  async toolsGroupsByLocation(
    ctx: Context<
      {
        id: string;
      },
      UserAuthMeta
    >,
  ) {
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');

    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }

    const notRemovedToolsGroups: ToolsGroup<'buildEvent'>[] = await ctx.call('toolsGroups.find', {
      query: {
        removeEvent: { $exists: false },
      },
      populate: ['tools', 'buildEvent', 'weightEvent'],
    });

    return notRemovedToolsGroups.filter(
      (toolGroup) => toolGroup.buildEvent.location.id === ctx.params.id,
    );
  }
}
