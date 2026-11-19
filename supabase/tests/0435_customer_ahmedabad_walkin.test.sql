-- 0435: Ahmedabad walk-ins; walk-ins decide the city.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid; a uuid; b uuid;
begin
  insert into tenants(name, slug) values ('0435 test', 'customer-0435') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK911') returning id into m;
  insert into franchise_groups (tenant_id, name, code) values (t, 'Ahmedabad', 'MK912') returning id into a;
  insert into branches (tenant_id, name, code, franchise_group_id) values (t, 'CG ROAD AHMEDABAD', 'CGA', a) returning id into b;
  insert into fx values ('tenant', t), ('mumbai', m), ('ahmedabad', a), ('cga', b);
end $$;
create function pg_temp.fx(p text) returns uuid language sql as $$ select id from fx where label = p $$;
create function pg_temp.clients(p_phone text) returns text language sql as $$
  select string_agg(f.name, ',' order by f.name) from customer.client_phones p join customer.clients c on c.id = p.client_id
    join franchise_groups f on f.id = c.franchise_group_id
   where p.tenant_id = pg_temp.fx('tenant') and p.phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.visit(p_ref text, p_row integer, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_ref, 'sheet_row', p_row, 'payload', jsonb_build_object(
    'TIMESTAMP', '2026-11-05 11:20:00', 'CRM CLIENT ID', 'MKC-' || p_row, 'CLIENT VISIT DATE', '2026-11-05', 'CLIENT TYPE', 'OLD CLIENT',
    'BRANCH', 'CGR', 'CRM NAME', 'ANJALI NAYAK', 'CLIENT NAME', 'Sapna', 'GENDER', 'FEMALE', 'CLIENT PHONE', '9820035001', 'BILLING PHONE', '9820035001',
    'CLIENT BOUGHT ANY PRODUCT?', 'YES', 'REFERENCE NUMBER', p_ref, 'WHAT GOLD RATE WAS APPLIED TO THIS PRODUCT FOR THE CLIENT?', 'NEW RATE',
    'FORM FILLED BY', 'PRERNA NAYAK') || p_extra) $$;

update customer.source_tables set franchise_code = 'MK911' where source in ('master_sheet', 'walkin');
update customer.source_tables set franchise_code = 'MK912' where source in ('ahd_walkin', 'ahd_walkin_family', 'ahd_referral');

-- A from a Mumbai list only; B walked in at a Mumbai store.
select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '9820035001', 'sheet_row', 4, 'payload', '{"CONTACT NUMBER": "9820035001", "CLIENT NAME": "Sapna", "SOURCE OF WALK-IN": "Ahmedabad Customer"}'::jsonb)), '{"next_row": 5}');
select customer_ingest_apply('master_sheet', 100);
select customer_ingest_store('walkin', jsonb_build_array(pg_temp.visit('MK-W-B', 2, '{"BRANCH": "BANDRA", "CLIENT PHONE": "9820035002", "BILLING PHONE": "9820035002", "CLIENT NAME": "Bina"}')), '{"next_row": 3}');
select customer_ingest_apply('walkin', 100);
create temp table before as select c.id from customer.clients c join customer.client_phones p on p.client_id = c.id where p.phone = customer.normalize_phone('9820035001');

-- Both walk in at an Ahmedabad store.
select customer_ingest_store('ahd_walkin', jsonb_build_array(
  pg_temp.visit('MK-A-1', 4, '{}'),
  pg_temp.visit('MK-A-2', 5, '{"CLIENT PHONE": "9820035002", "BILLING PHONE": "9820035002", "CLIENT NAME": "Bina"}')), '{"next_row": 6}');
select is(customer_ingest_apply('ahd_walkin', 100) - 'pending', '{"applied": 2, "rejected": 0}'::jsonb, 'Ahmedabad walk-ins apply');

select is(pg_temp.clients('9820035001'), 'Ahmedabad', 'a list-only Mumbai record of an Ahmedabad walk-in moves to Ahmedabad');
select is((select c.id from customer.clients c join customer.client_phones p on p.client_id = c.id where p.phone = customer.normalize_phone('9820035001')),
  (select id from before), 'it is the same record, with its history');
select ok(exists (select 1 from audit_logs where action = 'customer_moved_franchise' and record_id = (select id from before)), 'the move is audited');
select is(pg_temp.clients('9820035002'), 'Ahmedabad,Mumbai', 'someone who walked in at both cities has a record in each');

select is((select b.code from customer.interactions i join branches b on b.id = i.branch_id where i.source = 'ahd_walkin' and i.external_ref = 'MK-A-1'), 'CGA',
  'CGR is CG ROAD AHMEDABAD');
select is((select value from customer.client_field_values where source = 'ahd_walkin' and field_key = 'gold_rate_applied' limit 1), 'NEW RATE',
  'Ahmedabad''s extra columns are kept');
select is((select first_source from customer.clients where id in (select client_id from customer.ingest_rows where source = 'ahd_walkin' and row_key = 'MK-A-2')),
  'ahd_walkin', 'the Ahmedabad record of a two-city person starts at the Ahmedabad walk-in');

-- The Mumbai list row changes later: it finds the person in Ahmedabad, no new Mumbai record.
update customer.ingest_rows set updated_at = now() - interval '1 minute' where source = 'master_sheet';
select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '9820035001', 'sheet_row', 4, 'payload', '{"CONTACT NUMBER": "9820035001", "CLIENT NAME": "Sapna", "SOURCE OF WALK-IN": "Ahmedabad Customer", "CITY": "Ahmedabad"}'::jsonb)), '{"next_row": 5}');
select customer_ingest_apply('master_sheet', 100);
select is(pg_temp.clients('9820035001'), 'Ahmedabad', 'a Mumbai list follows the person to the city they walked in');

-- Family and referrals.
select customer_ingest_store('ahd_walkin_family', jsonb_build_array(jsonb_build_object('row_key', 'MKC-900|13/10/2026', 'sheet_row', 2, 'payload',
  '{"TIMESTAMP": "13/10/2026", "MAIN CLIENT ID": "MKC-4", "CLIENT ID": "MKC-900", "FAMILY ID": "MKF4", "FAMILY": "Raj", "NUMBER": "9820035003", "RELATION": "HUSBAND"}'::jsonb)), '{"next_row": 3}');
select is(customer_ingest_apply('ahd_walkin_family', 100) - 'pending', '{"applied": 1, "rejected": 0}'::jsonb, 'family rows apply');
select is(pg_temp.clients('9820035003'), 'Ahmedabad', 'family members are Ahmedabad''s');
select customer_ingest_store('ahd_referral', jsonb_build_array(jsonb_build_object('row_key', '9820035004|Jyoti', 'sheet_row', 2, 'payload',
  '{"CRM NAME": "ANJALI NAYAK", "SALES PERSON NAME": "SAPNA CHANDNANI", "REFERENCE GIVEN BY CLIENT NAME": "Sapna", "REFERRAL NAME": "Jyoti", "NUMBER": "9820035004", "LOCATION OF REFERRAL": "NARODA", "RELIGION OF REFERRAL": "SINDHI"}'::jsonb)), '{"next_row": 3}');
select is(customer_ingest_apply('ahd_referral', 100) - 'pending', '{"applied": 1, "rejected": 0}'::jsonb, 'referral rows apply');
select is((select f.name || '|' || c.segment || '|' || (select value from customer.client_field_values v where v.client_id = c.id and v.field_key = 'referred_by_name')
             from customer.clients c join franchise_groups f on f.id = c.franchise_group_id join customer.client_phones p on p.client_id = c.id
            where p.phone = customer.normalize_phone('9820035004')), 'Ahmedabad|lead|Sapna', 'a referral is an Ahmedabad lead, the giver kept by name');

select * from finish();
rollback;
