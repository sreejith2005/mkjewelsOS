begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select set_config('test.fms.defer_start','true',true);
\ir helpers/fms_visit_assignment_fixture.psql
reset role;
update fms_starter_assignments set created_at=now()-interval '3 days' where id=(select id from visit_assignment_fixture where name='starter');
set local role authenticated;
select is((get_fms_task_workspace('{"status":"pending"}')->>'total')::integer,1,'undated starter remains pending');
select is((task_feed_page('fms','pending')->>'total')::integer,1,'legacy task paging uses the same undated starter status');
select is((task_feed_page('fms','overdue')->>'total')::integer,0,'creation time is not an invented due date');
select is(get_fms_task_stage_page((select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')),
 (select id from visit_assignment_fixture where name='flow'),(select id from visit_assignment_fixture where name='initial'),true)->'records'->0->'dueAt','null'::jsonb,'starter card has no fabricated due date');
reset role;
select * from finish();
rollback;
