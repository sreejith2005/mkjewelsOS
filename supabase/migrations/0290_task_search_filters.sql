-- One authorized membership/paging implementation for the existing board and
-- the compact global search. No records, write grants or completion paths change.
set search_path=public,extensions;
create function public.task_workspace_page(p_filter jsonb default '{}'::jsonb,p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
 a user_profiles:=current_profile(); admin_view boolean:=has_permission('tasks.view_all'); manager_view boolean:=has_permission('tasks.manage_team');
 q text; kind_filter text; status_filter text; priority_filter text; section_filter text; requirement_filter text; ordering text; mode text;
 day_from date; day_to date; day_start timestamptz:=date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'; result jsonb;
begin
 perform assert_module_access('tasks');
 if a.id is null or not current_profile_is_active() then raise exception 'Task page access denied' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid task page' using errcode='22023'; end if;
 if p_filter is null or jsonb_typeof(p_filter)<>'object' then raise exception 'Invalid task filters' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each(p_filter) e where e.key not in ('query','kind','status','priority','from','to','subsection','requirement','sort','mode') or jsonb_typeof(e.value)<>'string') then raise exception 'Invalid task filters' using errcode='22023'; end if;
 q:=btrim(coalesce(p_filter->>'query','')); kind_filter:=coalesce(p_filter->>'kind','all'); status_filter:=coalesce(p_filter->>'status','all');
 priority_filter:=coalesce(p_filter->>'priority','all'); section_filter:=coalesce(p_filter->>'subsection','any');
 requirement_filter:=coalesce(p_filter->>'requirement','all'); ordering:=coalesce(p_filter->>'sort','due'); mode:=coalesce(p_filter->>'mode','explore');
 if length(q)>200 or kind_filter not in ('all','one_time','recurring','crm','fms') or status_filter not in ('all','pending','overdue','completed')
 or priority_filter not in ('all','high','medium','low') or section_filter not in ('any','mine','delegated','inLoop','all')
 or requirement_filter not in ('all','upload','form','remark') or ordering not in ('due','newest','priority') or mode not in ('board','explore') then
 raise exception 'Invalid task filters' using errcode='22023'; end if;
 if section_filter='all' and not admin_view then raise exception 'All tasks access denied' using errcode='42501'; end if;
 begin
  if nullif(p_filter->>'from','') is not null then
   if p_filter->>'from' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date'; end if;
   day_from:=(p_filter->>'from')::date;
  end if;
  if nullif(p_filter->>'to','') is not null then
   if p_filter->>'to' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date'; end if;
   day_to:=(p_filter->>'to')::date;
  end if;
  if day_from>day_to then raise exception 'Invalid date'; end if;
 exception when others then raise exception 'Invalid task dates' using errcode='22023'; end;
 with ordinary as (
  select t.id,t.status,t.task_type,t.task_template_id,t.created_by,
   coalesce(t.revised_datetime,t.due_datetime,t.planned_datetime) deadline,t.created_at,t.priority,
   t.requires_upload,t.requires_form,t.requires_remark,
   concat_ws(' ',t.title,t.description,t.core_task_label) searchable,
   case when t.source in ('crm','crm_walkin') then 'crm' when t.task_template_id is not null then 'recurring' else 'one_time' end kind,
   exists(select 1 from task_assignees x where x.task_instance_id=t.id and x.user_profile_id=a.id and x.is_active and x.role_at_task='doer') assigned,
   exists(select 1 from task_watchers x where x.task_instance_id=t.id and x.user_profile_id=a.id) watched,
   t.status='blocked' and not exists(select 1 from task_assignees x where x.task_instance_id=t.id and x.is_active and x.role_at_task='doer') coverage
  from task_instances t where t.tenant_id=a.tenant_id and t.deleted_at is null
   and (admin_view or manager_view or t.created_by=a.id
    or exists(select 1 from task_assignees x where x.task_instance_id=t.id and x.user_profile_id=a.id and x.is_active)
    or exists(select 1 from task_watchers x where x.task_instance_id=t.id and x.user_profile_id=a.id))
 ), workflow as (
  select s.id,s.status,'fms'::task_type task_type,null::uuid task_template_id,i.started_by created_by,
   s.planned_datetime deadline,s.created_at,i.priority,d.requires_upload,(d.form_template_id is not null) requires_form,d.requires_remark,
   concat_ws(' ',f.name,d.name,d.method,i.title,i.reference_number) searchable,'fms'::text kind,
   a.id=any(s.assigned_to) assigned,false watched,false coverage
  from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id
   join fms_stages d on d.id=s.fms_stage_id join fms_flows f on f.id=i.fms_flow_id
  where i.tenant_id=a.tenant_id and cardinality(s.assigned_to)>0 and module_accessible('fms',false) and can_read_fms_instance(i.id)
  union all
  select s.id,'pending'::task_status,'fms'::task_type,null::uuid,s.assigned_by,s.created_at,s.created_at,'medium'::task_priority,
   false,true,false,concat_ws(' ',f.name,d.name,d.method),'fms',s.user_profile_id=a.id,false,false
  from fms_starter_assignments s join fms_flows f on f.id=s.fms_flow_id join fms_stages d on d.id=s.fms_stage_id
  where s.tenant_id=a.tenant_id and s.status='pending' and module_accessible('fms',false) and (admin_view or s.user_profile_id=a.id)
 ), membership as (
  select *,not (watched and not assigned) and (assigned or (manager_view and coverage))
    and (admin_view or task_template_id is not null or task_type='fms') mine,
   not (watched and not assigned) and case when admin_view then created_by=a.id else assigned and task_template_id is null and task_type<>'fms' end delegated,
   watched and not assigned in_loop,
   case when status='completed' then 'completed' when status='overdue' or deadline<now() then 'overdue' else 'pending' end bucket
  from (select * from ordinary union all select * from workflow) t
 ), filtered as materialized (
  select *,case when section_filter in ('mine','delegated','inLoop','all') then section_filter
   when in_loop then 'inLoop' when mine then 'mine' when delegated then 'delegated' else 'all' end subsection
  from membership where (case section_filter when 'all' then admin_view when 'mine' then mine when 'delegated' then delegated when 'inLoop' then in_loop else mine or delegated or in_loop or admin_view end)
   and (mode='explore' or section_filter='all' or
    (task_type='fms' and status in ('pending','in_progress','in_review','overdue')) or
    (task_type<>'fms' and (deadline>=day_start and deadline<day_start+interval '1 day'
      or (status not in ('completed','rejected','blocked') and (deadline<day_start or (deadline>=day_start+interval '1 day' and task_template_id is null))))))
   and (q='' or strpos(lower(searchable),lower(q))>0)
   and (kind_filter='all' or kind=kind_filter) and (priority_filter='all' or priority::text=priority_filter)
   and (day_from is null or deadline>=day_from::timestamp at time zone 'Asia/Kolkata')
   and (day_to is null or deadline<(day_to+1)::timestamp at time zone 'Asia/Kolkata')
   and (requirement_filter='all' or requirement_filter='upload' and requires_upload or requirement_filter='form' and requires_form or requirement_filter='remark' and requires_remark)
 ), numbered as (
  select *,row_number() over(order by
   case when mode='board' then deadline end desc nulls last,case when mode='board' then id end desc,
   case when mode='explore' and ordering='priority' then case priority when 'high' then 3 when 'medium' then 2 else 1 end end desc nulls last,
   case when mode='explore' and ordering='newest' then created_at end desc nulls last,
   case when mode='explore' and ordering<>'newest' then deadline end asc nulls last,id asc) position
  from filtered where status_filter='all' or bucket=status_filter
 ), page as (select * from numbered order by position limit p_limit offset p_offset)
 select jsonb_build_object('ids',coalesce((select jsonb_agg(id order by position) from page),'[]'::jsonb),
  'sections',coalesce((select jsonb_object_agg(id,subsection) from page),'{}'::jsonb),
  'total',(select count(*) from numbered),
  'counts',jsonb_build_object('pending',count(*) filter(where bucket='pending'),'overdue',count(*) filter(where bucket='overdue'),
   'completed',count(*) filter(where bucket='completed'),'open',count(*) filter(where bucket<>'completed')))
 into result from filtered;
 return result;
end;
$$;
revoke all on function public.task_workspace_page(jsonb,integer,integer) from public,anon,service_role;
grant execute on function public.task_workspace_page(jsonb,integer,integer) to authenticated;

-- Keep the old signature, error messages, scope, date window and ordering.
create or replace function public.task_feed_page(p_view text,p_status text,p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform assert_module_access('tasks');
 if p_view is null or p_view not in ('mine','delegated','inLoop','all') or p_status is null or p_status not in ('pending','overdue','completed') then
  raise exception 'Invalid task page' using errcode='22023'; end if;
 return task_workspace_page(jsonb_build_object('mode','board','subsection',p_view,'status',p_status),p_offset,p_limit);
end;
$$;
