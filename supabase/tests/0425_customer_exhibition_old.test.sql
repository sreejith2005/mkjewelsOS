-- 0425: the old exhibition data.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0425 test', 'customer-0425') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;

select customer_ingest_store('exhibition_old', jsonb_build_array(
  jsonb_build_object('row_key', '9820025001', 'sheet_row', 2, 'payload', '{"CLIENT NAME": "Asha Mehta | Asha M", "MOBILE NUMBER": "9820025001", "ALTERNATE NUMBER": "9820025002", "CITY": "Mumbai | Thane", "STATE": "asha@example.com | Maharashtra", "PINCODE": "400001", "EXHIBITION / EVENT NAME": "PUNE - EXHIBITION | SURAT EXHIBITION", "VISIT / ENTRY TIMESTAMP": "2025-03-14 11:20:00", "REMARKS": "liked kundan", "LAST UPDATED": "2026-11-10 09:00:00"}'::jsonb),
  jsonb_build_object('row_key', '9820025003', 'sheet_row', 3, 'payload', '{"MOBILE NUMBER": "9820025003", "EXHIBITION / EVENT NAME": "PUNE - EXHIBITION", "VISIT / ENTRY TIMESTAMP": "NOT AVAILABLE", "LAST UPDATED": "2026-11-10 09:00:00"}'::jsonb)),
  '{"headers": ["CLIENT NAME", "MOBILE NUMBER", "ALTERNATE NUMBER", "CITY", "STATE", "PINCODE", "EXHIBITION / EVENT NAME", "VISIT / ENTRY TIMESTAMP", "REMARKS", "LAST UPDATED"], "next_row": 4, "completed": true}');
select is(customer_ingest_apply('exhibition_old', 100) - 'pending', '{"applied": 2, "rejected": 0}'::jsonb, 'old exhibition rows applied, one without a name');
select is((select primary_name || '|' || (select string_agg(name, ',' order by name) from customer.client_names n where n.client_id = c.id)
             from customer.clients c where c.id = pg_temp.client('9820025001')), 'Asha Mehta|Asha M,Asha Mehta', 'the first name is the name; every name is kept');
select is((select string_agg(phone, ',' order by phone) from customer.client_phones where client_id = pg_temp.client('9820025001')), '919820025001,919820025002',
  'the alternate number is kept');
select is((select email || '|' || state || '|' || pincode from customer.clients where id = pg_temp.client('9820025001')), 'asha@example.com|Maharashtra|400001',
  'an email written in STATE is an email; the state is the other value');
select is((select count(*)::int from customer.client_field_values where client_id = pg_temp.client('9820025001') and field_key = 'city'), 2,
  'both cities of a joined cell are kept');
select is((select channel || '|' || occurred_at::text || '|' || store_name || '|' || notes || '|' || coalesce(outcome, '-')
             from customer.interactions where client_id = pg_temp.client('9820025001')),
  'exhibition|' || ('2025-03-14 11:20:00+05:30'::timestamptz)::text || '|PUNE - EXHIBITION | SURAT EXHIBITION|liked kundan|-',
  'a dated visit is an exhibition visit; the exhibitions are kept as written');
select is((select count(*)::int from customer.interactions where client_id = pg_temp.client('9820025003')), 0, 'no date: no visit');
select is((select value || '|' || (select first_seen_at from customer.clients where id = pg_temp.client('9820025003'))::text
             from customer.client_field_values where client_id = pg_temp.client('9820025003') and field_key = 'exhibitions_attended'),
  'PUNE - EXHIBITION|' || ('2026-11-10 09:00:00+05:30'::timestamptz)::text, 'the exhibition is kept; first seen at LAST UPDATED');

select * from finish();
rollback;
