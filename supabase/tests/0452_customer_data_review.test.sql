-- 0452: a set-aside customer can be moved into the main list by someone allowed to.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid; b uuid; d uuid; v_auth uuid; v_id uuid; p record;
begin
  insert into tenants(name, slug) values ('0452 test', 'customer-0452') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK982') returning id into m;
  insert into branches(tenant_id, name, code) values (t, '0452 Store', 'S0452') returning id into b;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'Sales', 'D0452') returning id into d;
  insert into fx values ('tenant', t), ('mumbai', m);
  for p in select * from (values ('boss', 'super_admin'), ('staff', 'staff')) as x(name, role) loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p.name || '-0452@test.local', 'x', now(), now())
    returning id into v_auth;
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (t, v_auth, b, d, '0452 ' || p.name, 'E0452-' || p.name, p.name || '-0452@test.local', p.role::user_role, 'active', 'active', true) returning id into v_id;
    insert into fx values (p.name, v_auth), (p.name || '_profile', v_id);
  end loop;
end $$;
update customer.source_tables set franchise_code = 'MK982' where source in ('master_sheet', 'software_account_list');

create function pg_temp.sign_in(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from fx where label = p_who), 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', (select id from fx where label = p_who)::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true) $$;
create function pg_temp.client(p_phone text) returns customer.clients language sql as $$
  select c.* from customer.clients c join customer.client_phones ph on ph.client_id = c.id
   where ph.tenant_id = (select id from fx where label = 'tenant') and ph.phone = customer.normalize_phone(p_phone) $$;
update customer.source_tables set franchise_code = 'MK982' where source in ('master_sheet', 'master_wrong_number');
select customer_ingest_store('master_wrong_number', jsonb_build_array(jsonb_build_object('row_key', '9820052001', 'sheet_row', 2,
  'payload', '{"CONTACT NUMBER": "9820052001", "CLIENT NAME": "Synthetic", "WRONG NUMBER REASON": "wrong number"}'::jsonb)), '{"next_row": 3}');
select customer_ingest_apply('master_wrong_number', 100);
select customer_ingest_store('master_sheet', jsonb_build_array(jsonb_build_object('row_key', '9820052002', 'sheet_row', 4,
  'payload', '{"CONTACT NUMBER": "9820052002", "CLIENT NAME": "Normal"}'::jsonb)), '{"next_row": 5}');
select customer_ingest_apply('master_sheet', 100);
select is((pg_temp.client('9820052001')).data_problems, array['wrong_number'], 'set aside as a wrong number');

select pg_temp.sign_in('staff');
select throws_ok(format('select public.customer_set_data_review(%L, true)', (pg_temp.client('9820052001')).client_code), '42501', null,
  'staff without the permission cannot move a customer');

select pg_temp.sign_in('boss');
select throws_ok(format('select public.customer_set_data_review(%L, true)', (pg_temp.client('9820052002')).client_code), '22023', null,
  'a customer with no data problem cannot be moved');
select is((public.customer_list('{}'::jsonb) ->> 'total')::integer, 1, 'the main list leaves the wrong number out');
select is((public.customer_list('{"data_problems": ["wrong_number"]}'::jsonb) ->> 'total')::integer, 1, '... the filter shows it');
select is(public.customer_set_data_review((pg_temp.client('9820052001')).client_code, true) ->> 'data_review', 'main', 'moved into the main list');
select is((public.customer_list('{}'::jsonb) ->> 'total')::integer, 2, 'once moved it is in the main list');
select is((pg_temp.client('9820052001')).data_problems, array['wrong_number'], '... the problem is still recorded');
select is((select count(*) from audit_logs where action = 'customer_data_reviewed' and record_id = (pg_temp.client('9820052001')).id), 1::bigint, '... and audited');
select is((public.customer_get_client_page((pg_temp.client('9820052001')).client_code) ->> 'data_review'), 'main', 'the customer page says so');
select is(public.customer_set_data_review((pg_temp.client('9820052001')).client_code, false) ->> 'data_review', null, 'and it can be set aside again');

select * from finish();
rollback;
