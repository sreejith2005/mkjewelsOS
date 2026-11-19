-- 0437: "same person" needs the same main name; every franchise is readable.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid;
begin
  insert into tenants(name, slug) values ('0437 test', 'customer-0437') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK971') returning id into m;
  insert into fx values ('tenant', t), ('mumbai', m);
end $$;
update customer.source_tables set franchise_code = 'MK971' where source in ('master_sheet', 'software_account_list');

create function pg_temp.owner(p_phone text) returns uuid language sql as $$
  select p.client_id from customer.client_phones p
   where p.tenant_id = (select id from fx where label = 'tenant') and p.phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.master(p_phone text, p_name text, p_row integer) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_phone || ':' || p_row, 'sheet_row', p_row,
    'payload', jsonb_build_object('CONTACT NUMBER', p_phone, 'CLIENT NAME', p_name, 'SOURCE OF WALK-IN', 'Sales Register')) $$;
create function pg_temp.account(p_row integer, p_name text, p_mobile text, p_phone text) returns jsonb language sql as $$
  select jsonb_build_object('row_key', 'row:' || p_row, 'sheet_row', p_row,
    'payload', jsonb_build_object('A/c Name', p_name, 'Group', 'CUSTOMER', 'Mobile', p_mobile, 'Phone', p_phone)) $$;

-- A shared family phone: first "Asha Rao", later "Vikram Rao" (newest name is the main name).
-- Another person whose main name is "Asha Rao", with a number of her own.
select customer_ingest_store('master_sheet', jsonb_build_array(
  pg_temp.master('9820037001', 'Asha Rao', 4)), '{"next_row": 5}');
select customer_ingest_apply('master_sheet', 100);
update customer.client_names set last_seen_at = now() - interval '1 day' where client_id = pg_temp.owner('9820037001');
select customer.add_client_name(pg_temp.owner('9820037001'), 'Vikram Rao', 'master_sheet', now());
select customer_ingest_store('master_sheet', jsonb_build_array(
  pg_temp.master('9820037002', 'Asha Rao', 5), pg_temp.master('9820037003', 'Mohan Das', 6), pg_temp.master('9820037004', 'Mohan Das', 7)), '{"next_row": 8}');
select customer_ingest_apply('master_sheet', 100);
select is((select primary_name from customer.clients where id = pg_temp.owner('9820037001')), 'Vikram Rao', 'the shared phone''s main name is the newest name');

-- Their numbers appear together on two rows.
select customer_ingest_store('software_account_list', jsonb_build_array(
  pg_temp.account(2, 'Asha Rao', '9820037002', '9820037001'), pg_temp.account(3, 'Asha Rao', '9820037002', '9820037001'),
  pg_temp.account(4, 'Mohan Das', '9820037003', '9820037004')), '{"next_row": 5}');
select customer_ingest_apply('software_account_list', 100);

select ok(pg_temp.owner('9820037001') <> pg_temp.owner('9820037002'), 'a shared other name never joins two records, even on two rows');
select ok(not ('possible_duplicate' = any (customer.client_tags(pg_temp.owner('9820037002')))), '... and does not flag them');
select is((select count(distinct household_id) from customer.clients where id in (pg_temp.owner('9820037001'), pg_temp.owner('9820037002'))), 1::bigint,
  '... they are one family');
select ok('possible_duplicate' = any (customer.client_tags(pg_temp.owner('9820037003'))), 'the same main name on one row is still flagged');

select is(customer.readable_franchise_ids(), null::uuid[], 'every signed-in person reads every franchise');

select * from finish();
rollback;
