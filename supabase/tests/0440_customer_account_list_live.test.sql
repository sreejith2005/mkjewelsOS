-- 0440: the Account List is live, each row identified by A/c Name + Mobile.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0440 test', 'customer-0440') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK991');
  insert into fx values ('tenant', t);
end $$;
update customer.source_tables set franchise_code = 'MK991' where source = 'software_account_list';

select is((select one_time from customer.source_tables where source = 'software_account_list'), false, 'the Account List is a live source');

-- Rows as the one-time import stored them: by row number.
create function pg_temp.account(p_row integer, p_name text, p_mobile text) returns jsonb language sql as $$
  select jsonb_build_object('row_key', 'row:' || p_row, 'sheet_row', p_row,
    'payload', jsonb_build_object('A/c Name', p_name, 'Group', 'CUSTOMER', 'Mobile', p_mobile)) $$;
select customer_ingest_store('software_account_list', jsonb_build_array(
  pg_temp.account(2, 'Leena Shah', '9820040001'), pg_temp.account(3, 'Om Traders', '9820040002'),
  pg_temp.account(4, 'Leena Shah', '9820040001'),
  jsonb_build_object('row_key', 'row:5', 'sheet_row', 5, 'payload', '{"Group": "CUSTOMER", "Location": "Dadar"}'::jsonb)),
  '{"next_row": 6, "headers": ["A/c Name", "Group", "Location", "City", "Phone", "Mobile"]}');
select customer_ingest_apply('software_account_list', 100);

select is(customer.rekey_account_list(), 2, 'stored rows get the new identifier (the repeat and the row with neither keep theirs)');
select is((select row_key from customer.ingest_rows where source = 'software_account_list' and sheet_row = 2), 'Leena Shah|9820040001', 'identified by A/c Name + Mobile');
select is((select row_key from customer.ingest_rows where source = 'software_account_list' and sheet_row = 4), 'row:4',
  'a second row with the same name and mobile keeps its old identifier (taken out at the next full read)');
select is((select row_key from customer.ingest_rows where source = 'software_account_list' and sheet_row = 5), 'row:5', 'a row with neither keeps its row number');
select is((select _row_key from customer.sheet_software_account_list where _sheet_row = 3), 'Om Traders|9820040002', 'the sheet''s own table carries the new identifier');
select is((select count(*) from customer.ingest_rows where source = 'software_account_list' and status <> 'removed'), 4::bigint, 'no stored row is lost');

-- The sheet as the live job reads it now: rows 2 and 3 move down when a row is inserted above them.
select customer_ingest_store('software_account_list', jsonb_build_array(
  jsonb_build_object('row_key', 'Nina Rao|9820040003', 'sheet_row', 2, 'payload', '{"A/c Name": "Nina Rao", "Group": "CUSTOMER", "Mobile": "9820040003"}'::jsonb),
  jsonb_build_object('row_key', 'Leena Shah|9820040001', 'sheet_row', 3, 'payload', '{"A/c Name": "Leena Shah", "Group": "CUSTOMER", "Mobile": "9820040001"}'::jsonb)),
  '{"next_row": 7}');
select is((select count(*) from customer.ingest_rows where source = 'software_account_list' and row_key = 'Leena Shah|9820040001'), 1::bigint,
  'a row that moved in the sheet is the same stored row, not a second one');

select * from finish();
rollback;
