-- 0187: direct (non-RPC) writes to the CRM tables the original UI writes are audited in
-- public.audit_logs with the entity, operation and changed column names only; RPC writes
-- and owner writes are not double-audited; RLS is unchanged.
-- Staff cannot read public.audit_logs, so every audit assertion runs as the owner
-- (reset role) and the next write switches back to authenticated.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures: profiles 01 super_admin, 02 manager (branch A), 03 crm (branch A),
--   04 crm (branch A, no linked CRM user)
-- ---------------------------------------------------------------------------
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('01874000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated',
  'crm-0187-' || lpad(n::text, 2, '0') || '@example.invalid', crypt('local-test-only', gen_salt('bf')), now(), '{}', '{}', now(), now()
from generate_series(1, 4) n;
insert into tenants(id, name, slug) values ('01871000-0000-4000-8000-000000000001', 'CRM 0187 tenant', 'crm-0187-one');
insert into branches(id, tenant_id, name, code) values
('01872000-0000-4000-8000-000000000001', '01871000-0000-4000-8000-000000000001', 'JewelOS Bandra 0187', 'C185A'),
('01872000-0000-4000-8000-000000000002', '01871000-0000-4000-8000-000000000001', 'JewelOS Andheri 0187', 'C185B');
insert into departments(id, tenant_id, branch_id, name, code) values
('01873000-0000-4000-8000-000000000001', '01871000-0000-4000-8000-000000000001', '01872000-0000-4000-8000-000000000001', 'Dept 0187', 'C185D1');
insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
select ('01875000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  ('01874000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '01871000-0000-4000-8000-000000000001', '01872000-0000-4000-8000-000000000001', '01873000-0000-4000-8000-000000000001',
  'CRM 0187 person ' || n, '0000018500', 'crm-0187-' || lpad(n::text, 2, '0') || '@example.invalid', 'C185-' || n,
  (array['super_admin','manager','crm','crm'])[n]::user_role, 'active', 'active', true, '{}'
from generate_series(1, 4) n;

insert into crm.branches(id, name, jewelos_branch_id) values
('01876000-0000-4000-8000-000000000001', 'CRM 0187 Branch A', '01872000-0000-4000-8000-000000000001'),
('01876000-0000-4000-8000-000000000002', 'CRM 0187 Branch B', '01872000-0000-4000-8000-000000000002');
insert into crm.users(id, name, email, role, branch_id, jewelos_profile_id) values
('01877000-0000-4000-8000-000000000001', 'CRM 0187 Admin', 'crm-0187-admin@example.invalid', 'super_admin', null, '01875000-0000-4000-8000-000000000001'),
('01877000-0000-4000-8000-000000000002', 'CRM 0187 Manager', 'crm-0187-manager@example.invalid', 'branch_manager', '01876000-0000-4000-8000-000000000001', '01875000-0000-4000-8000-000000000002'),
('01877000-0000-4000-8000-000000000003', 'CRM 0187 Sales', 'crm-0187-sales@example.invalid', 'salesperson', '01876000-0000-4000-8000-000000000001', '01875000-0000-4000-8000-000000000003');
insert into crm.clients(client_id, primary_name, primary_phone, last_branch_id) values
('01878000-0000-4000-8000-000000000001', 'Audit Client A', '9018500001', '01876000-0000-4000-8000-000000000001'),
('01878000-0000-4000-8000-000000000002', 'Audit Client B', '9018500002', '01876000-0000-4000-8000-000000000002');
insert into crm.crm_allocation(branch_id, crm_name) values ('01876000-0000-4000-8000-000000000001', 'ANU 0187');

-- ---------------------------------------------------------------------------
-- Catalog: one audit trigger per original direct-write table, no browser entry point
-- ---------------------------------------------------------------------------
select set_eq(
  $$select c.relname::text from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'crm' and t.tgname = 'crm_direct_write_audit' and not t.tgisinternal$$,
  array['clients', 'crm_daily_availability', 'leads', 'lead_call_history',
        'lookup_beverages', 'lookup_cities', 'lookup_communities', 'lookup_gifts', 'lookup_not_bought_reasons',
        'lookup_pincodes', 'lookup_product_categories', 'lookup_relations', 'lookup_snacks',
        'lookup_source_of_leads', 'lookup_sugar_options'],
  'the direct-write audit trigger is attached to exactly the original direct-write tables'
);
select ok(not exists (
  select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where t.tgname = 'crm_direct_write_audit' and n.nspname = 'crm'
    and (t.tgtype & 1) = 0 -- not FOR EACH ROW
), 'every audit trigger is row-level');
select ok(not has_function_privilege('anon', 'crm_private.audit_direct_write()', 'EXECUTE'), 'anon cannot execute the audit trigger function');
select ok(not exists (
  select 1 from pg_trigger t where t.tgname = 'crm_direct_write_audit'
    and t.tgrelid in ('public.clients'::regclass, 'public.client_timeline'::regclass)
), 'the old JewelOS CRM tables are untouched');

-- ---------------------------------------------------------------------------
-- Salesperson: direct profile edit, lead capture, post-call interaction
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '01874000-0000-4000-8000-000000000003', true);
select set_config('request.path', '/clients', true);
set local role authenticated;
update crm.clients set primary_name = 'Renamed Audit Client', city = 'Pune 0187' where client_id = '01878000-0000-4000-8000-000000000001';
reset role;
select is(
  (select count(*)::int from public.audit_logs where action = 'crm.clients_update' and record_id = '01878000-0000-4000-8000-000000000001'),
  1, 'a direct client profile edit writes one audit row'
);
select ok(
  (select new_value -> 'changed_columns' ?& array['city', 'primary_name'] from public.audit_logs where action = 'crm.clients_update' and record_id = '01878000-0000-4000-8000-000000000001'),
  'the client audit row names the changed columns'
);
select is(
  (select jsonb_build_array(tenant_id, actor_user_id, module, new_value ->> 'entity', new_value ->> 'operation', new_value ->> 'crm_user_id')
   from public.audit_logs where action = 'crm.clients_update' and record_id = '01878000-0000-4000-8000-000000000001'),
  jsonb_build_array('01871000-0000-4000-8000-000000000001', '01875000-0000-4000-8000-000000000003', 'crm', 'clients', 'update', '01877000-0000-4000-8000-000000000003'),
  'the client audit row records tenant, JewelOS actor, module, entity, operation and CRM user'
);
select ok(
  (select position('Renamed Audit Client' in new_value::text) = 0 and position('Pune 0187' in new_value::text) = 0 and old_value is null
   from public.audit_logs where action = 'crm.clients_update' and record_id = '01878000-0000-4000-8000-000000000001'),
  'no customer value is copied into the client audit row'
);

-- RLS is unchanged: a JewelOS user without a linked CRM user changes nothing, and nothing is audited.
select set_config('request.jwt.claim.sub', '01874000-0000-4000-8000-000000000004', true);
set local role authenticated;
update crm.clients set city = 'Other 0187' where client_id = '01878000-0000-4000-8000-000000000002';
reset role;
select is(
  (select count(*)::int from public.audit_logs where record_id = '01878000-0000-4000-8000-000000000002'),
  0, 'an update by a user without CRM access changes nothing and writes no audit row'
);
select is((select city from crm.clients where client_id = '01878000-0000-4000-8000-000000000002'), null, 'the denied update left the client unchanged');

select set_config('request.jwt.claim.sub', '01874000-0000-4000-8000-000000000003', true);
select set_config('request.path', '/leads', true);
set local role authenticated;
insert into crm.leads(id, phone_number, name, field_values, created_by)
values ('01879000-0000-4000-8000-000000000001', '9018500011', 'Audit Lead', '{"city":"Nashik 0187"}', '01877000-0000-4000-8000-000000000003');
reset role;
select is(
  (select new_value -> 'changed_columns' ?& array['created_by', 'field_values', 'name', 'phone_number'] and not (new_value -> 'changed_columns' ? 'runo_push_error')
   from public.audit_logs where action = 'crm.leads_insert' and record_id = '01879000-0000-4000-8000-000000000001'),
  true, 'a lead capture is audited with the assigned (non-null) columns'
);
select ok(
  (select position('9018500011' in new_value::text) = 0 and position('Audit Lead' in new_value::text) = 0 and position('Nashik 0187' in new_value::text) = 0
   from public.audit_logs where action = 'crm.leads_insert'),
  'no lead value is copied into the audit row'
);

select set_config('request.path', '/lead_call_history', true);
set local role authenticated;
insert into crm.lead_call_history(id, lead_id, call_response, remark, entered_by)
values ('0187a000-0000-4000-8000-000000000001', '01879000-0000-4000-8000-000000000001', 'CONNECTED', 'Private remark 0187', '01877000-0000-4000-8000-000000000003');
reset role;
select ok(
  (select position('Private remark 0187' in new_value::text) = 0 from public.audit_logs
   where action = 'crm.lead_call_history_insert' and record_id = '0187a000-0000-4000-8000-000000000001'),
  'a post-call interaction is audited without its remark'
);

-- A write made inside an RPC call is covered by that RPC's own audit row.
select set_config('request.path', '/rpc/create_client_with_phone', true);
set local role authenticated;
select set_config('test.rpc_client', crm.create_client_with_phone('Rpc Client 0187', '+91 90185 00021', null, null)::text, true);
reset role;
select is(
  (select count(*)::int from public.audit_logs where record_id = current_setting('test.rpc_client')::uuid and action = 'crm.clients_insert'),
  0, 'a client created through an RPC is not double-audited by the direct-write trigger'
);
select is(
  (select count(*)::int from public.audit_logs where record_id = current_setting('test.rpc_client')::uuid and action = 'crm.create_client_with_phone'),
  1, 'the RPC keeps its own audit row'
);

-- ---------------------------------------------------------------------------
-- Branch manager: roster availability upsert (insert, conflict update) and delete
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '01874000-0000-4000-8000-000000000002', true);
select set_config('request.path', '/crm_daily_availability', true);
set local role authenticated;
insert into crm.crm_daily_availability(id, branch_id, crm_name, date, is_available)
values ('0187b000-0000-4000-8000-000000000001', '01876000-0000-4000-8000-000000000001', 'ANU 0187', '2026-09-25', false)
on conflict (branch_id, crm_name, date) do update set is_available = excluded.is_available;
insert into crm.crm_daily_availability(branch_id, crm_name, date, is_available)
values ('01876000-0000-4000-8000-000000000001', 'ANU 0187', '2026-09-25', true)
on conflict (branch_id, crm_name, date) do update set is_available = excluded.is_available;
delete from crm.crm_daily_availability where id = '0187b000-0000-4000-8000-000000000001';
reset role;
select bag_eq(
  $$select action, new_value -> 'changed_columns' from public.audit_logs
    where record_id = '0187b000-0000-4000-8000-000000000001'$$,
  $$values ('crm.crm_daily_availability_insert', '["branch_id", "created_at", "crm_name", "date", "id", "is_available"]'::jsonb),
           ('crm.crm_daily_availability_update', '["is_available"]'::jsonb),
           ('crm.crm_daily_availability_delete', '[]'::jsonb)$$,
  'availability upsert and delete are audited as insert, update and delete'
);

-- The branch manager still cannot write a lookup (RLS unchanged).
select set_config('request.path', '/lookup_gifts', true);
set local role authenticated;
select throws_ok(
  $$insert into crm.lookup_gifts(label) values ('Manager Gift 0187')$$,
  '42501', null, 'a branch manager still cannot write a lookup'
);

-- ---------------------------------------------------------------------------
-- Super admin: lookup maintenance and lead delete
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '01874000-0000-4000-8000-000000000001', true);
insert into crm.lookup_gifts(id, label) values ('0187c000-0000-4000-8000-000000000001', 'Gift 0187');
update crm.lookup_gifts set active = false where id = '0187c000-0000-4000-8000-000000000001';
reset role;
select bag_eq(
  $$select action, new_value -> 'changed_columns' from public.audit_logs where record_id = '0187c000-0000-4000-8000-000000000001'$$,
  $$values ('crm.lookup_gifts_insert', '["active", "id", "label"]'::jsonb), ('crm.lookup_gifts_update', '["active"]'::jsonb)$$,
  'lookup maintenance is audited'
);

select set_config('request.path', '/leads', true);
set local role authenticated;
delete from crm.leads where id = '01879000-0000-4000-8000-000000000001';
reset role;
select is(
  (select new_value -> 'changed_columns' from public.audit_logs where action = 'crm.leads_delete' and record_id = '01879000-0000-4000-8000-000000000001'),
  '[]'::jsonb, 'a lead delete is audited without values'
);
select is(
  (select new_value -> 'changed_columns' from public.audit_logs where action = 'crm.lead_call_history_delete' and record_id = '0187a000-0000-4000-8000-000000000001'),
  '[]'::jsonb, 'the call history removed by the lead delete cascade is recorded without values'
);

-- ---------------------------------------------------------------------------
-- Owner writes (migrations, imports) are outside the browser contract
-- ---------------------------------------------------------------------------
update crm.clients set city = 'Owner Edit 0187' where client_id = '01878000-0000-4000-8000-000000000002';
select is(
  (select count(*)::int from public.audit_logs where record_id = '01878000-0000-4000-8000-000000000002'),
  0, 'an owner write is not audited by the direct-write trigger'
);

select * from finish();
rollback;
