'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  CommonFields,
  CommonPopulates,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  IMAGE_TYPES,
  RestrictionType,
  Table,
} from '../types';
import { getFolderName } from '../utils';
import { UserAuthMeta } from './api.service';

interface Fields extends CommonFields {
  id: number;
  name: string;
}

interface Populates extends CommonPopulates {}

export type FishType<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'fishTypes',
  mixins: [DbConnection()],
  settings: {
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      name: 'string|required',
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
      isPrivate: false,
      types: IMAGE_TYPES,
      folder,
    });
  }

  @Method
  async seedDB() {
    await this.createEntities(null, [
      { name: 'baltieji amūrai' },
      { name: 'karosai, auksiniai' },
      { name: 'lynai' },
      { name: 'karosai, sidabriniai' },
      { name: 'lydekos' },
      { name: 'sykai' },
      { name: 'karpiai' },
      { name: 'seliavos' },
      { name: 'plačiakačiai' },
      { name: 'sterkai' },
      { name: 'karšiai' },
      { name: 'šamai' },
      { name: 'vaivorykštiniai upėtakiai' },
      { name: 'unguriai' },
      { name: 'vėgėlės' },
      { name: 'vėžiai, plačiažnypliai' },
      { name: 'margieji plačiakačiai' },
      { name: 'lašišos' },
      { name: 'šlakiai' },
      { name: 'margieji upėtakiai' },
      { name: 'aštriašnipiai eršketai' },
      { name: 'kiršliai' },
      { name: 'ūsoriai' },
      { name: 'skersnukiai' },
      { name: 'plačiakakčiai' },
      { name: 'margieji plačiakakčiai' },
    ]);
  }
}
