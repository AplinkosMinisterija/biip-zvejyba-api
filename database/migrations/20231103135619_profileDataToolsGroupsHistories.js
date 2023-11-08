exports.up = function (knex) {
  return knex.schema.alterTable('toolsGroupsHistories', (table) => {
    table.integer('tenantId').unsigned();
    table.integer('userId').unsigned();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('toolsGroupsHistories', (table) => {
    table.dropColumn('tenantId');
    table.dropColumn('userId');
  });
};
