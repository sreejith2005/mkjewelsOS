-- Preserve all report consumers while applying configured authority to the current actor.
create or replace function reporting_context_for_actor(p_actor_id uuid,p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles; v_tenant tenants; v_preset text; v_today date; v_start date; v_end date; v_branch uuid; v_department uuid; v_user uuid; v_page integer; v_size integer;
begin
  perform assert_json_keys(coalesce(p_context,'{}'::jsonb),array['preset','from','to','branch_id','department_id','user_profile_id','status','page','page_size'],'report filter');
  -- Interactive reads use the centrally resolved dashboard authority. Background exports
  -- retain their existing explicit actor path when no current session actor matches.
  v_actor:=current_profile();
  if v_actor.id is distinct from p_actor_id then select * into v_actor from user_profiles where id=p_actor_id; end if;
  if v_actor.id is null or v_actor.working_status in ('inactive','resigned') or not v_actor.is_login_enabled then raise exception 'Active profile required' using errcode='42501'; end if;
  select * into v_tenant from tenants where id=v_actor.tenant_id and is_active;
  if v_tenant.id is null then raise exception 'Active tenant required' using errcode='42501'; end if;
  v_preset:=coalesce(p_context->>'preset','today'); v_today:=(now() at time zone v_tenant.timezone)::date;
  if v_preset='today' then v_start:=v_today; v_end:=v_today+1;
  elsif v_preset='this_week' then v_start:=date_trunc('week',v_today::timestamp)::date; v_end:=v_start+7;
  elsif v_preset='this_month' then v_start:=date_trunc('month',v_today::timestamp)::date; v_end:=(v_start+interval '1 month')::date;
  elsif v_preset='last_7_days' then v_start:=v_today-6; v_end:=v_today+1;
  elsif v_preset='last_30_days' then v_start:=v_today-29; v_end:=v_today+1;
  elsif v_preset='custom' then
    begin v_start:=(p_context->>'from')::date; v_end:=(p_context->>'to')::date+1; exception when others then raise exception 'Invalid custom date range' using errcode='22023'; end;
  else raise exception 'Unknown date range preset' using errcode='22023'; end if;
  if v_start is null or v_end is null or v_end<=v_start or v_end-v_start>366 then raise exception 'Date range must be 1-366 days' using errcode='22023'; end if;
  begin v_branch:=nullif(p_context->>'branch_id','')::uuid; v_department:=nullif(p_context->>'department_id','')::uuid; v_user:=nullif(p_context->>'user_profile_id','')::uuid; exception when others then raise exception 'Invalid UUID filter' using errcode='22023'; end;
  if v_actor.user_role not in ('super_admin','admin') and v_branch is not null and v_branch<>v_actor.branch_id then raise exception 'Branch filter denied' using errcode='42501'; end if;
  v_branch:=case when v_actor.user_role in ('super_admin','admin') then v_branch else v_actor.branch_id end;
  if v_branch is not null and not exists(select 1 from branches where id=v_branch and tenant_id=v_actor.tenant_id and is_active) then raise exception 'Branch filter denied' using errcode='42501'; end if;
  if v_department is not null and not exists(select 1 from departments d where d.id=v_department and d.tenant_id=v_actor.tenant_id and d.is_active and (v_branch is null or d.branch_id is null or d.branch_id=v_branch)) then raise exception 'Department filter denied' using errcode='42501'; end if;
  if v_actor.user_role not in ('super_admin','admin','manager','hr') and v_department is not null and v_department<>v_actor.department_id then raise exception 'Department filter denied' using errcode='42501'; end if;
  if v_user is not null and not exists(select 1 from user_profiles up where up.id=v_user and up.tenant_id=v_actor.tenant_id and (v_branch is null or up.branch_id=v_branch)) then raise exception 'User filter denied' using errcode='42501'; end if;
  if v_actor.user_role not in ('super_admin','admin','manager','hr') and v_user is not null and v_user<>v_actor.id then raise exception 'User filter denied' using errcode='42501'; end if;
  begin v_page:=coalesce((p_context->>'page')::integer,1); v_size:=coalesce((p_context->>'page_size')::integer,25); exception when others then raise exception 'Invalid pagination' using errcode='22023'; end;
  if v_page<1 or v_size not in (10,25,50,100) then raise exception 'Invalid pagination' using errcode='22023'; end if;
  if p_context ? 'status' and (p_context->>'status') !~ '^[a-z_]{1,40}$' then raise exception 'Invalid status filter' using errcode='22023'; end if;
  return jsonb_build_object('tenant_id',v_actor.tenant_id,'actor_id',v_actor.id,'role',v_actor.user_role,'timezone',v_tenant.timezone,
    'local_start',v_start,'local_end_exclusive',v_end,'start_at',v_start::timestamp at time zone v_tenant.timezone,
    'end_at',v_end::timestamp at time zone v_tenant.timezone,'branch_id',v_branch,'department_id',v_department,'user_profile_id',v_user,
    'status',nullif(p_context->>'status',''),'page',v_page,'page_size',v_size);
end $$;

-- Additive, versioned decision-support reads. No changes to installed-client RPCs.
create or replace function management_insights_context_v1(p_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles; c jsonb; base jsonb; preset text; today date; start_day date; end_day date; k text; filter_id uuid;
begin
 perform assert_module_access('dashboard'); a:=assert_reporting_actor();
 perform assert_json_keys(p_context,array['version','tab','preset','from','to','groupBy','branch_id','department_id','designation_id','user_profile_id','category_id','flow_id','stage_id','task_type','priority','status','source'],'insights filter');
 if coalesce(p_context->>'version','1')<>'1' then raise exception 'Unsupported filter version' using errcode='22023'; end if;
 if coalesce(p_context->>'tab','overview') not in ('overview','tasks','workflows','people','crm') or coalesce(p_context->>'groupBy','department') not in ('department','branch','designation','employee','task_type','workflow') then raise exception 'Invalid view' using errcode='22023'; end if;
 preset:=coalesce(p_context->>'preset','this_month');
 base:=jsonb_build_object('preset',preset)|| (p_context - array['version','tab','preset','groupBy','designation_id','category_id','flow_id','stage_id','task_type','priority','status','source']);
 if preset in ('this_quarter','this_year') then
  select (now() at time zone timezone)::date into today from tenants where id=a.tenant_id;
  start_day:=date_trunc(case when preset='this_year' then 'year' else 'quarter' end,today::timestamp)::date;
  base:=base||jsonb_build_object('preset','custom','from',start_day,'to',today);
 end if;
 c:=reporting_context_for_actor(a.id,base);
 -- Current week/month end at today for comparable partial-period analysis.
 if preset in ('this_week','this_month') then
  end_day:=(now() at time zone (c->>'timezone'))::date+1;
  c:=c||jsonb_build_object('local_end_exclusive',end_day,'end_at',end_day::timestamp at time zone (c->>'timezone'));
 end if;
 foreach k in array array['designation_id','category_id','flow_id','stage_id'] loop
  begin filter_id:=nullif(p_context->>k,'')::uuid; exception when others then raise exception 'Invalid scope identifier' using errcode='22023'; end;
  if filter_id is not null and (case when k='flow_id' then not exists(select 1 from fms_flows f where f.id=filter_id and f.tenant_id=a.tenant_id) when k='stage_id' then not exists(select 1 from fms_stages s join fms_flows f on f.id=s.fms_flow_id where s.id=filter_id and f.tenant_id=a.tenant_id) else not exists(select 1 from dropdown_masters d where d.id=filter_id and d.tenant_id=a.tenant_id and d.master_type=case when k='designation_id' then 'designation' else 'task_category' end) end) then raise exception 'Scope denied' using errcode='42501'; end if;
 end loop;
 foreach k in array array['task_type','priority','status','source'] loop
  if p_context ? k and (p_context->>k is null or p_context->>k !~ '^[a-z_]{1,40}$') then raise exception 'Invalid work filter' using errcode='22023'; end if;
 end loop;
 if p_context ? 'task_type' and not exists(select 1 from pg_enum where enumtypid='task_type'::regtype and enumlabel=p_context->>'task_type') then raise exception 'Invalid task type' using errcode='22023'; end if;
 if p_context ? 'priority' and p_context->>'priority' not in ('low','medium','high') then raise exception 'Invalid priority' using errcode='22023'; end if;
 if p_context ? 'status' and not exists(select 1 from pg_enum where enumtypid='task_status'::regtype and enumlabel=p_context->>'status') then raise exception 'Invalid status' using errcode='22023'; end if;
 return c||p_context||jsonb_build_object('branch_id',c->'branch_id','department_id',c->'department_id','user_profile_id',c->'user_profile_id','groupBy',coalesce(p_context->>'groupBy','department'));
end $$;

-- One source of records for summaries and drilldowns; no evidence/answers/private reasons.
create or replace function management_insights_rows_v1(c jsonb)
returns table(record jsonb,module text,status text,due timestamptz,completed timestamptz,branch_id uuid,department_id uuid,employee_ids uuid[],task_type text,flow_id uuid,uncovered boolean)
language plpgsql stable security definer set search_path=public as $$
declare a user_profiles;
begin
 a:=current_profile();
 if module_accessible('checklist_tasks') then
 return query select jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'due',task_effective_due_datetime(t),'completed',t.actual_datetime,'module','tasks','task_id',t.id,'availability_clash',module_accessible('availability') and task_effective_due_datetime(t) is not null and exists(select 1 from task_assignees ta where ta.task_instance_id=t.id and ta.is_active and (not is_user_available_for_task(ta.user_profile_id,(task_effective_due_datetime(t) at time zone (c->>'timezone'))::date) or leave_half_day_absent_at(ta.user_profile_id,task_effective_due_datetime(t)))),'awaiting_form',module_accessible('forms_library') and t.requires_form and t.form_template_id is not null and not exists(select 1 from form_submissions fs where fs.linked_record_id=t.id and fs.form_template_id=t.form_template_id and fs.linked_module in ('task','checklist_task','delegation_task'))),
  'tasks'::text,t.status::text,task_effective_due_datetime(t),t.actual_datetime,t.branch_id,t.department_id,
  array(select ta.user_profile_id from task_assignees ta where ta.task_instance_id=t.id and ta.is_active),t.task_type::text,null::uuid,t.coverage_status='coverage_required'
 from task_instances t where task_in_reporting_scope(a,t,c)
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
 if module_accessible('forms_library') then
 return query select jsonb_build_object('id',s.id,'title',f.name,'status',s.status,'due',s.submitted_at,'completed',s.reviewed_at,'module','forms','form_id',s.form_template_id),
  'forms'::text,s.status::text,s.submitted_at,s.reviewed_at,s.branch_id,s.department_id,array[s.submitted_by],null::text,null::uuid,false
 from form_submissions s join form_templates f on f.id=s.form_template_id join user_profiles u on u.id=s.submitted_by
 where s.tenant_id=a.tenant_id and (a.user_role in ('super_admin','admin') or a.user_role='manager' and s.branch_id=a.branch_id or s.submitted_by=a.id)
  and (c->>'branch_id' is null or s.branch_id=(c->>'branch_id')::uuid) and (c->>'department_id' is null or s.department_id=(c->>'department_id')::uuid)
  and (c->>'flow_id' is null and c->>'stage_id' is null or s.linked_module='fms_stage' and exists(select 1 from fms_instance_stages fs join fms_instances fi on fi.id=fs.fms_instance_id where fs.id=s.linked_record_id and (c->>'flow_id' is null or fi.fms_flow_id=(c->>'flow_id')::uuid) and (c->>'stage_id' is null or fs.fms_stage_id=(c->>'stage_id')::uuid)))
  and (c->>'user_profile_id' is null or s.submitted_by=(c->>'user_profile_id')::uuid) and (c->>'designation_id' is null or u.designation_id=(c->>'designation_id')::uuid);
 end if;
 if module_accessible('availability') and a.user_role in ('super_admin','admin','manager','hr') then
 return query select jsonb_build_object('id',u.id,'title',u.employee_name,'status',case when (is_user_available_for_task(u.id,(now() at time zone (c->>'timezone'))::date) and not leave_half_day_absent_at(u.id,now())) then 'available' else 'unavailable' end,'due',null,'completed',null,'module','people','employee_id',u.id),
  'people'::text,case when (is_user_available_for_task(u.id,(now() at time zone (c->>'timezone'))::date) and not leave_half_day_absent_at(u.id,now())) then 'available' else 'unavailable' end,null::timestamptz,null::timestamptz,u.branch_id,u.department_id,array[u.id],null::text,null::uuid,false
 from user_profiles u where u.tenant_id=a.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
  and (c->>'branch_id' is null or u.branch_id=(c->>'branch_id')::uuid) and (c->>'department_id' is null or u.department_id=(c->>'department_id')::uuid)
  and (c->>'user_profile_id' is null or u.id=(c->>'user_profile_id')::uuid) and (c->>'designation_id' is null or u.designation_id=(c->>'designation_id')::uuid);
 end if;
end $$;

create or replace function management_insights_metric_matches_v1(m text,r_module text,r_status text,r_due timestamptz,r_completed timestamptz,r_uncovered boolean,s timestamptz,e timestamptz,r_record jsonb default '{}')
returns boolean language sql stable set search_path=public as $$
 select case m
 when 'due' then r_module='tasks' and r_due>=s and r_due<e
 when 'cohort_completed' then r_module='tasks' and r_due>=s and r_due<e and r_status='completed'
 when 'on_time' then r_module='tasks' and r_due>=s and r_due<e and r_status='completed' and r_completed<=r_due
 when 'throughput' then r_module='tasks' and r_status='completed' and r_completed>=s and r_completed<e
 when 'open' then r_module='tasks' and r_status not in ('completed','rejected','cancelled')
 when 'overdue' then r_module='tasks' and r_status not in ('completed','rejected','cancelled') and r_due<now()
 when 'uncovered' then r_module='tasks' and r_status not in ('completed','rejected','cancelled') and r_uncovered
 when 'required_forms' then r_module='tasks' and r_status not in ('completed','rejected','cancelled') and coalesce((r_record->>'awaiting_form')::boolean,false)
 when 'active_stages' then r_module='workflows' and r_record->>'instance_id' is not null and r_status not in ('completed','rejected','cancelled')
 when 'blocked_stages' then r_module='workflows' and r_record->>'instance_id' is not null and (r_status in ('blocked','overdue') or r_status not in ('completed','rejected','cancelled') and r_due<now())
 when 'completed_stages' then r_module='workflows' and r_record->>'instance_id' is not null and r_status='completed' and r_completed>=s and r_completed<e
 when 'timed_completions' then r_module='tasks' and r_status='completed' and r_due>=s and r_due<e and r_completed is not null
 when 'availability_clashes' then r_module='tasks' and r_status not in ('completed','rejected','cancelled') and coalesce((r_record->>'availability_clash')::boolean,false)
 when 'review_stages' then r_module='workflows' and r_record->>'instance_id' is not null and r_record->>'step_type'='approval' and r_status not in ('completed','rejected','cancelled')
 when 'pending_starters' then r_module='workflows' and r_record->>'starter_id' is not null and r_status not in ('completed','rejected','cancelled')
 when 'completed_starters' then r_module='workflows' and r_record->>'starter_id' is not null and r_status='completed' and r_completed>=s and r_completed<e
 when 'aged_stages' then r_module='workflows' and r_record->>'instance_id' is not null and r_status not in ('completed','rejected','cancelled') and r_due<now()-interval '7 days'
 when 'aged_reviews' then r_module='forms' and r_status in ('submitted','pending','pending_review') and r_due<now()-interval '7 days'
 when 'rejected_tasks' then r_module='tasks' and r_status='rejected' and r_due>=s and r_due<e
 when 'open_instances' then r_module='workflows' and r_record->>'instance_id' is not null and r_status not in ('completed','rejected','cancelled')
 when 'submitted_forms' then r_module='forms' and r_due>=s and r_due<e
 when 'review_forms' then r_module='forms' and r_status in ('submitted','pending','pending_review')
 when 'active_people' then r_module='people'
 when 'available_people' then r_module='people' and r_status='available'
 else false end;
$$;

create or replace function management_insights_group_rows_v1(c jsonb)
returns table(group_id text,group_name text,record_id text,module text,status text,due timestamptz,completed timestamptz)
language sql stable security definer set search_path=public as $$
 select case c->>'groupBy' when 'employee' then u.id::text when 'designation' then u.designation_id::text when 'branch' then r.branch_id::text when 'task_type' then r.task_type when 'workflow' then r.flow_id::text else r.department_id::text end,
  coalesce(case c->>'groupBy' when 'employee' then u.employee_name when 'designation' then des.label when 'branch' then b.name when 'task_type' then initcap(replace(r.task_type,'_',' ')) when 'workflow' then f.name else d.name end,'Unassigned / unknown'),
  r.record->>'id',r.module,r.status,r.due,r.completed
 from management_insights_rows_v1(c) r
 left join lateral unnest(case when c->>'groupBy' in ('employee','designation') then r.employee_ids else array[null::uuid] end) emp(id) on true
 left join user_profiles u on u.id=emp.id left join dropdown_masters des on des.id=u.designation_id
 left join branches b on b.id=r.branch_id left join departments d on d.id=r.department_id left join fms_flows f on f.id=r.flow_id
 where (r.record->>'starter_id' is null or r.status not in ('completed','rejected','cancelled')) and case coalesce(c->>'tab','overview') when 'people' then r.module='people' when 'workflows' then r.module='workflows' when 'crm' then false else r.module='tasks' end;
$$;

create or replace function get_management_insights_v1(p_context jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c jsonb; s timestamptz; e timestamptz; prev timestamptz; metrics jsonb; groups jsonb; trend jsonb;
begin
 c:=management_insights_context_v1(coalesce(p_context,'{}'));s:=(c->>'start_at')::timestamptz;e:=(c->>'end_at')::timestamptz;prev:=s-(e-s);
 with rows as materialized(select * from management_insights_rows_v1(c)), defs(key,label,module,basis) as (values
 ('due','Tasks due','tasks','cohort'),('cohort_completed','Completed due work','tasks','cohort'),('on_time','Completed on time','tasks','cohort'),('throughput','Completions in period','tasks','period'),
 ('open','Open tasks','tasks','current'),('overdue','Overdue tasks','tasks','current'),('uncovered','Tasks needing coverage','tasks','current'),('timed_completions','Completed due work with recorded times','tasks','cohort'),('availability_clashes','Open tasks with availability clashes','tasks','current'),('review_stages','Workflow approval stages waiting','workflows','current'),
 ('active_stages','Open workflow assignments','workflows','current'),('blocked_stages','Blocked or overdue stages','workflows','current'),('completed_stages','Runtime stages completed','workflows','period'),('pending_starters','Pending starter assignments','workflows','current'),('completed_starters','Completed starters (current assignee scope)','workflows','period'),('aged_stages','Open stages more than 7 days overdue','workflows','current'),('aged_reviews','Form reviews waiting over 7 days','forms','current'),('rejected_tasks','Rejected due-period tasks','tasks','cohort'),
 ('submitted_forms','Forms submitted','forms','period'),('review_forms','Forms awaiting review','forms','current'),('required_forms','Required task forms outstanding','forms','current'),('active_people','Active people','people','current'),('available_people','Available today','people','current')),
 counts as (select defs.*,count(*) filter(where management_insights_metric_matches_v1(key,r.module,status,due,completed,uncovered,s,e,r.record))::int value,
 count(*) filter(where management_insights_metric_matches_v1(key,r.module,status,due,completed,uncovered,prev,s,r.record))::int previous from defs left join rows r on true group by 1,2,3,4),
 values_with_rate as(select *,null::numeric numerator,null::numeric denominator,null::text unit from counts
 union all select 'completion_rate','Due work completion','tasks','cohort',
 case when (select value from counts where key='due')=0 then null else round(100.0*(select value from counts where key='cohort_completed')/(select value from counts where key='due'),1) end,
 null,(select value from counts where key='cohort_completed'),(select value from counts where key='due'),'percent'
 union all select 'task_pending_score','Work not done score','tasks','cohort',case when (select value from counts where key='due')=0 then null else round(100.0*(select value from counts where key='cohort_completed')/(select value from counts where key='due')-100,1) end,null,(select value from counts where key='cohort_completed'),(select value from counts where key='due'),'percent'
 union all select 'task_delayed_score','Work not done on time score','tasks','cohort',case when (select value from counts where key='due')=0 then null when (select value from counts where key='cohort_completed')=0 then -100 else round(100.0*(select value from counts where key='on_time')/(select value from counts where key='cohort_completed')-100,1) end,null,(select value from counts where key='on_time'),(select value from counts where key='cohort_completed'),'percent'
 union all select 'on_time_rate','On-time completed work','tasks','cohort',case when (select value from counts where key='timed_completions')=0 then null else round(100.0*(select value from counts where key='on_time')/(select value from counts where key='timed_completions'),1) end,null,(select value from counts where key='on_time'),(select value from counts where key='timed_completions'),'percent'
 union all select 'open_instances','Instances with visible open stages','workflows','current',count(distinct r.record->>'instance_id'),null,null,null,null from rows r where r.module='workflows' and r.record->>'instance_id' is not null and r.status not in ('completed','rejected','cancelled'))
 select coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'module',module,'basis',basis,'value',value,'previous',case when basis='current' then null else previous end,'numerator',numerator,'denominator',denominator,'unit',unit)),'[]') into metrics from values_with_rate
 where case module when 'tasks' then module_accessible('checklist_tasks') when 'workflows' then module_accessible('fms_builder') when 'forms' then module_accessible('forms_library') else module_accessible('availability') and (c->>'role') in ('super_admin','admin','manager','hr') end;
 select coalesce(jsonb_agg(to_jsonb(g) order by g.overdue desc,g.open desc,g.name),'[]') into groups from (
  select coalesce(group_id,'unknown') id,group_name name,count(distinct record_id)::int total,
  count(distinct record_id) filter(where status='completed' or module='people' and status='available')::int completed,
  count(distinct record_id) filter(where status not in ('completed','rejected','cancelled','available'))::int open,
  count(distinct record_id) filter(where status not in ('completed','rejected','cancelled','available') and due<now())::int overdue,
  count(distinct record_id) filter(where status='completed' and completed<=due)::int on_time
  from management_insights_group_rows_v1(c) where (due>=s and due<e) or status not in ('completed','rejected','cancelled') group by 1,2
 ) g;
 with r as materialized(select * from management_insights_rows_v1(c)), days as (select generate_series((c->>'local_start')::date,((c->>'local_end_exclusive')::date-1),case when e-s>interval '60 days' then interval '7 days' else interval '1 day' end) bucket)
 select coalesce(jsonb_agg(jsonb_build_object('date',bucket::date,'due',(select count(*) from r where module='tasks' and due>=bucket::timestamp at time zone (c->>'timezone') and due<(bucket+case when e-s>interval '60 days' then interval '7 days' else interval '1 day' end)::timestamp at time zone (c->>'timezone') and due<e),
 'completed',(select count(*) from r where module='tasks' and status='completed' and completed>=bucket::timestamp at time zone (c->>'timezone') and completed<(bucket+case when e-s>interval '60 days' then interval '7 days' else interval '1 day' end)::timestamp at time zone (c->>'timezone') and completed<e)) order by bucket),'[]') into trend from days;
 return jsonb_build_object('version',1,'generatedAt',now(),'timezone',c->>'timezone','from',c->>'local_start','to',((c->>'local_end_exclusive')::date-1),
 'scopeLabel',case when c->>'branch_id' is null then 'All authorized branches' else 'Authorized branch scope' end,
 'moduleStates',jsonb_build_object('tasks',module_accessible('checklist_tasks'),'workflows',module_accessible('fms_builder'),'forms',module_accessible('forms_library'),'people',module_accessible('availability') and c->>'role' in ('super_admin','admin','manager','hr'),'crm',false),
 'metrics',metrics,'groups',groups,'trend',trend,'groupBasis',case c->>'groupBy' when 'employee' then 'Employee assignments; shared tasks count once per employee' when 'designation' then 'Current employee designation; historical assignments retained' else case when c->>'tab'='workflows' then 'Runtime recorded scope; pending starters use current assignee organization. Completed starters excluded to avoid counting initial stages twice.' else 'Recorded work scope; current backlog plus due-period work' end end,
 'missingDeadline',(select count(*) from management_insights_rows_v1(c) where module in ('tasks','workflows') and due is null and status not in ('completed','rejected','cancelled')));
end $$;

create or replace function get_management_insight_records_v1(p_context jsonb,p_metric text,p_group_id text default null,p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c jsonb; result jsonb;
begin
 c:=management_insights_context_v1(coalesce(p_context,'{}'));
 if p_offset is null or p_limit is null or p_metric is null or p_offset<0 or p_limit not between 1 and 100 or p_metric not in ('due','cohort_completed','on_time','throughput','open','overdue','uncovered','active_stages','blocked_stages','completed_stages','submitted_forms','review_forms','required_forms','active_people','available_people','completion_rate','task_pending_score','task_delayed_score','pending_starters','completed_starters','aged_stages','aged_reviews','rejected_tasks','open_instances','timed_completions','on_time_rate','availability_clashes','review_stages','group_work') then raise exception 'Invalid detail selector' using errcode='22023';end if;
 if p_metric='open_instances' then
  if p_group_id is not null then raise exception 'Instance grouping selector unsupported' using errcode='22023';end if;
  with instances as materialized(select distinct on (record->>'instance_id') (record-'stage_id')||jsonb_build_object('id',record->>'instance_id') record from management_insights_rows_v1(c) where module='workflows' and record->>'instance_id' is not null and status not in ('completed','rejected','cancelled') order by record->>'instance_id',record->>'id'),page as(select record from instances order by record->>'id' offset p_offset limit p_limit)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(record) from page),'[]'),'total',(select count(*) from instances),'offset',p_offset,'limit',p_limit) into result;return result;
 end if;
 with rows as materialized(select r.* from management_insights_rows_v1(c) r where (p_metric='group_work' and exists(select 1 from management_insights_group_rows_v1(c) g where g.record_id=r.record->>'id' and ((g.due>=(c->>'start_at')::timestamptz and g.due<(c->>'end_at')::timestamptz) or g.status not in ('completed','rejected','cancelled'))) or management_insights_metric_matches_v1(case when p_metric in ('completion_rate','task_pending_score') then 'due' when p_metric='task_delayed_score' then 'cohort_completed' when p_metric='on_time_rate' then 'timed_completions' else p_metric end,r.module,r.status,r.due,r.completed,r.uncovered,(c->>'start_at')::timestamptz,(c->>'end_at')::timestamptz,r.record))
 and (p_group_id is null or exists(select 1 from management_insights_group_rows_v1(c) g where g.record_id=r.record->>'id' and coalesce(g.group_id,'unknown')=p_group_id))),
 page as(select record from rows order by due nulls last,record->>'id' offset p_offset limit p_limit)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(record) from page),'[]'),'total',(select count(*) from rows),'offset',p_offset,'limit',p_limit) into result;
 return result;
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
 'sources',coalesce((select jsonb_agg(jsonb_build_object('id',source,'name',initcap(replace(source,'_',' ')))) from (select distinct t.source from task_instances t where module_accessible('checklist_tasks') and task_in_reporting_scope(a,t,c) and source is not null) sources),'[]'));
end $$;

revoke all on function management_insights_context_v1(jsonb),management_insights_rows_v1(jsonb),management_insights_group_rows_v1(jsonb),management_insights_metric_matches_v1(text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function get_management_insights_v1(jsonb),get_management_insight_records_v1(jsonb,text,text,integer,integer),get_management_insights_options_v1(jsonb) from public,anon;
grant execute on function get_management_insights_v1(jsonb),get_management_insight_records_v1(jsonb,text,text,integer,integer),get_management_insights_options_v1(jsonb) to authenticated;
