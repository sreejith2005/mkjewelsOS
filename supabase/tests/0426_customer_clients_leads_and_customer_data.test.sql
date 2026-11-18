-- 0426: client or lead; dates with month names; Database CUSTOMER DATA.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0426 test', 'customer-0426') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;

select is(customer.parse_sheet_timestamp('14-Mar-2025'), '2025-03-14 00:00:00+05:30'::timestamptz, 'a date with a month name is read');
select is(customer.as_iso_date('05/11/1990'), '1990-11-05', 'a day-first date as YYYY-MM-DD');
select is(customer.phone_with_code('+971', '50 123 4567'), '+971501234567', 'a foreign code and number make one number');
select is(customer.phone_with_code('+91', '9820026001'), '9820026001', '+91 leaves the number as written');

create function pg_temp.r(p_row integer, p jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_key', 'row:' || p_row, 'sheet_row', p_row, 'payload', p) $$;
select customer_ingest_store('customer_data', jsonb_build_array(
  pg_temp.r(2, '{"FIRST NAME": "Asha", "SURNAME": "Mehta", "COUNTRY CODE": "+91", "MOBILE NO": "9820026001", "TAG": "Customer", "STATUS": "Bought", "STORE": "MK Bandra", "SALES PERSON": "Uma", "DOB": "12/04/1990", "STATE": "asha@example.com", "SPOUSE NAME": "Ravi", "SPOUSE NUMBER": "9820026002", "Address": "Juhu"}'),
  pg_temp.r(3, '{"FIRST NAME": "Asha", "SURNAME": "Mehta", "COUNTRY CODE": "+91", "MOBILE NO": "9820026001", "TAG": "Customer", "STATUS": "Bought"}'),
  pg_temp.r(4, '{"FIRST NAME": "Bina", "MOBILE NO": "#N/A", "TAG": "Customer", "STATUS": "Bought", "CITY": "Pune"}'),
  pg_temp.r(5, '{"FIRST NAME": "Bina", "MOBILE NO": "#N/A", "TAG": "Customer", "STATUS": "Bought", "CITY": "Pune"}')),
  '{"headers": ["FIRST NAME", "SURNAME", "COUNTRY CODE", "MOBILE NO", "TAG", "STATUS", "CITY"], "next_row": 6, "completed": true}');
select customer_ingest_store('customer_data_abroad', jsonb_build_array(
  pg_temp.r(2, '{"FIRST NAME": "Chetan", "COUNTRY CODE": "+1", "MOBILE NO": "4155550123", "CITY": "San Jose", "COUNTRY": "USA", "SALES PERSON": "Deepa"}')),
  '{"headers": ["FIRST NAME", "COUNTRY CODE", "MOBILE NO", "CITY", "COUNTRY"], "next_row": 3, "completed": true}');
select is(customer_ingest_apply('customer_data', 100) - 'pending', '{"applied": 4, "rejected": 0}'::jsonb, 'every row applied');
select customer_ingest_apply('customer_data_abroad', 100);

select is((select segment || '|' || email || '|' || dob::text || '|' || address from customer.clients where id = pg_temp.client('9820026001')),
  'buyer|asha@example.com|1990-04-12|Juhu', 'STATUS Bought makes a client; an email in STATE is the email');
select is((select count(*)::int from customer.ingest_rows r join customer.clients c on c.id = r.client_id where r.source = 'customer_data' and c.primary_name = 'Bina'), 2,
  'two identical rows without a number are kept');
select is((select count(distinct client_id)::int from customer.ingest_rows where source = 'customer_data' and row_key in ('row:4', 'row:5')), 1,
  'and are one customer');
select is((select household_id from customer.clients where id = pg_temp.client('9820026002')), (select household_id from customer.clients where id = pg_temp.client('9820026001')),
  'the spouse is in the same family');
select is((select country || '|' || segment from customer.clients where id = pg_temp.client('+14155550123')), 'USA|lead',
  'an abroad customer by country code and number; no Bought mark: a lead');

-- Client or lead follows the evidence.
delete from customer.client_field_values where client_id = pg_temp.client('9820026001') and field_key = 'buyer_status';
select is((select segment from customer.clients where id = pg_temp.client('9820026001')), 'lead', 'when the buyer mark goes, the client is a lead again');
select is((select count(*)::int from customer.clients where segment = 'non-buyer'), 0, 'nobody is a non-buyer: client or lead');

select * from finish();
rollback;
