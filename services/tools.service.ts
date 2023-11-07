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
  FieldHookCallback,
  Table,
  throwValidationError,
} from '../types';
import { AuthUserRole, UserAuthMeta } from './api.service';
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
  toolsGroup: ToolsGroup['id'];
  tenant: Tenant['id'];
  user: User['id'];
}

interface Populates extends CommonPopulates {
  toolType: ToolType;
  toolsGroup: ToolsGroup;
  tenant: Tenant;
  user: User;
}

export type Tool<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

async function validateSealNr({ ctx, params, entity, value }: FieldHookCallback) {
  if (!entity?.id && !value) {
    throwValidationError('No seal number', params);
  }

  if (!!value && entity?.sealNr !== value) {
    const query: any = {
      sealNr: ctx.params.sealNr,
    };

    if (entity?.id) {
      query.id = { $ne: entity?.id };
    }

    const count = await this.countEntities(null, {
      query,
      fields: ['id'],
    });

    if (count > 0) {
      throwValidationError('Tool with this seal number already exists', params);
    }
  }

  return value;
}

async function validateToolType({ ctx, params, entity, value }: FieldHookCallback) {
  if (!entity?.id && !value) {
    throwValidationError('No tool type', params);
  }

  if (!!value && entity?.toolTypeId !== value) {
    const toolType: ToolType = await ctx.call('toolTypes.resolve', { id: value });
    if (!toolType?.id) {
      throwValidationError('Invalid tool type', params);
    }
  }

  return value;
}

async function validateData({ ctx, params, entity, value }: FieldHookCallback) {
  if (!entity?.id && !value) {
    throwValidationError('No tool data', params);
  }

  if (!value && !!entity.data) return value;

  const toolType: ToolType = await ctx.call('toolTypes.resolve', {
    id: params.toolType || entity?.toolTypeId,
    throwIfNotExist: true,
  });

  if (!value?.eyeSize) throwValidationError('Invalid tool data - no eyeSize', params);

  if (toolType.type === ToolCategory.NET && !value?.netLength) {
    throwValidationError('Invalid tool data - no netLength', params);
  } else if (toolType.type !== ToolCategory.NET && !value?.eyeSize2) {
    throwValidationError('Invalid tool data - no eyeSize2', params);
  }

  return value;
}

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
      sealNr: {
        type: 'string',
        onCreate: validateSealNr,
        onUpdate: validateSealNr,
      },
      data: {
        type: 'object',
        onCreate: validateData,
        onUpdate: validateData,
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
        onCreate: validateToolType,
        onUpdate: validateToolType,
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
          //TODO: reikia geresnio sprendimo, nes toolGroups'u laikui begant dauges
          return Promise.all(
            tools.map(async (tool: Tool) => {
              const toolGroups = await ctx.call('toolsGroups.find', {
                query: {
                  $raw: `tools::jsonb @> '${tool.id}'`,
                },
              });
              return toolGroups.find((group: ToolsGroup) => !group.removeEvent);
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
    defaultPopulates: ['toolType', 'toolsGroup'],
  },
  hooks: {
    before: {
      create: ['beforeCreate'],
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
      populate: ['toolsGroup'],
    });
    return tools?.filter((tool) => !tool.toolsGroup);
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
        populate: ['toolsGroup'],
      });
      if (!tool) {
        throw new moleculer.Errors.ValidationError('Cannot delete tool');
      }
      //validate if tool is in the water
      if (tool.toolsGroup) {
        throw new moleculer.Errors.ValidationError('Tools is in use');
      }
    }
  }
}
