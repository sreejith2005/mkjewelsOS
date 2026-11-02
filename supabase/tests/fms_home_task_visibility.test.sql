begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Submits the exact starting form through the audited RPC, selecting employee B
-- from its employee question. The resulting Call assignment has no deadline.
\ir helpers/fms_visit_assignment_fixture.psql
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is(jsonb_array_length(get_home_summary()->'fms_stages'),1,'Home shows the form-selected employee assignment');
select is((get_fms_task_workspace('{"dateScope":"overall"}')->>'total')::integer,1,'Overall FMS hierarchy includes undated assigned work');
select is((get_fms_task_workspace('{"dateScope":"overall"}')->'counts'->>'active')::integer,1,'Overall badge counts the same undated assignment');
select is((get_fms_task_workspace('{"dateScope":"today"}')->>'total')::integer,0,'explicit Today remains a strict scheduled-date filter');
select is(jsonb_array_length(jsonb_path_query_array(get_fms_task_stages(
 (select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')),
 '{"dateScope":"overall"}'),'$[*] ? (@.count > 0)')),1,'employee can drill into the assigned stage');
select is((get_fms_task_stage_page(
 (select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')),
 (select id from visit_assignment_fixture where name='flow'),
 (select id from visit_assignment_fixture where name='call'),false,'{"dateScope":"overall"}')->>'total')::integer,1,
 'stage page includes the assignment counted on Home and FMS');
select is((get_fms_task_stage_page(
 (select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')),
 (select id from visit_assignment_fixture where name='flow'),
 (select id from visit_assignment_fixture where name='call'),false,'{"dateScope":"overall"}')->'records'->0->>'id'),
 get_home_summary()->'fms_stages'->0->>'stage_id','Home and Tasks open the same durable stage assignment');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
select is((get_fms_task_workspace('{"dateScope":"overall"}')->>'total')::integer,0,'Overall does not expose work to an unassigned employee');
reset role;
select * from finish();
rollback;
