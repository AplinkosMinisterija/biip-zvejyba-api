/**
 * A fisher picks the event location (Kuršių marios bar / polder patch /
 * inland water body) either via automatic GPS detection or via the
 * manual picker when GPS missed. `location_manual` distinguishes those
 * two paths so the admin UI can flag manual picks with a warning icon
 * (current requirement is Kuršių marios only, but adding the column on
 * every event type that carries `location` so we don't have to migrate
 * again later).
 *
 * Default false — historical rows are treated as auto-detected because
 * we have no other signal for them.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable('toolsGroupsEvents', (table) => {
      table.boolean('locationManual').notNullable().defaultTo(false);
    })
    .alterTable('weightEvents', (table) => {
      table.boolean('locationManual').notNullable().defaultTo(false);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .alterTable('toolsGroupsEvents', (table) => {
      table.dropColumn('locationManual');
    })
    .alterTable('weightEvents', (table) => {
      table.dropColumn('locationManual');
    });
};
