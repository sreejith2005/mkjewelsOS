-- 0296: Dashboard request budget, Task Control FMS cancellation, report export jobs.
--
-- 1. get_management_insights_v1 built its authorized rows four times per request
--    (metrics, groups, trend, missing deadlines). Each build is ~2 s for a
--    tenant-wide actor on production, so the RPC reached the 8 s statement limit
--    of the authenticated role and the Dashboard failed to open for Super
--    Admins/Admins. Rows are now built once per request and reused. The row
--    source (management_insights_rows_v1) and the grouping rules are unchanged:
--    grouping moves into management_insights_group_rows_from_v1 so the original
--    management_insights_group_rows_v1(c) and the new path share one definition.
-- 2. cancel_fms_starter_assignment_with_audit lets Task Control remove a pending
--    FMS start-form assignment. FMS steps are removed by the existing
--    cancel_fms_instance_with_audit (whole run, history preserved).
-- 3. schedule_report_export_jobs(url) creates the cron job that runs the
--    process-report-exports worker. Without it requested CSV exports stayed
--    queued forever. Same Vault/pg_cron pattern as schedule_kiara_jobs (0227).
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Insights: one row build per request
-- ---------------------------------------------------------------------------
create type management_insight_row_v1 as (
  record jsonb, module text, status text, due timestamptz, completed timestamptz,
  branch_id uuid, department_id uuid, employee_ids uuid[], task_type text, flow_id uuid, uncovered boolean);
create type management_insight_group_row_v1 as (
  group_id text, group_name text, record_id text, module text, status text, due timestamptz, completed timestamptz);

create or replace function management_insights_rows_array_v1(c jsonb)
returns management_insight_row_v1[] language sql stable security definer set search_path=public as $$
 select coalesce(array_agg(row(r.record,r.module,r.status,r.due,r.completed,r.branch_id,r.department_id,r.employee_ids,r.task_type,r.flow_id,r.uncovered)::management_insight_row_v1),'{}')
 from management_insights_rows_v1(c) r;
$$;

-- Grouping rules of 0206, applied to rows already built for this request.
create or replace function management_insights_group_rows_from_v1(c jsonb,p_rows management_insight_row_v1[])
returns setof management_insight_group_row_v1 language sql stable security definer set search_path=public as $$
 select case c->>'groupBy' when 'employee' then u.id::text when 'designation' then u.designation_id::text when 'branch' then r.branch_id::text when 'task_type' then r.task_type when 'workflow' then r.flow_id::text else r.department_id::text end,
  coalesce(case c->>'groupBy' when 'employee' then u.employee_name when 'designation' then des.label when 'branch' then b.name when 'task_type' then initcap(replace(r.task_type,'_',' ')) when 'workflow' then f.name else d.name end,'Unassigned / unknown'),
  r.record->>'id',r.module,r.status,r.due,r.completed
 from unnest(p_rows) r
 left join lateral unnest(case when c->>'groupBy' in ('employee','designation') then r.employee_ids else array[null::uuid] end) emp(id) on true
 left join user_profiles u on u.id=emp.id left join dropdown_masters des on des.id=u.designation_id
 left join branches b on b.id=r.branch_id left join departments d on d.id=r.department_id left join fms_flows f on f.id=r.flow_id
 where (r.record->>'starter_id' is null or r.status not in ('completed','rejected','cancelled')) and case coalesce(c->>'tab','overview') when 'people' then r.module='people' when 'workflows' then r.module='workflows' when 'crm' then false else r.module='tasks' end;
$$;

create or replace function management_insights_group_rows_v1(c jsonb)
returns table(group_id text,group_name text,record_id text,module text,status text,due timestamptz,completed timestamptz)
language sql stable security definer set search_path=public as $$
 select * from management_insights_group_rows_from_v1(c,management_insights_rows_array_v1(c));
$$;

create or replace function get_management_insights_v1(p_context jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c jsonb; s timestamptz; e timestamptz; prev timestamptz; metrics jsonb; groups jsonb; trend jsonb; v_rows management_insight_row_v1[]; v_missing integer;
begin
 c:=management_insights_context_v1(coalesce(p_context,'{}'));s:=(c->>'start_at')::timestamptz;e:=(c->>'end_at')::timestamptz;prev:=s-(e-s);
 v_rows:=management_insights_rows_array_v1(c);
 with rows as materialized(select * from unnest(v_rows)), defs(key,label,module,basis) as (values
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
  from management_insights_group_rows_from_v1(c,v_rows) where (due>=s and due<e) or status not in ('completed','rejected','cancelled') group by 1,2
 ) g;
 with r as materialized(select * from unnest(v_rows)), days as (select generate_series((c->>'local_start')::date,((c->>'local_end_exclusive')::date-1),case when e-s>interval '60 days' then interval '7 days' else interval '1 day' end) bucket)
 select coalesce(jsonb_agg(jsonb_build_object('date',bucket::date,'due',(select count(*) from r where module='tasks' and due>=bucket::timestamp at time zone (c->>'timezone') and due<(bucket+case when e-s>interval '60 days' then interval '7 days' else interval '1 day' end)::timestamp at time zone (c->>'timezone') and due<e),
 'completed',(select count(*) from r where module='tasks' and status='completed' and completed>=bucket::timestamp at time zone (c->>'timezone') and completed<(bucket+case when e-s>interval '60 days' then interval '7 days' else interval '1 day' end)::timestamp at time zone (c->>'timezone') and completed<e)) order by bucket),'[]') into trend from days;
 select count(*) into v_missing from unnest(v_rows) r where r.module in ('tasks','workflows') and r.due is null and r.status not in ('completed','rejected','cancelled');
 return jsonb_build_object('version',1,'generatedAt',now(),'timezone',c->>'timezone','from',c->>'local_start','to',((c->>'local_end_exclusive')::date-1),
 'scopeLabel',case when c->>'branch_id' is null then 'All authorized branches' else 'Authorized branch scope' end,
 'moduleStates',jsonb_build_object('tasks',module_accessible('checklist_tasks'),'workflows',module_accessible('fms_builder'),'forms',module_accessible('forms_library'),'people',module_accessible('availability') and c->>'role' in ('super_admin','admin','manager','hr'),'crm',false),
 'metrics',metrics,'groups',groups,'trend',trend,'groupBasis',case c->>'groupBy' when 'employee' then 'Employee assignments; shared tasks count once per employee' when 'designation' then 'Current employee designation; historical assignments retained' else case when c->>'tab'='workflows' then 'Runtime recorded scope; pending starters use current assignee organization. Completed starters excluded to avoid counting initial stages twice.' else 'Recorded work scope; current backlog plus due-period work' end end,
 'missingDeadline',v_missing);
end $$;

-- Drill-down: same selectors and rules; rows and groups built once.
create or replace function get_management_insight_records_v1(p_context jsonb,p_metric text,p_group_id text default null,p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c jsonb; result jsonb; v_rows management_insight_row_v1[]; v_groups management_insight_group_row_v1[];
begin
 c:=management_insights_context_v1(coalesce(p_context,'{}'));
 if p_offset is null or p_limit is null or p_metric is null or p_offset<0 or p_limit not between 1 and 100 or p_metric not in ('due','cohort_completed','on_time','throughput','open','overdue','uncovered','active_stages','blocked_stages','completed_stages','submitted_forms','review_forms','required_forms','active_people','available_people','completion_rate','task_pending_score','task_delayed_score','pending_starters','completed_starters','aged_stages','aged_reviews','rejected_tasks','open_instances','timed_completions','on_time_rate','availability_clashes','review_stages','group_work') then raise exception 'Invalid detail selector' using errcode='22023';end if;
 v_rows:=management_insights_rows_array_v1(c);
 if p_metric='open_instances' then
  if p_group_id is not null then raise exception 'Instance grouping selector unsupported' using errcode='22023';end if;
  with instances as materialized(select distinct on (record->>'instance_id') (record-'stage_id')||jsonb_build_object('id',record->>'instance_id') record from unnest(v_rows) where module='workflows' and record->>'instance_id' is not null and status not in ('completed','rejected','cancelled') order by record->>'instance_id',record->>'id'),page as(select record from instances order by record->>'id' offset p_offset limit p_limit)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(record) from page),'[]'),'total',(select count(*) from instances),'offset',p_offset,'limit',p_limit) into result;return result;
 end if;
 if p_metric='group_work' or p_group_id is not null then
  select coalesce(array_agg(g),'{}') into v_groups from management_insights_group_rows_from_v1(c,v_rows) g;
 end if;
 with grouped as materialized(select * from unnest(coalesce(v_groups,'{}'))),
 rows as materialized(select r.* from unnest(v_rows) r where (p_metric='group_work' and exists(select 1 from grouped g where g.record_id=r.record->>'id' and ((g.due>=(c->>'start_at')::timestamptz and g.due<(c->>'end_at')::timestamptz) or g.status not in ('completed','rejected','cancelled'))) or management_insights_metric_matches_v1(case when p_metric in ('completion_rate','task_pending_score') then 'due' when p_metric='task_delayed_score' then 'cohort_completed' when p_metric='on_time_rate' then 'timed_completions' else p_metric end,r.module,r.status,r.due,r.completed,r.uncovered,(c->>'start_at')::timestamptz,(c->>'end_at')::timestamptz,r.record))
 and (p_group_id is null or exists(select 1 from grouped g where g.record_id=r.record->>'id' and coalesce(g.group_id,'unknown')=p_group_id))),
 page as(select record from rows order by due nulls last,record->>'id' offset p_offset limit p_limit)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(record) from page),'[]'),'total',(select count(*) from rows),'offset',p_offset,'limit',p_limit) into result;
 return result;
end $$;

revoke all on function management_insights_rows_array_v1(jsonb),management_insights_group_rows_from_v1(jsonb,management_insight_row_v1[]),management_insights_group_rows_v1(jsonb) from public,anon,authenticated;
revoke all on function get_management_insights_v1(jsonb),get_management_insight_records_v1(jsonb,text,text,integer,integer) from public,anon;
grant execute on function get_management_insights_v1(jsonb),get_management_insight_records_v1(jsonb,text,text,integer,integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Task Control: cancel a pending FMS start-form assignment
-- ---------------------------------------------------------------------------
-- Same authority as cancelling an FMS run (set_fms_instance_status_with_audit):
-- Super Admin/Admin tenant-wide, Manager for assignees in their branch. The row is
-- kept (status 'cancelled'), so queue_fms_starter_assignments' (flow,user)
-- uniqueness does not re-create it, and its open alert is closed, not deleted.
create or replace function cancel_fms_starter_assignment_with_audit(p_assignment_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_row fms_starter_assignments; v_assignee user_profiles;
begin
 perform assert_module_enabled('task_templates');
 select * into v_actor from current_profile();
 if v_actor.id is null or not current_profile_is_active() then raise exception 'Start form cancellation denied' using errcode='42501'; end if;
 select * into v_row from fms_starter_assignments where id=p_assignment_id and tenant_id=v_actor.tenant_id for update;
 select * into v_assignee from user_profiles where id=v_row.user_profile_id;
 if v_row.id is null or not (v_actor.user_role in ('super_admin','admin') or v_actor.user_role='manager' and v_assignee.branch_id=v_actor.branch_id) then
  raise exception 'Start form cancellation denied' using errcode='42501'; end if;
 if nullif(btrim(p_reason),'') is null or length(p_reason)>1000 then raise exception 'A concise reason is required' using errcode='22023'; end if;
 if v_row.status<>'pending' then raise exception 'Only a pending start form can be cancelled' using errcode='23514'; end if;
 update fms_starter_assignments set status='cancelled' where id=v_row.id;
 update notifications set is_read=true,read_at=coalesce(read_at,now())
  where tenant_id=v_row.tenant_id and user_profile_id=v_row.user_profile_id and event_type='fms_starter_assigned'
    and source_module='fms' and source_record_id=v_row.id and not is_read;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_row.tenant_id,v_actor.id,'fms_starter_assignment_cancelled','fms_starter_assignments',v_row.id,
   jsonb_build_object('status',v_row.status),jsonb_build_object('status','cancelled','reason',btrim(p_reason)));
end $$;
revoke all on function cancel_fms_starter_assignment_with_audit(uuid,text) from public,anon,service_role;
grant execute on function cancel_fms_starter_assignment_with_audit(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Report export worker schedule (hosted operator step, like 0227)
-- ---------------------------------------------------------------------------
create or replace function schedule_report_export_jobs(p_function_url text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_secrets integer; v_cron name; v_command text;
begin
  select n.nspname into v_cron from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = to_regclass('cron.job');
  if v_cron is null then raise exception 'pg_cron is not installed' using errcode = '23514'; end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then raise exception 'pg_net is not installed' using errcode = '23514'; end if;
  if to_regclass('vault.secrets') is null then raise exception 'Vault is not available' using errcode = '23514'; end if;
  if p_function_url is null or p_function_url !~ '^https://[a-z0-9.-]+/functions/v1/process-report-exports$' then raise exception 'Invalid worker URL' using errcode = '22023'; end if;
  execute $q$select count(*)::integer from vault.secrets where name = 'report_exports_cron_secret'$q$ into v_secrets;
  if v_secrets <> 1 then raise exception 'Report export jobs need exactly one Vault secret named report_exports_cron_secret' using errcode = '23514'; end if;
  v_command := format('select net.http_post(url := %L, headers := jsonb_build_object(''Content-Type'', ''application/json'', '
    || '''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''report_exports_cron_secret'')), '
    || 'body := ''{}''::jsonb, timeout_milliseconds := 60000);', p_function_url);
  execute format('select %I.schedule($1, $2, $3)', v_cron) using 'process-report-exports', '* * * * *', v_command;
  return jsonb_build_object('scheduled', jsonb_build_array('process-report-exports'));
end $$;
alter function schedule_report_export_jobs(text) owner to postgres;
revoke all on function schedule_report_export_jobs(text) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
