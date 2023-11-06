'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
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
import { AuthUserRole, UserAuthMeta } from './api.service';
import { BuiltToolsGroup } from './builtToolsGroups.service';
import { Tenant } from './tenants.service';
import { ToolCategory, ToolType } from './toolTypes.service';
import { ToolsGroup } from './toolsGroups.service';
import { User } from './users.service';

interface Fields extends CommonFields {
  id: number;
  sealNr: string;
  eyeSize: number;
  eyeSize2: number;
  netLength: number;
  toolType: ToolType['id'];
  tenant: Tenant['id'];
  user: User['id'];
  // toolsGroup?: ToolsGroup['id'];
  builtToolsGroup?: BuiltToolsGroup['id'];
}

interface Populates extends CommonPopulates {
  toolType: ToolType;
  toolsGroup: ToolsGroup;
  builtToolsGroup: BuiltToolsGroup;
  tenant: Tenant;
  user: User;
}

export type Tool<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'tools',
  mixins: [DbConnection(), ProfileMixin],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      sealNr: 'string',
      data: {
        type: 'object',
        properties: {
          eyeSize: 'number|convert',
          eyeSize2: 'number|convert|optional',
          netLength: 'number|convert|optional',
        },
      },
      toolType: {
        type: 'number',
        columnType: 'integer',
        columnName: 'toolTypeId',
        populate: {
          action: 'toolTypes.resolve',
          params: {
            scope: false,
          },
        },
      },
      // toolsGroup: {
      //   type: 'number',
      //   readonly: true,
      //   virtual: true,
      //   async populate(ctx: any, _values: any, tools: Tool[]) {
      //     //TODO: reikia geresnio sprendimo, nes toolGroups'u laikui begant dauges
      //     return Promise.all(
      //       tools.map(async (tool: Tool) => {
      //         const toolGroups: BuiltToolsGroup[] = await ctx.call('builtToolsGroup.find', {
      //           query: {
      //             $raw: `tools::int[] @> ${tool.id}`,
      //           },
      //         });
      //         return toolGroups.find((group: BuiltToolsGroup) => !group.removeEvent);
      //       }),
      //     );
      //   },
      // },
      builtToolsGroup: {
        type: 'number',
        readonly: true,
        virtual: true,
        async populate(ctx: any, _values: any, tools: Tool[]) {
          //TODO: reikia geresnio sprendimo, nes toolGroups'u laikui begant dauges
          return Promise.all(
            tools.map(async (tool: Tool) => {
              return await ctx.call('builtToolsGroups.findOne', {
                query: {
                  ...ctx.params.query,
                  $raw: `${tool.id} = ANY(tools)`,
                  removeEvent: { $exists: false },
                },
              });
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
    defaultPopulates: ['toolType'],
  },
  hooks: {
    before: {
      create: ['beforeCreateOrUpdate', 'beforeCreate'],
      update: ['beforeCreateOrUpdate'],
      remove: ['beforeDelete'],
      availableTools: ['beforeSelect'],
      list: ['beforeSelect'],
      find: ['beforeSelect'],
      count: ['beforeSelect'],
      get: ['beforeSelect'],
      all: ['beforeSelect'],
    },
  },
})
export default class ToolTypesService extends moleculer.Service {
  @Action({
    rest: 'GET /available',
  })
  async availableTools(ctx: Context<any, UserAuthMeta>) {
    const tools: Tool[] = await this.findEntities(ctx, {
      ...ctx.params,
      populate: ['builtToolsGroup'],
    });
    return tools?.filter((tool) => !tool.builtToolsGroup);
  }

  @Method
  async beforeCreateOrUpdate(ctx: Context<any>) {
    const existing: Tool[] = await this.findEntities(null, {
      query: {
        sealNr: ctx.params.sealNr,
      },
    });

    //Seal number validation
    if (ctx.params.id ? existing?.some((tool) => tool.id !== ctx.params.id) : existing.length) {
      throw new moleculer.Errors.ValidationError('Tool with this seal number already exists');
    }

    //Tool type validation
    const toolType: ToolType = await ctx.call('toolTypes.get', {
      id: ctx.params.toolType,
    });

    if (!toolType) {
      throw new moleculer.Errors.ValidationError('Invalid tool type');
    }

    //Tool data validation
    const invalidNet = !ctx.params.data?.eyeSize || !ctx.params.data?.netLength;
    const invalidCatcher = !ctx.params.data?.eyeSize || !ctx.params.data?.eyeSize2;

    const invalidTool = toolType.type === ToolCategory.NET ? invalidNet : invalidCatcher;

    if (invalidTool) {
      throw new moleculer.Errors.ValidationError('Invalid tool data');
    }
  }

  @Method
  async beforeDelete(ctx: Context<any, UserAuthMeta>) {
    //Tool ownership validation
    if (![AuthUserRole.SUPER_ADMIN, AuthUserRole.ADMIN].some((r) => r === ctx.meta.authUser.type)) {
      const tool = await this.findEntity(ctx, {
        id: ctx.params.id,
        query: {
          tenant: ctx.meta.profile ? ctx.meta.profile : { $exists: false },
          user: ctx.meta.profile ? { $exists: true } : ctx.meta.user.id,
        },
        populate: ['builtToolsGroup'],
      });
      if (!tool) {
        throw new moleculer.Errors.ValidationError('Cannot delete tool');
      }
      //validate if tool is in the water
      if (tool.builtToolsGroup) {
        throw new moleculer.Errors.ValidationError('Tools is in use');
      }
    }
  }
}
