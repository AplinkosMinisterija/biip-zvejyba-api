exports.up = function (knex) {
  return knex.schema.raw(`
  CREATE MATERIALIZED VIEW fishing_events AS
  SELECT 'WEIGH_FISH' AS type, created_at AS date, fishing_id, tools_group_id, user_id, tenant_id
  FROM tools_groups_histories
  WHERE type = 'WEIGH_FISH' AND deleted_at is null
  UNION ALL
  SELECT 'START_FISHING' AS type, start_date AS date, id as fishing_id, null as tools_group_id, user_id, tenant_id
  FROM fishings 
  WHERE deleted_at is null
  UNION ALL
  SELECT 'END_FISHING' AS type, end_date AS date, id as fishing_id, null as tools_group_id, user_id, tenant_id
  FROM fishings  
  WHERE end_date is not null AND deleted_at is null
  UNION ALL
  SELECT type, created_at AS date, fishing_id, tools_group_id, user_id, tenant_id
  FROM tools_groups_histories
  WHERE type IN ('BUILD_TOOLS', 'REMOVE_TOOLS') AND deleted_at is null
  GROUP BY type, created_at, fishing_id, tools_group_id, user_id, tenant_id
  UNION ALL
  SELECT 'WEIGHT_TOTAL' AS type, created_at AS date, fishing_id,null as tools_group_id, user_id, tenant_id
  FROM fish_weights
  WHERE deleted_at is null;
  `);
};

exports.down = function (knex) {
  return knex.schema.dropMaterializedView('fishingEvents');
};
