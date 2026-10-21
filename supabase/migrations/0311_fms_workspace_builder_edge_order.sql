-- Match fmsOutgoingStageKeys: saved parallel targets, saved branch rules,
-- and conditional routes before the ordinary default fallback.
set search_path=public,extensions;
do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('get_fms_task_stages(uuid,jsonb)'::regprocedure);
 amended:=replace(definition,'d.name,d.sort_order,d.default_next_stage_id',
  'd.name,d.sort_order,d.step_type,d.default_next_stage_id');
 amended:=replace(amended,
 $old$(select jsonb_agg(distinct target) from unnest(array_remove(array[d.default_next_stage_id]||d.parallel_target_stage_ids,null)
      ||coalesce((select array_agg(next_stage_id order by sort_order) from fms_branch_rules where fms_stage_id=d.id and next_stage_id is not null),'{}')) target)$old$,
 $new$(select jsonb_agg(ordered.target order by ordered.position) from (
    select target,min(ordinality) position from unnest(
     case when d.step_type='parallel_start' then coalesce(d.parallel_target_stage_ids,'{}'::uuid[])
     else coalesce((select array_agg(next_stage_id order by sort_order,id) from fms_branch_rules
       where fms_stage_id=d.id and next_stage_id is not null),'{}'::uuid[])
      ||case when d.step_type<>'branch' and not exists(select 1 from fms_branch_rules
        where fms_stage_id=d.id and condition_operator='default')
       then array_remove(array[d.default_next_stage_id],null) else '{}'::uuid[] end end
    ) with ordinality outgoing(target,ordinality) where target is not null group by target
   ) ordered)$new$);
 if amended=definition or position('jsonb_agg(distinct target)' in amended)>0 then
  raise exception 'Review ordered FMS graph projection';
 end if;
 execute amended;
end $$;
notify pgrst,'reload schema';
