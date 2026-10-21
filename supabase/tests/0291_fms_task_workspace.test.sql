begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((task_feed_page('mine','pending')->'counts'->>'open')::integer,0,'FMS leaves My Tasks');
select is((task_feed_page('delegated','pending')->'counts'->>'open')::integer,0,'FMS leaves Delegated');
select is((task_feed_page('fms','pending')->'counts'->>'open')::integer,1,'exact personal FMS badge');
select is((get_fms_task_workspace('{}')->>'total')::integer,1,'one actionable visit');
select is((get_fms_task_workspace('{"query":"Synthetic client"}')->>'total')::integer,1,'authorized answer is searchable');
select is((get_fms_task_workspace('{"query":"Do not expose"}')->>'total')::integer,0,'unconfigured notes cannot become searchable names');
select is((get_fms_task_workspace('{}')->'families'->0->>'count')::integer,1,'family count reconciles');
select is((get_fms_task_stage_page((select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')),
 (select id from visit_assignment_fixture where name='flow'),(select id from visit_assignment_fixture where name='call'))->'records'->0->>'name'),'Synthetic client','record card uses authorized initial answer');
reset role;
select ok(not has_function_privilege('anon','get_fms_task_workspace(jsonb,integer,integer)','EXECUTE'),'anon has no workspace grant');
select ok(not has_function_privilege('service_role','get_fms_task_workspace(jsonb,integer,integer)','EXECUTE'),'service role has no employee read grant');
select ok(not has_function_privilege('authenticated','fms_work_record_name(uuid)','EXECUTE'),'name helper is private');
select ok(not exists(
 select 1 from pg_proc function cross join (values('anon'),('service_role')) api_role(name)
 where function.pronamespace='public'::regnamespace
 and function.proname in ('get_fms_task_workspace','get_fms_task_stages','get_fms_task_stage_page')
 and has_function_privilege(api_role.name,function.oid,'EXECUTE')
),'all three hierarchy entry points deny anonymous and service-role execution');
select ok(not exists(
 select 1 from pg_proc function cross join (values('anon'),('authenticated'),('service_role')) api_role(name)
 where function.pronamespace='public'::regnamespace
 and function.proname in ('fms_workspace_rows','fms_workspace_validate','fms_workspace_status_matches',
 'fms_work_record_name','fms_record_name_candidate','set_form_record_name_internal',
 'fms_work_context_before_record_name','save_form_draft_before_record_name','save_published_form_before_record_name')
 and has_function_privilege(api_role.name,function.oid,'EXECUTE')
),'projection and original-writer helpers cannot bypass public authorization');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
select is((get_fms_task_workspace('{}')->>'total')::integer,0,'unassigned employee sees no private activity');
select throws_ok($$select get_fms_task_workspace('{"employeeId":"00000000-0000-4000-8000-000000000001"}')$$,'22023',null,'actor cannot be chosen by client');
select throws_ok($$select get_fms_task_workspace('{}',0,51)$$,'22023',null,'family pages bounded');
select throws_ok($$select task_feed_page('arbitrary','pending')$$,'22023',null,'arbitrary subsection rejected');
reset role;
select * from finish();
rollback;
