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
  insert into tenants(name, slug) values ('Phase 2 test', 'phase2-test') returning id into t;
  insert into tenants(name, slug) values ('Phase 2 other', 'phase2-other') returning id into ot;
  insert into franchise_groups(tenant_id, name, code, city) values (t, 'Mumbai', 'MUM', 'Mumbai') returning id into mum;
  insert into franchise_groups(tenant_id, name, code, city) values (t, 'Ahmedabad', 'AHD', 'Ahmedabad') returning id into ahd;
  insert into fx_rec values ('MUM', mum), ('AHD', ahd), ('tenant', t);
  foreach c in array array['BANDRA','ANDHERI','ZAVERI','AHD1','AHD2'] loop
    perform set_config('jewelos.new_branch_franchise_group_id', (case when c like 'AHD%' then ahd else mum end)::text, true);
    insert into branches(tenant_id, name, code) values (t, initcap(c) || ' store', c) returning id into b;
    insert into fx_branch values (c, b);
  end loop;
  perform set_config('jewelos.new_branch_franchise_group_id', '', true);
  insert into branches(tenant_id, name, code) values (ot, 'Other store', 'OTH2') returning id into ob;
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'Sales', 'SALES') returning id into d;
  insert into departments(tenant_id, branch_id, name, code) values (ot, ob, 'Sales', 'SALES_OT2') returning id into od;
  for r in select * from (values
      ('sa','super_admin','BANDRA'), ('dir_mum','manager','ANDHERI'), ('adm_ahd','admin','AHD1'),
      ('hr_mum','hr','ZAVERI'), ('mgr_bandra','manager','BANDRA'), ('staff_bandra','staff','BANDRA'),
      ('staff_andheri','staff','ANDHERI'), ('staff_ahd','staff','AHD2'), ('mgr_ahd2','manager','AHD2'),
      ('ot_admin','admin','OTH')) v(kind, role, branch)
  loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'p2-' || r.kind || '@example.in', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (case when r.kind = 'ot_admin' then ot else t end, aid,
      case when r.kind = 'ot_admin' then ob else (select id from fx_branch where code = r.branch) end,
      case when r.kind = 'ot_admin' then od else d end,
      'P2 ' || r.kind, 'P2-' || upper(r.kind), 'p2-' || r.kind || '@example.in', r.role::user_role, 'active', 'active', true)
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

-- ===========================================================================
-- K. Existing behaviour while isolation is off, and existing data.
-- ===========================================================================
select is((select count(*)::int from form_fields where assignment_scope = 'local' and form_template_id <> pg_temp.r('form')),
  (select count(*)::int from form_fields where form_template_id <> pg_temp.r('form')), 'every existing Users question stays local');
select is((select count(*)::int from form_templates where owner_franchise_group_id is not null), 0, 'existing forms stay shared definitions');
select is((select count(*)::int from fms_flows where owner_franchise_group_id is not null), 0, 'existing FMS flows stay shared definitions');
-- Later migrations close every section; keep one pending here to test the lock itself.
update franchise_scope_modules set status = 'pending', pending_reason = 'lock test' where module = 'kiara';
select ok(not franchise_enforcement_supported(), 'isolation stays locked while modules are pending');

set local role authenticated;
select pg_temp.login('dir_mum');
select ok(pg_temp.task_visible('t_ahd2'), 'off: a manager with team rights still reads every branch task as before');
select pg_temp.login('staff_bandra');
select lives_ok(format($$select submit_form_with_audit(%L, jsonb_build_object('local_person', %L), null, null)$$,
  pg_temp.r('form'), pg_temp.p('staff_ahd')), 'off: a local Users question still accepts any active employee');
reset role;

-- ===========================================================================
-- A. Super Admin: coverage, counts, history; the switch stays locked.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('sa');
select is((get_franchise_branch_counts()->>pg_temp.b('BANDRA')::text)::int, 3, 'franchise panel counts active employees per store');
select ok(jsonb_array_length(get_franchise_module_coverage()) >= 10, 'module coverage is listed for the readiness panel');
select throws_ok($$select set_franchise_enforcement_with_audit(true, 'go live')$$, '55000',
  'Franchise isolation cannot be switched on until every module is covered (see Readiness)', 'isolation cannot be switched on while a module is pending');
select lives_ok($$select set_definition_owner_franchise_with_audit('form', (select family_id from form_templates where id = pg_temp.r('form')), null, 'stays shared')$$,
  'Super Admin decides a definition''s owner');
select ok(get_franchise_audit_history(20) @> '[{"action":"definition_owner_franchise_set"}]', 'organisation history lists definition ownership changes');
select pg_temp.login('dir_mum');
select throws_ok($$select get_franchise_branch_counts()$$, '42501', 'Franchise management denied', 'a Director cannot open the Super Admin franchise tools');
reset role;

-- Isolation on for the remaining scenarios (set directly: the API switch is
-- locked until every module is covered).
select pg_temp.isolation(true);

-- ===========================================================================
-- B. Mumbai Director: Mumbai-wide reads, no Ahmedabad.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('dir_mum');
select ok(pg_temp.task_visible('t_bandra') and pg_temp.task_visible('t_andheri'), 'Director reads tasks in every Mumbai store');
select ok(not pg_temp.task_visible('t_ahd2'), 'Director cannot read an Ahmedabad task');
select ok(not can_read_task(pg_temp.r('t_ahd2')), 'Director cannot reach an Ahmedabad task through the predicate either');
select ok(can_read_form_submission(pg_temp.r('sub_bandra')), 'Director reads Mumbai form submissions');
select ok(not can_read_form_submission(pg_temp.r('sub_ahd')), 'Director cannot read Ahmedabad form submissions');
reset role;
select ok(task_in_reporting_scope((select x from user_profiles x where x.id = pg_temp.p('dir_mum')), (select t from task_instances t where t.id = pg_temp.r('t_bandra')), '{}'),
  'Mumbai tasks count in the Director''s dashboard');
set local role authenticated;
select pg_temp.login('dir_mum');
reset role;
select ok(not task_in_reporting_scope((select x from user_profiles x where x.id = pg_temp.p('dir_mum')), (select t from task_instances t where t.id = pg_temp.r('t_ahd2')), '{}'),
  'Ahmedabad tasks never count in the Director''s dashboard');
set local role authenticated;
select pg_temp.login('dir_mum');
reset role;

-- ===========================================================================
-- C. Ahmedabad Regional Admin.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('adm_ahd');
select ok(pg_temp.task_visible('t_ahd2') and not pg_temp.task_visible('t_bandra'), 'Regional Admin reads Ahmedabad tasks only');
reset role;
select ok(not task_in_reporting_scope((select x from user_profiles x where x.id = pg_temp.p('adm_ahd')), (select t from task_instances t where t.id = pg_temp.r('t_bandra')), '{}'),
  'an Admin-role regional authority does not count Mumbai tasks');
set local role authenticated;
select pg_temp.login('adm_ahd');
select throws_ok(format($$select update_user_profile_with_audit(%L, '{"employee_name":"x"}')$$, pg_temp.p('staff_bandra')), '42501', null,
  'Regional Admin cannot edit a Mumbai employee');
select lives_ok(format($$select update_user_profile_with_audit(%L, '{"employee_name":"P2 staff ahd"}')$$, pg_temp.p('staff_ahd')),
  'Regional Admin edits an Ahmedabad employee');
reset role;

-- ===========================================================================
-- D. Bandra Manager / F. Bandra staff.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('mgr_bandra');
select ok(pg_temp.task_visible('t_bandra'), 'Bandra manager reads Bandra tasks');
select ok(not pg_temp.task_visible('t_andheri') and not pg_temp.task_visible('t_ahd2'), 'Bandra manager cannot browse Andheri or Ahmedabad tasks');
select pg_temp.login('staff_bandra');
select ok(pg_temp.task_visible('t_bandra') and not pg_temp.task_visible('t_andheri'), 'staff read their own work only');
select throws_ok($$select get_task_performance_dashboard_v1('{"scope":"team"}')$$, '42501', null, 'staff cannot open team performance');
reset role;

-- ===========================================================================
-- E. Mumbai HR.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('hr_mum');
select is((select count(*)::int from user_profiles where id in (pg_temp.p('staff_bandra'), pg_temp.p('staff_andheri'))), 2, 'Mumbai HR sees employees in every Mumbai store');
select is((select count(*)::int from user_profiles where id = pg_temp.p('staff_ahd')), 0, 'Mumbai HR cannot see Ahmedabad employees');
select ok(not has_permission('franchise.manage'), 'Mumbai HR cannot change franchise or global permissions');
reset role;

-- ===========================================================================
-- G / H. Cross-location and local Users questions.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('staff_bandra');
select ok(list_assignment_locations(jsonb_build_object('kind','form','form_template_id',pg_temp.r('form'),'field_key','assign_to'))->'franchises' @> '[{"name":"Ahmedabad"}]',
  'the cross-location picker lists Ahmedabad');
select is(jsonb_array_length(search_assignment_recipients(jsonb_build_object('kind','form','form_template_id',pg_temp.r('form'),'field_key','assign_to'),
  pg_temp.b('AHD2'), '', 0, 20)->'rows'), 1, 'the picker lists eligible people in the chosen store (staff cannot assign managers, as today)');
select ok(not (search_assignment_recipients(jsonb_build_object('kind','form','form_template_id',pg_temp.r('form'),'field_key','assign_to'),
  pg_temp.b('AHD2'), 'staff', 0, 20)->'rows'->0 ? 'email'), 'the picker returns no email or phone');
select throws_ok(format($$select list_assignment_locations(jsonb_build_object('kind','form','form_template_id',%L,'field_key','local_person'))$$, pg_temp.r('form')),
  '42501', 'This question does not allow employees from other locations', 'a local question cannot open the cross-location picker');
select lives_ok(format($$select submit_form_with_audit(%L, jsonb_build_object('assign_to', %L), null, null)$$, pg_temp.r('form'), pg_temp.p('staff_ahd')),
  'G: Bandra staff assign an Ahmedabad employee through a cross-location question');
reset role;
select ok(pg_temp.p('staff_ahd') = any(org_cross_location_recipients()), 'the validated recipient is available to the work transition in the same transaction');
set local role authenticated;
select pg_temp.login('staff_bandra');
select throws_ok(format($$select submit_form_with_audit(%L, jsonb_build_object('local_person', %L), null, null)$$, pg_temp.r('form'), pg_temp.p('mgr_ahd2')),
  '42501', 'Field local_person names an employee outside your location', 'H: a forged answer on a local question is refused');
select lives_ok(format($$select submit_form_with_audit(%L, jsonb_build_object('local_person', %L), null, null)$$, pg_temp.r('form'), pg_temp.p('staff_andheri')),
  'a local question accepts a colleague in the same franchise');
reset role;
select ok(exists (select 1 from audit_logs l join form_submissions s on s.id = l.record_id
  where l.action = 'cross_location_recipient_selected' and (l.new_value->>'recipient_id')::uuid = pg_temp.p('staff_ahd')
    and (l.new_value->>'origin_franchise_group_id')::uuid = pg_temp.r('MUM') and (l.new_value->>'recipient_franchise_group_id')::uuid = pg_temp.r('AHD')),
  'every cross-location selection is audited against its submission with both locations');
select is((select count(*)::int from audit_logs where action = 'cross_location_recipient_selected'), 1, 'a same-franchise answer is not logged as cross-location');
insert into user_permission_overrides(user_profile_id, tenant_id, permission_key, effect)
values (pg_temp.p('staff_andheri'), (select tenant_id from user_profiles where id = pg_temp.p('staff_andheri')), 'tasks.assign_cross_location', 'deny');
set local role authenticated;
select pg_temp.login('staff_andheri');
select lives_ok(format($$select submit_form_with_audit(%L, jsonb_build_object('assign_to', %L), null, null)$$, pg_temp.r('form'), pg_temp.p('staff_ahd')),
  'the form builder setting alone allows other locations (owner decision 2026-11-06)');
select throws_ok(format($$select submit_form_with_audit(%L, jsonb_build_object('local_person', %L), null, null)$$, pg_temp.r('form'), pg_temp.p('staff_ahd')),
  '42501', null, 'a question without the setting still refuses another franchise''s employee');
reset role;

-- ===========================================================================
-- I. Cross-location task: one task, both owners, no wider access.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('staff_bandra');
select lives_ok(format($$insert into fx_rec values ('x_task', create_delegation_task_with_audit(
  jsonb_build_object('title','Visit Ahmedabad client','planned_datetime',(now()+interval '2 days')::text,'branch_id',%L,'department_id',%L),
  array[%L]::uuid[], '{}'::uuid[], '[]'::jsonb))$$, pg_temp.b('AHD2'), (select department_id from user_profiles where id = pg_temp.p('staff_ahd')), pg_temp.p('staff_ahd')),
  'Bandra staff assign one task to an Ahmedabad employee');
select ok(pg_temp.task_visible('x_task'), 'the creator monitors the handoff');
select throws_ok(format($$select create_delegation_task_with_audit(
  jsonb_build_object('title','Forged','planned_datetime',(now()+interval '2 days')::text,'branch_id',%L,'department_id',%L),
  array[%L]::uuid[], '{}'::uuid[], '[]'::jsonb)$$, pg_temp.b('BANDRA'), (select department_id from user_profiles where id = pg_temp.p('staff_ahd')), pg_temp.p('staff_ahd')),
  null, null, 'a forged request naming the wrong store is refused');
reset role;
select is((select branch_id from task_instances where id = pg_temp.r('x_task')), pg_temp.b('AHD2'), 'the task''s branch is its execution store');
select is((select count(*)::int from task_instances where title = 'Visit Ahmedabad client'), 1, 'the work exists once');
select ok(exists (select 1 from audit_logs where action = 'cross_location_task_assigned' and record_id = pg_temp.r('x_task')), 'the cross-location task is audited');
set local role authenticated;
select pg_temp.login('staff_ahd');
select ok(pg_temp.task_visible('x_task'), 'I: the Ahmedabad assignee opens the exact task');
select ok(not pg_temp.task_visible('t_bandra') and not pg_temp.task_visible('t_andheri'), 'I: the assignee gains no other Mumbai work');
select pg_temp.login('mgr_ahd2');
select ok(pg_temp.task_visible('x_task'), 'Ahmedabad leadership monitors work done by their team');
select pg_temp.login('mgr_bandra');
select ok(pg_temp.task_visible('x_task'), 'Bandra leadership monitors the handoff made from their store');
select pg_temp.login('dir_mum');
select ok(pg_temp.task_visible('x_task') and not pg_temp.task_visible('t_ahd2'), 'the Mumbai Director sees the handoff, not unrelated Ahmedabad work');
select pg_temp.login('staff_andheri');
select ok(not pg_temp.task_visible('x_task'), 'an unrelated Mumbai employee does not see the handoff');
reset role;

-- ===========================================================================
-- J. Reports: each side counts its own; Super Admin counts both.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('sa');
select ok(pg_temp.task_visible('t_bandra') and pg_temp.task_visible('t_ahd2'), 'Super Admin reads both franchises');
reset role;
select ok(task_in_reporting_scope((select x from user_profiles x where x.id = pg_temp.p('sa')), (select t from task_instances t where t.id = pg_temp.r('t_ahd2')), '{}'),
  'Super Admin reports cover both franchises');
set local role authenticated;
select pg_temp.login('sa');
select lives_ok(format($$select get_task_performance_dashboard_v1(jsonb_build_object('scope','team','branch_id',%L))$$, pg_temp.b('AHD2')),
  'Super Admin filters team performance to any franchise store');
select pg_temp.login('dir_mum');
select throws_ok(format($$select get_task_performance_dashboard_v1(jsonb_build_object('scope','team','branch_id',%L))$$, pg_temp.b('AHD2')), '42501', 'Branch filter denied',
  'the Mumbai Director cannot filter performance to an Ahmedabad store');
select lives_ok(format($$select get_task_performance_dashboard_v1(jsonb_build_object('scope','team','branch_id',%L))$$, pg_temp.b('BANDRA')),
  'the Mumbai Director filters performance to a Mumbai store');
select ok(not (get_task_performance_options_v1()->'branches' @> jsonb_build_array(jsonb_build_object('id', pg_temp.b('AHD2')))),
  'the Director''s performance store list has no Ahmedabad store');
reset role;

-- ===========================================================================
-- Definitions: shared forms stay readable; only owners or Super Admin edit.
-- ===========================================================================
set local role authenticated;
select pg_temp.login('adm_ahd');
select ok(can_open_form_from_library(pg_temp.r('form')), 'a shared form opens in every franchise library');
select ok(not can_manage_form_template(pg_temp.r('form')), 'a regional authority cannot manage a shared company form');
reset role;
set local role authenticated;
select pg_temp.login('sa');
select lives_ok(format($$select set_definition_owner_franchise_with_audit('form', (select family_id from form_templates where id = %L), %L, 'Ahmedabad form')$$,
  pg_temp.r('form'), pg_temp.r('AHD')), 'Super Admin gives a published form to Ahmedabad without changing its questions');
reset role;
set local role authenticated;
select pg_temp.login('dir_mum');
select ok(not can_open_form_from_library(pg_temp.r('form')), 'an Ahmedabad-owned form is not in the Mumbai library');
select ok(can_read_form_submission(pg_temp.r('sub_bandra')), 'Mumbai''s own submissions of that form stay readable');
reset role;

-- ===========================================================================
-- L. Revocation takes effect immediately.
-- ===========================================================================
update org_scope_grants set revoked_at = now(), revoke_reason = 'test' where user_profile_id = pg_temp.p('dir_mum');
set local role authenticated;
select pg_temp.login('dir_mum');
select ok(not pg_temp.task_visible('t_bandra'), 'L: a revoked Director loses Mumbai-wide reads at once');
reset role;

select pg_temp.isolation(false);
set local role authenticated;
select pg_temp.login('mgr_bandra');
select ok(pg_temp.task_visible('t_andheri'), 'switching isolation off restores the previous behaviour');
reset role;

select * from finish();
rollback;
