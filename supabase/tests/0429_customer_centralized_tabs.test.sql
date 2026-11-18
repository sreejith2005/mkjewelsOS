-- 0429: WRONG NUMBER, DONT CONTACT ANYMORE, ALL BUYER LIST, ALL OLD FINAL DATA.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0429 test', 'customer-0429') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;

-- Known people from the main tab, one with a follow-up due.
select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '9820029001', 'sheet_row', 4, 'payload', '{"CONTACT NUMBER": "9820029001", "CLIENT NAME": "Asha", "FIRST  INTERACTION SOURCE": "EXCEL"}'::jsonb),
  jsonb_build_object('row_key', '9820029002', 'sheet_row', 5, 'payload', '{"CONTACT NUMBER": "9820029002", "CLIENT NAME": "Ravi"}'::jsonb),
  jsonb_build_object('row_key', '982002900', 'sheet_row', 6, 'payload', '{"CONTACT NUMBER": "982002900", "CLIENT NAME": "Chetan"}'::jsonb)), '{"next_row": 7}');
select customer_ingest_apply('master_sheet', 100);
insert into customer.follow_ups (tenant_id, client_id, kind, due_at)
select (select id from fx where label = 'tenant'), pg_temp.client('9820029002'), 'hot', now() + interval '1 day';

select customer_ingest_store('master_wrong_number', jsonb_build_array(
  jsonb_build_object('row_key', '9820029001', 'sheet_row', 2, 'payload', '{"CONTACT NUMBER": "9820029001", "CLIENT NAME": "Asha", "WRONG NUMBER REASON": "Call status: WRONG NUMBER", "INTERACTION DATE": "14-Mar-2025 10:05:00", "SOURCE": "CALLING MASTER DATA"}'::jsonb)), '{"next_row": 3}');
select customer_ingest_store('master_dont_contact', jsonb_build_array(
  jsonb_build_object('row_key', '9820029002', 'sheet_row', 2, 'payload', '{"CONTACT NUMBER": "9820029002", "CLIENT NAME": "Ravi", "NEGATIVE NOTE / REMARK": "Asked not to call again", "INTERACTION DATE": "02-Nov-2026 11:20"}'::jsonb)), '{"next_row": 3}');
select customer_ingest_store('master_buyer_list', jsonb_build_array(
  jsonb_build_object('row_key', '9820029003', 'sheet_row', 2, 'payload', '{"CLIENT NAME": "Meera", "CONTACT NUMBER": "9820029003", "SALES PERSON": "Neha", "TYPE OF CLIENT": "ROCKET"}'::jsonb)), '{"next_row": 3}');
select customer_ingest_store('master_old_final', jsonb_build_array(
  jsonb_build_object('row_key', '9820029004', 'sheet_row', 2, 'payload', '{"CLIENT ID": "M100001", "FAMILY ID": "M100001", "FIRST INTERACTION SOURCE": "Zaveri Bazaar Customer", "BUYER / NON BUYER": "BUYER", "CLIENT NAME": "Old Kiran", "CONTACT NUMBER": "9820029004", "DATE OF BIRTH": "12/4/", "ANNIVERSARY": "05/06/2001", "COMMUNITY / CASTE": "Sindhi"}'::jsonb),
  jsonb_build_object('row_key', '982002900', 'sheet_row', 3, 'payload', '{"CLIENT NAME": "Chetan P", "CONTACT NUMBER": "982002900", "CITY": "Thane"}'::jsonb),
  jsonb_build_object('row_key', '9820029001', 'sheet_row', 4, 'payload', '{"CLIENT NAME": "Asha", "CONTACT NUMBER": "9820029001", "CITY": "Mumbai", "COMMUNITY / CASTE": "Gujarati"}'::jsonb)), '{"next_row": 5}');
select is(customer_ingest_apply('master_wrong_number', 100) - 'pending', '{"applied": 1, "rejected": 0}'::jsonb, 'wrong number rows apply');
select is(customer_ingest_apply('master_dont_contact', 100) - 'pending', '{"applied": 1, "rejected": 0}'::jsonb, 'do not contact rows apply');
select is(customer_ingest_apply('master_buyer_list', 100) - 'pending', '{"applied": 1, "rejected": 0}'::jsonb, 'buyer list rows apply');
select is(customer_ingest_apply('master_old_final', 100) - 'pending', '{"applied": 3, "rejected": 0}'::jsonb, 'old final data rows apply');

select ok('wrong_number' = any(customer.client_tags(pg_temp.client('9820029001'))) and not customer.callable(pg_temp.client('9820029001')),
  'a wrong number is tagged and never called');
select is((select value from customer.client_field_values where client_id = pg_temp.client('9820029001') and field_key = 'wrong_number_reason'),
  'Call status: WRONG NUMBER', 'the reason is kept as written');

select is((select do_not_call::text || '|' || archive_reason from customer.clients where id = pg_temp.client('9820029002')), 'true|do_not_contact',
  'do not contact: never called, hidden');
select is((select status from customer.follow_ups where client_id = pg_temp.client('9820029002')), 'cancelled', 'their pending follow-up is cancelled');
select is((public.customer_list(jsonb_build_object('q', '9820029002')) -> 'total')::int, 0, 'they never show in the list or a search');
-- A later sheet with the same number does not bring them back.
select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '9820029002', 'sheet_row', 5, 'payload', '{"CONTACT NUMBER": "9820029002", "CLIENT NAME": "Ravi K"}'::jsonb)), '{"next_row": 7}');
select customer_ingest_apply('master_sheet', 100);
select is((select archive_reason from customer.clients where id = pg_temp.client('9820029002')), 'do_not_contact', 'a later row of another sheet keeps them hidden');

select is((select segment from customer.clients where id = pg_temp.client('9820029003')), 'buyer', 'on the buyer list makes a client');
select is((customer.client_tags(pg_temp.client('9820029003')))[1], 'tier:ROCKET', 'the ticket size is the first tag');

select is((select first_source || '|' || segment from customer.clients where id = pg_temp.client('9820029004')), 'master_old_final|buyer',
  'old final data adds new people, buyers as clients');
select is((select string_agg(field_key || '=' || value || '@' || coalesce(origin, '-'), ',' order by field_key) from customer.client_field_values
            where client_id = pg_temp.client('9820029004') and field_key in ('dob', 'anniversary')), 'anniversary=2001-06-05@Zaveri Bazaar Customer,dob=--04-12@Zaveri Bazaar Customer',
  'dates with and without a year, with the real source');
select is((select count(distinct client_id)::int from customer.client_identifiers where tenant_id = (select id from fx where label = 'tenant') and id_type = 'unverified_phone' and value = '982002900'), 1,
  'the same invalid number in two tabs is one customer');
select is((select customer.current_answer(pg_temp.client('9820029001'), 'community')), 'Gujarati', 'old data fills a gap');

-- Filler numbers stay apart.
select customer_ingest_store('master_old_final', jsonb_build_array(
  jsonb_build_object('row_key', '00000000', 'sheet_row', 5, 'payload', '{"CLIENT NAME": "A", "CONTACT NUMBER": "00000000"}'::jsonb)), '{"next_row": 6}');
select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '00000000', 'sheet_row', 9, 'payload', '{"CLIENT NAME": "B", "CONTACT NUMBER": "00000000"}'::jsonb)), '{"next_row": 10}');
select customer_ingest_apply('master_old_final', 100);
select customer_ingest_apply('master_sheet', 100);
select is((select count(distinct client_id)::int from customer.ingest_rows where row_key = '00000000'), 2, 'a filler number never joins two people');

select * from finish();
rollback;
