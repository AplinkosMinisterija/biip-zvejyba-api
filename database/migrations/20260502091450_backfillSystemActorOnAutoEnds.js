/**
 * Pora prie ankstesnio fix'o (PR #110): tas migravimas sukūrė END
 * event'us kaip „suklastotas vartotojas" — `user_id` ir `created_by`
 * buvo užkrauti realių vartotojų ID, nors veiksmą padarė sistema.
 *
 * Šis backfill'as randa tas pačias eilutes pagal jų signature
 * (type=END, deleted_at IS NULL, created_at exact match į
 * `start_day 23:59:59 Europe/Vilnius` be jokios fracinės sekundės dalies —
 * realūs vartotojo END'ai turi mikrosekundžių, mūsų sintetiniai ne) ir nuvalo:
 *   fishing_events.user_id  → NULL
 *   fishing_events.created_by → NULL
 *   fishings.updated_by    → NULL  (taip pat užkrautas to paties)
 *
 * Idempotentinė: pakartotinai paleidus, atitinkamos eilutės jau yra
 * NULL ir UPDATE'as no-op'ina. tenant_id sąmoningai paliekam — sistema
 * vis tiek elgiasi tenant'o kontekste.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.raw(`
    WITH targets AS (
      SELECT fe.id AS event_id, f.id AS fishing_id
      FROM fishing_events fe
      JOIN fishings f ON f.end_event_id = fe.id
      WHERE fe.type = 'END'
        AND fe.deleted_at IS NULL
        AND date_trunc('second', fe.created_at) = fe.created_at
        AND fe.created_at = (
          (date_trunc('day', f.created_at AT TIME ZONE 'Europe/Vilnius')
            + interval '1 day' - interval '1 second')
          AT TIME ZONE 'Europe/Vilnius'
        )
    ),
    upd_events AS (
      UPDATE fishing_events
      SET user_id = NULL, created_by = NULL
      FROM targets
      WHERE fishing_events.id = targets.event_id
      RETURNING fishing_events.id
    )
    UPDATE fishings
    SET updated_by = NULL
    FROM targets
    WHERE fishings.id = targets.fishing_id;
  `);
};

/**
 * No-op down — atstatyti suklastotą user_id į konkrečius vartotojus
 * neturim iš ko.
 *
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
exports.down = async function (_knex) {};
