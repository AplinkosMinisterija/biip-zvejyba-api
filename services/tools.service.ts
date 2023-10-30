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
import { Tenant } from './tenants.service';
import { ToolType, Type } from './toolTypes.service';
import { ToolGroup } from './toolsGroups.service';
import { User } from './users.service';

interface Fields extends CommonFields {
  id: number;
  sealNr: string;
  eyeSize: number;
  eyeSize2: number;
  netLength: number;
  toolType: ToolType['id'];
  toolsGroup?: ToolGroup[];
  tenant: Tenant['id'];
  user: User['id'];
}

interface Populates extends CommonPopulates {}

export type Tool<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields
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
          eyeSize2: 'number|convert',
          netLength: 'number|convert',
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
      toolsGroup: {
        type: 'number',
        readonly: true,
        virtual: true,
        async populate(ctx: any, _values: any, tools: Tool[]) {
          return Promise.all(
            tools.map((tool: Tool) => {
              return ctx.call('toolsGroups.find', {
                query: {
                  $raw: `tools::jsonb @> '${tool.id}'`,
                },
              });
            })
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
      delete: ['beforeDelete'],
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
      populate: ['toolsGroup'],
    });
    return tools?.filter((tool) => !tool.toolsGroup?.length);
  }

  @Method
  async beforeCreateOrUpdate(ctx: Context<any>) {
    const existing: Tool[] = await this.findEntities(null, {
      query: {
        sealNr: ctx.params.sealNr,
      },
    });

    //Seal number validation
    if (
      ctx.params.id
        ? existing?.some((tool) => tool.id !== ctx.params.id)
        : existing.length
    ) {
      throw new moleculer.Errors.ValidationError(
        'Tool with this seal number already exists'
      );
    }

    //Tool type validation
    const toolType: ToolType = await ctx.call('toolType.get', {
      id: ctx.params.toolType,
    });

    if (!toolType) {
      throw new moleculer.Errors.ValidationError('Invalid tool type');
    }

    //Tool data validation
    const invalidNet = !ctx.params.data?.eyeSize || !ctx.params.data?.netLength;
    const invalidCatcher =
      !ctx.params.data?.eyeSize || !ctx.params.data?.eysSize2;

    const invalidTool =
      toolType.type === Type.NET ? invalidNet : invalidCatcher;

    if (invalidTool) {
      throw new moleculer.Errors.ValidationError('Invalid tool data');
    }
  }

  @Method
  async beforeDelete(ctx: Context<any, UserAuthMeta>) {
    //Tool ownership validation
    if (
      ![AuthUserRole.SUPER_ADMIN, AuthUserRole.ADMIN].some(
        (r) => r === ctx.meta.authUser.type
      )
    ) {
      const tool = await this.findEntity(ctx, {
        id: ctx.params.id,
        query: {
          tenant: ctx.meta.profile ? ctx.meta.profile : { $exists: false },
          user: ctx.meta.profile ? { $exists: true } : ctx.params.user.id,
        },
        populate: ['toolsGroup'],
      });
      if (!tool) {
        throw new moleculer.Errors.ValidationError('Cannot delete tool');
      }
    }

    //TODO: should not delete tool in the water
  }
}
