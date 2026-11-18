-- 0431: ORDER FMS rows keyed by WORK ORDER NO + WORK STAGE.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0431 test', 'customer-0431') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.order_row(p_row integer, p_design text, p_stage text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('row_key', 'W310001|' || p_design || '|' || p_stage, 'sheet_row', p_row, 'payload', jsonb_build_object(
    'DATE OF ORDER', '01/11/2026', 'WORK ORDER NO', 'W310001', 'DESIGN NO', p_design, 'BILLING PHONE NUMBER', '9820031001',
    'SALE PERSON', 'DEEPA', 'WORK STAGE', p_stage, 'DOER', 'BADRINATH', 'PLANNED', '02/11/2026 10:00:00') || p_extra) $$;

-- Stored under the old key; then the design number of the stage-3 row was corrected in the sheet.
select customer_ingest_store('order_fms', jsonb_build_array(
  pg_temp.order_row(3, 'D1', '3. ORDER ISSUE TO KARIGAR', '{"ACTUAL": "02/11/2026 11:00:00"}'),
  pg_temp.order_row(4, 'D1', '10. UPDATE TO CLIENT (PRODUCT READY AT STORE)', '{"ACTUAL": "15/11/2026 16:00:00"}')), '{"next_row": 5}');
select customer_ingest_apply('order_fms', 100);
update customer.ingest_rows set updated_at = now() - interval '1 hour' where source = 'order_fms';
select customer_ingest_store('order_fms', jsonb_build_array(pg_temp.order_row(3, 'D1-CORRECTED', '3. ORDER ISSUE TO KARIGAR', '{"ACTUAL": "02/11/2026 11:00:00"}')), '{"next_row": 5}');
select customer_ingest_apply('order_fms', 100);

select is(customer.rekey_order_fms(), 3, 'every stored order row gets the new key');
select is((select string_agg(row_key || ':' || status, ',' order by row_key) from customer.ingest_rows where source = 'order_fms' and row_key not like '%replaced:%'),
  'W310001|10. UPDATE TO CLIENT (PRODUCT READY AT STORE):applied,W310001|3. ORDER ISSUE TO KARIGAR:applied', 'one row per order and stage');
select is((select status from customer.ingest_rows where source = 'order_fms' and row_key like '%replaced:%'), 'removed',
  'the older duplicate is removed the usual way');
select is((select payload ->> 'DESIGN NO' from customer.ingest_rows where source = 'order_fms' and row_key = 'W310001|3. ORDER ISSUE TO KARIGAR'), 'D1-CORRECTED',
  'the most recent row stays');
select is((select count(*)::int from customer.interactions where source = 'order_fms' and external_ref = 'W310001|10. UPDATE TO CLIENT (PRODUCT READY AT STORE)' and archived_at is null), 1,
  'the client contact follows the new key');
-- The next read under the new key finds the stored row, not a new one.
select customer_ingest_store('order_fms', jsonb_build_array(jsonb_build_object('row_key', 'W310001|10. UPDATE TO CLIENT (PRODUCT READY AT STORE)', 'sheet_row', 4,
  'payload', (select payload from customer.ingest_rows where source = 'order_fms' and row_key = 'W310001|10. UPDATE TO CLIENT (PRODUCT READY AT STORE)'))), '{"next_row": 5}');
select is((select count(*)::int from customer.ingest_rows where source = 'order_fms' and status <> 'removed'), 2, 'reading the sheet again adds nothing');

select * from finish();
rollback;
