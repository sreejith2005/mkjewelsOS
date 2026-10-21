begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
reset role;
update fms_instances set status='completed' where id=(select id from visit_assignment_fixture where name='instance');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((get_fms_task_workspace('{}')->>'activeTotal')::integer,0,'a terminal workflow cannot inflate actionable count');
select is((get_fms_task_workspace('{"status":"waiting"}')->>'total')::integer,1,'unfinished visit on terminal workflow remains visible as waiting');
select is((task_feed_page('fms','pending')->'counts'->>'open')::integer,0,'flat tab count shares terminal actionability');
select throws_ok($$select get_fms_task_workspace('{"from":"tomorrow"}')$$,'22023',null,'server rejects relative dates');
select throws_ok($$select get_fms_task_workspace('{"to":"infinity"}')$$,'22023',null,'server rejects infinite dates');
reset role;
insert into tenant_section_controls(tenant_id,section_availability)
values((select id from visit_assignment_fixture where name='tenant'),'{"fms_builder":false}')
on conflict(tenant_id) do update set section_availability=excluded.section_availability;
set local role authenticated;
select is((get_fms_task_workspace('{"status":"waiting"}')->>'total')::integer,0,
 'disabled FMS section hides hierarchy assignments');
select is((task_workspace_page('{"subsection":"fms"}')->>'total')::integer,0,
 'disabled FMS section hides direct search results');
reset role;
select * from finish();
rollback;
