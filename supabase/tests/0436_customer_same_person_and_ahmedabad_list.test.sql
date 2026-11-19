-- 0436: one person with two numbers, families found through shared numbers,
-- and the "AHEMDABAD list" tab.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid; a uuid;
begin
  insert into tenants(name, slug) values ('0436 test', 'customer-0436') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK961') returning id into m;
  insert into franchise_groups (tenant_id, name, code) values (t, 'Ahmedabad', 'MK962') returning id into a;
  insert into fx values ('tenant', t), ('mumbai', m), ('ahmedabad', a);
end $$;
update customer.source_tables set franchise_code = 'MK961' where source in ('master_sheet', 'software_account_list', 'master_dont_contact');
update customer.source_tables set franchise_code = 'MK962' where source = 'ahd_contact_list';

-- The customer that holds a number in a franchise.
create function pg_temp.owner(p_phone text, p_franchise text default 'mumbai') returns uuid language sql as $$
  select p.client_id from customer.client_phones p
   where p.tenant_id = (select id from fx where label = 'tenant') and p.phone = customer.normalize_phone(p_phone)
     and p.franchise_group_id = (select id from fx where label = p_franchise) $$;
create function pg_temp.master(p_phone text, p_name text, p_row integer) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_phone, 'sheet_row', p_row,
    'payload', jsonb_build_object('CONTACT NUMBER', p_phone, 'CLIENT NAME', p_name, 'SOURCE OF WALK-IN', 'Sales Register')) $$;
create function pg_temp.account(p_row integer, p_name text, p_mobile text, p_phone text) returns jsonb language sql as $$
  select jsonb_build_object('row_key', 'row:' || p_row, 'sheet_row', p_row,
    'payload', jsonb_build_object('A/c Name', p_name, 'Group', 'CUSTOMER', 'Mobile', p_mobile, 'Phone', p_phone)) $$;

-- Six people known by one number each (a Mumbai list).
select customer_ingest_store('master_sheet', jsonb_build_array(
  pg_temp.master('9820036001', 'Ravi Mehta', 4), pg_temp.master('9820036002', 'Ravi Mehta', 5),
  pg_temp.master('9820036003', 'Sunita Shah', 6), pg_temp.master('9820036004', 'Rakesh Shah', 7),
  pg_temp.master('9820036005', 'Neha Joshi', 8), pg_temp.master('9820036006', 'Neha Joshi', 9),
  pg_temp.master('9820036007', 'Kiran Rao', 10)), '{"next_row": 11}');
select customer_ingest_apply('master_sheet', 100);
create temp table first_ids as select pg_temp.owner('9820036001') as ravi1, pg_temp.owner('9820036002') as ravi2;

-- One row shows Ravi's two numbers together; another shows Sunita with Rakesh's number.
select customer_ingest_store('software_account_list', jsonb_build_array(
  pg_temp.account(2, 'Ravi Mehta', '9820036001', '9820036002'),
  pg_temp.account(3, 'Sunita Shah', '9820036003', '9820036004'),
  pg_temp.account(4, 'Sunita Shah', '9820036003', '9820036004')), '{"next_row": 5}');
select is(customer_ingest_apply('software_account_list', 100) - 'pending', '{"applied": 3, "rejected": 0}'::jsonb, 'the rows apply');

select ok(pg_temp.owner('9820036001') <> pg_temp.owner('9820036002'), 'same name, numbers together on one row only: not joined');
select is((select count(distinct household_id) from customer.clients where id in (pg_temp.owner('9820036001'), pg_temp.owner('9820036002'))), 1::bigint,
  '... but put in one family');
select ok('possible_duplicate' = any (customer.client_tags(pg_temp.owner('9820036001'))) and 'possible_duplicate' = any (customer.client_tags(pg_temp.owner('9820036002'))),
  '... and both are flagged possibly the same person');

select ok(pg_temp.owner('9820036003') <> pg_temp.owner('9820036004'), 'different names on two rows: never joined');
select is((select count(distinct household_id) from customer.clients where id in (pg_temp.owner('9820036003'), pg_temp.owner('9820036004'))), 1::bigint,
  'different names: one family');
select ok(not ('possible_duplicate' = any (customer.client_tags(pg_temp.owner('9820036003')))), 'different names: no "possibly the same person" flag');
select ok(exists (select 1 from audit_logs where action = 'customer_family_linked'), 'a family link is audited');

-- A second row with Ravi's two numbers: now the data proves one person.
select customer_ingest_store('software_account_list', jsonb_build_array(pg_temp.account(5, 'Ravi Mehta', '9820036002', '9820036001')), '{"next_row": 6}');
select customer_ingest_apply('software_account_list', 100);
select is(pg_temp.owner('9820036001'), pg_temp.owner('9820036002'), 'same name and numbers together on two rows: one customer');
select is(pg_temp.owner('9820036001'), (select ravi1 from first_ids), 'the older record is kept');
select is((select merged_into_client_id from customer.clients where id = (select ravi2 from first_ids)), (select ravi1 from first_ids),
  'the other record points to the one kept');
select ok(not exists (select 1 from customer.ingest_rows where client_id = (select ravi2 from first_ids)), 'its sheet rows moved to the kept customer');
select ok(not ('possible_duplicate' = any (customer.client_tags(pg_temp.owner('9820036001')))), 'the flag goes once they are one');
select ok(exists (select 1 from audit_logs where action = 'customer_same_person_joined' and record_id = (select ravi1 from first_ids)
                  and jsonb_array_length(new_value -> 'evidence_rows') = 2), 'the join is audited with the two rows that proved it');
select is((select count(*) from customer.client_names where client_id = (select ravi1 from first_ids)), 1::bigint, 'names are kept (one shared name)');

-- Do not contact: joined, and stays do not contact.
select customer_ingest_store('master_dont_contact', jsonb_build_array(
  jsonb_build_object('row_key', '9820036005', 'sheet_row', 2, 'payload', '{"CONTACT NUMBER": "9820036005", "CLIENT NAME": "Neha Joshi"}'::jsonb)), '{"next_row": 3}');
select customer_ingest_apply('master_dont_contact', 100);
select customer_ingest_store('software_account_list', jsonb_build_array(
  pg_temp.account(6, 'Neha Joshi', '9820036006', '9820036005'), pg_temp.account(7, 'Neha Joshi', '9820036006', '9820036005')), '{"next_row": 8}');
select customer_ingest_apply('software_account_list', 100);
select is(pg_temp.owner('9820036005'), pg_temp.owner('9820036006'), 'a do-not-contact person is joined too');
select is((select archive_reason || '|' || do_not_call from customer.clients where id = pg_temp.owner('9820036005')), 'do_not_contact|true',
  '... and the joined customer stays do not contact');

-- AHEMDABAD list.
select customer_ingest_store('ahd_contact_list', jsonb_build_array(
  jsonb_build_object('row_key', 'Kiran Rao|9820036007|', 'sheet_row', 2, 'payload',
    '{"NAME": "Kiran Rao", "NUMBER 1": "9820036007", "SOURCE": "KAJAL MOTWANI CONTACT"}'::jsonb),
  jsonb_build_object('row_key', 'Meera Patel|09820036010|9820036011', 'sheet_row', 3, 'payload',
    '{"NAME": "Meera Patel", "NUMBER 1": "09820036010", "NUMBER 2": "9820036011", "NUMBER 3": "9820036012, 12345", "ADDRESS": "Navrangpura", "SOURCE": "KAJAL MOTWANI CONTACT"}'::jsonb),
  jsonb_build_object('row_key', 'Dev Shah|919820036020|', 'sheet_row', 4, 'payload',
    '{"NAME": "Dev Shah", "NUMBER 1": "919820036020", "SOURCE": "AHEMDABAD STORE ACCOUNT LIST"}'::jsonb)), '{"next_row": 5}');
select is(customer_ingest_apply('ahd_contact_list', 100) - 'pending', '{"applied": 3, "rejected": 0}'::jsonb, 'the Ahmedabad list applies');

select ok(pg_temp.owner('9820036007', 'ahmedabad') is not null and pg_temp.owner('9820036007', 'ahmedabad') <> pg_temp.owner('9820036007'),
  'a number known in Mumbai is a separate Ahmedabad customer');
select is((select count(distinct client_id) from customer.client_phones where phone in
            (customer.normalize_phone('9820036010'), customer.normalize_phone('9820036011'), customer.normalize_phone('9820036012'))), 1::bigint,
  'NUMBER 1, 2 and 3 are one person (a 0 in front and a cell with two numbers handled)');
select ok(exists (select 1 from customer.client_identifiers where client_id = pg_temp.owner('9820036010', 'ahmedabad') and id_type = 'unverified_phone' and value = '12345'),
  'a number that is not valid is kept as written');
select is((select first_origin || '|' || segment from customer.clients where id = pg_temp.owner('9820036010', 'ahmedabad')), 'KAJAL MOTWANI CONTACT|lead',
  'the real source; a contact is a lead');
select is((select first_origin || '|' || segment from customer.clients where id = pg_temp.owner('9820036020', 'ahmedabad')), 'AHEMDABAD STORE ACCOUNT LIST|buyer',
  'the store account list: a client, with its real source');

-- Running the check again changes nothing.
select is(customer.reconcile_open_pairs((select id from fx where label = 'tenant')), '{}'::jsonb, 'nothing left open to decide');

select * from finish();
rollback;
