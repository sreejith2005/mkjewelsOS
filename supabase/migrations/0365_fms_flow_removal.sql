-- 0365: FMS workflows can always be removed.
--
-- 1. Deleting a draft failed with "fms_branch_rules_next_stage_id_fkey": a
--    one-statement flow delete cascades into the steps, and a route from one
--    step to another blocked the step it points at before the cascade had
--    reached that route. Removal now deletes routes before steps.
-- 2. A version that was never run is deleted permanently, whatever its status.
--    A version with runs is still archived first, as before.
-- 3. A super admin can permanently erase any version, runs included, through
--    erase_fms_flow_with_audit after typing DELETE. Notifications for the
--    erased work are closed (kept as history); form answers stay in Forms.
set search_path = public, extensions;

-- The definition guard lets through only the rows of the one flow that an
-- audited removal contract below has named for this transaction.
create or replace function public.enforce_fms_definition_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_removing text := nullif(current_setting('jewelos.allow_fms_flow_removal', true), '');
begin
  -- Set only by purge_demo_data, transaction-locally, after it has verified an
  -- active super admin and the DELETE confirmation.
  if current_setting('jewelos.allow_demo_data_purge', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  -- Set only by remove_fms_flow_rows (0365) for the flow it is removing.
  if v_removing is not null then
    -- The trigger serves two tables, so columns are read through jsonb.
    if tg_op = 'DELETE' and to_jsonb(old)->>(case tg_table_name when 'fms_flows' then 'id' else 'fms_flow_id' end) = v_removing then
      return old;
    end if;
    -- Another workflow that handed off to the removed one stops handing off.
    if tg_op = 'UPDATE' and tg_table_name = 'fms_stages'
       and to_jsonb(old)->>'split_to_flow_id' = v_removing
       and to_jsonb(new)->>'split_to_flow_id' is null
       and to_jsonb(new) - 'split_to_flow_id' = to_jsonb(old) - 'split_to_flow_id' then
      return new;
    end if;
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
end
$$;

-- Private: removes one flow version and everything that belongs to it, in an
-- order no foreign key can trip over. Callers authorize and audit.
create function public.remove_fms_flow_rows(p_flow_id uuid)
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
  v_closed integer;
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

  -- Alerts for removed work close but stay in history; queued alerts are not sent.
  update notifications set is_read = true, read_at = coalesce(read_at, now())
   where tenant_id = v_flow.tenant_id and source_module = 'fms'
     and source_record_id = any(v_instances || v_visits || v_starters) and not coalesce(is_read, false);
  get diagnostics v_closed = row_count;
  update notification_events set status = 'processed', processed_at = now(), error_category = 'source_deleted'
   where tenant_id = v_flow.tenant_id and source_module = 'fms'
     and source_record_id = any(v_instances || v_visits || v_starters) and status in ('pending', 'failed');

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
    'notificationsClosed', v_closed, 'handoffsRemoved', v_unlinked);
end
$$;

-- What the delete button will do, for the warning shown before it runs.
create function public.fms_flow_deletion_impact(p_flow_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_flow fms_flows;
  v_runs integer;
  v_open integer;
  v_super boolean := is_super_admin();
begin
  perform public.assert_module_enabled('fms_builder');
  select * into v_actor from current_profile();
  if not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode = '42501'; end if;
  select * into v_flow from fms_flows where id = p_flow_id and tenant_id = v_actor.tenant_id;
  if v_flow.id is null then raise exception 'Flow not found' using errcode = '23514'; end if;
  select count(*), count(*) filter (where status in ('active', 'on_hold', 'overdue'))
    into v_runs, v_open from fms_instances where fms_flow_id = v_flow.id;
  return jsonb_build_object(
    'name', v_flow.name, 'version', v_flow.version, 'status', v_flow.status,
    'runs', v_runs, 'openRuns', v_open,
    'handoffsFrom', coalesce((
      select jsonb_agg(distinct f.name order by f.name)
      from fms_flows f join fms_stages s on s.fms_flow_id = f.id
      where f.id <> v_flow.id and f.tenant_id = v_flow.tenant_id
        and (s.split_to_flow_id = v_flow.id
             or exists (select 1 from fms_branch_rules r where r.fms_stage_id = s.id and r.next_flow_id = v_flow.id))
    ), '[]'::jsonb),
    'canErase', v_super,
    'action', case when v_runs = 0 then 'delete'
                   when v_super then 'erase'
                   when v_flow.status <> 'archived' then 'archive'
                   else 'denied' end);
end
$$;

-- Same contract as before; a never-run version is now removed in any status.
create or replace function public.delete_fms_flow_with_audit(p_flow_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor user_profiles; v_flow fms_flows; v_runs integer; v_removed jsonb;
begin
  perform public.assert_module_enabled('fms_builder');
  select * into v_actor from current_profile();
  if not can_manage_fms_flow(p_flow_id) then
    raise exception 'FMS builder access denied' using errcode='42501';
  end if;

  select * into v_flow from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id for update;
  if v_flow.id is null then
    raise exception 'Flow not found' using errcode='23514';
  end if;
  select count(*) into v_runs from fms_instances where fms_flow_id = v_flow.id;

  if v_runs = 0 then
    v_removed := remove_fms_flow_rows(v_flow.id);
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(v_actor.tenant_id,v_actor.id,'fms_flow_deleted','fms_flows',p_flow_id,
      jsonb_build_object('status',v_flow.status,'name',v_flow.name,'version',v_flow.version,'family_id',v_flow.family_id),
      v_removed || jsonb_build_object('reason',left(coalesce(p_reason, 'Deleted unused version'), 1000)));
  elsif v_flow.status <> 'archived' then
    -- A version with runs is archived so its history stays readable.
    update fms_flows set status='archived', is_active=false, archived_by=v_actor.id, archived_at=now(), updated_by=v_actor.id, updated_at=now() where id=p_flow_id;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(v_actor.tenant_id,v_actor.id,'fms_flow_archived','fms_flows',p_flow_id,jsonb_build_object('status',v_flow.status),jsonb_build_object('reason',left(coalesce(p_reason, 'Deleted published flow'), 1000)));
  else
    raise exception 'This version is already archived and has % run(s). Only a super admin can delete it permanently.', v_runs using errcode='42501';
  end if;
end
$$;

-- Super admin only: permanently removes a version and all of its runs.
create function public.erase_fms_flow_with_audit(p_flow_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_actor user_profiles; v_flow fms_flows; v_open integer; v_removed jsonb;
begin
  perform public.assert_module_enabled('fms_builder');
  select * into v_actor from current_profile();
  if v_actor.id is null or not can_manage_fms_flow(p_flow_id) or not is_super_admin() then
    raise exception 'Only a super admin can permanently delete a workflow and its runs' using errcode='42501';
  end if;
  if p_confirmation is distinct from 'DELETE' then
    raise exception 'Type DELETE to confirm' using errcode='22023';
  end if;
  select * into v_flow from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id for update;
  if v_flow.id is null then raise exception 'Flow not found' using errcode='23514'; end if;
  select count(*) into v_open from fms_instances where fms_flow_id=v_flow.id and status in ('active','on_hold','overdue');

  v_removed := remove_fms_flow_rows(v_flow.id);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'fms_flow_erased','fms_flows',p_flow_id,
    jsonb_build_object('status',v_flow.status,'name',v_flow.name,'version',v_flow.version,'family_id',v_flow.family_id,'open_runs',v_open),
    v_removed);
  return v_removed;
end
$$;

revoke all on function public.remove_fms_flow_rows(uuid) from public, anon, authenticated, service_role;
revoke all on function public.fms_flow_deletion_impact(uuid), public.erase_fms_flow_with_audit(uuid,text) from public, anon, service_role;
grant execute on function public.fms_flow_deletion_impact(uuid), public.erase_fms_flow_with_audit(uuid,text) to authenticated;

notify pgrst, 'reload schema';
