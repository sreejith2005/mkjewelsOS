-- 0455: customer data standards - interpretations, places, validity, rules, sensitive fields.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(43);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid; b uuid; d uuid; v_auth uuid; v_id uuid; p record;
begin
  insert into tenants(name, slug) values ('0455 test', 'customer-0455') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK985') returning id into m;
  insert into branches(tenant_id, name, code) values (t, '0455 Store', 'S0455') returning id into b;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'Sales', 'D0455') returning id into d;
  insert into fx values ('tenant', t), ('mumbai', m);
  for p in select * from (values ('boss', 'super_admin'), ('staff', 'staff')) as x(name, role) loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p.name || '-0455@test.local', 'x', now(), now())
    returning id into v_auth;
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (t, v_auth, b, d, '0455 ' || p.name, 'E0455-' || p.name, p.name || '-0455@test.local', p.role::user_role, 'active', 'active', true) returning id into v_id;
    insert into fx values (p.name, v_auth), (p.name || '_profile', v_id);
  end loop;
end $$;
update customer.source_tables set franchise_code = 'MK985' where source in ('master_sheet', 'software_account_list');

create function pg_temp.sign_in(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from fx where label = p_who), 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', (select id from fx where label = p_who)::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true) $$;
update customer.source_tables set franchise_code = 'MK985' where source in ('master_sheet');
create function pg_temp.c(p_phone text) returns customer.clients language sql as $$
  select c.* from customer.clients c join customer.client_phones ph on ph.client_id = c.id
   where ph.tenant_id = (select id from fx where label = 'tenant') and ph.phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.new(p_phone text) returns uuid language sql as $$
  select customer.find_or_create_client((select id from fx where label = 'tenant'), p_phone, 'Synthetic ' || right(p_phone, 3), 'master_sheet', now()) $$;
create function pg_temp.say(p_phone text, p_field text, p_value text, p_source text default 'master_sheet', p_days integer default 0) returns void language plpgsql as $$
declare v uuid;
begin
  v := pg_temp.new(p_phone);
  v := customer.current_client(v);
  perform customer.set_field_value(v, p_field, p_value, p_source, now() - make_interval(days => p_days));
end $$;

-- 1. Capitalization: one Mumbai.
select pg_temp.say('9820055001', 'city', 'MUMBAI');
select pg_temp.say('9820055002', 'city', 'Mumbai');
select pg_temp.say('9820055003', 'city', 'mumbai ');
select is((select count(distinct city) from customer.clients where id in ((pg_temp.c('9820055001')).id, (pg_temp.c('9820055002')).id, (pg_temp.c('9820055003')).id)),
  1::bigint, 'MUMBAI, Mumbai and mumbai are one city');
select is((pg_temp.c('9820055002')).std_codes ->> 'city', 'place:mumbai', '... with a stable code');
select is((pg_temp.c('9820055001')).std_values ->> 'state', 'Maharashtra', '... and the state from the city');
select is((pg_temp.c('9820055001')).std_status ->> 'state', 'derived', '... marked as derived');
select is((select count(*) from customer.client_field_values v where v.client_id = (pg_temp.c('9820055001')).id and v.value = 'MUMBAI'), 1::bigint, 'the raw value is kept');

-- 2. Old names.
select pg_temp.say('9820055004', 'city', 'Bangalore');
select pg_temp.say('9820055005', 'city', 'BANGALORE');
select pg_temp.say('9820055006', 'city', 'Bengaluru,');
select is((select count(distinct std_codes ->> 'city') from customer.clients where id in ((pg_temp.c('9820055004')).id, (pg_temp.c('9820055005')).id, (pg_temp.c('9820055006')).id)),
  1::bigint, 'Bangalore and Bengaluru are one city');
select is(customer.ref_relabel_by_usage('place') >= 1, true, 'the label follows the spelling used most');
select is((select label from customer.ref_values where domain = 'place' and code = 'bengaluru'), 'Bangalore', '... Bangalore here');

-- 3. Locality.
select pg_temp.say('9820055007', 'city', 'Borivali');
select is((pg_temp.c('9820055007')).city, 'Mumbai', 'Borivali gives the city Mumbai');
select is((pg_temp.c('9820055007')).locality, 'Borivali', '... and keeps Borivali as the locality');
select is((pg_temp.c('9820055007')).country, 'India', '... and the country');

-- 4. A state written as a city: no city is invented.
select pg_temp.say('9820055008', 'city', 'HARYANA');
select is((pg_temp.c('9820055008')).city, null, 'Haryana in CITY makes no city');
select is((pg_temp.c('9820055008')).state, 'Haryana', '... it is kept as the state');
select is((pg_temp.c('9820055008')).std_status ->> 'state', 'cross_field', '... marked as coming from another field');

-- 5. Conflict: the own state answer stays.
select pg_temp.say('9820055009', 'state', 'Gujarat');
select pg_temp.say('9820055009', 'city', 'Mumbai');
select is((pg_temp.c('9820055009')).state, 'Gujarat', 'a different own state is not overwritten');
select is((pg_temp.c('9820055009')).std_status ->> 'state', 'conflict', '... the conflict is marked');

-- 6. Validity before rank.
select pg_temp.say('9820055010', 'city', 'Ahmedabad', 'runo', 30);
select pg_temp.say('9820055010', 'city', 'None', 'software');
select is((pg_temp.c('9820055010')).city, 'Ahmedabad', '"None" from a better source does not beat a real city');
select pg_temp.say('9820055011', 'city', 'Pune', 'runo', 30);
select pg_temp.say('9820055011', 'city', 'P', 'software');
select is((pg_temp.c('9820055011')).city, 'Pune', '"P" is not a city');
select pg_temp.say('9820055012', 'city', 'Kharghar Sector 5');
select is((pg_temp.c('9820055012')).city, 'Kharghar Sector 5', 'an unknown place is kept as written');
select is((pg_temp.c('9820055012')).std_status ->> 'city', 'unmapped', '... and marked as not standardized yet');

-- 7. Community: spelling only, lists, no inference.
select pg_temp.say('9820055013', 'community', 'GUJARATI');
select pg_temp.say('9820055014', 'community', 'Gujrati');
select pg_temp.say('9820055015', 'community', 'Kannada,Tamil');
select pg_temp.say('9820055016', 'community', 'MUMBAI');
select is((pg_temp.c('9820055014')).community, 'Gujarati', 'Gujrati is Gujarati');
select is((pg_temp.c('9820055015')).std_codes -> 'community', '["community:kannada", "community:tamil"]'::jsonb, 'two communities, two codes');
select is((select status from customer.value_interpretations i join customer.client_field_values v on v.id = i.field_value_id
            where v.client_id = (pg_temp.c('9820055016')).id and i.output_field = 'community'), 'wrong_field', 'a city in COMMUNITY is flagged');
select is((pg_temp.c('9820055016')).city, null, '... and does not become the city');

-- 8. Acquisition source is its own field.
select pg_temp.say('9820055017', 'lead_source', 'instagram');
select is((pg_temp.c('9820055017')).std_values ->> 'acquisition_source', 'Instagram', 'How they found us: Instagram');

-- The table: codes, one row per customer, counts of distinct customers.
select pg_temp.sign_in('boss');
create function pg_temp.n(p jsonb) returns integer language sql as $$ select (public.customer_table(p) ->> 'total')::integer $$;
select is(pg_temp.n('{"columns": ["name"], "filter": {"items": [{"field": "city", "op": "is_any_of", "value": ["place:mumbai"]}]}}'), 5,
  'filtering Mumbai finds MUMBAI, Mumbai, mumbai, Borivali and the customer with a Gujarat state');
select is(pg_temp.n('{"columns": ["name"], "filter": {"items": [{"field": "locality", "op": "is_any_of", "value": ["Borivali"]}]}}'), 1, 'and Borivali alone');
select is(pg_temp.n('{"columns": ["name"], "filter": {"items": [{"field": "community", "op": "has_any_of", "value": ["community:kannada", "community:tamil"]}]}}'), 1,
  'a customer matching two values is one row');
select is((select (x ->> 'count')::integer from jsonb_array_elements(public.customer_table_values('city')) x where x ->> 'code' = 'place:mumbai'), 5,
  'the value picker offers Mumbai once, with distinct customers');
select is(pg_temp.n('{"columns": ["name"], "filter": {"items": [{"field": "city", "op": "is_any_of", "value": ["place:bengaluru"]}]}}'), 3,
  'a renamed label keeps its code filter working');

-- Review and decisions.
select ok(exists (select 1 from jsonb_array_elements(public.customer_std_queue('city') -> 'items') x where x ->> 'input_key' = 'kharghar sector 5'), 'the unknown place is in the review');
select is(public.customer_std_decide('city', 'kharghar sector 5',
  '{"create": {"label": "Kharghar", "kind": "locality", "parent": "place:navi-mumbai"}}', 'Area of Navi Mumbai') ->> 'status', 'approved', 'a person creates the locality and maps it');
select customer.process_std_jobs(10000);
select is((pg_temp.c('9820055012')).city, 'Navi Mumbai', '... the customer now has the city');
select is((pg_temp.c('9820055012')).locality, 'Kharghar', '... and the locality');
select customer.process_std_jobs(10000);
select is((select count(*) from customer.value_interpretations where client_id = (pg_temp.c('9820055012')).id), 1::bigint, 'running the jobs again adds nothing');
select is(public.customer_std_end_rule((select id from customer.std_rules where input_key = 'kharghar sector 5' and status = 'approved'), 'Wrong area') ->> 'status',
  'inactive', 'a rule can be ended');
select customer.process_std_jobs(10000);
select is((pg_temp.c('9820055012')).std_status ->> 'city', 'unmapped', '... and the value is read again without it');

-- A new field joins with no field-specific code.
select is(public.customer_std_set_policy('sugar', 'reference') ->> 'policy', 'reference', 'Sugar is turned on');
select pg_temp.say('9820055018', 'sugar', 'LESS SUGAR');
select pg_temp.say('9820055019', 'sugar', 'less sugar');
select pg_temp.say('9820055020', 'sugar', 'Kam cheeni');
select public.customer_ref_save('{"action": "create", "domain": "sugar", "label": "Less sugar", "aliases": "Kam cheeni"}');
select customer.process_std_jobs(10000);
select is((select count(*) from customer.clients where std_codes ->> 'sugar' = 'sugar:less-sugar'), 3::bigint, 'three spellings, one value');

-- Sensitive fields.
update permission_catalog set default_roles = '{super_admin}' where key = 'customers.view_sensitive';
update permission_catalog set default_roles = array_append(default_roles, 'staff') where key = 'crm.view' and not ('staff' = any (default_roles));
select pg_temp.sign_in('staff');
select ok(not exists (select 1 from jsonb_array_elements(public.customer_table_fields()) x where x ->> 'key' = 'community'), 'without the permission Community is not offered');
select throws_ok('select public.customer_table(''{"filter": {"items": [{"field": "community", "op": "is_not_empty"}]}}'')', '22023', null, '... cannot be filtered');
select throws_ok('select public.customer_table_values(''community'')', '22023', null, '... has no values');
select throws_ok(format('select public.customer_std_decide(%L, %L, %L)', 'city', 'kharghar sector 5', '{"status": "invalid"}'), '42501', null, 'staff cannot decide rules');

select * from finish();
rollback;
