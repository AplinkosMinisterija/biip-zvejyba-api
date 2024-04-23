exports.up = function (knex) {
  return knex.schema.alterTable('researches', (table) => {
    table.float('totalBiomass');
    table.float('totalFishesAbundance');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('researches', (table) => {
    table.dropColumn('totalFishesAbundance');
    table.dropColumn('totalBiomass');
  });
};
