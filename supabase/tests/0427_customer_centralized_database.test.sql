-- 0427: MK CENTRALIZED CLIENT DATABASE.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0427 test', 'customer-0427') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;

-- An existing customer from a Runo call, with a city.
select customer_ingest_store('runo', jsonb_build_array(jsonb_build_object('row_key', 'm-call', 'sheet_row', 2, 'payload', jsonb_build_object(
  'callId', 'm-call', 'Mobile Number', '9820027001', 'Name', 'Asha', 'Interaction Date', '01/10/2026 11:00:00', 'Status', 'Interested', 'City', 'Pune'))), '{"next_row": 3}');
select customer_ingest_apply('runo', 100);

select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '9820027001', 'sheet_row', 4, 'payload', '{"CLIENT ID": "MKC-100777", "FAMILY ID": "MKF-100777", "FIRST  INTERACTION SOURCE": "GUPSHUP", "BUYER / NON BUYER": "BUYER", "CLIENT NAME": "Asha Mehta", "CONTACT NUMBER": "9820027001", "FIRST PURCHASE DATE": "14-Mar-2025", "RECENT PURCHASE DATE": "02-Nov-2026", "LAST INTERACTION DATE": "05-Nov-2026", "CITY": "Mumbai", "DATE OF BIRTH": "12-Apr-1990", "COMMUNITY / CASTE": "GUJARATI", "SCRIPT STATUS": "CLIENT - NO KEYWORD FOUND", "STATUS": "Jewels DATA", "SUGAR": "COFFEE", "GOOGLE REVIEW": "ALREADY_DONE"}'::jsonb),
  jsonb_build_object('row_key', '9820027002', 'sheet_row', 5, 'payload', '{"CLIENT ID": "MKC-A2000001", "FAMILY ID": "MKF-100777", "BUYER / NON BUYER": "NON BUYER", "CLIENT NAME": "Ravi Mehta", "CONTACT NUMBER": "9820027002", "FIRST PURCHASE DATE": "01-Jan-2025", "RECENT PURCHASE DATE": "01-Jan-2025", "SCRIPT STATUS": "NON-CLIENT - COURIER / DELIVERY"}'::jsonb),
  jsonb_build_object('row_key', '982002700', 'sheet_row', 6, 'payload', '{"CLIENT NAME": "Chetan", "CONTACT NUMBER": "982002700", "FIRST INTERACTION SOURCE": "EXCEL"}'::jsonb)),
  '{"headers": ["CLIENT ID", "FAMILY ID", "FIRST INTERACTION SOURCE", "BUYER / NON BUYER", "CLIENT NAME", "CONTACT NUMBER"], "next_row": 7}');
select is(customer_ingest_apply('master_sheet', 100) - 'pending', '{"applied": 3, "rejected": 0}'::jsonb, 'every row applied, an invalid number too');

select is((select segment || '|' || city || '|' || dob::text || '|' || community || '|' || (first_purchase_at at time zone 'Asia/Kolkata')::date::text
             || '|' || (last_purchase_at at time zone 'Asia/Kolkata')::date::text from customer.clients where id = pg_temp.client('9820027001')),
  'buyer|Mumbai|1990-04-12|GUJARATI|2025-03-14|2026-11-02', 'the existing customer gains the sheet''s facts; it outranks the call; purchases make a client');
select is((select string_agg(outcome || ':' || coalesce(origin, '-'), ',' order by occurred_at) from customer.interactions where source = 'master_sheet' and client_id = pg_temp.client('9820027001')),
  'FIRST PURCHASE DATE:GUPSHUP,RECENT PURCHASE DATE:GUPSHUP', 'two purchases on the timeline, with the real source');
select is((select string_agg(distinct origin, ',') from customer.client_field_values where client_id = pg_temp.client('9820027001') and source = 'master_sheet'),
  'GUPSHUP', 'every answer carries the real source');
select is((select count(*)::int from customer.interactions where source = 'master_sheet' and client_id = pg_temp.client('9820027002')), 1,
  'the same first and recent purchase day is one purchase');
select is((select segment from customer.clients where id = pg_temp.client('9820027002')), 'buyer', 'a purchase makes a client even when the sheet says NON BUYER');
select is((select household_id from customer.clients where id = pg_temp.client('9820027002')), (select household_id from customer.clients where id = pg_temp.client('9820027001')),
  'FAMILY ID puts the family together');
select is((select value from customer.client_field_values where client_id = pg_temp.client('9820027002') and field_key = 'contact_type'),
  'NON-CLIENT - COURIER / DELIVERY', 'SCRIPT STATUS is kept as written');
select is((select value from customer.client_field_values where client_id = pg_temp.client('9820027001') and field_key = 'sugar'), 'COFFEE',
  'SUGAR is kept as written');
select is((select source from customer.origins where origin = 'EXCEL') is null and exists (select 1 from customer.origins where origin = 'GUPSHUP'), true,
  'every real source seen is listed in customer.origins, whatever the spacing of the header');

-- The recent purchase date is cleared in the sheet: that purchase goes.
update customer.ingest_rows set updated_at = now() - interval '1 minute' where row_key = '9820027001';
select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '9820027001', 'sheet_row', 4, 'payload', '{"CONTACT NUMBER": "9820027001", "CLIENT NAME": "Asha Mehta", "FIRST PURCHASE DATE": "14-Mar-2025", "FIRST INTERACTION SOURCE": "GUPSHUP"}'::jsonb)), '{"next_row": 7}');
select customer_ingest_apply('master_sheet', 100);
select is((select count(*)::int from customer.interactions where source = 'master_sheet' and client_id = pg_temp.client('9820027001')), 1,
  'a purchase date removed from the row removes that purchase');
select is((select source_rank from customer.sources where source = 'master_sheet'), 4, 'the sheet ranks 4');

select * from finish();
rollback;
