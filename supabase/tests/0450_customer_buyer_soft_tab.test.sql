-- 0450: BUYER / NON BUYER SOFT decides buyer or not, with the purchase dates.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0450 test', 'customer-0450') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.client(p_phone text) returns customer.clients language sql as $$
  select c.* from customer.clients c join customer.client_phones ph on ph.client_id = c.id
   where ph.tenant_id = (select id from fx where label = 'tenant') and ph.phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.soft(p_phone text, p_status text, p_type text, p_first text, p_recent text) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_phone, 'sheet_row', 2, 'payload', jsonb_strip_nulls(jsonb_build_object(
    'BUYER / NON BUYER', p_status, 'CLIENT NAME', 'Synthetic Person', 'CONTACT NUMBER', p_phone, 'SALES PERSON', 'Neha',
    'TYPE OF CLIENT', p_type, 'FIRST PURCHASE DATE', p_first, 'RECENT PURCHASE DATE', p_recent, 'LAST INTERACTION DATE', '12-Oct-2026'))) $$;

-- A buyer from another tab that the soft tab calls NON BUYER.
select customer_ingest_store('master_buyer_list', jsonb_build_array(
  jsonb_build_object('row_key', '9820050002', 'sheet_row', 2, 'payload', '{"CONTACT NUMBER": "9820050002", "CLIENT NAME": "Ravi", "TYPE OF CLIENT": "GOLD"}'::jsonb)), '{"next_row": 3}');
select customer_ingest_apply('master_buyer_list', 100);
select is((pg_temp.client('9820050002')).segment, 'buyer', 'another tab made Ravi a buyer');

select customer_ingest_store('master_buyer_soft', jsonb_build_array(
  pg_temp.soft('9820050001', 'BUYER', 'SILVER', '05-Jan-2024', '18-Sep-2026'),
  pg_temp.soft('9820050002', 'NON BUYER', 'LEAD', null, null),
  pg_temp.soft('9820050003', 'NON BUYER', 'LEAD', null, null)), '{"next_row": 5}');
select is(customer_ingest_apply('master_buyer_soft', 100) - 'pending', '{"applied": 3, "rejected": 0}'::jsonb, 'every row applies');

select is((pg_temp.client('9820050001')).segment, 'buyer', 'BUYER is a buyer');
select is(((pg_temp.client('9820050001')).first_purchase_at at time zone 'UTC')::date, '2024-01-05'::date, '... with the first purchase date');
select is(((pg_temp.client('9820050001')).last_purchase_at at time zone 'UTC')::date, '2026-09-18'::date, '... and the latest');
select is(customer.current_answer((pg_temp.client('9820050001')).id, 'client_category'), 'SILVER', 'TYPE OF CLIENT is the ticket size');
select is((pg_temp.client('9820050002')).segment, 'lead', 'the tab''s NON BUYER wins over another tab''s mark');
select is((select count(*) from customer.client_field_values where client_id = (pg_temp.client('9820050003')).id and field_key = 'client_category'), 0::bigint,
  'LEAD is not a ticket size');
select is(customer.current_answer((pg_temp.client('9820050003')).id, 'last_interaction_date'), '2026-10-12', 'dates are kept as dates');

select * from finish();
rollback;
