begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(6);

select has_table('public','fms_starter_assignments','published workflows create persistent starting-form assignments');
select policies_are('public','fms_starter_assignments',array['fms_starter_assignments_select'],'starter assignments are visible only through the personal queue policy');
select ok((select pg_get_functiondef('publish_fms_flow_with_audit(uuid)'::regprocedure) like '%queue_fms_starter_assignments%'),'publishing queues starting-form assignments');
select ok((select pg_get_functiondef('publish_fms_flow_with_audit(uuid)'::regprocedure) like '%update fms_starter_assignments starter set status=''cancelled''%'),'revisions cancel obsolete starting-form assignments');
select ok((select pg_get_functiondef('get_home_summary(jsonb)'::regprocedure) like '%from fms_instance_stages fis join fms_instances%'),'home summary returns assigned live FMS stages');
select ok((select pg_get_functiondef('get_home_summary(jsonb)'::regprocedure) like '%fms_instance_stage_assignees a where a.fms_instance_stage_id=fis.id and a.user_profile_id=v_actor.id and a.is_active%'),'live FMS stages are scoped to the signed-in user');

select * from finish();
rollback;
