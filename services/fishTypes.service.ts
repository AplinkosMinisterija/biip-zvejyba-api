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

const data = [
  { label: 'Karšis', priority: 999999999 },
  { label: 'Sterkas', priority: 999999998 },
  { label: 'Kuoja', priority: 999999997 },
  { label: 'Ešerys', priority: 999999996 },
  { label: 'Žiobris', priority: 999999995 },
  { label: 'Perpelė', priority: 999999994 },
  { label: 'Karosas, auksinis', priority: 999999993 },
  { label: 'Karosas, sidabrinis', priority: 999999992 },
  { label: 'Ožka', priority: 999999991 },
  { label: 'Lydeka', priority: 999999990 },
  { label: 'Ungurys', priority: 999999989 },
  { label: 'Stinta', priority: 999999988 },
  { label: 'Nėgė', priority: 999999987 },
  { label: 'Karpis', priority: 999999986 },
  { label: 'Vėgėlė', priority: 999999985 },
  { label: 'Šamas', priority: 999999984 },
  { label: 'Kiršlys', priority: 0 },
  { label: 'Lašiša', priority: 0 },
  { label: 'Lynas', priority: 0 },
  { label: 'Margasis plačiakaktis', priority: 0 },
  { label: 'Margasis upėtakis', priority: 0 },
  { label: 'Meknė', priority: 0 },
  { label: 'Plačiakaktis', priority: 0 },
  { label: 'Plakis', priority: 0 },
  { label: 'Plekšnė', priority: 0 },
  { label: 'Pūgžlys', priority: 0 },
  { label: 'Raudė', priority: 0 },
  { label: 'Salačius', priority: 0 },
  { label: 'Seliava', priority: 0 },
  { label: 'Skersnukis', priority: 0 },
  { label: 'Šlakis', priority: 0 },
  { label: 'Strimelė', priority: 0 },
  { label: 'Sykas', priority: 0 },
  { label: 'Ūsorius', priority: 0 },
  { label: 'Vaivorykštinis upėtakis', priority: 0 },
  { label: 'Vėžys, plačiažnyplis', priority: 0 },
  { label: 'Aukšlė', priority: 34 },
  { label: 'Aštriašnipis eršketas', priority: 43 },
  { label: 'Baltasis amūras', priority: 21 },
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
        if (new Date() >= new Date('2025-01-01T00:00:00')) {
          const fishTypes: FishType[] = await this.call('fishTypes.find', {
            query: {
              priority: { $lt: 999999000 },
            },
          });
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
    await this.createEntities(null, data);
  }
}
