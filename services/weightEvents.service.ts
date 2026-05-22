'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
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
  FieldHookCallback,
  RestrictionType,
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
  locationManual: boolean;
  fishing: Fishing['id'];
  toolsGroup: ToolsGroup['id'];
  tenant: Tenant['id'];
  user: User['id'];
}

export interface GetFishByFishingResponse {
  fishOnShore: WeightEvent<'toolsGroup' | 'createdBy' | 'tenant'> | null;
  fishOnBoat: Record<number, WeightEvent<'toolsGroup'>>;
}

interface Populates extends CommonPopulates {
  toolType: ToolType;
  toolsGroup: ToolsGroup<'buildEvent' | 'tools'>;
  fishing: Fishing;
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
      geojson: { maxDecimalDigits: 2 },
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
      data: {
        type: 'object',
        set: ({ value }: FieldHookCallback) => {
          const numericData: { [key: string]: number } = {};
          for (const i in value) {
            numericData[i] = Number(value[i]);
          }
          return numericData;
        },
      },
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
      locationManual: {
        type: 'boolean',
        default: false,
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
    defaultPopulates: ['toolsGroup', 'geom'],
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
      populate: ['toolsGroup', 'geom', 'tenant', 'createdBy'],
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
      { fishOnShore: null, fishOnBoat: null },
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
      locationManual: { type: 'boolean', optional: true, convert: true },
      data: 'object',
    },
  })
  async createWeightEvent(
    ctx: Context<{
      toolsGroup: number;
      coordinates: Coordinates;
      data: { [key: FishType['id']]: number };
      location?: Location;
      locationManual?: boolean;
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

    //toolsGroup validation
    if (ctx.params.id) {
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

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public',
      path: '/statistics',
    },
    auth: RestrictionType.PUBLIC,
  })
  async getStatistics(ctx: Context<any>) {
    const data = await this.rawQuery(
      ctx,
      `SELECT SUM((fish_data.value)::numeric) AS total_weight, COUNT(DISTINCT fish_data.key) AS fish_types
        FROM weight_events, LATERAL jsonb_each_text(data) AS fish_data
        WHERE tools_group_id IS NULL;`,
    );

    const locationsCount: number = await ctx.call('toolsGroups.getUniqueToolsLocationsCount');

    return {
      totalWeight: Number(data[0]?.total_weight),
      totalFishTypes: Number(data[0]?.fish_types),
      totalLocations: locationsCount,
    };
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public',
      path: '/uetk/statistics',
    },
    params: {
      // Accept either an ISO date string OR an explicit {from, to} window —
      // never an arbitrary Mongo-style operator object. The previous
      // signature ran `JSON.parse(date)` on caller input and used the
      // result as `query.createdAt`, which let an unauthenticated caller
      // smuggle `{"$ne":null}` / `{"$gt":"…"}` and scrape the full
      // weight_events dataset by cadastralId. See /cso audit Finding #7.
      date: [
        {
          type: 'string',
          optional: true,
          // ISO-8601 prefix is enough — Postgres parses the rest.
          pattern: '^\\d{4}-\\d{2}-\\d{2}',
        },
        {
          type: 'object',
          optional: true,
          strict: 'remove',
          props: {
            from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}', optional: true },
            to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}', optional: true },
          },
        },
      ],
      fish: {
        type: 'number',
        convert: true,
        optional: true,
      },
    },
    auth: RestrictionType.PUBLIC,
  })
  async getStatisticsForUETK(
    ctx: Context<{ date: string | { from?: string; to?: string }; fish: number }>,
  ) {
    const { fish: fishId, date } = ctx.params;
    const query: any = {
      toolsGroup: { $exists: false },
    };

    if (typeof date === 'string') {
      query.createdAt = date;
    } else if (date && typeof date === 'object') {
      const range: Record<string, string> = {};
      if (date.from) range.$gte = date.from;
      if (date.to) range.$lte = date.to;
      if (Object.keys(range).length > 0) query.createdAt = range;
    }
    const events: WeightEvent<'fishing'>[] = await ctx.call('weightEvents.find', {
      query,
      populate: 'fishing',
    });

    const fishTypes: { [key: string]: FishType[] } = await ctx.call('fishTypes.find', {
      mapping: 'id',
      fields: ['id', 'label'],
    });

    return Object.entries(
      events.reduce((acc: any, event: any) => {
        const cadastralId = event.fishing.uetkCadastralId;
        if (!cadastralId) return acc;

        const byCadastralId = acc[cadastralId] || {};

        Object.entries(event?.data || {}).forEach(([key, value]) => {
          if (fishId && Number(key) !== fishId) return;

          byCadastralId[`${key}`] = byCadastralId[key] || { count: 0, fish: fishTypes[`${key}`] };
          byCadastralId[`${key}`].count += Number(value) || 0;
        });

        acc[cadastralId] = byCadastralId;
        return acc;
      }, {}),
    ).reduce((acc: any, [key, value]) => {
      const items = Object.values(value).filter((i) => i.count > 0);
      acc[key] = {
        byFishes: items,
        count: items.reduce((acc: number, i) => acc + i.count, 0),
      };
      return acc;
    }, {});
  }
}
