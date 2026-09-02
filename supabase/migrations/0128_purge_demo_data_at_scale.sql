-- Makes purge_demo_data (0127) survive a real tenant's data volume.
--
-- Three problems, all of which only appear at scale or on a partial selection:
--
-- 1. Realtime trigger fan-out. 0102 puts per-row AFTER triggers on every task,
--    FMS and forms table; each one runs a SELECT plus an INSERT into
--    tenant_realtime_events. Clearing ~4k tasks means ~9.7k extra trigger
--    round-trips (task_instances + assignees + checklists + attachments +
--    watchers), on top of the deletes themselves, inside one transaction. The
--    events they write are then immediately worthless: the rows they point at
--    no longer exist, and the purge sweeps that table anyway. So the triggers
--    are disabled for the duration of the purge and the sweep is repeated at
--    the end.
--
-- 2. statement_timeout. The purge is a single long transaction; it must not
--    inherit a short interactive timeout.
--
-- 3. task_import_items.{task_instance_id,task_template_id} (0101, both NO
--    ACTION) were missed by 0127. Deleting Tasks or Recurring templates WITHOUT
--    also selecting Task imports raises a foreign key violation. Cleared the
--    same way 0127 already clears buddy_assignments.
--
-- Module semantics, retention and authorization are unchanged from 0127.

create or replace function public.purge_demo_data(
  p_actor_auth_user_id uuid,
  p_modules text[],
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
set statement_timeout = '240s'
as $$
declare
  v_actor public.user_profiles;
  v_tenant uuid;
  v_valid constant text[] := array['tasks','recurring_templates','task_imports','fms','forms','notifications','checklists'];
  -- table -> realtime trigger, for every table this purge writes to.
  v_realtime constant text[][] := array[
    ['task_instances','tenant_realtime_tasks_direct'],
    ['task_assignees','tenant_realtime_tasks_assignees'],
    ['task_watchers','tenant_realtime_tasks_watchers'],
    ['task_checklists','tenant_realtime_tasks_checklists'],
    ['task_attachments','tenant_realtime_tasks_attachments'],
    ['task_comments','tenant_realtime_tasks_comments'],
    ['task_revisions','tenant_realtime_tasks_revisions'],
    ['fms_instances','tenant_realtime_fms_instances'],
    ['fms_instance_stages','tenant_realtime_fms_stages_runtime'],
    ['fms_instance_checklist_items','tenant_realtime_fms_checklists'],
    ['fms_evidence','tenant_realtime_fms_evidence'],
    ['fms_stage_logs','tenant_realtime_fms_logs'],
    ['fms_flows','tenant_realtime_fms_flows'],
    ['fms_stages','tenant_realtime_fms_definitions'],
    ['fms_stage_assignees','tenant_realtime_fms_assignees'],
    ['fms_branch_rules','tenant_realtime_fms_branch_rules'],
    ['form_templates','tenant_realtime_forms_templates'],
    ['form_submissions','tenant_realtime_forms_submissions'],
    ['form_fields','tenant_realtime_forms_fields'],
    ['form_links','tenant_realtime_forms_links']
  ];
  v_unknown text[];
  v_pair text[];
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

  -- Transaction-scoped: an error anywhere below rolls the re-enable back in too.
  foreach v_pair slice 1 in array v_realtime loop
    execute format('alter table public.%I disable trigger %I', v_pair[1], v_pair[2]);
  end loop;

  -- Runtime residue, always. Deliveries/logs/events go first because
  -- notification_deliveries.rule_id and .template_id are NO ACTION references
  -- into the rows the notifications module deletes below.
  delete from public.notification_deliveries where tenant_id = v_tenant;
  delete from public.notification_logs where notification_id in (select id from public.notifications where tenant_id = v_tenant);
  delete from public.notification_events where tenant_id = v_tenant;
  delete from public.export_logs where tenant_id = v_tenant;
  delete from public.performance_snapshots where tenant_id = v_tenant;
  delete from public.task_import_row_registry where tenant_id = v_tenant;

  -- Clear NO ACTION references held by rows that survive this purge, so any
  -- subset of modules can be selected on its own. No-ops when the referencing
  -- rows are themselves being deleted below.
  update public.buddy_assignments set task_instance_id = null
    where tenant_id = v_tenant and task_instance_id is not null;
  update public.task_import_items set task_instance_id = null, task_template_id = null
    where tenant_id = v_tenant and (task_instance_id is not null or task_template_id is not null);

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

  foreach v_pair slice 1 in array v_realtime loop
    execute format('alter table public.%I enable trigger %I', v_pair[1], v_pair[2]);
  end loop;

  -- Last, so it also clears anything emitted before the triggers went down.
  delete from public.tenant_realtime_events where tenant_id = v_tenant;

  v_after := public.demo_data_purge_counts(p_actor_auth_user_id);
  v_result := jsonb_build_object('modules', to_jsonb(p_modules), 'before', v_before, 'after', v_after);

  insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_tenant, v_actor.id, 'demo_data_purged', 'demo_data_purge', v_actor.id, v_result);

  return v_result;
end;
$$;

revoke all on function public.purge_demo_data(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.purge_demo_data(uuid, text[], text) to service_role;

notify pgrst, 'reload schema';
