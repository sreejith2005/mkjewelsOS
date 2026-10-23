-- FMS AI assistant (debugger + workflow builder). Additive only.
-- * fms_ai_settings: per-tenant switches, all OFF by default, so manual FMS
--   authoring is unaffected and each AI capability can be disabled alone.
-- * fms_ai_requests: per-user/tenant daily request quota and token metrics.
--   No prompt or answer text is stored.
-- * fms_diagnostic_events: sanitized records of failed FMS work attempts,
--   written after the failed transaction has rolled back. They never retry or
--   alter work, and hold no answers, remarks or error text.
-- * get_fms_run_diagnostic_snapshot: a bounded, redacted, actor-authorized
--   read of one run for "Diagnose run". It reuses can_read_fms_instance.
set search_path=public,extensions;

create table fms_ai_settings(
  tenant_id uuid primary key references tenants(id) on delete cascade,
  debugger_enabled boolean not null default false,
  builder_enabled boolean not null default false,
  run_diagnosis_enabled boolean not null default false,
  user_daily_limit integer not null default 30 check(user_daily_limit between 1 and 500),
  tenant_daily_limit integer not null default 300 check(tenant_daily_limit between 1 and 5000),
  updated_by uuid references user_profiles(id),
  updated_at timestamptz not null default now()
);

create table fms_ai_requests(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_profile_id uuid not null references user_profiles(id) on delete cascade,
  request_id uuid not null,
  mode text not null check(mode in ('debug','build')),
  includes_run_data boolean not null default false,
  status text not null default 'started' check(status in ('started','completed','failed')),
  model text check(model is null or model ~ '^[a-z0-9.\-]{1,64}$'),
  input_tokens integer not null default 0 check(input_tokens between 0 and 10000000),
  output_tokens integer not null default 0 check(output_tokens between 0 and 10000000),
  cache_read_tokens integer not null default 0 check(cache_read_tokens between 0 and 10000000),
  cache_write_tokens integer not null default 0 check(cache_write_tokens between 0 and 10000000),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(tenant_id,user_profile_id,request_id)
);
create index fms_ai_requests_quota on fms_ai_requests(tenant_id,created_at);

create table fms_diagnostic_events(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_id uuid not null references user_profiles(id) on delete cascade,
  operation text not null check(operation in ('fms_stage_transition','fms_starter_submission','fms_flow_start','fms_stage_review')),
  fms_instance_id uuid references fms_instances(id) on delete cascade,
  fms_instance_stage_id uuid references fms_instance_stages(id) on delete cascade,
  fms_flow_id uuid references fms_flows(id) on delete cascade,
  sqlstate text check(sqlstate is null or sqlstate ~ '^[0-9A-Z]{5}$'),
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);
create index fms_diagnostic_events_instance on fms_diagnostic_events(fms_instance_id,created_at desc);
create index fms_diagnostic_events_actor on fms_diagnostic_events(tenant_id,actor_id,created_at desc);

-- Reads and writes go through the functions below only.
alter table fms_ai_settings enable row level security;
alter table fms_ai_requests enable row level security;
alter table fms_diagnostic_events enable row level security;
revoke all on fms_ai_settings,fms_ai_requests,fms_diagnostic_events from public,anon,authenticated,service_role;

create function get_fms_ai_settings()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor user_profiles:=current_profile(); s fms_ai_settings; used_today integer;
begin
  perform assert_module_enabled('fms_builder');
  if actor.id is null or not current_profile_is_active() or not has_permission('fms.manage') then
    raise exception 'Only active FMS authors can use the FMS assistant' using errcode='42501';
  end if;
  select * into s from fms_ai_settings where tenant_id=actor.tenant_id;
  select count(*) into used_today from fms_ai_requests
  where tenant_id=actor.tenant_id and user_profile_id=actor.id and created_at>=date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  return jsonb_build_object(
    'debugger_enabled',coalesce(s.debugger_enabled,false),
    'builder_enabled',coalesce(s.builder_enabled,false),
    'run_diagnosis_enabled',coalesce(s.run_diagnosis_enabled,false),
    'user_daily_limit',coalesce(s.user_daily_limit,30),
    'tenant_daily_limit',coalesce(s.tenant_daily_limit,300),
    'used_today',used_today,
    'can_configure',has_permission('settings.manage_organization'));
end $$;

create function set_fms_ai_settings_with_audit(p_debugger boolean,p_builder boolean,p_run_diagnosis boolean,p_user_daily_limit integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor user_profiles:=current_profile(); previous fms_ai_settings; updated fms_ai_settings;
begin
  perform assert_module_enabled('fms_builder');
  if actor.id is null or not current_profile_is_active() or not has_permission('settings.manage_organization') or not has_permission('fms.manage') then
    raise exception 'Only organization administrators can change the FMS assistant' using errcode='42501';
  end if;
  if p_debugger is null or p_builder is null or p_run_diagnosis is null or p_user_daily_limit is null or p_user_daily_limit not between 1 and 500 then
    raise exception 'Choose each switch and a daily limit between 1 and 500' using errcode='22023';
  end if;
  select * into previous from fms_ai_settings where tenant_id=actor.tenant_id for update;
  insert into fms_ai_settings(tenant_id,debugger_enabled,builder_enabled,run_diagnosis_enabled,user_daily_limit,updated_by,updated_at)
  values(actor.tenant_id,p_debugger,p_builder,p_run_diagnosis,p_user_daily_limit,actor.id,now())
  on conflict(tenant_id) do update set debugger_enabled=excluded.debugger_enabled,builder_enabled=excluded.builder_enabled,
    run_diagnosis_enabled=excluded.run_diagnosis_enabled,user_daily_limit=excluded.user_daily_limit,updated_by=excluded.updated_by,updated_at=now()
  returning * into updated;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(actor.tenant_id,actor.id,'fms_ai_settings_changed','fms',actor.tenant_id,
    case when previous.tenant_id is null then null else jsonb_build_object('debugger_enabled',previous.debugger_enabled,'builder_enabled',previous.builder_enabled,'run_diagnosis_enabled',previous.run_diagnosis_enabled,'user_daily_limit',previous.user_daily_limit) end,
    jsonb_build_object('debugger_enabled',updated.debugger_enabled,'builder_enabled',updated.builder_enabled,'run_diagnosis_enabled',updated.run_diagnosis_enabled,'user_daily_limit',updated.user_daily_limit));
  return get_fms_ai_settings();
end $$;

-- Called by the fms-ai Edge Function as the caller (never the service role)
-- before any model request. Repeating a request id is refused, so one browser
-- request cannot be billed twice.
create function start_fms_ai_request(p_request_id uuid,p_mode text,p_include_run boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor user_profiles:=current_profile(); s fms_ai_settings; user_used integer; tenant_used integer; day_start timestamptz;
begin
  perform assert_module_enabled('fms_builder');
  if actor.id is null or not current_profile_is_active() or not has_permission('fms.manage') then
    raise exception 'Only active FMS authors can use the FMS assistant' using errcode='42501';
  end if;
  if p_request_id is null or p_mode not in ('debug','build') or p_include_run is null then
    raise exception 'Invalid FMS assistant request' using errcode='22023';
  end if;
  select * into s from fms_ai_settings where tenant_id=actor.tenant_id;
  if not coalesce(case when p_mode='build' then s.builder_enabled else s.debugger_enabled end,false)
    or (p_include_run and not coalesce(s.run_diagnosis_enabled,false)) then
    raise exception 'fms_ai_disabled' using errcode='42501';
  end if;
  -- Serialize this tenant's quota check so concurrent requests cannot overrun it.
  perform pg_advisory_xact_lock(hashtextextended('fms_ai_quota:'||actor.tenant_id::text,0));
  day_start:=date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  select count(*) filter(where user_profile_id=actor.id),count(*) into user_used,tenant_used
  from fms_ai_requests where tenant_id=actor.tenant_id and created_at>=day_start;
  if user_used>=coalesce(s.user_daily_limit,30) or tenant_used>=coalesce(s.tenant_daily_limit,300) then
    raise exception 'fms_ai_daily_limit_reached' using errcode='P0001';
  end if;
  insert into fms_ai_requests(tenant_id,user_profile_id,request_id,mode,includes_run_data)
  values(actor.tenant_id,actor.id,p_request_id,p_mode,p_include_run)
  on conflict(tenant_id,user_profile_id,request_id) do nothing;
  if not found then raise exception 'fms_ai_duplicate_request' using errcode='P0001'; end if;
  -- Bounded retention of metrics only.
  delete from fms_ai_requests where tenant_id=actor.tenant_id and created_at<now()-interval '90 days';
  return jsonb_build_object('remaining_today',greatest(coalesce(s.user_daily_limit,30)-user_used-1,0));
end $$;

create function finish_fms_ai_request(p_request_id uuid,p_status text,p_model text,p_input_tokens integer,p_output_tokens integer,p_cache_read_tokens integer,p_cache_write_tokens integer)
returns void language plpgsql security definer set search_path=public as $$
declare actor user_profiles:=current_profile();
begin
  if actor.id is null or not current_profile_is_active() then raise exception 'Active profile required' using errcode='42501'; end if;
  if p_status not in ('completed','failed') or least(p_input_tokens,p_output_tokens,p_cache_read_tokens,p_cache_write_tokens)<0
    or greatest(p_input_tokens,p_output_tokens,p_cache_read_tokens,p_cache_write_tokens)>10000000
    or (p_model is not null and p_model !~ '^[a-z0-9.\-]{1,64}$') then
    raise exception 'Invalid FMS assistant usage' using errcode='22023';
  end if;
  update fms_ai_requests set status=p_status,model=p_model,input_tokens=p_input_tokens,output_tokens=p_output_tokens,
    cache_read_tokens=p_cache_read_tokens,cache_write_tokens=p_cache_write_tokens,completed_at=now()
  where tenant_id=actor.tenant_id and user_profile_id=actor.id and request_id=p_request_id and status='started';
end $$;

-- Recorded by the browser after an FMS write failed and rolled back. The
-- database derives every identifier it stores from rows the actor may read;
-- nothing the client sends beyond the operation, SQLSTATE and correlation id
-- is kept. Over the rate limit the event is dropped, never an error.
create function record_fms_diagnostic_event(p_operation text,p_instance_stage_id uuid,p_sqlstate text,p_correlation_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare actor user_profiles:=current_profile(); v_stage fms_instance_stages; v_instance fms_instances; recent integer; event_id uuid;
begin
  perform assert_module_enabled('fms_builder');
  if actor.id is null or not current_profile_is_active() then raise exception 'Active profile required' using errcode='42501'; end if;
  if p_operation not in ('fms_stage_transition','fms_stage_review') or p_correlation_id is null
    or (p_sqlstate is not null and upper(p_sqlstate) !~ '^[0-9A-Z]{5}$') then
    raise exception 'Invalid FMS diagnostic event' using errcode='22023';
  end if;
  select s.* into v_stage from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id
  where s.id=p_instance_stage_id and i.tenant_id=actor.tenant_id;
  if v_stage.id is null or not can_read_fms_instance(v_stage.fms_instance_id) then
    raise exception 'FMS step not found in your authorized scope' using errcode='42501';
  end if;
  select * into v_instance from fms_instances where id=v_stage.fms_instance_id;
  select count(*) into recent from fms_diagnostic_events where tenant_id=actor.tenant_id and actor_id=actor.id and created_at>now()-interval '1 hour';
  if recent>=30 then return null; end if;
  insert into fms_diagnostic_events(tenant_id,actor_id,operation,fms_instance_id,fms_instance_stage_id,fms_flow_id,sqlstate,correlation_id)
  values(actor.tenant_id,actor.id,p_operation,v_instance.id,v_stage.id,v_instance.fms_flow_id,upper(p_sqlstate),p_correlation_id)
  returning id into event_id;
  delete from fms_diagnostic_events where tenant_id=actor.tenant_id and created_at<now()-interval '30 days';
  return event_id;
end $$;

create function get_fms_run_diagnostic_snapshot(p_instance_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor user_profiles:=current_profile(); s fms_ai_settings; i fms_instances; f fms_flows; today date;
  v_stages jsonb; v_stage_count integer; v_decisions jsonb; v_logs jsonb; v_log_count integer; v_pending jsonb; v_events jsonb; v_answers jsonb; v_people jsonb; v_since date;
begin
  perform assert_module_enabled('fms_builder');
  if actor.id is null or not current_profile_is_active() or not has_permission('fms.manage') then
    raise exception 'Only active FMS authors can diagnose runs' using errcode='42501';
  end if;
  select * into s from fms_ai_settings where tenant_id=actor.tenant_id;
  if not coalesce(s.run_diagnosis_enabled,false) then raise exception 'fms_ai_disabled' using errcode='42501'; end if;
  select * into i from fms_instances where id=p_instance_id and tenant_id=actor.tenant_id;
  if i.id is null or not can_read_fms_instance(i.id) then
    raise exception 'FMS run not found in your authorized scope' using errcode='42501';
  end if;
  select * into f from fms_flows where id=i.fms_flow_id;
  today:=(now() at time zone 'Asia/Kolkata')::date;

  select count(*) into v_stage_count from fms_instance_stages where fms_instance_id=i.id;
  select coalesce(jsonb_agg(item order by item->>'created_at',item->>'instance_stage_id'),'[]') into v_stages from (
    select jsonb_build_object('instance_stage_id',x.id,'stage_key',d.stage_key,'stage_name',d.name,'step_type',d.step_type,'status',x.status,
      'visit_number',x.visit_number,'assigned_to',coalesce(to_jsonb(x.assigned_to),'[]'),'next_doer_ids',coalesce(to_jsonb(x.next_doer_ids),'[]'),
      'planned_at',x.planned_datetime,'activated_at',x.activated_at,'actual_at',x.actual_datetime,'sla_breached',coalesce(x.sla_breached,false),
      'outcome',x.outcome,'has_form_submission',x.form_submission_id is not null,'branch_rule_id',x.branch_rule_id,'completed_by',x.completed_by,
      'coverage_status',x.coverage_status,'created_at',x.created_at) item
    from fms_instance_stages x join fms_stages d on d.id=x.fms_stage_id
    where x.fms_instance_id=i.id order by x.created_at desc nulls last,x.id limit 200) bounded;

  select coalesce(jsonb_agg(item order by item->>'created_at'),'[]') into v_decisions from (
    select jsonb_build_object('target_stage_key',d.stage_key,'visit_number',a.visit_number,'method',a.assignment_method,
      'selected_user_ids',to_jsonb(a.selected_user_ids),'effective_user_ids',to_jsonb(a.effective_user_ids),'created_at',a.created_at) item
    from fms_stage_assignment_decisions a join fms_stages d on d.id=a.target_stage_id
    where a.fms_instance_id=i.id and a.tenant_id=actor.tenant_id order by a.created_at desc limit 100) bounded;

  -- Log actions and times only; details (which can carry remarks) are redacted.
  select count(*) into v_log_count from fms_stage_logs l join fms_instance_stages x on x.id=l.fms_instance_stage_id where x.fms_instance_id=i.id;
  select coalesce(jsonb_agg(item order by item->>'created_at'),'[]') into v_logs from (
    select jsonb_build_object('stage_key',d.stage_key,'action',l.action,'actor_id',l.actor_id,'created_at',l.created_at) item
    from fms_stage_logs l join fms_instance_stages x on x.id=l.fms_instance_stage_id join fms_stages d on d.id=x.fms_stage_id
    where x.fms_instance_id=i.id order by l.created_at desc nulls last limit 200) bounded;

  select coalesce(jsonb_agg(jsonb_build_object('linked_record_id',k.linked_record_id,'created_at',k.created_at)),'[]') into v_pending from (
    select k.* from fms_workflow_mutation_keys k
    where k.tenant_id=actor.tenant_id and k.completed_at is null
      and k.linked_record_id in (select x.id from fms_instance_stages x where x.fms_instance_id=i.id)
    order by k.created_at desc limit 50) k;

  select coalesce(jsonb_agg(item order by item->>'created_at'),'[]') into v_events from (
    select jsonb_build_object('operation',e.operation,'sqlstate',e.sqlstate,'stage_key',d.stage_key,'created_at',e.created_at) item
    from fms_diagnostic_events e left join fms_instance_stages x on x.id=e.fms_instance_stage_id left join fms_stages d on d.id=x.fms_stage_id
    where e.fms_instance_id=i.id and e.tenant_id=actor.tenant_id and e.created_at>now()-interval '30 days'
    order by e.created_at desc limit 50) bounded;
  select min(created_at)::date into v_since from fms_diagnostic_events where tenant_id=actor.tenant_id;

  -- Only answers to questions that decide a route or an assignment, bounded.
  select coalesce(jsonb_agg(item),'[]') into v_answers from (
    select jsonb_build_object('stage_key',d.stage_key,'visit_number',x.visit_number,'field_key',q.field_key,
      'value',left(case jsonb_typeof(fs.data->q.field_key) when 'array' then (select string_agg(value,',') from jsonb_array_elements_text(fs.data->q.field_key)) else fs.data->>q.field_key end,100)) item
    from fms_instance_stages x
    join fms_stages d on d.id=x.fms_stage_id
    join form_submissions fs on fs.id=x.form_submission_id and fs.tenant_id=actor.tenant_id
    cross join lateral (
      select r.source_key field_key from fms_branch_rules r where r.fms_stage_id=d.id and r.source_type='form_answer' and r.source_key is not null
      union
      select src->>'fieldKey' from fms_stages other cross join lateral jsonb_array_elements(coalesce(other.planned_time_rule#>'{assignment,sources}','[]')) src
      where other.fms_flow_id=d.fms_flow_id and src->>'sourceStageKey'=d.stage_key and src->>'fieldKey' is not null
    ) q
    where x.fms_instance_id=i.id and fs.data ? q.field_key and jsonb_typeof(fs.data->q.field_key) in ('string','number','boolean','array')
    order by x.created_at desc limit 100) bounded;

  select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name,'role',u.user_role,
      'active',u.working_status not in ('inactive','resigned') and coalesce(u.account_status,'active') not in ('inactive','suspended'),
      'login_enabled',coalesce(u.is_login_enabled,false),
      'availability_today',(select a.status from user_availability a where a.user_profile_id=u.id and a.tenant_id=actor.tenant_id and a.date=today limit 1))),'[]')
  into v_people from user_profiles u where u.tenant_id=actor.tenant_id and u.id in (
    select unnest(x.assigned_to) from fms_instance_stages x where x.fms_instance_id=i.id
    union select unnest(x.next_doer_ids) from fms_instance_stages x where x.fms_instance_id=i.id
    union select x.completed_by from fms_instance_stages x where x.fms_instance_id=i.id
    union select unnest(a.selected_user_ids||a.effective_user_ids) from fms_stage_assignment_decisions a where a.fms_instance_id=i.id
    union select i.started_by);

  return jsonb_build_object('schema',1,'generated_at',now(),
    'instance',jsonb_build_object('id',i.id,'reference_number',i.reference_number,'status',i.status,'flow_id',i.fms_flow_id,'flow_version',i.flow_version,
      'assignment_version',i.assignment_version,'execution_version',i.execution_version,'started_at',i.started_at,'completed_at',i.completed_at,
      'started_by',i.started_by,'held',i.held_at is not null and i.status='on_hold','cancelled',i.status='cancelled'),
    'flow',jsonb_build_object('id',f.id,'name',f.name,'version',f.version,'status',f.status),
    'stages',v_stages,'assignment_decisions',v_decisions,'logs',v_logs,'pending_requests',v_pending,'diagnostic_events',v_events,
    'route_answers',v_answers,'people',v_people,
    'truncated',to_jsonb(array_remove(array[case when v_stage_count>200 then 'stages' end,case when v_log_count>200 then 'logs' end],null)),
    'redacted',jsonb_build_array('remarks','hold and cancel reasons','form answers except questions that decide a route or an assignment','evidence files','log details','checklist answers','contact details'),
    'absent',jsonb_build_array('failed attempts before diagnostics were recorded, or older than 30 days','failed attempts on devices that did not report them'),
    'diagnostic_history_since',v_since);
end $$;

revoke all on function get_fms_ai_settings(),set_fms_ai_settings_with_audit(boolean,boolean,boolean,integer),
  start_fms_ai_request(uuid,text,boolean),finish_fms_ai_request(uuid,text,text,integer,integer,integer,integer),
  record_fms_diagnostic_event(text,uuid,text,uuid),get_fms_run_diagnostic_snapshot(uuid) from public,anon,authenticated,service_role;
grant execute on function get_fms_ai_settings(),set_fms_ai_settings_with_audit(boolean,boolean,boolean,integer),
  start_fms_ai_request(uuid,text,boolean),finish_fms_ai_request(uuid,text,text,integer,integer,integer,integer),
  record_fms_diagnostic_event(text,uuid,text,uuid),get_fms_run_diagnostic_snapshot(uuid) to authenticated;
notify pgrst,'reload schema';
