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
  insert into tenants(name, slug) values ('Director speed test', 'director-speed-test') returning id into t;
  insert into franchise_groups(tenant_id, name, code) values (t, 'Mumbai', 'MUM') returning id into mum;
  insert into franchise_groups(tenant_id, name, code) values (t, 'Ahmedabad', 'AHD') returning id into ahd;
  insert into fx_rec values ('MUM', mum), ('AHD', ahd), ('tenant', t);
  foreach c in array array['BANDRA','ANDHERI','AHD1','AHD2'] loop
    perform set_config('jewelos.new_branch_franchise_group_id', (case when c like 'AHD%' then ahd::text else mum::text end), true);
    insert into branches(tenant_id, name, code) values (t, initcap(c) || ' store', c || '99') returning id into b;
    insert into fx_rec values (c, b);
  end loop;
  perform set_config('jewelos.new_branch_franchise_group_id', '', true);
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'Sales', 'SALES99') returning id into d;
  for r in select * from (values
      ('sa','super_admin','BANDRA'), ('adm','admin','ANDHERI'),
      ('dir_ahd','admin','AHD1'), ('dir_mum','admin','BANDRA'), ('dir_store','admin','AHD2'),
      ('mgr_bandra','manager','BANDRA'),
      ('staff_bandra','staff','BANDRA'), ('staff_ahd1','staff','AHD1'), ('staff_ahd2','staff','AHD2')) v(kind, role, branch)
  loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'dsp-' || r.kind || '@example.in', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (t, aid, (select id from fx_rec where label = r.branch), d,
      'DSP ' || r.kind, 'DSP-' || upper(r.kind), 'dsp-' || r.kind || '@example.in', r.role::user_role, 'active', 'active', true)
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

-- ===========================================================================
-- A. Remembered scope answers stay correct inside one transaction.
--    The helpers are internal: run them as the owner with the signed-in identity set.
-- ===========================================================================
select pg_temp.login('dir_ahd');
select ok(not org_branch_visible(pg_temp.b('tenant'), pg_temp.p('dir_ahd'), pg_temp.b('BANDRA'))
  and org_branch_visible(pg_temp.b('tenant'), pg_temp.p('dir_ahd'), pg_temp.b('AHD2')),
  'a Director sees their franchise''s stores only');
select ok(not org_branch_visible(pg_temp.b('tenant'), pg_temp.p('dir_ahd'), pg_temp.b('BANDRA')),
  'the remembered answer is the same on the next call');
select ok(org_scope_enforced(pg_temp.b('tenant')), 'the Director''s session is scoped');

select pg_temp.login('adm');
select ok(not org_scope_enforced(pg_temp.b('tenant')), 'an Admin signed in later in the same transaction is not scoped');
select ok(org_branch_visible(pg_temp.b('tenant'), pg_temp.p('adm'), pg_temp.b('AHD1')), 'the Admin sees every store');
select pg_temp.login('dir_ahd');
select ok(org_scope_enforced(pg_temp.b('tenant')), 'signing the Director back in is scoped again');

-- A grant change in the same transaction is seen straight away.
update org_scope_grants set revoked_at = now(), revoke_reason = 'test' where user_profile_id = pg_temp.p('dir_ahd');
select ok(not org_scope_enforced(pg_temp.b('tenant'))
  and org_branch_visible(pg_temp.b('tenant'), pg_temp.p('dir_ahd'), pg_temp.b('BANDRA')),
  'after the Director grant is revoked, the same transaction sees every store');
update org_scope_grants set revoked_at = null, revoke_reason = null where user_profile_id = pg_temp.p('dir_ahd');
select ok(not org_branch_visible(pg_temp.b('tenant'), pg_temp.p('dir_ahd'), pg_temp.b('BANDRA')),
  'restoring the grant scopes the Director again');

-- A rolled-back change takes its remembered answers with it.
savepoint before_change;
update org_scope_grants set revoked_at = now(), revoke_reason = 'test' where user_profile_id = pg_temp.p('dir_ahd');
select ok(org_branch_visible(pg_temp.b('tenant'), pg_temp.p('dir_ahd'), pg_temp.b('BANDRA')), 'inside the savepoint the Director sees every store');
rollback to savepoint before_change;
select ok(not org_branch_visible(pg_temp.b('tenant'), pg_temp.p('dir_ahd'), pg_temp.b('BANDRA')),
  'after rolling back, the Director is limited again');

-- Moving a person, a store or the switch is seen straight away.
select pg_temp.login('dir_store');
select is(org_scope_branch_ids(pg_temp.p('dir_store'), false), array[pg_temp.b('AHD2')], 'a single-store Director reads one store');
update user_profiles set branch_id = pg_temp.b('BANDRA') where id = pg_temp.p('dir_store');
select ok(pg_temp.b('BANDRA') = any(org_scope_branch_ids(pg_temp.p('dir_store'), false)), 'a new home store is seen at once');
update user_profiles set branch_id = pg_temp.b('AHD2') where id = pg_temp.p('dir_store');
select pg_temp.login('dir_mum');
select ok(not org_branch_visible(pg_temp.b('tenant'), pg_temp.p('dir_mum'), pg_temp.b('AHD1')), 'a Mumbai Director does not see AHD1');
select is(array_length(org_scope_branch_ids(pg_temp.p('dir_mum'), false), 1), 2, 'a Mumbai Director has two stores');
select set_config('jewelos.new_branch_franchise_group_id', pg_temp.b('MUM')::text, true);
insert into branches(tenant_id, name, code) values (pg_temp.b('tenant'), 'Juhu store', 'JUHU99');
select set_config('jewelos.new_branch_franchise_group_id', '', true);
select is(array_length(org_scope_branch_ids(pg_temp.p('dir_mum'), false), 1), 3, 'a store added to Mumbai is seen at once');
select pg_temp.login('mgr_bandra');
select ok(not org_scope_enforced(pg_temp.b('tenant')), 'a Manager is not scoped while isolation is off');
insert into tenant_franchise_controls(tenant_id, enforcement_enabled, change_reason) values (pg_temp.b('tenant'), true, 'test');
select ok(org_scope_enforced(pg_temp.b('tenant')), 'switching isolation on is seen at once');
delete from tenant_franchise_controls where tenant_id = pg_temp.b('tenant');
select ok(not org_scope_enforced(pg_temp.b('tenant')), 'switching it off again is seen at once');

-- ===========================================================================
-- B. Home's recent activity: the same rows as the 0387 rule, read per person.
-- ===========================================================================
insert into audit_logs(tenant_id, actor_user_id, action, module, created_at)
select pg_temp.b('tenant'), case when k = 'none' then null else pg_temp.p(k) end, 'home_' || k, 'test', now() + make_interval(mins => n::int)
from unnest(array['none','staff_bandra','mgr_bandra','staff_ahd1','staff_ahd2','dir_ahd','dir_store','adm']) with ordinality u(k, n);

-- The 0387 rule, evaluated directly as the owner, for comparison.
create function pg_temp.old_activity(k text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc, q.id desc), '[]'::jsonb) from (
    select a.id, a.action, a.module, a.created_at from audit_logs a, user_profiles v
    where v.id = pg_temp.p(k) and a.tenant_id = v.tenant_id
      and (a.actor_user_id = v.id
        or (v.user_role in ('super_admin','admin') and org_record_in_filter(org_branch_filter_for(v.tenant_id, v.id), null, array[a.actor_user_id]))
        or v.user_role = 'manager' and exists (select 1 from user_profiles p where p.id = a.actor_user_id and p.branch_id = v.branch_id))
    order by a.created_at desc, a.id desc limit 8) q;
$$;
create function pg_temp.activity_actions() returns text[] language sql as $$
  select array(select e->>'action' from jsonb_array_elements(get_home_summary('{}')->'recent_activity') e where e->>'module' = 'test' order by 1);
$$;
grant execute on function pg_temp.activity_actions() to authenticated;
create temp table home_expected(k text primary key, old jsonb);
grant select on home_expected to authenticated;

select pg_temp.login('dir_ahd');
insert into home_expected values ('dir_ahd', pg_temp.old_activity('dir_ahd'));
set local role authenticated;
select is(pg_temp.activity_actions(), array['home_dir_ahd','home_dir_store','home_staff_ahd1','home_staff_ahd2'],
  'the Ahmedabad Director''s Home activity shows Ahmedabad people only');
select is(get_home_summary('{}')->'recent_activity', (select old from home_expected where k = 'dir_ahd'),
  'Director: same rows as the previous rule');
reset role;
select pg_temp.login('dir_store');
insert into home_expected values ('dir_store', pg_temp.old_activity('dir_store'));
set local role authenticated;
select is(pg_temp.activity_actions(), array['home_dir_store','home_staff_ahd2'], 'a single-store Director sees that store''s activity');
select is(get_home_summary('{}')->'recent_activity', (select old from home_expected where k = 'dir_store'), 'single-store Director: same rows as before');
reset role;
select pg_temp.login('adm');
insert into home_expected values ('adm', pg_temp.old_activity('adm'));
set local role authenticated;
select ok(pg_temp.activity_actions() @> array['home_none','home_staff_bandra','home_staff_ahd1'], 'an Admin sees the whole company''s activity');
select is(get_home_summary('{}')->'recent_activity', (select old from home_expected where k = 'adm'), 'Admin: same rows as before');
reset role;
select pg_temp.login('mgr_bandra');
insert into home_expected values ('mgr_bandra', pg_temp.old_activity('mgr_bandra'));
set local role authenticated;
select is(pg_temp.activity_actions(), array['home_mgr_bandra','home_staff_bandra'], 'a Manager sees their store''s activity');
select is(get_home_summary('{}')->'recent_activity', (select old from home_expected where k = 'mgr_bandra'), 'Manager: same rows as before');
reset role;
select pg_temp.login('staff_ahd1');
insert into home_expected values ('staff_ahd1', pg_temp.old_activity('staff_ahd1'));
set local role authenticated;
select is(pg_temp.activity_actions(), array['home_staff_ahd1'], 'staff see only their own activity');
select is(get_home_summary('{}')->'recent_activity', (select old from home_expected where k = 'staff_ahd1'), 'staff: same rows as before');
reset role;

-- ===========================================================================
-- C. The helpers stay internal.
-- ===========================================================================
select ok(not has_function_privilege('authenticated', 'org_branch_visible(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'org_scope_branch_ids(uuid,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'org_scope_cache_key(text)', 'execute')
  and not has_function_privilege('authenticated', 'org_scope_cache_bump()', 'execute')
  and not has_function_privilege('anon', 'org_scope_enforced(uuid)', 'execute'),
  'scope helpers are not callable by clients');

select * from finish();
rollback;
