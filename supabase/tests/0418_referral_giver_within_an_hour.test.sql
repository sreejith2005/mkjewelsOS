-- 0418: a referral is linked to the visit it was given at, within an hour.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0418 test', 'customer-0418') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.visit(p_ref text, p_ts text, p_name text, p_phone text) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_ref, 'sheet_row', 2, 'payload', jsonb_build_object('TIMESTAMP', p_ts, 'CLIENT VISIT DATE', left(p_ts, 10),
    'CLIENT NAME', p_name, 'CLIENT PHONE', p_phone, 'REFERENCE NUMBER', p_ref)) $$;
create function pg_temp.ref(p_key text, p_ts text, p_giver text, p_phone text) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_key, 'sheet_row', 2, 'payload', jsonb_build_object('TIMESTAMP', p_ts,
    'REFERENCE GIVEN BY CLIENT NAME', p_giver, 'REFERRAL NAME', 'R ' || p_key, 'REFERRAL NUMBER', p_phone)) $$;

select customer_ingest_store('walkin', jsonb_build_array(
  pg_temp.visit('V1', '2026-11-05 11:00:00', 'Asha Mehta', '9820018001'),
  pg_temp.visit('V2', '2026-11-05 11:30:00', 'Asha Mehta', '9820018002'),
  pg_temp.visit('V3', '2026-11-05 11:05:00', 'Bina', '9820018003')), '{"next_row": 5}');
select customer_ingest_apply('walkin', 100);
select customer_ingest_store('referral', jsonb_build_array(
  pg_temp.ref('a', '05/11/2026 11:24:00', 'ASHA MEHTA', '9820018011'),
  pg_temp.ref('b', '05/11/2026 13:00:00', 'Asha Mehta', '9820018012'),
  pg_temp.ref('c', '05/11/2026 11:06:00', 'Chetan', '9820018013')), '{"next_row": 5}');
select customer_ingest_apply('referral', 100);

select is((select referred_by_client_id from customer.clients where id = pg_temp.client('9820018011')), pg_temp.client('9820018002'),
  'the giver is the client with that name whose visit form was sent nearest, within an hour');
select is((select referred_by_client_id from customer.clients where id = pg_temp.client('9820018012')), null, 'more than an hour away: not linked');
select is((select referred_by_client_id from customer.clients where id = pg_temp.client('9820018013')), null, 'another name in the same minutes: not linked');

-- Referral first, visit later.
select customer_ingest_store('referral', jsonb_build_array(pg_temp.ref('d', '06/11/2026 10:40:00', 'Dev', '9820018014')), '{"next_row": 6}');
select customer_ingest_apply('referral', 100);
select customer_ingest_store('walkin', jsonb_build_array(pg_temp.visit('V4', '2026-11-06 10:10:00', 'Dev', '9820018004')), '{"next_row": 6}');
select customer_ingest_apply('walkin', 100);
select is((select referred_by_client_id from customer.clients where id = pg_temp.client('9820018014')), pg_temp.client('9820018004'),
  'a visit that arrives after its referrals links them');
select is((select value from customer.client_field_values where client_id = pg_temp.client('9820018012') and field_key = 'referred_by_name'), 'Asha Mehta',
  'an unlinked referral keeps the giver''s name as written');

select * from finish();
rollback;
