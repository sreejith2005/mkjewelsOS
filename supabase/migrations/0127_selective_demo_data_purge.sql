-- Repeatable, selective purge of operational (demo/test) data.
--
-- 0106 shipped a one-shot production cutover: a single all-or-nothing manifest
-- locked behind a preview row, a SHA-256 count hash, a 20-minute expiry and a
-- one-open-operation-per-tenant index. In a live tenant that contract is close
-- to unexecutable -- tenant_realtime_events and notifications churn constantly,
-- so the post-preview hash recheck almost always fails -- and it cannot express
-- "delete only Forms" at all.
--
-- This adds a contract the owner can actually use: pick the modules to clear,
-- confirm, done. It is repeatable, holds no lock, and expires nothing.
--
-- Two foreign keys make selective deletion non-trivial, and 0106 gets one of
-- them wrong:
--   * buddy_assignments.task_instance_id -> task_instances (fk_buddy_task, NO
--     ACTION). buddy_assignments is RETAINED data, so a retained row pointing at
--     a doomed task aborts the whole delete. 0106 never clears it.
--   * task_import_row_registry.{task_instance_id,task_template_id} (NO ACTION).
--     0106 only survives this because it deletes import batches first and the
--     registry cascades off first_batch_id.
-- Both are handled here by nulling/sweeping the reference before the delete, so
-- any subset of modules can be purged independently.
--
-- Never touched by any module: auth users, user_profiles, branches, departments,
-- user_availability, buddy_assignments rows, dropdown masters, settings, section
-- controls, preferences, every CRM table, and audit_logs.

create or replace function public.demo_data_purge_actor(p_actor_auth_user_id uuid)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.user_profiles;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Demo-data purge denied' using errcode = '42501';
  end if;

  select * into v_actor
  from public.user_profiles
  where auth_user_id = p_actor_auth_user_id;

  if v_actor.id is null
     or v_actor.user_role <> 'super_admin'
     or v_actor.working_status <> 'active'
     or v_actor.account_status <> 'active'
     or not coalesce(v_actor.is_login_enabled, false) then
    raise exception 'Demo-data purge denied' using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

-- Live row counts for the Settings panel. Read-only: no preview row, no hash,
-- no lock, so it is safe to poll and safe to call before every purge.
create or replace function public.demo_data_purge_counts(p_actor_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.user_profiles;
  v_tenant uuid;
begin
  v_actor := public.demo_data_purge_actor(p_actor_auth_user_id);
  v_tenant := v_actor.tenant_id;

  return jsonb_build_object(
    'modules', jsonb_build_object(
      'tasks', jsonb_build_object(
        'label', 'Tasks',
        'total', (select count(*) from public.task_instances where tenant_id = v_tenant),
        'detail', jsonb_build_object(
          'task_instances', (select count(*) from public.task_instances where tenant_id = v_tenant),
          'task_assignees', (select count(*) from public.task_assignees a join public.task_instances t on t.id = a.task_instance_id where t.tenant_id = v_tenant),
          'task_checklists', (select count(*) from public.task_checklists c join public.task_instances t on t.id = c.task_instance_id where t.tenant_id = v_tenant),
          'task_comments', (select count(*) from public.task_comments c join public.task_instances t on t.id = c.task_instance_id where t.tenant_id = v_tenant),
          'task_attachments', (select count(*) from public.task_attachments a join public.task_instances t on t.id = a.task_instance_id where t.tenant_id = v_tenant),
          'task_revisions', (select count(*) from public.task_revisions r join public.task_instances t on t.id = r.task_instance_id where t.tenant_id = v_tenant),
          'task_watchers', (select count(*) from public.task_watchers w join public.task_instances t on t.id = w.task_instance_id where t.tenant_id = v_tenant)
        )
      ),
      'recurring_templates', jsonb_build_object(
        'label', 'Recurring task templates',
        'total', (select count(*) from public.task_templates where tenant_id = v_tenant),
        'detail', jsonb_build_object('task_templates', (select count(*) from public.task_templates where tenant_id = v_tenant))
      ),
      'task_imports', jsonb_build_object(
        'label', 'Task import batches',
        'total', (select count(*) from public.task_import_items where tenant_id = v_tenant)
                 + (select count(*) from public.task_import_batches where tenant_id = v_tenant),
        'detail', jsonb_build_object(
          'task_import_items', (select count(*) from public.task_import_items where tenant_id = v_tenant),
          'task_import_batches', (select count(*) from public.task_import_batches where tenant_id = v_tenant)
        )
      ),
      'fms', jsonb_build_object(
        'label', 'FMS workflows',
        'total', (select count(*) from public.fms_flows where tenant_id = v_tenant)
                 + (select count(*) from public.fms_instances where tenant_id = v_tenant),
        'detail', jsonb_build_object(
          'fms_flows', (select count(*) from public.fms_flows where tenant_id = v_tenant),
          'fms_instances', (select count(*) from public.fms_instances where tenant_id = v_tenant),
          'fms_evidence', (select count(*) from public.fms_evidence where tenant_id = v_tenant)
        )
      ),
      'forms', jsonb_build_object(
        'label', 'Forms',
        'total', (select count(*) from public.form_templates where tenant_id = v_tenant)
                 + (select count(*) from public.form_submissions where tenant_id = v_tenant),
        'detail', jsonb_build_object(
          'form_templates', (select count(*) from public.form_templates where tenant_id = v_tenant),
          'form_submissions', (select count(*) from public.form_submissions where tenant_id = v_tenant),
          'form_submission_files', (select count(*) from public.form_submission_files where tenant_id = v_tenant)
        )
      ),
      'notifications', jsonb_build_object(
        'label', 'Notifications',
        'total', (select count(*) from public.notifications where tenant_id = v_tenant)
                 + (select count(*) from public.notification_rules where tenant_id = v_tenant)
                 + (select count(*) from public.notification_templates where tenant_id = v_tenant),
        'detail', jsonb_build_object(
          'notifications', (select count(*) from public.notifications where tenant_id = v_tenant),
          'notification_rules', (select count(*) from public.notification_rules where tenant_id = v_tenant),
          'notification_templates', (select count(*) from public.notification_templates where tenant_id = v_tenant)
        )
      ),
      'checklists', jsonb_build_object(
        'label', 'Designation daily checklists',
        'total', (select count(*) from public.designation_daily_checklists where tenant_id = v_tenant)
                 + (select count(*) from public.daily_checklist_acknowledgements where tenant_id = v_tenant),
        'detail', jsonb_build_object(
          'designation_daily_checklists', (select count(*) from public.designation_daily_checklists where tenant_id = v_tenant),
          'daily_checklist_acknowledgements', (select count(*) from public.daily_checklist_acknowledgements where tenant_id = v_tenant)
        )
      )
    ),
    -- Derived runtime residue: logs, outbox rows and realtime fan-out records.
    -- These carry no configuration the owner would ever want to keep, so every
    -- purge clears them without asking.
    'always_swept', jsonb_build_object(
      'tenant_realtime_events', (select count(*) from public.tenant_realtime_events where tenant_id = v_tenant),
      'notification_events', (select count(*) from public.notification_events where tenant_id = v_tenant),
      'notification_deliveries', (select count(*) from public.notification_deliveries where tenant_id = v_tenant),
      'notification_logs', (select count(*) from public.notification_logs l join public.notifications n on n.id = l.notification_id where n.tenant_id = v_tenant),
      'export_logs', (select count(*) from public.export_logs where tenant_id = v_tenant),
      'performance_snapshots', (select count(*) from public.performance_snapshots where tenant_id = v_tenant),
      'task_import_row_registry', (select count(*) from public.task_import_row_registry where tenant_id = v_tenant)
    ),
    'retained', jsonb_build_object(
      'user_profiles', (select count(*) from public.user_profiles where tenant_id = v_tenant),
      'branches', (select count(*) from public.branches where tenant_id = v_tenant),
      'departments', (select count(*) from public.departments where tenant_id = v_tenant),
      'user_availability', (select count(*) from public.user_availability where tenant_id = v_tenant),
      'buddy_assignments', (select count(*) from public.buddy_assignments where tenant_id = v_tenant),
      'dropdown_masters', (select count(*) from public.dropdown_masters where tenant_id = v_tenant),
      'clients', (select count(*) from public.clients where tenant_id = v_tenant),
      'crm_documents', (select count(*) from public.crm_documents where tenant_id = v_tenant),
      'audit_logs', (select count(*) from public.audit_logs where tenant_id = v_tenant)
    )
  );
end;
$$;

create or replace function public.purge_demo_data(
  p_actor_auth_user_id uuid,
  p_modules text[],
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor public.user_profiles;
  v_tenant uuid;
  v_valid constant text[] := array['tasks','recurring_templates','task_imports','fms','forms','notifications','checklists'];
  v_unknown text[];
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  v_actor := public.demo_data_purge_actor(p_actor_auth_user_id);
  v_tenant := v_actor.tenant_id;

  if p_confirmation is distinct from 'DELETE' then
    raise exception 'Type DELETE to confirm the purge' using errcode = '22023';
  end if;
  if p_modules is null or cardinality(p_modules) = 0 then
    raise exception 'Select at least one module to purge' using errcode = '22023';
  end if;

  select array_agg(m order by m) into v_unknown
  from unnest(p_modules) as m
  where m <> all(v_valid);
  if coalesce(cardinality(v_unknown), 0) <> 0 then
    raise exception 'Unknown purge modules: %', array_to_string(v_unknown, ', ') using errcode = '22023';
  end if;

  v_before := public.demo_data_purge_counts(p_actor_auth_user_id);

  -- 1. Runtime residue, always. Deliveries/logs/events go first because
  -- notification_deliveries.rule_id and .template_id are NO ACTION references
  -- into the rows the notifications module deletes below.
  delete from public.notification_deliveries where tenant_id = v_tenant;
  delete from public.notification_logs where notification_id in (select id from public.notifications where tenant_id = v_tenant);
  delete from public.notification_events where tenant_id = v_tenant;
  delete from public.tenant_realtime_events where tenant_id = v_tenant;
  delete from public.export_logs where tenant_id = v_tenant;
  delete from public.performance_snapshots where tenant_id = v_tenant;
  delete from public.task_import_row_registry where tenant_id = v_tenant;

  -- 2. Clear NO ACTION references held by rows that survive the purge, so each
  -- module can be selected on its own. No-ops when the referencing rows are
  -- themselves being deleted below.
  update public.buddy_assignments set task_instance_id = null
    where tenant_id = v_tenant and task_instance_id is not null;

  if 'checklists' = any(p_modules) then
    delete from public.daily_checklist_acknowledgements where tenant_id = v_tenant;
    delete from public.designation_daily_checklists where tenant_id = v_tenant;
  end if;

  if 'task_imports' = any(p_modules) then
    delete from public.task_import_items where tenant_id = v_tenant;
    delete from public.task_import_batches where tenant_id = v_tenant;
  end if;

  if 'tasks' = any(p_modules) then
    delete from public.task_instances where tenant_id = v_tenant;
  end if;

  if 'recurring_templates' = any(p_modules) then
    update public.task_instances set task_template_id = null
      where tenant_id = v_tenant and task_template_id is not null;
    delete from public.task_templates where tenant_id = v_tenant;
  end if;

  -- FMS before Forms: fms_starter_assignments.form_template_id is NOT NULL and
  -- fms_stages/fms_instance_stages hold NO ACTION references into forms.
  if 'fms' = any(p_modules) then
    delete from public.fms_evidence where tenant_id = v_tenant;
    delete from public.fms_instances where tenant_id = v_tenant;
    delete from public.fms_flows where tenant_id = v_tenant;
  end if;

  if 'forms' = any(p_modules) then
    -- NOT NULL reference: these rows cannot outlive their form template.
    delete from public.fms_starter_assignments where tenant_id = v_tenant;
    update public.fms_instance_stages set form_submission_id = null
      where form_submission_id in (select id from public.form_submissions where tenant_id = v_tenant);
    update public.fms_stages set form_template_id = null
      where form_template_id in (select id from public.form_templates where tenant_id = v_tenant);
    update public.task_instances set form_template_id = null
      where tenant_id = v_tenant and form_template_id is not null;
    update public.task_templates set form_template_id = null
      where tenant_id = v_tenant and form_template_id is not null;
    delete from public.form_submission_files where tenant_id = v_tenant;
    delete from public.form_submissions where tenant_id = v_tenant;
    delete from public.form_templates where tenant_id = v_tenant;
  end if;

  if 'notifications' = any(p_modules) then
    delete from public.notifications where tenant_id = v_tenant;
    delete from public.notification_rules where tenant_id = v_tenant;
    delete from public.notification_templates where tenant_id = v_tenant;
  end if;

  v_after := public.demo_data_purge_counts(p_actor_auth_user_id);
  v_result := jsonb_build_object('modules', to_jsonb(p_modules), 'before', v_before, 'after', v_after);

  insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_tenant, v_actor.id, 'demo_data_purged', 'demo_data_purge', v_actor.id, v_result);

  return v_result;
end;
$$;

revoke all on function public.demo_data_purge_actor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.demo_data_purge_counts(uuid) from public, anon, authenticated;
revoke all on function public.purge_demo_data(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.demo_data_purge_counts(uuid) to service_role;
grant execute on function public.purge_demo_data(uuid, text[], text) to service_role;

notify pgrst, 'reload schema';
