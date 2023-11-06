exports.up = function (knex) {
  return knex.schema
    .alterTable('toolsGroups', (table) => {
      table.dropColumn('tools');
    })
    .alterTable('toolsGroups', (table) => {
      table.specificType('tools', 'int[]');
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('toolsGroups', (table) => {
      table.dropColumn('tools');
    })
    .alterTable('toolsGroups', (table) => {
      table.jsonb('tools');
    });
};
