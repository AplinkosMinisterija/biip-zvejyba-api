exports.up = function (knex) {
  return knex.schema
    .dropView('builtToolsGroups')
    .alterTable('toolsGroups', (table) => {
      table.integer('buildEventId').unsigned();
      table.integer('removeEventId').unsigned();
    })
    .alterTable('toolsGroupsHistories', (table) => {
      table.dropColumn('toolsGroupId');
    })
    .alterTable('fishWeights', (table) => {
      table.integer('toolsGroupId').unsigned();
      table.jsonb('location');
    })
    .raw(`ALTER TABLE fish_weights ADD COLUMN geom geometry(point, 3346)`)
    .raw(`CREATE INDEX fish_weights_geom_idx ON fish_weights USING GIST (geom)`)
    .raw(
      `ALTER TABLE "tools_groups_histories" 
        DROP CONSTRAINT "tools_groups_histories_type_check", 
        ADD CONSTRAINT "tools_groups_histories_type_check" 
        CHECK ("type" IN ('BUILD_TOOLS', 'REMOVE_TOOLS'))`,
    )
    .renameTable('toolsGroupsHistories', 'toolsGroupsEvents');
};

exports.down = function (knex) {
  return knex.schema
    .raw(
      `CREATE VIEW built_tools_groups AS SELECT 
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
      ) AS weighing_event
        FROM tools_groups;`,
    )
    .alterTable('toolsGroups', (table) => {
      table.dropColumn('buildEventId');
      table.dropColumn('removeEventId');
    })
    .alterTable('toolsGroupsHistories', (table) => {
      table.integer('toolsGroupsId').unsigned();
    })
    .alterTable('fish_weights', (table) => {
      table.dropColumn('toolsGroupId');
      table.dropColumn('location');
      table.dropColumn('geom');
    })
    .raw(
      `ALTER TABLE "tools_groups_histories" 
        DROP CONSTRAINT "tools_groups_histories_type_check", 
        ADD CONSTRAINT "tools_groups_histories_type_check" 
        CHECK ("type" IN ('BUILD_TOOLS', 'REMOVE_TOOLS', 'WEIGH_FISH'))`,
    )
    .renameTable('toolsGroupsEvents', 'toolsGroupsHistories');
};
