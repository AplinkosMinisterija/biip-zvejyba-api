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
  RestrictionType,
  Table,
} from '../types';
import { UserAuthMeta } from './api.service';
import { FishType } from './fishTypes.service';
import { Fishing } from './fishings.service';
import { Coordinates, CoordinatesProp, Location, LocationProp } from './location.service';
import { Tenant } from './tenants.service';
import { Tool } from './tools.service';
import { ToolsGroupHistoryTypes, ToolsGroupsEvent } from './toolsGroupsEvents.service';
import { User } from './users.service';
import { WeightEvent } from './weightEvents.service';

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
  tools: Tool<'toolType'>[];
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
          if (!values?.length || !entities?.length) return [];

          const tools: Tool[] = await ctx.call('tools.find', {
            query: { id: { $in: values } },
            populate: ['toolType'],
          });

          const toolsMap = new Map(tools.map((t) => [t.id, t]));

          return entities.map((entity) =>
            entity.tools?.length
              ? entity.tools.map((id) => toolsMap.get(id)).filter(Boolean)
              : entity.tools,
          );
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
              const f = await ctx.call('weightEvents.getFishByToolsGroup', {
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
    defaultPopulates: ['tools', 'buildEvent'],
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
    rest: 'POST /connect/:id',
    auth: RestrictionType.USER,
    params: {
      id: 'number|convert',
      tools: {
        type: 'array',
        items: 'number',
      },
    },
  })
  async connectTools(
    ctx: Context<{
      tools: number[];
      id: number;
    }>,
  ) {
    const group: ToolsGroup<'tools'> = await ctx.call('toolsGroups.resolve', {
      id: ctx.params.id,
      populate: ['tools'],
    });
    if (!group) {
      throw new moleculer.Errors.ValidationError('Invalid group');
    }

    if (!ctx.params.tools.length) {
      throw new moleculer.Errors.ValidationError('No tools');
    }

    const toolGroupToolType = group.tools[0].toolType.id;

    const tools: Tool<'toolsGroup' | 'toolType'>[] = await ctx.call('tools.find', {
      query: {
        id: { $in: ctx.params.tools },
      },
      populate: ['toolsGroup', 'toolType'],
    });

    if (tools.length && tools.length !== ctx.params.tools.length) {
      throw new moleculer.Errors.ValidationError('Tools do not exist');
    }

    const builtTools = tools.filter(
      (tool) => tool?.toolsGroup?.buildEvent && !tool?.toolsGroup?.removeEvent,
    );

    if (builtTools.length) {
      throw new moleculer.Errors.ValidationError('Tools is in use');
    }

    for (const tool of tools) {
      if (tool.toolType.id !== toolGroupToolType) {
        throw new moleculer.Errors.ValidationError('Too many tool types');
      }
    }

    for (const tool of tools) {
      try {
        this.removeEntity(ctx, {
          id: tool.toolsGroup.id,
        });
      } catch (e) {}
    }

    return await this.updateEntity(ctx, {
      id: ctx.params.id,
      tools: [...group.tools.map((tool) => tool.id), ...tools.map((tool) => tool.id)],
    });
  }

  @Action({
    rest: 'POST /disconnect/:id',
    auth: RestrictionType.USER,
    params: {
      id: 'number|convert',
      tools: {
        type: 'array',
        items: 'number',
      },
    },
  })
  async disconnectTools(
    ctx: Context<
      {
        tools: number[];
        id: number;
      },
      UserAuthMeta
    >,
  ) {
    const userId = ctx.meta.user.id;
    const tenantId = ctx.meta.profile;
    const toolsIds = ctx.params.tools;
    const group: ToolsGroup<'tools'> = await ctx.call('toolsGroups.resolve', {
      id: ctx.params.id,
      populate: ['tools'],
    });
    if (!group) {
      throw new moleculer.Errors.ValidationError('Invalid group');
    }

    const toolGroupId = group.id;

    if (!ctx.params.tools.length) {
      throw new moleculer.Errors.ValidationError('No tools');
    }

    const tools: Tool<'toolsGroup' | 'toolType'>[] = await ctx.call('tools.find', {
      query: {
        id: { $in: ctx.params.tools },
      },
      populate: ['toolsGroup', 'toolType'],
    });
    if (tools.length && tools.length !== ctx.params.tools.length) {
      throw new moleculer.Errors.ValidationError('Tools do not exist');
    }

    const builtTools = tools.filter(
      (tool) => tool.toolsGroup.buildEvent && !tool.toolsGroup.removeEvent,
    );

    if (builtTools.length) {
      throw new moleculer.Errors.ValidationError('Tools are in use');
    }

    for (const tool of tools) {
      if (tool.toolsGroup.id !== toolGroupId) {
        throw new moleculer.Errors.ValidationError('Tool belongs to another tool group');
      }
    }

    await this.createEntity(ctx, {
      tools: toolsIds,
      user: userId,
      tenant: tenantId,
    });

    return await this.updateEntity(ctx, {
      id: ctx.params.id,
      tools: group.tools.filter((tool) => !toolsIds.includes(tool.id)).map((tool) => tool.id),
    });
  }

  @Action({
    rest: 'POST /build/:id',
    auth: RestrictionType.USER,
    params: {
      id: 'number|convert',
      coordinates: CoordinatesProp,
      location: LocationProp,
    },
  })
  async buildTools(
    ctx: Context<{
      id: number;
      coordinates: Coordinates;
      location: Location;
    }>,
  ) {
    const group: ToolsGroup<'tools'> = await ctx.call('toolsGroups.resolve', {
      id: ctx.params.id,
      populate: ['tools'],
    });
    if (!group) {
      throw new moleculer.Errors.ValidationError('Invalid group');
    }

    // fishing validation
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }

    const geom = coordinatesToGeometry(ctx.params.coordinates);

    const buildEvent: ToolsGroupsEvent = await ctx.call('toolsGroupsEvents.create', {
      type: ToolsGroupHistoryTypes.BUILD_TOOLS,
      geom,
      location: ctx.params.location,
      fishing: currentFishing.id,
    });

    try {
      return await this.updateEntity(ctx, {
        id: ctx.params.id,
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
    auth: RestrictionType.USER,
    params: {
      id: 'number|convert',
      coordinates: CoordinatesProp,
      location: LocationProp,
    },
  })
  async removeTools(
    ctx: Context<
      {
        id: number;
        coordinates: Coordinates;
        location: Location;
      },
      UserAuthMeta
    >,
  ) {
    const userId = ctx.meta.user.id;
    const tenantId = ctx.meta.profile;
    const group: ToolsGroup<'tools'> = await ctx.call('toolsGroups.resolve', {
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
      await this.updateEntity(ctx, {
        id: ctx.params.id,
        removeEvent: removeEvent.id,
      });

      await ctx.call('toolsGroups.create', {
        tools: group.tools.map((tool) => tool.id),
        user: userId,
        tenant: tenantId,
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
    auth: RestrictionType.USER,
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
    await ctx.call('weightEvents.createWeightEvent', {
      toolsGroup: ctx.params.id,
      coordinates: ctx.params.coordinates,
      location: ctx.params.location,
      data: ctx.params.data,
    });
    return { success: true };
  }

  @Action({
    rest: 'GET /location/:id',
    auth: RestrictionType.USER,
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
      (toolGroup) => toolGroup?.buildEvent?.location.id === ctx.params.id,
    );
  }

  @Action({
    rest: 'GET /notChecked',
    params: {
      toolsGroup: 'number|convert|optional',
    },
    auth: RestrictionType.USER,
  })
  async getNotCheckedToolsGroups(ctx: Context<{ toolsGroup?: number }>) {
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }

    const weightEvents: WeightEvent<'toolsGroup'>[] = await ctx.call('weightEvents.find', {
      query: { fishing: currentFishing.id },
    });

    const weightToolLocationStats = weightEvents.reduce<
      Record<
        string,
        {
          name: string;
          count: number;
        }
      >
    >((acc, curr) => {
      const location = curr?.toolsGroup?.buildEvent?.location;

      if (!location?.id) return acc;

      const { id, name } = location;

      if (!acc[id]) {
        acc[id] = {
          name: name ?? '',
          count: 1,
        };
      } else {
        acc[id].count += 1;
      }

      return acc;
    }, {});
    const notRemovedToolsGroups: ToolsGroup<'buildEvent'>[] = await ctx.call('toolsGroups.find', {
      query: {
        removeEvent: { $exists: false },
      },
      populate: ['buildEvent'],
    });

    const notRemovedToolsLocationCounts = notRemovedToolsGroups.reduce<Record<string, number>>(
      (acc, curr) => {
        const locationId = curr.buildEvent?.location?.id;

        if (!locationId) return acc;

        return {
          ...acc,
          [locationId]: (acc[locationId] ?? 0) + 1,
        };
      },
      {},
    );
    const locations = Object.entries(weightToolLocationStats)
      .filter(([id, stats]) => stats.count < (notRemovedToolsLocationCounts[id] ?? 0))
      .map(([id, stats]) => ({
        id,
        name: stats.name,
      }));

    return locations;
  }

  @Action({
    auth: RestrictionType.PUBLIC,
  })
  async getUniqueToolsLocationsCount(ctx: Context) {
    const locations = await this.rawQuery(
      ctx,
      `SELECT COUNT(DISTINCT (location->>'id')::text) +
        CASE WHEN EXISTS ( SELECT 1 FROM tools_groups_events WHERE location IS NOT NULL AND (location->>'name') ILIKE '%baras%') 
        THEN 1 ELSE 0 END AS location_count
        FROM tools_groups_events
        WHERE location IS NOT NULL AND (location->>'name') NOT ILIKE '%baras%';`,
    );
    return Number(locations[0]?.location_count);
  }
}
