begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture: Mumbai (BANDRA, ANDHERI), Ahmedabad (AHD1, AHD2). Isolation stays OFF.
create temp table fx(kind text primary key, id uuid, auth_id uuid);
create temp table fx_rec(label text primary key, id uuid);
do $$
declare t uuid; d uuid; b uuid; c text; r record; aid uuid; pid uuid; mum uuid; ahd uuid;
begin
  insert into tenants(name, slug) values ('Director scope test', 'director-scope-test') returning id into t;
  insert into franchise_groups(tenant_id, name, code) values (t, 'Mumbai', 'MUM') returning id into mum;
  insert into franchise_groups(tenant_id, name, code) values (t, 'Ahmedabad', 'AHD') returning id into ahd;
  insert into fx_rec values ('MUM', mum), ('AHD', ahd), ('tenant', t);
  foreach c in array array['BANDRA','ANDHERI','AHD1','AHD2'] loop
    perform set_config('jewelos.new_branch_franchise_group_id', (case when c like 'AHD%' then ahd::text else mum::text end), true);
    insert into branches(tenant_id, name, code) values (t, initcap(c) || ' store', c || '98') returning id into b;
    insert into fx_rec values (c, b);
  end loop;
  perform set_config('jewelos.new_branch_franchise_group_id', '', true);
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'Sales', 'SALES98') returning id into d;
  for r in select * from (values
      ('sa','super_admin','BANDRA'), ('adm','admin','ANDHERI'),
      ('dir_ahd','admin','AHD1'), ('dir_mum','admin','BANDRA'), ('dir_store','admin','AHD2'),
      ('mgr_bandra','manager','BANDRA'),
      ('staff_bandra','staff','BANDRA'), ('staff_ahd1','staff','AHD1'), ('staff_ahd2','staff','AHD2')) v(kind, role, branch)
  loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'ds-' || r.kind || '@example.in', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (t, aid, (select id from fx_rec where label = r.branch), d,
      'DS ' || r.kind, 'DS-' || upper(r.kind), 'ds-' || r.kind || '@example.in', r.role::user_role, 'active', 'active', true)
    returning id into pid;
    insert into fx values (r.kind, pid, aid);
  end loop;
  insert into org_scope_grants(tenant_id, user_profile_id, authority, scope_level, franchise_group_id, reason)
  select t, id, 'director', 'franchise', case when kind = 'dir_ahd' then ahd else mum end, 'fixture'
  from fx where kind in ('dir_ahd', 'dir_mum');
  insert into org_scope_grants(tenant_id, user_profile_id, authority, scope_level, branch_id, reason)
  select t, id, 'director', 'branch', (select id from fx_rec where label = 'AHD2'), 'fixture' from fx where kind = 'dir_store';
end $$;
grant select on fx, fx_rec to authenticated, anon, service_role;
create function pg_temp.p(k text) returns uuid language sql stable as $$ select id from fx where kind = k $$;
create function pg_temp.b(k text) returns uuid language sql stable as $$ select id from fx_rec where label = k $$;
create function pg_temp.login(k text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', (select auth_id::text from fx where kind = k), true);
$$;
grant execute on function pg_temp.p(text), pg_temp.b(text), pg_temp.login(text) to authenticated, anon, service_role;

-- One task per store, created by and assigned to that store's staff.
create temp table fx_task(label text primary key, id uuid);
grant select on fx_task to authenticated;
do $$
declare c text; v uuid; s uuid;
begin
  foreach c in array array['BANDRA','AHD1','AHD2'] loop
    s := pg_temp.p(case c when 'BANDRA' then 'staff_bandra' when 'AHD1' then 'staff_ahd1' else 'staff_ahd2' end);
    insert into task_instances(tenant_id, branch_id, task_type, title, planned_datetime, created_by)
    values (pg_temp.b('tenant'), pg_temp.b(c), 'delegation', 'Director scope ' || c, now(), s) returning id into v;
    insert into task_assignees(task_instance_id, user_profile_id, role_at_task, is_active)
    values (v, s, 'doer', true);
    insert into fx_task values (c, v);
  end loop;
end $$;

-- ===========================================================================
-- A. The switch stays off; only a Director's own session is scoped.
-- ===========================================================================
select ok(not org_isolation_switch_on(pg_temp.b('tenant')), 'franchise isolation is off for the tenant');
select ok(not org_scope_enforced(pg_temp.b('tenant')), 'with no signed-in person (cron, service role) nothing is scoped');

set local role authenticated;
select pg_temp.login('dir_ahd');
select ok(org_my_scope_enforced(), 'a Director''s session is scoped even with isolation off');
select ok((get_my_org_scope()->>'enforcement_enabled')::boolean and not (get_my_org_scope()->>'company_scope')::boolean,
  'a Director''s own scope snapshot reports scoped, not company');
select pg_temp.login('adm');
select ok(not org_my_scope_enforced(), 'an Admin is not scoped while isolation is off');
select pg_temp.login('sa');
select ok(not org_my_scope_enforced(), 'Super Admin is not scoped');
select pg_temp.login('mgr_bandra');
select ok(not org_my_scope_enforced(), 'a Manager keeps today''s access while isolation is off');
select pg_temp.login('staff_bandra');
select ok(not org_my_scope_enforced(), 'Staff keep today''s access while isolation is off');

-- ===========================================================================
-- B. People: an Ahmedabad Director sees Ahmedabad only.
-- ===========================================================================
select pg_temp.login('dir_ahd');
select is((select count(*)::int from user_profiles where id in (pg_temp.p('staff_bandra'), pg_temp.p('mgr_bandra'), pg_temp.p('adm'))), 0,
  'the Ahmedabad Director does not see Mumbai people');
select is((select count(*)::int from user_profiles where id in (pg_temp.p('staff_ahd1'), pg_temp.p('staff_ahd2'))), 2,
  'the Ahmedabad Director sees both Ahmedabad stores'' people');
select pg_temp.login('dir_mum');
select is((select count(*)::int from user_profiles where id in (pg_temp.p('staff_ahd1'), pg_temp.p('staff_ahd2'), pg_temp.p('dir_ahd'))), 0,
  'a Mumbai Director does not see Ahmedabad people');
select pg_temp.login('dir_store');
select is((select count(*)::int from user_profiles where id = pg_temp.p('staff_ahd1')), 0, 'a single-store Director does not see the other store');
select is((select count(*)::int from user_profiles where id = pg_temp.p('staff_ahd2')), 1, 'a single-store Director sees their store');
select pg_temp.login('adm');
select is((select count(*)::int from user_profiles where id in (pg_temp.p('staff_bandra'), pg_temp.p('staff_ahd1'), pg_temp.p('staff_ahd2'))), 3,
  'an Admin still sees every store''s people');

-- ===========================================================================
-- C. Tasks and dashboards.
-- ===========================================================================
select pg_temp.login('dir_ahd');
select ok(not can_read_task((select id from fx_task where label = 'BANDRA')), 'the Ahmedabad Director cannot read a Mumbai task');
select ok(can_read_task((select id from fx_task where label = 'AHD1')) and can_read_task((select id from fx_task where label = 'AHD2')),
  'the Ahmedabad Director reads Ahmedabad tasks');
-- Internal helpers are not granted to clients; evaluate them as the owner with
-- the same signed-in identity.
reset role;
select ok(not org_branch_visible(pg_temp.b('tenant'), pg_temp.p('dir_ahd'), pg_temp.b('BANDRA'))
  and org_branch_visible(pg_temp.b('tenant'), pg_temp.p('dir_ahd'), pg_temp.b('AHD2')),
  'dashboards and Task Control count only the Director''s stores');
select is(org_my_branch_filter(), array(select pg_temp.b(c) from unnest(array['AHD1','AHD2']) c order by 1),
  'Task Control lists are filtered to the Ahmedabad stores');
set local role authenticated;
select pg_temp.login('dir_mum');
select ok(can_read_task((select id from fx_task where label = 'BANDRA')) and not can_read_task((select id from fx_task where label = 'AHD1')),
  'a Mumbai Director reads Mumbai tasks only');
select pg_temp.login('adm');
select ok(can_read_task((select id from fx_task where label = 'BANDRA')) and can_read_task((select id from fx_task where label = 'AHD1')),
  'an Admin reads every store''s tasks');
reset role;
select is(org_my_branch_filter(), null, 'an Admin''s lists are not filtered');
select pg_temp.login('mgr_bandra');
select is(org_my_branch_filter(), null, 'a Manager''s lists keep today''s behaviour while isolation is off');

-- ===========================================================================
-- D. Leaving the Director role restores Admin access; switching isolation on keeps working.
-- ===========================================================================
reset role;
update org_scope_grants set revoked_at = now(), revoke_reason = 'test' where user_profile_id = pg_temp.p('dir_mum');
set local role authenticated;
select pg_temp.login('dir_mum');
select ok(not org_my_scope_enforced() and can_read_task((select id from fx_task where label = 'AHD1')),
  'once no longer a Director, the Admin reads every store again');
reset role;
insert into tenant_franchise_controls(tenant_id, enforcement_enabled, change_reason) values (pg_temp.b('tenant'), true, 'test');
set local role authenticated;
select pg_temp.login('mgr_bandra');
select ok(org_my_scope_enforced(), 'with isolation on, everyone below company scope is scoped as before');
select pg_temp.login('dir_ahd');
select ok(not can_read_task((select id from fx_task where label = 'BANDRA')), 'with isolation on, the Director stays limited');
reset role;

select * from finish();
rollback;
