/**
 * One-shot data fix: close every fishing that was started on a previous
 * Europe/Vilnius day and never received an END event. Caused by the
 * `endFishings` cron not firing — the `Cron` mixin was missing on the
 * fishings service. Pairs with the cron-mixin fix in the same PR.
 *
 * Some legacy rows have NULL start_event_id (likely from very old
 * data — observed on staging: ids 296, 310, 317, 332, 339). For those
 * we fall back to fishings.tenant_id / user_id and let END.geom be NULL.
 *
 * Idempotent: filtered by end_event_id IS NULL, so re-running is a no-op.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.raw(`
    DO $$
    DECLARE
      f RECORD;
      end_ts TIMESTAMPTZ;
      new_event_id INT;
    BEGIN
      FOR f IN
        SELECT
          fi.id,
          COALESCE(se.tenant_id, fi.tenant_id) AS tenant_id,
          COALESCE(se.user_id, fi.user_id)     AS user_id,
          COALESCE(se.geom, fi.geom)           AS geom,
          fi.created_at
        FROM fishings fi
        LEFT JOIN fishing_events se ON se.id = fi.start_event_id
        WHERE fi.end_event_id IS NULL
          AND fi.deleted_at IS NULL
          AND (fi.created_at AT TIME ZONE 'Europe/Vilnius')
              < date_trunc('day', now() AT TIME ZONE 'Europe/Vilnius')
        ORDER BY fi.id
      LOOP
        end_ts := ((date_trunc('day', f.created_at AT TIME ZONE 'Europe/Vilnius')
                    + interval '1 day' - interval '1 second')
                    AT TIME ZONE 'Europe/Vilnius');

        INSERT INTO fishing_events
          (type, tenant_id, user_id, geom, created_at, created_by)
        VALUES
          ('END', f.tenant_id, f.user_id, f.geom, end_ts, f.user_id)
        RETURNING id INTO new_event_id;

        UPDATE fishings
        SET end_event_id = new_event_id,
            updated_at   = end_ts,
            updated_by   = f.user_id
        WHERE id = f.id;
      END LOOP;
    END
    $$;
  `);
};

/**
 * No-op down: undoing a one-shot data fix would re-open finalized fishings
 * and orphan the END events we just created — not desirable.
 *
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
exports.down = async function (_knex) {};
