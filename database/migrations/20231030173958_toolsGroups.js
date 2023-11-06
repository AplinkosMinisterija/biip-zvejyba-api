const { commonFields } = require('./20230405144107_setup');
exports.up = function (knex) {
  return knex.schema.dropTable('toolGroups').createTable('toolsGroups', (table) => {
    table.increments('id');
    table.jsonb('tools');
    table.integer('tenantId').unsigned();
    table.integer('userId').unsigned();
    commonFields(table);
  });
};

exports.down = function (knex) {
  return knex.schema
    .createTable('toolGroups', (table) => {
      table.increments('id');
      table.jsonb('tools');
      table.timestamp('startDate');
      table.integer('startFishingId').unsigned();
      table.timestamp('endDate');
      table.integer('endFishingId').unsigned();
      table.integer('tenantId').unsigned();
      table.integer('userId').unsigned();
      table.integer('locationId');
      table.string('locationName');
      table.enu('locationType', ['ESTUARY', 'POLDERS', 'INLAND_WATERS']);
      commonFields(table);
    })
    .raw(`ALTER TABLE tool_groups ADD COLUMN geom geometry(point, 3346)`)
    .raw(`CREATE INDEX tool_groups_geom_idx ON tool_groups USING GIST (geom)`);
};
