'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import PostgisMixin from 'moleculer-postgis';
import DbConnection from '../mixins/database.mixin';
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
import { FishType } from './fishTypes.service';
import { FishingEvent, FishingEventType } from './fishingEvents.service';
import { Coordinates, CoordinatesProp, Location } from './location.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';
import { WeightEvent } from './weightEvents.service';

export enum FishingType {
  ESTUARY = 'ESTUARY',
  POLDERS = 'POLDERS',
  INLAND_WATERS = 'INLAND_WATERS',
}

interface Fields extends CommonFields {
  id: number;
  startEvent: FishingEvent['id'];
  endEvent: FishingEvent['id'];
  skipDate: FishingEvent['id'];
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
      startEvent: {
        type: 'number',
        columnType: 'integer',
        columnName: 'startEventId',
        populate: {
          action: 'fishingEvents.resolve',
          params: {
            scope: false,
          },
        },
      },
      endEvent: {
        type: 'number',
        columnType: 'integer',
        columnName: 'endEventId',
        populate: {
          action: 'fishingEvents.resolve',
          params: {
            scope: false,
          },
        },
      },
      skipEvent: {
        type: 'number',
        columnType: 'integer',
        columnName: 'skipEventId',
        populate: {
          action: 'fishingEvents.resolve',
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
      weightEvent: {
        type: 'array',
        readonly: true,
        virtual: true,
        async populate(ctx: any, _values: any, fishings: Fishing[]) {
          return Promise.all(
            fishings.map((fishing: any) => {
              return ctx.call('weightsEvents.findOne', {
                query: {
                  fishing: fishing.id,
                  toolsGroup: { $exists: false },
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
      coordinates: CoordinatesProp,
    },
  })
  async startFishing(
    ctx: Context<{ type: FishingType; coordinates: { x: number; y: number } }, UserAuthMeta>,
  ) {
    //Single active fishing validation
    const current: Fishing = await ctx.call('fishings.currentFishing');
    if (current) {
      throw new moleculer.Errors.ValidationError('Fishing already started');
    }

    //Tenant tools validation. Tenant should have at least one tool.
    const toolsCount: number = await ctx.call('tools.count');
    if (toolsCount < 1) {
      throw new moleculer.Errors.ValidationError('No tools in storage');
    }
    const geom = coordinatesToGeometry(ctx.params.coordinates);
    const startEvent: FishingEvent = await ctx.call('fishingEvents.create', {
      geom,
      type: FishingEventType.START,
    });
    return this.createEntity(ctx, { ...ctx.params, startEvent: startEvent.id });
  }

  @Action({
    rest: 'POST /skip',
    params: {
      type: 'string',
      coordinates: CoordinatesProp,
    },
  })
  async skipFishing(ctx: Context<any>) {
    //To skip fishing, create new fishing and mark it as skipped.
    const geom = coordinatesToGeometry(ctx.params.coordinates);
    const skipEvent: FishingEvent = await ctx.call('fishingEvents.create', {
      geom,
      type: FishingEventType.SKIP,
    });
    return this.createEntity(ctx, { ...ctx.params, skipEvent: skipEvent.id });
  }

  @Action({
    rest: 'POST /end',
    params: {
      coordinates: CoordinatesProp,
    },
  })
  async endFishing(
    ctx: Context<{ type: FishingEventType; coordinates: Coordinates }, UserAuthMeta>,
  ) {
    //Single active fishing validation
    const current: Fishing = await ctx.call('fishings.currentFishing');
    if (!current) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }
    //validate if fishing has unweighted fish
    const fishWeightEvents: WeightEvent[] = await ctx.call('weightEvents.find', {
      query: {
        fishing: current.id,
      },
    });
    const finalFishEvent = fishWeightEvents.find((fishEvenet) => !fishEvenet.toolsGroup);

    if (fishWeightEvents.length > 0 && !finalFishEvent) {
      throw new moleculer.Errors.ValidationError('Fish must be weighted');
    }
    const geom = coordinatesToGeometry(ctx.params.coordinates);
    const endEvent: FishingEvent = await ctx.call('fishingEvents.create', {
      geom,
      type: FishingEventType.SKIP,
    });
    return this.updateEntity(ctx, { id: current.id, endEvent: endEvent.id });
  }

  @Action({
    rest: 'GET /current',
  })
  async currentFishing(ctx: Context<any, UserAuthMeta>) {
    //Users in the same tenant do not share fishing. Each person should start and finish his/her own fishing.
    return await ctx.call('fishings.findOne', {
      query: {
        startEvent: { $exists: true },
        endEvent: { $exists: false },
        skipEvent: { $exists: false },
      },
    });
  }

  @Action({
    rest: 'GET /weights',
  })
  async getPreliminaryFishWeight(ctx: Context) {
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }
    const weightEvents: WeightEvent[] = await ctx.call('weightEvents.find', {
      query: {
        fishing: currentFishing.id,
      },
      sort: '-createdAt',
    });
    const totalWeightEvent = weightEvents.find((e) => !e.toolsGroup);
    const toolsGroupsEvents = weightEvents.filter((e) => !!e.toolsGroup);

    const data = toolsGroupsEvents.reduce(
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
    return { total: totalWeightEvent?.data, preliminary: data.fishWeights };
  }

  @Action({
    rest: 'POST /weight',
    params: {
      coordinates: CoordinatesProp,
      data: 'object',
    },
  })
  async weighFish(
    ctx: Context<
      {
        coordinates: Coordinates;
        location: Location;
        data: { [key: FishType['id']]: number };
      },
      UserAuthMeta
    >,
  ) {
    await ctx.call('weightEvents.createWeightEvent', {
      coordinates: ctx.params.coordinates,
      location: ctx.params.location,
      data: ctx.params.data,
    });
    return { success: true };
  }
}
