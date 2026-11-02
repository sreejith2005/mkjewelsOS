-- 0366: Delete on a workflow card removes the whole workflow.
--
-- 0365 deleted one version at a time, so a workflow with many versions kept
-- showing the next older (archived) version after each delete. Now:
-- - delete_fms_workflow_with_audit removes every version of a workflow family.
--   No runs anywhere: any workflow builder. With runs: super admin only, after
--   typing DELETE; other builders archive it, as before.
-- - Removal leaves no trace in the app: alerts and queued alerts for the removed
--   work are deleted, not just closed. One audit_logs row remains.
-- - fms_workflow_deletion_impact drives the warning.
set search_path = public, extensions;

-- Same as 0365, except that alerts for the removed work are deleted.
create or replace function public.remove_fms_flow_rows(p_flow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flow fms_flows;
  v_instances uuid[];
  v_visits uuid[];
  v_starters uuid[];
  v_stages uuid[];
  v_removed integer;
  v_unlinked integer;
  v_more integer;
begin
  select * into v_flow from fms_flows where id = p_flow_id for update;
  if v_flow.id is null then raise exception 'Flow not found' using errcode = '23514'; end if;

  select coalesce(array_agg(id), '{}') into v_instances from fms_instances where fms_flow_id = v_flow.id;
  select coalesce(array_agg(id), '{}') into v_visits from fms_instance_stages where fms_instance_id = any(v_instances);
  select coalesce(array_agg(id), '{}') into v_starters from fms_starter_assignments where fms_flow_id = v_flow.id;
  select coalesce(array_agg(id), '{}') into v_stages from fms_stages where fms_flow_id = v_flow.id;

  perform set_config('jewelos.allow_fms_flow_removal', v_flow.id::text, true);

  -- Alerts for the removed work go with it; their delivery rows cascade.
  delete from notifications
   where tenant_id = v_flow.tenant_id and source_module = 'fms'
     and source_record_id = any(v_instances || v_visits || v_starters);
  get diagnostics v_removed = row_count;
  delete from notification_events
   where tenant_id = v_flow.tenant_id and source_module = 'fms'
     and source_record_id = any(v_instances || v_visits || v_starters);

  -- Runs of this version, with their steps, checklists, uploads and outcomes.
  delete from crm_sync.customer_workflow_links where instance_id = any(v_instances);
  update fms_instances set parent_instance_id = null
   where parent_instance_id = any(v_instances) and not (id = any(v_instances));
  -- A run's steps go in one cascaded statement, so links between them never block.
  delete from fms_instances where id = any(v_instances);

  -- Other workflows that handed off to this one stop handing off.
  update fms_branch_rules set next_flow_id = null where next_flow_id = v_flow.id;
  get diagnostics v_unlinked = row_count;
  update fms_stages set split_to_flow_id = null where split_to_flow_id = v_flow.id and fms_flow_id <> v_flow.id;
  get diagnostics v_more = row_count;
  v_unlinked := v_unlinked + v_more;

  -- Routes before steps: a route may point at a step that is deleted first.
  delete from fms_branch_rules where fms_stage_id = any(v_stages) or next_stage_id = any(v_stages);
  -- One statement, so step-to-step default links are all gone before they are checked.
  delete from fms_stages where fms_flow_id = v_flow.id;
  -- Starter assignments, assignees and diagnostics cascade with the flow.
  delete from fms_flows where id = v_flow.id;

  perform set_config('jewelos.allow_fms_flow_removal', '', true);
  return jsonb_build_object('runs', cardinality(v_instances), 'steps', cardinality(v_stages),
    'notificationsRemoved', v_removed, 'handoffsRemoved', v_unlinked);
end
$$;

-- What Delete on a workflow card will do, for the warning shown before it runs.
create function public.fms_workflow_deletion_impact(p_family_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_name text;
  v_versions integer;
  v_live integer;
  v_runs integer;
  v_open integer;
  v_super boolean := is_super_admin();
begin
  perform public.assert_module_enabled('fms_builder');
  select * into v_actor from current_profile();
  if not can_manage_fms_flow(null) then raise exception 'FMS builder access denied' using errcode = '42501'; end if;
  select (array_agg(name order by version desc))[1], count(*), count(*) filter (where status <> 'archived')
    into v_name, v_versions, v_live
    from fms_flows where family_id = p_family_id and tenant_id = v_actor.tenant_id;
  if v_versions = 0 then raise exception 'Workflow not found' using errcode = '23514'; end if;
  select count(*), count(*) filter (where i.status in ('active', 'on_hold', 'overdue'))
    into v_runs, v_open
    from fms_instances i join fms_flows f on f.id = i.fms_flow_id
   where f.family_id = p_family_id and f.tenant_id = v_actor.tenant_id;
  return jsonb_build_object(
    'name', v_name, 'versions', v_versions, 'runs', v_runs, 'openRuns', v_open,
    'handoffsFrom', coalesce((
      select jsonb_agg(distinct f.name order by f.name)
      from fms_flows f join fms_stages s on s.fms_flow_id = f.id
      where f.tenant_id = v_actor.tenant_id and f.family_id <> p_family_id
        and (s.split_to_flow_id in (select id from fms_flows where family_id = p_family_id)
             or exists (select 1 from fms_branch_rules r where r.fms_stage_id = s.id
                        and r.next_flow_id in (select id from fms_flows where family_id = p_family_id)))
    ), '[]'::jsonb),
    'canErase', v_super,
    'action', case when v_runs = 0 then 'delete'
                   when v_super then 'erase'
                   when v_live > 0 then 'archive'
                   else 'denied' end);
end
$$;

-- Removes every version of a workflow; a builder who is not a super admin
-- archives a workflow that has runs instead.
create function public.delete_fms_workflow_with_audit(p_family_id uuid, p_confirmation text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_id uuid;
  v_name text;
  v_ids uuid[];
  v_runs integer;
  v_open integer;
  v_removed jsonb;
  v_versions integer := 0;
  v_notifications integer := 0;
  v_handoffs integer := 0;
begin
  perform public.assert_module_enabled('fms_builder');
  select * into v_actor from current_profile();
  if v_actor.id is null or not can_manage_fms_flow(null) then
    raise exception 'FMS builder access denied' using errcode = '42501';
  end if;
  perform 1 from fms_flows where family_id = p_family_id and tenant_id = v_actor.tenant_id order by id for update;
  select coalesce(array_agg(id order by version), '{}'), (array_agg(name order by version desc))[1]
    into v_ids, v_name from fms_flows where family_id = p_family_id and tenant_id = v_actor.tenant_id;
  if cardinality(v_ids) = 0 then raise exception 'Workflow not found' using errcode = '23514'; end if;
  select count(*), count(*) filter (where status in ('active', 'on_hold', 'overdue'))
    into v_runs, v_open from fms_instances where fms_flow_id = any(v_ids);

  if v_runs > 0 and not is_super_admin() then
    -- A builder who is not a super admin keeps the history: archive what is live.
    if not exists (select 1 from fms_flows where id = any(v_ids) and status <> 'archived') then
      raise exception 'This workflow is archived and has % run(s). Only a super admin can delete it permanently.', v_runs using errcode = '42501';
    end if;
    update fms_flows set status = 'archived', is_active = false, archived_by = v_actor.id, archived_at = now(),
      updated_by = v_actor.id, updated_at = now()
     where id = any(v_ids) and status <> 'archived';
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (v_actor.tenant_id, v_actor.id, 'fms_workflow_archived', 'fms_flows', p_family_id,
      jsonb_build_object('name', v_name, 'versions', cardinality(v_ids), 'runs', v_runs), '{}'::jsonb);
    return jsonb_build_object('outcome', 'archived', 'versions', cardinality(v_ids), 'runs', v_runs);
  end if;

  if v_runs > 0 and p_confirmation is distinct from 'DELETE' then
    raise exception 'Type DELETE to confirm' using errcode = '22023';
  end if;

  foreach v_id in array v_ids loop
    v_removed := remove_fms_flow_rows(v_id);
    v_versions := v_versions + 1;
    v_notifications := v_notifications + (v_removed->>'notificationsRemoved')::integer;
    v_handoffs := v_handoffs + (v_removed->>'handoffsRemoved')::integer;
  end loop;

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'fms_workflow_deleted', 'fms_flows', p_family_id,
    jsonb_build_object('name', v_name, 'versions', v_versions, 'runs', v_runs, 'open_runs', v_open),
    jsonb_build_object('notificationsRemoved', v_notifications, 'handoffsRemoved', v_handoffs));
  return jsonb_build_object('outcome', 'deleted', 'versions', v_versions, 'runs', v_runs);
end
$$;

revoke all on function public.fms_workflow_deletion_impact(uuid), public.delete_fms_workflow_with_audit(uuid,text) from public, anon, service_role;
grant execute on function public.fms_workflow_deletion_impact(uuid), public.delete_fms_workflow_with_audit(uuid,text) to authenticated;

notify pgrst, 'reload schema';
