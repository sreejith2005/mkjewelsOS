begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Owner report 2026-11-10: an Executive Assistant (staff) granted "Assign tasks
-- to other users" still saw only herself. Fixture: one tenant, two stores, an
-- assistant alone in her department, and one account per recipient shape.
insert into auth.users(id, aud, role, email, created_at, updated_at)
select ('40200000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated',
  'acw-' || n || '@example.invalid', now(), now()
from generate_series(1, 10) n;

insert into tenants(id, name, slug) values
  ('40210000-0000-4000-8000-000000000001', 'Company-wide fixture', 'company-wide-fixture'),
  ('40210000-0000-4000-8000-000000000002', 'Company-wide other tenant', 'company-wide-other');
insert into branches(id, tenant_id, name, code) values
  ('40220000-0000-4000-8000-000000000001', '40210000-0000-4000-8000-000000000001', 'Head office', 'ACW-HO'),
  ('40220000-0000-4000-8000-000000000002', '40210000-0000-4000-8000-000000000001', 'Store two', 'ACW-S2'),
  ('40220000-0000-4000-8000-000000000003', '40210000-0000-4000-8000-000000000002', 'Other tenant store', 'ACW-OT');
insert into departments(id, tenant_id, branch_id, name, code) values
  ('40230000-0000-4000-8000-000000000001', '40210000-0000-4000-8000-000000000001', '40220000-0000-4000-8000-000000000001', 'Office', 'ACW-D1'),
  ('40230000-0000-4000-8000-000000000002', '40210000-0000-4000-8000-000000000001', '40220000-0000-4000-8000-000000000001', 'Accounts', 'ACW-D2'),
  ('40230000-0000-4000-8000-000000000003', '40210000-0000-4000-8000-000000000001', '40220000-0000-4000-8000-000000000002', 'Sales', 'ACW-D3'),
  ('40230000-0000-4000-8000-000000000004', '40210000-0000-4000-8000-000000000002', '40220000-0000-4000-8000-000000000003', 'Other', 'ACW-D4');
insert into dropdown_masters(id, tenant_id, master_type, label, value, is_active) values
  ('40250000-0000-4000-8000-000000000001', '40210000-0000-4000-8000-000000000001', 'designation', 'Executive Assistant', 'executive_assistant', true),
  ('40250000-0000-4000-8000-000000000002', '40210000-0000-4000-8000-000000000001', 'designation', 'Company Owner', 'company_owner', true),
  ('40250000-0000-4000-8000-000000000003', '40210000-0000-4000-8000-000000000001', 'task_category', 'Company-wide tests', 'company-wide-tests', true);

insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, designation_id, working_status, account_status, is_login_enabled, week_off)
select ('40240000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid, ('40200000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid,
  f.tenant::uuid, f.branch::uuid, f.department::uuid, f.name, '00004020' || lpad(f.n::text, 2, '0'), 'acw-' || f.n || '@example.invalid',
  'ACW-' || f.n, f.role::user_role, f.designation::uuid, 'active', 'active', true, '{}'
from (values
  (1, 'ACW Super Admin', 'super_admin', '40210000-0000-4000-8000-000000000001', '40220000-0000-4000-8000-000000000001', '40230000-0000-4000-8000-000000000001', null),
  (2, 'ACW Admin', 'admin', '40210000-0000-4000-8000-000000000001', '40220000-0000-4000-8000-000000000001', '40230000-0000-4000-8000-000000000001', null),
  (3, 'ACW Manager', 'manager', '40210000-0000-4000-8000-000000000001', '40220000-0000-4000-8000-000000000002', '40230000-0000-4000-8000-000000000003', null),
  (4, 'ACW Executive Assistant', 'staff', '40210000-0000-4000-8000-000000000001', '40220000-0000-4000-8000-000000000001', '40230000-0000-4000-8000-000000000001', '40250000-0000-4000-8000-000000000001'),
  (5, 'ACW Accounts Staff', 'staff', '40210000-0000-4000-8000-000000000001', '40220000-0000-4000-8000-000000000001', '40230000-0000-4000-8000-000000000002', null),
  (6, 'ACW Store Staff', 'staff', '40210000-0000-4000-8000-000000000001', '40220000-0000-4000-8000-000000000002', '40230000-0000-4000-8000-000000000003', null),
  (7, 'ACW HR', 'hr', '40210000-0000-4000-8000-000000000001', '40220000-0000-4000-8000-000000000002', '40230000-0000-4000-8000-000000000003', null),
  (8, 'ACW Owner', 'staff', '40210000-0000-4000-8000-000000000001', '40220000-0000-4000-8000-000000000002', '40230000-0000-4000-8000-000000000003', '40250000-0000-4000-8000-000000000002'),
  (9, 'ACW Store Staff Two', 'staff', '40210000-0000-4000-8000-000000000001', '40220000-0000-4000-8000-000000000002', '40230000-0000-4000-8000-000000000003', null),
  (10, 'ACW Outsider', 'staff', '40210000-0000-4000-8000-000000000002', '40220000-0000-4000-8000-000000000003', '40230000-0000-4000-8000-000000000004', null)
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
    'branch_id', u.branch_id, 'department_id', u.department_id, 'category_id', '40250000-0000-4000-8000-000000000003',
    'default_assignee_type', 'specific_user', 'default_assignee_user_id', p_user, 'default_assignee_role', null,
    'requires_form', false, 'form_template_id', null, 'checklist_items', '[]'::jsonb, 'is_active', true));
end $$;
grant execute on function pg_temp.schedule_for(uuid) to authenticated;
create function pg_temp.roster() returns uuid[]
language sql security definer set search_path = public as $$
  select coalesce(array_agg(id order by id), '{}') from list_task_assignment_users();
$$;
grant execute on function pg_temp.roster() to authenticated;

select is((select default_roles from permission_catalog where key = 'tasks.assign_company_wide'), '{super_admin,admin}'::user_role[],
  'capability defaults to Super Admin and Admin only');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

-- 1. The reported problem: assignment allowed, but only her own department.
select set_config('request.jwt.claim.sub', '40200000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_user_access_with_audit('40240000-0000-4000-8000-000000000004', '{"tasks.assign_others":"grant"}', null)$$,
  'Super Admin grants Assign tasks to other users');
select set_config('request.jwt.claim.sub', '40200000-0000-4000-8000-000000000004', true);
select is(pg_temp.roster(), array['40240000-0000-4000-8000-000000000004'::uuid], 'without the new switch she sees only herself (reported behaviour)');
select throws_ok($$select pg_temp.assign_to('40240000-0000-4000-8000-000000000006')$$, '42501', null, 'without the switch another store is denied');

-- 2. Only permission managers can grant the new switch.
select throws_ok($$select save_user_access_with_audit('40240000-0000-4000-8000-000000000004', '{"tasks.assign_company_wide":"grant"}', null)$$,
  '42501', null, 'a staff member cannot grant herself company-wide assignment');
select set_config('request.jwt.claim.sub', '40200000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_user_access_with_audit('40240000-0000-4000-8000-000000000004', '{"tasks.assign_company_wide":"grant"}', null)$$,
  'Super Admin grants Assign tasks to anyone in the company');
select ok(exists(select 1 from get_user_access_breakdown('40240000-0000-4000-8000-000000000004') b,
  jsonb_array_elements(b->'rows') r where r->>'key' = 'tasks.assign_company_wide' and (r->>'effective')::boolean),
  'Permission management shows the switch as allowed for her');

-- 3. With the switch: everyone in the company except protected leadership.
select set_config('request.jwt.claim.sub', '40200000-0000-4000-8000-000000000004', true);
select is(pg_temp.roster(), array[
  '40240000-0000-4000-8000-000000000003', '40240000-0000-4000-8000-000000000004', '40240000-0000-4000-8000-000000000005',
  '40240000-0000-4000-8000-000000000006', '40240000-0000-4000-8000-000000000007', '40240000-0000-4000-8000-000000000009']::uuid[],
  'roster lists staff, HR and the Manager in every store and department; never Super Admin, Admin, Owner or another tenant');
select lives_ok($$select pg_temp.assign_to('40240000-0000-4000-8000-000000000005')$$, 'assigns another department in her store');
select lives_ok($$select pg_temp.assign_to('40240000-0000-4000-8000-000000000006')$$, 'assigns staff in another store');
select lives_ok($$select pg_temp.assign_to('40240000-0000-4000-8000-000000000003')$$, 'assigns a Manager');
select lives_ok($$select pg_temp.assign_to('40240000-0000-4000-8000-000000000007')$$, 'assigns HR');
select throws_ok($$select pg_temp.assign_to('40240000-0000-4000-8000-000000000001')$$, '42501', null, 'direct API still cannot assign Super Admin');
select throws_ok($$select pg_temp.assign_to('40240000-0000-4000-8000-000000000002')$$, '42501', null, 'direct API still cannot assign Admin');
select throws_ok($$select pg_temp.assign_to('40240000-0000-4000-8000-000000000008')$$, '42501', null, 'direct API still cannot assign an Owner designation');
select throws_ok($$select pg_temp.assign_to('40240000-0000-4000-8000-000000000010')$$, null, null, 'another tenant stays out of reach');
select ok(exists(select 1 from audit_logs where actor_user_id = '40240000-0000-4000-8000-000000000004' and module = 'tasks'),
  'her assignments are audited');
select set_config('test.acw.task', pg_temp.assign_to('40240000-0000-4000-8000-000000000004')::text, true);
select throws_ok($$select delegate_task_with_audit(current_setting('test.acw.task')::uuid, '40240000-0000-4000-8000-000000000004',
  '40240000-0000-4000-8000-000000000003', 'Synthetic transfer')$$, '23503', null, 'a transfer still stays in the task''s own store and department (unchanged)');
select lives_ok($$select pg_temp.schedule_for('40240000-0000-4000-8000-000000000006')$$, 'repeating schedule for another store');

-- 4. "Assign tasks to other users" denied still wins: self only.
select set_config('request.jwt.claim.sub', '40200000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_user_access_with_audit('40240000-0000-4000-8000-000000000004', '{"tasks.assign_others":"deny"}', null)$$, 'deny assignment');
select set_config('request.jwt.claim.sub', '40200000-0000-4000-8000-000000000004', true);
select is(pg_temp.roster(), array['40240000-0000-4000-8000-000000000004'::uuid], 'denied assignment keeps her to herself even with company scope');
select throws_ok($$select pg_temp.assign_to('40240000-0000-4000-8000-000000000006')$$, '42501', null, 'denied assignment blocks the direct API');

-- 5. Ordinary staff are unchanged: own department, no Managers.
select set_config('request.jwt.claim.sub', '40200000-0000-4000-8000-000000000006', true);
select is(pg_temp.roster(), array['40240000-0000-4000-8000-000000000006', '40240000-0000-4000-8000-000000000007',
  '40240000-0000-4000-8000-000000000009']::uuid[], 'ordinary staff still see their own department without the Manager');
select throws_ok($$select pg_temp.assign_to('40240000-0000-4000-8000-000000000003')$$, '42501', null, 'ordinary staff still cannot assign a Manager');

-- 6. Department and designation grants work like user grants.
select set_config('request.jwt.claim.sub', '40200000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_department_permissions_with_audit('40230000-0000-4000-8000-000000000003', '{"tasks.assign_company_wide":"grant"}')$$,
  'department grant is accepted');
select set_config('request.jwt.claim.sub', '40200000-0000-4000-8000-000000000006', true);
select ok('40240000-0000-4000-8000-000000000005'::uuid = any(pg_temp.roster()), 'department grant opens the whole company');
select set_config('request.jwt.claim.sub', '40200000-0000-4000-8000-000000000001', true);
select lives_ok($$select save_department_permissions_with_audit('40230000-0000-4000-8000-000000000003', '{"tasks.assign_company_wide":null}')$$, 'department grant removed');
select lives_ok($$select save_designation_permissions_with_audit('40250000-0000-4000-8000-000000000001', '{"tasks.assign_company_wide":"grant"}')$$,
  'designation grant is accepted');
select lives_ok($$select save_user_access_with_audit('40240000-0000-4000-8000-000000000004', '{"tasks.assign_others":null,"tasks.assign_company_wide":null}', null)$$,
  'her individual overrides cleared');
select set_config('request.jwt.claim.sub', '40200000-0000-4000-8000-000000000004', true);
select ok('40240000-0000-4000-8000-000000000006'::uuid = any(pg_temp.roster()), 'Executive Assistant designation grant opens the whole company');
select set_config('request.jwt.claim.sub', '40200000-0000-4000-8000-000000000006', true);
select ok(not ('40240000-0000-4000-8000-000000000005'::uuid = any(pg_temp.roster())), 'removing the department grant restores department scope');

reset role;
select ok(not has_function_privilege('authenticated', 'task_assignment_recipient_allowed(uuid)', 'EXECUTE'), 'recipient helper stays private');
select ok(not has_function_privilege('anon', 'list_task_assignment_users()', 'EXECUTE'), 'anonymous cannot list assignees');
select * from finish();
rollback;
