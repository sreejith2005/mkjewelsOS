-- D5: ported CRM functions break ORDER BY ties with the primary key (0190).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'crm' and p.proname in ('browse_clients', 'search_clients', 'create_not_bought_followup_from_visit_form')
    and pg_get_functiondef(p.oid) like '%crm-port: deterministic order%'), 3, 'the three tie-prone functions carry the tie-breaker');
select is((select count(*)::integer from pg_trigger t where t.tgrelid = 'crm.visit_forms'::regclass and not t.tgisinternal
  and t.tgfoid = 'crm.create_not_bought_followup_from_visit_form()'::regprocedure), 1, 'the follow-up trigger still uses the replaced function');

-- A super_admin, as in 0183, to call the RPCs.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('01904000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'crm-0190@example.invalid', crypt('local-test-only', gen_salt('bf')), now(), '{}', '{}', now(), now());
insert into tenants(id, name, slug) values ('01901000-0000-4000-8000-000000000001', 'CRM 0190 tenant', 'crm-0190');
insert into branches(id, tenant_id, name, code) values ('01902000-0000-4000-8000-000000000001', '01901000-0000-4000-8000-000000000001', 'JewelOS 0190', 'C190A');
insert into departments(id, tenant_id, branch_id, name, code) values ('01903000-0000-4000-8000-000000000001', '01901000-0000-4000-8000-000000000001', '01902000-0000-4000-8000-000000000001', 'Dept 0190', 'C190D');
insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
values ('01905000-0000-4000-8000-000000000001', '01904000-0000-4000-8000-000000000001', '01901000-0000-4000-8000-000000000001', '01902000-0000-4000-8000-000000000001',
  '01903000-0000-4000-8000-000000000001', 'CRM 0190 admin', '0000019000', 'crm-0190@example.invalid', 'C190-1', 'super_admin', 'active', 'active', true, '{}');
insert into crm.users(id, name, email, role, branch_id, jewelos_profile_id)
values ('01907000-0000-4000-8000-000000000001', 'CRM 0190 Admin', 'crm-0190-admin@example.invalid', 'super_admin', null, '01905000-0000-4000-8000-000000000001');

-- Five clients that tie on every original sort key (same name, same last visit, no phone match),
-- inserted in an order unrelated to their ids.
insert into crm.clients(client_id, primary_name, primary_phone, last_visit_date)
select ('01908000-0000-4000-8000-00000000000' || n)::uuid, 'Tie Client 0190', '90190000' || lpad(n::text, 2, '0'), '2026-09-01T10:00:00Z'
from unnest(array[4, 1, 5, 3, 2]) n;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '01904000-0000-4000-8000-000000000001', true);
select is((select array_agg(client_id order by ordinality)::text from crm.browse_clients('Tie Client 0190', null, 0, 200) with ordinality),
  '{01908000-0000-4000-8000-000000000001,01908000-0000-4000-8000-000000000002,01908000-0000-4000-8000-000000000003,01908000-0000-4000-8000-000000000004,01908000-0000-4000-8000-000000000005}',
  'browse_clients breaks ties by client_id');
select is((select array_agg(client_id order by ordinality)::text from crm.browse_clients('Tie Client 0190', null, 2, 2) with ordinality),
  '{01908000-0000-4000-8000-000000000003,01908000-0000-4000-8000-000000000004}', 'browse_clients pages are stable');
select is((select array_agg(client_id order by ordinality)::text from crm.search_clients('Tie Client 0190', 20) with ordinality),
  '{01908000-0000-4000-8000-000000000001,01908000-0000-4000-8000-000000000002,01908000-0000-4000-8000-000000000003,01908000-0000-4000-8000-000000000004,01908000-0000-4000-8000-000000000005}',
  'search_clients breaks ties by client_id');
reset role;

select * from finish();
rollback;
