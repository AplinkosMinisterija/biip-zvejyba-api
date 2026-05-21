'use strict';

import ExcelJS from 'exceljs';
import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import PostgisMixin from 'moleculer-postgis';
import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  ResponseHeadersMeta,
  RestrictionType,
  Table,
} from '../types';

import ProfileMixin from '../mixins/profile.mixin';
import { coordinatesToGeometry, geomToWgs } from '../modules/geometry';
import { UserAuthMeta } from './api.service';
import { FishingEvent, FishingEventType } from './fishingEvents.service';
import { FishType } from './fishTypes.service';
import { Coordinates, CoordinatesProp, Location } from './location.service';
import { Polder } from './polders.service';
import { Tenant } from './tenants.service';
import { Tool } from './tools.service';
import { ToolsGroup } from './toolsGroups.service';
import { User } from './users.service';
import { GetFishByFishingResponse, WeightEvent } from './weightEvents.service';

const Cron = require('@r2d2bzh/moleculer-cron');

export enum FishingType {
  ESTUARY = 'ESTUARY',
  POLDERS = 'POLDERS',
  INLAND_WATERS = 'INLAND_WATERS',
}

enum EventType {
  START = 'START',
  END = 'END',
  SKIP = 'SKIP',
  WEIGHT_ON_SHORE = 'WEIGHT_ON_SHORE',
  WEIGHT_ON_BOAT = 'WEIGHT_ON_BOAT',
  BUILD_TOOLS = 'BUILD_TOOLS',
  REMOVE_TOOLS = 'REMOVE_TOOLS',
}

type Event = {
  id: number;
  type: EventType;
  date: Date;
  geom: any;
  coordinates?: { lat: number; lng: number } | null;
  location?: any;
  locationManual?: boolean;
  data?: any;
};

interface Fields extends CommonFields {
  id: number;
  startEvent: FishingEvent['id'];
  endEvent: FishingEvent['id'];
  skipEvent: FishingEvent['id'];
  geom: any;
  uetkCadastralId?: string;
  polderId?: Polder['id'];
  type: FishingType;
  tenant: Tenant['id'];
  user: User['id'];
  weightEvents: any;
  hasManualLocation: boolean;
}

interface Populates extends CommonPopulates {
  startEvent: FishingEvent;
  endEvent: FishingEvent;
  skipEvent: FishingEvent;
  weightEvents: GetFishByFishingResponse;
  tenant: Tenant;
}

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
    Cron,
  ],
  crons: [
    {
      name: 'endFishings',
      cronTime: '0 0 * * *',
      timeZone: 'Europe/Vilnius',

      async onTick() {
        await this.call('fishings.endFishings');
      },
    },
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
      uetkCadastralId: 'string',
      polderId: {
        type: 'number',
        columnType: 'integer',
        columnName: 'polderId',
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
      weightEvents: {
        type: 'array',
        readonly: true,
        virtual: true,
        async populate(ctx: any, _values: any, fishings: Fishing[]) {
          return Promise.all(
            fishings.map((fishing: any) => {
              return ctx.call('weightEvents.getFishByFishing', { fishingId: fishing.id });
            }),
          );
        },
      },
      hasManualLocation: {
        type: 'boolean',
        readonly: true,
        virtual: true,
        async populate(ctx: any, _values: any, fishings: Fishing[]) {
          // True if at least one event of this fishing (toolsGroup or
          // weight) had location_manual=true. Admin uses this to render
          // the warning icon on the journal row (Kuršių marios fishings).
          //
          // Delegate to a dedicated action so we can debug via REPL
          // (`mol $ call fishings.getManualLocationFlags --fishingIds 321`)
          // — the previous moleculer-db `find` + `fields: ['fishing']`
          // approach silently dropped the FK because of `secure: true` ID
          // encoding (see CLAUDE.md → "Virtual-field populate gotchas").
          if (!fishings.length) return [];
          const ids = fishings.map((f) => Number(f.id)).filter(Number.isFinite);
          if (!ids.length) return fishings.map(() => false);
          const flagged: number[] = await ctx.call('fishings.getManualLocationFlags', {
            fishingIds: ids,
          });
          const flaggedSet = new Set(flagged.map(Number));
          return fishings.map((f) => flaggedSet.has(Number(f.id)));
        },
      },
      location: {
        type: 'array',
        readonly: true,
        virtual: true,
        async populate(ctx: any, _values: any, fishings: Fishing[]) {
          const cadastralIds = fishings
            .filter((fishing) => !!fishing.uetkCadastralId)
            .map((fishing: any) => fishing.uetkCadastralId);
          const locations = cadastralIds.length
            ? await ctx.call('locations.uetkSearchByCadastralId', {
                cadastralId: cadastralIds,
              })
            : [];

          const polderIds = Array.from(
            new Set(
              fishings
                .filter((fishing) => !!fishing.polderId)
                .map((fishing: any) => fishing.polderId),
            ),
          );
          const polders: Polder[] = polderIds.length
            ? await ctx.call('polders.find', { query: { id: { $in: polderIds } } })
            : [];
          const polderById = polders.reduce<Record<number, Polder>>((acc, p) => {
            acc[p.id] = p;
            return acc;
          }, {});

          return fishings.map((fishing: any) => {
            if (fishing.polderId) {
              const polder = polderById[fishing.polderId];
              if (!polder) return undefined;
              return {
                id: polder.id,
                name: polder.name,
                type: 'POLDERS',
                area: polder.area,
              };
            }
            return locations.find((location: any) => location.id === fishing.uetkCadastralId);
          });
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
    remove: {
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
      currentFishing: ['beforeSelect'],
      list: ['beforeSelect'],
      find: ['beforeSelect'],
      count: ['beforeSelect'],
      get: ['beforeSelect'],
      all: ['beforeSelect'],
    },
  },
})
export default class FishTypesService extends moleculer.Service {
  @Action()
  async endFishings(ctx: Context) {
    const fishings: Fishing[] = await ctx.call('fishings.find', {
      query: { endEvent: { $exists: false } },
    });

    const result = [];

    for (const fishing of fishings) {
      // Sistema (cron) — ne pats vartotojas — uždaro žvejybą. user_id
      // ir created_by lieka NULL: audit trail neigia neegzistuojantį
      // „vartotojas baigė 23:59:59" veiksmą; populate'as parodys
      // Sistema actor'ą. tenant'as išlaikomas, kad event'as liktų to
      // paties tenant'o scope'e.
      const endEvent: FishingEvent = await ctx.call('fishingEvents.create', {
        geom: fishing.geom,
        type: FishingEventType.END,
        tenant: fishing.tenant ?? null,
        user: null,
      });

      const updatedFishing = await ctx.call('fishings.update', {
        id: fishing.id,
        endEvent: endEvent.id,
      });

      result.push(updatedFishing);
    }

    return result;
  }

  @Action({
    rest: 'POST /start',
    auth: RestrictionType.USER,
    params: {
      type: 'string',
      coordinates: CoordinatesProp,
      uetkCadastralId: 'string|optional',
      polderId: 'number|integer|positive|optional|convert',
    },
  })
  async startFishing(
    ctx: Context<
      {
        type: FishingType;
        coordinates: { x: number; y: number };
        uetkCadastralId?: string;
        polderId?: number;
      },
      UserAuthMeta
    >,
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

    // If polderId is supplied, verify the polder exists; we do not force
    // POLDERS fishings to carry a polderId so older clients keep working.
    if (ctx.params.polderId) {
      const polder: Polder = await ctx.call('polders.get', { id: ctx.params.polderId });
      if (!polder) {
        throw new moleculer.Errors.ValidationError('Polder not found');
      }
    }

    const geom = coordinatesToGeometry(ctx.params.coordinates);
    const startEvent: FishingEvent = await ctx.call('fishingEvents.create', {
      geom,
      type: FishingEventType.START,
    });

    if (ctx.params.type === FishingType.ESTUARY) {
      ctx.params.uetkCadastralId = '00070001'; // Kuršių marios
    }

    return this.createEntity(ctx, { ...ctx.params, startEvent: startEvent.id });
  }

  @Action({
    rest: 'POST /skip',
    auth: RestrictionType.USER,
    params: {
      type: 'string',
      coordinates: CoordinatesProp,
      note: 'string',
      polderId: 'number|integer|positive|optional|convert',
    },
  })
  async skipFishing(ctx: Context<any>) {
    //To skip fishing, create new fishing and mark it as skipped.
    const geom = coordinatesToGeometry(ctx.params.coordinates);
    const skipEvent: FishingEvent = await ctx.call('fishingEvents.create', {
      geom,
      type: FishingEventType.SKIP,
      data: { note: ctx.params.note },
    });
    return this.createEntity(ctx, { ...ctx.params, skipEvent: skipEvent.id });
  }

  @Action({
    rest: 'POST /end',
    auth: RestrictionType.USER,
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
    const finalFishEvent = fishWeightEvents.find((fishEvent) => !fishEvent.toolsGroup);
    const hasPreliminaryFish = fishWeightEvents.some(
      (fishEvent) =>
        !!fishEvent.toolsGroup &&
        !!fishEvent.data &&
        Object.values(fishEvent.data).some((amount) => Number(amount) > 0),
    );

    if (hasPreliminaryFish && !finalFishEvent) {
      throw new moleculer.Errors.ValidationError('Fish must be weighted');
    }

    // Field report: angler builds nets, hits "Patikrinta" on each without
    // recording fish, then ends fishing — no catch ever logged. The
    // `assertSiblingsHaveFishLogged` guard on `removeTools` only catches
    // the per-bar / per-type return path; nothing stopped the end-fishing
    // shortcut. Mirror the same logic across the whole fishing here.
    await this.assertEveryToolTypeHasFishLogged(ctx, current, fishWeightEvents);

    const geom = coordinatesToGeometry(ctx.params.coordinates);
    const endEvent: FishingEvent = await ctx.call('fishingEvents.create', {
      geom,
      type: FishingEventType.END,
    });
    return this.updateEntity(ctx, { id: current.id, endEvent: endEvent.id });
  }

  // Refuse end-of-fishing when any tool type in the current fishing has a
  // weight event recorded but no fish payload anywhere across siblings of
  // that type — the "Patikrinta" shortcut otherwise lets the user wipe an
  // empty catch from the journal silently. Same shape as
  // `toolsGroups.assertSiblingsHaveFishLogged`, just scoped per type
  // across the whole fishing instead of the per-bar last-unchecked case.
  @Method
  async assertEveryToolTypeHasFishLogged(
    ctx: Context,
    fishing: Fishing,
    fishWeightEvents: WeightEvent[],
  ) {
    const activeGroups: ToolsGroup<'tools' | 'buildEvent'>[] = await ctx.call(
      'toolsGroups.find',
      {
        query: { removeEvent: { $exists: false } },
        populate: ['tools', 'buildEvent'],
      },
    );
    const inFishing = activeGroups.filter(
      (g) => g.buildEvent?.fishing?.id === fishing.id,
    );
    if (!inFishing.length) return;

    type TypeBucket = { hasChecked: boolean; hasFish: boolean };
    const byType = new Map<number, TypeBucket>();

    for (const g of inFishing) {
      const tt = (g.tools as Tool<'toolType'>[] | undefined)?.[0]?.toolType?.id;
      if (tt == null) continue;
      if (!byType.has(tt)) byType.set(tt, { hasChecked: false, hasFish: false });
    }

    for (const w of fishWeightEvents) {
      if (w.toolsGroup == null) continue; // shore weigh row, not per-tool
      const grp = inFishing.find((g) => g.id === w.toolsGroup);
      if (!grp) continue;
      const tt = (grp.tools as Tool<'toolType'>[] | undefined)?.[0]?.toolType?.id;
      if (tt == null) continue;
      const bucket = byType.get(tt) ?? { hasChecked: false, hasFish: false };
      bucket.hasChecked = true;
      if (w.data && Object.keys(w.data).length > 0) bucket.hasFish = true;
      byType.set(tt, bucket);
    }

    const offending = Array.from(byType.values()).some(
      (s) => s.hasChecked && !s.hasFish,
    );
    if (offending) {
      throw new moleculer.Errors.ValidationError(
        'Negalima baigti žvejybos: yra įrankių, pažymėtų kaip patikrinti, bet žuvies svoris dar neįrašytas. Pirmiausia įrašykite žuvis arba grąžinkite įrankius į sandėlį.',
      );
    }
  }

  // Lightweight read-only twin of the `endFishing` validations so the
  // mobile UI can keep the "Baigti žvejybą" button visible but disabled
  // (with a reason) instead of letting the user submit just to see a
  // server-side error toast.
  @Action({
    rest: 'GET /canFinish',
    auth: RestrictionType.USER,
  })
  async canFinish(
    ctx: Context<any, UserAuthMeta>,
  ): Promise<{ canFinish: boolean; reason?: string }> {
    const current: Fishing = await ctx.call('fishings.currentFishing');
    if (!current) return { canFinish: false, reason: 'Žvejyba neprasidėjusi' };

    const fishWeightEvents: WeightEvent[] = await ctx.call('weightEvents.find', {
      query: { fishing: current.id },
    });

    const finalFishEvent = fishWeightEvents.find((w) => !w.toolsGroup);
    const hasPreliminaryFish = fishWeightEvents.some(
      (w) =>
        !!w.toolsGroup &&
        !!w.data &&
        Object.values(w.data).some((amount) => Number(amount) > 0),
    );
    if (hasPreliminaryFish && !finalFishEvent) {
      return {
        canFinish: false,
        reason:
          'Trūksta žuvies iškrovimo: yra įrašytų preliminarių svorių, bet svėrimas krante dar neatliktas.',
      };
    }

    try {
      await this.assertEveryToolTypeHasFishLogged(ctx, current, fishWeightEvents);
    } catch (e: any) {
      return { canFinish: false, reason: e?.message };
    }

    return { canFinish: true };
  }

  @Action({
    rest: 'GET /current',
    auth: RestrictionType.USER,
  })
  async currentFishing(ctx: Context<any, UserAuthMeta>) {
    const userQuery = ctx.meta?.user?.id ? { user: ctx.meta.user.id } : {};
    return await ctx.call('fishings.findOne', {
      query: {
        ...ctx.params.query,
        ...userQuery,
        startEvent: { $exists: true },
        endEvent: { $exists: false },
      },
      populate: ['location', ...(ctx?.params?.populate || [])],
    });
  }

  @Action({
    rest: 'GET /weights',
    params: {
      toolsGroup: 'number|convert|optional',
    },
    auth: RestrictionType.USER,
  })
  async getPreliminaryFishWeight(ctx: Context<{ toolsGroup?: number }>) {
    const { toolsGroup } = ctx.params;
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }

    const weightEventsQuery: any = { fishing: currentFishing.id };

    if (toolsGroup) weightEventsQuery.toolsGroup = toolsGroup;

    const weightEvents: WeightEvent[] = await ctx.call('weightEvents.find', {
      query: weightEventsQuery,
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
    auth: RestrictionType.USER,
    params: {
      coordinates: CoordinatesProp,
      locationManual: { type: 'boolean', optional: true, convert: true },
      data: 'object',
      preliminaryData: 'object',
    },
  })
  async weighFish(
    ctx: Context<
      {
        coordinates: Coordinates;
        location: Location;
        locationManual?: boolean;
        data: { [key: FishType['id']]: number };
        preliminaryData: { [key: FishType['id']]: number };
      },
      UserAuthMeta
    >,
  ) {
    const { data, preliminaryData } = ctx.params;

    // Every fish the fisher registered on the boat (preliminary) must
    // also appear in the onshore payload — the value can be 0 kg (if all
    // were released back to the water), but the key has to be present.
    // Prevents accidentally dropping e.g. undersized fish from the final
    // catch report.
    const missingKeys: FishType['id'][] = [];
    for (const key in preliminaryData) {
      const finalValue = data[key];
      if (finalValue === undefined || finalValue === null) {
        missingKeys.push(key as any);
      }
    }
    if (missingKeys.length > 0) {
      throw new moleculer.Errors.ValidationError(
        'Missing onshore weight for fish caught on boat',
        'MISSING_ONSHORE_WEIGHT',
        { missingFishTypeIds: missingKeys },
      );
    }

    const invalidKeys: FishType['id'][] = [];

    for (const key in data) {
      const finalValue = data[key];
      const preliminaryValue = preliminaryData[key];

      if (preliminaryValue === undefined || preliminaryValue === 0) continue;

      const error = Math.abs(finalValue - preliminaryValue) / preliminaryValue;

      if (error > 0.2) {
        invalidKeys.push(key as any);
      }
    }

    if (invalidKeys.length > 0) {
      throw new moleculer.Errors.ValidationError('Weight difference greater than 20%');
    }

    await ctx.call('weightEvents.createWeightEvent', {
      coordinates: ctx.params.coordinates,
      location: ctx.params.location,
      locationManual: !!ctx.params.locationManual,
      data,
    });

    return { success: true };
  }

  // Internal helper for the `hasManualLocation` virtual field on Fishing.
  // Returns the subset of `fishingIds` that have at least one event with
  // `location_manual = true`. Raw SQL avoids the moleculer-db DSL + secure
  // ID + ProfileMixin scope layering that silently miscounted the first
  // version of this aggregation (see CLAUDE.md → "Virtual-field populate
  // gotchas"). No `rest` — internal-only.
  @Action({
    params: {
      fishingIds: { type: 'array', items: 'number|convert', min: 1 },
    },
  })
  async getManualLocationFlags(ctx: Context<{ fishingIds: number[] }>): Promise<number[]> {
    const ids = (ctx.params.fishingIds || []).map(Number).filter(Number.isFinite);
    if (!ids.length) return [];
    const rows: Array<{ fishing_id: number }> = await this.rawQuery(
      ctx,
      `SELECT DISTINCT fishing_id FROM tools_groups_events
         WHERE fishing_id = ANY(?) AND location_manual = TRUE AND deleted_at IS NULL
       UNION
       SELECT DISTINCT fishing_id FROM weight_events
         WHERE fishing_id = ANY(?) AND location_manual = TRUE AND deleted_at IS NULL`,
      [ids, ids],
    );
    return rows.map((r) => Number(r.fishing_id)).filter(Number.isFinite);
  }

  @Action({
    rest: 'GET /exportCaughtFishes',
  })
  async exportCaughtFishes(ctx: Context<any, ResponseHeadersMeta>) {
    ctx.params.query = JSON.parse(ctx?.params?.query || {});

    const fishings: Fishing<'weightEvents' | 'tenant'>[] = await ctx.call('fishings.find', {
      query: ctx?.params?.query,
      populate: 'weightEvents,tenant',
      sort: 'id',
    });

    const fishTypes: FishType[] = await ctx.call('fishTypes.find');

    const fishTypesMap = new Map(fishTypes.map((fish) => [fish.id, fish]));

    const workbook = new ExcelJS.Workbook();
    const caughtFishesSheet = workbook.addWorksheet('Sugautos žuvys');

    caughtFishesSheet.views = [{ state: 'frozen', ySplit: 1 }];

    caughtFishesSheet.getRow(1).values = [
      'Eil. Nr.',
      'Žuvų rūšis',
      'Vandens telkiniai (viename išplaukime/žvejyboje)',
      'Žvejybos įrankiai (viename išplaukime/žvejyboje)',
      'Tikslus svoris, kg',
      'Žuvų iškrovimo data',
      'Įmonė/Fizinis asmuo',
    ];

    caughtFishesSheet.getRow(1).eachCell((c) => (c.font = { bold: true }));

    let rowIndex = 2;

    for (const currentFishing of fishings) {
      const weightEvents = currentFishing?.weightEvents;

      const fishOnShore = weightEvents?.fishOnShore;
      const fishOnBoat = weightEvents?.fishOnBoat;

      if (!fishOnShore || !fishOnBoat) {
        continue;
      }

      const info: Record<
        string,
        {
          fish: string;
          locations: string[];
          tools: string[];
        }
      > = {};

      Object.values(fishOnBoat).forEach((toolGroup) => {
        const fishIds = Object.keys(toolGroup.data).map(Number);

        const location = toolGroup.location.name;
        const tool = toolGroup.toolsGroup.tools[0].toolType.label;

        fishIds.forEach((id) => {
          const fish = fishTypesMap.get(id as any)?.label;

          if (!info[id]) {
            info[id] = {
              fish: fish ?? '',
              locations: [],
              tools: [],
            };
          }

          if (!info[id].locations.includes(location)) {
            info[id].locations.push(location);
          }

          if (!info[id].tools.includes(tool)) {
            info[id].tools.push(tool);
          }
        });
      });

      const fishData = fishOnShore.data;
      const fishIds = Object.keys(fishData);

      fishIds.forEach((key) => {
        caughtFishesSheet.getRow(rowIndex).values = [
          rowIndex - 1,
          info[key]?.fish ?? '',
          info[key]?.locations.join(', ') ?? '',
          info[key]?.tools.join(', ') ?? '',
          fishData[key],
          fishOnShore.createdAt,
          currentFishing?.tenant
            ? currentFishing.tenant.name
            : `${fishOnShore.createdBy.firstName} ${fishOnShore.createdBy.lastName}`,
        ];

        rowIndex++;
      });
    }

    caughtFishesSheet.columns = [
      { width: 8 },
      { width: 28 },
      { width: 48 },
      { width: 48 },
      { width: 28 },
      { width: 28 },
      { width: 28 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();

    ctx.meta.$responseHeaders = {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="mp_vienetai.xlsx"',
    };

    return buffer;
  }

  @Action({
    rest: 'GET /history/:id',
    params: {
      id: 'number|convert',
    },
  })
  async getHistory(
    ctx: Context<
      {
        id: number;
      },
      UserAuthMeta
    >,
  ) {
    const events: Event[] = [];
    const fishing: any = await ctx.call('fishings.get', {
      id: ctx.params.id,
      populate: ['startEvent', 'skipEvent', 'endEvent', 'user', 'tenant'],
    });

    if (fishing?.skipEvent) {
      events.push({
        id: fishing.skipEvent.id,
        type: EventType.SKIP,
        geom: fishing.skipEvent.geom,
        date: fishing.skipEvent.createdAt,
        data: fishing.skipEvent.data,
      });
    }
    if (fishing?.startEvent) {
      events.push({
        id: fishing.startEvent.id,
        type: EventType.START,
        geom: fishing.startEvent.geom,
        date: fishing.startEvent.createdAt,
      });
    }
    if (fishing?.endEvent) {
      events.push({
        id: fishing.endEvent.id,
        type: EventType.END,
        geom: fishing.endEvent.geom,
        date: fishing.endEvent.createdAt,
      });
    }

    const toolsGroupsEvents: any[] = await ctx.call('toolsGroupsEvents.find', {
      query: { fishing: ctx.params.id },
      populate: ['toolsGroup', 'geom'],
    });
    for (const t of toolsGroupsEvents.filter((e) => !!e.toolsGroup)) {
      const coordinates = geomToWgs(t.geom);
      events.push({
        id: t.id,
        type: t.type as EventType,
        geom: t.geom,
        coordinates,
        location: t.location,
        locationManual: !!t.locationManual,
        date: t.createdAt,
        data: t.toolsGroup,
      });
    }

    const fishingWeights: { fishOnShore: WeightEvent; fishOnBoat: WeightEvent[] } = await ctx.call(
      'weightEvents.getFishByFishing',
      {
        fishingId: ctx.params.id,
      },
    );

    for (const w of Object.values(fishingWeights.fishOnBoat || {}) as WeightEvent[]) {
      const coordinates = geomToWgs(w.geom);

      events.push({
        id: w.id,
        type: EventType.WEIGHT_ON_BOAT,
        geom: w.geom,
        coordinates,
        location: w.location,
        locationManual: !!w.locationManual,
        date: w.createdAt,
        data: { fish: w.data, toolsGroup: w.toolsGroup },
      });
    }
    if (fishingWeights.fishOnShore) {
      const coordinates = geomToWgs(fishingWeights.fishOnShore.geom);
      events.push({
        id: fishingWeights.fishOnShore.id,
        type: EventType.WEIGHT_ON_SHORE,
        geom: fishingWeights.fishOnShore.geom,
        coordinates,
        locationManual: !!fishingWeights.fishOnShore.locationManual,
        date: fishingWeights.fishOnShore.createdAt,
        data: fishingWeights.fishOnShore.data,
      });
    }

    return {
      id: fishing.id,
      type: fishing.type,
      tenant: fishing.tenant,
      user: fishing.user,
      history: events.sort((a, b) => a.date.getTime() - b.date.getTime()),
    };
  }
}
