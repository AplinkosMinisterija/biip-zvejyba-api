'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
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
import { FishType } from './fishTypes.service';
import { Fishing } from './fishings.service';
import { Coordinates, CoordinatesProp, Location, LocationProp } from './location.service';
import { Tenant } from './tenants.service';
import { ToolType } from './toolTypes.service';
import { ToolsGroup } from './toolsGroups.service';
import { User } from './users.service';

interface Fields extends CommonFields {
  id: number;
  data: any;
  date: string;
  geom: any;
  location: Location;
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

export type WeightEvent<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'weightEvents',
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
        ...LocationProp,
        required: false,
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
    defaultPopulates: ['toolType', 'geom'],
  },
  hooks: {
    before: {
      createWeightEvent: ['beforeCreate', 'beforeFishWeigh'],
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

  @Action({
    params: {
      fishingId: 'number|convert',
    },
  })
  async getFishByFishing(ctx: Context<{ fishingId: number }>) {
    const weights: WeightEvent<'toolsGroup'>[] = await ctx.call('weightEvents.find', {
      query: {
        fishing: ctx.params.fishingId,
      },
      sort: 'createdAt',
      populate: ['toolsGroup', 'geom'],
    });

    return weights?.reduce(
      (acc: any, val: WeightEvent<'toolsGroup'>) => {
        if (!val.toolsGroup) {
          return {
            ...acc,
            fishOnShore: val,
          };
        }
        return {
          ...acc,
          fishOnBoat: {
            ...acc.fishOnBoat,
            [val.toolsGroup.id]: val,
          },
        };
      },
      { fishOnShore: null, fishOnBoat: {} },
    );
  }

  @Action({
    rest: 'POST /',
    params: {
      toolsGroup: 'number|convert|optional',
      coordinates: CoordinatesProp,
      location: {
        ...LocationProp,
        optional: true,
      },
      data: 'object',
    },
  })
  async createWeightEvent(
    ctx: Context<{
      toolsGroup: number;
      coordinates: Coordinates;
      data: { [key: FishType['id']]: number };
      location?: Location;
    }>,
  ) {
    return this.createEntity(ctx, { ...ctx.params });
  }

  @Method
  async beforeFishWeigh(ctx: Context<any>) {
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

    if (!ctx.params.id) {
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
    } else {
      //toolsGroup validation
      const group: ToolsGroup = await ctx.call('toolsGroups.get', {
        id: ctx.params.id,
      });
      if (!group) {
        throw new moleculer.Errors.ValidationError('Invalid group');
      }
    }
    ctx.params.fishing = currentFishing.id;
    const geom = coordinatesToGeometry(ctx.params.coordinates);
    ctx.params.geom = geom;
  }
}
