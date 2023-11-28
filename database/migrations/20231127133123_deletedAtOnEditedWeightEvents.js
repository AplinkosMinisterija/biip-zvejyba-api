exports.up = function (knex) {
  return knex.schema.raw(`
    CREATE OR REPLACE FUNCTION update_deleted_at() RETURNS TRIGGER AS $$
    BEGIN UPDATE weight_events SET deleted_at = NOW(), deleted_by = NEW.created_by
    WHERE fishing_id = NEW.fishing_id AND tools_group_id = NEW.tools_group_id AND id <> NEW.id; -- Exclude the newly inserted row
    RETURN NEW; 
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER after_insert_update_deleted_at
    AFTER INSERT ON weight_events
    FOR EACH ROW
    EXECUTE FUNCTION update_deleted_at()
    `);
};

exports.down = function (knex) {
  return knex.schema.raw(`DROP TRIGGER IF EXISTS after_insert_update_deleted_at ON weight_events;
`);
};
