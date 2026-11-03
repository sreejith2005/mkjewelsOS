begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
reset role;

create function pg_temp.fx(p text) returns uuid language sql as $$ select id from visit_assignment_fixture where name=p $$;
with f as (insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version)
  select tenant_id,gen_random_uuid(),1,'Safety net draft','tenant','draft',true,created_by,updated_by,2 from fms_flows where id=pg_temp.fx('flow') returning id)
insert into visit_assignment_fixture select 'draft_flow',id from f;
with s as (insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
  values(pg_temp.fx('draft_flow'),'safety_branch','Safety branch','branch',0,true,'{"deadlineEnabled":false}') returning id)
insert into visit_assignment_fixture select 'safety_branch',id from s;

-- A send-back / v1-style insert of an open person step without a deadline.
insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,activated_at)
  values(pg_temp.fx('instance'),pg_temp.fx('demo'),'pending','2026-11-03 12:30 Asia/Kolkata') returning id \gset sent_back_
select is((select planned_datetime from fms_instance_stages where id=:'sent_back_id'),'2026-11-03 21:00 Asia/Kolkata'::timestamptz,
  'an open person step created without a deadline at 12:30 PM is due 9 PM');
insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,activated_at)
  values(pg_temp.fx('instance'),pg_temp.fx('demo'),'in_progress','2026-11-03 17:45 Asia/Kolkata') returning id \gset late_
select is((select planned_datetime from fms_instance_stages where id=:'late_id'),'2026-11-04 15:00 Asia/Kolkata'::timestamptz,
  'one created at 5:45 PM is due 3 PM the next day');
insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,planned_datetime,activated_at)
  values(pg_temp.fx('instance'),pg_temp.fx('demo'),'pending','2026-11-08 19:00 Asia/Kolkata','2026-11-03 12:30 Asia/Kolkata') returning id \gset explicit_
select is((select planned_datetime from fms_instance_stages where id=:'explicit_id'),'2026-11-08 19:00 Asia/Kolkata'::timestamptz,
  'a resolved deadline is never replaced');
insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,activated_at,actual_datetime)
  values(pg_temp.fx('instance'),pg_temp.fx('demo'),'completed',now(),now()) returning id \gset done_
select is((select planned_datetime from fms_instance_stages where id=:'done_id'),null,'completed history is not dated');
insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,activated_at,outcome)
  values(pg_temp.fx('instance'),pg_temp.fx('demo'),'pending',now(),'condition_skipped') returning id \gset skipped_
select is((select planned_datetime from fms_instance_stages where id=:'skipped_id'),null,'a skipped step is not dated');
insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,activated_at)
  values(pg_temp.fx('instance'),pg_temp.fx('safety_branch'),'in_progress',now()) returning id \gset branch_
select is((select planned_datetime from fms_instance_stages where id=:'branch_id'),null,'routing nodes are not dated');
select ok(not has_function_privilege('authenticated','fms_visit_day_half_due()','execute'),'the trigger function is not callable by users');

select * from finish();
rollback;
