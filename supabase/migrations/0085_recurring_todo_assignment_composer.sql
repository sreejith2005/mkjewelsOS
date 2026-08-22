-- The recurring assignment composer distinguishes when work starts from when
-- it is due. Coverage remains profile-owned and permanently enabled for this
-- workflow; the browser cannot select or supply a buddy.

alter table task_templates
  add column if not exists due_time time without time zone;

alter table task_templates
  add column if not exists coverage_enabled boolean not null default true;

alter table task_templates
  drop constraint if exists task_templates_recurring_coverage_enabled_check;

alter table task_templates
  add constraint task_templates_recurring_coverage_enabled_check
  check (task_type <> 'checklist' or coverage_enabled);

create or replace function apply_recurring_template_due_time()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_due_time time;
begin
  if new.task_template_id is null or new.scheduled_date is null then return new; end if;
  select due_time into v_due_time from task_templates where id=new.task_template_id;
  if v_due_time is not null then
    new.planned_datetime:=((new.scheduled_date::text||' '||v_due_time::text||' Asia/Kolkata')::timestamptz);
  end if;
  return new;
end;
$$;

drop trigger if exists task_instances_apply_recurring_due_time on task_instances;
create trigger task_instances_apply_recurring_due_time
before insert on task_instances for each row execute function apply_recurring_template_due_time();

create or replace function save_recurring_todo_template_with_audit(p_template_id uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_actor user_profiles; v_old task_templates; v_new task_templates;
  v_base jsonb; v_kind text; v_starts_on date; v_due_time time;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then
    raise exception 'Recurring schedule management denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_payload)<>'object' then raise exception 'Recurring schedule payload is invalid' using errcode='22023'; end if;
  v_kind:=coalesce(nullif(p_payload->>'schedule_kind',''),'recurring');
  if v_kind not in ('recurring','daily','weekly','monthly','nth_weekday','quarterly','yearly','one_time','as_required') then
    raise exception 'Schedule kind is unsupported' using errcode='22023';
  end if;
  begin v_due_time:=nullif(p_payload->>'due_time','')::time; exception when invalid_datetime_format then raise exception 'Due time is invalid' using errcode='22023'; end;
  if v_due_time is not null and v_due_time <= coalesce(nullif(p_payload->>'planned_time','')::time,'09:00'::time) then
    raise exception 'Due time must be after scheduled start time' using errcode='22023';
  end if;
  if coalesce((p_payload->>'coverage_enabled')::boolean,true) is not true then
    raise exception 'Recurring schedules always use profile coverage' using errcode='22023';
  end if;
  v_starts_on:=coalesce(nullif(p_payload->>'starts_on','')::date,
    case when p_template_id is null then (now() at time zone 'Asia/Kolkata')::date else null end);
  if v_kind='one_time' and v_starts_on is null then raise exception 'One-time schedules require a start date' using errcode='22023'; end if;
  if p_template_id is not null then select * into v_old from task_templates where id=p_template_id; end if;
  v_base:=p_payload-array['schedule_kind','starts_on','verification_required','followup_enabled','personal_performance_enabled','due_time','coverage_enabled'];
  if v_kind='as_required' then
    v_base:=v_base||jsonb_build_object('is_active',false);
  elsif p_template_id is null and v_starts_on is not null then
    v_base:=v_base||jsonb_build_object('initial_planned_datetime',
      (v_starts_on::text||' '||coalesce(nullif(p_payload->>'planned_time',''),'09:00')||' Asia/Kolkata')::timestamptz);
  end if;
  v_id:=save_task_template_with_audit(p_template_id,v_base);
  update task_templates set schedule_kind=v_kind,starts_on=coalesce(v_starts_on,starts_on),due_time=v_due_time,coverage_enabled=true,
    verification_required=coalesce((p_payload->>'verification_required')::boolean,false),
    followup_enabled=coalesce((p_payload->>'followup_enabled')::boolean,false),
    personal_performance_enabled=coalesce((p_payload->>'personal_performance_enabled')::boolean,true),
    is_active=case when v_kind='as_required' then false else is_active end,
    updated_by=v_actor.id,updated_at=now() where id=v_id returning * into v_new;
  if p_template_id is null and v_starts_on is not null and v_due_time is not null then
    update task_instances set planned_datetime=((v_starts_on::text||' '||v_due_time::text||' Asia/Kolkata')::timestamptz),updated_at=now()
      where task_template_id=v_id and status='pending' and scheduled_date=v_starts_on;
  end if;
  update task_instances set verification_status=case when v_new.verification_required then 'pending' else 'not_required' end,
    updated_by=v_actor.id,updated_at=now() where task_template_id=v_id and status='pending'
      and (planned_datetime at time zone 'Asia/Kolkata')::date=coalesce(v_starts_on,v_new.starts_on);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,case when p_template_id is null then 'recurring_todo_created' else 'recurring_todo_updated' end,
    'recurring_todo',v_id,case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
  return v_id;
end;
$$;

revoke all on function apply_recurring_template_due_time() from public,anon,authenticated,service_role;
revoke all on function save_recurring_todo_template_with_audit(uuid,jsonb) from public,anon;
grant execute on function save_recurring_todo_template_with_audit(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
