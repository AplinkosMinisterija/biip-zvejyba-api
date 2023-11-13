const { commonFields } = require('./20230405144107_setup');

exports.up = function (knex) {
  return knex.schema
    .createTable('fishingEvents', (table) => {
      table.increments('id');
      table.enu('locationType', ['START', 'END', 'SKIP']);
      table.jsonb('location');
      table.integer('tenantId').unsigned();
      table.integer('userId').unsigned();
      commonFields(table);
    })
    .raw(`ALTER TABLE fishing_events ADD COLUMN geom geometry(point, 3346)`)
    .raw(`CREATE INDEX fishing_events_geom_idx ON fishing_events USING GIST (geom)`)
    .alterTable('fishings', (table) => {
      table.integer('startEventId').unsigned();
      table.integer('endEventId').unsigned();
      table.integer('skipEventId').unsigned();
      table.dropColumn('startDate');
      table.dropColumn('endDate');
      table.dropColumn('skipDate');
    })
    .renameTable('fishWeights', 'weightEvents');
};

exports.down = function (knex) {
  return knex.schema
    .dropTable('fishingEvents')
    .alterTable('fishings', (table) => {
      table.dropColumn('startEventId');
      table.dropColumn('endEventId');
      table.dropColumn('skipEventId');
      table.timestamp('startDate');
      table.timestamp('endDate');
      table.timestamp('skipDate');
    })
    .renameTable('weightEvents', 'fishWeights');
};
