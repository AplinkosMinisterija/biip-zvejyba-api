const { commonFields } = require('./20230405144107_setup');

exports.up = function (knex) {
  return knex.schema
    .createTable('toolsGroupsHistories', (table) => {
      table.increments('id');
      table.enu('type', ['BUILD_TOOLS', 'REMOVE_TOOLS', 'WEIGH_FISH']).notNullable();
      table.jsonb('location');
      table.jsonb('data');
      table.integer('fishingId').unsigned();
      table.integer('toolsGroupId').unsigned();
      commonFields(table);
    })
    .raw(`ALTER TABLE tools_groups_histories ADD COLUMN geom geometry(point, 3346)`)
    .raw(`CREATE INDEX tools_groups_geom_idx ON tools_groups_histories USING GIST (geom)`);
};

exports.down = function (knex) {};
