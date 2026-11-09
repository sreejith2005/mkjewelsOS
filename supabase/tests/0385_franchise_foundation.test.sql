begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture: one tenant with five stores and an exhibition, one other tenant.
create temp table fx(kind text primary key, id uuid, auth_id uuid, tenant_id uuid, branch_id uuid, department_id uuid);
create temp table fx_branch(code text primary key, id uuid);
create temp table fx_franchise(code text primary key, id uuid);
create temp table fx_out(label text primary key, id uuid);
do $$
declare t uuid; ot uuid; d uuid; od uuid; b uuid; ob uuid; c text; r record; aid uuid; pid uuid;
begin
  insert into tenants(name, slug) values ('Franchise test', 'franchise-test') returning id into t;
  insert into tenants(name, slug) values ('Franchise other', 'franchise-other') returning id into ot;
  foreach c in array array['BANDRA','ANDHERI','ZAVERI','AHD1','AHD2','EXPO'] loop
    insert into branches(tenant_id, name, code) values (t, initcap(c) || ' store', c) returning id into b;
    insert into fx_branch values (c, b);
  end loop;
  insert into branches(tenant_id, name, code) values (ot, 'Other store', 'OTH') returning id into ob;
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'Sales', 'SALES') returning id into d;
  insert into departments(tenant_id, branch_id, name, code) values (ot, ob, 'Sales', 'SALES_OT') returning id into od;
  for r in select * from (values
      ('sa','super_admin','BANDRA'), ('dir_mum','manager','ANDHERI'), ('adm_ahd','admin','AHD1'),
      ('hr_mum','hr','ZAVERI'), ('mgr_bandra','manager','BANDRA'), ('staff_bandra','staff','BANDRA'),
      ('staff_bandra2','staff','BANDRA'), ('staff_andheri','staff','ANDHERI'), ('staff_ahd','staff','AHD2'),
      ('ahd_dir','manager','AHD2'), ('ot_admin','admin','OTH')) v(kind, role, branch)
  loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'fr-' || r.kind || '@example.in', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (case when r.kind = 'ot_admin' then ot else t end, aid,
      case when r.kind = 'ot_admin' then ob else (select id from fx_branch where code = r.branch) end,
      case when r.kind = 'ot_admin' then od else d end,
      'FR ' || r.kind, 'FR-' || upper(r.kind), 'fr-' || r.kind || '@example.in', r.role::user_role, 'active', 'active', true)
    returning id into pid;
    insert into fx values (r.kind, pid, aid, case when r.kind = 'ot_admin' then ot else t end,
      case when r.kind = 'ot_admin' then ob else (select id from fx_branch where code = r.branch) end,
      case when r.kind = 'ot_admin' then od else d end);
  end loop;
  update branches set manager_id = (select id from fx where kind = 'mgr_bandra') where id = (select id from fx_branch where code = 'BANDRA');
end $$;
grant select, insert, update on fx, fx_branch, fx_franchise, fx_out to authenticated, service_role, anon;
create function pg_temp.p(k text) returns uuid language sql stable as $$ select id from fx where kind = k $$;
create function pg_temp.b(k text) returns uuid language sql stable as $$ select id from fx_branch where code = k $$;
create function pg_temp.f(k text) returns uuid language sql stable as $$ select id from fx_franchise where code = k $$;
create function pg_temp.login(k text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', (select auth_id::text from fx where kind = k), true);
$$;
create function pg_temp.service() returns void language sql as $$
  select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claim.sub', '', true);
$$;
create function pg_temp.new_auth(email text) returns uuid language plpgsql as $$
declare aid uuid := gen_random_uuid();
begin
  insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
  values (aid, 'authenticated', 'authenticated', email, 'x', now(), now());
  return aid;
end $$;
grant execute on function pg_temp.p(text), pg_temp.b(text), pg_temp.f(text), pg_temp.login(text), pg_temp.service() to authenticated, service_role, anon;
create function pg_temp.visible(kinds text[]) returns int language sql stable as $$
  select count(*)::int from user_profiles where id in (select id from fx where kind = any(kinds));
$$;
grant execute on function pg_temp.visible(text[]) to authenticated;

-- ===========================================================================
-- A. Isolation off: existing behaviour is unchanged.
-- ===========================================================================
select is((select count(*)::int from tenant_franchise_controls), 0, 'isolation is off for every tenant after the migration');
select ok((select bool_and(franchise_group_id is null and location_kind = 'store') from branches), 'existing branches are kept and left unmapped');

set local role authenticated;
select pg_temp.login('adm_ahd');
select is(pg_temp.visible(array['staff_bandra','staff_andheri','hr_mum']), 3, 'off: an Admin still sees the whole tenant directory');
select lives_ok($$select update_user_profile_with_audit(pg_temp.p('staff_bandra'), '{"employee_name":"FR staff bandra"}')$$, 'off: an Admin still edits any branch');
select pg_temp.login('hr_mum');
select is(pg_temp.visible(array['staff_ahd','staff_bandra']), 2, 'off: HR still sees every branch');
select pg_temp.login('mgr_bandra');
select ok(not has_permission('users.manage_scoped'), 'off: a branch manager gains no new capability');
select is((get_my_org_scope()->>'enforcement_enabled')::boolean, false, 'the client can read its own scope state');
select ok(not has_permission('franchise.manage'), 'franchise management is protected');
reset role;

-- ===========================================================================
-- B. Super Admin organisation tools.
-- ===========================================================================
set local role authenticated;
-- Since 0397 an Admin may add a franchise (0397_leadership_hierarchy.test.sql); a Manager may not.
select pg_temp.login('dir_mum');
select throws_ok($$select save_franchise_group_with_audit(null, '{"name":"Rogue","code":"ROGUE"}')$$, '42501', null, 'a Manager cannot create a franchise');
select pg_temp.login('adm_ahd');
select throws_ok($$select get_franchise_readiness_report()$$, '42501', null, 'an Admin cannot read the readiness report');
select pg_temp.login('sa');
insert into fx_franchise select 'MUM', (save_franchise_group_with_audit(null, '{"name":"Mumbai","code":"mum","city":"Mumbai","state":"Maharashtra"}')).id;
insert into fx_franchise select 'AHD', (save_franchise_group_with_audit(null, '{"name":"Ahmedabad","code":"AHD","city":"Ahmedabad","state":"Gujarat"}')).id;
select is((select code from franchise_groups where id = pg_temp.f('MUM')), 'MUM', 'Super Admin creates a franchise; the code is normalised');
select throws_ok($$select save_franchise_group_with_audit(null, '{"name":"mumbai","code":"MUM2"}')$$, '23505', null, 'franchise names are unique per tenant');
select throws_ok($$select save_franchise_group_with_audit(null, '{"name":"Bad","code":"MUM","owner":"x"}')$$, '22023', null, 'unknown franchise fields are rejected');
select lives_ok($$select assign_branch_franchise_with_audit(pg_temp.b('BANDRA'), pg_temp.f('MUM'), null, null)$$, 'first mapping of a store needs no reason');
select lives_ok($$select assign_branch_franchise_with_audit(pg_temp.b('ANDHERI'), pg_temp.f('MUM'), null, null)$$, 'Andheri mapped');
select lives_ok($$select assign_branch_franchise_with_audit(pg_temp.b('ZAVERI'), pg_temp.f('MUM'), null, null)$$, 'Zaveri mapped');
select lives_ok($$select assign_branch_franchise_with_audit(pg_temp.b('AHD1'), pg_temp.f('AHD'), null, null)$$, 'AHD1 mapped');
select lives_ok($$select assign_branch_franchise_with_audit(pg_temp.b('AHD2'), pg_temp.f('AHD'), null, null)$$, 'AHD2 mapped');
select is((get_franchise_readiness_report()->>'mappings_complete')::boolean, false, 'readiness stays incomplete while a location is still typed as a store without a franchise');
select is((select jsonb_array_length(get_franchise_readiness_report()->'unmapped_active_branches')), 1, 'that location is listed as an exception');
select throws_ok($$select assign_branch_franchise_with_audit(pg_temp.b('EXPO'), null, 'store', '')$$, '22023', null, 'a store needs a franchise');
select lives_ok($$select assign_branch_franchise_with_audit(pg_temp.b('EXPO'), null, 'exhibition', '')$$, 'an exhibition is marked as such and needs no franchise (owner decision 2026-11-06)');
select is((get_franchise_readiness_report()->>'mappings_complete')::boolean, true, 'every store is mapped; exhibitions do not block');
-- Later migrations close every section; hold one pending to test the lock.
reset role;
update franchise_scope_modules set status = 'pending', pending_reason = 'lock test' where module = 'kiara';
set local role authenticated;
select throws_ok($$select set_franchise_enforcement_with_audit(true, 'try')$$, '55000', null, 'isolation cannot be switched on while a section is not covered');
select throws_ok($$select save_franchise_group_with_audit(pg_temp.f('AHD'), '{"is_active":false}')$$, '23514', null, 'a franchise with active branches cannot be deactivated');
select lives_ok($$select grant_org_scope_with_audit(pg_temp.p('dir_mum'), 'director', pg_temp.f('MUM'), null, false, 'Mumbai director')$$, 'Director scope granted');
-- Since 0397 an Admin limited to one franchise is a Director (an Admin without one sees every franchise).
select lives_ok($$select grant_org_scope_with_audit(pg_temp.p('adm_ahd'), 'director', pg_temp.f('AHD'), null, false, 'Ahmedabad admin')$$, 'Ahmedabad Admin made a Director');
select lives_ok($$select grant_org_scope_with_audit(pg_temp.p('hr_mum'), 'hr', pg_temp.f('MUM'), null, false, 'Mumbai HR')$$, 'HR scope granted');
select lives_ok($$select grant_org_scope_with_audit(pg_temp.p('ahd_dir'), 'director', pg_temp.f('AHD'), null, false, 'Ahmedabad director')$$, 'second Director granted');
select throws_ok($$select grant_org_scope_with_audit(pg_temp.p('dir_mum'), 'director', pg_temp.f('MUM'), null, false, 'again')$$, '23505', null, 'duplicate grants are refused');
select throws_ok($$select grant_org_scope_with_audit(pg_temp.p('staff_bandra'), 'store_manager', null, null, true, 'company store')$$, '22023', null, 'store authority cannot be company-wide');
select throws_ok($$select grant_org_scope_with_audit(pg_temp.p('ot_admin'), 'hr', pg_temp.f('MUM'), null, false, 'cross tenant')$$, '42501', null, 'scope cannot be granted to another tenant''s employee');
select throws_ok($$select grant_org_scope_with_audit(pg_temp.p('staff_bandra'), 'store_access', null, (select id from branches where code = 'OTH'), false, 'forged')$$, '22023', null, 'a forged foreign branch id is refused');
reset role;

select ok(exists(select 1 from audit_logs where action = 'branch_franchise_assigned' and record_id = pg_temp.b('EXPO') and new_value ? 'impact'), 'branch mapping is audited with its impact');
select ok(exists(select 1 from audit_logs where action = 'org_scope_granted' and record_id = pg_temp.p('dir_mum')), 'scope grants are audited');
select throws_ok($$update branches set franchise_group_id = pg_temp.f('AHD') where id = pg_temp.b('BANDRA')$$, '42501', null, 'no path can re-home a branch outside the audited contract');

set local role authenticated;
select pg_temp.login('adm_ahd');
select throws_ok($$select grant_org_scope_with_audit(pg_temp.p('adm_ahd'), 'regional_admin', pg_temp.f('MUM'), null, false, 'self escalation')$$, '42501', null, 'a regional admin cannot grant themselves more scope');
select is((select count(*)::int from org_scope_grants), 1, 'a person sees only their own scope grants');
select is((select count(*)::int from franchise_groups), 2, 'franchise names are visible inside the tenant');
select pg_temp.login('ot_admin');
select is((select count(*)::int from franchise_groups), 0, 'another tenant sees no franchises');
reset role;
set local role anon;
select throws_ok($$select count(*) from franchise_groups$$, '42501', null, 'anonymous callers cannot read franchises');
select throws_ok($$select get_my_org_scope()$$, '42501', null, 'anonymous callers cannot call the scope RPC');
reset role;

-- ===========================================================================
-- C. Isolation on (simulates the Phase 2 activation).
-- ===========================================================================
insert into tenant_franchise_controls(tenant_id, enforcement_enabled, change_reason) select tenant_id, true, 'test' from fx where kind = 'sa';
set local role authenticated;

select pg_temp.login('sa');
select is(pg_temp.visible(array['staff_bandra','staff_andheri','staff_ahd','adm_ahd']), 4, 'Super Admin sees both franchises');
select ok(org_branch_in_data_scope(null), 'company scope may read records without a branch');

select pg_temp.login('dir_mum');
select is(pg_temp.visible(array['staff_bandra','staff_andheri','hr_mum','mgr_bandra']), 4, 'Mumbai Director sees all Mumbai stores');
select is(pg_temp.visible(array['staff_ahd','adm_ahd','ahd_dir']), 0, 'Mumbai Director sees no Ahmedabad employee');
select is((select count(*)::int from user_profiles where branch_id in (pg_temp.b('AHD1'), pg_temp.b('AHD2'))), 0, 'counts and filters on Ahmedabad return nothing');
select ok(not org_branch_in_data_scope(null), 'records without a branch are not exposed to franchise scope');
select ok(not org_branch_in_data_scope(pg_temp.b('EXPO')), 'an exhibition belongs to no franchise: its records reach people through the work itself');
select ok(not org_branch_in_data_scope(pg_temp.b('AHD1')), 'Ahmedabad data is out of scope for Mumbai');
select ok(has_permission('users.manage_scoped') and has_permission('users.view'), 'Director authority confers scoped user management');
select ok(not has_permission('users.manage') and not has_permission('franchise.manage'), 'Director authority confers no company-wide power');

select pg_temp.login('adm_ahd');
select is(pg_temp.visible(array['staff_ahd','ahd_dir']), 2, 'Ahmedabad Admin sees Ahmedabad');
select is(pg_temp.visible(array['staff_bandra','staff_andheri','dir_mum','hr_mum']), 0, 'Ahmedabad Admin sees no Mumbai employee');

select pg_temp.login('hr_mum');
select is(pg_temp.visible(array['staff_bandra','staff_andheri','mgr_bandra','dir_mum']), 4, 'Mumbai HR sees the three Mumbai stores');
select is(pg_temp.visible(array['staff_ahd','adm_ahd']), 0, 'Mumbai HR sees no Ahmedabad employee');

select pg_temp.login('mgr_bandra');
select is(pg_temp.visible(array['staff_bandra','staff_bandra2']), 2, 'Bandra manager sees Bandra');
select is(pg_temp.visible(array['staff_andheri','dir_mum','staff_ahd']), 0, 'Bandra manager sees neither Andheri nor Ahmedabad');
select ok(has_permission('users.manage_scoped'), 'branches.manager_id counts as store manager authority');

select pg_temp.login('staff_bandra');
select is(pg_temp.visible(array['staff_bandra','staff_bandra2','staff_andheri','staff_ahd']), 1, 'Staff see only their own profile');
select ok(not has_permission('users.manage_scoped'), 'Staff gain no user management');

-- An ordinary permission override never widens data scope.
reset role;
insert into user_permission_overrides(user_profile_id, tenant_id, permission_key, effect) select id, tenant_id, 'users.manage', 'grant' from fx where kind = 'staff_andheri';
set local role authenticated;
select pg_temp.login('staff_andheri');
select is(pg_temp.visible(array['staff_bandra','staff_ahd']), 0, 'a users.manage override does not expose other branches');
select throws_ok($$select update_user_profile_with_audit(pg_temp.p('staff_bandra'), '{"employee_name":"x"}')$$, '42501', null, 'a users.manage override cannot edit outside its branch scope');

-- Writes through the audited editor.
select pg_temp.login('adm_ahd');
select throws_ok($$select update_user_profile_with_audit(pg_temp.p('staff_bandra'), '{"employee_name":"x"}')$$, '42501', null, 'Ahmedabad Admin cannot edit a Mumbai employee');
select lives_ok($$select update_user_profile_with_audit(pg_temp.p('staff_ahd'), '{"employee_name":"FR staff ahd"}')$$, 'Ahmedabad Admin edits an Ahmedabad employee');
select throws_ok(format($$select update_user_profile_with_audit(pg_temp.p('staff_ahd'), '{"branch_id":"%s"}')$$, pg_temp.b('BANDRA')), '42501', null, 'a forged destination branch is refused');
select throws_ok($$select update_user_profile_with_audit(pg_temp.p('ahd_dir'), '{"employee_name":"x"}')$$, '42501', null, 'a Regional Admin cannot edit the franchise Director');
select throws_ok($$select update_user_profile_with_audit(pg_temp.p('staff_ahd'), '{"user_role":"super_admin"}')$$, '42501', null, 'role escalation through the editor is refused');

select pg_temp.login('dir_mum');
select lives_ok(format($$select update_user_profile_with_audit(pg_temp.p('staff_bandra2'), '{"branch_id":"%s"}')$$, pg_temp.b('ANDHERI')), 'Director moves an employee between Mumbai stores');
select throws_ok(format($$select update_user_profile_with_audit(pg_temp.p('staff_bandra2'), '{"branch_id":"%s"}')$$, pg_temp.b('AHD1')), '42501', null, 'Director cannot move an employee into Ahmedabad');

select pg_temp.login('mgr_bandra');
select throws_ok($$select update_user_profile_with_audit(pg_temp.p('staff_andheri'), '{"employee_name":"x"}')$$, '42501', null, 'Bandra manager cannot edit an Andheri employee');
select lives_ok($$select update_user_profile_with_audit(pg_temp.p('staff_bandra'), '{"employee_name":"FR staff bandra edited"}')$$, 'Bandra manager edits a Bandra employee');

select pg_temp.login('sa');
select throws_ok(format($$select update_user_profile_with_audit(pg_temp.p('staff_andheri'), '{"branch_id":"%s"}')$$, pg_temp.b('AHD2')), '23514', null, 'even Super Admin uses the transfer contract to change franchise');
select lives_ok(format($$select transfer_employee_franchise_with_audit(pg_temp.p('staff_andheri'), '%s', '%s', 'Relocated to Ahmedabad')$$, pg_temp.b('AHD2'), (select department_id from fx where kind = 'sa')), 'Super Admin transfers an employee across franchises');
reset role;
select ok(exists(select 1 from user_organization_history where user_profile_id = pg_temp.p('staff_andheri') and new_branch_id = pg_temp.b('AHD2')), 'the transfer keeps organisation history');
select ok(exists(select 1 from audit_logs where action = 'employee_franchise_transferred' and record_id = pg_temp.p('staff_andheri') and new_value ? 'impact'), 'the transfer is audited with impact');

-- Account creation (Edge Function path, service role acting for the inviter).
insert into fx_out select 'new' || n, pg_temp.new_auth('fr-new' || n || '@example.in') from generate_series(1, 8) n;
set local role service_role;
select pg_temp.service();
select lives_ok(format($$select invite_profile_with_audit_v3('%s', pg_temp.p('hr_mum'), 'fr-new1@example.in', 'New', 'One', '', pg_temp.b('ANDHERI'), (select department_id from fx where kind='sa'), null, '', null, '{}', 'staff', null)$$, (select id from fx_out where label = 'new1')), 'Mumbai HR creates an Andheri employee');
select throws_ok(format($$select invite_profile_with_audit_v3('%s', pg_temp.p('hr_mum'), 'fr-new2@example.in', 'New', 'Two', '', pg_temp.b('AHD1'), (select department_id from fx where kind='sa'), null, '', null, '{}', 'staff', null)$$, (select id from fx_out where label = 'new2')), '42501', null, 'Mumbai HR cannot create an Ahmedabad employee');
select lives_ok(format($$select invite_profile_with_audit_v3('%s', pg_temp.p('mgr_bandra'), 'fr-new3@example.in', 'New', 'Three', '', pg_temp.b('BANDRA'), (select department_id from fx where kind='sa'), null, '', null, '{}', 'staff', null)$$, (select id from fx_out where label = 'new3')), 'Bandra manager creates a Bandra employee');
select throws_ok(format($$select invite_profile_with_audit_v3('%s', pg_temp.p('mgr_bandra'), 'fr-new4@example.in', 'New', 'Four', '', pg_temp.b('ANDHERI'), (select department_id from fx where kind='sa'), null, '', null, '{}', 'staff', null)$$, (select id from fx_out where label = 'new4')), '42501', null, 'Bandra manager cannot create an Andheri employee');
select throws_ok(format($$select invite_profile_with_audit_v3('%s', pg_temp.p('mgr_bandra'), 'fr-new5@example.in', 'New', 'Five', '', pg_temp.b('BANDRA'), (select department_id from fx where kind='sa'), null, '', null, '{}', 'admin', null)$$, (select id from fx_out where label = 'new5')), '42501', null, 'Bandra manager cannot create an administrator');
select throws_ok(format($$select invite_profile_with_audit_v3('%s', pg_temp.p('dir_mum'), 'fr-new6@example.in', 'New', 'Six', '', pg_temp.b('BANDRA'), (select department_id from fx where kind='sa'), null, '', null, '{}', 'super_admin', null)$$, (select id from fx_out where label = 'new6')), '42501', null, 'a Director cannot create a Super Admin');
select throws_ok(format($$select invite_profile_with_audit_v3('%s', pg_temp.p('ot_admin'), 'fr-new7@example.in', 'New', 'Seven', '', pg_temp.b('BANDRA'), (select department_id from fx where kind='sa'), null, '', null, '{}', 'staff', null)$$, (select id from fx_out where label = 'new7')), '23503', null, 'another tenant cannot create into this tenant''s branch');
reset role;

-- Suspended and removed actors.
update user_profiles set account_status = 'suspended', is_login_enabled = false where id = pg_temp.p('dir_mum');
set local role service_role;
select pg_temp.service();
select throws_ok(format($$select invite_profile_with_audit_v3('%s', pg_temp.p('dir_mum'), 'fr-new8@example.in', 'New', 'Eight', '', pg_temp.b('BANDRA'), (select department_id from fx where kind='sa'), null, '', null, '{}', 'staff', null)$$, (select id from fx_out where label = 'new8')), '42501', null, 'a suspended Director cannot create accounts');
reset role;
set local role authenticated;
select pg_temp.login('dir_mum');
select is(pg_temp.visible(array['staff_bandra','staff_ahd']), 0, 'a suspended Director sees nobody');
reset role;
update user_profiles set account_status = 'active', is_login_enabled = true where id = pg_temp.p('dir_mum');

-- Deletion keeps users.delete and respects scope.
insert into user_permission_overrides(user_profile_id, tenant_id, permission_key, effect) select id, tenant_id, 'users.delete', 'grant' from fx where kind = 'adm_ahd';
update user_profiles set account_status = 'suspended', is_login_enabled = false where id = pg_temp.p('staff_bandra2');
set local role authenticated;
select pg_temp.login('adm_ahd');
select throws_ok($$select prepare_unused_user_deletion(pg_temp.p('staff_bandra2'))$$, '42501', null, 'delete permission cannot reach another franchise');
select pg_temp.login('ot_admin');
select throws_ok($$select update_user_profile_with_audit(pg_temp.p('staff_ahd'), '{"employee_name":"x"}')$$, '42501', null, 'cross-tenant edits stay denied');

-- Store manager reassignment moves store authority with it.
select pg_temp.login('sa');
select lives_ok(format($$select save_branch_with_audit(pg_temp.b('BANDRA'), '{"manager_id":"%s"}')$$, pg_temp.p('staff_bandra')), 'Super Admin reassigns the Bandra manager');
select pg_temp.login('mgr_bandra');
select ok(not has_permission('users.manage_scoped'), 'the previous manager loses store authority');
select is(pg_temp.visible(array['staff_bandra']), 0, 'the previous manager no longer sees the store directory');
select pg_temp.login('staff_bandra');
select ok(has_permission('users.manage_scoped'), 'the new manager gains store authority');

-- Re-homing a store moves its visibility with it, with a reason.
select pg_temp.login('sa');
select throws_ok($$select assign_branch_franchise_with_audit(pg_temp.b('ZAVERI'), pg_temp.f('AHD'), null, '')$$, '22023', null, 're-homing a mapped store needs a reason');
select lives_ok($$select assign_branch_franchise_with_audit(pg_temp.b('ZAVERI'), pg_temp.f('AHD'), null, 'Test re-home')$$, 'Super Admin re-homes Zaveri');
select pg_temp.login('dir_mum');
select is(pg_temp.visible(array['hr_mum']), 0, 'Mumbai no longer sees the re-homed store');
select pg_temp.login('sa');
select lives_ok($$select save_branch_with_audit(null, '{"name":"Expo November","code":"EXPONOV"}')$$, 'a new location (for example this month''s exhibition) can be opened while isolation is on (owner decision 2026-11-06)');
select ok(not org_branch_in_data_scope((select id from branches where code = 'EXPONOV')) or org_i_have_company_scope(), 'a location without a franchise is visible only to company scope');
select lives_ok($$select create_branch_in_franchise_with_audit(pg_temp.f('MUM'), '{"name":"Powai store","code":"POWAI"}')$$, 'new branches are created inside a franchise');
select is((select franchise_group_id from branches where code = 'POWAI'), pg_temp.f('MUM'), 'the new branch belongs to its franchise');

-- Rollback lever: switching isolation off restores today's behaviour.
select lives_ok($$select set_franchise_enforcement_with_audit(false, 'rollback drill')$$, 'Super Admin can always switch isolation off');
select pg_temp.login('adm_ahd');
select is(pg_temp.visible(array['staff_bandra','staff_ahd']), 2, 'off again: Admin sees the whole tenant');
reset role;

select ok((select count(*) from user_profiles where tenant_id = (select tenant_id from fx where kind = 'sa')) = 12, 'no employee row was removed (10 fixtures + 2 created)');
select * from finish();
rollback;
