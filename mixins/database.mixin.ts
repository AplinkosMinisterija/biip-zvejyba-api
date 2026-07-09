'use strict';

import _ from 'lodash';
import { Context } from 'moleculer';
import filtersMixin from 'moleculer-knex-filters';
const DbService = require('@moleculer/database').Service;
const knex = require('../knexfile');

export function PopulateHandlerFn(action: string) {
  return async function (
    ctx: Context<{ populate: string | string[] }>,
    values: any[],
    docs: any[],
    field: any,
  ) {
    if (!values.length) return null;
    const rule = field.populate;
    let populate = rule.params?.populate;
    if (rule.inheritPopulate) {
      populate = ctx.params.populate;
    }
    const params = {
      ...(rule.params || {}),
      id: values,
      mapping: true,
      populate,
      throwIfNotExist: false,
    };

    const byKey: any = await ctx.call(action, params, rule.callOptions);

    let fieldName = field.name;
    if (rule.keyField) {
      fieldName = rule.keyField;
    }

    return docs?.map((d) => {
      const fieldValue = d[fieldName];
      if (!fieldValue) return null;
      return byKey[fieldValue] || null;
    });
  };
}

function makeMapping(
  data: any[],
  mapping?: string,
  options?: {
    mappingMulti?: boolean;
    mappingField?: string;
  },
) {
  if (!mapping) return data;

  return data?.reduce((acc: any, item) => {
    let value: any = item;

    if (options?.mappingField) {
      value = item[options.mappingField];
    }

    if (options?.mappingMulti) {
      return {
        ...acc,
        [`${item[mapping]}`]: [...(acc[`${item[mapping]}`] || []), value],
      };
    }

    return { ...acc, [`${item[mapping]}`]: value };
  }, {});
}

export default function (opts: any = {}) {
  const adapter: any = {
    type: 'Knex',
    options: {
      knex,
      tableName: opts.collection,
    },
  };

  const cache = {
    enabled: false,
  };

  // @moleculer/database default is `maxLimit: -1` (unbounded). With
  // `populate` chains that fan-out to N nested ctx.calls, a single
  // `GET /fishings?pageSize=10000&populate=weightEvents,toolsGroup`
  // can stall the worker and blow DB connection budget (audit security
  // #M14). Cap to 100 by default; individual services can override
  // by passing `maxLimit` through opts.
  opts = _.defaultsDeep(opts, { adapter, maxLimit: 100 }, { cache: opts.cache || cache });

  const removeRestActions: any = {};

  if (opts?.createActions === undefined || opts?.createActions !== false) {
    removeRestActions.replace = {
      rest: null as any,
    };
  }

  const schema = {
    mixins: [DbService(opts), filtersMixin()],

    actions: {
      ...removeRestActions,

      findOne(ctx: any) {
        return this.findEntity(ctx);
      },

      // `clearEntities` is an unscoped hard `DELETE FROM <table>` (bypasses
      // soft-delete and tenant scope). It must NEVER be HTTP-reachable: the
      // gateway runs `mappingPolicy: 'all'`, so without `protected` any
      // authenticated USER could `POST /<service>/removeAllEntities` and wipe
      // every tenant's rows (security audit — mass deletion). `protected`
      // keeps internal `broker.call`/`ctx.call` (tests, seeds) working while
      // moleculer-web refuses to serve it (mirrors `users.resolve`).
      removeAllEntities: {
        visibility: 'protected',
        handler(ctx: any) {
          return this.clearEntities(ctx);
        },
      },

      async populateByProp(
        ctx: Context<{
          id: number | number[];
          queryKey: string;
          query: any;
          mapping?: boolean;
          mappingMulti?: boolean;
          mappingField: string;
        }>,
      ): Promise<any> {
        const { queryKey, query, mapping, mappingMulti, mappingField } = ctx.params;

        const ids = Array.isArray(ctx.params.id) ? ctx.params.id : [ctx.params.id];

        delete ctx.params.queryKey;
        delete ctx.params.id;
        delete ctx.params.mapping;
        delete ctx.params.mappingMulti;
        delete ctx.params.mappingField;

        const entities = await this.findEntities(ctx, {
          ...ctx.params,
          query: {
            ...(query || {}),
            [queryKey]: { $in: ids },
          },
        });

        const resultById = makeMapping(entities, mapping ? queryKey : '', {
          mappingMulti,
          mappingField: mappingField,
        });

        return ids.reduce(
          (acc: any, id) => ({
            ...acc,
            [`${id}`]: resultById[id] || (mappingMulti ? [] : ''),
          }),
          {},
        );
      },
    },

    methods: {
      filterQueryIds(ids: number[], queryIds?: any) {
        if (!queryIds) return ids;

        queryIds = (Array.isArray(queryIds) ? queryIds : [queryIds]).map((id: any) => parseInt(id));

        return ids.filter((id) => queryIds.indexOf(id) >= 0);
      },
      async rawQuery(ctx: Context, sql: string, bindings?: readonly any[]): Promise<any[]> {
        const adapter = await (this as any).getAdapter(ctx);
        const knex = adapter.client;
        const result = await knex.raw(sql, (bindings ?? []) as any[]);
        return result.rows;
      },
    },
    hooks: {
      after: {
        find: [
          async function (
            ctx: Context<{
              mapping: string;
              mappingMulti: boolean;
              mappingField: string;
            }>,
            data: any[],
          ) {
            const { mapping, mappingMulti, mappingField } = ctx.params;
            return makeMapping(data, mapping, {
              mappingMulti,
              mappingField,
            });
          },
        ],
      },
    },

    merged(schema: any) {
      if (schema.actions) {
        for (const action in schema.actions) {
          const params = schema.actions[action].additionalParams;
          if (typeof params === 'object') {
            schema.actions[action].params = {
              ...schema.actions[action].params,
              ...params,
            };
          }
        }
      }
    },

    async started() {
      // Seeding if the DB is empty
      const count = await this.countEntities(null, {
        scope: false,
      });

      if (count == 0 && _.isFunction(this.seedDB)) {
        this.logger.info(`Seed '${opts.collection}' collection...`);
        await this.seedDB();
      }
    },
  };

  return schema;
}
