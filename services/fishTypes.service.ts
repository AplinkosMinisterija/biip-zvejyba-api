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
  { label: 'Karšis', priority: 99999999999 },
  { label: 'Sterkas', priority: 99999999998 },
  { label: 'Sterkas (neverslinio dydžio)', priority: 99999999997 },
  { label: 'Kuoja', priority: 99999999996 },
  { label: 'Ešerys', priority: 99999999995 },
  { label: 'Žiobris', priority: 99999999994 },
  { label: 'Perpelė', priority: 99999999993 },
  { label: 'Karosas', priority: 99999999992 },
  { label: 'Ožka', priority: 99999999991 },
  { label: 'Lydeka', priority: 99999999990 },
  { label: 'Ungurys', priority: 99999999989 },
  { label: 'Stinta', priority: 99999999988 },
  { label: 'Nėgė', priority: 99999999987 },
  { label: 'Karpis', priority: 99999999986 },
  { label: 'Vėgėlė', priority: 99999999985 },
  { label: 'Šamas', priority: 99999999984 },

  { label: 'Karosas, auksinis', priority: 0 },
  { label: 'Karosas, sidabrinis', priority: 0 },
  { label: 'Lašiša', priority: 0 },
  { label: 'Lynas', priority: 0 },
  { label: 'Plakis', priority: 0 },
  { label: 'Plekšnė', priority: 0 },
  { label: 'Pūgžlys', priority: 0 },
  { label: 'Raudė', priority: 0 },
  { label: 'Strimelė', priority: 0 },
  { label: 'Sykas', priority: 0 },
  { label: 'Šlakis', priority: 0 },
  { label: 'Vėžys, plačiažnyplis', priority: 0 },
  { label: 'Seliava', priority: -1 },
  { label: 'Kita rūšis', priority: -1 },
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
