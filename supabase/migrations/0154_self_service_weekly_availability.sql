-- Everyone is present by default, and marking yourself away is now self-service.
-- Any active user may set their own availability for any day of the current
-- Monday-to-Sunday week - the days already gone as well as the days still to
-- come - so a whole week off is one action. Recording availability for somebody
-- else, or outside the current week, stays with super_admin / admin / manager /
-- hr exactly as before, and every write keeps the absence-coverage handover
-- restored in 0145.
set search_path = public, extensions;

create or replace function current_availability_week_start()
returns date language sql stable set search_path=public as $$
  select date_trunc('week',(now() at time zone 'Asia/Kolkata'))::date;
$$;

create or replace function record_availability_with_audit(p_user_profile_id uuid,p_date date,p_status availability_status,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old user_availability; v_new user_availability; v_task task_instances;
  v_privileged boolean; v_week_start date;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active() then raise exception 'Availability cannot be recorded for this user' using errcode='42501'; end if;
  v_privileged:=v_actor.user_role in ('super_admin','admin','manager','hr');
  if not (p_user_profile_id=v_actor.id or v_privileged) or not exists(select 1 from user_profiles where id=p_user_profile_id and tenant_id=v_actor.tenant_id) then raise exception 'Availability cannot be recorded for this user' using errcode='42501'; end if;
  if not v_privileged then
    v_week_start:=current_availability_week_start();
    if p_date<v_week_start or p_date>v_week_start+6 then raise exception 'You can only change your availability inside the current week' using errcode='22023'; end if;
  end if;
  select * into v_old from user_availability where user_profile_id=p_user_profile_id and date=p_date;
  insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by,source) values(v_actor.tenant_id,p_user_profile_id,p_date,p_status,nullif(btrim(p_reason),''),v_actor.id,'manual') on conflict(user_profile_id,date) do update set status=excluded.status,reason=excluded.reason,logged_by=excluded.logged_by,source='manual' returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'availability_recorded','availability',v_new.id,case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));

  if p_status='absent' then
    perform reconcile_all_assignment_coverage_with_audit(p_user_profile_id,p_date,p_reason);
  elsif v_old.status='absent' and is_user_available_for_task(p_user_profile_id,p_date) then
    for v_task in
      select * from task_instances
      where tenant_id=v_actor.tenant_id and coverage_original_assignee_id=p_user_profile_id
        and coverage_resolved_for_date=p_date and status not in ('completed','rejected')
      for update
    loop
      update task_assignees set is_active=false
      where task_instance_id=v_task.id and role_at_task='doer' and is_active and not is_original;
      update task_assignees set is_active=true,completed_at=null
      where task_instance_id=v_task.id and user_profile_id=p_user_profile_id
        and role_at_task='doer' and is_original and not is_active;
      if not found then
        insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
        values(v_task.id,p_user_profile_id,'doer',true,true)
        on conflict do nothing;
      end if;
      update task_instances set coverage_status=null,coverage_original_assignee_id=null,
        coverage_resolution=null,coverage_resolved_for_date=null,updated_by=v_actor.id,updated_at=now()
      where id=v_task.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_actor.tenant_id,v_actor.id,'absence_coverage_restored','tasks',v_task.id,
        jsonb_build_object('original_assignee_id',p_user_profile_id,'coverage_resolution',v_task.coverage_resolution,'date',p_date),
        jsonb_build_object('original_assignee_id',p_user_profile_id,'effective_assignee_id',p_user_profile_id,'date',p_date));
    end loop;
  end if;
  return v_new.id;
end;
$$;

-- Marking a scattered set of days - the two days already missed plus Friday -
-- is one request and one transaction, so a partial failure never leaves half a
-- week marked. It reports the same coverage summary as a contiguous range.
create or replace function record_availability_days_with_audit(
  p_user_profile_id uuid,p_dates date[],p_status availability_status,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_date date; v_ids jsonb:='[]'::jsonb; v_summary jsonb; v_dates date[];
begin
  select array_agg(distinct day order by day) into v_dates from unnest(coalesce(p_dates,'{}'::date[])) as day;
  if v_dates is null or array_length(v_dates,1) is null then
    raise exception 'At least one date is required' using errcode='22023';
  end if;
  if array_length(v_dates,1)>31 then
    raise exception 'Availability can be recorded for at most 31 days at a time' using errcode='22023';
  end if;
  foreach v_date in array v_dates loop
    v_ids:=v_ids||jsonb_build_array(record_availability_with_audit(p_user_profile_id,v_date,p_status,p_reason));
  end loop;
  with outcomes as (
    select coverage_resolution from task_instances where coverage_original_assignee_id=p_user_profile_id
      and coverage_resolved_for_date=any(v_dates)
    union all select coverage_resolution from client_followups where coverage_original_assignee_id=p_user_profile_id
      and coverage_resolved_for_date=any(v_dates)
    union all select coverage_resolution from fms_instance_stages where coverage_original_assignee_id=p_user_profile_id
      and coverage_resolved_for_date=any(v_dates)
  ) select jsonb_build_object(
    'primary_buddy',count(*) filter(where coverage_resolution='primary_buddy'),
    'secondary_buddy',count(*) filter(where coverage_resolution='secondary_buddy'),
    'reporting_manager',count(*) filter(where coverage_resolution='reporting_manager'),
    'coverage_required',count(*) filter(where coverage_resolution='coverage_required'),
    'manager_review',count(*) filter(where coverage_resolution='manager_review')
  ) into v_summary from outcomes;
  return jsonb_build_object('dates',to_jsonb(v_dates),'record_ids',v_ids,'coverage_summary',v_summary);
end;
$$;

alter function current_availability_week_start() owner to postgres;
alter function record_availability_with_audit(uuid,date,availability_status,text) owner to postgres;
alter function record_availability_days_with_audit(uuid,date[],availability_status,text) owner to postgres;
revoke all on function current_availability_week_start() from public,anon,service_role;
revoke all on function record_availability_with_audit(uuid,date,availability_status,text) from public,anon;
revoke all on function record_availability_days_with_audit(uuid,date[],availability_status,text) from public,anon,service_role;
grant execute on function current_availability_week_start() to authenticated;
grant execute on function record_availability_with_audit(uuid,date,availability_status,text) to authenticated;
grant execute on function record_availability_days_with_audit(uuid,date[],availability_status,text) to authenticated;

notify pgrst, 'reload schema';
