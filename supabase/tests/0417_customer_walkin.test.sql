-- 0417: walk-in dataset, family data and referrals.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(30);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; u uuid; b uuid;
begin
  insert into tenants(name, slug) values ('0417 test', 'customer-0417') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into branches(tenant_id, name, code) values (t, 'MK Bandra', 'B0417') returning id into b;
  insert into user_profiles(tenant_id, employee_name) values (t, 'Uma Sehgal') returning id into u;
  insert into fx values ('tenant', t), ('uma', u), ('bandra', b);
end $$;
create function pg_temp.fx(p text) returns uuid language sql as $$ select id from fx where label = p $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = pg_temp.fx('tenant') and phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.visit(p_ref text, p_row integer, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_ref, 'sheet_row', p_row, 'payload', jsonb_build_object(
    'TIMESTAMP', '2026-11-05 11:20:00', 'CRM CLIENT ID', 'MKC-' || p_row, 'CLIENT VISIT DATE', '2026-11-05', 'CLIENT TYPE', 'NEW CLIENT',
    'SOURCE OF LEAD', 'INSTAGRAM', 'BRANCH', 'BANDRA', 'CRM NAME', 'SHRUTI VORA', 'CLIENT NAME', 'Asha Mehta', 'GENDER', 'FEMALE',
    'CLIENT PHONE', '919820017001', 'BILLING PHONE', '919820017001', 'COUNTRY', 'INDIA', 'CITY', 'MUMBAI', 'COMMUNITY', 'GUJARATI',
    'SALESPERSON', 'UMA SEHGAL', 'CLIENT BOUGHT ANY PRODUCT?', 'NO', 'REFERENCE NUMBER', p_ref, 'FAMILY ID', 'MKF-' || p_row) || p_extra) $$;
create function pg_temp.h(variadic p text[]) returns jsonb language sql as $$ select jsonb_build_object('headers', to_jsonb(p)) $$;

-- 1. A visit ------------------------------------------------------------------------------------
select customer_ingest_store('walkin', jsonb_build_array(
  pg_temp.visit('MK-W-1', 2, '{"CLIENT BOUGHT ANY PRODUCT?": "YES", "BOUGHT TAGS (COMBINED)": "N123456, N123457", "BOUGHT CATEGORIES": "GOLD CHAIN",
    "SEEN CATEGORIES": "POLKI SET, NA", "CITY": "OTHER", "CITY (OTHER)": "THANE", "BEVERAGE": "COFFEE", "SUGAR": "NA", "DOB": "1990-04-12",
    "NEXT VISIT DATE": "2026-12-01", "REMARK": "liked the polki set", "NOT BOUGHT REASONS": "PRICE", "NOT BOUGHT REASON (OTHER TEXT)": "will come with husband",
    "COMPANION 1 NAME": "Ravi Mehta", "COMPANION 1 MOBILE": "9820017002", "COMPANION 1 RELATION": "HUSBAND",
    "COMPANION 2 NAME": "Tara", "COMPANION 2 RELATION": "DAUGHTER", "RESERVED COLUMN 119": "THANE"}'),
  pg_temp.visit('MK-W-2', 3, '{"CLIENT PHONE": "", "BILLING PHONE": "919820017003", "CLIENT NAME": "Bina Rao", "CLIENT VISIT DATE": "06/11/2026",
    "TIMESTAMP": "06/11/2026 12:00:00", "CLIENT BOUGHT ANY PRODUCT?": "ORDER_PLACED", "ANNIVERSARY": "31/02/2010"}'),
  pg_temp.visit('MK-W-3', 4, '{"CLIENT PHONE": "", "BILLING PHONE": "", "CLIENT NAME": "Chetan", "TIMESTAMP": "2026-11-07 10:00:00", "CLIENT VISIT DATE": "2026-11-07"}'),
  pg_temp.visit('MK-W-4', 5, '{"CLIENT NAME": "CLIENT NAME", "GENDER": "GENDER", "CLIENT PHONE": "CLIENT PHONE"}')),
  pg_temp.h('TIMESTAMP', 'CRM CLIENT ID', 'CLIENT VISIT DATE', 'CLIENT NAME', 'CLIENT PHONE', 'BILLING PHONE', 'CITY', 'CITY (OTHER)', 'REFERENCE NUMBER', 'RESERVED COLUMN 119')
    || '{"next_row": 6}');
select is(customer_ingest_apply('walkin', 100) - 'pending', '{"applied": 3, "rejected": 1}'::jsonb, 'three visits applied; the header copy is not a visit');
select is((select reject_reason from customer.ingest_rows where row_key = 'MK-W-4'), 'Header row inside the data', 'and says so');

select is((select channel || '|' || direction || '|' || purpose || '|' || outcome || '|' || result || '|' || occurred_at::text
             from customer.interactions where external_ref = 'MK-W-1'),
  'walk_in|in_person|purchase|YES|positive|' || ('2026-11-05 11:20:00+05:30'::timestamptz)::text, 'YES is a purchase, dated by the visit and the form time');
select is((select staff_user_id || '|' || recorded_by_name || '|' || branch_id || '|' || notes || '|' || customer_type_stated from customer.interactions where external_ref = 'MK-W-1'),
  pg_temp.fx('uma') || '|SHRUTI VORA|' || pg_temp.fx('bandra') || '|liked the polki set|NEW CLIENT', 'salesperson, form filler, branch, remark and client type');
select is((select outcome || '|' || purpose || '|' || result from customer.interactions where external_ref = 'MK-W-2'), 'ORDER_PLACED|visit|neutral',
  'other outcomes are kept as written');
select is((select segment || '|' || lifecycle_stage || '|' || (last_purchase_at is not null) from customer.clients where id = pg_temp.client('9820017001')),
  'buyer|visited|true', 'the buyer is marked from the visit');
select is((select segment from customer.clients where id = pg_temp.client('9820017003')), 'lead', 'an order placed does not make a buyer by itself');

select is((select string_agg(coalesce(product_code, product_category) || ':' || interest, ',' order by interest, coalesce(product_code, product_category))
             from customer.interaction_products p join customer.interactions i on i.id = p.interaction_id where i.external_ref = 'MK-W-1'),
  'GOLD CHAIN:bought,N123456:bought,N123457:bought,POLKI SET:seen', 'products seen and bought; NA is no product');
select is((select city || '|' || beverage || '|' || coalesce(sugar, '-') || '|' || dob::text || '|' || community from customer.clients where id = pg_temp.client('9820017001')),
  'THANE|COFFEE|-|1990-04-12|GUJARATI', 'answers: the OTHER box when OTHER is chosen; NA is no answer; the RESERVED copy is not used');
select is((select value from customer.client_field_values where client_id = pg_temp.client('9820017001') and field_key = 'not_bought_reasons'),
  'PRICE; will come with husband', 'not-bought reasons with the free text');
select is((select a.type || '|' || a.status || '|' || a.branch_id from customer.appointments a join customer.interactions i on i.id = a.origin_interaction_id where i.external_ref = 'MK-W-1'),
  'store|booked|' || pg_temp.fx('bandra'), 'the next visit date is a store appointment');
select is((select value from customer.client_field_values where client_id = pg_temp.client('9820017003') and field_key = 'anniversary_as_written'), '31/02/2010',
  'a date that does not exist is kept as written');

-- Who: billing phone, and no phone at all.
select is((select primary_name from customer.clients where id = pg_temp.client('9820017003')), 'Bina Rao', 'no client phone: the billing phone identifies the customer');
select is((select (c.client_code ~ '^MKC-') || '|' || (select count(*) from customer.client_phones p where p.client_id = c.id)
             from customer.clients c join customer.ingest_rows r on r.client_id = c.id where r.row_key = 'MK-W-3'),
  'true|0', 'no phone at all: a customer of their own');
select is((select string_agg(id_type || '=' || value, ',' order by id_type) from customer.client_identifiers
            where client_id = pg_temp.client('9820017001') and id_type like 'sheet%'), 'sheet_client_id=MKC-2,sheet_family_id=MKF-2',
  'the old sheet ids are kept as references, not as our codes');
select ok((select client_code from customer.clients where id = pg_temp.client('9820017001')) <> 'MKC-2', 'the customer has our own code');

-- Companions.
select is((select count(distinct household_id)::int from customer.clients c join customer.client_names n on n.client_id = c.id
            where c.tenant_id = pg_temp.fx('tenant') and n.name in ('Asha Mehta', 'Ravi Mehta', 'Tara')), 1, 'companions join the customer''s family');
select is((select string_agg(n.name || ':' || v.value, ',' order by n.name) from customer.client_field_values v join customer.client_names n on n.client_id = v.client_id
            where v.field_key = 'family_relation' and v.source = 'walkin'), 'Ravi Mehta:HUSBAND,Tara:DAUGHTER', 'with their relation');

-- 2. Family data ----------------------------------------------------------------------------------
select customer_ingest_store('walkin_family', jsonb_build_array(
  jsonb_build_object('row_key', 'MKC-2|05/11/2026 11:21:00', 'sheet_row', 2, 'payload', '{"TIMESTAMP": "05/11/2026 11:21:00", "MAIN CLIENT ID": "MKC-2", "CLIENT ID": "MKC-2", "FAMILY ID": "MKF-2", "FAMILY": "Asha Mehta", "NUMBER": "919820017001", "RELATION": "MAIN CLIENT", "COMMUNICATION PREFERENCE": "CALL"}'::jsonb),
  jsonb_build_object('row_key', 'MKC-9|05/11/2026 11:21:00', 'sheet_row', 3, 'payload', '{"TIMESTAMP": "05/11/2026 11:21:00", "MAIN CLIENT ID": "MKC-2", "CLIENT ID": "MKC-9", "FAMILY ID": "MKF-2", "FAMILY": "Meera Mehta", "RELATION": "MOTHER"}'::jsonb),
  jsonb_build_object('row_key', 'MKC-8|05/11/2026 11:21:00', 'sheet_row', 4, 'payload', '{"TIMESTAMP": "05/11/2026 11:21:00", "MAIN CLIENT ID": "MKC-2", "CLIENT ID": "MKC-8", "FAMILY ID": "MKF-2", "FAMILY": "Nikhil", "NUMBER": "+919820017009", "RELATION": "SON"}'::jsonb),
  jsonb_build_object('row_key', 'MKC-50|01/11/2026 10:00:00', 'sheet_row', 5, 'payload', '{"TIMESTAMP": "01/11/2026 10:00:00", "MAIN CLIENT ID": "MKC-50", "CLIENT ID": "MKC-51", "FAMILY ID": "MKF-50", "FAMILY": "Om", "RELATION": "SON"}'::jsonb)),
  pg_temp.h('TIMESTAMP', 'MAIN CLIENT ID', 'CLIENT ID', 'FAMILY ID', 'FAMILY', 'NUMBER', 'RELATION', 'COMMUNICATION PREFERENCE') || '{"next_row": 6}');
select is(customer_ingest_apply('walkin_family', 100) - 'pending', '{"applied": 4, "rejected": 0}'::jsonb, 'family rows applied');
select is((select count(*)::int from customer.clients where household_id = (select household_id from customer.clients where id = pg_temp.client('9820017001'))), 5,
  'the old FAMILY ID puts the members in the main client''s family (with the walk-in companions)');
select is((select h.main_client_id from customer.households h join customer.clients c on c.household_id = h.id where c.id = pg_temp.client('9820017001')),
  pg_temp.client('9820017001'), 'MAIN CLIENT marks the family''s main client');
select is((select communication_preference from customer.clients where id = pg_temp.client('9820017001')), 'CALL', 'family-data answers reach the profile');
select is((select count(*)::int from customer.clients c join customer.client_names n on n.client_id = c.id where n.name = 'Om'), 1,
  'a member whose main client is unknown is kept as a customer of their own');

-- A visit of that unknown main client arrives later: the member joins.
select customer_ingest_store('walkin', jsonb_build_array(pg_temp.visit('MK-W-50', 50, '{"CLIENT PHONE": "9820017050", "BILLING PHONE": "", "CLIENT NAME": "Pari", "FAMILY ID": "MKF-50"}')), '{"next_row": 51}');
select customer_ingest_apply('walkin', 100);
select is((select household_id from customer.clients c join customer.client_names n on n.client_id = c.id where n.name = 'Om'),
  (select household_id from customer.clients where id = pg_temp.client('9820017050')), 'the family comes together whichever arrives first');

-- 3. Referrals -------------------------------------------------------------------------------------
select customer_ingest_store('referral', jsonb_build_array(
  jsonb_build_object('row_key', 'r1', 'sheet_row', 2, 'payload', '{"TIMESTAMP": "05/11/2026 11:20:00", "REFERENCE GIVEN BY CLIENT NAME": "ASHA MEHTA", "REFERRAL NAME": "Kavita", "REFERRAL NUMBER": "91 9820017020"}'::jsonb),
  jsonb_build_object('row_key', 'r2', 'sheet_row', 3, 'payload', '{"TIMESTAMP": "01/10/2026 09:00:00", "REFERENCE GIVEN BY CLIENT NAME": "Someone", "REFERRAL NAME": "Lalit", "REFERRAL NUMBER": "982001702"}'::jsonb),
  jsonb_build_object('row_key', 'r3', 'sheet_row', 4, 'payload', '{"TIMESTAMP": "08/11/2026 15:00:00", "REFERENCE GIVEN BY CLIENT NAME": "Divya", "REFERRAL NAME": "Mohan", "REFERRAL NUMBER": "9820017030"}'::jsonb)),
  pg_temp.h('TIMESTAMP', 'REFERENCE GIVEN BY CLIENT NAME', 'REFERRAL NAME', 'REFERRAL NUMBER') || '{"next_row": 5}');
select is(customer_ingest_apply('referral', 100) - 'pending', '{"applied": 3, "rejected": 0}'::jsonb, 'referrals applied, including an invalid number');
select is((select referred_by_client_id from customer.clients where id = pg_temp.client('9820017020')), pg_temp.client('9820017001'),
  'the giver is the client whose visit form was sent in the same second');
select is((select v.value from customer.client_field_values v join customer.ingest_rows r on r.client_id = v.client_id where r.row_key = 'r2' and v.field_key = 'referred_by_name'),
  'Someone', 'no matching visit: the giver''s name is kept as written');
-- The giver's visit arrives after the referral.
select customer_ingest_store('walkin', jsonb_build_array(pg_temp.visit('MK-W-60', 60, '{"TIMESTAMP": "2026-11-08 15:00:00", "CLIENT VISIT DATE": "2026-11-08", "CLIENT PHONE": "9820017060", "BILLING PHONE": "", "CLIENT NAME": "Divya", "FAMILY ID": ""}')), '{"next_row": 61}');
select customer_ingest_apply('walkin', 100);
select is((select referred_by_client_id from customer.clients where id = pg_temp.client('9820017030')), pg_temp.client('9820017060'),
  'a referral imported before the visit is linked when the visit arrives');

-- 4. Removal ---------------------------------------------------------------------------------------
select customer.remove_source_row(id) from customer.ingest_rows where row_key = 'MK-W-1';
select is((select segment || '|' || (last_purchase_at is null) from customer.clients where id = pg_temp.client('9820017001')), 'lead|true',
  'a removed purchase visit takes the buyer mark with it');
select is(has_function_privilege('authenticated', 'customer.apply_walkin_row(uuid)', 'execute'), false, 'browsers cannot run the import');

select * from finish();
rollback;
