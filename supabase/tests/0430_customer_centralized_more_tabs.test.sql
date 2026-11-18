-- 0430: NO NAME, NO NUMBER, BANGALORE BUYER LIST, SCOT, CHIRAYU APP.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0430 test', 'customer-0430') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;

-- Known from the main tab, with a sheet CLIENT ID.
select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '9820030001', 'sheet_row', 4, 'payload', '{"CLIENT ID": "M300001", "CONTACT NUMBER": "9820030001", "CLIENT NAME": "Asha Shah"}'::jsonb)), '{"next_row": 5}');
select customer_ingest_apply('master_sheet', 100);

select customer_ingest_store('master_no_number', jsonb_build_array(
  jsonb_build_object('row_key', 'M300001', 'sheet_row', 2, 'payload', '{"CLIENT ID": "M300001", "FIRST INTERACTION SOURCE": "Sales Register", "BUYER / NON BUYER": "BUYER", "CLIENT NAME": "Asha Shah", "CITY": "Pune"}'::jsonb),
  jsonb_build_object('row_key', 'M300002', 'sheet_row', 3, 'payload', '{"CLIENT ID": "M300002", "FIRST INTERACTION SOURCE": "Sales Register", "BUYER / NON BUYER": "BUYER", "CLIENT NAME": "Dev Rao"}'::jsonb)), '{"next_row": 4}');
select customer_ingest_store('master_no_name', jsonb_build_array(
  jsonb_build_object('row_key', '9820030003', 'sheet_row', 2, 'payload', '{"CLIENT ID": "M300003", "FIRST INTERACTION SOURCE": "Exhibition", "CONTACT NUMBER": "9820030003", "CITY": "Hyderabad"}'::jsonb)), '{"next_row": 3}');
select customer_ingest_store('master_bangalore_buyers', jsonb_build_array(
  jsonb_build_object('row_key', '9820030004', 'sheet_row', 2, 'payload', '{"BUYER / NON BUYER": "BUYER", "CLIENT NAME": "Kiran", "CONTACT NUMBER": "9820030004"}'::jsonb)), '{"next_row": 3}');
select customer_ingest_store('master_scot', jsonb_build_array(
  jsonb_build_object('row_key', 'row:2', 'sheet_row', 2, 'payload', '{"Contact Number": "9820030001", "Customer": "Asha S", "Other Client Name(s)": "Asha Mehta | A Shah", "Sales Person": "Neha", "LAST INTERACTION DATE": "05/03/2025", "ASSINGED CALL PERSON": "SHRUTI GAIKWAD"}'::jsonb),
  jsonb_build_object('row_key', 'row:3', 'sheet_row', 3, 'payload', '{"Customer": "No Phone Person", "Sales Person": "Neha"}'::jsonb),
  jsonb_build_object('row_key', 'row:4', 'sheet_row', 4, 'payload', '{"Customer": "No Phone Person", "Sales Person": "Neha"}'::jsonb)), '{"next_row": 5}');
select customer_ingest_store('master_chirayu_app', jsonb_build_array(
  jsonb_build_object('row_key', 'row:2', 'sheet_row', 2, 'payload', '{"Name": "Ritu", "Mobile": "9820030005", "City": "Surat", "Mobile Type": "Android", "Entry Date Time": "14-03-2025"}'::jsonb),
  jsonb_build_object('row_key', 'row:3', 'sheet_row', 3, 'payload', '{"Name": "Ritu", "Mobile": "9820030005", "City": "Surat", "Mobile Type": "Android", "Entry Date Time": "20-03-2025"}'::jsonb)), '{"next_row": 4}');

select is((select jsonb_object_agg(s, customer_ingest_apply(s, 100) - 'pending') from unnest(array['master_no_number', 'master_no_name', 'master_bangalore_buyers', 'master_scot', 'master_chirayu_app']) s),
  '{"master_scot": {"applied": 3, "rejected": 0}, "master_no_name": {"applied": 1, "rejected": 0}, "master_no_number": {"applied": 2, "rejected": 0}, "master_chirayu_app": {"applied": 2, "rejected": 0}, "master_bangalore_buyers": {"applied": 1, "rejected": 0}}'::jsonb,
  'every row of the five tabs applies');

select is((select client_id from customer.ingest_rows where source = 'master_no_number' and row_key = 'M300001'), pg_temp.client('9820030001'),
  'a row with no number finds its person by CLIENT ID');
select is((select segment || '|' || coalesce(city, '-') from customer.clients where id = pg_temp.client('9820030001')), 'buyer|Pune',
  'it adds what the main tab lacks: bought, and the city');
select ok((select client_id from customer.ingest_rows where source = 'master_no_number' and row_key = 'M300002') is not null
  and (select client_id from customer.ingest_rows where source = 'master_no_number' and row_key = 'M300002') <> pg_temp.client('9820030001'),
  'an unknown CLIENT ID without a number is a customer of its own');
select is((select segment from customer.clients where id = pg_temp.client('9820030004')), 'buyer', 'Bangalore buyers are clients');
select is((select primary_name from customer.clients where id = pg_temp.client('9820030003')), null, 'NO NAME rows keep no invented name');

select is((select string_agg(name, ',' order by name) from customer.client_names where client_id = pg_temp.client('9820030001')),
  'A Shah,Asha Mehta,Asha S,Asha Shah', 'SCOT other names are kept');
select is((select value from customer.client_field_values where client_id = pg_temp.client('9820030001') and field_key = 'assigned_call_person'),
  'SHRUTI GAIKWAD', 'the assigned caller is kept as written');
select is((select count(distinct client_id)::int from customer.ingest_rows where source = 'master_scot' and row_key in ('row:3', 'row:4')), 1,
  'identical rows without a number are one person');

select is((select count(distinct client_id)::int from customer.ingest_rows where source = 'master_chirayu_app'), 1, 'two app sign-ups of one number are one person');
select is((select string_agg(distinct origin, ',') from customer.client_field_values where client_id = pg_temp.client('9820030005')), 'Chirayu app',
  'the app is the real source');

select * from finish();
rollback;
