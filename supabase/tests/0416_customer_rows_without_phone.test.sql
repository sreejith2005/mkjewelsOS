-- 0416: no sheet row is left out for want of a phone number.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0416 test', 'customer-0416') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.t() returns uuid language sql as $$ select id from fx where label = 'tenant' $$;
create function pg_temp.call(p_key text, p_phone text, p_name text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_key, 'sheet_row', 2, 'payload',
    jsonb_build_object('callId', p_key, 'Mobile Number', p_phone, 'Name', p_name, 'Interaction Date', '01/11/2026 11:00:00', 'Status', 'Interested') || p_extra) $$;

select customer_ingest_store('runo', jsonb_build_array(
  pg_temp.call('n-1', '12345', 'Gita'),
  pg_temp.call('n-2', '', 'Hari'),
  pg_temp.call('n-3', 'abc', 'Isha', '{"Billing Phone Number Add +91": "9820016003"}'),
  pg_temp.call('n-4', '12345', 'Gita')), '{"next_row": 6}');
select is(customer_ingest_apply('runo', 100) - 'pending', '{"applied": 4, "rejected": 0}'::jsonb, 'Runo rows with no valid phone are applied, not rejected');

select is((select count(distinct client_id)::int from customer.ingest_rows where source = 'runo' and row_key in ('n-1', 'n-2', 'n-4')), 3,
  'each such row is its own customer; the same invalid number never joins two rows');
select is((select (c.client_code ~ '^MKC-') || '|' || (select count(*) from customer.client_phones p where p.client_id = c.id) || '|' ||
                  (select value from customer.client_identifiers i where i.client_id = c.id and i.id_type = 'unverified_phone')
             from customer.clients c join customer.ingest_rows r on r.client_id = c.id where r.row_key = 'n-1'),
  'true|0|12345', 'it gets a client code; what the sheet wrote as the phone is kept, unverified');
select is((select string_agg(p.phone || ':' || p.kind, ',') from customer.client_phones p join customer.ingest_rows r on r.client_id = p.client_id where r.row_key = 'n-3'),
  '919820016003:primary', 'no valid phone but a valid billing phone: the billing phone identifies the customer');
select is((select count(*)::int from customer.interactions i join customer.ingest_rows r on r.interaction_id = i.id where r.row_key in ('n-1', 'n-2', 'n-3', 'n-4')), 4,
  'every row is on its customer''s timeline');

-- The same row again finds the same customer.
select customer_ingest_store('runo', jsonb_build_array(pg_temp.call('n-2', '', 'Hari', '{"Notes": "edited"}')), '{"next_row": 6}');
select customer_ingest_apply('runo', 100);
select is((select count(*)::int from customer.clients where tenant_id = pg_temp.t() and primary_name = 'Hari'), 1, 'an edited row keeps its customer');

-- resolve_client directly.
select is(customer.resolve_client(pg_temp.t(), null, 'Jaya', 'instagram_fms', now(), null, '@Jaya.K', 'x:1'),
          customer.resolve_client(pg_temp.t(), 'n/a', 'Jaya K', 'instagram_fms', now(), null, 'jaya.k', 'x:2'),
  'no phone: the Instagram ID finds the same customer');
select is((select count(*)::int from customer.client_identifiers where value = 'n/a'), 0, 'NA-like phone cells are not kept as numbers');
insert into fx values ('kiran', customer.resolve_client(pg_temp.t(), '9820016009', 'Kiran', 'runo', now(), null, null, 'x:3'));
select is((select id from fx where label = 'kiran'), (select client_id from customer.client_phones where phone = '919820016009'), 'a valid phone still decides');
select is((select count(*)::int from customer.client_identifiers where value = 'x:3'), 0, 'a customer with a phone gets no row link');

select * from finish();
rollback;
