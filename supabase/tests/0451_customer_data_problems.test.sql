-- 0451: bad-data customers carry their problem kinds.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0451 test', 'customer-0451') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.problems(p_phone text) returns text[] language sql as $$
  select c.data_problems from customer.clients c join customer.client_phones ph on ph.client_id = c.id
   where ph.tenant_id = (select id from fx where label = 'tenant') and ph.phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.wrong(p_phone text, p_reason text) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_phone, 'sheet_row', 2, 'payload', jsonb_build_object(
    'CONTACT NUMBER', p_phone, 'CLIENT NAME', 'Synthetic', 'WRONG NUMBER REASON', p_reason)) $$;

select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '9820051005', 'sheet_row', 4, 'payload', '{"CONTACT NUMBER": "9820051005", "CLIENT NAME": "Sara", "STATUS": "WRONG DATA"}'::jsonb),
  jsonb_build_object('row_key', '9820051006', 'sheet_row', 5, 'payload', '{"CONTACT NUMBER": "9820051006", "CLIENT NAME": "Nikhil", "CITY": "Mumbai"}'::jsonb)), '{"next_row": 6}');
select customer_ingest_apply('master_sheet', 100);
select customer_ingest_store('master_wrong_number', jsonb_build_array(
  pg_temp.wrong('9820051001', 'CALL GOT CONNECTED: WRONG NUMBER'),
  pg_temp.wrong('9820051002', 'dialed number does not exist'),
  pg_temp.wrong('9820051003', 'invalid no.'),
  pg_temp.wrong('9820051004', 'he said galat number lagaye ho')), '{"next_row": 6}');
select customer_ingest_apply('master_wrong_number', 100);

select is(pg_temp.problems('9820051001'), array['wrong_number'], 'a wrong number');
select is(pg_temp.problems('9820051002'), array['number_not_exist'], 'a number that does not exist');
select is(pg_temp.problems('9820051003'), array['number_not_exist'], 'staff''s "invalid no." is a number that does not exist');
select is(pg_temp.problems('9820051004'), array['wrong_number'], 'Hindi "galat number" is a wrong number');
select is(pg_temp.problems('9820051005'), array['wrong_data'], 'DATA STATUS WRONG DATA');
select is(pg_temp.problems('9820051006'), '{}'::text[], 'a normal customer has none');

-- A wrong number who later bought stays in the list.
select customer_ingest_store('master_buyer_soft', jsonb_build_array(jsonb_build_object('row_key', '9820051001', 'sheet_row', 2,
  'payload', '{"BUYER / NON BUYER": "BUYER", "CONTACT NUMBER": "9820051001", "CLIENT NAME": "Synthetic"}'::jsonb)), '{"next_row": 3}');
select customer_ingest_apply('master_buyer_soft', 100);
select is(pg_temp.problems('9820051001'), '{}'::text[], 'a buyer is not a bad number');

select * from finish();
rollback;
