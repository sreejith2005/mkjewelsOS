-- Apply profile-level availability to every dated assignment, not only work
-- due today or tomorrow. Original assignment history remains immutable.
set search_path = public, extensions;

create or replace function resolve_task_coverage(p_original_assignee_id uuid, p_target_date date)
returns table(original_assignee_id uuid, effective_assignee_id uuid, resolution text)
language plpgsql stable security definer set search_path=public as $$
declare v_original user_profiles; v_candidate uuid;
begin
  select * into v_original from user_profiles where id=p_original_assignee_id;
  if v_original.id is null then return query select p_original_assignee_id,null::uuid,'coverage_required'::text; return; end if;
  if is_user_available_for_task(v_original.id,p_target_date) and v_original.account_status='active' and v_original.is_login_enabled then
    return query select v_original.id,v_original.id,'original'::text; return;
  end if;
  foreach v_candidate in array array[v_original.buddy_id,v_original.secondary_buddy_id] loop
    if v_candidate is not null and exists(
      select 1 from user_profiles u where u.id=v_candidate and u.tenant_id=v_original.tenant_id
        and u.account_status='active' and u.is_login_enabled and u.working_status='active'
        and is_user_available_for_task(u.id,p_target_date)
    ) then
      return query select v_original.id,v_candidate,
        case when v_candidate=v_original.buddy_id then 'primary_buddy' else 'secondary_buddy' end;
      return;
    end if;
  end loop;
  return query select v_original.id,null::uuid,'coverage_required'::text;
end;
$$;

create or replace function apply_task_assignment_coverage()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_task task_instances; v_date date; v_resolution record; v_actor uuid;
begin
  if new.role_at_task<>'doer' or new.is_active is not true or new.is_original is not true or new.completed_at is not null then return new; end if;
  select * into v_task from task_instances where id=new.task_instance_id for update;
  v_date:=(coalesce(v_task.revised_datetime,v_task.planned_datetime) at time zone 'Asia/Kolkata')::date;
  if v_task.status<>'pending' then return new; end if;
  select id into v_actor from user_profiles where auth_user_id=auth.uid();
  select * into v_resolution from resolve_task_coverage(new.user_profile_id,v_date);
  if v_resolution.resolution='original' then return new; end if;
  if v_resolution.effective_assignee_id is null then
    update task_assignees set is_active=false where id=new.id;
    update task_instances set coverage_status='coverage_required',coverage_original_assignee_id=new.user_profile_id,coverage_resolution='coverage_required',coverage_resolved_for_date=v_date,updated_at=now() where id=v_task.id;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_task.tenant_id,v_actor,'coverage_required','tasks',v_task.id,jsonb_build_object('original_assignee_id',new.user_profile_id,'date',v_date,'source','assignment_created'));
    return new;
  end if;
  update task_assignees set is_active=false where id=new.id;
  insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values(v_task.id,v_resolution.effective_assignee_id,'doer',false,true) on conflict do nothing;
  insert into buddy_assignments(tenant_id,original_assignee_id,buddy_id,task_instance_id,date,escalated_to_manager) values(v_task.tenant_id,new.user_profile_id,v_resolution.effective_assignee_id,v_task.id,v_date,false);
  update task_instances set coverage_status='covered',coverage_original_assignee_id=new.user_profile_id,coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=v_date,updated_at=now() where id=v_task.id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_task.tenant_id,v_actor,'task_assignment_resolved','tasks',v_task.id,jsonb_build_object('original_assignee_id',new.user_profile_id,'effective_assignee_id',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,'date',v_date,'source','assignment_created'));
  return new;
end;
$$;

create or replace function apply_crm_followup_coverage()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_resolution record; v_actor uuid; v_original uuid;
begin
  if new.status<>'open' or new.assigned_to is null then return new; end if;
  if tg_op='UPDATE' and new.assigned_to is not distinct from old.assigned_to and new.due_date is not distinct from old.due_date then return new; end if;
  v_original:=new.assigned_to;
  select * into v_resolution from resolve_task_coverage(v_original,new.due_date);
  if v_resolution.resolution='original' then return new; end if;
  select id into v_actor from user_profiles where auth_user_id=auth.uid();
  new.coverage_original_assignee_id:=v_original; new.coverage_resolved_for_date:=new.due_date;
  if v_resolution.effective_assignee_id is null then new.coverage_status:='coverage_required'; new.coverage_resolution:='coverage_required';
  else new.assigned_to:=v_resolution.effective_assignee_id; new.coverage_status:='covered'; new.coverage_resolution:=v_resolution.resolution; end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(new.tenant_id,v_actor,case when v_resolution.effective_assignee_id is null then 'coverage_required' else 'task_assignment_resolved' end,'crm_followups',new.id,jsonb_build_object('original_assignee_id',v_original,'effective_assignee_id',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,'date',new.due_date,'source','followup_created_or_rescheduled'));
  return new;
end;
$$;

create or replace function resolve_fms_stage_assignees(p_stage_id uuid,p_instance_id uuid,p_selected_user uuid default null)
returns uuid[] language plpgsql security definer set search_path=public as $$
declare v_stage fms_stages; v_instance fms_instances; v_rule fms_stage_assignees; v_ids uuid[]:=array[]::uuid[]; v_resolved uuid[]:=array[]::uuid[]; v_previous uuid[]; v_candidate uuid; v_coverage record; v_target_date date;
begin
  select * into v_stage from fms_stages where id=p_stage_id; select * into v_instance from fms_instances where id=p_instance_id;
  if v_stage.id is null or v_instance.id is null or v_stage.fms_flow_id<>v_instance.fms_flow_id then raise exception 'Invalid stage activation' using errcode='23514'; end if;
  v_target_date:=(fms_stage_deadline_for_instance(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id) at time zone 'Asia/Kolkata')::date;
  if p_selected_user is not null then
    if not exists(select 1 from user_profiles u where u.id=p_selected_user and u.tenant_id=v_instance.tenant_id and u.branch_id=v_instance.branch_id and u.department_id=v_instance.department_id and u.working_status not in ('inactive','resigned') and coalesce(u.account_status::text,'active') in ('active','invited')) then raise exception 'The selected starting assignee is outside this branch and department' using errcode='23514'; end if;
    select * into v_coverage from resolve_task_coverage(p_selected_user,v_target_date);
    if v_coverage.effective_assignee_id is null then raise exception 'Coverage required for the selected starting assignee' using errcode='23514'; end if;
    return array[v_coverage.effective_assignee_id];
  end if;
  select assigned_to into v_previous from fms_instance_stages where fms_instance_id=p_instance_id and status='completed' order by actual_datetime desc nulls last,created_at desc limit 1;
  for v_rule in select * from fms_stage_assignees where fms_stage_id=p_stage_id order by sort_order,id loop
    if v_rule.assignee_type='specific_user' then v_ids:=array_append(v_ids,v_rule.user_profile_id);
    elsif v_rule.assignee_type='role' then select coalesce(array_agg(id),array[]::uuid[]) into v_previous from user_profiles where tenant_id=v_instance.tenant_id and user_role=v_rule.role_value and (v_instance.branch_id is null or branch_id=v_instance.branch_id) and (v_instance.department_id is null or department_id=v_instance.department_id) and working_status not in ('inactive','resigned') and is_login_enabled; v_ids:=v_ids||v_previous;
    elsif v_rule.assignee_type='manager' then select manager_id into v_candidate from branches where id=v_instance.branch_id; v_ids:=array_append(v_ids,v_candidate);
    elsif v_rule.assignee_type='department_head' then select head_id into v_candidate from departments where id=v_instance.department_id; v_ids:=array_append(v_ids,v_candidate);
    elsif v_rule.assignee_type='previous_step_doer' then v_ids:=v_ids||coalesce(v_previous,'{}');
    elsif v_rule.assignee_type='reporter' then v_ids:=array_append(v_ids,v_instance.started_by); end if;
  end loop;
  for v_candidate in select distinct candidate.id from unnest(array_remove(v_ids,null)) candidate(id) join user_profiles u on u.id=candidate.id where u.tenant_id=v_instance.tenant_id loop
    select * into v_coverage from resolve_task_coverage(v_candidate,v_target_date);
    if v_coverage.effective_assignee_id is not null then v_resolved:=array_append(v_resolved,v_coverage.effective_assignee_id); end if;
  end loop;
  select coalesce(array_agg(distinct candidate.id),array[]::uuid[]) into v_ids from unnest(array_remove(v_resolved,null)) candidate(id);
  if cardinality(v_ids)=0 and v_stage.step_type not in ('notification','branch','parallel_start','parallel_join','end') then raise exception 'Coverage required: no active profile-level buddy is available for this step' using errcode='23514'; end if;
  if not v_stage.allow_multiple_doers and cardinality(v_ids)>1 then raise exception 'Choose one eligible assignee for this step' using errcode='23514'; end if;
  return v_ids;
end;
$$;

create or replace function reconcile_all_assignment_coverage_with_audit(p_user_profile_id uuid,p_date date,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_target user_profiles; v_resolution record; v_manager uuid;
  v_task record; v_followup record; v_stage record; v_tasks int:=0; v_crm int:=0; v_fms int:=0; v_required int:=0; v_review int:=0;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  select * into v_target from user_profiles where id=p_user_profile_id for update;
  if v_actor.id is null or not current_profile_is_active() or not (p_user_profile_id=v_actor.id or v_actor.user_role in ('super_admin','admin','manager','hr')) or v_target.id is null or v_target.tenant_id<>v_actor.tenant_id then raise exception 'Coverage reconciliation is not authorized' using errcode='42501'; end if;
  if not exists(select 1 from user_availability where user_profile_id=p_user_profile_id and date=p_date and status='absent') then return jsonb_build_object('date',p_date,'ignored',true,'reason','authorized_absence_required'); end if;
  select * into v_resolution from resolve_task_coverage(p_user_profile_id,p_date);
  if v_resolution.resolution='original' then return jsonb_build_object('date',p_date,'ignored',true,'reason','original_assignee_available'); end if;
  v_manager:=coalesce(v_target.reports_to_user_id,(select head_id from departments where id=v_target.department_id));
  for v_task in select ti.* from task_instances ti where ti.tenant_id=v_actor.tenant_id and ti.status in ('pending','in_progress','in_review') and (coalesce(ti.revised_datetime,ti.planned_datetime) at time zone 'Asia/Kolkata')::date=p_date and exists(select 1 from task_assignees a where a.task_instance_id=ti.id and a.user_profile_id=p_user_profile_id and a.is_active and a.completed_at is null and a.role_at_task='doer') for update of ti loop
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
$$;

create or replace function record_availability_with_audit(p_user_profile_id uuid,p_date date,p_status availability_status,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old user_availability; v_new user_availability;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active() or not (p_user_profile_id=v_actor.id or v_actor.user_role in ('super_admin','admin','manager','hr')) or not exists(select 1 from user_profiles where id=p_user_profile_id and tenant_id=v_actor.tenant_id) then raise exception 'Availability cannot be recorded for this user' using errcode='42501'; end if;
  select * into v_old from user_availability where user_profile_id=p_user_profile_id and date=p_date;
  insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by,source) values(v_actor.tenant_id,p_user_profile_id,p_date,p_status,nullif(btrim(p_reason),''),v_actor.id,'manual') on conflict(user_profile_id,date) do update set status=excluded.status,reason=excluded.reason,logged_by=excluded.logged_by,source='manual' returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'availability_recorded','availability',v_new.id,case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
  if p_status='absent' then perform reconcile_all_assignment_coverage_with_audit(p_user_profile_id,p_date,p_reason); end if;
  return v_new.id;
end;
$$;

revoke all on function resolve_task_coverage(uuid,date) from public,anon,authenticated;
revoke all on function reconcile_all_assignment_coverage_with_audit(uuid,date,text) from public,anon,authenticated,service_role;
grant execute on function resolve_task_coverage(uuid,date) to service_role;
notify pgrst, 'reload schema';
