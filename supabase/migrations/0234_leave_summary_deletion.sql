-- Owner-approved individual and bulk removal, with durable audit evidence.
set search_path=public,extensions;

-- permission-catalog:begin
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values
('availability.delete_leave', 'protected', null, '{super_admin}', 194);
-- permission-catalog:end

-- Deleted requests retain private approval evidence through their audited
-- snapshots. The same reference protects cleanup and auditor signed URLs.
create index leave_deleted_tl_evidence_idx on audit_logs(tenant_id,(old_value->>'tl_approval_path')) where action='leave_deleted';
create index leave_deleted_handover_evidence_idx on audit_logs(tenant_id,(old_value->>'handover_approval_path')) where action='leave_deleted';
create index leave_availability_restore_audit_idx on audit_logs(tenant_id,record_id,(new_value->>'reason'),created_at desc,id desc)
  where action in ('availability_recorded','leave_deletion_availability_reconciled');
create function leave_file_retained_for_audit(p_path text)
returns boolean language sql stable security definer set search_path=public as $$
  select current_profile_is_active() and module_accessible('availability') and exists(
    select 1 from audit_logs al where al.tenant_id=current_tenant_id() and al.action='leave_deleted'
      and (al.old_value->>'tl_approval_path'=p_path or al.old_value->>'handover_approval_path'=p_path))
$$;
revoke all on function leave_file_retained_for_audit(text) from public,anon,authenticated,service_role;
grant execute on function leave_file_retained_for_audit(text) to authenticated;

create or replace function leave_file_readable(p_path text)
returns boolean language sql stable security definer set search_path=public as $$
  select leave_file_writable(p_path) or exists(select 1 from leave_requests r
    where (r.tl_approval_path=p_path or r.handover_approval_path=p_path)
      and r.tenant_id=current_tenant_id() and current_profile_is_active() and module_accessible('availability')
      and (r.applicant_id=(current_profile()).id or has_permission('availability.review_leave')
        or has_permission('availability.view_leave_summary')))
    or (leave_file_retained_for_audit(p_path) and
      (has_permission('availability.review_leave') or has_permission('availability.view_leave_summary')))
$$;
drop policy leave_approval_cleanup on storage.objects;
create policy leave_approval_cleanup on storage.objects for delete to authenticated
using(bucket_id='leave-approvals' and owner_id=auth.uid()::text and leave_file_writable(name)
  and not leave_file_retained_for_audit(name)
  and not exists(select 1 from public.leave_requests r where r.tl_approval_path=name or r.handover_approval_path=name));

-- Shared coverage restoration for leave cleanup. Only unfinished work changes.
-- This helper is internal; the public deletion RPC authorizes and scopes it.
create function restore_deleted_leave_coverage(p_user uuid,p_date date)
returns void language plpgsql security definer set search_path=public as $$
declare a user_profiles; t task_instances; f client_followups; s fms_instance_stages;
  v_buddy uuid; v_keep_buddy boolean; v_half_day boolean;
  v_at timestamptz:=case when p_date=(now() at time zone 'Asia/Kolkata')::date then now() end;
begin
  a:=current_profile();
  if not is_user_available_for_task(p_user,p_date) or not exists(select 1 from user_profiles u
    where u.id=p_user and u.tenant_id=a.tenant_id and u.account_status='active' and u.is_login_enabled) then return; end if;
  select exists(select 1 from user_availability where user_profile_id=p_user and date=p_date and status='half_day') into v_half_day;
  for t in select * from task_instances_live where tenant_id=a.tenant_id
    and coverage_original_assignee_id=p_user and coverage_resolved_for_date=p_date
    and status not in ('completed','rejected') for update
  loop
    if v_half_day and (coalesce(v_at,task_effective_due_datetime(t)) is null
      or leave_half_day_absent_at(p_user,coalesce(v_at,task_effective_due_datetime(t)))) then continue; end if;
    -- A multi-doer task may still be pending after this contribution completed.
    -- Preserve that completion and its coverage rather than assigning it again.
    if exists(select 1 from task_assignees ta where ta.task_instance_id=t.id
      and ta.role_at_task='doer' and ta.completed_at is not null
      and (ta.user_profile_id=p_user or (not ta.is_original and ta.is_active))) then continue; end if;
    update task_assignees set is_active=false where task_instance_id=t.id
      and role_at_task='doer' and is_active and not is_original;
    update task_assignees set is_active=true where task_instance_id=t.id
      and user_profile_id=p_user and role_at_task='doer' and is_original and completed_at is null;
    if not found then
      insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
      values(t.id,p_user,'doer',true,true) on conflict do nothing;
    end if;
    update task_instances set coverage_status=null,coverage_original_assignee_id=null,
      coverage_resolution=null,coverage_resolved_for_date=null,updated_by=a.id,updated_at=now() where id=t.id;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(a.tenant_id,a.id,'absence_coverage_restored','tasks',t.id,to_jsonb(t),
      jsonb_build_object('source','leave_deleted','original_assignee_id',p_user,'date',p_date));
  end loop;
  for f in select * from client_followups where tenant_id=a.tenant_id
    and coverage_original_assignee_id=p_user and coverage_resolved_for_date=p_date and status='open' for update
  loop
    -- Date-only follow-ups have no historical hour to distinguish the halves.
    -- On today's date use the existing live half-day timing contract.
    if v_half_day and (v_at is null or leave_half_day_absent_at(p_user,v_at)) then continue; end if;
    update client_followups set assigned_to=p_user,coverage_status=null,coverage_original_assignee_id=null,
      coverage_resolution=null,coverage_resolved_for_date=null,updated_by=a.id,updated_at=now(),
      record_version=record_version+1 where id=f.id;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(a.tenant_id,a.id,'absence_coverage_restored','crm_followups',f.id,to_jsonb(f),
      jsonb_build_object('source','leave_deleted','original_assignee_id',p_user,'date',p_date));
  end loop;
  for s in select st.* from fms_instance_stages st join fms_instances fi on fi.id=st.fms_instance_id
    where fi.tenant_id=a.tenant_id and st.coverage_original_assignee_id=p_user
      and st.coverage_resolved_for_date=p_date and st.status='pending' for update of st
  loop
    if v_half_day and (coalesce(v_at,s.planned_datetime) is null
      or leave_half_day_absent_at(p_user,coalesce(v_at,s.planned_datetime))) then continue; end if;
    -- Completed individual contributions are durable even while all_doers is
    -- waiting on another peer. Legacy coverage cannot identify its buddy safely.
    if exists(select 1 from fms_instance_stage_assignees sa where sa.fms_instance_stage_id=s.id
      and (sa.status='completed' or sa.completed_at is not null) and (sa.user_profile_id=p_user
        or sa.user_profile_id=s.leave_coverage_buddy_id
        or (s.leave_coverage_buddy_id is null and sa.is_active))) then continue; end if;
    v_buddy:=s.leave_coverage_buddy_id;
    v_keep_buddy:=coalesce(s.leave_coverage_buddy_preexisting,false);
    -- Legacy full-day coverage has no reliable preexisting-buddy metadata.
    -- Preserve its current peers rather than removing a legitimate assignee.
    if v_buddy is null then
      v_keep_buddy:=true;
    end if;
    update fms_instance_stage_assignees set is_active=false,status='reassigned'
      where fms_instance_stage_id=s.id and user_profile_id=v_buddy and is_active and not v_keep_buddy;
    if not exists(select 1 from fms_instance_stage_assignees where fms_instance_stage_id=s.id
      and user_profile_id=p_user and is_active) then
      update fms_instance_stage_assignees set is_active=true,status='assigned' where id=(
        select id from fms_instance_stage_assignees where fms_instance_stage_id=s.id
          and user_profile_id=p_user and status='reassigned' order by assigned_at desc,id limit 1);
      if not found then
        insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by)
        values(a.tenant_id,s.id,p_user,a.id);
      end if;
    end if;
    update fms_instance_stages set assigned_to=case when p_user=any(
      case when v_keep_buddy then assigned_to else array_remove(assigned_to,v_buddy) end)
      then case when v_keep_buddy then assigned_to else array_remove(assigned_to,v_buddy) end
      else array_append(case when v_keep_buddy then assigned_to else array_remove(assigned_to,v_buddy) end,p_user) end,
      coverage_status=null,coverage_original_assignee_id=null,coverage_resolution=null,
      coverage_resolved_for_date=null,leave_coverage_buddy_id=null,leave_coverage_buddy_preexisting=null,
      updated_at=now() where id=s.id;
    insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
    values(s.id,a.id,'reassigned',jsonb_build_object('source','leave_deleted','to',p_user,'date',p_date));
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(a.tenant_id,a.id,'absence_coverage_restored','fms',s.id,to_jsonb(s),
      jsonb_build_object('source','leave_deleted','original_assignee_id',p_user,'date',p_date));
  end loop;
end $$;
revoke all on function restore_deleted_leave_coverage(uuid,date) from public,anon,authenticated,service_role;

create function delete_leave_requests_with_audit(p_ids uuid[])
returns integer language plpgsql security definer set search_path=public as $$
declare a user_profiles; r leave_requests; v_ids uuid[]; v_count integer:=0;
  av user_availability; v_prior jsonb; v_remaining leave_requests; v_status availability_status;
  v_reason text; v_seen_reasons text[];
begin
  a:=current_profile();
  if a.id is null or not current_profile_is_active() or not has_permission('availability.delete_leave') then
    raise exception 'Leave deletion denied' using errcode='42501';
  end if;
  perform assert_module_access('availability');
  if p_ids is null or cardinality(p_ids) not between 1 and 500 or array_position(p_ids,null) is not null then
    raise exception 'Select between 1 and 500 leave requests' using errcode='22023';
  end if;
  select array_agg(distinct id order by id) into v_ids from unnest(p_ids) id;
  -- Separate batches can select different overlapping requests for one person.
  -- Serialize those deletions before reading the remaining approvals. NO KEY
  -- UPDATE also permits the FK key-share locks used by concurrent leave review.
  perform p.id from user_profiles p where p.tenant_id=a.tenant_id and exists(
    select 1 from leave_requests lr where lr.id=any(v_ids) and lr.tenant_id=a.tenant_id and lr.applicant_id=p.id)
    order by p.id for no key update;
  -- Validate the entire selection before any write; lock against concurrent review.
  for r in select * from leave_requests where id=any(v_ids) and tenant_id=a.tenant_id order by id for update loop
    v_count:=v_count+1;
  end loop;
  if v_count<>cardinality(v_ids) then
    raise exception 'Leave request not found or not accessible' using errcode='42501';
  end if;
  for r in select * from leave_requests where id=any(v_ids) order by id loop
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(a.tenant_id,a.id,'leave_deleted','availability',r.id,to_jsonb(r),
      jsonb_build_object('deleted',true,'batch_size',v_count,'approval_images_retained',true));
  end loop;
  delete from leave_requests where id=any(v_ids) and tenant_id=a.tenant_id;
  -- Approval RPC labels its availability rows with the exact leave ID. Manual
  -- overrides have another reason and are deliberately left untouched.
  for av in select * from user_availability where tenant_id=a.tenant_id
    and reason=any(select 'Approved leave '||id::text from unnest(v_ids) id)
    order by user_profile_id,date for update
  loop
    v_remaining:=null;
    select * into v_remaining from leave_requests lr where lr.tenant_id=a.tenant_id
      and lr.applicant_id=av.user_profile_id and lr.status='approved'
      and av.date between lr.leave_start and lr.work_start_date
      and (extract(dow from av.date)<>0 or lr.leave_start=lr.work_start_date)
      and (av.date<>lr.work_start_date or (lr.work_start_in='2ND HALF'
        and not(av.date=lr.leave_start and lr.duration='2ND HALF')))
      order by case when av.date=lr.work_start_date or (av.date=lr.leave_start and lr.duration='2ND HALF') then 1 else 0 end,
        lr.reviewed_at desc,lr.id limit 1;
    -- Resolve the manual baseline even when another approval remains. Retain it
    -- in the reconciliation audit so deletion order cannot lose a manual change
    -- made between overlapping approvals.
    v_prior:=null; v_reason:=av.reason; v_seen_reasons:='{}';
    loop
      if v_reason=any(v_seen_reasons) then
        raise exception 'Leave availability audit chain is inconsistent' using errcode='22000';
      end if;
      v_seen_reasons:=array_append(v_seen_reasons,v_reason);
      select case when al.action='leave_deletion_availability_reconciled'
        then al.new_value->'restore_baseline' else al.old_value end into v_prior
      from audit_logs al where al.tenant_id=a.tenant_id and al.record_id=av.id
        and al.new_value->>'reason'=v_reason and (al.action='availability_recorded'
          or (al.action='leave_deletion_availability_reconciled' and al.new_value ? 'restore_baseline'))
      order by (al.action='leave_deletion_availability_reconciled') desc,al.created_at desc,al.id desc limit 1;
      exit when coalesce(v_prior->>'reason','') !~ '^Approved leave [0-9a-f-]{36}$';
      v_reason:=v_prior->>'reason';
    end loop;
    if v_remaining.id is not null then
      v_status:=(case when av.date=v_remaining.work_start_date or (av.date=v_remaining.leave_start
        and v_remaining.duration='2ND HALF') then 'half_day' else 'absent' end)::availability_status;
    else
      v_status:=coalesce((v_prior->>'status')::availability_status,'present');
    end if;
    update user_availability set status=v_status,
      reason=case when v_remaining.id is not null then 'Approved leave '||v_remaining.id::text else v_prior->>'reason' end,
      logged_by=a.id,source=coalesce(v_prior->>'source','manual') where id=av.id;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value,created_at)
    values(a.tenant_id,a.id,'leave_deletion_availability_reconciled','availability',av.id,to_jsonb(av),
      (select to_jsonb(ua) from user_availability ua where ua.id=av.id)
        || jsonb_build_object('restore_baseline',v_prior),clock_timestamp());
    if v_status in ('present','half_day') then perform restore_deleted_leave_coverage(av.user_profile_id,av.date); end if;
  end loop;
  return v_count;
end $$;
revoke all on function delete_leave_requests_with_audit(uuid[]) from public,anon,authenticated,service_role;
grant execute on function delete_leave_requests_with_audit(uuid[]) to authenticated;
