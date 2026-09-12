-- Recurring workspace: two small read fixes. NOT the cause of the reported
-- timeout — see "What this does not fix" below before assuming it is.
--
-- Reported 2026-09-12: Recurring / To-Do takes about a minute on the phone and
-- intermittently fails with
--   "Load recurring workspace: cancelling statement due to statement timeout".
--
-- MEASURED ON THE PRODUCTION DATABASE before writing this:
--
--   task_instances      5,672 rows      form_submissions      25 rows
--   task_assignees      5,672           task_checklists    1,304
--   task_templates      1,456           task_comments          0
--
--   get_recurring_todo_workspace('{}') as the real actor:  1,482 ms
--   response payload:                                     12,366 KB
--     instances 10,473 KB   templates 1,893 KB   stats 0 KB
--   statement_timeout for the authenticated role:              8 s
--
-- So the query is NOT slow: 1.5 s against an 8 s budget. The minute the user
-- sees is a **12 MB JSON document** being transferred to a phone and parsed by
-- Hermes, and that same payload is the obvious candidate for the 2026-09-11
-- memory-pressure ANR (Java heap pinned at 252/256 MB, RSS ~2 GB). The
-- intermittent timeout is that 1.5 s occasionally overrunning under load.
--
-- The two changes here are real but small, and are kept because they are
-- correct and because both costs grow while the workspace does not:
--
--   1. The `submissions` CTE joined `form_submissions` on `linked_record_id`
--      alone. The only covering index, `idx_form_submissions_task_completion`,
--      leads with `tenant_id`, so the planner could not use it and chose a
--      Seq Scan on form_submissions on every call. That table holds 25 rows
--      today, so this is currently worth nothing — but it grows with every
--      form anyone ever submits, and the workspace does not. The instance is
--      already tenant-scoped, so `s.tenant_id = v_actor.tenant_id` narrows
--      nothing semantically and lets the index do its job.
--
--   2. A partial index matching the predicate the range scan actually uses:
--      `(tenant_id, planned_datetime) where task_template_id is not null`.
--      The workspace only ever shows scheduled occurrences.
--
-- Behaviour is unchanged: same filters, same rows, same statistics, same JSON
-- shape, same access rule. Neither client changes. Equivalence was checked by
-- running this function and the 0118 one side by side over sixteen filter
-- combinations — default, wide and narrow windows, each search, status,
-- priority, branch, department and schedule_kind filter, and all at once —
-- comparing the entire JSONB result. All sixteen identical, including the
-- deliberate asymmetry where a search narrows `instances` while `stats.total`
-- stays at the unsearched count.
--
-- WHAT THIS DOES NOT FIX:
--
--   * The 12 MB payload, which is the actual problem. The function returns
--     every occurrence in the window with all of its children, plus all 1,456
--     templates, on every call, and `to_jsonb(v)` emits every column of
--     task_instances whether a client reads it or not. Cutting it means either
--     paginating or selecting columns, and `parseRecurringWorkspace` types the
--     rows as whole `Tables<"task_instances">` / `Tables<"task_templates">`
--     records, so either is a shared-contract change affecting web as well.
--     That needs agreement; it is deliberately not done here.
--
--   * A rejected optimisation, recorded so it is not retried: folding the
--     separate statistics scan into the `visible` scan looks obvious and is
--     wrong. The statistics aggregate measures 3 ms, and materialising the
--     wider set it would need made the function ~20%% SLOWER in a benchmark
--     (18.6 s vs 15.3 s on a synthetic 40,000-row tenant). Reverted.

set search_path = public, extensions;

-- The index the range scan actually wants (change 2 above).
create index if not exists idx_task_instances_recurring_window
  on public.task_instances (tenant_id, planned_datetime)
  where task_template_id is not null;

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
