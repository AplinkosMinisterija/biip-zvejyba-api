'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
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

import { Tenant } from './tenants.service';
import { User } from './users.service';

interface Fields extends CommonFields {
  id: number;
  tenant: Tenant['id'];
  user: User['id'];
}

interface Populates extends CommonPopulates {}

export type ResearchFish<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'researches.fishes',
  mixins: [
    DbConnection({
      collection: 'researchFishes',
      rest: false,
    }),
  ],
  settings: {
    // This entity is managed exclusively through the (INVESTIGATOR-gated)
    // `researches` service via internal `ctx.call`; it has no `tenant`/`user`
    // column to scope on and no FE consumer. `rest: false` does not hide it
    // because the gateway's `mappingPolicy: 'all'` still serves
    // `/researches.fishes/<action>` — without this any USER could read/write
    // arbitrary research-fish rows by id. Lock all HTTP access to ADMIN;
    // internal calls bypass the gateway and keep working.
    auth: RestrictionType.ADMIN,
    fields: {
      id: {
        type: 'number',
        primaryKey: true,
        secure: true,
      },
      fishType: {
        type: 'number',
        immutable: true,
        columnType: 'integer',
        columnName: 'fishTypeId',
        populate: 'fishTypes.resolve',
      },
      abundance: 'number',
      biomass: 'number',
      abundancePercentage: 'number',
      biomassPercentage: 'number',
      research: {
        immutable: true,
        type: 'number',
        columnType: 'integer',
        columnName: 'researchId',
        populate: {
          action: 'researches.resolve',
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
})
export default class ResearchesFishesService extends moleculer.Service {
  @Action()
  async createOrUpdate(ctx: Context<{ id: number; research: number; fishType: number }>) {
    const { fishType, research } = ctx.params;
    let { id } = ctx.params;
    if (fishType && research) {
      const researchFish: ResearchFish = await ctx.call('researches.fishes.findOne', {
        query: {
          research,
          fishType,
        },
      });

      id = researchFish?.id;
    }

    if (!id) {
      return ctx.call('researches.fishes.create', ctx.params);
    }

    return ctx.call('researches.fishes.update', { ...ctx.params, id });
  }
}
