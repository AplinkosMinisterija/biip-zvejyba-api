/**
 * NO-OP.
 *
 * This slot used to add four partial UNIQUE indices (tenant_users,
 * tools, tenants, fishings) as defense-in-depth against race-induced
 * duplicates. The original migration ran cleanly on dev but crashed on
 * staging — staging carries enough history that real duplicates exist
 * in at least one of those tables, and `CREATE UNIQUE INDEX` against
 * pre-existing duplicates fails the whole transaction (knex wraps each
 * migration in `BEGIN…COMMIT`).
 *
 * Knex migration transactions are atomic, so on staging the crash
 * rolled back every index this file tried to create — knex still sees
 * this migration as "not yet run". By turning the body into a no-op
 * we let staging's next boot move past this entry without crashing,
 * while dev (where the indices DID land) keeps them because dev's
 * knex_migrations row already says this filename ran.
 *
 * The defense-in-depth value is deferred to a follow-up PR that will
 * (1) audit each table for existing duplicates, (2) decide per pair
 * whether to soft-delete or keep both, (3) only then add the constraint.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (_knex) {
  // intentionally empty — see header comment
};

exports.down = async function (_knex) {
  // intentionally empty — no schema delta to roll back
};
