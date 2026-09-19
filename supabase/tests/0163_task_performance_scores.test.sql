begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Synthetic-only identities. Test output contains no row payloads or contact data.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select aid,'authenticated','authenticated',email,crypt('synthetic-test-value',gen_salt('bf')),now(),'{}','{}',now(),now() from (values
 ('a1630000-0000-0000-0000-000000000001'::uuid,'score-super@example.invalid'),
 ('a1630000-0000-0000-0000-000000000002'::uuid,'score-staff-mixed@example.invalid'),
 ('a1630000-0000-0000-0000-000000000003'::uuid,'score-staff-unfinished@example.invalid'),
 ('a1630000-0000-0000-0000-000000000004'::uuid,'score-staff-idle@example.invalid'),
 ('a1630000-0000-0000-0000-000000000005'::uuid,'score-inactive-admin@example.invalid')
) x(aid,email);
insert into tenants(id,name,slug,timezone) values
 ('11630000-0000-0000-0000-000000000001','Synthetic Score Tenant','score-test','Asia/Kolkata');
insert into branches(id,tenant_id,name,code) values
 ('21630000-0000-0000-0000-000000000001','11630000-0000-0000-0000-000000000001','Synthetic Score Branch','SC1');
insert into departments(id,tenant_id,branch_id,name,code) values
 ('31630000-0000-0000-0000-000000000001','11630000-0000-0000-0000-000000000001','21630000-0000-0000-0000-000000000001','Synthetic Score Department','SCD1');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
select pid,aid,'11630000-0000-0000-0000-000000000001','21630000-0000-0000-0000-000000000001','31630000-0000-0000-0000-000000000001',label,mobile,email,code,role::user_role,status::working_status,enabled from (values
 ('41630000-0000-0000-0000-000000000001'::uuid,'a1630000-0000-0000-0000-000000000001'::uuid,'Synthetic Score Super','9000016301','score-super@example.invalid','SC-1','super_admin','active',true),
 ('41630000-0000-0000-0000-000000000002','a1630000-0000-0000-0000-000000000002','Synthetic Score Mixed','9000016302','score-staff-mixed@example.invalid','SC-2','staff','active',true),
 ('41630000-0000-0000-0000-000000000003','a1630000-0000-0000-0000-000000000003','Synthetic Score Unfinished','9000016303','score-staff-unfinished@example.invalid','SC-3','staff','active',true),
 ('41630000-0000-0000-0000-000000000004','a1630000-0000-0000-0000-000000000004','Synthetic Score Idle','9000016304','score-staff-idle@example.invalid','SC-4','staff','active',true),
 ('41630000-0000-0000-0000-000000000005','a1630000-0000-0000-0000-000000000005','Synthetic Score Inactive','9000016305','score-inactive-admin@example.invalid','SC-5','admin','inactive',false)
) x(pid,aid,label,mobile,email,code,role,status,enabled);

-- All tasks are planned today (tenant-local). Mixed: one on time, one late,
-- two open. Unfinished: one open. Idle: nothing assigned.
create temporary table score_day as select date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as d;
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,priority,status,planned_datetime,actual_datetime,created_by,source)
select tid::uuid,'11630000-0000-0000-0000-000000000001','21630000-0000-0000-0000-000000000001','31630000-0000-0000-0000-000000000001','checklist',title,'medium',status::task_status,
  (select d from score_day)+planned,case when actual is null then null else (select d from score_day)+actual end,'41630000-0000-0000-0000-000000000001','manual'
from (values
 ('51630000-0000-0000-0000-000000000001','Synthetic on-time task','completed',interval '10 hours',interval '9 hours'),
 ('51630000-0000-0000-0000-000000000002','Synthetic late task','completed',interval '1 hour',interval '2 hours'),
 ('51630000-0000-0000-0000-000000000003','Synthetic open task one','pending',interval '23 hours',null),
 ('51630000-0000-0000-0000-000000000004','Synthetic open task two','pending',interval '23 hours',null),
 ('51630000-0000-0000-0000-000000000005','Synthetic unfinished task','pending',interval '23 hours',null)
) x(tid,title,status,planned,actual);
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values
 ('51630000-0000-0000-0000-000000000001','41630000-0000-0000-0000-000000000002','doer',true,true),
 ('51630000-0000-0000-0000-000000000002','41630000-0000-0000-0000-000000000002','doer',true,true),
 ('51630000-0000-0000-0000-000000000003','41630000-0000-0000-0000-000000000002','doer',true,true),
 ('51630000-0000-0000-0000-000000000004','41630000-0000-0000-0000-000000000002','doer',true,true),
 ('51630000-0000-0000-0000-000000000005','41630000-0000-0000-0000-000000000003','doer',true,true);

-- Contract shape and grants are unchanged.
select is((select prosecdef from pg_proc where oid='public.get_dashboard_metrics(jsonb)'::regprocedure),true,'dashboard stays security definer');
select is((select prosecdef from pg_proc where oid='public.get_employee_task_progress(jsonb)'::regprocedure),true,'employee progress stays security definer');
select ok(not has_function_privilege('anon','get_dashboard_metrics(jsonb)','EXECUTE'),'anon cannot call dashboard');
select ok(not has_function_privilege('anon','get_employee_task_progress(jsonb)','EXECUTE'),'anon cannot call employee progress');
select ok(position('assert_module_access(''dashboard'')' in pg_get_functiondef('public.get_dashboard_metrics(jsonb)'::regprocedure))>0,'dashboard keeps its section gate');
select ok(position('assert_module_enabled(''task_templates'')' in pg_get_functiondef('public.get_employee_task_progress(jsonb)'::regprocedure))>0,'employee progress keeps its section gate');
select ok(position('v_branch:=v_actor.branch_id' in pg_get_functiondef('public.get_employee_task_progress(jsonb)'::regprocedure))>0,'manager scope is still narrowed to the caller branch');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);

-- Denied callers.
select set_config('request.jwt.claim.sub','a1630000-0000-0000-0000-000000000005',true);
select throws_ok($$select get_employee_task_progress('{}')$$,'42501',null,'inactive admin is denied employee progress');
select throws_ok($$select get_dashboard_metrics('{}')$$,'42501',null,'inactive admin is denied Dashboard');
select set_config('request.jwt.claim.sub','a1630000-0000-0000-0000-000000000002',true);
select throws_ok($$select get_employee_task_progress('{}')$$,'42501',null,'staff is denied other people''s progress');

-- Own Dashboard scores: 2 of 4 complete, 1 of 2 on time.
select is((get_dashboard_metrics('{"preset":"today"}')->'metrics'->>'task_pending_score')::numeric,-50.0,'mixed staff pending score');
select is((get_dashboard_metrics('{"preset":"today"}')->'metrics'->>'task_delayed_score')::numeric,-50.0,'mixed staff delayed score');
select ok(get_dashboard_metrics('{"preset":"today"}')->'metrics' ? 'task_completion_rate','legacy completion rate is kept for installed apps');
select ok(get_dashboard_metrics('{"preset":"today"}')->'previous' ? 'task_pending_score','previous period carries the pending score');

-- Assigned but nothing completed: both scores are -100.
select set_config('request.jwt.claim.sub','a1630000-0000-0000-0000-000000000003',true);
select is((get_dashboard_metrics('{"preset":"today"}')->'metrics'->>'task_pending_score')::numeric,-100.0,'unfinished staff pending score');
select is((get_dashboard_metrics('{"preset":"today"}')->'metrics'->>'task_delayed_score')::numeric,-100.0,'unfinished staff delayed score');

-- Nothing assigned: no data, never a failing score.
select set_config('request.jwt.claim.sub','a1630000-0000-0000-0000-000000000004',true);
select is(get_dashboard_metrics('{"preset":"today"}')->'metrics'->'task_pending_score','null'::jsonb,'idle staff has no pending score');
select is(get_dashboard_metrics('{"preset":"today"}')->'metrics'->'task_delayed_score','null'::jsonb,'idle staff has no delayed score');

-- Tenant-wide Dashboard: 2 of 5 complete (-60.0), 1 of 2 on time (-50.0).
select set_config('request.jwt.claim.sub','a1630000-0000-0000-0000-000000000001',true);
select is((get_dashboard_metrics('{"preset":"today"}')->'metrics'->>'task_pending_score')::numeric,-60.0,'super admin pending score');
select is((get_dashboard_metrics('{"preset":"today"}')->'metrics'->>'task_delayed_score')::numeric,-50.0,'super admin delayed score');

-- Employee progress carries on-time counts on every roll-up level.
select is((select (e->>'on_time_completed')::int from jsonb_array_elements(get_employee_task_progress('{}')->'employees') e where e->>'user_profile_id'='41630000-0000-0000-0000-000000000002'),1,'employee row has on-time completed');
select is((select (e->>'completed')::int from jsonb_array_elements(get_employee_task_progress('{}')->'employees') e where e->>'user_profile_id'='41630000-0000-0000-0000-000000000002'),2,'employee completed count is unchanged');
select is((select (e->>'on_time_completed')::int from jsonb_array_elements(get_employee_task_progress('{}')->'employees') e where e->>'user_profile_id'='41630000-0000-0000-0000-000000000003'),0,'unfinished employee has no on-time work');
select is((select (b->>'on_time_completed')::int from jsonb_array_elements(get_employee_task_progress('{}')->'branches') b where b->>'branch_id'='21630000-0000-0000-0000-000000000001'),1,'branch roll-up sums on-time completed');
select is((select (d->>'on_time_completed')::int from jsonb_array_elements(get_employee_task_progress('{}')->'departments') d where d->>'department_id'='31630000-0000-0000-0000-000000000001'),1,'department roll-up sums on-time completed');

select * from finish();
rollback;
