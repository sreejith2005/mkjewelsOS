-- Central task coverage and the database-backed Recurring / To-Do workspace.
-- All dates in the coverage contract are interpreted in Asia/Kolkata.
set search_path = public, extensions;

alter table user_profiles
  add column if not exists secondary_buddy_id uuid references user_profiles(id);

alter table user_availability add column if not exists source text not null default 'manual';
alter table user_availability drop constraint if exists user_availability_source_check;
alter table user_availability add constraint user_availability_source_check
  check (source in ('manual','weekly_off'));

create index if not exists idx_user_profiles_secondary_buddy
  on user_profiles(secondary_buddy_id) where secondary_buddy_id is not null;

alter table task_instances
  add column if not exists coverage_status text,
  add column if not exists coverage_original_assignee_id uuid references user_profiles(id),
  add column if not exists coverage_resolution text,
  add column if not exists coverage_resolved_for_date date;

alter table task_templates
  add column if not exists schedule_kind text not null default 'recurring',
  add column if not exists starts_on date,
  add column if not exists verification_required boolean not null default false,
  add column if not exists followup_enabled boolean not null default false,
  add column if not exists personal_performance_enabled boolean not null default true;

alter table task_templates drop constraint if exists task_templates_schedule_kind_check;
alter table task_templates add constraint task_templates_schedule_kind_check check(schedule_kind in
  ('recurring','daily','weekly','monthly','nth_weekday','quarterly','yearly','one_time','as_required'));

alter table task_instances
  add column if not exists verification_status text not null default 'not_required',
  add column if not exists verified_by uuid references user_profiles(id),
  add column if not exists verified_at timestamptz,
  add column if not exists verification_note text,
  add column if not exists followup_count integer not null default 0,
  add column if not exists last_followup_at timestamptz;

alter table task_instances drop constraint if exists task_instances_verification_status_check;
alter table task_instances add constraint task_instances_verification_status_check
  check(verification_status in ('not_required','pending','verified','rejected'));

alter table client_followups
  add column if not exists coverage_status text,
  add column if not exists coverage_original_assignee_id uuid references user_profiles(id),
  add column if not exists coverage_resolution text,
  add column if not exists coverage_resolved_for_date date;

alter table fms_instance_stages
  add column if not exists coverage_status text,
  add column if not exists coverage_original_assignee_id uuid references user_profiles(id),
  add column if not exists coverage_resolution text,
  add column if not exists coverage_resolved_for_date date;

alter table task_instances drop constraint if exists task_instances_coverage_status_check;
alter table task_instances add constraint task_instances_coverage_status_check
  check (coverage_status is null or coverage_status in ('covered','coverage_required','manager_review'));
alter table client_followups drop constraint if exists client_followups_coverage_status_check;
alter table client_followups add constraint client_followups_coverage_status_check
  check (coverage_status is null or coverage_status in ('covered','coverage_required','manager_review'));
alter table fms_instance_stages drop constraint if exists fms_instance_stages_coverage_status_check;
alter table fms_instance_stages add constraint fms_instance_stages_coverage_status_check
  check (coverage_status is null or coverage_status in ('covered','coverage_required','manager_review'));

create index if not exists idx_task_instances_coverage_queue
  on task_instances(tenant_id, coverage_status, coverage_resolved_for_date)
  where coverage_status is not null;
create index if not exists idx_client_followups_coverage_queue
  on client_followups(tenant_id, coverage_status, coverage_resolved_for_date)
  where coverage_status is not null;
create index if not exists idx_fms_instance_stages_coverage_queue
  on fms_instance_stages(coverage_status, coverage_resolved_for_date)
  where coverage_status is not null;

create or replace function enforce_user_profile_buddy_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_candidate_id uuid; v_candidate user_profiles;
begin
  if new.buddy_id is not null and new.secondary_buddy_id = new.buddy_id then
    raise exception 'Primary and secondary buddies must be different' using errcode='23514';
  end if;
  foreach v_candidate_id in array array[new.buddy_id, new.secondary_buddy_id] loop
    if v_candidate_id is null then continue; end if;
    if v_candidate_id = new.id then raise exception 'A user cannot be their own buddy' using errcode='23514'; end if;
    select * into v_candidate from user_profiles where id=v_candidate_id;
    if v_candidate.id is null or v_candidate.tenant_id<>new.tenant_id
       or v_candidate.account_status<>'active' or v_candidate.is_login_enabled is not true
       or v_candidate.working_status<>'active' then
      raise exception 'Buddy must be an active user in the same tenant' using errcode='23503';
    end if;
    if v_candidate.branch_id<>new.branch_id or v_candidate.department_id<>new.department_id
       or v_candidate.designation_id is distinct from new.designation_id then
      raise exception 'Buddy must be in the same branch, department, and designation' using errcode='23503';
    end if;
    if user_role_hierarchy_rank(v_candidate.user_role)<user_role_hierarchy_rank(new.user_role) then
      raise exception 'Buddy assignment cannot point to a higher hierarchy' using errcode='42501';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists user_profiles_enforce_buddy_scope on user_profiles;
create trigger user_profiles_enforce_buddy_scope
before insert or update of buddy_id, secondary_buddy_id, branch_id, department_id,
  designation_id, user_role, account_status, working_status, is_login_enabled
on user_profiles for each row execute function enforce_user_profile_buddy_scope();

create or replace function resolve_task_coverage(p_original_assignee_id uuid, p_target_date date)
returns table(
  original_assignee_id uuid,
  effective_assignee_id uuid,
  resolution text
) language plpgsql stable security definer set search_path=public as $$
declare v_original user_profiles; v_candidate uuid;
begin
  select * into v_original from user_profiles where id=p_original_assignee_id;
  if v_original.id is null then
    return query select p_original_assignee_id, null::uuid, 'coverage_required'::text;
    return;
  end if;
  if is_user_available_for_task(v_original.id,p_target_date)
     and v_original.account_status='active' and v_original.is_login_enabled is true then
    return query select v_original.id,v_original.id,'original'::text;
    return;
  end if;
  foreach v_candidate in array array[v_original.buddy_id,v_original.secondary_buddy_id,v_original.reports_to_user_id] loop
    if v_candidate is not null and exists(
      select 1 from user_profiles u where u.id=v_candidate and u.tenant_id=v_original.tenant_id
      and u.account_status='active' and u.is_login_enabled is true
      and is_user_available_for_task(u.id,p_target_date)
    ) then
      return query select v_original.id,v_candidate,
        case v_candidate when v_original.buddy_id then 'primary_buddy'
          when v_original.secondary_buddy_id then 'secondary_buddy'
          else 'reporting_manager' end::text;
      return;
    end if;
  end loop;
  return query select v_original.id,null::uuid,'coverage_required'::text;
end;
$$;

create or replace function configure_invited_profile_coverage_with_audit(
  p_creator_profile_id uuid,p_profile_id uuid,p_secondary_buddy_id uuid,p_reports_to_user_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare v_creator user_profiles; v_old user_profiles; v_new user_profiles;
begin
  if auth.role()<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into v_creator from user_profiles where id=p_creator_profile_id;
  select * into v_old from user_profiles where id=p_profile_id for update;
  if v_creator.id is null or v_creator.user_role not in ('super_admin','admin') or v_creator.account_status<>'active'
    or v_old.id is null or v_old.tenant_id<>v_creator.tenant_id then raise exception 'Invited profile coverage configuration denied' using errcode='42501'; end if;
  update user_profiles set secondary_buddy_id=p_secondary_buddy_id,reports_to_user_id=p_reports_to_user_id,
    updated_by=v_creator.id,updated_at=now() where id=p_profile_id returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_creator.tenant_id,v_creator.id,'user_coverage_profile_configured','user_management',p_profile_id,
    jsonb_build_object('secondary_buddy_id',v_old.secondary_buddy_id,'reports_to_user_id',v_old.reports_to_user_id),
    jsonb_build_object('primary_buddy_id',v_new.buddy_id,'secondary_buddy_id',v_new.secondary_buddy_id,'reports_to_user_id',v_new.reports_to_user_id));
end;
$$;

-- Keep the established audited profile editor while extending its allow-list
-- and validation to the secondary buddy. Buddy selection remains profile-only.
create or replace function update_user_profile_with_audit(p_profile_id uuid, p_changes jsonb)
returns user_profiles language plpgsql security definer set search_path=public as $$
declare
  v_actor user_profiles; v_old user_profiles; v_new user_profiles;
  v_role user_role; v_status working_status; v_account user_account_status;
  v_branch uuid; v_department uuid; v_designation uuid; v_buddy uuid; v_secondary_buddy uuid; v_manager uuid;
  v_week_off text[];
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  if v_actor.id is null or v_actor.user_role not in ('super_admin','admin') or not current_profile_is_active() then
    raise exception 'Only active super_admin or admin can edit user profiles' using errcode='42501';
  end if;
  if p_changes-array['employee_name','branch_id','department_id','designation_id','personal_mobile','official_mobile',
    'week_off','user_role','employee_code','buddy_id','secondary_buddy_id','working_status','account_status','reports_to_user_id']<>'{}'::jsonb then
    raise exception 'Profile update contains unsupported fields' using errcode='22023';
  end if;
  if p_changes?'week_off' then
    if v_actor.user_role<>'super_admin' then raise exception 'Only super_admin can change week off' using errcode='42501'; end if;
    if jsonb_typeof(p_changes->'week_off')<>'array' or jsonb_array_length(p_changes->'week_off')>1
      or exists(select 1 from jsonb_array_elements(p_changes->'week_off') day(value)
        where jsonb_typeof(day.value)<>'string' or lower(btrim(day.value#>>'{}')) not in
        ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')) then
      raise exception 'Week off must be one weekday or no week off' using errcode='22023';
    end if;
    select coalesce(array_agg(lower(btrim(day.value#>>'{}'))),'{}'::text[]) into v_week_off
      from jsonb_array_elements(p_changes->'week_off') day(value);
  end if;
  select * into v_old from user_profiles where id=p_profile_id for update;
  if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id then raise exception 'Profile not found or not accessible' using errcode='42501'; end if;
  if v_actor.user_role='admin' and v_old.user_role='super_admin' then raise exception 'Admin cannot edit a super_admin' using errcode='42501'; end if;
  v_role:=case when p_changes?'user_role' then (p_changes->>'user_role')::user_role else v_old.user_role end;
  v_status:=case when p_changes?'working_status' then (p_changes->>'working_status')::working_status else v_old.working_status end;
  v_account:=case when p_changes?'account_status' then (p_changes->>'account_status')::user_account_status else v_old.account_status end;
  v_branch:=case when p_changes?'branch_id' then nullif(p_changes->>'branch_id','')::uuid else v_old.branch_id end;
  v_department:=case when p_changes?'department_id' then nullif(p_changes->>'department_id','')::uuid else v_old.department_id end;
  v_designation:=case when p_changes?'designation_id' then nullif(p_changes->>'designation_id','')::uuid else v_old.designation_id end;
  v_buddy:=case when p_changes?'buddy_id' then nullif(p_changes->>'buddy_id','')::uuid else v_old.buddy_id end;
  v_secondary_buddy:=case when p_changes?'secondary_buddy_id' then nullif(p_changes->>'secondary_buddy_id','')::uuid else v_old.secondary_buddy_id end;
  v_manager:=case when p_changes?'reports_to_user_id' then nullif(p_changes->>'reports_to_user_id','')::uuid else v_old.reports_to_user_id end;
  if v_actor.user_role<>'super_admin' and v_role<>v_old.user_role then raise exception 'Only super_admin can change user role' using errcode='42501'; end if;
  if v_actor.user_role='admin' and v_role='super_admin' then raise exception 'Admin cannot create or promote super_admin' using errcode='42501'; end if;
  if v_status='resigned' and v_old.working_status<>'resigned' then raise exception 'Use the resignation workflow to set resigned status' using errcode='22023'; end if;
  if v_account='left' and v_status<>'resigned' then raise exception 'Only the resignation workflow can mark a user as left' using errcode='22023'; end if;
  if not exists(select 1 from branches where id=v_branch and tenant_id=v_old.tenant_id and is_active) then raise exception 'Branch is invalid or inactive' using errcode='23503'; end if;
  if not exists(select 1 from departments where id=v_department and tenant_id=v_old.tenant_id and is_active and (branch_id is null or branch_id=v_branch)) then raise exception 'Department is invalid or inactive for this branch' using errcode='23503'; end if;
  if v_designation is not null and not exists(select 1 from dropdown_masters where id=v_designation and master_type='designation' and is_active and (tenant_id=v_old.tenant_id or tenant_id is null)) then raise exception 'Designation is invalid or inactive' using errcode='23503'; end if;
  if v_buddy is not null and not exists(select 1 from user_profiles where id=v_buddy and tenant_id=v_old.tenant_id and id<>v_old.id and account_status='active') then raise exception 'Primary buddy is invalid' using errcode='23503'; end if;
  if v_secondary_buddy is not null and not exists(select 1 from user_profiles where id=v_secondary_buddy and tenant_id=v_old.tenant_id and id<>v_old.id and account_status='active') then raise exception 'Secondary buddy is invalid' using errcode='23503'; end if;
  if v_buddy is not null and v_buddy=v_secondary_buddy then raise exception 'Primary and secondary buddies must be different' using errcode='23514'; end if;
  if v_manager=v_old.id or (v_manager is not null and is_reporting_descendant(v_old.id,v_manager)) then raise exception 'Reporting hierarchy cannot contain a cycle' using errcode='23514'; end if;
  if v_manager is not null and not exists(select 1 from user_profiles where id=v_manager and tenant_id=v_old.tenant_id and account_status='active') then raise exception 'Reports-to user is invalid or inactive' using errcode='23503'; end if;
  if v_old.user_role='super_admin' and (v_role<>'super_admin' or v_account<>'active') and not exists(select 1 from user_profiles where tenant_id=v_old.tenant_id and user_role='super_admin' and account_status='active' and id<>v_old.id) then raise exception 'At least one active super_admin is required' using errcode='23514'; end if;
  if p_changes?'personal_mobile' and nullif(btrim(p_changes->>'personal_mobile'),'') is not null and btrim(p_changes->>'personal_mobile')!~E'^\\+?[0-9][0-9 ()-]{7,19}$' then raise exception 'Personal mobile format is invalid' using errcode='22023'; end if;
  update user_profiles set
    employee_name=case when p_changes?'employee_name' then btrim(p_changes->>'employee_name') else employee_name end,
    branch_id=v_branch,department_id=v_department,designation_id=v_designation,
    personal_mobile=case when p_changes?'personal_mobile' then nullif(btrim(p_changes->>'personal_mobile'),'') else personal_mobile end,
    official_mobile=case when p_changes?'official_mobile' then nullif(btrim(p_changes->>'official_mobile'),'') else official_mobile end,
    week_off=case when p_changes?'week_off' then v_week_off else week_off end,
    user_role=v_role,employee_code=case when p_changes?'employee_code' then btrim(p_changes->>'employee_code') else employee_code end,
    buddy_id=v_buddy,secondary_buddy_id=v_secondary_buddy,working_status=v_status,account_status=v_account,
    reports_to_user_id=v_manager,is_login_enabled=(v_account='active' and v_status<>'resigned'),updated_by=v_actor.id,updated_at=now()
  where id=p_profile_id returning * into v_new;
  if (v_old.branch_id,v_old.department_id,v_old.designation_id,v_old.reports_to_user_id) is distinct from
     (v_new.branch_id,v_new.department_id,v_new.designation_id,v_new.reports_to_user_id) then
    insert into user_organization_history(tenant_id,user_profile_id,old_branch_id,new_branch_id,old_department_id,new_department_id,
      old_designation_id,new_designation_id,old_reports_to_user_id,new_reports_to_user_id,changed_by)
    values(v_new.tenant_id,v_new.id,v_old.branch_id,v_new.branch_id,v_old.department_id,v_new.department_id,
      v_old.designation_id,v_new.designation_id,v_old.reports_to_user_id,v_new.reports_to_user_id,v_actor.id);
  end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_new.tenant_id,v_actor.id,'user_updated','user_management',v_new.id,to_jsonb(v_old),to_jsonb(v_new));
  return v_new;
end;
$$;

create or replace function resolve_fms_stage_assignees(
  p_stage_id uuid,p_instance_id uuid,p_selected_user uuid default null
) returns uuid[] language plpgsql security definer set search_path=public as $$
declare v_stage fms_stages; v_instance fms_instances; v_rule fms_stage_assignees;
  v_ids uuid[]:=array[]::uuid[]; v_resolved uuid[]:=array[]::uuid[]; v_previous uuid[];
  v_candidate uuid; v_coverage record; v_target_date date;
  v_today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
  select * into v_stage from fms_stages where id=p_stage_id;
  select * into v_instance from fms_instances where id=p_instance_id;
  if v_stage.id is null or v_instance.id is null or v_stage.fms_flow_id<>v_instance.fms_flow_id then
    raise exception 'Invalid stage activation' using errcode='23514';
  end if;
  v_target_date:=(fms_stage_deadline_for_instance(v_stage.planned_time_rule,v_instance.tenant_id,p_instance_id)
    at time zone 'Asia/Kolkata')::date;
  if p_selected_user is not null then
    if not exists(select 1 from user_profiles u where u.id=p_selected_user and u.tenant_id=v_instance.tenant_id
      and u.branch_id=v_instance.branch_id and u.department_id=v_instance.department_id
      and u.working_status not in ('inactive','resigned') and coalesce(u.account_status::text,'active') in ('active','invited')) then
      raise exception 'The selected starting assignee is outside this branch and department' using errcode='23514';
    end if;
    if v_target_date not between v_today and v_today+1 then return array[p_selected_user]; end if;
    select * into v_coverage from resolve_task_coverage(p_selected_user,v_target_date);
    if v_coverage.effective_assignee_id is null then raise exception 'Coverage required for the selected starting assignee' using errcode='23514'; end if;
    return array[v_coverage.effective_assignee_id];
  end if;
  select assigned_to into v_previous from fms_instance_stages where fms_instance_id=p_instance_id
    and status='completed' order by actual_datetime desc nulls last,created_at desc limit 1;
  for v_rule in select * from fms_stage_assignees where fms_stage_id=p_stage_id order by sort_order,id loop
    if v_rule.assignee_type='specific_user' then
      v_ids:=array_append(v_ids,v_rule.user_profile_id);
    elsif v_rule.assignee_type='role' then
      for v_candidate in select id from user_profiles where tenant_id=v_instance.tenant_id and user_role=v_rule.role_value
        and (v_instance.branch_id is null or branch_id=v_instance.branch_id)
        and (v_instance.department_id is null or department_id=v_instance.department_id)
        and working_status not in ('inactive','resigned') and is_login_enabled
      loop
        v_ids:=array_append(v_ids,v_candidate);
      end loop;
    elsif v_rule.assignee_type='manager' then select manager_id into v_candidate from branches where id=v_instance.branch_id; v_ids:=array_append(v_ids,v_candidate);
    elsif v_rule.assignee_type='department_head' then select head_id into v_candidate from departments where id=v_instance.department_id; v_ids:=array_append(v_ids,v_candidate);
    elsif v_rule.assignee_type='previous_step_doer' then v_ids:=v_ids||coalesce(v_previous,'{}');
    elsif v_rule.assignee_type='reporter' then v_ids:=array_append(v_ids,v_instance.started_by);
    end if;
  end loop;
  for v_candidate in select distinct candidate.id from unnest(array_remove(v_ids,null)) candidate(id)
    join user_profiles u on u.id=candidate.id where u.tenant_id=v_instance.tenant_id
  loop
    if v_target_date not between v_today and v_today+1 then
      v_resolved:=array_append(v_resolved,v_candidate);
      continue;
    end if;
    select * into v_coverage from resolve_task_coverage(v_candidate,v_target_date);
    if v_coverage.effective_assignee_id is not null then
      v_resolved:=array_append(v_resolved,v_coverage.effective_assignee_id);
    end if;
  end loop;
  select coalesce(array_agg(distinct candidate.id),array[]::uuid[]) into v_ids
  from unnest(array_remove(v_resolved,null)) candidate(id);
  if cardinality(v_ids)=0 and v_stage.step_type not in ('notification','branch','parallel_start','parallel_join','end') then
    raise exception 'Coverage required: no active profile-level buddy or manager is available for this step' using errcode='23514';
  end if;
  if not v_stage.allow_multiple_doers and cardinality(v_ids)>1 then raise exception 'Choose one eligible assignee for this step' using errcode='23514'; end if;
  return v_ids;
end;
$$;

create or replace function reconcile_short_deadline_coverage_with_audit(
  p_user_profile_id uuid, p_date date, p_reason text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor user_profiles; v_target user_profiles; v_resolution record; v_today date;
  v_availability user_availability;
  v_task record; v_followup record; v_stage record; v_manager uuid;
  v_moved_tasks int:=0; v_moved_crm int:=0; v_moved_fms int:=0;
  v_manager_review int:=0; v_coverage_required int:=0;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  select * into v_target from user_profiles where id=p_user_profile_id for update;
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin','manager','hr')
     or v_target.id is null or v_target.tenant_id<>v_actor.tenant_id then
    raise exception 'Coverage reconciliation is not authorized' using errcode='42501';
  end if;
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  if p_date not between v_today and v_today+1 then
    return jsonb_build_object('date',p_date,'ignored',true,'reason','outside_short_deadline_window');
  end if;
  select * into v_availability from user_availability
    where user_profile_id=p_user_profile_id and date=p_date for update;
  if v_availability.id is null or v_availability.status<>'absent' then
    return jsonb_build_object('date',p_date,'ignored',true,'reason','authorized_absence_required');
  end if;
  select * into v_resolution from resolve_task_coverage(p_user_profile_id,p_date);
  if v_resolution.resolution='original' then
    return jsonb_build_object('date',p_date,'ignored',true,'reason','original_assignee_available');
  end if;
  v_manager := coalesce(v_target.reports_to_user_id,
    (select d.head_id from departments d where d.id=v_target.department_id));

  for v_task in
    select ti.* from task_instances ti
    where ti.tenant_id=v_actor.tenant_id
      and exists (
        select 1 from task_assignees ta
        where ta.task_instance_id=ti.id
          and ta.user_profile_id=p_user_profile_id
          and ta.is_active
          and ta.completed_at is null
          and ta.role_at_task='doer'
      )
      and (coalesce(ti.revised_datetime,ti.planned_datetime) at time zone 'Asia/Kolkata')::date=p_date
      and ti.status in ('pending','in_progress','in_review') for update of ti
  loop
    if v_task.coverage_resolved_for_date=p_date
       and v_task.coverage_status in ('manager_review','coverage_required') then
      continue;
    end if;
    if v_task.status<>'pending' then
      update task_instances set coverage_status='manager_review',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution='manager_review',coverage_resolved_for_date=p_date,updated_by=v_actor.id,updated_at=now()
      where id=v_task.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_actor.tenant_id,v_actor.id,'coverage_manager_review','tasks',v_task.id,
        jsonb_build_object('original_assignee_id',p_user_profile_id,'date',p_date,'reason',p_reason));
      v_manager_review:=v_manager_review+1;
    elsif v_resolution.effective_assignee_id is not null then
      update task_assignees set is_active=false where task_instance_id=v_task.id
        and user_profile_id=p_user_profile_id and is_active and role_at_task='doer';
      insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
      values(v_task.id,v_resolution.effective_assignee_id,'doer',false,true) on conflict do nothing;
      insert into buddy_assignments(tenant_id,original_assignee_id,buddy_id,task_instance_id,date,
        escalated_to_manager)
      values(v_actor.tenant_id,p_user_profile_id,v_resolution.effective_assignee_id,v_task.id,p_date,
        v_resolution.resolution='reporting_manager');
      update task_instances set coverage_status='covered',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=p_date,
        updated_by=v_actor.id,updated_at=now() where id=v_task.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_actor.tenant_id,v_actor.id,'short_deadline_coverage_assigned','tasks',v_task.id,
        jsonb_build_object('assignee_id',p_user_profile_id),
        jsonb_build_object('assignee_id',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,'date',p_date));
      insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url)
      values(v_actor.tenant_id,v_resolution.effective_assignee_id,'task_coverage_assigned','Coverage task assigned',
        v_task.title||' was assigned to you for '||p_date::text,'/tasks');
      v_moved_tasks:=v_moved_tasks+1;
    else
      update task_assignees set is_active=false where task_instance_id=v_task.id
        and user_profile_id=p_user_profile_id and is_active and role_at_task='doer';
      update task_instances set coverage_status='coverage_required',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution='coverage_required',coverage_resolved_for_date=p_date,updated_by=v_actor.id,updated_at=now()
      where id=v_task.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_actor.tenant_id,v_actor.id,'coverage_required','tasks',v_task.id,
        jsonb_build_object('original_assignee_id',p_user_profile_id,'date',p_date,'reason',p_reason));
      v_coverage_required:=v_coverage_required+1;
    end if;
  end loop;

  for v_followup in select cf.* from client_followups cf
    where cf.tenant_id=v_actor.tenant_id and cf.assigned_to=p_user_profile_id
      and cf.due_date=p_date and cf.status='open' for update
  loop
    if v_followup.coverage_resolved_for_date=p_date
       and v_followup.coverage_status in ('covered','coverage_required','manager_review') then
      continue;
    end if;
    if v_resolution.effective_assignee_id is not null then
      update client_followups set assigned_to=v_resolution.effective_assignee_id,
        coverage_status='covered',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=p_date,
        updated_by=v_actor.id,updated_at=now(),record_version=record_version+1 where id=v_followup.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_actor.tenant_id,v_actor.id,'short_deadline_coverage_assigned','crm_followups',v_followup.id,
        jsonb_build_object('assigned_to',p_user_profile_id),
        jsonb_build_object('assigned_to',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,'date',p_date));
      insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url)
      values(v_actor.tenant_id,v_resolution.effective_assignee_id,'crm_followup_coverage_assigned','CRM follow-up coverage assigned',
        'A follow-up due '||p_date::text||' was assigned to you','/crm?client='||v_followup.client_id);
      v_moved_crm:=v_moved_crm+1;
    else
      update client_followups set coverage_status='coverage_required',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution='coverage_required',coverage_resolved_for_date=p_date,
        updated_by=v_actor.id,updated_at=now(),record_version=record_version+1 where id=v_followup.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_actor.tenant_id,v_actor.id,'coverage_required','crm_followups',v_followup.id,
        jsonb_build_object('original_assignee_id',p_user_profile_id,'date',p_date,'reason',p_reason));
      v_coverage_required:=v_coverage_required+1;
    end if;
  end loop;

  for v_stage in
    select fis.*,fi.tenant_id,fi.title from fms_instance_stages fis
    join fms_instances fi on fi.id=fis.fms_instance_id
    where fi.tenant_id=v_actor.tenant_id and p_user_profile_id=any(fis.assigned_to)
      and (fis.planned_datetime at time zone 'Asia/Kolkata')::date=p_date
      and fis.status in ('pending','in_progress','in_review') for update of fis
  loop
    if v_stage.coverage_resolved_for_date=p_date
       and v_stage.coverage_status in ('manager_review','coverage_required') then
      continue;
    end if;
    if v_stage.status<>'pending' then
      update fms_instance_stages set coverage_status='manager_review',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution='manager_review',coverage_resolved_for_date=p_date,updated_at=now() where id=v_stage.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_actor.tenant_id,v_actor.id,'coverage_manager_review','fms',v_stage.id,
        jsonb_build_object('original_assignee_id',p_user_profile_id,'date',p_date,'reason',p_reason));
      v_manager_review:=v_manager_review+1;
    elsif v_resolution.effective_assignee_id is not null then
      update fms_instance_stages set assigned_to=array_replace(assigned_to,p_user_profile_id,v_resolution.effective_assignee_id),
        coverage_status='covered',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=p_date,updated_at=now() where id=v_stage.id;
      update fms_instance_stage_assignees set is_active=false,status='reassigned'
        where fms_instance_stage_id=v_stage.id and user_profile_id=p_user_profile_id and is_active;
      if not exists(select 1 from fms_instance_stage_assignees where fms_instance_stage_id=v_stage.id
        and user_profile_id=v_resolution.effective_assignee_id and is_active) then
        insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by)
        values(v_actor.tenant_id,v_stage.id,v_resolution.effective_assignee_id,v_actor.id);
      end if;
      insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
      values(v_stage.id,v_actor.id,'reassigned',jsonb_build_object('from',p_user_profile_id,
        'to',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,'date',p_date));
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_actor.tenant_id,v_actor.id,'short_deadline_coverage_assigned','fms',v_stage.id,
        jsonb_build_object('assigned_to',p_user_profile_id),
        jsonb_build_object('assigned_to',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,'date',p_date));
      insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url)
      values(v_actor.tenant_id,v_resolution.effective_assignee_id,'fms_coverage_assigned','FMS coverage assigned',
        v_stage.title||' was assigned to you for '||p_date::text,'/fms');
      v_moved_fms:=v_moved_fms+1;
    else
      update fms_instance_stages set coverage_status='coverage_required',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution='coverage_required',coverage_resolved_for_date=p_date,updated_at=now() where id=v_stage.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_actor.tenant_id,v_actor.id,'coverage_required','fms',v_stage.id,
        jsonb_build_object('original_assignee_id',p_user_profile_id,'date',p_date,'reason',p_reason));
      v_coverage_required:=v_coverage_required+1;
    end if;
  end loop;

  if v_manager is not null and (v_manager_review>0 or v_coverage_required>0) then
    insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url)
    values(v_actor.tenant_id,v_manager,'task_coverage_review','Coverage review required',
      (v_manager_review+v_coverage_required)::text||' work item(s) need coverage review for '||p_date::text,
      '/recurring-todo');
  end if;
  return jsonb_build_object('date',p_date,'resolution',v_resolution.resolution,
    'effective_assignee_id',v_resolution.effective_assignee_id,'tasks_moved',v_moved_tasks,
    'crm_followups_moved',v_moved_crm,'fms_stages_moved',v_moved_fms,
    'manager_review',v_manager_review,'coverage_required',v_coverage_required);
end;
$$;

create or replace function record_availability_with_audit(
  p_user_profile_id uuid,p_date date,p_status availability_status,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old user_availability; v_new user_availability;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active() or not (
    p_user_profile_id=v_actor.id or v_actor.user_role in ('super_admin','admin','manager','hr'))
    or not exists(select 1 from user_profiles where id=p_user_profile_id and tenant_id=v_actor.tenant_id) then
    raise exception 'Availability cannot be recorded for this user' using errcode='42501';
  end if;
  select * into v_old from user_availability where user_profile_id=p_user_profile_id and date=p_date;
  insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by,source)
  values(v_actor.tenant_id,p_user_profile_id,p_date,p_status,nullif(btrim(p_reason),''),v_actor.id,'manual')
  on conflict(user_profile_id,date) do update set status=excluded.status,reason=excluded.reason,
    logged_by=excluded.logged_by,source='manual'
  returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'availability_recorded','availability',v_new.id,
    case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
  if p_status='absent' and v_actor.user_role in ('super_admin','admin','manager','hr') then
    perform reconcile_short_deadline_coverage_with_audit(p_user_profile_id,p_date,p_reason);
  end if;
  return v_new.id;
end;
$$;

create or replace function record_availability_range_with_audit(
  p_user_profile_id uuid,p_start_date date,p_end_date date,p_status availability_status,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_date date; v_ids jsonb:='[]'::jsonb; v_summary jsonb;
begin
  if p_end_date<p_start_date or p_end_date-p_start_date>366 then
    raise exception 'Availability range must be between 1 and 367 days' using errcode='22023';
  end if;
  for v_date in select generate_series(p_start_date,p_end_date,'1 day'::interval)::date loop
    v_ids:=v_ids||jsonb_build_array(record_availability_with_audit(p_user_profile_id,v_date,p_status,p_reason));
  end loop;
  with outcomes as (
    select coverage_resolution from task_instances where coverage_original_assignee_id=p_user_profile_id
      and coverage_resolved_for_date between p_start_date and p_end_date
    union all select coverage_resolution from client_followups where coverage_original_assignee_id=p_user_profile_id
      and coverage_resolved_for_date between p_start_date and p_end_date
    union all select coverage_resolution from fms_instance_stages where coverage_original_assignee_id=p_user_profile_id
      and coverage_resolved_for_date between p_start_date and p_end_date
  ) select jsonb_build_object(
    'primary_buddy',count(*) filter(where coverage_resolution='primary_buddy'),
    'secondary_buddy',count(*) filter(where coverage_resolution='secondary_buddy'),
    'reporting_manager',count(*) filter(where coverage_resolution='reporting_manager'),
    'coverage_required',count(*) filter(where coverage_resolution='coverage_required'),
    'manager_review',count(*) filter(where coverage_resolution='manager_review')
  ) into v_summary from outcomes;
  return jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,
    'record_ids',v_ids,'coverage_summary',v_summary);
end;
$$;

create or replace function reconcile_changed_week_off()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_date date; v_today date:=(now() at time zone 'Asia/Kolkata')::date;
  v_actor user_profiles; v_old_availability user_availability; v_new_availability user_availability;
begin
  if new.week_off is not distinct from old.week_off then return new; end if;
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  for v_date in select generate_series(v_today,v_today+1,'1 day'::interval)::date loop
    select * into v_old_availability from user_availability
      where user_profile_id=new.id and date=v_date for update;
    if v_old_availability.id is not null and v_old_availability.source='weekly_off'
       and lower(to_char(v_date,'FMDay'))<>all(new.week_off) then
      delete from user_availability where id=v_old_availability.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(new.tenant_id,v_actor.id,'weekly_off_availability_removed','availability',v_old_availability.id,
        to_jsonb(v_old_availability),null);
      v_old_availability:=null;
    end if;
    if lower(to_char(v_date,'FMDay'))=any(new.week_off) then
      if v_old_availability.id is null or v_old_availability.source='weekly_off' then
        insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by,source)
        values(new.tenant_id,new.id,v_date,'absent','Configured weekly off',v_actor.id,'weekly_off')
        on conflict(user_profile_id,date) do update set status='absent',reason='Configured weekly off',
          logged_by=excluded.logged_by,source='weekly_off' returning * into v_new_availability;
        insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
        values(new.tenant_id,v_actor.id,'weekly_off_availability_recorded','availability',v_new_availability.id,
          case when v_old_availability.id is null then null else to_jsonb(v_old_availability) end,to_jsonb(v_new_availability));
        perform reconcile_short_deadline_coverage_with_audit(new.id,v_date,'Configured weekly off');
      end if;
    end if;
    v_old_availability:=null; v_new_availability:=null;
  end loop;
  return new;
end;
$$;
drop trigger if exists user_profiles_reconcile_changed_week_off on user_profiles;
create trigger user_profiles_reconcile_changed_week_off after update of week_off on user_profiles
for each row execute function reconcile_changed_week_off();

create or replace function get_recurring_todo_workspace(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles; v_from date; v_to date; v_status text; v_search text;
  v_templates jsonb; v_instances jsonb; v_stats jsonb;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active() then raise exception 'Recurring workspace access denied' using errcode='42501'; end if;
  v_from:=coalesce(nullif(p_filter->>'date_from','')::date,(now() at time zone 'Asia/Kolkata')::date-7);
  v_to:=coalesce(nullif(p_filter->>'date_to','')::date,(now() at time zone 'Asia/Kolkata')::date+30);
  v_status:=nullif(p_filter->>'status',''); v_search:=lower(btrim(coalesce(p_filter->>'search','')));
  select coalesce(jsonb_agg(to_jsonb(t) order by t.title),'[]'::jsonb) into v_templates
  from task_templates t where t.tenant_id=v_actor.tenant_id and t.task_type='checklist'
    and t.recurrence_rule is not null
    and (v_actor.user_role in ('super_admin','admin','manager') or t.created_by=v_actor.id or t.default_assignee_user_id=v_actor.id)
    and (v_search='' or lower(t.title||' '||coalesce(t.description,'')) like '%'||v_search||'%');
  with visible as (
    select ti.* from task_instances ti where ti.tenant_id=v_actor.tenant_id and ti.task_template_id is not null
      and (ti.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to
      and (v_status is null or ti.status::text=v_status)
      and (v_search='' or lower(ti.title||' '||coalesce(ti.description,'')) like '%'||v_search||'%')
      and can_read_task(ti.id)
  )
  select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object(
    'assignees',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name,'is_original',a.is_original)),'[]'::jsonb)
      from task_assignees a join user_profiles u on u.id=a.user_profile_id where a.task_instance_id=v.id and a.is_active),
    'checklist',(select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order),'[]'::jsonb) from task_checklists c where c.task_instance_id=v.id),
    'has_attachment',exists(select 1 from task_attachments a where a.task_instance_id=v.id),
    'has_form_submission',exists(select 1 from form_submissions s where s.linked_module='checklist_task'
      and s.linked_record_id=v.id and s.form_template_id=v.form_template_id)
  ) order by v.planned_datetime),'[]'::jsonb) into v_instances from visible v;
  select jsonb_build_object(
    'total',count(*),'pending',count(*) filter(where status='pending'),
    'in_progress',count(*) filter(where status='in_progress'),
    'completed',count(*) filter(where status='completed'),
    'overdue',count(*) filter(where status='overdue'),
    'coverage_required',count(*) filter(where coverage_status='coverage_required'),
    'manager_review',count(*) filter(where coverage_status='manager_review')) into v_stats
  from task_instances ti where ti.tenant_id=v_actor.tenant_id and ti.task_template_id is not null
    and (ti.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to
    and can_read_task(ti.id);
  return jsonb_build_object('filters',jsonb_build_object('date_from',v_from,'date_to',v_to),
    'templates',v_templates,'instances',v_instances,'stats',v_stats);
end;
$$;

create or replace function initialize_recurring_task_requirements()
returns trigger language plpgsql set search_path=public as $$
declare v_template task_templates;
begin
  if new.task_template_id is null then return new; end if;
  select * into v_template from task_templates where id=new.task_template_id;
  new.verification_status:=case when v_template.verification_required then 'pending' else 'not_required' end;
  return new;
end;
$$;
drop trigger if exists task_instances_initialize_recurring_requirements on task_instances;
create trigger task_instances_initialize_recurring_requirements before insert on task_instances
for each row execute function initialize_recurring_task_requirements();

create or replace function save_recurring_todo_template_with_audit(p_template_id uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_actor user_profiles; v_old task_templates; v_new task_templates;
  v_base jsonb; v_kind text; v_starts_on date;
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
  v_starts_on:=coalesce(nullif(p_payload->>'starts_on','')::date,
    case when p_template_id is null then (now() at time zone 'Asia/Kolkata')::date else null end);
  if v_kind='one_time' and v_starts_on is null then
    raise exception 'One-time schedules require a start date' using errcode='22023';
  end if;
  if p_template_id is not null then select * into v_old from task_templates where id=p_template_id; end if;
  v_base:=p_payload-array['schedule_kind','starts_on','verification_required','followup_enabled','personal_performance_enabled'];
  if v_kind='as_required' then
    v_base:=v_base||jsonb_build_object('is_active',false);
  elsif p_template_id is null and v_starts_on is not null then
    v_base:=v_base||jsonb_build_object('initial_planned_datetime',
      (v_starts_on::text||' '||coalesce(nullif(p_payload->>'planned_time',''),'09:00')||' Asia/Kolkata')::timestamptz);
  end if;
  v_id:=save_task_template_with_audit(p_template_id,v_base);
  update task_templates set schedule_kind=v_kind,starts_on=coalesce(v_starts_on,starts_on),
    verification_required=coalesce((p_payload->>'verification_required')::boolean,false),
    followup_enabled=coalesce((p_payload->>'followup_enabled')::boolean,false),
    personal_performance_enabled=coalesce((p_payload->>'personal_performance_enabled')::boolean,true),
    is_active=case when v_kind='as_required' then false else is_active end,
    updated_by=v_actor.id,updated_at=now() where id=v_id returning * into v_new;
  update task_instances set verification_status=case when v_new.verification_required then 'pending' else 'not_required' end,
    updated_by=v_actor.id,updated_at=now()
    where task_template_id=v_id and status='pending'
      and (planned_datetime at time zone 'Asia/Kolkata')::date=coalesce(v_starts_on,v_new.starts_on);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,case when p_template_id is null then 'recurring_todo_created' else 'recurring_todo_updated' end,
    'recurring_todo',v_id,case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
  return v_id;
end;
$$;

create or replace function set_recurring_todo_template_active_with_audit(p_template_id uuid,p_active boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old task_templates; v_new task_templates;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  select * into v_old from task_templates where id=p_template_id for update;
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin','manager')
     or v_old.id is null or v_old.tenant_id<>v_actor.tenant_id
     or (v_actor.user_role='manager' and v_old.branch_id is distinct from v_actor.branch_id) then
    raise exception 'Recurring schedule activation denied' using errcode='42501';
  end if;
  if v_old.schedule_kind='as_required' and p_active then
    raise exception 'As-required schedules are run manually and cannot be activated' using errcode='23514';
  end if;
  update task_templates set is_active=p_active,updated_by=v_actor.id,updated_at=now()
    where id=p_template_id returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,case when p_active then 'recurring_todo_activated' else 'recurring_todo_paused' end,
    'recurring_todo',p_template_id,to_jsonb(v_old),to_jsonb(v_new));
  return p_active;
end;
$$;

create or replace function delete_recurring_todo_template_with_audit(p_template_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_old task_templates; v_outcome text;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  select * into v_old from task_templates where id=p_template_id for update;
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager')
    or v_old.id is null or v_old.tenant_id<>v_actor.tenant_id
    or (v_actor.user_role='manager' and v_old.branch_id is distinct from v_actor.branch_id) then
    raise exception 'Recurring schedule deletion denied' using errcode='42501';
  end if;
  if exists(select 1 from task_instances where task_template_id=p_template_id) then
    update task_templates set is_active=false,updated_by=v_actor.id,updated_at=now() where id=p_template_id;
    v_outcome:='archived';
  else
    delete from task_templates where id=p_template_id;
    v_outcome:='deleted';
  end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'recurring_todo_'||v_outcome,'recurring_todo',p_template_id,to_jsonb(v_old),jsonb_build_object('outcome',v_outcome));
  return v_outcome;
end;
$$;

create or replace function verify_recurring_task_with_audit(p_task_id uuid,p_decision text,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_task task_instances;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  select * into v_task from task_instances where id=p_task_id for update;
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager')
    or v_task.id is null or v_task.tenant_id<>v_actor.tenant_id or v_task.task_template_id is null
    or (v_actor.user_role='manager' and v_task.branch_id is distinct from v_actor.branch_id) then
    raise exception 'Recurring task verification denied' using errcode='42501';
  end if;
  if v_task.status<>'completed' or v_task.verification_status not in ('pending','rejected') then
    raise exception 'Only completed tasks awaiting verification can be reviewed' using errcode='23514';
  end if;
  if p_decision not in ('verified','rejected') then raise exception 'Verification decision is invalid' using errcode='22023'; end if;
  if p_decision='rejected' and nullif(btrim(p_note),'') is null then raise exception 'A rejection note is required' using errcode='22023'; end if;
  update task_instances set verification_status=p_decision,verified_by=v_actor.id,verified_at=now(),
    verification_note=nullif(btrim(p_note),''),updated_by=v_actor.id,updated_at=now() where id=p_task_id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'recurring_task_'||p_decision,'recurring_todo',p_task_id,
    jsonb_build_object('verification_status',v_task.verification_status),
    jsonb_build_object('verification_status',p_decision,'note',nullif(btrim(p_note),'')));
end;
$$;

create or replace function send_recurring_followup_with_audit(p_task_id uuid,p_message text)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_task task_instances; v_assignee uuid;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  select * into v_task from task_instances where id=p_task_id for update;
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager')
    or v_task.id is null or v_task.tenant_id<>v_actor.tenant_id or v_task.task_template_id is null
    or (v_actor.user_role='manager' and v_task.branch_id is distinct from v_actor.branch_id)
    or not exists(select 1 from task_templates where id=v_task.task_template_id and followup_enabled) then
    raise exception 'Recurring task follow-up denied' using errcode='42501';
  end if;
  if nullif(btrim(p_message),'') is null or length(btrim(p_message))>1000 then raise exception 'Follow-up message must contain 1 to 1000 characters' using errcode='22023'; end if;
  insert into task_comments(task_instance_id,user_profile_id,comment) values(p_task_id,v_actor.id,btrim(p_message));
  update task_instances set followup_count=followup_count+1,last_followup_at=now(),updated_by=v_actor.id,updated_at=now() where id=p_task_id;
  for v_assignee in select user_profile_id from task_assignees where task_instance_id=p_task_id and is_active loop
    insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url)
    values(v_actor.tenant_id,v_assignee,'recurring_task_followup','Task follow-up',btrim(p_message),'/recurring-todo');
  end loop;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'recurring_task_followup_sent','recurring_todo',p_task_id,
    jsonb_build_object('message',btrim(p_message),'recipient_count',(select count(*) from task_assignees where task_instance_id=p_task_id and is_active)));
end;
$$;

-- Protected worker entry point. The worker supplies only the original doers;
-- the database resolves coverage again inside the creation transaction.
create or replace function create_recurring_todo_instance(
  p_template_id uuid,p_target_date date,p_original_assignee_ids uuid[]
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_template task_templates; v_task task_instances; v_original_id uuid; v_resolution record;
  v_item jsonb; v_uncovered boolean:=false; v_first_uncovered uuid; v_manager uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' and not exists(
    select 1 from user_profiles u where u.auth_user_id=auth.uid()
      and u.account_status='active' and u.is_login_enabled
      and u.user_role in ('super_admin','admin','manager')
  ) then raise exception 'Recurring task creation denied' using errcode='42501'; end if;
  if p_target_date is null or coalesce(array_length(p_original_assignee_ids,1),0)=0 then
    raise exception 'Target date and original assignees are required' using errcode='22023';
  end if;
  select * into v_template from task_templates where id=p_template_id
    and (is_active or schedule_kind='as_required') and task_type='checklist' for update;
  if v_template.id is null then raise exception 'Template not found' using errcode='22023'; end if;
  if exists(select 1 from task_instances where task_template_id=p_template_id and scheduled_date=p_target_date) then return null; end if;
  insert into task_instances(tenant_id,branch_id,department_id,category_id,task_template_id,task_type,title,
    description,priority,status,planned_datetime,scheduled_date,requires_upload,requires_remark,requires_form,
    form_template_id,source,created_by)
  values(v_template.tenant_id,v_template.branch_id,v_template.department_id,v_template.category_id,v_template.id,
    'checklist',v_template.title,v_template.description,v_template.priority,'pending',
    (p_target_date::text||' '||coalesce(v_template.planned_time,'23:59'::time)::text||' Asia/Kolkata')::timestamptz,
    p_target_date,v_template.requires_upload,v_template.requires_remark,v_template.requires_form,
    v_template.form_template_id,'checklist',coalesce(v_template.created_by,v_template.updated_by,p_original_assignee_ids[1]))
  on conflict do nothing returning * into v_task;
  if v_task.id is null then return null; end if;
  for v_item in select value from jsonb_array_elements(v_template.checklist_items) loop
    insert into task_checklists(task_instance_id,item_text,is_required,sort_order)
    values(v_task.id,v_item->>'item_text',coalesce((v_item->>'is_required')::boolean,true),coalesce((v_item->>'sort_order')::integer,0));
  end loop;
  foreach v_original_id in array p_original_assignee_ids loop
    if not exists(select 1 from user_profiles u where u.id=v_original_id and u.tenant_id=v_template.tenant_id
      and (v_template.branch_id is null or u.branch_id=v_template.branch_id)
      and (v_template.department_id is null or u.department_id=v_template.department_id)
      and ((v_template.default_assignee_type='specific_user' and u.id=v_template.default_assignee_user_id)
        or (v_template.default_assignee_type='role' and u.user_role=v_template.default_assignee_role))) then
      raise exception 'Original recurring doer is outside the template scope' using errcode='23503';
    end if;
    select * into v_resolution from resolve_task_coverage(v_original_id,p_target_date);
    if v_resolution.effective_assignee_id is null then
      v_uncovered:=true; v_first_uncovered:=coalesce(v_first_uncovered,v_original_id);
      insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
      values(v_task.id,v_original_id,'doer',true,false) on conflict do nothing;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_template.tenant_id,null,'coverage_required','tasks',v_task.id,
        jsonb_build_object('original_assignee_id',v_original_id,'date',p_target_date));
    else
      insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
      values(v_task.id,v_resolution.effective_assignee_id,'doer',v_resolution.resolution='original',true) on conflict do nothing;
      if v_resolution.resolution<>'original' then
        insert into buddy_assignments(tenant_id,original_assignee_id,buddy_id,task_instance_id,date,escalated_to_manager)
        values(v_template.tenant_id,v_original_id,v_resolution.effective_assignee_id,v_task.id,p_target_date,
          v_resolution.resolution='reporting_manager');
      end if;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_template.tenant_id,null,'task_assignment_resolved','tasks',v_task.id,
        jsonb_build_object('original_assignee_id',v_original_id,'effective_assignee_id',v_resolution.effective_assignee_id,
          'resolution',v_resolution.resolution,'date',p_target_date));
    end if;
  end loop;
  if v_uncovered then
    update task_instances set coverage_status='coverage_required',coverage_original_assignee_id=v_first_uncovered,
      coverage_resolution='coverage_required',coverage_resolved_for_date=p_target_date where id=v_task.id;
    select coalesce(u.reports_to_user_id,d.head_id) into v_manager from user_profiles u
      left join departments d on d.id=u.department_id where u.id=v_first_uncovered;
    if v_manager is not null then
      insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url)
      values(v_template.tenant_id,v_manager,'task_coverage_required','Task needs coverage',
        v_template.title||' has no available buddy for '||p_target_date::text,'/recurring-todo');
    end if;
  end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_template.tenant_id,null,'recurring_task_generated','tasks',v_task.id,
    jsonb_build_object('template_id',p_template_id,'scheduled_date',p_target_date,'coverage_required',v_uncovered));
  return v_task.id;
exception when unique_violation then return null;
end;
$$;

create or replace function run_recurring_todo_template_now_with_audit(p_template_id uuid,p_target_date date)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_template task_templates; v_assignees uuid[]; v_task_id uuid;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  select * into v_template from task_templates where id=p_template_id for update;
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin','manager')
     or v_template.id is null or v_template.tenant_id<>v_actor.tenant_id
     or (v_actor.user_role='manager' and v_template.branch_id is distinct from v_actor.branch_id) then
    raise exception 'Recurring schedule run denied' using errcode='42501';
  end if;
  select coalesce(array_agg(u.id),array[]::uuid[]) into v_assignees from user_profiles u
    where u.tenant_id=v_template.tenant_id and u.account_status='active' and u.is_login_enabled
      and (v_template.branch_id is null or u.branch_id=v_template.branch_id)
      and (v_template.department_id is null or u.department_id=v_template.department_id)
      and ((v_template.default_assignee_type='specific_user' and u.id=v_template.default_assignee_user_id)
        or (v_template.default_assignee_type='role' and u.user_role=v_template.default_assignee_role));
  if cardinality(v_assignees)=0 then raise exception 'No eligible schedule assignee' using errcode='23514'; end if;
  v_task_id:=create_recurring_todo_instance(p_template_id,p_target_date,v_assignees);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'recurring_todo_run_now','recurring_todo',p_template_id,
    jsonb_build_object('target_date',p_target_date,'task_id',v_task_id));
  return v_task_id;
end;
$$;

-- Every manual task-assignee insert passes through the same profile coverage
-- chain. The original row remains as inactive history when a cover is used.
create or replace function apply_task_assignment_coverage()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_task task_instances; v_date date; v_today date; v_resolution record; v_actor uuid;
begin
  if new.role_at_task<>'doer' or new.is_active is not true or new.is_original is not true
     or new.completed_at is not null then return new; end if;
  select * into v_task from task_instances where id=new.task_instance_id for update;
  v_date:=(coalesce(v_task.revised_datetime,v_task.planned_datetime) at time zone 'Asia/Kolkata')::date;
  v_today:=(now() at time zone 'Asia/Kolkata')::date;
  if v_task.status<>'pending' or v_date not between v_today and v_today+1 then return new; end if;
  select id into v_actor from user_profiles where auth_user_id=auth.uid();
  select * into v_resolution from resolve_task_coverage(new.user_profile_id,v_date);
  if v_resolution.resolution='original' then return new; end if;
  if v_resolution.effective_assignee_id is null then
    update task_assignees set is_active=false where id=new.id;
    update task_instances set coverage_status='coverage_required',coverage_original_assignee_id=new.user_profile_id,
      coverage_resolution='coverage_required',coverage_resolved_for_date=v_date,updated_at=now() where id=v_task.id;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
    values(v_task.tenant_id,v_actor,'coverage_required','tasks',v_task.id,
      jsonb_build_object('original_assignee_id',new.user_profile_id,'date',v_date,'source','assignment_created'));
    return new;
  end if;
  update task_assignees set is_active=false where id=new.id;
  insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
  values(v_task.id,v_resolution.effective_assignee_id,'doer',false,true) on conflict do nothing;
  insert into buddy_assignments(tenant_id,original_assignee_id,buddy_id,task_instance_id,date,escalated_to_manager)
  values(v_task.tenant_id,new.user_profile_id,v_resolution.effective_assignee_id,v_task.id,v_date,
    v_resolution.resolution='reporting_manager');
  update task_instances set coverage_status='covered',coverage_original_assignee_id=new.user_profile_id,
    coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=v_date,updated_at=now() where id=v_task.id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_task.tenant_id,v_actor,'task_assignment_resolved','tasks',v_task.id,
    jsonb_build_object('original_assignee_id',new.user_profile_id,'effective_assignee_id',v_resolution.effective_assignee_id,
      'resolution',v_resolution.resolution,'date',v_date,'source','assignment_created'));
  return new;
end;
$$;
drop trigger if exists task_assignees_apply_profile_coverage on task_assignees;
create trigger task_assignees_apply_profile_coverage after insert on task_assignees
for each row execute function apply_task_assignment_coverage();

create or replace function apply_crm_followup_coverage()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_today date; v_resolution record; v_actor uuid; v_original uuid;
begin
  if new.status<>'open' or new.assigned_to is null then return new; end if;
  if tg_op='UPDATE' and new.assigned_to is not distinct from old.assigned_to
     and new.due_date is not distinct from old.due_date then return new; end if;
  v_today:=(now() at time zone 'Asia/Kolkata')::date;
  if new.due_date not between v_today and v_today+1 then
    new.coverage_status:=null; new.coverage_original_assignee_id:=null;
    new.coverage_resolution:=null; new.coverage_resolved_for_date:=null;
    return new;
  end if;
  v_original:=new.assigned_to;
  select * into v_resolution from resolve_task_coverage(v_original,new.due_date);
  if v_resolution.resolution='original' then return new; end if;
  select id into v_actor from user_profiles where auth_user_id=auth.uid();
  new.coverage_original_assignee_id:=v_original;
  new.coverage_resolved_for_date:=new.due_date;
  if v_resolution.effective_assignee_id is null then
    new.coverage_status:='coverage_required'; new.coverage_resolution:='coverage_required';
  else
    new.assigned_to:=v_resolution.effective_assignee_id;
    new.coverage_status:='covered'; new.coverage_resolution:=v_resolution.resolution;
  end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(new.tenant_id,v_actor,case when v_resolution.effective_assignee_id is null then 'coverage_required' else 'task_assignment_resolved' end,
    'crm_followups',new.id,jsonb_build_object('original_assignee_id',v_original,
      'effective_assignee_id',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,
      'date',new.due_date,'source','followup_created_or_rescheduled'));
  return new;
end;
$$;
drop trigger if exists client_followups_apply_profile_coverage on client_followups;
create trigger client_followups_apply_profile_coverage before insert or update of assigned_to,due_date on client_followups
for each row execute function apply_crm_followup_coverage();

-- Legacy notification producers capture the requested assignee before coverage
-- triggers run. Suppress stale Task events and normalize CRM recipients to the
-- persisted effective assignee so absent originals are never notified as doers.
create or replace function notify_task_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_title text; v_tenant_id uuid; v_persisted_active boolean; v_task task_instances; v_resolution record;
  v_task_date date; v_today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
  select * into v_task from task_instances where id=new.task_instance_id;
  v_task_date:=(coalesce(v_task.revised_datetime,v_task.planned_datetime) at time zone 'Asia/Kolkata')::date;
  if new.is_original and v_task.status='pending' and v_task_date between v_today and v_today+1 then
    select * into v_resolution from resolve_task_coverage(new.user_profile_id,
      v_task_date);
    if v_resolution.resolution<>'original' then return new; end if;
  end if;
  select is_active into v_persisted_active from task_assignees where id=new.id;
  if not coalesce(v_persisted_active,false) then return new; end if;
  if tg_op='UPDATE' and old.is_active=true then return new; end if;
  select title,tenant_id into v_title,v_tenant_id from task_instances where id=new.task_instance_id;
  insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url,channel)
  values(v_tenant_id,new.user_profile_id,'task_assigned','New Task Assigned',
    'You have been assigned to task: '||coalesce(v_title,'Untitled Task'),'/tasks/checklist','in_app');
  return new;
end;
$$;

create or replace function emit_task_notification_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_task task_instances; v_event_type text; v_resolution record;
  v_task_date date; v_today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
  select * into v_task from task_instances where id=new.task_instance_id;
  v_task_date:=(coalesce(v_task.revised_datetime,v_task.planned_datetime) at time zone 'Asia/Kolkata')::date;
  if new.is_original and v_task.status='pending' and v_task_date between v_today and v_today+1 then
    select * into v_resolution from resolve_task_coverage(new.user_profile_id,
      v_task_date);
    if v_resolution.resolution<>'original' then return new; end if;
  end if;
  v_event_type:=case when new.is_original then 'task_assigned' else 'task_delegated' end;
  insert into notifications(tenant_id,branch_id,department_id,user_profile_id,event_type,title,message,
    link_url,channel,delivered_status,priority,source_module,source_record_id,delivered_at)
  values(v_task.tenant_id,v_task.branch_id,v_task.department_id,new.user_profile_id,v_event_type,
    case when new.is_original then 'New task assigned' else 'Task delegated to you' end,
    left(v_task.title,4000),'/tasks','in_app','delivered',v_task.priority,'tasks',v_task.id,now());
  return new;
end;
$$;

create or replace function normalize_coverage_notification_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_effective uuid;
begin
  if new.source_module='tasks' and new.event_type in ('task_assigned','task_delegated') then
    if new.idempotency_key like 'task_watcher:%' then return new; end if;
    if not exists(
      select 1 from task_assignees a
      where a.task_instance_id=new.source_record_id and a.is_active and a.role_at_task='doer'
        and a.user_profile_id in (select value::uuid from jsonb_array_elements_text(coalesce(new.payload->'_assigned_user_ids','[]'::jsonb)))
    ) then return null; end if;
  elsif new.source_module='crm' and new.event_type='followup_created' then
    select assigned_to into v_effective from client_followups where id=new.source_record_id;
    if v_effective is not null then
      new.payload:=jsonb_set(new.payload,'{_assigned_user_ids}',jsonb_build_array(v_effective),true);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists notification_events_normalize_coverage_recipient on notification_events;
create trigger notification_events_normalize_coverage_recipient before insert on notification_events
for each row execute function normalize_coverage_notification_event();

revoke all on function resolve_task_coverage(uuid,date) from public,anon,authenticated;
revoke all on function reconcile_short_deadline_coverage_with_audit(uuid,date,text) from public,anon,authenticated,service_role;
revoke all on function record_availability_range_with_audit(uuid,date,date,availability_status,text) from public,anon;
revoke all on function get_recurring_todo_workspace(jsonb) from public,anon;
revoke all on function create_recurring_todo_instance(uuid,date,uuid[]) from public,anon,authenticated;
revoke all on function configure_invited_profile_coverage_with_audit(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function save_recurring_todo_template_with_audit(uuid,jsonb) from public,anon;
revoke all on function set_recurring_todo_template_active_with_audit(uuid,boolean) from public,anon;
revoke all on function run_recurring_todo_template_now_with_audit(uuid,date) from public,anon;
revoke all on function delete_recurring_todo_template_with_audit(uuid) from public,anon;
revoke all on function verify_recurring_task_with_audit(uuid,text,text) from public,anon;
revoke all on function send_recurring_followup_with_audit(uuid,text) from public,anon;
revoke all on function apply_task_assignment_coverage() from public,anon,authenticated,service_role;
revoke all on function apply_crm_followup_coverage() from public,anon,authenticated,service_role;
revoke all on function normalize_coverage_notification_event() from public,anon,authenticated,service_role;
revoke all on function notify_task_assignment() from public,anon,authenticated,service_role;
revoke all on function emit_task_notification_event() from public,anon,authenticated,service_role;
revoke all on function reconcile_changed_week_off() from public,anon,authenticated,service_role;
grant execute on function record_availability_range_with_audit(uuid,date,date,availability_status,text) to authenticated;
grant execute on function get_recurring_todo_workspace(jsonb) to authenticated;
grant execute on function resolve_task_coverage(uuid,date) to service_role;
grant execute on function create_recurring_todo_instance(uuid,date,uuid[]) to service_role;
grant execute on function configure_invited_profile_coverage_with_audit(uuid,uuid,uuid,uuid) to service_role;
grant execute on function save_recurring_todo_template_with_audit(uuid,jsonb) to authenticated;
grant execute on function set_recurring_todo_template_active_with_audit(uuid,boolean) to authenticated;
grant execute on function run_recurring_todo_template_now_with_audit(uuid,date) to authenticated;
grant execute on function delete_recurring_todo_template_with_audit(uuid) to authenticated;
grant execute on function verify_recurring_task_with_audit(uuid,text,text) to authenticated;
grant execute on function send_recurring_followup_with_audit(uuid,text) to authenticated;

notify pgrst,'reload schema';
