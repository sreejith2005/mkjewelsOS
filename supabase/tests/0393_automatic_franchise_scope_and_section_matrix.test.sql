begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture: Mumbai (BANDRA, ANDHERI, ZAVERI), Ahmedabad (AHD1, AHD2), an
-- exhibition with no franchise (EXPO), and another tenant.
create temp table fx(kind text primary key, id uuid, auth_id uuid);
create temp table fx_rec(label text primary key, id uuid);
do $$
declare t uuid; ot uuid; d uuid; od uuid; b uuid; ob uuid; c text; r record; aid uuid; pid uuid; mum uuid; ahd uuid;
begin
  insert into tenants(name, slug) values ('Auto scope test', 'auto-scope-test') returning id into t;
  insert into tenants(name, slug) values ('Auto scope other', 'auto-scope-other') returning id into ot;
  insert into franchise_groups(tenant_id, name, code) values (t, 'Mumbai', 'MUM') returning id into mum;
  insert into franchise_groups(tenant_id, name, code) values (t, 'Ahmedabad', 'AHD') returning id into ahd;
  insert into fx_rec values ('MUM', mum), ('AHD', ahd), ('tenant', t);
  foreach c in array array['BANDRA','ANDHERI','ZAVERI','AHD1','AHD2','EXPO'] loop
    perform set_config('jewelos.new_branch_franchise_group_id', (case when c = 'EXPO' then '' when c like 'AHD%' then ahd::text else mum::text end), true);
    insert into branches(tenant_id, name, code) values (t, initcap(c) || ' store', c) returning id into b;
    insert into fx_rec values (c, b);
  end loop;
  perform set_config('jewelos.new_branch_franchise_group_id', '', true);
  insert into branches(tenant_id, name, code) values (ot, 'Other store', 'OTH90') returning id into ob;
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'Sales', 'SALES90') returning id into d;
  insert into departments(tenant_id, branch_id, name, code) values (ot, ob, 'Sales', 'SALES_OT90') returning id into od;
  for r in select * from (values
      ('sa','super_admin','BANDRA'), ('sa2','super_admin','BANDRA'), ('adm_mum','admin','ANDHERI'), ('hr_ahd','hr','AHD1'),
      ('mgr_bandra','manager','BANDRA'), ('staff_bandra','staff','BANDRA'), ('staff_andheri','staff','ANDHERI'),
      ('staff_ahd','staff','AHD2'), ('adm_expo','admin','EXPO'), ('ot_admin','admin','OTH')) v(kind, role, branch)
  loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'as-' || r.kind || '@example.in', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (case when r.kind = 'ot_admin' then ot else t end, aid,
      case when r.kind = 'ot_admin' then ob else (select id from fx_rec where label = r.branch) end,
      case when r.kind = 'ot_admin' then od else d end,
      'AS ' || r.kind, 'AS-' || upper(r.kind), 'as-' || r.kind || '@example.in', r.role::user_role, 'active', 'active', true)
    returning id into pid;
    insert into fx values (r.kind, pid, aid);
  end loop;
  update branches set manager_id = (select id from fx where kind = 'mgr_bandra') where id = (select id from fx_rec where label = 'BANDRA');
end $$;
grant select on fx, fx_rec to authenticated, anon;
create function pg_temp.p(k text) returns uuid language sql stable as $$ select id from fx where kind = k $$;
create function pg_temp.b(k text) returns uuid language sql stable as $$ select id from fx_rec where label = k $$;
create function pg_temp.login(k text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', (select auth_id::text from fx where kind = k), true);
$$;
create function pg_temp.reads(k text, codes text[]) returns boolean language sql stable as $$
  select org_scope_branch_ids(pg_temp.p(k), false) @> array(select pg_temp.b(c) from unnest(codes) c);
$$;
create function pg_temp.reads_any(k text, codes text[]) returns boolean language sql stable as $$
  select org_scope_branch_ids(pg_temp.p(k), false) && array(select pg_temp.b(c) from unnest(codes) c);
$$;
grant execute on function pg_temp.p(text), pg_temp.b(text), pg_temp.login(text) to authenticated, anon;

-- ===========================================================================
-- A. Automatic franchise scope (no grant rows exist).
-- ===========================================================================
select is((select count(*)::int from org_scope_grants g join fx on fx.id = g.user_profile_id), 0, 'the fixture has no scope grants');
select ok(pg_temp.reads('adm_mum', array['BANDRA','ANDHERI','ZAVERI']), 'an Admin reads every store of their own franchise');
select ok(not pg_temp.reads_any('adm_mum', array['AHD1','AHD2','EXPO']), 'an Admin reads no store of another franchise');
select ok(org_scope_branch_ids(pg_temp.p('adm_mum'), true) @> array[pg_temp.b('BANDRA'), pg_temp.b('ZAVERI')], 'an Admin manages the stores of their franchise');
select is(org_scope_authorities(pg_temp.p('adm_mum')), array['regional_admin'], 'an Admin is a Regional Admin of their franchise automatically');
select ok(pg_temp.reads('hr_ahd', array['AHD1','AHD2']), 'HR reads every store of their own franchise');
select ok(not pg_temp.reads_any('hr_ahd', array['BANDRA','ANDHERI']), 'HR reads no store of another franchise');
select is(org_scope_authorities(pg_temp.p('hr_ahd')), array['hr'], 'HR is HR of their franchise automatically');
select is(org_scope_branch_ids(pg_temp.p('staff_bandra'), false), array[pg_temp.b('BANDRA')], 'staff keep only their own store');
select is(org_scope_authorities(pg_temp.p('staff_bandra')), '{}'::text[], 'staff hold no scope authority');
select is(org_scope_branch_ids(pg_temp.p('mgr_bandra'), true), array[pg_temp.b('BANDRA')], 'a store manager still manages only their store');
select is(org_scope_branch_ids(pg_temp.p('adm_expo'), false), array[pg_temp.b('EXPO')], 'an Admin at a store with no franchise keeps only that store');
select is((select count(*)::int from org_automatic_scope(pg_temp.p('ot_admin')) s where s.franchise_group_id in (pg_temp.b('MUM'), pg_temp.b('AHD'))), 0,
  'another tenant''s Admin never covers this tenant''s franchise');

-- Dashboard authority decides, as everywhere else.
insert into user_access_profiles(user_profile_id, tenant_id, dashboard_authority) values (pg_temp.p('staff_andheri'), pg_temp.b('tenant'), 'admin');
select ok(pg_temp.reads('staff_andheri', array['BANDRA','ZAVERI']), 'admin dashboard authority confers the franchise too');
delete from user_access_profiles where user_profile_id = pg_temp.p('staff_andheri');

-- It is derived on every call: store, role and franchise state move it at once.
update user_profiles set branch_id = pg_temp.b('AHD2') where id = pg_temp.p('adm_mum');
select ok(pg_temp.reads('adm_mum', array['AHD1','AHD2']) and not pg_temp.reads_any('adm_mum', array['BANDRA','ANDHERI']),
  'moving an Admin to another franchise''s store moves their scope');
update user_profiles set branch_id = pg_temp.b('ANDHERI') where id = pg_temp.p('adm_mum');
update user_profiles set user_role = 'staff' where id = pg_temp.p('hr_ahd');
select is(org_scope_branch_ids(pg_temp.p('hr_ahd'), false), array[pg_temp.b('AHD1')], 'a changed role drops the automatic franchise');
update user_profiles set user_role = 'hr' where id = pg_temp.p('hr_ahd');
update franchise_groups set is_active = false where id = pg_temp.b('AHD');
select is(org_scope_branch_ids(pg_temp.p('hr_ahd'), false), array[pg_temp.b('AHD1')], 'an inactive franchise confers nothing');
update franchise_groups set is_active = true where id = pg_temp.b('AHD');
update user_profiles set working_status = 'resigned' where id = pg_temp.p('hr_ahd');
select is(org_scope_branch_ids(pg_temp.p('hr_ahd'), false), '{}'::uuid[], 'a former employee has no scope');
update user_profiles set working_status = 'active' where id = pg_temp.p('hr_ahd');

-- Capability defaults follow the authority only while isolation is on.
set local role authenticated;
select pg_temp.login('hr_ahd');
select ok(not has_permission('users.manage_scoped'), 'isolation off: automatic scope adds no capability');
reset role;
insert into tenant_franchise_controls(tenant_id, enforcement_enabled, change_reason) values (pg_temp.b('tenant'), true, 'test');
set local role authenticated;
select pg_temp.login('hr_ahd');
select ok(has_permission('users.manage_scoped'), 'isolation on: automatic HR scope confers the HR defaults');
select is((select count(*)::int from user_profiles where id in (pg_temp.p('staff_ahd'))), 1, 'isolation on: HR sees their franchise''s people');
select is((select count(*)::int from user_profiles where id in (pg_temp.p('staff_bandra'), pg_temp.p('staff_andheri'))), 0, 'isolation on: HR does not see another franchise''s people');
select pg_temp.login('staff_bandra');
select is((select count(*)::int from user_profiles where id in (pg_temp.p('staff_andheri'), pg_temp.p('staff_ahd'))), 0, 'isolation on: staff still see only their own store');
reset role;
delete from tenant_franchise_controls where tenant_id = pg_temp.b('tenant');

-- Super Admin panel.
set local role authenticated;
select pg_temp.login('sa');
select ok((get_franchise_admin_context()->'automatic_scopes') @> jsonb_build_array(
    jsonb_build_object('user_profile_id', pg_temp.p('adm_mum'), 'authority', 'regional_admin', 'franchise_group_id', pg_temp.b('MUM')),
    jsonb_build_object('user_profile_id', pg_temp.p('hr_ahd'), 'authority', 'hr', 'franchise_group_id', pg_temp.b('AHD'))),
  'the Franchises panel lists automatic scope');
select ok(not ((get_franchise_admin_context()->'automatic_scopes') @> jsonb_build_array(jsonb_build_object('user_profile_id', pg_temp.p('staff_bandra')))),
  'staff are not listed as automatic scope');
select ok(not (get_franchise_readiness_report()->'leaders_without_scope') @> jsonb_build_array(jsonb_build_object('id', pg_temp.p('adm_mum'))),
  'readiness no longer flags a covered Admin');
select ok((get_franchise_readiness_report()->'leaders_without_scope') @> jsonb_build_array(jsonb_build_object('id', pg_temp.p('adm_expo'))),
  'readiness still flags an Admin whose store has no franchise');
reset role;
select ok(not has_function_privilege('authenticated', 'org_automatic_scope(uuid)', 'execute'), 'the internal resolver is not callable by clients');

-- ===========================================================================
-- B. Section access matrix.
-- ===========================================================================
set local role anon;
select throws_ok($$select get_section_access_matrix()$$, '42501', null, 'anon cannot read the matrix');
reset role;
set local role authenticated;
select pg_temp.login('staff_bandra');
select throws_ok($$select get_section_access_matrix()$$, '42501', null, 'an ordinary employee cannot read the matrix');
select throws_ok($$select save_section_access_bulk_with_audit(jsonb_build_object(pg_temp.p('staff_andheri')::text, '{"reports.view":"deny"}'::jsonb))$$,
  '42501', null, 'an ordinary employee cannot save the matrix');
select pg_temp.login('adm_mum');
select throws_ok($$select get_section_access_matrix()$$, '42501', null, 'an Admin without permission management cannot read the matrix');

select pg_temp.login('sa');
select is((select count(*)::int from jsonb_array_elements(get_section_access_matrix()->'users') u where (u->>'id')::uuid = pg_temp.p('ot_admin')), 0,
  'the matrix never lists another tenant''s people');
select ok((get_section_access_matrix()->'sections') ? 'reports.view' and not ((get_section_access_matrix()->'sections') ? 'users.manage'),
  'the matrix lists section permissions only');
select is((select u->'inherited'->>'users.view' from jsonb_array_elements(get_section_access_matrix()->'users') u where (u->>'id')::uuid = pg_temp.p('staff_bandra')), 'false',
  'inherited state follows the role default (staff: Users off)');
select is((select u->'inherited'->>'users.view' from jsonb_array_elements(get_section_access_matrix()->'users') u where (u->>'id')::uuid = pg_temp.p('hr_ahd')), 'true',
  'inherited state follows the role default (HR: Users on)');

select lives_ok($$select save_section_access_bulk_with_audit(jsonb_build_object(
    pg_temp.p('staff_bandra')::text, '{"users.view":"grant","reports.view":"deny"}'::jsonb,
    pg_temp.p('staff_andheri')::text, '{"reports.view":"deny"}'::jsonb))$$, 'Super Admin saves several employees at once');
reset role;
select is((select effect from user_permission_overrides where user_profile_id = pg_temp.p('staff_bandra') and permission_key = 'users.view'), 'grant', 'enable is saved');
select is((select count(*)::int from user_permission_overrides where user_profile_id in (pg_temp.p('staff_bandra'), pg_temp.p('staff_andheri')) and permission_key = 'reports.view' and effect = 'deny'), 2, 'disable is saved for both');
select is((select count(*)::int from audit_logs where action = 'user_access_saved' and record_id in (pg_temp.p('staff_bandra'), pg_temp.p('staff_andheri'))), 2, 'each employee gets an audit row');
select ok(permission_effective_for(pg_temp.p('staff_bandra'), 'users.view') and not permission_effective_for(pg_temp.p('staff_bandra'), 'reports.view'), 'the resolver applies the saved choices');
set local role authenticated;
select pg_temp.login('sa');
select is((select u->'overrides' from jsonb_array_elements(get_section_access_matrix()->'users') u where (u->>'id')::uuid = pg_temp.p('staff_bandra')),
  '{"users.view":"grant","reports.view":"deny"}'::jsonb, 'the matrix shows saved overrides');
select lives_ok($$select save_section_access_bulk_with_audit(jsonb_build_object(pg_temp.p('staff_bandra')::text, '{"users.view":null}'::jsonb))$$, 'inherit clears an override');
reset role;
select is((select count(*)::int from user_permission_overrides where user_profile_id = pg_temp.p('staff_bandra') and permission_key = 'users.view'), 0, 'inherit removed the row');

-- Refusals save nothing.
set local role authenticated;
select pg_temp.login('sa');
select throws_ok($$select save_section_access_bulk_with_audit(jsonb_build_object(
    pg_temp.p('staff_ahd')::text, '{"reports.view":"deny"}'::jsonb,
    pg_temp.p('sa')::text, '{"reports.view":"deny"}'::jsonb))$$, '42501', null, 'changing your own access is refused');
select throws_ok($$select save_section_access_bulk_with_audit(jsonb_build_object(pg_temp.p('staff_ahd')::text, '{"users.manage":"grant"}'::jsonb))$$,
  '22023', null, 'only section permissions are accepted');
select throws_ok($$select save_section_access_bulk_with_audit(jsonb_build_object(pg_temp.p('ot_admin')::text, '{"reports.view":"deny"}'::jsonb))$$,
  '42501', null, 'another tenant''s employee is refused');
select throws_ok($$select save_section_access_bulk_with_audit('{"not-an-id":{"reports.view":"deny"}}'::jsonb)$$, '22023', null, 'a malformed id is refused');
reset role;
select is((select count(*)::int from user_permission_overrides where user_profile_id = pg_temp.p('staff_ahd')), 0, 'a refused batch saved nothing');

select * from finish();
rollback;
