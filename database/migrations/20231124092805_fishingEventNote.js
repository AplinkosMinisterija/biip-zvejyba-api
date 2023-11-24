exports.up = function (knex) {
  return knex.schema.alterTable('fishingEvents', (table) => {
    table.string('note');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('fishingEvents', (table) => {
    table.dropColumn('note');
  });
};
