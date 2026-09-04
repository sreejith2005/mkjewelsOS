-- Task Control needs to show every task a user was assigned -- the checklist
-- ones and the upload ones together -- not only the tasks that produced a file.
--
-- The workspace already computed that exact set in its `scope` CTE and then
-- threw it away, returning only the attachment page. This returns the task page
-- itself, with each task's evidence attached inline, so one list answers "what
-- was this person given, and what came back".
--
-- `evidence`/`evidence_total` are replaced by `tasks`/`tasks_total`: a separate
-- file-only page is redundant once every file is shown on the task that owns
-- it. `stats` and `missing` are unchanged -- the overview panel still reads
-- them, and the file/byte counts in `stats` still come from the same join.
set search_path=public,extensions;

create or replace function public.get_task_evidence_workspace(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_actor user_profiles; v_from date; v_to date; v_branch uuid; v_department uuid;
  v_user uuid; v_search text; v_page integer; v_page_size integer; v_view text; v_result jsonb;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
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
    from task_instances t
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
end $$;

revoke all on function public.get_task_evidence_workspace(jsonb) from public,anon;
grant execute on function public.get_task_evidence_workspace(jsonb) to authenticated;

notify pgrst,'reload schema';
