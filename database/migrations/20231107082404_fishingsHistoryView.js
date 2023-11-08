exports.up = function (knex) {
  return knex.schema.raw(`
CREATE OR REPLACE VIEW fishing_events AS
    SELECT 'WEIGH_TOTAL' AS type, created_at as date, fish_weights.id as fish_weight_id, null as tools_groups_history_id, null as tools_group_id, fishing_id, user_id, tenant_id, created_at, deleted_at
    FROM fish_weights
    WHERE deleted_at is null GROUP BY id
UNION ALL
    SELECT 'WEIGH_FISH' AS type, created_at as date, null as fish_weight_id, id as tools_groups_history_id, tools_group_id, fishing_id, user_id, tenant_id, created_at, deleted_at
    FROM tools_groups_histories
    WHERE type = 'WEIGH_FISH' AND deleted_at is null 
UNION ALL
    SELECT 'START_FISHING' AS type, start_date AS date, null as fish_weight_id, null as tools_groups_history_id, null as tools_group_id, id as fishing_id, user_id, tenant_id,created_at, deleted_at
    FROM fishings 
    WHERE deleted_at is null
UNION ALL
    SELECT 'END_FISHING' AS type, end_date AS date, null as fish_weight_id, null as tools_groups_history_id, null as tools_group_id, id as fishing_id, user_id, tenant_id,created_at, deleted_at
    FROM fishings  
    WHERE end_date is not null AND deleted_at is null
UNION ALL
    SELECT type, created_at as date, null as fish_weight_id, id as tools_groups_history_id, tools_group_id,fishing_id,  user_id, tenant_id, created_at, deleted_at
    FROM tools_groups_histories
    WHERE type IN ('BUILD_TOOLS', 'REMOVE_TOOLS') AND deleted_at is null
    GROUP BY id, type, created_at, tools_group_id, fishing_id, user_id, tenant_id, created_at, deleted_at;
  `);
};

exports.down = function (knex) {
  return knex.schema.dropMaterializedView('fishingEvents');
};
