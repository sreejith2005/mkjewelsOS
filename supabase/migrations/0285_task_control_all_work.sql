-- Task Control shows every kind of assigned work, not only Tasks-section rows.
--
-- get_task_evidence_workspace read task_instances alone, so a leader looking
-- at one employee saw their one-time, recurring and CRM walk-in tasks but none
-- of their FMS work: FMS steps live in fms_instance_stages and FMS start forms
-- in fms_starter_assignments (the same two sources v_task_feed_scope already
-- unions into the employee's own feed).
--
-- 1. The scope now unions those two FMS sources. Their rows carry
--    task_type 'fms', which the bulk-delete preparation already skips, and no
--    evidence (FMS evidence stays on the FMS stage).
-- 2. Every row carries work_kind ('one_time', 'recurring', 'crm', 'fms_step',
--    'fms_start') and a short work_context line, so the list can say what each
--    row is without the client guessing from task_type/source.
-- 3. An optional `kind` filter ('all', 'one_time', 'recurring', 'crm', 'fms')
--    narrows the list; kind_counts reports the per-kind totals of the scope.
-- 4. Open FMS work is shown whatever its date, as the task feed does
--    (AGENTS.md: a task feed must not hide open work). Finished FMS work
--    follows the date range like every other row.
-- 5. `stats` and `missing` still describe Tasks-section work only, so the
--    Overview tiles and scores are unchanged by this migration.
set search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.get_task_evidence_workspace(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor user_profiles; v_from date; v_to date; v_branch uuid; v_department uuid;
  v_user uuid; v_search text; v_page integer; v_page_size integer; v_view text; v_kind text; v_result jsonb;
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
  v_kind:=coalesce(nullif(p_filter->>'kind',''),'all');
  if v_kind not in ('all','one_time','recurring','crm','fms') then
    raise exception 'Task kind is invalid' using errcode='22023';
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
      (t.status not in ('completed','rejected') and coalesce(t.due_datetime,t.planned_datetime)<now()) as is_overdue,
      case when t.task_type='fms' then 'fms_step'
           when t.source in ('crm','crm_walkin') then 'crm'
           when t.task_template_id is not null then 'recurring'
           else 'one_time' end as work_kind,
      case t.source when 'crm_walkin' then 'CRM walk-in' when 'crm' then 'CRM client' end as work_context
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
    union all
    -- FMS steps: one row per activated stage with named doers.
    select fis.id,st.name,fis.status,'fms'::task_type,false,
      coalesce(fis.planned_datetime,fis.activated_at,fis.created_at),fis.actual_datetime,null::timestamptz,
      b.name,d.name,
      (select string_agg(u.employee_name,', ' order by u.employee_name)
         from user_profiles u where u.id=any(fis.assigned_to)),
      false,false,
      coalesce(fis.status='overdue' or (fis.status not in ('completed','rejected') and fis.planned_datetime<now()),false),
      'fms_step',
      f.name||' · '||fi.reference_number
    from public.fms_instance_stages fis
    join public.fms_instances fi on fi.id=fis.fms_instance_id
    join public.fms_stages st on st.id=fis.fms_stage_id
    join public.fms_flows f on f.id=fi.fms_flow_id
    left join branches b on b.id=fi.branch_id
    left join departments d on d.id=fi.department_id
    where fi.tenant_id=v_actor.tenant_id
      and cardinality(fis.assigned_to)>0
      and (fi.status<>'cancelled' or fis.status='completed')
      and ((coalesce(fis.planned_datetime,fis.activated_at,fis.created_at) at time zone 'Asia/Kolkata')::date between v_from and v_to
           or fis.status in ('pending','in_progress','in_review','overdue'))
      and (v_branch is null or fi.branch_id=v_branch)
      and (v_department is null or fi.department_id=v_department)
      and (v_user is null or v_user=any(fis.assigned_to))
      and (v_search='' or lower(st.name||' '||f.name||' '||fi.reference_number||' '||fi.title) like '%'||v_search||'%')
    union all
    -- FMS start forms still waiting for their assignee: standing open work.
    select sa.id,f.name,'pending'::task_status,'fms'::task_type,false,
      sa.created_at,null::timestamptz,null::timestamptz,
      b.name,d.name,u.employee_name,
      false,false,false,
      'fms_start',
      'Start form · '||ft.name
    from public.fms_starter_assignments sa
    join public.fms_flows f on f.id=sa.fms_flow_id
    join public.form_templates ft on ft.id=sa.form_template_id
    join public.user_profiles u on u.id=sa.user_profile_id
    left join branches b on b.id=u.branch_id
    left join departments d on d.id=u.department_id
    where sa.tenant_id=v_actor.tenant_id
      and sa.status='pending'
      and f.status='published' and coalesce(f.is_active,true)
      and (v_branch is null or u.branch_id=v_branch)
      and (v_department is null or u.department_id=v_department)
      and (v_user is null or sa.user_profile_id=v_user)
      and (v_search='' or lower(f.name||' '||ft.name) like '%'||v_search||'%')
  ), task_scope as (
    -- Tasks-section work only: the evidence and Overview figures describe it.
    select * from scope where work_kind not like 'fms%'
  ), files as (
    select a.id as attachment_id,a.created_at as uploaded_at,a.original_filename,a.mime_type,a.size_bytes,
      u.employee_name as uploaded_by_name,s.*
    from task_attachments a
    join task_scope s on s.task_id=a.task_instance_id
    left join user_profiles u on u.id=a.uploaded_by
  ), selected as (
    select * from scope where (case v_view
      when 'checklist' then not is_upload_work and work_kind not like 'fms%'
      when 'upload' then is_upload_work
      when 'awaiting_evidence' then requires_upload and not has_evidence
      when 'overdue' then is_overdue
      when 'completed' then status='completed'
      when 'remaining' then status<>'completed'
      else true end)
      and (case v_kind
      when 'fms' then work_kind like 'fms%'
      when 'all' then true
      else work_kind=v_kind end)
  ), outstanding as (
    select * from task_scope where requires_upload and not has_evidence
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
    ) as value from task_scope
  ), kind_counts as (
    select jsonb_build_object(
      'all',count(*),
      'one_time',count(*) filter(where work_kind='one_time'),
      'recurring',count(*) filter(where work_kind='recurring'),
      'crm',count(*) filter(where work_kind='crm'),
      'fms',count(*) filter(where work_kind like 'fms%')
    ) as value from scope
  ), task_page as (
    -- Late work first, then most recent: the reason to open this list is to see
    -- what is outstanding before what is merely old.
    select * from selected order by is_overdue desc,coalesce(due_datetime,planned_datetime) desc,task_id
    limit v_page_size offset (v_page-1)*v_page_size
  ), tasks as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'task_id',p.task_id,'task_title',p.title,'task_type',p.task_type,'task_status',p.status,
      'requires_upload',p.requires_upload,'is_upload_work',p.is_upload_work,'overdue',p.is_overdue,
      'branch_name',p.branch_name,'department_name',p.department_name,'assignee_names',p.assignee_names,
      'planned_datetime',p.planned_datetime,'due_datetime',p.due_datetime,'actual_datetime',p.actual_datetime,
      'work_kind',p.work_kind,'work_context',p.work_context,
      'attachments',coalesce((
        select jsonb_agg(jsonb_build_object(
          'attachment_id',a.id,'original_filename',a.original_filename,'mime_type',a.mime_type,
          'size_bytes',a.size_bytes,'uploaded_at',a.created_at,'uploaded_by_name',u.employee_name
        ) order by a.created_at desc)
        from task_attachments a left join user_profiles u on u.id=a.uploaded_by
        where a.task_instance_id=p.task_id and p.work_kind not like 'fms%'),'[]'::jsonb)
    ) order by p.is_overdue desc,coalesce(p.due_datetime,p.planned_datetime) desc,p.task_id),'[]'::jsonb) as value
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
      'user_profile_id',v_user,'search',v_search,'page',v_page,'page_size',v_page_size,'view',v_view,'kind',v_kind),
    'stats',stats.value,
    'kind_counts',kind_counts.value,
    'tasks',tasks.value,
    'tasks_total',(select count(*) from selected),
    'missing',missing.value,
    'missing_total',(select count(*) from outstanding))
  into v_result from stats,kind_counts,tasks,missing;
  return v_result;
end $function$;
