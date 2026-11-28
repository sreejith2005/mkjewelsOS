-- 0453: same name with different numbers, and one number with different names.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid; b uuid; d uuid; v_auth uuid; v_id uuid; p record;
begin
  insert into tenants(name, slug) values ('0453 test', 'customer-0453') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK983') returning id into m;
  insert into branches(tenant_id, name, code) values (t, '0453 Store', 'S0453') returning id into b;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'Sales', 'D0453') returning id into d;
  insert into fx values ('tenant', t), ('mumbai', m);
  for p in select * from (values ('boss', 'super_admin'), ('staff', 'staff')) as x(name, role) loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p.name || '-0453@test.local', 'x', now(), now())
    returning id into v_auth;
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (t, v_auth, b, d, '0453 ' || p.name, 'E0453-' || p.name, p.name || '-0453@test.local', p.role::user_role, 'active', 'active', true) returning id into v_id;
    insert into fx values (p.name, v_auth), (p.name || '_profile', v_id);
  end loop;
end $$;
update customer.source_tables set franchise_code = 'MK983' where source in ('master_sheet', 'software_account_list');

create function pg_temp.sign_in(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from fx where label = p_who), 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', (select id from fx where label = p_who)::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true) $$;
create function pg_temp.owner(p_phone text) returns uuid language sql as $$
  select p.client_id from customer.client_phones p
   where p.tenant_id = (select id from fx where label = 'tenant') and p.phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.row(p_key text, p_phone text, p_name text, p_row integer, p_city text default null) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_key, 'sheet_row', p_row,
    'payload', jsonb_strip_nulls(jsonb_build_object('CONTACT NUMBER', p_phone, 'CLIENT NAME', p_name, 'CITY', p_city))) $$;
update customer.source_tables set franchise_code = 'MK983' where source in ('master_sheet', 'master_wrong_number');

select ok(customer.names_clearly_differ('Priya Shah', 'Rohan Shah'), 'different first names differ');
select ok(not customer.names_clearly_differ('Priya', 'Priya Shah'), 'a longer form of the name does not');
select ok(not customer.names_clearly_differ('P Shah', 'Priya Shah'), 'an initial does not');

-- Two "Meera Kapoor" with their own numbers; one number used by Asha and by Kiran.
select customer_ingest_store('master_sheet', jsonb_build_array(
  pg_temp.row('a', '9820053001', 'Meera Kapoor', 4), pg_temp.row('b', '9820053002', 'Meera Kapoor', 5),
  pg_temp.row('c', '9820053003', 'Asha Mehta', 6, 'Pune'), pg_temp.row('d', '9820053003', 'Kiran Mehta', 7, 'Surat')), '{"next_row": 8}');
select customer_ingest_apply('master_sheet', 100);
update customer.client_names set last_seen_at = now() - interval '1 day' where name_key = 'KIRAN MEHTA';
select customer.refresh_primary_name(pg_temp.owner('9820053003'));
select is(public.customer_refresh_review_checks() -> (select id::text from fx where label = 'tenant'), '{"same_name": 1, "shared_phone": 1}'::jsonb,
  'one same-name pair and one shared number found');
select is(public.customer_refresh_review_checks() -> (select id::text from fx where label = 'tenant'), '{"same_name": 0, "shared_phone": 0}'::jsonb,
  '... and not asked twice');

select pg_temp.sign_in('staff');
select throws_ok('select public.customer_review_queue(''same_name'')', '42501', null, 'staff without the permission cannot see them');
select pg_temp.sign_in('boss');
select is((public.customer_review_queue('same_name') ->> 'total')::integer, 1, 'the same-name review lists the pair');
select is((public.customer_review_queue('shared_phone') -> 'items' -> 0 ->> 'other_name'), 'Kiran Mehta', 'the shared-number review names the other name');

-- Same name: different people are never asked again.
select is(public.customer_review_decide((select id from customer.identity_review where reason = 'same_name_check' and status = 'open'), false) ->> 'result',
  'kept_separate', 'different people stay apart');
select is(public.customer_refresh_review_checks() -> (select id::text from fx where label = 'tenant') ->> 'same_name', '0', '... and are not asked again');

-- Shared number: Kiran is split off with her row.
select is(public.customer_review_decide((select id from customer.identity_review where reason = 'shared_phone_check' and status = 'open'), false) ->> 'result',
  'split', 'different people: the name is split off');
create temp table kiran as select client_id as id from customer.client_names where name_key = 'KIRAN MEHTA';
select isnt((select id from kiran), pg_temp.owner('9820053003'), '... as its own customer');
select is((select status from customer.ingest_rows where source = 'master_sheet' and row_key = 'd'), 'pending', '... and her sheet row is read again');
select customer_ingest_apply('master_sheet', 100);
select is((select client_id from customer.ingest_rows where source = 'master_sheet' and row_key = 'd'), (select id from kiran), 'her row now belongs to her');
select is((select city from customer.clients where id = (select id from kiran)), 'Surat', '... with her answers');
select is((select city from customer.clients where id = pg_temp.owner('9820053003')), 'Pune', 'and Asha keeps hers and the number');

select * from finish();
rollback;
