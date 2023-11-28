exports.up = function (knex) {
  return knex.schema
    .raw('CREATE SCHEMA IF NOT EXISTS publishing')
    .withSchema('publishing')
    .createViewOrReplace('fishings', function (view) {
      view.as(
        knex.raw(`
  with we as (
    select we.fishing_id, jsonb_agg(jsonb_build_object('fish_type', json_build_object('id', ft.id, 'label', ft.label, 'photo', ft.photo), 'count', fishes.value::int, 'date', we.date)) as fishes 
    from public.weight_events we, jsonb_each_text(we.data) fishes
    left join public.fish_types ft on ft.id = fishes.key::int
    where we.tools_group_id is null
    group by we.fishing_id
  )
  select f.id, f.type, f.created_at, coalesce(start_event.geom, end_event.geom, skip_event.geom) as geom,
    start_event.created_at started_at, 
    end_event.created_at ended_at, 
    skip_event.created_at skipped_at,
    we.fishes as weigh_events,
    CASE
	    WHEN skip_event.id is not null THEN 'SKIPPED'
	    WHEN end_event.id is not null THEN 'FINISHED'
	    WHEN start_event.id is not null THEN 'STARTED'
	  END AS status
  from public.fishings f
  left join public.fishing_events start_event on start_event.id = f.start_event_id
  left join public.fishing_events end_event on end_event.id = f.end_event_id
  left join public.fishing_events skip_event on skip_event.id = f.skip_event_id
  left join we on we.fishing_id = f.id
  where f.start_event_id is not null or f.skip_event_id is not null
`),
      );
    });
};

exports.down = function (knex) {
  return knex.schema
    .withSchema('publishing')
    .dropViewIfExists('fishings')
    .raw('DROP SCHEMA IF EXISTS publishing');
};
