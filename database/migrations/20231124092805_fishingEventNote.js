exports.up = function (knex) {
  return knex.schema.alterTable('fishingEvents', (table) => {
    table.jsonb('data');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('fishingEvents', (table) => {
    table.dropColumn('data');
  });
};
