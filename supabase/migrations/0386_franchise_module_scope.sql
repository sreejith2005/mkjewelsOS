-- Franchise module scope (Phase 2): tasks, FMS, forms, dashboards, recipients and
-- cross-location assignment on top of the 0385 foundation.
--
-- Design: docs/architecture/franchise-scope.md ("Phase 2").
--
-- Safety, as in 0385: every rule below is inert while franchise isolation is off
-- (org_scope_enforced() false), so applying this migration changes no existing
-- read or write. Isolation can be switched on only when every module in
-- franchise_scope_modules is 'enforced'; modules this migration does not cover
-- stay 'pending' and keep the switch locked.
--
-- Ownership model (no record is rewritten):
--   * operational records keep their branch_id; franchise = branch's franchise
--   * a task's branch is its execution owner (doers belong to it); its creator's
--     branch is the originating owner; an FMS run's branch is its origin and its
--     stage assignees' branches are the execution owners
--   * form templates and FMS flows gain owner_franchise_group_id: null means a
--     shared company definition (all existing rows), set means one franchise
--   * cross-location work is reached through the work itself (assignee,
--     watcher, creator), never by widening a franchise's data scope
set search_path = public, extensions;

-- Exact-text upgrade helper (the 0156/0235/0348 pattern). Fails loudly when a
-- live body no longer contains the expected text. Temporary: dropped at the end.
create function pg_temp.franchise_patch(p_signature text, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_signature::regprocedure), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0386: expected % match(es) in %, found %: %', p_expected, p_signature, found, left(p_old, 80);
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Module coverage registry (replaces the hard-coded 0385 switch lock)
-- ---------------------------------------------------------------------------

create table franchise_scope_modules (
  module text primary key,
  label text not null,
  status text not null check (status in ('enforced', 'pending')),
  covered_by text,
  pending_reason text,
  updated_at timestamptz not null default now(),
  check ((status = 'enforced') = (pending_reason is null))
);
alter table franchise_scope_modules enable row level security;
revoke all on franchise_scope_modules from public, anon, authenticated;

insert into franchise_scope_modules(module, label, status, covered_by, pending_reason) values
('users', 'Users directory and user management', 'enforced', '0385 directory policies, assert_org_user_write', null),
('tasks', 'Tasks (read access and assignment)', 'enforced', '0386 can_read_task, task_assignment_user_in_scope', null),
('fms_runs', 'FMS runs and handoffs', 'enforced', '0386 can_read_fms_instance, assert_fms_handoff_recipient', null),
('forms', 'Forms Library, definitions and submissions', 'enforced', '0386 can_access_form_template, can_read_form_submission, form_definition_write_guard', null),
('dashboards', 'Dashboard, insights and Employee Task Performance', 'enforced', '0386 reporting helpers, performance context', null),
('notifications', 'Notifications', 'enforced', 'own notifications only (unchanged)', null),
('crm_roster', 'CRM roster (CRM department per franchise)', 'enforced', '0386 crm_sync.staff_roster_fields + CRM 20261107000100', null),
('task_control', 'Task Control, task templates and bulk reassignment', 'pending', null,
  'task_templates read policy, task_reassignment_candidates and Task Control lists still use role scope'),
('fms_builder', 'FMS builder writes and FMS flow reports', 'pending', null,
  'flow saves, get_fms_flow_report/records and trigger history still use role scope'),
('reports_exports', 'Business Reports, saved reports and CSV exports', 'pending', null,
  'report_rows_for_profile form/FMS report types and export_* functions still use role scope'),
('crm_clients', 'CRM project client data (clients, visits, follow-ups, reports, exports)', 'pending', null,
  'every active CRM user still reads all CRM clients; needs franchise columns and CRM RLS in the CRM project'),
('store_intelligence', 'Store Intelligence recordings and sales score', 'pending', null,
  'recording review uses manager branch scope; admin scope is company-wide'),
('storage', 'Signed file URLs and uploads', 'pending', null,
  'task and form files follow the scoped record predicates; FMS context uploads and recording media are not yet reviewed'),
('kiara', 'Ask Kiara and FMS AI tools', 'pending', null,
  'tools read through section RPCs; needs franchise eval cases before activation'),
('search_availability', 'Global search, Availability and Dropdown Master', 'pending', null,
  'availability lists and search suggestions not yet reviewed for franchise scope');

-- Isolation can be switched on only when every module is enforced.
create or replace function franchise_enforcement_supported()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from franchise_scope_modules where status <> 'enforced');
$$;
revoke all on function franchise_enforcement_supported() from public, anon, authenticated;

select pg_temp.franchise_patch('public.set_franchise_enforcement_with_audit(boolean,text)',
  'Franchise isolation cannot be switched on until the Phase 2 module integration is installed',
  'Franchise isolation cannot be switched on until every module is covered (see Readiness)', 1);

-- ---------------------------------------------------------------------------
-- 2. Scope helpers shared by every module
-- ---------------------------------------------------------------------------

-- Franchises a person reads (own branch, managed stores, grants).
create function org_profile_franchise_ids(p_profile_id uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct b.franchise_group_id) filter (where b.franchise_group_id is not null), '{}'::uuid[])
  from branches b where b.id = any(org_scope_branch_ids(p_profile_id, false));
$$;

-- Branch visibility for an explicit actor (report helpers receive the actor as
-- a parameter). Fails closed: no actor while isolation is on sees nothing.
create function org_branch_visible(p_tenant_id uuid, p_actor_id uuid, p_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not org_scope_enforced(p_tenant_id)
    or (p_actor_id is not null and (org_has_company_scope(p_actor_id)
      or (p_branch_id is not null and p_branch_id = any(org_scope_branch_ids(p_actor_id, false)))));
$$;

-- The signed-in person. Work without a session (background report jobs) has
-- no actor, so org_branch_visible() shows it nothing while isolation is on;
-- Business Reports and exports are a pending section in the registry.
create function org_scope_actor()
returns uuid language sql stable security definer set search_path = public as $$
  select (current_profile()).id;
$$;

-- Definitions (form templates, FMS flows): shared (owner null) or owned by one
-- franchise; a definition with a branch also needs that branch in scope.
create function org_definition_visible(p_branch_id uuid, p_owner_franchise_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not org_my_scope_enforced() or org_i_have_company_scope()
    or ((p_owner_franchise_id is null or p_owner_franchise_id = any(org_profile_franchise_ids((current_profile()).id)))
        and (p_branch_id is null or p_branch_id = any(org_my_readable_branch_ids())));
$$;

-- Only company scope edits a shared definition while isolation is on; a
-- franchise authority edits its own franchise's definitions.
create function org_definition_manageable(p_branch_id uuid, p_owner_franchise_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not org_my_scope_enforced() or org_i_have_company_scope()
    or (p_owner_franchise_id is not null and p_owner_franchise_id = any(org_profile_franchise_ids((current_profile()).id))
        and (p_branch_id is null or p_branch_id = any(org_my_readable_branch_ids())));
$$;

-- Local recipient scope: anyone in a franchise the actor reads. This is the
-- franchise-level successor of the company-wide FMS handoff (0318).
create function org_recipient_in_local_scope(p_actor_id uuid, p_recipient_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select not org_scope_enforced(r.tenant_id) or org_has_company_scope(p_actor_id)
      or r.branch_id = any(org_scope_branch_ids(p_actor_id, false))
      or franchise_of_branch(r.branch_id) = any(org_profile_franchise_ids(p_actor_id))
    from user_profiles r join user_profiles a on a.id = p_actor_id and a.tenant_id = r.tenant_id
    where r.id = p_recipient_id), false);
$$;

-- Recipients validated in this transaction through a cross-location Users
-- question (assert_form_user_answer). Transaction-local; clients cannot set it.
create function org_cross_location_recipients()
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v text := nullif(current_setting('jewelos.cross_location_recipients', true), '');
begin
  if v is null then return '{}'::uuid[]; end if;
  return string_to_array(v, ',')::uuid[];
end $$;

create function org_note_cross_location_recipient(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (p_user_id = any(org_cross_location_recipients())) then
    perform set_config('jewelos.cross_location_recipients',
      array_to_string(array_append(org_cross_location_recipients(), p_user_id), ','), true);
  end if;
end $$;

create function org_cross_location_task_active()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('jewelos.assignment_context', true), '') = 'cross_location_task'
    and has_permission('tasks.assign_cross_location') and has_permission('tasks.assign_others');
$$;

-- An employee who may receive work from another store or franchise: active,
-- login-enabled, in an active branch, and allowed by the existing management
-- recipient rule (task_assignment_recipient_allowed).
create function org_cross_location_recipient_eligible(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_profiles u
    join branches b on b.id = u.branch_id and b.tenant_id = u.tenant_id and b.is_active
    where u.id = p_user_id and u.tenant_id = current_tenant_id() and u.removed_at is null
      and u.account_status = 'active' and u.working_status = 'active' and u.is_login_enabled)
    and task_assignment_recipient_allowed(p_user_id);
$$;

-- The franchise rule every assignment path applies on top of its own scope.
create function org_recipient_allowed(p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare a user_profiles := current_profile();
begin
  -- Automated work (service role, triggers without a signed-in person) keeps
  -- the destinations its published configuration chose.
  if a.id is null then return true; end if;
  return org_recipient_in_local_scope(a.id, p_user_id)
    or p_user_id = any(org_cross_location_recipients())
    or (org_cross_location_task_active() and org_cross_location_recipient_eligible(p_user_id));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cross-location assignment capability
-- ---------------------------------------------------------------------------

-- permission-catalog:begin
insert into permission_catalog(key, kind, page_id, default_roles, sort_order) values
('tasks.assign_cross_location', 'action', null, '{super_admin,admin,manager,hr,crm,staff}', 36);
-- permission-catalog:end

-- ---------------------------------------------------------------------------
-- 4. Assignment scope: tasks, FMS handoffs, form answers
-- ---------------------------------------------------------------------------

-- Task recipients: the existing tenant / branch / department scope, plus the
-- franchise boundary; a validated cross-location request replaces the local
-- branch/department limit for that request only.
create or replace function task_assignment_user_in_scope(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select current_profile_is_active() and exists(
    select 1 from user_profiles u
    join branches b on b.id=u.branch_id and b.tenant_id=u.tenant_id and b.is_active
    join departments d on d.id=u.department_id and d.tenant_id=u.tenant_id and d.is_active
    cross join current_profile() a
    where u.id=p_user_id and u.tenant_id=a.tenant_id and u.working_status='active'
      and u.account_status in ('active','invited')
      and (u.account_status='invited' or u.is_login_enabled)
      and (task_assignment_scope()='tenant'
        or (task_assignment_scope()='branch' and u.branch_id=a.branch_id)
        or (task_assignment_scope()='department' and u.department_id=a.department_id)
        or org_cross_location_task_active()
        or u.id = any(org_cross_location_recipients()))
      and org_recipient_allowed(u.id)
  );
$$;

-- A delegation request is cross-location when the author holds the capability,
-- names a store in another (mapped) franchise, and every doer belongs to that
-- store. Inside one franchise today's rules are unchanged (managers: own branch;
-- staff: own department). The mark lasts only until the contract returns; the
-- existing contract then applies every other rule (department, form, checklist,
-- audit).
create function org_begin_cross_location_task(p_payload jsonb, p_doer_ids uuid[], p_watcher_ids uuid[])
returns boolean language plpgsql security definer set search_path = public as $$
declare a user_profiles := current_profile(); v_branch uuid;
begin
  if a.id is null or not current_profile_is_active()
     or not has_permission('tasks.assign_cross_location') or not has_permission('tasks.assign_others') then
    return false;
  end if;
  begin v_branch := nullif(p_payload->>'branch_id', '')::uuid;
  exception when invalid_text_representation then return false; end;
  if v_branch is null or v_branch = a.branch_id or coalesce(cardinality(p_doer_ids), 0) = 0 then return false; end if;
  if franchise_of_branch(v_branch) is null or franchise_of_branch(v_branch) is not distinct from franchise_of_branch(a.branch_id) then
    return false;
  end if;
  if exists (select 1 from unnest(p_doer_ids) d(id)
             where not exists (select 1 from user_profiles u where u.id = d.id and u.tenant_id = a.tenant_id and u.branch_id = v_branch)
                or not org_cross_location_recipient_eligible(d.id)) then
    return false;
  end if;
  -- Watchers stay with the author's own team or the destination store.
  if exists (select 1 from unnest(coalesce(p_watcher_ids, '{}'::uuid[])) w(id)
             where not exists (select 1 from user_profiles u where u.id = w.id and u.tenant_id = a.tenant_id
                               and (u.branch_id = v_branch or org_recipient_in_local_scope(a.id, u.id)))) then
    return false;
  end if;
  perform set_config('jewelos.assignment_context', 'cross_location_task', true);
  return true;
end $$;

select pg_temp.franchise_patch('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)',
  E'begin\n  perform public.assert_module_enabled(''checklist_tasks'');\n  select * into v_actor from current_profile() where auth_user_id = auth.uid();',
  E'begin\n  perform public.assert_module_enabled(''checklist_tasks'');\n  perform public.org_begin_cross_location_task(p_payload, p_doer_ids, p_watcher_ids);\n  select * into v_actor from current_profile() where auth_user_id = auth.uid();', 1);
select pg_temp.franchise_patch('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)',
  E'     or (\n      v_actor.user_role not in (''super_admin'', ''admin'', ''manager'')',
  E'     or (\n      not public.org_cross_location_task_active()\n      and v_actor.user_role not in (''super_admin'', ''admin'', ''manager'')', 1);
select pg_temp.franchise_patch('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)',
  'if task_assignment_scope() = ''branch'' then',
  'if task_assignment_scope() = ''branch'' and not public.org_cross_location_task_active() then', 1);
select pg_temp.franchise_patch('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)',
  E'  return v_task.id;',
  E'  perform set_config(''jewelos.assignment_context'', '''', true);
  return v_task.id;', 1);

-- Every cross-location task is audited with both owners.
create function audit_cross_location_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare a user_profiles := current_profile();
begin
  if coalesce(current_setting('jewelos.assignment_context', true), '') = 'cross_location_task' and a.id is not null then
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
    values (new.tenant_id, a.id, 'cross_location_task_assigned', 'tasks', new.id, jsonb_build_object(
      'origin_branch_id', a.branch_id, 'origin_franchise_group_id', franchise_of_branch(a.branch_id),
      'execution_branch_id', new.branch_id, 'execution_franchise_group_id', franchise_of_branch(new.branch_id)));
  end if;
  return new;
end $$;
create trigger task_instances_cross_location_audit after insert on task_instances
  for each row execute function audit_cross_location_task();

-- FMS explicit handoffs (picker, reassign, revision): the franchise boundary
-- applies; the destination may be another franchise only when a cross-location
-- Users question validated it in this transaction.
create or replace function assert_fms_handoff_recipient(p_user_id uuid, p_tenant_id uuid, p_explicit boolean default true)
returns void language plpgsql stable security definer set search_path = public as $$
declare a user_profiles:=current_profile();
begin
  perform assert_direct_assignment_user(p_user_id,p_tenant_id,'FMS');
  if p_explicit and (a.id is null or a.tenant_id<>p_tenant_id or not current_profile_is_active()) then
    raise exception 'Employee is outside your permitted FMS handoff scope' using errcode='42501';
  end if;
  if p_explicit and not org_recipient_allowed(p_user_id) then
    raise exception 'Employee is in another franchise; use a form that allows other locations' using errcode='42501';
  end if;
end $$;

-- Users questions: where "Allow selecting employees from other locations" is
-- persisted. Only cross_location is ever stored explicitly by the builder.
alter table form_fields add column assignment_scope text not null default 'local'
  check (assignment_scope in ('local', 'cross_location'));
alter table form_fields add constraint form_fields_assignment_scope_users
  check (assignment_scope = 'local' or field_type = 'user_dropdown');

-- One check for a Users answer, used by the submit validator (also behind the
-- FMS transition preview). The field's scope comes from the saved definition,
-- never from the request. A recipient accepted through a cross-location question
-- is marked for this transaction so the work transition that follows may hand
-- off to them; audit_cross_location_answers records it with the submission.
create function assert_form_user_answer(p_tenant_id uuid, p_field_key text, p_scope text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare a user_profiles := current_profile(); v_id uuid;
begin
  v_id := p_value::uuid;
  if not exists (select 1 from user_profiles up where up.id = v_id and up.tenant_id = p_tenant_id and up.working_status = 'active') then
    raise exception 'Field % references an invalid user', p_field_key using errcode = '23503';
  end if;
  if a.id is null or org_recipient_in_local_scope(a.id, v_id) then return; end if;
  -- The form builder's question setting is the switch (owner decision 2026-11-06).
  if p_scope = 'cross_location' and org_cross_location_recipient_eligible(v_id) then
    perform org_note_cross_location_recipient(v_id);
    return;
  end if;
  raise exception 'Field % names an employee outside your location', p_field_key using errcode = '42501';
end $$;

-- Every cross-location answer is audited against its submission, with the
-- origin and destination store and franchise.
create function audit_cross_location_answers(p_submission_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  select s.tenant_id, s.submitted_by, 'cross_location_recipient_selected', 'forms', s.id, jsonb_build_object(
    'form_template_id', s.form_template_id, 'field_key', f.field_key, 'recipient_id', u.id,
    'recipient_branch_id', u.branch_id, 'recipient_franchise_group_id', franchise_of_branch(u.branch_id),
    'origin_branch_id', s.branch_id, 'origin_franchise_group_id', franchise_of_branch(s.branch_id))
  from form_submissions s
  join form_fields f on f.form_template_id = s.form_template_id and f.field_type = 'user_dropdown' and f.assignment_scope = 'cross_location'
  join user_profiles u on u.id::text = s.data->>f.field_key and u.tenant_id = s.tenant_id
  where s.id = p_submission_id and u.id = any(org_cross_location_recipients())
    and not org_recipient_in_local_scope(s.submitted_by, u.id);
$$;

select pg_temp.franchise_patch('public.submit_form_base_with_audit(uuid,jsonb,text,uuid)',
  'if v_field.field_type=''user_dropdown'' and not exists(select 1 from user_profiles up where up.id=v_text::uuid and up.tenant_id=v_actor.tenant_id and up.working_status=''active'') then raise exception ''Field % references an invalid user'',v_field.field_key using errcode=''23503''; end if;',
  'if v_field.field_type=''user_dropdown'' then perform public.assert_form_user_answer(v_actor.tenant_id,v_field.field_key,v_field.assignment_scope,v_text); end if;', 1);
select pg_temp.franchise_patch('public.submit_form_locked_with_audit(uuid,jsonb,text,uuid)',
  E'  returning * into v_submission;
  if array_length(v_file_ids,1) > 0 then',
  E'  returning * into v_submission;
  perform public.audit_cross_location_answers(v_submission.id);
  if array_length(v_file_ids,1) > 0 then', 1);
select pg_temp.franchise_patch('public.fms_validate_candidate_form(uuid,jsonb,text,uuid)',
  'if v_field.field_type=''user_dropdown'' and not exists(select 1 from user_profiles up where up.id=v_text::uuid and up.tenant_id=v_actor.tenant_id and up.working_status=''active'') then raise exception ''Field % references an invalid user'',v_field.field_key using errcode=''23503''; end if;',
  'if v_field.field_type=''user_dropdown'' then perform public.assert_form_user_answer(v_actor.tenant_id,v_field.field_key,v_field.assignment_scope,v_text); end if;', 1);

-- "Assigned To from the form": a saved answer becomes an FMS assignee. Within
-- the run's franchise as before; another franchise only from a cross-location
-- question (validated when the answer was submitted).
select pg_temp.franchise_patch('public.fms_assignment_user_from_submission(uuid,uuid)',
  E'  perform assert_direct_assignment_user(v_user_id,v_submission.tenant_id,''FMS'');\n  return v_user_id;',
  E'  perform assert_direct_assignment_user(v_user_id,v_submission.tenant_id,''FMS'');\n'
  || E'  if org_scope_enforced(v_submission.tenant_id) and v_field.assignment_scope<>''cross_location''\n'
  || E'     and franchise_of_branch((select u.branch_id from user_profiles u where u.id=v_user_id)) is distinct from franchise_of_branch(v_submission.branch_id) then\n'
  || E'    raise exception ''FMS step % assigns an employee in another franchise'',v_stage.name using errcode=''42501'';\n'
  || E'  end if;\n  return v_user_id;', 1);

-- Persist the setting through drafts, publish, revisions and duplicates.
select pg_temp.franchise_patch('public.normalize_form_fields(jsonb,jsonb)',
  'select coalesce(jsonb_agg(value-''branches''),''[]'') into clean from jsonb_array_elements(p_fields);',
  'select coalesce(jsonb_agg(value-''branches''-''assignmentScope''),''[]'') into clean from jsonb_array_elements(p_fields);', 1);
select pg_temp.franchise_patch('public.normalize_form_fields(jsonb,jsonb)',
  '  seen:=array_append(seen,item->>''key''); i:=i+1;',
  E'  if item ? ''assignmentScope'' and item->''assignmentScope''<>''null'' then\n'
  || E'   if jsonb_typeof(item->''assignmentScope'')<>''string'' or item->>''assignmentScope'' not in (''local'',''cross_location'') then raise exception ''Unsupported employee location setting'' using errcode=''22023''; end if;\n'
  || E'   if item->>''assignmentScope''=''cross_location'' then\n'
  || E'    if item->>''type''<>''user_dropdown'' then raise exception ''Only a Users question can allow employees from other locations'' using errcode=''22023''; end if;\n'
  || E'    result:=jsonb_set(result,array[i::text,''assignmentScope''],''"cross_location"'');\n'
  || E'   end if;\n  end if;\n'
  || '  seen:=array_append(seen,item->>''key''); i:=i+1;', 1);
select pg_temp.franchise_patch('public.replace_form_draft_fields(uuid,jsonb)',
  'is_required, options, option_source, dropdown_master_type, conditional_logic, branch_logic, validation, placeholder,',
  'is_required, options, option_source, dropdown_master_type, conditional_logic, branch_logic, assignment_scope, validation, placeholder,', 1);
select pg_temp.franchise_patch('public.replace_form_draft_fields(uuid,jsonb)',
  'coalesce(v_field->''rule'', v_field->''condition''), v_field->''branches'',',
  'coalesce(v_field->''rule'', v_field->''condition''), v_field->''branches'', coalesce(v_field->>''assignmentScope'', ''local''),', 1);
select pg_temp.franchise_patch('public.create_form_revision_with_audit(uuid,jsonb)',
  'conditional_logic,branch_logic,', 'conditional_logic,branch_logic,assignment_scope,', 2);
select pg_temp.franchise_patch('public.duplicate_form_with_audit(uuid,text)',
  'conditional_logic, branch_logic, sort_order', 'conditional_logic, branch_logic, assignment_scope, sort_order', 2);

-- ---------------------------------------------------------------------------
-- 5. Read scope
-- ---------------------------------------------------------------------------

-- A task is in a leader's scope through its branch (execution owner), its
-- creator's branch (originating owner) or an assignee of their own team.
create function org_task_in_my_scope(p_task_id uuid, p_branch_id uuid, p_created_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when not org_my_scope_enforced() then true else
    org_branch_in_data_scope(p_branch_id)
    or exists (select 1 from user_profiles c where c.id = p_created_by and c.branch_id = any(org_my_readable_branch_ids()))
    or exists (select 1 from task_assignees ta join user_profiles u on u.id = ta.user_profile_id
               where ta.task_instance_id = p_task_id and ta.is_active and u.branch_id = any(org_my_readable_branch_ids())) end;
$$;

create or replace function can_read_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select current_profile_is_active() and exists (
    select 1 from task_instances ti where ti.id=p_task_id
    and ti.tenant_id=current_tenant_id() and ti.deleted_at is null
    and (ti.created_by=(current_profile()).id or is_task_participant(ti.id) or is_task_watcher(ti.id)
      or ((has_permission('tasks.view_all') or has_permission('tasks.manage_team'))
          and org_task_in_my_scope(ti.id, ti.branch_id, ti.created_by)))
  );
$$;

create function org_fms_instance_in_my_scope(p_instance_id uuid, p_branch_id uuid, p_started_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when not org_my_scope_enforced() then true else
    org_branch_in_data_scope(p_branch_id)
    or exists (select 1 from user_profiles s where s.id = p_started_by and s.branch_id = any(org_my_readable_branch_ids()))
    or exists (select 1 from fms_instance_stages st join fms_instance_stage_assignees x on x.fms_instance_stage_id = st.id and x.is_active
               join user_profiles u on u.id = x.user_profile_id
               where st.fms_instance_id = p_instance_id and u.branch_id = any(org_my_readable_branch_ids())) end;
$$;

create or replace function can_read_fms_instance(p_instance_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from fms_instances i join user_profiles actor on actor.auth_user_id=auth.uid()
    where i.id=p_instance_id and i.tenant_id=actor.tenant_id and actor.working_status not in ('inactive','resigned') and actor.is_login_enabled
      and (i.started_by=actor.id or exists(select 1 from fms_instance_stages s where s.fms_instance_id=i.id and actor.id=any(s.assigned_to))
        or (actor.user_role in ('super_admin','admin') and org_fms_instance_in_my_scope(i.id,i.branch_id,i.started_by))
        or (actor.user_role='manager' and (i.branch_id=actor.branch_id
          or (org_scope_enforced(actor.tenant_id) and org_fms_instance_in_my_scope(i.id,i.branch_id,i.started_by)))))
  );
$$;

create or replace function can_read_form_submission(p_submission_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select current_profile_is_active() and exists (
    select 1 from form_submissions fs
    where fs.id = p_submission_id and fs.tenant_id = current_tenant_id()
      and (
        fs.submitted_by = (current_profile()).id
        or (current_role_level() in ('super_admin','admin') and org_branch_in_data_scope(fs.branch_id))
        or (current_role_level() = 'manager' and (fs.branch_id = current_branch_id()
          or (org_my_scope_enforced() and fs.branch_id = any(org_my_readable_branch_ids()))))
        or (fs.linked_module in ('checklist_task','delegation_task') and exists (
          select 1 from task_instances ti join task_assignees ta on ta.task_instance_id = ti.id
          where ti.id = fs.linked_record_id and ti.tenant_id = fs.tenant_id
            and ta.user_profile_id = (current_profile()).id and ta.is_active and ta.role_at_task = 'doer'
        ))
      )
  );
$$;

-- Definition ownership. Existing rows stay shared (null).
alter table form_templates add column owner_franchise_group_id uuid;
alter table form_templates add constraint form_templates_owner_franchise_fk
  foreign key (tenant_id, owner_franchise_group_id) references franchise_groups(tenant_id, id) on delete restrict;
alter table fms_flows add column owner_franchise_group_id uuid;
alter table fms_flows add constraint fms_flows_owner_franchise_fk
  foreign key (tenant_id, owner_franchise_group_id) references franchise_groups(tenant_id, id) on delete restrict;

-- A new definition (or revision) inherits its family's owner; one made by a
-- franchise authority while isolation is on belongs to their franchise.
create function set_definition_owner_franchise()
returns trigger language plpgsql security definer set search_path = public as $$
declare a user_profiles := current_profile(); v_family_owner uuid; v_family_exists boolean;
begin
  if new.owner_franchise_group_id is not null then return new; end if;
  if tg_table_name = 'form_templates' then
    select bool_or(true), (array_agg(t.owner_franchise_group_id order by t.created_at desc))[1] into v_family_exists, v_family_owner
    from form_templates t where t.family_id = new.family_id and t.id <> new.id and t.tenant_id = new.tenant_id;
  else
    select bool_or(true), (array_agg(f.owner_franchise_group_id order by f.created_at desc))[1] into v_family_exists, v_family_owner
    from fms_flows f where f.family_id = new.family_id and f.id <> new.id and f.tenant_id = new.tenant_id;
  end if;
  if coalesce(v_family_exists, false) then
    new.owner_franchise_group_id := v_family_owner;
  elsif a.id is not null and org_scope_enforced(new.tenant_id) and not org_has_company_scope(a.id) then
    new.owner_franchise_group_id := franchise_of_branch(a.branch_id);
  end if;
  return new;
end $$;
create trigger form_templates_owner_franchise before insert on form_templates
  for each row execute function set_definition_owner_franchise();
create trigger fms_flows_owner_franchise before insert on fms_flows
  for each row execute function set_definition_owner_franchise();

-- Definition writes by a signed-in person (builder, revisions, archive): only
-- definitions they may manage. Automated writes (no person) are unaffected.
create function form_definition_write_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare a user_profiles := current_profile(); t form_templates; v_template uuid;
begin
  if a.id is null or not org_scope_enforced(a.tenant_id) or org_has_company_scope(a.id) then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'form_fields' then
    v_template := coalesce(new.form_template_id, old.form_template_id);
    select * into t from form_templates where id = v_template;
  elsif tg_op = 'INSERT' then
    t := new;
  else
    -- Only definition columns are guarded; usage bookkeeping is not.
    if (new.name, new.description, new.permissions, new.lifecycle, new.library_visible, new.is_active, new.branch_id, new.owner_franchise_group_id)
       is not distinct from (old.name, old.description, old.permissions, old.lifecycle, old.library_visible, old.is_active, old.branch_id, old.owner_franchise_group_id) then
      return new;
    end if;
    t := old;
  end if;
  if t.id is not null and not org_definition_manageable(t.branch_id, t.owner_franchise_group_id) then
    raise exception 'This form belongs to another franchise or is shared company-wide; only its owner or Super Admin can change it' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger form_templates_write_guard before insert or update on form_templates
  for each row execute function form_definition_write_guard();
create trigger form_fields_write_guard before insert or update or delete on form_fields
  for each row execute function form_definition_write_guard();

create or replace function can_manage_form_template(p_template_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select current_profile_is_active() and exists (
    select 1 from form_templates ft
    where ft.id = p_template_id and ft.tenant_id = current_tenant_id()
      and has_permission('forms.manage') and org_definition_manageable(ft.branch_id, ft.owner_franchise_group_id)
  );
$$;

create or replace function can_open_form_from_library(p_template_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select current_profile_is_active() and exists (
    select 1 from form_templates ft
    where ft.id=p_template_id and ft.tenant_id=current_tenant_id()
      and ft.lifecycle='published' and ft.is_active
      and (ft.library_visible or has_permission('forms.manage'))
      and current_role_level() in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
      and (current_role_level() in ('super_admin','admin') or (ft.permissions->'roles') ? current_role_level()::text)
      and org_definition_visible(ft.branch_id, ft.owner_franchise_group_id)
  );
$$;

-- Library and builder access follow definition visibility; access through
-- assigned work (task, FMS starter, FMS step) or a readable submission is a
-- narrow work grant and does not depend on the definition's franchise.
create or replace function can_access_form_template(p_template_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select current_profile_is_active() and exists (
    select 1 from form_templates ft
    where ft.id=p_template_id and ft.tenant_id=current_tenant_id() and (
      ((has_permission('forms.manage') or can_open_form_from_library(ft.id)) and org_definition_visible(ft.branch_id, ft.owner_franchise_group_id))
      or (ft.lifecycle='draft' and has_permission('forms.manage') and org_definition_visible(ft.branch_id, ft.owner_franchise_group_id))
      or (ft.lifecycle='archived' and can_manage_form_template(ft.id))
      or exists(select 1 from form_submissions fs where fs.form_template_id=ft.id and can_read_form_submission(fs.id))
      or (ft.published_at is not null and ft.lifecycle in ('published','archived') and exists (
        select 1 from task_instances ti join task_assignees ta on ta.task_instance_id=ti.id
        where ti.tenant_id=ft.tenant_id and ti.form_template_id=ft.id and ti.requires_form
          and ta.user_profile_id=(current_profile()).id and ta.is_active
      ))
      or (ft.published_at is not null and ft.lifecycle in ('published','archived') and exists (
        select 1 from fms_starter_assignments a where a.tenant_id=ft.tenant_id
          and a.form_template_id=ft.id and a.user_profile_id=(current_profile()).id and a.status='pending'
      ))
      or (ft.published_at is not null and ft.lifecycle in ('published','archived') and exists (
        select 1 from fms_stages stage
          join fms_instance_stages work on work.fms_stage_id=stage.id
          join fms_instances instance on instance.id=work.fms_instance_id
        where instance.tenant_id=ft.tenant_id and stage.form_template_id=ft.id
          and work.status in ('pending','in_progress','in_review','overdue')
          and instance.status in ('active','overdue','on_hold')
          and ((current_profile()).id=any(work.assigned_to) or exists (
            select 1 from fms_instance_stage_assignees assignee
            where assignee.fms_instance_stage_id=work.id and assignee.user_profile_id=(current_profile()).id and assignee.is_active))
      ))
    )
  );
$$;

-- FMS flows: the role rule as before, limited to visible definitions.
drop policy flow_select on fms_flows;
create policy flow_select on fms_flows for select to authenticated using (
  (select current_profile_is_active()) and tenant_id = (select current_tenant_id())
  and ((select current_role_level()) = any (array['super_admin'::user_role, 'admin'::user_role])
       or (status = 'published'::fms_flow_status and is_active and (branch_id is null or branch_id = (select current_branch_id()))))
  and org_definition_visible(branch_id, owner_franchise_group_id)
);

-- ---------------------------------------------------------------------------
-- 6. Dashboards, insights and Employee Task Performance
-- ---------------------------------------------------------------------------

create or replace function task_in_reporting_scope(p_actor user_profiles, p_task task_instances, p_context jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select p_task.tenant_id=p_actor.tenant_id
    and ((p_context->>'branch_id') is null or p_task.branch_id=(p_context->>'branch_id')::uuid)
    and ((p_context->>'department_id') is null or p_task.department_id=(p_context->>'department_id')::uuid)
    and (
      (p_actor.user_role in ('super_admin','admin') and org_branch_visible(p_actor.tenant_id, p_actor.id, p_task.branch_id))
      or p_actor.user_role='manager' and (p_task.branch_id=p_actor.branch_id
        or (org_scope_enforced(p_actor.tenant_id) and p_task.branch_id = any(org_scope_branch_ids(p_actor.id, false))))
      or exists(select 1 from task_assignees ta where ta.task_instance_id=p_task.id and ta.user_profile_id=p_actor.id and ta.is_active)
    )
    and ((p_context->>'user_profile_id') is null or exists(select 1 from task_assignees ta where ta.task_instance_id=p_task.id and ta.user_profile_id=(p_context->>'user_profile_id')::uuid and ta.is_active));
$$;

-- A stage counts once per viewer: through its run's branch (origin) or, for a
-- cross-location step, through its assignee's branch (execution).
create or replace function fms_stage_in_reporting_scope(p_actor user_profiles, p_stage_id uuid, p_context jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id
    where fis.id=p_stage_id and fi.tenant_id=p_actor.tenant_id
      and ((p_context->>'branch_id') is null or fi.branch_id=(p_context->>'branch_id')::uuid)
      and ((p_context->>'department_id') is null or fi.department_id=(p_context->>'department_id')::uuid)
      and ((p_actor.user_role in ('super_admin','admin') and (org_branch_visible(p_actor.tenant_id, p_actor.id, fi.branch_id)
             or exists(select 1 from fms_instance_stage_assignees a join user_profiles u on u.id=a.user_profile_id
                       where a.fms_instance_stage_id=fis.id and a.is_active and org_scope_enforced(p_actor.tenant_id)
                         and org_branch_visible(p_actor.tenant_id, p_actor.id, u.branch_id))))
        or p_actor.user_role='manager' and (fi.branch_id=p_actor.branch_id
          or (org_scope_enforced(p_actor.tenant_id) and fi.branch_id = any(org_scope_branch_ids(p_actor.id, false))))
        or exists(select 1 from fms_instance_stage_assignees a where a.fms_instance_stage_id=fis.id and a.user_profile_id=p_actor.id and a.is_active))
      and ((p_context->>'user_profile_id') is null or exists(select 1 from fms_instance_stage_assignees a where a.fms_instance_stage_id=fis.id and a.user_profile_id=(p_context->>'user_profile_id')::uuid and a.is_active)));
$$;

create or replace function client_in_reporting_scope(p_actor user_profiles, p_client_id uuid, p_context jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from clients cl where cl.id=p_client_id and cl.tenant_id=p_actor.tenant_id and cl.status<>'merged'
    and ((p_context->>'branch_id') is null or cl.branch_id=(p_context->>'branch_id')::uuid)
    and (p_actor.user_role in ('super_admin','admin')
      or p_actor.user_role='manager' and cl.branch_id=p_actor.branch_id
      or p_actor.user_role='crm' and (cl.assigned_crm_id=p_actor.id or cl.branch_id=p_actor.branch_id or exists(select 1 from client_assignments ca where ca.client_id=cl.id and ca.user_profile_id=p_actor.id and ca.is_active))));
$$;

-- Leaders with the manager role (Directors, Store Managers) read every store in
-- their scope while isolation is on; before that, their own branch as today.
-- Team performance: filters must name branches and people in scope; rows are
-- limited to people in scope before any aggregate (each row is one assignee,
-- so a cross-location task is never counted twice for one viewer).
select pg_temp.franchise_patch('public.task_performance_context_v1(jsonb)',
  E'    if v_user is not null and not exists(select 1 from user_profiles u where u.id=v_user and u.tenant_id=a.tenant_id) then\n      raise exception ''Employee filter denied'' using errcode=''42501''; end if;',
  E'    if v_user is not null and not exists(select 1 from user_profiles u where u.id=v_user and u.tenant_id=a.tenant_id) then\n      raise exception ''Employee filter denied'' using errcode=''42501''; end if;\n'
  || E'    if v_branch is not null and not org_branch_visible(a.tenant_id,a.id,v_branch) then\n      raise exception ''Branch filter denied'' using errcode=''42501''; end if;\n'
  || E'    if v_user is not null and not org_branch_visible(a.tenant_id,a.id,(select u.branch_id from user_profiles u where u.id=v_user)) then\n      raise exception ''Employee filter denied'' using errcode=''42501''; end if;', 1);
select pg_temp.franchise_patch('public.performance_work_rows_v1(uuid,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid,text,boolean)',
  'and (p_branch is null or u.branch_id=p_branch) and (p_department is null or u.department_id=p_department)',
  'and (p_branch is null or u.branch_id=p_branch) and (p_department is null or u.department_id=p_department) and public.org_branch_visible(p_tenant,public.org_scope_actor(),u.branch_id)', 2);
select pg_temp.franchise_patch('public.get_task_performance_dashboard_v1(jsonb)',
  'and (v_branch is null or u.branch_id=v_branch) and (v_dept is null or u.department_id=v_dept) and (v_user is null or u.id=v_user)',
  'and (v_branch is null or u.branch_id=v_branch) and (v_dept is null or u.department_id=v_dept) and (v_user is null or u.id=v_user) and org_branch_visible(v_tenant,org_scope_actor(),u.branch_id)', 2);
select pg_temp.franchise_patch('public.get_task_performance_options_v1()',
  'from branches b where b.tenant_id=a.tenant_id and b.is_active)',
  'from branches b where b.tenant_id=a.tenant_id and b.is_active and org_branch_visible(a.tenant_id,a.id,b.id))', 1);
select pg_temp.franchise_patch('public.get_task_performance_options_v1()',
  'from user_profiles u where u.tenant_id=a.tenant_id and u.working_status not in (''inactive'',''resigned'') and u.is_login_enabled and u.account_status=''active'')',
  'from user_profiles u where u.tenant_id=a.tenant_id and u.working_status not in (''inactive'',''resigned'') and u.is_login_enabled and u.account_status=''active'' and org_branch_visible(a.tenant_id,a.id,u.branch_id))', 1);

-- ---------------------------------------------------------------------------
-- 7. Cross-location recipient lookup (bounded, projected)
-- ---------------------------------------------------------------------------

-- p_context: {"kind":"form","form_template_id":..,"field_key":..} for a Users
-- question that allows other locations, or {"kind":"task"} for task assignment.
create function assert_cross_location_lookup(p_context jsonb)
returns user_profiles language plpgsql stable security definer set search_path = public as $$
declare a user_profiles := current_profile(); v_kind text; v_template uuid; v_key text;
begin
  if a.id is null or not current_profile_is_active() then raise exception 'Active profile required' using errcode = '42501'; end if;
  if p_context is null or jsonb_typeof(p_context) <> 'object' or p_context - array['kind','form_template_id','field_key'] <> '{}'::jsonb then
    raise exception 'Lookup context is invalid' using errcode = '22023';
  end if;
  v_kind := p_context->>'kind';
  if v_kind = 'task' then
    if not has_permission('tasks.assign_cross_location') then
      raise exception 'Assigning work to other locations is not allowed for you' using errcode = '42501';
    end if;
    perform assert_module_access('tasks');
    if not has_permission('tasks.assign_others') then raise exception 'Assigning tasks to other users is denied' using errcode = '42501'; end if;
  elsif v_kind = 'form' then
    begin v_template := (p_context->>'form_template_id')::uuid;
    exception when invalid_text_representation then raise exception 'Lookup context is invalid' using errcode = '22023'; end;
    v_key := p_context->>'field_key';
    if not exists (select 1 from form_templates ft join form_fields f on f.form_template_id = ft.id
                   where ft.id = v_template and ft.tenant_id = a.tenant_id and ft.published_at is not null and ft.lifecycle = 'published'
                     and f.field_key = v_key and f.field_type = 'user_dropdown' and f.assignment_scope = 'cross_location')
       or not can_access_form_template(v_template) then
      raise exception 'This question does not allow employees from other locations' using errcode = '42501';
    end if;
  else
    raise exception 'Lookup context is invalid' using errcode = '22023';
  end if;
  return a;
end $$;

-- Locations only: franchise and store names. Unmapped active stores are listed
-- under a null franchise ("Other locations") until the owner maps them.
create function list_assignment_locations(p_context jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  a := assert_cross_location_lookup(p_context);
  return jsonb_build_object(
    'own_branch_id', a.branch_id,
    'own_franchise_group_id', franchise_of_branch(a.branch_id),
    'franchises', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'branches', x.branches) order by x.sort_key, x.name)
      from (
        select f.id, f.name, 0 sort_key, jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name) branches
        from franchise_groups f join branches b on b.franchise_group_id = f.id and b.is_active
        where f.tenant_id = a.tenant_id and f.is_active group by f.id, f.name
        union all
        select null, 'Other locations', 1, jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name)
        from branches b where b.tenant_id = a.tenant_id and b.is_active and b.franchise_group_id is null
        having count(*) > 0
      ) x), '[]'::jsonb));
end $$;

-- One store at a time, at most 50 rows: id, name, designation, store and
-- franchise names. No phone, email, HR or profile details.
create function search_assignment_recipients(p_context jsonb, p_branch_id uuid, p_search text, p_offset integer, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles; v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50); v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), ''); v_rows jsonb;
begin
  a := assert_cross_location_lookup(p_context);
  if p_branch_id is null or not exists (select 1 from branches b where b.id = p_branch_id and b.tenant_id = a.tenant_id and b.is_active) then
    raise exception 'Choose an active store' using errcode = '22023';
  end if;
  if v_search is not null and length(v_search) > 80 then raise exception 'Search is too long' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(q.r order by q.n, q.id), '[]'::jsonb) into v_rows from (
    select u.employee_name n, u.id, jsonb_build_object('id', u.id, 'name', u.employee_name, 'designation', dm.label,
      'branch_id', b.id, 'branch_name', b.name, 'franchise_group_id', f.id, 'franchise_name', f.name) r
    from user_profiles u join branches b on b.id = u.branch_id
    left join franchise_groups f on f.id = b.franchise_group_id
    left join dropdown_masters dm on dm.id = u.designation_id
    where u.tenant_id = a.tenant_id and u.branch_id = p_branch_id
      and (v_search is null or u.employee_name ilike '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%')
      and org_cross_location_recipient_eligible(u.id)
    order by u.employee_name, u.id offset v_offset limit v_limit + 1) q;
  if jsonb_array_length(v_rows) > v_limit then
    return jsonb_build_object('rows', v_rows - v_limit, 'has_more', true);
  end if;
  return jsonb_build_object('rows', v_rows, 'has_more', false);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Franchise administration additions
-- ---------------------------------------------------------------------------

-- Active employees per branch (counts only) for the franchise panel.
create function get_franchise_branch_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  a := assert_franchise_admin();
  return coalesce((select jsonb_object_agg(b.id::text, (select count(*) from user_profiles u where u.branch_id = b.id
      and u.account_status = 'active' and u.removed_at is null and u.working_status <> 'resigned'))
    from branches b where b.tenant_id = a.tenant_id), '{}'::jsonb);
end $$;

create function get_franchise_module_coverage()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_franchise_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('module', m.module, 'label', m.label, 'status', m.status,
      'pending_reason', m.pending_reason) order by m.status desc, m.label) from franchise_scope_modules m), '[]'::jsonb);
end $$;

-- Organisation audit history: franchise, branch mapping, scope, transfer,
-- isolation and cross-location events. Names only, newest first.
create function get_franchise_audit_history(p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  a := assert_franchise_admin();
  return coalesce((select jsonb_agg(x order by (x->>'created_at') desc) from (
    select jsonb_build_object('id', l.id, 'action', l.action, 'record_id', l.record_id, 'created_at', l.created_at,
      'actor_name', p.employee_name, 'new_value', l.new_value) x
    from audit_logs l left join user_profiles p on p.id = l.actor_user_id
    where l.tenant_id = a.tenant_id and l.action in ('franchise_group_saved', 'branch_franchise_assigned', 'org_scope_granted',
      'org_scope_revoked', 'employee_franchise_transferred', 'franchise_enforcement_changed', 'cross_location_task_assigned',
      'cross_location_recipient_selected', 'definition_owner_franchise_set')
    order by l.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) s), '[]'::jsonb);
end $$;

-- Super Admin decides which franchise owns a form or FMS workflow family (null
-- = shared company-wide). Applies to every version of the family.
create function set_definition_owner_franchise_with_audit(p_kind text, p_family_id uuid, p_franchise_group_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare a user_profiles; v_count integer;
begin
  a := assert_franchise_admin();
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason' using errcode = '22023'; end if;
  if p_franchise_group_id is not null and not exists (select 1 from franchise_groups f where f.id = p_franchise_group_id and f.tenant_id = a.tenant_id and f.is_active) then
    raise exception 'Franchise is invalid or inactive' using errcode = '23503';
  end if;
  if p_kind = 'form' then
    -- Ownership is access metadata, not definition content: published versions
    -- keep their questions and answers unchanged.
    perform set_config('jewelos.allow_published_form_edit', 'on', true);
    update form_templates set owner_franchise_group_id = p_franchise_group_id where family_id = p_family_id and tenant_id = a.tenant_id;
    perform set_config('jewelos.allow_published_form_edit', '', true);
  elsif p_kind = 'fms' then
    update fms_flows set owner_franchise_group_id = p_franchise_group_id where family_id = p_family_id and tenant_id = a.tenant_id;
  else
    raise exception 'Definition kind is invalid' using errcode = '22023';
  end if;
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'Definition not found' using errcode = '42501'; end if;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (a.tenant_id, a.id, 'definition_owner_franchise_set', 'user_management', p_family_id,
    jsonb_build_object('kind', p_kind, 'franchise_group_id', p_franchise_group_id, 'reason', btrim(p_reason), 'versions', v_count));
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 9. CRM roster per franchise (CRM project: 20261107000100)
-- ---------------------------------------------------------------------------

-- While isolation is on, the CRM department joins the rosters of its own
-- franchise's stores only. The CRM project reads crm_roster_jewelos_branch_ids;
-- absent (isolation off) it keeps the company-wide roster of 0203.
select pg_temp.franchise_patch('crm_sync.staff_roster_fields(uuid)',
  E'    ''crm_roster'', v_choice = ''crm'', ''crm_roster_all_branches'', v_choice = ''crm'', ''selection_department'', v_choice,',
  E'    ''crm_roster'', v_choice = ''crm'', ''crm_roster_all_branches'', v_choice = ''crm'', ''selection_department'', v_choice,\n'
  || E'    ''crm_roster_jewelos_branch_ids'', case when v_choice = ''crm'' and org_scope_enforced(v_profile.tenant_id) then coalesce((\n'
  || E'      select jsonb_agg(b.id order by b.id) from branches b where b.tenant_id = v_profile.tenant_id and b.is_active\n'
  || E'        and b.franchise_group_id is not distinct from franchise_of_branch(v_profile.branch_id)), ''[]''::jsonb) end,', 1);

-- Switching isolation, or moving a store between franchises, re-sends the
-- roster so the CRM project follows at once.
create function org_resend_crm_roster(p_tenant_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into crm_sync.outbox (event_type, aggregate_id)
  select 'staff.access_changed', p.id from user_profiles p where p.tenant_id = p_tenant_id
  on conflict (event_type, aggregate_id) where delivered_at is null and dead_at is null
  do update set changed_at = clock_timestamp();
$$;
select pg_temp.franchise_patch('public.set_franchise_enforcement_with_audit(boolean,text)',
  E'  return jsonb_build_object(''enforcement_enabled'', p_enabled);',
  E'  if p_enabled is distinct from v_old then perform org_resend_crm_roster(a.tenant_id); end if;\n  return jsonb_build_object(''enforcement_enabled'', p_enabled);', 1);
select pg_temp.franchise_patch('public.assign_branch_franchise_with_audit(uuid,uuid,text,text)',
  E'  return new_row;\nend',
  E'  if org_scope_enforced(a.tenant_id) then perform org_resend_crm_roster(a.tenant_id); end if;\n  return new_row;\nend', 1);

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------

revoke all on function org_profile_franchise_ids(uuid), org_branch_visible(uuid, uuid, uuid), org_scope_actor(),
  org_recipient_in_local_scope(uuid, uuid), org_cross_location_recipients(), org_note_cross_location_recipient(uuid),
  org_cross_location_task_active(), org_cross_location_recipient_eligible(uuid), org_recipient_allowed(uuid),
  org_begin_cross_location_task(jsonb, uuid[], uuid[]), audit_cross_location_task(),
  assert_form_user_answer(uuid, text, text, text), audit_cross_location_answers(uuid), set_definition_owner_franchise(),
  form_definition_write_guard(), assert_cross_location_lookup(jsonb), org_resend_crm_roster(uuid),
  org_task_in_my_scope(uuid, uuid, uuid), org_fms_instance_in_my_scope(uuid, uuid, uuid)
  from public, anon, authenticated;
-- Evaluated inside policies as the querying role.
revoke all on function org_definition_visible(uuid, uuid), org_definition_manageable(uuid, uuid) from public, anon;
grant execute on function org_definition_visible(uuid, uuid), org_definition_manageable(uuid, uuid) to authenticated;
-- Client contracts.
revoke all on function list_assignment_locations(jsonb), search_assignment_recipients(jsonb, uuid, text, integer, integer),
  get_franchise_branch_counts(), get_franchise_module_coverage(),
  get_franchise_audit_history(integer), set_definition_owner_franchise_with_audit(text, uuid, uuid, text)
  from public, anon;
grant execute on function list_assignment_locations(jsonb), search_assignment_recipients(jsonb, uuid, text, integer, integer),
  get_franchise_branch_counts(), get_franchise_module_coverage(),
  get_franchise_audit_history(integer), set_definition_owner_franchise_with_audit(text, uuid, uuid, text)
  to authenticated;

drop function pg_temp.franchise_patch(text, text, text, integer);
notify pgrst, 'reload schema';
