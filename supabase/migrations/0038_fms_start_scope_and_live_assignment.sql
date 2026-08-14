-- Manual FMS runs choose their concrete branch, department, and first owner at
-- start time. Flow scope remains the default for administrators and the hard
-- authorization boundary for branch/department-scoped operational users.

create or replace function can_start_fms_flow(p_flow_id uuid,p_branch_id uuid,p_department_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from fms_flows f
    join user_profiles actor on actor.auth_user_id=auth.uid()
    where f.id=p_flow_id
      and f.tenant_id=actor.tenant_id
      and f.status='published'
      and f.is_active
      and actor.working_status not in ('inactive','resigned')
      and actor.is_login_enabled
      and actor.user_role in ('super_admin','admin','manager','crm','staff')
      and (
        actor.user_role in ('super_admin','admin')
        or (
          p_branch_id=actor.branch_id
          and (f.branch_id is null or f.branch_id=p_branch_id)
          and (f.department_id is null or f.department_id=p_department_id)
          and (actor.user_role not in ('crm','staff') or p_department_id=actor.department_id)
        )
      )
  )
$$;

create or replace function resolve_fms_stage_assignees(p_stage_id uuid,p_instance_id uuid,p_selected_user uuid default null)
returns uuid[] language plpgsql security definer set search_path=public as $$
declare v_stage fms_stages; v_instance fms_instances; v_rule fms_stage_assignees; v_ids uuid[]:='{}'::uuid[]; v_previous uuid[]; v_candidate uuid;
begin
 select * into v_stage from fms_stages where id=p_stage_id;
 select * into v_instance from fms_instances where id=p_instance_id;
 if v_stage.id is null or v_instance.id is null or v_stage.fms_flow_id<>v_instance.fms_flow_id then raise exception 'Invalid stage activation' using errcode='23514'; end if;

 if p_selected_user is not null then
   if not exists(
     select 1 from user_profiles u
     where u.id=p_selected_user
       and u.tenant_id=v_instance.tenant_id
       and u.branch_id=v_instance.branch_id
       and u.department_id=v_instance.department_id
       and u.working_status not in ('inactive','resigned')
       and coalesce(u.account_status::text,'active') in ('active','invited')
       and not exists(
         select 1 from user_availability a
         where a.user_profile_id=u.id
           and a.date=(now() at time zone 'Asia/Kolkata')::date
           and a.status='absent'
       )
   ) then raise exception 'The selected starting assignee is not available in this branch and department' using errcode='23514'; end if;
   return array[p_selected_user];
 end if;

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
 if not v_stage.allow_multiple_doers and cardinality(v_ids)>1 then raise exception 'Choose one eligible assignee for this step' using errcode='23514'; end if;
 return v_ids;
end $$;

create or replace function start_fms_instance_with_audit(p_flow_id uuid,p_title text,p_priority task_priority default 'medium',p_context jsonb default '{}',p_branch_id uuid default null,p_department_id uuid default null,p_first_assignee_id uuid default null)
returns table(instance_id uuid,reference_number text) language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_flow fms_flows; v_instance fms_instances; v_start uuid; v_ref text;
begin
 select * into v_actor from current_profile();
 if v_actor.id is null or not current_profile_is_active() then raise exception 'Active profile required' using errcode='42501'; end if;
 select * into v_flow from fms_flows where id=p_flow_id for share;
 p_branch_id=coalesce(p_branch_id,v_flow.branch_id,v_actor.branch_id);
 p_department_id=coalesce(p_department_id,v_flow.department_id,v_actor.department_id);
 if not can_start_fms_flow(p_flow_id,p_branch_id,p_department_id) then raise exception 'Flow start is outside authorized scope' using errcode='42501'; end if;
 if not exists(select 1 from branches b where b.id=p_branch_id and b.tenant_id=v_actor.tenant_id and b.is_active) then raise exception 'Choose an active branch for this workflow run' using errcode='23514'; end if;
 if not exists(select 1 from departments d where d.id=p_department_id and d.tenant_id=v_actor.tenant_id and d.is_active and (d.branch_id is null or d.branch_id=p_branch_id)) then raise exception 'Choose an active department available in this branch' using errcode='23514'; end if;
 if length(btrim(p_title)) not between 1 and 200 or jsonb_typeof(p_context)<>'object' or pg_column_size(p_context)>32768 or (select count(*) from jsonb_object_keys(p_context))>50 then raise exception 'Invalid instance title or context' using errcode='22023'; end if;
 v_ref='FMS-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||lpad(nextval('fms_reference_sequence')::text,8,'0');
 insert into fms_instances(tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,priority,context,started_by)
 values(v_actor.tenant_id,p_branch_id,p_department_id,v_flow.id,v_flow.family_id,v_flow.version,v_ref,btrim(p_title),'active',p_priority,p_context,v_actor.id)
 returning * into v_instance;
 update fms_flows set usage_count=usage_count+1 where id=v_flow.id;
 select id into v_start from fms_stages where fms_flow_id=v_flow.id order by sort_order,id limit 1;
 perform activate_fms_stage_internal(v_instance.id,v_start,null,p_first_assignee_id,0);
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
 values(v_actor.tenant_id,v_actor.id,'fms_instance_started','fms_instances',v_instance.id,jsonb_build_object('flow_id',v_flow.id,'version',v_flow.version,'reference_number',v_ref,'branch_id',p_branch_id,'department_id',p_department_id,'first_assignee_id',p_first_assignee_id));
 return query select v_instance.id,v_ref;
end $$;

alter function can_start_fms_flow(uuid,uuid,uuid) owner to postgres;
alter function resolve_fms_stage_assignees(uuid,uuid,uuid) owner to postgres;
alter function start_fms_instance_with_audit(uuid,text,task_priority,jsonb,uuid,uuid,uuid) owner to postgres;
revoke all on function can_start_fms_flow(uuid,uuid,uuid),resolve_fms_stage_assignees(uuid,uuid,uuid),start_fms_instance_with_audit(uuid,text,task_priority,jsonb,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function can_start_fms_flow(uuid,uuid,uuid),resolve_fms_stage_assignees(uuid,uuid,uuid),start_fms_instance_with_audit(uuid,text,task_priority,jsonb,uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
