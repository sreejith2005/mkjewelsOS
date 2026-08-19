-- Production dashboards, fixed reports, asynchronous CSV exports, and settings.
-- Analytics are live, indexed, tenant-timezone aware, and scoped in PostgreSQL.

set search_path = public, extensions;

-- --------------------------------------------------------------------------
-- Settings and export job schema
-- --------------------------------------------------------------------------

alter table tenants
  add column settings jsonb not null default '{}'::jsonb,
  add column settings_version integer not null default 1,
  add column export_retention_days integer not null default 7,
  add column export_max_rows integer not null default 50000,
  add constraint tenants_settings_object check (jsonb_typeof(settings)='object'),
  add constraint tenants_settings_version check (settings_version>0),
  add constraint tenants_export_retention check (export_retention_days between 1 and 30),
  add constraint tenants_export_max_rows check (export_max_rows between 100 and 100000);

alter table branches
  add column settings jsonb not null default '{}'::jsonb,
  add column settings_version integer not null default 1,
  add constraint branches_settings_object check (jsonb_typeof(settings)='object'),
  add constraint branches_settings_version check (settings_version>0);

create table user_preferences (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_profile_id uuid not null references user_profiles(id) on delete cascade,
  preferences jsonb not null default jsonb_build_object(
    'default_landing_page','home','dashboard_range','today',
    'table_density','comfortable','timezone_display','tenant'
  ),
  record_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references user_profiles(id),
  unique(user_profile_id),
  constraint user_preferences_object check(jsonb_typeof(preferences)='object'),
  constraint user_preferences_version check(record_version>0)
);

alter table export_logs rename column export_type to report_key;
alter table export_logs rename column filters to filter_snapshot;
alter table export_logs rename column file_url to object_path;
alter table export_logs rename column created_at to requested_at;
-- Retain legacy history without preserving old URL-shaped file references or
-- allowing pre-contract jobs to enter the new worker queue.
update export_logs set report_key='legacy_export',filter_snapshot=coalesce(filter_snapshot,'{}'::jsonb),object_path=null;
alter table export_logs
  alter column requested_at set not null,
  add column format text not null default 'csv',
  add column status text not null default 'queued',
  add column requester_role user_role not null default 'staff',
  add column scope_snapshot jsonb not null default '{}'::jsonb,
  add column progress_percent integer not null default 0,
  add column row_count integer,
  add column sanitized_error text,
  add column attempt_count integer not null default 0,
  add column max_attempts integer not null default 3,
  add column claimed_by uuid,
  add column claimed_at timestamptz,
  add column claim_expires_at timestamptz,
  add column started_at timestamptz,
  add column completed_at timestamptz,
  add column failed_at timestamptz,
  add column cancelled_at timestamptz,
  add column expires_at timestamptz,
  add column cleaned_at timestamptz,
  add column request_key uuid not null default uuid_generate_v4(),
  add column updated_at timestamptz not null default now(),
  add constraint export_logs_report_key check(report_key in (
    'task_operations','task_completion_delay','fms_instances_stages','fms_sla',
    'form_submissions_reviews','crm_clients_ownership','crm_walkins','crm_interactions',
    'crm_followups','people_availability','people_task_performance',
    'notification_delivery_health','legacy_export'
  )),
  add constraint export_logs_format check(format='csv'),
  add constraint export_logs_status check(status in ('queued','processing','completed','failed','cancelled','expired')),
  add constraint export_logs_progress check(progress_percent between 0 and 100),
  add constraint export_logs_rows check(row_count is null or row_count>=0),
  add constraint export_logs_attempts check(attempt_count between 0 and 10 and max_attempts between 1 and 10),
  add constraint export_logs_filter_object check(jsonb_typeof(filter_snapshot)='object'),
  add constraint export_logs_scope_object check(jsonb_typeof(scope_snapshot)='object'),
  add constraint export_logs_path check(object_path is null or object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[a-z0-9_-]+-[0-9]{4}-[0-9]{2}-[0-9]{2}\.csv$'),
  add constraint export_logs_terminal check(
    (status='completed' and object_path is not null and completed_at is not null and expires_at is not null)
    or (status='failed' and failed_at is not null)
    or (status='cancelled' and cancelled_at is not null)
    or (status='expired' and expires_at is not null)
    or status in ('queued','processing')
  ),
  add constraint export_logs_request_unique unique(tenant_id,user_profile_id,request_key);

update export_logs set status='expired',expires_at=coalesce(requested_at,now()),cleaned_at=now(),updated_at=now()
where report_key='legacy_export';
alter table export_logs alter column request_key drop default;

drop index if exists idx_export_logs_tenant_user_created;
create index idx_export_logs_requester_history on export_logs(tenant_id,user_profile_id,requested_at desc,id);
create index idx_export_logs_claim on export_logs(status,requested_at,id) where status in ('queued','processing');
create index idx_export_logs_expiry on export_logs(expires_at,id) where status='completed' and cleaned_at is null;

create index idx_task_instances_reporting on task_instances(tenant_id,branch_id,department_id,planned_datetime,status,id);
create index idx_task_assignees_reporting on task_assignees(user_profile_id,is_active,task_instance_id);
create index idx_task_checklists_reporting on task_checklists(task_instance_id,is_required,is_completed);
create index idx_fms_stages_reporting on fms_instance_stages(fms_instance_id,status,planned_datetime,actual_datetime,id);
create index idx_fms_actor_reporting on fms_instance_stage_assignees(tenant_id,user_profile_id,is_active,fms_instance_stage_id);
create index idx_form_submissions_reporting on form_submissions(tenant_id,branch_id,department_id,submitted_at,status,id);
create index idx_audit_logs_home on audit_logs(tenant_id,actor_user_id,created_at desc,id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('report-exports','report-exports',false,52428800,array['text/csv','application/csv','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table user_preferences enable row level security;
alter table export_logs enable row level security;

revoke all on user_preferences,export_logs from public,anon,authenticated,service_role;
grant select on user_preferences,export_logs to authenticated;

drop policy if exists user_preferences_select on user_preferences;
create policy user_preferences_select on user_preferences for select to authenticated
using(current_profile_is_active() and tenant_id=current_tenant_id() and user_profile_id=(current_profile()).id);
drop policy if exists export_logs_select on export_logs;
create policy export_logs_select on export_logs for select to authenticated
using(current_profile_is_active() and tenant_id=current_tenant_id() and (user_profile_id=(current_profile()).id or current_role_level() in ('super_admin','admin')));

-- --------------------------------------------------------------------------
-- Shared validation and scope helpers
-- --------------------------------------------------------------------------

create function assert_reporting_actor()
returns user_profiles language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or v_actor.working_status in ('inactive','resigned') or not v_actor.is_login_enabled then
    raise exception 'Active profile required' using errcode='42501';
  end if;
  return v_actor;
end $$;

create function assert_json_keys(p_value jsonb,p_allowed text[],p_label text)
returns void language plpgsql immutable set search_path=public as $$
declare v_key text;
begin
  if p_value is null or jsonb_typeof(p_value)<>'object' then raise exception '% must be an object',p_label using errcode='22023'; end if;
  for v_key in select jsonb_object_keys(p_value) loop
    if not (v_key=any(p_allowed)) then raise exception 'Unknown % key: %',p_label,v_key using errcode='22023'; end if;
  end loop;
end $$;

create function reporting_context_for_actor(p_actor_id uuid,p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles; v_tenant tenants; v_preset text; v_today date; v_start date; v_end date; v_branch uuid; v_department uuid; v_user uuid; v_page integer; v_size integer;
begin
  perform assert_json_keys(coalesce(p_context,'{}'::jsonb),array['preset','from','to','branch_id','department_id','user_profile_id','status','page','page_size'],'report filter');
  select * into v_actor from user_profiles where id=p_actor_id;
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

create function task_in_reporting_scope(p_actor user_profiles,p_task task_instances,p_context jsonb)
returns boolean language sql stable security definer set search_path=public as $$
  select p_task.tenant_id=p_actor.tenant_id
    and ((p_context->>'branch_id') is null or p_task.branch_id=(p_context->>'branch_id')::uuid)
    and ((p_context->>'department_id') is null or p_task.department_id=(p_context->>'department_id')::uuid)
    and (
      p_actor.user_role in ('super_admin','admin')
      or p_actor.user_role='manager' and p_task.branch_id=p_actor.branch_id
      or exists(select 1 from task_assignees ta where ta.task_instance_id=p_task.id and ta.user_profile_id=p_actor.id and ta.is_active)
    )
    and ((p_context->>'user_profile_id') is null or exists(select 1 from task_assignees ta where ta.task_instance_id=p_task.id and ta.user_profile_id=(p_context->>'user_profile_id')::uuid and ta.is_active));
$$;

create function fms_stage_in_reporting_scope(p_actor user_profiles,p_stage_id uuid,p_context jsonb)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id
    where fis.id=p_stage_id and fi.tenant_id=p_actor.tenant_id
      and ((p_context->>'branch_id') is null or fi.branch_id=(p_context->>'branch_id')::uuid)
      and ((p_context->>'department_id') is null or fi.department_id=(p_context->>'department_id')::uuid)
      and (p_actor.user_role in ('super_admin','admin') or p_actor.user_role='manager' and fi.branch_id=p_actor.branch_id
        or exists(select 1 from fms_instance_stage_assignees a where a.fms_instance_stage_id=fis.id and a.user_profile_id=p_actor.id and a.is_active))
      and ((p_context->>'user_profile_id') is null or exists(select 1 from fms_instance_stage_assignees a where a.fms_instance_stage_id=fis.id and a.user_profile_id=(p_context->>'user_profile_id')::uuid and a.is_active)));
$$;

-- --------------------------------------------------------------------------
-- Home and dashboard read contracts
-- --------------------------------------------------------------------------

create function get_home_summary(p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles; v_context jsonb; v_today date; v_start timestamptz; v_end timestamptz; v_tasks jsonb; v_fms jsonb; v_forms jsonb; v_followups jsonb; v_activity jsonb; v_unread integer; v_availability text; v_actions jsonb;
begin
  v_actor:=assert_reporting_actor();
  perform assert_json_keys(coalesce(p_context,'{}'::jsonb),array[]::text[],'home context');
  v_context:=reporting_context_for_actor(v_actor.id,jsonb_build_object('preset','today'));
  v_today:=(v_context->>'local_start')::date; v_start:=(v_context->>'start_at')::timestamptz; v_end:=(v_context->>'end_at')::timestamptz;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.overdue desc,q.priority_order,q.due_at,q.id),'[]'::jsonb) into v_tasks from (
    select ti.id,ti.title,ti.task_type,ti.priority,ti.status,coalesce(ti.revised_datetime,ti.planned_datetime) due_at,
      (ti.status not in ('completed','rejected') and coalesce(ti.revised_datetime,ti.planned_datetime)<now()) overdue,
      case ti.priority when 'high' then 1 when 'medium' then 2 else 3 end priority_order,
      coalesce((select round(100.0*count(*) filter(where tc.is_completed)/nullif(count(*),0),1) from task_checklists tc where tc.task_instance_id=ti.id and tc.is_required),null) checklist_completion
    from task_instances ti where task_in_reporting_scope(v_actor,ti,v_context)
      and (coalesce(ti.revised_datetime,ti.planned_datetime)>=v_start and coalesce(ti.revised_datetime,ti.planned_datetime)<v_end
        or ti.status not in ('completed','rejected') and coalesce(ti.revised_datetime,ti.planned_datetime)<v_start)
    order by overdue desc,priority_order,due_at,id limit 10
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.planned_datetime,q.stage_id),'[]'::jsonb) into v_fms from (
    select fis.id stage_id,fi.id instance_id,fi.reference_number,fi.title instance_title,fs.name stage_name,fis.status,fis.planned_datetime,fis.sla_breached
    from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id
    where fis.status in ('pending','in_progress','in_review','blocked','overdue') and fms_stage_in_reporting_scope(v_actor,fis.id,v_context)
    order by fis.planned_datetime nulls last,fis.id limit 6
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.due_at,q.task_id),'[]'::jsonb) into v_forms from (
    select ti.id task_id,ti.form_template_id,ft.name form_name,ti.title task_title,coalesce(ti.revised_datetime,ti.planned_datetime) due_at
    from task_instances ti join form_templates ft on ft.id=ti.form_template_id
    where ti.requires_form and ti.form_template_id is not null and ti.status not in ('completed','rejected') and task_in_reporting_scope(v_actor,ti,v_context)
      and exists(select 1 from task_assignees ta where ta.task_instance_id=ti.id and ta.user_profile_id=v_actor.id and ta.is_active)
      and not exists(select 1 from form_submissions fs where fs.linked_module='task' and fs.linked_record_id=ti.id and fs.form_template_id=ti.form_template_id and fs.submitted_by=v_actor.id)
    order by due_at,ti.id limit 6
  ) q;

  if v_actor.user_role in ('super_admin','admin','manager','crm') then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.overdue desc,q.due_date,q.id),'[]'::jsonb) into v_followups from (
      select f.id,f.client_id,f.subject,f.due_date,f.status,f.due_date<v_today overdue
      from client_followups f where f.tenant_id=v_actor.tenant_id and f.status='open' and f.due_date<=v_today
        and can_read_crm_client(f.client_id) and (v_actor.user_role<>'crm' or f.assigned_to=v_actor.id or f.branch_id=v_actor.branch_id)
      order by overdue desc,f.due_date,f.id limit 6
    ) q;
  else v_followups:='[]'::jsonb; end if;

  select count(*)::integer into v_unread from notifications n where n.tenant_id=v_actor.tenant_id and n.user_profile_id=v_actor.id and not n.is_read;
  select ua.status::text into v_availability from user_availability ua where ua.user_profile_id=v_actor.id and ua.date=v_today;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]'::jsonb) into v_activity from (
    select a.id,a.action,a.module,a.created_at from audit_logs a where a.tenant_id=v_actor.tenant_id
      and (a.actor_user_id=v_actor.id or v_actor.user_role in ('super_admin','admin') or v_actor.user_role='manager' and exists(select 1 from user_profiles p where p.id=a.actor_user_id and p.branch_id=v_actor.branch_id))
    order by a.created_at desc,a.id desc limit 8
  ) q;
  v_actions:=case
    when v_actor.user_role in ('super_admin','admin','manager') then '["/tasks/checklist","/tasks/delegation","/tasks/fms","/forms","/reports"]'::jsonb
    when v_actor.user_role='crm' then '["/crm","/tasks/checklist","/tasks/fms","/forms","/reports"]'::jsonb
    else '["/tasks/checklist","/tasks/delegation","/tasks/fms","/forms"]'::jsonb end;
  return jsonb_build_object('generated_at',now(),'tenant_local_date',v_today,'timezone',v_context->>'timezone',
    'profile',jsonb_build_object('id',v_actor.id,'name',v_actor.employee_name,'role',v_actor.user_role,'branch_id',v_actor.branch_id,
      'branch_name',(select b.name from branches b where b.id=v_actor.branch_id),'department_id',v_actor.department_id,
      'department_name',(select d.name from departments d where d.id=v_actor.department_id),'working_status',v_actor.working_status),
    'tasks',v_tasks,'fms_stages',v_fms,'forms_awaiting_submission',v_forms,'crm_followups',v_followups,
    'unread_notifications',v_unread,'availability_status',v_availability,'recent_activity',v_activity,'quick_actions',v_actions);
end $$;

create function get_dashboard_metrics(p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles; c jsonb; v_start timestamptz; v_end timestamptz; v_days integer; v_prev_start timestamptz; v_metrics jsonb; v_trend jsonb; v_status jsonb; v_previous jsonb; v_task_assigned integer; v_task_completed integer; v_check_total integer; v_check_done integer; v_people_active integer; v_people_available integer;
begin
  v_actor:=assert_reporting_actor(); c:=reporting_context_for_actor(v_actor.id,coalesce(p_context,'{}'::jsonb));
  v_start:=(c->>'start_at')::timestamptz; v_end:=(c->>'end_at')::timestamptz; v_days:=(c->>'local_end_exclusive')::date-(c->>'local_start')::date; v_prev_start:=v_start-(v_days||' days')::interval;
  select count(*) filter(where ti.planned_datetime>=v_start and ti.planned_datetime<v_end),
    count(*) filter(where ti.actual_datetime>=v_start and ti.actual_datetime<v_end and ti.status='completed')
  into v_task_assigned,v_task_completed from task_instances ti where task_in_reporting_scope(v_actor,ti,c);
  select count(*) filter(where tc.is_required),count(*) filter(where tc.is_required and tc.is_completed) into v_check_total,v_check_done
  from task_checklists tc join task_instances ti on ti.id=tc.task_instance_id where ti.planned_datetime>=v_start and ti.planned_datetime<v_end and task_in_reporting_scope(v_actor,ti,c);

  select jsonb_build_object(
    'tasks_assigned',v_task_assigned,'tasks_completed',v_task_completed,
    'task_completion_rate',case when v_task_assigned=0 then null else round(100.0*v_task_completed/v_task_assigned,1) end,
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
  select jsonb_build_object('tasks_assigned',count(*) filter(where ti.planned_datetime>=v_prev_start and ti.planned_datetime<v_start),'tasks_completed',count(*) filter(where ti.status='completed' and ti.actual_datetime>=v_prev_start and ti.actual_datetime<v_start)) into v_previous from task_instances ti where task_in_reporting_scope(v_actor,ti,c);
  return jsonb_build_object('generated_at',now(),'freshness','live','context',c,'metrics',v_metrics,'previous',v_previous,'task_completion_trend',v_trend,'task_status_distribution',v_status);
end $$;

-- --------------------------------------------------------------------------
-- Fixed report catalog read contract
-- --------------------------------------------------------------------------

create function client_in_reporting_scope(p_actor user_profiles,p_client_id uuid,p_context jsonb)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from clients cl where cl.id=p_client_id and cl.tenant_id=p_actor.tenant_id and cl.status<>'merged'
    and ((p_context->>'branch_id') is null or cl.branch_id=(p_context->>'branch_id')::uuid)
    and (p_actor.user_role in ('super_admin','admin') or p_actor.user_role='manager' and cl.branch_id=p_actor.branch_id
      or p_actor.user_role='crm' and (cl.assigned_crm_id=p_actor.id or cl.branch_id=p_actor.branch_id or exists(select 1 from client_assignments ca where ca.client_id=cl.id and ca.user_profile_id=p_actor.id and ca.is_active))));
$$;

create function report_allowed_for_role(p_key text,p_role user_role,p_export boolean default false)
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
    else false end;
$$;

create function report_max_days(p_key text)
returns integer language sql immutable set search_path=public as $$
  select case when p_key in ('task_operations','people_availability','notification_delivery_health') then 90
    when p_key in ('fms_instances_stages','crm_walkins','crm_interactions','crm_followups') then 180 else 366 end;
$$;

create function report_rows_for_profile(p_profile_id uuid,p_report_key text,p_filters jsonb,p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles; c jsonb; s timestamptz; e timestamptz; d1 date; d2 date; v_rows jsonb:='[]'::jsonb; v_total bigint:=0;
begin
  select * into a from user_profiles where id=p_profile_id;
  if a.id is null or a.working_status in ('inactive','resigned') or not a.is_login_enabled then raise exception 'Active profile required' using errcode='42501'; end if;
  if not report_allowed_for_role(p_report_key,a.user_role,false) then raise exception 'Report access denied' using errcode='42501'; end if;
  if p_offset<0 or p_limit<1 or p_limit>1000 then raise exception 'Invalid report pagination' using errcode='22023'; end if;
  c:=reporting_context_for_actor(a.id,coalesce(p_filters,'{}'::jsonb)); s:=(c->>'start_at')::timestamptz; e:=(c->>'end_at')::timestamptz; d1:=(c->>'local_start')::date; d2:=(c->>'local_end_exclusive')::date;
  if d2-d1>report_max_days(p_report_key) then raise exception 'Report date range exceeds maximum' using errcode='22023'; end if;

  if p_report_key='task_operations' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.planned_datetime,q.task_id),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select ti.id task_id,ti.title,ti.task_type::text,ti.priority::text,ti.status::text,coalesce(ti.revised_datetime,ti.planned_datetime) planned_datetime,
        coalesce((select string_agg(up.employee_name,', ' order by up.employee_name,up.id) from task_assignees ta join user_profiles up on up.id=ta.user_profile_id where ta.task_instance_id=ti.id and ta.is_active),'Unassigned') assignee_name,
        (select case when count(*) filter(where tc.is_required)=0 then null else round(100.0*count(*) filter(where tc.is_required and tc.is_completed)/count(*) filter(where tc.is_required),1) end from task_checklists tc where tc.task_instance_id=ti.id) checklist_completion,
        count(*) over() _total
      from task_instances ti where task_in_reporting_scope(a,ti,c) and coalesce(ti.revised_datetime,ti.planned_datetime)>=s and coalesce(ti.revised_datetime,ti.planned_datetime)<e and ((c->>'status') is null or ti.status::text=c->>'status')
      order by planned_datetime,ti.id offset p_offset limit p_limit) q;
  elsif p_report_key='task_completion_delay' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.actual_datetime desc,q.task_id),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select ti.id task_id,ti.title,coalesce((select string_agg(up.employee_name,', ' order by up.employee_name,up.id) from task_assignees ta join user_profiles up on up.id=ta.user_profile_id where ta.task_instance_id=ti.id and ta.is_active),'Unassigned') assignee_name,
        coalesce(ti.revised_datetime,ti.planned_datetime) planned_datetime,ti.actual_datetime,(ti.actual_datetime<=coalesce(ti.revised_datetime,ti.planned_datetime)) on_time,greatest(coalesce(ti.delay_minutes,0),0) delay_minutes,count(*) over() _total
      from task_instances ti where task_in_reporting_scope(a,ti,c) and ti.status='completed' and ti.actual_datetime>=s and ti.actual_datetime<e
      order by ti.actual_datetime desc,ti.id offset p_offset limit p_limit) q;
  elsif p_report_key='fms_instances_stages' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.planned_datetime,q.instance_id,q.stage_id),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select fi.id instance_id,fis.id stage_id,fi.reference_number,ff.name flow_name,fi.status::text instance_status,fs.name stage_name,fis.status::text stage_status,fis.planned_datetime,
        coalesce((select string_agg(up.employee_name,', ' order by up.employee_name,up.id) from fms_instance_stage_assignees fa join user_profiles up on up.id=fa.user_profile_id where fa.fms_instance_stage_id=fis.id and fa.is_active),'Unassigned') assignee_name,count(*) over() _total
      from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_flows ff on ff.id=fi.fms_flow_id join fms_stages fs on fs.id=fis.fms_stage_id
      where fms_stage_in_reporting_scope(a,fis.id,c) and coalesce(fis.planned_datetime,fi.started_at)>=s and coalesce(fis.planned_datetime,fi.started_at)<e and ((c->>'status') is null or fis.status::text=c->>'status')
      order by fis.planned_datetime nulls last,fi.id,fis.id offset p_offset limit p_limit) q;
  elsif p_report_key='fms_sla' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.planned_datetime,q.instance_id,q.stage_id),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select fi.id instance_id,fis.id stage_id,fi.reference_number,fs.name stage_name,fis.planned_datetime,fis.actual_datetime,
        case when fis.sla_breached or fis.delay_minutes>0 then 'breached' when fis.status='completed' then 'on_time' when fis.planned_datetime<now() then 'at_risk' else 'within_sla' end sla_state,greatest(coalesce(fis.delay_minutes,0),0) delay_minutes,count(*) over() _total
      from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id
      where fms_stage_in_reporting_scope(a,fis.id,c) and coalesce(fis.actual_datetime,fis.planned_datetime)>=s and coalesce(fis.actual_datetime,fis.planned_datetime)<e and ((c->>'status') is null or (case when fis.sla_breached or fis.delay_minutes>0 then 'breached' when fis.status='completed' then 'on_time' when fis.planned_datetime<now() then 'at_risk' else 'within_sla' end)=c->>'status')
      order by fis.planned_datetime nulls last,fi.id,fis.id offset p_offset limit p_limit) q;
  elsif p_report_key='form_submissions_reviews' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.submitted_at desc,q.submission_id),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select fs.id submission_id,ft.name form_name,fs.status::text,fs.submitted_at,submitter.employee_name submitted_by_name,fs.reviewed_at,reviewer.employee_name reviewed_by_name,count(*) over() _total
      from form_submissions fs join form_templates ft on ft.id=fs.form_template_id left join user_profiles submitter on submitter.id=fs.submitted_by left join user_profiles reviewer on reviewer.id=fs.reviewed_by
      where fs.tenant_id=a.tenant_id and fs.submitted_at>=s and fs.submitted_at<e and ((c->>'branch_id') is null or fs.branch_id=(c->>'branch_id')::uuid) and ((c->>'department_id') is null or fs.department_id=(c->>'department_id')::uuid)
        and (a.user_role in ('super_admin','admin') or a.user_role='manager' and fs.branch_id=a.branch_id or fs.submitted_by=a.id) and ((c->>'status') is null or fs.status::text=c->>'status') and ((c->>'user_profile_id') is null or fs.submitted_by=(c->>'user_profile_id')::uuid)
      order by fs.submitted_at desc,fs.id offset p_offset limit p_limit) q;
  elsif p_report_key='crm_clients_ownership' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.created_at desc,q.client_id),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select cl.id client_id,b.name branch_name,owner.employee_name owner_name,cl.status,cl.created_at,
        (nullif(btrim(cl.first_name),'') is not null and cl.normalized_phone is not null and cl.email is not null and cl.date_of_birth is not null) profile_complete,count(*) over() _total
      from clients cl left join branches b on b.id=cl.branch_id left join user_profiles owner on owner.id=cl.assigned_crm_id
      where client_in_reporting_scope(a,cl.id,c) and cl.created_at>=s and cl.created_at<e and ((c->>'status') is null or cl.status=c->>'status') and ((c->>'user_profile_id') is null or cl.assigned_crm_id=(c->>'user_profile_id')::uuid)
      order by cl.created_at desc,cl.id offset p_offset limit p_limit) q;
  elsif p_report_key='crm_walkins' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.visit_date desc,q.walkin_id),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select w.id walkin_id,w.client_id,b.name branch_name,w.visit_date,owner.employee_name crm_owner_name,coalesce(dm.label,w.buy_status) buy_status,count(*) over() _total
      from walkin_entries w left join branches b on b.id=w.branch_id left join user_profiles owner on owner.id=w.crm_id left join dropdown_masters dm on dm.id=w.buy_status_id
      where client_in_reporting_scope(a,w.client_id,c) and w.visit_date>=s and w.visit_date<e and ((c->>'branch_id') is null or w.branch_id=(c->>'branch_id')::uuid) and ((c->>'user_profile_id') is null or w.crm_id=(c->>'user_profile_id')::uuid)
      order by w.visit_date desc,w.id offset p_offset limit p_limit) q;
  elsif p_report_key='crm_interactions' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.occurred_at desc,q.interaction_id),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select t.id interaction_id,t.client_id,t.event_type,t.subject,t.outcome,t.occurred_at,up.employee_name actor_name,count(*) over() _total
      from client_timeline t left join user_profiles up on up.id=t.created_by where client_in_reporting_scope(a,t.client_id,c) and t.occurred_at>=s and t.occurred_at<e and ((c->>'status') is null or t.outcome=c->>'status') and ((c->>'user_profile_id') is null or t.created_by=(c->>'user_profile_id')::uuid)
      order by t.occurred_at desc,t.id offset p_offset limit p_limit) q;
  elsif p_report_key='crm_followups' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.due_date,q.followup_id),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select f.id followup_id,f.client_id,f.subject,f.due_date,f.status,up.employee_name assignee_name,f.completed_at,count(*) over() _total
      from client_followups f left join user_profiles up on up.id=f.assigned_to where client_in_reporting_scope(a,f.client_id,c) and f.due_date>=d1 and f.due_date<d2 and ((c->>'status') is null or f.status=c->>'status') and ((c->>'user_profile_id') is null or f.assigned_to=(c->>'user_profile_id')::uuid)
      order by f.due_date,f.id offset p_offset limit p_limit) q;
  elsif p_report_key='people_availability' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.date desc,q.profile_id),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select up.id profile_id,up.employee_name,b.name branch_name,d.name department_name,up.working_status::text,ua.date,ua.status::text availability_status,count(*) over() _total
      from user_profiles up left join user_availability ua on ua.user_profile_id=up.id and ua.date>=d1 and ua.date<d2 left join branches b on b.id=up.branch_id left join departments d on d.id=up.department_id
      where up.tenant_id=a.tenant_id and (a.user_role in ('super_admin','admin','hr') or up.branch_id=a.branch_id) and ((c->>'branch_id') is null or up.branch_id=(c->>'branch_id')::uuid) and ((c->>'department_id') is null or up.department_id=(c->>'department_id')::uuid) and ((c->>'status') is null or coalesce(ua.status::text,up.working_status::text)=c->>'status') and ((c->>'user_profile_id') is null or up.id=(c->>'user_profile_id')::uuid)
      order by ua.date desc nulls last,up.id offset p_offset limit p_limit) q;
  elsif p_report_key='people_task_performance' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.employee_name,q.profile_id),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select up.id profile_id,up.employee_name,count(distinct ti.id) tasks_assigned,count(distinct ti.id) filter(where ti.status='completed' and ti.actual_datetime>=s and ti.actual_datetime<e) tasks_completed,
        case when count(distinct ti.id)=0 then null else round(100.0*count(distinct ti.id) filter(where ti.status='completed' and ti.actual_datetime>=s and ti.actual_datetime<e)/count(distinct ti.id),1) end completion_rate,
        count(distinct ti.id) filter(where ti.status='completed' and ti.actual_datetime>=s and ti.actual_datetime<e and ti.actual_datetime<=coalesce(ti.revised_datetime,ti.planned_datetime)) on_time_completed,
        count(distinct ti.id) filter(where ti.status not in ('completed','rejected') and coalesce(ti.revised_datetime,ti.planned_datetime)<now()) overdue_open,
        round(avg(greatest(coalesce(ti.delay_minutes,0),0)) filter(where ti.status='completed' and ti.actual_datetime>=s and ti.actual_datetime<e),1) average_delay_minutes,count(*) over() _total
      from user_profiles up left join task_assignees ta on ta.user_profile_id=up.id and ta.is_active left join task_instances ti on ti.id=ta.task_instance_id and ti.planned_datetime>=s and ti.planned_datetime<e
      where up.tenant_id=a.tenant_id and (a.user_role in ('super_admin','admin','hr') or up.branch_id=a.branch_id) and ((c->>'branch_id') is null or up.branch_id=(c->>'branch_id')::uuid) and ((c->>'department_id') is null or up.department_id=(c->>'department_id')::uuid) and ((c->>'user_profile_id') is null or up.id=(c->>'user_profile_id')::uuid)
      group by up.id,up.employee_name order by up.employee_name,up.id offset p_offset limit p_limit) q;
  elsif p_report_key='notification_delivery_health' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.channel,q.status),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select nd.channel,nd.state status,count(*) delivery_count,sum(nd.attempt_count) retry_count,max(nd.updated_at) latest_attempt_at,count(*) over() _total
      from notification_deliveries nd where nd.tenant_id=a.tenant_id and nd.created_at>=s and nd.created_at<e and ((c->>'status') is null or nd.state=c->>'status') group by nd.channel,nd.state
      order by nd.channel,nd.state offset p_offset limit p_limit) q;
  elsif p_report_key='export_history' then
    select coalesce(jsonb_agg(to_jsonb(q)-'_total' order by q.requested_at desc,q.export_id),'[]'),coalesce(max(q._total),0) into v_rows,v_total from (
      select x.id export_id,x.report_key,x.status,x.progress_percent,x.row_count,x.requested_at,x.expires_at,up.employee_name requester_name,count(*) over() _total
      from export_logs x join user_profiles up on up.id=x.user_profile_id where x.tenant_id=a.tenant_id and (x.user_profile_id=a.id or a.user_role in ('super_admin','admin')) and x.requested_at>=s and x.requested_at<e and ((c->>'status') is null or x.status=c->>'status') and ((c->>'user_profile_id') is null or x.user_profile_id=(c->>'user_profile_id')::uuid)
      order by x.requested_at desc,x.id offset p_offset limit p_limit) q;
  else raise exception 'Unknown report key' using errcode='22023'; end if;
  return jsonb_build_object('report_key',p_report_key,'context',c,'rows',v_rows,'total',v_total,'offset',p_offset,'limit',p_limit);
end $$;

create function get_report_data(p_report_key text,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles; c jsonb;
begin
  a:=assert_reporting_actor(); c:=reporting_context_for_actor(a.id,coalesce(p_filters,'{}'::jsonb));
  return report_rows_for_profile(a.id,p_report_key,p_filters,((c->>'page')::integer-1)*(c->>'page_size')::integer,(c->>'page_size')::integer);
end $$;

-- --------------------------------------------------------------------------
-- Asynchronous private CSV exports
-- --------------------------------------------------------------------------

create function request_report_export_with_audit(p_report_key text,p_filters jsonb,p_request_key uuid)
returns export_logs language plpgsql security definer set search_path=public as $$
declare a user_profiles; c jsonb; v_existing export_logs; v_new export_logs;
begin
  a:=assert_reporting_actor();
  if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if;
  if not report_allowed_for_role(p_report_key,a.user_role,true) then raise exception 'Report export denied' using errcode='42501'; end if;
  c:=reporting_context_for_actor(a.id,coalesce(p_filters,'{}'::jsonb));
  if (c->>'local_end_exclusive')::date-(c->>'local_start')::date>report_max_days(p_report_key) then raise exception 'Report date range exceeds maximum' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(a.tenant_id::text||a.id::text||p_request_key::text,0));
  select * into v_existing from export_logs where tenant_id=a.tenant_id and user_profile_id=a.id and request_key=p_request_key;
  if v_existing.id is not null then
    if v_existing.report_key<>p_report_key or v_existing.filter_snapshot<>coalesce(p_filters,'{}'::jsonb) then raise exception 'Request key already used with different input' using errcode='23505'; end if;
    return v_existing;
  end if;
  insert into export_logs(tenant_id,user_profile_id,report_key,filter_snapshot,requester_role,scope_snapshot,request_key)
  values(a.tenant_id,a.id,p_report_key,coalesce(p_filters,'{}'::jsonb),a.user_role,jsonb_build_object('tenant_id',a.tenant_id,'branch_id',c->'branch_id','department_id',c->'department_id','user_profile_id',c->'user_profile_id'),p_request_key)
  returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(a.tenant_id,a.id,'report_export_requested','exports',v_new.id,jsonb_build_object('report_key',p_report_key,'request_key',p_request_key,'status','queued'));
  return v_new;
end $$;

create function cancel_report_export_with_audit(p_export_id uuid,p_request_key uuid)
returns export_logs language plpgsql security definer set search_path=public as $$
declare a user_profiles; x export_logs;
begin
  a:=assert_reporting_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if;
  select * into x from export_logs where id=p_export_id for update;
  if x.id is null or x.tenant_id<>a.tenant_id or not (x.user_profile_id=a.id or a.user_role in ('super_admin','admin')) then raise exception 'Export not found' using errcode='42501'; end if;
  if x.status='cancelled' then return x; end if;
  if x.status not in ('queued','processing') then raise exception 'Export cannot be cancelled' using errcode='55000'; end if;
  update export_logs set status='cancelled',cancelled_at=now(),claimed_by=null,claimed_at=null,claim_expires_at=null,updated_at=now() where id=x.id returning * into x;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'report_export_cancelled','exports',x.id,jsonb_build_object('request_key',p_request_key,'status','cancelled'));
  return x;
end $$;

create function retry_report_export_with_audit(p_export_id uuid,p_request_key uuid)
returns export_logs language plpgsql security definer set search_path=public as $$
declare a user_profiles; x export_logs;
begin
  a:=assert_reporting_actor(); if p_request_key is null then raise exception 'Request key is required' using errcode='22023'; end if;
  select * into x from export_logs where id=p_export_id for update;
  if x.id is null or x.tenant_id<>a.tenant_id or not (x.user_profile_id=a.id or a.user_role in ('super_admin','admin')) then raise exception 'Export not found' using errcode='42501'; end if;
  if x.status not in ('failed','expired') or x.attempt_count>=x.max_attempts then raise exception 'Export cannot be retried' using errcode='55000'; end if;
  update export_logs set status='queued',progress_percent=0,row_count=null,object_path=null,sanitized_error=null,failed_at=null,completed_at=null,expires_at=null,cleaned_at=null,claimed_by=null,claimed_at=null,claim_expires_at=null,updated_at=now() where id=x.id returning * into x;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'report_export_retried','exports',x.id,jsonb_build_object('request_key',p_request_key,'status','queued'));
  return x;
end $$;

create function claim_report_exports(p_limit integer,p_worker_id uuid,p_lease_minutes integer default 10)
returns table(id uuid,tenant_id uuid,report_key text,filter_snapshot jsonb,user_profile_id uuid,attempt_number integer,max_rows integer)
language plpgsql security definer set search_path=public as $$
begin
  if current_user not in ('service_role','postgres') then raise exception 'Worker access denied' using errcode='42501'; end if;
  if p_limit not between 1 and 20 or p_worker_id is null or p_lease_minutes not between 1 and 30 then raise exception 'Invalid worker claim' using errcode='22023'; end if;
  update export_logs set status='queued',claimed_by=null,claimed_at=null,claim_expires_at=null,updated_at=now()
  where status='processing' and claim_expires_at<now() and attempt_count<max_attempts;
  update export_logs set status='failed',failed_at=now(),sanitized_error='retry_limit_reached',claimed_by=null,claimed_at=null,claim_expires_at=null,updated_at=now()
  where status='processing' and claim_expires_at<now() and attempt_count>=max_attempts;
  return query with candidates as (
    select x.id from export_logs x where x.status='queued' and x.attempt_count<x.max_attempts order by x.requested_at,x.id for update skip locked limit p_limit
  ), claimed as (
    update export_logs x set status='processing',started_at=coalesce(x.started_at,now()),claimed_by=p_worker_id,claimed_at=now(),claim_expires_at=now()+make_interval(mins=>p_lease_minutes),attempt_count=x.attempt_count+1,updated_at=now()
    from candidates c where x.id=c.id returning x.*
  ) select cl.id,cl.tenant_id,cl.report_key,cl.filter_snapshot,cl.user_profile_id,cl.attempt_count,least(t.export_max_rows,coalesce((b.settings->>'export_max_rows')::integer,t.export_max_rows))
    from claimed cl join tenants t on t.id=cl.tenant_id left join user_profiles up on up.id=cl.user_profile_id left join branches b on b.id=up.branch_id;
end $$;

create function get_report_export_batch(p_export_id uuid,p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare x export_logs;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Worker access denied' using errcode='42501'; end if;
  if p_offset<0 or p_limit not between 1 and 1000 then raise exception 'Invalid export batch' using errcode='22023'; end if;
  select * into x from export_logs where id=p_export_id;
  if x.id is null or x.status not in ('processing','cancelled') then raise exception 'Export job is not processing' using errcode='55000'; end if;
  if x.status='cancelled' then return jsonb_build_object('cancelled',true,'rows','[]'::jsonb,'total',0); end if;
  return report_rows_for_profile(x.user_profile_id,x.report_key,x.filter_snapshot,p_offset,p_limit);
end $$;

create function update_report_export_progress(p_export_id uuid,p_worker_id uuid,p_progress integer,p_row_count integer)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if current_user not in ('service_role','postgres') then raise exception 'Worker access denied' using errcode='42501'; end if;
  if p_progress not between 0 and 99 or p_row_count<0 then raise exception 'Invalid export progress' using errcode='22023'; end if;
  update export_logs set progress_percent=greatest(progress_percent,p_progress),row_count=p_row_count,claim_expires_at=now()+interval '10 minutes',updated_at=now()
  where id=p_export_id and status='processing' and claimed_by=p_worker_id;
  return found;
end $$;

create function finish_report_export(p_export_id uuid,p_worker_id uuid,p_outcome text,p_object_path text default null,p_row_count integer default null,p_error_code text default null)
returns text language plpgsql security definer set search_path=public as $$
declare x export_logs; v_retention integer;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Worker access denied' using errcode='42501'; end if;
  if p_outcome not in ('completed','failed','cancelled') then raise exception 'Invalid export outcome' using errcode='22023'; end if;
  select * into x from export_logs where id=p_export_id for update;
  if x.id is null then raise exception 'Export not found' using errcode='22023'; end if;
  if x.status='cancelled' then return 'cancelled'; end if;
  if x.status='completed' then return 'completed'; end if;
  if x.status<>'processing' or x.claimed_by<>p_worker_id then raise exception 'Export claim lost' using errcode='55000'; end if;
  if p_outcome='completed' then
    if p_object_path is null or p_row_count is null or p_row_count<0 then raise exception 'Completed export metadata required' using errcode='22023'; end if;
    select export_retention_days into v_retention from tenants where id=x.tenant_id;
    update export_logs set status='completed',object_path=p_object_path,row_count=p_row_count,progress_percent=100,completed_at=now(),expires_at=now()+make_interval(days=>v_retention),claimed_by=null,claimed_at=null,claim_expires_at=null,updated_at=now() where id=x.id;
  elsif p_outcome='failed' then
    if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{1,63}$' then p_error_code:='export_processing_failed'; end if;
    update export_logs set status='failed',sanitized_error=p_error_code,failed_at=now(),claimed_by=null,claimed_at=null,claim_expires_at=null,updated_at=now() where id=x.id;
  else
    update export_logs set status='cancelled',cancelled_at=now(),claimed_by=null,claimed_at=null,claim_expires_at=null,updated_at=now() where id=x.id;
  end if;
  return p_outcome;
end $$;

create function claim_report_export_cleanup(p_limit integer)
returns table(id uuid,object_path text) language plpgsql security definer set search_path=public as $$
begin
  if current_user not in ('service_role','postgres') then raise exception 'Worker access denied' using errcode='42501'; end if;
  if p_limit not between 1 and 100 then raise exception 'Invalid cleanup limit' using errcode='22023'; end if;
  return query with candidates as (select x.id from export_logs x where x.status='completed' and x.expires_at<=now() and x.cleaned_at is null order by x.expires_at,x.id for update skip locked limit p_limit), expired as (
    update export_logs x set status='expired',updated_at=now() from candidates c where x.id=c.id returning x.id,x.object_path,x.tenant_id,x.user_profile_id
  ) select ex.id,ex.object_path from expired ex;
end $$;

create function mark_report_export_cleaned(p_export_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare x export_logs;
begin
  if current_user not in ('service_role','postgres') then raise exception 'Worker access denied' using errcode='42501'; end if;
  update export_logs set cleaned_at=now(),object_path=null,updated_at=now() where id=p_export_id and status='expired' returning * into x;
  if x.id is not null then insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(x.tenant_id,x.user_profile_id,'report_export_cleaned','exports',x.id,jsonb_build_object('status','expired')); end if;
  return x.id is not null;
end $$;

create function get_report_export_download_url(p_export_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles; x export_logs;
begin
  a:=assert_reporting_actor(); select * into x from export_logs where id=p_export_id;
  if x.id is null or x.tenant_id<>a.tenant_id or not (x.user_profile_id=a.id or a.user_role in ('super_admin','admin')) or x.status<>'completed' or x.expires_at<=now() or x.cleaned_at is not null or x.object_path is null then raise exception 'Export download unavailable' using errcode='42501'; end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'report_export_download_authorized','exports',x.id,jsonb_build_object('expires_in_seconds',60));
  return jsonb_build_object('bucket','report-exports','object_path',x.object_path,'expires_in_seconds',60);
end $$;

create function can_read_report_export_object(p_name text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from export_logs x,current_profile() a where x.object_path=p_name and x.tenant_id=a.tenant_id and current_profile_is_active() and x.status='completed' and x.expires_at>now() and x.cleaned_at is null and (x.user_profile_id=a.id or a.user_role in ('super_admin','admin')));
$$;

create policy report_export_objects_select on storage.objects for select to authenticated using(bucket_id='report-exports' and can_read_report_export_object(name));

-- --------------------------------------------------------------------------
-- Audited preferences and optimistic-concurrency settings
-- --------------------------------------------------------------------------

create table settings_mutation_keys(
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_id uuid not null references user_profiles(id),
  operation text not null,
  request_key uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(tenant_id,actor_id,operation,request_key)
);
revoke all on settings_mutation_keys from public,anon,authenticated,service_role;

create function validated_user_preferences(p_preferences jsonb)
returns jsonb language plpgsql stable set search_path=public as $$
begin
  perform assert_json_keys(p_preferences,array['default_landing_page','dashboard_range','table_density','timezone_display'],'preference');
  p_preferences:=jsonb_build_object(
    'default_landing_page',coalesce(p_preferences->>'default_landing_page','home'),
    'dashboard_range',coalesce(p_preferences->>'dashboard_range','today'),
    'table_density',coalesce(p_preferences->>'table_density','comfortable'),
    'timezone_display',coalesce(p_preferences->>'timezone_display','tenant'));
  if p_preferences->>'default_landing_page' not in ('home','dashboard') or p_preferences->>'dashboard_range' not in ('today','this_week','this_month','last_7_days','last_30_days') or p_preferences->>'table_density' not in ('comfortable','compact') or p_preferences->>'timezone_display' not in ('tenant','device') then raise exception 'Invalid user preferences' using errcode='22023'; end if;
  return p_preferences;
end $$;

create function save_user_preferences_with_audit(p_preferences jsonb)
returns user_preferences language plpgsql security definer set search_path=public as $$
declare a user_profiles; v_new user_preferences; v_old jsonb;
begin
  a:=assert_reporting_actor(); p_preferences:=validated_user_preferences(p_preferences);
  select preferences into v_old from user_preferences where user_profile_id=a.id for update;
  insert into user_preferences(tenant_id,user_profile_id,preferences,updated_by) values(a.tenant_id,a.id,p_preferences,a.id)
  on conflict(user_profile_id) do update set preferences=excluded.preferences,record_version=user_preferences.record_version+1,updated_at=now(),updated_by=a.id returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(a.tenant_id,a.id,'user_preferences_saved','settings',v_new.id,v_old,p_preferences);
  return v_new;
end $$;

create function save_tenant_settings_with_audit(p_settings jsonb,p_expected_version integer,p_request_key uuid)
returns tenants language plpgsql security definer set search_path=public as $$
declare a user_profiles; t tenants; v_old jsonb; v_replay jsonb; v_name text; v_currency text; v_timezone text; v_retention integer; v_max integer;
begin
  a:=assert_reporting_actor(); if a.user_role not in ('super_admin','admin') then raise exception 'Tenant settings denied' using errcode='42501'; end if;
  if p_request_key is null or p_expected_version is null then raise exception 'Version and request key required' using errcode='22023'; end if;
  perform assert_json_keys(p_settings,array['name','currency','timezone','export_retention_days','export_max_rows'],'tenant setting');
  select result into v_replay from settings_mutation_keys where tenant_id=a.tenant_id and actor_id=a.id and operation='tenant_settings' and request_key=p_request_key;
  if v_replay is not null then select * into t from tenants where id=(v_replay->>'id')::uuid; return t; end if;
  select * into t from tenants where id=a.tenant_id for update; if t.settings_version<>p_expected_version then raise exception 'Tenant settings changed; refresh and retry' using errcode='40001'; end if;
  v_old:=jsonb_build_object('name',t.name,'currency',t.currency,'timezone',t.timezone,'export_retention_days',t.export_retention_days,'export_max_rows',t.export_max_rows,'settings_version',t.settings_version);
  v_name:=btrim(p_settings->>'name'); v_currency:=p_settings->>'currency'; v_timezone:=p_settings->>'timezone';
  begin v_retention:=(p_settings->>'export_retention_days')::integer; v_max:=(p_settings->>'export_max_rows')::integer; perform now() at time zone v_timezone; exception when others then raise exception 'Invalid tenant settings' using errcode='22023'; end;
  if length(v_name) not between 2 and 120 or v_currency !~ '^[A-Z]{3}$' or length(v_timezone)>64 or v_retention not between 1 and 30 or v_max not between 100 and 100000 then raise exception 'Invalid tenant settings' using errcode='22023'; end if;
  update tenants set name=v_name,currency=v_currency,timezone=v_timezone,export_retention_days=v_retention,export_max_rows=v_max,settings_version=settings_version+1,updated_at=now() where id=t.id returning * into t;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(a.tenant_id,a.id,'tenant_settings_saved','settings',t.id,v_old,jsonb_build_object('name',v_name,'currency',v_currency,'timezone',v_timezone,'export_retention_days',v_retention,'export_max_rows',v_max,'settings_version',t.settings_version,'request_key',p_request_key));
  insert into settings_mutation_keys values(a.tenant_id,a.id,'tenant_settings',p_request_key,jsonb_build_object('id',t.id),now()); return t;
end $$;

create function save_branch_settings_with_audit(p_branch_id uuid,p_settings jsonb,p_expected_version integer,p_request_key uuid)
returns branches language plpgsql security definer set search_path=public as $$
declare a user_profiles; b branches; v_old jsonb; v_replay jsonb; v_department uuid; v_max integer; v_clean jsonb;
begin
  a:=assert_reporting_actor(); if a.user_role not in ('super_admin','admin','manager') then raise exception 'Branch settings denied' using errcode='42501'; end if;
  if p_request_key is null or p_expected_version is null then raise exception 'Version and request key required' using errcode='22023'; end if;
  perform assert_json_keys(p_settings,array['report_default_department_id','export_max_rows'],'branch setting');
  select result into v_replay from settings_mutation_keys where tenant_id=a.tenant_id and actor_id=a.id and operation='branch_settings' and request_key=p_request_key;
  if v_replay is not null then select * into b from branches where id=(v_replay->>'id')::uuid; return b; end if;
  select * into b from branches where id=p_branch_id and tenant_id=a.tenant_id for update;
  if b.id is null or (a.user_role='manager' and b.id<>a.branch_id) then raise exception 'Branch settings denied' using errcode='42501'; end if;
  if b.settings_version<>p_expected_version then raise exception 'Branch settings changed; refresh and retry' using errcode='40001'; end if;
  v_old:=b.settings||jsonb_build_object('settings_version',b.settings_version);
  begin v_department:=nullif(p_settings->>'report_default_department_id','')::uuid; v_max:=nullif(p_settings->>'export_max_rows','')::integer; exception when others then raise exception 'Invalid branch settings' using errcode='22023'; end;
  if v_department is not null and not exists(select 1 from departments d where d.id=v_department and d.tenant_id=a.tenant_id and (d.branch_id is null or d.branch_id=b.id) and d.is_active) then raise exception 'Invalid branch department' using errcode='22023'; end if;
  if v_max is not null and v_max not between 100 and 50000 then raise exception 'Invalid branch row limit' using errcode='22023'; end if;
  v_clean:=jsonb_build_object('report_default_department_id',v_department,'export_max_rows',v_max);
  update branches set settings=v_clean,settings_version=settings_version+1,updated_at=now(),updated_by=a.id where id=b.id returning * into b;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(a.tenant_id,a.id,'branch_settings_saved','settings',b.id,v_old,v_clean||jsonb_build_object('settings_version',b.settings_version,'request_key',p_request_key));
  insert into settings_mutation_keys values(a.tenant_id,a.id,'branch_settings',p_request_key,jsonb_build_object('id',b.id),now()); return b;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'assert_reporting_actor','assert_json_keys','reporting_context_for_actor','task_in_reporting_scope','fms_stage_in_reporting_scope',
      'get_home_summary','get_dashboard_metrics','client_in_reporting_scope','report_allowed_for_role','report_max_days',
      'report_rows_for_profile','get_report_data','request_report_export_with_audit','cancel_report_export_with_audit',
      'retry_report_export_with_audit','claim_report_exports','get_report_export_batch','update_report_export_progress',
      'finish_report_export','claim_report_export_cleanup','mark_report_export_cleaned','get_report_export_download_url',
      'can_read_report_export_object','validated_user_preferences','save_user_preferences_with_audit',
      'save_tenant_settings_with_audit','save_branch_settings_with_audit'
    )
  loop
    execute format('alter function %s owner to postgres',f.identity);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.identity);
  end loop;
end $$;

grant execute on function get_home_summary(jsonb),get_dashboard_metrics(jsonb),get_report_data(text,jsonb),
  request_report_export_with_audit(text,jsonb,uuid),cancel_report_export_with_audit(uuid,uuid),retry_report_export_with_audit(uuid,uuid),
  get_report_export_download_url(uuid),can_read_report_export_object(text),save_user_preferences_with_audit(jsonb),
  save_tenant_settings_with_audit(jsonb,integer,uuid),save_branch_settings_with_audit(uuid,jsonb,integer,uuid)
to authenticated;

grant execute on function claim_report_exports(integer,uuid,integer),get_report_export_batch(uuid,integer,integer),
  update_report_export_progress(uuid,uuid,integer,integer),finish_report_export(uuid,uuid,text,text,integer,text),
  claim_report_export_cleanup(integer),mark_report_export_cleaned(uuid)
to service_role;

comment on table export_logs is 'Private asynchronous fixed-report CSV jobs. object_path is never a public or signed URL.';
comment on function get_report_export_download_url(uuid) is 'Reauthorizes a completed private export, audits access, and returns short-lived signing metadata; the API client creates the 60-second signed URL.';

notify pgrst,'reload schema';
