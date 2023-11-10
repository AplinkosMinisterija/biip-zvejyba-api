'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
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
import { ToolsGroupHistoryTypes, ToolsGroupsHistory } from './toolsGroupsHistories.service';
import { User } from './users.service';

interface Fields extends CommonFields {
  id: number;
  data: any;
  date: string;
  fishing: Fishing['id'];
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
  mixins: [DbConnection(), ProfileMixin],
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

    const caughtFishEvents: ToolsGroupsHistory[] = await ctx.call('toolsGroupsHistories.find', {
      query: {
        fishing: currentFishing.id,
        type: ToolsGroupHistoryTypes.WEIGH_FISH,
      },
    });
    if (caughtFishEvents.length) {
      return caughtFishEvents.reduce((aggregate: any, currentValue) => {
        const data = currentValue.data;
        for (const key in data) {
          if (aggregate[key]) {
            aggregate[key] = aggregate[key] + data[key];
          } else {
            aggregate[key] = data[key];
          }
        }
        return aggregate;
      }, {});
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
}
