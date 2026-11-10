-- Leaders view every workflow and form design read-only (0401). Synthetic fixtures;
-- every check runs as a signed-in person.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temp table fx(kind text primary key, id uuid, auth_id uuid);
create temp table fx_rec(label text primary key, id uuid);
do $$
declare t uuid; d uuid; b uuid; c text; r record; aid uuid; pid uuid; mum uuid; ahd uuid; f uuid;
begin
  insert into tenants(name, slug) values ('0401 test', 'view-designs-0401') returning id into t;
  insert into franchise_groups(tenant_id, name, code) values (t, 'Mumbai', 'MUM') returning id into mum;
  insert into franchise_groups(tenant_id, name, code) values (t, 'Ahmedabad', 'AHD') returning id into ahd;
  insert into fx_rec values ('MUM', mum), ('AHD', ahd), ('tenant', t);
  foreach c in array array['BANDRA','AHD1'] loop
    perform set_config('jewelos.new_branch_franchise_group_id', (case when c like 'AHD%' then ahd::text else mum::text end), true);
    insert into branches(tenant_id, name, code) values (t, initcap(c) || ' store', c || '01') returning id into b;
    insert into fx_rec values (c, b);
  end loop;
  perform set_config('jewelos.new_branch_franchise_group_id', '', true);
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'Ops', 'OPS0401') returning id into d;
  for r in select * from (values ('sa','super_admin','BANDRA'), ('adm','admin','BANDRA'), ('dir_ahd','admin','AHD1'),
      ('mgr','manager','BANDRA'), ('hr','hr','BANDRA'), ('staff','staff','BANDRA')) v(kind, role, branch) loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'vd-' || r.kind || '@example.in', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (t, aid, (select id from fx_rec where label = r.branch), d, 'VD ' || r.kind, 'VD-' || upper(r.kind), 'vd-' || r.kind || '@example.in',
      r.role::user_role, 'active', 'active', true)
    returning id into pid;
    insert into fx values (r.kind, pid, aid);
  end loop;
  insert into org_scope_grants(tenant_id, user_profile_id, authority, scope_level, franchise_group_id, reason)
  values (t, (select id from fx where kind = 'dir_ahd'), 'director', 'franchise', ahd, 'fixture');

  -- A company-wide draft workflow with one step, and a Mumbai-owned draft workflow.
  f := gen_random_uuid();
  insert into fms_flows(id, family_id, tenant_id, name, status, is_active, created_by)
  values (f, f, t, 'VD company flow', 'draft', true, (select id from fx where kind = 'sa'));
  insert into fx_rec values ('flow', f);
  insert into fms_stages(fms_flow_id, stage_key, name, sort_order)
  values (f, 'call', 'Call the customer', 1);
  f := gen_random_uuid();
  insert into fms_flows(id, family_id, tenant_id, name, status, is_active, owner_franchise_group_id, created_by)
  values (f, f, t, 'VD Mumbai flow', 'draft', true, mum, (select id from fx where kind = 'sa'));
  insert into fx_rec values ('mum_flow', f);

  -- A draft form, an archived form, and a Mumbai-owned draft form.
  foreach c in array array['draft_form','archived_form','mum_form'] loop
    pid := gen_random_uuid();
    insert into form_templates(id, family_id, tenant_id, name, is_active, lifecycle, library_visible, permissions, owner_franchise_group_id)
    values (pid, pid, t, 'VD ' || c, true, 'draft', false, '{"roles":["super_admin"]}', case when c = 'mum_form' then mum end);
    insert into form_fields(form_template_id, field_key, field_name, field_type, sort_order, is_shown, is_editable, is_required)
    values (pid, 'q1', 'Question one', 'text', 0, true, true, false);
    insert into fx_rec values (c, pid);
  end loop;
  update form_templates set lifecycle = 'published', published_at = now() where id = (select id from fx_rec where label = 'archived_form');
  update form_templates set lifecycle = 'archived' where id = (select id from fx_rec where label = 'archived_form');
end $$;
grant select on fx, fx_rec to authenticated, anon;
create function pg_temp.p(k text) returns uuid language sql stable as $$ select id from fx where kind = k $$;
create function pg_temp.r(k text) returns uuid language sql stable as $$ select id from fx_rec where label = k $$;
create function pg_temp.login(k text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', (select auth_id::text from fx where kind = k), true);
$$;
grant execute on function pg_temp.p(text), pg_temp.r(text), pg_temp.login(text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- A. Capabilities by role
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('mgr');
select ok(has_permission('fms.view_designs') and has_permission('forms.view_designs') and has_permission('settings.view_organization')
  and has_permission('dropdowns.view'), 'a Manager views workflow and form designs, organization settings and Dropdown Master');
select ok(not has_permission('forms.manage') and not has_permission('fms.manage') and not has_permission('dropdowns.manage')
  and not has_permission('settings.manage_organization'), 'a Manager no longer authors forms and changes nothing else');
select pg_temp.login('adm');
select ok(has_permission('fms.view_designs') and has_permission('forms.view_designs') and has_permission('settings.view_organization')
  and has_permission('dropdowns.view'), 'an Admin has the same view access');
select ok(not has_permission('forms.manage') and not has_permission('dropdowns.manage'), 'an Admin cannot author forms or dropdowns');
select pg_temp.login('dir_ahd');
select ok(has_permission('fms.view_designs') and has_permission('forms.view_designs'), 'a Director has the same view access');
select pg_temp.login('hr');
select ok(not has_permission('fms.view_designs') and not has_permission('forms.view_designs') and not has_permission('dropdowns.view'),
  'HR is unchanged');
select pg_temp.login('staff');
select ok(not has_permission('fms.view_designs') and not has_permission('forms.view_designs') and not has_permission('settings.view_organization'),
  'staff get no design access');
select pg_temp.login('sa');
select ok(has_permission('forms.manage') and has_permission('fms.view_designs'), 'Super Admin keeps everything');

-- ---------------------------------------------------------------------------
-- B. Workflows: view, never edit
-- ---------------------------------------------------------------------------
select pg_temp.login('mgr');
select is(fms_my_flow_access(pg_temp.r('flow')), 'view', 'a Manager has View on a draft workflow');
select is((select count(*)::int from fms_flows where id = pg_temp.r('flow')), 1, 'a Manager reads the draft workflow');
select is((select count(*)::int from fms_stages where fms_flow_id = pg_temp.r('flow')), 1, 'and its steps');
select ok(exists (select 1 from list_my_fms_flow_access() where family_id = pg_temp.r('flow') and access_level = 'view'),
  'the FMS list offers View workflow');
select ok(not can_edit_fms_flow(pg_temp.r('flow')) and not can_publish_fms_flow(pg_temp.r('flow')), 'View never edits or publishes');
select throws_ok(format($q$select save_fms_flow_draft_with_audit(%L::uuid, '{}'::jsonb, '[]'::jsonb)$q$, pg_temp.r('flow')),
  null, null, 'saving the workflow is refused');
select throws_ok(format($q$select publish_fms_flow_with_audit(%L::uuid)$q$, pg_temp.r('flow')), null, null, 'publishing is refused');
select is((select count(*)::int from fms_flows where id = pg_temp.r('mum_flow')), 1, 'a Manager in Mumbai sees the Mumbai workflow');
select pg_temp.login('dir_ahd');
select is(fms_my_flow_access(pg_temp.r('mum_flow')), null, 'the Ahmedabad Director has no View on a Mumbai-owned workflow');
select is(fms_my_flow_access(pg_temp.r('flow')), 'view', 'but views company workflows');
select pg_temp.login('staff');
select is(fms_my_flow_access(pg_temp.r('flow')), null, 'staff have no View');
select is((select count(*)::int from fms_flows where id = pg_temp.r('flow')), 0, 'staff cannot read a draft workflow');

-- An explicit grant wins over the leader's View.
reset role;
insert into fms_flow_access_grants(tenant_id, family_id, user_profile_id, access_level, granted_by)
values (pg_temp.r('tenant'), pg_temp.r('flow'), pg_temp.p('mgr'), 'edit', pg_temp.p('sa'));
set local role authenticated;
select pg_temp.login('mgr');
select is(fms_my_flow_access(pg_temp.r('flow')), 'edit', 'an explicit Edit grant wins over View');
select ok(can_edit_fms_flow(pg_temp.r('flow')), 'and still lets that person edit');
select is((select count(*)::int from list_my_fms_flow_access() where family_id = pg_temp.r('flow')), 1, 'the workflow is listed once');

-- View shows a workflow's assignees and routes, but never a malformed or cross-tenant one.
reset role;
do $$
declare ot uuid; ob uuid; od uuid; aid uuid := gen_random_uuid(); foreign_person uuid; step uuid;
begin
  insert into tenants(name, slug) values ('0401 other', 'view-designs-0401-other') returning id into ot;
  insert into branches(tenant_id, name, code) values (ot, 'Other store', 'OTH0401') returning id into ob;
  insert into departments(tenant_id, branch_id, name, code) values (ot, null, 'Ops', 'OPS0401O') returning id into od;
  insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
  values (aid, 'authenticated', 'authenticated', 'vd-foreign@example.in', 'x', now(), now());
  insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
  values (ot, aid, ob, od, 'VD foreign', 'VD-FOREIGN', 'vd-foreign@example.in', 'staff', 'active', 'active', true) returning id into foreign_person;
  select id into step from fms_stages where fms_flow_id = (select id from fx_rec where label = 'flow');
  insert into fms_stage_assignees(fms_stage_id, assignee_type, user_profile_id) values (step, 'specific_user', (select id from fx where kind = 'staff'));
  insert into fms_stage_assignees(fms_stage_id, assignee_type, user_profile_id) values (step, 'specific_user', foreign_person);
  insert into fx_rec values ('foreign_person', foreign_person);
end $$;
delete from fms_flow_access_grants where user_profile_id = pg_temp.p('mgr');
set local role authenticated;
select pg_temp.login('mgr');
select is((select count(*)::int from fms_stage_assignees a join fms_stages s on s.id = a.fms_stage_id where s.fms_flow_id = pg_temp.r('flow')
  and a.user_profile_id = pg_temp.p('staff')), 1, 'a viewer sees the step''s assignee');
select is((select count(*)::int from fms_stage_assignees where user_profile_id = pg_temp.r('foreign_person')), 0,
  'but never an assignee from another company');

-- ---------------------------------------------------------------------------
-- C. Forms: drafts and archived versions readable, nothing writable
-- ---------------------------------------------------------------------------
select pg_temp.login('mgr');
select ok(can_access_form_template(pg_temp.r('draft_form')), 'a Manager opens a draft form');
select ok(can_access_form_template(pg_temp.r('archived_form')), 'and an archived form');
select is((select count(*)::int from form_fields where form_template_id = pg_temp.r('draft_form')), 1, 'with its questions');
select ok(not can_manage_form_template(pg_temp.r('draft_form')), 'but cannot manage it');
do $$ begin update form_templates set name = 'changed' where id = pg_temp.r('draft_form'); exception when others then null; end $$;
select is((select name from form_templates where id = pg_temp.r('draft_form')), 'VD draft_form', 'a direct rename changes nothing');
select pg_temp.login('dir_ahd');
select ok(not can_access_form_template(pg_temp.r('mum_form')), 'the Ahmedabad Director cannot open a Mumbai-owned form');
select ok(can_access_form_template(pg_temp.r('draft_form')), 'but opens company forms');
select pg_temp.login('staff');
select ok(not can_access_form_template(pg_temp.r('draft_form')) and not can_access_form_template(pg_temp.r('archived_form')),
  'staff cannot open draft or archived forms');
select pg_temp.login('hr');
select ok(not can_access_form_template(pg_temp.r('draft_form')), 'HR cannot open draft forms');

-- ---------------------------------------------------------------------------
-- D. Dropdown Master and settings stay read-only
-- ---------------------------------------------------------------------------
select pg_temp.login('mgr');
select throws_ok($q$select change_dropdown_with_audit('create', null, 'vd_list', 'One', 'one', 1, true)$q$, null, null,
  'a Manager cannot change Dropdown Master');
select is((select count(*)::int from tenants where id = pg_temp.r('tenant')), 1, 'a Manager reads the organization settings row');
do $$ begin update tenants set name = 'changed' where id = pg_temp.r('tenant'); exception when others then null; end $$;
select is((select name from tenants where id = pg_temp.r('tenant')), '0401 test', 'but cannot change it');
reset role;

select * from finish();
rollback;
