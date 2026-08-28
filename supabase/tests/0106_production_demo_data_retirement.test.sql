begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

select has_table('public', 'production_demo_data_retirements', 'retirement operation ledger exists');
select has_column('public', 'production_demo_data_retirements', 'tenant_id', 'operations are tenant scoped');
select has_column('public', 'production_demo_data_retirements', 'manifest_hash', 'operations bind execution to an inventory hash');
select has_function('public', 'preview_production_demo_data_retirement', array['uuid', 'text', 'boolean'], 'service boundary can create a read-only preview');
select has_function('public', 'execute_production_demo_data_retirement', array['uuid', 'uuid', 'text', 'text'], 'service boundary can execute an approved preview');
select table_privs_are('public', 'production_demo_data_retirements', 'authenticated', array[]::text[], 'browser callers cannot read or mutate the operation ledger');
select function_privs_are('public', 'preview_production_demo_data_retirement', array['uuid', 'text', 'boolean'], 'authenticated', array[]::text[], 'browser callers cannot preview retirement directly');
select function_privs_are('public', 'execute_production_demo_data_retirement', array['uuid', 'uuid', 'text', 'text'], 'authenticated', array[]::text[], 'browser callers cannot execute retirement directly');
select lives_ok($$select public.production_demo_data_retirement_manifest('00000000-0000-0000-0000-000000000001')$$, 'all tenant-scoped tables have an explicit retirement classification');

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('10600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'retirement-admin@example.invalid', crypt('local-test-only', gen_salt('bf')), now(), '{}', '{}', now(), now());
insert into public.tenants(id, name, slug) values ('10610000-0000-4000-8000-000000000001', 'Retirement Test', 'retirement-test');
insert into public.branches(id, tenant_id, name, code) values ('10620000-0000-4000-8000-000000000001', '10610000-0000-4000-8000-000000000001', 'Retirement Branch', 'RTB');
insert into public.departments(id, tenant_id, branch_id, name, code) values ('10630000-0000-4000-8000-000000000001', '10610000-0000-4000-8000-000000000001', '10620000-0000-4000-8000-000000000001', 'Retirement Department', 'RTD');
insert into public.user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled)
values ('10640000-0000-4000-8000-000000000001', '10600000-0000-4000-8000-000000000001', '10610000-0000-4000-8000-000000000001', '10620000-0000-4000-8000-000000000001', '10630000-0000-4000-8000-000000000001', 'Retirement Super Admin', '0000000106', 'retirement-admin@example.invalid', 'RET-1', 'super_admin', 'active', 'active', true);
insert into public.user_availability(tenant_id, user_profile_id, date, status, logged_by)
values ('10610000-0000-4000-8000-000000000001', '10640000-0000-4000-8000-000000000001', current_date, 'present', '10640000-0000-4000-8000-000000000001');
insert into public.clients(tenant_id, branch_id, phone, first_name)
values ('10610000-0000-4000-8000-000000000001', '10620000-0000-4000-8000-000000000001', '9000000106', 'Retained CRM Client');
insert into public.task_instances(tenant_id, branch_id, department_id, task_type, title, planned_datetime, created_by)
values ('10610000-0000-4000-8000-000000000001', '10620000-0000-4000-8000-000000000001', '10630000-0000-4000-8000-000000000001', 'checklist', 'Demo task', now(), '10640000-0000-4000-8000-000000000001');
insert into public.task_import_batches(tenant_id, created_by, import_hash, source_headers, requested_count)
values ('10610000-0000-4000-8000-000000000001', '10640000-0000-4000-8000-000000000001', repeat('a', 64), array['demo'], 1);
insert into public.task_import_row_registry(tenant_id, business_fingerprint, first_batch_id, task_instance_id)
select '10610000-0000-4000-8000-000000000001', repeat('b', 64), b.id, t.id
from public.task_import_batches b
cross join public.task_instances t
where b.tenant_id='10610000-0000-4000-8000-000000000001' and t.tenant_id='10610000-0000-4000-8000-000000000001';
insert into public.fms_flows(tenant_id, name, created_by)
values ('10610000-0000-4000-8000-000000000001', 'Demo workflow', '10640000-0000-4000-8000-000000000001');
insert into public.fms_instances(tenant_id, branch_id, fms_flow_id, reference_number, title, started_by)
select '10610000-0000-4000-8000-000000000001', '10620000-0000-4000-8000-000000000001', id, 'DEMO-106', 'Demo workflow instance', '10640000-0000-4000-8000-000000000001'
from public.fms_flows where tenant_id='10610000-0000-4000-8000-000000000001';
insert into public.notifications(tenant_id, user_profile_id, event_type, title, message)
values ('10610000-0000-4000-8000-000000000001', '10640000-0000-4000-8000-000000000001', 'demo', 'Demo notification', 'Remove me');
insert into public.performance_snapshots(tenant_id, branch_id, department_id, user_profile_id, period_start, period_end)
values ('10610000-0000-4000-8000-000000000001', '10620000-0000-4000-8000-000000000001', '10630000-0000-4000-8000-000000000001', '10640000-0000-4000-8000-000000000001', current_date, current_date);

select set_config('request.jwt.claim.role', 'service_role', true);
create temporary table retirement_preview as
select public.preview_production_demo_data_retirement('10600000-0000-4000-8000-000000000001', 'local-backup-reference', true) as response;
select is(((select response from retirement_preview)->'removal_counts'->>'task_instances')::integer, 1, 'preview counts the demo task without mutating it');
select is((select count(*)::integer from public.task_instances where tenant_id='10610000-0000-4000-8000-000000000001'), 1, 'preview is read only');
select lives_ok($$select public.execute_production_demo_data_retirement('10600000-0000-4000-8000-000000000001', ((select response from retirement_preview)->>'operation_id')::uuid, (select response->>'manifest_hash' from retirement_preview), 'RETIRE DEMO DATA')$$, 'approved service execution retires the demo manifest');
select is((select count(*)::integer from public.task_instances where tenant_id='10610000-0000-4000-8000-000000000001'), 0, 'demo tasks are removed');
select is((select count(*)::integer from public.task_import_row_registry where tenant_id='10610000-0000-4000-8000-000000000001'), 0, 'task import registry rows cannot block retirement');
select is((select count(*)::integer from public.fms_flows where tenant_id='10610000-0000-4000-8000-000000000001'), 0, 'used demo workflows are removed through the guarded retirement path');
select is((select count(*)::integer from public.notifications where tenant_id='10610000-0000-4000-8000-000000000001'), 0, 'demo notifications are removed');
select is((select count(*)::integer from public.clients where tenant_id='10610000-0000-4000-8000-000000000001'), 1, 'CRM remains intact');
select is((select count(*)::integer from public.user_availability where tenant_id='10610000-0000-4000-8000-000000000001'), 1, 'Availability remains intact');

select * from finish();
rollback;
