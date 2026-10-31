begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select is(fms_follow_up_datetime('{}','{}','2026-10-10 17:30+00'), '2026-10-11 05:30+00'::timestamptz,'day ten defaults to day eleven at 11 IST');
select is(fms_follow_up_datetime('{"dateFieldKey":"date","timeFieldKey":"time"}','{"date":"2026-10-12","time":"14:15"}','2026-10-10 04:00+00'), '2026-10-12 08:45+00'::timestamptz,'requested date/time wins');
select is(fms_follow_up_datetime('{"dateFieldKey":"date"}','{"date":"2026-10-12"}','2026-10-10 04:00+00'), '2026-10-12 05:30+00'::timestamptz,'requested date uses default clock');
select is(fms_follow_up_datetime('{"workingDaysOnly":true}','{}','2026-10-09 04:00+00'), '2026-10-12 05:30+00'::timestamptz,'optional weekend handling moves to Monday');
select is(fms_follow_up_datetime('{"unit":"hours","delay":3}','{}','2026-10-10 04:00+00'), '2026-10-10 07:00+00'::timestamptz,'hour delay is elapsed time');
select ok(task_calendar_scope_matches('today','2026-10-11 18:30+00','pending','2026-10-11 19:00+00'),'IST midnight starts the new business date');
select ok(not task_calendar_scope_matches('today','2026-10-12 18:30+00','pending','2026-10-11 19:00+00'),'next IST midnight is excluded');
select ok(not task_calendar_scope_matches('today','2026-10-11 18:29:59+00','pending','2026-10-11 19:00+00'),'previous date excluded from strict Today');
select ok(task_calendar_scope_matches('overdue','2026-10-11 18:29:59+00','pending','2026-10-11 19:00+00'),'previous unfinished date belongs to Overdue');
select ok(not task_calendar_scope_matches('overdue','2026-10-11 18:29:59+00','completed','2026-10-11 19:00+00'),'completed history is not overdue');
select ok(task_calendar_scope_matches('overall','2027-10-11 18:30+00','pending','2026-10-11 19:00+00'),'Overall includes future');

select is(fms_form_due_resolution('{"deadlineEnabled":false,"formDue":{"onMissing":"none"},"followUp":{"schedule":{"delay":1,"unit":"days"}}}',null,null,null,'task')->>'source','none','explicit form due configuration retains precedence over follow-up scheduling');

select is(fms_form_due_resolution('{"deadlineEnabled":false,"followUp":{"schedule":{"delay":1,"unit":"days"}}}',null,null,null,'task')->>'dueAt',null::text,'No due date remains disabled when a follow-up schedule is present');

-- The existing audited fixture configures incoming routing and employee rules.
-- Inject this test's optional metadata before its draft is published.
create function pg_temp.schedule_fixture_stage() returns trigger language plpgsql as $$
begin
 if new.stage_key='call' then new.planned_time_rule:=new.planned_time_rule||'{"deadlineEnabled":true,"timingMethod":"tat_hours","tatHours":1,"followUp":{"maxVisits":10,"onLimit":"hold","schedule":{"delay":1,"unit":"days","time":"11:00"}}}'::jsonb; end if;
 return new;
end $$;
create trigger scheduling_fixture_stage before insert on fms_stages for each row execute function pg_temp.schedule_fixture_stage();
\ir helpers/fms_visit_assignment_fixture.psql
reset role;
drop trigger scheduling_fixture_stage on fms_stages;
select is((select planned_datetime from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')),
 (((now() at time zone 'Asia/Kolkata')::date+1)+time '11:00') at time zone 'Asia/Kolkata','matching successor activates with next-day 11 IST deadline');
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='demo')),0,'unmatched successor is not created');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((get_fms_task_workspace('{"dateScope":"today"}')->>'total')::integer,0,'future FMS work excluded from Today count');
select is((get_fms_task_workspace('{"dateScope":"today"}')->>'activeTotal')::integer,0,'Today active total shares the same strict date scope');
select is((get_fms_task_workspace('{"dateScope":"overall"}')->>'total')::integer,1,'Overall retains scheduled successor');
select is((get_fms_task_workspace('{"dateScope":"overall"}')->'counts'->>'active')::integer,1,'Overall active badge matches hierarchy');
select is((get_fms_task_workspace('{"dateScope":"overall","query":"no-such-work-item"}')->>'activeTotal')::integer,0,'active total reuses the searched authorized relation');
select is((get_fms_task_stage_page((select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')),
 (select id from visit_assignment_fixture where name='flow'),(select id from visit_assignment_fixture where name='call'),false,'{"dateScope":"today"}')->>'total')::integer,0,'Today drilldown uses same date scope');
select is((get_fms_task_stage_page((select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')),
 (select id from visit_assignment_fixture where name='flow'),(select id from visit_assignment_fixture where name='call'),false,'{"dateScope":"overall"}',0,1)->>'total')::integer,1,'Overall page total equals scoped badge');
select is((task_workspace_page('{"scope":"today","subsection":"fms","status":"pending","mode":"board"}')->>'total')::integer,0,'regular workspace also excludes future FMS before pagination');
select is((task_workspace_page('{"scope":"overall","subsection":"fms","status":"pending","mode":"board"}',0,1)->>'total')::integer,1,'regular Overall page retains future FMS');
select throws_ok($$select get_fms_task_workspace('{"dateScope":"invalid"}')$$,'22023',null,'invalid FMS scope rejected');
select throws_ok($$select task_workspace_page('{"scope":"invalid"}')$$,'22023',null,'invalid ordinary scope rejected');
select throws_ok($$select task_workspace_page('{"scope":"overall","subsection":"all"}')$$,'42501',null,'scope does not grant admin access');

-- Repeating activation of the exact predecessor retains the existing visit id.
reset role;
select is(activate_fms_stage_v2_internal((select id from visit_assignment_fixture where name='instance'),(select id from visit_assignment_fixture where name='call'),
 (select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='initial')),null,0),
 (select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')),'retry returns existing successor rather than scheduling twice');
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')),1,'retry has exactly one assignment');

-- Travel across the date boundary without changing membership or the template.
update fms_instance_stages set planned_datetime=(((now() at time zone 'Asia/Kolkata')::date)+time '23:59') at time zone 'Asia/Kolkata'
 where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((get_fms_task_workspace('{"dateScope":"today"}')->>'total')::integer,1,'assignment appears on scheduled IST date');
select is((task_workspace_page('{"scope":"today","subsection":"fms","status":"pending"}',0,1)->>'total')::integer,1,'task page agrees on scheduled day');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
select is((get_fms_task_workspace('{"dateScope":"overall"}')->>'total')::integer,0,'unassigned employee cannot see scheduled private work');
reset role;
update fms_instance_stages set planned_datetime=now()-interval '2 days'
 where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((get_fms_task_workspace('{"dateScope":"overdue"}')->>'total')::integer,1,'earlier-date pending assignment is available in Overdue');
select is((get_fms_task_workspace('{"dateScope":"today"}')->>'total')::integer,0,'Overdue does not inflate strict Today');
select lives_ok($$select submit_fms_form_and_progress_with_audit(
 (select id from visit_assignment_fixture where name='form'),jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c')),
 'fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')),gen_random_uuid())$$,
 'scheduled work completes through its required form transaction');
select is((task_workspace_page('{"scope":"overall","subsection":"fms","status":"completed","mode":"explore"}')->>'total')::integer,1,'Overall search retains authorized completed FMS history');
select is((task_workspace_page('{"scope":"overall","subsection":"fms","status":"completed","mode":"explore","query":"Call"}')->>'total')::integer,1,'completed FMS search filters the same authorized relation');
select is((task_workspace_page('{"subsection":"fms","status":"pending","mode":"board"}')->>'total')::integer,0,'legacy unscoped pending board retains active-only membership');
select is((task_workspace_page('{"subsection":"fms","status":"completed","mode":"board"}')->>'total')::integer,1,'legacy explicit completed history remains available');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
select is((task_workspace_page('{"scope":"overall","subsection":"fms","status":"completed","mode":"explore"}')->>'total')::integer,0,'completed-history scope cannot expose another employee work');
reset role;
update user_profiles set is_login_enabled=false where id=(select id from visit_assignment_fixture where name='b');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select throws_ok($$select task_workspace_page('{"scope":"overall"}')$$,'42501',null,'inactive caller cannot use Overall');
select throws_ok($$select get_fms_task_workspace('{"dateScope":"overall"}')$$,'42501',null,'inactive caller cannot use FMS Overall');
reset role;
select ok(not has_function_privilege('anon','task_workspace_page(jsonb,integer,integer)','EXECUTE'),'anonymous cannot query work');
select ok(not has_function_privilege('service_role','get_fms_task_workspace(jsonb,integer,integer)','EXECUTE'),'service role cannot impersonate employee reads');
select ok(not has_function_privilege('authenticated','fms_causal_stage_deadline(jsonb,uuid,uuid,uuid,jsonb)','EXECUTE'),'causal form answers remain internal');
select ok(not has_function_privilege('authenticated','fms_form_due_resolution(jsonb,uuid,uuid,uuid,text,uuid,jsonb,uuid[])','EXECUTE'),'unified due resolver remains private');
select ok(not has_function_privilege('authenticated','fms_form_due_resolution_before_followup(jsonb,uuid,uuid,uuid,text,uuid,jsonb,uuid[])','EXECUTE'),'compatibility due resolver remains private');
select ok(has_function_privilege('authenticated','assert_fms_flow_publishable(uuid)','EXECUTE'),'builder publish preflight remains available');
select ok(not has_function_privilege('anon','assert_fms_flow_publishable(uuid)','EXECUTE'),'anonymous publisher preflight denied');
select ok(not has_function_privilege('authenticated','assert_fms_flow_publishable_before_schedule(uuid)','EXECUTE'),'compatibility publish helper remains private');
select * from finish();
rollback;
