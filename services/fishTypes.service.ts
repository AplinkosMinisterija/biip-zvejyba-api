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

interface Fields extends CommonFields {
  id: number;
  label: string;
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
      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },
    actions: {
      remove: {
        types: [RestrictionType.ADMIN],
      },
      create: {
        types: [RestrictionType.ADMIN],
      },
      update: {
        types: [RestrictionType.ADMIN],
      },
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
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
      isPrivate: true,
      types: IMAGE_TYPES,
      folder,
    });
  }

  @Method
  async seedDB() {
    await this.createEntities(null, [
      { label: 'baltieji amūrai' },
      { label: 'karosai, auksiniai' },
      { label: 'lynai' },
      { label: 'karosai, sidabriniai' },
      { label: 'lydekos' },
      { label: 'sykai' },
      { label: 'karpiai' },
      { label: 'seliavos' },
      { label: 'plačiakačiai' },
      { label: 'sterkai' },
      { label: 'karšiai' },
      { label: 'šamai' },
      { label: 'vaivorykštiniai upėtakiai' },
      { label: 'unguriai' },
      { label: 'vėgėlės' },
      { label: 'vėžiai, plačiažnypliai' },
      { label: 'margieji plačiakačiai' },
      { label: 'lašišos' },
      { label: 'šlakiai' },
      { label: 'margieji upėtakiai' },
      { label: 'aštriašnipiai eršketai' },
      { label: 'kiršliai' },
      { label: 'ūsoriai' },
      { label: 'skersnukiai' },
      { label: 'plačiakakčiai' },
      { label: 'margieji plačiakakčiai' },
    ]);
  }
}
