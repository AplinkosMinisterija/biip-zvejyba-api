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
  RestrictionType,
  Table,
} from '../types';

import ProfileMixin from '../mixins/profile.mixin';
import { GeomFeatureCollection } from '../modules/geometry';
import { getFolderName } from '../utils';
import { UserAuthMeta } from './api.service';
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
}
