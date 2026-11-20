-- 0441: forms fill client details from the customer database.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid; a uuid; bm uuid; ba uuid; d uuid; v_auth uuid; v_id uuid; p record; h uuid; c uuid;
begin
  insert into tenants(name, slug) values ('0441 test', 'customer-0441') returning id into t;
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK411') returning id into m;
  insert into franchise_groups (tenant_id, name, code) values (t, 'Ahmedabad', 'MK412') returning id into a;
  insert into branches(tenant_id, name, code, franchise_group_id) values (t, '0441 Mumbai', 'S0441M', m) returning id into bm;
  insert into branches(tenant_id, name, code, franchise_group_id) values (t, '0441 Ahmedabad', 'S0441A', a) returning id into ba;
  insert into departments(tenant_id, branch_id, name, code) values (t, bm, 'Sales', 'D0441') returning id into d;
  insert into fx values ('tenant', t), ('mumbai', m), ('ahmedabad', a);
  for p in select * from (values ('crm_mumbai', 'crm', bm), ('crm_ahd', 'crm', ba), ('staff', 'staff', bm)) as x(name, role, branch) loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p.name || '-0441@test.local', 'x', now(), now())
    returning id into v_auth;
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (t, v_auth, p.branch, d, '0441 ' || p.name, 'E0441-' || p.name, p.name || '-0441@test.local', p.role::user_role, 'active', 'active', true) returning id into v_id;
    insert into fx values (p.name, v_auth);
  end loop;

  -- One number known in both franchises (two clients), with a billing phone in Mumbai.
  insert into customer.households(tenant_id) values (t) returning id into h;
  insert into customer.clients(tenant_id, household_id, primary_name, gender, dob, anniversary, anniversary_year_known, city, pincode, community, franchise_group_id, last_contacted_at)
  values (t, h, 'Leena Shah', 'Female', '1990-04-02', '2000-12-05', false, 'Mumbai', '400028', 'Gujarati', m, now() - interval '30 days') returning id into c;
  insert into customer.client_phones(tenant_id, client_id, phone, kind, franchise_group_id) values (t, c, '919820041001', 'primary', m), (t, c, '919820041009', 'billing', m);
  insert into fx values ('leena_mumbai', c);
  insert into customer.households(tenant_id) values (t) returning id into h;
  insert into customer.clients(tenant_id, household_id, primary_name, city, franchise_group_id, last_contacted_at)
  values (t, h, 'Leena S', 'Ahmedabad', a, now()) returning id into c;
  insert into customer.client_phones(tenant_id, client_id, phone, kind, franchise_group_id) values (t, c, '919820041001', 'primary', a);
  -- A merged record's number is never used.
  insert into customer.households(tenant_id) values (t) returning id into h;
  insert into customer.clients(tenant_id, household_id, primary_name, franchise_group_id, merged_into_client_id)
  values (t, h, 'Old Record', m, (select id from fx where label = 'leena_mumbai')) returning id into c;
  insert into customer.client_phones(tenant_id, client_id, phone, kind, franchise_group_id) values (t, c, '919820041002', 'primary', m);
end $$;
insert into customer.pincodes(pincode, city, state, country) values ('400028', 'Mumbai', 'Maharashtra', 'India') on conflict (pincode) do nothing;

create function pg_temp.sign_in(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from fx where label = p_who), 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', (select id from fx where label = p_who)::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true) $$;

select is(customer.load_pincodes('[{"pincode": "380001", "city": "Ahmedabad", "state": "Gujarat", "country": "India"}, {"pincode": "12", "city": "x"}, {"pincode": "380002", "city": "Gone", "active": false}]'),
  1, 'the owner''s copy loads valid, active pincodes only');
select is(customer.load_pincodes('[{"pincode": "380001", "city": "Ahmedabad City", "state": "Gujarat", "country": "India"}]'), 1, '... and a second copy updates the names');
select is((select city from customer.pincodes where pincode = '380001'), 'Ahmedabad City', '... to the newest');

select pg_temp.sign_in('crm_mumbai');
select is(customer_form_lookup('98200 41001') ->> 'primary_name', 'Leena Shah', 'a typed number finds the customer of the asker''s own franchise');
select is(customer_form_lookup('9820041001') ->> 'billing_phone', '+919820041009', '... with the billing phone');
select is(customer_form_lookup('9820041001') ->> 'dob', '1990-04-02', '... a full date of birth');
select ok(not (customer_form_lookup('9820041001') ? 'anniversary'), '... but no anniversary whose year is unknown');
select is(customer_form_lookup('+91 98200 41001') ->> 'community', 'Gujarati', '... the number may carry its country code');
select is(customer_form_lookup('9820041002'), null::jsonb, 'a merged record''s number fills nothing');
select is(customer_form_lookup('12'), null::jsonb, 'not a phone number: nothing');
select is(customer_pincode_lookup('400028'), '{"city": "Mumbai", "state": "Maharashtra", "country": "India"}'::jsonb, 'a pincode fills city, state and country');

select pg_temp.sign_in('crm_ahd');
select is(customer_form_lookup('9820041001') ->> 'primary_name', 'Leena S', 'in Ahmedabad the same number is the Ahmedabad customer');

select pg_temp.sign_in('staff');
select throws_ok($$ select customer_form_lookup('9820041001') $$, '42501', null, 'someone without CRM access gets nothing');
select ok(not has_function_privilege('authenticated', 'customer.load_pincodes(jsonb)', 'execute'), 'the pincode copy is not open to the app');
select ok(has_function_privilege('authenticated', 'public.customer_form_lookup(text)', 'execute') and not has_function_privilege('anon', 'public.customer_form_lookup(text)', 'execute'),
  'the lookup is open to signed-in people only');

select * from finish();
rollback;
