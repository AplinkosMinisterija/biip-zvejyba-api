exports.up = function (knex) {
  return knex.schema.raw(`
  CREATE VIEW built_tools_groups AS SELECT 
  tools_groups.*,
  (
    SELECT to_json(tools_groups_histories.*)::jsonb
    FROM tools_groups_histories
    WHERE tools_group_id = tools_groups.id 
    AND type = 'BUILD_TOOLS'
    AND deleted_at is null
  ) as build_event,
  (
    SELECT to_json(tools_groups_histories.*)::jsonb
    FROM tools_groups_histories
    WHERE tools_group_id = tools_groups.id 
    AND type = 'REMOVE_TOOLS'
    AND deleted_at is null
  ) as remove_event,
  (
    SELECT to_json(tools_groups_histories.*)::jsonb
    FROM tools_groups_histories
    WHERE tools_group_id = tools_groups.id 
    AND type = 'WEIGH_FISH'
    AND deleted_at is null
  )AS weighing_event
    FROM tools_groups;
  `);
};

exports.down = function (knex) {
  return knex.schema.dropView('builtToolsGroups');
};
