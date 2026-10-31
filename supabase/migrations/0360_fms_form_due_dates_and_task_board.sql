-- FMS Phase 2 (2026-10-30): due dates from form answers, and the stage-column task board.
--
-- 1. A human step may take its deadline from a date (and optional time) question that the
--    causal previous step's form answered: planned_time_rule.formDue =
--      { sources: [{ stageKey, dateFieldKey, timeFieldKey? }], defaultTime?: "HH:MM",
--        onMissing: "fallback" | "none" | "require" }
--    The existing timing rule (timingMethod ...) stays the fallback. The deadline is resolved
--    inside activate_fms_stage_v2_internal, in the same transaction that creates the visit, and
--    stored in fms_instance_stages.planned_datetime. Leave cover uses the same date.
-- 2. The Tasks -> FMS workspace gains due-today/overdue counts, business priority, due and
--    priority filters, a team scope (existing can_read_fms_work_context rule) and one board read
--    that returns the stage columns with exact counts and the first page of each column.
--
-- No new table, no new task records, no historical rewrite. Every function body that is patched
-- is checked for its marker so a drifted production body stops the migration.
set search_path=public,extensions;

-- ---------------------------------------------------------------------------------------------
-- Answer parsing. Pure and strict: anything ambiguous is null, never a guessed deadline.
-- ---------------------------------------------------------------------------------------------
create function fms_due_parse_time(p_value text) returns time
language plpgsql stable set search_path=public as $$
declare v text:=lower(btrim(coalesce(p_value,''))); m text[]; h integer;
begin
  if v='' then return null; end if;
  if v ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then return v::time; end if;
  m:=regexp_match(v,'^(1[0-2]|0?[1-9])(?:[:.]([0-5][0-9]))?\s*([ap])\.?\s*m\.?$');
  if m is null then return null; end if;
  h:=(m[1]::integer % 12)+case when m[3]='p' then 12 else 0 end;
  return make_time(h,coalesce(m[2],'0')::integer,0);
exception when others then return null;
end $$;

create function fms_due_parse_date(p_value text) returns date
language plpgsql stable set search_path=public as $$
declare v text:=btrim(coalesce(p_value,'')); d date;
begin
  if v !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  d:=v::date;
  -- Reject values Postgres would roll over (2026-02-30 is not a date).
  if to_char(d,'YYYY-MM-DD')<>v then return null; end if;
  return d;
exception when others then return null;
end $$;

-- A datetime answer is the form's local wall-clock time ("2026-11-05T15:30") in the tenant's
-- timezone; an explicit offset or Z is honoured as an instant.
create function fms_due_parse_datetime(p_value text,p_zone text) returns timestamptz
language plpgsql stable set search_path=public as $$
declare v text:=btrim(coalesce(p_value,'')); d date; t time;
begin
  if v ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$' then return v::timestamptz; end if;
  if v !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$' then return null; end if;
  d:=fms_due_parse_date(left(v,10)); t:=fms_due_parse_time(left(substr(v,12),8));
  if d is null or t is null then return null; end if;
  return (d+t) at time zone p_zone;
exception when others then return null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The resolver. Returns { dueAt, source, reason?, sourceVisitId?, submissionId?, stageKey?,
-- dateFieldKey?, timeFieldKey? }. source: rule (no formDue), form_answer, fallback, none.
-- The source is the nearest earlier visit on this route that had a form (the same causal path
-- the Assigned To rule uses), so a parallel or older answer with a similar name is never read.
-- ---------------------------------------------------------------------------------------------
create function fms_form_due_resolution(p_rule jsonb,p_tenant_id uuid,p_instance_id uuid,p_source_visit_id uuid,p_step_type text,
  p_candidate_stage_id uuid default null,p_candidate_answers jsonb default null,p_candidate_path uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare cfg jsonb:=p_rule->'formDue'; zone text; prior fms_instance_stages; work fms_instance_stages; step fms_stages;
  answers jsonb; submission_id uuid; src jsonb; date_field form_fields; time_field form_fields; reached text[]; form_sections jsonb;
  due timestamptz; d date; t time; reason text; on_missing text; field_ok boolean;
begin
  if jsonb_typeof(cfg) is distinct from 'object' or coalesce(p_step_type,'') not in ('form','task','approval') then
    return jsonb_build_object('dueAt',fms_stage_deadline_for_instance(p_rule,p_tenant_id,p_instance_id),'source','rule');
  end if;
  if coalesce((p_rule->>'deadlineEnabled')::boolean,true)=false then return jsonb_build_object('dueAt',null,'source','none','reason','deadline_off'); end if;
  on_missing:=coalesce(nullif(cfg->>'onMissing',''),'none');
  select coalesce(nullif(timezone,''),'Asia/Kolkata') into zone from tenants where id=p_tenant_id;
  zone:=coalesce(zone,'Asia/Kolkata');
  if p_source_visit_id is not null then
    select * into prior from fms_instance_stages where id=p_source_visit_id and fms_instance_id=p_instance_id;
    if prior.id is null then raise exception 'Deadline source belongs to another workflow' using errcode='42501'; end if;
    select visit.* into work from unnest(coalesce(p_candidate_path,prior.execution_path,'{}')||array[prior.id]) with ordinality path(id,depth)
      join fms_instance_stages visit on visit.id=path.id and visit.fms_instance_id=p_instance_id
      join fms_stages definition on definition.id=visit.fms_stage_id
      where definition.form_template_id is not null and visit.outcome is distinct from 'condition_skipped'
        and (visit.status='completed' or visit.id=prior.id)
      order by path.depth desc limit 1;
  end if;
  if work.id is null then reason:='no_source_form';
  else
    select * into step from fms_stages where id=work.fms_stage_id;
    select value into src from jsonb_array_elements(case when jsonb_typeof(cfg->'sources')='array' then cfg->'sources' else '[]' end) value
      where value->>'stageKey'=step.stage_key limit 1;
    if src is null then reason:='route_not_configured';
    else
      if p_candidate_answers is not null and work.fms_stage_id=p_candidate_stage_id then answers:=p_candidate_answers; submission_id:=null;
      else
        select s.data,s.id into answers,submission_id from form_submissions s
          where s.id=work.form_submission_id and s.tenant_id=p_tenant_id and s.status='submitted';
      end if;
      if answers is null then reason:='no_submission';
      else
        select coalesce(t.sections,'[]') into form_sections from form_templates t where t.id=step.form_template_id;
        reached:=form_reachable_sections(step.form_template_id,answers);
        select * into date_field from form_fields where form_template_id=step.form_template_id and field_key=src->>'dateFieldKey' and field_type in ('date','datetime');
        if nullif(src->>'timeFieldKey','') is not null then
          select * into time_field from form_fields where form_template_id=step.form_template_id and field_key=src->>'timeFieldKey';
        end if;
        -- Applicable = shown, its condition met, its section reached and asked by this step.
        field_ok:=date_field.id is not null and date_field.is_shown
          and form_condition_matches(date_field.conditional_logic,answers)
          and (reached is null or form_field_section_key(date_field.group_name,form_sections)=any(reached))
          and (nullif(step.planned_time_rule->>'formSectionKey','') is null or form_field_section_key(date_field.group_name,form_sections)=step.planned_time_rule->>'formSectionKey');
        if not field_ok then reason:='date_not_applicable';
        elsif nullif(btrim(answers->>date_field.field_key),'') is null then reason:='date_missing';
        elsif date_field.field_type='datetime' then
          due:=fms_due_parse_datetime(answers->>date_field.field_key,zone);
          if due is null then reason:='date_invalid'; end if;
        else
          d:=fms_due_parse_date(answers->>date_field.field_key);
          if d is null then reason:='date_invalid';
          else
            if time_field.id is not null and time_field.is_shown and form_condition_matches(time_field.conditional_logic,answers)
              and (reached is null or form_field_section_key(time_field.group_name,form_sections)=any(reached))
              and nullif(btrim(answers->>time_field.field_key),'') is not null then
              t:=fms_due_parse_time(answers->>time_field.field_key);
              if t is null then reason:='time_invalid'; end if;
            end if;
            if reason is null then
              t:=coalesce(t,fms_due_parse_time(cfg->>'defaultTime'));
              -- Date only: the end of that calendar day in the tenant's timezone.
              due:=case when t is null then (d+time '23:59:59.999999') at time zone zone else (d+t) at time zone zone end;
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;
  if reason is null then
    return jsonb_build_object('dueAt',due,'source','form_answer','sourceVisitId',work.id,'submissionId',submission_id,'stageKey',step.stage_key,
      'dateFieldKey',src->>'dateFieldKey','timeFieldKey',nullif(src->>'timeFieldKey',''));
  end if;
  if on_missing='require' then
    raise exception 'Enter a valid "%" in the form for step %. The next step takes its due date from it.',
      coalesce(date_field.field_name,'due date'),coalesce(step.name,'the previous step') using errcode='23514';
  end if;
  if on_missing='fallback' then
    return jsonb_build_object('dueAt',fms_stage_deadline_for_instance(p_rule,p_tenant_id,p_instance_id),'source','fallback','reason',reason,'sourceVisitId',work.id);
  end if;
  return jsonb_build_object('dueAt',null,'source','none','reason',reason,'sourceVisitId',work.id);
end $$;

create function fms_stage_due_for_visit(p_rule jsonb,p_tenant_id uuid,p_instance_id uuid,p_source_visit_id uuid,p_step_type text,
  p_candidate_stage_id uuid default null,p_candidate_answers jsonb default null,p_candidate_path uuid[] default null)
returns timestamptz language sql stable security definer set search_path=public as $$
  select (fms_form_due_resolution(p_rule,p_tenant_id,p_instance_id,p_source_visit_id,p_step_type,p_candidate_stage_id,p_candidate_answers,p_candidate_path)->>'dueAt')::timestamptz
$$;

-- Provenance for the visit just created: which answer (or fallback) set its deadline.
create function fms_record_due_source(p_visit_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare visit fms_instance_stages; step fms_stages; i fms_instances; resolution jsonb;
begin
  select * into visit from fms_instance_stages where id=p_visit_id;
  select * into step from fms_stages where id=visit.fms_stage_id;
  if jsonb_typeof(step.planned_time_rule->'formDue') is distinct from 'object' or step.step_type::text not in ('form','task','approval') then return; end if;
  select * into i from fms_instances where id=visit.fms_instance_id;
  resolution:=fms_form_due_resolution(step.planned_time_rule,i.tenant_id,i.id,visit.previous_instance_stage_id,step.step_type::text);
  insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
    values(p_visit_id,i.started_by,'due_date_resolved',resolution||jsonb_build_object('plannedDatetime',visit.planned_datetime));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Existing rule-based deadline: a form-answer rule without a fallback has no rule deadline
-- (its timing fields may be blank), so it must neither fail nor invent one.
-- ---------------------------------------------------------------------------------------------
do $$
declare definition text; patched text; marker text;
begin
  definition:=replace(pg_get_functiondef('fms_stage_deadline_for_instance(jsonb,uuid,uuid)'::regprocedure),E'\r','');
  marker:='  if coalesce((p_rule->>''deadlineEnabled'')::boolean,true)=false then return null; end if;';
  patched:=replace(definition,marker,marker||E'\n  if jsonb_typeof(p_rule->''formDue'')=''object'' and coalesce(p_rule#>>''{formDue,onMissing}'',''none'')<>''fallback'' then return null; end if;');
  if patched=definition then raise exception 'Rule deadline marker changed'; end if; execute patched;

  definition:=replace(pg_get_functiondef('is_valid_fms_timing_rule(jsonb)'::regprocedure),E'\r','');
  marker:='  if coalesce((p_rule->>''deadlineEnabled'')::boolean,true)=false then return true; end if;';
  patched:=replace(definition,marker,marker||E'\n  if jsonb_typeof(p_rule->''formDue'')=''object'' and coalesce(p_rule#>>''{formDue,onMissing}'',''none'')<>''fallback'' then return true; end if;');
  if patched=definition then raise exception 'Timing validation marker changed'; end if; execute patched;

  -- The visit's deadline is resolved from its causal source, then its provenance is logged.
  definition:=replace(pg_get_functiondef('activate_fms_stage_v2_internal(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid[],uuid)'::regprocedure),E'\r','');
  marker:='v_ids,fms_stage_deadline_for_instance(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id),now(),p_previous_instance_stage_id';
  patched:=replace(definition,marker,'v_ids,fms_stage_due_for_visit(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id,p_previous_instance_stage_id,v_stage.step_type::text),now(),p_previous_instance_stage_id');
  if patched=definition then raise exception 'Activation deadline marker changed'; end if;
  definition:=patched;
  marker:='perform record_fms_visit_assignment(v_instance_stage.id,v_assignment);';
  patched:=replace(definition,marker,marker||' perform fms_record_due_source(v_instance_stage.id);');
  if patched=definition then raise exception 'Activation assignment marker changed'; end if; execute patched;

  -- Leave cover is resolved for the day the work is actually due.
  definition:=replace(pg_get_functiondef('fms_assignment_coverage(uuid,uuid,uuid,uuid[],boolean)'::regprocedure),E'\r','');
  patched:=replace(definition,'p_explicit boolean)','p_explicit boolean, p_deadline timestamp with time zone)');
  patched:=replace(patched,'target_date:=(fms_stage_deadline_for_instance(target.planned_time_rule,p_tenant_id,p_instance_id) at time zone ''Asia/Kolkata'')::date;',
    'target_date:=(p_deadline at time zone ''Asia/Kolkata'')::date;');
  if patched=definition or position('p_deadline timestamp' in patched)=0 or position('(p_deadline at time zone' in patched)=0 then raise exception 'Coverage deadline marker changed'; end if;
  execute patched;

  definition:=replace(pg_get_functiondef('resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid,uuid[],text)'::regprocedure),E'\r','');
  marker:='coverage:=fms_assignment_coverage(target.id,i.tenant_id,i.id,chosen_ids,explicit_choice);';
  patched:=replace(definition,marker,'coverage:=fms_assignment_coverage(target.id,i.tenant_id,i.id,chosen_ids,explicit_choice,fms_stage_due_for_visit(target.planned_time_rule,i.tenant_id,i.id,prior.id,target.step_type::text,p_candidate_stage_id,p_candidate_answers,p_candidate_path));');
  if patched=definition then raise exception 'Assignment coverage marker changed'; end if; execute patched;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Publication: a form-answer deadline must point at real date/time questions of the source
-- step's pinned form. The builder suggests one; the server refuses anything ambiguous.
-- ---------------------------------------------------------------------------------------------
create function assert_fms_form_due_publishable(p_flow_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare target fms_stages; cfg jsonb; src jsonb; source fms_stages; date_type text; time_type text;
begin
  for target in select * from fms_stages where fms_flow_id=p_flow_id and planned_time_rule ? 'formDue' order by sort_order,id loop
    cfg:=target.planned_time_rule->'formDue';
    if target.step_type::text not in ('form','task','approval') then raise exception 'Only a person''s step can take its due date from a form (step %)',target.name using errcode='23514'; end if;
    if target.id=(select first_step.id from fms_stages first_step where first_step.fms_flow_id=p_flow_id order by first_step.sort_order,first_step.id limit 1) then
      raise exception 'The first step has no earlier form to take a due date from (step %)',target.name using errcode='23514'; end if;
    if jsonb_typeof(cfg)<>'object' or coalesce(cfg->>'onMissing','none') not in ('fallback','none','require')
      or (cfg ? 'defaultTime' and nullif(cfg->>'defaultTime','') is not null and coalesce(cfg->>'defaultTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      or jsonb_typeof(cfg->'sources') is distinct from 'array' or jsonb_array_length(cfg->'sources') not between 1 and 20 then
      raise exception 'Due date from form answer is incomplete for step %',target.name using errcode='23514'; end if;
    if (select count(distinct value->>'stageKey') from jsonb_array_elements(cfg->'sources') value)<>jsonb_array_length(cfg->'sources') then
      raise exception 'Choose one due-date question per earlier step for step %',target.name using errcode='23514'; end if;
    for src in select value from jsonb_array_elements(cfg->'sources') loop
      select * into source from fms_stages where fms_flow_id=p_flow_id and stage_key=src->>'stageKey';
      if source.id is null or source.id=target.id or source.form_template_id is null then
        raise exception 'Due date for step % must come from an earlier step that has a form',target.name using errcode='23514'; end if;
      select field_type into date_type from form_fields where form_template_id=source.form_template_id and field_key=src->>'dateFieldKey';
      if date_type is null or date_type not in ('date','datetime') then
        raise exception 'Choose a date question from step % for the due date of step %',source.name,target.name using errcode='23514'; end if;
      if nullif(src->>'timeFieldKey','') is not null then
        select field_type into time_type from form_fields where form_template_id=source.form_template_id and field_key=src->>'timeFieldKey';
        if date_type<>'date' or time_type is null or time_type not in ('text','select','radio') then
          raise exception 'The time question for step % must be a text or choice question next to a date question',target.name using errcode='23514'; end if;
      end if;
    end loop;
  end loop;
end $$;

do $$
declare definition text; patched text; marker text:='perform assert_fms_form_sections_publishable(p_flow_id);';
begin
  definition:=replace(pg_get_functiondef('assert_fms_flow_publishable(uuid)'::regprocedure),E'\r','');
  patched:=replace(definition,marker,marker||E'\n  perform assert_fms_form_due_publishable(p_flow_id);');
  if patched=definition then raise exception 'Publisher marker changed'; end if; execute patched;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Workspace: team scope. "mine" (default) is unchanged. "all" adds open work the caller may
-- already open under can_read_fms_work_context (tasks.view_all, or tasks.manage_team in the
-- caller's branch). Starting forms stay personal.
-- ---------------------------------------------------------------------------------------------
do $$
declare definition text; patched text; marker text;
begin
  definition:=replace(pg_get_functiondef('fms_workspace_rows(jsonb)'::regprocedure),E'\r','');
  marker:='where a.workspace_actor_active and a.workspace_fms_enabled and a.id=any(w.assigned_to)';
  patched:=replace(definition,marker,'where a.workspace_actor_active and a.workspace_fms_enabled and (a.id=any(w.assigned_to) or p_filter->>''scope''=''all'' and w.status in (''pending'',''in_progress'',''in_review'',''overdue'') and i.status in (''active'',''overdue'') and cardinality(w.assigned_to)>0)');
  if patched=definition then raise exception 'Workspace scope marker changed'; end if; execute patched;

  definition:=replace(pg_get_functiondef('fms_workspace_validate(jsonb,integer,integer)'::regprocedure),E'\r','');
  marker:='e.key not in (''query'',''status'',''from'',''to'',''familyId'',''stageId'')';
  patched:=replace(definition,marker,'e.key not in (''query'',''status'',''from'',''to'',''familyId'',''stageId'',''scope'',''due'',''priority'',''sort'',''assigneeId'')');
  marker:='foreach selector in array array[nullif(p_filter->>''familyId'',''''),nullif(p_filter->>''stageId'','''')] loop';
  patched:=replace(patched,marker,
    'if coalesce(nullif(p_filter->>''scope'',''''),''mine'') not in (''mine'',''all'') or coalesce(nullif(p_filter->>''due'',''''),''all'') not in (''all'',''overdue'',''today'',''upcoming'',''none'')'||E'\n'||
    '   or coalesce(nullif(p_filter->>''priority'',''''),''all'') not in (''all'',''high'',''medium'',''low'') or coalesce(nullif(p_filter->>''sort'',''''),''due'') not in (''due'',''priority'') then'||E'\n'||
    '   raise exception ''Invalid FMS filters'' using errcode=''22023''; end if;'||E'\n'||
    ' foreach selector in array array[nullif(p_filter->>''familyId'',''''),nullif(p_filter->>''stageId'',''''),nullif(p_filter->>''assigneeId'','''')] loop');
  if patched=definition or position('''due'',''priority'',''sort'',''assigneeId'')' in patched)=0 or position('p_filter->>''assigneeId''' in patched)=0 then raise exception 'Workspace validation marker changed'; end if;
  execute patched;
end $$;

-- Urgency is separate from business priority: priority is never rewritten by a deadline.
create function fms_due_urgency(p_due timestamptz,p_bucket text,p_zone text,p_now timestamptz default now()) returns text
language sql stable set search_path=public as $$
  select case when p_bucket='overdue' then 'overdue' when p_due is null then 'none'
    when p_due<p_now then 'overdue'
    when (p_due at time zone p_zone)::date=(p_now at time zone p_zone)::date then 'today' else 'upcoming' end
$$;

-- The workspace relation plus priority, urgency and the board filters, for one caller.
create function fms_board_rows(p_filter jsonb) returns table(id uuid,family_id uuid,flow_id uuid,stage_id uuid,instance_id uuid,form_id uuid,starting boolean,
  workflow_name text,stage_name text,version integer,pipeline text,sort_order integer,visit_number integer,due_at timestamptz,status text,bucket text,reference text,
  description text,priority text,urgency text,urgency_rank integer,priority_rank integer)
language sql stable security definer set search_path=public as $$
  with zone as materialized (select coalesce(nullif(t.timezone,''),'Asia/Kolkata') name from tenants t where t.id=(select tenant_id from current_profile())),
  base as materialized (select w.*,i.priority::text priority from fms_workspace_rows(p_filter) w left join fms_instances i on i.id=w.instance_id),
  ranked as (select b.*,fms_due_urgency(b.due_at,b.bucket,coalesce((select name from zone),'Asia/Kolkata')) urgency from base b)
  select r.id,r.family_id,r.flow_id,r.stage_id,r.instance_id,r.form_id,r.starting,r.workflow_name,r.stage_name,r.version,r.pipeline,r.sort_order,r.visit_number,
    r.due_at,r.status,r.bucket,r.reference,r.description,r.priority,r.urgency,
    case r.urgency when 'overdue' then 0 when 'today' then 1 when 'upcoming' then 2 else 3 end,
    case r.priority when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 3 end
  from ranked r
  where (coalesce(nullif(p_filter->>'priority',''),'all')='all' or r.priority=p_filter->>'priority')
    and (coalesce(nullif(p_filter->>'due',''),'all')='all' or r.urgency=p_filter->>'due')
    and (nullif(p_filter->>'assigneeId','') is null or not r.starting and exists(select 1 from fms_instance_stage_assignees x
      where x.fms_instance_stage_id=r.id and x.user_profile_id=(p_filter->>'assigneeId')::uuid and x.is_active))
$$;

-- Cards for rows the caller already selected (passed as JSON, so the workspace relation is not
-- evaluated twice). Record names come from the batched, authorized name projection.
create function fms_board_cards(p_rows jsonb) returns table(id uuid,card jsonb)
language sql stable security definer set search_path=public as $$
  with rows as materialized (select * from jsonb_to_recordset(coalesce(p_rows,'[]')) as x(id uuid,instance_id uuid,form_id uuid,starting boolean,
    workflow_name text,version integer,visit_number integer,due_at timestamptz,bucket text,reference text,description text,priority text,urgency text)),
  names as materialized (select * from fms_work_record_names_authorized(array(select id from rows where not starting))),
  people as materialized (select x.fms_instance_stage_id work_id,jsonb_agg(jsonb_build_object('id',p.id,'name',p.employee_name) order by p.employee_name,p.id) assignees
    from fms_instance_stage_assignees x join user_profiles p on p.id=x.user_profile_id
    where x.fms_instance_stage_id in (select id from rows where not starting) and x.is_active group by x.fms_instance_stage_id)
  select r.id,jsonb_build_object('id',r.id,'name',case when r.starting then r.workflow_name||' — Starting Form' else coalesce(n.record_name,r.workflow_name) end,
    'reference',r.reference,'description',r.description,'dueAt',r.due_at,'status',r.bucket,'visitNumber',r.visit_number,
    'priority',r.priority,'urgency',r.urgency,'version',r.version,'assignees',coalesce(people.assignees,'[]'),
    'target',case when r.starting then jsonb_build_object('kind','starter_form','starterAssignmentId',r.id,'formTemplateId',r.form_id)
      when r.form_id is not null then jsonb_build_object('kind','stage_form','instanceId',r.instance_id,'instanceStageId',r.id,'formTemplateId',r.form_id)
      else jsonb_build_object('kind','stage','instanceId',r.instance_id,'instanceStageId',r.id) end)
  from rows r left join names n on n.work_id=r.id left join people on people.work_id=r.id
$$;

-- ---------------------------------------------------------------------------------------------
-- Level 1: workflows with exact actionable / overdue / due-today counts (all pages).
-- ---------------------------------------------------------------------------------------------
create or replace function get_fms_task_workspace(p_filter jsonb default '{}',p_offset integer default 0,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform fms_workspace_validate(p_filter,p_offset,p_limit);
 with rows as materialized (select * from fms_board_rows(p_filter)), families as (
  select family_id id,(array_agg(workflow_name order by version desc,flow_id))[1] name,
   count(*) filter(where fms_workspace_status_matches(bucket,p_filter->>'status')) count,
   count(*) filter(where bucket in ('pending','overdue')) active,
   count(*) filter(where bucket in ('pending','overdue') and urgency='overdue') overdue,
   count(*) filter(where bucket in ('pending','overdue') and urgency='today') "dueToday"
  from rows group by family_id having count(*) filter(where fms_workspace_status_matches(bucket,p_filter->>'status'))>0
 ), page as(select * from families order by name,id limit p_limit offset p_offset)
 select jsonb_build_object('families',coalesce((select jsonb_agg(to_jsonb(page) order by name,id) from page),'[]'),
  'familyTotal',(select count(*) from families),'total',count(*) filter(where fms_workspace_status_matches(bucket,p_filter->>'status')),
  'activeTotal',(select count(*) from fms_workspace_rows('{}') where bucket in ('pending','overdue')),
  'counts',jsonb_build_object('active',count(*) filter(where bucket in ('pending','overdue')),'pending',count(*) filter(where bucket='pending'),
   'overdue',count(*) filter(where bucket='overdue'),'waiting',count(*) filter(where bucket='waiting'),'completed',count(*) filter(where bucket='completed'),
   'dueToday',count(*) filter(where bucket in ('pending','overdue') and urgency='today'))) into result from rows;
 return result;
end $$;

-- Ordering shared by the board's first page and every later page.
create function fms_board_order_key(p_sort text,p_urgency_rank integer,p_priority_rank integer,p_due timestamptz) returns text
language sql immutable set search_path=public as $$
  select case when coalesce(p_sort,'due')='priority' then p_priority_rank::text||p_urgency_rank::text else p_urgency_rank::text end
    ||coalesce(to_char(p_due at time zone 'UTC','YYYYMMDDHH24MISSUS'),'99999999999999999999')
    ||case when coalesce(p_sort,'due')='priority' then '' else p_priority_rank::text end
$$;

-- ---------------------------------------------------------------------------------------------
-- Later pages of one column. Same response as before plus priority, urgency, assignees.
-- ---------------------------------------------------------------------------------------------
create or replace function get_fms_task_stage_page(p_family_id uuid,p_flow_id uuid,p_stage_id uuid,p_starting boolean default false,p_filter jsonb default '{}',p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform fms_workspace_validate(p_filter,p_offset,p_limit);
 if p_starting is null or p_family_id is null or p_flow_id is null or p_stage_id is null then raise exception 'Invalid stage group' using errcode='22023'; end if;
 with eligible as materialized(select * from fms_board_rows(p_filter||jsonb_build_object('familyId',p_family_id,'stageId',p_stage_id))
  where flow_id=p_flow_id and starting=p_starting and fms_workspace_status_matches(bucket,p_filter->>'status')),
 page as materialized(select *,fms_board_order_key(p_filter->>'sort',urgency_rank,priority_rank,due_at) order_key from eligible order by order_key,id limit p_limit offset p_offset),
 cards as materialized(select * from fms_board_cards((select jsonb_agg(to_jsonb(page)) from page)))
 select jsonb_build_object('total',(select count(*) from eligible),
  'records',coalesce((select jsonb_agg(cards.card order by page.order_key,page.id) from page join cards on cards.id=page.id),'[]')) into result;
 return result;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Level 2: one workflow's board. Every stage of each version that holds the caller's work (and
-- the latest published version), each with exact counts and its first page of cards.
-- ---------------------------------------------------------------------------------------------
create function get_fms_task_board(p_family_id uuid,p_filter jsonb default '{}',p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform fms_workspace_validate(p_filter,0,greatest(1,least(coalesce(p_limit,0),50)));
 if p_family_id is null then raise exception 'A workflow family is required' using errcode='22023'; end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid FMS filters' using errcode='22023'; end if;
 with everything as materialized (select * from fms_board_rows((p_filter - 'due' - 'status')||jsonb_build_object('familyId',p_family_id))),
 work as materialized (select * from everything where fms_workspace_status_matches(bucket,p_filter->>'status')
   and (coalesce(nullif(p_filter->>'due',''),'all')='all' or urgency=p_filter->>'due')),
 latest as (select f.id from fms_flows f where coalesce(f.family_id,f.id)=p_family_id and f.status='published' and f.tenant_id=(select tenant_id from current_profile())
   and exists(select 1 from everything) order by f.version desc limit 1),
 versions as (select distinct flow_id from work union select id from latest),
 definitions as (
  select d.id,d.fms_flow_id flow_id,d.name,d.sort_order,d.step_type,d.default_next_stage_id,d.parallel_target_stage_ids,
    coalesce(d.planned_time_rule->>'pipelineName','') pipeline,f.version
  from versions v join fms_stages d on d.fms_flow_id=v.flow_id join fms_flows f on f.id=v.flow_id
 ), ordered as (
  select *,row_number() over (partition by flow_id,stage_id,starting order by fms_board_order_key(p_filter->>'sort',urgency_rank,priority_rank,due_at),id) position
  from work
 ), first_page as materialized (select * from ordered where position<=p_limit),
 cards as materialized (select * from fms_board_cards((select jsonb_agg(to_jsonb(first_page)) from first_page))),
 groups as (
  select d.id::text||':stage' id,d.flow_id "flowId",d.id "stageId",d.name,d.version,d.step_type::text "stepType",
   (select count(*) from work where stage_id=d.id and not starting) count,
   (select count(*) from work where stage_id=d.id and not starting and bucket in ('pending','overdue') and urgency='overdue') overdue,
   (select count(*) from work where stage_id=d.id and not starting and bucket in ('pending','overdue') and urgency='today') "dueToday",
   d.pipeline,greatest(d.sort_order,0) "order",false starting,
   coalesce((select jsonb_agg(ordered_targets.target order by ordered_targets.position) from (
    select target,min(ordinality) position from unnest(
     case when d.step_type='parallel_start' then coalesce(d.parallel_target_stage_ids,'{}'::uuid[])
     else coalesce((select array_agg(next_stage_id order by sort_order,id) from fms_branch_rules
       where fms_stage_id=d.id and next_stage_id is not null),'{}'::uuid[])
      ||case when d.step_type<>'branch' and not exists(select 1 from fms_branch_rules
        where fms_stage_id=d.id and condition_operator='default')
       then array_remove(array[d.default_next_stage_id],null) else '{}'::uuid[] end end
    ) with ordinality outgoing(target,ordinality) where target is not null group by target
   ) ordered_targets),'[]') "nextStageIds",
   coalesce((select jsonb_agg(c.card order by fp.position) from first_page fp join cards c on c.id=fp.id where fp.stage_id=d.id and not fp.starting),'[]') records
  from definitions d
  union all
  select w.stage_id::text||':starter',w.flow_id,w.stage_id,'Starting Form',max(w.version),'form',count(*),0,0,'',0,true,'[]'::jsonb,
   coalesce((select jsonb_agg(c.card order by fp.position) from first_page fp join cards c on c.id=fp.id where fp.stage_id=w.stage_id and fp.flow_id=w.flow_id and fp.starting),'[]')
  from work w where w.starting group by w.flow_id,w.stage_id
 )
 select jsonb_build_object(
  'name',(select (array_agg(workflow_name order by version desc,flow_id))[1] from everything),
  'counts',jsonb_build_object(
    'active',(select count(*) from everything where bucket in ('pending','overdue')),
    'overdue',(select count(*) from everything where bucket in ('pending','overdue') and urgency='overdue'),
    'dueToday',(select count(*) from everything where bucket in ('pending','overdue') and urgency='today'),
    'upcoming',(select count(*) from everything where bucket in ('pending','overdue') and urgency='upcoming'),
    'noDue',(select count(*) from everything where bucket in ('pending','overdue') and urgency='none'),
    'waiting',(select count(*) from everything where bucket='waiting'),
    'completed',(select count(*) from everything where bucket='completed'),
    'shown',(select count(*) from work)),
  'stages',coalesce((select jsonb_agg(to_jsonb(groups) order by version desc,"flowId",starting desc,"order",id) from groups),'[]')) into result;
 return result;
end $$;

-- Due-date filters and overdue ordering read planned_datetime of open visits.
create index if not exists fms_instance_stages_open_due on fms_instance_stages(planned_datetime,id)
  where status in ('pending','in_progress','in_review','overdue');

revoke all on function fms_due_parse_time(text),fms_due_parse_date(text),fms_due_parse_datetime(text,text),
  fms_form_due_resolution(jsonb,uuid,uuid,uuid,text,uuid,jsonb,uuid[]),fms_stage_due_for_visit(jsonb,uuid,uuid,uuid,text,uuid,jsonb,uuid[]),
  fms_record_due_source(uuid),assert_fms_form_due_publishable(uuid),fms_assignment_coverage(uuid,uuid,uuid,uuid[],boolean,timestamptz),
  fms_due_urgency(timestamptz,text,text,timestamptz),fms_board_rows(jsonb),fms_board_cards(jsonb),fms_board_order_key(text,integer,integer,timestamptz),
  get_fms_task_board(uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function get_fms_task_board(uuid,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
