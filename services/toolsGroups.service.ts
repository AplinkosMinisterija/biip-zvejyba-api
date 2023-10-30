'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import PostgisMixin from 'moleculer-postgis';
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
import { Fishing } from './fishings.service';
import { Tenant } from './tenants.service';
import { ToolsGroupHistoryTypes } from './toolsGroups.histories.service';
import { User } from './users.service';

interface Fields extends CommonFields {
  id: number;
  tools: any[];
  tenant: Tenant['id'];
  user: User['id'];
}

interface Populates extends CommonPopulates {}

export type ToolsGroup<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'toolsGroups',
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
            const toolsMap: any = {};
            for (const toolId of values) {
              const tool = await ctx.call('tools.get', {
                id: toolId,
                scope: false,
              });
              toolsMap[toolId] = tool;
            }

            return entities?.map((entity) => {
              return entity.tools?.map((toolId) => {
                const tool = toolsMap[toolId.toString()];
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
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: ['toolType'],
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
    rest: 'POST /build/:id',
    params: {
      id: 'number|convert|optional',
      coordinates: 'object',
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
    },
  })
  async buildGroup(ctx: Context<any>) {
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }
    const geom = coordinatesToGeometry(ctx.params.coordinates);

    const group = this.findEntity(ctx, { id: ctx.params.id });
    if (!group) {
      throw new moleculer.Errors.ValidationError('Invalid tools group');
    }

    await ctx.call('toolsGroups.histories.create', {
      type: ToolsGroupHistoryTypes.BUILD_TOOLS,
      geom,
      location: ctx.params.location,
      toolsGroup: group.id,
      fishing: currentFishing.id,
    });

    return this.findEntity(ctx, { id: group.id });
  }

  @Action({
    rest: 'POST /build',
    params: {
      tools: 'array|optional',
      coordinates: 'object',
      location: 'number|convert',
      locationName: 'string',
    },
  })
  async buildTools(ctx: Context<any>) {
    if (!ctx.params.tools) {
      throw new moleculer.Errors.ValidationError('No tools selected');
    }

    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }

    const geom = coordinatesToGeometry(ctx.params.coordinates);

    const group = await this.createEntity(ctx, {
      ...ctx.params,
      tools: ctx.params.tools,
    });

    await ctx.call('toolsGroups.histories.create', {
      type: ToolsGroupHistoryTypes.BUILD_TOOLS,
      geom,
      location: ctx.params.location,
      toolsGroup: group.id,
      fishing: currentFishing.id,
    });

    return this.findEntity(ctx, { id: group.id });
  }

  @Action({
    rest: 'PATCH /return/:id',
    params: {},
  })
  async removeTools(ctx: Context<any>) {
    const toolsGroup = await this.findEntity(ctx, { id: ctx.params.id });
    if (!toolsGroup) {
      throw new moleculer.Errors.ValidationError('Invalid id');
    }

    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }

    const group = await this.updateEntity(ctx, {
      id: toolsGroup.id,
      endDate: new Date(),
      endFishing: currentFishing.id,
    });

    await Promise.all(
      group.tools?.map((id: number) =>
        ctx.call('tools.update', {
          id,
          toolsGroup: null,
        })
      )
    );
    return group;
  }
  @Action({
    rest: 'GET /current',
  })
  async toolsGroupsByLocation(ctx: Context<any>) {
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }
    const locationId = JSON.parse(ctx.params.query)?.locationId;
    return this.findEntities(ctx, {
      query: {
        endDate: { $exists: false },
        endFishing: { $exists: false },
        locationId,
      },
      populate: ['tools'],
    });
  }
}
