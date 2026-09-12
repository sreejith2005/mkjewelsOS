-- Make FMS starter assignments and runtime stages one durable assigned-work
-- contract across Home, Notifications and Tasks. Completion closes only the
-- notification linked to the completed work item.
set search_path = public, extensions;

drop view if exists public.v_all_tasks;
create view public.v_all_tasks with (security_invoker = true) as
  select ti.id, ti.tenant_id, ti.branch_id, ti.department_id, ti.category_id, ti.task_template_id,
    ti.task_type, ti.title, ti.description, ti.priority, ti.status, ti.created_by, ti.planned_datetime,
    ti.revised_datetime, ti.actual_datetime, ti.delay_minutes, ti.source, ti.requires_upload,
    ti.requires_remark, ti.requires_form, ti.form_template_id, ta.user_profile_id as assignee_id,
    coalesce(round(100.0 * count(tc.id) filter (where tc.is_required and tc.is_completed)
      / nullif(count(tc.id) filter (where tc.is_required), 0)),
      case when count(tc.id) filter (where tc.is_required) = 0 then 100 else 0 end)::integer as checklist_completion_pct,
    ti.due_datetime, ti.core_task_label, ti.verifier_user_profile_id,
    ti.scheduled_date, ti.assignment_status, ti.buddy_assignment_allowed, ti.verification_status,
    ti.coverage_status, ti.coverage_original_assignee_id,
    coalesce(ti.revised_datetime, ti.due_datetime, ti.planned_datetime) as effective_due_datetime,
    b.name as branch_name, d.name as department_name,
    tt.schedule_kind, tt.starts_on, tt.planned_time, tt.due_time, tt.is_active, tt.verification_required,
    null::text as fms_work_source, null::uuid as fms_instance_id,
    null::uuid as fms_instance_stage_id, null::uuid as fms_starter_assignment_id
  from public.task_instances ti
  left join public.task_assignees ta on ta.task_instance_id = ti.id and ta.is_active and ta.role_at_task = 'doer'
  left join public.task_checklists tc on tc.task_instance_id = ti.id
  left join public.task_templates tt on tt.id = ti.task_template_id
  left join public.branches b on b.id = ti.branch_id
  left join public.departments d on d.id = ti.department_id
  group by ti.id, ta.user_profile_id, tt.id, b.id, d.id
  union all
  select fis.id, fi.tenant_id, fi.branch_id, null::uuid, null::uuid, null::uuid, 'fms'::public.task_type,
    fs.name, fs.method, fi.priority, fis.status, fi.started_by, fis.planned_datetime, null::timestamptz,
    fis.actual_datetime, fis.delay_minutes, 'fms'::text, fs.requires_upload, fs.requires_remark,
    (fs.form_template_id is not null), fs.form_template_id, unnest(fis.assigned_to), 0,
    null::timestamptz, null::text, null::uuid,
    null::date, null::text, null::boolean, null::text,
    fis.coverage_status, fis.coverage_original_assignee_id,
    fis.planned_datetime as effective_due_datetime,
    fb.name, null::text,
    null::text, null::date, null::time, null::time, null::boolean, null::boolean,
    'fms_stage'::text, fi.id, fis.id, null::uuid
  from public.fms_instance_stages fis
  join public.fms_instances fi on fi.id = fis.fms_instance_id
  join public.fms_stages fs on fs.id = fis.fms_stage_id
  left join public.branches fb on fb.id = fi.branch_id
  union all
  select starter.id, starter.tenant_id, flow.branch_id, flow.department_id,
    null::uuid, null::uuid, 'fms'::public.task_type,
    flow.name, stage.method, 'medium'::public.task_priority, 'pending'::public.task_status,
    starter.assigned_by, starter.created_at, null::timestamptz, null::timestamptz, null::integer,
    'fms'::text, false, false, true, starter.form_template_id, starter.user_profile_id, 0,
    null::timestamptz, null::text, null::uuid,
    null::date, null::text, null::boolean, null::text,
    null::text, null::uuid,
    starter.created_at,
    branch.name, department.name,
    null::text, null::date, null::time, null::time, null::boolean, null::boolean,
    'fms_starter'::text, null::uuid, null::uuid, starter.id
  from public.fms_starter_assignments starter
  join public.fms_flows flow on flow.id = starter.fms_flow_id
  join public.fms_stages stage on stage.id = starter.fms_stage_id
  left join public.branches branch on branch.id = flow.branch_id
  left join public.departments department on department.id = flow.department_id
  where starter.status = 'pending';

revoke all on public.v_all_tasks from public, anon;
grant select on public.v_all_tasks to authenticated;

create or replace function public.queue_fms_starter_assignments(p_flow_id uuid, p_assigned_by uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_flow public.fms_flows;
  v_stage public.fms_stages;
  v_assignment public.fms_starter_assignments;
begin
  select * into v_flow from public.fms_flows where id=p_flow_id for share;
  select * into v_stage from public.fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1;
  if v_flow.id is null or v_stage.id is null or v_stage.step_type<>'form' or v_stage.form_template_id is null then
    raise exception 'Published workflow needs an initial linked Form' using errcode='23514';
  end if;
  for v_assignment in
    insert into public.fms_starter_assignments(tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,assigned_by)
    select v_flow.tenant_id,v_flow.id,v_stage.id,v_stage.form_template_id,a.user_profile_id,p_assigned_by
    from public.fms_stage_assignees a
    join public.user_profiles u on u.id=a.user_profile_id
    where a.fms_stage_id=v_stage.id and a.assignee_type='specific_user'
      and u.tenant_id=v_flow.tenant_id and u.working_status not in ('inactive','resigned') and u.is_login_enabled
    on conflict(fms_flow_id,user_profile_id) do nothing
    returning *
  loop
    insert into public.notifications(
      tenant_id,user_profile_id,event_type,title,message,link_url,channel,delivered_status,
      source_module,source_record_id
    ) values(
      v_assignment.tenant_id,v_assignment.user_profile_id,'fms_starter_assigned',
      'New workflow form assigned',
      'Complete the starting form for '||v_flow.name||' to begin the process.',
      '/tasks/fms?starter='||v_assignment.id||'&form='||v_assignment.form_template_id,
      'in_app','delivered','fms',v_assignment.id
    );
  end loop;
end;
$$;

create or replace function public.emit_fms_stage_assignment_event()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_i public.fms_instances;
  v_d public.fms_stages;
  v_f public.fms_flows;
  v_actor public.user_profiles;
  v_names text;
  v_link text;
begin
  if cardinality(new.assigned_to)=0 then return new; end if;
  select * into v_i from public.fms_instances where id=new.fms_instance_id;
  select * into v_d from public.fms_stages where id=new.fms_stage_id;
  select * into v_f from public.fms_flows where id=v_i.fms_flow_id;
  select * into v_actor from public.user_profiles where id=v_i.started_by;
  select string_agg(employee_name,', ' order by employee_name) into v_names
  from public.user_profiles where id=any(new.assigned_to);
  v_link := '/tasks/fms?instance='||v_i.id||'&stage='||new.id;
  if v_d.form_template_id is not null then
    v_link := v_link||'&form='||v_d.form_template_id;
  end if;
  perform public.enqueue_notification_event(
    v_i.tenant_id,v_i.branch_id,v_i.department_id,'fms_stage_assigned','fms',new.id,v_i.started_by,
    jsonb_build_object(
      'actor_name',coalesce(v_actor.employee_name,'System'),'assignee_name',v_names,
      'flow_name',v_f.name,'stage_name',v_d.name,'reference',v_i.reference_number,
      'planned_datetime',coalesce(new.planned_datetime,now()),'priority',v_i.priority,
      '_assigned_user_ids',to_jsonb(new.assigned_to),'_instance_starter_id',v_i.started_by,
      '_link_url',v_link
    ),
    'fms_stage_assigned:'||new.id,coalesce(new.activated_at,now())
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_fms_stage_assignment on public.fms_instance_stage_assignees;

create or replace function public.close_fms_starter_assignment_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if old.status is distinct from new.status and new.status='completed' then
    update public.notifications
    set is_read=true, read_at=coalesce(read_at,now())
    where tenant_id=new.tenant_id
      and user_profile_id=new.user_profile_id
      and event_type='fms_starter_assigned'
      and source_module='fms'
      and source_record_id=new.id
      and not is_read;
  end if;
  return new;
end;
$$;

drop trigger if exists fms_starter_notification_completion on public.fms_starter_assignments;
create trigger fms_starter_notification_completion
after update of status on public.fms_starter_assignments
for each row execute function public.close_fms_starter_assignment_notification();

create or replace function public.close_fms_stage_assignment_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
begin
  if old.status is distinct from new.status and new.status='completed' then
    select tenant_id into v_tenant_id
    from public.fms_instances where id=new.fms_instance_id;
    update public.notifications
    set is_read=true, read_at=coalesce(read_at,now())
    where tenant_id=v_tenant_id
      and user_profile_id=any(new.assigned_to)
      and event_type='fms_stage_assigned'
      and source_module='fms'
      and source_record_id=new.id
      and not is_read;
  end if;
  return new;
end;
$$;

drop trigger if exists fms_stage_notification_completion on public.fms_instance_stages;
create trigger fms_stage_notification_completion
after update of status on public.fms_instance_stages
for each row execute function public.close_fms_stage_assignment_notification();

alter function public.close_fms_starter_assignment_notification() owner to postgres;
alter function public.close_fms_stage_assignment_notification() owner to postgres;
revoke all on function public.close_fms_starter_assignment_notification() from public, anon, authenticated, service_role;
revoke all on function public.close_fms_stage_assignment_notification() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
