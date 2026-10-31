-- FMS due dates from form answers, automatically (2026-10-31).
--
-- 0360 let a step take its deadline from a form answer only after the author switched on
-- "Set deadline" and chose "From form answer" plus the question for every incoming step.
-- No production step was ever configured that way, so FMS work had no due date.
--
-- Now a person's step whose deadline is off (the default) and that has no formDue rule reads
-- the answered follow-up / next / due date question of the causal previous form, the same
-- source 0360 uses. A step with an explicit timing rule or formDue rule is unchanged. The
-- author can turn the automatic date off per step: planned_time_rule.autoFormDue = false.
--
-- * Only questions whose name means a future date (next, follow-up, due, appointment ...) and
--   never one that names a past event (received, last, birth ...). Same rule as
--   isFmsDueDateQuestion in @jewelos/core.
-- * The question must be shown, its condition met and its section reached (the section the
--   employee filled), exactly like 0360. Unanswered or malformed answers are skipped, never an
--   error: the automatic date never blocks a submission.
-- * Several answered questions with different dates are ambiguous: no due date.
-- * Date only: the end of that day in the tenant timezone. A "time" question next to it is used
--   when exactly one is answered.
-- * Open visits that are still undated get their date once (logged as a backfill); completed
--   visits are never rewritten.
set search_path=public,extensions;

create function fms_due_question_name(p_name text) returns boolean
language sql immutable set search_path=public as $$
  select coalesce(p_name,'') ~* '\m(next|follow[[:space:]-]?up|due|deadline|appointment|meeting|call[[:space:]]?back|callback|visit|scheduled?|revisit)\M'
     and coalesce(p_name,'') !~* '\m(last|previous|received|birth|dob|anniversary|created|joined|joining|purchased?)\M'
$$;

create function fms_auto_form_due_applies(p_rule jsonb,p_step_type text) returns boolean
language sql immutable set search_path=public as $$
  select coalesce(p_step_type,'') in ('form','task','approval')
     and jsonb_typeof(p_rule->'formDue') is distinct from 'object'
     and p_rule->'deadlineEnabled'='false'::jsonb
     and p_rule->'autoFormDue' is distinct from 'false'::jsonb
$$;

-- Returns { dueAt, source: form_answer|none, automatic: true, reason?, sourceVisitId?, submissionId?,
-- stageKey?, dateFieldKey?, timeFieldKey? }.
create function fms_auto_form_due(p_tenant_id uuid,p_instance_id uuid,p_source_visit_id uuid,
  p_candidate_stage_id uuid default null,p_candidate_answers jsonb default null,p_candidate_path uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare zone text; prior fms_instance_stages; work fms_instance_stages; step fms_stages; answers jsonb; submission_id uuid;
  reached text[]; form_sections jsonb; f form_fields; due timestamptz; d date; t time; section text; time_key text; time_count integer;
  dues timestamptz[]:='{}'; date_keys text[]:='{}'; time_keys text[]:='{}';
begin
  if p_source_visit_id is null then return jsonb_build_object('dueAt',null,'source','none','automatic',true,'reason','no_source_form'); end if;
  select coalesce(nullif(timezone,''),'Asia/Kolkata') into zone from tenants where id=p_tenant_id;
  zone:=coalesce(zone,'Asia/Kolkata');
  select * into prior from fms_instance_stages where id=p_source_visit_id and fms_instance_id=p_instance_id;
  if prior.id is null then raise exception 'Deadline source belongs to another workflow' using errcode='42501'; end if;
  -- The nearest earlier visit on this route that had a form (same causal path as 0360 / Assigned To).
  select visit.* into work from unnest(coalesce(p_candidate_path,prior.execution_path,'{}')||array[prior.id]) with ordinality path(id,depth)
    join fms_instance_stages visit on visit.id=path.id and visit.fms_instance_id=p_instance_id
    join fms_stages definition on definition.id=visit.fms_stage_id
    where definition.form_template_id is not null and visit.outcome is distinct from 'condition_skipped'
      and (visit.status='completed' or visit.id=prior.id)
    order by path.depth desc limit 1;
  if work.id is null then return jsonb_build_object('dueAt',null,'source','none','automatic',true,'reason','no_source_form'); end if;
  select * into step from fms_stages where id=work.fms_stage_id;
  if p_candidate_answers is not null and work.fms_stage_id=p_candidate_stage_id then answers:=p_candidate_answers; submission_id:=null;
  else
    select s.data,s.id into answers,submission_id from form_submissions s
      where s.id=work.form_submission_id and s.tenant_id=p_tenant_id and s.status='submitted';
  end if;
  if answers is null then return jsonb_build_object('dueAt',null,'source','none','automatic',true,'reason','no_submission','sourceVisitId',work.id); end if;
  select coalesce(tpl.sections,'[]') into form_sections from form_templates tpl where tpl.id=step.form_template_id;
  reached:=form_reachable_sections(step.form_template_id,answers);
  for f in select * from form_fields where form_template_id=step.form_template_id and field_type in ('date','datetime')
      and fms_due_question_name(field_name) order by sort_order, field_key loop
    section:=form_field_section_key(f.group_name,form_sections);
    continue when not (f.is_shown and form_condition_matches(f.conditional_logic,answers)
      and (reached is null or section=any(reached))
      and (nullif(step.planned_time_rule->>'formSectionKey','') is null or section=step.planned_time_rule->>'formSectionKey'));
    continue when nullif(btrim(answers->>f.field_key),'') is null;
    due:=null; t:=null; time_key:=null;
    if f.field_type='datetime' then due:=fms_due_parse_datetime(answers->>f.field_key,zone);
    else
      d:=fms_due_parse_date(answers->>f.field_key);
      if d is not null then
        select count(*),min(x.field_key) into time_count,time_key from form_fields x
          where x.form_template_id=step.form_template_id and x.field_type in ('text','select','radio') and x.field_name ~* '\mtime\M'
            and x.is_shown and form_condition_matches(x.conditional_logic,answers)
            and form_field_section_key(x.group_name,form_sections) is not distinct from section and nullif(btrim(answers->>x.field_key),'') is not null;
        if time_count=1 then t:=fms_due_parse_time(answers->>time_key); end if;
        if t is null then time_key:=null; end if;
        due:=case when t is null then (d+time '23:59:59.999999') at time zone zone else (d+t) at time zone zone end;
      end if;
    end if;
    if due is not null then dues:=dues||due; date_keys:=date_keys||f.field_key::text; time_keys:=time_keys||coalesce(time_key,''); end if;
  end loop;
  if cardinality(dues)=0 then
    return jsonb_build_object('dueAt',null,'source','none','automatic',true,'reason','no_due_answer','sourceVisitId',work.id,'submissionId',submission_id,'stageKey',step.stage_key);
  end if;
  if (select count(distinct value) from unnest(dues) value)>1 then
    return jsonb_build_object('dueAt',null,'source','none','automatic',true,'reason','several_dates','sourceVisitId',work.id,'submissionId',submission_id,'stageKey',step.stage_key);
  end if;
  return jsonb_build_object('dueAt',dues[1],'source','form_answer','automatic',true,'sourceVisitId',work.id,'submissionId',submission_id,
    'stageKey',step.stage_key,'dateFieldKey',date_keys[1],'timeFieldKey',nullif(time_keys[1],''));
end $$;

-- The 0360 resolver: steps with the deadline off and no formDue now use the automatic date.
do $$
declare definition text; patched text;
  marker text:='  if jsonb_typeof(cfg) is distinct from ''object'' or coalesce(p_step_type,'''') not in (''form'',''task'',''approval'') then';
begin
  definition:=pg_get_functiondef('fms_form_due_resolution(jsonb,uuid,uuid,uuid,text,uuid,jsonb,uuid[])'::regprocedure);
  patched:=replace(definition,marker,
    '  if fms_auto_form_due_applies(p_rule,p_step_type) then'||E'\n'||
    '    return fms_auto_form_due(p_tenant_id,p_instance_id,p_source_visit_id,p_candidate_stage_id,p_candidate_answers,p_candidate_path);'||E'\n'||
    '  end if;'||E'\n'||marker);
  if patched=definition then raise exception 'Form due resolver marker changed'; end if;
  execute patched;
end $$;

-- Provenance: also log the automatic date (only when one was found, so steps without a date
-- question do not log on every visit).
create or replace function fms_record_due_source(p_visit_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare visit fms_instance_stages; step fms_stages; i fms_instances; resolution jsonb; automatic boolean;
begin
  select * into visit from fms_instance_stages where id=p_visit_id;
  select * into step from fms_stages where id=visit.fms_stage_id;
  if step.step_type::text not in ('form','task','approval') then return; end if;
  automatic:=fms_auto_form_due_applies(step.planned_time_rule,step.step_type::text);
  if jsonb_typeof(step.planned_time_rule->'formDue') is distinct from 'object' and not automatic then return; end if;
  select * into i from fms_instances where id=visit.fms_instance_id;
  resolution:=fms_form_due_resolution(step.planned_time_rule,i.tenant_id,i.id,visit.previous_instance_stage_id,step.step_type::text);
  if automatic and resolution->>'dueAt' is null then return; end if;
  insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
    values(p_visit_id,i.started_by,'due_date_resolved',resolution||jsonb_build_object('plannedDatetime',visit.planned_datetime));
end $$;

revoke all on function fms_due_question_name(text),fms_auto_form_due_applies(jsonb,text),
  fms_auto_form_due(uuid,uuid,uuid,uuid,jsonb,uuid[]) from public,anon,authenticated;

-- One-time: open visits that are still undated take the date their previous form recorded.
do $$
declare r record; resolution jsonb;
begin
  for r in select v.id,v.previous_instance_stage_id,i.id instance_id,i.tenant_id,i.started_by
    from fms_instance_stages v
    join fms_stages s on s.id=v.fms_stage_id
    join fms_instances i on i.id=v.fms_instance_id
    where v.status in ('pending','in_progress','in_review','overdue') and v.planned_datetime is null
      and v.previous_instance_stage_id is not null and i.status in ('active','overdue')
      and fms_auto_form_due_applies(s.planned_time_rule,s.step_type::text)
    order by v.id
  loop
    resolution:=fms_auto_form_due(r.tenant_id,r.instance_id,r.previous_instance_stage_id);
    continue when resolution->>'dueAt' is null;
    update fms_instance_stages set planned_datetime=(resolution->>'dueAt')::timestamptz,updated_at=now() where id=r.id and planned_datetime is null;
    insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
      values(r.id,r.started_by,'due_date_resolved',resolution||jsonb_build_object('plannedDatetime',resolution->'dueAt','backfill',true));
  end loop;
end $$;
