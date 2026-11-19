-- 0434: the real source, never the centralized sheet; Account List (billing software).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0434 test', 'customer-0434') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
select set_config('test.tenant', (select id::text from fx where label = 'tenant'), true);
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;

select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '9820034001', 'sheet_row', 4, 'payload', '{"CONTACT NUMBER": "9820034001", "CLIENT NAME": "Asha", "FIRST  INTERACTION SOURCE": "EXCEL", "SOURCE OF WALK-IN": "Sales Register", "CITY": "Pune", "RECENT PURCHASE DATE": "02-Nov-2026"}'::jsonb),
  jsonb_build_object('row_key', '9820034002', 'sheet_row', 5, 'payload', '{"CONTACT NUMBER": "9820034002", "CLIENT NAME": "Ravi", "FIRST  INTERACTION SOURCE": "EXCEL", "CITY": "Thane"}'::jsonb)), '{"next_row": 6}');
select customer_ingest_apply('master_sheet', 100);

select is((select first_origin from customer.clients where id = pg_temp.client('9820034001')), 'Sales Register', 'the first source is SOURCE OF WALK-IN');
select is((select a ->> 'source_label' from jsonb_array_elements(public.customer_get_client_page((select client_code from customer.clients where id = pg_temp.client('9820034001'))) -> 'answers') a
            where a ->> 'field_key' = 'city'), 'Sales Register', 'an answer shows the real source');
select is((select a ->> 'source_label' from jsonb_array_elements(public.customer_get_client_page((select client_code from customer.clients where id = pg_temp.client('9820034002'))) -> 'answers') a
            where a ->> 'field_key' = 'city'), 'Source not recorded', 'a row with no source says so, never the centralized sheet');
select is((select string_agg(s ->> 'label', ',') from jsonb_array_elements(public.customer_get_client_page((select client_code from customer.clients where id = pg_temp.client('9820034001'))) -> 'sheet_rows') s),
  'Sales Register', 'where it comes from: the real source');
select is((select coalesce(process_name, '-') || '|' || origin from customer.interactions where client_id = pg_temp.client('9820034001') and source = 'master_sheet'),
  'Sales Register|Sales Register', 'the purchase on the timeline carries the real source');
select is((public.customer_list('{"first_sources": ["Sales Register"]}'::jsonb) ->> 'total')::int, 1, 'the list filters by the real first source');
select ok(not exists (select 1 from customer.sources where label ilike '%centralized%') and not exists (select 1 from customer.source_tables where label ilike '%centralized%'),
  'no source is called centralized');

-- Account List.
select customer_ingest_store('software_account_list', jsonb_build_array(
  jsonb_build_object('row_key', 'row:2', 'sheet_row', 2, 'payload', '{"A/c Name": "Asha Mehta", "Group": "CUSTOMER", "Location": "Chembur", "City": ".MUMBAI", "Mobile": "9820034001", "Phone": "9820034009", "Date Of Birth": "12/04/1990"}'::jsonb),
  jsonb_build_object('row_key', 'row:3', 'sheet_row', 3, 'payload', '{"A/c Name": "Gold Supplier Pvt", "Group": "SUPPLIER", "Mobile": "9820034003"}'::jsonb),
  jsonb_build_object('row_key', 'row:4', 'sheet_row', 4, 'payload', '{"A/c Name": "Kiran", "Group": "CUSTOMER", "Mobile": "9"}'::jsonb),
  jsonb_build_object('row_key', 'row:5', 'sheet_row', 5, 'payload', '{"A/c Name": "Kiran", "Group": "CUSTOMER", "Mobile": "9"}'::jsonb)), '{"next_row": 6}');
select is(customer_ingest_apply('software_account_list', 100) - 'pending', '{"applied": 3, "rejected": 1}'::jsonb, 'customer accounts apply; a supplier is not a customer');
select is((select segment || '|' || city || '|' || dob::text from customer.clients where id = pg_temp.client('9820034001')), 'buyer|MUMBAI|1990-04-12',
  'billing software: a client, and its answers rank first');
select is((select client_id from customer.client_phones where phone = customer.normalize_phone('9820034009')), pg_temp.client('9820034001'), 'the second number is kept');
select is((select count(distinct client_id)::int from customer.ingest_rows where source = 'software_account_list' and row_key in ('row:4', 'row:5')), 1,
  'identical rows without a valid number are one person');

select * from finish();
rollback;
