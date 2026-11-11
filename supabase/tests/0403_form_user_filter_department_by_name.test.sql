-- 0403: a Department rule on a Users question matches the department name in every store.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; t2 uuid; b uuid; b2 uuid; sales_b uuid; sales_a uuid; crm_b uuid; acc_b uuid; sales_other uuid; r record; aid uuid; pid uuid;
begin
  insert into tenants(name, slug) values ('0403 test', 'dept-name-0403') returning id into t;
  insert into tenants(name, slug) values ('0403 other', 'dept-name-0403-other') returning id into t2;
  insert into branches(tenant_id, name, code) values (t, '0403 Bandra', 'B0403') returning id into b;
  insert into branches(tenant_id, name, code) values (t, '0403 Andheri', 'A0403') returning id into b2;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'Sales', 'S0403B') returning id into sales_b;
  insert into departments(tenant_id, branch_id, name, code) values (t, b2, ' sales ', 'S0403A') returning id into sales_a;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'CRM', 'C0403B') returning id into crm_b;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'Accounts', 'X0403B') returning id into acc_b;
  insert into departments(tenant_id, branch_id, name, code) values (t2, null, 'Sales', 'S0403O') returning id into sales_other;
  insert into fx values ('sales_b', sales_b), ('crm_b', crm_b), ('sales_other', sales_other);
  for r in select * from (values ('andheri_sales', b2, sales_a), ('bandra_crm', b, crm_b), ('bandra_accounts', b, acc_b)) v(kind, br, dept) loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'dn-' || r.kind || '@example.in', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (t, aid, r.br, r.dept, 'DN ' || r.kind, 'DN-' || upper(r.kind), 'dn-' || r.kind || '@example.in', 'staff', 'active', 'active', true)
    returning id into pid;
    insert into fx values (r.kind, pid);
  end loop;
end $$;

create function pg_temp.id(p text) returns uuid language sql as $$ select id from fx where label = p $$;
create function pg_temp.rule(p_op text, variadic p_ids uuid[]) returns jsonb language sql as $$
  select jsonb_build_object('match', 'all', 'rules', jsonb_build_array(jsonb_build_object('attribute', 'department', 'operator', p_op,
    'values', (select jsonb_agg(i::text) from unnest(p_ids) i))));
$$;

select ok(form_user_matches_filter(pg_temp.rule('in', pg_temp.id('sales_b'), pg_temp.id('crm_b')), pg_temp.id('andheri_sales')),
  'Sales chosen from Bandra matches a Sales employee at Andheri (name, trimmed, any case)');
select ok(form_user_matches_filter(pg_temp.rule('in', pg_temp.id('sales_b'), pg_temp.id('crm_b')), pg_temp.id('bandra_crm')),
  'and a CRM employee');
select ok(not form_user_matches_filter(pg_temp.rule('in', pg_temp.id('sales_b'), pg_temp.id('crm_b')), pg_temp.id('bandra_accounts')),
  'but not an Accounts employee');
select ok(form_user_matches_filter(pg_temp.rule('not_in', pg_temp.id('sales_b')), pg_temp.id('bandra_accounts'))
  and not form_user_matches_filter(pg_temp.rule('not_in', pg_temp.id('sales_b')), pg_temp.id('andheri_sales')),
  'Department is not in Sales excludes Sales in every store');
select ok(not form_user_matches_filter(pg_temp.rule('equals', pg_temp.id('sales_other')), pg_temp.id('andheri_sales')),
  'another company''s department of the same name does not count');
select is(has_function_privilege('authenticated', 'form_user_matches_filter(jsonb, uuid)', 'execute'), false,
  'the matcher stays server-only');

select * from finish();
rollback;
