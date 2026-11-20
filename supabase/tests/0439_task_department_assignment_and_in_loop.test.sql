begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Owner report 2026-11-10: an Executive Assistant (staff) granted "Assign tasks
-- to other users" still saw only herself. Fixture: one tenant, two stores, an
-- assistant alone in her department, and one account per recipient shape.
insert into auth.users(id, aud, role, email, created_at, updated_at)
select ('43800000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated',
  'acw-' || n || '@example.invalid', now(), now()
from generate_series(1, 10) n;

insert into tenants(id, name, slug) values
  ('43810000-0000-4000-8000-000000000001', 'Task assignment 0438', 'task-assignment-0438'),
  ('43810000-0000-4000-8000-000000000002', 'Company-wide other tenant', 'company-wide-other');
insert into branches(id, tenant_id, name, code) values
  ('43820000-0000-4000-8000-000000000001', '43810000-0000-4000-8000-000000000001', 'Head office', 'ACW-HO'),
  ('43820000-0000-4000-8000-000000000002', '43810000-0000-4000-8000-000000000001', 'Store two', 'ACW-S2'),
  ('43820000-0000-4000-8000-000000000003', '43810000-0000-4000-8000-000000000002', 'Other tenant store', 'ACW-OT');
insert into departments(id, tenant_id, branch_id, name, code) values
  ('43830000-0000-4000-8000-000000000001', '43810000-0000-4000-8000-000000000001', '43820000-0000-4000-8000-000000000001', 'Office', 'ACW-D1'),
  ('43830000-0000-4000-8000-000000000002', '43810000-0000-4000-8000-000000000001', '43820000-0000-4000-8000-000000000001', 'Accounts', 'ACW-D2'),
  ('43830000-0000-4000-8000-000000000003', '43810000-0000-4000-8000-000000000001', '43820000-0000-4000-8000-000000000002', 'Sales', 'ACW-D3'),
  ('43830000-0000-4000-8000-000000000004', '43810000-0000-4000-8000-000000000002', '43820000-0000-4000-8000-000000000003', 'Other', 'ACW-D4');
insert into dropdown_masters(id, tenant_id, master_type, label, value, is_active) values
  ('43850000-0000-4000-8000-000000000001', '43810000-0000-4000-8000-000000000001', 'designation', 'Executive Assistant', 'executive_assistant', true),
  ('43850000-0000-4000-8000-000000000002', '43810000-0000-4000-8000-000000000001', 'designation', 'Company Owner', 'company_owner', true),
  ('43850000-0000-4000-8000-000000000003', '43810000-0000-4000-8000-000000000001', 'task_category', 'Company-wide tests', 'company-wide-tests', true);

insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, designation_id, working_status, account_status, is_login_enabled, week_off)
select ('43840000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid, ('43800000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid,
  f.tenant::uuid, f.branch::uuid, f.department::uuid, f.name, '00004380' || lpad(f.n::text, 2, '0'), 'acw-' || f.n || '@example.invalid',
  'ACW-' || f.n, f.role::user_role, f.designation::uuid, 'active', 'active', true, '{}'
from (values
  (1, 'ACW Super Admin', 'super_admin', '43810000-0000-4000-8000-000000000001', '43820000-0000-4000-8000-000000000001', '43830000-0000-4000-8000-000000000001', null),
  (2, 'ACW Admin', 'admin', '43810000-0000-4000-8000-000000000001', '43820000-0000-4000-8000-000000000001', '43830000-0000-4000-8000-000000000001', null),
  (3, 'ACW Manager', 'manager', '43810000-0000-4000-8000-000000000001', '43820000-0000-4000-8000-000000000002', '43830000-0000-4000-8000-000000000003', null),
  (4, 'ACW Executive Assistant', 'staff', '43810000-0000-4000-8000-000000000001', '43820000-0000-4000-8000-000000000001', '43830000-0000-4000-8000-000000000001', '43850000-0000-4000-8000-000000000001'),
  (5, 'ACW Accounts Staff', 'staff', '43810000-0000-4000-8000-000000000001', '43820000-0000-4000-8000-000000000001', '43830000-0000-4000-8000-000000000002', null),
  (6, 'ACW Store Staff', 'staff', '43810000-0000-4000-8000-000000000001', '43820000-0000-4000-8000-000000000002', '43830000-0000-4000-8000-000000000003', null),
  (7, 'ACW HR', 'hr', '43810000-0000-4000-8000-000000000001', '43820000-0000-4000-8000-000000000002', '43830000-0000-4000-8000-000000000003', null),
  (8, 'ACW Owner', 'staff', '43810000-0000-4000-8000-000000000001', '43820000-0000-4000-8000-000000000002', '43830000-0000-4000-8000-000000000003', '43850000-0000-4000-8000-000000000002'),
  (9, 'ACW Store Staff Two', 'staff', '43810000-0000-4000-8000-000000000001', '43820000-0000-4000-8000-000000000002', '43830000-0000-4000-8000-000000000003', null),
  (10, 'ACW Outsider', 'staff', '43810000-0000-4000-8000-000000000002', '43820000-0000-4000-8000-000000000003', '43830000-0000-4000-8000-000000000004', null)
) as f(n, name, role, tenant, branch, department, designation);

-- Mirrors the web client: the task takes the selected person's store and department.
create function pg_temp.assign_to(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare u user_profiles;
begin
  select * into u from user_profiles where id = p_user;
  return create_manual_task_with_mode_with_audit(jsonb_build_object('title', 'Synthetic company-wide assignment',
    'planned_datetime', now() + interval '3 days', 'priority', 'medium', 'branch_id', u.branch_id, 'department_id', u.department_id,
    'task_type', 'delegation', 'requires_form', false, 'form_template_id', null), array[p_user], '{}', '[]');
end $$;
grant execute on function pg_temp.assign_to(uuid) to authenticated;
create function pg_temp.schedule_for(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare u user_profiles;
begin
  select * into u from user_profiles where id = p_user;
  return save_task_template_with_audit(null, jsonb_build_object('title', 'Synthetic company-wide schedule',
    'description', 'Synthetic', 'recurrence_rule', 'RRULE:FREQ=DAILY;INTERVAL=1', 'planned_time', '18:00', 'priority', 'medium',
    'branch_id', u.branch_id, 'department_id', u.department_id, 'category_id', '43850000-0000-4000-8000-000000000003',
    'default_assignee_type', 'specific_user', 'default_assignee_user_id', p_user, 'default_assignee_role', null,
    'requires_form', false, 'form_template_id', null, 'checklist_items', '[]'::jsonb, 'is_active', true));
end $$;
grant execute on function pg_temp.schedule_for(uuid) to authenticated;
create function pg_temp.roster() returns uuid[]
language sql security definer set search_path = public as $$
  select coalesce(array_agg(id order by id), '{}') from list_task_assignment_users();
$$;
grant execute on function pg_temp.roster() to authenticated;


create temp table task_test_ids(kind text primary key,id uuid);
grant all on task_test_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','43800000-0000-4000-8000-000000000004',true);
select is(cardinality(pg_temp.roster()),9,'ordinary staff sees every active company account including senior hierarchy');
select lives_ok($$select pg_temp.assign_to('43840000-0000-4000-8000-000000000002')$$,'staff assigns to admin in their department');
select lives_ok($$select pg_temp.assign_to('43840000-0000-4000-8000-000000000005')$$,'staff assigns outside department');
select lives_ok($$select pg_temp.assign_to('43840000-0000-4000-8000-000000000008')$$,'staff assigns to owner at another store');
select lives_ok($$select pg_temp.schedule_for('43840000-0000-4000-8000-000000000008')$$,'staff schedules work for owner');
select lives_ok($$select search_assignment_recipients('{"kind":"task"}','43820000-0000-4000-8000-000000000002',null,0,20)$$,'ordinary staff can open another store picker');
select throws_ok($$select pg_temp.assign_to('43840000-0000-4000-8000-000000000010')$$,'42501',null,'cross tenant assignment denied');

select lives_ok($$select create_manual_task_with_mode_with_audit(
  '{"title":"Author in loop","planned_datetime":"2030-11-22T10:00:00Z","branch_id":"43820000-0000-4000-8000-000000000001","department_id":"43830000-0000-4000-8000-000000000002","task_type":"delegation"}',
  array['43840000-0000-4000-8000-000000000005'::uuid],
  array['43840000-0000-4000-8000-000000000004'::uuid,'43840000-0000-4000-8000-000000000006'::uuid],'[]')$$,'author can include themselves and another person in loop');
insert into task_test_ids values ('review_schedule', save_recurring_todo_template_with_audit(null,
  jsonb_build_object('title','Scheduled In Loop','description','Synthetic','recurrence_rule','RRULE:FREQ=DAILY;INTERVAL=1',
    'planned_time','11:00','due_time','13:00','starts_on',(now() at time zone 'Asia/Kolkata')::date,
    'schedule_kind','recurring','task_type','checklist','checklist_items','[{"item_text":"Count","is_required":true,"sort_order":0}]'::jsonb,
    'default_assignee_type','specific_user','default_assignee_user_id','43840000-0000-4000-8000-000000000005',
    'branch_id','43820000-0000-4000-8000-000000000001','department_id','43830000-0000-4000-8000-000000000002',
    'verification_required',true,'verifier_user_profile_id','43840000-0000-4000-8000-000000000001')));
select is((select count(*) from task_instances t join task_watchers w on w.task_instance_id=t.id
  where t.task_template_id=(select id from task_test_ids where kind='review_schedule') and w.user_profile_id='43840000-0000-4000-8000-000000000001'),1::bigint,'schedule occurrence inherits In Loop reviewer');
select set_config('request.jwt.claim.sub','43800000-0000-4000-8000-000000000001',true);
select lives_ok($$select run_recurring_todo_template_now_with_audit((select id from task_test_ids where kind='review_schedule'),(now() at time zone 'Asia/Kolkata')::date+1)$$,'named reviewer can generate a future checklist occurrence');
select lives_ok($$select save_recurring_todo_template_with_audit((select id from task_test_ids where kind='review_schedule'),
  jsonb_build_object('title','Scheduled In Loop revised','description','Synthetic','recurrence_rule','RRULE:FREQ=DAILY;INTERVAL=1',
    'planned_time','11:00','due_time','13:00','starts_on',(now() at time zone 'Asia/Kolkata')::date,
    'schedule_kind','recurring','task_type','checklist','checklist_items','[{"item_text":"Count","is_required":true,"sort_order":0}]'::jsonb,
    'default_assignee_type','specific_user','default_assignee_user_id','43840000-0000-4000-8000-000000000005',
    'branch_id','43820000-0000-4000-8000-000000000001','department_id','43830000-0000-4000-8000-000000000002',
    'verification_required',true,'verifier_user_profile_id','43840000-0000-4000-8000-000000000006'))$$,'schedule edit replaces In Loop person');
select is((select count(*) from task_instances t join task_watchers w on w.task_instance_id=t.id
  where t.task_template_id=(select id from task_test_ids where kind='review_schedule') and w.user_profile_id='43840000-0000-4000-8000-000000000001'),0::bigint,'former scheduled reviewer loses In Loop access');
reset role;
update task_templates set schedule_kind='as_required',is_active=false,verifier_user_profile_id='43840000-0000-4000-8000-000000000001'
  where id=(select id from task_test_ids where kind='review_schedule');
set local role authenticated;
select lives_ok($$select start_on_demand_task_with_audit((select id from task_test_ids where kind='review_schedule'))$$,'named reviewer can assign an as-needed checklist occurrence');
select set_config('request.jwt.claim.sub','43800000-0000-4000-8000-000000000004',true);

-- A checklist permits completion without uploading artificial evidence.
insert into task_test_ids values ('manual',create_manual_task_with_mode_with_audit(
  '{"title":"In Loop review","planned_datetime":"2030-11-22T10:00:00Z","branch_id":"43820000-0000-4000-8000-000000000001","department_id":"43830000-0000-4000-8000-000000000001","task_type":"checklist"}',
  array['43840000-0000-4000-8000-000000000004'::uuid],
  array['43840000-0000-4000-8000-000000000005'::uuid,'43840000-0000-4000-8000-000000000006'::uuid],
  '[{"item_text":"Check","is_required":true,"sort_order":0}]'));
select is((select verification_status::text from task_instances where id=(select id from task_test_ids where kind='manual')),'pending','In Loop enables manual task review');
select lives_ok($$select update_task_with_audit((select id from task_test_ids where kind='manual'),'checklist',
  (select id from task_checklists where task_instance_id=(select id from task_test_ids where kind='manual')),true)$$,'doer ticks required checklist');
select lives_ok($$select update_task_with_audit((select id from task_test_ids where kind='manual'),'complete')$$,'doer completes work for review');
select set_config('request.jwt.claim.sub','43800000-0000-4000-8000-000000000009',true);
select throws_ok($$select verify_recurring_task_with_audit((select id from task_test_ids where kind='manual'),'verified','')$$,'42501',null,'unrelated employee cannot review');
select set_config('request.jwt.claim.sub','43800000-0000-4000-8000-000000000006',true);
select ok((task_workspace_page('{"mode":"board","subsection":"inLoop","status":"pending","scope":"overall"}')->'ids') @> to_jsonb(array[(select id from task_test_ids where kind='manual')]),'completed work awaiting review appears in pending In Loop');
select ok(can_read_task((select id from task_test_ids where kind='manual')),'cross-store In Loop user reads this task');
select throws_ok($$select update_task_with_audit((select id from task_test_ids where kind='manual'),'complete')$$,'42501',null,'reviewer cannot perform doer actions');
select throws_ok($$select verify_recurring_task_with_audit((select id from task_test_ids where kind='manual'),'rejected','')$$,'22023',null,'rejection requires reason');
select lives_ok($$select verify_recurring_task_with_audit((select id from task_test_ids where kind='manual'),'rejected','Please recheck')$$,'second In Loop person can return completed manual work');
select is((select status::text from task_instances where id=(select id from task_test_ids where kind='manual')),'rejected','rejected work returns to doer');
select set_config('request.jwt.claim.sub','43800000-0000-4000-8000-000000000004',true);
select lives_ok($$select update_task_with_audit((select id from task_test_ids where kind='manual'),'complete')$$,'doer resubmits rejected work');
select set_config('request.jwt.claim.sub','43800000-0000-4000-8000-000000000005',true);
select lives_ok($$select verify_recurring_task_with_audit((select id from task_test_ids where kind='manual'),'verified','')$$,'first In Loop person approves resubmitted work');
select is((select verification_status::text from task_instances where id=(select id from task_test_ids where kind='manual')),'verified','review decision persists');

select ok(not ((task_workspace_page('{"mode":"board","subsection":"inLoop","status":"pending","scope":"overall"}')->'ids') @> to_jsonb(array[(select id from task_test_ids where kind='manual')])),'approved work leaves pending In Loop');

reset role;
select ok(exists(select 1 from audit_logs where record_id=(select id from task_test_ids where kind='manual') and action='recurring_task_verified'),'review writes audit');
update user_profiles set is_login_enabled=false where id='43840000-0000-4000-8000-000000000007';
set local role authenticated;
select set_config('request.jwt.claim.sub','43800000-0000-4000-8000-000000000004',true);
select throws_ok($$select pg_temp.assign_to('43840000-0000-4000-8000-000000000007')$$,'42501',null,'disabled recipient denied');
select set_config('request.jwt.claim.sub','43800000-0000-4000-8000-000000000007',true);
select throws_ok($$select list_task_assignment_users()$$,'42501',null,'inactive actor cannot use roster');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select list_task_assignment_users()$$,'42501',null,'unauthenticated actor cannot use roster');
reset role;
set local role service_role;
select throws_ok($$select list_task_assignment_users()$$,'42501',null,'service role does not gain task author roster access');
reset role;
select * from finish();
rollback;
