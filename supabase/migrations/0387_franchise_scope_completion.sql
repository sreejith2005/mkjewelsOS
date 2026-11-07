-- Franchise scope completion (Phase 3): Task Control, FMS builder and flow
-- reports, Business Reports and exports, Store Intelligence, Storage, Ask Kiara,
-- search / Availability / Dropdown Master and same-franchise cross-store task
-- assignment. CRM customer data stays shared by every store (owner decision
-- 2026-11-06).
--
-- Design: docs/architecture/franchise-scope.md ("Phase 3").
--
-- Safety, as in 0385 and 0386: every rule below first asks whether franchise
-- isolation is on for the tenant and, while it is off, keeps today's behaviour.
-- No existing row is rewritten. Registry rows move to 'enforced' only for the
-- sections this migration covers and its pgTAP file proves.
set search_path = public, extensions;

create function pg_temp.franchise_patch(p_signature text, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_signature::regprocedure), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0387: expected % match(es) in %, found %: %', p_expected, p_signature, found, left(p_old, 80);
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Statement-level scope helpers
-- ---------------------------------------------------------------------------

-- The readable branches of an actor, or null when the actor is unrestricted
-- (isolation off, or company scope). A list query computes it once
-- ((select org_my_branch_filter())) instead of resolving scope per row.
-- Fails closed: no actor while isolation is on gives an empty set.
create function org_branch_filter_for(p_tenant_id uuid, p_profile_id uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when not org_scope_enforced(p_tenant_id) then null
    when p_profile_id is null then '{}'::uuid[]
    when org_has_company_scope(p_profile_id) then null
    else org_scope_branch_ids(p_profile_id, false) end;
$$;

create function org_my_branch_filter()
returns uuid[] language sql stable security definer set search_path = public as $$
  select org_branch_filter_for(current_tenant_id(), (current_profile()).id);
$$;

-- A record owned by a branch and/or people: visible when the filter is null,
-- when its branch is in the filter, or when one of its people belongs to a
-- branch in the filter (originating / executing owners, cross-location work).
create function org_record_in_filter(p_filter uuid[], p_branch_id uuid, p_people uuid[])
returns boolean language sql stable security definer set search_path = public as $$
  select p_filter is null
    or (p_branch_id is not null and p_branch_id = any(p_filter))
    or exists (select 1 from user_profiles u where u.id = any(coalesce(p_people, '{}'::uuid[])) and u.branch_id = any(p_filter));
$$;

-- A task: branch, creator, or an active assignee in the filter (the same
-- ownership rule as org_task_in_my_scope, with the filter precomputed).
create function org_task_in_filter(p_filter uuid[], p_task_id uuid, p_branch_id uuid, p_created_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_filter is null
    or (p_branch_id is not null and p_branch_id = any(p_filter))
    or exists (select 1 from user_profiles c where c.id = p_created_by and c.branch_id = any(p_filter))
    or exists (select 1 from task_assignees ta join user_profiles u on u.id = ta.user_profile_id
               where ta.task_instance_id = p_task_id and ta.is_active and u.branch_id = any(p_filter));
$$;

-- An FMS run: its branch (origin), its starter, or an active stage assignee.
create function org_fms_instance_in_filter(p_filter uuid[], p_instance_id uuid, p_branch_id uuid, p_started_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_filter is null
    or (p_branch_id is not null and p_branch_id = any(p_filter))
    or exists (select 1 from user_profiles s where s.id = p_started_by and s.branch_id = any(p_filter))
    or exists (select 1 from fms_instance_stages st
               join fms_instance_stage_assignees x on x.fms_instance_stage_id = st.id and x.is_active
               join user_profiles u on u.id = x.user_profile_id
               where st.fms_instance_id = p_instance_id and u.branch_id = any(p_filter));
$$;

-- Raise when the signed-in person may not act on an employee's records.
create function org_assert_person_in_my_scope(p_profile_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare f uuid[] := org_my_branch_filter();
begin
  if f is not null and not exists (select 1 from user_profiles u where u.id = p_profile_id and u.branch_id = any(f)) then
    raise exception 'This employee is outside your franchise or store scope' using errcode = '42501';
  end if;
end $$;

-- Raise when an existing task is outside the signed-in person's scope.
create function org_assert_task_in_my_scope(p_task_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare f uuid[] := org_my_branch_filter(); t task_instances;
begin
  if f is null then return; end if;
  select * into t from task_instances where id = p_task_id;
  if t.id is not null and not org_task_in_filter(f, t.id, t.branch_id, t.created_by) then
    raise exception 'This task belongs to another franchise or store' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Task Control, task templates, bulk import and bulk reassignment
-- ---------------------------------------------------------------------------

-- Task Control lists: rows and counts are limited to the viewer's scope before
-- counting (administrators read their franchise; company scope reads all).
select pg_temp.franchise_patch('public.task_workspace_page(jsonb,integer,integer)',
  ' a user_profiles:=current_profile(); admin_view boolean:=has_permission(''tasks.view_all''); manager_view boolean:=has_permission(''tasks.manage_team'');',
  ' a user_profiles:=current_profile(); admin_view boolean:=has_permission(''tasks.view_all''); manager_view boolean:=has_permission(''tasks.manage_team''); scope_filter uuid[]:=org_my_branch_filter();', 1);
select pg_temp.franchise_patch('public.task_workspace_page(jsonb,integer,integer)',
  '   and (admin_view or manager_view or t.created_by=a.id',
  '   and (((admin_view or manager_view) and org_task_in_filter(scope_filter,t.id,t.branch_id,t.created_by)) or t.created_by=a.id', 1);
select pg_temp.franchise_patch('public.task_workspace_page(jsonb,integer,integer)',
  'and fms_module_enabled and (admin_view or s.user_profile_id=a.id)',
  'and fms_module_enabled and ((admin_view and org_record_in_filter(scope_filter,null,array[s.user_profile_id,s.assigned_by])) or s.user_profile_id=a.id)', 1);

select pg_temp.franchise_patch('public.get_task_template_directory(jsonb)',
  E'    where t.tenant_id = v_actor.tenant_id\n      and t.task_type in (''checklist'',''delegation'')',
  E'    where t.tenant_id = v_actor.tenant_id\n      and t.task_type in (''checklist'',''delegation'')\n'
  || E'      and public.org_record_in_filter((select public.org_my_branch_filter()), t.branch_id, array[t.default_assignee_user_id, t.created_by])', 1);

select pg_temp.franchise_patch('public.list_assigning_left_tasks()',
  'where t.tenant_id=v_actor.tenant_id and t.assignment_status=''assigning_left''',
  'where t.tenant_id=v_actor.tenant_id and t.assignment_status=''assigning_left'' and public.org_record_in_filter((select public.org_my_branch_filter()),t.branch_id,array[t.created_by])', 2);

select pg_temp.franchise_patch('public.get_recurring_todo_workspace(jsonb)',
  E'  where t.tenant_id = v_actor.tenant_id and t.task_type in (''checklist'',''delegation'')\n    and t.recurrence_rule is not null',
  E'  where t.tenant_id = v_actor.tenant_id and t.task_type in (''checklist'',''delegation'')\n    and t.recurrence_rule is not null\n'
  || E'    and public.org_record_in_filter((select public.org_my_branch_filter()), t.branch_id, array[t.default_assignee_user_id, t.created_by])', 1);
select pg_temp.franchise_patch('public.get_recurring_todo_workspace(jsonb)',
  E'    where ti.tenant_id = v_actor.tenant_id and ti.task_template_id is not null',
  E'    where ti.tenant_id = v_actor.tenant_id and ti.task_template_id is not null\n'
  || E'      and public.org_task_in_filter((select public.org_my_branch_filter()), ti.id, ti.branch_id, ti.created_by)', 1);

-- Bulk reassignment: the person whose work moves must be in the actor's scope;
-- the receiver already passes task_assignment_user_in_scope (franchise rule).
select pg_temp.franchise_patch('public.task_reassignment_candidates(uuid)',
  E'    raise exception ''Employee not found'' using errcode = ''42501'';\n  end if;',
  E'    raise exception ''Employee not found'' using errcode = ''42501'';\n  end if;\n  perform org_assert_person_in_my_scope(p_from_user_id);', 1);
select pg_temp.franchise_patch('public.reassign_task_work_with_audit(uuid,uuid,text,uuid[],uuid[],uuid[])',
  E'  if v_from.id is null then raise exception ''Employee not found'' using errcode = ''42501''; end if;',
  E'  if v_from.id is null then raise exception ''Employee not found'' using errcode = ''42501''; end if;\n  perform org_assert_person_in_my_scope(p_from_user_id);', 1);

-- Task administration (edit / delete / recurring follow-up and verification).
select pg_temp.franchise_patch('public.admin_edit_task_with_audit(uuid,jsonb)',
  'if old_task.id is null then raise exception ''Task administration denied'' using errcode=''42501''; end if;',
  'if old_task.id is null then raise exception ''Task administration denied'' using errcode=''42501''; end if;
  perform org_assert_task_in_my_scope(old_task.id);', 1);
select pg_temp.franchise_patch('public.admin_edit_task_with_audit(uuid,jsonb)',
  E'      or (scope in (''branch'',''department'') and candidate.branch_id is distinct from a.branch_id) then',
  E'      or (scope in (''branch'',''department'') and candidate.branch_id is distinct from a.branch_id)\n      or not org_branch_in_data_scope(candidate.branch_id) then', 1);
select pg_temp.franchise_patch('public.admin_delete_task_with_audit(uuid,boolean,text)',
  E'  perform public.assert_module_access(''tasks'');\n  return',
  E'  perform public.assert_module_access(''tasks'');\n  perform public.org_assert_task_in_my_scope(p_task_id);\n  return', 1);
select pg_temp.franchise_patch('public.send_recurring_followup_with_audit(uuid,text)',
  '  select * into v_task from task_instances where id=p_task_id for update;',
  E'  select * into v_task from task_instances where id=p_task_id for update;\n  perform org_assert_task_in_my_scope(p_task_id);', 1);
select pg_temp.franchise_patch('public.verify_recurring_task_with_audit(uuid,text,text)',
  '  select * into v_task from public.task_instances where id = p_task_id for update;',
  E'  select * into v_task from public.task_instances where id = p_task_id for update;\n'
  || E'  if v_task.verifier_user_profile_id is distinct from v_actor.id then perform public.org_assert_task_in_my_scope(p_task_id); end if;', 1);
select pg_temp.franchise_patch('public.run_recurring_todo_template_now_with_audit(uuid,date)',
  '  select * into v_template from task_templates where id=p_template_id for update;',
  E'  select * into v_template from task_templates where id=p_template_id for update;\n'
  || E'  if v_template.id is not null and not org_record_in_filter(org_my_branch_filter(), v_template.branch_id, array[v_template.default_assignee_user_id, v_template.created_by]) then\n'
  || E'    raise exception ''This schedule belongs to another franchise or store'' using errcode = ''42501''; end if;', 1);

-- Template recipients ("specific user") follow the franchise rule.
select pg_temp.franchise_patch('public.assert_task_assignment_rule(text,uuid)',
  E'  if p_type=''specific_user'' and not task_assignment_recipient_allowed(p_user_id) then',
  E'  if p_type=''specific_user'' and p_user_id is not null and not org_recipient_allowed(p_user_id) then\n'
  || E'    raise exception ''Employee is in another franchise'' using errcode=''42501'';\n  end if;\n'
  || E'  if p_type=''specific_user'' and not task_assignment_recipient_allowed(p_user_id) then', 1);

-- Bulk import resolves doers only among people the importer may assign.
select pg_temp.franchise_patch('public.task_import_resolve_assignee(jsonb)',
  '(v_actor.user_role<>''manager'' or u.branch_id=v_actor.branch_id)',
  '(v_actor.user_role<>''manager'' or u.branch_id=v_actor.branch_id) and public.org_recipient_allowed(u.id)', 4);
select pg_temp.franchise_patch('public.list_task_import_identity_candidates()',
  '(v_actor.user_role<>''manager'' or u.branch_id=v_actor.branch_id)',
  '(v_actor.user_role<>''manager'' or u.branch_id=v_actor.branch_id) and public.org_recipient_allowed(u.id)', 1);

-- Templates: read and write follow the template's branch and people. Writes by
-- a signed-in person (builder, schedule, pause, delete, reassignment) are
-- guarded on the table, so every RPC path is covered; automated runs (no
-- person) are unaffected.
create policy task_templates_franchise_scope on task_templates as restrictive for select to authenticated using (
  org_record_in_filter((select org_my_branch_filter()), branch_id, array[default_assignee_user_id, created_by])
);

create function task_template_franchise_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare a user_profiles := current_profile(); f uuid[];
begin
  if a.id is null then return coalesce(new, old); end if;
  f := org_branch_filter_for(a.tenant_id, a.id);
  if f is null then return coalesce(new, old); end if;
  if tg_op in ('UPDATE', 'DELETE') and not org_record_in_filter(f, old.branch_id, array[old.default_assignee_user_id, old.created_by]) then
    raise exception 'This schedule belongs to another franchise or store' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and not org_record_in_filter(f, new.branch_id, array[new.default_assignee_user_id]) then
    raise exception 'The schedule''s store or doer is outside your franchise or store scope' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger task_templates_franchise_guard before insert or update or delete on task_templates
  for each row execute function task_template_franchise_guard();

-- Import batches: administrators read batches imported by people in their
-- scope (the importer always reads their own). Same single read policy.
drop policy task_import_batches_select on task_import_batches;
create policy task_import_batches_select on task_import_batches for select to authenticated using (
  current_profile_is_active() and tenant_id = current_tenant_id()
  and ((current_role_level() = any (array['super_admin'::user_role, 'admin'::user_role])
        and org_record_in_filter((select org_my_branch_filter()), null, array[created_by]))
       or created_by = (current_profile()).id)
);

-- ---------------------------------------------------------------------------
-- 3. FMS builder writes, flow reports and trigger history
-- ---------------------------------------------------------------------------

-- The builder follows definition ownership (0386): company scope manages shared
-- workflows; a franchise authority manages its own franchise's workflows.
select pg_temp.franchise_patch('public.can_manage_fms_flow(uuid)',
  '(p_flow_id is null or exists(select 1 from fms_flows f where f.id=p_flow_id and f.tenant_id=actor.tenant_id))',
  '(p_flow_id is null or exists(select 1 from fms_flows f where f.id=p_flow_id and f.tenant_id=actor.tenant_id and org_definition_manageable(f.branch_id,f.owner_franchise_group_id)))', 1);

-- Definition writes by a signed-in person on any definition table (flows,
-- steps, routing rules, default step assignees). Runtime bookkeeping
-- (usage_count, updated_at) and automated writes are not guarded, so starting
-- and running a shared workflow keeps working in every franchise.
create function fms_definition_write_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare a user_profiles := current_profile(); f fms_flows; v_flow uuid;
begin
  if a.id is null or not org_scope_enforced(a.tenant_id) or org_has_company_scope(a.id) then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'fms_flows' then
    if tg_op = 'UPDATE' and (new.name, new.description, new.status, new.is_active, new.branch_id, new.department_id, new.trigger_type,
        new.start_mode, new.start_trigger, new.module_context, new.owner_franchise_group_id, new.scope_type, new.family_id)
       is not distinct from (old.name, old.description, old.status, old.is_active, old.branch_id, old.department_id, old.trigger_type,
        old.start_mode, old.start_trigger, old.module_context, old.owner_franchise_group_id, old.scope_type, old.family_id) then
      return new;
    end if;
    if tg_op in ('UPDATE', 'DELETE') and not org_definition_manageable(old.branch_id, old.owner_franchise_group_id) then
      raise exception 'This workflow belongs to another franchise or is shared company-wide; only its owner or Super Admin can change it' using errcode = '42501';
    end if;
    if tg_op in ('INSERT', 'UPDATE') and not org_definition_manageable(new.branch_id, new.owner_franchise_group_id) then
      raise exception 'This workflow belongs to another franchise or is shared company-wide; only its owner or Super Admin can change it' using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;
  if tg_table_name = 'fms_stages' then
    v_flow := coalesce(new.fms_flow_id, old.fms_flow_id);
  else
    select s.fms_flow_id into v_flow from fms_stages s where s.id = coalesce(new.fms_stage_id, old.fms_stage_id);
  end if;
  select * into f from fms_flows where id = v_flow;
  if f.id is not null and not org_definition_manageable(f.branch_id, f.owner_franchise_group_id) then
    raise exception 'This workflow belongs to another franchise or is shared company-wide; only its owner or Super Admin can change it' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
-- Named after fms_flows_owner_franchise so the owner is set before the check.
create trigger fms_flows_write_guard before insert or update or delete on fms_flows
  for each row execute function fms_definition_write_guard();
create trigger fms_stages_write_guard before insert or update or delete on fms_stages
  for each row execute function fms_definition_write_guard();
create trigger fms_branch_rules_write_guard before insert or update or delete on fms_branch_rules
  for each row execute function fms_definition_write_guard();
create trigger fms_stage_assignees_write_guard before insert or update or delete on fms_stage_assignees
  for each row execute function fms_definition_write_guard();

-- Flow reports and records: runs were already limited by can_read_fms_instance
-- (0386); the workflow itself must also be visible, so a foreign franchise's
-- step names are never returned.
create function org_assert_fms_family_visible(p_family_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if org_my_scope_enforced() and exists (select 1 from fms_flows f where coalesce(f.family_id, f.id) = p_family_id and f.tenant_id = current_tenant_id())
     and not exists (select 1 from fms_flows f where coalesce(f.family_id, f.id) = p_family_id and f.tenant_id = current_tenant_id()
                     and org_definition_visible(f.branch_id, f.owner_franchise_group_id)) then
    raise exception 'This workflow belongs to another franchise' using errcode = '42501';
  end if;
end $$;
select pg_temp.franchise_patch('public.get_fms_flow_report(uuid,jsonb)',
  E'  if p_family_id is null then raise exception ''Choose a workflow'' using errcode=''22023''; end if;',
  E'  if p_family_id is null then raise exception ''Choose a workflow'' using errcode=''22023''; end if;\n  perform org_assert_fms_family_visible(p_family_id);', 1);
select pg_temp.franchise_patch('public.get_fms_flow_records(uuid,jsonb,integer,integer)',
  E'then raise exception ''Invalid FMS record page'' using errcode=''22023''; end if;',
  E'then raise exception ''Invalid FMS record page'' using errcode=''22023''; end if;\n  perform org_assert_fms_family_visible(p_family_id);', 1);

-- Trigger history, inspection, retry and samples: events of stores in scope
-- (an event's branch, or its staff member's branch). Summary counts likewise.
create function org_trigger_event_in_my_scope(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from fms_trigger_events e where e.id = p_event_id
    and org_record_in_filter(org_my_branch_filter(), e.branch_id, array[e.staff_profile_id]));
$$;
select pg_temp.franchise_patch('public.get_fms_trigger_history(jsonb,integer,integer)',
  '      and (v_actor.user_role in (''super_admin'',''admin'') or e.branch_id=v_actor.branch_id)',
  '      and (v_actor.user_role in (''super_admin'',''admin'') or e.branch_id=v_actor.branch_id)
      and org_record_in_filter((select org_my_branch_filter()),e.branch_id,array[e.staff_profile_id])', 1);
select pg_temp.franchise_patch('public.get_fms_trigger_history(jsonb,integer,integer)',
  'from fms_trigger_events e where e.tenant_id=v_actor.tenant_id and',
  'from fms_trigger_events e where e.tenant_id=v_actor.tenant_id and org_record_in_filter((select org_my_branch_filter()),e.branch_id,array[e.staff_profile_id]) and', 2);
select pg_temp.franchise_patch('public.get_fms_trigger_history(jsonb,integer,integer)',
  'from fms_trigger_events e where e.tenant_id=v_actor.tenant_id)',
  'from fms_trigger_events e where e.tenant_id=v_actor.tenant_id and org_record_in_filter((select org_my_branch_filter()),e.branch_id,array[e.staff_profile_id]))', 1);
select pg_temp.franchise_patch('public.get_fms_trigger_history(jsonb,integer,integer)',
  'from fms_trigger_evaluations v where v.tenant_id=v_actor.tenant_id and',
  'from fms_trigger_evaluations v where v.tenant_id=v_actor.tenant_id and org_trigger_event_in_my_scope(v.event_id) and', 3);
select pg_temp.franchise_patch('public.inspect_fms_trigger_event(uuid)',
  'and (v_actor.user_role in (''super_admin'',''admin'') or branch_id=v_actor.branch_id);',
  'and (v_actor.user_role in (''super_admin'',''admin'') or branch_id=v_actor.branch_id) and org_trigger_event_in_my_scope(id);', 1);
select pg_temp.franchise_patch('public.retry_fms_trigger_event_with_audit(uuid)',
  'and (v_actor.user_role in (''super_admin'',''admin'') or branch_id=v_actor.branch_id) for update;',
  'and (v_actor.user_role in (''super_admin'',''admin'') or branch_id=v_actor.branch_id) and org_trigger_event_in_my_scope(id) for update;', 1);
select pg_temp.franchise_patch('public.list_fms_trigger_samples(jsonb,integer)',
  'and (v_actor.user_role in (''super_admin'',''admin'') or s.branch_id=v_actor.branch_id)',
  'and (v_actor.user_role in (''super_admin'',''admin'') or s.branch_id=v_actor.branch_id) and org_branch_in_data_scope(s.branch_id)', 1);
select pg_temp.franchise_patch('public.list_fms_trigger_samples(jsonb,integer)',
  'and (v_actor.user_role in (''super_admin'',''admin'') or e.branch_id=v_actor.branch_id)',
  'and (v_actor.user_role in (''super_admin'',''admin'') or e.branch_id=v_actor.branch_id) and org_trigger_event_in_my_scope(e.id)', 1);
select pg_temp.franchise_patch('public.test_fms_start_trigger(uuid,jsonb,jsonb)',
  'select * into f from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id;',
  'select * into f from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id and org_definition_visible(branch_id,owner_franchise_group_id);', 1);

-- Explicit FMS handoff picker: offer only people the handoff may name
-- (assert_fms_handoff_recipient re-checks on submit). Cross-location
-- recipients come from a cross-location Users question, not this list.
select pg_temp.franchise_patch('public.list_fms_handoff_recipients(jsonb,uuid,text,uuid,integer)',
  'where u.tenant_id=a.tenant_id and u.account_status=''active'' and u.working_status=''active'' and u.is_login_enabled',
  'where u.tenant_id=a.tenant_id and u.account_status=''active'' and u.working_status=''active'' and u.is_login_enabled and org_recipient_in_local_scope(a.id,u.id)', 1);

-- Starting a workflow from the library: the definition must be visible and,
-- for administrators, the chosen store must be in scope.
select pg_temp.franchise_patch('public.can_start_fms_flow(uuid,uuid,uuid)',
  E'      and f.is_active\n',
  E'      and f.is_active\n      and org_definition_visible(f.branch_id, f.owner_franchise_group_id)\n', 1);
select pg_temp.franchise_patch('public.can_start_fms_flow(uuid,uuid,uuid)',
  E'        actor.user_role in (''super_admin'',''admin'')\n        or (',
  E'        (actor.user_role in (''super_admin'',''admin'') and org_branch_in_data_scope(p_branch_id))\n        or (', 1);

-- ---------------------------------------------------------------------------
-- 4. Work actions by role (tasks and FMS steps)
-- ---------------------------------------------------------------------------

-- Administrators and managers act on work in their scope; the people on the
-- work (creator, doer, watcher, FMS assignee, starter) always keep their
-- access, including cross-location assignees.
create or replace function org_assert_task_in_my_scope(p_task_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare f uuid[] := org_my_branch_filter(); t task_instances;
begin
  if f is null then return; end if;
  select * into t from task_instances where id = p_task_id;
  if t.id is null or t.created_by = (current_profile()).id or is_task_participant(t.id) or is_task_watcher(t.id) then return; end if;
  if not org_task_in_filter(f, t.id, t.branch_id, t.created_by) then
    raise exception 'This task belongs to another franchise or store' using errcode = '42501';
  end if;
end $$;

create function org_assert_fms_stage_in_my_scope(p_instance_stage_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare me uuid := (current_profile()).id; s fms_instance_stages; i fms_instances;
begin
  if not org_my_scope_enforced() then return; end if;
  select * into s from fms_instance_stages where id = p_instance_stage_id;
  if s.id is null then return; end if;
  select * into i from fms_instances where id = s.fms_instance_id;
  if me = any(s.assigned_to) or i.started_by = me
     or exists (select 1 from fms_instance_stage_assignees x where x.fms_instance_stage_id = s.id and x.user_profile_id = me and x.is_active)
     or can_read_fms_instance(i.id) then
    return;
  end if;
  raise exception 'This FMS work belongs to another franchise or store' using errcode = '42501';
end $$;

select pg_temp.franchise_patch('public.add_task_attachment_with_audit(uuid,text)',
  E'  select * into v_actor from current_profile() where auth_user_id=auth.uid();',
  E'  select * into v_actor from current_profile() where auth_user_id=auth.uid();\n  perform org_assert_task_in_my_scope(p_task_id);', 1);
select pg_temp.franchise_patch('public.complete_uploaded_task_with_audit(uuid,text)',
  E'  select * into v_old from task_instances where id=p_task_id for update;',
  E'  select * into v_old from task_instances where id=p_task_id for update;\n  perform org_assert_task_in_my_scope(p_task_id);', 1);
select pg_temp.franchise_patch('public.complete_recurring_task_with_image_with_audit(uuid,text)',
  E'  select * into v_task from public.task_instances where id=p_task_id for update;',
  E'  select * into v_task from public.task_instances where id=p_task_id for update;\n  perform public.org_assert_task_in_my_scope(p_task_id);', 1);
select pg_temp.franchise_patch('public.update_task_with_audit(uuid,text,uuid,boolean,text)',
  E'  select * into v_old from task_instances where id = p_task_id for update;',
  E'  select * into v_old from task_instances where id = p_task_id for update;\n  perform org_assert_task_in_my_scope(p_task_id);', 1);

select pg_temp.franchise_patch('public.complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)',
  E'  perform public.assert_module_enabled(''fms_builder'');',
  E'  perform public.assert_module_enabled(''fms_builder'');\n  perform public.org_assert_fms_stage_in_my_scope(p_instance_stage_id);', 1);
select pg_temp.franchise_patch('public.escalate_fms_stage_with_audit(uuid,text)',
  'perform public.assert_module_enabled(''fms_builder'');',
  'perform public.assert_module_enabled(''fms_builder''); perform public.org_assert_fms_stage_in_my_scope(p_instance_stage_id);', 1);
select pg_temp.franchise_patch('public.register_fms_evidence_with_audit(uuid,text,text,text,bigint)',
  'perform public.assert_module_enabled(''fms_builder'');',
  'perform public.assert_module_enabled(''fms_builder''); perform public.org_assert_fms_stage_in_my_scope(p_instance_stage_id);', 1);
select pg_temp.franchise_patch('public.update_fms_checklist_item_with_audit(uuid,boolean)',
  'perform public.assert_module_enabled(''fms_builder'');',
  'perform public.assert_module_enabled(''fms_builder''); perform public.org_assert_fms_stage_in_my_scope((select c.fms_instance_stage_id from fms_instance_checklist_items c where c.id=p_item_id));', 1);
select pg_temp.franchise_patch('public.cancel_fms_starter_assignment_with_audit(uuid,text)',
  E' select * into v_assignee from user_profiles where id=v_row.user_profile_id;',
  E' select * into v_assignee from user_profiles where id=v_row.user_profile_id;\n if v_row.id is not null and v_row.user_profile_id is distinct from v_actor.id then perform org_assert_person_in_my_scope(v_row.user_profile_id); end if;', 1);
select pg_temp.franchise_patch('public.get_task_import_batch_status(uuid)',
  '(created_by=v_actor.id or v_actor.user_role in (''super_admin'',''admin''))',
  '(created_by=v_actor.id or (v_actor.user_role in (''super_admin'',''admin'') and public.org_record_in_filter(public.org_my_branch_filter(),null,array[created_by])))', 1);

-- ---------------------------------------------------------------------------
-- 5. Business Reports, exports, dashboards and Home
-- ---------------------------------------------------------------------------

-- Background report jobs have no signed-in person. They now run with the
-- requester's persisted scope (export_logs.user_profile_id, re-checked as still
-- authorized by report_rows_for_profile), never with company-wide access.
-- The marker is honoured only without a session profile and only for the
-- service role or a direct database session; a browser always has a profile.
create or replace function org_scope_actor()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce((current_profile()).id,
    case when auth.uid() is null
           and (nullif(current_setting('request.jwt.claims', true), '') is null or coalesce(auth.role(), '') = 'service_role')
         then nullif(current_setting('jewelos.report_scope_actor', true), '')::uuid end);
$$;

-- A branch-owned row in a report: administrators within their filter,
-- managers their own branch (and, while isolation is on, their scope), and
-- everyone their own rows. The filter is the actor's (org_branch_filter_for).
create function org_report_branch_allowed(p_actor user_profiles, p_filter uuid[], p_branch_id uuid, p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_actor.user_role in ('super_admin','admin') and (p_filter is null or p_branch_id = any(p_filter)))
    or (p_actor.user_role = 'manager' and (p_branch_id = p_actor.branch_id
        or (org_scope_enforced(p_actor.tenant_id) and (p_filter is null or p_branch_id = any(p_filter)))))
    or p_owner = p_actor.id;
$$;

-- Report filters: while isolation is on, a scope authority (Director, HR,
-- Store Manager) reports across their whole scope instead of their own store,
-- and every store or person filter must be inside the viewer's scope.
select pg_temp.franchise_patch('public.reporting_context_for_actor(uuid,jsonb)',
  'if v_actor.user_role not in (''super_admin'',''admin'') and v_branch is not null and v_branch<>v_actor.branch_id then raise exception ''Branch filter denied'' using errcode=''42501''; end if;',
  'if v_actor.user_role not in (''super_admin'',''admin'') and not (org_scope_enforced(v_actor.tenant_id) and cardinality(org_scope_authorities(v_actor.id))>0)
    and v_branch is not null and v_branch<>v_actor.branch_id then raise exception ''Branch filter denied'' using errcode=''42501''; end if;
  if v_branch is not null and not org_record_in_filter(org_branch_filter_for(v_actor.tenant_id,v_actor.id),v_branch,null) then raise exception ''Branch filter denied'' using errcode=''42501''; end if;', 1);
select pg_temp.franchise_patch('public.reporting_context_for_actor(uuid,jsonb)',
  'v_branch:=case when v_actor.user_role in (''super_admin'',''admin'') then v_branch else v_actor.branch_id end;',
  'v_branch:=case when v_actor.user_role in (''super_admin'',''admin'') or (org_scope_enforced(v_actor.tenant_id) and cardinality(org_scope_authorities(v_actor.id))>0) then v_branch else v_actor.branch_id end;', 1);
select pg_temp.franchise_patch('public.reporting_context_for_actor(uuid,jsonb)',
  'if v_user is not null and not exists(select 1 from user_profiles up where up.id=v_user and up.tenant_id=v_actor.tenant_id and (v_branch is null or up.branch_id=v_branch))',
  'if v_user is not null and not exists(select 1 from user_profiles up where up.id=v_user and up.tenant_id=v_actor.tenant_id and (v_branch is null or up.branch_id=v_branch) and org_record_in_filter(org_branch_filter_for(v_actor.tenant_id,v_actor.id),up.branch_id,null))', 1);

-- The export worker's entry point names the requester for the batch it reads
-- (report_rows_for_profile re-checks that the requester is still authorized).
-- Customer exports already run as the requester there.
select pg_temp.franchise_patch('public.get_report_export_batch(uuid,integer,integer)',
  ' if x.report_key not like ''customer_%'' then return get_report_export_batch_before_customers(p_export_id,p_offset,p_limit);end if;',
  ' if x.report_key not like ''customer_%'' then
  perform set_config(''jewelos.report_scope_actor'', x.user_profile_id::text, true);
  return get_report_export_batch_before_customers(p_export_id,p_offset,p_limit);
 end if;', 1);
select pg_temp.franchise_patch('public.report_rows_for_profile(uuid,text,jsonb,integer,integer)',
  '(a.user_role in (''super_admin'',''admin'') or a.user_role=''manager'' and fs.branch_id=a.branch_id or fs.submitted_by=a.id)',
  'org_report_branch_allowed(a,(select org_branch_filter_for(a.tenant_id,a.id)),fs.branch_id,fs.submitted_by)', 1);
select pg_temp.franchise_patch('public.report_rows_for_profile(uuid,text,jsonb,integer,integer)',
  '(a.user_role in (''super_admin'',''admin'') or a.user_role=''manager'' and fi.branch_id=a.branch_id or fi.started_by=a.id',
  '((a.user_role in (''super_admin'',''admin'') and org_fms_instance_in_filter((select org_branch_filter_for(a.tenant_id,a.id)),fi.id,fi.branch_id,fi.started_by))
          or a.user_role=''manager'' and (fi.branch_id=a.branch_id or (org_scope_enforced(a.tenant_id) and org_fms_instance_in_filter((select org_branch_filter_for(a.tenant_id,a.id)),fi.id,fi.branch_id,fi.started_by)))
          or fi.started_by=a.id', 1);
select pg_temp.franchise_patch('public.report_rows_for_profile(uuid,text,jsonb,integer,integer)',
  '(a.user_role in (''super_admin'',''admin'',''hr'') or up.branch_id=a.branch_id)',
  '(a.user_role in (''super_admin'',''admin'',''hr'') or up.branch_id=a.branch_id) and org_record_in_filter((select org_branch_filter_for(a.tenant_id,a.id)),up.branch_id,null)', 1);

select pg_temp.franchise_patch('public.report_rows_for_profile_v1(uuid,text,jsonb,integer,integer)',
  '(a.user_role in (''super_admin'',''admin'') or a.user_role=''manager'' and fs.branch_id=a.branch_id or fs.submitted_by=a.id)',
  'org_report_branch_allowed(a,(select org_branch_filter_for(a.tenant_id,a.id)),fs.branch_id,fs.submitted_by)', 1);
select pg_temp.franchise_patch('public.report_rows_for_profile_v1(uuid,text,jsonb,integer,integer)',
  '(a.user_role in (''super_admin'',''admin'',''hr'') or up.branch_id=a.branch_id)',
  '(a.user_role in (''super_admin'',''admin'',''hr'') or up.branch_id=a.branch_id) and org_record_in_filter((select org_branch_filter_for(a.tenant_id,a.id)),up.branch_id,null)', 2);
select pg_temp.franchise_patch('public.report_rows_for_profile_v1(uuid,text,jsonb,integer,integer)',
  'from notification_deliveries nd where nd.tenant_id=a.tenant_id and',
  'from notification_deliveries nd where nd.tenant_id=a.tenant_id and org_record_in_filter((select org_branch_filter_for(a.tenant_id,a.id)),null,array[nd.recipient_profile_id]) and', 1);
select pg_temp.franchise_patch('public.report_rows_for_profile_v1(uuid,text,jsonb,integer,integer)',
  '(x.user_profile_id=a.id or a.user_role in (''super_admin'',''admin''))',
  '(x.user_profile_id=a.id or (a.user_role in (''super_admin'',''admin'') and org_record_in_filter((select org_branch_filter_for(a.tenant_id,a.id)),null,array[x.user_profile_id])))', 1);

-- Report filter choices: forms and workflows the viewer may see; people in scope.
select pg_temp.franchise_patch('public.get_report_filter_options(uuid)',
  'from form_templates t where t.tenant_id=a.tenant_id',
  'from form_templates t where t.tenant_id=a.tenant_id and org_definition_visible(t.branch_id,t.owner_franchise_group_id)', 1);
select pg_temp.franchise_patch('public.get_report_filter_options(uuid)',
  'from fms_flows f where f.tenant_id=a.tenant_id',
  'from fms_flows f where f.tenant_id=a.tenant_id and org_definition_visible(f.branch_id,f.owner_franchise_group_id)', 1);
select pg_temp.franchise_patch('public.get_report_filter_options(uuid)',
  'where f.tenant_id=a.tenant_id and coalesce(f.family_id,f.id)=p_flow_family_id',
  'where f.tenant_id=a.tenant_id and coalesce(f.family_id,f.id)=p_flow_family_id and org_definition_visible(f.branch_id,f.owner_franchise_group_id)', 1);
select pg_temp.franchise_patch('public.get_report_filter_options(uuid)',
  'where tenant_id=a.tenant_id and working_status not in (''inactive'',''resigned'')',
  'where tenant_id=a.tenant_id and working_status not in (''inactive'',''resigned'') and org_record_in_filter((select org_my_branch_filter()),branch_id,null)', 1);

-- Exports: administrators manage exports requested by people in their scope.
create function org_export_in_my_scope(p_user_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select current_role_level() in ('super_admin','admin') and org_record_in_filter(org_my_branch_filter(), null, array[p_user_profile_id]);
$$;
select pg_temp.franchise_patch('public.can_read_report_export_object(text)',
  '(x.user_profile_id=a.id or a.user_role in (''super_admin'',''admin''))',
  '(x.user_profile_id=a.id or org_export_in_my_scope(x.user_profile_id))', 1);
select pg_temp.franchise_patch('public.cancel_report_export_with_audit(uuid,uuid)',
  'not (x.user_profile_id=a.id or a.user_role in (''super_admin'',''admin''))',
  'not (x.user_profile_id=a.id or org_export_in_my_scope(x.user_profile_id))', 1);
select pg_temp.franchise_patch('public.retry_report_export_with_audit(uuid,uuid)',
  'not (x.user_profile_id=a.id or a.user_role in (''super_admin'',''admin''))',
  'not (x.user_profile_id=a.id or org_export_in_my_scope(x.user_profile_id))', 1);
select pg_temp.franchise_patch('public.get_report_export_download_url(uuid)',
  'not (x.user_profile_id=a.id or a.user_role in (''super_admin'',''admin''))',
  'not (x.user_profile_id=a.id or org_export_in_my_scope(x.user_profile_id))', 1);
create policy export_logs_franchise_scope on export_logs as restrictive for select to authenticated using (
  user_profile_id = (select (current_profile()).id)
  or org_record_in_filter((select org_my_branch_filter()), null, array[user_profile_id])
);

-- Dashboard counts that were tenant-wide by role.
select pg_temp.franchise_patch('public.get_dashboard_metrics(jsonb)',
  '(v_actor.user_role in (''super_admin'',''admin'') or v_actor.user_role=''manager'' and fs.branch_id=v_actor.branch_id or fs.submitted_by=v_actor.id)',
  'org_report_branch_allowed(v_actor,(select org_branch_filter_for(v_actor.tenant_id,v_actor.id)),fs.branch_id,fs.submitted_by)', 1);
select pg_temp.franchise_patch('public.get_dashboard_metrics(jsonb)',
  'p.tenant_id=v_actor.tenant_id and p.working_status=''active'' and p.is_login_enabled and',
  'p.tenant_id=v_actor.tenant_id and p.working_status=''active'' and p.is_login_enabled and org_record_in_filter((select org_branch_filter_for(v_actor.tenant_id,v_actor.id)),p.branch_id,null) and', 2);
select pg_temp.franchise_patch('public.get_dashboard_metrics(jsonb)',
  'from fms_instances fi where fi.tenant_id=v_actor.tenant_id and fi.status=''active'' and',
  'from fms_instances fi where fi.tenant_id=v_actor.tenant_id and fi.status=''active'' and org_fms_instance_in_filter((select org_branch_filter_for(v_actor.tenant_id,v_actor.id)),fi.id,fi.branch_id,fi.started_by) and', 1);
select pg_temp.franchise_patch('public.get_dashboard_metrics(jsonb)',
  'from form_submissions fs where fs.tenant_id=v_actor.tenant_id and fs.status=''submitted'' and',
  'from form_submissions fs where fs.tenant_id=v_actor.tenant_id and fs.status=''submitted'' and org_record_in_filter((select org_branch_filter_for(v_actor.tenant_id,v_actor.id)),fs.branch_id,array[fs.submitted_by]) and', 1);
select pg_temp.franchise_patch('public.get_dashboard_metrics(jsonb)',
  'from notification_deliveries nd where nd.tenant_id=v_actor.tenant_id and',
  'from notification_deliveries nd where nd.tenant_id=v_actor.tenant_id and org_record_in_filter((select org_branch_filter_for(v_actor.tenant_id,v_actor.id)),null,array[nd.recipient_profile_id]) and', 1);
select pg_temp.franchise_patch('public.get_home_summary(jsonb)',
  'or v_actor.user_role in (''super_admin'',''admin'') or v_actor.user_role=''manager''',
  'or (v_actor.user_role in (''super_admin'',''admin'') and org_record_in_filter((select org_branch_filter_for(v_actor.tenant_id,v_actor.id)),null,array[a.actor_user_id])) or v_actor.user_role=''manager''', 1);

-- Management insight filter choices.
select pg_temp.franchise_patch('public.get_management_insights_options_v1(jsonb)',
  'from branches where tenant_id=a.tenant_id and is_active and (a.user_role in (''super_admin'',''admin'') or id=a.branch_id)',
  'from branches where tenant_id=a.tenant_id and is_active and (a.user_role in (''super_admin'',''admin'') or id=a.branch_id) and org_record_in_filter((select org_my_branch_filter()),id,null)', 1);
select pg_temp.franchise_patch('public.get_management_insights_options_v1(jsonb)',
  'from user_profiles where tenant_id=a.tenant_id and',
  'from user_profiles where tenant_id=a.tenant_id and org_record_in_filter((select org_my_branch_filter()),branch_id,null) and', 1);
select pg_temp.franchise_patch('public.get_management_insights_options_v1(jsonb)',
  'from fms_stages s join fms_flows f on f.id=s.fms_flow_id where f.tenant_id=a.tenant_id and',
  'from fms_stages s join fms_flows f on f.id=s.fms_flow_id where f.tenant_id=a.tenant_id and org_definition_visible(f.branch_id,f.owner_franchise_group_id) and', 1);
select pg_temp.franchise_patch('public.get_management_insights_options_v1(jsonb)',
  'from fms_flows where tenant_id=a.tenant_id and',
  'from fms_flows where tenant_id=a.tenant_id and org_definition_visible(branch_id,owner_franchise_group_id) and', 1);

-- ---------------------------------------------------------------------------
-- 6. Store Intelligence
-- ---------------------------------------------------------------------------

-- Conversations, scores, coaching, devices and playback are already limited to
-- the viewer's own store (recorder_can_read, recording_is_reviewer and the
-- branch-pinned workspace queries), which is narrower than franchise scope.
-- Sales score rules (rubrics, SOP versions, CRM outcome settings) are one
-- company-wide definition: while isolation is on only company scope changes
-- them, as with shared forms and workflows.
select pg_temp.franchise_patch('public.recording_rubric_manager()',
  ' if a.user_role not in (''super_admin'',''admin'') or not has_permission(''recording.manage_rubric'') then raise exception ''recording_rubric_denied'' using errcode=''42501''; end if;',
  ' if a.user_role not in (''super_admin'',''admin'') or not has_permission(''recording.manage_rubric'') then raise exception ''recording_rubric_denied'' using errcode=''42501''; end if;
 if org_scope_enforced(a.tenant_id) and not org_has_company_scope(a.id) then raise exception ''recording_rubric_company_scope_required'' using errcode=''42501''; end if;', 1);

-- Super Admin sees and acts on every store's conversations, scores, coaching,
-- devices and integration (owner decision 2026-11-06). Every own-store check
-- in the Store Intelligence functions becomes "own store, or company scope";
-- everyone else keeps their own store. Applies whether isolation is on or off.
do $$
declare r record; v_body text; v_new text; v_count integer;
begin
  for r in select * from (values
    ('public.recorder_can_read(uuid,uuid,uuid)', 1),
    ('public.recorder_linkable_walkins()', 1),
    ('public.recording_is_reviewer(recorder_sessions)', 1),
    ('public.recording_conversations_page(jsonb,timestamp with time zone,uuid,integer)', 1),
    ('public.recording_today()', 5),
    ('public.recording_devices_page(text,text,integer,integer)', 1),
    ('public.recording_insights(date,date,uuid)', 2),
    ('public.recording_coaching_lists(date,date)', 1),
    ('public.recording_workspace_settings()', 1),
    ('public.recording_integration_health()', 1)
  ) v(sig, expected) loop
    v_body := replace(pg_get_functiondef(r.sig::regprocedure), E'\r', '');
    v_count := (select count(*) from regexp_matches(v_body, '(\m[a-z]\.branch_id ?= ?a\.branch_id|\ma\.branch_id ?= ?(p_branch|s\.branch_id)\M)', 'g'));
    if v_count <> r.expected then
      raise exception '0387: expected % own-store check(s) in %, found %', r.expected, r.sig, v_count;
    end if;
    v_new := regexp_replace(v_body, '(\m[a-z]\.branch_id ?= ?a\.branch_id|\ma\.branch_id ?= ?(p_branch|s\.branch_id)\M)',
      '(\1 or public.org_has_company_scope(a.id))', 'g');
    execute v_new;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Storage (signed URLs, uploads, downloads)
-- ---------------------------------------------------------------------------

-- Reads already follow the scoped record predicates: task attachments
-- (can_read_task), form uploads (can_read_form_submission), FMS evidence
-- (can_read_fms_instance), report exports (section 5). The remaining paths:

create function org_task_id_in_my_scope(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select org_task_in_filter(org_my_branch_filter(), t.id, t.branch_id, t.created_by) from task_instances t where t.id = p_task_id), false);
$$;

-- Task attachment uploads by managers: only on tasks in their scope.
select pg_temp.franchise_patch('public.can_write_task_attachment_object(text)',
  E'  return current_role_level() in (''super_admin'', ''admin'', ''manager'')\n    or is_task_participant(v_task_id);',
  E'  return (current_role_level() in (''super_admin'', ''admin'', ''manager'') and org_task_id_in_my_scope(v_task_id))\n    or is_task_participant(v_task_id);', 1);

-- FMS context uploads (earlier form answers shown on a later step): the
-- "all tasks" reader follows run scope.
select pg_temp.franchise_patch('public.can_read_fms_work_context(uuid)',
  'actor.id=any(work.assigned_to) or has_permission(''tasks.view_all'')',
  'actor.id=any(work.assigned_to) or (has_permission(''tasks.view_all'') and org_fms_instance_in_my_scope(i.id,i.branch_id,i.started_by))', 1);

-- Leave approval images: reviewers read requests of their scope.
select pg_temp.franchise_patch('public.leave_file_readable(text)',
  E'      and (r.applicant_id=(current_profile()).id or has_permission(''availability.review_leave'')\n        or has_permission(''availability.view_leave_summary'')))',
  E'      and (r.applicant_id=(current_profile()).id or ((has_permission(''availability.review_leave'')\n        or has_permission(''availability.view_leave_summary'')) and org_record_in_filter(org_my_branch_filter(), r.branch_id, array[r.applicant_id]))))', 1);
select pg_temp.franchise_patch('public.leave_file_readable(text)',
  E'    or (leave_file_retained_for_audit(p_path) and\n      (has_permission(''availability.review_leave'') or has_permission(''availability.view_leave_summary'')))',
  E'    or (leave_file_retained_for_audit(p_path) and\n      (has_permission(''availability.review_leave'') or has_permission(''availability.view_leave_summary''))\n'
  || E'      and org_record_in_filter(org_my_branch_filter(), null, array[nullif(split_part(p_path,''/'',2),'''')::uuid]))', 1);

-- ---------------------------------------------------------------------------
-- 8. Availability, leave, directory views, search and Dropdown Master
-- ---------------------------------------------------------------------------

create policy availability_franchise_scope on user_availability as restrictive for select to authenticated using (
  user_profile_id = (select (current_profile()).id)
  or org_record_in_filter((select org_my_branch_filter()), null, array[user_profile_id])
);
create policy leave_requests_franchise_scope on leave_requests as restrictive for select to authenticated using (
  applicant_id = (select (current_profile()).id) or handover_to = (select (current_profile()).id)
  or org_record_in_filter((select org_my_branch_filter()), branch_id, array[applicant_id])
);

select pg_temp.franchise_patch('public.record_availability_with_audit(uuid,date,availability_status,text)',
  E'  select * into v_old from user_availability where user_profile_id=p_user_profile_id and date=p_date;',
  E'  if p_user_profile_id is distinct from v_actor.id then perform org_assert_person_in_my_scope(p_user_profile_id); end if;\n'
  || E'  select * into v_old from user_availability where user_profile_id=p_user_profile_id and date=p_date;', 1);
select pg_temp.franchise_patch('public.review_leave_request(uuid,boolean,text)',
  'select * into v_old from leave_requests where id=p_id and tenant_id=v_actor.tenant_id for update;',
  E'select * into v_old from leave_requests where id=p_id and tenant_id=v_actor.tenant_id for update;\n'
  || E'  if v_old.id is not null and v_old.applicant_id is distinct from v_actor.id then perform org_assert_person_in_my_scope(v_old.applicant_id); end if;', 1);
select pg_temp.franchise_patch('public.edit_pending_leave(uuid,date,date,date,text)',
  'select * into v_old from leave_requests where id=p_id and tenant_id=v_actor.tenant_id for update;',
  E'select * into v_old from leave_requests where id=p_id and tenant_id=v_actor.tenant_id for update;\n'
  || E'  if v_old.id is not null and v_old.applicant_id is distinct from v_actor.id then perform org_assert_person_in_my_scope(v_old.applicant_id); end if;', 1);
select pg_temp.franchise_patch('public.submit_leave_handover(uuid,uuid,text)',
  'select * into v_old from leave_requests where id=p_id and tenant_id=v_actor.tenant_id for update;',
  E'select * into v_old from leave_requests where id=p_id and tenant_id=v_actor.tenant_id for update;\n'
  || E'  if v_old.id is not null and v_old.applicant_id is distinct from v_actor.id and v_old.handover_to is distinct from v_actor.id then perform org_assert_person_in_my_scope(v_old.applicant_id); end if;', 1);

-- Directory views run as their owner, so they are not covered by the 0385
-- user_profiles policies; they apply the same boundary themselves. People who
-- share a task or workflow run with the viewer stay visible by name, so a
-- cross-location assignee still sees who asked for the work.
create function org_person_shares_work_with_me(p_person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with me as (select (current_profile()).id id)
  select exists (
    select 1 from task_instances t, me
    where t.deleted_at is null
      and (t.created_by = p_person or exists (select 1 from task_assignees a where a.task_instance_id = t.id and a.user_profile_id = p_person and a.is_active)
           or exists (select 1 from task_watchers w where w.task_instance_id = t.id and w.user_profile_id = p_person))
      and (t.created_by = me.id or exists (select 1 from task_assignees a where a.task_instance_id = t.id and a.user_profile_id = me.id and a.is_active)
           or exists (select 1 from task_watchers w where w.task_instance_id = t.id and w.user_profile_id = me.id)))
  or exists (
    select 1 from fms_instances i, me
    where (i.started_by = p_person or exists (select 1 from fms_instance_stages s where s.fms_instance_id = i.id and p_person = any(s.assigned_to)))
      and (i.started_by = me.id or exists (select 1 from fms_instance_stages s where s.fms_instance_id = i.id and me.id = any(s.assigned_to))));
$$;

create or replace view v_task_users as
 select id, tenant_id, branch_id, department_id, employee_name, user_role, employee_code, working_status, buddy_id
   from user_profiles
  where tenant_id = current_tenant_id() and current_profile_is_active()
    and (org_record_in_filter((select org_my_branch_filter()), branch_id, null)
         or id = (select (current_profile()).id) or org_person_shares_work_with_me(id));

create or replace view leave_summary_applicants with (security_barrier = true) as
 select distinct p.id, p.employee_name
   from user_profiles p join leave_requests r on r.applicant_id = p.id
  where current_profile_is_active() and module_accessible('availability'::text) and p.tenant_id = current_tenant_id()
    and r.tenant_id = p.tenant_id and has_permission('availability.view_leave_summary'::text)
    and org_record_in_filter((select org_my_branch_filter()), r.branch_id, array[p.id]);

-- Answers only for the signed-in person (the view's caller).
create function org_recipient_in_my_local_scope(p_recipient_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select org_recipient_in_local_scope((current_profile()).id, p_recipient_id);
$$;
revoke all on function org_recipient_in_my_local_scope(uuid) from public, anon;
grant execute on function org_recipient_in_my_local_scope(uuid) to authenticated;

create or replace view leave_handover_candidates with (security_barrier = true) as
 select id, employee_name
   from user_profiles p
  where current_profile_is_active() and module_accessible('availability'::text) and tenant_id = current_tenant_id()
    and working_status = 'active'::working_status and account_status = 'active'::user_account_status and is_login_enabled
    and id <> (current_profile()).id
    and org_recipient_in_my_local_scope(p.id)
  order by employee_name, id;

-- Dropdown Master is one company-wide vocabulary. Changing an existing list
-- affects every franchise, so while isolation is on only company scope may.
create function org_assert_company_config_write()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if org_my_scope_enforced() and not org_i_have_company_scope() then
    raise exception 'This setting is shared by every franchise; only Super Admin can change it' using errcode = '42501';
  end if;
end $$;
select pg_temp.franchise_patch('public.change_dropdown_with_audit(text,uuid,text,text,text,integer,boolean)',
  E'  select * into v_actor from current_profile() where auth_user_id = auth.uid();',
  E'  select * into v_actor from current_profile() where auth_user_id = auth.uid();\n  perform org_assert_company_config_write();', 1);

-- ---------------------------------------------------------------------------
-- 9. Ask Kiara and FMS AI
-- ---------------------------------------------------------------------------

-- Kiara answers through the asker's own section RPCs (tasks, dashboard,
-- reports, availability, progress), which follow scope above. Its own
-- lookups follow the same rule:
select pg_temp.franchise_patch('public.kiara_directory_lookup(text,integer)',
  'where p.tenant_id = v_actor.tenant_id',
  'where p.tenant_id = v_actor.tenant_id and org_recipient_in_local_scope(v_actor.id, p.id)', 1);
select pg_temp.franchise_patch('public.get_task_evidence_workspace(jsonb)',
  '(v_branch is null or t.branch_id=v_branch)',
  '(v_branch is null or t.branch_id=v_branch) and org_task_in_filter((select org_my_branch_filter()),t.id,t.branch_id,t.created_by)', 1);
select pg_temp.franchise_patch('public.get_task_evidence_workspace(jsonb)',
  '(v_branch is null or fi.branch_id=v_branch)',
  '(v_branch is null or fi.branch_id=v_branch) and org_fms_instance_in_filter((select org_my_branch_filter()),fi.id,fi.branch_id,fi.started_by)', 1);
select pg_temp.franchise_patch('public.get_task_evidence_workspace(jsonb)',
  '(v_branch is null or u.branch_id=v_branch)',
  '(v_branch is null or u.branch_id=v_branch) and org_record_in_filter((select org_my_branch_filter()),u.branch_id,null)', 1);
select pg_temp.franchise_patch('public.kiara_insight_scope(uuid,uuid,boolean)',
  'and (p_tenant_wide or is_reporting_descendant(p_actor_id, p.id))',
  'and ((p_tenant_wide and org_record_in_filter((select org_branch_filter_for(p_tenant_id, p_actor_id)), p.branch_id, null)) or is_reporting_descendant(p_actor_id, p.id))', 1);
select pg_temp.franchise_patch('public.kiara_escalation_answerer(uuid,uuid,uuid,uuid)',
  'kiara_effective_role(actor.id) in (''admin'', ''super_admin'')',
  '(kiara_effective_role(actor.id) in (''admin'', ''super_admin'') and org_record_in_filter(org_branch_filter_for(actor.tenant_id, actor.id), p_branch_id, array[asker.id]))', 1);
select pg_temp.franchise_patch('public.search_kiara_limit_people(text)',
  'where p.tenant_id = v_actor.tenant_id and p.working_status <> ''resigned''',
  'where p.tenant_id = v_actor.tenant_id and p.working_status <> ''resigned'' and org_record_in_filter((select org_my_branch_filter()), p.branch_id, null)', 1);

-- ---------------------------------------------------------------------------
-- 10. Cross-store task assignment inside one franchise
-- ---------------------------------------------------------------------------

-- 0386 accepted an explicit cross-location request only for a store of another
-- mapped franchise. The same explicit, audited request now also covers another
-- mapped store of the author's own franchise. The local
-- rules (manager: own branch; staff: own department) are unchanged for every
-- task that does not name another store; every doer must belong to the named
-- store and be eligible, and the request is re-checked on the server.
create or replace function org_begin_cross_location_task(p_payload jsonb, p_doer_ids uuid[], p_watcher_ids uuid[])
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
  if not exists (select 1 from branches b where b.id = v_branch and b.tenant_id = a.tenant_id and b.is_active) then return false; end if;
  -- Only between stores the owner has mapped into franchises: before the
  -- franchise structure exists, today's local rules apply unchanged.
  if franchise_of_branch(v_branch) is null or franchise_of_branch(a.branch_id) is null then return false; end if;
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

-- Ordinary task creation names the doer's store and department, so the
-- bounded recipient lookup returns the department id (an id only; still no
-- phone, email or HR detail).
select pg_temp.franchise_patch('public.search_assignment_recipients(jsonb,uuid,text,integer,integer)',
  '''branch_id'', b.id, ''branch_name'', b.name,',
  '''branch_id'', b.id, ''branch_name'', b.name, ''department_id'', u.department_id,', 1);

-- ---------------------------------------------------------------------------
-- 11. Coverage registry
-- ---------------------------------------------------------------------------

-- Each row is closed for what this migration enforces and its pgTAP files
-- (0387_franchise_scope_completion.test.sql)
-- prove. The activation lock (franchise_enforcement_supported) is unchanged.
-- CRM customers are deliberately company-wide (owner decision 2026-11-06): the
-- row records that decision instead of a filter.
update franchise_scope_modules set status = 'enforced', pending_reason = null, updated_at = now(), covered_by = v.covered
from (values
  ('task_control', '0387 task_workspace_page, template directory/guard, reassignment, import, recurring and admin task actions'),
  ('fms_builder', '0387 fms_definition_write_guard, can_manage_fms_flow, flow report visibility, trigger history, handoff picker'),
  ('reports_exports', '0387 report rows scoped before aggregation, background requester scope, export access, dashboard and Home counts'),
  ('store_intelligence', 'own-store recording reads (0383/0384); 0387 company scope for shared sales score rules'),
  ('storage', '0387 task attachment uploads, FMS context files, leave images; reads follow record predicates'),
  ('kiara', '0387 directory lookup, evidence workspace, insights and escalations; tools read through scoped section RPCs'),
  ('search_availability', '0387 availability and leave policies and writes, directory views, Dropdown Master company-only changes'),
  ('crm_clients', 'Owner decision 2026-11-06: customer details and history are shared by every store, branch and city (no franchise filter)')
) v(module, covered)
where franchise_scope_modules.module = v.module;

-- ---------------------------------------------------------------------------
-- 12. Grants
-- ---------------------------------------------------------------------------

revoke all on function org_branch_filter_for(uuid, uuid), org_my_branch_filter(), org_record_in_filter(uuid[], uuid, uuid[]),
  org_task_in_filter(uuid[], uuid, uuid, uuid), org_fms_instance_in_filter(uuid[], uuid, uuid, uuid),
  org_assert_person_in_my_scope(uuid), org_assert_task_in_my_scope(uuid), org_assert_fms_stage_in_my_scope(uuid),
  task_template_franchise_guard(), fms_definition_write_guard(), org_assert_fms_family_visible(uuid),
  org_trigger_event_in_my_scope(uuid), org_report_branch_allowed(user_profiles, uuid[], uuid, uuid), org_export_in_my_scope(uuid),
  org_task_id_in_my_scope(uuid), org_person_shares_work_with_me(uuid), org_assert_company_config_write()
  from public, anon, authenticated;
-- Evaluated inside policies and owner-run views as the querying role.
grant execute on function org_my_branch_filter(), org_record_in_filter(uuid[], uuid, uuid[]), org_person_shares_work_with_me(uuid)
  to authenticated;

drop function pg_temp.franchise_patch(text, text, text, integer);
notify pgrst, 'reload schema';
