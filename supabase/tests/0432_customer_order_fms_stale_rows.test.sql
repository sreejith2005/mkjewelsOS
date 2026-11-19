-- 0432: a sheet can keep the rows deleted from it.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0432 test', 'customer-0432') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.order_row(p_row integer, p_order text) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_order || '|10. UPDATE TO CLIENT (PRODUCT READY AT STORE)', 'sheet_row', p_row, 'payload', jsonb_build_object(
    'WORK ORDER NO', p_order, 'BILLING PHONE NUMBER', '9820032001', 'WORK STAGE', '10. UPDATE TO CLIENT (PRODUCT READY AT STORE)',
    'ACTUAL', '15/11/2026 16:00:00', 'DOER', 'BADRINATH')) $$;

-- 60 orders stored; then a pass sees none of them (all deleted from the sheet).
select customer_ingest_store('order_fms', (select jsonb_agg(pg_temp.order_row(n + 2, 'W32' || lpad(n::text, 4, '0'))) from generate_series(1, 60) n), '{"next_row": 63}');
select customer_ingest_apply('order_fms', 500);
update customer.ingest_rows set received_at = now() - interval '1 day' where source = 'order_fms';
delete from customer.ingest_pass_keys where source = 'order_fms';
update customer.ingest_state set scan_started_at = now() - interval '1 minute' where source = 'order_fms';
select is(customer_ingest_finish_scan('order_fms', 200) ->> 'blocked', 'true', 'by default, a sheet losing most of its rows is stopped');

update customer.source_tables set keep_rows_gone_from_sheet = true where source = 'order_fms';
delete from customer.ingest_pass_keys where source = 'order_fms';
update customer.ingest_state set scan_started_at = now() - interval '1 minute' where source = 'order_fms';
select is(customer_ingest_finish_scan('order_fms', 200) - 'remaining', '{"kept": true, "removed": 0, "blocked": false}'::jsonb, 'with keep on, the pass ends');
select is((select count(*)::int from customer.ingest_rows where source = 'order_fms' and status = 'applied'), 60, 'every row stays');
select is((select last_error from customer.ingest_state where source = 'order_fms'), null, 'no error');

select * from finish();
rollback;
