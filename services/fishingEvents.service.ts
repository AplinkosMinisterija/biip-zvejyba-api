'use strict';

import moleculer, { Context } from 'moleculer';
import { Service } from 'moleculer-decorators';
import PostgisMixin from 'moleculer-postgis';
import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  Table,
} from '../types';

import ProfileMixin from '../mixins/profile.mixin';
import { Tenant } from './tenants.service';
import { User } from './users.service';

export enum FishingEventType {
  START = 'START',
  END = 'END',
  SKIP = 'SKIP',
}

interface Fields extends CommonFields {
  id: number;
  geom: any;
  type: FishingEventType;
  tenant: Tenant['id'];
  user: User['id'];
}

interface Populates extends CommonPopulates {}

export type FishingEvent<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'fishingEvents',
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
      geom: {
        type: 'any',
        geom: {
          types: ['Point'],
        },
      },
      type: 'string',
      data: {
        type: 'object',
        params: {
          note: 'string',
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
        // NULL user_id reiškia, kad event'ą sukūrė sistema (pvz., midnight
        // cron'as uždarinėjantis nepataikytas žvejybas) — populate grąžina
        // sintetinį Sistema actor'ą, kad UI galėtų atskirti nuo realaus
        // vartotojo be magic id reikšmės.
        async populate(ctx: Context, values: Array<number | null>) {
          const realIds = Array.from(new Set(values.filter((v): v is number => v != null)));
          const users: User[] = realIds.length
            ? await ctx.call('users.resolve', { id: realIds, scope: false })
            : [];
          const byId = new Map(users.map((u) => [u.id, u]));
          return values.map((v) =>
            v == null
              ? { id: null, firstName: 'Sistema', lastName: '', isSystem: true }
              : byId.get(v),
          );
        },
      },
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: ['geom'],
  },
  actions: {
    create: {
      rest: null,
    },
    update: {
      rest: null,
    },
    remove: {
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
export default class FishTypesService extends moleculer.Service {}
