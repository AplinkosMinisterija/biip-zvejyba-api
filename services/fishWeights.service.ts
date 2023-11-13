'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
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
import { UserAuthMeta } from './api.service';
import { FishType } from './fishTypes.service';
import { Fishing } from './fishings.service';
import { Tenant } from './tenants.service';
import { ToolType } from './toolTypes.service';
import { ToolsGroup } from './toolsGroups.service';
import { User } from './users.service';

interface Fields extends CommonFields {
  id: number;
  data: any;
  date: string;
  fishing: Fishing['id'];
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

export type FishWeight<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'fishWeights',
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
      data: 'any',
      date: {
        type: 'date',
        columnType: 'datetime',
        readonly: true,
        onCreate: () => new Date(),
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
      weighFish: ['beforeCreate'],
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
    update: {
      rest: null,
    },
    remove: {
      rest: null,
    },
  },
})
export default class ToolTypesService extends moleculer.Service {
  @Action({
    rest: 'GET /preliminary',
  })
  async getPreliminaryFishWeight(ctx: Context) {
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }
    const fishWeights: FishWeight[] = await this.findEntities(ctx, {
      query: {
        fishing: currentFishing.id,
      },
      sort: '-createdAt',
    });

    if (fishWeights.length) {
      const data = fishWeights.reduce(
        (aggregate: any, currentValue) => {
          if (aggregate.toolsGroups.includes(currentValue.toolsGroup)) {
            return aggregate;
          }
          const data = currentValue.data;
          for (const key in data) {
            if (aggregate.fishWeights[key]) {
              aggregate.fishWeights[key] = aggregate.fishWeights[key] + data[key];
            } else {
              aggregate.fishWeights[key] = data[key];
            }
          }
          aggregate.toolsGroups.push(currentValue.toolsGroup);
          return aggregate;
        },
        { toolsGroups: [], fishWeights: {} },
      );
      return data.fishWeights;
    }
    return {};
  }

  @Action({
    rest: 'POST /',
    params: {
      data: 'object',
    },
  })
  async weighFish(
    ctx: Context<
      {
        data: { [key: FishType['id']]: number };
      },
      UserAuthMeta
    >,
  ) {
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
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

    //validate if fish is already weighted
    const fishWeight = await this.findEntity(ctx, {
      query: {
        fishing: currentFishing.id,
        toolsGroup: { $exists: false },
      },
    });
    if (fishWeight) {
      throw new moleculer.Errors.ValidationError('Fish already weighted');
    }

    return this.createEntity(ctx, {
      ...ctx.params,
      fishing: currentFishing.id,
    });
  }
  @Action({
    params: {
      toolsGroup: 'number',
    },
  })
  async getFishByToolsGroup(ctx: Context<{ toolsGroup: number }>) {
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }
    const weights = await this.findEntities(ctx, {
      query: {
        fishing: currentFishing.id,
        toolsGroup: ctx.params.toolsGroup,
      },
      sort: '-createdAt',
      limit: 1,
    });
    return weights[0];
  }
}
