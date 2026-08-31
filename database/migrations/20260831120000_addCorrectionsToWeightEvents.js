/**
 * AAD officers may correct a fisher's mistaken catch entry (wrong weight or
 * mixed-up species) under Žvejybos žurnalų pildymo taisyklės §211, which
 * requires the officer to record the AAD PPT report number that authorised
 * the correction. `data` is overwritten in place, so the append-only
 * `corrections` array is the only record of what the fisher originally
 * entered — treat it as legal evidence, never rewrite it.
 *
 * Nullable with no default: existing rows stay NULL (= never corrected) and
 * the service reads NULL as an empty list, so no backfill and no table
 * rewrite. The `hasColumn` guard keeps a re-run harmless if a deploy dies
 * between the DDL and the migrations-table insert.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
// `hasColumn` compares information_schema *values*, which knexSnakeCaseMappers
// does not rewrite (it only wraps identifiers) — so this probe must spell the
// physical names, while `alterTable` keeps the camelCase repo convention.
const TABLE = 'weight_events';
const COLUMN = 'corrections';

exports.up = async function (knex) {
  if (await knex.schema.hasColumn(TABLE, COLUMN)) return;

  return knex.schema.alterTable('weightEvents', (table) => {
    table.jsonb('corrections');
  });
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasColumn(TABLE, COLUMN))) return;

  return knex.schema.alterTable('weightEvents', (table) => {
    table.dropColumn('corrections');
  });
};
