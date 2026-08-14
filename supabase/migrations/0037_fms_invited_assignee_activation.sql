-- A named active/invited profile may own an activated FMS stage before its
-- login is enabled. Absence still selects the configured same-department
-- fallback. Historical role-based rules retain login-enabled eligibility.

create or replace function resolve_fms_stage_assignees(p_stage_id uuid,p_instance_id uuid,p_selected_user uuid default null)
returns uuid[] language plpgsql security definer set search_path=public as $$
declare v_stage fms_stages; v_instance fms_instances; v_rule fms_stage_assignees; v_ids uuid[]:='{}'::uuid[]; v_previous uuid[]; v_candidate uuid;
begin
 select * into v_stage from fms_stages where id=p_stage_id; select * into v_instance from fms_instances where id=p_instance_id;
 if v_stage.id is null or v_instance.id is null or v_stage.fms_flow_id<>v_instance.fms_flow_id then raise exception 'Invalid stage activation' using errcode='23514'; end if;
 select assigned_to into v_previous from fms_instance_stages where fms_instance_id=p_instance_id and status='completed' order by actual_datetime desc nulls last,created_at desc limit 1;
 for v_rule in select * from fms_stage_assignees where fms_stage_id=p_stage_id order by sort_order,id loop
   if v_rule.assignee_type='specific_user' then
     if exists(select 1 from user_profiles u where u.id=v_rule.user_profile_id and u.tenant_id=v_instance.tenant_id and u.working_status not in ('inactive','resigned') and not exists(select 1 from user_availability a where a.user_profile_id=u.id and a.date=(now() at time zone 'Asia/Kolkata')::date and a.status='absent')) then v_ids=array_append(v_ids,v_rule.user_profile_id);
     elsif exists(select 1 from user_profiles u where u.id=v_rule.fallback_user_profile_id and u.tenant_id=v_instance.tenant_id and u.working_status not in ('inactive','resigned') and not exists(select 1 from user_availability a where a.user_profile_id=u.id and a.date=(now() at time zone 'Asia/Kolkata')::date and a.status='absent')) then v_ids=array_append(v_ids,v_rule.fallback_user_profile_id); end if;
   elsif v_rule.assignee_type='role' then select coalesce(array_agg(id order by employee_code),'{}') into v_previous from user_profiles where tenant_id=v_instance.tenant_id and user_role=v_rule.role_value and (v_instance.branch_id is null or branch_id=v_instance.branch_id) and (v_instance.department_id is null or department_id=v_instance.department_id) and working_status not in ('inactive','resigned') and is_login_enabled; v_ids=v_ids||v_previous;
   elsif v_rule.assignee_type='manager' then select manager_id into v_candidate from branches where id=v_instance.branch_id; v_ids=array_append(v_ids,v_candidate);
   elsif v_rule.assignee_type='department_head' then select head_id into v_candidate from departments where id=v_instance.department_id; v_ids=array_append(v_ids,v_candidate);
   elsif v_rule.assignee_type='previous_step_doer' then v_ids=v_ids||coalesce(v_previous,'{}'); elsif v_rule.assignee_type='reporter' then v_ids=array_append(v_ids,v_instance.started_by); end if;
 end loop;
 select coalesce(array_agg(distinct u.id),'{}') into v_ids
 from unnest(array_remove(v_ids,null)) candidate(id)
 join user_profiles u on u.id=candidate.id
 where u.tenant_id=v_instance.tenant_id and u.working_status not in ('inactive','resigned')
   and (u.is_login_enabled or exists(select 1 from fms_stage_assignees a where a.fms_stage_id=p_stage_id and a.assignee_type='specific_user' and u.id in (a.user_profile_id,a.fallback_user_profile_id)));
 if cardinality(v_ids)=0 and v_stage.step_type not in ('notification','branch','parallel_start','parallel_join','end') then raise exception 'No active named assignee or same-department fallback is available for this step' using errcode='23514'; end if;
 if not v_stage.allow_multiple_doers and cardinality(v_ids)>1 then if p_selected_user is null or not p_selected_user=any(v_ids) then raise exception 'Choose one eligible assignee for this step' using errcode='23514'; end if; v_ids=array[p_selected_user]; end if;
 return v_ids;
end $$;

alter function resolve_fms_stage_assignees(uuid,uuid,uuid) owner to postgres;
revoke all on function resolve_fms_stage_assignees(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function resolve_fms_stage_assignees(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
