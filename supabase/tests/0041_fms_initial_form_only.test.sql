begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(5);

select function_owner_is('public','assert_fms_flow_publishable',array['uuid'],'postgres','publish validator owner is postgres');
select ok(not has_function_privilege('authenticated','assert_fms_flow_publishable(uuid)','EXECUTE'),'publish helper remains unavailable to clients');
select ok((select pg_get_functiondef('assert_fms_flow_publishable(uuid)'::regprocedure) like '%The initial Form step needs a published Form%'),'initial details Form is explicitly required');
select ok((select pg_get_functiondef('assert_fms_flow_publishable(uuid)'::regprocedure) not like '%s.step_type=''form'' and s.form_template_id is null%'),'later Form steps are not globally required to link templates');
select ok((select pg_get_functiondef('complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)'::regprocedure) like '%first_stage%order by first_stage.sort_order%'),'runtime requires a submission only for the initial linked Form');

select * from finish();
rollback;
