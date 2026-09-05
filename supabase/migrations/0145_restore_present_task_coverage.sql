-- Restore unfinished work to its original assignee when an authorized roster
-- update changes that person's availability from absent to available. Coverage
-- remains auditable; completed and rejected work is never reassigned.
set search_path=public,extensions;

create or replace function record_availability_with_audit(p_user_profile_id uuid,p_date date,p_status availability_status,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old user_availability; v_new user_availability; v_task task_instances;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active() or not (p_user_profile_id=v_actor.id or v_actor.user_role in ('super_admin','admin','manager','hr')) or not exists(select 1 from user_profiles where id=p_user_profile_id and tenant_id=v_actor.tenant_id) then raise exception 'Availability cannot be recorded for this user' using errcode='42501'; end if;
  select * into v_old from user_availability where user_profile_id=p_user_profile_id and date=p_date;
  insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by,source) values(v_actor.tenant_id,p_user_profile_id,p_date,p_status,nullif(btrim(p_reason),''),v_actor.id,'manual') on conflict(user_profile_id,date) do update set status=excluded.status,reason=excluded.reason,logged_by=excluded.logged_by,source='manual' returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'availability_recorded','availability',v_new.id,case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));

  if p_status='absent' then
    perform reconcile_all_assignment_coverage_with_audit(p_user_profile_id,p_date,p_reason);
  elsif v_old.status='absent' and is_user_available_for_task(p_user_profile_id,p_date) then
    for v_task in
      select * from task_instances
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
$$;

-- The coverage owner is returned by the existing security-invoker feed. The
-- client resolves the name from its already-authorized v_task_users load.
drop view if exists public.v_all_tasks;
create view public.v_all_tasks with (security_invoker=true) as
  select ti.id,ti.tenant_id,ti.branch_id,ti.department_id,ti.category_id,ti.task_template_id,
    ti.task_type,ti.title,ti.description,ti.priority,ti.status,ti.created_by,ti.planned_datetime,
    ti.revised_datetime,ti.actual_datetime,ti.delay_minutes,ti.source,ti.requires_upload,
    ti.requires_remark,ti.requires_form,ti.form_template_id,ta.user_profile_id as assignee_id,
    coalesce(round(100.0*count(tc.id) filter(where tc.is_required and tc.is_completed)
      /nullif(count(tc.id) filter(where tc.is_required),0)),
      case when count(tc.id) filter(where tc.is_required)=0 then 100 else 0 end)::integer as checklist_completion_pct,
    ti.due_datetime,ti.core_task_label,ti.verifier_user_profile_id,
    ti.scheduled_date,ti.assignment_status,ti.buddy_assignment_allowed,ti.verification_status,
    ti.coverage_status,ti.coverage_original_assignee_id,
    b.name as branch_name,d.name as department_name,
    tt.schedule_kind,tt.starts_on,tt.planned_time,tt.due_time,tt.is_active,tt.verification_required
  from public.task_instances ti
  left join public.task_assignees ta on ta.task_instance_id=ti.id and ta.is_active and ta.role_at_task='doer'
  left join public.task_checklists tc on tc.task_instance_id=ti.id
  left join public.task_templates tt on tt.id=ti.task_template_id
  left join public.branches b on b.id=ti.branch_id
  left join public.departments d on d.id=ti.department_id
  group by ti.id,ta.user_profile_id,tt.id,b.id,d.id
  union all
  select fis.id,fi.tenant_id,fi.branch_id,null::uuid,null::uuid,null::uuid,'fms'::public.task_type,
    fs.name,fs.method,fi.priority,fis.status,fi.started_by,fis.planned_datetime,null::timestamptz,
    fis.actual_datetime,fis.delay_minutes,'fms'::text,fs.requires_upload,fs.requires_remark,
    (fs.form_template_id is not null),fs.form_template_id,unnest(fis.assigned_to),0,
    null::timestamptz,null::text,null::uuid,
    null::date,null::text,null::boolean,null::text,
    fis.coverage_status,fis.coverage_original_assignee_id,
    fb.name,null::text,
    null::text,null::date,null::time,null::time,null::boolean,null::boolean
  from public.fms_instance_stages fis
  join public.fms_instances fi on fi.id=fis.fms_instance_id
  join public.fms_stages fs on fs.id=fis.fms_stage_id
  left join public.branches fb on fb.id=fi.branch_id;
grant select on public.v_all_tasks to authenticated;
notify pgrst,'reload schema';
