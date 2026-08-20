begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(6);

select has_table('public','fms_starter_assignments','published workflows create persistent starting-form assignments');
select policies_are('public','fms_starter_assignments',array['fms_starter_assignments_select'],'starter assignments are visible only through the personal queue policy');
select ok((select pg_get_functiondef('publish_fms_flow_with_audit(uuid)'::regprocedure) like '%queue_fms_starter_assignments%'),'publishing queues starting-form assignments');
select ok((select pg_get_functiondef('publish_fms_flow_with_audit(uuid)'::regprocedure) like '%fms_starter_assignments set status=''cancelled''%'),'revisions cancel obsolete starting-form assignments');
select ok((select pg_get_functiondef('get_home_summary(jsonb)'::regprocedure) like '%fms_starters%'),'home summary returns assigned starting forms');
select ok((select pg_get_functiondef('get_home_summary(jsonb)'::regprocedure) like '%starter.user_profile_id=v_actor.id%'),'starter forms are scoped to the signed-in user');

select * from finish();
rollback;
