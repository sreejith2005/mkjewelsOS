-- 0454: the customer table - chosen columns, any filter, sort, values.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid; b uuid; d uuid; v_auth uuid; v_id uuid; p record;
begin
  insert into tenants(name, slug) values ('0454 test', 'customer-0454') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK984') returning id into m;
  insert into branches(tenant_id, name, code) values (t, '0454 Store', 'S0454') returning id into b;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'Sales', 'D0454') returning id into d;
  insert into fx values ('tenant', t), ('mumbai', m);
  for p in select * from (values ('boss', 'super_admin'), ('staff', 'staff')) as x(name, role) loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p.name || '-0454@test.local', 'x', now(), now())
    returning id into v_auth;
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (t, v_auth, b, d, '0454 ' || p.name, 'E0454-' || p.name, p.name || '-0454@test.local', p.role::user_role, 'active', 'active', true) returning id into v_id;
    insert into fx values (p.name, v_auth), (p.name || '_profile', v_id);
  end loop;
end $$;
update customer.source_tables set franchise_code = 'MK984' where source in ('master_sheet', 'software_account_list');

create function pg_temp.sign_in(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from fx where label = p_who), 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', (select id from fx where label = p_who)::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true) $$;
update customer.source_tables set franchise_code = 'MK984' where source in ('master_sheet', 'master_wrong_number', 'master_buyer_soft');
create function pg_temp.m(p_phone text, p_name text, p_row integer, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_phone, 'sheet_row', p_row,
    'payload', jsonb_build_object('CONTACT NUMBER', p_phone, 'CLIENT NAME', p_name) || p_extra) $$;
select customer_ingest_store('master_sheet', jsonb_build_array(
  pg_temp.m('9820054001', 'Asha Shah', 4, '{"CITY": "Mumbai", "BRANCH": "Bandra"}'),
  pg_temp.m('9820054002', 'Ravi Jain', 5, '{"CITY": "Pune", "BRANCH": "Andheri"}'),
  pg_temp.m('9820054003', 'Meena Rao', 6, '{"CITY": "mumbai "}')), '{"next_row": 7}');
select customer_ingest_apply('master_sheet', 100);
select customer_ingest_store('master_buyer_soft', jsonb_build_array(jsonb_build_object('row_key', '9820054002', 'sheet_row', 2,
  'payload', '{"BUYER / NON BUYER": "BUYER", "CONTACT NUMBER": "9820054002", "CLIENT NAME": "Ravi Jain", "RECENT PURCHASE DATE": "18-Sep-2026", "TYPE OF CLIENT": "GOLD"}'::jsonb)), '{"next_row": 3}');
select customer_ingest_apply('master_buyer_soft', 100);
select customer_ingest_store('master_wrong_number', jsonb_build_array(jsonb_build_object('row_key', '9820054004', 'sheet_row', 2,
  'payload', '{"CONTACT NUMBER": "9820054004", "CLIENT NAME": "Wrong One", "WRONG NUMBER REASON": "wrong number"}'::jsonb)), '{"next_row": 3}');
select customer_ingest_apply('master_wrong_number', 100);

create function pg_temp.t(p jsonb) returns jsonb language sql as $$ select public.customer_table(p) $$;
create function pg_temp.names(p jsonb) returns text language sql as $$
  select string_agg(x -> 'values' ->> 'name', ', ' order by o) from jsonb_array_elements(public.customer_table(p) -> 'rows') with ordinality y(x, o) $$;

select throws_ok('select public.customer_table(''{}'')', '42501', null, 'not signed in: denied');
select pg_temp.sign_in('boss');

select ok((select count(*) from jsonb_array_elements(public.customer_table_fields()) x where x ->> 'key' in ('name', 'city', 'store', 'client_category')) = 4,
  'the column picker lists core fields and sheet answers');
select ok(exists (select 1 from customer.client_answers a where a.answers ->> 'store' = 'Bandra'), 'current answers are kept per customer');
select is((pg_temp.t('{"columns": ["name"], "sort": [{"field": "name", "dir": "asc"}]}') ->> 'total')::integer, 3, 'the wrong number is left out by default');
select is(pg_temp.names('{"columns": ["name"], "sort": [{"field": "name", "dir": "desc"}]}'), 'Ravi Jain, Meena Rao, Asha Shah', 'sorted by any column');
select is(pg_temp.names('{"columns": ["name"], "filter": {"match": "all", "items": [{"field": "city", "op": "is_any_of", "value": ["Mumbai"]}]}, "sort": [{"field": "name"}]}'),
  'Asha Shah, Meena Rao', 'is any of ignores case and spaces');
select is(pg_temp.names('{"columns": ["name"], "filter": {"items": [{"field": "store", "op": "contains", "value": "and"}]}, "sort": [{"field": "name"}]}'),
  'Asha Shah, Ravi Jain', 'contains on a sheet answer');
select is(pg_temp.names('{"columns": ["name"], "filter": {"match": "any", "items": [{"field": "city", "op": "is_any_of", "value": ["Pune"]}, {"field": "store", "op": "is_any_of", "value": ["Bandra"]}]}, "sort": [{"field": "name"}]}'),
  'Asha Shah, Ravi Jain', 'any of several conditions');
select is(pg_temp.names('{"columns": ["name"], "filter": {"items": [{"field": "segment", "op": "is_any_of", "value": ["Client"]}, {"match": "any", "items": [{"field": "recent_purchase_date", "op": "after", "value": "2026-01-01"}]}]}}'),
  'Ravi Jain', 'nested groups and dates from the sheet');
select is(pg_temp.names('{"columns": ["name"], "filter": {"items": [{"field": "store", "op": "is_empty"}]}}'), 'Meena Rao', 'is empty');
select is(pg_temp.names('{"columns": ["name"], "filter": {"items": [{"field": "data_problems", "op": "has_any_of", "value": ["wrong_number"]}]}}'), 'Wrong One',
  'a data-problem filter shows the set-aside customers');
select is((pg_temp.t('{"columns": ["name", "phone", "client_category"], "filter": {"items": [{"field": "name", "op": "is_any_of", "value": ["Ravi Jain"]}]}}') -> 'rows' -> 0 -> 'values'),
  jsonb_build_object('name', 'Ravi Jain', 'phone', customer.normalize_phone('9820054002'), 'client_category', 'GOLD'), 'the chosen columns, in order');
select is((pg_temp.t('{"columns": ["name"], "limit": 1, "offset": 1, "sort": [{"field": "name"}]}') -> 'rows' -> 0 -> 'values' ->> 'name'), 'Meena Rao', 'pages');
select is(pg_temp.names('{"columns": ["name"], "filter": {"items": [{"field": "name", "op": "contains", "value": "'' or 1=1 --"}]}}'), null, 'quotes in a value are only text');
select throws_ok('select public.customer_table(''{"filter": {"items": [{"field": "name); drop table x; --", "op": "is_empty"}]}}'')', '22023', null, 'unknown fields are refused');
select throws_ok('select public.customer_table(''{"filter": {"items": [{"field": "first_seen_at", "op": "contains", "value": "x"}]}}'')', '22023', null, 'an operator must fit the type');
select throws_ok('select public.customer_table(''{"sort": [{"field": "phone"}]}'')', '22023', null, 'only sortable fields sort');
select is((public.customer_table_values('city') -> 0 ->> 'count')::integer, 2, 'the value picker counts each value (Mumbai and mumbai are one since 0455)');

select * from finish();
rollback;
