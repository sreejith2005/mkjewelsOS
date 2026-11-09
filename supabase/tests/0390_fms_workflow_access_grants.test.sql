-- Per-workflow FMS access (0390): view / edit / publish grants on one workflow,
-- enforced in the database. Synthetic fixtures; every check runs as a person.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
-- Migration 0397 withdrew fms.manage from Admin by default; this test keeps an Admin as the FMS builder.
update permission_catalog set default_roles = array_append(default_roles, 'admin') where key = 'fms.manage' and not ('admin' = any(default_roles));

create temp table fx(kind text primary key, id uuid, auth_id uuid);
create temp table fx_rec(label text primary key, id uuid);
do $$
declare t uuid; ot uuid; b uuid; ob uuid; d uuid; od uuid; r record; aid uuid; pid uuid; f uuid;
begin
  insert into tenants(name, slug) values ('0390 test', 'fms-access-0390') returning id into t;
  insert into tenants(name, slug) values ('0390 other', 'fms-access-0390-other') returning id into ot;
  insert into branches(tenant_id, name, code) values (t, '0390 store', 'S0390') returning id into b;
  insert into branches(tenant_id, name, code) values (ot, '0390 other store', 'O0390') returning id into ob;
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'Ops', 'OPS0390') returning id into d;
  insert into departments(tenant_id, branch_id, name, code) values (ot, ob, 'Ops', 'OPS0390O') returning id into od;
  insert into fx_rec values ('tenant', t);
  for r in select * from (values ('sa','super_admin'), ('admin','admin'), ('viewer','staff'), ('editor','staff'),
      ('publisher','staff'), ('stranger','staff'), ('leaver','staff'), ('ot_admin','admin')) v(kind, role) loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'fa-' || r.kind || '@example.in', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (case when r.kind = 'ot_admin' then ot else t end, aid, case when r.kind = 'ot_admin' then ob else b end,
      case when r.kind = 'ot_admin' then od else d end, 'FA ' || r.kind, 'FA-' || upper(r.kind), 'fa-' || r.kind || '@example.in',
      r.role::user_role, 'active', 'active', true)
    returning id into pid;
    insert into fx values (r.kind, pid, aid);
  end loop;
  f := gen_random_uuid();
  insert into fms_flows(id, family_id, tenant_id, name, status, is_active, created_by)
  values (f, f, t, 'FA granted flow', 'draft', true, (select id from fx where kind = 'admin'));
  insert into fx_rec values ('flow', f);
  f := gen_random_uuid();
  insert into fms_flows(id, family_id, tenant_id, name, status, is_active, created_by)
  values (f, f, t, 'FA other flow', 'draft', true, (select id from fx where kind = 'admin'));
  insert into fx_rec values ('other_flow', f);
end $$;
grant select on fx, fx_rec to authenticated, anon;
create function pg_temp.p(k text) returns uuid language sql stable as $$ select id from fx where kind = k $$;
create function pg_temp.r(k text) returns uuid language sql stable as $$ select id from fx_rec where label = k $$;
create function pg_temp.login(k text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', (select auth_id::text from fx where kind = k), true);
$$;
create function pg_temp.sees(k text) returns integer language sql stable as $$
  select count(*)::int from fms_flows where id = (select id from fx_rec where label = k);
$$;
grant execute on function pg_temp.p(text), pg_temp.r(text), pg_temp.login(text), pg_temp.sees(text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Contracts
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'grant_fms_flow_access_with_audit(uuid,uuid,text)', 'EXECUTE'), 'anonymous callers cannot grant');
select ok(not has_function_privilege('anon', 'list_fms_flow_access(uuid)', 'EXECUTE'), 'anonymous callers cannot list access');
select ok(not has_table_privilege('authenticated', 'fms_flow_access_grants', 'SELECT'), 'browsers never read the grant table directly');
select ok(not has_table_privilege('authenticated', 'fms_flow_access_grants', 'INSERT'), 'nor write it');

-- ---------------------------------------------------------------------------
-- Before any grant: staff see no drafts and cannot edit or grant.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('viewer');
select is(pg_temp.sees('flow'), 0, 'staff cannot see a draft workflow without a grant');
select ok(not can_edit_fms_flow(pg_temp.r('flow')), 'and cannot edit it');
select throws_ok(format($$select grant_fms_flow_access_with_audit(%L, %L, 'edit')$$, pg_temp.r('flow'), pg_temp.p('viewer')),
  '42501', null, 'staff cannot grant themselves access');
select throws_ok(format($$select list_fms_flow_access(%L)$$, pg_temp.r('flow')), '42501', null, 'nor list who has access');

-- An administrator of another company cannot grant on this workflow.
select pg_temp.login('ot_admin');
select throws_ok(format($$select grant_fms_flow_access_with_audit(%L, %L, 'view')$$, pg_temp.r('flow'), pg_temp.p('viewer')),
  '42501', null, 'another company''s admin cannot grant');

-- ---------------------------------------------------------------------------
-- The workflow manager grants view, edit and publish (audited).
-- ---------------------------------------------------------------------------
select pg_temp.login('admin');
select lives_ok(format($$select grant_fms_flow_access_with_audit(%L, %L, 'view')$$, pg_temp.r('flow'), pg_temp.p('viewer')), 'admin grants view');
select lives_ok(format($$select grant_fms_flow_access_with_audit(%L, %L, 'view')$$, pg_temp.r('flow'), pg_temp.p('editor')), 'admin grants view to the future editor');
select lives_ok(format($$select grant_fms_flow_access_with_audit(%L, %L, 'edit')$$, pg_temp.r('flow'), pg_temp.p('editor')), 'and raises it to edit (one live grant)');
select lives_ok(format($$select grant_fms_flow_access_with_audit(%L, %L, 'publish')$$, pg_temp.r('flow'), pg_temp.p('publisher')), 'admin grants publish');
select lives_ok(format($$select grant_fms_flow_access_with_audit(%L, %L, 'view')$$, pg_temp.r('flow'), pg_temp.p('leaver')), 'admin grants view to a later leaver');
select throws_ok(format($$select grant_fms_flow_access_with_audit(%L, %L, 'owner')$$, pg_temp.r('flow'), pg_temp.p('stranger')),
  '22023', null, 'unknown access levels are refused');
select throws_ok(format($$select grant_fms_flow_access_with_audit(%L, %L, 'view')$$, pg_temp.r('flow'), pg_temp.p('ot_admin')),
  '22023', null, 'people of another company cannot be named');
select is((select count(*)::int from list_fms_flow_access(pg_temp.r('flow'))), 4, 'four people have access');
select is((select access_level from list_fms_flow_access(pg_temp.r('flow')) where user_profile_id = pg_temp.p('editor')), 'edit', 'the editor holds edit');
reset role;
select is((select count(*)::int from audit_logs where action = 'fms_flow_access_granted' and record_id = pg_temp.r('flow')), 5, 'every grant and change is audited');

-- ---------------------------------------------------------------------------
-- View only: reads the workflow, cannot change it through any path.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('viewer');
select is(pg_temp.sees('flow'), 1, 'the viewer opens the draft workflow');
select is(pg_temp.sees('other_flow'), 0, 'but not other workflows');
select ok(not can_edit_fms_flow(pg_temp.r('flow')), 'view does not allow editing');
select throws_ok(format($$select save_fms_flow_draft_with_audit(%L, '{"name":"Viewer rename","scope_type":"tenant"}', '[]')$$, pg_temp.r('flow')),
  '42501', null, 'saving a draft is refused');
select throws_ok(format($$select publish_fms_flow_with_audit(%L)$$, pg_temp.r('flow')), '42501', null, 'publishing is refused');
select throws_ok(format($$update fms_flows set name = 'x' where id = %L$$, pg_temp.r('flow')), '42501', null, 'a direct table write is refused');
select is((select count(*)::int from list_my_fms_flow_access()), 1, 'the viewer sees their own grant');

-- Edit: saves drafts, cannot publish, cannot grant, other workflows untouched.
select pg_temp.login('editor');
select lives_ok(format($$select save_fms_flow_draft_with_audit(%L, '{"name":"Edited by grant","scope_type":"tenant"}', '[]')$$, pg_temp.r('flow')),
  'the editor saves the draft');
select is((select name from fms_flows where id = pg_temp.r('flow')), 'Edited by grant', 'the change is stored');
select throws_ok(format($$select publish_fms_flow_with_audit(%L)$$, pg_temp.r('flow')), '42501', null, 'edit does not allow publishing');
select throws_ok(format($$select set_fms_flow_active_with_audit(%L, false, 'pause')$$, pg_temp.r('flow')), '42501', null, 'nor pausing');
select throws_ok(format($$select save_fms_flow_draft_with_audit(%L, '{"name":"Nope","scope_type":"tenant"}', '[]')$$, pg_temp.r('other_flow')),
  '42501', null, 'an ungranted workflow stays closed');
select throws_ok($$select save_fms_flow_draft_with_audit(null, '{"name":"Brand new","scope_type":"tenant"}', '[]')$$,
  '42501', null, 'a grant never allows creating new workflows');
select throws_ok(format($$select grant_fms_flow_access_with_audit(%L, %L, 'edit')$$, pg_temp.r('flow'), pg_temp.p('stranger')),
  '42501', null, 'an editor cannot hand out access');
select throws_ok(format($$select delete_fms_flow_with_audit(%L, 'x')$$, pg_temp.r('flow')), '42501', null, 'nor delete the workflow');

-- Publish: may publish and pause this workflow only.
select pg_temp.login('publisher');
select ok(can_publish_fms_flow(pg_temp.r('flow')), 'publish grant allows publishing this workflow');
select ok(not can_publish_fms_flow(pg_temp.r('other_flow')), 'and no other');
select ok(not can_manage_fms_flow(pg_temp.r('flow')), 'a publish grant is not full management');
reset role;

-- ---------------------------------------------------------------------------
-- Revocation, deactivation and losing the FMS module switch access off.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('admin');
select lives_ok(format($$select revoke_fms_flow_access_with_audit((select grant_id from list_fms_flow_access(%L) where user_profile_id = %L), 'moved team')$$,
  pg_temp.r('flow'), pg_temp.p('editor')), 'admin revokes the editor');
select pg_temp.login('editor');
select throws_ok(format($$select save_fms_flow_draft_with_audit(%L, '{"name":"After revoke","scope_type":"tenant"}', '[]')$$, pg_temp.r('flow')),
  '42501', null, 'a revoked editor can no longer save');
select is(pg_temp.sees('flow'), 0, 'nor see the draft');
reset role;
select is((select count(*)::int from fms_flow_access_grants where user_profile_id = pg_temp.p('editor') and revoked_at is not null), 1, 'the revoked grant is kept as history');
select is((select count(*)::int from audit_logs where action = 'fms_flow_access_revoked' and record_id = pg_temp.r('flow')), 1, 'revocation is audited');

update user_profiles set account_status = 'inactive' where id = pg_temp.p('leaver');
set local role authenticated;
select pg_temp.login('leaver');
select is(pg_temp.sees('flow'), 0, 'a deactivated person loses access at once');
reset role;

insert into user_permission_overrides(user_profile_id, tenant_id, permission_key, effect)
values (pg_temp.p('publisher'), pg_temp.r('tenant'), 'fms.view', 'deny');
set local role authenticated;
select pg_temp.login('publisher');
select ok(not can_publish_fms_flow(pg_temp.r('flow')), 'taking away the FMS module switches the grant off');
reset role;

-- Super Admin still manages everything.
set local role authenticated;
select pg_temp.login('sa');
select ok(can_manage_fms_flow(pg_temp.r('flow')) and can_publish_fms_flow(pg_temp.r('other_flow')), 'Super Admin manages every workflow');
reset role;

select * from finish();
rollback;
