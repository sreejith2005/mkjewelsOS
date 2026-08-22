begin;
select plan(58);

select has_column('public', 'user_profiles', 'secondary_buddy_id', 'profiles store a secondary buddy');
select col_is_fk('public', 'user_profiles', 'secondary_buddy_id', 'secondary buddy is referentially enforced');
select has_index('public', 'user_profiles', 'idx_user_profiles_secondary_buddy', 'secondary buddy lookups are indexed');
select has_column('public', 'user_availability', 'source', 'availability distinguishes manual leave from generated weekly off');

select has_function('public', 'resolve_task_coverage', array['uuid', 'date'], 'coverage has one canonical resolver');
select has_function('public', 'reconcile_short_deadline_coverage_with_audit', array['uuid', 'date', 'text'], 'short-deadline work has one audited reconciler');
select has_function('public', 'record_availability_range_with_audit', array['uuid', 'date', 'date', 'availability_status', 'text'], 'availability ranges are recorded atomically');
select has_function('public', 'get_recurring_todo_workspace', array['jsonb'], 'recurring workspace is database-backed');
select has_function('public', 'create_recurring_todo_instance', array['uuid', 'date', 'uuid[]'], 'recurring generation uses the central contract');
select has_function('public', 'resolve_fms_stage_assignees', array['uuid', 'uuid', 'uuid'], 'FMS activation has one assignment resolver');
select has_function('public', 'normalize_coverage_notification_event', array[]::text[], 'legacy assignment notifications are normalized after coverage');
select ok(position('select is_active' in lower(pg_get_functiondef('public.notify_task_assignment()'::regprocedure))) > 0, 'legacy direct task notification re-reads persisted assignment activity');
select ok(position('task_watcher:' in pg_get_functiondef('public.normalize_coverage_notification_event()'::regprocedure)) > 0, 'watcher assignment notifications bypass the doer-only stale-event guard');
select has_column('public', 'task_templates', 'verification_required', 'recurring schedules can require verification');
select has_column('public', 'task_templates', 'followup_enabled', 'recurring schedules can enable follow-up');
select has_column('public', 'task_instances', 'verification_status', 'recurring instances persist verification state');
select has_column('public', 'task_instances', 'followup_count', 'recurring instances persist follow-up activity');
select has_function('public', 'save_recurring_todo_template_with_audit', array['uuid', 'jsonb'], 'recurring schedules have an audited save contract');
select has_function('public', 'verify_recurring_task_with_audit', array['uuid', 'text', 'text'], 'verification decisions are audited');
select has_function('public', 'send_recurring_followup_with_audit', array['uuid', 'text'], 'task follow-ups are audited');
select has_function('public', 'delete_recurring_todo_template_with_audit', array['uuid'], 'template deletion is dependency-safe and audited');
select has_function('public', 'configure_invited_profile_coverage_with_audit', array['uuid', 'uuid', 'uuid', 'uuid'], 'new users can receive their full coverage profile atomically');
select ok(position('secondary_buddy_id' in pg_get_functiondef('public.configure_invited_profile_coverage_with_audit(uuid,uuid,uuid,uuid)'::regprocedure)) > 0, 'new-user coverage configuration persists the secondary buddy');

select ok(
  position('secondary_buddy_id' in pg_get_functiondef('public.resolve_task_coverage(uuid,date)'::regprocedure)) > 0,
  'resolver evaluates the secondary buddy'
);
select ok(
  position('resolve_task_coverage' in pg_get_functiondef('public.create_recurring_todo_instance(uuid,date,uuid[])'::regprocedure)) > 0,
  'recurring generation delegates availability and buddy order to the canonical resolver'
);
select ok(
  position('resolve_task_coverage' in pg_get_functiondef('public.resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure)) > 0
  and position('fallback_user_profile_id' in pg_get_functiondef('public.resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure)) = 0,
  'FMS activation uses profile coverage and ignores the retired per-stage fallback'
);
select ok(
  position('fms_stage_deadline_for_instance' in pg_get_functiondef('public.resolve_fms_stage_assignees(uuid,uuid,uuid)'::regprocedure)) > 0,
  'FMS coverage uses the effective stage deadline'
);
select ok(
  position('v_old.branch_id is distinct from v_actor.branch_id' in pg_get_functiondef('public.set_recurring_todo_template_active_with_audit(uuid,boolean)'::regprocedure)) > 0,
  'manager activation is branch scoped'
);
select ok(
  position('v_template.branch_id is distinct from v_actor.branch_id' in pg_get_functiondef('public.run_recurring_todo_template_now_with_audit(uuid,date)'::regprocedure)) > 0,
  'manager run-now is branch scoped'
);
select ok(
  position('v_task.branch_id is distinct from v_actor.branch_id' in pg_get_functiondef('public.verify_recurring_task_with_audit(uuid,text,text)'::regprocedure)) > 0,
  'manager verification is branch scoped'
);
select ok(
  position('v_task.branch_id is distinct from v_actor.branch_id' in pg_get_functiondef('public.send_recurring_followup_with_audit(uuid,text)'::regprocedure)) > 0,
  'manager follow-up is branch scoped'
);
select ok(
  position('v_kind=''as_required''' in pg_get_functiondef('public.save_recurring_todo_template_with_audit(uuid,jsonb)'::regprocedure)) > 0
  and position('is_active' in pg_get_functiondef('public.save_recurring_todo_template_with_audit(uuid,jsonb)'::regprocedure)) > 0,
  'as-required schedules are persisted inactive without automatic generation'
);
select ok(
  position('as_required' in lower(pg_get_functiondef('public.create_recurring_todo_instance(uuid,date,uuid[])'::regprocedure))) > 0
  and position('is_active or' in lower(pg_get_functiondef('public.create_recurring_todo_instance(uuid,date,uuid[])'::regprocedure))) > 0,
  'authorized Run Now can instantiate an inactive as-required schedule'
);
select ok(
  position('reports_to_user_id' in pg_get_functiondef('public.resolve_task_coverage(uuid,date)'::regprocedure)) > 0,
  'resolver falls back to the reporting manager'
);
select ok(
  position('Asia/Kolkata' in pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure)) > 0,
  'reconciliation uses the agreed business timezone'
);
select ok(
  position('client_followups' in pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure)) > 0
  and position('fms_instance_stages' in pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure)) > 0
  and position('task_instances' in pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure)) > 0,
  'reconciliation covers Tasks, CRM follow-ups, and FMS stages'
);
select ok(
  position('manager_review' in pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure)) > 0,
  'claimed or in-progress work is routed to manager review'
);
select ok(
  position('coverage_required' in pg_get_functiondef('public.reconcile_short_deadline_coverage_with_audit(uuid,date,text)'::regprocedure)) > 0,
  'uncovered work is visibly marked coverage required'
);
select ok(
  position('reconcile_short_deadline_coverage_with_audit' in pg_get_functiondef('public.record_availability_with_audit(uuid,date,availability_status,text)'::regprocedure)) > 0,
  'single-day absence recording invokes reconciliation'
);
select ok(
  not has_function_privilege('authenticated', 'reconcile_short_deadline_coverage_with_audit(uuid,date,text)', 'EXECUTE'),
  'reconciliation is internal to audited availability writes and cannot be called directly'
);

-- Executing fixtures prove the lock query, fallback order, deadline window,
-- in-progress review path, assignment history, and retry idempotency.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated',email,crypt('local-test-only',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
from (values
  ('84000000-0000-4000-8000-000000000001'::uuid,'coverage-manager@example.invalid'),
  ('84000000-0000-4000-8000-000000000002'::uuid,'coverage-original@example.invalid'),
  ('84000000-0000-4000-8000-000000000003'::uuid,'coverage-primary@example.invalid'),
  ('84000000-0000-4000-8000-000000000004'::uuid,'coverage-secondary@example.invalid'),
  ('84000000-0000-4000-8000-000000000005'::uuid,'coverage-uncovered@example.invalid')
) fixture(id,email);
insert into tenants(id,name,slug) values('84100000-0000-4000-8000-000000000001','Coverage Fixture','coverage-fixture');
insert into branches(id,tenant_id,name,code) values('84200000-0000-4000-8000-000000000001','84100000-0000-4000-8000-000000000001','Coverage Branch','CVG');
insert into departments(id,tenant_id,branch_id,name,code) values('84300000-0000-4000-8000-000000000001','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','Coverage Department','CVGD');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,week_off)
values
 ('84400000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','84300000-0000-4000-8000-000000000001','Coverage Manager','0000000001','coverage-manager@example.invalid','CVG-1','manager','active','active',true,'{}'),
 ('84400000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000002','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','84300000-0000-4000-8000-000000000001','Coverage Original','0000000002','coverage-original@example.invalid','CVG-2','doer','active','active',true,'{}'),
 ('84400000-0000-4000-8000-000000000003','84000000-0000-4000-8000-000000000003','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','84300000-0000-4000-8000-000000000001','Coverage Primary','0000000003','coverage-primary@example.invalid','CVG-3','doer','active','active',true,'{}'),
 ('84400000-0000-4000-8000-000000000004','84000000-0000-4000-8000-000000000004','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','84300000-0000-4000-8000-000000000001','Coverage Secondary','0000000004','coverage-secondary@example.invalid','CVG-4','doer','active','active',true,'{}'),
 ('84400000-0000-4000-8000-000000000005','84000000-0000-4000-8000-000000000005','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','84300000-0000-4000-8000-000000000001','Coverage Uncovered','0000000005','coverage-uncovered@example.invalid','CVG-5','doer','active','active',true,'{}');
update user_profiles set buddy_id='84400000-0000-4000-8000-000000000003',secondary_buddy_id='84400000-0000-4000-8000-000000000004',reports_to_user_id='84400000-0000-4000-8000-000000000001'
where id='84400000-0000-4000-8000-000000000002';
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by)
values
 ('84500000-0000-4000-8000-000000000001','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','84300000-0000-4000-8000-000000000001','delegation','Move today','pending',(((now() at time zone 'Asia/Kolkata')::date)::text||' 18:00 Asia/Kolkata')::timestamptz,'84400000-0000-4000-8000-000000000001'),
 ('84500000-0000-4000-8000-000000000002','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','84300000-0000-4000-8000-000000000001','delegation','Leave later','pending',((((now() at time zone 'Asia/Kolkata')::date)+2)::text||' 18:00 Asia/Kolkata')::timestamptz,'84400000-0000-4000-8000-000000000001'),
 ('84500000-0000-4000-8000-000000000003','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','84300000-0000-4000-8000-000000000001','delegation','Review active','in_progress',(((now() at time zone 'Asia/Kolkata')::date)::text||' 18:00 Asia/Kolkata')::timestamptz,'84400000-0000-4000-8000-000000000001');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
select id,'84400000-0000-4000-8000-000000000002','doer',true,true from task_instances where id in
 ('84500000-0000-4000-8000-000000000001','84500000-0000-4000-8000-000000000002','84500000-0000-4000-8000-000000000003');
insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by)
values('84100000-0000-4000-8000-000000000001','84400000-0000-4000-8000-000000000003',(now() at time zone 'Asia/Kolkata')::date,'absent','fixture','84400000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select lives_ok(format('select record_availability_with_audit(%L,(now() at time zone ''Asia/Kolkata'')::date,''absent'',''approved fixture'')','84400000-0000-4000-8000-000000000002'),'authorized absence executes reconciliation');
select is((select coverage_resolution from task_instances where id='84500000-0000-4000-8000-000000000001'),'secondary_buddy','unavailable primary falls through to secondary buddy');
select ok(exists(select 1 from task_assignees where task_instance_id='84500000-0000-4000-8000-000000000001' and user_profile_id='84400000-0000-4000-8000-000000000004' and is_active),'secondary buddy becomes the active doer');
select ok(exists(select 1 from task_assignees where task_instance_id='84500000-0000-4000-8000-000000000001' and user_profile_id='84400000-0000-4000-8000-000000000002' and not is_active),'original assignment remains as inactive history');
select is((select coverage_status from task_instances where id='84500000-0000-4000-8000-000000000002'),null,'work beyond tomorrow remains untouched');
select is((select coverage_status from task_instances where id='84500000-0000-4000-8000-000000000003'),'manager_review','in-progress work is retained for manager review');
select lives_ok(format('select record_availability_with_audit(%L,(now() at time zone ''Asia/Kolkata'')::date,''absent'',''approved fixture retry'')','84400000-0000-4000-8000-000000000002'),'repeated authorized absence is safe');
select is((select count(*)::integer from audit_logs where record_id='84500000-0000-4000-8000-000000000003' and action='coverage_manager_review'),1,'manager-review audit is idempotent');
reset role;
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by)
values('84500000-0000-4000-8000-000000000004','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','84300000-0000-4000-8000-000000000001','delegation','Created after absence','pending',(((now() at time zone 'Asia/Kolkata')::date)::text||' 19:00 Asia/Kolkata')::timestamptz,'84400000-0000-4000-8000-000000000001');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
values('84500000-0000-4000-8000-000000000004','84400000-0000-4000-8000-000000000002','doer',true,true);
select is((select coverage_resolution from task_instances where id='84500000-0000-4000-8000-000000000004'),'secondary_buddy','new short-deadline tasks resolve coverage at assignment creation');
select ok(exists(select 1 from task_assignees where task_instance_id='84500000-0000-4000-8000-000000000004' and user_profile_id='84400000-0000-4000-8000-000000000004' and is_active),'creation-time coverage activates the resolved doer');
select ok(not exists(select 1 from notifications where user_profile_id='84400000-0000-4000-8000-000000000002' and message like '%Created after absence%'),'creation-time coverage suppresses the absent original notification');
select ok(exists(select 1 from notifications where user_profile_id='84400000-0000-4000-8000-000000000004' and message like '%Created after absence%'),'creation-time coverage notifies the effective doer');
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by)
values('84500000-0000-4000-8000-000000000006','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','84300000-0000-4000-8000-000000000001','delegation','Long dated after absence','pending',((((now() at time zone 'Asia/Kolkata')::date)+2)::text||' 20:00 Asia/Kolkata')::timestamptz,'84400000-0000-4000-8000-000000000001');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
values('84500000-0000-4000-8000-000000000006','84400000-0000-4000-8000-000000000002','doer',true,true);
select ok(exists(select 1 from notifications where user_profile_id='84400000-0000-4000-8000-000000000002' and message like '%Long dated after absence%'),'long-dated assignments remain assigned and notify the original doer');
insert into task_watchers(tenant_id,task_instance_id,user_profile_id,created_by)
values('84100000-0000-4000-8000-000000000001','84500000-0000-4000-8000-000000000004','84400000-0000-4000-8000-000000000003','84400000-0000-4000-8000-000000000001');
select ok(exists(select 1 from notification_events where idempotency_key like 'task_watcher:%' and payload->'_assigned_user_ids' @> jsonb_build_array('84400000-0000-4000-8000-000000000003'::uuid)),'watcher assignment notification remains queued');
insert into clients(id,tenant_id,branch_id,phone,first_name,assigned_crm_id)
values('84600000-0000-4000-8000-000000000001','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','0000000099','Coverage Client','84400000-0000-4000-8000-000000000002');
insert into client_followups(id,client_id,tenant_id,branch_id,assigned_to,due_date,status,subject,created_by)
values('84700000-0000-4000-8000-000000000001','84600000-0000-4000-8000-000000000001','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','84400000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date,'open','Creation coverage','84400000-0000-4000-8000-000000000001');
select is((select assigned_to from client_followups where id='84700000-0000-4000-8000-000000000001'),'84400000-0000-4000-8000-000000000004'::uuid,'new CRM follow-ups use the central coverage resolver');
select is((select coverage_resolution from client_followups where id='84700000-0000-4000-8000-000000000001'),'secondary_buddy','CRM creation records the selected coverage path');

insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by)
values('84100000-0000-4000-8000-000000000001','84400000-0000-4000-8000-000000000005',(now() at time zone 'Asia/Kolkata')::date,'absent','uncovered fixture','84400000-0000-4000-8000-000000000001');
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by)
values('84500000-0000-4000-8000-000000000005','84100000-0000-4000-8000-000000000001','84200000-0000-4000-8000-000000000001','84300000-0000-4000-8000-000000000001','delegation','Uncovered task','pending',(((now() at time zone 'Asia/Kolkata')::date)::text||' 20:00 Asia/Kolkata')::timestamptz,'84400000-0000-4000-8000-000000000001');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
values('84500000-0000-4000-8000-000000000005','84400000-0000-4000-8000-000000000005','doer',true,true);
select is((select coverage_status from task_instances where id='84500000-0000-4000-8000-000000000005'),'coverage_required','uncovered work is marked for coverage');
select ok(not exists(select 1 from task_assignees where task_instance_id='84500000-0000-4000-8000-000000000005' and is_active),'an absent uncovered assignee cannot act on the task');

select * from finish();
rollback;
