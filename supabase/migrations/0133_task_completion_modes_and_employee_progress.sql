-- Explicit manual-task completion modes and leader-only employee progress.
set search_path=public,extensions;

create function public.create_manual_task_with_mode_with_audit(
  p_payload jsonb,p_doer_ids uuid[],p_watcher_ids uuid[],p_checklist jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_task_id uuid; v_mode text:=coalesce(nullif(p_payload->>'task_type',''),'delegation'); v_actor user_profiles;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid() and account_status='active' and is_login_enabled;
  if v_actor.id is null then raise exception 'Active profile is required' using errcode='42501'; end if;
  if v_mode not in ('delegation','checklist') then raise exception 'Task type is invalid' using errcode='23514'; end if;
  if v_mode='delegation' and jsonb_array_length(coalesce(p_checklist,'[]'::jsonb))>0 then raise exception 'Task cannot contain checklist items' using errcode='23514'; end if;
  if v_mode='checklist' and (jsonb_array_length(coalesce(p_checklist,'[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements(p_checklist) x where nullif(btrim(x->>'item_text'),'') is null)) then raise exception 'Checklist requires at least one item' using errcode='23514'; end if;
  v_task_id:=create_delegation_task_with_audit(
    p_payload || jsonb_build_object('requires_upload',v_mode='delegation'),p_doer_ids,p_watcher_ids,
    case when v_mode='checklist' then p_checklist else '[]'::jsonb end);
  update task_instances set task_type=v_mode::task_type,requires_upload=(v_mode='delegation'),updated_by=v_actor.id,updated_at=now() where id=v_task_id and tenant_id=v_actor.tenant_id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'task_completion_mode_set','tasks',v_task_id,jsonb_build_object('task_type',v_mode));
  return v_task_id;
end $$;

create function public.get_employee_task_progress(p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_from date:=coalesce(nullif(p_context->>'from','')::date,(now() at time zone 'Asia/Kolkata')::date);
  v_to date:=coalesce(nullif(p_context->>'to','')::date,v_from); v_branch uuid:=nullif(p_context->>'branch_id','')::uuid;
  v_department uuid:=nullif(p_context->>'department_id','')::uuid; v_result jsonb;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid() and account_status='active' and is_login_enabled;
  if v_actor.id is null then raise exception 'Active profile is required' using errcode='42501'; end if;
  if v_actor.user_role not in ('super_admin','admin','hr','manager') then raise exception 'Employee progress is not authorized' using errcode='42501'; end if;
  if v_to<v_from or v_to-v_from>366 then raise exception 'Date range is invalid' using errcode='22023'; end if;
  if v_actor.user_role='manager' and (v_branch is not null and v_branch<>v_actor.branch_id) then raise exception 'Branch is not authorized' using errcode='42501'; end if;
  if v_actor.user_role='manager' then v_branch:=v_actor.branch_id; end if;
  with visible as materialized (
    select a.user_profile_id,t.id,t.status,t.planned_datetime,t.actual_datetime,u.employee_name,u.branch_id,u.department_id,b.name branch_name,d.name department_name
    from task_assignees a join task_instances t on t.id=a.task_instance_id join user_profiles u on u.id=a.user_profile_id
    join branches b on b.id=u.branch_id left join departments d on d.id=u.department_id
    where a.is_active and t.tenant_id=v_actor.tenant_id and u.account_status='active' and u.is_login_enabled
      and (v_branch is null or u.branch_id=v_branch) and (v_department is null or u.department_id=v_department)
      and (t.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to
  ), employee_rows as (
    select user_profile_id,employee_name,branch_id,branch_name,department_id,department_name,count(*) assigned,
      count(*) filter(where status='completed' and (actual_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to) completed,
      count(*) filter(where status<>'completed') remaining from visible group by 1,2,3,4,5,6
  ) select jsonb_build_object('employees',coalesce((select jsonb_agg(to_jsonb(employee_rows) order by employee_name) from employee_rows),'[]'::jsonb),
    'departments',coalesce((select jsonb_agg(jsonb_build_object('department_id',department_id,'department_name',department_name,'assigned',sum(assigned),'completed',sum(completed),'remaining',sum(remaining)) order by department_name) from employee_rows group by department_id,department_name),'[]'::jsonb),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('branch_id',branch_id,'branch_name',branch_name,'assigned',sum(assigned),'completed',sum(completed),'remaining',sum(remaining)) order by branch_name) from employee_rows group by branch_id,branch_name),'[]'::jsonb)) into v_result;
  return v_result;
end $$;

revoke all on function public.create_manual_task_with_mode_with_audit(jsonb,uuid[],uuid[],jsonb),public.get_employee_task_progress(jsonb) from public,anon;
grant execute on function public.create_manual_task_with_mode_with_audit(jsonb,uuid[],uuid[],jsonb),public.get_employee_task_progress(jsonb) to authenticated;
notify pgrst,'reload schema';
