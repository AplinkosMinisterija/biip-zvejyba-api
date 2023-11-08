'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import PostgisMixin from 'moleculer-postgis';
import DbConnection, { PopulateHandlerFn } from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  RestrictionType,
  Table,
} from '../types';

import ProfileMixin from '../mixins/profile.mixin';
import { coordinatesToGeometry } from '../modules/geometry';
import { UserAuthMeta } from './api.service';
import { FishWeight } from './fishWeights.service';
import { Tenant } from './tenants.service';
import { ToolsGroupHistoryTypes } from './toolsGroupsHistories.service';
import { User } from './users.service';

enum FishingType {
  ESTUARY = 'ESTUARY',
  POLDERS = 'POLDERS',
  INLAND_WATERS = 'INLAND_WATERS',
}

interface Fields extends CommonFields {
  id: number;
  startDate: Date;
  endDate: Date;
  skipDate: Date;
  geom: any;
  type: FishingType;
  tenant: Tenant['id'];
  user: User['id'];
}

interface Populates extends CommonPopulates {}

export type Fishing<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'fishings',
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
      startDate: {
        type: 'date',
        columnType: 'datetime',
        readonly: true,
        onCreate: () => new Date(),
      },
      endDate: 'date',
      skipDate: 'date',
      geom: {
        type: 'any',
        geom: {
          types: ['Point'],
        },
      },
      type: 'string',
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
      toolsGroupsHistories: {
        //galimai nebereikes sito
        type: 'array',
        readonly: true,
        virtual: true,
        populate: {
          keyField: 'id',
          handler: PopulateHandlerFn('toolsGroupsHistories.populateByProp'),
          params: {
            queryKey: 'fishing',
            mappingMulti: true,
            sort: 'createdAt'
          },
        },
      },
      fishWeight: {
        //galimai nebereikes sito
        type: 'array',
        readonly: true,
        virtual: true,
        async populate(ctx: any, _values: any, fishings: Fishing[]) {
          return Promise.all(
            fishings.map((fishing: any) => {
              return ctx.call('fishWeights.findOne', {
                query: {
                  fishing: fishing.id,
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
    defaultPopulates: [],
  },
  actions: {
    create: {
      rest: null,
    },
    update: {
      auth: RestrictionType.ADMIN,
    },
  },
  hooks: {
    before: {
      startFishing: ['beforeCreate'],
      skipFishing: ['beforeCreate'],
      list: ['beforeSelect'],
      find: ['beforeSelect'],
      count: ['beforeSelect'],
      get: ['beforeSelect'],
      all: ['beforeSelect'],
    },
  },
})
export default class FishTypesService extends moleculer.Service {
  @Action({
    rest: 'POST /start',
    params: {
      type: 'string',
      coordinates: 'object',
    },
  })
  async startFishing(
    ctx: Context<{ type: FishingType; coordinates: { x: number; y: number } }, UserAuthMeta>,
  ) {
    //Single active fishing validation
    const current = await this.currentFishing(ctx);
    if (current) {
      throw new moleculer.Errors.ValidationError('Fishing already started');
    }

    //Tenant tools validation. Tenant should have at least one tool.
    const toolsCount: number = await ctx.call('tools.count');
    if (toolsCount < 1) {
      throw new moleculer.Errors.ValidationError('No tools in storage');
    }

    const params: Partial<Fishing> = {
      ...ctx.params,
      startDate: new Date(),
    };
    if (ctx.params.coordinates) {
      params.geom = coordinatesToGeometry(ctx.params.coordinates);
    }
    return this.createEntity(ctx, params);
  }

  @Action({
    rest: 'POST /skip',
    params: {
      type: 'string',
    },
  })
  async skipFishing(ctx: Context<any>) {
    //To skip fishing, create new fishing and mark it as skipped.
    return this.createEntity(ctx, {
      ...ctx.params,
      skipDate: new Date(),
    });
  }

  @Action({
    rest: 'PATCH /finish',
  })
  async finishFishing(ctx: Context<any, UserAuthMeta>) {
    //Single active fishing validation
    const current = await this.currentFishing(ctx);
    if (!current) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }
    //validate if fishing has loose toolsGroups weighing events
    const fishWeightEvents: number = await ctx.call('toolsGroupsHistories.count', {
      query: {
        fishing: current.id,
        type: ToolsGroupHistoryTypes.WEIGH_FISH,
      },
    });
    if (fishWeightEvents) {
      const totalFishWeight: FishWeight[] = await ctx.call('fishWeights.count', {
        query: {
          fishing: current.id,
        },
      });
      if (!totalFishWeight) {
        throw new moleculer.Errors.ValidationError('Fish must be weighted');
      }
    }
    return this.updateEntity(ctx, {
      id: current.id,
      endDate: new Date(),
    });
  }

  @Action({
    rest: 'GET /current',
  })
  async currentFishing(ctx: Context<any, UserAuthMeta>) {
    //Users in the same tenant do not share fishing. Each person should start and finish his/her own fishing.
    let entities = [];
    if (!!ctx.meta?.profile) {
      entities = await this.findEntities(ctx, {
        query: {
          tenant: ctx.meta.profile,
          user: ctx.meta.user.id,
          endDate: { $exists: false },
        },
      });
    } else {
      entities = await this.findEntities(ctx, {
        query: {
          user: ctx.meta.user.id,
          tenant: { $exists: false },
          endDate: { $exists: false },
        },
      });
    }
    return entities[0];
  }
}
