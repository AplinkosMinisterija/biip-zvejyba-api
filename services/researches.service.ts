'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import PostgisMixin, { GeometryType } from 'moleculer-postgis';
import DbConnection, { PopulateHandlerFn } from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  FILE_TYPES,
  ResponseHeadersMeta,
  RestrictionType,
  Table,
} from '../types';

import ProfileMixin from '../mixins/profile.mixin';
import {
  allocateShoreCatch,
  BoatCatchRow,
  buildCatchSummaryWorkbook,
  CatchLocation,
  describeSummaryFilters,
  filterCatchEntries,
  ShoreCatchRow,
  summarizeCatch,
  SUMMARY_MAX_MONTH_SHEETS,
  summaryMonths,
  SummaryPeriod,
  toVilniusDate,
} from '../modules/catchSummary';
import { GeomFeatureCollection } from '../modules/geometry';
import { getFolderName } from '../utils';
import { UserAuthMeta } from './api.service';
import { FishingType } from './fishings.service';
import { ResearchFish } from './researches.fishes.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

const publicFields = [
  'id',
  'cadastralId',
  'waterBodyData',
  'geom',
  'startAt',
  'endAt',
  'predatoryFishesRelativeAbundance',
  'predatoryFishesRelativeBiomass',
  'averageWeight',
  'valuableFishesRelativeBiomass',
  'conditionIndex',
  'files',
  'previousResearchData',
  'fishes',
  'totalFishesAbundance',
  'totalBiomass',
];

// Caught-on day as the fisher lives it; FE sends Vilnius day bounds.
const SHORE_CATCH_DAY_SQL = `(COALESCE(we.date, we.created_at) AT TIME ZONE 'Europe/Vilnius')::date`;

type CatchSummaryParams = {
  dateFrom?: string;
  dateTo?: string;
  types?: FishingType[];
  locationId?: string;
  locationName?: string;
  fishTypes?: string[];
  toolTypes?: string[];
  byMonths?: boolean;
  byToolTypes?: boolean;
};

interface Fields extends CommonFields {
  id: number;
  cadastralId: string;
  waterBodyData: { name: string; municipality?: string; area: number };
  startAt: Date;
  endAt: Date;
  predatoryFishesRelativeAbundance: number;
  predatoryFishesRelativeBiomass: number;
  averageWeight: number;
  valuableFishesRelativeBiomass: number;
  conditionIndex: number;
  files: Array<{
    url: string;
    name: string;
    size: number;
  }>;
  previousResearchData: {
    year: number;
    conditionIndex: number;
    totalAbundance: number;
    totalBiomass: number;
  };
  totalFishesAbundance?: number;
  totalBiomass?: number;
  fishes?: ResearchFish[];
  tenant: Tenant['id'];
  user: User['id'];
  previous?: Research;
}

interface Populates extends CommonPopulates {}

export type Research<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'researches',
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
      cadastralId: 'string',
      waterBodyData: {
        type: 'object',
        required: true,
        properties: {
          name: 'string|required',
          municipality: 'string',
          area: 'number|required',
        },
      },
      geom: {
        type: 'any',
        geom: {
          types: [GeometryType.POINT],
        },
      },
      startAt: {
        type: 'date',
        columnType: 'datetime',
        required: true,
      },
      endAt: {
        type: 'date',
        columnType: 'datetime',
        required: true,
      },
      predatoryFishesRelativeAbundance: 'number|required',
      predatoryFishesRelativeBiomass: 'number|required',
      totalFishesAbundance: 'number|optional',
      totalBiomass: 'number|optional',
      averageWeight: 'number|required',
      valuableFishesRelativeBiomass: 'number|required',
      conditionIndex: 'number|required',
      files: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: 'string|required',
            name: 'string',
            size: 'number',
          },
        },
        columnType: 'json',
      },
      previousResearchData: {
        type: 'object',
        properties: {
          year: 'number',
          conditionIndex: 'number',
          totalAbundance: 'number',
          totalBiomass: 'number',
        },
      },
      fishes: {
        virtual: true,
        type: 'array',
        populate: {
          keyField: 'id',
          handler: PopulateHandlerFn('researches.fishes.populateByProp'),
          params: {
            queryKey: 'research',
            mappingMulti: true,
            sort: 'createdAt',
            populate: 'fishType',
            fields: [
              'id',
              'abundance',
              'biomass',
              'abundancePercentage',
              'biomassPercentage',
              'fishType',
              'research',
            ],
          },
        },
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
    defaultPopulates: [],
  },
  actions: {
    create: {
      rest: null,
    },
    update: {
      rest: null,
    },
    find: {
      rest: null,
    },
    count: {
      rest: null,
    },
  },
  hooks: {
    before: {
      create: ['beforeCreate', 'handleMunicipality'],
      // The generic remove (and the rest:null update reachable via the
      // mappingPolicy fallback) had no scope — a USER could delete another
      // tenant's research by id. Pin both to the caller.
      update: ['beforeMutate'],
      remove: ['beforeMutate'],
      list: ['beforeSelect'],
      find: ['beforeSelect'],
      count: ['beforeSelect'],
      get: ['beforeSelect'],
      all: ['beforeSelect'],
    },
  },
})
export default class ResearchesService extends moleculer.Service {
  @Action({
    rest: <RestSchema>{
      method: 'POST',
      path: '/upload',
      type: 'multipart',
      busboyConfig: {
        limits: {
          files: 1,
          // 10 MB cap — research PDFs are usually a few hundred KB; this
          // bounds storage abuse via a single oversized upload (see
          // security audit #H4). Pair with the INVESTIGATOR auth below.
          fileSize: 10 * 1024 * 1024,
        },
      },
    },
    // Was implicitly DEFAULT (USER+ADMIN), which let any authenticated
    // mobile-app user POST arbitrary PDFs into MinIO. Research uploads
    // are only legitimate from biip-admin-web operating as an
    // INVESTIGATOR account.
    auth: RestrictionType.INVESTIGATOR,
  })
  async upload(ctx: Context<{}, UserAuthMeta>) {
    const folder = getFolderName(ctx.meta?.user, ctx.meta?.profile);

    return ctx.call('minio.uploadFile', {
      payload: ctx.params,
      isPrivate: true,
      types: FILE_TYPES,
      folder,
    });
  }

  @Action({
    rest: ['POST /', 'PATCH /:id'],
    auth: RestrictionType.INVESTIGATOR,
  })
  async createOrUpdate(ctx: Context<{ fishes: ResearchFish[]; id?: number }, UserAuthMeta>) {
    const { fishes, id } = ctx.params;

    const research: Research = await ctx.call(
      id ? 'researches.update' : 'researches.create',
      ctx.params,
    );

    await this.saveOrUpdateFishesForResearch(research.id, fishes);

    return ctx.call('researches.resolve', { id: research.id });
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/researches',
      path: '/:id/related',
    },
    auth: RestrictionType.PUBLIC,
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
  })
  async listRelated(ctx: Context<{ id: number; query: any; pageSize: number; page?: number }>) {
    const { id } = ctx.params;

    const research: Research = await ctx.call('researches.resolve', { id });
    if (!research.cadastralId) {
      return {
        rows: [],
        total: 0,
        page: ctx.params?.page || 1,
        pageSize: ctx.params?.pageSize || 10,
        totalPages: 1,
      };
    }

    // Pin `fields` to the public allowlist and ignore any caller-supplied
    // `fields`/`populate`/`scope` — otherwise a public caller can
    // `?fields=user,tenant&populate=user` to dereference the investigator's
    // PII. The sibling `listPublic`/`getPublic` already pin `publicFields`.
    return ctx.call('researches.list', {
      fields: publicFields,
      page: ctx.params?.page || 1,
      pageSize: ctx.params?.pageSize || 10,
      query: {
        cadastralId: research.cadastralId,
        id: { $ne: research.id },
      },
    });
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/researches',
      path: '/',
    },
    auth: RestrictionType.PUBLIC,
  })
  async listPublic(ctx: Context) {
    const researchesById: { [key: string]: Research[] } = await ctx.call('researches.find', {
      mapping: 'cadastralId',
      mappingMulti: true,
      populate: 'fishes',
      fields: publicFields,
      sort: '-startAt',
    });

    const researches: Research[] = [];

    Object.entries(researchesById).forEach(([cadastralId, items]) => {
      if (cadastralId) {
        researches.push(items[0]);
      } else {
        researches.push(...items);
      }
    });

    return researches.sort((a, b) => a.waterBodyData.name.localeCompare(b.waterBodyData.name));
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/researches',
      path: '/:id',
    },
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
    auth: RestrictionType.PUBLIC,
  })
  async getPublic(ctx: Context<{ id: number }>) {
    const research: Research = await ctx.call('researches.resolve', {
      id: ctx.params.id,
      throwIfNotExist: true,
      populate: ['fishes'],
      fields: publicFields,
    });

    if (research.cadastralId) {
      research.previous = await ctx.call('researches.findOne', {
        query: {
          startAt: { $lt: research.startAt },
          cadastralId: research.cadastralId,
        },
        sort: '-startAt',
      });
    }

    return research;
  }

  @Method
  async saveOrUpdateFishesForResearch(id: number, fishes: ResearchFish[]) {
    const savedIds: number[] = [];
    for (const fish of fishes) {
      const researchFish: ResearchFish = await this.broker.call(
        'researches.fishes.createOrUpdate',
        {
          ...fish,
          research: id,
        },
      );

      savedIds.push(researchFish.id);
    }

    const allFishes: ResearchFish[] = await this.broker.call('researches.fishes.find', {
      query: {
        research: id,
      },
    });

    const deletingIds: number[] = allFishes
      .map((fish) => fish.id)
      .filter((id) => !savedIds.includes(id));

    deletingIds.map((id) => this.broker.call('researches.fishes.remove', { id }));
  }

  @Method
  async handleMunicipality(ctx: Context<{ geom?: GeomFeatureCollection; waterBodyData: any }>) {
    if (ctx.params.geom) {
      const municipality: { id: number; name: string } = await ctx.call(
        'locations.findMunicipality',
        {
          geom: ctx.params.geom,
        },
      );
      const waterBody = {
        ...ctx.params.waterBodyData,
        municipality: municipality.name,
      };
      ctx.params.waterBodyData = waterBody;
    }
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      path: '/catchSummary',
    },
    // Vienintelė vieta, kur mokslininkas mato ne savo duomenis: suvestinė
    // sąmoningai apeina ProfileMixin scope'ą ir sumuoja VISŲ įmonių sugavimus,
    // tad rolė čia yra visa apsauga. ADMIN taip pat praeina (api.service
    // `authorize` traktuoja administratorių kaip mokslininko supersetą).
    auth: RestrictionType.INVESTIGATOR,
    params: {
      dateFrom: 'string|optional',
      dateTo: 'string|optional',
      types: {
        type: 'array',
        items: { type: 'enum', values: Object.values(FishingType) },
        optional: true,
        convert: true,
      },
      locationId: 'string|optional',
      locationName: 'string|optional',
      // Priimam kaip string'us: FE siunčia tokius id, kokius pats gavo iš
      // `fishTypes` / `toolTypes`, o mes juos verčiam į etiketes
      // (žr. resolveSelectedLabels).
      fishTypes: {
        type: 'array',
        items: 'string',
        optional: true,
        convert: true,
      },
      toolTypes: {
        type: 'array',
        items: 'string',
        optional: true,
        convert: true,
      },
      byMonths: { type: 'boolean', optional: true, convert: true },
      byToolTypes: { type: 'boolean', optional: true, convert: true },
    },
  })
  async catchSummary(ctx: Context<CatchSummaryParams, ResponseHeadersMeta>) {
    const { types = [], locationId, locationName } = ctx.params;
    const period: SummaryPeriod = {
      from: this.parseSummaryDate(ctx.params.dateFrom, 'dateFrom'),
      to: this.parseSummaryDate(ctx.params.dateTo, 'dateTo'),
    };
    const location: CatchLocation | null =
      locationId && locationName ? { id: locationId, name: locationName } : null;

    const [labelById, fishTypes, toolTypes, shoreRows] = await Promise.all([
      this.fetchFishTypeLabels(ctx),
      this.resolveSelectedLabels(ctx, 'fishTypes', ctx.params.fishTypes),
      this.resolveSelectedLabels(ctx, 'toolTypes', ctx.params.toolTypes),
      this.fetchShoreCatchRows(ctx, period, types),
    ]);
    const boatRows = await this.fetchBoatCatchRows(
      ctx,
      shoreRows.map((row) => row.fishing_id),
    );

    const entries = filterCatchEntries(allocateShoreCatch(shoreRows, boatRows), {
      location,
      toolTypes,
    });
    const summary = summarizeCatch(entries, { labelById, selectedLabels: fishTypes });

    const months = ctx.params.byMonths
      ? summaryMonths(period, Array.from(summary.byMonth.keys()))
      : [];
    if (months.length > SUMMARY_MAX_MONTH_SHEETS) {
      throw new moleculer.Errors.ValidationError(
        `Period longer than ${SUMMARY_MAX_MONTH_SHEETS} months cannot be split by months`,
        'PERIOD_TOO_LONG',
      );
    }

    const workbook = buildCatchSummaryWorkbook(summary, {
      period,
      months,
      types,
      filterLine: describeSummaryFilters({ types, location, toolTypes, fishTypes }),
      showToolTypes: !!ctx.params.byToolTypes,
    });

    const buffer = await workbook.xlsx.writeBuffer();

    ctx.meta.$responseHeaders = {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="versliniai_sugavimai_suvestine.xlsx"',
    };

    return buffer;
  }

  // FE sends Vilnius start/end-of-day instants, direct callers bare dates —
  // both reduce to the Vilnius calendar day the SQL compares on.
  @Method
  parseSummaryDate(value: string | undefined, field: string): string | null {
    if (!value) return null;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new moleculer.Errors.ValidationError(`Invalid ${field}`);
    }

    return toVilniusDate(date);
  }

  // `weight_events.data` raktai yra tokie id, kokius atsiuntė klientas. Kad
  // suvestinė nepriklausytų nuo id transportavimo (`secure: true` šiandien yra
  // no-op — `encodeID` niekur neperrašytas, bet tai gali pasikeisti), visur
  // toliau lyginam pagal `label`. Etiketes imam raw SQL'u — žalius id.
  @Method
  async fetchFishTypeLabels(ctx: Context): Promise<Map<number, string>> {
    const rows: Array<{ id: number; label: string }> = await this.rawQuery(
      ctx,
      `SELECT id, label FROM fish_types WHERE deleted_at IS NULL`,
    );

    return new Map(rows.map((row) => [Number(row.id), row.label]));
  }

  // Filtro id verčiam į etiketes tuo pačiu keliu, kuriuo juos gavo FE
  // (`fishTypes.find` / `toolTypes.find`), tad sutapimas nepriklauso nuo id
  // kodavimo.
  @Method
  async resolveSelectedLabels(
    ctx: Context,
    service: 'fishTypes' | 'toolTypes',
    ids?: string[],
  ): Promise<Set<string> | null> {
    if (!ids?.length) return null;

    const all: Array<{ id: unknown; label: string }> = await ctx.call(`${service}.find`, {
      fields: ['id', 'label'],
    });

    const labelById = new Map(all.map((item) => [String(item.id), item.label]));
    const selected = ids
      .map((id) => labelById.get(String(id)))
      .filter((label): label is string => !!label);

    // Filtras pritaikytas, bet nė vienas id neatpažintas — grąžinam tuščią
    // aibę, kad suvestinė būtų tuščia, o ne begalinė (fail closed).
    return new Set(selected);
  }

  // Agregacijai naudojam raw SQL: moleculer DSL + secure id + ProfileMixin
  // scope'ai tokiuose skaičiavimuose sluoksniuojasi taip, kad rezultato realiai
  // neįmanoma peržiūrėti (CLAUDE.md → „Virtual-field populate gotchas" 2 p.).
  // Imam tik krantinius svėrimus (`tools_group_id IS NULL`) — tai oficialus
  // tiksliai pasvertas kiekis, kurį raportuoja ir etaloninė AAD lentelė.
  @Method
  async fetchShoreCatchRows(
    ctx: Context,
    period: SummaryPeriod,
    types: FishingType[],
  ): Promise<ShoreCatchRow[]> {
    const conditions = [
      'we.deleted_at IS NULL',
      'we.tools_group_id IS NULL',
      'f.deleted_at IS NULL',
    ];
    const bindings: unknown[] = [];

    if (types.length) {
      conditions.push('f.type = ANY(?)');
      bindings.push(types);
    }

    if (period.from) {
      conditions.push(`${SHORE_CATCH_DAY_SQL} >= ?::date`);
      bindings.push(period.from);
    }

    if (period.to) {
      conditions.push(`${SHORE_CATCH_DAY_SQL} <= ?::date`);
      bindings.push(period.to);
    }

    return this.rawQuery(
      ctx,
      `SELECT we.fishing_id,
              f.type AS fishing_type,
              t.name AS tenant_name,
              u.first_name AS first_name,
              u.last_name AS last_name,
              to_char(${SHORE_CATCH_DAY_SQL}, 'YYYY-MM') AS month,
              we.data AS data
         FROM weight_events we
         JOIN fishings f ON f.id = we.fishing_id
         LEFT JOIN tenants t ON t.id = we.tenant_id AND t.deleted_at IS NULL
         LEFT JOIN users u ON u.id = we.user_id
        WHERE ${conditions.join(' AND ')}`,
      bindings,
    );
  }

  // Boat weigh-ins are the only rows that know the gear and the bar. A tools
  // group holds a single tool type (`connectTools` rejects mixing), and it sits
  // where it was built — the same bar `toolsGroupsByLocation` lists it under.
  // Not filtered by date: a trip's boat weigh-ins size its landing whenever
  // they happened.
  @Method
  async fetchBoatCatchRows(ctx: Context, fishingIds: number[]): Promise<BoatCatchRow[]> {
    if (!fishingIds.length) return [];

    return this.rawQuery(
      ctx,
      `SELECT we.fishing_id,
              tool_type.label AS tool_type,
              COALESCE(be.location, we.location)->>'id' AS location_id,
              COALESCE(be.location, we.location)->>'name' AS location_name,
              we.data AS data
         FROM weight_events we
         JOIN tools_groups tg ON tg.id = we.tools_group_id
         LEFT JOIN tools_groups_events be
           ON be.id = tg.build_event_id AND be.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT tt.label
             FROM tools t
             JOIN tool_types tt ON tt.id = t.tool_type_id
            WHERE t.id = ANY(tg.tools)
            ORDER BY t.id
            LIMIT 1
         ) tool_type ON TRUE
        WHERE we.deleted_at IS NULL
          AND we.fishing_id = ANY(?)`,
      [Array.from(new Set(fishingIds))],
    );
  }
}
