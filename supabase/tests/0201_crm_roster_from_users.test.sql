-- 0201: the delivered CRM staff snapshot carries the CRM roster flag (JewelOS role CRM)
-- and the next 31 days of JewelOS Availability; Availability and weekly-off changes
-- enqueue the person. Synthetic fixtures only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(not has_function_privilege('authenticated', 'crm_sync.user_availability_changed()', 'execute'), 'the trigger function is internal');
select ok(not has_function_privilege('service_role', 'crm_sync.staff_roster_fields(uuid)', 'execute'), 'the roster fields are reached only through the worker RPCs');

-- ---------------------------------------------------------------------------
-- Fixtures: one tenant and branch; a crm user, a staff member, a manager
-- ---------------------------------------------------------------------------
create temporary table roster_fixture(name text primary key, id uuid) on commit drop;
do $$
declare v_tenant uuid; v_branch uuid; v_department uuid; v_auth uuid; v_id uuid; v_person record;
begin
  insert into tenants(name, slug) values ('Roster test tenant', 'crm-roster-test-tenant') returning id into v_tenant;
  insert into branches(tenant_id, name, code) values (v_tenant, 'Roster Main', 'RSM') returning id into v_branch;
  insert into departments(tenant_id, branch_id, name, code) values (v_tenant, v_branch, 'Sales', 'RSD') returning id into v_department;
  for v_person in select * from (values ('crm_user', 'crm'), ('staff', 'staff'), ('manager', 'manager')) as p(name, role) loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'roster-' || v_person.name || '@test.local', 'x', now(), now()) returning id into v_auth;
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email,
      user_role, working_status, account_status, is_login_enabled)
    values (v_tenant, v_auth, v_branch, v_department, 'Roster ' || v_person.name, 'RST-' || v_person.name,
      'roster-' || v_person.name || '@test.local', v_person.role::user_role, 'active', 'active', true) returning id into v_id;
    insert into roster_fixture values (v_person.name, v_id);
  end loop;
  insert into roster_fixture values ('tenant', v_tenant);
end $$;

create function pg_temp.pid(p_name text) returns uuid language sql as $$ select id from roster_fixture where name = p_name $$;
create function pg_temp.snap(p_name text) returns jsonb language sql as $$
  select crm_sync.staff_snapshot(pg_temp.pid(p_name)) || crm_sync.staff_roster_fields(pg_temp.pid(p_name)) $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
-- Unavailable dates as offsets from today.
create function pg_temp.offsets(p_name text) returns int[] language sql as $$
  select coalesce(array_agg(d.value::date - pg_temp.today() order by d.value::date), '{}')
  from jsonb_array_elements_text(pg_temp.snap(p_name) -> 'unavailable_dates') d;
$$;
create function pg_temp.open_events(p_name text) returns integer language sql as $$
  select count(*)::integer from crm_sync.outbox o
  where o.aggregate_id = pg_temp.pid(p_name) and o.delivered_at is null and o.dead_at is null;
$$;
create function pg_temp.deliver_all() returns void language sql as $$
  update crm_sync.outbox set delivered_at = now() where delivered_at is null and dead_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Snapshot fields
-- ---------------------------------------------------------------------------
select ok((pg_temp.snap('crm_user') ->> 'crm_roster')::boolean, 'a JewelOS CRM-role person is on the CRM roster');
select ok(not (pg_temp.snap('staff') ->> 'crm_roster')::boolean, 'a Staff-role person is not');
select ok(not (pg_temp.snap('manager') ->> 'crm_roster')::boolean, 'a manager is not');
select is((pg_temp.snap('crm_user') ->> 'availability_from')::date, pg_temp.today(), 'the window starts today (IST)');
select is((pg_temp.snap('crm_user') ->> 'availability_to')::date, pg_temp.today() + 30, 'and covers 31 days');
select is(pg_temp.offsets('crm_user'), '{}'::int[], 'no absence and no weekly off: available every day');

insert into user_access_profiles(user_profile_id, tenant_id, dashboard_authority)
values (pg_temp.pid('crm_user'), (select id from roster_fixture where name = 'tenant'), 'staff');
select ok((pg_temp.snap('crm_user') ->> 'crm_roster')::boolean, 'a dashboard authority does not take a CRM-role person off the roster');
delete from user_access_profiles where user_profile_id = pg_temp.pid('crm_user');

-- ---------------------------------------------------------------------------
-- Availability: absences (manual or approved leave) and weekly offs
-- ---------------------------------------------------------------------------
select pg_temp.deliver_all();
insert into user_availability(tenant_id, user_profile_id, date, status, reason)
values ((select id from roster_fixture where name = 'tenant'), pg_temp.pid('crm_user'), pg_temp.today(), 'absent', 'test'),
       ((select id from roster_fixture where name = 'tenant'), pg_temp.pid('crm_user'), pg_temp.today() + 3, 'half_day', 'test'),
       ((select id from roster_fixture where name = 'tenant'), pg_temp.pid('crm_user'), pg_temp.today() + 40, 'absent', 'test'),
       ((select id from roster_fixture where name = 'tenant'), pg_temp.pid('crm_user'), pg_temp.today() - 1, 'absent', 'test');
select is(pg_temp.open_events('crm_user'), 1, 'an Availability entry enqueues the person');
select is(pg_temp.offsets('crm_user'), '{0}'::int[],
  'an absence today is sent; a half day counts as available; dates outside the window are not sent');

select pg_temp.deliver_all();
delete from user_availability where user_profile_id = pg_temp.pid('crm_user') and date = pg_temp.today();
select is(pg_temp.open_events('crm_user'), 1, 'removing an absence enqueues the person');
select is(pg_temp.offsets('crm_user'), '{}'::int[], 'and the person is available again');

select pg_temp.deliver_all();
update user_profiles set week_off = array[btrim(to_char(pg_temp.today() + 1, 'Day'))] where id = pg_temp.pid('crm_user');
select is(pg_temp.open_events('crm_user'), 1, 'a weekly-off change enqueues the person');
select is(pg_temp.offsets('crm_user'), '{1,8,15,22,29}'::int[], 'the weekly off is unavailable each week');

select pg_temp.deliver_all();
update user_profiles set user_role = 'staff' where id = pg_temp.pid('crm_user');
select is(pg_temp.open_events('crm_user'), 1, 'a role change enqueues the person');
select ok(not (pg_temp.snap('crm_user') ->> 'crm_roster')::boolean, 'and takes them off the CRM roster');

-- Both delivery paths carry the roster fields.
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok((select bool_and(s ? 'crm_roster' and s ? 'unavailable_dates') from jsonb_array_elements(public.crm_sync_staff_roster()) s
  where s ->> 'jewelos_user_id' in (select id::text from roster_fixture where name <> 'tenant')), 'the daily roster carries the roster fields');
update crm_sync.outbox set next_attempt_at = now() where delivered_at is null and dead_at is null;
select ok((select bool_and(snapshot ? 'crm_roster' and snapshot ? 'availability_from') from public.crm_sync_claim_staff_events(200)),
  'claimed events carry the roster fields');

-- The seed in 0201 sent everyone once (checked against the migration, not this fixture).
select ok(not exists (select 1 from user_profiles p
  where not exists (select 1 from crm_sync.outbox o where o.aggregate_id = p.id)), 'every profile has been enqueued at least once');

select * from finish();
rollback;
