'use strict';

import moleculer from 'moleculer';
import { Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  RestrictionType,
  Table,
} from '../types';

// Static list of Nemuno žemupio polderiai used as fishing locations.
// Areas are in hectares. Order matches the source spreadsheet.
const data = [
  { name: 'Alkos', area: 3826 },
  { name: 'Minijos', area: 685 },
  { name: 'Stankiškių', area: 1130 },
  { name: 'Kulinų', area: 598 },
  { name: 'Šakūnėlių', area: 395 },
  { name: 'Veržės', area: 1773 },
  { name: 'Nausėdų-Plaušvarių', area: 2686 },
  { name: 'Plaškių', area: 1500 },
  { name: 'Šilgalių', area: 543 },
  { name: 'Pakalnės', area: 629 },
  { name: 'Uostadvario', area: 1380 },
  { name: 'Vorusnės', area: 755 },
  { name: 'Šyšos', area: 1577 },
];

interface Fields extends CommonFields {
  id: number;
  name: string;
  area: number;
}

interface Populates extends CommonPopulates {}

export type Polder<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'polders',
  mixins: [
    DbConnection({
      collection: 'polders',
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
      name: 'string|required',
      area: 'number',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
  actions: {
    list: { auth: RestrictionType.DEFAULT },
    find: { auth: RestrictionType.DEFAULT },
    get: { auth: RestrictionType.DEFAULT },
    count: { auth: RestrictionType.DEFAULT },
    create: { auth: RestrictionType.ADMIN },
    update: { auth: RestrictionType.ADMIN },
    remove: { auth: RestrictionType.ADMIN },
  },
})
export default class PoldersService extends moleculer.Service {
  @Method
  async seedDB() {
    await this.createEntities(null, data);
  }
}
