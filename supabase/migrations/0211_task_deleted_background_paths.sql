-- Deleted work is excluded before existing schedule and coverage mutations.
-- Retain each existing authorization, validation, audit and sync contract.
set search_path=public,extensions;
CREATE OR REPLACE FUNCTION public.crm_sync_apply_walkin(p_event_id text, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prior jsonb;
  v_queue uuid;
  v_at timestamptz;
  v_state crm_sync.walkin_state;
  v_task task_instances;
  v_new task_instances;
  v_doer user_profiles;
  v_flagged boolean := false;
  v_manager uuid;
  v_branch uuid;
  v_title text;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_event_id is null or p_event_id !~ '^[A-Za-z0-9_.:-]{1,160}$' or jsonb_typeof(p_snapshot) is distinct from 'object' then
    raise exception 'invalid sync event' using errcode = '22023';
  end if;
  begin
    v_queue := (p_snapshot ->> 'queue_id')::uuid;
    v_at := (p_snapshot ->> 'snapshot_at')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'invalid sync event' using errcode = '22023';
  end;
  if v_queue is null or v_at is null then
    raise exception 'invalid sync event' using errcode = '22023';
  end if;

  select i.result into v_prior from crm_sync.inbox i where i.event_id = p_event_id;
  if found then
    return v_prior || jsonb_build_object('duplicate', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('crm_sync.walkin:' || v_queue::text, 0));
  select * into v_state from crm_sync.walkin_state where queue_id = v_queue for update;
  if v_state.queue_id is not null and v_state.snapshot_at >= v_at then
    v_result := jsonb_build_object('outcome', 'stale', 'task_id', v_state.task_id);
  else
    select * into v_task from task_instances
    where source = 'crm_walkin' and source_ref_id = v_queue
    order by created_at limit 1
    for update;

    if v_task.deleted_at is not null then
      -- Honor the administrator's removal; acknowledge sync without resurrecting work.
      v_result := jsonb_build_object('outcome','administratively_deleted','task_id',v_task.id);
    elsif coalesce((p_snapshot ->> 'completed')::boolean, false) or not coalesce((p_snapshot ->> 'present')::boolean, false) then
      -- The walk-in form was submitted (or the queue entry is gone): close the task.
      if v_task.id is null then
        v_result := jsonb_build_object('outcome', 'no_task');
      elsif v_task.status in ('completed', 'rejected') then
        v_result := jsonb_build_object('outcome', 'already_closed', 'task_id', v_task.id);
      else
        update task_instances
        set status = 'completed', actual_datetime = now(), updated_at = now(),
            updated_by = coalesce((select a.user_profile_id from task_assignees a where a.task_instance_id = v_task.id and a.is_active and a.role_at_task = 'doer' order by a.id limit 1), v_task.created_by)
        where id = v_task.id returning * into v_new;
        update task_assignees set completed_at = now() where task_instance_id = v_task.id and is_active and completed_at is null;
        insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
        values (v_task.tenant_id, null, 'crm_walkin_task_completed', 'tasks', v_task.id,
          jsonb_build_object('status', v_task.status),
          jsonb_build_object('status', v_new.status, 'crm_queue_id', v_queue, 'event_id', p_event_id));
        v_result := jsonb_build_object('outcome', 'completed', 'task_id', v_task.id);
      end if;
    elsif v_task.id is not null then
      v_result := jsonb_build_object('outcome', 'already_created', 'task_id', v_task.id);
    else
      -- Registered: create the task for the resolved salesperson, else a branch manager.
      v_doer := crm_sync.walkin_doer(nullif(p_snapshot ->> 'assignee_jewelos_user_id', '')::uuid);
      if v_doer.id is null then
        for v_manager in select value::uuid from jsonb_array_elements_text(coalesce(p_snapshot -> 'manager_jewelos_user_ids', '[]'::jsonb)) loop
          v_doer := crm_sync.walkin_doer(v_manager);
          exit when v_doer.id is not null;
        end loop;
        v_flagged := true;
      end if;
      if v_doer.id is null then
        v_result := jsonb_build_object('outcome', 'unassigned');
      else
        v_branch := coalesce(
          (select b.id from branches b where b.id = nullif(p_snapshot ->> 'jewelos_branch_id', '')::uuid and b.tenant_id = v_doer.tenant_id),
          v_doer.branch_id);
        v_title := left('Complete walk-in form - ' || coalesce(nullif(btrim(p_snapshot ->> 'client_name'), ''), 'Walk-in client')
          || coalesce(' (' || nullif(p_snapshot ->> 'client_code', '') || ')', ''), 200);
        insert into task_instances (
          tenant_id, branch_id, department_id, task_type, title, description, priority,
          planned_datetime, source, source_ref_id, created_by, updated_by
        ) values (
          v_doer.tenant_id, v_branch, v_doer.department_id, 'delegation', v_title,
          'Created by the CRM walk-in queue (token ' || coalesce(p_snapshot ->> 'token', '-') || '). '
            || 'It closes by itself when the walk-in form is submitted in the CRM.'
            || case when v_flagged then ' The queue salesperson could not be matched to a JewelOS user, so it was assigned to the branch manager.' else '' end,
          'high', now(), 'crm_walkin', v_queue, v_doer.id, v_doer.id
        ) returning * into v_new;
        insert into task_assignees (task_instance_id, user_profile_id, role_at_task, is_original, is_active)
        values (v_new.id, v_doer.id, 'doer', true, true);
        insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
        values (v_doer.tenant_id, null, 'crm_walkin_task_created', 'tasks', v_new.id,
          jsonb_build_object('crm_queue_id', v_queue, 'doer_id', v_doer.id, 'flagged', v_flagged, 'event_id', p_event_id));
        v_result := jsonb_build_object('outcome', case when v_flagged then 'created_for_manager' else 'created' end, 'task_id', v_new.id);
      end if;
    end if;

    insert into crm_sync.walkin_state as s (queue_id, snapshot_at, outcome, task_id, applied_at)
    values (v_queue, v_at, v_result ->> 'outcome', (v_result ->> 'task_id')::uuid, now())
    on conflict (queue_id) do update
      set snapshot_at = excluded.snapshot_at, outcome = excluded.outcome,
          task_id = coalesce(excluded.task_id, s.task_id), applied_at = excluded.applied_at;
  end if;

  insert into crm_sync.inbox (event_id, event_type, aggregate_id, result)
  values (p_event_id, 'walkin.changed', v_queue, v_result);
  return v_result;
end
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_all_assignment_coverage_with_audit(p_user_profile_id uuid, p_date date, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor user_profiles; v_target user_profiles; v_resolution record; v_manager uuid;
  v_task record; v_followup record; v_stage record; v_tasks int:=0; v_crm int:=0; v_fms int:=0; v_required int:=0; v_review int:=0;
begin
  select * into v_actor from current_profile() where auth_user_id=auth.uid();
  select * into v_target from user_profiles where id=p_user_profile_id for update;
  if v_actor.id is null or not current_profile_is_active() or not (p_user_profile_id=v_actor.id or v_actor.user_role in ('super_admin','admin','manager','hr')) or v_target.id is null or v_target.tenant_id<>v_actor.tenant_id then raise exception 'Coverage reconciliation is not authorized' using errcode='42501'; end if;
  if not exists(select 1 from user_availability where user_profile_id=p_user_profile_id and date=p_date and status='absent') then return jsonb_build_object('date',p_date,'ignored',true,'reason','authorized_absence_required'); end if;
  select * into v_resolution from resolve_task_coverage(p_user_profile_id,p_date);
  if v_resolution.resolution='original' then return jsonb_build_object('date',p_date,'ignored',true,'reason','original_assignee_available'); end if;
  v_manager:=coalesce(v_target.reports_to_user_id,(select head_id from departments where id=v_target.department_id));
  for v_task in select ti.* from public.task_instances_live ti where ti.tenant_id=v_actor.tenant_id and ti.status in ('pending','in_progress','in_review') and (coalesce(ti.revised_datetime,ti.due_datetime,ti.planned_datetime) at time zone 'Asia/Kolkata')::date=p_date and exists(select 1 from task_assignees a where a.task_instance_id=ti.id and a.user_profile_id=p_user_profile_id and a.is_active and a.completed_at is null and a.role_at_task='doer') for update of ti loop
    if v_task.coverage_resolved_for_date=p_date and v_task.coverage_status in ('covered','coverage_required','manager_review') then continue; end if;
    if v_task.status<>'pending' then update task_instances set coverage_status='manager_review',coverage_original_assignee_id=p_user_profile_id,coverage_resolution='manager_review',coverage_resolved_for_date=p_date,updated_by=v_actor.id,updated_at=now() where id=v_task.id; v_review:=v_review+1;
    elsif v_resolution.effective_assignee_id is null then update task_assignees set is_active=false where task_instance_id=v_task.id and user_profile_id=p_user_profile_id and is_active and role_at_task='doer'; update task_instances set coverage_status='coverage_required',coverage_original_assignee_id=p_user_profile_id,coverage_resolution='coverage_required',coverage_resolved_for_date=p_date,updated_by=v_actor.id,updated_at=now() where id=v_task.id; v_required:=v_required+1;
    else update task_assignees set is_active=false where task_instance_id=v_task.id and user_profile_id=p_user_profile_id and is_active and role_at_task='doer'; insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values(v_task.id,v_resolution.effective_assignee_id,'doer',false,true) on conflict do nothing; update task_instances set coverage_status='covered',coverage_original_assignee_id=p_user_profile_id,coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=p_date,updated_by=v_actor.id,updated_at=now() where id=v_task.id; v_tasks:=v_tasks+1; end if;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,case when v_task.status<>'pending' then 'coverage_manager_review' when v_resolution.effective_assignee_id is null then 'coverage_required' else 'absence_coverage_assigned' end,'tasks',v_task.id,jsonb_build_object('original_assignee_id',p_user_profile_id,'effective_assignee_id',v_resolution.effective_assignee_id,'resolution',case when v_task.status<>'pending' then 'manager_review' else v_resolution.resolution end,'date',p_date,'reason',p_reason));
  end loop;
  for v_followup in select * from client_followups where tenant_id=v_actor.tenant_id and assigned_to=p_user_profile_id and due_date=p_date and status='open' for update loop
    if v_followup.coverage_resolved_for_date=p_date and v_followup.coverage_status in ('covered','coverage_required') then continue; end if;
    if v_resolution.effective_assignee_id is null then update client_followups set coverage_status='coverage_required',coverage_original_assignee_id=p_user_profile_id,coverage_resolution='coverage_required',coverage_resolved_for_date=p_date,updated_by=v_actor.id,updated_at=now(),record_version=record_version+1 where id=v_followup.id; v_required:=v_required+1;
    else update client_followups set assigned_to=v_resolution.effective_assignee_id,coverage_status='covered',coverage_original_assignee_id=p_user_profile_id,coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=p_date,updated_by=v_actor.id,updated_at=now(),record_version=record_version+1 where id=v_followup.id; v_crm:=v_crm+1; end if;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,case when v_resolution.effective_assignee_id is null then 'coverage_required' else 'absence_coverage_assigned' end,'crm_followups',v_followup.id,jsonb_build_object('original_assignee_id',p_user_profile_id,'effective_assignee_id',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,'date',p_date,'reason',p_reason));
  end loop;
  for v_stage in select fis.*,fi.tenant_id from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id where fi.tenant_id=v_actor.tenant_id and p_user_profile_id=any(fis.assigned_to) and (fis.planned_datetime at time zone 'Asia/Kolkata')::date=p_date and fis.status in ('pending','in_progress','in_review') for update of fis loop
    if v_stage.coverage_resolved_for_date=p_date and v_stage.coverage_status in ('covered','coverage_required','manager_review') then continue; end if;
    if v_stage.status<>'pending' then update fms_instance_stages set coverage_status='manager_review',coverage_original_assignee_id=p_user_profile_id,coverage_resolution='manager_review',coverage_resolved_for_date=p_date,updated_at=now() where id=v_stage.id; v_review:=v_review+1;
    elsif v_resolution.effective_assignee_id is null then update fms_instance_stage_assignees set is_active=false,status='reassigned' where fms_instance_stage_id=v_stage.id and user_profile_id=p_user_profile_id and is_active; update fms_instance_stages set assigned_to=array_remove(assigned_to,p_user_profile_id),coverage_status='coverage_required',coverage_original_assignee_id=p_user_profile_id,coverage_resolution='coverage_required',coverage_resolved_for_date=p_date,updated_at=now() where id=v_stage.id; v_required:=v_required+1;
    else update fms_instance_stage_assignees set is_active=false,status='reassigned' where fms_instance_stage_id=v_stage.id and user_profile_id=p_user_profile_id and is_active; update fms_instance_stages set assigned_to=array_replace(assigned_to,p_user_profile_id,v_resolution.effective_assignee_id),coverage_status='covered',coverage_original_assignee_id=p_user_profile_id,coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=p_date,updated_at=now() where id=v_stage.id; insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by) select v_actor.tenant_id,v_stage.id,v_resolution.effective_assignee_id,v_actor.id where not exists(select 1 from fms_instance_stage_assignees where fms_instance_stage_id=v_stage.id and user_profile_id=v_resolution.effective_assignee_id and is_active); v_fms:=v_fms+1; end if;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,case when v_stage.status<>'pending' then 'coverage_manager_review' when v_resolution.effective_assignee_id is null then 'coverage_required' else 'absence_coverage_assigned' end,'fms',v_stage.id,jsonb_build_object('original_assignee_id',p_user_profile_id,'effective_assignee_id',v_resolution.effective_assignee_id,'resolution',case when v_stage.status<>'pending' then 'manager_review' else v_resolution.resolution end,'date',p_date,'reason',p_reason));
  end loop;
  if v_manager is not null and (v_required>0 or v_review>0) then insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url) values(v_actor.tenant_id,v_manager,'task_coverage_review','Coverage review required',(v_required+v_review)::text||' work item(s) need coverage review for '||p_date::text,'/recurring-todo'); end if;
  return jsonb_build_object('date',p_date,'resolution',v_resolution.resolution,'effective_assignee_id',v_resolution.effective_assignee_id,'tasks_moved',v_tasks,'crm_followups_moved',v_crm,'fms_stages_moved',v_fms,'manager_review',v_review,'coverage_required',v_required);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_short_deadline_coverage_with_audit(p_user_profile_id uuid, p_date date, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor user_profiles; v_target user_profiles; v_resolution record; v_today date;
  v_availability user_availability;
  v_task record; v_followup record; v_stage record; v_manager uuid;
  v_moved_tasks int:=0; v_moved_crm int:=0; v_moved_fms int:=0;
  v_manager_review int:=0; v_coverage_required int:=0;
begin
  select * into v_actor from current_profile() where auth_user_id=auth.uid();
  select * into v_target from user_profiles where id=p_user_profile_id for update;
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin','manager','hr')
     or v_target.id is null or v_target.tenant_id<>v_actor.tenant_id then
    raise exception 'Coverage reconciliation is not authorized' using errcode='42501';
  end if;
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  if p_date not between v_today and v_today+1 then
    return jsonb_build_object('date',p_date,'ignored',true,'reason','outside_short_deadline_window');
  end if;
  select * into v_availability from user_availability
    where user_profile_id=p_user_profile_id and date=p_date for update;
  if v_availability.id is null or v_availability.status<>'absent' then
    return jsonb_build_object('date',p_date,'ignored',true,'reason','authorized_absence_required');
  end if;
  select * into v_resolution from resolve_task_coverage(p_user_profile_id,p_date);
  if v_resolution.resolution='original' then
    return jsonb_build_object('date',p_date,'ignored',true,'reason','original_assignee_available');
  end if;
  v_manager := coalesce(v_target.reports_to_user_id,
    (select d.head_id from departments d where d.id=v_target.department_id));

  for v_task in
    select ti.* from public.task_instances_live ti
    where ti.tenant_id=v_actor.tenant_id
      and exists (
        select 1 from task_assignees ta
        where ta.task_instance_id=ti.id
          and ta.user_profile_id=p_user_profile_id
          and ta.is_active
          and ta.completed_at is null
          and ta.role_at_task='doer'
      )
      and (coalesce(ti.revised_datetime,ti.planned_datetime) at time zone 'Asia/Kolkata')::date=p_date
      and ti.status in ('pending','in_progress','in_review') for update of ti
  loop
    if v_task.coverage_resolved_for_date=p_date
       and v_task.coverage_status in ('manager_review','coverage_required') then
      continue;
    end if;
    if v_task.status<>'pending' then
      update task_instances set coverage_status='manager_review',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution='manager_review',coverage_resolved_for_date=p_date,updated_by=v_actor.id,updated_at=now()
      where id=v_task.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_actor.tenant_id,v_actor.id,'coverage_manager_review','tasks',v_task.id,
        jsonb_build_object('original_assignee_id',p_user_profile_id,'date',p_date,'reason',p_reason));
      v_manager_review:=v_manager_review+1;
    elsif v_resolution.effective_assignee_id is not null then
      update task_assignees set is_active=false where task_instance_id=v_task.id
        and user_profile_id=p_user_profile_id and is_active and role_at_task='doer';
      insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
      values(v_task.id,v_resolution.effective_assignee_id,'doer',false,true) on conflict do nothing;
      insert into buddy_assignments(tenant_id,original_assignee_id,buddy_id,task_instance_id,date,
        escalated_to_manager)
      values(v_actor.tenant_id,p_user_profile_id,v_resolution.effective_assignee_id,v_task.id,p_date,
        v_resolution.resolution='reporting_manager');
      update task_instances set coverage_status='covered',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=p_date,
        updated_by=v_actor.id,updated_at=now() where id=v_task.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_actor.tenant_id,v_actor.id,'short_deadline_coverage_assigned','tasks',v_task.id,
        jsonb_build_object('assignee_id',p_user_profile_id),
        jsonb_build_object('assignee_id',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,'date',p_date));
      insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url)
      values(v_actor.tenant_id,v_resolution.effective_assignee_id,'task_coverage_assigned','Coverage task assigned',
        v_task.title||' was assigned to you for '||p_date::text,'/tasks');
      v_moved_tasks:=v_moved_tasks+1;
    else
      update task_assignees set is_active=false where task_instance_id=v_task.id
        and user_profile_id=p_user_profile_id and is_active and role_at_task='doer';
      update task_instances set coverage_status='coverage_required',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution='coverage_required',coverage_resolved_for_date=p_date,updated_by=v_actor.id,updated_at=now()
      where id=v_task.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_actor.tenant_id,v_actor.id,'coverage_required','tasks',v_task.id,
        jsonb_build_object('original_assignee_id',p_user_profile_id,'date',p_date,'reason',p_reason));
      v_coverage_required:=v_coverage_required+1;
    end if;
  end loop;

  for v_followup in select cf.* from client_followups cf
    where cf.tenant_id=v_actor.tenant_id and cf.assigned_to=p_user_profile_id
      and cf.due_date=p_date and cf.status='open' for update
  loop
    if v_followup.coverage_resolved_for_date=p_date
       and v_followup.coverage_status in ('covered','coverage_required','manager_review') then
      continue;
    end if;
    if v_resolution.effective_assignee_id is not null then
      update client_followups set assigned_to=v_resolution.effective_assignee_id,
        coverage_status='covered',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=p_date,
        updated_by=v_actor.id,updated_at=now(),record_version=record_version+1 where id=v_followup.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_actor.tenant_id,v_actor.id,'short_deadline_coverage_assigned','crm_followups',v_followup.id,
        jsonb_build_object('assigned_to',p_user_profile_id),
        jsonb_build_object('assigned_to',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,'date',p_date));
      insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url)
      values(v_actor.tenant_id,v_resolution.effective_assignee_id,'crm_followup_coverage_assigned','CRM follow-up coverage assigned',
        'A follow-up due '||p_date::text||' was assigned to you','/crm?client='||v_followup.client_id);
      v_moved_crm:=v_moved_crm+1;
    else
      update client_followups set coverage_status='coverage_required',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution='coverage_required',coverage_resolved_for_date=p_date,
        updated_by=v_actor.id,updated_at=now(),record_version=record_version+1 where id=v_followup.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_actor.tenant_id,v_actor.id,'coverage_required','crm_followups',v_followup.id,
        jsonb_build_object('original_assignee_id',p_user_profile_id,'date',p_date,'reason',p_reason));
      v_coverage_required:=v_coverage_required+1;
    end if;
  end loop;

  for v_stage in
    select fis.*,fi.tenant_id,fi.title from fms_instance_stages fis
    join fms_instances fi on fi.id=fis.fms_instance_id
    where fi.tenant_id=v_actor.tenant_id and p_user_profile_id=any(fis.assigned_to)
      and (fis.planned_datetime at time zone 'Asia/Kolkata')::date=p_date
      and fis.status in ('pending','in_progress','in_review') for update of fis
  loop
    if v_stage.coverage_resolved_for_date=p_date
       and v_stage.coverage_status in ('manager_review','coverage_required') then
      continue;
    end if;
    if v_stage.status<>'pending' then
      update fms_instance_stages set coverage_status='manager_review',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution='manager_review',coverage_resolved_for_date=p_date,updated_at=now() where id=v_stage.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_actor.tenant_id,v_actor.id,'coverage_manager_review','fms',v_stage.id,
        jsonb_build_object('original_assignee_id',p_user_profile_id,'date',p_date,'reason',p_reason));
      v_manager_review:=v_manager_review+1;
    elsif v_resolution.effective_assignee_id is not null then
      update fms_instance_stages set assigned_to=array_replace(assigned_to,p_user_profile_id,v_resolution.effective_assignee_id),
        coverage_status='covered',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=p_date,updated_at=now() where id=v_stage.id;
      update fms_instance_stage_assignees set is_active=false,status='reassigned'
        where fms_instance_stage_id=v_stage.id and user_profile_id=p_user_profile_id and is_active;
      if not exists(select 1 from fms_instance_stage_assignees where fms_instance_stage_id=v_stage.id
        and user_profile_id=v_resolution.effective_assignee_id and is_active) then
        insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by)
        values(v_actor.tenant_id,v_stage.id,v_resolution.effective_assignee_id,v_actor.id);
      end if;
      insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
      values(v_stage.id,v_actor.id,'reassigned',jsonb_build_object('from',p_user_profile_id,
        'to',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,'date',p_date));
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_actor.tenant_id,v_actor.id,'short_deadline_coverage_assigned','fms',v_stage.id,
        jsonb_build_object('assigned_to',p_user_profile_id),
        jsonb_build_object('assigned_to',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,'date',p_date));
      insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url)
      values(v_actor.tenant_id,v_resolution.effective_assignee_id,'fms_coverage_assigned','FMS coverage assigned',
        v_stage.title||' was assigned to you for '||p_date::text,'/fms');
      v_moved_fms:=v_moved_fms+1;
    else
      update fms_instance_stages set coverage_status='coverage_required',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution='coverage_required',coverage_resolved_for_date=p_date,updated_at=now() where id=v_stage.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_actor.tenant_id,v_actor.id,'coverage_required','fms',v_stage.id,
        jsonb_build_object('original_assignee_id',p_user_profile_id,'date',p_date,'reason',p_reason));
      v_coverage_required:=v_coverage_required+1;
    end if;
  end loop;

  if v_manager is not null and (v_manager_review>0 or v_coverage_required>0) then
    insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url)
    values(v_actor.tenant_id,v_manager,'task_coverage_review','Coverage review required',
      (v_manager_review+v_coverage_required)::text||' work item(s) need coverage review for '||p_date::text,
      '/recurring-todo');
  end if;
  return jsonb_build_object('date',p_date,'resolution',v_resolution.resolution,
    'effective_assignee_id',v_resolution.effective_assignee_id,'tasks_moved',v_moved_tasks,
    'crm_followups_moved',v_moved_crm,'fms_stages_moved',v_moved_fms,
    'manager_review',v_manager_review,'coverage_required',v_coverage_required);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_availability_with_audit(p_user_profile_id uuid, p_date date, p_status availability_status, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor user_profiles; v_old user_availability; v_new user_availability; v_task task_instances;
begin
  perform public.assert_module_enabled('availability');
  select * into v_actor from current_profile() where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active() or not (p_user_profile_id=v_actor.id or has_permission('availability.manage_others')) or not exists(select 1 from user_profiles where id=p_user_profile_id and tenant_id=v_actor.tenant_id) then raise exception 'Availability cannot be recorded for this user' using errcode='42501'; end if;
  select * into v_old from user_availability where user_profile_id=p_user_profile_id and date=p_date;
  insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by,source) values(v_actor.tenant_id,p_user_profile_id,p_date,p_status,nullif(btrim(p_reason),''),v_actor.id,'manual') on conflict(user_profile_id,date) do update set status=excluded.status,reason=excluded.reason,logged_by=excluded.logged_by,source='manual' returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'availability_recorded','availability',v_new.id,case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));

  if p_status='absent' then
    perform reconcile_all_assignment_coverage_with_audit(p_user_profile_id,p_date,p_reason);
  elsif v_old.status='absent' and is_user_available_for_task(p_user_profile_id,p_date) then
    for v_task in
      select * from public.task_instances_live
      where tenant_id=v_actor.tenant_id and coverage_original_assignee_id=p_user_profile_id
        and coverage_resolved_for_date=p_date and status not in ('completed','rejected')
      for update
    loop
      update task_assignees set is_active=false
      where task_instance_id=v_task.id and role_at_task='doer' and is_active and not is_original;
      update task_assignees set is_active=true,completed_at=null
      where task_instance_id=v_task.id and user_profile_id=p_user_profile_id
        and role_at_task='doer' and is_original and not is_active;
      if not found then
        insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
        values(v_task.id,p_user_profile_id,'doer',true,true)
        on conflict do nothing;
      end if;
      update task_instances set coverage_status=null,coverage_original_assignee_id=null,
        coverage_resolution=null,coverage_resolved_for_date=null,updated_by=v_actor.id,updated_at=now()
      where id=v_task.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_actor.tenant_id,v_actor.id,'absence_coverage_restored','tasks',v_task.id,
        jsonb_build_object('original_assignee_id',p_user_profile_id,'coverage_resolution',v_task.coverage_resolution,'date',p_date),
        jsonb_build_object('original_assignee_id',p_user_profile_id,'effective_assignee_id',p_user_profile_id,'date',p_date));
    end loop;
  end if;
  return v_new.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.save_recurring_todo_template_with_audit(p_template_id uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_actor user_profiles; v_old task_templates; v_new task_templates;
  v_base jsonb; v_kind text; v_starts_on date; v_task_type task_type; v_due_time time;
  v_verifier uuid; v_verification boolean;
begin
  select * into v_actor from current_profile() where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then
    raise exception 'Recurring schedule management denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_payload)<>'object' then raise exception 'Recurring schedule payload is invalid' using errcode='22023'; end if;
  v_task_type:=coalesce(nullif(p_payload->>'task_type','')::task_type,'checklist');
  if v_task_type not in ('checklist','delegation') then raise exception 'Recurring task type is unsupported' using errcode='22023'; end if;
  v_kind:=coalesce(nullif(p_payload->>'schedule_kind',''),'recurring');
  if v_kind not in ('recurring','daily','weekly','monthly','nth_weekday','quarterly','yearly','one_time','as_required') then raise exception 'Schedule kind is unsupported' using errcode='22023'; end if;
  v_starts_on:=coalesce(nullif(p_payload->>'starts_on','')::date,case when p_template_id is null then (now() at time zone 'Asia/Kolkata')::date else null end);
  if p_template_id is not null then
    select * into v_old from task_templates where id=p_template_id for update;
    if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id or (v_actor.user_role='manager' and v_old.branch_id is distinct from v_actor.branch_id) then raise exception 'Recurring schedule not found' using errcode='42501'; end if;
    -- task_templates_due_after_start compares the stored due time against the
    -- incoming start time, so shifting a schedule later in one save would trip
    -- it inside the delegate. Release the deadline here and restore it below
    -- once the new start time is in place.
    update task_templates set task_type='checklist', due_time=null where id=p_template_id;
  end if;
  v_due_time:=case when p_payload ? 'due_time' then nullif(p_payload->>'due_time','')::time else v_old.due_time end;
  v_verification:=coalesce((p_payload->>'verification_required')::boolean,false);
  v_verifier:=case when p_payload ? 'verifier_user_profile_id'
    then nullif(p_payload->>'verifier_user_profile_id','')::uuid else v_old.verifier_user_profile_id end;
  if not v_verification then v_verifier:=null; end if;
  if v_verifier is not null and not exists(
    select 1 from user_profiles u where u.id=v_verifier and u.tenant_id=v_actor.tenant_id
      and u.account_status='active' and u.is_login_enabled
  ) then raise exception 'Verifier is invalid or inactive' using errcode='23503'; end if;
  v_base:=p_payload-array['schedule_kind','starts_on','verification_required','followup_enabled',
    'personal_performance_enabled','task_type','buddy_assignment_allowed','due_time','verifier_user_profile_id'];
  v_base:=v_base||jsonb_build_object('requires_upload',v_task_type='delegation','checklist_items',case when v_task_type='delegation' then '[]'::jsonb else coalesce(p_payload->'checklist_items','[]'::jsonb) end);
  if v_kind='as_required' then
    v_base:=v_base||jsonb_build_object('is_active',false);
  elsif p_template_id is null then
    v_base:=v_base||jsonb_build_object('initial_planned_datetime',(v_starts_on::text||' '||coalesce(nullif(p_payload->>'planned_time',''),'09:00')||' Asia/Kolkata')::timestamptz);
  end if;
  v_id:=save_task_template_with_audit(p_template_id,v_base);
  update task_templates set task_type=v_task_type, buddy_assignment_allowed=coalesce((p_payload->>'buddy_assignment_allowed')::boolean,true),
    requires_upload=(v_task_type='delegation'), checklist_items=case when v_task_type='delegation' then '[]'::jsonb else checklist_items end,
    schedule_kind=v_kind,starts_on=coalesce(v_starts_on,starts_on),verification_required=v_verification,
    verifier_user_profile_id=v_verifier,
    followup_enabled=coalesce((p_payload->>'followup_enabled')::boolean,false),personal_performance_enabled=coalesce((p_payload->>'personal_performance_enabled')::boolean,true),
    due_time=v_due_time,
    updated_by=v_actor.id,updated_at=now() where id=v_id returning * into v_new;
  update task_instances set task_type=v_task_type,requires_upload=(v_task_type='delegation'),buddy_assignment_allowed=v_new.buddy_assignment_allowed,
    due_datetime=case when v_new.due_time is null then due_datetime
      else (coalesce(scheduled_date,(planned_datetime at time zone 'Asia/Kolkata')::date)::text||' '||v_new.due_time::text||' Asia/Kolkata')::timestamptz end,
    updated_by=v_actor.id,updated_at=now() where task_template_id=v_id and deleted_at is null and status='pending'
    and (planned_datetime at time zone 'Asia/Kolkata')::date=coalesce(v_starts_on,v_new.starts_on);
  -- Every occurrence still open carries the schedule's current review rule.
  update task_instances set verifier_user_profile_id=v_verifier,
    verification_status=case when v_new.verification_required then 'pending' else 'not_required' end,
    updated_by=v_actor.id,updated_at=now()
    where task_template_id=v_id and deleted_at is null and status in ('pending','in_progress','rejected');
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values
    (v_actor.tenant_id,v_actor.id,case when p_template_id is null then 'recurring_todo_created' else 'recurring_todo_updated' end,'recurring_todo',v_id,
     case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_leave_half_day_tasks(p_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_day date:=(p_at at time zone 'Asia/Kolkata')::date;
  v_leave record; v_task task_instances; v_followup client_followups; v_stage fms_instance_stages;
  v_resolution record; v_absent boolean; v_effective uuid; v_covered_id uuid;
  v_buddy_preexisting boolean; v_resolution_name text;
begin
  for v_leave in
    select distinct r.applicant_id,r.tenant_id from leave_requests r
    join user_availability a on a.user_profile_id=r.applicant_id and a.date=v_day
      and a.status='half_day'
    where r.status='approved' and r.tenant_id=a.tenant_id
      and ((r.leave_start=v_day and r.duration='2ND HALF')
        or (r.work_start_date=v_day and r.work_start_in='2ND HALF'))
  loop
    v_absent:=leave_half_day_absent_at(v_leave.applicant_id,p_at);
    v_effective:=v_leave.applicant_id;
    v_resolution_name:=null;
    if v_absent then
      select * into v_resolution from resolve_task_coverage_at(v_leave.applicant_id,v_day,p_at);
      v_effective:=v_resolution.effective_assignee_id;
      v_resolution_name:=v_resolution.resolution;
    end if;
    for v_task in select ti.* from public.task_instances_live ti
      where ti.tenant_id=v_leave.tenant_id
        and ((v_absent and ti.status='pending') or (not v_absent and ti.status not in ('completed','rejected')))
        and (coalesce(ti.revised_datetime,ti.due_datetime,ti.planned_datetime) at time zone 'Asia/Kolkata')::date=v_day
        and (exists(select 1 from task_assignees ta where ta.task_instance_id=ti.id
          and ta.user_profile_id=v_leave.applicant_id and ta.role_at_task='doer' and ta.is_original and ta.is_active)
          or (ti.coverage_original_assignee_id=v_leave.applicant_id and ti.coverage_resolved_for_date=v_day))
      for update of ti
    loop
      if v_absent and v_task.coverage_original_assignee_id=v_leave.applicant_id then continue; end if;
      if not v_absent and v_task.coverage_original_assignee_id is distinct from v_leave.applicant_id then continue; end if;
      update task_assignees set is_active=false where task_instance_id=v_task.id
        and role_at_task='doer' and is_active
        and (user_profile_id=v_leave.applicant_id or not is_original);
      if v_absent then
        if v_resolution.effective_assignee_id is not null then
          insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
          values(v_task.id,v_resolution.effective_assignee_id,'doer',false,true)
          on conflict do nothing;
        end if;
        update task_instances set coverage_status=case when v_resolution.effective_assignee_id is null then 'coverage_required' else 'covered' end,
          coverage_original_assignee_id=v_leave.applicant_id,coverage_resolution=v_resolution.resolution,
          coverage_resolved_for_date=v_day,updated_at=now() where id=v_task.id;
      else
        update task_assignees set is_active=true,completed_at=null where id=(
          select id from task_assignees where task_instance_id=v_task.id
            and user_profile_id=v_leave.applicant_id and role_at_task='doer'
            and is_original and completed_at is null order by id limit 1);
        if not found then
          insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
          values(v_task.id,v_leave.applicant_id,'doer',true,true) on conflict do nothing;
        end if;
        update task_instances set coverage_status=null,coverage_original_assignee_id=null,
          coverage_resolution=null,coverage_resolved_for_date=null,updated_at=now() where id=v_task.id;
      end if;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_leave.tenant_id,null,case when v_absent then 'absence_coverage_assigned' else 'absence_coverage_restored' end,
        'tasks',v_task.id,to_jsonb(v_task),jsonb_build_object('source','approved_half_day_leave',
          'original_assignee_id',v_leave.applicant_id,'effective_assignee_id',
          v_effective,
          'at',p_at));
    end loop;
    for v_followup in select * from client_followups f
      where f.tenant_id=v_leave.tenant_id and f.due_date=v_day and f.status='open'
        and (f.assigned_to=v_leave.applicant_id
          or (f.coverage_original_assignee_id=v_leave.applicant_id and f.coverage_resolved_for_date=v_day))
      for update
    loop
      if v_absent and v_followup.coverage_original_assignee_id=v_leave.applicant_id then continue; end if;
      if not v_absent and v_followup.coverage_original_assignee_id is distinct from v_leave.applicant_id then continue; end if;
      update client_followups set assigned_to=case when v_absent and v_effective is not null then v_effective else v_leave.applicant_id end,
        coverage_status=case when v_absent then case when v_effective is null then 'coverage_required' else 'covered' end else null end,
        coverage_original_assignee_id=case when v_absent then v_leave.applicant_id else null end,
        coverage_resolution=v_resolution_name,
        coverage_resolved_for_date=case when v_absent then v_day else null end,
        updated_at=now(),record_version=record_version+1 where id=v_followup.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_leave.tenant_id,null,case when v_absent then 'absence_coverage_assigned' else 'absence_coverage_restored' end,
        'crm_followups',v_followup.id,to_jsonb(v_followup),jsonb_build_object('source','approved_half_day_leave',
          'original_assignee_id',v_leave.applicant_id,'effective_assignee_id',v_effective,'at',p_at));
    end loop;
    for v_stage in select s.* from fms_instance_stages s join fms_instances fi on fi.id=s.fms_instance_id
      where fi.tenant_id=v_leave.tenant_id and s.status='pending'
        and (s.planned_datetime at time zone 'Asia/Kolkata')::date=v_day
        and (v_leave.applicant_id=any(s.assigned_to)
          or (s.coverage_original_assignee_id=v_leave.applicant_id and s.coverage_resolved_for_date=v_day))
      for update of s
    loop
      if v_absent and v_stage.coverage_original_assignee_id=v_leave.applicant_id then continue; end if;
      if not v_absent and v_stage.coverage_original_assignee_id is distinct from v_leave.applicant_id then continue; end if;
      if v_absent then
        v_buddy_preexisting:=v_effective=any(v_stage.assigned_to);
        update fms_instance_stage_assignees set is_active=false,status='reassigned'
        where fms_instance_stage_id=v_stage.id and user_profile_id=v_leave.applicant_id and is_active;
        if v_effective is not null then
          update fms_instance_stage_assignees set is_active=true,status='assigned' where id=(
            select id from fms_instance_stage_assignees where fms_instance_stage_id=v_stage.id
              and user_profile_id=v_effective and not is_active order by assigned_at desc,id limit 1);
          if not found and not exists(select 1 from fms_instance_stage_assignees
            where fms_instance_stage_id=v_stage.id and user_profile_id=v_effective and is_active) then
            insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_at)
            values(v_leave.tenant_id,v_stage.id,v_effective,clock_timestamp());
          end if;
        end if;
        update fms_instance_stages set assigned_to=case when v_effective is null or v_buddy_preexisting
            then array_remove(assigned_to,v_leave.applicant_id)
            else array_append(array_remove(assigned_to,v_leave.applicant_id),v_effective) end,
          coverage_status=case when v_effective is null then 'coverage_required' else 'covered' end,
          coverage_original_assignee_id=v_leave.applicant_id,coverage_resolution=v_resolution_name,
          coverage_resolved_for_date=v_day,leave_coverage_buddy_id=v_effective,
          leave_coverage_buddy_preexisting=v_buddy_preexisting,updated_at=now() where id=v_stage.id;
      else
        v_covered_id:=v_stage.leave_coverage_buddy_id;
        update fms_instance_stage_assignees set is_active=false,status='reassigned'
        where fms_instance_stage_id=v_stage.id and user_profile_id=v_covered_id and is_active
          and v_stage.leave_coverage_buddy_preexisting is not true;
        update fms_instance_stage_assignees set is_active=true,status='assigned' where id=(
          select id from fms_instance_stage_assignees where fms_instance_stage_id=v_stage.id
            and user_profile_id=v_leave.applicant_id and not is_active order by assigned_at desc,id limit 1);
        if not found and not exists(select 1 from fms_instance_stage_assignees
          where fms_instance_stage_id=v_stage.id and user_profile_id=v_leave.applicant_id and is_active) then
          insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_at)
          values(v_leave.tenant_id,v_stage.id,v_leave.applicant_id,clock_timestamp());
        end if;
        update fms_instance_stages set assigned_to=array_append(
            case when v_stage.leave_coverage_buddy_preexisting then assigned_to
              else array_remove(assigned_to,v_covered_id) end,v_leave.applicant_id),
          coverage_status=null,coverage_original_assignee_id=null,coverage_resolution=null,
          coverage_resolved_for_date=null,leave_coverage_buddy_id=null,
          leave_coverage_buddy_preexisting=null,updated_at=now() where id=v_stage.id;
      end if;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_leave.tenant_id,null,case when v_absent then 'absence_coverage_assigned' else 'absence_coverage_restored' end,
        'fms',v_stage.id,to_jsonb(v_stage),jsonb_build_object('source','approved_half_day_leave',
          'original_assignee_id',v_leave.applicant_id,'effective_assignee_id',v_effective,'at',p_at));
    end loop;
  end loop;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.task_import_repair_checklist_evidence(p_registry_id uuid, p_actor_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_registry public.task_import_row_registry;
  v_actor public.user_profiles;
  v_task public.task_instances;
  v_template public.task_templates;
  v_instance public.task_instances;
  v_updated integer:=0;
begin
  select * into v_actor from public.user_profiles where id=p_actor_user_id;
  select * into v_registry from public.task_import_row_registry where id=p_registry_id;
  if v_actor.id is null or v_registry.id is null or v_actor.tenant_id<>v_registry.tenant_id then
    raise exception 'Task import checklist evidence repair denied' using errcode='42501';
  end if;

  if v_registry.task_instance_id is not null then
    select * into v_task from public.task_instances_live
    where id=v_registry.task_instance_id and tenant_id=v_registry.tenant_id
      and source='bulk_import' and task_type='checklist' and requires_upload
    for update;
    if v_task.id is not null then
      update public.task_instances
      set requires_upload=false,updated_by=v_actor.id,updated_at=now()
      where id=v_task.id;
      insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_registry.tenant_id,v_actor.id,'task_bulk_import_checklist_evidence_corrected','tasks',v_task.id,
        jsonb_build_object('task_type',v_task.task_type,'requires_upload',true),
        jsonb_build_object('task_type',v_task.task_type,'requires_upload',false));
      v_updated:=v_updated+1;
    end if;
  end if;

  if v_registry.task_template_id is not null then
    select * into v_template from public.task_templates
    where id=v_registry.task_template_id and tenant_id=v_registry.tenant_id
      and task_type='checklist' and requires_upload
    for update;
    if v_template.id is not null then
      update public.task_templates
      set requires_upload=false,updated_by=v_actor.id,updated_at=now()
      where id=v_template.id;
      insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_registry.tenant_id,v_actor.id,'task_bulk_import_checklist_evidence_corrected','task_templates',v_template.id,
        jsonb_build_object('task_type',v_template.task_type,'requires_upload',true),
        jsonb_build_object('task_type',v_template.task_type,'requires_upload',false));
      v_updated:=v_updated+1;
    end if;

    for v_instance in
      select * from public.task_instances_live
      where tenant_id=v_registry.tenant_id and task_template_id=v_registry.task_template_id
        and task_type='checklist' and requires_upload
      for update
    loop
      update public.task_instances
      set requires_upload=false,updated_by=v_actor.id,updated_at=now()
      where id=v_instance.id;
      insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_registry.tenant_id,v_actor.id,'task_bulk_import_checklist_evidence_corrected','tasks',v_instance.id,
        jsonb_build_object('task_type',v_instance.task_type,'requires_upload',true,'task_template_id',v_registry.task_template_id),
        jsonb_build_object('task_type',v_instance.task_type,'requires_upload',false,'task_template_id',v_registry.task_template_id));
      v_updated:=v_updated+1;
    end loop;
  end if;

  return v_updated;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.task_import_repair_checklist_headline(p_registry_id uuid, p_headline text, p_actor_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_registry public.task_import_row_registry;
  v_actor public.user_profiles;
  v_task public.task_instances;
  v_template public.task_templates;
  v_instance public.task_instances;
  v_headline text:=btrim(coalesce(p_headline,''));
  v_updated integer:=0;
begin
  if length(v_headline) not between 1 and 500 then return 0; end if;
  select * into v_actor from public.user_profiles where id=p_actor_user_id;
  select * into v_registry from public.task_import_row_registry where id=p_registry_id;
  if v_actor.id is null or v_registry.id is null or v_actor.tenant_id<>v_registry.tenant_id then
    raise exception 'Task import headline repair denied' using errcode='42501';
  end if;

  if v_registry.task_instance_id is not null then
    select * into v_task from public.task_instances_live
    where id=v_registry.task_instance_id and tenant_id=v_registry.tenant_id
      and source='bulk_import' and task_type='checklist'
      and title=core_task_label and title<>v_headline
    for update;
    if v_task.id is not null then
      update public.task_instances set title=v_headline,updated_by=v_actor.id,updated_at=now() where id=v_task.id;
      insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_registry.tenant_id,v_actor.id,'task_bulk_import_headline_corrected','tasks',v_task.id,
        jsonb_build_object('title',v_task.title),jsonb_build_object('title',v_headline,'core_task_label',v_task.core_task_label));
      v_updated:=v_updated+1;
    end if;
  end if;

  if v_registry.task_template_id is not null then
    select * into v_template from public.task_templates
    where id=v_registry.task_template_id and tenant_id=v_registry.tenant_id
      and task_type='checklist' and title=core_task_label and title<>v_headline
    for update;
    if v_template.id is not null then
      update public.task_templates set title=v_headline,updated_by=v_actor.id,updated_at=now() where id=v_template.id;
      insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_registry.tenant_id,v_actor.id,'task_bulk_import_headline_corrected','task_templates',v_template.id,
        jsonb_build_object('title',v_template.title),jsonb_build_object('title',v_headline,'core_task_label',v_template.core_task_label));
      v_updated:=v_updated+1;
    end if;

    for v_instance in select * from public.task_instances_live
      where tenant_id=v_registry.tenant_id and task_template_id=v_registry.task_template_id
        and task_type='checklist'
        and title=core_task_label and title<>v_headline
      for update
    loop
      update public.task_instances set title=v_headline,updated_by=v_actor.id,updated_at=now() where id=v_instance.id;
      insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_registry.tenant_id,v_actor.id,'task_bulk_import_headline_corrected','tasks',v_instance.id,
        jsonb_build_object('title',v_instance.title),jsonb_build_object('title',v_headline,'core_task_label',v_instance.core_task_label,'task_template_id',v_registry.task_template_id));
      v_updated:=v_updated+1;
    end loop;
  end if;
  return v_updated;
end;
$function$
;
notify pgrst,'reload schema';
