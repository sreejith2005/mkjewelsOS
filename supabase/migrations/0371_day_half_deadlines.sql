-- Universal first-half / second-half deadlines (owner decision 2026-11-03).
--
-- MK Jewels' working day has two halves with one fixed deadline each, in India time:
--   FIRST HALF  -> 15:00 Asia/Kolkata
--   SECOND HALF -> 21:00 Asia/Kolkata
-- Actionable work that has no usable deadline of its own takes the next half-day deadline after
-- the moment it became actionable (server time):
--   before 15:00 -> 21:00 the same day (second half)
--   15:00 or later -> 15:00 the next day (first half)
-- Weekends and holidays are not skipped. @jewelos/core dayHalfDeadline.ts mirrors this rule.
--
-- What changes, all inside the transaction that already creates or activates the work:
-- 1. FMS person steps (form/task/approval). The existing resolver chain is untouched and keeps
--    its order: explicit form-answer deadline (formDue, incl. onMissing require/fallback), the
--    follow-up schedule, the step's timing rule, then the automatic form-answer date (0361).
--    Only when that whole chain resolves no deadline does the step take the half-day deadline.
--    End, branch, notification and parallel nodes never get one. Provenance is logged.
-- 2. Starting-form assignments get a stored due_at (new column) and the readers that showed them
--    undated (0304) now show it.
-- 3. CRM walk-in tasks were created with no due date, so they were "overdue" the moment they
--    appeared; they now take the half-day deadline.
-- 4. An on-demand duty enforced by a manager whose template has no time used a hard-coded 20:00;
--    it now takes the half-day deadline. Template times and self-started duties are unchanged.
-- 5. Existing data is NOT rewritten here. reconcile_day_half_deadlines(...) reports what it would
--    change (dry run, the default) and applies it in audited, idempotent batches when the owner
--    runs it with p_apply => true. Imported templates keep no First/Second Half provenance, so
--    13:00 / 20:00 schedules are reported as ambiguous and change only through an explicit,
--    owner-verified template list.
--
-- Every patched function body is checked for its marker so a drifted production body stops the
-- migration instead of being half-patched.
set search_path=public,extensions;

-- ---------------------------------------------------------------------------------------------
-- 1. The policy.
-- ---------------------------------------------------------------------------------------------
create function day_half_deadline(p_reference timestamptz) returns timestamptz
language sql immutable set search_path=public as $$
  select case when (p_reference at time zone 'Asia/Kolkata')::time < time '15:00'
    then ((p_reference at time zone 'Asia/Kolkata')::date + time '21:00') at time zone 'Asia/Kolkata'
    else ((p_reference at time zone 'Asia/Kolkata')::date + 1 + time '15:00') at time zone 'Asia/Kolkata' end
$$;

-- 'first_half' / 'second_half' when a deadline sits exactly on 15:00 / 21:00 India time.
create function day_half_of(p_due timestamptz) returns text
language sql immutable set search_path=public as $$
  select case (p_due at time zone 'Asia/Kolkata')::time when time '15:00' then 'first_half' when time '21:00' then 'second_half' end
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. FMS: the half-day deadline is the last step of the existing resolver chain.
-- ---------------------------------------------------------------------------------------------
alter function fms_form_due_resolution(jsonb,uuid,uuid,uuid,text,uuid,jsonb,uuid[]) rename to fms_form_due_resolution_before_day_half;
create function fms_form_due_resolution(p_rule jsonb,p_tenant_id uuid,p_instance_id uuid,p_source_visit_id uuid,p_step_type text,
  p_candidate_stage_id uuid default null,p_candidate_answers jsonb default null,p_candidate_path uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare resolution jsonb; due timestamptz;
begin
  -- A require-policy error, an explicit form date, a schedule or a timing rule all come from here.
  resolution:=fms_form_due_resolution_before_day_half(p_rule,p_tenant_id,p_instance_id,p_source_visit_id,p_step_type,p_candidate_stage_id,p_candidate_answers,p_candidate_path);
  if resolution->>'dueAt' is not null or coalesce(p_step_type,'') not in ('form','task','approval') then return resolution; end if;
  -- now() is the server time of this transaction: the moment the previous step was completed and
  -- this one activated (they commit together), never a browser clock.
  due:=day_half_deadline(now());
  return resolution||jsonb_build_object('dueAt',due,'source','day_half','half',day_half_of(due),'referenceAt',now(),
    'resolvedSource',resolution->>'source');
end $$;

-- Provenance: also log the half-day deadline (formDue and automatic dates log as before).
create or replace function fms_record_due_source(p_visit_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare visit fms_instance_stages; step fms_stages; i fms_instances; resolution jsonb; automatic boolean;
begin
  select * into visit from fms_instance_stages where id=p_visit_id;
  select * into step from fms_stages where id=visit.fms_stage_id;
  if step.step_type::text not in ('form','task','approval') then return; end if;
  automatic:=fms_auto_form_due_applies(step.planned_time_rule,step.step_type::text);
  select * into i from fms_instances where id=visit.fms_instance_id;
  resolution:=fms_form_due_resolution(step.planned_time_rule,i.tenant_id,i.id,visit.previous_instance_stage_id,step.step_type::text);
  if resolution->>'source' is distinct from 'day_half' then
    if jsonb_typeof(step.planned_time_rule->'formDue') is distinct from 'object' and not automatic then return; end if;
    if automatic and resolution->>'dueAt' is null then return; end if;
  end if;
  insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
    values(p_visit_id,i.started_by,'due_date_resolved',resolution||jsonb_build_object('plannedDatetime',visit.planned_datetime));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Starting-form assignments: a stored deadline from the moment they were assigned.
-- ---------------------------------------------------------------------------------------------
alter table fms_starter_assignments add column due_at timestamptz;
comment on column fms_starter_assignments.due_at is 'Half-day deadline from when the starting form was assigned (0371). Null only for rows assigned before 0371 that reconcile_day_half_deadlines has not dated yet.';

create function fms_starter_assignment_due() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.status='pending' and new.due_at is null then new.due_at:=day_half_deadline(coalesce(new.created_at,now())); end if;
  return new;
end $$;
create trigger fms_starter_assignment_due before insert on fms_starter_assignments
  for each row execute function fms_starter_assignment_due();

do $$
declare definition text; patched text; marker text; replacement text;
begin
  -- FMS workspace and board: the deadline, and overdue once it has passed.
  definition:=replace(pg_get_functiondef('fms_workspace_rows(jsonb)'::regprocedure),E'\r','');
  marker:='''Starting Form'',f.version,'''',-1,0,null::timestamptz,s.status,';
  patched:=replace(definition,marker,'''Starting Form'',f.version,'''',-1,0,s.due_at,s.status,');
  marker:='case when s.status=''completed'' then ''completed'' else ''pending'' end,'''',coalesce(d.method,'''')';
  replacement:='case when s.status=''completed'' then ''completed'' when s.due_at<now() then ''overdue'' else ''pending'' end,'''',coalesce(d.method,'''')';
  if (length(patched)-length(replace(patched,marker,'')))/length(marker)<>1 then raise exception 'Starter workspace bucket marker changed'; end if;
  patched:=replace(patched,marker,replacement);
  if position('-1,0,s.due_at,s.status,' in patched)=0 then raise exception 'Starter workspace deadline marker changed'; end if;
  execute patched;

  -- Tasks search / Task Control.
  definition:=replace(pg_get_functiondef('task_workspace_page(jsonb,integer,integer)'::regprocedure),E'\r','');
  marker:='null::uuid,s.assigned_by,null::timestamptz,s.created_at,''medium''::task_priority';
  if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then raise exception 'Starter search deadline marker changed'; end if;
  execute replace(definition,marker,'null::uuid,s.assigned_by,s.due_at,s.created_at,''medium''::task_priority');

  -- Management insights (reports).
  definition:=replace(pg_get_functiondef('management_insights_rows_v1(jsonb)'::regprocedure),E'\r','');
  patched:=replace(definition,'''status'',s.status,''due'',null,''completed'',s.completed_at,''module'',''workflows''',
    '''status'',s.status,''due'',s.due_at,''completed'',s.completed_at,''module'',''workflows''');
  patched:=replace(patched,'''workflows''::text,s.status::text,null::timestamptz,s.completed_at','''workflows''::text,s.status::text,s.due_at,s.completed_at');
  if position('''due'',s.due_at' in patched)=0 or position('s.status::text,s.due_at,s.completed_at' in patched)=0 then raise exception 'Starter insights deadline marker changed'; end if;
  execute patched;

  -- Legacy task feeds.
  definition:=pg_get_viewdef('v_all_tasks'::regclass,true);
  marker:='NULL::timestamp with time zone AS planned_datetime';
  if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then raise exception 'Starter feed deadline marker changed'; end if;
  patched:=replace(definition,marker,'starter.due_at AS planned_datetime');
  marker:='NULL::timestamp with time zone AS effective_due_datetime';
  if (length(patched)-length(replace(patched,marker,'')))/length(marker)<>1 then raise exception 'Starter feed effective deadline marker changed'; end if;
  patched:=replace(patched,marker,'starter.due_at AS effective_due_datetime');
  execute 'create or replace view public.v_all_tasks with (security_invoker=true) as '||patched;

  definition:=pg_get_viewdef('v_task_feed_scope'::regclass,true);
  patched:=replace(definition,'starter.created_at AS effective_due_datetime','COALESCE(starter.due_at, starter.created_at) AS effective_due_datetime');
  patched:=replace(patched,'starter.created_at AS planned_datetime','COALESCE(starter.due_at, starter.created_at) AS planned_datetime');
  if position('starter.created_at AS' in patched)>0 or patched=definition then raise exception 'Starter feed scope marker changed'; end if;
  execute 'create or replace view public.v_task_feed_scope with (security_invoker=true) as '||patched;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. CRM walk-in tasks: the half-day deadline from the moment the task is created.
-- ---------------------------------------------------------------------------------------------
create function task_instance_walkin_due() returns trigger
language plpgsql set search_path=public as $$
begin
  new.due_datetime:=day_half_deadline(coalesce(new.created_at,now()));
  return new;
end $$;
create trigger task_instances_walkin_due before insert on task_instances
  for each row when (new.source='crm_walkin' and new.due_datetime is null and new.revised_datetime is null)
  execute function task_instance_walkin_due();

-- ---------------------------------------------------------------------------------------------
-- 5. On-demand duty enforced by a manager, template without a time: half-day, not 20:00.
-- ---------------------------------------------------------------------------------------------
do $$
declare definition text; marker text;
begin
  definition:=replace(pg_get_functiondef('start_on_demand_task_with_audit(uuid)'::regprocedure),E'\r','');
  marker:='v_due:=((v_today::text||'' ''||coalesce(v_template.due_time,v_template.planned_time,''20:00''::time)::text)::timestamp'
    ||E'\n      at time zone ''Asia/Kolkata'');';
  if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then raise exception 'On-demand deadline marker changed'; end if;
  -- The template's own time still wins, and the existing 30-minute guard below is unchanged.
  execute replace(definition,marker,
    'v_due:=case when coalesce(v_template.due_time,v_template.planned_time) is null then day_half_deadline(now())'
    ||E'\n      else ((v_today::text||'' ''||coalesce(v_template.due_time,v_template.planned_time)::text)::timestamp at time zone ''Asia/Kolkata'') end;');
end $$;

-- The policy itself is pure date arithmetic with no data access: any signed-in reader may use it.
revoke all on function day_half_deadline(timestamptz),day_half_of(timestamptz) from public,anon,service_role;
grant execute on function day_half_deadline(timestamptz),day_half_of(timestamptz) to authenticated;
revoke all on function
  fms_form_due_resolution(jsonb,uuid,uuid,uuid,text,uuid,jsonb,uuid[]),fms_form_due_resolution_before_day_half(jsonb,uuid,uuid,uuid,text,uuid,jsonb,uuid[]),
  fms_starter_assignment_due(),task_instance_walkin_due() from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. Existing data: dry run first, then audited idempotent batches. Run by the owner only.
-- ---------------------------------------------------------------------------------------------
-- Open person work on FMS still without a deadline, with the moment it became actionable.
create function day_half_open_fms_work() returns table(id uuid,tenant_id uuid,actor uuid,reference timestamptz)
language sql stable security definer set search_path=public as $$
  select v.id,i.tenant_id,i.started_by,coalesce(v.activated_at,prior.actual_datetime,v.created_at)
  from fms_instance_stages v join fms_stages s on s.id=v.fms_stage_id join fms_instances i on i.id=v.fms_instance_id
  left join fms_instance_stages prior on prior.id=v.previous_instance_stage_id
  where v.planned_datetime is null and v.status in ('pending','in_progress','in_review','overdue') and i.status in ('active','overdue')
    and s.step_type::text in ('form','task','approval') and coalesce(v.outcome,'') not in ('condition_skipped','workflow_closed')
$$;

create function reconcile_day_half_deadlines(p_apply boolean default false,p_limit integer default 500,
  p_first_half_template_ids uuid[] default '{}',p_second_half_template_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; due timestamptz; new_due time; done_visits integer:=0; done_starters integer:=0; done_walkins integer:=0;
  done_templates integer:=0; done_occurrences integer:=0; changed integer; report jsonb;
  first_ids uuid[]:=coalesce(p_first_half_template_ids,'{}'); second_ids uuid[]:=coalesce(p_second_half_template_ids,'{}');
begin
  if p_limit is null or p_limit not between 1 and 5000 then raise exception 'Batch size must be 1 to 5000' using errcode='22023'; end if;
  if first_ids && second_ids then raise exception 'A schedule cannot be both First Half and Second Half' using errcode='22023'; end if;


  if p_apply then
    for r in select * from day_half_open_fms_work() w order by w.reference,w.id limit p_limit loop
      due:=day_half_deadline(r.reference);
      update fms_instance_stages set planned_datetime=due,updated_at=now() where id=r.id and planned_datetime is null;
      get diagnostics changed=row_count; continue when changed=0;
      done_visits:=done_visits+1;
      insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
        values(r.id,r.actor,'due_date_resolved',jsonb_build_object('dueAt',due,'source','day_half','half',day_half_of(due),'referenceAt',r.reference,'backfill',true,'plannedDatetime',due));
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
        values(r.tenant_id,null,'day_half_deadline_backfilled','fms_instance_stages',r.id,jsonb_build_object('planned_datetime',null),
          jsonb_build_object('planned_datetime',due,'reference_at',r.reference));
    end loop;

    for r in select s.* from fms_starter_assignments s where s.status='pending' and s.due_at is null order by s.created_at,s.id limit p_limit loop
      due:=day_half_deadline(r.created_at);
      update fms_starter_assignments set due_at=due where id=r.id and due_at is null and status='pending';
      get diagnostics changed=row_count; continue when changed=0;
      done_starters:=done_starters+1;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
        values(r.tenant_id,null,'day_half_deadline_backfilled','fms_starter_assignments',r.id,jsonb_build_object('due_at',null),
          jsonb_build_object('due_at',due,'reference_at',r.created_at));
    end loop;

    for r in select t.* from task_instances t where t.source='crm_walkin' and t.due_datetime is null and t.revised_datetime is null
        and t.deleted_at is null and t.status not in ('completed','rejected') order by t.created_at,t.id limit p_limit loop
      due:=day_half_deadline(coalesce(r.created_at,r.planned_datetime));
      update task_instances set due_datetime=due,updated_at=now() where id=r.id and due_datetime is null and revised_datetime is null;
      get diagnostics changed=row_count; continue when changed=0;
      done_walkins:=done_walkins+1;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
        values(r.tenant_id,null,'day_half_deadline_backfilled','tasks',r.id,jsonb_build_object('due_datetime',null),
          jsonb_build_object('due_datetime',due,'reference_at',coalesce(r.created_at,r.planned_datetime)));
    end loop;

    -- Owner-verified schedules only. Completed work and manually revised deadlines are kept.
    for r in select t.*,case when t.id=any(first_ids) then time '15:00' else time '21:00' end half_due
        from task_templates t where (t.id=any(first_ids) or t.id=any(second_ids)) and t.deleted_at is null
          and t.due_time is distinct from case when t.id=any(first_ids) then time '15:00' else time '21:00' end
          and (t.planned_time is null or t.planned_time<case when t.id=any(first_ids) then time '15:00' else time '21:00' end)
        order by t.id limit p_limit loop
      new_due:=r.half_due;
      update task_templates set due_time=new_due,updated_at=now() where id=r.id;
      update task_instances set due_datetime=(coalesce(scheduled_date,(planned_datetime at time zone 'Asia/Kolkata')::date)+new_due) at time zone 'Asia/Kolkata',updated_at=now()
        where task_template_id=r.id and deleted_at is null and revised_datetime is null and status not in ('completed','rejected');
      get diagnostics changed=row_count;
      done_templates:=done_templates+1; done_occurrences:=done_occurrences+changed;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
        values(r.tenant_id,null,'day_half_schedule_reconciled','task_templates',r.id,jsonb_build_object('due_time',r.due_time),
          jsonb_build_object('due_time',new_due,'half',case when new_due=time '15:00' then 'first_half' else 'second_half' end,'open_occurrences_updated',changed));
    end loop;
  end if;

  report:=jsonb_build_object(
    'mode',case when p_apply then 'apply' else 'dry_run' end,
    'applied',jsonb_build_object('fms_visits',done_visits,'starting_forms',done_starters,'crm_walkin_tasks',done_walkins,
      'schedules',done_templates,'schedule_occurrences',done_occurrences),
    'remaining',jsonb_build_object(
      'fms_visits_without_deadline',jsonb_build_object('action','set half-day deadline from activation time',
        'count',(select count(*) from day_half_open_fms_work()),
        'overdue_once_dated',(select count(*) from day_half_open_fms_work() w where day_half_deadline(w.reference)<now())),
      'starting_forms_without_deadline',jsonb_build_object('action','set half-day deadline from assignment time',
        'count',(select count(*) from fms_starter_assignments where status='pending' and due_at is null),
        'overdue_once_dated',(select count(*) from fms_starter_assignments where status='pending' and due_at is null and day_half_deadline(created_at)<now())),
      'crm_walkin_tasks_without_deadline',jsonb_build_object('action','set half-day deadline from creation time',
        'count',(select count(*) from task_instances where source='crm_walkin' and due_datetime is null and revised_datetime is null and deleted_at is null and status not in ('completed','rejected')),
        'overdue_once_dated',(select count(*) from task_instances where source='crm_walkin' and due_datetime is null and revised_datetime is null and deleted_at is null and status not in ('completed','rejected')
          and day_half_deadline(coalesce(created_at,planned_datetime))<now())),
      'verified_schedules',jsonb_build_object('action','set due time to 15:00 / 21:00 and update open occurrences',
        'first_half',(select count(*) from task_templates where id=any(first_ids) and deleted_at is null and due_time is distinct from time '15:00' and (planned_time is null or planned_time<time '15:00')),
        'second_half',(select count(*) from task_templates where id=any(second_ids) and deleted_at is null and due_time is distinct from time '21:00' and (planned_time is null or planned_time<time '21:00')),
        'open_occurrences',(select count(*) from task_instances i join task_templates t on t.id=i.task_template_id
          where (t.id=any(first_ids) and t.due_time is distinct from time '15:00' or t.id=any(second_ids) and t.due_time is distinct from time '21:00')
            and t.deleted_at is null and i.deleted_at is null and i.revised_datetime is null and i.status not in ('completed','rejected')),
        'not_applied',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'reason',case when t.id is null then 'not found'
            when t.deleted_at is not null then 'deleted'
            else 'start time is not before the half-day deadline' end) order by x.id)
          from unnest(first_ids||second_ids) x(id) left join task_templates t on t.id=x.id
          where t.id is null or t.deleted_at is not null
            or t.planned_time>=case when x.id=any(first_ids) then time '15:00' else time '21:00' end),'[]'::jsonb))),
    -- Not changed automatically: no stored First/Second Half provenance. The owner verifies these.
    'ambiguous_active_schedules',(select jsonb_build_object(
        'due_13_00',count(*) filter (where due_time=time '13:00'),
        'due_20_00',count(*) filter (where due_time=time '20:00'),
        'due_other_time',count(*) filter (where due_time is not null and due_time not in (time '13:00',time '20:00',time '15:00',time '21:00')),
        'already_15_00_or_21_00',count(*) filter (where due_time in (time '15:00',time '21:00')),
        'no_time',count(*) filter (where due_time is null and planned_time is null),
        'items_13_00_and_20_00',coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'schedule_kind',schedule_kind,'start',planned_time,'due',due_time)
          order by due_time,title,id) filter (where due_time in (time '13:00',time '20:00')),'[]'::jsonb))
      from task_templates where deleted_at is null and coalesce(is_active,false)
        and not (id=any(first_ids) or id=any(second_ids))));
  return report;
end $$;
revoke all on function reconcile_day_half_deadlines(boolean,integer,uuid[],uuid[]),day_half_open_fms_work() from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
