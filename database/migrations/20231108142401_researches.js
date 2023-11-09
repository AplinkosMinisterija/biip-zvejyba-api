const { commonFields } = require('./20230405144107_setup');
exports.up = function (knex) {
  return knex.schema
    .createTable('researches', (table) => {
      table.increments('id');
      table.string('cadastralId', 255);
      table.jsonb('waterBodyData');
      table.timestamp('startAt');
      table.timestamp('endAt');
      table.float('predatoryFishesRelativeAbundance');
      table.float('predatoryFishesRelativeBiomass');
      table.float('averageWeight');
      table.float('valuableFishesRelativeBiomass');
      table.float('conditionIndex');
      table.jsonb('files');
      table.jsonb('previousResearchData');
      table.integer('tenantId').unsigned();
      table.integer('userId').unsigned();
      commonFields(table);
    })
    .raw(`ALTER TABLE researches ADD COLUMN geom geometry(point, 3346)`)
    .raw(`CREATE INDEX researches_geom_idx ON researches USING GIST (geom)`)
    .createTable('researchFishes', (table) => {
      table.increments('id');
      table.integer('fishTypeId').unsigned();
      table.integer('researchId').unsigned();
      table.float('abundance');
      table.float('biomass');
      table.float('abundancePercentage');
      table.float('biomassPercentage');
      commonFields(table);
    });
};

exports.down = function (knex) {
  return knex.schema.dropTable('researches');
};
