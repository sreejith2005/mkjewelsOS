-- 0423: exhibition walk-ins.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0423 test', 'customer-0423') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;

select customer_ingest_store('exhibition', jsonb_build_array(
  jsonb_build_object('row_key', '12/07/2026 11:00:00|9820023001', 'sheet_row', 2, 'payload', '{"TIMESTAMP": "12/07/2026 11:00:00", "EXHIBITION NAME": "KOLHAPUR EXHIBITION", "REFERENCE NUMBER": "KOLHAPUR-001", "SALESPERSON": "UMA SEHGAL", "CLIENT NAME": "Asha", "PHONE 1": "9820023001", "PHONE 2": "9820023002", "MARRIAGE STATUS": "MARRIED", "CRM NAME": "NEHA PATIL", "STATUS": "BOUGHT", "PINCODE": "416001", "REMARK": "416002", "REFERENCE 1 NAME": "Kavita", "REFERENCE 1 NUMBER": "9820023010"}'::jsonb),
  jsonb_build_object('row_key', '12/07/2026 11:05:00|9', 'sheet_row', 3, 'payload', '{"TIMESTAMP": "12/07/2026 11:05:00", "EXHIBITION NAME": "KOLHAPUR EXHIBITION", "CLIENT NAME": "Bina", "PHONE 1": "9", "STATUS": "YES"}'::jsonb)),
  '{"headers": ["TIMESTAMP", "EXHIBITION NAME", "REFERENCE NUMBER", "SALESPERSON", "CLIENT NAME", "PHONE 1", "PHONE 2", "STATUS"], "next_row": 4}');
select is(customer_ingest_apply('exhibition', 100) - 'pending', '{"applied": 2, "rejected": 0}'::jsonb, 'exhibition rows applied, an invalid number too');
select is((select channel || '|' || direction || '|' || purpose || '|' || outcome || '|' || result || '|' || store_name || '|' || staff_name || '|' || recorded_by_name || '|' || notes
             from customer.interactions where source = 'exhibition' and client_id = pg_temp.client('9820023001')),
  'exhibition|in_person|purchase|BOUGHT|positive|KOLHAPUR EXHIBITION|UMA SEHGAL|NEHA PATIL|416002', 'one exhibition visit, BOUGHT read as a purchase, the rest as written');
select is((select outcome || '|' || result from customer.interactions i join customer.ingest_rows r on r.interaction_id = i.id where r.row_key = '12/07/2026 11:05:00|9'),
  'YES|neutral', 'other statuses kept as written');
select is((select string_agg(phone || ':' || kind, ',' order by kind desc) from customer.client_phones where client_id = pg_temp.client('9820023001')),
  '919820023001:primary,919820023002:other', 'PHONE 2 is kept as another number of the same visitor');
select is((select marital_status || '|' || pincode || '|' || lifecycle_stage || '|' || segment from customer.clients where id = pg_temp.client('9820023001')),
  'MARRIED|416001|visited|buyer', 'profile answers; an exhibition visit is a visit; BOUGHT makes a buyer');
select is((select referred_by_client_id from customer.clients where id = pg_temp.client('9820023010')), pg_temp.client('9820023001'),
  'a reference the visitor gave is referred by them');
select is((select source_rank from customer.sources where source = 'exhibition'), 3, 'exhibition answers rank 3');

select * from finish();
rollback;
