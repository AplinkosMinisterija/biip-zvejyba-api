'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
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

import _ from 'lodash';
import ProfileMixin from '../mixins/profile.mixin';
import { getFolderName } from '../utils';
import { UserAuthMeta } from './api.service';
import { ResearchFish } from './researches.fishes.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

interface Fields extends CommonFields {
  id: number;
  cadastralId: string;
  waterBodyData: { [key: string]: any };
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
  }>;
  previousResearchData: {
    year: number;
    conditionIndex: number;
    totalAbundance: number;
    totalBiomass: number;
  };
  fishes?: ResearchFish[];
  tenant: Tenant['id'];
  user: User['id'];
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
      waterBodyData: 'object|required',
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
    defaultPopulates: ['fishes'],
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
      create: ['beforeCreate'],
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
        },
      },
    },
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
    rest: 'POST /',
    auth: RestrictionType.INVESTIGATOR,
  })
  async createEntity(ctx: Context<{ fishes: ResearchFish[] }, UserAuthMeta>) {
    const { fishes } = ctx.params;

    const research: Research = await ctx.call('researches.create', ctx.params);

    await Promise.all(
      fishes?.map(
        (f) =>
          ctx.call('researches.fishes.createOrUpdate', {
            ...f,
            research: research.id,
          }) as Promise<ResearchFish>,
      ),
    );

    return ctx.call('researches.resolve', { id: research.id });
  }

  @Action({
    rest: 'PATCH /:id',
    auth: RestrictionType.INVESTIGATOR,
  })
  async updateEntity(ctx: Context<{ fishes: ResearchFish[] }, UserAuthMeta>) {
    const { fishes } = ctx.params;
    const research: Research = await ctx.call('researches.update', ctx.params);

    await Promise.all(
      fishes?.map(
        (f) =>
          ctx.call('researches.fishes.createOrUpdate', {
            ...f,
            research: research.id,
          }) as Promise<ResearchFish>,
      ),
    );

    return ctx.call('researches.resolve', { id: research.id });
  }

  @Action({
    rest: 'GET /:id/related',
    auth: RestrictionType.PUBLIC,
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
  })
  async listRelated(
    ctx: Context<{ id: number; query: any; pageSize: number; page?: number }, UserAuthMeta>,
  ) {
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

    return ctx.call(
      'researches.list',
      _.merge({}, ctx.params || {}, {
        query: {
          cadastralId: research.cadastralId,
          id: {
            $ne: research.id,
          },
        },
      }),
    );
  }
}
