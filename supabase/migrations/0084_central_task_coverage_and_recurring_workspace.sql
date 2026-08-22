-- Central task coverage and the database-backed Recurring / To-Do workspace.
-- All dates in the coverage contract are interpreted in Asia/Kolkata.
set search_path = public, extensions;

alter table user_profiles
  add column if not exists secondary_buddy_id uuid references user_profiles(id);

create index if not exists idx_user_profiles_secondary_buddy
  on user_profiles(secondary_buddy_id) where secondary_buddy_id is not null;

alter table task_instances
  add column if not exists coverage_status text,
  add column if not exists coverage_original_assignee_id uuid references user_profiles(id),
  add column if not exists coverage_resolution text,
  add column if not exists coverage_resolved_for_date date;

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
  v_ids uuid[]:='{}'; v_previous uuid[]; v_candidate uuid; v_coverage record; v_target_date date;
begin
  select * into v_stage from fms_stages where id=p_stage_id;
  select * into v_instance from fms_instances where id=p_instance_id;
  if v_stage.id is null or v_instance.id is null or v_stage.fms_flow_id<>v_instance.fms_flow_id then
    raise exception 'Invalid stage activation' using errcode='23514';
  end if;
  v_target_date:=(now() at time zone 'Asia/Kolkata')::date;
  if p_selected_user is not null then
    if not exists(select 1 from user_profiles u where u.id=p_selected_user and u.tenant_id=v_instance.tenant_id
      and u.branch_id=v_instance.branch_id and u.department_id=v_instance.department_id
      and u.working_status not in ('inactive','resigned') and coalesce(u.account_status::text,'active') in ('active','invited')) then
      raise exception 'The selected starting assignee is outside this branch and department' using errcode='23514';
    end if;
    select * into v_coverage from resolve_task_coverage(p_selected_user,v_target_date);
    if v_coverage.effective_assignee_id is null then raise exception 'Coverage required for the selected starting assignee' using errcode='23514'; end if;
    return array[v_coverage.effective_assignee_id];
  end if;
  select assigned_to into v_previous from fms_instance_stages where fms_instance_id=p_instance_id
    and status='completed' order by actual_datetime desc nulls last,created_at desc limit 1;
  for v_rule in select * from fms_stage_assignees where fms_stage_id=p_stage_id order by sort_order,id loop
    if v_rule.assignee_type='specific_user' then
      select * into v_coverage from resolve_task_coverage(v_rule.user_profile_id,v_target_date);
      if v_coverage.effective_assignee_id is not null then v_ids:=array_append(v_ids,v_coverage.effective_assignee_id); end if;
    elsif v_rule.assignee_type='role' then
      for v_candidate in select id from user_profiles where tenant_id=v_instance.tenant_id and user_role=v_rule.role_value
        and (v_instance.branch_id is null or branch_id=v_instance.branch_id)
        and (v_instance.department_id is null or department_id=v_instance.department_id)
        and working_status not in ('inactive','resigned') and is_login_enabled
      loop
        select * into v_coverage from resolve_task_coverage(v_candidate,v_target_date);
        if v_coverage.effective_assignee_id is not null then v_ids:=array_append(v_ids,v_coverage.effective_assignee_id); end if;
      end loop;
    elsif v_rule.assignee_type='manager' then select manager_id into v_candidate from branches where id=v_instance.branch_id; v_ids:=array_append(v_ids,v_candidate);
    elsif v_rule.assignee_type='department_head' then select head_id into v_candidate from departments where id=v_instance.department_id; v_ids:=array_append(v_ids,v_candidate);
    elsif v_rule.assignee_type='previous_step_doer' then v_ids:=v_ids||coalesce(v_previous,'{}');
    elsif v_rule.assignee_type='reporter' then v_ids:=array_append(v_ids,v_instance.started_by);
    end if;
  end loop;
  select coalesce(array_agg(distinct u.id),'{}') into v_ids from unnest(array_remove(v_ids,null)) candidate(id)
    join user_profiles u on u.id=candidate.id where u.tenant_id=v_instance.tenant_id
      and u.working_status not in ('inactive','resigned') and u.is_login_enabled;
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
  select * into v_resolution from resolve_task_coverage(p_user_profile_id,p_date);
  v_manager := coalesce(v_target.reports_to_user_id,
    (select d.head_id from departments d where d.id=v_target.department_id));

  for v_task in
    select distinct ti.* from task_instances ti join task_assignees ta on ta.task_instance_id=ti.id
    where ti.tenant_id=v_actor.tenant_id and ta.user_profile_id=p_user_profile_id
      and ta.is_active and ta.role_at_task='doer'
      and (coalesce(ti.revised_datetime,ti.planned_datetime) at time zone 'Asia/Kolkata')::date=p_date
      and ti.status in ('pending','in_progress','in_review') for update of ti
  loop
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
    if v_resolution.effective_assignee_id is not null then
      update client_followups set assigned_to=v_resolution.effective_assignee_id,
        coverage_status='covered',coverage_original_assignee_id=p_user_profile_id,
        coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=p_date,
        updated_by=v_actor.id,updated_at=now(),record_version=record_version+1 where id=v_followup.id;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_actor.tenant_id,v_actor.id,'short_deadline_coverage_assigned','crm_followups',v_followup.id,
        jsonb_build_object('assigned_to',p_user_profile_id),
        jsonb_build_object('assigned_to',v_resolution.effective_assignee_id,'resolution',v_resolution.resolution,'date',p_date));
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
  insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by)
  values(v_actor.tenant_id,p_user_profile_id,p_date,p_status,nullif(btrim(p_reason),''),v_actor.id)
  on conflict(user_profile_id,date) do update set status=excluded.status,reason=excluded.reason,logged_by=excluded.logged_by
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
declare v_date date; v_ids jsonb:='[]'::jsonb;
begin
  if p_end_date<p_start_date or p_end_date-p_start_date>366 then
    raise exception 'Availability range must be between 1 and 367 days' using errcode='22023';
  end if;
  for v_date in select generate_series(p_start_date,p_end_date,'1 day'::interval)::date loop
    v_ids:=v_ids||jsonb_build_array(record_availability_with_audit(p_user_profile_id,v_date,p_status,p_reason));
  end loop;
  return jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'record_ids',v_ids);
end;
$$;

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
    and (v_actor.user_role in ('super_admin','admin','manager','hr') or t.created_by=v_actor.id or t.default_assignee_user_id=v_actor.id)
    and (v_search='' or lower(t.title||' '||coalesce(t.description,'')) like '%'||v_search||'%');
  with visible as (
    select ti.* from task_instances ti where ti.tenant_id=v_actor.tenant_id and ti.task_template_id is not null
      and (ti.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to
      and (v_status is null or ti.status::text=v_status)
      and (v_search='' or lower(ti.title||' '||coalesce(ti.description,'')) like '%'||v_search||'%')
      and (v_actor.user_role in ('super_admin','admin','manager','hr') or ti.created_by=v_actor.id or exists(
        select 1 from task_assignees a where a.task_instance_id=ti.id and a.user_profile_id=v_actor.id and a.is_active))
  )
  select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object(
    'assignees',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name,'is_original',a.is_original)),'[]'::jsonb)
      from task_assignees a join user_profiles u on u.id=a.user_profile_id where a.task_instance_id=v.id and a.is_active),
    'checklist',(select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order),'[]'::jsonb) from task_checklists c where c.task_instance_id=v.id)
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
    and (v_actor.user_role in ('super_admin','admin','manager','hr') or ti.created_by=v_actor.id or exists(
      select 1 from task_assignees a where a.task_instance_id=ti.id and a.user_profile_id=v_actor.id and a.is_active));
  return jsonb_build_object('filters',jsonb_build_object('date_from',v_from,'date_to',v_to),
    'templates',v_templates,'instances',v_instances,'stats',v_stats);
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
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if p_target_date is null or coalesce(array_length(p_original_assignee_ids,1),0)=0 then
    raise exception 'Target date and original assignees are required' using errcode='22023';
  end if;
  select * into v_template from task_templates where id=p_template_id and is_active and task_type='checklist' for update;
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
      values(v_task.id,v_original_id,'doer',true,true) on conflict do nothing;
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

revoke all on function resolve_task_coverage(uuid,date) from public,anon,authenticated;
revoke all on function reconcile_short_deadline_coverage_with_audit(uuid,date,text) from public,anon;
revoke all on function record_availability_range_with_audit(uuid,date,date,availability_status,text) from public,anon;
revoke all on function get_recurring_todo_workspace(jsonb) from public,anon;
revoke all on function create_recurring_todo_instance(uuid,date,uuid[]) from public,anon,authenticated;
grant execute on function reconcile_short_deadline_coverage_with_audit(uuid,date,text) to authenticated;
grant execute on function record_availability_range_with_audit(uuid,date,date,availability_status,text) to authenticated;
grant execute on function get_recurring_todo_workspace(jsonb) to authenticated;
grant execute on function resolve_task_coverage(uuid,date) to service_role;
grant execute on function create_recurring_todo_instance(uuid,date,uuid[]) to service_role;

notify pgrst,'reload schema';
