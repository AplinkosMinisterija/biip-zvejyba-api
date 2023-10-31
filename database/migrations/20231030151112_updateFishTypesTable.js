/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('fishTypes', (table) => {
    table.jsonb('photo');
    table.renameColumn('label', 'name');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('fishTypes', (table) => {
    table.dropColumn('photo');
    table.renameColumn('name', 'label');
  });
};
