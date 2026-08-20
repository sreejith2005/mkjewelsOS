-- A published workflow begins when its initial Form is submitted.  The form
-- itself is recorded as the completed opening stage, then the next stage is
-- assigned and its existing notification trigger delivers the alert.

create or replace function start_fms_from_form_submission_with_audit(p_submission_id uuid)
returns table(instance_id uuid, reference_number text)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_actor user_profiles;
  v_submission form_submissions;
  v_flow fms_flows;
  v_initial_stage fms_stages;
  v_instance fms_instances;
  v_initial_instance_stage fms_instance_stages;
  v_flow_count integer;
  v_ref text;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then
    raise exception 'An active profile is required to start a workflow from a form' using errcode='42501';
  end if;

  select * into v_submission
  from form_submissions
  where id=p_submission_id and tenant_id=v_actor.tenant_id and submitted_by=v_actor.id and linked_module is null
  for update;
  if v_submission.id is null then
    raise exception 'Standalone form submission not found for this account' using errcode='42501';
  end if;

  select count(*) into v_flow_count
  from fms_flows f
  join lateral (
    select s.form_template_id
    from fms_stages s
    where s.fms_flow_id=f.id
    order by s.sort_order,s.id
    limit 1
  ) first_stage on true
  where f.tenant_id=v_actor.tenant_id
    and f.status='published'
    and f.is_active
    and first_stage.form_template_id=v_submission.form_template_id
    and (f.branch_id is null or f.branch_id=v_submission.branch_id)
    and (f.department_id is null or f.department_id=v_submission.department_id);

  if v_flow_count=0 then
    return;
  end if;
  if v_flow_count>1 then
    raise exception 'This form is linked to more than one active workflow. Keep one workflow active for this form.' using errcode='23514';
  end if;

  select f.* into v_flow
  from fms_flows f
  join lateral (
    select s.form_template_id
    from fms_stages s
    where s.fms_flow_id=f.id
    order by s.sort_order,s.id
    limit 1
  ) first_stage on true
  where f.tenant_id=v_actor.tenant_id
    and f.status='published'
    and f.is_active
    and first_stage.form_template_id=v_submission.form_template_id
    and (f.branch_id is null or f.branch_id=v_submission.branch_id)
    and (f.department_id is null or f.department_id=v_submission.department_id)
  for update;
  select * into v_initial_stage from fms_stages where fms_flow_id=v_flow.id order by sort_order,id limit 1;

  v_ref:='FMS-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||lpad(nextval('fms_reference_sequence')::text,8,'0');
  insert into fms_instances(tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,priority,context,started_by)
  values(
    v_actor.tenant_id,
    coalesce(v_submission.branch_id,v_flow.branch_id,v_actor.branch_id),
    coalesce(v_submission.department_id,v_flow.department_id,v_actor.department_id),
    v_flow.id,v_flow.family_id,v_flow.version,v_ref,
    left(v_flow.name||' · Form submission',200),'active','medium',
    jsonb_build_object('form_submission_id',v_submission.id,'form_template_id',v_submission.form_template_id),v_actor.id
  ) returning * into v_instance;
  update fms_flows set usage_count=usage_count+1 where id=v_flow.id;

  insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at,actual_datetime,completed_by,form_submission_id)
  values(
    v_instance.id,v_initial_stage.id,'completed',array[v_actor.id],
    fms_stage_deadline_for_instance(v_initial_stage.planned_time_rule,v_instance.tenant_id,v_instance.id),
    now(),now(),v_actor.id,v_submission.id
  ) returning * into v_initial_instance_stage;
  insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
  values(v_initial_instance_stage.id,v_actor.id,'form_trigger_submitted',jsonb_build_object('form_submission_id',v_submission.id,'form_template_id',v_submission.form_template_id));

  if v_initial_stage.default_next_stage_id is not null then
    perform activate_fms_stage_internal(v_instance.id,v_initial_stage.default_next_stage_id,v_initial_instance_stage.id,null,0);
  else
    update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=v_instance.id;
  end if;

  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'fms_instance_started_from_form','fms_instances',v_instance.id,
    jsonb_build_object('flow_id',v_flow.id,'reference_number',v_ref,'form_submission_id',v_submission.id));
  return query select v_instance.id,v_ref;
end;
$$;

alter function start_fms_from_form_submission_with_audit(uuid) owner to postgres;
revoke all on function start_fms_from_form_submission_with_audit(uuid) from public,anon,service_role;
grant execute on function start_fms_from_form_submission_with_audit(uuid) to authenticated;

-- Home is a personal action queue.  It deliberately does not inherit the
-- broader manager/admin reporting scope: a user sees items assigned to them,
-- including future deadlines, as soon as they are assigned.
create or replace function get_home_summary(p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles; v_context jsonb; v_today date; v_tasks jsonb; v_fms jsonb; v_forms jsonb; v_followups jsonb; v_activity jsonb; v_unread integer; v_availability text; v_actions jsonb;
begin
  v_actor:=assert_reporting_actor();
  perform assert_json_keys(coalesce(p_context,'{}'::jsonb),array[]::text[],'home context');
  v_context:=reporting_context_for_actor(v_actor.id,jsonb_build_object('preset','today'));
  v_today:=(v_context->>'local_start')::date;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.overdue desc,q.priority_order,q.due_at,q.id),'[]'::jsonb) into v_tasks from (
    select ti.id,ti.title,ti.task_type,ti.priority,ti.status,coalesce(ti.revised_datetime,ti.planned_datetime) due_at,
      (ti.status not in ('completed','rejected') and coalesce(ti.revised_datetime,ti.planned_datetime)<now()) overdue,
      case ti.priority when 'high' then 1 when 'medium' then 2 else 3 end priority_order,
      coalesce((select round(100.0*count(*) filter(where tc.is_completed)/nullif(count(*),0),1) from task_checklists tc where tc.task_instance_id=ti.id and tc.is_required),null) checklist_completion
    from task_instances ti
    where ti.tenant_id=v_actor.tenant_id
      and ti.status not in ('completed','rejected')
      and exists(select 1 from task_assignees ta where ta.task_instance_id=ti.id and ta.user_profile_id=v_actor.id and ta.is_active)
    order by overdue desc,priority_order,due_at nulls last,id limit 10
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.planned_datetime nulls last,q.stage_id),'[]'::jsonb) into v_fms from (
    select fis.id stage_id,fi.id instance_id,fi.reference_number,fi.title instance_title,fs.name stage_name,fis.status,fis.planned_datetime,fis.sla_breached
    from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id
    where fis.status in ('pending','in_progress','in_review','blocked','overdue')
      and fi.tenant_id=v_actor.tenant_id
      and exists(select 1 from fms_instance_stage_assignees a where a.fms_instance_stage_id=fis.id and a.user_profile_id=v_actor.id and a.is_active)
    order by fis.planned_datetime nulls last,fis.id limit 6
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.due_at nulls last,q.task_id),'[]'::jsonb) into v_forms from (
    select ti.id task_id,ti.form_template_id,ft.name form_name,ti.title task_title,coalesce(ti.revised_datetime,ti.planned_datetime) due_at
    from task_instances ti join form_templates ft on ft.id=ti.form_template_id
    where ti.requires_form and ti.form_template_id is not null and ti.status not in ('completed','rejected')
      and ti.tenant_id=v_actor.tenant_id
      and exists(select 1 from task_assignees ta where ta.task_instance_id=ti.id and ta.user_profile_id=v_actor.id and ta.is_active)
      and not exists(select 1 from form_submissions fs where fs.linked_module='task' and fs.linked_record_id=ti.id and fs.form_template_id=ti.form_template_id and fs.submitted_by=v_actor.id)
    order by due_at nulls last,ti.id limit 6
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.overdue desc,q.due_date nulls last,q.id),'[]'::jsonb) into v_followups from (
    select f.id,f.client_id,f.subject,f.due_date,f.status,(f.due_date<v_today) overdue
    from client_followups f
    where f.tenant_id=v_actor.tenant_id and f.status='open' and f.assigned_to=v_actor.id
    order by overdue desc,f.due_date nulls last,f.id limit 6
  ) q;

  select count(*)::integer into v_unread from notifications n where n.tenant_id=v_actor.tenant_id and n.user_profile_id=v_actor.id and not n.is_read;
  select ua.status::text into v_availability from user_availability ua where ua.user_profile_id=v_actor.id and ua.date=v_today;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]'::jsonb) into v_activity from (
    select a.id,a.action,a.module,a.created_at from audit_logs a where a.tenant_id=v_actor.tenant_id
      and (a.actor_user_id=v_actor.id or v_actor.user_role in ('super_admin','admin') or v_actor.user_role='manager' and exists(select 1 from user_profiles p where p.id=a.actor_user_id and p.branch_id=v_actor.branch_id))
    order by a.created_at desc,a.id desc limit 8
  ) q;
  v_actions:=case
    when v_actor.user_role in ('super_admin','admin','manager') then '["/tasks/checklist","/tasks/delegation","/tasks/fms","/forms","/reports"]'::jsonb
    when v_actor.user_role='crm' then '["/crm","/tasks/checklist","/tasks/fms","/forms","/reports"]'::jsonb
    else '["/tasks/checklist","/tasks/delegation","/tasks/fms","/forms"]'::jsonb end;
  return jsonb_build_object('generated_at',now(),'tenant_local_date',v_today,'timezone',v_context->>'timezone',
    'profile',jsonb_build_object('id',v_actor.id,'name',v_actor.employee_name,'role',v_actor.user_role,'branch_id',v_actor.branch_id,
      'branch_name',(select b.name from branches b where b.id=v_actor.branch_id),'department_id',v_actor.department_id,
      'department_name',(select d.name from departments d where d.id=v_actor.department_id),'working_status',v_actor.working_status),
    'tasks',v_tasks,'fms_stages',v_fms,'forms_awaiting_submission',v_forms,'crm_followups',v_followups,
    'unread_notifications',v_unread,'availability_status',v_availability,'recent_activity',v_activity,'quick_actions',v_actions);
end $$;

alter function get_home_summary(jsonb) owner to postgres;
revoke all on function get_home_summary(jsonb) from public,anon,service_role;
grant execute on function get_home_summary(jsonb) to authenticated;

notify pgrst,'reload schema';
