-- Business Reports 2.0 (2026-11-02).
-- Extends the existing report engine (migration 0013) instead of adding a second one:
-- new report keys run through report_rows_for_profile, get_report_data, the private
-- export queue and its retention. Older report keys keep working for past exports and
-- Ask Kiara. Reads only: no report table, cache or customer copy is added.
set search_path=public,extensions;

-- ---------------------------------------------------------------------------
-- 1. Report keys, roles and ranges
-- ---------------------------------------------------------------------------
create or replace function report_allowed_for_role(p_key text,p_role user_role,p_export boolean default false)
returns boolean language sql immutable set search_path=public as $$
  select case p_key
    when 'task_operations' then p_role in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
    when 'task_completion_delay' then p_role in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
    when 'fms_instances_stages' then p_role in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
    when 'fms_sla' then p_role in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
    when 'form_submissions_reviews' then p_role in ('super_admin','admin','manager','crm','staff')
    when 'crm_clients_ownership' then p_role in ('super_admin','admin','manager','crm')
    when 'crm_walkins' then p_role in ('super_admin','admin','manager','crm')
    when 'crm_interactions' then p_role in ('super_admin','admin','manager','crm')
    when 'crm_followups' then p_role in ('super_admin','admin','manager','crm')
    when 'people_availability' then p_role in ('super_admin','admin','manager','hr')
    when 'people_task_performance' then p_role in ('super_admin','admin','manager','hr')
    when 'notification_delivery_health' then p_role in ('super_admin','admin')
    when 'export_history' then not p_export
    -- Business Reports 2.0
    when 'form_answers' then p_role in ('super_admin','admin','manager','crm','staff')
    when 'fms_workflow_summary' then p_role in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
    when 'fms_stage_visits' then p_role in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
    when 'fms_stage_performance' then p_role in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
    when 'work_register' then p_role in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
    when 'employee_task_performance' then p_role in ('super_admin','admin','manager','hr')
    else false end;
$$;

create or replace function report_max_days(p_key text)
returns integer language sql immutable set search_path=public as $$
  select case when p_key in ('task_operations','people_availability','notification_delivery_health') then 90
    when p_key in ('fms_instances_stages','crm_walkins','crm_interactions','crm_followups','work_register') then 180 else 366 end;
$$;

-- The shared filter context accepts the new report filters; each report validates its own.
do $context$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('reporting_context_for_actor(uuid,jsonb)'::regprocedure);
  v_new:=replace(v_def,$old$'user_profile_id','status','page','page_size'],'report filter'$old$,
    $new$'user_profile_id','status','page','page_size','form_family_id','flow_family_id','stage_key','work_kind','search'],'report filter'$new$);
  if v_new=v_def then raise exception 'reporting_context_for_actor filter list not found'; end if;
  execute v_new;
end $context$;

alter table export_logs drop constraint export_logs_report_key;
alter table export_logs add constraint export_logs_report_key check(report_key in (
  'task_operations','task_completion_delay','fms_instances_stages','fms_sla','form_submissions_reviews','crm_clients_ownership','crm_walkins',
  'crm_interactions','crm_followups','people_availability','people_task_performance','notification_delivery_health','export_history',
  'customer_master','customer_enquiries','customer_stages','customer_answers','customer_activity','customer_followups','customer_commercial','customer_exceptions',
  'form_answers','fms_workflow_summary','fms_stage_visits','fms_stage_performance','work_register','employee_task_performance',
  'customer_report_master','customer_report_journey','customer_report_leads','customer_report_followups','customer_report_sources',
  'customer_report_crm_staff','customer_report_sales'));

-- ---------------------------------------------------------------------------
-- 2. Form answers as readable text, from the saved submission snapshot
-- ---------------------------------------------------------------------------
-- Labels, options and visibility come from the form version the person answered, never
-- today's editable form. Attachments export their file names only: no storage path or URL.
create function report_answer_text(p_field jsonb,p_value jsonb,p_tenant uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare t text:=coalesce(p_field->>'field_type','text'); result text;
begin
  if p_value is null or p_value in ('null'::jsonb,'[]'::jsonb,'{}'::jsonb) then return null; end if;
  if jsonb_typeof(p_value)='string' and btrim(p_value#>>'{}')='' then return null; end if;
  if t='file' then
    select string_agg(case when jsonb_typeof(x)='object' then coalesce(nullif(btrim(x->>'name'),''),nullif(btrim(x->>'file_name'),''),nullif(btrim(x->>'fileName'),''),'Attachment') else 'Attachment' end,'; ' order by n)
      into result from jsonb_array_elements(case jsonb_typeof(p_value) when 'array' then p_value else jsonb_build_array(p_value) end) with ordinality e(x,n);
    return result;
  end if;
  select string_agg(coalesce(
      case when t='user_dropdown' then (select employee_name from user_profiles where tenant_id=p_tenant and id::text=x#>>'{}')
           when t='branch_dropdown' then (select name from branches where tenant_id=p_tenant and id::text=x#>>'{}')
           when t='department_dropdown' then (select name from departments where tenant_id=p_tenant and id::text=x#>>'{}') end,
      (select o->>'label' from jsonb_array_elements(case when jsonb_typeof(p_field->'options')='array' then p_field->'options' else '[]'::jsonb end) o
        where jsonb_typeof(o)='object' and o->'value'=x limit 1),
      case jsonb_typeof(x)
        when 'object' then coalesce(nullif(x->>'name',''),nullif(x->>'label',''),nullif(x->>'title',''),nullif(x->>'value',''),
          (select string_agg(k||': '||coalesce(v#>>'{}',''),', ' order by k) from jsonb_each(x) j(k,v) where jsonb_typeof(v) in ('string','number','boolean')),'Provided')
        when 'boolean' then case when x='true'::jsonb then 'Yes' else 'No' end
        else nullif(btrim(x#>>'{}'),'') end),'; ' order by n)
    into result from jsonb_array_elements(case jsonb_typeof(p_value) when 'array' then p_value else jsonb_build_array(p_value) end) with ordinality e(x,n);
  return nullif(result,'');
end $$;

-- A field counts only when its saved visibility rule is met (hidden answers export blank).
create function report_field_visible(p_field jsonb,p_data jsonb)
returns boolean language sql stable security definer set search_path=public as $$
  -- Same visibility test as the customer sync (crm_sync.capture_customer_submission).
  select coalesce(p_field->>'is_shown','true')<>'false'
    and form_condition_matches(p_field->'conditional_logic',p_data) is true
    and (p_field->'rule_definition' is null or p_field->'rule_definition'='null'::jsonb or form_condition_matches(p_field->'rule_definition',p_data) is true);
$$;

create function report_submission_answers(p_snapshot jsonb,p_data jsonb,p_tenant uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('label',coalesce(nullif(fld->>'field_name',''),fld->>'field_key'),'value',x.v) order by coalesce((fld->>'sort_order')::numeric,0),n),'[]')
  from jsonb_array_elements(case when jsonb_typeof(p_snapshot->'fields')='array' then p_snapshot->'fields' else '[]'::jsonb end) with ordinality e(fld,n)
  cross join lateral (select report_answer_text(fld,p_data->(fld->>'field_key'),p_tenant) v) x
  where x.v is not null and coalesce(fld->>'field_type','') not in ('section_header','divider') and report_field_visible(fld,p_data);
$$;

-- ---------------------------------------------------------------------------
-- 3. One FMS visit base shared by the FMS, work and performance reports
-- ---------------------------------------------------------------------------
-- Executed visits only (loops stay separate rows); End steps are outcomes, not work.
-- Skipped and stopped visits are reported as such, never as completed.
create function report_fms_visit_rows(p_actor user_profiles,c jsonb,p_flow uuid,p_stage text,p_search text,p_basis text)
returns table(id uuid,fms_instance_id uuid,reference_number text,title text,branch_id uuid,flow_family_id uuid,flow_name text,stage_key text,stage_name text,
  form_template_id uuid,visit_number integer,raw_status text,assigned_to uuid[],planned_datetime timestamptz,actual_datetime timestamptz,activated_at timestamptz,
  created_at timestamptz,path_depth integer,completed_by uuid,form_submission_id uuid,priority text,status text,timing text,delay_minutes integer)
language sql stable security definer set search_path=public as $$
  select w.id,fi.id,fi.reference_number,fi.title,fi.branch_id,coalesce(fi.flow_family_id,ff.family_id,ff.id),ff.name,st.stage_key,st.name,st.form_template_id,
    w.visit_number,w.status::text,w.assigned_to,w.planned_datetime,w.actual_datetime,w.activated_at,w.created_at,
    -- Visits written in one transaction share a timestamp; the causal chain keeps the real order.
    (with recursive up(prev,depth) as (select w.previous_instance_stage_id,0 union all
      select p.previous_instance_stage_id,up.depth+1 from up join fms_instance_stages p on p.id=up.prev where up.depth<5000) select max(depth) from up)::integer,w.completed_by,w.form_submission_id,fi.priority::text,
    case when w.outcome='condition_skipped' then 'skipped' when w.outcome='workflow_closed' then 'stopped'
      when w.status::text in ('pending','in_progress','in_review','overdue') and w.planned_datetime<now() then 'overdue' else w.status::text end,
    case when w.outcome in ('condition_skipped','workflow_closed') then null
      when w.actual_datetime is not null and w.planned_datetime is not null then case when w.actual_datetime<=w.planned_datetime then 'on_time' else 'delayed' end
      when w.status::text='completed' then 'no_deadline'
      when w.planned_datetime is null then 'no_deadline' when w.planned_datetime<now() then 'overdue' else 'not_due' end,
    case when w.actual_datetime>w.planned_datetime then round(extract(epoch from w.actual_datetime-w.planned_datetime)/60)::integer else 0 end
  from fms_instance_stages w join fms_instances fi on fi.id=w.fms_instance_id join fms_flows ff on ff.id=fi.fms_flow_id join fms_stages st on st.id=w.fms_stage_id
  where fi.tenant_id=p_actor.tenant_id and st.step_type<>'end'
    and case when p_basis='planned' then w.planned_datetime else coalesce(w.activated_at,w.created_at) end>=(c->>'start_at')::timestamptz
    and case when p_basis='planned' then w.planned_datetime else coalesce(w.activated_at,w.created_at) end<(c->>'end_at')::timestamptz
    and ((c->>'branch_id') is null or fi.branch_id=(c->>'branch_id')::uuid)
    and ((c->>'department_id') is null or fi.department_id=(c->>'department_id')::uuid)
    and (p_flow is null or coalesce(fi.flow_family_id,ff.family_id,ff.id)=p_flow)
    and (p_stage is null or st.stage_key=p_stage)
    and (p_actor.user_role in ('super_admin','admin','hr') or p_actor.user_role='manager' and fi.branch_id=p_actor.branch_id
      or p_actor.id=any(w.assigned_to) or w.completed_by=p_actor.id
      or exists(select 1 from fms_instance_stage_assignees x where x.fms_instance_stage_id=w.id and x.user_profile_id=p_actor.id and x.is_active))
    and ((c->>'user_profile_id') is null or (c->>'user_profile_id')::uuid=any(w.assigned_to)
      or exists(select 1 from fms_instance_stage_assignees x where x.fms_instance_stage_id=w.id and x.user_profile_id=(c->>'user_profile_id')::uuid and x.is_active))
    and (p_search is null or strpos(lower(concat_ws(' ',fi.reference_number,fi.title,ff.name,st.name)),p_search)>0);
$$;

create function report_employee_names(p_ids uuid[],p_tenant uuid)
returns text language sql stable security definer set search_path=public as $$
  select string_agg(employee_name,', ' order by employee_name) from user_profiles where tenant_id=p_tenant and id=any(p_ids);
$$;

-- ---------------------------------------------------------------------------
-- 4. The report reader: new keys here, older keys unchanged in _v1
-- ---------------------------------------------------------------------------
alter function report_rows_for_profile(uuid,text,jsonb,integer,integer) rename to report_rows_for_profile_v1;

create function report_rows_for_profile(p_profile_id uuid,p_report_key text,p_filters jsonb,p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  f jsonb:=coalesce(p_filters,'{}'::jsonb); a user_profiles; c jsonb; s timestamptz; e timestamptz;
  v_rows jsonb:='[]'::jsonb; v_total bigint:=0; v_columns jsonb; v_summary jsonb;
  v_form uuid; v_flow uuid; v_stage text; v_kind text; v_search text; v_status text; v_branch uuid; v_dept uuid; v_user uuid;
  v_manager boolean; v_background boolean;
begin
  -- Before 0370 the Reports page sent From/To without a preset and every report and export
  -- silently covered today only. A chosen range is a custom range.
  if not f ? 'preset' and nullif(f->>'from','') is not null and nullif(f->>'to','') is not null then f:=f||'{"preset":"custom"}'::jsonb; end if;
  select * into a from user_profiles where id=p_profile_id;
  if a.id is null or a.working_status in ('inactive','resigned') or not a.is_login_enabled then raise exception 'Active profile required' using errcode='42501'; end if;
  -- A background export runs as the worker: the requester must still hold report access now.
  v_background:=(current_profile()).id is distinct from a.id;
  if v_background and not (permission_effective_for(a.id,'reports.view') and permission_effective_for(a.id,'reports.export')) then
    raise exception 'Requester no longer authorized' using errcode='42501'; end if;
  if p_report_key not in ('form_answers','fms_workflow_summary','fms_stage_visits','fms_stage_performance','work_register','employee_task_performance') then
    return report_rows_for_profile_v1(p_profile_id,p_report_key,f,p_offset,p_limit);
  end if;
  if not report_allowed_for_role(p_report_key,a.user_role,false) then raise exception 'Report access denied' using errcode='42501'; end if;
  if p_offset<0 or p_limit<1 or p_limit>1000 then raise exception 'Invalid report pagination' using errcode='22023'; end if;
  c:=reporting_context_for_actor(a.id,f); s:=(c->>'start_at')::timestamptz; e:=(c->>'end_at')::timestamptz;
  if (c->>'local_end_exclusive')::date-(c->>'local_start')::date>report_max_days(p_report_key) then raise exception 'Report date range exceeds maximum' using errcode='22023'; end if;
  begin
    v_form:=nullif(f->>'form_family_id','')::uuid; v_flow:=nullif(f->>'flow_family_id','')::uuid;
  exception when others then raise exception 'Invalid report filter' using errcode='22023'; end;
  v_stage:=nullif(f->>'stage_key','');
  if v_stage is not null and v_stage !~ '^[A-Za-z0-9_:-]{1,100}$' then raise exception 'Invalid stage filter' using errcode='22023'; end if;
  v_kind:=coalesce(nullif(f->>'work_kind',''),'all');
  if v_kind not in ('all','task','fms') then raise exception 'Invalid work type filter' using errcode='22023'; end if;
  v_search:=nullif(lower(btrim(coalesce(f->>'search',''))),'');
  if length(coalesce(v_search,''))>100 then raise exception 'Search text is too long' using errcode='22023'; end if;
  v_status:=c->>'status'; v_branch:=(c->>'branch_id')::uuid; v_dept:=(c->>'department_id')::uuid; v_user:=(c->>'user_profile_id')::uuid;
  v_manager:=a.user_role in ('super_admin','admin','manager');

  if p_report_key='form_answers' then
    -- Every submitted form (standalone, task and FMS), with its real answers.
    with scoped as materialized (
      select fs.id,fs.submitted_at,fs.status::text status,fs.branch_id,fs.submitted_by,fs.linked_module,fs.linked_record_id,fs.data,fs.template_snapshot snap
      from form_submissions fs
      where fs.tenant_id=a.tenant_id and fs.submitted_at>=s and fs.submitted_at<e
        and (v_branch is null or fs.branch_id=v_branch) and (v_dept is null or fs.department_id=v_dept)
        and (a.user_role in ('super_admin','admin') or a.user_role='manager' and fs.branch_id=a.branch_id or fs.submitted_by=a.id)
        and (v_status is null or fs.status::text=v_status) and (v_user is null or fs.submitted_by=v_user)
        and (v_form is null or coalesce(nullif(fs.template_snapshot#>>'{template,family_id}',''),fs.template_snapshot#>>'{template,id}',fs.form_template_id::text)=v_form::text)
        and (v_search is null or strpos(lower(coalesce(fs.template_snapshot#>>'{template,name}','')||' '||fs.data::text),v_search)>0)
    ), cols as materialized (
      -- One stable column per question key across every version of the chosen form; the
      -- newest wording is the header. Questions missing from a version export blank.
      select key,label,type,ver,sort from (
        select distinct on (fld->>'field_key') fld->>'field_key' key,coalesce(nullif(fld->>'field_name',''),fld->>'field_key') label,fld->>'field_type' type,
          coalesce((q.snap#>>'{template,version}')::integer,0) ver,coalesce((fld->>'sort_order')::numeric,0) sort
        from scoped q cross join jsonb_array_elements(case when jsonb_typeof(q.snap->'fields')='array' then q.snap->'fields' else '[]'::jsonb end) fld
        where v_form is not null and nullif(fld->>'field_key','') is not null and coalesce(fld->>'field_type','') not in ('section_header','divider')
        order by fld->>'field_key',coalesce((q.snap#>>'{template,version}')::integer,0) desc,q.submitted_at desc
      ) d order by ver desc,sort,key limit 200
    ), page as (select * from scoped order by submitted_at desc,id offset p_offset limit p_limit)
    select coalesce(jsonb_agg(item order by p_submitted desc,p_id),'[]'),(select count(*) from scoped),
      case when v_form is null then null else jsonb_build_array(
          jsonb_build_object('key','form_name','label','Form'),jsonb_build_object('key','form_version','label','Form version'),
          jsonb_build_object('key','submitted_at','label','Submitted (Asia/Kolkata)','instant',true),jsonb_build_object('key','submitted_by_name','label','Submitted by'),
          jsonb_build_object('key','branch_name','label','Branch'),jsonb_build_object('key','linked_to','label','Linked FMS / task'),
          jsonb_build_object('key','workflow_name','label','Workflow'),jsonb_build_object('key','stage_name','label','Stage'),jsonb_build_object('key','status','label','Status'))
        ||(select coalesce(jsonb_agg(jsonb_build_object('key','q:'||k.key,'label',k.label,'phone',k.type='phone') order by k.ver desc,k.sort,k.key),'[]'::jsonb) from cols k) end
      into v_rows,v_total,v_columns from (
      select p.submitted_at p_submitted,p.id p_id,jsonb_build_object(
        'submission_id',p.id,'form_name',p.snap#>>'{template,name}','form_version',(p.snap#>>'{template,version}')::integer,'submitted_at',p.submitted_at,
        'submitted_by_name',up.employee_name,'branch_name',b.name,'status',p.status,
        'linked_to',coalesce(fms.reference_number,task.title,case p.linked_module when 'crm_client' then 'CRM customer' end),
        'workflow_name',fms.flow_name,'stage_name',fms.stage_name,
        'answers',(select string_agg((x->>'label')||': '||(x->>'value'),' | ') from jsonb_array_elements(ans.list) x))
        ||case when v_background then '{}'::jsonb else jsonb_build_object('answer_list',ans.list) end
        ||coalesce((select jsonb_object_agg('q:'||k.key,case when fld is null or not report_field_visible(fld,p.data) then null else report_answer_text(fld,p.data->k.key,a.tenant_id) end)
            from cols k left join lateral (select x fld from jsonb_array_elements(case when jsonb_typeof(p.snap->'fields')='array' then p.snap->'fields' else '[]'::jsonb end) x where x->>'field_key'=k.key limit 1) fx on true),'{}'::jsonb) item
      from page p
      cross join lateral (select report_submission_answers(p.snap,p.data,a.tenant_id) list) ans
      left join user_profiles up on up.id=p.submitted_by left join branches b on b.id=p.branch_id
      left join lateral (select fi.reference_number,ff.name flow_name,st.name stage_name from fms_instance_stages w join fms_instances fi on fi.id=w.fms_instance_id
        join fms_flows ff on ff.id=fi.fms_flow_id join fms_stages st on st.id=w.fms_stage_id where w.form_submission_id=p.id and fi.tenant_id=a.tenant_id order by w.created_at,w.id limit 1) fms on true
      left join lateral (select ti.title from task_instances ti where p.linked_module in ('checklist_task','delegation_task','tasks','task') and ti.id=p.linked_record_id and ti.tenant_id=a.tenant_id) task on true
    ) r;

  elsif p_report_key='fms_workflow_summary' then
    perform assert_module_enabled('fms_builder');
    with inst as materialized (
      select fi.id,fi.reference_number,fi.title,fi.status::text status,fi.started_at,fi.completed_at,fi.started_by,ff.name flow_name,ff.version flow_version
      from fms_instances fi join fms_flows ff on ff.id=fi.fms_flow_id
      where fi.tenant_id=a.tenant_id and fi.started_at>=s and fi.started_at<e
        and (v_branch is null or fi.branch_id=v_branch) and (v_dept is null or fi.department_id=v_dept)
        and (v_flow is null or coalesce(fi.flow_family_id,ff.family_id,ff.id)=v_flow)
        and (a.user_role in ('super_admin','admin') or a.user_role='manager' and fi.branch_id=a.branch_id or fi.started_by=a.id
          or exists(select 1 from fms_instance_stages w where w.fms_instance_id=fi.id and (a.id=any(w.assigned_to) or w.completed_by=a.id)))
        and (v_user is null or fi.started_by=v_user or exists(select 1 from fms_instance_stages w where w.fms_instance_id=fi.id and (v_user=any(w.assigned_to) or w.completed_by=v_user)))
        and (v_search is null or strpos(lower(concat_ws(' ',fi.reference_number,fi.title,ff.name)),v_search)>0)
    ), enriched as materialized (
      select i.*,o.outcome,o.end_stage_name,o.closed_at,
        exists(select 1 from fms_instance_stages w join fms_stages st on st.id=w.fms_stage_id where w.fms_instance_id=i.id and st.step_type<>'end'
          and w.status::text in ('pending','in_progress','in_review','overdue') and w.planned_datetime<now()) is_overdue
      from inst i left join fms_instance_outcomes o on o.fms_instance_id=i.id
    ), filtered as materialized (
      select * from enriched where v_status is null or case when v_status in ('won','lost','do_not_contact','other') then outcome=v_status
        when v_status='running' then status in ('active','overdue') when v_status='overdue' then status in ('active','overdue') and is_overdue else status=v_status end
    ), page as (select * from filtered order by started_at desc,id offset p_offset limit p_limit)
    select coalesce(jsonb_agg(jsonb_build_object(
        'instance_id',p.id,'reference_number',p.reference_number,'workflow_name',p.flow_name,'flow_version',p.flow_version,'started_at',p.started_at,
        'record_name',coalesce(fms_work_record_name_authorized(lv.id),p.title),'started_by_name',(select employee_name from user_profiles where id=p.started_by),
        'first_assignee',report_employee_names(fv.assigned_to,a.tenant_id),
        'current_stage',(select string_agg(distinct st.name,', ') from fms_instance_stages w join fms_stages st on st.id=w.fms_stage_id where w.fms_instance_id=p.id and st.step_type<>'end' and w.status::text in ('pending','in_progress','in_review','overdue')),
        'current_assignee',(select report_employee_names(array_agg(distinct u),a.tenant_id) from fms_instance_stages w join fms_stages st on st.id=w.fms_stage_id cross join unnest(w.assigned_to) u
          where w.fms_instance_id=p.id and st.step_type<>'end' and w.status::text in ('pending','in_progress','in_review','overdue')),
        'status',case when p.status in ('active','overdue') and p.is_overdue then 'overdue' when p.status='active' then 'running' else p.status end,
        'next_due',(select min(w.planned_datetime) from fms_instance_stages w join fms_stages st on st.id=w.fms_stage_id where w.fms_instance_id=p.id and st.step_type<>'end' and w.status::text in ('pending','in_progress','in_review','overdue')),
        'final_outcome',p.outcome,'end_stage',p.end_stage_name,'completed_at',coalesce(p.closed_at,p.completed_at),
        'stage_visits',(select count(*) from fms_instance_stages w join fms_stages st on st.id=w.fms_stage_id where w.fms_instance_id=p.id and st.step_type<>'end')
      ) order by p.started_at desc,p.id),'[]'),(select count(*) from filtered),
      (select jsonb_build_object('workflows',count(*),'running',count(*) filter(where status in ('active','overdue')),'overdue',count(*) filter(where status in ('active','overdue') and is_overdue),
        'completed',count(*) filter(where status='completed'),'cancelled',count(*) filter(where status='cancelled'),'won',count(*) filter(where outcome='won'),'lost',count(*) filter(where outcome='lost')) from filtered)
      into v_rows,v_total,v_summary
    from page p
    left join lateral (select w.id from fms_instance_stages w where w.fms_instance_id=p.id order by w.created_at desc,cardinality(w.execution_path) desc,w.id desc limit 1) lv on true
    left join lateral (select w.assigned_to from fms_instance_stages w where w.fms_instance_id=p.id order by w.created_at,cardinality(w.execution_path),w.id limit 1) fv on true;

  elsif p_report_key='fms_stage_visits' then
    perform assert_module_enabled('fms_builder');
    with filtered as materialized (
      select * from report_fms_visit_rows(a,c,v_flow,v_stage,v_search,'activated') r where v_status is null or r.status=v_status or r.timing=v_status
    ), page as (select * from filtered order by reference_number,created_at,path_depth,id offset p_offset limit p_limit)
    select coalesce(jsonb_agg(jsonb_build_object(
        'visit_id',p.id,'reference_number',p.reference_number,'workflow_name',p.flow_name,'record_name',coalesce(fms_work_record_name_authorized(p.id),p.title),
        'stage_name',p.stage_name,'visit_number',p.visit_number,'assigned_to',report_employee_names(p.assigned_to,a.tenant_id),
        'planned_datetime',p.planned_datetime,'actual_datetime',p.actual_datetime,'status',p.status,
        'completed_by_name',(select employee_name from user_profiles where id=p.completed_by and tenant_id=a.tenant_id),
        'form_name',case when p.form_template_id is null then null else coalesce(fs.template_snapshot#>>'{template,name}',(select name from form_templates where id=p.form_template_id)) end,
        'form_filled',case when p.form_template_id is null then null else p.form_submission_id is not null end,
        -- Managers see the answers; other readers only answers they submitted themselves.
        'answers',case when fs.id is not null and (v_manager or fs.submitted_by=a.id) then
          (select string_agg((x->>'label')||': '||(x->>'value'),' | ') from jsonb_array_elements(report_submission_answers(fs.template_snapshot,fs.data,a.tenant_id)) x) end,
        'next_steps',(select string_agg(t.name||coalesce(' ('||report_employee_names(tw.assigned_to,a.tenant_id)||')',''),'; ' order by t.sort_order)
          from fms_visit_transitions vt join fms_stages t on t.id=vt.target_stage_id left join fms_instance_stages tw on tw.id=vt.target_instance_stage_id where vt.source_instance_stage_id=p.id),
        'timing',p.timing,'delay_minutes',p.delay_minutes,
        'final_outcome',(select o.outcome from fms_instance_outcomes o where o.source_instance_stage_id=p.id)
      ) order by p.reference_number,p.created_at,p.path_depth,p.id),'[]'),(select count(*) from filtered),
      (select jsonb_build_object('visits',count(*),'completed',count(*) filter(where status='completed'),'overdue',count(*) filter(where status='overdue'),
        'on_time',count(*) filter(where timing='on_time'),'delayed',count(*) filter(where timing='delayed')) from filtered)
      into v_rows,v_total,v_summary
    from page p left join form_submissions fs on fs.id=p.form_submission_id and fs.tenant_id=a.tenant_id;

  elsif p_report_key='fms_stage_performance' then
    perform assert_module_enabled('fms_builder');
    with visits as materialized (select * from report_fms_visit_rows(a,c,v_flow,v_stage,v_search,'activated') where status not in ('skipped','stopped')),
    grouped as materialized (
      select flow_family_id,stage_key,(array_agg(flow_name order by created_at desc))[1] flow_name,(array_agg(stage_name order by created_at desc))[1] stage_name,
        count(*) visits,count(*) filter(where status='completed') completed,count(*) filter(where status in ('pending','in_progress','in_review','blocked')) open_not_late,
        count(*) filter(where status='overdue') overdue,count(*) filter(where timing='on_time') on_time,count(*) filter(where timing='delayed') delayed,
        round(avg(delay_minutes) filter(where timing='delayed'))::integer average_delay_minutes,
        round(avg(extract(epoch from actual_datetime-coalesce(activated_at,created_at))/3600) filter(where status='completed' and actual_datetime is not null)::numeric,1) average_hours_to_complete
      from visits group by flow_family_id,stage_key
    ), page as (select * from grouped order by flow_name,stage_name,stage_key offset p_offset limit p_limit)
    select coalesce(jsonb_agg(jsonb_build_object('stage_key',p.stage_key,'workflow_name',p.flow_name,'stage_name',p.stage_name,'visits',p.visits,'completed',p.completed,
        'open_not_late',p.open_not_late,'overdue',p.overdue,'on_time',p.on_time,'delayed',p.delayed,
        'on_time_rate',case when p.on_time+p.delayed=0 then null else round(100.0*p.on_time/(p.on_time+p.delayed),1) end,
        'average_delay_minutes',p.average_delay_minutes,'average_hours_to_complete',p.average_hours_to_complete) order by p.flow_name,p.stage_name,p.stage_key),'[]'),
      (select count(*) from grouped) into v_rows,v_total from page p;

  elsif p_report_key='work_register' then
    -- Regular tasks and FMS steps in one list, each by its own due time.
    with tasks as materialized (
      select 'task'::text kind,ti.id,ti.title,initcap(replace(ti.task_type::text,'_',' ')) work_type,null::text flow_name,null::text stage_name,
        coalesce((select string_agg(up.employee_name,', ' order by up.employee_name) from task_assignees ta join user_profiles up on up.id=ta.user_profile_id where ta.task_instance_id=ti.id and ta.is_active),'Unassigned') assignees,
        ti.branch_id,coalesce(ti.revised_datetime,ti.planned_datetime) planned,ti.actual_datetime actual,
        case when ti.status::text in ('pending','in_progress','in_review','overdue') and coalesce(ti.revised_datetime,ti.planned_datetime)<now() then 'overdue' else ti.status::text end status,
        ti.priority::text priority,
        case when ti.status::text='completed' and ti.actual_datetime is not null then case when ti.actual_datetime<=coalesce(ti.revised_datetime,ti.planned_datetime) then 'on_time' else 'delayed' end
          when ti.status::text in ('rejected','blocked') then null when coalesce(ti.revised_datetime,ti.planned_datetime)<now() then 'overdue' else 'not_due' end timing,
        case when ti.actual_datetime>coalesce(ti.revised_datetime,ti.planned_datetime) then round(extract(epoch from ti.actual_datetime-coalesce(ti.revised_datetime,ti.planned_datetime))/60)::integer else 0 end delay_minutes,
        nullif(ti.verification_status,'not_required') verification
      from task_instances ti
      where v_kind in ('all','task') and ti.deleted_at is null and task_in_reporting_scope(a,ti,c)
        and coalesce(ti.revised_datetime,ti.planned_datetime)>=s and coalesce(ti.revised_datetime,ti.planned_datetime)<e
        and (v_search is null or strpos(lower(ti.title),v_search)>0)
    ), fms as materialized (
      select 'fms'::text kind,r.id,r.title,'FMS step'::text work_type,r.flow_name,r.stage_name,coalesce(report_employee_names(r.assigned_to,a.tenant_id),'Unassigned') assignees,
        r.branch_id,r.planned_datetime planned,r.actual_datetime actual,r.status,r.priority,r.timing,r.delay_minutes,null::text verification
      from report_fms_visit_rows(a,c,v_flow,v_stage,v_search,'planned') r where v_kind in ('all','fms') and r.status not in ('skipped','stopped')
    ), filtered as materialized (
      select * from (select * from tasks union all select * from fms) w where v_status is null or w.status=v_status or w.timing=v_status
    ), page as (select * from filtered order by planned,kind,id offset p_offset limit p_limit)
    select coalesce(jsonb_agg(jsonb_build_object('work_id',p.id,'work_kind',p.kind,
        'title',case when p.kind='fms' then coalesce(fms_work_record_name_authorized(p.id),p.title) else p.title end,
        'work_type',p.work_type,'workflow_name',p.flow_name,'stage_name',p.stage_name,'assignee_name',p.assignees,'branch_name',b.name,
        'planned_datetime',p.planned,'actual_datetime',p.actual,'status',p.status,'priority',p.priority,'timing',p.timing,'delay_minutes',p.delay_minutes,'verification',p.verification
      ) order by p.planned,p.kind,p.id),'[]'),(select count(*) from filtered),
      (select jsonb_build_object('work',count(*),'completed',count(*) filter(where status='completed'),'open',count(*) filter(where status in ('pending','in_progress','in_review','blocked','overdue')),
        'overdue',count(*) filter(where status='overdue'),'on_time',count(*) filter(where timing='on_time'),'delayed',count(*) filter(where timing='delayed')) from filtered)
      into v_rows,v_total,v_summary
    from page p left join branches b on b.id=p.branch_id;

  elsif p_report_key='employee_task_performance' then
    -- Cohort: work DUE in the period, credited to every active assignee (shared work counts
    -- once for each person). Reassigned work counts for the current assignee only; each
    -- recurring occurrence is its own task; reopened work counts by its current state.
    -- Rejected tasks and skipped/stopped FMS steps are excluded; FMS steps without a
    -- deadline cannot be due and are not counted.
    with work as materialized (
      select ta.user_profile_id pid,ti.id wid,coalesce(ti.revised_datetime,ti.planned_datetime) due,ti.actual_datetime done_at,ti.status::text st
      from task_instances ti join task_assignees ta on ta.task_instance_id=ti.id and ta.is_active
      where v_kind in ('all','task') and ti.tenant_id=a.tenant_id and ti.deleted_at is null and ti.status::text<>'rejected'
        and coalesce(ti.revised_datetime,ti.planned_datetime)>=s and coalesce(ti.revised_datetime,ti.planned_datetime)<e
      union all
      select u,r.id,r.planned_datetime,r.actual_datetime,r.raw_status
      from report_fms_visit_rows(a,c-'user_profile_id',v_flow,v_stage,null,'planned') r cross join unnest(r.assigned_to) u
      where v_kind in ('all','fms') and r.status not in ('skipped','stopped') and r.raw_status<>'rejected' and r.planned_datetime is not null
    ), people as materialized (
      select up.id profile_id,up.employee_name,b.name branch_name,d.name department_name,
        count(w.wid) assigned,count(w.wid) filter(where w.st='completed') completed,
        count(w.wid) filter(where w.st<>'completed' and w.due>=now()) pending,count(w.wid) filter(where w.st<>'completed' and w.due<now()) overdue,
        count(w.wid) filter(where w.st='completed' and w.done_at<=w.due) on_time_completed,count(w.wid) filter(where w.st='completed' and w.done_at>w.due) delayed_completed,
        round(avg(extract(epoch from w.done_at-w.due)/60) filter(where w.st='completed' and w.done_at>w.due))::integer average_delay_minutes
      from user_profiles up left join work w on w.pid=up.id left join branches b on b.id=up.branch_id left join departments d on d.id=up.department_id
      where up.tenant_id=a.tenant_id and (a.user_role in ('super_admin','admin','hr') or up.branch_id=a.branch_id)
        and (v_branch is null or up.branch_id=v_branch) and (v_dept is null or up.department_id=v_dept) and (v_user is null or up.id=v_user)
        and (w.wid is not null or up.working_status not in ('inactive','resigned'))
      group by up.id,up.employee_name,b.name,d.name
    ), page as (select * from people order by employee_name,profile_id offset p_offset limit p_limit)
    select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
        'completion_rate',case when p.assigned=0 then null else round(100.0*p.completed/p.assigned,1) end,
        'on_time_rate',case when p.completed=0 then null else round(100.0*p.on_time_completed/p.completed,1) end) order by p.employee_name,p.profile_id),'[]'),
      (select count(*) from people),
      (select jsonb_build_object('assigned',coalesce(sum(assigned),0),'completed',coalesce(sum(completed),0),'pending',coalesce(sum(pending),0),'overdue',coalesce(sum(overdue),0),
        'on_time_completed',coalesce(sum(on_time_completed),0),'delayed_completed',coalesce(sum(delayed_completed),0)) from people)
      into v_rows,v_total,v_summary from page p;
  end if;

  return jsonb_build_object('report_key',p_report_key,'context',c,'rows',v_rows,'total',v_total,'offset',p_offset,'limit',p_limit)
    ||case when v_columns is null then '{}'::jsonb else jsonb_build_object('columns',v_columns) end
    ||case when v_summary is null then '{}'::jsonb else jsonb_build_object('summary',v_summary) end;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Filter choices for the Reports page (names only, in the reader's scope)
-- ---------------------------------------------------------------------------
create function get_report_filter_options(p_flow_family_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles;
begin
  perform assert_module_access('reports'); a:=assert_reporting_actor();
  return jsonb_build_object(
    'forms',(select coalesce(jsonb_agg(jsonb_build_object('id',fam,'name',name) order by lower(name),fam),'[]') from (
      select distinct on (coalesce(t.family_id,t.id)) coalesce(t.family_id,t.id) fam,t.name from form_templates t where t.tenant_id=a.tenant_id
      order by coalesce(t.family_id,t.id),t.version desc,t.updated_at desc) q),
    'flows',(select coalesce(jsonb_agg(jsonb_build_object('id',fam,'name',name) order by lower(name),fam),'[]') from (
      select distinct on (coalesce(f.family_id,f.id)) coalesce(f.family_id,f.id) fam,f.name from fms_flows f where f.tenant_id=a.tenant_id
      order by coalesce(f.family_id,f.id),f.version desc,f.updated_at desc) q),
    'stages',case when p_flow_family_id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',stage_key,'name',name) order by sort,name),'[]') from (
      select distinct on (s.stage_key) s.stage_key,s.name,s.sort_order sort from fms_stages s join fms_flows f on f.id=s.fms_flow_id
      where f.tenant_id=a.tenant_id and coalesce(f.family_id,f.id)=p_flow_family_id and s.step_type<>'end' and s.stage_key is not null
      order by s.stage_key,f.version desc) q) end,
    'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',employee_name) order by lower(employee_name),id),'[]') from user_profiles
      where tenant_id=a.tenant_id and working_status not in ('inactive','resigned')
        and (a.user_role in ('super_admin','admin','hr') or a.user_role='manager' and branch_id=a.branch_id or id=a.id)));
end $$;

-- ---------------------------------------------------------------------------
-- 6. CRM-owned business reports use the existing customer export path
-- ---------------------------------------------------------------------------
do $customer$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('request_customer_export(text,jsonb,uuid)'::regprocedure);
  v_new:=replace(v_def,$old$if p_key not in ('customer_master',$old$,
    $new$if p_key not in ('customer_report_master','customer_report_journey','customer_report_leads','customer_report_followups','customer_report_sources','customer_report_crm_staff','customer_report_sales','customer_master',$new$);
  if v_new=v_def then raise exception 'request_customer_export key list not found'; end if;
  execute v_new;
end $customer$;

revoke all on function report_answer_text(jsonb,jsonb,uuid),report_field_visible(jsonb,jsonb),report_submission_answers(jsonb,jsonb,uuid),
  report_fms_visit_rows(user_profiles,jsonb,uuid,text,text,text),report_employee_names(uuid[],uuid),
  report_rows_for_profile(uuid,text,jsonb,integer,integer),report_rows_for_profile_v1(uuid,text,jsonb,integer,integer) from public,anon,authenticated,service_role;
revoke all on function get_report_filter_options(uuid) from public,anon,authenticated,service_role;
grant execute on function get_report_filter_options(uuid) to authenticated;
notify pgrst,'reload schema';
