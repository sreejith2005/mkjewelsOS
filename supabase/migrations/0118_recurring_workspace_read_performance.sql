-- Recurring workspace: aggregate all task details in set-based passes.
-- The former implementation executed five correlated subqueries per
-- occurrence. With thousands of scheduled occurrences, that exceeded the
-- hosted statement timeout before the workspace could render.

set search_path = public, extensions;

create or replace function public.get_recurring_todo_workspace(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
  from public.task_templates t
  where t.tenant_id = v_actor.tenant_id and t.task_type in ('checklist','delegation')
    and t.recurrence_rule is not null
    and (v_search = '' or lower(t.title||' '||coalesce(t.description,'')) like '%'||v_search||'%')
    and (v_branch is null or t.branch_id = v_branch)
    and (v_department is null or t.department_id = v_department)
    and (v_priority is null or t.priority::text = v_priority)
    and (v_kind is null or t.schedule_kind = v_kind);

  with visible as materialized (
    select ti.* from public.task_instances ti
    where ti.tenant_id = v_actor.tenant_id and ti.task_template_id is not null
      and ti.planned_datetime >= v_from_at and ti.planned_datetime < v_to_at
      and (v_search = '' or lower(ti.title||' '||coalesce(ti.description,'')) like '%'||v_search||'%')
      and (v_branch is null or ti.branch_id = v_branch)
      and (v_department is null or ti.department_id = v_department)
      and (v_priority is null or ti.priority::text = v_priority)
      and (v_status is null or ti.status::text = v_status)
      and (v_kind is null or exists(select 1 from public.task_templates t where t.id = ti.task_template_id and t.schedule_kind = v_kind))
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
    select v.id as task_instance_id, true as has_form_submission from visible v join public.form_submissions s on s.linked_record_id = v.id and v.form_template_id is not null and s.form_template_id = v.form_template_id group by v.id
  ), followups as (
    select f.task_instance_id, coalesce(jsonb_agg(jsonb_build_object('id',f.id,'comment',f.comment,'created_at',f.created_at,'author',u.employee_name) order by f.created_at desc),'[]'::jsonb) as rows
    from public.task_comments f join visible v on v.id = f.task_instance_id join public.user_profiles u on u.id = f.user_profile_id group by f.task_instance_id
  )
  select coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object('assignees',coalesce(a.rows,'[]'::jsonb),'checklist',coalesce(c.rows,'[]'::jsonb),'has_attachment',coalesce(ta.has_attachment,false),'has_form_submission',coalesce(s.has_form_submission,false),'followups',coalesce(f.rows,'[]'::jsonb)) order by public.task_effective_due_datetime(v)),'[]'::jsonb) into v_instances
  from visible v left join assignees a on a.task_instance_id = v.id left join checklists c on c.task_instance_id = v.id left join attachments ta on ta.task_instance_id = v.id left join submissions s on s.task_instance_id = v.id left join followups f on f.task_instance_id = v.id;

  select jsonb_build_object('total',count(*),'pending',count(*) filter(where status='pending'),'in_progress',count(*) filter(where status='in_progress'),'completed',count(*) filter(where status='completed'),'rejected',count(*) filter(where status='rejected'),'overdue',count(*) filter(where status not in ('completed','rejected') and public.task_effective_due_datetime(ti) < now()),'on_time',count(*) filter(where on_time_status='on_time'),'delayed',count(*) filter(where on_time_status='delayed'),'completed_on_behalf',count(*) filter(where completion_mode='on_behalf'),'coverage_required',count(*) filter(where coverage_status='coverage_required'),'manager_review',count(*) filter(where coverage_status='manager_review')) into v_stats
  from public.task_instances ti
  where ti.tenant_id = v_actor.tenant_id and ti.task_template_id is not null and ti.planned_datetime >= v_from_at and ti.planned_datetime < v_to_at
    and (v_branch is null or ti.branch_id = v_branch) and (v_department is null or ti.department_id = v_department) and (v_priority is null or ti.priority::text = v_priority);

  return jsonb_build_object('filters',jsonb_build_object('date_from',v_from,'date_to',v_to),'templates',v_templates,'instances',v_instances,'stats',v_stats);
end;
$$;

revoke all on function public.get_recurring_todo_workspace(jsonb) from public,anon;
grant execute on function public.get_recurring_todo_workspace(jsonb) to authenticated;
notify pgrst, 'reload schema';
