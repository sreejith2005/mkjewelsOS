-- 0433: Mumbai and Ahmedabad customers kept apart.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid; a uuid; bm uuid; ba uuid;
begin
  insert into tenants(name, slug) values ('0433 test', 'customer-0433') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK901') returning id into m;
  insert into franchise_groups (tenant_id, name, code) values (t, 'Ahmedabad', 'MK902') returning id into a;
  insert into branches (tenant_id, name, franchise_group_id) values (t, 'Bandra', m) returning id into bm;
  insert into branches (tenant_id, name, franchise_group_id) values (t, 'Satellite', a) returning id into ba;
  insert into fx values ('tenant', t), ('mumbai', m), ('ahmedabad', a);
  insert into user_profiles (tenant_id, employee_name, branch_id) values (t, 'Mumbai staff', bm) returning id into m;
  insert into user_profiles (tenant_id, employee_name, branch_id) values (t, 'Ahmedabad staff', ba) returning id into a;
  insert into fx values ('mumbai_staff', m), ('ahmedabad_staff', a);
end $$;
select set_config('test.tenant', (select id::text from fx where label = 'tenant'), true);

-- The centralized sheet is Mumbai's; a second sheet of the same kind is Ahmedabad's.
update customer.source_tables set franchise_code = 'MK901' where source = 'master_sheet';
insert into customer.sources (source, source_rank, label) values ('test_ahd_master', 4, 'Ahmedabad test sheet');
insert into customer.source_tables (source, table_name, label, importer, one_time, franchise_code)
values ('test_ahd_master', 'sheet_test_ahd_master', 'Ahmedabad test sheet', 'master_sheet', false, 'MK902');

select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '9820033001', 'sheet_row', 4, 'payload', '{"CONTACT NUMBER": "9820033001", "CLIENT NAME": "Asha Mumbai", "CITY": "Mumbai"}'::jsonb)), '{"next_row": 5}');
select customer_ingest_apply('master_sheet', 100);
select customer_ingest_store('test_ahd_master', jsonb_build_array(
  jsonb_build_object('row_key', '9820033001', 'sheet_row', 2, 'payload', '{"CONTACT NUMBER": "9820033001", "CLIENT NAME": "Asha Ahmedabad", "CITY": "Ahmedabad"}'::jsonb)), '{"next_row": 3}');
select customer_ingest_apply('test_ahd_master', 100);

create function pg_temp.client(p_franchise text) returns uuid language sql as $$
  select c.id from customer.clients c join customer.client_phones p on p.client_id = c.id
   where p.phone = customer.normalize_phone('9820033001') and c.franchise_group_id = (select id from fx where label = p_franchise) $$;

select ok(pg_temp.client('mumbai') <> pg_temp.client('ahmedabad'), 'one number in two franchises is two customers');
select is((select primary_name || '|' || city from customer.clients where id = pg_temp.client('ahmedabad')), 'Asha Ahmedabad|Ahmedabad',
  'the Ahmedabad customer has only Ahmedabad facts');
select is((select primary_name || '|' || city from customer.clients where id = pg_temp.client('mumbai')), 'Asha Mumbai|Mumbai',
  'the Mumbai customer is untouched');
select is((select count(*)::int from customer.client_phones where franchise_group_id = (select id from fx where label = 'ahmedabad')), 1,
  'the number carries its franchise');

-- A later Mumbai row with the same number finds the Mumbai customer.
select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '9820033001', 'sheet_row', 4, 'payload', '{"CONTACT NUMBER": "9820033001", "CLIENT NAME": "Asha Mumbai", "CITY": "Mumbai", "GENDER": "Female"}'::jsonb)), '{"next_row": 5}');
select customer_ingest_apply('master_sheet', 100);
select is((select count(*)::int from customer.clients where tenant_id = (select id from fx where label = 'tenant')), 2, 'no third customer');

-- Reading: each person sees only their franchise.
select set_config('test.profile', (select id::text from fx where label = 'mumbai_staff'), true);
select is((public.customer_list('{"q": "9820033001"}'::jsonb) -> 'rows' -> 0 ->> 'franchise') || '|' || (public.customer_list('{"q": "9820033001"}'::jsonb) ->> 'total'),
  'Mumbai|1', 'Mumbai staff find only the Mumbai customer');
select is((public.customer_list('{"q": "9820033001", "franchise": "all"}'::jsonb) ->> 'total')::int, 1, 'asking for all does not widen it');
select throws_ok(format('select public.customer_get_client_page(%L)', (select client_code from customer.clients where id = pg_temp.client('ahmedabad'))),
  'P0002', 'Client not found', 'an Ahmedabad customer page is not found for Mumbai staff');
select is(jsonb_array_length(public.customer_list_filters(null) -> 'franchises'), 1, 'Mumbai staff are offered one franchise');

select set_config('test.profile', (select id::text from fx where label = 'ahmedabad_staff'), true);
select is((public.customer_list('{"q": "9820033001"}'::jsonb) -> 'rows' -> 0 ->> 'franchise'), 'Ahmedabad', 'Ahmedabad staff see only theirs');
select is((select count(*)::int from public.customer_search('9820033001', 10)), 1, 'search too');

-- Company-wide authority: own franchise by default, both when chosen.
select set_config('test.profile', (select id::text from fx where label = 'mumbai_staff'), true);
select set_config('test.company', 'true', true);
select is((public.customer_list('{"q": "9820033001"}'::jsonb) ->> 'total')::int || '|' || (public.customer_list('{"q": "9820033001", "franchise": "all"}'::jsonb) ->> 'total'),
  '1|2', 'the list opens on the own franchise; All shows both');

select throws_ok(format('select customer.merge_clients(%L, %L, %L, null)', pg_temp.client('mumbai'), pg_temp.client('ahmedabad'), 'test'),
  '22023', 'Customers of different franchises are kept apart', 'customers of two franchises are never merged');

update customer.source_tables set franchise_code = 'MK999' where source = 'test_ahd_master';
select throws_ok($$select customer_ingest_apply('test_ahd_master', 10)$$, '22023', 'Franchise MK999 of source test_ahd_master not found',
  'a sheet whose franchise is missing never imports');

select * from finish();
rollback;
