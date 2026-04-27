const { commonFields } = require('./20230405144107_setup');

exports.up = function (knex) {
  return knex.schema
    .createTable('polders', (table) => {
      table.increments('id');
      table.string('name', 255).notNullable();
      table.float('area');
      commonFields(table);
    })
    .alterTable('fishings', (table) => {
      table.integer('polderId').unsigned();
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('fishings', (table) => {
      table.dropColumn('polderId');
    })
    .dropTable('polders');
};
