-- 0405: customer master identity. One phone is one client; newest name is the
-- main name; every name and number is kept; answers win by source rank, then date.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(51);

create temp table fx(label text primary key, id uuid);
grant select on fx to authenticated, anon;
do $$
declare t uuid; t2 uuid; b uuid; b2 uuid; d uuid; d2 uuid; r record; aid uuid; pid uuid;
begin
  insert into tenants(name, slug) values ('0405 test', 'customer-0405') returning id into t;
  insert into tenants(name, slug) values ('0405 other', 'customer-0405-other') returning id into t2;
  insert into branches(tenant_id, name, code) values (t, '0405 Bandra', 'B0405') returning id into b;
  insert into branches(tenant_id, name, code) values (t2, '0405 Other', 'O0405') returning id into b2;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'CRM', 'C0405') returning id into d;
  insert into departments(tenant_id, branch_id, name, code) values (t2, b2, 'CRM', 'C0405O') returning id into d2;
  insert into fx values ('tenant', t), ('other_tenant', t2);
  for r in select * from (values
      ('crm', t, b, d, 'crm', 'active'), ('staff', t, b, d, 'staff', 'active'),
      ('inactive_crm', t, b, d, 'crm', 'inactive'), ('admin', t, b, d, 'super_admin', 'active'),
      ('other_crm', t2, b2, d2, 'crm', 'active')) v(kind, tn, br, dept, role, status) loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'cu-' || r.kind || '@example.invalid', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (r.tn, aid, r.br, r.dept, 'CU ' || r.kind, 'CU-' || upper(r.kind), 'cu-' || r.kind || '@example.invalid',
            r.role::user_role, 'active', r.status::user_account_status, true)
    returning id into pid;
    insert into fx values (r.kind, pid), (r.kind || '_auth', aid);
  end loop;
end $$;

create function pg_temp.id(p text) returns uuid language sql as $$ select id from fx where label = p $$;
create function pg_temp.act_as(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce((select id::text from fx where label = p || '_auth'), ''), true);
$$;

-- 1. Phone rule (same as packages/core phoneKey) --------------------------------
select is(customer.normalize_phone('9820000001'), '919820000001', 'ten digits are Indian');
select is(customer.normalize_phone('+91 98200-00001'), '919820000001', '+91 with spaces and dashes');
select is(customer.normalize_phone('09820000001'), '919820000001', 'a trunk 0 is removed');
select is(customer.normalize_phone('+65 9123 4567'), '6591234567', 'another country keeps its code');
select is(customer.normalize_phone('12345'), null, 'too short is not a phone');
select is(customer.normalize_phone(''), null, 'empty is not a phone');

-- 2. New phone -> new client with all three codes --------------------------------
insert into fx values ('meera', customer.find_or_create_client(pg_temp.id('tenant'), '9820000001', 'Meera  Shah', 'instagram_fms', '2026-01-10 10:00+05:30'));
select ok((select client_code ~ '^MKC-\d+$' and referral_code ~ '^MKREF-\d+$' from customer.clients where id = pg_temp.id('meera')),
  'a new phone creates a client with MKC and MKREF codes');
select ok((select h.household_code ~ '^MKF-\d+$' and h.main_client_id = c.id from customer.clients c join customer.households h on h.id = c.household_id where c.id = pg_temp.id('meera')),
  'and a family (MKF) whose main client is that person');
select is((select primary_name || '|' || segment || '|' || lifecycle_stage || '|' || first_source from customer.clients where id = pg_temp.id('meera')),
  'Meera Shah|lead|lead|instagram_fms', 'the new client is a lead; the name is cleaned; the first source is kept');
select is((select count(*)::int from audit_logs where action = 'customer_client_created' and record_id = pg_temp.id('meera')), 1,
  'creation writes one audit row');

-- 3. Same phone, another name -> same client, newest name wins -------------------
select is(customer.find_or_create_client(pg_temp.id('tenant'), '+919820000001', 'Ayush Shah', 'runo', '2026-03-01 12:00+05:30'), pg_temp.id('meera'),
  'the same phone with a different name is the same client');
select is((select primary_name from customer.clients where id = pg_temp.id('meera')), 'Ayush Shah', 'the newest name becomes the main name');
select is((select count(*)::int from customer.client_names where client_id = pg_temp.id('meera')), 2, 'the older name is kept');
select is(customer.find_or_create_client(pg_temp.id('tenant'), '9820000001', 'Old Name', 'master_sheet', '2022-05-05 12:00+05:30'), pg_temp.id('meera'),
  'an older row loaded later matches the same client');
select is((select primary_name || '|' || first_source from customer.clients where id = pg_temp.id('meera')), 'Ayush Shah|master_sheet',
  'an older row does not take the main name, but it becomes the first source');
select is((select count(*)::int from audit_logs where action = 'customer_client_created' and record_id = pg_temp.id('meera')), 1,
  'matching an existing client writes no new audit row');

-- 4. Same name, different phone -> different client ------------------------------
insert into fx values ('ayush2', customer.find_or_create_client(pg_temp.id('tenant'), '9820000002', 'Ayush Shah', 'runo', '2026-03-02 12:00+05:30'));
select isnt(pg_temp.id('ayush2'), pg_temp.id('meera'), 'the same name with a different phone is a different client');

-- 5. Extra phones ----------------------------------------------------------------
select is(customer.find_or_create_client(pg_temp.id('tenant'), '9820000001', 'Ayush Shah', 'walkin', '2026-04-01 12:00+05:30',
    array['98200 00003', 'bad'], '9820000004'), pg_temp.id('meera'), 'a row with extra numbers matches on the main phone');
select is((select string_agg(phone || ':' || kind, ',' order by phone) from customer.client_phones where client_id = pg_temp.id('meera')),
  '919820000001:primary,919820000003:other,919820000004:billing', 'second and billing numbers are kept; an invalid one is skipped');
select is(customer.find_or_create_client(pg_temp.id('tenant'), '9820000004', 'Someone', 'runo', '2026-04-02 12:00+05:30'), pg_temp.id('meera'),
  'a billing number finds the same client');
select is(customer.find_or_create_client(pg_temp.id('tenant'), '9820000001', 'Ayush Shah', 'walkin', '2026-04-03 12:00+05:30', array['9820000002']), pg_temp.id('meera'),
  'an extra number owned by another client still returns the main-phone client');
select is((select count(*)::int from customer.identity_review where status = 'open' and reason = 'two_phones_two_clients'
            and client_a = pg_temp.id('meera') and client_b = pg_temp.id('ayush2')), 1, 'and raises one review row, with no merge');
select is((select client_id from customer.client_phones where phone = '919820000002'), pg_temp.id('ayush2'), 'the other client keeps its phone');
select throws_ok($$insert into customer.client_phones(tenant_id, client_id, phone) values (pg_temp.id('tenant'), pg_temp.id('ayush2'), '919820000001')$$,
  '23505', null, 'the database refuses one phone on two clients');
select throws_ok($$select customer.find_or_create_client(pg_temp.id('tenant'), '123', 'X', 'runo')$$, '22023', 'Not a valid phone number',
  'an invalid main phone is refused');
select isnt(customer.find_or_create_client(pg_temp.id('other_tenant'), '9820000001', 'Other Co', 'runo'), pg_temp.id('meera'),
  'another company with the same phone gets its own client');

-- 6. Family member without a phone ------------------------------------------------
insert into fx values ('spouse', customer.create_client_without_phone(pg_temp.id('tenant'),
  (select household_id from customer.clients where id = pg_temp.id('meera')), 'Riya Shah', 'runo'));
select ok((select s.household_id = m.household_id and s.client_code <> m.client_code
            from customer.clients s, customer.clients m where s.id = pg_temp.id('spouse') and m.id = pg_temp.id('meera')),
  'a family member without a phone is a separate client in the same family');
select is(customer.create_client_without_phone(pg_temp.id('tenant'),
  (select household_id from customer.clients where id = pg_temp.id('meera')), 'riya  shah', 'walkin'), pg_temp.id('spouse'),
  'the same name entered again for that family is the same person');

-- 7. Answers: rank, then recency; stale flag; dates --------------------------------
select customer.set_field_value(pg_temp.id('meera'), 'city', 'Thane', 'instagram_fms', '2026-01-10 10:00+05:30');
select customer.set_field_value(pg_temp.id('meera'), 'city', 'Navi Mumbai', 'doubletick_fms', '2026-02-10 10:00+05:30');
select is((select city from customer.clients where id = pg_temp.id('meera')), 'Navi Mumbai', 'same rank: the latest answer wins');
select customer.set_field_value(pg_temp.id('meera'), 'city', 'Mumbai', 'walkin', '2026-01-20 10:00+05:30');
select is((select city from customer.clients where id = pg_temp.id('meera')), 'Mumbai', 'walk-in beats WhatsApp even when older');
select customer.set_field_value(pg_temp.id('meera'), 'city', 'Pune', 'runo', '2026-06-01 10:00+05:30');
select is((select city from customer.clients where id = pg_temp.id('meera')), 'Mumbai', 'a call does not overwrite a walk-in');
select is((select count(*)::int from customer.client_field_values where client_id = pg_temp.id('meera') and needs_review), 0, 'a newer lower-rank answer within 12 months is not flagged');
select customer.set_field_value(pg_temp.id('meera'), 'city', 'Delhi', 'runo', '2027-03-01 10:00+05:30');
select is((select city || '|' || (select string_agg(value, ',') from customer.client_field_values where client_id = c.id and needs_review)
            from customer.clients c where id = pg_temp.id('meera')), 'Mumbai|Delhi', 'a lower-rank answer 12+ months newer is flagged for review and does not overwrite');
select customer.set_field_value(pg_temp.id('meera'), 'city', 'Delhi', 'runo', '2027-03-01 10:00+05:30');
select is((select count(*)::int from customer.client_field_values where client_id = pg_temp.id('meera') and field_key = 'city'), 5, 'the same answer imported twice is stored once');
select customer.set_field_value(pg_temp.id('meera'), 'dob', '12/04/1988 11:41:47', 'runo', '2026-03-01 10:00+05:30');
select is((select dob::text || '|' || dob_year_known from customer.clients where id = pg_temp.id('meera')), '1988-04-12|true', 'a sheet date (day first) is read as a date');
select customer.set_field_value(pg_temp.id('meera'), 'anniversary', '--12-02', 'walkin', '2026-03-01 10:00+05:30');
select is((select to_char(anniversary, 'MM-DD') || '|' || anniversary_year_known from customer.clients where id = pg_temp.id('meera')), '12-02|false', 'a date without a year keeps day and month');
select throws_ok($$select customer.set_field_value(pg_temp.id('meera'), 'dob', 'giving', 'runo')$$, '22007', null, 'a dropdown word is not accepted as a date');
select lives_ok($$select customer.set_field_value(pg_temp.id('meera'), 'wedding_budget', '5 lakh', 'runo')$$, 'an answer with no client column is still stored');

-- 8. Merge -----------------------------------------------------------------------
select customer.merge_clients(pg_temp.id('meera'), pg_temp.id('ayush2'), 'previous number', pg_temp.id('admin'));
select is((select client_id from customer.client_phones where phone = '919820000002'), pg_temp.id('meera'), 'merge moves the phone to the kept client');
select ok((select archived_at is not null and merged_into_client_id = pg_temp.id('meera') from customer.clients where id = pg_temp.id('ayush2')),
  'the removed client is archived, not deleted');
select is((select count(*)::int from customer.identity_review where status = 'open'), 0, 'the open review for that pair is closed');
select is((select count(*)::int from audit_logs where action = 'customer_clients_merged' and record_id = pg_temp.id('meera')), 1, 'merge is audited');

-- 9. Who can read ----------------------------------------------------------------
select is(has_function_privilege('authenticated', 'customer.find_or_create_client(uuid,text,text,text,timestamptz,text[],text,uuid,uuid)', 'execute')
       or has_function_privilege('authenticated', 'customer.merge_clients(uuid,uuid,text,uuid)', 'execute')
       or has_schema_privilege('authenticated', 'customer', 'usage')
       or has_function_privilege('anon', 'public.customer_search(text,integer)', 'execute'), false,
  'browsers cannot reach the schema or the write functions; anon cannot search');

set local role authenticated;
select pg_temp.act_as('crm');
select is((select string_agg(matched_on, ',') from customer_search('98200 00004')), 'phone', 'a CRM user finds a client by any of its phones');
select is((select count(*)::int from customer_search('ayu')), 1, 'and by the start of a name');
select is((select count(*)::int from customer_search((select client_code from customer_search('9820000001')))), 1, 'and by MKC code');
select is((customer_get_profile((select client_id from customer_search('9820000001'))) -> 'field_sources' -> 'city' ->> 'source'), 'walkin',
  'the profile shows which source each answer came from');
select pg_temp.act_as('other_crm');
select is((select count(*)::int from customer_search('ayu')), 0, 'another company sees none of these clients');
select pg_temp.act_as('staff');
select throws_ok($$select * from customer_search('9820000001')$$, '42501', 'Section access denied', 'a user without CRM access is refused');
select pg_temp.act_as('inactive_crm');
select throws_ok($$select * from customer_search('9820000001')$$, '42501', 'Section access denied', 'an inactive user is refused');
reset role;

insert into tenant_section_controls(tenant_id, section_availability) values (pg_temp.id('tenant'), '{"crm": false}')
on conflict (tenant_id) do update set section_availability = excluded.section_availability;
set local role authenticated;
select pg_temp.act_as('crm');
select throws_ok($$select * from customer_search('9820000001')$$, '42501', 'This section is currently unavailable', 'the CRM section switched off refuses the search');
reset role;

select * from finish();
rollback;
