-- 0202: the CRM department (code CRM) is the CRM roster; Role CRM still counts; moving a
-- person or changing a department's code enqueues them; 0203: department members are on
-- every branch roster. Synthetic fixtures only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(not has_function_privilege('authenticated', 'crm_sync.department_code_changed()', 'execute'), 'the trigger function is internal');

create temporary table dept_fixture(name text primary key, id uuid) on commit drop;
do $$
declare v_tenant uuid; v_branch uuid; v_crm uuid; v_sales uuid; v_auth uuid; v_id uuid; v_person record;
begin
  insert into tenants(name, slug) values ('Dept roster tenant', 'crm-dept-roster-tenant') returning id into v_tenant;
  insert into branches(tenant_id, name, code) values (v_tenant, 'Dept Main', 'DPM') returning id into v_branch;
  insert into departments(tenant_id, name, code) values (v_tenant, 'CRM', 'crm ') returning id into v_crm;
  insert into departments(tenant_id, name, code) values (v_tenant, 'Sales', 'DPS') returning id into v_sales;
  for v_person in select * from (values ('crm_staff', 'staff', v_crm), ('sales_staff', 'staff', v_sales),
                                        ('crm_role', 'crm', v_sales)) as p(name, role, dept) loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'dept-' || v_person.name || '@test.local', 'x', now(), now()) returning id into v_auth;
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email,
      user_role, working_status, account_status, is_login_enabled)
    values (v_tenant, v_auth, v_branch, v_person.dept, 'Dept ' || v_person.name, 'DPT-' || v_person.name,
      'dept-' || v_person.name || '@test.local', v_person.role::user_role, 'active', 'active', true) returning id into v_id;
    insert into dept_fixture values (v_person.name, v_id);
  end loop;
  insert into dept_fixture values ('crm_dept', v_crm), ('sales_dept', v_sales);
end $$;

create function pg_temp.pid(p_name text) returns uuid language sql as $$ select id from dept_fixture where name = p_name $$;
create function pg_temp.on_roster(p_name text) returns boolean language sql as $$
  select (crm_sync.staff_roster_fields(pg_temp.pid(p_name)) ->> 'crm_roster')::boolean $$;
create function pg_temp.open_events(p_name text) returns integer language sql as $$
  select count(*)::integer from crm_sync.outbox o
  where o.aggregate_id = pg_temp.pid(p_name) and o.delivered_at is null and o.dead_at is null $$;
create function pg_temp.deliver_all() returns void language sql as $$
  update crm_sync.outbox set delivered_at = now() where delivered_at is null and dead_at is null $$;

select ok(pg_temp.on_roster('crm_staff'), 'a Staff-role member of the CRM department is on the roster (code matched case-insensitively)');
select ok(not pg_temp.on_roster('sales_staff'), 'a member of another department is not');
select ok(pg_temp.on_roster('crm_role'), 'Role CRM still puts a person on the roster');
select ok((crm_sync.staff_roster_fields(pg_temp.pid('crm_staff')) ->> 'crm_roster_all_branches')::boolean,
  '0203: a CRM-department member is on every branch roster');
select ok(not (crm_sync.staff_roster_fields(pg_temp.pid('crm_role')) ->> 'crm_roster_all_branches')::boolean,
  '0203: a Role-CRM person outside the department stays on their own branch');
select ok(not (crm_sync.staff_roster_fields(pg_temp.pid('sales_staff')) ->> 'crm_roster_all_branches')::boolean,
  '0203: nobody else is');

select pg_temp.deliver_all();
update user_profiles set department_id = pg_temp.pid('crm_dept') where id = pg_temp.pid('sales_staff');
select is(pg_temp.open_events('sales_staff'), 1, 'moving a person into the CRM department enqueues them');
select ok(pg_temp.on_roster('sales_staff'), 'and puts them on the roster');

select pg_temp.deliver_all();
update departments set code = 'CRMX' where id = pg_temp.pid('crm_dept');
select is(pg_temp.open_events('crm_staff'), 1, 'changing the department code enqueues its members');
select ok(not pg_temp.on_roster('crm_staff'), 'a department no longer coded CRM is not the roster');

select pg_temp.deliver_all();
update departments set name = 'CRM TEAM' where id = pg_temp.pid('crm_dept');
select is(pg_temp.open_events('crm_staff'), 0, 'a rename alone does not change the roster and sends nothing');

select ok(not exists (select 1 from user_profiles p
  where not exists (select 1 from crm_sync.outbox o where o.aggregate_id = p.id)), 'every profile has been enqueued');

select * from finish();
rollback;
