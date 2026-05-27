/**
 * Defensive UNIQUE constraints, all expressed as PARTIAL unique indices
 * gated on `deleted_at IS NULL` so soft-deleted rows don't collide with
 * fresh ones (audit security #A8 + #M7).
 *
 * Catches:
 *   - `tenantUsers (tenantId, userId)` — race-induced duplicate
 *     memberships from concurrent `tenantUsers.create`
 *   - `tools (sealNr)` — `validateSealNr` is an app-side check that
 *     loses races with `validateSealNr` running on another node
 *   - `tenants (code)` — duplicate company imports through E-vartai +
 *     `tenants.importBatch`
 *   - `fishings (userId) WHERE end_event_id IS NULL` — guarantees the
 *     single-active-fishing invariant that `startFishing` checks in app
 *
 * If this migration fails on an existing duplicate, that's a real data
 * issue — investigate the pair before re-running, don't `--force`.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // tenant_users (tenantId, userId) partial unique
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_tenant_id_user_id_active_unique
      ON tenant_users (tenant_id, user_id)
      WHERE deleted_at IS NULL;
  `);

  // tools (sealNr) partial unique
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS tools_seal_nr_active_unique
      ON tools (seal_nr)
      WHERE deleted_at IS NULL;
  `);

  // tenants (code) partial unique
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS tenants_code_active_unique
      ON tenants (code)
      WHERE deleted_at IS NULL;
  `);

  // fishings active-per-user invariant
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS fishings_user_id_active_unique
      ON fishings (user_id)
      WHERE end_event_id IS NULL AND deleted_at IS NULL;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS fishings_user_id_active_unique;`);
  await knex.raw(`DROP INDEX IF EXISTS tenants_code_active_unique;`);
  await knex.raw(`DROP INDEX IF EXISTS tools_seal_nr_active_unique;`);
  await knex.raw(`DROP INDEX IF EXISTS tenant_users_tenant_id_user_id_active_unique;`);
};
