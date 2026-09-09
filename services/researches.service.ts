'use strict';

import ExcelJS from 'exceljs';
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

// Verslinių sugavimų suvestinės stulpeliai. Tvarka ir sudėtis pakartoja AAD
// rankomis pildytą etaloninę lentelę („Versliniai sugavimai … (Suvestinė)"),
// todėl sąmoningai NEGENERUOJAMA iš `fish_types`: adminui pridėjus rūšį
// stulpeliai pasislinktų ir suvestinė nustotų sutapti su istoriniais failais.
// `labels` — `fish_types.label` reikšmės, krentančios į tą patį stulpelį.
type SummaryColumn = { header: string; labels: string[] };

const SUMMARY_MAIN_COLUMNS: SummaryColumn[] = [
  { header: 'Karšis', labels: ['Karšis'] },
  // Etalone „Starkis", registre „Sterkas". Neverslinio dydžio sterkas
  // etalone atskiro stulpelio neturi, tad sumuojamas čia pat.
  { header: 'Starkis', labels: ['Sterkas', 'Sterkas (neverslinio dydžio)'] },
  { header: 'Kuoja', labels: ['Kuoja'] },
  { header: 'Lydeka', labels: ['Lydeka'] },
  { header: 'Ešerys', labels: ['Ešerys'] },
  { header: 'Ungurys', labels: ['Ungurys'] },
  { header: 'Karosas', labels: ['Karosas', 'Karosas, auksinis', 'Karosas, sidabrinis'] },
  { header: 'Vėgėlė', labels: ['Vėgėlė'] },
  { header: 'Stinta', labels: ['Stinta'] },
  { header: 'Lynas', labels: ['Lynas'] },
  { header: 'Nėgė', labels: ['Nėgė'] },
  { header: 'Žiobris', labels: ['Žiobris'] },
  { header: 'Plakis', labels: ['Plakis'] },
  { header: 'Salatis', labels: ['Salatis'] },
  { header: 'Šamas', labels: ['Šamas'] },
  { header: 'Ožka', labels: ['Ožka'] },
  { header: 'Karpis', labels: ['Karpis'] },
];

// „Kitos žuvys" detalizacija (etalono dešinysis blokas). Rūšis, nepatekusi nei
// čia, nei į pagrindinius stulpelius, sumuojama į paskutinį „Kitos" stulpelį.
const SUMMARY_OTHER_COLUMNS: SummaryColumn[] = [
  { header: 'Perpelė', labels: ['Perpelė'] },
  { header: 'Plačiakaktis', labels: ['Plačiakaktis'] },
  { header: 'Plekšnė', labels: ['Plekšnė'] },
  { header: 'Šapalas', labels: ['Šapalas'] },
  { header: 'Sykas', labels: ['Sykas'] },
  { header: 'Pūgžlys', labels: ['Pūgžlys'] },
  { header: 'Dyglė', labels: ['Dyglė'] },
  { header: 'Meknė', labels: ['Meknė'] },
  { header: 'Raudė', labels: ['Raudė'] },
  { header: 'Strimelė', labels: ['Strimelė'] },
  { header: 'Aukšlė', labels: ['Aukšlė'] },
  { header: 'Šlakis', labels: ['Šlakis'] },
  { header: 'Lašiša', labels: ['Lašiša'] },
];

// Etalone kiekviena zona turi savo bloką. `INLAND_WATERS` blokas pakeičia
// etalono „stintų / upinių nėgių migracijos metu" lenteles — migracijos
// laikotarpio duomenų modelyje neturim, tad rodom visą zoną be skaidymo.
const SUMMARY_ZONES: Array<{ type: FishingType; title: string; totalLabel: string }> = [
  {
    type: FishingType.ESTUARY,
    title: 'KURŠIŲ MARIOSE:',
    totalLabel: 'IŠ VISO (Kuršių mariose):',
  },
  {
    type: FishingType.INLAND_WATERS,
    title: 'NEMUNO ŽEMUPYJE, ŠVENTOSIOS UPĖJE:',
    totalLabel: 'Iš viso Nemuno žemupyje, Šventosios upėje:',
  },
  {
    type: FishingType.POLDERS,
    title: 'POLDERIUOSE:',
    totalLabel: 'Iš viso polderiuose:',
  },
];

const SUMMARY_TITLE =
  'ŽVEJYBOS VERSLINĖS ŽVEJYBOS ĮRANKIAIS KURŠIŲ MARIOSE, NEMUNO ŽEMUPYJE, ' +
  'ŠVENTOJOJE (PAJŪRIO) UPĖSE ATASKAITŲ SUVESTINĖ (KG.)';

// 1 (eil. nr.) + 1 (pavadinimas) + rūšys + „Kitos žuvys" + „IŠ VISO"
const SUMMARY_TOTAL_COL = 2 + SUMMARY_MAIN_COLUMNS.length + 2;
// Tuščias skiriamasis stulpelis, tada „Kontrolinė suma" ir detalizacija.
const SUMMARY_CONTROL_COL = SUMMARY_TOTAL_COL + 2;
const SUMMARY_LAST_COL = SUMMARY_CONTROL_COL + SUMMARY_OTHER_COLUMNS.length + 2;

type SummaryTotals = { main: number[]; other: number[] };

const emptyTotals = (): SummaryTotals => ({
  main: SUMMARY_MAIN_COLUMNS.map(() => 0),
  // +1 — paskutinis „Kitos" stulpelis nesuklasifikuotoms rūšims.
  other: [...SUMMARY_OTHER_COLUMNS.map(() => 0), 0],
});

const addTotals = (target: SummaryTotals, source: SummaryTotals) => {
  source.main.forEach((value, i) => (target.main[i] += value));
  source.other.forEach((value, i) => (target.other[i] += value));
};

// Kilogramai suvedami su dešimtainėmis dalimis, tad sumos kaupia float paklaidą.
const round2 = (value: number) => Math.round(value * 100) / 100;

// Rūšys sutapdinamos pagal `label`, o registro rašyba per aplinkas skiriasi
// (dev turėjo `karpiai`, prod — `Karpis`). Normalizavimas padengia raidžių
// registrą ir tarpus; skirtingi žodžiai lieka nesutapę ir atsiduria
// diagnostiniame lape, o ne tyliai „Kitose".
const normalizeLabel = (label: string) => label.trim().toLowerCase().replace(/\s+/g, ' ');

type CatchSummaryRow = {
  fishing_type: string;
  tenant_name: string | null;
  first_name: string | null;
  last_name: string | null;
  data: Record<string, number> | null;
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
      type: {
        type: 'enum',
        values: Object.values(FishingType),
        optional: true,
      },
      locationId: 'string|optional',
      locationName: 'string|optional',
      // Priimam kaip string'us: FE siunčia tokius id, kokius pats gavo iš
      // `fishTypes`, o mes juos verčiam į etiketes (žr. resolveSelectedFishLabels).
      fishTypes: {
        type: 'array',
        items: 'string',
        optional: true,
        convert: true,
      },
    },
  })
  async catchSummary(
    ctx: Context<
      {
        dateFrom?: string;
        dateTo?: string;
        type?: FishingType;
        locationId?: string;
        locationName?: string;
        fishTypes?: string[];
      },
      ResponseHeadersMeta
    >,
  ) {
    const from = this.parseSummaryDate(ctx.params.dateFrom, 'dateFrom', false);
    const to = this.parseSummaryDate(ctx.params.dateTo, 'dateTo', true);

    const [labelById, selectedLabels, rows] = await Promise.all([
      this.fetchFishTypeLabels(ctx),
      this.resolveSelectedFishLabels(ctx, ctx.params.fishTypes),
      this.fetchCatchSummaryRows(ctx, { from, to }),
    ]);

    const workbook = this.buildCatchSummaryWorkbook(rows, {
      labelById,
      selectedLabels,
      from,
      to,
    });

    const buffer = await workbook.xlsx.writeBuffer();

    ctx.meta.$responseHeaders = {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="versliniai_sugavimai_suvestine.xlsx"',
    };

    return buffer;
  }

  // Bare data (`2026-05-31`) neturi laiko dalies, tad intervalo pabaiga be šito
  // nukirstų visą paskutinę dieną. FE siunčia jau `endOfDay`, bet endpoint'as
  // kviečiamas ir tiesiogiai.
  @Method
  parseSummaryDate(value: string | undefined, field: string, endOfDay: boolean): Date | null {
    if (!value) return null;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new moleculer.Errors.ValidationError(`Invalid ${field}`);
    }

    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      date.setHours(23, 59, 59, 999);
    }

    return date;
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
  // (`fishTypes.find`), tad sutapimas nepriklauso nuo id kodavimo.
  @Method
  async resolveSelectedFishLabels(
    ctx: Context,
    fishTypes?: string[],
  ): Promise<Set<string> | null> {
    if (!fishTypes?.length) return null;

    const all: Array<{ id: unknown; label: string }> = await ctx.call('fishTypes.find', {
      fields: ['id', 'label'],
    });

    const labelById = new Map(all.map((item) => [String(item.id), item.label]));
    const selected = fishTypes
      .map((id) => labelById.get(String(id)))
      .filter((label): label is string => !!label);

    // Filtras pritaikytas, bet nė viena rūšis neatpažinta — grąžinam tuščią
    // aibę, kad suvestinė būtų tuščia, o ne begalinė (fail closed).
    return new Set(selected);
  }

  // Agregacijai naudojam raw SQL: moleculer DSL + secure id + ProfileMixin
  // scope'ai tokiuose skaičiavimuose sluoksniuojasi taip, kad rezultato realiai
  // neįmanoma peržiūrėti (CLAUDE.md → „Virtual-field populate gotchas" 2 p.).
  // Imam tik krantinius svėrimus (`tools_group_id IS NULL`) — tai oficialus
  // tiksliai pasvertas kiekis, kurį raportuoja ir etaloninė AAD lentelė.
  @Method
  async fetchCatchSummaryRows(
    ctx: Context<{
      type?: FishingType;
      locationId?: string;
      locationName?: string;
    }>,
    range: { from: Date | null; to: Date | null },
  ): Promise<CatchSummaryRow[]> {
    const { type, locationId, locationName } = ctx.params;

    const conditions = [
      'we.deleted_at IS NULL',
      'we.tools_group_id IS NULL',
      'f.deleted_at IS NULL',
    ];
    const bindings: any[] = [];

    if (type) {
      conditions.push('f.type = ?');
      bindings.push(type);
    }

    if (range.from) {
      conditions.push('COALESCE(we.date, we.created_at) >= ?');
      bindings.push(range.from);
    }

    if (range.to) {
      conditions.push('COALESCE(we.date, we.created_at) <= ?');
      bindings.push(range.to);
    }

    // Vietovė gyvena įrankių įvykiuose, ne žvejybos eilutėje — tas pats
    // sutapimas kaip `fishings.applyLocationFilter` (id + pavadinimas, nes
    // polderių ir barų id gali sutapti).
    if (locationId && locationName) {
      conditions.push(
        `we.fishing_id IN (
           SELECT fishing_id FROM tools_groups_events
           WHERE location->>'id' = ? AND location->>'name' = ? AND deleted_at IS NULL
         )`,
      );
      bindings.push(String(locationId), String(locationName));
    }

    return this.rawQuery(
      ctx,
      `SELECT f.type AS fishing_type,
              t.name AS tenant_name,
              u.first_name AS first_name,
              u.last_name AS last_name,
              we.data AS data
         FROM weight_events we
         JOIN fishings f ON f.id = we.fishing_id
         LEFT JOIN tenants t ON t.id = we.tenant_id AND t.deleted_at IS NULL
         LEFT JOIN users u ON u.id = we.user_id
        WHERE ${conditions.join(' AND ')}`,
      bindings,
    );
  }

  @Method
  buildCatchSummaryWorkbook(
    rows: CatchSummaryRow[],
    opts: {
      labelById: Map<number, string>;
      selectedLabels: Set<string> | null;
      from: Date | null;
      to: Date | null;
    },
  ) {
    const mainIndexByLabel = new Map<string, number>();
    SUMMARY_MAIN_COLUMNS.forEach((column, index) =>
      column.labels.forEach((label) => mainIndexByLabel.set(normalizeLabel(label), index)),
    );

    const otherIndexByLabel = new Map<string, number>();
    SUMMARY_OTHER_COLUMNS.forEach((column, index) =>
      column.labels.forEach((label) => otherIndexByLabel.set(normalizeLabel(label), index)),
    );
    const otherRestIndex = SUMMARY_OTHER_COLUMNS.length;

    // Rūšys, kurių nepavyko priskirti nė vienam stulpeliui. Skaičiuoti jos
    // skaičiuojamos kaip „Kitos" (sumos nesikeičia), bet atskirai išvedamos,
    // kad pervadinta ar nauja rūšis nedingtų nepastebėta.
    const unmapped = new Map<string, number>();

    const byZone = new Map<string, Map<string, SummaryTotals>>();
    SUMMARY_ZONES.forEach((zone) => byZone.set(zone.type, new Map()));

    for (const row of rows) {
      const zone = byZone.get(row.fishing_type);
      if (!zone) continue;

      const party =
        row.tenant_name ||
        `${row.first_name || ''} ${row.last_name || ''}`.trim() ||
        'Nenurodyta';

      let totals = zone.get(party);
      if (!totals) {
        totals = emptyTotals();
        zone.set(party, totals);
      }

      for (const [fishTypeId, weight] of Object.entries(row.data || {})) {
        const kg = Number(weight);
        if (!Number.isFinite(kg) || kg === 0) continue;

        const label = opts.labelById.get(Number(fishTypeId));

        // Ištrinta rūšis etiketės nebeturi — su aktyviu filtru ją praleidžiam,
        // be filtro sumuojam į „Kitos", kad bendra suma nesumažėtų.
        if (!label) {
          if (!opts.selectedLabels) {
            totals.other[otherRestIndex] += kg;
            unmapped.set(`ID ${fishTypeId}`, (unmapped.get(`ID ${fishTypeId}`) || 0) + kg);
          }
          continue;
        }

        if (opts.selectedLabels && !opts.selectedLabels.has(label)) continue;

        const normalized = normalizeLabel(label);

        const mainIndex = mainIndexByLabel.get(normalized);
        if (mainIndex !== undefined) {
          totals.main[mainIndex] += kg;
          continue;
        }

        const otherIndex = otherIndexByLabel.get(normalized);
        if (otherIndex === undefined) {
          unmapped.set(label, (unmapped.get(label) || 0) + kg);
        }

        totals.other[otherIndex ?? otherRestIndex] += kg;
      }
    }

    return this.renderCatchSummarySheet(byZone, opts, unmapped);
  }

  @Method
  renderCatchSummarySheet(
    byZone: Map<string, Map<string, SummaryTotals>>,
    opts: { from: Date | null; to: Date | null },
    unmapped: Map<string, number>,
  ) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Suvestinė');

    sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 4 }];

    sheet.mergeCells(1, 1, 1, SUMMARY_LAST_COL);
    sheet.getCell(1, 1).value = SUMMARY_TITLE;
    sheet.getCell(1, 1).font = { bold: true };
    sheet.getCell(1, 1).alignment = { horizontal: 'center', wrapText: true };

    sheet.mergeCells(2, 1, 2, SUMMARY_LAST_COL);
    sheet.getCell(2, 1).value = `UŽ ${this.formatSummaryPeriod(opts.from, opts.to)}`;
    sheet.getCell(2, 1).alignment = { horizontal: 'center' };

    sheet.mergeCells(3, SUMMARY_CONTROL_COL, 3, SUMMARY_LAST_COL);
    sheet.getCell(3, SUMMARY_CONTROL_COL).value = 'Kitos žuvys :';
    sheet.getCell(3, SUMMARY_CONTROL_COL).font = { bold: true };

    const headerRow = sheet.getRow(4);
    headerRow.values = [
      'Eil. Nr.',
      'ĮMONĖS (ORGANIZACIJOS) PAVADINIMAS',
      ...SUMMARY_MAIN_COLUMNS.map((column) => column.header),
      'Kitos žuvys',
      'IŠ VISO',
      null,
      'Kontrolinė suma (iš viso)',
      ...SUMMARY_OTHER_COLUMNS.map((column) => column.header),
      'Kitos',
      'IŠ VISO',
    ];
    headerRow.font = { bold: true };
    headerRow.alignment = { wrapText: true, vertical: 'bottom' };

    let rowIndex = 5;
    const grandTotals = emptyTotals();

    for (const zone of SUMMARY_ZONES) {
      const parties = Array.from(byZone.get(zone.type)?.entries() || []).sort((a, b) =>
        a[0].localeCompare(b[0], 'lt'),
      );

      const titleRow = sheet.getRow(rowIndex++);
      titleRow.getCell(1).value = zone.title;
      titleRow.font = { bold: true };

      const zoneTotals = emptyTotals();

      parties.forEach(([party, totals], index) => {
        sheet.getRow(rowIndex++).values = this.summaryRowValues(index + 1, party, totals);
        addTotals(zoneTotals, totals);
      });

      const totalRow = sheet.getRow(rowIndex++);
      totalRow.values = this.summaryRowValues('', zone.totalLabel, zoneTotals);
      totalRow.font = { bold: true };

      addTotals(grandTotals, zoneTotals);
      rowIndex++;
    }

    const grandRow = sheet.getRow(rowIndex);
    grandRow.values = this.summaryRowValues('', 'IŠ VISO:', grandTotals);
    grandRow.font = { bold: true };

    sheet.getColumn(1).width = 8;
    sheet.getColumn(2).width = 38;
    for (let column = 3; column <= SUMMARY_LAST_COL; column++) {
      sheet.getColumn(column).width = column === SUMMARY_TOTAL_COL + 1 ? 3 : 12;
    }

    this.appendUnmappedSheet(workbook, unmapped);

    return workbook;
  }

  // Etalono invariantas: „IŠ VISO" = „Kontrolinė suma" = pagrindinės rūšys +
  // „Kitos žuvys", o detalizacijos „IŠ VISO" = „Kitos žuvys".
  @Method
  summaryRowValues(first: string | number, name: string, totals: SummaryTotals) {
    const other = round2(totals.other.reduce((sum, value) => sum + value, 0));
    const total = round2(totals.main.reduce((sum, value) => sum + value, 0) + other);

    return [
      first,
      name,
      ...totals.main.map(round2),
      other,
      total,
      null,
      total,
      ...totals.other.slice(0, SUMMARY_OTHER_COLUMNS.length).map(round2),
      round2(totals.other[SUMMARY_OTHER_COLUMNS.length]),
      other,
    ];
  }

  // Antras lapas atsiranda TIK tada, kai kažko nepavyko priskirti. Švarioje
  // aplinkoje suvestinė lieka lygiai tokia, kokia yra AAD etalonas.
  @Method
  appendUnmappedSheet(workbook: ExcelJS.Workbook, unmapped: Map<string, number>) {
    if (!unmapped.size) return;

    const sheet = workbook.addWorksheet('Nepriskirtos rūšys');

    sheet.getRow(1).values = [
      'Šios rūšys nepateko į nė vieną suvestinės stulpelį ir buvo priskaičiuotos prie „Kitos žuvys“.',
    ];
    sheet.getRow(1).font = { bold: true };

    const header = sheet.getRow(3);
    header.values = ['Rūšis registre', 'Kiekis, kg'];
    header.font = { bold: true };

    Array.from(unmapped.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([label, kg], index) => {
        sheet.getRow(4 + index).values = [label, round2(kg)];
      });

    sheet.getColumn(1).width = 48;
    sheet.getColumn(2).width = 16;
  }

  @Method
  formatSummaryPeriod(from: Date | null, to: Date | null) {
    const format = (date: Date) => date.toISOString().slice(0, 10);

    if (from && to) return `${format(from)} – ${format(to)}`;
    if (from) return `LAIKOTARPĮ NUO ${format(from)}`;
    if (to) return `LAIKOTARPĮ IKI ${format(to)}`;
    return 'VISĄ LAIKOTARPĮ';
  }

}
