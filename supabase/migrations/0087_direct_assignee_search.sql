-- Direct assignment accepts an authorized tenant peer, never caller-supplied org scope.
set search_path = public, extensions;

create or replace function assert_direct_assignment_user(p_user_id uuid,p_tenant_id uuid,p_purpose text)
returns user_profiles language plpgsql stable security definer set search_path=public as $$
declare v_user user_profiles;
begin
  select * into v_user from user_profiles where id=p_user_id and tenant_id=p_tenant_id
    and account_status='active' and working_status='active' and is_login_enabled;
  if v_user.id is null then raise exception '% user is not an active login-enabled tenant profile',p_purpose using errcode='23503'; end if;
  if p_purpose='CRM' and v_user.user_role not in ('super_admin','admin','manager','crm') then raise exception 'Assigned CRM role is not eligible' using errcode='23514'; end if;
  if p_purpose='salesperson' and v_user.user_role not in ('super_admin','admin','manager','crm','staff') then raise exception 'Salesperson role is not eligible' using errcode='23514'; end if;
  return v_user;
end $$;

-- Compatibility wrapper: callers retain the historical argument list, but the
-- selected profile, rather than p_branch_id, supplies assignment scope.
create or replace function assert_crm_branch_user(p_user_id uuid,p_tenant_id uuid,p_branch_id uuid,p_purpose text)
returns user_profiles language plpgsql stable security definer set search_path=public as $$
begin
  return assert_direct_assignment_user(p_user_id,p_tenant_id,p_purpose);
end $$;

create or replace function reassign_fms_stage_with_audit(p_instance_stage_id uuid,p_from_user_id uuid,p_to_user_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_s fms_instance_stages; v_i fms_instances; v_target user_profiles;
begin
  select * into v_actor from current_profile(); select * into v_s from fms_instance_stages where id=p_instance_stage_id for update; select * into v_i from fms_instances where id=v_s.fms_instance_id for update;
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') or (v_actor.user_role='manager' and v_i.branch_id<>v_actor.branch_id) then raise exception 'Reassignment denied' using errcode='42501'; end if;
  if v_i.status not in ('active','overdue') or v_s.status not in ('pending','in_progress','in_review','overdue') or not p_from_user_id=any(v_s.assigned_to) or p_from_user_id=p_to_user_id or nullif(btrim(p_reason),'') is null then raise exception 'Invalid reassignment' using errcode='23514'; end if;
  v_target:=assert_direct_assignment_user(p_to_user_id,v_i.tenant_id,'FMS');
  update fms_instance_stage_assignees set is_active=false,status='reassigned' where fms_instance_stage_id=p_instance_stage_id and user_profile_id=p_from_user_id and is_active;
  insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by) values(v_i.tenant_id,p_instance_stage_id,v_target.id,v_actor.id);
  update fms_instance_stages set assigned_to=array_replace(assigned_to,p_from_user_id,v_target.id),updated_at=now() where id=p_instance_stage_id;
  insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_instance_stage_id,v_actor.id,'reassigned',jsonb_build_object('from',p_from_user_id,'to',v_target.id,'derived_branch_id',v_target.branch_id,'derived_department_id',v_target.department_id,'reason',left(p_reason,1000)));
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_i.tenant_id,v_actor.id,'fms_stage_reassigned','fms_instance_stages',p_instance_stage_id,jsonb_build_object('from',p_from_user_id,'to',v_target.id,'derived_branch_id',v_target.branch_id,'derived_department_id',v_target.department_id,'reason',left(p_reason,1000)));
end $$;

create or replace function resolve_fms_stage_assignees(p_stage_id uuid,p_instance_id uuid,p_selected_user uuid default null)
returns uuid[] language plpgsql security definer set search_path=public as $$
declare v_stage fms_stages; v_instance fms_instances; v_rule fms_stage_assignees; v_ids uuid[]:=array[]::uuid[]; v_resolved uuid[]:=array[]::uuid[]; v_previous uuid[]; v_candidate uuid; v_coverage record; v_target_date date;
begin
  select * into v_stage from fms_stages where id=p_stage_id; select * into v_instance from fms_instances where id=p_instance_id;
  if v_stage.id is null or v_instance.id is null or v_stage.fms_flow_id<>v_instance.fms_flow_id then raise exception 'Invalid stage activation' using errcode='23514'; end if;
  v_target_date:=(fms_stage_deadline_for_instance(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id) at time zone 'Asia/Kolkata')::date;
  if p_selected_user is not null then
    perform assert_direct_assignment_user(p_selected_user,v_instance.tenant_id,'FMS'); select * into v_coverage from resolve_task_coverage(p_selected_user,v_target_date);
    if v_coverage.effective_assignee_id is null then raise exception 'Coverage required for the selected starting assignee' using errcode='23514'; end if;
    return array[v_coverage.effective_assignee_id];
  end if;
  select assigned_to into v_previous from fms_instance_stages where fms_instance_id=p_instance_id and status='completed' order by actual_datetime desc nulls last,created_at desc limit 1;
  for v_rule in select * from fms_stage_assignees where fms_stage_id=p_stage_id order by sort_order,id loop
    if v_rule.assignee_type='specific_user' then v_ids:=array_append(v_ids,v_rule.user_profile_id);
    elsif v_rule.assignee_type='role' then select coalesce(array_agg(id),array[]::uuid[]) into v_previous from user_profiles where tenant_id=v_instance.tenant_id and user_role=v_rule.role_value and (v_instance.branch_id is null or branch_id=v_instance.branch_id) and (v_instance.department_id is null or department_id=v_instance.department_id) and account_status='active' and working_status='active' and is_login_enabled; v_ids:=v_ids||v_previous;
    elsif v_rule.assignee_type='manager' then select manager_id into v_candidate from branches where id=v_instance.branch_id; v_ids:=array_append(v_ids,v_candidate);
    elsif v_rule.assignee_type='department_head' then select head_id into v_candidate from departments where id=v_instance.department_id; v_ids:=array_append(v_ids,v_candidate);
    elsif v_rule.assignee_type='previous_step_doer' then v_ids:=v_ids||coalesce(v_previous,'{}'); elsif v_rule.assignee_type='reporter' then v_ids:=array_append(v_ids,v_instance.started_by); end if;
  end loop;
  for v_candidate in select distinct candidate.id from unnest(array_remove(v_ids,null)) candidate(id) join user_profiles u on u.id=candidate.id where u.tenant_id=v_instance.tenant_id and u.account_status='active' and u.working_status='active' and u.is_login_enabled loop
    select * into v_coverage from resolve_task_coverage(v_candidate,v_target_date); if v_coverage.effective_assignee_id is not null then v_resolved:=array_append(v_resolved,v_coverage.effective_assignee_id); end if;
  end loop;
  select coalesce(array_agg(distinct candidate.id),array[]::uuid[]) into v_ids from unnest(array_remove(v_resolved,null)) candidate(id);
  if cardinality(v_ids)=0 and v_stage.step_type not in ('notification','branch','parallel_start','parallel_join','end') then raise exception 'Coverage required: no active profile-level buddy is available for this step' using errcode='23514'; end if;
  if not v_stage.allow_multiple_doers and cardinality(v_ids)>1 then raise exception 'Choose one eligible assignee for this step' using errcode='23514'; end if;
  return v_ids;
end $$;

-- A client home branch is a business fact, not an assignee scope. Keep the
-- compatible p_branch_id argument for older clients, but never trust or apply
-- it to the client record during a direct reassignment.
create or replace function reassign_crm_client(p_client_id uuid,p_assigned_crm_id uuid,p_branch_id uuid,p_expected_version integer,p_request_key uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_client clients; v_target user_profiles; v_version int; v_replay jsonb;
begin
 v_actor:=assert_crm_actor();
 if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||v_actor.id::text||'reassign_client'||p_request_key::text,0));
 select result into v_replay from crm_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and operation='reassign_client' and request_key=p_request_key;
 if v_replay is not null then return (v_replay->>'version')::int; end if;
 select * into v_client from clients where id=p_client_id for update;
 if v_client.id is null or v_client.tenant_id<>v_actor.tenant_id or v_client.record_version<>p_expected_version then raise exception 'Client not found or stale' using errcode='40001'; end if;
 if v_actor.user_role='crm' or (v_actor.user_role='manager' and v_client.branch_id<>v_actor.branch_id) then raise exception 'Reassignment is outside role scope' using errcode='42501'; end if;
 v_target:=assert_direct_assignment_user(p_assigned_crm_id,v_actor.tenant_id,'CRM');
 update client_assignments set is_active=false,ended_at=now(),ended_by=v_actor.id where client_id=p_client_id and is_active;
 insert into client_assignments(tenant_id,client_id,user_profile_id,branch_id,assigned_by)
 values(v_actor.tenant_id,p_client_id,v_target.id,v_target.branch_id,v_actor.id);
 update clients set assigned_crm_id=v_target.id,record_version=record_version+1,updated_by=v_actor.id,updated_at=now()
 where id=p_client_id returning record_version into v_version;
 insert into client_timeline(tenant_id,branch_id,client_id,event_type,subject,summary,created_by,occurred_at,metadata)
 values(v_actor.tenant_id,v_client.branch_id,p_client_id,'client_reassigned','Client reassigned','CRM ownership changed',v_actor.id,now(),jsonb_build_object('client_branch_id',v_client.branch_id,'assigned_crm_id',v_target.id,'derived_assignee_branch_id',v_target.branch_id,'ignored_request_branch_id',p_branch_id));
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
 values(v_actor.tenant_id,v_actor.id,'crm_client_reassigned','clients',p_client_id,jsonb_build_object('branch_id',v_client.branch_id,'assigned_crm_id',v_client.assigned_crm_id),jsonb_build_object('branch_id',v_client.branch_id,'assigned_crm_id',v_target.id,'derived_assignee_branch_id',v_target.branch_id,'record_version',v_version));
 perform enqueue_notification_event(v_actor.tenant_id,v_client.branch_id,null,'client_reassigned','crm',p_client_id,v_actor.id,jsonb_build_object('_assigned_user_ids',jsonb_build_array(v_target.id),'_link_url','/crm?client='||p_client_id),'client_reassigned:'||p_client_id||':'||v_version,now());
 insert into crm_mutation_keys(tenant_id,actor_id,operation,request_key,result_id,result) values(v_actor.tenant_id,v_actor.id,'reassign_client',p_request_key,p_client_id,jsonb_build_object('version',v_version));
 return v_version;
end $$;

alter function assert_direct_assignment_user(uuid,uuid,text) owner to postgres;
alter function assert_crm_branch_user(uuid,uuid,uuid,text) owner to postgres;
alter function reassign_fms_stage_with_audit(uuid,uuid,uuid,text) owner to postgres;
alter function reassign_crm_client(uuid,uuid,uuid,integer,uuid) owner to postgres;
alter function resolve_fms_stage_assignees(uuid,uuid,uuid) owner to postgres;
revoke all on function assert_direct_assignment_user(uuid,uuid,text) from public,anon,authenticated;
revoke all on function assert_crm_branch_user(uuid,uuid,uuid,text) from public,anon;
grant execute on function assert_crm_branch_user(uuid,uuid,uuid,text) to authenticated;
revoke all on function reassign_fms_stage_with_audit(uuid,uuid,uuid,text),resolve_fms_stage_assignees(uuid,uuid,uuid),reassign_crm_client(uuid,uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function reassign_fms_stage_with_audit(uuid,uuid,uuid,text),resolve_fms_stage_assignees(uuid,uuid,uuid),reassign_crm_client(uuid,uuid,uuid,integer,uuid) to authenticated;
notify pgrst,'reload schema';
