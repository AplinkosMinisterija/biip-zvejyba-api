exports.up = function (knex) {
  return knex.schema.raw(`
  CREATE VIEW built_tools_groups AS SELECT 
    tg.*,
    tg.build_event::jsonb ->>'fishing_id' as fishing_id,
    tg.build_event::jsonb ->'location'->>'id' as location_id,
    (
      SELECT fishings.type
      FROM fishings
      WHERE tg.build_event::jsonb ->>'fishing_id' = fishings.id::text
    ) as location_type
    FROM (
      SELECT
      tools_groups.*,
      (SELECT to_json(tools_groups_histories)::jsonb
        FROM tools_groups_histories
        WHERE tools_groups_histories.tools_group_id = tools_groups.id 
        AND tools_groups_histories.type = 'BUILD_TOOLS'
        AND deleted_at is null
      ) AS build_event,
      (SELECT to_json(tools_groups_histories)::jsonb
        FROM tools_groups_histories
        WHERE tools_groups_histories.tools_group_id = tools_groups.id 
        AND tools_groups_histories.type = 'REMOVE_TOOLS'
        AND deleted_at is null
       )AS remove_event,
      (SELECT to_json(tools_groups_histories)::jsonb
        FROM tools_groups_histories
         WHERE tools_groups_histories.tools_group_id = tools_groups.id 
        AND tools_groups_histories.type = 'WEIGH_FISH'
        AND deleted_at is null
       )AS weighing_event
      FROM tools_groups
    ) as tg
  `);
};

exports.down = function (knex) {
  return knex.schema.dropView('builtToolsGroups');
};
