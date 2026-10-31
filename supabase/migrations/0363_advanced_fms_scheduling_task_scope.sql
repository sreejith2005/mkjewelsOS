-- Extend the existing authorized workspaces and atomic FMS activation. No new
-- scheduler, customer delivery, assignment writer, or historical-data rewrite.
set search_path=public,extensions;

create function task_calendar_scope_matches(p_scope text,p_due timestamptz,p_status text,p_now timestamptz default now())
returns boolean language sql stable set search_path=public as $$
 select case coalesce(p_scope,'overall') when 'overall' then true
 when 'today' then p_due >= (p_now at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata'
  and p_due < (((p_now at time zone 'Asia/Kolkata')::date+1)::timestamp at time zone 'Asia/Kolkata')
 when 'overdue' then p_due < ((p_now at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata')
  and p_status not in ('completed','rejected','blocked','waiting') else false end
$$;

do $$
declare original text; amended text;
begin
 original:=pg_get_functiondef('task_workspace_page(jsonb,integer,integer)'::regprocedure);
 amended:=replace(original,'''sort'',''mode''','''sort'',''mode'',''scope''');
 amended:=replace(amended,'if length(q)>200',E'if p_filter ? ''scope'' and p_filter->>''scope'' not in (''today'',''overall'',''overdue'') then raise exception ''Invalid task scope'' using errcode=''22023''; end if;\n if length(q)>200');
 -- Explicit scope replaces the old board-only window, leaving old clients intact.
 amended:=replace(amended,'and (mode=''explore'' or section_filter=''all'' or','and (p_filter ? ''scope'' or mode=''explore'' or section_filter=''all'' or');
 -- 0317 projects names after the membership relation; apply scope before that
 -- projection so every count/page uses the same authorized calendar window.
 amended:=replace(amended,'from membership where (',E'from membership where (coalesce(p_filter->>''scope'',''overall'')=''overall'' or task_calendar_scope_matches(p_filter->>''scope'',deadline,status::text))\n   and (');
 -- Modern scoped/search clients can select completed authorized FMS rows too.
 -- Retain the legacy active-only board and the exact workspace membership check.
 amended:=replace(amended,
  $patch$section_filter<>'fms' or id in (select id from fms_workspace_rows('{}') where bucket in ('pending','overdue'))$patch$,
  $patch$section_filter<>'fms' or id in (select id from fms_workspace_rows('{}') where (status_filter='completed' and bucket='completed' or mode='explore' or p_filter ? 'scope' or bucket in ('pending','overdue')))$patch$);
 if position($patch$mode='explore' or p_filter ? 'scope' or bucket$patch$ in amended)=0 then raise exception 'Review completed FMS search membership patch'; end if;
 if amended=original or position('task_calendar_scope_matches' in amended)=0 or position('''scope'') or jsonb_typeof' in amended)=0 then raise exception 'Review task scope patch against current workspace'; end if;
 execute amended;
 original:=pg_get_functiondef('fms_workspace_validate(jsonb,integer,integer)'::regprocedure);
 amended:=replace(original,'''scope'',''due''','''scope'',''dateScope'',''due''');
 amended:=replace(amended,'or length(coalesce(p_filter->>''query'',''''))>200','or (p_filter ? ''dateScope'' and p_filter->>''dateScope'' not in (''today'',''overall'',''overdue'')) or length(coalesce(p_filter->>''query'',''''))>200');
 if amended=original then raise exception 'Review FMS scope validation patch'; end if; execute amended;
 original:=pg_get_functiondef('fms_workspace_rows(jsonb)'::regprocedure);
 amended:=replace(original,'select * from work where (','select * from work where (coalesce(p_filter->>''dateScope'',''overall'')=''overall'' or task_calendar_scope_matches(p_filter->>''dateScope'',due_at,bucket)) and (');
 if amended=original then raise exception 'Review FMS scope relation patch'; end if; execute amended;
 original:=pg_get_functiondef('get_fms_task_workspace(jsonb,integer,integer)'::regprocedure);
 -- Reuse the already-authorized, already-filtered materialized relation. A
 -- second call would repeat historical-name projection for every search.
 amended:=replace(original,'fms_workspace_rows(''{}'')','rows');
 if amended=original then raise exception 'Review FMS scoped total patch'; end if; execute amended;
end $$;

create function fms_follow_up_schedule_valid(p_schedule jsonb) returns boolean
language plpgsql immutable set search_path=public as $$
begin
 return jsonb_typeof(p_schedule)='object'
  and not exists(select 1 from jsonb_object_keys(p_schedule) k where k not in ('delay','unit','time','sourceStageKey','dateFieldKey','timeFieldKey','workingDaysOnly'))
  and coalesce(p_schedule->>'delay','1') ~ '^\d{1,4}$' and coalesce(p_schedule->>'delay','1')::integer between 0 and 3650
  and coalesce(p_schedule->>'unit','days') in ('days','hours')
  and coalesce(p_schedule->>'time','11:00') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  and (not p_schedule ? 'workingDaysOnly' or jsonb_typeof(p_schedule->'workingDaysOnly')='boolean');
exception when others then return false;
end $$;

-- Shared pure calculation used by the causal activation deadline below.
create function fms_follow_up_datetime(p_schedule jsonb,p_answers jsonb,p_now timestamptz default now()) returns timestamptz
language plpgsql stable set search_path=public as $$
declare local_time timestamp:=p_now at time zone 'Asia/Kolkata'; requested_date text; requested_time text;
begin
 if not fms_follow_up_schedule_valid(p_schedule) then raise exception 'Invalid follow-up schedule' using errcode='23514'; end if;
 requested_date:=nullif(p_answers->>(p_schedule->>'dateFieldKey'),'');
 requested_time:=nullif(p_answers->>(p_schedule->>'timeFieldKey'),'');
 if requested_date is not null then
  if requested_date !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid requested follow-up date' using errcode='22023'; end if;
  local_time:=requested_date::date;
 elsif coalesce(p_schedule->>'unit','days')='hours' then local_time:=local_time+make_interval(hours=>coalesce((p_schedule->>'delay')::integer,1));
 else local_time:=local_time+make_interval(days=>coalesce((p_schedule->>'delay')::integer,1)); end if;
 if requested_time is not null or requested_date is not null or coalesce(p_schedule->>'unit','days')='days' then
  requested_time:=coalesce(requested_time,p_schedule->>'time','11:00');
  if requested_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Requested follow-up time must use HH:mm' using errcode='22023'; end if;
  local_time:=local_time::date+requested_time::time;
 end if;
 if requested_date is null and coalesce((p_schedule->>'workingDaysOnly')::boolean,false) then
  while extract(isodow from local_time) in (6,7) loop local_time:=local_time+interval '1 day'; end loop;
 end if;
 return local_time at time zone 'Asia/Kolkata';
end $$;

create function fms_causal_stage_deadline(p_rule jsonb,p_tenant_id uuid,p_instance_id uuid,p_source_id uuid,p_answers jsonb default null)
returns timestamptz language plpgsql stable security definer set search_path=public as $$
declare schedule jsonb:=p_rule#>'{followUp,schedule}'; answers jsonb:='{}'; source fms_instance_stages;
begin
 if coalesce((p_rule->>'deadlineEnabled')::boolean,true)=false then return null; end if;
 if schedule is null then return fms_stage_deadline_for_instance(p_rule,p_tenant_id,p_instance_id); end if;
 if p_instance_id is not null and not exists(select 1 from fms_instances where id=p_instance_id and tenant_id=p_tenant_id) then raise exception 'Invalid scheduling instance' using errcode='23514'; end if;
 if p_answers is not null then answers:=p_answers;
 elsif p_source_id is not null then
  select * into source from fms_instance_stages where id=p_source_id and fms_instance_id=p_instance_id;
  if source.id is null then raise exception 'Invalid scheduling source' using errcode='23514'; end if;
  -- Only the selected route's causal visits can contribute customer preferences.
  select submission.data into answers
   from unnest(coalesce(source.execution_path,'{}')||array[source.id]) with ordinality path(id,depth)
   join fms_instance_stages visit on visit.id=path.id and visit.fms_instance_id=p_instance_id
   join fms_stages definition on definition.id=visit.fms_stage_id
   join form_submissions submission on submission.id=visit.form_submission_id and submission.tenant_id=p_tenant_id
   where definition.stage_key=schedule->>'sourceStageKey' order by path.depth desc limit 1;
 end if;
 return fms_follow_up_datetime(schedule,coalesce(answers,'{}'));
end $$;

-- Publication still uses all existing validators, permissions and audited writers.
alter function assert_fms_flow_publishable(uuid) rename to assert_fms_flow_publishable_before_schedule;
create function assert_fms_flow_publishable(p_flow_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare target fms_stages; source fms_stages; schedule jsonb;
begin
 perform assert_fms_flow_publishable_before_schedule(p_flow_id);
 for target in select * from fms_stages where fms_flow_id=p_flow_id loop
  schedule:=target.planned_time_rule#>'{followUp,schedule}'; if schedule is null then continue; end if;
  if not fms_follow_up_schedule_valid(schedule) then raise exception 'Invalid follow-up schedule for step %',target.name using errcode='23514'; end if;
  if nullif(schedule->>'dateFieldKey','') is not null or nullif(schedule->>'timeFieldKey','') is not null then
   select * into source from fms_stages where fms_flow_id=p_flow_id and stage_key=schedule->>'sourceStageKey';
   if source.form_template_id is null
    or nullif(schedule->>'dateFieldKey','') is not null and not exists(select 1 from form_fields where form_template_id=source.form_template_id and field_key=schedule->>'dateFieldKey' and field_type='date')
    or nullif(schedule->>'timeFieldKey','') is not null and not exists(select 1 from form_fields where form_template_id=source.form_template_id and field_key=schedule->>'timeFieldKey' and field_type='text') then
    raise exception 'Follow-up source must use date/time questions in the pinned source form' using errcode='23514'; end if;
  end if;
 end loop;
end $$;

-- Extend the existing causal due-date resolver; activation, coverage and provenance
-- keep their 0360 transaction path. An explicit formDue contract retains precedence.
alter function fms_form_due_resolution(jsonb,uuid,uuid,uuid,text,uuid,jsonb,uuid[]) rename to fms_form_due_resolution_before_followup;
create function fms_form_due_resolution(p_rule jsonb,p_tenant_id uuid,p_instance_id uuid,p_source_visit_id uuid,p_step_type text,p_candidate_stage_id uuid default null,p_candidate_answers jsonb default null,p_candidate_path uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare candidate jsonb;
begin
 if coalesce((p_rule->>'deadlineEnabled')::boolean,true) and p_rule#>'{followUp,schedule}' is not null and jsonb_typeof(p_rule->'formDue') is distinct from 'object' then
  if p_candidate_stage_id is not null and exists(select 1 from fms_stages where id=p_candidate_stage_id and stage_key=p_rule#>>'{followUp,schedule,sourceStageKey}') then candidate:=p_candidate_answers; end if;
  return jsonb_build_object('dueAt',fms_causal_stage_deadline(p_rule,p_tenant_id,p_instance_id,p_source_visit_id,candidate),'source','rule');
 end if;
 return fms_form_due_resolution_before_followup(p_rule,p_tenant_id,p_instance_id,p_source_visit_id,p_step_type,p_candidate_stage_id,p_candidate_answers,p_candidate_path);
end $$;

do $$
declare original text; amended text;
begin
 original:=pg_get_functiondef('fms_initial_assignment_preview(uuid,uuid,jsonb,uuid)'::regprocedure);
 amended:=replace(original,'fms_assignment_coverage(target.id,flow.tenant_id,null,selected,explicit)',
  $patch$fms_assignment_coverage(target.id,flow.tenant_id,null,selected,explicit,fms_stage_due_for_visit(target.planned_time_rule,flow.tenant_id,null,null,target.step_type::text,initial.id,p_answers))$patch$);
 if amended=original then raise exception 'Review initial scheduled coverage preview'; end if; execute amended;
end $$;

revoke all on function task_calendar_scope_matches(text,timestamptz,text,timestamptz),fms_follow_up_schedule_valid(jsonb),fms_follow_up_datetime(jsonb,jsonb,timestamptz),
 fms_causal_stage_deadline(jsonb,uuid,uuid,uuid,jsonb),fms_form_due_resolution(jsonb,uuid,uuid,uuid,text,uuid,jsonb,uuid[]),fms_form_due_resolution_before_followup(jsonb,uuid,uuid,uuid,text,uuid,jsonb,uuid[]),assert_fms_flow_publishable_before_schedule(uuid),assert_fms_flow_publishable(uuid),
 fms_assignment_coverage(uuid,uuid,uuid,uuid[],boolean,timestamptz) from public,anon,authenticated,service_role;
-- Preserve the existing read-only builder preflight entry point; compatibility
-- and causal-data helpers above remain private. Audited publishers retain writes.
grant execute on function assert_fms_flow_publishable(uuid) to authenticated;
notify pgrst,'reload schema';
