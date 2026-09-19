-- Task performance scores (docs/superpowers/specs/2026-09-18-task-performance-score-design.md).
--
-- Additive only: both RPCs keep their authorization, section gates (0156),
-- and every existing response field. get_employee_task_progress gains an
-- on_time_completed count per row; get_dashboard_metrics gains
-- task_pending_score and task_delayed_score, both computed from one
-- assigned-task cohort (tasks planned in the range). task_completion_rate is
-- retained for installed native builds that still read it.
--
-- On time means completed no later than task_effective_due_datetime().

create or replace function public.get_employee_task_progress(p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
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
     task_effective_due_datetime(t) effective_due,
     u.employee_name,u.branch_id,u.department_id,b.name branch_name,d.name department_name
   from task_assignees a
   join task_instances t on t.id=a.task_instance_id
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
end $$;

revoke all on function public.get_employee_task_progress(jsonb) from public,anon;
grant execute on function public.get_employee_task_progress(jsonb) to authenticated;

create or replace function public.get_dashboard_metrics(p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles; c jsonb; v_start timestamptz; v_end timestamptz; v_days integer; v_prev_start timestamptz; v_metrics jsonb; v_trend jsonb; v_status jsonb; v_previous jsonb; v_task_assigned integer; v_task_completed integer; v_check_total integer; v_check_done integer; v_people_active integer; v_people_available integer; v_cohort_completed integer; v_cohort_on_time integer;
begin
  perform public.assert_module_access('dashboard');
  v_actor:=assert_reporting_actor(); c:=reporting_context_for_actor(v_actor.id,coalesce(p_context,'{}'::jsonb));
  v_start:=(c->>'start_at')::timestamptz; v_end:=(c->>'end_at')::timestamptz; v_days:=(c->>'local_end_exclusive')::date-(c->>'local_start')::date; v_prev_start:=v_start-(v_days||' days')::interval;
  select count(*) filter(where ti.planned_datetime>=v_start and ti.planned_datetime<v_end),
    count(*) filter(where ti.actual_datetime>=v_start and ti.actual_datetime<v_end and ti.status='completed'),
    count(*) filter(where ti.planned_datetime>=v_start and ti.planned_datetime<v_end and ti.status='completed'),
    count(*) filter(where ti.planned_datetime>=v_start and ti.planned_datetime<v_end and ti.status='completed' and ti.actual_datetime<=task_effective_due_datetime(ti))
  into v_task_assigned,v_task_completed,v_cohort_completed,v_cohort_on_time from task_instances ti where task_in_reporting_scope(v_actor,ti,c);
  select count(*) filter(where tc.is_required),count(*) filter(where tc.is_required and tc.is_completed) into v_check_total,v_check_done
  from task_checklists tc join task_instances ti on ti.id=tc.task_instance_id where ti.planned_datetime>=v_start and ti.planned_datetime<v_end and task_in_reporting_scope(v_actor,ti,c);

  select jsonb_build_object(
    'tasks_assigned',v_task_assigned,'tasks_completed',v_task_completed,
    'task_completion_rate',case when v_task_assigned=0 then null else round(100.0*v_task_completed/v_task_assigned,1) end,
    'task_pending_score',case when v_task_assigned=0 then null else round(100.0*v_cohort_completed/v_task_assigned-100,1) end,
    'task_delayed_score',case when v_task_assigned=0 then null when v_cohort_completed=0 then -100.0 else round(100.0*v_cohort_on_time/v_cohort_completed-100,1) end,
    'on_time_completed',count(*) filter(where ti.status='completed' and ti.actual_datetime>=v_start and ti.actual_datetime<v_end and ti.actual_datetime<=coalesce(ti.revised_datetime,ti.planned_datetime)),
    'overdue_open',count(*) filter(where ti.status not in ('completed','rejected') and coalesce(ti.revised_datetime,ti.planned_datetime)<now()),
    'average_completion_delay',round(avg(greatest(coalesce(ti.delay_minutes,0),0)) filter(where ti.status='completed' and ti.actual_datetime>=v_start and ti.actual_datetime<v_end),1),
    'checklist_completion',case when v_check_total=0 then null else round(100.0*v_check_done/v_check_total,1) end
  ) into v_metrics from task_instances ti where task_in_reporting_scope(v_actor,ti,c);

  v_metrics:=v_metrics||jsonb_build_object(
    'active_fms_stages',(select count(*) from fms_instance_stages fis where fis.status in ('in_progress','in_review','blocked','overdue') and fms_stage_in_reporting_scope(v_actor,fis.id,c)),
    'completed_fms_stages',(select count(*) from fms_instance_stages fis where fis.actual_datetime>=v_start and fis.actual_datetime<v_end and fis.status='completed' and fms_stage_in_reporting_scope(v_actor,fis.id,c)),
    'fms_sla_breaches',(select count(*) from fms_instance_stages fis where (fis.sla_breached or fis.delay_minutes>0) and coalesce(fis.actual_datetime,fis.planned_datetime)>=v_start and coalesce(fis.actual_datetime,fis.planned_datetime)<v_end and fms_stage_in_reporting_scope(v_actor,fis.id,c)),
    'forms_submitted',(select count(*) from form_submissions fs where fs.tenant_id=v_actor.tenant_id and fs.submitted_at>=v_start and fs.submitted_at<v_end and (v_actor.user_role in ('super_admin','admin') or v_actor.user_role='manager' and fs.branch_id=v_actor.branch_id or fs.submitted_by=v_actor.id)),
    'forms_awaiting_submission',(select count(*) from task_instances ti where ti.requires_form and ti.form_template_id is not null and ti.status not in ('completed','rejected') and task_in_reporting_scope(v_actor,ti,c) and not exists(select 1 from form_submissions fs where fs.linked_module='task' and fs.linked_record_id=ti.id and fs.form_template_id=ti.form_template_id)),
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
    from task_instances ti where ti.status='completed' and ti.actual_datetime>=v_start and ti.actual_datetime<v_end and task_in_reporting_scope(v_actor,ti,c)
    group by 1 order by 1
  ) q;
  select coalesce(jsonb_object_agg(q.status,q.count),'{}'::jsonb) into v_status from (select ti.status::text status,count(*)::integer count from task_instances ti where ti.planned_datetime>=v_start and ti.planned_datetime<v_end and task_in_reporting_scope(v_actor,ti,c) group by ti.status) q;
  select jsonb_build_object('tasks_assigned',q.assigned,'tasks_completed',q.completed,
    'task_pending_score',case when q.assigned=0 then null else round(100.0*q.cohort_completed/q.assigned-100,1) end,
    'task_delayed_score',case when q.assigned=0 then null when q.cohort_completed=0 then -100.0 else round(100.0*q.cohort_on_time/q.cohort_completed-100,1) end)
  into v_previous from (
    select count(*) filter(where ti.planned_datetime>=v_prev_start and ti.planned_datetime<v_start) assigned,
      count(*) filter(where ti.status='completed' and ti.actual_datetime>=v_prev_start and ti.actual_datetime<v_start) completed,
      count(*) filter(where ti.planned_datetime>=v_prev_start and ti.planned_datetime<v_start and ti.status='completed') cohort_completed,
      count(*) filter(where ti.planned_datetime>=v_prev_start and ti.planned_datetime<v_start and ti.status='completed' and ti.actual_datetime<=task_effective_due_datetime(ti)) cohort_on_time
    from task_instances ti where task_in_reporting_scope(v_actor,ti,c)
  ) q;
  return jsonb_build_object('generated_at',now(),'freshness','live','context',c,'metrics',v_metrics,'previous',v_previous,'task_completion_trend',v_trend,'task_status_distribution',v_status);
end $$;

revoke all on function public.get_dashboard_metrics(jsonb) from public,anon;
grant execute on function public.get_dashboard_metrics(jsonb) to authenticated;

notify pgrst,'reload schema';
