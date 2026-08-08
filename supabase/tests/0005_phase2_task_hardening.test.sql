begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

-- All identities and business records in this file are fixed synthetic fixtures.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  auth_id, 'authenticated', 'authenticated', email,
  crypt('local-test-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (values
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'manager-a1@example.invalid'),
  ('a0000000-0000-0000-0000-000000000002'::uuid, 'admin-a@example.invalid'),
  ('a0000000-0000-0000-0000-000000000003'::uuid, 'super-a@example.invalid'),
  ('a0000000-0000-0000-0000-000000000004'::uuid, 'doer-a1@example.invalid'),
  ('a0000000-0000-0000-0000-000000000005'::uuid, 'doer-a2@example.invalid'),
  ('a0000000-0000-0000-0000-000000000006'::uuid, 'doer-a3@example.invalid'),
  ('a0000000-0000-0000-0000-000000000007'::uuid, 'watcher-a@example.invalid'),
  ('a0000000-0000-0000-0000-000000000008'::uuid, 'inactive-a@example.invalid'),
  ('a0000000-0000-0000-0000-000000000009'::uuid, 'buddy-a@example.invalid'),
  ('a0000000-0000-0000-0000-000000000010'::uuid, 'other-branch-a@example.invalid'),
  ('a0000000-0000-0000-0000-000000000011'::uuid, 'admin-b@example.invalid'),
  ('a0000000-0000-0000-0000-000000000012'::uuid, 'doer-b@example.invalid')
) fixture(auth_id, email);

insert into tenants (id, name, slug)
values
  ('10000000-0000-0000-0000-000000000001', 'Synthetic Tenant A', 'synthetic-tenant-a'),
  ('10000000-0000-0000-0000-000000000002', 'Synthetic Tenant B', 'synthetic-tenant-b');

insert into branches (id, tenant_id, name, code)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'A Branch One', 'A1'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'A Branch Two', 'A2'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'B Branch One', 'B1');

insert into departments (id, tenant_id, branch_id, name, code)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'A1 Department', 'A1D'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'A2 Department', 'A2D'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'B1 Department', 'B1D');

insert into user_profiles (
  id, auth_user_id, tenant_id, branch_id, department_id, employee_name,
  personal_mobile, email, employee_code, user_role, working_status, week_off
)
values
  ('40000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Synthetic Manager A1', '0000000001', 'manager-a1@example.invalid', 'SYN-A-001', 'manager', 'active', '{}'),
  ('40000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Synthetic Admin A', '0000000002', 'admin-a@example.invalid', 'SYN-A-002', 'admin', 'active', '{}'),
  ('40000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Synthetic Super A', '0000000003', 'super-a@example.invalid', 'SYN-A-003', 'super_admin', 'active', '{}'),
  ('40000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Synthetic Doer A1', '0000000004', 'doer-a1@example.invalid', 'SYN-A-004', 'doer', 'active', '{}'),
  ('40000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Synthetic Doer A2', '0000000005', 'doer-a2@example.invalid', 'SYN-A-005', 'doer', 'active', '{}'),
  ('40000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Synthetic Doer A3', '0000000006', 'doer-a3@example.invalid', 'SYN-A-006', 'doer', 'active', '{}'),
  ('40000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Synthetic Watcher A', '0000000007', 'watcher-a@example.invalid', 'SYN-A-007', 'staff', 'active', '{}'),
  ('40000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Synthetic Inactive A', '0000000008', 'inactive-a@example.invalid', 'SYN-A-008', 'doer', 'inactive', '{}'),
  ('40000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Synthetic Buddy A', '0000000009', 'buddy-a@example.invalid', 'SYN-A-009', 'doer', 'active', '{}'),
  ('40000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Synthetic Other Branch A', '0000000010', 'other-branch-a@example.invalid', 'SYN-A-010', 'doer', 'active', '{}'),
  ('40000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Synthetic Admin B', '0000000011', 'admin-b@example.invalid', 'SYN-B-011', 'admin', 'active', '{}'),
  ('40000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Synthetic Doer B', '0000000012', 'doer-b@example.invalid', 'SYN-B-012', 'doer', 'active', '{}');

update branches set manager_id = '40000000-0000-0000-0000-000000000001'
where id = '20000000-0000-0000-0000-000000000001';
update departments set head_id = '40000000-0000-0000-0000-000000000001'
where id = '30000000-0000-0000-0000-000000000001';
update user_profiles set buddy_id = '40000000-0000-0000-0000-000000000009'
where id = '40000000-0000-0000-0000-000000000004';

insert into dropdown_masters (id, tenant_id, master_type, label, value, is_active)
values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'task_category', 'Synthetic Active', 'synthetic_active', true),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'task_category', 'Synthetic Inactive', 'synthetic_inactive', false),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'task_category', 'Synthetic Tenant B', 'synthetic_b', true);

insert into form_templates (id, tenant_id, name, is_active)
values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Synthetic Form A', true),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Synthetic Form B', true);

-- Structural schema and index contract.
select has_column('public', 'task_templates', 'category_id', 'task_templates.category_id exists');
select has_column('public', 'task_instances', 'category_id', 'task_instances.category_id exists');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.task_templates'::regclass
    and conname = 'task_templates_category_id_fkey'
    and confrelid = 'public.dropdown_masters'::regclass
), 'task_templates.category_id has the dropdown foreign key');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.task_instances'::regclass
    and conname = 'task_instances_category_id_fkey'
    and confrelid = 'public.dropdown_masters'::regclass
), 'task_instances.category_id has the dropdown foreign key');
select has_column('public', 'task_watchers', 'tenant_id', 'task_watchers.tenant_id exists');
select has_column('public', 'task_watchers', 'task_instance_id', 'task_watchers.task_instance_id exists');
select has_column('public', 'task_watchers', 'user_profile_id', 'task_watchers.user_profile_id exists');
select has_column('public', 'task_watchers', 'created_by', 'task_watchers.created_by exists');
select has_column('public', 'task_watchers', 'created_at', 'task_watchers.created_at exists');
select ok(exists (
  select 1 from pg_index where indexrelid = 'public.task_watchers_task_user_unique'::regclass and indisunique
), 'task watchers reject duplicate task/user pairs');
select throws_ok($$
  insert into task_watchers (tenant_id, task_instance_id, user_profile_id, created_by)
  values ('10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000001')
$$, '23503', null, 'watcher task foreign key is enforced before task fixture exists');
select ok(exists (
  select 1 from pg_indexes where schemaname = 'public' and tablename = 'task_watchers'
    and indexdef ~ '\(tenant_id, task_instance_id\)'
), 'task_watchers has tenant/task lookup index');
select ok(exists (
  select 1 from pg_indexes where schemaname = 'public' and tablename = 'task_watchers'
    and indexdef ~ '\(user_profile_id, tenant_id, task_instance_id\)'
), 'task_watchers has user/tenant/task lookup index');
select ok(exists (
  select 1 from pg_indexes where schemaname = 'public' and tablename = 'task_watchers'
    and indexdef ~ '\(created_by\)'
), 'task_watchers has creator lookup index');
select ok(exists (
  select 1 from pg_indexes where schemaname = 'public' and tablename = 'task_assignees'
    and indexname = 'idx_task_assignees_one_active_doer' and indexdef ~ 'UNIQUE' and indexdef ~ 'WHERE is_active'
), 'active-doer uniqueness is a partial unique index');
select ok(exists (
  select 1 from pg_indexes where schemaname = 'public' and tablename = 'task_templates'
    and indexdef ~ '\(category_id, tenant_id\)'
), 'task template category foreign-key lookup is indexed');
select ok(exists (
  select 1 from pg_indexes where schemaname = 'public' and tablename = 'task_instances'
    and indexdef ~ '\(category_id, tenant_id\)'
), 'task instance category foreign-key lookup is indexed');
select ok(exists (
  select 1 from pg_indexes where schemaname = 'public' and tablename = 'task_checklists'
    and indexdef ~ '\(task_instance_id\)'
), 'task checklist RLS and foreign-key lookup is indexed');
select ok(exists (
  select 1 from pg_indexes where schemaname = 'public' and tablename = 'task_attachments'
    and indexdef ~ '\(task_instance_id\)'
), 'task attachment RLS and foreign-key lookup is indexed');
select ok(exists (
  select 1 from pg_indexes where schemaname = 'public' and tablename = 'task_attachments'
    and indexdef ~ '\(file_url\)'
), 'recorded attachment cleanup lookup is indexed');
select ok(exists (
  select 1 from pg_indexes where schemaname = 'public' and tablename = 'form_submissions'
    and indexdef ~ '\(tenant_id, linked_record_id, linked_module, form_template_id\)'
), 'task form-completion lookup is indexed');
select ok(exists (
  select 1 from pg_indexes where schemaname = 'public' and tablename = 'audit_logs'
    and indexdef ~ '\(record_id\)' and indexdef ~ 'module'
), 'task audit-history RLS lookup is indexed');

-- Direct synthetic tasks establish index and RLS behavior without RPC side effects.
insert into task_instances (
  id, tenant_id, branch_id, department_id, category_id, task_type, title,
  planned_datetime, created_by
)
values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'delegation', 'Synthetic watched task', '2026-08-10 09:00 Asia/Kolkata', '40000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', 'delegation', 'Synthetic tenant B task', '2026-08-10 09:00 Asia/Kolkata', '40000000-0000-0000-0000-000000000011'),
  ('70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'delegation', 'Synthetic other branch task', '2026-08-10 09:00 Asia/Kolkata', '40000000-0000-0000-0000-000000000002');

insert into task_assignees (task_instance_id, user_profile_id, role_at_task, is_original, is_active)
values
  ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 'doer', true, true),
  ('70000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000012', 'doer', true, true),
  ('70000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000010', 'doer', true, true);
insert into task_watchers (tenant_id, task_instance_id, user_profile_id, created_by)
values ('10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000001');
insert into task_checklists (task_instance_id, item_text, is_required, sort_order)
values ('70000000-0000-0000-0000-000000000001', 'Synthetic watched checklist', true, 0);
insert into task_attachments (task_instance_id, file_url, uploaded_by)
values ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001/70000000-0000-0000-0000-000000000001/recorded.pdf', '40000000-0000-0000-0000-000000000004');
insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
values ('10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'synthetic_created', 'tasks', '70000000-0000-0000-0000-000000000001', '{}');

-- Historical rows are allowed; duplicate active rows are not.
update task_assignees set is_active = false
where task_instance_id = '70000000-0000-0000-0000-000000000001'
  and user_profile_id = '40000000-0000-0000-0000-000000000004';
select lives_ok($$
  insert into task_assignees (task_instance_id, user_profile_id, role_at_task, is_original, is_active)
  values ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 'doer', false, true)
$$, 'inactive assignment history permits a later active assignment');
select throws_ok($$
  insert into task_assignees (task_instance_id, user_profile_id, role_at_task, is_original, is_active)
  values ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 'doer', false, true)
$$, '23505', null, 'duplicate active task/user assignment is rejected');

-- RLS and privileges by role.
select ok((select relrowsecurity from pg_class where oid = 'public.task_watchers'::regclass), 'RLS is enabled on task_watchers');
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('public', p.oid, 'EXECUTE')
), 'PUBLIC cannot execute any public SECURITY DEFINER function');
select ok(has_function_privilege('authenticated', 'create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)', 'EXECUTE'), 'authenticated can execute task creation RPC');
select ok(not has_function_privilege('anon', 'create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)', 'EXECUTE'), 'anon cannot execute task creation RPC');
select ok(has_function_privilege('service_role', 'create_recurring_task_instance(uuid,date,jsonb)', 'EXECUTE'), 'service_role can execute recurrence RPC');
select ok(not has_function_privilege('authenticated', 'create_recurring_task_instance(uuid,date,jsonb)', 'EXECUTE'), 'authenticated cannot execute recurrence RPC');
select ok(not has_function_privilege('service_role', 'create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)', 'EXECUTE'), 'service_role has no explicit task creation RPC grant');
select ok(not has_function_privilege('authenticated', 'invite_profile_with_audit(uuid,uuid,text,text,uuid,uuid,uuid,text,text,text[],user_role,text,uuid)', 'EXECUTE'), 'authenticated cannot execute service-only invitation RPC');
select ok(
  has_table_privilege('service_role', 'task_templates', 'SELECT')
  and has_table_privilege('service_role', 'user_profiles', 'SELECT')
  and has_table_privilege('service_role', 'user_availability', 'SELECT'),
  'recurrence service role has only the required direct read path'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000007', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*)::integer from task_instances where id = '70000000-0000-0000-0000-000000000001'), 1, 'watcher selects the watched task');
select is((select count(*)::integer from task_assignees where task_instance_id = '70000000-0000-0000-0000-000000000001'), 2, 'watcher selects allowed task assignee history');
select is((select count(*)::integer from task_checklists where task_instance_id = '70000000-0000-0000-0000-000000000001'), 1, 'watcher selects related checklist');
select is((select count(*)::integer from task_attachments where task_instance_id = '70000000-0000-0000-0000-000000000001'), 1, 'watcher selects related attachment metadata');
select is((select count(*)::integer from audit_logs where record_id = '70000000-0000-0000-0000-000000000001'), 1, 'watcher selects related task audit history');
select is((select count(*)::integer from task_instances where tenant_id = '10000000-0000-0000-0000-000000000002'), 0, 'cross-tenant watcher access returns zero tasks');
select throws_ok($$insert into task_watchers (tenant_id, task_instance_id, user_profile_id, created_by) values ('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000007')$$, '42501', null, 'watcher has no INSERT authority');
select throws_ok($$update task_watchers set created_at = now() where task_instance_id = '70000000-0000-0000-0000-000000000001'$$, '42501', null, 'watcher has no UPDATE authority');
select throws_ok($$delete from task_watchers where task_instance_id = '70000000-0000-0000-0000-000000000001'$$, '42501', null, 'watcher has no DELETE authority');
select throws_ok($$select update_task_with_audit('70000000-0000-0000-0000-000000000001','start')$$, '42501', 'Task is not accessible to an active doer', 'watcher does not satisfy active-doer mutation authorization');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*)::integer from task_instances where tenant_id = '10000000-0000-0000-0000-000000000001'), 2, 'manager elevated read remains within own tenant');
select is((select count(*)::integer from task_instances where tenant_id = '10000000-0000-0000-0000-000000000002'), 0, 'manager elevated read cannot cross tenant');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*)::integer from task_instances where tenant_id = '10000000-0000-0000-0000-000000000001'), 2, 'admin elevated read remains within own tenant');
select is((select count(*)::integer from task_instances where tenant_id = '10000000-0000-0000-0000-000000000002'), 0, 'admin elevated read cannot cross tenant');
reset role;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok($$select count(*) from task_instances$$, '42501', null, 'anonymous task-table access is rejected');
select throws_ok($$select create_delegation_task_with_audit('{}', '{}', '{}', '[]')$$, '42501', null, 'anonymous task RPC execution is rejected');
reset role;

-- Storage authorization remains tenant/task scoped and preserves recorded objects.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('task-attachments', '10000000-0000-0000-0000-000000000001/70000000-0000-0000-0000-000000000001/recorded.pdf', 'a0000000-0000-0000-0000-000000000004')
$$, 'authorized doer can upload into the tenant/task prefix');
select lives_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('task-attachments', '10000000-0000-0000-0000-000000000001/70000000-0000-0000-0000-000000000001/unrecorded.pdf', 'a0000000-0000-0000-0000-000000000004')
$$, 'authorized doer can create an unrecorded upload');
select ok(not can_delete_unrecorded_task_attachment_object('10000000-0000-0000-0000-000000000001/70000000-0000-0000-0000-000000000001/recorded.pdf'), 'recorded-object cleanup policy rejects deletion');
select is((select count(*)::integer from storage.objects where bucket_id = 'task-attachments' and name like '%/recorded.pdf'), 1, 'recorded attachment object cannot be deleted through cleanup');
select ok(can_delete_unrecorded_task_attachment_object('10000000-0000-0000-0000-000000000001/70000000-0000-0000-0000-000000000001/unrecorded.pdf'), 'authorized unrecorded upload cleanup is permitted by policy');
select ok(exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='task_attachment_objects_delete' and cmd='DELETE'), 'Storage cleanup path is enforced by the delete policy');
select throws_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('task-attachments', '10000000-0000-0000-0000-000000000002/70000000-0000-0000-0000-000000000002/cross.pdf', 'a0000000-0000-0000-0000-000000000004')
$$, '42501', null, 'cross-tenant attachment upload is rejected');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000007', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok($$
  insert into storage.objects (bucket_id, name, owner)
  values ('task-attachments', '10000000-0000-0000-0000-000000000001/70000000-0000-0000-0000-000000000001/watcher.pdf', 'a0000000-0000-0000-0000-000000000007')
$$, '42501', null, 'watcher cannot upload attachment evidence');
reset role;

-- Task creation validation.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Manager own branch task","planned_datetime":"2026-08-12T09:00:00+05:30","priority":"high","branch_id":"20000000-0000-0000-0000-000000000001","department_id":"30000000-0000-0000-0000-000000000001","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000004'::uuid,'40000000-0000-0000-0000-000000000005'::uuid],
    array['40000000-0000-0000-0000-000000000007'::uuid],
    '[{"item_text":"Optional check","is_required":false,"sort_order":0}]'
  )
$$, 'manager creation in own branch succeeds');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Manager other branch","planned_datetime":"2026-08-12T09:00:00+05:30","branch_id":"20000000-0000-0000-0000-000000000002","department_id":"30000000-0000-0000-0000-000000000002","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000010'::uuid], '{}', '[]'
  )
$$, '42501', 'Managers can create tasks only in their own branch', 'manager creation in another branch fails');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Inactive category","planned_datetime":"2026-08-12T09:00:00+05:30","category_id":"50000000-0000-0000-0000-000000000002"}',
    array['40000000-0000-0000-0000-000000000004'::uuid], '{}', '[]'
  )
$$, '23503', 'Task category is invalid or inactive', 'inactive category fails');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Cross category","planned_datetime":"2026-08-12T09:00:00+05:30","category_id":"50000000-0000-0000-0000-000000000003"}',
    array['40000000-0000-0000-0000-000000000004'::uuid], '{}', '[]'
  )
$$, '23503', 'Task category is invalid or inactive', 'cross-tenant category fails');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Cross user","planned_datetime":"2026-08-12T09:00:00+05:30","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000012'::uuid], '{}', '[]'
  )
$$, '23503', 'Every doer must be active and belong to the task branch and department', 'cross-tenant doer fails');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Inactive doer","planned_datetime":"2026-08-12T09:00:00+05:30","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000008'::uuid], '{}', '[]'
  )
$$, '23503', 'Every doer must be active and belong to the task branch and department', 'inactive user fails');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Overlap","planned_datetime":"2026-08-12T09:00:00+05:30","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000004'::uuid], array['40000000-0000-0000-0000-000000000004'::uuid], '[]'
  )
$$, '22023', 'A user cannot be both a watcher and a doer', 'doer/watcher overlap fails');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Duplicate doers","planned_datetime":"2026-08-12T09:00:00+05:30","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000004'::uuid,'40000000-0000-0000-0000-000000000004'::uuid], '{}', '[]'
  )
$$, '22023', 'Doer list contains duplicates', 'duplicate doers fail');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Duplicate watchers","planned_datetime":"2026-08-12T09:00:00+05:30","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000004'::uuid], array['40000000-0000-0000-0000-000000000007'::uuid,'40000000-0000-0000-0000-000000000007'::uuid], '[]'
  )
$$, '22023', 'Watcher list contains duplicates', 'duplicate watchers fail');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Unsupported","planned_datetime":"2026-08-12T09:00:00+05:30","category_id":"50000000-0000-0000-0000-000000000001","unexpected":true}',
    array['40000000-0000-0000-0000-000000000004'::uuid], '{}', '[]'
  )
$$, '22023', 'Task payload contains unsupported fields', 'unsupported payload keys fail');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Bad priority","planned_datetime":"2026-08-12T09:00:00+05:30","priority":"urgent","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000004'::uuid], '{}', '[]'
  )
$$, '22023', 'Task payload contains an invalid UUID, priority, or planned datetime', 'invalid priority fails');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Bad datetime","planned_datetime":"not-a-date","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000004'::uuid], '{}', '[]'
  )
$$, '22007', 'invalid input syntax for type timestamp with time zone: "not-a-date"', 'invalid datetime fails');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Bad checklist","planned_datetime":"2026-08-12T09:00:00+05:30","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000004'::uuid], '{}', '[{"item_text":"","is_required":true,"sort_order":0}]'
  )
$$, '22023', 'Every checklist item must contain non-empty item_text and supported fields only', 'invalid checklist structure fails');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Bad checklist order","planned_datetime":"2026-08-12T09:00:00+05:30","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000004'::uuid], '{}', '[{"item_text":"First","is_required":true,"sort_order":1},{"item_text":"Second","is_required":true,"sort_order":1}]'
  )
$$, '22023', 'Checklist sort_order must be zero-based and contiguous', 'invalid checklist order fails');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Admin other branch valid","planned_datetime":"2026-08-12T09:00:00+05:30","branch_id":"20000000-0000-0000-0000-000000000002","department_id":"30000000-0000-0000-0000-000000000002","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000010'::uuid], '{}', '[]'
  )
$$, 'admin creation in a valid tenant branch and department succeeds');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Cross branch","planned_datetime":"2026-08-12T09:00:00+05:30","branch_id":"20000000-0000-0000-0000-000000000003","department_id":"30000000-0000-0000-0000-000000000003","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000012'::uuid], '{}', '[]'
  )
$$, '23503', 'Branch is invalid or inactive', 'cross-tenant branch fails');
select throws_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Cross department","planned_datetime":"2026-08-12T09:00:00+05:30","branch_id":"20000000-0000-0000-0000-000000000001","department_id":"30000000-0000-0000-0000-000000000003","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000004'::uuid], '{}', '[]'
  )
$$, '23503', 'Department must belong to the selected active branch', 'cross-tenant department fails');
select throws_ok($$
  select save_task_template_with_audit(null,
    '{"title":"Cross form template","recurrence_rule":"FREQ=DAILY","planned_time":"09:00","priority":"medium","requires_upload":false,"requires_remark":false,"requires_form":true,"form_template_id":"60000000-0000-0000-0000-000000000002","default_assignee_type":"specific_user","default_assignee_user_id":"40000000-0000-0000-0000-000000000004","branch_id":"20000000-0000-0000-0000-000000000001","department_id":"30000000-0000-0000-0000-000000000001","category_id":"50000000-0000-0000-0000-000000000001","checklist_items":[],"is_active":true}')
$$, '23503', 'Required form is invalid or inactive', 'cross-tenant form fails');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok($$
  select create_delegation_task_with_audit(
    '{"title":"Super valid task","planned_datetime":"2026-08-12T09:00:00+05:30","branch_id":"20000000-0000-0000-0000-000000000002","department_id":"30000000-0000-0000-0000-000000000002","category_id":"50000000-0000-0000-0000-000000000001"}',
    array['40000000-0000-0000-0000-000000000010'::uuid], '{}', '[]'
  )
$$, 'super-admin creation in a valid tenant branch and department succeeds');
reset role;

select is((select count(*)::integer from audit_logs where action = 'delegation_task_created' and record_id = (select id from task_instances where title = 'Manager own branch task')), 1, 'successful task creation writes its audit row in the same transaction');

-- Delegation transfers one active doer and preserves the others and history.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(format(
  'select delegate_task_with_audit(%L::uuid,%L::uuid,%L::uuid,%L)',
  (select id from task_instances where title = 'Manager own branch task'),
  '40000000-0000-0000-0000-000000000004',
  '40000000-0000-0000-0000-000000000006',
  'Synthetic transfer'
), 'delegation transfers the specified active doer');
reset role;
select is((select count(*)::integer from task_assignees where task_instance_id = (select id from task_instances where title = 'Manager own branch task') and user_profile_id = '40000000-0000-0000-0000-000000000005' and is_active), 1, 'other active doers remain assigned');
select is((select count(*)::integer from task_assignees where task_instance_id = (select id from task_instances where title = 'Manager own branch task') and user_profile_id = '40000000-0000-0000-0000-000000000004' and not is_active), 1, 'prior assignment becomes inactive rather than deleted');
select is((select count(*)::integer from task_assignees where task_instance_id = (select id from task_instances where title = 'Manager own branch task') and user_profile_id = '40000000-0000-0000-0000-000000000006' and is_active), 1, 'destination becomes the active doer');
select ok(exists (select 1 from audit_logs where action = 'task_doer_transferred' and old_value ? 'assignments' and new_value ?& array['assignments','from_user_id','to_user_id','reason']), 'delegation writes complete before/after audit history');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(format(
  'select delegate_task_with_audit(%L::uuid,%L::uuid,%L::uuid,%L)',
  (select id from task_instances where title = 'Manager own branch task'),
  '40000000-0000-0000-0000-000000000005',
  '40000000-0000-0000-0000-000000000006', 'Duplicate active'
), '23505', 'Destination user is already an active doer', 'delegation to an already-active doer fails');
select throws_ok(format(
  'select delegate_task_with_audit(%L::uuid,%L::uuid,%L::uuid,%L)',
  (select id from task_instances where title = 'Manager own branch task'),
  '40000000-0000-0000-0000-000000000005',
  '40000000-0000-0000-0000-000000000007', 'Watcher overlap'
), '22023', 'Destination user is already a watcher and cannot also be a doer', 'delegation to a watcher fails');
select throws_ok(format(
  'select delegate_task_with_audit(%L::uuid,%L::uuid,%L::uuid,%L)',
  (select id from task_instances where title = 'Manager own branch task'),
  '40000000-0000-0000-0000-000000000005',
  '40000000-0000-0000-0000-000000000005', 'Self transfer'
), '22023', 'Self-delegation is not allowed', 'self-transfer fails');
select lives_ok(format(
  'select update_task_with_audit(%L::uuid,%L,null,null,null)',
  (select id from task_instances where title = 'Manager own branch task'), 'complete'
), 'task with no outstanding required checks completes');
reset role;
select is((select count(*)::integer from task_assignees where task_instance_id = (select id from task_instances where title = 'Manager own branch task') and role_at_task = 'doer' and is_active and completed_at is not null), 2, 'completion timestamps every active doer');
select ok(exists (select 1 from audit_logs where action = 'task_complete' and record_id = (select id from task_instances where title = 'Manager own branch task') and old_value is not null and new_value is not null), 'completion writes complete before/after audit history');

-- Completion gates use separate synthetic tasks for independent proof.
insert into task_instances (id, tenant_id, branch_id, department_id, category_id, task_type, title, planned_datetime, requires_upload, requires_remark, requires_form, form_template_id, created_by)
values
  ('71000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','delegation','Required checklist gate','2026-08-12 09:00 Asia/Kolkata',false,false,false,null,'40000000-0000-0000-0000-000000000001'),
  ('71000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','delegation','Required upload gate','2026-08-12 09:00 Asia/Kolkata',true,false,false,null,'40000000-0000-0000-0000-000000000001'),
  ('71000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','delegation','Required form gate','2026-08-12 09:00 Asia/Kolkata',false,false,true,'60000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
  ('71000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','delegation','Required remark gate','2026-08-12 09:00 Asia/Kolkata',false,true,false,null,'40000000-0000-0000-0000-000000000001');
insert into task_assignees (task_instance_id,user_profile_id,role_at_task,is_active)
select id,'40000000-0000-0000-0000-000000000004','doer',true from task_instances where id::text like '71000000%';
insert into task_checklists (id,task_instance_id,item_text,is_required,is_completed,sort_order)
values ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','Required item',true,false,0);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok($$select update_task_with_audit('71000000-0000-0000-0000-000000000001','complete')$$, '23514', 'Complete all required checklist items first', 'required incomplete checklist blocks completion');
select lives_ok($$select update_task_with_audit('71000000-0000-0000-0000-000000000001','checklist','72000000-0000-0000-0000-000000000001',true)$$, 'authorized doer can complete required checklist item');
select lives_ok($$select update_task_with_audit('71000000-0000-0000-0000-000000000001','complete')$$, 'completed required checklist permits completion');
select throws_ok($$select update_task_with_audit('71000000-0000-0000-0000-000000000002','complete')$$, '23514', 'A required upload is missing', 'required upload is enforced');
select throws_ok($$select update_task_with_audit('71000000-0000-0000-0000-000000000003','complete')$$, '23514', 'The required task form submission is missing', 'required form is enforced');
select throws_ok($$select update_task_with_audit('71000000-0000-0000-0000-000000000004','complete')$$, '23514', 'A completion remark is required', 'required remark is enforced');
reset role;

insert into task_attachments(task_instance_id,file_url,uploaded_by)
values ('71000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001/71000000-0000-0000-0000-000000000002/evidence.pdf','40000000-0000-0000-0000-000000000004');
insert into form_submissions(tenant_id,branch_id,department_id,form_template_id,linked_module,linked_record_id,data,submitted_by)
values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','delegation_task','71000000-0000-0000-0000-000000000004','{}','40000000-0000-0000-0000-000000000004');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok($$select update_task_with_audit('71000000-0000-0000-0000-000000000002','complete')$$, 'recorded required upload permits completion');
select throws_ok($$select update_task_with_audit('71000000-0000-0000-0000-000000000003','complete')$$, '23514', 'The required task form submission is missing', 'form completion must match task ID');
reset role;
update form_submissions set linked_record_id='71000000-0000-0000-0000-000000000003', linked_module='checklist_task';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok($$select update_task_with_audit('71000000-0000-0000-0000-000000000003','complete')$$, '23514', 'The required task form submission is missing', 'form completion must match linked module');
reset role;
update form_submissions set linked_module='delegation_task', form_template_id='60000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok($$select update_task_with_audit('71000000-0000-0000-0000-000000000003','complete')$$, '23514', 'The required task form submission is missing', 'form completion must match form-template ID');
reset role;
update form_submissions set form_template_id='60000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok($$select update_task_with_audit('71000000-0000-0000-0000-000000000003','complete')$$, 'matching form submission permits completion');
select lives_ok($$select update_task_with_audit('71000000-0000-0000-0000-000000000004','complete',null,null,'Synthetic completion remark')$$, 'non-empty required remark permits completion');
reset role;

-- Availability, recurrence, buddy coverage, escalation, timezone, and idempotency.
select ok(is_user_available_for_task('40000000-0000-0000-0000-000000000005','2026-08-10'), 'missing availability means available');
insert into user_availability(tenant_id,user_profile_id,date,status) values ('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000005','2026-08-10','absent');
select ok(not is_user_available_for_task('40000000-0000-0000-0000-000000000005','2026-08-10'), 'explicit absent means unavailable');
insert into user_availability(tenant_id,user_profile_id,date,status) values ('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000004','2026-08-10','absent');
select ok(not is_user_available_for_task('40000000-0000-0000-0000-000000000008','2026-08-10'), 'inactive user means unavailable');
update user_profiles set week_off=array['Monday'] where id='40000000-0000-0000-0000-000000000006';
select ok(not is_user_available_for_task('40000000-0000-0000-0000-000000000006','2026-08-10'), 'week-off means unavailable');
insert into user_availability(tenant_id,user_profile_id,date,status) values
  ('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000009','2026-08-10','remote'),
  ('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000010','2026-08-10','half_day');
select ok(is_user_available_for_task('40000000-0000-0000-0000-000000000009','2026-08-10'), 'remote status remains available');
select ok(is_user_available_for_task('40000000-0000-0000-0000-000000000010','2026-08-10'), 'half-day status remains available');
select ok(is_supported_task_rrule('FREQ=DAILY;INTERVAL=1'), 'supported RRULE is accepted');
select ok(not is_supported_task_rrule('FREQ=HOURLY'), 'unsupported RRULE is rejected');

insert into task_templates (
  id,tenant_id,branch_id,department_id,category_id,title,task_type,recurrence_rule,
  planned_time,priority,default_assignee_type,default_assignee_user_id,checklist_items,
  is_active,created_by,updated_by
)
values
  ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','Buddy recurrence','checklist','FREQ=DAILY','09:30','medium','specific_user','40000000-0000-0000-0000-000000000004','[]',true,'40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
  ('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','Blocked recurrence','checklist','FREQ=DAILY','10:15','medium','specific_user','40000000-0000-0000-0000-000000000005','[]',true,'40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
  ('80000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','Available recurrence','checklist','FREQ=DAILY','09:30','medium','specific_user','40000000-0000-0000-0000-000000000009','[]',true,'40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001');

set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok($$
  select create_recurring_task_instance(
    '80000000-0000-0000-0000-000000000001','2026-08-10',
    '[{"original_assignee_id":"40000000-0000-0000-0000-000000000004","effective_assignee_id":"40000000-0000-0000-0000-000000000009","resolution":"buddy"}]'
  )
$$, 'valid buddy coverage is selected');
select lives_ok($$
  select create_recurring_task_instance(
    '80000000-0000-0000-0000-000000000002','2026-08-10',
    '[{"original_assignee_id":"40000000-0000-0000-0000-000000000005","effective_assignee_id":null,"resolution":"blocked"}]'
  )
$$, 'unresolved coverage creates a blocked recurrence');
select lives_ok($$
  select create_recurring_task_instance(
    '80000000-0000-0000-0000-000000000003','2026-08-11',
    '[{"original_assignee_id":"40000000-0000-0000-0000-000000000009","effective_assignee_id":"40000000-0000-0000-0000-000000000009","resolution":"assigned"}]'
  )
$$, 'available recurrence is generated');
select is(
  create_recurring_task_instance(
    '80000000-0000-0000-0000-000000000003','2026-08-11',
    '[{"original_assignee_id":"40000000-0000-0000-0000-000000000009","effective_assignee_id":"40000000-0000-0000-0000-000000000009","resolution":"assigned"}]'
  ), null::uuid, 'repeated recurrence execution is idempotent for template/date');
reset role;

select is((select status::text from task_instances where task_template_id='80000000-0000-0000-0000-000000000001' and scheduled_date='2026-08-10'), 'pending', 'buddy-covered task remains pending');
select is((select user_profile_id from task_assignees where task_instance_id=(select id from task_instances where task_template_id='80000000-0000-0000-0000-000000000001' and scheduled_date='2026-08-10') and is_active), '40000000-0000-0000-0000-000000000009'::uuid, 'buddy becomes the effective active doer');
select is((select count(*)::integer from buddy_assignments where task_instance_id=(select id from task_instances where task_template_id='80000000-0000-0000-0000-000000000001' and scheduled_date='2026-08-10')), 1, 'buddy coverage records buddy assignment');
select is((select status::text from task_instances where task_template_id='80000000-0000-0000-0000-000000000002' and scheduled_date='2026-08-10'), 'blocked', 'unresolved coverage produces blocked task');
select is((select count(*)::integer from notifications where event_type='task_coverage_required' and tenant_id='10000000-0000-0000-0000-000000000001'), 1, 'blocked coverage creates required internal notification');
select ok(exists(select 1 from audit_logs where action='task_coverage_escalated' and old_value ? 'availability_state' and new_value ?& array['resolution_state','task_status','notified_user_ids']), 'blocked coverage creates complete escalation audit');
select ok(exists(select 1 from audit_logs where action='recurring_task_generated' and new_value ?& array['template_id','scheduled_date','coverage_state','assignments']), 'recurrence generation creates complete audit');
select is((select scheduled_date from task_instances where task_template_id='80000000-0000-0000-0000-000000000003'), '2026-08-11'::date, 'recurrence scheduled_date matches target date');
select is((select planned_datetime from task_instances where task_template_id='80000000-0000-0000-0000-000000000003'), '2026-08-11 09:30 Asia/Kolkata'::timestamptz, 'recurrence planned timestamp follows Asia/Kolkata');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok($$
  select save_task_template_with_audit(null,
    '{"title":"Unsupported recurrence","recurrence_rule":"FREQ=HOURLY","planned_time":"09:00","priority":"medium","requires_upload":false,"requires_remark":false,"requires_form":false,"default_assignee_type":"specific_user","default_assignee_user_id":"40000000-0000-0000-0000-000000000004","branch_id":"20000000-0000-0000-0000-000000000001","department_id":"30000000-0000-0000-0000-000000000001","category_id":"50000000-0000-0000-0000-000000000001","checklist_items":[],"is_active":true}')
$$, '22023', 'Recurrence rule is invalid or unsupported', 'unsupported RRULE fails template creation');
reset role;

select * from finish();
rollback;
