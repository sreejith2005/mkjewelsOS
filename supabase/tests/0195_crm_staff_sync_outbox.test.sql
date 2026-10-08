-- 0195: CRM roster sync outbox (JewelOS -> CRM project).
-- Every access-relevant change enqueues one coalesced event in the same transaction; the
-- worker receives a snapshot computed at claim time; delivery, requeue, backoff and dead
-- events; service-role-only worker contract; admin-only health. Synthetic fixtures only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select ok(not has_schema_privilege('authenticated', 'crm_sync', 'usage'), 'authenticated cannot use schema crm_sync');
select ok(not has_schema_privilege('anon', 'crm_sync', 'usage'), 'anon cannot use schema crm_sync');
select ok(not has_table_privilege('service_role', 'crm_sync.outbox', 'select'), 'the outbox is reached only through the worker RPCs');
select ok(not has_function_privilege('authenticated', 'public.crm_sync_claim_staff_events(integer)', 'execute'), 'clients cannot claim sync events');
select ok(not has_function_privilege('authenticated', 'public.crm_sync_finish_staff_event(bigint,boolean,text)', 'execute'), 'clients cannot finish sync events');
select ok(not has_function_privilege('authenticated', 'public.crm_sync_staff_roster()', 'execute'), 'clients cannot read the staff roster snapshot');
select ok(not has_function_privilege('anon', 'public.crm_sync_health()', 'execute'), 'anon cannot read sync health');
select ok(has_function_privilege('service_role', 'public.crm_sync_claim_staff_events(integer)', 'execute'), 'the worker can claim');
select function_owner_is('public', 'crm_sync_claim_staff_events', array['integer'], 'postgres', 'claim is server owned');

-- ---------------------------------------------------------------------------
-- Fixtures: one tenant, two branches; a crm user, a manager, a staff member, an admin
-- ---------------------------------------------------------------------------
create temporary table sync_fixture(name text primary key, id uuid) on commit drop;
grant select on sync_fixture to authenticated, service_role;
do $$
declare v_tenant uuid; v_branch uuid; v_branch2 uuid; v_department uuid; v_auth uuid; v_id uuid; v_person record;
begin
  insert into tenants(name, slug) values ('Sync test tenant', 'crm-sync-test-tenant') returning id into v_tenant;
  insert into branches(tenant_id, name, code) values (v_tenant, 'Sync Main', 'SYM') returning id into v_branch;
  insert into branches(tenant_id, name, code) values (v_tenant, 'Sync Second', 'SYS') returning id into v_branch2;
  insert into departments(tenant_id, branch_id, name, code) values (v_tenant, v_branch, 'Sales', 'SYD') returning id into v_department;
  for v_person in select * from (values ('crm_user', 'crm'), ('manager', 'manager'), ('staff', 'staff'), ('admin', 'admin')) as p(name, role) loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'sync-' || v_person.name || '@test.local', 'x', now(), now()) returning id into v_auth;
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email,
      user_role, working_status, account_status, is_login_enabled)
    values (v_tenant, v_auth, v_branch, v_department, 'Sync ' || v_person.name, 'SYN-' || v_person.name,
      'Sync-' || v_person.name || '@Test.Local ', v_person.role::user_role, 'active', 'active', true) returning id into v_id;
    insert into sync_fixture values (v_person.name, v_id), (v_person.name || '_auth', v_auth);
  end loop;
  insert into sync_fixture values ('tenant', v_tenant), ('branch2', v_branch2);
end $$;

create function pg_temp.open_events(p_name text) returns integer language sql as $$
  select count(*)::integer from crm_sync.outbox o
  where o.aggregate_id = (select id from sync_fixture where name = p_name) and o.delivered_at is null and o.dead_at is null;
$$;
create function pg_temp.event_of(p_name text) returns crm_sync.outbox language sql security definer as $$
  select o.* from crm_sync.outbox o
  where o.aggregate_id = (select id from sync_fixture where name = p_name) order by o.id desc limit 1;
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
grant execute on function pg_temp.as_service() to service_role;
grant execute on function pg_temp.event_of(text) to service_role;

-- ---------------------------------------------------------------------------
-- Enqueue and coalescing
-- ---------------------------------------------------------------------------
select is(pg_temp.open_events('crm_user'), 1, 'a new profile enqueues one event');

update user_profiles set personal_mobile = '9000000001' where id = (select id from sync_fixture where name = 'crm_user');
select is(pg_temp.open_events('crm_user'), 1, 'an unrelated column change adds no event');

update user_profiles set employee_name = 'Sync crm renamed' where id = (select id from sync_fixture where name = 'crm_user');
update user_profiles set branch_id = (select id from sync_fixture where name = 'branch2') where id = (select id from sync_fixture where name = 'crm_user');
select is(pg_temp.open_events('crm_user'), 1, 'further changes coalesce into the one open event');

-- ---------------------------------------------------------------------------
-- Claim: snapshot computed now
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
create temporary table claimed on commit drop as select * from public.crm_sync_claim_staff_events(200);
reset role;

select is((select count(*)::integer from claimed where aggregate_id in (select id from sync_fixture)), 4, 'each fixture person is claimed once');
select is((select snapshot ->> 'name' from claimed where aggregate_id = (select id from sync_fixture where name = 'crm_user')),
  'Sync crm renamed', 'the snapshot carries the current name');
select is((select snapshot ->> 'email' from claimed where aggregate_id = (select id from sync_fixture where name = 'crm_user')),
  'sync-crm_user@test.local', 'the login email is normalized');
select is((select (snapshot ->> 'jewelos_branch_id')::uuid from claimed where aggregate_id = (select id from sync_fixture where name = 'crm_user')),
  (select id from sync_fixture where name = 'branch2'), 'the snapshot carries the current branch');
select is((select snapshot ->> 'crm_role' from claimed where aggregate_id = (select id from sync_fixture where name = 'crm_user')),
  'salesperson', 'crm role maps to salesperson');
select is((select snapshot ->> 'crm_role' from claimed where aggregate_id = (select id from sync_fixture where name = 'manager')),
  'branch_manager', 'manager maps to branch_manager');
select is((select snapshot ->> 'crm_role' from claimed where aggregate_id = (select id from sync_fixture where name = 'admin')),
  'super_admin', 'admin maps to super_admin');
select ok((select (snapshot ->> 'eligible')::boolean from claimed where aggregate_id = (select id from sync_fixture where name = 'crm_user')),
  'an active crm user with crm.view is eligible');
select ok(not (select (snapshot ->> 'eligible')::boolean from claimed where aggregate_id = (select id from sync_fixture where name = 'staff')),
  'staff without crm.view is not eligible');
select ok((select snapshot ? 'snapshot_at' from claimed limit 1), 'a snapshot carries its time');
select ok(not exists (select 1 from claimed c, jsonb_object_keys(c.snapshot) k where k not in
  ('jewelos_user_id', 'present', 'tenant_id', 'name', 'email', 'jewelos_role', 'crm_role', 'jewelos_branch_id', 'eligible',
   'crm_roster', 'crm_roster_all_branches', 'availability_from', 'availability_to', 'unavailable_dates', 'snapshot_at')),
  'snapshots carry only the documented staff fields');

set local role service_role;
select pg_temp.as_service();
select is((select count(*)::integer from public.crm_sync_claim_staff_events(200) where aggregate_id in (select id from sync_fixture)), 0,
  'a claimed event is leased and not claimed twice');
reset role;

-- ---------------------------------------------------------------------------
-- Finish: delivered, requeued, retry, dead
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
select is(public.crm_sync_finish_staff_event((pg_temp.event_of('manager')).id, true), 'delivered', 'a delivered event is closed');
select is(public.crm_sync_finish_staff_event((pg_temp.event_of('manager')).id, true), 'ignored', 'finishing twice is ignored');
reset role;
select is(pg_temp.open_events('manager'), 0, 'no open event after delivery');

-- A change while in flight keeps the event open.
update user_profiles set employee_name = 'Sync crm in flight' where id = (select id from sync_fixture where name = 'crm_user');
set local role service_role;
select pg_temp.as_service();
select is(public.crm_sync_finish_staff_event((pg_temp.event_of('crm_user')).id, true), 'requeued', 'a change during delivery requeues the event');
reset role;
select is(pg_temp.open_events('crm_user'), 1, 'the requeued event stays open');
select ok((pg_temp.event_of('crm_user')).next_attempt_at <= now(), 'a requeued event is due at once');

set local role service_role;
select pg_temp.as_service();
select is(public.crm_sync_finish_staff_event((pg_temp.event_of('staff')).id, false, 'Response body with 9000000001'), 'retry', 'a failure is retried');
reset role;
select is((pg_temp.event_of('staff')).last_error, 'error', 'a free-text error is not stored');
select ok((pg_temp.event_of('staff')).next_attempt_at > now(), 'a failed event backs off');

update crm_sync.outbox set attempts = 10 where id = (pg_temp.event_of('staff')).id;
set local role service_role;
select pg_temp.as_service();
select is(public.crm_sync_finish_staff_event((pg_temp.event_of('staff')).id, false, 'http_502'), 'dead', 'the tenth failure makes the event dead');
reset role;
select is((select count(*)::integer from audit_logs where action = 'crm_sync.event_dead' and record_id = (select id from sync_fixture where name = 'staff')), 1,
  'a dead event is audited');
update user_profiles set user_role = 'crm' where id = (select id from sync_fixture where name = 'staff');
select is(pg_temp.open_events('staff'), 1, 'after a dead event, a new change opens a new event');

-- ---------------------------------------------------------------------------
-- Permission and authority changes
-- ---------------------------------------------------------------------------
update crm_sync.outbox set delivered_at = now() where aggregate_id in (select id from sync_fixture) and delivered_at is null and dead_at is null;

insert into user_permission_overrides(user_profile_id, tenant_id, permission_key, effect)
values ((select id from sync_fixture where name = 'crm_user'), (select id from sync_fixture where name = 'tenant'), 'crm.view', 'deny');
select is(pg_temp.open_events('crm_user'), 1, 'a crm.view override enqueues the person');
select ok(not (crm_sync.staff_snapshot((select id from sync_fixture where name = 'crm_user')) ->> 'eligible')::boolean,
  'a crm.view deny makes the person ineligible');

insert into user_permission_overrides(user_profile_id, tenant_id, permission_key, effect)
values ((select id from sync_fixture where name = 'manager'), (select id from sync_fixture where name = 'tenant'), 'tasks.view', 'deny')
on conflict do nothing;
select is(pg_temp.open_events('manager'), 0, 'an unrelated override adds no event');

insert into role_permissions(tenant_id, user_role, permission_key, is_allowed)
values ((select id from sync_fixture where name = 'tenant'), 'manager', 'crm.view', false);
select is(pg_temp.open_events('manager'), 1, 'a crm.view role rule enqueues every person with that role');
select is(pg_temp.open_events('admin'), 0, 'people with other roles are not enqueued');

insert into user_access_profiles(user_profile_id, tenant_id, dashboard_authority)
values ((select id from sync_fixture where name = 'admin'), (select id from sync_fixture where name = 'tenant'), 'staff');
select is(pg_temp.open_events('admin'), 1, 'a dashboard authority change enqueues the person');
select is(crm_sync.staff_snapshot((select id from sync_fixture where name = 'admin')) ->> 'crm_role', 'salesperson',
  'the dashboard authority is the effective role');

update user_profiles set account_status = 'suspended' where id = (select id from sync_fixture where name = 'manager');
select ok(not (crm_sync.staff_snapshot((select id from sync_fixture where name = 'manager')) ->> 'eligible')::boolean,
  'a suspended account is not eligible');

-- Deleting a profile sends present = false.
delete from user_permission_overrides where user_profile_id = (select id from sync_fixture where name = 'staff');
delete from user_profiles where id = (select id from sync_fixture where name = 'staff');
select is(pg_temp.open_events('staff'), 1, 'a deleted profile still has its open event');
select is(crm_sync.staff_snapshot((select id from sync_fixture where name = 'staff')) ->> 'present', 'false',
  'a deleted profile snapshots as not present');

-- ---------------------------------------------------------------------------
-- Roster and health
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
select ok(jsonb_array_length(public.crm_sync_staff_roster()) >= 3, 'the roster lists every profile');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true),
  set_config('request.jwt.claims', '{"role":"authenticated"}', true),
  set_config('request.jwt.claim.sub', (select id::text from sync_fixture where name = 'crm_user_auth'), true);
select throws_ok($$select * from public.crm_sync_claim_staff_events(10)$$, '42501', null, 'an end user cannot claim events');
select throws_ok($$select * from public.crm_sync_health()$$, '42501', null, 'a non-admin cannot read sync health');
reset role;
update user_profiles set user_role = 'admin' where id = (select id from sync_fixture where name = 'crm_user');
delete from user_access_profiles where user_profile_id = (select id from sync_fixture where name = 'crm_user');
set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from sync_fixture where name = 'crm_user_auth'), true);
select lives_ok($$select * from public.crm_sync_health()$$, 'an active admin reads sync health');
select ok((select open_events from public.crm_sync_health()) >= 1, 'sync health counts open events');
reset role;

select * from finish();
rollback;
