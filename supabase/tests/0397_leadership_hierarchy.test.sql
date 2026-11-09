begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture: Mumbai (BANDRA, ANDHERI), Ahmedabad (AHD1, AHD2), another tenant.
create temp table fx(kind text primary key, id uuid, auth_id uuid);
create temp table fx_rec(label text primary key, id uuid);
do $$
declare t uuid; ot uuid; d uuid; od uuid; b uuid; ob uuid; c text; r record; aid uuid; pid uuid; mum uuid; ahd uuid; oth uuid;
begin
  insert into tenants(name, slug) values ('Leadership test', 'leadership-test') returning id into t;
  insert into tenants(name, slug) values ('Leadership other', 'leadership-other') returning id into ot;
  insert into franchise_groups(tenant_id, name, code) values (t, 'Mumbai', 'MUM') returning id into mum;
  insert into franchise_groups(tenant_id, name, code) values (t, 'Ahmedabad', 'AHD') returning id into ahd;
  insert into franchise_groups(tenant_id, name, code) values (ot, 'Other', 'OTHF') returning id into oth;
  insert into fx_rec values ('MUM', mum), ('AHD', ahd), ('OTHF', oth), ('tenant', t);
  foreach c in array array['BANDRA','ANDHERI','AHD1','AHD2'] loop
    perform set_config('jewelos.new_branch_franchise_group_id', (case when c like 'AHD%' then ahd::text else mum::text end), true);
    insert into branches(tenant_id, name, code) values (t, initcap(c) || ' store', c) returning id into b;
    insert into fx_rec values (c, b);
  end loop;
  perform set_config('jewelos.new_branch_franchise_group_id', '', true);
  insert into branches(tenant_id, name, code) values (ot, 'Other store', 'OTH95') returning id into ob;
  insert into fx_rec values ('OTH', ob);
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'Sales', 'SALES95') returning id into d;
  insert into departments(tenant_id, branch_id, name, code) values (ot, ob, 'Sales', 'SALES_OT95') returning id into od;
  for r in select * from (values
      ('sa','super_admin','BANDRA'), ('adm','admin','ANDHERI'), ('adm2','admin','AHD1'),
      ('dir_mum','admin','BANDRA'), ('dir_mum2','admin','ANDHERI'), ('dir_ahd2','admin','AHD2'),
      ('mgr_bandra','manager','BANDRA'), ('hr_ahd','hr','AHD1'),
      ('staff_bandra','staff','BANDRA'), ('staff_andheri','staff','ANDHERI'), ('staff_ahd1','staff','AHD1'), ('staff_ahd2','staff','AHD2'),
      ('ot_admin','admin','OTH')) v(kind, role, branch)
  loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'lh-' || r.kind || '@example.in', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (case when r.kind = 'ot_admin' then ot else t end, aid, (select id from fx_rec where label = r.branch),
      case when r.kind = 'ot_admin' then od else d end,
      'LH ' || r.kind, 'LH-' || upper(r.kind), 'lh-' || r.kind || '@example.in', r.role::user_role, 'active', 'active', true)
    returning id into pid;
    insert into fx values (r.kind, pid, aid);
  end loop;
  update branches set manager_id = (select id from fx where kind = 'mgr_bandra') where id = (select id from fx_rec where label = 'BANDRA');
  insert into org_scope_grants(tenant_id, user_profile_id, authority, scope_level, franchise_group_id, reason)
  select t, id, 'director', 'franchise', mum, 'fixture' from fx where kind in ('dir_mum', 'dir_mum2');
  insert into org_scope_grants(tenant_id, user_profile_id, authority, scope_level, branch_id, reason)
  select t, id, 'director', 'branch', (select id from fx_rec where label = 'AHD2'), 'fixture' from fx where kind = 'dir_ahd2';
end $$;
grant select on fx, fx_rec to authenticated, anon, service_role;
create function pg_temp.p(k text) returns uuid language sql stable as $$ select id from fx where kind = k $$;
create function pg_temp.b(k text) returns uuid language sql stable as $$ select id from fx_rec where label = k $$;
create function pg_temp.login(k text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', (select auth_id::text from fx where kind = k), true);
$$;
create function pg_temp.reads(k text) returns uuid[] language sql stable as $$
  select org_scope_branch_ids(pg_temp.p(k), false);
$$;
create function pg_temp.codes(codes text[]) returns uuid[] language sql stable as $$
  select array(select pg_temp.b(c) from unnest(codes) c order by 1);
$$;
grant execute on function pg_temp.p(text), pg_temp.b(text), pg_temp.login(text), pg_temp.codes(text[]) to authenticated, anon, service_role;

-- ===========================================================================
-- A. Capabilities: Admin views and manages people, but does not build, configure or delete.
-- ===========================================================================
select ok(not permission_effective_for(pg_temp.p('adm'), k), 'Admin no longer has ' || k)
from unnest(array['fms.manage','forms.manage','notifications.manage','settings.manage_organization','settings.manage_branch',
  'recording.manage_rubric','tasks.delete','users.delete','dropdowns.manage','organization.manage','franchise.manage']) k;
select ok(permission_effective_for(pg_temp.p('adm'), k), 'Admin keeps ' || k)
from unnest(array['users.manage','users.view','tasks.view_all','tasks.assign_others','task_control.view','availability.review_leave',
  'availability.manage_others','organization.add_locations','dashboard.view','reports.view','fms.view','forms.view']) k;
select ok(not permission_effective_for(pg_temp.p('dir_mum'), 'fms.manage') and permission_effective_for(pg_temp.p('dir_mum'), 'users.manage'),
  'a Director has the Admin capabilities');
select ok(permission_effective_for(pg_temp.p('sa'), k), 'Super Admin keeps ' || k)
from unnest(array['fms.manage','forms.manage','tasks.delete','users.delete','franchise.manage','organization.manage']) k;
select ok(permission_effective_for(pg_temp.p('mgr_bandra'), 'forms.manage'), 'a Manager keeps form authoring (unchanged)');
select ok(not permission_effective_for(pg_temp.p('mgr_bandra'), 'tasks.delete') and not permission_effective_for(pg_temp.p('staff_bandra'), 'organization.add_locations'),
  'new permissions are not given to Managers or Staff');

-- Task deletion needs tasks.delete.
create temp table fx_task(id uuid);
grant select on fx_task to authenticated;
with x as (insert into task_instances(tenant_id, branch_id, task_type, title, planned_datetime, created_by)
  values (pg_temp.b('tenant'), pg_temp.b('ANDHERI'), 'delegation', 'Leadership test task', now(), pg_temp.p('sa')) returning id)
insert into fx_task select id from x;
set local role authenticated;
select pg_temp.login('adm');
select throws_ok($$select admin_delete_task_with_audit((select id from fx_task), false, 'test')$$, '42501', null, 'Admin cannot delete a task');
select pg_temp.login('dir_mum');
select throws_ok($$select admin_delete_task_with_audit((select id from fx_task), false, 'test')$$, '42501', null, 'a Director cannot delete a task');
select pg_temp.login('sa');
select lives_ok($$select admin_delete_task_with_audit((select id from fx_task), false, 'test')$$, 'Super Admin deletes a task');
reset role;
select isnt((select deleted_at from task_instances where id = (select id from fx_task)), null, 'the task is deleted');

-- ===========================================================================
-- B. Scope: Admin sees every franchise, a Director only theirs.
-- ===========================================================================
select ok(org_has_company_scope(pg_temp.p('adm')), 'an Admin has company scope');
select is(pg_temp.reads('adm'), pg_temp.codes(array['BANDRA','ANDHERI','AHD1','AHD2']), 'an Admin reads every store');
select ok(not org_has_company_scope(pg_temp.p('dir_mum')), 'a Director does not have company scope');
select ok(org_is_director(pg_temp.p('dir_mum')) and not org_is_director(pg_temp.p('adm')) and not org_is_director(pg_temp.p('staff_bandra')), 'org_is_director identifies Directors only');
select is(pg_temp.reads('dir_mum'), pg_temp.codes(array['BANDRA','ANDHERI']), 'a Mumbai Director reads only the Mumbai stores');
select is(org_scope_branch_ids(pg_temp.p('dir_mum'), true), pg_temp.codes(array['BANDRA','ANDHERI']), 'a Mumbai Director manages the Mumbai stores');
select is(pg_temp.reads('dir_ahd2'), pg_temp.codes(array['AHD2']), 'a single-store Director reads only that store');
select is(org_scope_branch_ids(pg_temp.p('dir_ahd2'), true), pg_temp.codes(array['AHD2']), 'a single-store Director manages that store');
select is(org_scope_authorities(pg_temp.p('adm')), '{}'::text[], 'an Admin has no franchise authority (company scope instead)');
select is(pg_temp.reads('hr_ahd'), pg_temp.codes(array['AHD1','AHD2']), 'HR still covers their store''s franchise automatically');
select is((select count(*)::int from org_automatic_scope(pg_temp.p('adm'))), 0, 'Admin has no automatic franchise row');
insert into user_access_profiles(user_profile_id, tenant_id, dashboard_authority) values (pg_temp.p('staff_ahd1'), pg_temp.b('tenant'), 'admin');
select ok(org_has_company_scope(pg_temp.p('staff_ahd1')), 'admin dashboard authority confers company scope');
delete from user_access_profiles where user_profile_id = pg_temp.p('staff_ahd1');
select ok(not (pg_temp.reads('ot_admin') && pg_temp.codes(array['BANDRA','ANDHERI','AHD1','AHD2'])), 'another tenant''s Admin never reads this tenant''s stores');

-- Isolation on: the directory follows scope.
insert into tenant_franchise_controls(tenant_id, enforcement_enabled, change_reason) values (pg_temp.b('tenant'), true, 'test');
set local role authenticated;
select pg_temp.login('dir_mum');
select is((select count(*)::int from user_profiles where id in (pg_temp.p('staff_ahd1'), pg_temp.p('staff_ahd2'))), 0, 'isolation on: a Mumbai Director sees no Ahmedabad employee');
select is((select count(*)::int from user_profiles where id in (pg_temp.p('staff_bandra'), pg_temp.p('staff_andheri'))), 2, 'isolation on: a Mumbai Director sees Mumbai employees');
select pg_temp.login('adm');
select is((select count(*)::int from user_profiles where id in (pg_temp.p('staff_ahd1'), pg_temp.p('staff_bandra'))), 2, 'isolation on: an Admin sees every franchise');
select pg_temp.login('dir_ahd2');
select is((select count(*)::int from user_profiles where id in (pg_temp.p('staff_ahd1'), pg_temp.p('staff_ahd2'))), 1, 'isolation on: a single-store Director sees only that store');
reset role;
delete from tenant_franchise_controls where tenant_id = pg_temp.b('tenant');

-- ===========================================================================
-- C. User management
-- ===========================================================================
select throws_ok($$select assert_org_user_write(pg_temp.p('dir_mum'), null, pg_temp.b('BANDRA'), 'admin')$$, '42501', null, 'a Director cannot create an Admin or Director');
select throws_ok($$select assert_org_user_write(pg_temp.p('dir_mum'), null, pg_temp.b('AHD1'), 'staff')$$, '42501', null, 'a Director cannot add employees to another franchise (isolation off too)');
select lives_ok($$select assert_org_user_write(pg_temp.p('dir_mum'), null, pg_temp.b('ANDHERI'), 'staff')$$, 'a Director adds employees to their franchise');
select throws_ok($$select assert_org_user_write(pg_temp.p('dir_mum'), pg_temp.p('adm'), null, null)$$, '42501', null, 'a Director cannot edit an Admin');
select throws_ok($$select assert_org_user_write(pg_temp.p('dir_mum'), pg_temp.p('dir_mum2'), null, null)$$, '42501', null, 'a Director cannot edit another Director');
select lives_ok($$select assert_org_user_write(pg_temp.p('dir_ahd2'), null, pg_temp.b('AHD2'), 'staff')$$, 'a single-store Director adds employees to that store');
select throws_ok($$select assert_org_user_write(pg_temp.p('dir_ahd2'), null, pg_temp.b('AHD1'), 'staff')$$, '42501', null, 'a single-store Director cannot add employees elsewhere');
select lives_ok($$select assert_org_user_write(pg_temp.p('adm'), null, pg_temp.b('AHD1'), 'admin')$$, 'an Admin creates an Admin in any franchise');
select lives_ok($$select assert_org_user_write(pg_temp.p('adm'), pg_temp.p('dir_mum'), null, null)$$, 'an Admin edits a Director');

-- ===========================================================================
-- D. Directors: set up, change, end
-- ===========================================================================
set local role authenticated;
select pg_temp.login('staff_bandra');
select throws_ok($$select save_director_with_audit(pg_temp.p('staff_andheri'), array[pg_temp.b('AHD')], '{}', null, 'x')$$, '42501', null, 'an employee cannot set up a Director');
select pg_temp.login('dir_mum');
select throws_ok($$select save_director_with_audit(pg_temp.p('staff_andheri'), array[pg_temp.b('MUM')], '{}', null, 'x')$$, '42501', null, 'a Director cannot set up a Director');
select pg_temp.login('adm');
select throws_ok($$select save_director_with_audit(pg_temp.p('staff_andheri'), array[pg_temp.b('AHD')], '{}', null, 'x')$$, '42501', null, 'an Admin cannot change an employee''s role');
select throws_ok($$select save_director_with_audit(pg_temp.p('sa'), array[pg_temp.b('AHD')], '{}', null, 'x')$$, '42501', null, 'a Super Admin cannot be made a Director');
select throws_ok($$select save_director_with_audit(pg_temp.p('adm'), array[pg_temp.b('AHD')], '{}', null, 'x')$$, '42501', null, 'nobody changes their own Director scope');
select throws_ok($$select save_director_with_audit(pg_temp.p('dir_mum'), '{}', '{}', null, 'x')$$, '22023', null, 'a Director needs at least one franchise or store');
select throws_ok($$select save_director_with_audit(pg_temp.p('dir_mum'), array[pg_temp.b('OTHF')], '{}', null, 'x')$$, '22023', null, 'another tenant''s franchise is refused');
select throws_ok($$select save_director_with_audit(pg_temp.p('dir_mum'), '{}', array[pg_temp.b('OTH')], null, 'x')$$, '22023', null, 'another tenant''s store is refused');
-- An Admin changes a Director's stores: one Ahmedabad store instead of Mumbai.
select lives_ok($$select save_director_with_audit(pg_temp.p('dir_mum2'), '{}', array[pg_temp.b('AHD1')], null, 'Moved to Ahmedabad')$$, 'an Admin changes a Director''s stores');
reset role;
select is(pg_temp.reads('dir_mum2'), pg_temp.codes(array['AHD1']), 'the Director now reads only the chosen store');
select is((select branch_id from user_profiles where id = pg_temp.p('dir_mum2')), pg_temp.b('AHD1'), 'the home store moved inside the new scope');
select is((select count(*)::int from org_scope_grants where user_profile_id = pg_temp.p('dir_mum2') and revoked_at is null and authority = 'director'), 1, 'the old franchise grant was revoked');
select ok(exists (select 1 from audit_logs where action = 'director_scope_saved' and record_id = pg_temp.p('dir_mum2')), 'the scope change is audited');

-- Super Admin makes an employee a Director of Ahmedabad (franchise) plus one Mumbai store.
set local role authenticated;
select pg_temp.login('sa');
select lives_ok($$select save_director_with_audit(pg_temp.p('staff_andheri'), array[pg_temp.b('AHD')], array[pg_temp.b('ANDHERI'), pg_temp.b('AHD1')], null, 'New Director')$$,
  'Super Admin makes an employee a Director');
reset role;
select is((select user_role::text from user_profiles where id = pg_temp.p('staff_andheri')), 'admin', 'the Director holds the Admin role');
select is((select d.name from user_profiles u join departments d on d.id = u.department_id where u.id = pg_temp.p('staff_andheri')), 'Leadership', 'the Director sits in the Leadership department');
select ok((select d.branch_id is null from user_profiles u join departments d on d.id = u.department_id where u.id = pg_temp.p('staff_andheri')), 'Leadership is company-wide');
select is((select designation_id from user_profiles where id = pg_temp.p('staff_andheri')), null, 'the Director has no designation');
select is(pg_temp.reads('staff_andheri'), pg_temp.codes(array['ANDHERI','AHD1','AHD2']), 'franchise and store choices combine');
select is((select count(*)::int from org_scope_grants where user_profile_id = pg_temp.p('staff_andheri') and revoked_at is null and authority = 'director' and scope_level = 'branch'), 1,
  'a store inside a chosen franchise is not stored twice');
select is((select count(*)::int from user_organization_history where user_profile_id = pg_temp.p('staff_andheri')), 1, 'the department change is kept in history');
select is((select count(*)::int from departments where tenant_id = pg_temp.b('tenant') and name = 'Leadership'), 1, 'one Leadership department per company');

-- Ending Director scope makes them a company-wide Admin; leaving the Admin role ends it too.
set local role authenticated;
select pg_temp.login('adm');
select lives_ok($$select end_director_with_audit(pg_temp.p('dir_ahd2'), 'Now Admin')$$, 'an Admin turns a Director into an Admin');
select pg_temp.login('dir_mum');
select throws_ok($$select end_director_with_audit(pg_temp.p('dir_mum2'), 'x')$$, '42501', null, 'a Director cannot widen another Director');
reset role;
select ok(org_has_company_scope(pg_temp.p('dir_ahd2')) and not org_is_director(pg_temp.p('dir_ahd2')), 'the former Director has company scope');
set local role authenticated;
select pg_temp.login('sa');
select lives_ok($$select update_user_profile_with_audit(pg_temp.p('dir_mum'), '{"user_role":"manager"}'::jsonb)$$, 'Super Admin changes a Director''s role');
reset role;
select is((select count(*)::int from org_scope_grants where user_profile_id = pg_temp.p('dir_mum') and revoked_at is null and authority = 'director'), 0,
  'leaving the Admin role revokes Director scope');

-- Directors list for the Users page.
set local role authenticated;
select pg_temp.login('adm');
select ok((list_director_scopes()) @> jsonb_build_array(jsonb_build_object('user_profile_id', pg_temp.p('staff_andheri'))), 'the Users page lists Directors');
select ok(not (list_director_scopes()) @> jsonb_build_array(jsonb_build_object('user_profile_id', pg_temp.p('adm'))), 'an Admin is not listed as a Director');
select pg_temp.login('staff_bandra');
select throws_ok($$select list_director_scopes()$$, '42501', null, 'employees without Users access cannot list Directors');
reset role;

-- ===========================================================================
-- E. Creating a Director account (invite-user, service role)
-- ===========================================================================
create temp table fx_new(kind text primary key, auth_id uuid);
insert into fx_new values ('ok', gen_random_uuid()), ('denied', gen_random_uuid());
insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
select auth_id, 'authenticated', 'authenticated', 'lh-new-' || kind || '@example.in', 'x', now(), now() from fx_new;
grant select on fx_new to service_role, authenticated;
select ok(not has_function_privilege('authenticated', 'create_director_profile_with_audit(uuid,uuid,text,text,text,text,uuid,text,text,text[],uuid[],uuid[])', 'execute'),
  'browsers cannot call the Director creation contract');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($$select create_director_profile_with_audit((select auth_id from fx_new where kind = 'denied'), pg_temp.p('mgr_bandra'), 'lh-new-denied@example.in',
  'Denied', 'Director', '', null, '', null, '{}', array[pg_temp.b('AHD')], '{}')$$, '42501', null, 'a Manager cannot create a Director');
select throws_ok($$select create_director_profile_with_audit((select auth_id from fx_new where kind = 'denied'), pg_temp.p('staff_andheri'), 'lh-new-denied@example.in',
  'Denied', 'Director', '', null, '', null, '{}', array[pg_temp.b('AHD')], '{}')$$, '42501', null, 'a Director cannot create a Director');
select throws_ok($$select create_director_profile_with_audit((select auth_id from fx_new where kind = 'denied'), pg_temp.p('adm'), 'lh-new-denied@example.in',
  'Denied', 'Director', '', null, '', null, '{}', '{}', '{}')$$, '22023', null, 'a new Director needs a franchise or store');
select lives_ok($$select create_director_profile_with_audit((select auth_id from fx_new where kind = 'ok'), pg_temp.p('adm'), 'lh-new-ok@example.in',
  'Yash', 'Test', '', null, '', null, '{}', array[pg_temp.b('AHD')], '{}')$$, 'an Admin creates an Ahmedabad Director');
reset role;
select is((select u.user_role::text || ' ' || d.name from user_profiles u join departments d on d.id = u.department_id where u.auth_user_id = (select auth_id from fx_new where kind = 'ok')),
  'admin Leadership', 'the new Director has the Admin role and the Leadership department');
select is(org_scope_branch_ids((select id from user_profiles where auth_user_id = (select auth_id from fx_new where kind = 'ok')), false), pg_temp.codes(array['AHD1','AHD2']),
  'the new Director reads both Ahmedabad stores only');
select is((select count(*)::int from user_profiles where auth_user_id = (select auth_id from fx_new where kind = 'denied')), 0, 'refused creations saved nothing');

-- ===========================================================================
-- F. Adding franchises and stores
-- ===========================================================================
insert into org_scope_grants(tenant_id, user_profile_id, authority, scope_level, franchise_group_id, reason)
values (pg_temp.b('tenant'), pg_temp.p('adm2'), 'director', 'franchise', pg_temp.b('AHD'), 'fixture');
set local role authenticated;
select pg_temp.login('adm');
select lives_ok($$select save_franchise_group_with_audit(null, '{"name":"Pune","code":"PUN"}'::jsonb)$$, 'an Admin adds a franchise');
select throws_ok($$select save_franchise_group_with_audit(pg_temp.b('MUM'), '{"name":"Mumbai West"}'::jsonb)$$, '42501', null, 'an Admin cannot edit a franchise');
select lives_ok($$select create_branch_in_franchise_with_audit(pg_temp.b('MUM'), '{"name":"Powai store","code":"POWAI95"}'::jsonb)$$, 'an Admin adds a store to any franchise');
select throws_ok($$select save_branch_with_audit(null, '{"name":"Loose store","code":"LOOSE95"}'::jsonb)$$, '42501', null, 'an Admin cannot use the Super Admin branch editor');
select ok((get_org_locations()->>'can_add_franchise')::boolean and jsonb_array_length(get_org_locations()->'addable_franchise_ids') >= 3, 'an Admin may add anywhere');
select pg_temp.login('adm2');
select throws_ok($$select save_franchise_group_with_audit(null, '{"name":"Surat","code":"SUR"}'::jsonb)$$, '42501', null, 'a Director cannot add a franchise');
select lives_ok($$select create_branch_in_franchise_with_audit(pg_temp.b('AHD'), '{"name":"Ahd three","code":"AHD395"}'::jsonb)$$, 'a Director adds a store to their franchise');
select throws_ok($$select create_branch_in_franchise_with_audit(pg_temp.b('MUM'), '{"name":"Not mine","code":"NOTMINE95"}'::jsonb)$$, '42501', null, 'a Director cannot add a store to another franchise');
select throws_ok($$select create_branch_in_franchise_with_audit(pg_temp.b('AHD'), jsonb_build_object('name','With manager','code','MGR95','manager_id',pg_temp.p('staff_ahd1')))$$,
  '22023', null, 'a new store gets its manager later');
select ok(not (get_org_locations()->>'can_add_franchise')::boolean, 'a Director is not offered Add franchise');
select is(get_org_locations()->'addable_franchise_ids', jsonb_build_array(pg_temp.b('AHD')), 'a Director may add stores only to their franchise');
select ok(not exists (select 1 from jsonb_array_elements(get_org_locations()->'branches') x where (x->>'id')::uuid in (pg_temp.b('BANDRA'), pg_temp.b('ANDHERI'))),
  'a Director sees only their franchise''s stores');
select pg_temp.login('staff_bandra');
select throws_ok($$select create_branch_in_franchise_with_audit(pg_temp.b('MUM'), '{"name":"Staff store","code":"STAFF95"}'::jsonb)$$, '42501', null, 'an employee cannot add a store');
select throws_ok($$select get_org_locations()$$, '42501', null, 'an employee cannot read the location list');
reset role;
select is((select franchise_group_id from branches where code = 'AHD395'), pg_temp.b('AHD'), 'the new store belongs to the franchise');
select ok(pg_temp.b('AHD1') = any(pg_temp.reads('adm2')) and (select id from branches where code = 'AHD395') = any(pg_temp.reads('adm2')),
  'the Director covers the new store at once');
select is(current_setting('jewelos.location_create', true), '', 'the store-creation setting does not outlive the call');
select ok(exists (select 1 from audit_logs where action = 'branch_saved' and record_id = (select id from branches where code = 'AHD395')), 'the new store is audited');

select * from finish();
rollback;
