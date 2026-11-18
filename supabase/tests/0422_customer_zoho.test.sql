-- 0422: the old Zoho CRM export.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0422 test', 'customer-0422') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;

select is(customer.parse_date_ordered('5/14/23 13:10', 'mdy'), '2023-05-14 13:10:00+05:30'::timestamptz, 'Created Time is month first, two-digit year');
select is(customer.parse_date_ordered('14/5/1990', 'mdy'), '1990-05-14 00:00:00+05:30'::timestamptz, 'a part above 12 is the day whatever the column');
select is(customer.parse_date_ordered('3/4/2024', 'dmy'), '2024-04-03 00:00:00+05:30'::timestamptz, 'both parts 12 or below: the column decides');

-- A Runo call already knows this phone: Zoho ranks below it.
select customer_ingest_store('runo', jsonb_build_array(jsonb_build_object('row_key', 'z-call', 'sheet_row', 2, 'payload', jsonb_build_object(
  'callId', 'z-call', 'Mobile Number', '9820022001', 'Name', 'Asha Mehta', 'Interaction Date', '01/11/2026 11:00:00', 'Status', 'Interested', 'Street', 'Juhu'))), '{"next_row": 3}');
select customer_ingest_apply('runo', 100);
select customer_ingest_store('zoho', jsonb_build_array(
  jsonb_build_object('row_key', '101', 'sheet_row', 2, 'payload', '{"Sr. No": "101", "Contact Name": "Asha", "Mobile": "9820022001", "Address": "Thane", "Email ID": "Asha@Example.com", "Date of Birth": "14/5/1990", "Lead Source": "EXCEL", "Created Time": "5/14/23 13:10"}'::jsonb),
  jsonb_build_object('row_key', '102', 'sheet_row', 3, 'payload', '{"Sr. No": "102", "Contact Name": "Bina", "Mobile": "9820022002", "Store": "CG Road Ahmedabad", "Sales Person": "Kiran", "Buying ?": "Yes", "Visit Date": "3/4/2024", "Created Time": "4/3/24 10:00"}'::jsonb),
  jsonb_build_object('row_key', '103', 'sheet_row', 4, 'payload', '{"Sr. No": "103", "Contact Name": "Chetan", "Mobile": "982002200", "Created Time": "1/2/22 09:00"}'::jsonb)),
  '{"headers": ["Sr. No", "Contact Name", "Mobile", "Email ID", "Date of Birth", "Address", "Lead Source", "Store", "Sales Person", "Buying ?", "Visit Date", "Created Time"], "next_row": 5, "completed": true}');
select is(customer_ingest_apply('zoho', 100) - 'pending', '{"applied": 3, "rejected": 0}'::jsonb, 'every Zoho row is applied, an invalid number too');

select is((select address || '|' || email || '|' || dob::text || '|' || first_source || '|' || first_seen_at::text from customer.clients where id = pg_temp.client('9820022001')),
  'Juhu|asha@example.com|1990-05-14|zoho|' || ('2023-05-14 13:10:00+05:30'::timestamptz)::text,
  'Zoho adds what is missing, ranks below the call, and dates the customer from Created Time');
select is((select primary_name from customer.clients where id = pg_temp.client('9820022001')), 'Asha Mehta', 'the newer name stays the main name');
select is((select channel || '|' || purpose || '|' || outcome || '|' || result || '|' || store_name || '|' || occurred_at::text
             from customer.interactions where source = 'zoho' and client_id = pg_temp.client('9820022002')),
  'walk_in|purchase|Yes|positive|CG Road Ahmedabad|' || ('2024-04-03 00:00:00+05:30'::timestamptz)::text, 'a visit date is a store visit; Yes is a purchase');
select is((select segment from customer.clients where id = pg_temp.client('9820022002')), 'buyer', 'and the customer is a buyer');
select is((select count(*)::int from customer.interactions where source = 'zoho' and client_id = pg_temp.client('9820022001')), 0, 'no visit date: no visit');
select ok((select source_rank from customer.sources where source = 'zoho') < (select source_rank from customer.sources where source = 'runo'),
  'Zoho ranks below every live source (the centralized sheet moved up in 0427)');

select * from finish();
rollback;
