-- Soft-deleted work must be absent from every operational read, including
-- SECURITY DEFINER summaries that do not pass through table RLS. These simple
-- invoker views preserve the existing table columns and underlying RLS.
set search_path=public,extensions;
create view public.task_instances_live with (security_invoker=true) as
  select * from public.task_instances where deleted_at is null;
create view public.task_templates_live with (security_invoker=true) as
  select * from public.task_templates where deleted_at is null;
revoke all on public.task_instances_live,public.task_templates_live from public,anon,service_role;
grant select on public.task_instances_live,public.task_templates_live to authenticated;

-- The existing read contracts are retained; only their table read source changes.
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor user_profiles; c jsonb; v_start timestamptz; v_end timestamptz; v_days integer; v_prev_start timestamptz; v_metrics jsonb; v_trend jsonb; v_status jsonb; v_previous jsonb; v_task_assigned integer; v_task_completed integer; v_check_total integer; v_check_done integer; v_people_active integer; v_people_available integer; v_cohort_completed integer; v_cohort_on_time integer;
begin
  perform public.assert_module_access('dashboard');
  v_actor:=assert_reporting_actor(); c:=reporting_context_for_actor(v_actor.id,coalesce(p_context,'{}'::jsonb));
  v_start:=(c->>'start_at')::timestamptz; v_end:=(c->>'end_at')::timestamptz; v_days:=(c->>'local_end_exclusive')::date-(c->>'local_start')::date; v_prev_start:=v_start-(v_days||' days')::interval;
  select count(*) filter(where ti.planned_datetime>=v_start and ti.planned_datetime<v_end),
    count(*) filter(where ti.actual_datetime>=v_start and ti.actual_datetime<v_end and ti.status='completed'),
    count(*) filter(where ti.planned_datetime>=v_start and ti.planned_datetime<v_end and ti.status='completed'),
    count(*) filter(where ti.planned_datetime>=v_start and ti.planned_datetime<v_end and ti.status='completed' and ti.actual_datetime<=task_effective_due_datetime(row(ti.*)::public.task_instances))
  into v_task_assigned,v_task_completed,v_cohort_completed,v_cohort_on_time from public.task_instances_live ti where task_in_reporting_scope(v_actor,row(ti.*)::public.task_instances,c);
  select count(*) filter(where tc.is_required),count(*) filter(where tc.is_required and tc.is_completed) into v_check_total,v_check_done
  from task_checklists tc join public.task_instances_live ti on ti.id=tc.task_instance_id where ti.planned_datetime>=v_start and ti.planned_datetime<v_end and task_in_reporting_scope(v_actor,row(ti.*)::public.task_instances,c);

  select jsonb_build_object(
    'tasks_assigned',v_task_assigned,'tasks_completed',v_task_completed,
    'task_completion_rate',case when v_task_assigned=0 then null else round(100.0*v_task_completed/v_task_assigned,1) end,
    'task_pending_score',case when v_task_assigned=0 then null else round(100.0*v_cohort_completed/v_task_assigned-100,1) end,
    'task_delayed_score',case when v_task_assigned=0 then null when v_cohort_completed=0 then -100.0 else round(100.0*v_cohort_on_time/v_cohort_completed-100,1) end,
    'on_time_completed',count(*) filter(where ti.status='completed' and ti.actual_datetime>=v_start and ti.actual_datetime<v_end and ti.actual_datetime<=coalesce(ti.revised_datetime,ti.planned_datetime)),
    'overdue_open',count(*) filter(where ti.status not in ('completed','rejected') and coalesce(ti.revised_datetime,ti.planned_datetime)<now()),
    'average_completion_delay',round(avg(greatest(coalesce(ti.delay_minutes,0),0)) filter(where ti.status='completed' and ti.actual_datetime>=v_start and ti.actual_datetime<v_end),1),
    'checklist_completion',case when v_check_total=0 then null else round(100.0*v_check_done/v_check_total,1) end
  ) into v_metrics from public.task_instances_live ti where task_in_reporting_scope(v_actor,row(ti.*)::public.task_instances,c);

  v_metrics:=v_metrics||jsonb_build_object(
    'active_fms_stages',(select count(*) from fms_instance_stages fis where fis.status in ('in_progress','in_review','blocked','overdue') and fms_stage_in_reporting_scope(v_actor,fis.id,c)),
    'completed_fms_stages',(select count(*) from fms_instance_stages fis where fis.actual_datetime>=v_start and fis.actual_datetime<v_end and fis.status='completed' and fms_stage_in_reporting_scope(v_actor,fis.id,c)),
    'fms_sla_breaches',(select count(*) from fms_instance_stages fis where (fis.sla_breached or fis.delay_minutes>0) and coalesce(fis.actual_datetime,fis.planned_datetime)>=v_start and coalesce(fis.actual_datetime,fis.planned_datetime)<v_end and fms_stage_in_reporting_scope(v_actor,fis.id,c)),
    'forms_submitted',(select count(*) from form_submissions fs where fs.tenant_id=v_actor.tenant_id and fs.submitted_at>=v_start and fs.submitted_at<v_end and (v_actor.user_role in ('super_admin','admin') or v_actor.user_role='manager' and fs.branch_id=v_actor.branch_id or fs.submitted_by=v_actor.id)),
    'forms_awaiting_submission',(select count(*) from public.task_instances_live ti where ti.requires_form and ti.form_template_id is not null and ti.status not in ('completed','rejected') and task_in_reporting_scope(v_actor,row(ti.*)::public.task_instances,c) and not exists(select 1 from form_submissions fs where fs.linked_module='task' and fs.linked_record_id=ti.id and fs.form_template_id=ti.form_template_id)),
    'unread_notifications',(select count(*) from notifications n where n.tenant_id=v_actor.tenant_id and n.user_profile_id=v_actor.id and not n.is_read)
  );

  if v_actor.user_role in ('super_admin','admin','manager','crm') then
    v_metrics:=v_metrics||jsonb_build_object(
      'crm_followups_due',(select count(*) from client_followups f where f.tenant_id=v_actor.tenant_id and f.due_date>=(c->>'local_start')::date and f.due_date<(c->>'local_end_exclusive')::date and f.status='open' and can_read_crm_client(f.client_id)),
      'crm_followups_overdue',(select count(*) from client_followups f where f.tenant_id=v_actor.tenant_id and f.due_date<(c->>'local_end_exclusive')::date and f.status='open' and can_read_crm_client(f.client_id)),
      'crm_followups_completed',(select count(*) from client_followups f where f.tenant_id=v_actor.tenant_id and f.completed_at>=v_start and f.completed_at<v_end and f.status='completed' and can_read_crm_client(f.client_id)),
      'crm_clients',(select count(*) from clients cl where cl.tenant_id=v_actor.tenant_id and cl.status<>'merged' and can_read_crm_client(cl.id)),
      'crm_walkins',(select count(*) from walkin_entries w where w.tenant_id=v_actor.tenant_id and w.visit_date>=v_start and w.visit_date<v_end and can_read_crm_client(w.client_id)),
      'crm_interactions',(select count(*) from client_timeline t where t.tenant_id=v_actor.tenant_id and t.occurred_at>=v_start and t.occurred_at<v_end and can_read_crm_client(t.client_id))
    );
  end if;
  if v_actor.user_role in ('super_admin','admin','manager','hr') then
    select count(*) into v_people_active from user_profiles p where p.tenant_id=v_actor.tenant_id and p.working_status='active' and p.is_login_enabled and ((c->>'branch_id') is null or p.branch_id=(c->>'branch_id')::uuid);
    select count(distinct p.id) into v_people_available from user_profiles p join user_availability ua on ua.user_profile_id=p.id and ua.date=(now() at time zone (c->>'timezone'))::date and ua.status in ('present','half_day','remote') where p.tenant_id=v_actor.tenant_id and p.working_status='active' and p.is_login_enabled and ((c->>'branch_id') is null or p.branch_id=(c->>'branch_id')::uuid);
    v_metrics:=v_metrics||jsonb_build_object('active_people',v_people_active,'people_available',v_people_available,'people_availability_rate',case when v_people_active=0 then null else round(100.0*v_people_available/v_people_active,1) end,
      'fms_instances_active',(select count(*) from fms_instances fi where fi.tenant_id=v_actor.tenant_id and fi.status='active' and ((c->>'branch_id') is null or fi.branch_id=(c->>'branch_id')::uuid)),
      'form_reviews_pending',(select count(*) from form_submissions fs where fs.tenant_id=v_actor.tenant_id and fs.status='submitted' and ((c->>'branch_id') is null or fs.branch_id=(c->>'branch_id')::uuid)));
  end if;
  if v_actor.user_role in ('super_admin','admin') then
    v_metrics:=v_metrics||jsonb_build_object('notification_delivery_health',(select case when count(*) filter(where nd.state in ('delivered','failed_terminal'))=0 then null else round(100.0*count(*) filter(where nd.state='delivered')/count(*) filter(where nd.state in ('delivered','failed_terminal')),1) end from notification_deliveries nd where nd.tenant_id=v_actor.tenant_id and nd.created_at>=v_start and nd.created_at<v_end));
  end if;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.local_date),'[]'::jsonb) into v_trend from (
    select (ti.actual_datetime at time zone (c->>'timezone'))::date local_date,count(*)::integer completed
    from public.task_instances_live ti where ti.status='completed' and ti.actual_datetime>=v_start and ti.actual_datetime<v_end and task_in_reporting_scope(v_actor,row(ti.*)::public.task_instances,c)
    group by 1 order by 1
  ) q;
  select coalesce(jsonb_object_agg(q.status,q.count),'{}'::jsonb) into v_status from (select ti.status::text status,count(*)::integer count from public.task_instances_live ti where ti.planned_datetime>=v_start and ti.planned_datetime<v_end and task_in_reporting_scope(v_actor,row(ti.*)::public.task_instances,c) group by ti.status) q;
  select jsonb_build_object('tasks_assigned',q.assigned,'tasks_completed',q.completed,
    'task_pending_score',case when q.assigned=0 then null else round(100.0*q.cohort_completed/q.assigned-100,1) end,
    'task_delayed_score',case when q.assigned=0 then null when q.cohort_completed=0 then -100.0 else round(100.0*q.cohort_on_time/q.cohort_completed-100,1) end)
  into v_previous from (
    select count(*) filter(where ti.planned_datetime>=v_prev_start and ti.planned_datetime<v_start) assigned,
      count(*) filter(where ti.status='completed' and ti.actual_datetime>=v_prev_start and ti.actual_datetime<v_start) completed,
      count(*) filter(where ti.planned_datetime>=v_prev_start and ti.planned_datetime<v_start and ti.status='completed') cohort_completed,
      count(*) filter(where ti.planned_datetime>=v_prev_start and ti.planned_datetime<v_start and ti.status='completed' and ti.actual_datetime<=task_effective_due_datetime(row(ti.*)::public.task_instances)) cohort_on_time
    from public.task_instances_live ti where task_in_reporting_scope(v_actor,row(ti.*)::public.task_instances,c)
  ) q;
  return jsonb_build_object('generated_at',now(),'freshness','live','context',c,'metrics',v_metrics,'previous',v_previous,'task_completion_trend',v_trend,'task_status_distribution',v_status);
end $function$;

CREATE OR REPLACE FUNCTION public.get_employee_task_progress(p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor user_profiles;
  v_from date:=coalesce(nullif(p_context->>'from','')::date,(now() at time zone 'Asia/Kolkata')::date);
  v_to date:=coalesce(nullif(p_context->>'to','')::date,v_from);
  v_branch uuid:=nullif(p_context->>'branch_id','')::uuid;
  v_department uuid:=nullif(p_context->>'department_id','')::uuid;
  v_user uuid:=nullif(p_context->>'user_profile_id','')::uuid;
  v_result jsonb;
begin
 perform public.assert_module_enabled('task_templates');
 select * into v_actor from current_profile() p where p.account_status='active' and p.is_login_enabled;
 if v_actor.id is null or v_actor.user_role not in ('super_admin','admin','hr','manager') then raise exception 'Employee progress is not authorized' using errcode='42501'; end if;
 if v_to<v_from or v_to-v_from>366 then raise exception 'Date range is invalid' using errcode='22023'; end if;
 if v_actor.user_role='manager' and v_branch is not null and v_branch<>v_actor.branch_id then raise exception 'Branch is not authorized' using errcode='42501'; end if;
 if v_actor.user_role='manager' then v_branch:=v_actor.branch_id; end if;
 with visible as materialized (
   select a.user_profile_id,t.status,t.planned_datetime,t.actual_datetime,t.due_datetime,
     task_effective_due_datetime(row(t.*)::public.task_instances) effective_due,
     u.employee_name,u.branch_id,u.department_id,b.name branch_name,d.name department_name
   from task_assignees a
   join public.task_instances_live t on t.id=a.task_instance_id
   join user_profiles u on u.id=a.user_profile_id
   join branches b on b.id=u.branch_id
   left join departments d on d.id=u.department_id
   where a.is_active and t.tenant_id=v_actor.tenant_id and u.account_status='active' and u.is_login_enabled
     and (v_branch is null or u.branch_id=v_branch)
     and (v_department is null or u.department_id=v_department)
     and (v_user is null or a.user_profile_id=v_user)
     and (t.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to
 ), employees as (
   select user_profile_id,employee_name,branch_id,branch_name,department_id,department_name,
     count(*)::int assigned,
     (count(*) filter(where status='completed' and (actual_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to))::int completed,
     (count(*) filter(where status='completed' and (actual_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to and actual_datetime<=effective_due))::int on_time_completed,
     (count(*) filter(where status<>'completed'))::int remaining,
     (count(*) filter(where status not in ('completed','rejected') and coalesce(due_datetime,planned_datetime)<now()))::int overdue
   from visible group by 1,2,3,4,5,6
 ), departments as (
   select department_id,department_name,sum(assigned)::int assigned,sum(completed)::int completed,
     sum(on_time_completed)::int on_time_completed,sum(remaining)::int remaining,sum(overdue)::int overdue from employees group by 1,2
 ), branches as (
   select branch_id,branch_name,sum(assigned)::int assigned,sum(completed)::int completed,
     sum(on_time_completed)::int on_time_completed,sum(remaining)::int remaining,sum(overdue)::int overdue from employees group by 1,2
 )
 select jsonb_build_object(
   'employees',coalesce((select jsonb_agg(to_jsonb(employees) order by employee_name) from employees),'[]'::jsonb),
   'departments',coalesce((select jsonb_agg(to_jsonb(departments) order by department_name) from departments),'[]'::jsonb),
   'branches',coalesce((select jsonb_agg(to_jsonb(branches) order by branch_name) from branches),'[]'::jsonb)
 ) into v_result;
 return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.get_home_summary(p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor user_profiles; v_context jsonb; v_today date; v_tasks jsonb; v_fms jsonb; v_forms jsonb; v_followups jsonb; v_activity jsonb; v_unread integer; v_availability text; v_actions jsonb;
begin
  perform public.assert_module_access('home');
  v_actor:=assert_reporting_actor();
  perform assert_json_keys(coalesce(p_context,'{}'::jsonb),array[]::text[],'home context');
  v_context:=reporting_context_for_actor(v_actor.id,jsonb_build_object('preset','today'));
  v_today:=(v_context->>'local_start')::date;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.overdue desc,q.priority_order,q.due_at,q.id),'[]'::jsonb) into v_tasks from (
    select ti.id,ti.title,ti.task_type,ti.priority,ti.status,coalesce(ti.revised_datetime,ti.planned_datetime) due_at,
      (ti.status not in ('completed','rejected') and coalesce(ti.revised_datetime,ti.planned_datetime)<now()) overdue,
      case ti.priority when 'high' then 1 when 'medium' then 2 else 3 end priority_order,
      coalesce((select round(100.0*count(*) filter(where tc.is_completed)/nullif(count(*),0),1) from task_checklists tc where tc.task_instance_id=ti.id and tc.is_required),null) checklist_completion
    from public.task_instances_live ti
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
    from public.task_instances_live ti join form_templates ft on ft.id=ti.form_template_id
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
end $function$;

CREATE OR REPLACE FUNCTION public.get_recurring_todo_workspace(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor public.user_profiles; v_from date; v_to date; v_search text;
  v_status text; v_priority text; v_branch uuid; v_department uuid; v_kind text;
  v_templates jsonb; v_instances jsonb; v_stats jsonb;
  v_from_at timestamptz; v_to_at timestamptz;
begin
  select * into v_actor from public.user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or not public.current_profile_is_active() or v_actor.user_role not in ('super_admin','admin') then
    raise exception 'Recurring workspace access denied' using errcode = '42501';
  end if;
  v_from := coalesce(nullif(p_filter->>'date_from','')::date,(now() at time zone 'Asia/Kolkata')::date-7);
  v_to := coalesce(nullif(p_filter->>'date_to','')::date,(now() at time zone 'Asia/Kolkata')::date+30);
  v_search := lower(btrim(coalesce(p_filter->>'search','')));
  v_status := nullif(p_filter->>'status','');
  v_priority := nullif(p_filter->>'priority','');
  v_branch := nullif(p_filter->>'branch_id','')::uuid;
  v_department := nullif(p_filter->>'department_id','')::uuid;
  v_kind := nullif(p_filter->>'schedule_kind','');
  v_from_at := v_from::timestamp at time zone 'Asia/Kolkata';
  v_to_at := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';
  if v_status is not null and v_status not in ('pending','in_progress','in_review','completed','rejected','blocked','overdue') then
    raise exception 'Status filter is invalid' using errcode = '22023';
  end if;
  if v_priority is not null and v_priority not in ('high','medium','low') then
    raise exception 'Priority filter is invalid' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.title),'[]'::jsonb) into v_templates
  from public.task_templates_live t
  where t.tenant_id = v_actor.tenant_id and t.task_type in ('checklist','delegation')
    and t.recurrence_rule is not null
    and (v_search = '' or lower(t.title||' '||coalesce(t.description,'')) like '%'||v_search||'%')
    and (v_branch is null or t.branch_id = v_branch)
    and (v_department is null or t.department_id = v_department)
    and (v_priority is null or t.priority::text = v_priority)
    and (v_kind is null or t.schedule_kind = v_kind);

  with visible as materialized (
    select ti.* from public.task_instances_live ti
    where ti.tenant_id = v_actor.tenant_id and ti.task_template_id is not null
      and ti.planned_datetime >= v_from_at and ti.planned_datetime < v_to_at
      and (v_search = '' or lower(ti.title||' '||coalesce(ti.description,'')) like '%'||v_search||'%')
      and (v_branch is null or ti.branch_id = v_branch)
      and (v_department is null or ti.department_id = v_department)
      and (v_priority is null or ti.priority::text = v_priority)
      and (v_status is null or ti.status::text = v_status)
      and (v_kind is null or exists(select 1 from public.task_templates_live t where t.id = ti.task_template_id and t.schedule_kind = v_kind))
  ), assignees as (
    select a.task_instance_id, coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name,'is_original',a.is_original)),'[]'::jsonb) as rows
    from public.task_assignees a join visible v on v.id = a.task_instance_id join public.user_profiles u on u.id = a.user_profile_id
    where a.is_active group by a.task_instance_id
  ), checklists as (
    select c.task_instance_id, coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order),'[]'::jsonb) as rows
    from public.task_checklists c join visible v on v.id = c.task_instance_id group by c.task_instance_id
  ), attachments as (
    select a.task_instance_id, true as has_attachment from public.task_attachments a join visible v on v.id = a.task_instance_id group by a.task_instance_id
  ), submissions as (
    -- `s.tenant_id` is what makes idx_form_submissions_task_completion usable;
    -- the instance is already tenant-scoped, so this narrows nothing.
    select v.id as task_instance_id, true as has_form_submission
    from visible v
    join public.form_submissions s
      on s.tenant_id = v_actor.tenant_id
     and s.linked_record_id = v.id
     and v.form_template_id is not null
     and s.form_template_id = v.form_template_id
    group by v.id
  ), followups as (
    select f.task_instance_id, coalesce(jsonb_agg(jsonb_build_object('id',f.id,'comment',f.comment,'created_at',f.created_at,'author',u.employee_name) order by f.created_at desc),'[]'::jsonb) as rows
    from public.task_comments f join visible v on v.id = f.task_instance_id join public.user_profiles u on u.id = f.user_profile_id group by f.task_instance_id
  )
  select coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object('assignees',coalesce(a.rows,'[]'::jsonb),'checklist',coalesce(c.rows,'[]'::jsonb),'has_attachment',coalesce(ta.has_attachment,false),'has_form_submission',coalesce(s.has_form_submission,false),'followups',coalesce(f.rows,'[]'::jsonb)) order by public.task_effective_due_datetime(row(v.*)::public.task_instances)),'[]'::jsonb) into v_instances
  from visible v left join assignees a on a.task_instance_id = v.id left join checklists c on c.task_instance_id = v.id left join attachments ta on ta.task_instance_id = v.id left join submissions s on s.task_instance_id = v.id left join followups f on f.task_instance_id = v.id;

  select jsonb_build_object('total',count(*),'pending',count(*) filter(where status='pending'),'in_progress',count(*) filter(where status='in_progress'),'completed',count(*) filter(where status='completed'),'rejected',count(*) filter(where status='rejected'),'overdue',count(*) filter(where status not in ('completed','rejected') and public.task_effective_due_datetime(row(ti.*)::public.task_instances) < now()),'on_time',count(*) filter(where on_time_status='on_time'),'delayed',count(*) filter(where on_time_status='delayed'),'completed_on_behalf',count(*) filter(where completion_mode='on_behalf'),'coverage_required',count(*) filter(where coverage_status='coverage_required'),'manager_review',count(*) filter(where coverage_status='manager_review')) into v_stats
  from public.task_instances_live ti
  where ti.tenant_id = v_actor.tenant_id and ti.task_template_id is not null and ti.planned_datetime >= v_from_at and ti.planned_datetime < v_to_at
    and (v_branch is null or ti.branch_id = v_branch) and (v_department is null or ti.department_id = v_department) and (v_priority is null or ti.priority::text = v_priority);

  return jsonb_build_object('filters',jsonb_build_object('date_from',v_from,'date_to',v_to),'templates',v_templates,'instances',v_instances,'stats',v_stats);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_task_evidence_workspace(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor user_profiles; v_from date; v_to date; v_branch uuid; v_department uuid;
  v_user uuid; v_search text; v_page integer; v_page_size integer; v_view text; v_result jsonb;
begin
  perform public.assert_module_enabled('task_templates');
  select * into v_actor from current_profile() where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin','manager','hr') then
    raise exception 'Task evidence workspace access denied' using errcode='42501';
  end if;
  v_from:=coalesce(nullif(p_filter->>'from','')::date,(now() at time zone 'Asia/Kolkata')::date-29);
  v_to:=coalesce(nullif(p_filter->>'to','')::date,(now() at time zone 'Asia/Kolkata')::date);
  if v_to<v_from or v_to-v_from>366 then raise exception 'Date range is invalid' using errcode='22023'; end if;
  v_branch:=nullif(p_filter->>'branch_id','')::uuid;
  v_department:=nullif(p_filter->>'department_id','')::uuid;
  v_user:=nullif(p_filter->>'user_profile_id','')::uuid;
  v_search:=lower(btrim(coalesce(p_filter->>'search','')));
  v_page:=greatest(1,coalesce(nullif(p_filter->>'page','')::integer,1));
  v_page_size:=least(100,greatest(10,coalesce(nullif(p_filter->>'page_size','')::integer,25)));
  v_view:=coalesce(nullif(p_filter->>'view',''),'all');
  if v_view not in ('all','checklist','upload','awaiting_evidence','overdue','completed','remaining') then
    raise exception 'Task view is invalid' using errcode='22023';
  end if;
  if v_actor.user_role='manager' then
    if v_branch is not null and v_branch<>v_actor.branch_id then
      raise exception 'Branch is not authorized' using errcode='42501';
    end if;
    v_branch:=v_actor.branch_id;
  end if;

  with scope as materialized (
    select t.id as task_id,t.title,t.status,t.task_type,coalesce(t.requires_upload,false) as requires_upload,
      t.planned_datetime,t.actual_datetime,t.due_datetime,b.name as branch_name,d.name as department_name,
      (select string_agg(u.employee_name,', ' order by u.employee_name)
         from task_assignees a join user_profiles u on u.id=a.user_profile_id
        where a.task_instance_id=t.id and a.is_active) as assignee_names,
      exists(select 1 from task_attachments x where x.task_instance_id=t.id) as has_evidence,
      -- One task carries two independent facts the workspace filters on: the
      -- work type a doer sees (an upload task, or a checkbox one) and whether
      -- it is late. Both are derived once here so every branch below agrees.
      (t.task_type='delegation' or coalesce(t.requires_upload,false)) as is_upload_work,
      (t.status not in ('completed','rejected') and coalesce(t.due_datetime,t.planned_datetime)<now()) as is_overdue
    from public.task_instances_live t
    left join branches b on b.id=t.branch_id
    left join departments d on d.id=t.department_id
    where t.tenant_id=v_actor.tenant_id
      and (t.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to
      and (v_branch is null or t.branch_id=v_branch)
      and (v_department is null or t.department_id=v_department)
      and (v_user is null or exists(select 1 from task_assignees a
            where a.task_instance_id=t.id and a.is_active and a.user_profile_id=v_user))
      and (v_search='' or lower(t.title||' '||coalesce(t.description,'')) like '%'||v_search||'%')
  ), files as (
    select a.id as attachment_id,a.created_at as uploaded_at,a.original_filename,a.mime_type,a.size_bytes,
      u.employee_name as uploaded_by_name,s.*
    from task_attachments a
    join scope s on s.task_id=a.task_instance_id
    left join user_profiles u on u.id=a.uploaded_by
  ), selected as (
    select * from scope where case v_view
      when 'checklist' then not is_upload_work
      when 'upload' then is_upload_work
      when 'awaiting_evidence' then requires_upload and not has_evidence
      when 'overdue' then is_overdue
      when 'completed' then status='completed'
      when 'remaining' then status<>'completed'
      else true end
  ), outstanding as (
    select * from scope where requires_upload and not has_evidence
  ), stats as (
    select jsonb_build_object(
      'tasks_total',count(*),
      'upload_tasks',count(*) filter(where requires_upload),
      'upload_tasks_with_evidence',count(*) filter(where requires_upload and has_evidence),
      'upload_tasks_awaiting_evidence',count(*) filter(where requires_upload and not has_evidence),
      'completed',count(*) filter(where status='completed'),
      'remaining',count(*) filter(where status<>'completed'),
      'overdue',count(*) filter(where is_overdue),
      'evidence_files',(select count(*) from files),
      'evidence_bytes',(select coalesce(sum(size_bytes),0) from files)
    ) as value from scope
  ), task_page as (
    -- Late work first, then most recent: the reason to open this list is to see
    -- what is outstanding before what is merely old.
    select * from selected order by is_overdue desc,coalesce(due_datetime,planned_datetime) desc
    limit v_page_size offset (v_page-1)*v_page_size
  ), tasks as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'task_id',p.task_id,'task_title',p.title,'task_type',p.task_type,'task_status',p.status,
      'requires_upload',p.requires_upload,'is_upload_work',p.is_upload_work,'overdue',p.is_overdue,
      'branch_name',p.branch_name,'department_name',p.department_name,'assignee_names',p.assignee_names,
      'planned_datetime',p.planned_datetime,'due_datetime',p.due_datetime,'actual_datetime',p.actual_datetime,
      'attachments',coalesce((
        select jsonb_agg(jsonb_build_object(
          'attachment_id',a.id,'original_filename',a.original_filename,'mime_type',a.mime_type,
          'size_bytes',a.size_bytes,'uploaded_at',a.created_at,'uploaded_by_name',u.employee_name
        ) order by a.created_at desc)
        from task_attachments a left join user_profiles u on u.id=a.uploaded_by
        where a.task_instance_id=p.task_id),'[]'::jsonb)
    ) order by p.is_overdue desc,coalesce(p.due_datetime,p.planned_datetime) desc),'[]'::jsonb) as value
    from task_page p
  ), outstanding_page as (
    select * from outstanding order by coalesce(due_datetime,planned_datetime) limit 100
  ), missing as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'task_id',task_id,'task_title',title,'task_status',status,'assignee_names',assignee_names,
      'branch_name',branch_name,'department_name',department_name,'planned_datetime',planned_datetime,
      'due_datetime',due_datetime,'overdue',is_overdue
    ) order by coalesce(due_datetime,planned_datetime)),'[]'::jsonb) as value from outstanding_page
  )
  select jsonb_build_object(
    'filters',jsonb_build_object('from',v_from,'to',v_to,'branch_id',v_branch,'department_id',v_department,
      'user_profile_id',v_user,'search',v_search,'page',v_page,'page_size',v_page_size,'view',v_view),
    'stats',stats.value,
    'tasks',tasks.value,
    'tasks_total',(select count(*) from selected),
    'missing',missing.value,
    'missing_total',(select count(*) from outstanding))
  into v_result from stats,tasks,missing;
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.get_task_template_directory(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor public.user_profiles; v_search text; v_rows jsonb;
begin
  perform public.assert_module_enabled('task_templates');
  select * into v_actor from current_profile() where auth_user_id = auth.uid();
  if v_actor.id is null or not public.current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin') then
    raise exception 'Task template directory access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_filter,'{}'::jsonb)) <> 'object' then
    raise exception 'Task template filter is invalid' using errcode = '22023';
  end if;
  v_search := lower(btrim(coalesce(p_filter->>'search','')));

  with imported as (
    select distinct origin.task_template_id
    from (
      select i.task_template_id from public.task_import_items i where i.task_template_id is not null
      union all
      select r.task_template_id from public.task_import_row_registry r where r.task_template_id is not null
    ) origin
  )
  select coalesce(jsonb_agg(listing.entry order by listing.owner_name, listing.task_title),'[]'::jsonb)
  into v_rows
  from (
    select
      coalesce(u.employee_name,'') as owner_name,
      t.title as task_title,
      jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'description', t.description,
        'assignee_user_id', t.default_assignee_user_id,
        'assignee_name', coalesce(u.employee_name,''),
        'assignee_type', t.default_assignee_type,
        'department_id', t.department_id,
        'department_name', coalesce(d.name,''),
        'branch_id', t.branch_id,
        'branch_name', coalesce(b.name,''),
        'task_type', t.task_type,
        'schedule_kind', t.schedule_kind,
        'recurrence_rule', t.recurrence_rule,
        'starts_on', t.starts_on,
        'planned_time', t.planned_time,
        'due_time', t.due_time,
        'priority', t.priority,
        'requires_upload', coalesce(t.requires_upload,false),
        'requires_form', coalesce(t.requires_form,false),
        'verification_required', t.verification_required,
        'followup_enabled', t.followup_enabled,
        'buddy_assignment_allowed', t.buddy_assignment_allowed,
        'is_active', coalesce(t.is_active,false),
        'assignment_status', t.assignment_status,
        'schedule_status', case
          when t.assignment_status = 'assigning_left' then 'assigning_left'
          when t.schedule_kind <> 'as_required' and t.starts_on is null then 'needs_start_date'
          when coalesce(t.is_active,false) then 'ready'
          else 'paused' end,
        'source', case when i.task_template_id is not null then 'bulk_import' else 'web_app' end,
        'checklist_count', case when jsonb_typeof(t.checklist_items) = 'array'
          then jsonb_array_length(t.checklist_items) else 0 end,
        'created_at', t.created_at,
        'updated_at', t.updated_at
      ) as entry
    from public.task_templates_live t
    left join public.user_profiles u on u.id = t.default_assignee_user_id
    left join public.departments d on d.id = t.department_id
    left join public.branches b on b.id = t.branch_id
    left join imported i on i.task_template_id = t.id
    where t.tenant_id = v_actor.tenant_id
      and t.task_type in ('checklist','delegation')
      and (v_search = '' or lower(
            coalesce(t.title,'') || ' ' || coalesce(t.description,'') || ' ' ||
            coalesce(u.employee_name,'') || ' ' || coalesce(d.name,'')
          ) like '%' || v_search || '%')
  ) listing;

  return jsonb_build_object('templates', v_rows);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_assigning_left_tasks()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor public.user_profiles; v_result jsonb;
begin
  perform public.assert_module_enabled('checklist_tasks');
  select * into v_actor from public.current_profile();
  if v_actor.id is null or not public.current_profile_is_active() or v_actor.user_role not in ('super_admin','admin') then raise exception 'Assigning Left access denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(item order by item->>'created_at' desc),'[]'::jsonb) into v_result from (
    select jsonb_build_object('record_kind','task','id',t.id,'title',t.title,'destination','Tasks','branch_id',t.branch_id,'department_id',t.department_id,'starts_at',t.planned_datetime,'verification_pending',t.verification_status='pending' and t.verifier_user_profile_id is null,'created_at',t.created_at) item
    from public.task_instances_live t where t.tenant_id=v_actor.tenant_id and t.assignment_status='assigning_left'
    union all
    select jsonb_build_object('record_kind','template','id',t.id,'title',t.title,'destination',case when t.schedule_kind='as_required' then 'As Required' else 'Recurring / To-Do' end,'branch_id',t.branch_id,'department_id',t.department_id,'starts_at',t.starts_on,'verification_pending',t.verification_required and t.verifier_user_profile_id is null,'created_at',t.created_at) item
    from public.task_templates_live t where t.tenant_id=v_actor.tenant_id and t.assignment_status='assigning_left'
  ) queued;
  return v_result;
end;
$function$;


create or replace function management_insights_rows_v1(c jsonb)
returns table(record jsonb,module text,status text,due timestamptz,completed timestamptz,branch_id uuid,department_id uuid,employee_ids uuid[],task_type text,flow_id uuid,uncovered boolean)
language plpgsql stable security definer set search_path=public as $$
declare a user_profiles; v_availability boolean; v_forms boolean;
begin
 a:=current_profile();
 -- Stable section permissions are resolved once per request, not for every task.
 v_availability:=module_accessible('availability');
 v_forms:=module_accessible('forms_library');
 if module_accessible('checklist_tasks') then
 return query select jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'due',task_effective_due_datetime(row(t.*)::public.task_instances),'completed',t.actual_datetime,'module','tasks','task_id',t.id,'availability_clash',v_availability and task_effective_due_datetime(row(t.*)::public.task_instances) is not null and exists(select 1 from task_assignees ta where ta.task_instance_id=t.id and ta.is_active and (not is_user_available_for_task(ta.user_profile_id,(task_effective_due_datetime(row(t.*)::public.task_instances) at time zone (c->>'timezone'))::date) or leave_half_day_absent_at(ta.user_profile_id,task_effective_due_datetime(row(t.*)::public.task_instances)))),'awaiting_form',v_forms and t.requires_form and t.form_template_id is not null and not exists(select 1 from form_submissions fs where fs.linked_record_id=t.id and fs.form_template_id=t.form_template_id and fs.linked_module in ('task','checklist_task','delegation_task'))),
  'tasks'::text,t.status::text,task_effective_due_datetime(row(t.*)::public.task_instances),t.actual_datetime,t.branch_id,t.department_id,
  array(select ta.user_profile_id from task_assignees ta where ta.task_instance_id=t.id and ta.is_active),t.task_type::text,null::uuid,t.coverage_status='coverage_required'
 from public.task_instances_live t where task_in_reporting_scope(a,row(t.*)::public.task_instances,c)
  and (c->>'task_type' is null or t.task_type::text=c->>'task_type') and (c->>'priority' is null or t.priority::text=c->>'priority')
  and (c->>'status' is null or t.status::text=c->>'status') and (c->>'source' is null or t.source=c->>'source') and (c->>'category_id' is null or t.category_id=(c->>'category_id')::uuid)
  and (c->>'designation_id' is null or exists(select 1 from task_assignees ta join user_profiles u on u.id=ta.user_profile_id where ta.task_instance_id=t.id and ta.is_active and u.designation_id=(c->>'designation_id')::uuid));
 end if;
 if module_accessible('fms_builder') then
 return query select jsonb_build_object('id',s.id,'title',concat(f.name,'  |  ',d.name),'status',s.status,'due',s.planned_datetime,'completed',s.actual_datetime,'module','workflows','instance_id',i.id,'stage_id',s.id,'step_type',d.step_type),
  'workflows'::text,s.status::text,s.planned_datetime,s.actual_datetime,i.branch_id,i.department_id,
  array(select sa.user_profile_id from fms_instance_stage_assignees sa where sa.fms_instance_stage_id=s.id and sa.is_active),null::text,i.fms_flow_id,false
 from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id join fms_flows f on f.id=i.fms_flow_id join fms_stages d on d.id=s.fms_stage_id
 where fms_stage_in_reporting_scope(a,s.id,c) and (c->>'stage_id' is null or s.fms_stage_id=(c->>'stage_id')::uuid) and (c->>'flow_id' is null or i.fms_flow_id=(c->>'flow_id')::uuid)
  and (c->>'status' is null or s.status::text=c->>'status')
  and (c->>'designation_id' is null or exists(select 1 from fms_instance_stage_assignees sa join user_profiles u on u.id=sa.user_profile_id where sa.fms_instance_stage_id=s.id and sa.is_active and u.designation_id=(c->>'designation_id')::uuid));
 return query select jsonb_build_object('id',s.id,'title',concat(f.name,'  |  Starter form'),'status',s.status,'due',null,'completed',s.completed_at,'module','workflows','starter_id',s.id,'form_id',s.form_template_id),
  'workflows'::text,s.status::text,null::timestamptz,s.completed_at,u.branch_id,u.department_id,array[u.id],null::text,s.fms_flow_id,false
 from fms_starter_assignments s join user_profiles u on u.id=s.user_profile_id join fms_flows f on f.id=s.fms_flow_id
 where (c->>'stage_id' is null or s.fms_stage_id=(c->>'stage_id')::uuid) and s.tenant_id=a.tenant_id and (a.user_role in ('super_admin','admin') or a.user_role='manager' and u.branch_id=a.branch_id or u.id=a.id)
  and (c->>'branch_id' is null or u.branch_id=(c->>'branch_id')::uuid) and (c->>'department_id' is null or u.department_id=(c->>'department_id')::uuid)
  and (c->>'user_profile_id' is null or u.id=(c->>'user_profile_id')::uuid) and (c->>'designation_id' is null or u.designation_id=(c->>'designation_id')::uuid)
  and (c->>'flow_id' is null or s.fms_flow_id=(c->>'flow_id')::uuid);
 end if;
 if v_forms then
 return query select jsonb_build_object('id',s.id,'title',f.name,'status',s.status,'due',s.submitted_at,'completed',s.reviewed_at,'module','forms','form_id',s.form_template_id),
  'forms'::text,s.status::text,s.submitted_at,s.reviewed_at,s.branch_id,s.department_id,array[s.submitted_by],null::text,null::uuid,false
 from form_submissions s join form_templates f on f.id=s.form_template_id join user_profiles u on u.id=s.submitted_by
 where s.tenant_id=a.tenant_id and (a.user_role in ('super_admin','admin') or a.user_role='manager' and s.branch_id=a.branch_id or s.submitted_by=a.id)
  and (c->>'branch_id' is null or s.branch_id=(c->>'branch_id')::uuid) and (c->>'department_id' is null or s.department_id=(c->>'department_id')::uuid)
  and (c->>'flow_id' is null and c->>'stage_id' is null or s.linked_module='fms_stage' and exists(select 1 from fms_instance_stages fs join fms_instances fi on fi.id=fs.fms_instance_id where fs.id=s.linked_record_id and (c->>'flow_id' is null or fi.fms_flow_id=(c->>'flow_id')::uuid) and (c->>'stage_id' is null or fs.fms_stage_id=(c->>'stage_id')::uuid)))
  and (c->>'user_profile_id' is null or s.submitted_by=(c->>'user_profile_id')::uuid) and (c->>'designation_id' is null or u.designation_id=(c->>'designation_id')::uuid);
 end if;
 if v_availability and a.user_role in ('super_admin','admin','manager','hr') then
 return query select jsonb_build_object('id',u.id,'title',u.employee_name,'status',case when (is_user_available_for_task(u.id,(now() at time zone (c->>'timezone'))::date) and not leave_half_day_absent_at(u.id,now())) then 'available' else 'unavailable' end,'due',null,'completed',null,'module','people','employee_id',u.id),
  'people'::text,case when (is_user_available_for_task(u.id,(now() at time zone (c->>'timezone'))::date) and not leave_half_day_absent_at(u.id,now())) then 'available' else 'unavailable' end,null::timestamptz,null::timestamptz,u.branch_id,u.department_id,array[u.id],null::text,null::uuid,false
 from user_profiles u where u.tenant_id=a.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
  and (c->>'branch_id' is null or u.branch_id=(c->>'branch_id')::uuid) and (c->>'department_id' is null or u.department_id=(c->>'department_id')::uuid)
  and (c->>'user_profile_id' is null or u.id=(c->>'user_profile_id')::uuid) and (c->>'designation_id' is null or u.designation_id=(c->>'designation_id')::uuid);
 end if;
end $$;

create or replace function get_management_insights_options_v1(p_context jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c jsonb; a user_profiles;
begin
 c:=management_insights_context_v1(coalesce(p_context,'{}'));a:=current_profile();
 return jsonb_build_object(
 'branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from branches where tenant_id=a.tenant_id and is_active and (a.user_role in ('super_admin','admin') or id=a.branch_id)),'[]'),
 'departments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from departments where tenant_id=a.tenant_id and is_active and (c->>'branch_id' is null or branch_id is null or branch_id=(c->>'branch_id')::uuid) and (a.user_role in ('super_admin','admin','manager','hr') or id=a.department_id)),'[]'),
 'employees',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',employee_name) order by employee_name) from (select id,employee_name from user_profiles where tenant_id=a.tenant_id and (c->>'branch_id' is null or branch_id=(c->>'branch_id')::uuid) and (a.user_role in ('super_admin','admin','manager','hr') or id=a.id) and (c->>'department_id' is null or department_id=(c->>'department_id')::uuid) order by employee_name,id) u),'[]'),
 'designations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',label) order by label) from dropdown_masters where tenant_id=a.tenant_id and master_type='designation' and is_active),'[]'),
 'categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',label) order by label) from dropdown_masters where tenant_id=a.tenant_id and master_type='task_category' and is_active),'[]'),
 'stages',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.sort_order,s.id) from fms_stages s join fms_flows f on f.id=s.fms_flow_id where f.tenant_id=a.tenant_id and module_accessible('fms_builder') and (c->>'flow_id' is null or f.id=(c->>'flow_id')::uuid)),'[]'),
 'flows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',concat(name,' - v',version)) order by name,version) from fms_flows where tenant_id=a.tenant_id and module_accessible('fms_builder')),'[]'),
 'taskTypes',coalesce((select jsonb_agg(jsonb_build_object('id',enumlabel,'name',initcap(replace(enumlabel,'_',' ')))) from pg_enum where enumtypid='task_type'::regtype),'[]'),
 'sources',coalesce((select jsonb_agg(jsonb_build_object('id',source,'name',initcap(replace(source,'_',' ')))) from (select distinct t.source from public.task_instances_live t where module_accessible('checklist_tasks') and task_in_reporting_scope(a,row(t.*)::public.task_instances,c) and source is not null) sources),'[]'));
end $$;

-- The two template deletion entry points delegate Admin/Super Admin to the
-- same series lifecycle. Manager's existing recurring contract is retained.
create function public.admin_delete_task_series_with_audit(p_template_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_actor user_profiles:=public.current_profile(); v_template task_templates; v_task_id uuid; v_result jsonb;
begin
  perform public.assert_module_enabled('tasks');
  if v_actor.id is null or not current_profile_is_active() or not has_permission('tasks.view_all') then
    raise exception 'Task administration denied' using errcode='42501'; end if;
  select * into v_template from task_templates where id=p_template_id and tenant_id=v_actor.tenant_id and deleted_at is null for update;
  if v_template.id is null then raise exception 'Task administration denied' using errcode='42501'; end if;
  select id into v_task_id from task_instances where task_template_id=p_template_id and deleted_at is null
    order by (status='completed'),id limit 1;
  if v_task_id is not null then
    -- The series-specific screen may be accessible even when the Tasks section
    -- is denied. Both use this internal implementation after their own gate.
    v_result:=public.delete_task_lifecycle_with_audit(v_task_id,true,p_reason);
  else
    update task_templates set is_active=false,deleted_at=now(),updated_by=v_actor.id,updated_at=now() where id=p_template_id;
    update task_import_batches b set retired_import_hash=b.import_hash,
      import_hash=encode(digest(b.import_hash||b.id::text,'sha256'),'hex')
      where b.tenant_id=v_actor.tenant_id and b.retired_import_hash is null and exists(
        select 1 from task_import_items i where i.batch_id=b.id and i.task_template_id=p_template_id);
    update task_import_row_registry set retired_business_fingerprint=business_fingerprint,
      business_fingerprint=encode(digest(business_fingerprint||id::text,'sha256'),'hex')
      where tenant_id=v_actor.tenant_id and task_template_id=p_template_id and retired_business_fingerprint is null;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_actor.tenant_id,v_actor.id,'task_series_deleted','tasks',p_template_id,to_jsonb(v_template),jsonb_build_object('reason',p_reason));
    v_result:=jsonb_build_object('removed',0,'completed_preserved',0);
  end if;
  return v_result||jsonb_build_object('title',v_template.title);
end;
$$;
revoke all on function public.admin_delete_task_series_with_audit(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.delete_task_template_with_audit(p_template_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  perform public.assert_module_access('task_templates');
  v_result:=public.admin_delete_task_series_with_audit(p_template_id,'Deleted from task templates');
  return jsonb_build_object('outcome',case when (v_result->>'completed_preserved')::integer>0 then 'archived' else 'deleted' end,
    'open_instances_removed',v_result->'removed','instances_preserved',v_result->'completed_preserved','title',v_result->'title');
end;
$$;

alter function public.delete_recurring_todo_template_with_audit(uuid) rename to delete_recurring_todo_template_v0210;
revoke all on function public.delete_recurring_todo_template_v0210(uuid) from public,anon,authenticated,service_role;
create function public.delete_recurring_todo_template_with_audit(p_template_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  perform public.assert_module_access('recurring_todo');
  if public.has_permission('tasks.view_all') then
    v_result:=public.admin_delete_task_series_with_audit(p_template_id,'Deleted from recurring schedules');
    return case when (v_result->>'completed_preserved')::integer>0 then 'archived' else 'deleted' end;
  end if;
  return public.delete_recurring_todo_template_v0210(p_template_id);
end;
$$;
revoke all on function public.delete_recurring_todo_template_with_audit(uuid) from public,anon,service_role;
grant execute on function public.delete_recurring_todo_template_with_audit(uuid) to authenticated;
notify pgrst,'reload schema';
