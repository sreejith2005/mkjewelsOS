set search_path=public,extensions;

-- Keep old request values readable; retire only the seeded choice.
update dropdown_masters set is_active=false
where master_type='leave_type' and value='earned';
insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'leave_type','Compensatory Off','compensatory_off',30,true from tenants t
on conflict(tenant_id,master_type,value) do update set is_active=true;

create view leave_handover_candidates with (security_barrier=true) as
  select p.id,p.employee_name
  from user_profiles p
  where current_profile_is_active() and module_accessible('availability')
    and p.tenant_id=current_tenant_id() and p.working_status='active'
    and p.account_status='active' and p.is_login_enabled
    and p.id<>(current_profile()).id
  order by p.employee_name,p.id;
revoke all on leave_handover_candidates from public,anon,authenticated,service_role;
grant select on leave_handover_candidates to authenticated;

-- The roster remains half_day; this function defines which half is absent.
create function leave_half_day_absent_at(p_user uuid,p_at timestamptz)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from leave_requests r
    join user_availability a on a.user_profile_id=r.applicant_id
      and a.date=(p_at at time zone 'Asia/Kolkata')::date and a.status='half_day'
    where r.applicant_id=p_user and r.status='approved'
      and r.tenant_id=a.tenant_id
      and ((r.leave_start=a.date and r.duration='2ND HALF'
        and (p_at at time zone 'Asia/Kolkata')::time>=time '13:00')
      or (r.work_start_date=a.date and r.work_start_in='2ND HALF'
        and not (r.leave_start=a.date and r.duration='2ND HALF')
        and (p_at at time zone 'Asia/Kolkata')::time<time '13:00'))
  )
$$;
revoke all on function leave_half_day_absent_at(uuid,timestamptz) from public,anon,authenticated,service_role;
create index leave_approved_half_start_idx on leave_requests(leave_start,applicant_id) where status='approved' and duration='2ND HALF';
create index leave_approved_half_return_idx on leave_requests(work_start_date,applicant_id) where status='approved' and work_start_in='2ND HALF';
alter table fms_instance_stages
  add column leave_coverage_buddy_id uuid references user_profiles(id),
  add column leave_coverage_buddy_preexisting boolean;

create function resolve_task_coverage_at(p_original_assignee_id uuid, p_target_date date,p_at timestamptz)
returns table(original_assignee_id uuid, effective_assignee_id uuid, resolution text)
language plpgsql stable security definer set search_path=public as $$
declare v_original user_profiles; v_candidate uuid;
begin
  select * into v_original from user_profiles where id=p_original_assignee_id;
  if v_original.id is null then return query select p_original_assignee_id,null::uuid,'coverage_required'::text; return; end if;
  if is_user_available_for_task(v_original.id,p_target_date)
    and not (p_target_date=(p_at at time zone 'Asia/Kolkata')::date
      and leave_half_day_absent_at(v_original.id,p_at))
    and v_original.account_status='active' and v_original.is_login_enabled then
    return query select v_original.id,v_original.id,'original'::text; return;
  end if;
  foreach v_candidate in array array[v_original.buddy_id,v_original.secondary_buddy_id] loop
    if v_candidate is not null and exists(
      select 1 from user_profiles u where u.id=v_candidate and u.tenant_id=v_original.tenant_id
        and u.account_status='active' and u.is_login_enabled and u.working_status='active'
        and is_user_available_for_task(u.id,p_target_date)
        and not (p_target_date=(p_at at time zone 'Asia/Kolkata')::date
          and leave_half_day_absent_at(u.id,p_at))
    ) then
      return query select v_original.id,v_candidate,
        case when v_candidate=v_original.buddy_id then 'primary_buddy' else 'secondary_buddy' end;
      return;
    end if;
  end loop;
  return query select v_original.id,null::uuid,'coverage_required'::text;
end;
$$;
revoke all on function resolve_task_coverage_at(uuid,date,timestamptz) from public,anon,authenticated,service_role;
create or replace function resolve_task_coverage(p_original_assignee_id uuid,p_target_date date)
returns table(original_assignee_id uuid,effective_assignee_id uuid,resolution text)
language sql stable security definer set search_path=public as $$
  select * from resolve_task_coverage_at(p_original_assignee_id,p_target_date,now())
$$;

-- New assignments use the same effective deadline as the task feed.
do $assignment$
declare v_definition text;
begin
  select pg_get_functiondef('public.apply_task_assignment_coverage()'::regprocedure) into v_definition;
  v_definition:=replace(v_definition,
    'coalesce(v_task.revised_datetime,v_task.planned_datetime)',
    'coalesce(v_task.revised_datetime,v_task.due_datetime,v_task.planned_datetime)');
  if position('coalesce(v_task.revised_datetime,v_task.due_datetime,v_task.planned_datetime)' in v_definition)=0 then
    raise exception 'Task assignment effective deadline upgrade failed';
  end if;
  execute v_definition;
end $assignment$;

-- Idempotent minute job. p_at is private so clients cannot change the clock.
create function sync_leave_half_day_tasks(p_at timestamptz)
returns void language plpgsql security definer set search_path=public as $$
declare v_day date:=(p_at at time zone 'Asia/Kolkata')::date;
  v_leave record; v_task task_instances; v_followup client_followups; v_stage fms_instance_stages;
  v_resolution record; v_absent boolean; v_effective uuid; v_covered_id uuid;
  v_buddy_preexisting boolean; v_resolution_name text;
begin
  for v_leave in
    select distinct r.applicant_id,r.tenant_id from leave_requests r
    join user_availability a on a.user_profile_id=r.applicant_id and a.date=v_day
      and a.status='half_day'
    where r.status='approved' and r.tenant_id=a.tenant_id
      and ((r.leave_start=v_day and r.duration='2ND HALF')
        or (r.work_start_date=v_day and r.work_start_in='2ND HALF'))
  loop
    v_absent:=leave_half_day_absent_at(v_leave.applicant_id,p_at);
    v_effective:=v_leave.applicant_id;
    v_resolution_name:=null;
    if v_absent then
      select * into v_resolution from resolve_task_coverage_at(v_leave.applicant_id,v_day,p_at);
      v_effective:=v_resolution.effective_assignee_id;
      v_resolution_name:=v_resolution.resolution;
    end if;
    for v_task in select ti.* from task_instances ti
      where ti.tenant_id=v_leave.tenant_id
        and ((v_absent and ti.status='pending') or (not v_absent and ti.status not in ('completed','rejected')))
        and (coalesce(ti.revised_datetime,ti.due_datetime,ti.planned_datetime) at time zone 'Asia/Kolkata')::date=v_day
        and (exists(select 1 from task_assignees ta where ta.task_instance_id=ti.id
          and ta.user_profile_id=v_leave.applicant_id and ta.role_at_task='doer' and ta.is_original and ta.is_active)
          or (ti.coverage_original_assignee_id=v_leave.applicant_id and ti.coverage_resolved_for_date=v_day))
      for update of ti
    loop
      if v_absent and v_task.coverage_original_assignee_id=v_leave.applicant_id then continue; end if;
      if not v_absent and v_task.coverage_original_assignee_id is distinct from v_leave.applicant_id then continue; end if;
      update task_assignees set is_active=false where task_instance_id=v_task.id
        and role_at_task='doer' and is_active
        and (user_profile_id=v_leave.applicant_id or not is_original);
      if v_absent then
        if v_resolution.effective_assignee_id is not null then
          insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
          values(v_task.id,v_resolution.effective_assignee_id,'doer',false,true)
          on conflict do nothing;
        end if;
        update task_instances set coverage_status=case when v_resolution.effective_assignee_id is null then 'coverage_required' else 'covered' end,
          coverage_original_assignee_id=v_leave.applicant_id,coverage_resolution=v_resolution.resolution,
          coverage_resolved_for_date=v_day,updated_at=now() where id=v_task.id;
      else
        update task_assignees set is_active=true,completed_at=null where id=(
          select id from task_assignees where task_instance_id=v_task.id
            and user_profile_id=v_leave.applicant_id and role_at_task='doer'
            and is_original and completed_at is null order by id limit 1);
        if not found then
          insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
          values(v_task.id,v_leave.applicant_id,'doer',true,true) on conflict do nothing;
        end if;
        update task_instances set coverage_status=null,coverage_original_assignee_id=null,
          coverage_resolution=null,coverage_resolved_for_date=null,updated_at=now() where id=v_task.id;
      end if;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_leave.tenant_id,null,case when v_absent then 'absence_coverage_assigned' else 'absence_coverage_restored' end,
        'tasks',v_task.id,to_jsonb(v_task),jsonb_build_object('source','approved_half_day_leave',
          'original_assignee_id',v_leave.applicant_id,'effective_assignee_id',
          v_effective,
          'at',p_at));
    end loop;
    for v_followup in select * from client_followups f
      where f.tenant_id=v_leave.tenant_id and f.due_date=v_day and f.status='open'
        and (f.assigned_to=v_leave.applicant_id
          or (f.coverage_original_assignee_id=v_leave.applicant_id and f.coverage_resolved_for_date=v_day))
      for update
    loop
      if v_absent and v_followup.coverage_original_assignee_id=v_leave.applicant_id then continue; end if;
      if not v_absent and v_followup.coverage_original_assignee_id is distinct from v_leave.applicant_id then continue; end if;
      update client_followups set assigned_to=case when v_absent and v_effective is not null then v_effective else v_leave.applicant_id end,
        coverage_status=case when v_absent then case when v_effective is null then 'coverage_required' else 'covered' end else null end,
        coverage_original_assignee_id=case when v_absent then v_leave.applicant_id else null end,
        coverage_resolution=v_resolution_name,
        coverage_resolved_for_date=case when v_absent then v_day else null end,
        updated_at=now(),record_version=record_version+1 where id=v_followup.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_leave.tenant_id,null,case when v_absent then 'absence_coverage_assigned' else 'absence_coverage_restored' end,
        'crm_followups',v_followup.id,to_jsonb(v_followup),jsonb_build_object('source','approved_half_day_leave',
          'original_assignee_id',v_leave.applicant_id,'effective_assignee_id',v_effective,'at',p_at));
    end loop;
    for v_stage in select s.* from fms_instance_stages s join fms_instances fi on fi.id=s.fms_instance_id
      where fi.tenant_id=v_leave.tenant_id and s.status='pending'
        and (s.planned_datetime at time zone 'Asia/Kolkata')::date=v_day
        and (v_leave.applicant_id=any(s.assigned_to)
          or (s.coverage_original_assignee_id=v_leave.applicant_id and s.coverage_resolved_for_date=v_day))
      for update of s
    loop
      if v_absent and v_stage.coverage_original_assignee_id=v_leave.applicant_id then continue; end if;
      if not v_absent and v_stage.coverage_original_assignee_id is distinct from v_leave.applicant_id then continue; end if;
      if v_absent then
        v_buddy_preexisting:=v_effective=any(v_stage.assigned_to);
        update fms_instance_stage_assignees set is_active=false,status='reassigned'
        where fms_instance_stage_id=v_stage.id and user_profile_id=v_leave.applicant_id and is_active;
        if v_effective is not null then
          update fms_instance_stage_assignees set is_active=true,status='assigned' where id=(
            select id from fms_instance_stage_assignees where fms_instance_stage_id=v_stage.id
              and user_profile_id=v_effective and not is_active order by assigned_at desc,id limit 1);
          if not found and not exists(select 1 from fms_instance_stage_assignees
            where fms_instance_stage_id=v_stage.id and user_profile_id=v_effective and is_active) then
            insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_at)
            values(v_leave.tenant_id,v_stage.id,v_effective,clock_timestamp());
          end if;
        end if;
        update fms_instance_stages set assigned_to=case when v_effective is null or v_buddy_preexisting
            then array_remove(assigned_to,v_leave.applicant_id)
            else array_append(array_remove(assigned_to,v_leave.applicant_id),v_effective) end,
          coverage_status=case when v_effective is null then 'coverage_required' else 'covered' end,
          coverage_original_assignee_id=v_leave.applicant_id,coverage_resolution=v_resolution_name,
          coverage_resolved_for_date=v_day,leave_coverage_buddy_id=v_effective,
          leave_coverage_buddy_preexisting=v_buddy_preexisting,updated_at=now() where id=v_stage.id;
      else
        v_covered_id:=v_stage.leave_coverage_buddy_id;
        update fms_instance_stage_assignees set is_active=false,status='reassigned'
        where fms_instance_stage_id=v_stage.id and user_profile_id=v_covered_id and is_active
          and v_stage.leave_coverage_buddy_preexisting is not true;
        update fms_instance_stage_assignees set is_active=true,status='assigned' where id=(
          select id from fms_instance_stage_assignees where fms_instance_stage_id=v_stage.id
            and user_profile_id=v_leave.applicant_id and not is_active order by assigned_at desc,id limit 1);
        if not found and not exists(select 1 from fms_instance_stage_assignees
          where fms_instance_stage_id=v_stage.id and user_profile_id=v_leave.applicant_id and is_active) then
          insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_at)
          values(v_leave.tenant_id,v_stage.id,v_leave.applicant_id,clock_timestamp());
        end if;
        update fms_instance_stages set assigned_to=array_append(
            case when v_stage.leave_coverage_buddy_preexisting then assigned_to
              else array_remove(assigned_to,v_covered_id) end,v_leave.applicant_id),
          coverage_status=null,coverage_original_assignee_id=null,coverage_resolution=null,
          coverage_resolved_for_date=null,leave_coverage_buddy_id=null,
          leave_coverage_buddy_preexisting=null,updated_at=now() where id=v_stage.id;
      end if;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_leave.tenant_id,null,case when v_absent then 'absence_coverage_assigned' else 'absence_coverage_restored' end,
        'fms',v_stage.id,to_jsonb(v_stage),jsonb_build_object('source','approved_half_day_leave',
          'original_assignee_id',v_leave.applicant_id,'effective_assignee_id',v_effective,'at',p_at));
    end loop;
  end loop;
end;
$$;
revoke all on function sync_leave_half_day_tasks(timestamptz) from public,anon,authenticated,service_role;

create function sync_approved_half_day_leave()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status='pending' and new.status='approved' then
    perform sync_leave_half_day_tasks(now());
  end if;
  return new;
end;
$$;
revoke all on function sync_approved_half_day_leave() from public,anon,authenticated,service_role;
create trigger leave_half_day_approved_sync after update of status on leave_requests
for each row execute function sync_approved_half_day_leave();

do $migration$
begin
  if to_regclass('cron.job') is not null then
    perform cron.schedule('sync-approved-half-day-leave','* * * * *',
      'select public.sync_leave_half_day_tasks(now())');
  else
    raise notice 'pg_cron unavailable; half-day boundary job not scheduled';
  end if;
end $migration$;
notify pgrst,'reload schema';
