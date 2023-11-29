exports.up = function (knex) {
  return knex.schema.alterTable('fishings', (table) => {
    table.string('uetkCadastralId', 255);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('fishings', (table) => {
    table.dropColumn('uetkCadastralId');
  });
};
