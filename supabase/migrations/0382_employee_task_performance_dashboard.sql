-- 0382: Employee Task Performance dashboard (owner request 2026-11-05).
--
-- The Dashboard opens on employee task performance instead of the broad management-insights
-- summary. Before this migration three readers counted "employee task performance" three
-- different ways:
--   * Task Control (get_employee_task_progress, 0210): Tasks-section work only, cohort by
--     planned date, "completed" only when completed inside the period (so assigned did not
--     equal completed + remaining), rejected work counted as remaining.
--   * Reports > Employee Task Performance (0370): tasks and FMS steps due in the period.
--   * Management insights (0206/0296): a third cohort over JSON rows.
-- This migration adds ONE canonical, assignment-level row source and points the Dashboard,
-- Task Control's employee progress and the Employee Task Performance report at it, so the same
-- employee, scope and cohort show the same counts and therefore the same scores everywhere.
--
-- Canonical rules (docs/REPORTS.md "Employee task performance"):
--   * One row = one active doer on one work item (a shared task counts once per person).
--     Work items: task occurrences (one-time, recurring, CRM) and FMS person-step visits
--     (form, task, approval). End/branch/notification/parallel nodes are never work. FMS start
--     forms are standing assignments with no occurrence history, so they are reported as a
--     current count beside the score, never inside it.
--   * Cohort: the effective deadline falls in the period. Tasks:
--     coalesce(revised, due, planned) -- task_effective_due_datetime(), written inline so the
--     existing index on that expression is used. FMS: the visit's planned_datetime.
--   * Every cohort row lands in exactly one bucket:
--       on_time | late | completed_untimed | in_progress | pending | overdue | excluded
--     excluded = rejected tasks/steps, skipped or stopped FMS visits, open steps of a cancelled
--     run. Excluded rows are counted and shown, never scored.
--   * Scores are NOT computed here: @jewelos/core taskPendingScore / taskDelayedScore are the
--     one formula (docs/superpowers/specs/2026-09-18-task-performance-score-design.md).
--
-- Authorization: every caller is authenticated, inside the Dashboard section, and sees only
-- their own work unless the new action permission dashboard.view_team_performance is granted
-- (default Super Admin and Admin; grant it to named managers/directors in Permissions). The
-- canonical row source is SECURITY DEFINER and executable by no client role.
--
-- Nothing here writes, rewrites deadlines, or changes scheduling, completion or FMS behaviour.
set search_path=public,extensions;

-- permission-catalog:begin
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values
('dashboard.view_team_performance', 'action', null, '{super_admin,admin}', 25);
-- permission-catalog:end

-- FMS visits are found by deadline. Tasks already have idx_tasks_live_tenant_deadline (0208)
-- on (tenant_id, coalesce(revised,due,planned), id) where deleted_at is null, and
-- idx_task_instances_effective_due (0100) for open work.
create index if not exists fms_instance_stages_performance_due on fms_instance_stages(planned_datetime) where planned_datetime is not null;

-- ---------------------------------------------------------------------------------------------
-- 1. The canonical row source
-- ---------------------------------------------------------------------------------------------
-- p_start null = no lower bound. p_open_only restricts to open work (the current backlog read).
-- Person filters apply to the assignee's current profile: performance is credited to people.
--
-- A plain SQL function on purpose: with no SECURITY DEFINER and no SET clause Postgres inlines
-- it into each caller, so a count reads only the columns it needs and the optional filters fold
-- into index conditions (the PL/pgSQL version materialised every column of every row first).
-- Table names are schema-qualified, so the body does not depend on the caller's search_path.
-- It is not executable by any client role: only the SECURITY DEFINER readers below call it,
-- and they have already authorized the actor and fixed the tenant and person scope. Callers
-- validate p_kind; an unknown kind matches nothing.
create function performance_work_rows_v1(p_tenant uuid,p_start timestamptz,p_end timestamptz,
  p_branch uuid default null,p_department uuid default null,p_user uuid default null,p_flow uuid default null,
  p_kind text default 'all',p_open_only boolean default false)
returns table(person_id uuid,work_kind text,work_id uuid,task_id uuid,instance_id uuid,flow_family_id uuid,flow_name text,
  stage_key text,stage_name text,stage_order integer,reference_number text,title text,raw_status text,due timestamptz,done_at timestamptz,
  activated_at timestamptz,excluded_reason text,bucket text)
language sql stable as $$
  select w.person,w.kind,w.wid,w.tid,w.iid,w.fam,w.fname,w.skey,w.sname,w.sorder,w.ref,w.ttl,w.st,w.due_at,w.done,w.act,w.excl,
    case when w.excl is not null then 'excluded'
      when w.st='completed' then case when w.done is null then 'completed_untimed' when w.done<=w.due_at then 'on_time' else 'late' end
      when w.due_at<now() then 'overdue'
      when w.st in ('in_progress','in_review') then 'in_progress'
      else 'pending' end
  from (
    select a.user_profile_id person,
      case when t.task_type::text='fms' then 'fms_step' when t.source in ('crm','crm_walkin') then 'crm'
        when t.task_template_id is not null then 'recurring' else 'one_time' end kind,
      t.id wid,t.id tid,null::uuid iid,null::uuid fam,null::text fname,null::text skey,null::text sname,
      null::integer sorder,null::text ref,t.title ttl,t.status::text st,
      coalesce(t.revised_datetime,t.due_datetime,t.planned_datetime) due_at,t.actual_datetime done,null::timestamptz act,
      case when t.status::text='rejected' then 'rejected' end excl
    from public.task_instances t
    join public.task_assignees a on a.task_instance_id=t.id and a.is_active and (a.role_at_task='doer' or a.role_at_task is null)
    join public.user_profiles u on u.id=a.user_profile_id and u.tenant_id=p_tenant
    where t.tenant_id=p_tenant and t.deleted_at is null and p_flow is null
      and coalesce(t.revised_datetime,t.due_datetime,t.planned_datetime)>=coalesce(p_start,'-infinity'::timestamptz)
      and coalesce(t.revised_datetime,t.due_datetime,t.planned_datetime)<p_end
      and (not p_open_only or t.status not in ('completed','rejected'))
      and (p_kind='all'
        or p_kind='fms' and t.task_type::text='fms'
        or p_kind='tasks' and t.task_type::text<>'fms'
        or p_kind='crm' and t.task_type::text<>'fms' and t.source in ('crm','crm_walkin')
        or p_kind='recurring' and t.task_type::text<>'fms' and t.source not in ('crm','crm_walkin') and t.task_template_id is not null
        or p_kind='one_time' and t.task_type::text<>'fms' and t.source not in ('crm','crm_walkin') and t.task_template_id is null)
      and (p_branch is null or u.branch_id=p_branch) and (p_department is null or u.department_id=p_department)
      and (p_user is null or a.user_profile_id=p_user)
    union all
    select p.person,'fms_step',v.id,null::uuid,fi.id,fi.flow_family_id,ff.name,st.stage_key,st.name,st.sort_order,fi.reference_number,
      concat(ff.name,' · ',st.name),v.status::text,v.planned_datetime,v.actual_datetime,coalesce(v.activated_at,v.created_at),
      case when v.outcome='condition_skipped' then 'skipped' when v.outcome='workflow_closed' then 'stopped'
        when v.status::text='rejected' then 'rejected' when fi.status::text='cancelled' and v.status::text<>'completed' then 'cancelled_run' end
    from public.fms_instance_stages v
    join public.fms_instances fi on fi.id=v.fms_instance_id
    join public.fms_flows ff on ff.id=fi.fms_flow_id
    join public.fms_stages st on st.id=v.fms_stage_id
    cross join lateral (select distinct x person from unnest(v.assigned_to) x where x is not null) p
    join public.user_profiles u on u.id=p.person and u.tenant_id=p_tenant
    where fi.tenant_id=p_tenant and p_kind in ('all','fms')
      and st.step_type in ('task','approval','form')
      and v.planned_datetime>=coalesce(p_start,'-infinity'::timestamptz) and v.planned_datetime<p_end
      and (not p_open_only or v.status in ('pending','in_progress','in_review','overdue','blocked') and fi.status::text<>'cancelled'
        and coalesce(v.outcome,'') not in ('condition_skipped','workflow_closed'))
      and (p_flow is null or fi.flow_family_id=p_flow)
      and (p_branch is null or u.branch_id=p_branch) and (p_department is null or u.department_id=p_department)
      and (p_user is null or p.person=p_user)
  ) w
$$;

revoke all on function performance_work_rows_v1(uuid,timestamptz,timestamptz,uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Dashboard scope: validated filters and the one authorization decision
-- ---------------------------------------------------------------------------------------------
create function task_performance_context_v1(p_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles; c jsonb:=coalesce(p_context,'{}'::jsonb); tz text; v_scope text; v_from date; v_to date; v_branch uuid; v_dept uuid;
  v_user uuid; v_flow uuid; v_kind text; v_gran text; v_team boolean;
begin
  perform assert_module_access('dashboard');
  a:=assert_reporting_actor();
  perform assert_json_keys(c,array['scope','from','to','branch_id','department_id','user_profile_id','flow_id','kind','granularity'],'performance filter');
  select coalesce(t.timezone,'Asia/Kolkata') into tz from tenants t where t.id=a.tenant_id and t.is_active;
  if tz is null then raise exception 'Active tenant required' using errcode='42501'; end if;
  v_scope:=coalesce(nullif(c->>'scope',''),'me');
  if v_scope not in ('me','team') then raise exception 'Performance scope is invalid' using errcode='22023'; end if;
  v_team:=has_permission('dashboard.view_team_performance');
  if v_scope='team' and not v_team then raise exception 'Team performance is not authorized' using errcode='42501'; end if;
  begin
    v_from:=coalesce(nullif(c->>'from','')::date,(now() at time zone tz)::date);
    v_to:=coalesce(nullif(c->>'to','')::date,v_from);
    v_branch:=nullif(c->>'branch_id','')::uuid; v_dept:=nullif(c->>'department_id','')::uuid;
    v_user:=nullif(c->>'user_profile_id','')::uuid; v_flow:=nullif(c->>'flow_id','')::uuid;
  exception when others then raise exception 'Performance filter is invalid' using errcode='22023'; end;
  if v_to<v_from or v_to-v_from>365 then raise exception 'Choose 1 to 366 days' using errcode='22023'; end if;
  v_kind:=coalesce(nullif(c->>'kind',''),'all');
  if v_kind not in ('all','one_time','recurring','crm','fms') then raise exception 'Task source is invalid' using errcode='22023'; end if;
  v_gran:=coalesce(nullif(c->>'granularity',''),case when v_to-v_from<=31 then 'day' when v_to-v_from<=184 then 'week' else 'month' end);
  if v_gran not in ('day','week','month') then raise exception 'Trend interval is invalid' using errcode='22023'; end if;
  if v_scope='me' then
    -- Personal scope is the caller's own work; no other person, branch or department.
    if v_branch is not null or v_dept is not null or (v_user is not null and v_user<>a.id) then
      raise exception 'Personal performance shows your own work only' using errcode='42501'; end if;
    v_user:=a.id;
  else
    if v_branch is not null and not exists(select 1 from branches b where b.id=v_branch and b.tenant_id=a.tenant_id) then
      raise exception 'Branch filter denied' using errcode='42501'; end if;
    if v_dept is not null and not exists(select 1 from departments d where d.id=v_dept and d.tenant_id=a.tenant_id) then
      raise exception 'Department filter denied' using errcode='42501'; end if;
    if v_user is not null and not exists(select 1 from user_profiles u where u.id=v_user and u.tenant_id=a.tenant_id) then
      raise exception 'Employee filter denied' using errcode='42501'; end if;
  end if;
  if v_flow is not null and not exists(select 1 from fms_flows f where f.family_id=v_flow and f.tenant_id=a.tenant_id) then
    raise exception 'Workflow filter denied' using errcode='42501'; end if;
  return jsonb_build_object('tenant_id',a.tenant_id,'actor_id',a.id,'scope',v_scope,'can_team',v_team,'timezone',tz,
    'from',v_from,'to',v_to,'start_at',(v_from::timestamp at time zone tz),'end_at',((v_to+1)::timestamp at time zone tz),
    'branch_id',v_branch,'department_id',v_dept,'user_profile_id',v_user,'flow_id',v_flow,'kind',v_kind,'granularity',v_gran);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. The Dashboard summary: one set-based pass, aggregates only
-- ---------------------------------------------------------------------------------------------
create function get_task_performance_dashboard_v1(p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public set plan_cache_mode=force_custom_plan as $$
declare c jsonb; v_tenant uuid; s timestamptz; e timestamptz; v_branch uuid; v_dept uuid; v_user uuid; v_flow uuid; v_kind text;
  v_gran text; tz text; v_team boolean; v_result jsonb; v_backlog jsonb; v_starters integer;
begin
  c:=task_performance_context_v1(p_context);
  v_tenant:=(c->>'tenant_id')::uuid; s:=(c->>'start_at')::timestamptz; e:=(c->>'end_at')::timestamptz; tz:=c->>'timezone';
  v_branch:=(c->>'branch_id')::uuid; v_dept:=(c->>'department_id')::uuid; v_user:=(c->>'user_profile_id')::uuid;
  v_flow:=(c->>'flow_id')::uuid; v_kind:=c->>'kind'; v_gran:=c->>'granularity'; v_team:=c->>'scope'='team';

  with r as materialized (
    select person_id,work_kind,work_id,flow_family_id,due,excluded_reason,bucket
    from performance_work_rows_v1(v_tenant,s,e,v_branch,v_dept,v_user,v_flow,v_kind,false)
  ), ok as materialized (select * from r where bucket<>'excluded'),
  counts as (
    select person_id,count(*)::int assigned,
      count(*) filter(where bucket='on_time')::int on_time,count(*) filter(where bucket='late')::int late,
      count(*) filter(where bucket='completed_untimed')::int completed_untimed,count(*) filter(where bucket='pending')::int pending,
      count(*) filter(where bucket='in_progress')::int in_progress,count(*) filter(where bucket='overdue')::int overdue
    from ok group by person_id
  ), people as (
    -- Team scope lists every active employee in the filters, with or without work, plus anyone
    -- (for example a since-resigned employee) who holds work in the cohort.
    select u.id user_profile_id,u.employee_name,u.branch_id,b.name branch_name,u.department_id,d.name department_name,
      (u.working_status not in ('inactive','resigned') and u.is_login_enabled) active,
      coalesce(k.assigned,0) assigned,coalesce(k.on_time,0) on_time,coalesce(k.late,0) late,coalesce(k.completed_untimed,0) completed_untimed,
      coalesce(k.pending,0) pending,coalesce(k.in_progress,0) in_progress,coalesce(k.overdue,0) overdue
    from user_profiles u
    left join counts k on k.person_id=u.id
    left join branches b on b.id=u.branch_id left join departments d on d.id=u.department_id
    where u.tenant_id=v_tenant and (k.person_id is not null or (u.working_status not in ('inactive','resigned') and u.is_login_enabled and u.account_status='active'))
      and (v_branch is null or u.branch_id=v_branch) and (v_dept is null or u.department_id=v_dept) and (v_user is null or u.id=v_user)
  ), families as (
    -- Every configured workflow (a published, active version) appears, with or without work.
    select distinct on (f.family_id) f.family_id,f.name from fms_flows f
    where f.tenant_id=v_tenant and (v_flow is null or f.family_id=v_flow)
      and (f.status='published' and coalesce(f.is_active,true) or exists(select 1 from ok where ok.flow_family_id=f.family_id))
    order by f.family_id,(f.status='published' and coalesce(f.is_active,true)) desc,f.version desc
  ), flows as (
    select fa.family_id flow_id,fa.name flow_name,count(o.work_id)::int assigned,count(distinct o.work_id)::int visits,
      count(o.work_id) filter(where o.bucket='on_time')::int on_time,count(o.work_id) filter(where o.bucket='late')::int late,
      count(o.work_id) filter(where o.bucket='completed_untimed')::int completed_untimed,count(o.work_id) filter(where o.bucket='pending')::int pending,
      count(o.work_id) filter(where o.bucket='in_progress')::int in_progress,count(o.work_id) filter(where o.bucket='overdue')::int overdue
    from families fa left join ok o on o.flow_family_id=fa.family_id
    where c->>'scope'='team' or o.work_id is not null
    group by fa.family_id,fa.name
  ), trend as (
    select date_trunc(v_gran,(due at time zone tz))::date bucket_start,count(*)::int due,
      count(*) filter(where bucket='on_time')::int on_time,count(*) filter(where bucket='late')::int late,
      count(*) filter(where bucket='completed_untimed')::int completed_untimed,
      count(*) filter(where bucket in ('pending','in_progress','overdue'))::int remaining
    from ok group by 1
  ), kinds as (
    select work_kind,count(*)::int assigned,count(*) filter(where bucket in ('on_time','late','completed_untimed'))::int completed,
      count(*) filter(where bucket='on_time')::int on_time,count(*) filter(where bucket='overdue')::int overdue
    from ok group by work_kind
  ), rollup_branch as (
    select p.branch_id id,coalesce(p.branch_name,'No branch') name,sum(p.assigned)::int assigned,sum(p.on_time)::int on_time,sum(p.late)::int late,
      sum(p.completed_untimed)::int completed_untimed,sum(p.pending)::int pending,sum(p.in_progress)::int in_progress,sum(p.overdue)::int overdue
    from people p group by 1,2
  ), rollup_dept as (
    select p.department_id id,coalesce(p.department_name,'No department') name,sum(p.assigned)::int assigned,sum(p.on_time)::int on_time,sum(p.late)::int late,
      sum(p.completed_untimed)::int completed_untimed,sum(p.pending)::int pending,sum(p.in_progress)::int in_progress,sum(p.overdue)::int overdue
    from people p group by 1,2
  )
  select jsonb_build_object(
    'summary',(select jsonb_build_object(
        'assigned',count(*) filter(where bucket<>'excluded'),
        'on_time',count(*) filter(where bucket='on_time'),'late',count(*) filter(where bucket='late'),
        'completed_untimed',count(*) filter(where bucket='completed_untimed'),'pending',count(*) filter(where bucket='pending'),
        'in_progress',count(*) filter(where bucket='in_progress'),'overdue',count(*) filter(where bucket='overdue'),
        'excluded',count(*) filter(where bucket='excluded'),
        'excluded_rejected',count(*) filter(where excluded_reason='rejected'),'excluded_skipped',count(*) filter(where excluded_reason='skipped'),
        'excluded_stopped',count(*) filter(where excluded_reason='stopped'),'excluded_cancelled_run',count(*) filter(where excluded_reason='cancelled_run'),
        'work_items',count(distinct work_id) filter(where bucket<>'excluded')) from r),
    'employees',coalesce((select jsonb_agg(to_jsonb(p) order by p.overdue desc,(p.pending+p.in_progress+p.overdue) desc,p.employee_name) from people p),'[]'::jsonb),
    'flows',coalesce((select jsonb_agg(to_jsonb(f) order by f.overdue desc,(f.pending+f.in_progress+f.overdue) desc,f.flow_name) from flows f),'[]'::jsonb),
    'trend',coalesce((select jsonb_agg(to_jsonb(t) order by t.bucket_start) from trend t),'[]'::jsonb),
    'kinds',coalesce((select jsonb_agg(to_jsonb(k) order by k.work_kind) from kinds k),'[]'::jsonb),
    'branches',case when v_team then coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from rollup_branch x where x.assigned>0),'[]'::jsonb) else '[]'::jsonb end,
    'departments',case when v_team then coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from rollup_dept x where x.assigned>0),'[]'::jsonb) else '[]'::jsonb end
  ) into v_result;

  -- Current backlog: open work whose deadline passed BEFORE the period began. Reported beside
  -- the cohort, never added to it.
  select jsonb_build_object('overdue_before_period',count(*),'people',count(distinct person_id)) into v_backlog
  from performance_work_rows_v1(v_tenant,null,s,v_branch,v_dept,v_user,v_flow,v_kind,true) where bucket='overdue';

  -- FMS start forms: standing assignments, current count only.
  select count(*) into v_starters from fms_starter_assignments sa join user_profiles u on u.id=sa.user_profile_id
  join fms_flows f on f.id=sa.fms_flow_id
  where sa.tenant_id=v_tenant and sa.status='pending' and f.status='published' and coalesce(f.is_active,true)
    and v_kind in ('all','fms') and (v_flow is null or f.family_id=v_flow)
    and (v_branch is null or u.branch_id=v_branch) and (v_dept is null or u.department_id=v_dept) and (v_user is null or u.id=v_user);

  return v_result||jsonb_build_object('version',1,'generatedAt',now(),'timezone',tz,'scope',c->>'scope','canTeam',(c->>'can_team')::boolean,
    'from',c->>'from','to',c->>'to','granularity',v_gran,'backlog',v_backlog,'pendingStartForms',v_starters);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Drilldown: the same rows as the counts, filtered to one bucket, paginated
-- ---------------------------------------------------------------------------------------------
-- p_bucket: assigned | completed | on_time | late | completed_untimed | remaining | pending |
--           in_progress | overdue | excluded | backlog
create function get_task_performance_records_v1(p_context jsonb,p_bucket text,p_stage_key text default null,p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path=public set plan_cache_mode=force_custom_plan as $$
declare c jsonb; v_tenant uuid; s timestamptz; e timestamptz; v_result jsonb;
begin
  c:=task_performance_context_v1(p_context);
  if p_bucket is null or p_bucket not in ('assigned','completed','on_time','late','completed_untimed','remaining','pending','in_progress','overdue','excluded','backlog') then
    raise exception 'Record selector is invalid' using errcode='22023'; end if;
  if p_offset is null or p_limit is null or p_offset<0 or p_limit not between 1 and 100 then raise exception 'Invalid pagination' using errcode='22023'; end if;
  if p_stage_key is not null and p_stage_key !~ '^[A-Za-z0-9_:-]{1,100}$' then raise exception 'Invalid stage filter' using errcode='22023'; end if;
  v_tenant:=(c->>'tenant_id')::uuid; s:=(c->>'start_at')::timestamptz; e:=(c->>'end_at')::timestamptz;
  with r as materialized (
    select x.person_id,x.work_kind,x.work_id,x.task_id,x.instance_id,x.raw_status,x.due,x.done_at,x.excluded_reason,x.bucket
    from performance_work_rows_v1(v_tenant,case when p_bucket='backlog' then null else s end,case when p_bucket='backlog' then s else e end,
      (c->>'branch_id')::uuid,(c->>'department_id')::uuid,(c->>'user_profile_id')::uuid,(c->>'flow_id')::uuid,c->>'kind',p_bucket='backlog') x
    where (p_stage_key is null or x.stage_key=p_stage_key)
      and case p_bucket
        when 'assigned' then x.bucket<>'excluded'
        when 'completed' then x.bucket in ('on_time','late','completed_untimed')
        when 'remaining' then x.bucket in ('pending','in_progress','overdue')
        when 'backlog' then x.bucket='overdue'
        else x.bucket=p_bucket end
  ), page as (
    select * from r order by (bucket='overdue') desc,case when bucket='overdue' then due end asc,due desc,work_id,person_id
    offset p_offset limit p_limit
  ), described as (
    -- Names and titles for the page only. FMS rows show workflow, stage and reference, never
    -- the run's free-text title (it can hold a customer name).
    select p.*,u.employee_name,coalesce(t.title,concat(ff.name,' · ',st.name)) title,fi.reference_number,ff.name flow_name,st.name stage_name
    from page p
    left join user_profiles u on u.id=p.person_id
    left join task_instances t on t.id=p.task_id
    left join fms_instance_stages v on p.work_kind='fms_step' and p.instance_id is not null and v.id=p.work_id
    left join fms_instances fi on fi.id=v.fms_instance_id
    left join fms_flows ff on ff.id=fi.fms_flow_id
    left join fms_stages st on st.id=v.fms_stage_id
  )
  select jsonb_build_object('total',(select count(*) from r),'offset',p_offset,'limit',p_limit,
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'work_id',d.work_id,'person_id',d.person_id,'employee_name',d.employee_name,'work_kind',d.work_kind,'title',d.title,
      'task_id',d.task_id,'instance_id',d.instance_id,'stage_id',case when d.work_kind='fms_step' and d.instance_id is not null then d.work_id end,
      'reference_number',d.reference_number,'flow_name',d.flow_name,'stage_name',d.stage_name,'status',d.raw_status,'bucket',d.bucket,
      'excluded_reason',d.excluded_reason,'due',d.due,'done_at',d.done_at,
      'overdue_minutes',case when d.bucket='overdue' then floor(extract(epoch from now()-d.due)/60)::int end,
      'delay_minutes',case when d.bucket='late' then floor(extract(epoch from d.done_at-d.due)/60)::int end)
      order by (d.bucket='overdue') desc,case when d.bucket='overdue' then d.due end asc,d.due desc,d.work_id,d.person_id)
      from described d),'[]'::jsonb)) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. FMS stage-wise performance for one workflow
-- ---------------------------------------------------------------------------------------------
create function get_task_performance_fms_stages_v1(p_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=public set plan_cache_mode=force_custom_plan as $$
declare c jsonb; v_result jsonb;
begin
  c:=task_performance_context_v1(p_context);
  if c->>'flow_id' is null then raise exception 'Choose a workflow' using errcode='22023'; end if;
  with r as materialized (
    select person_id,work_id,stage_key,stage_name,stage_order,activated_at,done_at,bucket
    from performance_work_rows_v1((c->>'tenant_id')::uuid,(c->>'start_at')::timestamptz,(c->>'end_at')::timestamptz,
      (c->>'branch_id')::uuid,(c->>'department_id')::uuid,(c->>'user_profile_id')::uuid,(c->>'flow_id')::uuid,'fms',false) where bucket<>'excluded'
  ), visits as (
    -- Durations are per stage visit (activation to completion), not per person.
    select distinct on (work_id) work_id,stage_key,activated_at,done_at,bucket from r order by work_id
  ), durations as (
    select stage_key,
      round((percentile_cont(0.5) within group (order by extract(epoch from done_at-activated_at)/3600))::numeric,1) median_hours,
      round(avg(extract(epoch from done_at-activated_at)/3600)::numeric,1) average_hours
    from visits where done_at is not null and activated_at is not null and done_at>=activated_at group by stage_key
  ), people as (
    select stage_key,person_id,count(*)::int assigned,count(*) filter(where bucket in ('on_time','late','completed_untimed'))::int completed,
      count(*) filter(where bucket='late')::int late,count(*) filter(where bucket='overdue')::int overdue,
      count(*) filter(where bucket in ('pending','in_progress','overdue'))::int remaining
    from r group by stage_key,person_id
  ), stages as (
    select r.stage_key,(array_agg(r.stage_name order by r.activated_at desc))[1] stage_name,min(r.stage_order) stage_order,
      count(distinct r.work_id)::int visits,count(*)::int assigned,
      count(*) filter(where bucket='on_time')::int on_time,count(*) filter(where bucket='late')::int late,
      count(*) filter(where bucket='completed_untimed')::int completed_untimed,count(*) filter(where bucket='pending')::int pending,
      count(*) filter(where bucket='in_progress')::int in_progress,count(*) filter(where bucket='overdue')::int overdue
    from r group by r.stage_key
  )
  select jsonb_build_object('flow_id',c->>'flow_id','stages',coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object(
      'median_hours',d.median_hours,'average_hours',d.average_hours,
      'people',coalesce((select jsonb_agg(jsonb_build_object('user_profile_id',p.person_id,'employee_name',u.employee_name,'assigned',p.assigned,
          'completed',p.completed,'late',p.late,'overdue',p.overdue,'remaining',p.remaining) order by p.overdue desc,p.remaining desc,u.employee_name)
        from people p join user_profiles u on u.id=p.person_id where p.stage_key=s.stage_key),'[]'::jsonb))
    order by s.stage_order nulls last,s.stage_name),'[]'::jsonb)) into v_result
  from stages s left join durations d on d.stage_key=s.stage_key;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Filter choices (names only). Team lists only with the team permission.
-- ---------------------------------------------------------------------------------------------
create function get_task_performance_options_v1()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles; v_team boolean;
begin
  perform assert_module_access('dashboard');
  a:=assert_reporting_actor();
  v_team:=has_permission('dashboard.view_team_performance');
  return jsonb_build_object('canTeam',v_team,'me',jsonb_build_object('id',a.id,'name',a.employee_name),
    'branches',case when v_team then coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name) from branches b where b.tenant_id=a.tenant_id and b.is_active),'[]'::jsonb) else '[]'::jsonb end,
    'departments',case when v_team then coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'branch_id',d.branch_id) order by d.name) from departments d where d.tenant_id=a.tenant_id and d.is_active),'[]'::jsonb) else '[]'::jsonb end,
    'employees',case when v_team then coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name,'branch_id',u.branch_id,'department_id',u.department_id) order by u.employee_name)
      from user_profiles u where u.tenant_id=a.tenant_id and u.working_status not in ('inactive','resigned') and u.is_login_enabled and u.account_status='active'),'[]'::jsonb) else '[]'::jsonb end,
    'flows',coalesce((select jsonb_agg(jsonb_build_object('id',x.family_id,'name',x.name) order by x.name) from (
      select distinct on (f.family_id) f.family_id,f.name from fms_flows f where f.tenant_id=a.tenant_id and f.status in ('published','archived')
      order by f.family_id,(f.status='published') desc,f.version desc) x),'[]'::jsonb));
end $$;

revoke all on function task_performance_context_v1(jsonb) from public,anon,authenticated;
revoke all on function get_task_performance_dashboard_v1(jsonb),get_task_performance_records_v1(jsonb,text,text,integer,integer),
  get_task_performance_fms_stages_v1(jsonb),get_task_performance_options_v1() from public,anon;
grant execute on function get_task_performance_dashboard_v1(jsonb),get_task_performance_records_v1(jsonb,text,text,integer,integer),
  get_task_performance_fms_stages_v1(jsonb),get_task_performance_options_v1() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. Task Control employee progress reads the canonical rows
-- ---------------------------------------------------------------------------------------------
-- Authorization, inputs and the response shape are unchanged (0210). What changes, so Task
-- Control and the Dashboard agree for the same person, scope and period:
--   * FMS person steps count, as Task Control's own task list has shown them since 0285;
--   * the period is the effective deadline (revised > due > planned), not the planned date;
--   * completed = completed now (assigned = completed + remaining always holds);
--   * rejected work, skipped/stopped FMS visits and open steps of cancelled runs are excluded.
CREATE OR REPLACE FUNCTION public.get_employee_task_progress(p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
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
   select r.person_id user_profile_id,r.bucket,u.employee_name,u.branch_id,u.department_id,b.name branch_name,d.name department_name
   from performance_work_rows_v1(v_actor.tenant_id,(v_from::timestamp at time zone 'Asia/Kolkata'),((v_to+1)::timestamp at time zone 'Asia/Kolkata'),
     v_branch,v_department,v_user,null,'all',false) r
   join user_profiles u on u.id=r.person_id
   join branches b on b.id=u.branch_id
   left join departments d on d.id=u.department_id
   where r.bucket<>'excluded' and u.account_status='active' and u.is_login_enabled
 ), employees as (
   select user_profile_id,employee_name,branch_id,branch_name,department_id,department_name,
     count(*)::int assigned,
     (count(*) filter(where bucket in ('on_time','late','completed_untimed')))::int completed,
     (count(*) filter(where bucket='on_time'))::int on_time_completed,
     (count(*) filter(where bucket in ('pending','in_progress','overdue')))::int remaining,
     (count(*) filter(where bucket='overdue'))::int overdue
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

revoke all on function public.get_employee_task_progress(jsonb) from public,anon;
grant execute on function public.get_employee_task_progress(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. Reports > Employee Task Performance reads the same rows
-- ---------------------------------------------------------------------------------------------
-- Only the report's row CTE changes; its access rules, people list, columns and summary are
-- untouched. The body is checked for the exact 0370 text so a drifted body stops the migration.
do $patch$
declare definition text; patched text; marker text;
begin
  definition:=replace(pg_get_functiondef('public.report_rows_for_profile(uuid,text,jsonb,integer,integer)'::regprocedure),E'\r\n',E'\n');
  marker:=$m$    with work as materialized (
      select ta.user_profile_id pid,ti.id wid,coalesce(ti.revised_datetime,ti.planned_datetime) due,ti.actual_datetime done_at,ti.status::text st
      from task_instances ti join task_assignees ta on ta.task_instance_id=ti.id and ta.is_active
      where v_kind in ('all','task') and ti.tenant_id=a.tenant_id and ti.deleted_at is null and ti.status::text<>'rejected'
        and coalesce(ti.revised_datetime,ti.planned_datetime)>=s and coalesce(ti.revised_datetime,ti.planned_datetime)<e
      union all
      select u,r.id,r.planned_datetime,r.actual_datetime,r.raw_status
      from report_fms_visit_rows(a,c-'user_profile_id',v_flow,v_stage,null,'planned') r cross join unnest(r.assigned_to) u
      where v_kind in ('all','fms') and r.status not in ('skipped','stopped') and r.raw_status<>'rejected' and r.planned_datetime is not null
    ), people as materialized ($m$;
  if position(marker in definition)=0 then raise exception 'report_rows_for_profile employee_task_performance marker changed; refusing to patch'; end if;
  patched:=replace(definition,marker,$r$    -- Canonical assignment rows (0382), shared with the Dashboard and Task Control.
    with work as materialized (
      select r.person_id pid,r.work_id wid,r.due,r.done_at,r.raw_status st
      from performance_work_rows_v1(a.tenant_id,s,e,null,null,null,v_flow,case v_kind when 'task' then 'tasks' else v_kind end,false) r
      where r.bucket<>'excluded'
    ), people as materialized ($r$);
  execute patched;
end $patch$;
