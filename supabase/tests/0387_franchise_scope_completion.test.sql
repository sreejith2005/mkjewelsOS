-- Franchise scope completion (0387): Task Control, FMS builder, reports and exports,
-- availability, directory views, Kiara, storage, Store Intelligence, cross-store work and the registry.
-- Synthetic fixtures (shared with 0386); every check runs as a signed-in person.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture: Mumbai (Bandra, Andheri, Zaveri) and Ahmedabad (AHD1, AHD2) in one
-- tenant, plus another tenant. Built as postgres; every check runs as a person.
create temp table fx(kind text primary key, id uuid, auth_id uuid, branch_id uuid);
create temp table fx_branch(code text primary key, id uuid);
create temp table fx_rec(label text primary key, id uuid);
do $$
declare t uuid; ot uuid; d uuid; od uuid; b uuid; ob uuid; c text; r record; aid uuid; pid uuid; mum uuid; ahd uuid;
begin
  insert into tenants(name, slug) values ('Phase 3 test', 'phase3-test') returning id into t;
  insert into tenants(name, slug) values ('Phase 3 other', 'phase3-other') returning id into ot;
  insert into franchise_groups(tenant_id, name, code, city) values (t, 'Mumbai', 'MUM', 'Mumbai') returning id into mum;
  insert into franchise_groups(tenant_id, name, code, city) values (t, 'Ahmedabad', 'AHD', 'Ahmedabad') returning id into ahd;
  insert into fx_rec values ('MUM', mum), ('AHD', ahd), ('tenant', t);
  foreach c in array array['BANDRA','ANDHERI','ZAVERI','AHD1','AHD2'] loop
    perform set_config('jewelos.new_branch_franchise_group_id', (case when c like 'AHD%' then ahd else mum end)::text, true);
    insert into branches(tenant_id, name, code) values (t, initcap(c) || ' store', c) returning id into b;
    insert into fx_branch values (c, b);
  end loop;
  perform set_config('jewelos.new_branch_franchise_group_id', '', true);
  insert into branches(tenant_id, name, code) values (ot, 'Other store', 'OTH3') returning id into ob;
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'Sales', 'SALES') returning id into d;
  insert into departments(tenant_id, branch_id, name, code) values (ot, ob, 'Sales', 'SALES_OT3') returning id into od;
  for r in select * from (values
      ('sa','super_admin','BANDRA'), ('dir_mum','manager','ANDHERI'), ('adm_ahd','admin','AHD1'),
      ('hr_mum','hr','ZAVERI'), ('mgr_bandra','manager','BANDRA'), ('staff_bandra','staff','BANDRA'),
      ('staff_andheri','staff','ANDHERI'), ('staff_ahd','staff','AHD2'), ('mgr_ahd2','manager','AHD2'),
      ('ot_admin','admin','OTH')) v(kind, role, branch)
  loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'p3-' || r.kind || '@example.in', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (case when r.kind = 'ot_admin' then ot else t end, aid,
      case when r.kind = 'ot_admin' then ob else (select id from fx_branch where code = r.branch) end,
      case when r.kind = 'ot_admin' then od else d end,
      'P2 ' || r.kind, 'P3-' || upper(r.kind), 'p3-' || r.kind || '@example.in', r.role::user_role, 'active', 'active', true)
    returning id into pid;
    insert into fx values (r.kind, pid, aid, case when r.kind = 'ot_admin' then ob else (select id from fx_branch where code = r.branch) end);
  end loop;
  update branches set manager_id = (select id from fx where kind = 'mgr_bandra') where id = (select id from fx_branch where code = 'BANDRA');
  update branches set manager_id = (select id from fx where kind = 'mgr_ahd2') where id = (select id from fx_branch where code = 'AHD2');
  insert into org_scope_grants(tenant_id, user_profile_id, authority, scope_level, franchise_group_id, reason) values
    (t, (select id from fx where kind = 'dir_mum'), 'director', 'franchise', mum, 'test'),
    -- Since 0397 an Admin limited to one franchise is a Director (an Admin without one sees every franchise).
    (t, (select id from fx where kind = 'adm_ahd'), 'director', 'franchise', ahd, 'test'),
    (t, (select id from fx where kind = 'hr_mum'), 'hr', 'franchise', mum, 'test');
  insert into user_permission_overrides(user_profile_id, tenant_id, permission_key, effect)
  values ((select id from fx where kind = 'dir_mum'), t, 'dashboard.view_team_performance', 'grant');

  -- One task per store, created by that store's staff or manager, doer in the store.
  for r in select * from (values ('t_bandra','BANDRA','staff_bandra'), ('t_andheri','ANDHERI','staff_andheri'),
      ('t_ahd2','AHD2','staff_ahd')) v(label, branch, person) loop
    insert into task_instances(tenant_id, task_type, title, planned_datetime, created_by, branch_id, department_id)
    values (t, 'delegation', 'P2 ' || r.label, now() + interval '1 day', (select id from fx where kind = r.person),
      (select id from fx_branch where code = r.branch), d) returning id into pid;
    insert into task_assignees(task_instance_id, user_profile_id, role_at_task, is_active)
    values (pid, (select id from fx where kind = r.person), 'doer', true);
    insert into fx_rec values (r.label, pid);
  end loop;

  -- A published form with a local and a cross-location Users question.
  pid := gen_random_uuid();
  insert into form_templates(id, family_id, tenant_id, name, is_active, lifecycle, library_visible, permissions)
  values (pid, pid, t, 'P2 lead handoff', true, 'draft', true, '{"roles":["super_admin","admin","manager","crm","staff"]}');
  insert into form_fields(form_template_id, field_key, field_name, field_type, sort_order, is_shown, is_editable, is_required, assignment_scope) values
    (pid, 'assign_to', 'Assign this lead to', 'user_dropdown', 0, true, true, false, 'cross_location'),
    (pid, 'local_person', 'Local person', 'user_dropdown', 1, true, true, false, 'local');
  update form_templates set lifecycle = 'published', published_at = now() where id = pid;
  insert into fx_rec values ('form', pid);
  -- Two submissions, one per franchise.
  insert into form_submissions(tenant_id, form_template_id, submitted_by, branch_id, data, status)
  values (t, pid, (select id from fx where kind = 'staff_bandra'), (select id from fx_branch where code = 'BANDRA'), '{}', 'submitted') returning id into b;
  insert into fx_rec values ('sub_bandra', b);
  insert into form_submissions(tenant_id, form_template_id, submitted_by, branch_id, data, status)
  values (t, pid, (select id from fx where kind = 'staff_ahd'), (select id from fx_branch where code = 'AHD2'), '{}', 'submitted') returning id into b;
  insert into fx_rec values ('sub_ahd', b);
end $$;
grant select, insert, update on fx, fx_branch, fx_rec to authenticated, service_role, anon;
create function pg_temp.p(k text) returns uuid language sql stable as $$ select id from fx where kind = k $$;
create function pg_temp.b(k text) returns uuid language sql stable as $$ select id from fx_branch where code = k $$;
create function pg_temp.r(k text) returns uuid language sql stable as $$ select id from fx_rec where label = k $$;
create function pg_temp.login(k text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', (select auth_id::text from fx where kind = k), true);
$$;
grant execute on function pg_temp.p(text), pg_temp.b(text), pg_temp.r(text), pg_temp.login(text) to authenticated, service_role, anon;
create function pg_temp.isolation(p_on boolean) returns void language sql as $$
  insert into tenant_franchise_controls(tenant_id, enforcement_enabled, change_reason)
  values ((select id from fx_rec where label = 'tenant'), p_on, 'test')
  on conflict (tenant_id) do update set enforcement_enabled = excluded.enforcement_enabled;
$$;
create function pg_temp.task_visible(k text) returns boolean language sql stable as $$
  select exists (select 1 from task_instances where id = (select id from fx_rec where label = k));
$$;
grant execute on function pg_temp.task_visible(text) to authenticated;

-- Extra Phase 3 fixtures: availability rows, a Mumbai-owned workflow, a shared
-- workflow, an export per franchise, a template per franchise.
do $$
declare t uuid := (select id from fx_rec where label = 'tenant'); f uuid; s uuid;
begin
  insert into tenant_section_controls(tenant_id, section_availability) values (t, '{"ask_kiara": true, "sales_recording": true}')
  on conflict (tenant_id) do update set section_availability = tenant_section_controls.section_availability || '{"ask_kiara": true, "sales_recording": true}';
  insert into user_availability(tenant_id, user_profile_id, date, status, logged_by)
  values (t, (select id from fx where kind = 'staff_bandra'), current_date, 'present', (select id from fx where kind = 'staff_bandra')),
         (t, (select id from fx where kind = 'staff_ahd'), current_date, 'present', (select id from fx where kind = 'staff_ahd'));
  f := gen_random_uuid();
  insert into fms_flows(id, family_id, tenant_id, name, status, is_active, owner_franchise_group_id, created_by)
  values (f, f, t, 'P3 Mumbai flow', 'draft', true, (select id from fx_rec where label = 'MUM'), (select id from fx where kind = 'sa'));
  insert into fx_rec values ('flow_mum', f);
  s := gen_random_uuid();
  insert into fms_flows(id, family_id, tenant_id, name, status, is_active, created_by) values (s, s, t, 'P3 shared flow', 'draft', true, (select id from fx where kind = 'sa'));
  insert into fx_rec values ('flow_shared', s);
  insert into export_logs(id, tenant_id, user_profile_id, report_key, request_key, status, object_path, expires_at, completed_at)
  values (gen_random_uuid(), t, (select id from fx where kind = 'staff_bandra'), 'work_register', gen_random_uuid(), 'completed',
          t::text || '/00000000-0000-4000-8000-000000000387/work_register-2026-11-07.csv', now() + interval '1 hour', now());
  insert into task_templates(tenant_id, branch_id, title, task_type, is_active, created_by, default_assignee_type, default_assignee_user_id)
  values (t, (select id from fx_branch where code = 'BANDRA'), 'P3 Bandra template', 'delegation', true,
          (select id from fx where kind = 'mgr_bandra'), 'specific_user', (select id from fx where kind = 'staff_bandra')) returning id into s;
  insert into fx_rec values ('tpl_bandra', s);
end $$;

-- ===========================================================================
-- A. Registry and activation lock.
-- ===========================================================================
select is((select count(*)::int from franchise_scope_modules where status = 'pending'), 0, 'every section is covered');
select ok(franchise_enforcement_supported(), 'the section lock is open; activation still needs Super Admin, a reason and every store mapped');
select ok((select covered_by from franchise_scope_modules where module = 'crm_clients') like 'Owner decision%',
  'CRM customers are shared company-wide by owner decision');
set local role authenticated;
select pg_temp.login('dir_mum');
select throws_ok($$select set_franchise_enforcement_with_audit(true, 'try')$$, '42501', null, 'a Director cannot switch isolation on');
reset role;

-- ===========================================================================
-- B. Isolation off: existing behaviour (Ahmedabad admin still sees every store).
-- ===========================================================================
set local role authenticated;
select pg_temp.login('adm_ahd');
select ok((task_workspace_page('{"subsection":"all","mode":"explore"}', 0, 50)->>'total')::int >= 3, 'off: Task Control lists every store''s tasks');
select ok(exists (select 1 from user_availability where user_profile_id = pg_temp.p('staff_bandra')), 'off: availability of every store, as before');
reset role;

select pg_temp.isolation(true);

-- ===========================================================================
-- C. Task Control, templates, reassignment, task administration.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('adm_ahd');
select is((task_workspace_page('{"subsection":"all","mode":"explore"}', 0, 50)->'ids') @> to_jsonb(array[pg_temp.r('t_bandra')]), false,
  'an Ahmedabad Regional Admin does not list Bandra tasks');
select ok((task_workspace_page('{"subsection":"all","mode":"explore"}', 0, 50)->'ids') @> to_jsonb(array[pg_temp.r('t_ahd2')]),
  'but lists Ahmedabad tasks');
select is((task_workspace_page('{"subsection":"all","mode":"explore"}', 0, 50)->>'total')::int, 1, 'counts are computed after scope');
select ok(not exists (select 1 from task_templates where id = pg_temp.r('tpl_bandra')), 'Bandra templates are hidden');
select throws_ok(format($$update task_templates set title = 'forged' where id = %L$$, pg_temp.r('tpl_bandra')), null, null,
  'a direct template write outside scope is refused or touches nothing');
select throws_ok(format($$select task_reassignment_candidates(%L)$$, pg_temp.p('staff_bandra')), '42501', null,
  'reassignment of a Bandra employee''s work is refused');
select lives_ok(format($$select task_reassignment_candidates(%L)$$, pg_temp.p('staff_ahd')), 'reassignment inside Ahmedabad works');
select throws_ok(format($$select admin_edit_task_with_audit(%L, '{"title":"forged"}')$$, pg_temp.r('t_bandra')), '42501', null,
  'editing a Bandra task through Task Control is refused');
select throws_ok(format($$select admin_delete_task_with_audit(%L, false, 'forged')$$, pg_temp.r('t_bandra')), '42501', null,
  'deleting a Bandra task through Task Control is refused');
select is(jsonb_array_length(coalesce(get_task_template_directory('{}')->'templates', '[]')), 0, 'the template directory lists no Bandra template');
select pg_temp.login('mgr_bandra');
select ok(exists (select 1 from task_templates where id = pg_temp.r('tpl_bandra')), 'the Bandra manager still reads their template');
select pg_temp.login('sa');
select ok((task_workspace_page('{"subsection":"all","mode":"explore"}', 0, 50)->>'total')::int >= 3, 'Super Admin lists every store');
reset role;
select is((select title from task_templates where id = pg_temp.r('tpl_bandra')), 'P3 Bandra template', 'the Bandra template is unchanged');

-- ===========================================================================
-- D. FMS builder ownership, flow reports.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('adm_ahd');
select ok(not can_manage_fms_flow(pg_temp.r('flow_mum')), 'an Ahmedabad admin cannot manage a Mumbai workflow');
select ok(not can_manage_fms_flow(pg_temp.r('flow_shared')), 'nor a shared company workflow');
select throws_ok(format($$select get_fms_flow_report(%L, '{}')$$, pg_temp.r('flow_mum')), '42501', null,
  'the Mumbai workflow''s report is refused');
select pg_temp.login('sa');
select ok(can_manage_fms_flow(pg_temp.r('flow_shared')), 'Super Admin manages shared workflows');
reset role;
-- A direct definition write by an Ahmedabad admin is refused by the table guard.
set local role authenticated;
select pg_temp.login('adm_ahd');
select is((select count(*)::int from fms_flows where id = pg_temp.r('flow_mum')), 0, 'the Mumbai workflow is not even visible');
reset role;

-- ===========================================================================
-- E. Reports, exports, dashboards (scope before aggregation).
-- ===========================================================================
set local role authenticated;
select pg_temp.login('adm_ahd');
select is((get_report_data('form_answers', '{}')->>'total')::int, 1, 'form answers: Ahmedabad submissions only');
select is(((get_dashboard_metrics('{}')->'metrics')->>'form_reviews_pending')::int, 1, 'dashboard pending reviews count Ahmedabad only');
select ok(not exists (select 1 from export_logs where user_profile_id = pg_temp.p('staff_bandra')), 'Bandra exports are not listed');
select ok(not can_read_report_export_object((select id::text from fx_rec where label = 'tenant') || '/00000000-0000-4000-8000-000000000387/work_register-2026-11-07.csv'),
  'nor downloadable');
select pg_temp.login('dir_mum');
select is((get_report_data('form_answers', '{}')->>'total')::int, 1, 'a Mumbai Director (manager role) reads Mumbai submissions only');
select pg_temp.login('sa');
select is((get_report_data('form_answers', '{}')->>'total')::int, 2, 'Super Admin reads both franchises');
reset role;
-- Background export: no signed-in person, the requester's scope applies.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
select is((report_rows_for_profile(pg_temp.p('adm_ahd'), 'form_answers', '{}', 0, 50)->>'total')::int, 1,
  'a background export runs with the requester''s franchise, not company-wide and not empty');

-- ===========================================================================
-- F. Availability, directory views, Kiara.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('adm_ahd');
select ok(not exists (select 1 from user_availability where user_profile_id = pg_temp.p('staff_bandra')), 'Bandra availability is hidden');
select throws_ok(format($$select record_availability_with_audit(%L, current_date, 'absent', 'forged')$$, pg_temp.p('staff_bandra')), '42501', null,
  'marking a Bandra employee absent is refused');
select pg_temp.login('staff_ahd');
select ok(not exists (select 1 from v_task_users where id = pg_temp.p('staff_bandra')), 'the task people list hides other franchises');
select ok(not exists (select 1 from jsonb_array_elements(coalesce(kiara_directory_lookup('P2', 20)->'people', '[]')) x
  where x->>'name' in ('P2 staff_bandra', 'P2 staff_andheri', 'P2 mgr_bandra', 'P2 dir_mum', 'P2 hr_mum', 'P2 sa')),
  'Kiara''s colleague lookup returns no Mumbai employee');
select ok(exists (select 1 from jsonb_array_elements(coalesce(kiara_directory_lookup('P2', 20)->'people', '[]')) x where x->>'name' = 'P2 mgr_ahd2'),
  'but still finds Ahmedabad colleagues');
reset role;

-- ===========================================================================
-- G. Storage.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('adm_ahd');
select ok(not can_write_task_attachment_object((select id::text from fx_rec where label = 'tenant') || '/' || pg_temp.r('t_bandra')::text || '/f.jpg'),
  'an Ahmedabad admin cannot upload into a Bandra task');
select ok(can_write_task_attachment_object((select id::text from fx_rec where label = 'tenant') || '/' || pg_temp.r('t_ahd2')::text || '/f.jpg'),
  'but can into an Ahmedabad task');
reset role;

-- ===========================================================================
-- G2. Store Intelligence: Super Admin sees every store (owner decision).
-- ===========================================================================
set local role authenticated;
select pg_temp.login('sa');
select ok(recorder_can_read(pg_temp.p('staff_ahd'), (select id from fx_rec where label = 'tenant'), pg_temp.b('AHD2')),
  'Super Admin reads an Ahmedabad store''s conversations');
select pg_temp.login('mgr_bandra');
select ok(not recorder_can_read(pg_temp.p('staff_ahd'), (select id from fx_rec where label = 'tenant'), pg_temp.b('AHD2')),
  'a store manager still reads only their own store');
reset role;

-- ===========================================================================
-- H. Cross-store work inside one franchise (explicit, audited).
-- ===========================================================================
set local role authenticated;
select pg_temp.login('mgr_bandra');
select throws_ok(format($$select create_delegation_task_with_audit(
  jsonb_build_object('title','Local rule','planned_datetime',(now()+interval '2 days')::text,'branch_id',%L,'department_id',%L),
  array[%L]::uuid[], '{}'::uuid[], '[]'::jsonb)$$, pg_temp.b('BANDRA'), (select department_id from user_profiles where id = pg_temp.p('staff_andheri')), pg_temp.p('staff_andheri')),
  null, null, 'without naming the store, a manager still assigns only inside their own store');
select lives_ok(format($$insert into fx_rec values ('andheri_task', create_delegation_task_with_audit(
  jsonb_build_object('title','Help at Andheri','planned_datetime',(now()+interval '2 days')::text,'branch_id',%L,'department_id',%L),
  array[%L]::uuid[], '{}'::uuid[], '[]'::jsonb))$$, pg_temp.b('ANDHERI'), (select department_id from user_profiles where id = pg_temp.p('staff_andheri')), pg_temp.p('staff_andheri')),
  'naming another Mumbai store assigns one task to its employee');
select pg_temp.login('staff_andheri');
select ok(pg_temp.task_visible('andheri_task'), 'the Andheri employee opens the task');
reset role;
select ok(exists (select 1 from audit_logs where action = 'cross_location_task_assigned' and record_id = pg_temp.r('andheri_task')),
  'the cross-store task is audited with both stores');
select is((select count(*)::int from task_instances where title = 'Help at Andheri'), 1, 'one task, no duplicate');

-- ===========================================================================
-- I. Revocation.
-- ===========================================================================
update org_scope_grants set revoked_at = now(), revoked_by = pg_temp.p('sa') where user_profile_id = pg_temp.p('adm_ahd');
set local role authenticated;
select pg_temp.login('adm_ahd');
-- 0390: an Admin covers their own store's franchise automatically, so revoking
-- the grant keeps it; the franchise goes once the role no longer confers it.
select ok((task_workspace_page('{"subsection":"all","mode":"explore"}', 0, 50)->'ids') @> to_jsonb(array[pg_temp.r('t_ahd2')]),
  'a revoked Regional Admin with the Admin role keeps their franchise automatically (0390)');
reset role;
update user_profiles set user_role = 'staff' where id = pg_temp.p('adm_ahd');
select is(org_scope_branch_ids(pg_temp.p('adm_ahd'), false), array[pg_temp.b('AHD1')],
  'without the grant and without an Admin role the person keeps only their own store (AHD1)');

select * from finish();
rollback;
