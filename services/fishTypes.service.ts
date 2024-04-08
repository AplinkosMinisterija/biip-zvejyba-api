'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  IMAGE_TYPES,
  RestrictionType,
  Table,
} from '../types';
import { getFolderName } from '../utils';
import { UserAuthMeta } from './api.service';

const Cron = require('@r2d2bzh/moleculer-cron');

export const START_PRIORITY_UPDATE_DATE = '2025-01-01T00:00:00';

export const fishTypesSeedData = [
  { label: 'karšiai', priority: 26 },
  { label: 'žiobriai', priority: 25 },
  { label: 'kuojos', priority: 24 },
  { label: 'sterkai', priority: 23 },
  { label: 'ešeriai', priority: 22 },
  { label: 'strintos', priority: 21 },
  { label: 'perpelės', priority: 20 },
  { label: 'karosai, auksiniai', priority: 19 },
  { label: 'karosai, sidabriniai', priority: 18 },
  { label: 'unguriai', priority: 17 },
  { label: 'lydekos', priority: 16 },
  { label: 'salačiai', priority: 15 },
  { label: 'vėgėlės', priority: 14 },
  { label: 'ožkos', priority: 13 },
  { label: 'karpiai', priority: 12 },
  { label: 'plakiai', priority: 11 },
  { label: 'šamai', priority: 10 },
  { label: 'nėgės', priority: 9 },
  { label: 'pūgžliai', priority: 8 },
  { label: 'lynai', priority: 7 },
  { label: 'meknės', priority: 6 },
  { label: 'plekšnės', priority: 5 },
  { label: 'sykai', priority: 4 },
  { label: 'strimelės', priority: 3 },
  { label: 'plačiakačiai', priority: 2 },
  { label: 'aukšlės', priority: 1 },
  { label: 'seliavos', priority: 0 },
  { label: 'vaivorykštiniai upėtakiai', priority: 0 },
  { label: 'vėžiai, plačiažnypliai', priority: 0 },
  { label: 'margieji plačiakačiai', priority: 0 },
  { label: 'lašišos', priority: 0 },
  { label: 'šlakiai', priority: 0 },
  { label: 'margieji upėtakiai', priority: 0 },
  { label: 'aštriašnipiai eršketai', priority: 0 },
  { label: 'kiršliai', priority: 0 },
  { label: 'ūsoriai', priority: 0 },
  { label: 'skersnukiai', priority: 0 },
  { label: 'plačiakakčiai', priority: 0 },
  { label: 'margieji plačiakakčiai', priority: 0 },
  { label: 'baltieji amūrai', priority: 0 },
];

interface Fields extends CommonFields {
  id: number;
  label: string;
  photo: {
    url: string;
    name: string;
  };
  priority: number;
}

interface Populates extends CommonPopulates {}

export type FishType<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'fishTypes',
  mixins: [
    DbConnection({
      collection: 'fishTypes',
      createActions: {
        createMany: false,
      },
    }),
    Cron,
  ],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      label: 'string|required',
      photo: {
        type: 'object',
        properties: {
          url: 'string|required',
          name: 'string',
        },
        columnType: 'json',
      },
      priority: 'number',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
  actions: {
    remove: {
      auth: RestrictionType.ADMIN,
    },
    create: {
      auth: RestrictionType.ADMIN,
    },
    update: {
      auth: RestrictionType.ADMIN,
    },
  },
  hooks: {
    before: {
      list: ['sortItems'],
      find: ['sortItems'],
      all: ['sortItems'],
    },
  },
  crons: [
    {
      name: 'updatePriority',
      cronTime: '0 0 * * 0',
      async onTick() {
        // There is no data yet, so the sort would be inaccurate if sorted now.
        if (new Date() >= new Date(START_PRIORITY_UPDATE_DATE)) {
          const fishTypes: FishType[] = await this.call('fishTypes.find');
          for (const fishType of fishTypes) {
            const weightEventsCount: number = await this.call('weightEvents.count', {
              query: {
                toolsGroup: { $exists: false },
                $raw: {
                  condition: `data->> ? IS NOT NULL`,
                  bindings: fishType.id,
                },
              },
            });
            await this.call('fishTypes.update', {
              id: fishType.id,
              priority: weightEventsCount,
            });
          }
        }
      },
      timeZone: 'Europe/Vilnius',
    },
  ],
})
export default class FishTypesService extends moleculer.Service {
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
      isPrivate: false,
      types: IMAGE_TYPES,
      folder,
    });
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/fishTypes',
      path: '/',
    },
    auth: RestrictionType.PUBLIC,
  })
  async getPublicFishType(ctx: Context) {
    return await this.findEntities(ctx, {
      fields: ['id', 'label', 'photo'],
      sort: 'label',
    });
  }

  @Method
  async sortItems(ctx: Context<any>) {
    if (!ctx.params.sort) {
      ctx.params.sort = '-priority,label';
    }
  }

  @Method
  async seedDB() {
    await this.createEntities(null, fishTypesSeedData);
  }
}
