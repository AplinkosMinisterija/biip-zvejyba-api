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
        // Locked post-create — see security audit #H2.
        immutable: true,
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
        immutable: true,
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

    // The angler app scopes the catch to the active session. Admin / journal
    // views reach here through the toolsGroups `weightEvent` virtual populate
    // and have no current fishing — they must NOT be rejected with
    // "Fishing not started" (that 422'd the whole `toolsGroups/all` list in
    // the admin įrankiai page). Fall back to the tool group's own weight
    // history: a tools_group id is tied to a single fishing (returning a net
    // spawns a fresh group), so the latest weight event is unambiguous with
    // or without the fishing filter. `removeTools` still guards currentFishing
    // before calling, so its behaviour is unchanged.
    const query: { toolsGroup: number; fishing?: number } = {
      toolsGroup: ctx.params.toolsGroup,
    };
    if (currentFishing) {
      query.fishing = currentFishing.id;
    }

    // Go through the scoped `find` (ProfileMixin `beforeSelect`) rather than
    // the unscoped `findEntities`, so the action defends itself: it returns
    // only weight events the caller's tenant/user may see (admins bypass the
    // scope and see all) regardless of whether the caller pre-scoped the
    // toolsGroup id. Dropping the in-session `fishing` filter above otherwise
    // removed the only implicit tenant constraint (security audit follow-up).
    // `populate: []` keeps the previous raw shape (no defaultPopulates).
    const weights: WeightEvent[] = await ctx.call('weightEvents.find', {
      query,
      sort: '-createdAt',
      limit: 1,
      populate: [],
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
      // `deleted_at IS NULL` mirrors COMMON_SCOPES.notDeleted — without
      // it the public statistics aggregated soft-deleted rows, leaking
      // numbers from records the user (or admin) had explicitly removed
      // (audit security #M6).
      `SELECT SUM((fish_data.value)::numeric) AS total_weight, COUNT(DISTINCT fish_data.key) AS fish_types
        FROM weight_events, LATERAL jsonb_each_text(data) AS fish_data
        WHERE tools_group_id IS NULL AND deleted_at IS NULL;`,
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
      // Was `type: number, convert: true, optional: true`, which let
      // `?fish=foo` slip through as `NaN`; the handler condition
      // `if (fishId && Number(key) !== fishId)` then read `NaN` as
      // falsy and skipped the per-fish filter entirely — public
      // statistics callers got the full unfiltered dataset back. Pin
      // the param to a positive-integer regex so the gateway rejects
      // garbage before the handler runs (audit security #M16).
      fish: {
        type: 'string',
        optional: true,
        pattern: '^[1-9][0-9]*$',
      },
    },
    auth: RestrictionType.PUBLIC,
  })
  async getStatisticsForUETK(
    ctx: Context<{ date: string | { from?: string; to?: string }; fish?: string }>,
  ) {
    const { fish, date } = ctx.params;
    const fishId = fish ? Number(fish) : null;
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
