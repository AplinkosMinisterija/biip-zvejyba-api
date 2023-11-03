/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('tools', (table) => {
    table.dropColumn('eyeSize');
    table.dropColumn('eyeSize2');
    table.dropColumn('netLength');
    table.jsonb('data');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('tools', (table) => {
    table.double('eyeSize');
    table.double('eyeSize2');
    table.double('netLength');
    table.dropColumn('data');
  });
};
