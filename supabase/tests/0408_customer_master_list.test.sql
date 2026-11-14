-- 0408: the customer master list and its filters.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

create temp table fx(label text primary key, id uuid);
grant select on fx to authenticated, anon;
do $$
declare t uuid; t2 uuid; b uuid; b2 uuid; d uuid; d2 uuid; r record; aid uuid; pid uuid; c uuid;
begin
  insert into tenants(name, slug) values ('0408 test', 'customer-0408') returning id into t;
  insert into tenants(name, slug) values ('0408 other', 'customer-0408-other') returning id into t2;
  insert into branches(tenant_id, name, code) values (t, '0408 Bandra', 'B0408') returning id into b;
  insert into branches(tenant_id, name, code) values (t2, '0408 Other', 'O0408') returning id into b2;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'CRM', 'C0408') returning id into d;
  insert into departments(tenant_id, branch_id, name, code) values (t2, b2, 'CRM', 'C0408O') returning id into d2;
  for r in select * from (values ('crm', t, b, d, 'crm'), ('staff', t, b, d, 'staff'), ('other_crm', t2, b2, d2, 'crm')) v(kind, tn, br, dept, role) loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'cl-' || r.kind || '@example.invalid', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (r.tn, aid, r.br, r.dept, 'CL ' || r.kind, 'CL-' || upper(r.kind), 'cl-' || r.kind || '@example.invalid', r.role::user_role, 'active', 'active', true)
    returning id into pid;
    insert into fx values (r.kind || '_auth', aid);
  end loop;

  -- Asha: Mumbai, Jain, reached 5 days ago, follow-up due yesterday.
  c := customer.find_or_create_client(t, '9820003001', 'Asha Jain', 'runo', now() - interval '5 days');
  perform customer.set_field_value(c, 'city', 'Mumbai', 'runo', now() - interval '5 days');
  perform customer.set_field_value(c, 'community', 'JAIN', 'runo', now() - interval '5 days');
  perform customer.create_follow_up(c, 'hot', now() - interval '1 day',
    customer.record_interaction(c, jsonb_build_object('occurred_at', now() - interval '5 days', 'channel', 'call', 'direction', 'outbound', 'purpose', 'enquiry', 'source', 'runo')));
  insert into fx values ('asha', c);
  -- Bina: Pune, reached 200 days ago.
  c := customer.find_or_create_client(t, '9820003002', 'Bina Shah', 'instagram_fms', now() - interval '200 days');
  perform customer.set_field_value(c, 'city', 'Pune', 'runo', now() - interval '200 days');
  perform customer.record_interaction(c, jsonb_build_object('occurred_at', now() - interval '200 days', 'channel', 'instagram', 'direction', 'inbound', 'purpose', 'enquiry', 'source', 'instagram_fms'));
  -- Chetan: Mumbai, only a missed call (never reached).
  c := customer.find_or_create_client(t, '9820003003', 'Chetan Rao', 'runo', now() - interval '2 days');
  perform customer.set_field_value(c, 'city', 'Mumbai', 'runo', now() - interval '2 days');
  perform customer.record_interaction(c, jsonb_build_object('occurred_at', now() - interval '2 days', 'channel', 'call', 'direction', 'outbound', 'purpose', 'offer', 'source', 'runo', 'successful', false));
  -- Another company.
  perform customer.find_or_create_client(t2, '9820003004', 'Asha Other', 'runo', now());
end $$;
create temp table fx_code as select client_code as code from customer.clients where id = (select id from fx where label = 'asha');
grant select on fx_code to authenticated;
create function pg_temp.act_as(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce((select id::text from fx where label = p || '_auth'), ''), true);
$$;
create function pg_temp.names(p jsonb) returns text language sql as $$
  select string_agg(r ->> 'primary_name', ',' order by ord) from jsonb_array_elements(p -> 'rows') with ordinality t(r, ord) $$;

select is(has_function_privilege('anon', 'public.customer_list(jsonb,integer,integer)', 'execute')
       or has_function_privilege('anon', 'public.customer_list_filters()', 'execute'), false, 'anon cannot read the list');

set local role authenticated;
select pg_temp.act_as('crm');
select is((customer_list() ->> 'total') || '|' || pg_temp.names(customer_list()), '3|Asha Jain,Bina Shah,Chetan Rao',
  'the list shows this company''s clients, most recently reached first, never-reached last');
select is(pg_temp.names(customer_list('{"sort": "least_recent"}')), 'Chetan Rao,Bina Shah,Asha Jain', 'least recently reached first puts the never-reached on top');
select is(pg_temp.names(customer_list('{"cities": ["Mumbai"], "sort": "name"}')), 'Asha Jain,Chetan Rao', 'filter by city');
select is(pg_temp.names(customer_list('{"communities": ["JAIN"]}')), 'Asha Jain', 'filter by community');
select is(pg_temp.names(customer_list('{"not_contacted_days": 90, "sort": "name"}')), 'Bina Shah,Chetan Rao', 'not reached in 90 days includes the never-reached');
select is(pg_temp.names(customer_list('{"contacted_within_days": 30}')), 'Asha Jain', 'reached in the last 30 days');
select is(pg_temp.names(customer_list('{"follow_up_due": true}')), 'Asha Jain', 'follow-up due');
select is(pg_temp.names(customer_list('{"first_sources": ["instagram_fms"]}')), 'Bina Shah', 'filter by first source');
select is(pg_temp.names(customer_list('{"q": "98200 03003"}')) || '|' || pg_temp.names(customer_list('{"q": "bin"}'))
          || '|' || pg_temp.names(customer_list(jsonb_build_object('q', (select code from fx_code)))),
  'Chetan Rao|Bina Shah|Asha Jain', 'search by phone, name or MKC code');
select is((customer_list('{"sort": "name"}', 2, 2) ->> 'total') || '|' || pg_temp.names(customer_list('{"sort": "name"}', 2, 2)), '3|Chetan Rao', 'paging keeps the full total');
select is((customer_list('{"cities": ["Mumbai"], "sort": "name"}') -> 'rows' -> 0 ->> 'primary_phone') || '|' || ((customer_list('{"cities": ["Mumbai"], "sort": "name"}') -> 'rows' -> 0 ->> 'next_follow_up_at') is not null),
  '919820003001|true', 'a row carries the phone and the next follow-up');
select is((customer_list_filters() ->> 'total') || '|' || (customer_list_filters() -> 'cities' -> 0 ->> 'value') || ':' || (customer_list_filters() -> 'cities' -> 0 ->> 'count')
          || '|' || (customer_list_filters() -> 'segments' ->> 'lead'), '3|Mumbai:2|3', 'filter values come with counts');
select pg_temp.act_as('other_crm');
select is(pg_temp.names(customer_list()), 'Asha Other', 'another company sees only its own clients');
select pg_temp.act_as('staff');
select throws_ok($$select customer_list()$$, '42501', 'Section access denied', 'a user without CRM access is refused');
reset role;

select * from finish();
rollback;
