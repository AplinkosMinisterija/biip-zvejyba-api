const { commonFields } = require('./20230405144107_setup');
exports.up = function (knex) {
  return knex.schema.createTable('fishWeights', (table) => {
    table.increments('id');
    table.integer('fishingId').unsigned();
    table.jsonb('data');
    table.timestamp('date');
    table.integer('tenantId').unsigned();
    table.integer('userId').unsigned();
    commonFields(table);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('fishWeights');
};
