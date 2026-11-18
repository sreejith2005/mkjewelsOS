-- 0424: deleting imported data safely.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0424 test', 'customer-0424') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.call(p_key text, p_phone text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_key, 'sheet_row', 2, 'payload', jsonb_build_object('callId', p_key, 'Mobile Number', p_phone, 'Name', 'N ' || p_key,
    'Interaction Date', '01/11/2026 11:00:00', 'Status', 'Interested') || p_extra) $$;

-- Asha: one Runo call that brought her city. Bina: two calls. Chetan: a walk-in with a companion.
select customer_ingest_store('runo', jsonb_build_array(
  pg_temp.call('c1', '9820024001', '{"City": "Thane"}'),
  pg_temp.call('c2', '9820024002', '{"City": "Pune"}'),
  pg_temp.call('c3', '9820024002', '{"Interaction Date": "02/11/2026 11:00:00", "City": "Nashik"}')),
  '{"headers": ["callId", "Mobile Number", "Name", "Interaction Date", "Status", "City"], "next_row": 5}');
select customer_ingest_apply('runo', 100);
select customer_ingest_store('walkin', jsonb_build_array(jsonb_build_object('row_key', 'W1', 'sheet_row', 2, 'payload', jsonb_build_object(
  'TIMESTAMP', '2026-11-03 10:00:00', 'CLIENT VISIT DATE', '2026-11-03', 'CLIENT NAME', 'Chetan', 'CLIENT PHONE', '9820024003', 'REFERENCE NUMBER', 'W1',
  'CLIENT BOUGHT ANY PRODUCT?', 'YES', 'COMPANION 1 NAME', 'Divya', 'COMPANION 1 MOBILE', '9820024004', 'COMPANION 1 RELATION', 'WIFE'))), '{"headers": ["TIMESTAMP", "CLIENT NAME", "CLIENT PHONE", "REFERENCE NUMBER"], "next_row": 3}');
select customer_ingest_apply('walkin', 100);

select is((select source_row from customer.clients where id = pg_temp.client('9820024004')),
  (select id from customer.ingest_rows where row_key = 'W1'), 'a customer records the sheet row that made them');

-- 1. Delete one row of a sheet's own table.
delete from customer.sheet_runo_live where _row_key = 'c3';
select is((select count(*)::int from customer.ingest_rows where row_key = 'c3'), 0, 'deleting a row in the sheet table deletes the stored row');
select is((select interaction_count || '|' || city from customer.clients where id = pg_temp.client('9820024002')), '1|Pune',
  'the customer keeps the other row; its contact and answer are gone and the profile is worked out again');

-- 2. Delete the only row of a customer.
delete from customer.sheet_runo_live where _row_key = 'c1';
select is(pg_temp.client('9820024001'), null, 'a customer with nothing left is deleted with their row');

-- 3. Delete the walk-in row: the visit, the buyer mark, and the companion it made go.
delete from customer.ingest_rows where row_key = 'W1';
select is((select count(*)::int from customer.clients where id in (pg_temp.client('9820024003'), pg_temp.client('9820024004'))), 0,
  'the visitor and the companion that row made are deleted');
select is((select count(*)::int from customer.interactions where source = 'walkin'), 0, 'with the visit');

-- 4. Delete a customer directly.
select customer_ingest_store('runo', jsonb_build_array(pg_temp.call('c4', '9820024005'), pg_temp.call('c5', '9820024006')), '{"next_row": 7}');
select customer_ingest_apply('runo', 100);
update customer.clients set referred_by_client_id = pg_temp.client('9820024005') where id = pg_temp.client('9820024006');
insert into fx values ('gone', pg_temp.client('9820024005'));
delete from customer.clients where id = (select id from fx where label = 'gone');
select is((select count(*)::int from customer.client_phones where client_id = (select id from fx where label = 'gone'))
        + (select count(*)::int from customer.interactions where client_id = (select id from fx where label = 'gone')), 0,
  'deleting a customer deletes their phones and contacts');
select is((select referred_by_client_id from customer.clients where id = pg_temp.client('9820024006')), null, 'a customer they referred stays, unlinked');
select is((select client_id from customer.ingest_rows where row_key = 'c4'), null, 'the sheet row stays, no longer pointing at them');

-- 5. Delete a whole sheet.
update customer.source_tables set scheduled = true where source = 'runo';
select is((customer.delete_sheet('runo') ->> 'customers_deleted')::int, 2, 'delete_sheet removes the sheet and the two customers it alone made');
select is((select count(*)::int from customer.ingest_rows where source = 'runo') + (select count(*)::int from customer.sheet_runo_live), 0, 'nothing of it is left');
select is((select scheduled from customer.source_tables where source = 'runo'), false, 'and stops its 5-minute job');
select is(has_function_privilege('service_role', 'customer.delete_sheet(text)', 'execute'), false, 'only from the SQL Editor');

select * from finish();
rollback;
