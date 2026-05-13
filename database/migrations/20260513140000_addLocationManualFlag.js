/**
 * Žvejys gali pasirinkti įvykio lokaciją (Kuršių marių barą / polderio
 * vietą / vidaus vandens telkinį) GPS automatiškai arba rankiniu būdu,
 * jei nustatymas nepataikė. Šis flag'as `location_manual` skiriasi tarp
 * tų dviejų atvejų, kad admin pusėje galėtume parodyti šauktuko ikoną
 * (kol kas reikalavimas tik Kuršių marioms, bet kolumną pridedam viskam
 * kas turi `location` field'ą, kad nereikėtų vėliau papildyti).
 *
 * Default false — esamos eilutės laikomos automatiškai nustatytomis,
 * nes kitokios info istoriškai nėra.
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
