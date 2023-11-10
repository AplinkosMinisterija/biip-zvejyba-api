exports.up = function (knex) {
  return knex.schema
    .dropView('builtToolsGroups')
    .alterTable('toolsGroups', (table) => {
      table.integer('buildEventId').unsigned();
      table.integer('removeEventId').unsigned();
      table.integer('weightEventId').unsigned();
    })
    .alterTable('toolsGroupsHistories', (table) => {
      table.dropColumn('toolsGroupId');
      table.integer('updatedEventId').unsigned();
    });
};

exports.down = function (knex) {
  return knex.schema
    .raw(
      `
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
  `,
    )
    .alterTable('toolsGroups', (table) => {
      table.dropColumn('buildEventId');
      table.dropColumn('removeEventId');
      table.dropColumn('weightEventId');
    })
    .alterTable('toolsGroupsHistories', (table) => {
      table.integer('toolsGroupsId').unsigned();
      table.dropColumn('updatedEventId');
    });
};
