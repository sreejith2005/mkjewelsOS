-- The purge has to get past the definition-immutability guards.
--
-- fms_flows_immutable / fms_stages_immutable (0010, function last redefined by
-- 0117) refuse to delete any flow that is not a draft or that has instances,
-- and refuse any delete of a stage belonging to a published or archived flow --
-- which a cascading flow delete triggers too. That is correct for ordinary
-- editing: a published workflow must not lose its definition under running
-- work. It is wrong for the purge, whose entire purpose is to remove the
-- published flows and their instances together, in one transaction, on the
-- owner's explicit instruction.
--
-- Forms already model this exact exemption with the jewelos.allow_form_deletion
-- setting that the audited form-deletion action sets, so the FMS guard gets the
-- matching one rather than a new mechanism: jewelos.allow_demo_data_purge, set
-- transaction-locally by purge_demo_data and by nothing else. Outside that
-- transaction both guards behave exactly as before.
--
-- purge_demo_data is otherwise unchanged from 0128.

create or replace function enforce_fms_definition_immutability()
returns trigger language plpgsql set search_path=public as $$
begin
  -- Set only by purge_demo_data, transaction-locally, after it has verified an
  -- active super admin and the DELETE confirmation.
  if current_setting('jewelos.allow_demo_data_purge', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  if tg_table_name='fms_flows' then
    if tg_op='DELETE' and (old.status<>'draft' or exists(select 1 from fms_instances where fms_flow_id=old.id)) then raise exception 'Published or used flows cannot be deleted' using errcode='23514'; end if;
    if tg_op='UPDATE' and old.status in ('published','archived') and row(new.name,new.description,new.branch_id,new.department_id,new.family_id,new.version,new.trigger_type,new.scope_type) is distinct from row(old.name,old.description,old.branch_id,old.department_id,old.family_id,old.version,old.trigger_type,old.scope_type) then raise exception 'Published flow definitions are immutable' using errcode='23514'; end if;
  else
    if tg_op='UPDATE'
       and current_setting('jewelos.allow_form_deletion', true) = 'on'
       and old.form_template_id is not null
       and new.form_template_id is null
       and to_jsonb(new) - 'form_template_id' = to_jsonb(old) - 'form_template_id' then
      return new;
    end if;
    if exists(select 1 from fms_flows where id=coalesce(new.fms_flow_id,old.fms_flow_id) and status in ('published','archived')) then raise exception 'Published stage definitions are immutable' using errcode='23514'; end if;
  end if;
  return coalesce(new,old);
end $$;

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

  -- Transaction-local, and only now that the actor and confirmation are known
  -- good. Both are dropped when this function returns or raises.
  perform set_config('jewelos.allow_demo_data_purge', 'on', true);
  perform set_config('jewelos.allow_form_deletion', 'on', true);

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
