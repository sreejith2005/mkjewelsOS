-- Exact personal counts: durable work, never a page length or management scope.
set search_path=public,extensions;

create function public.get_my_sidebar_counts()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  a user_profiles:=current_profile();
  result jsonb:='{}';
  tasks_count bigint:=0; delegation_count bigint:=0; recurring_count bigint:=0;
  fms_count bigint:=0; forms_count bigint:=0; unread_count bigint:=0; leave_count bigint:=0;
  can_tasks boolean; can_recurring boolean;
begin
  if auth.uid() is null or a.id is null or not current_profile_is_active() then
    raise exception 'Sidebar counts access denied' using errcode='42501';
  end if;
  -- The shell spans sections. Check each section independently so one disabled
  -- module cannot prevent the authorized modules from rendering their counts.
  can_tasks:=module_accessible('checklist_tasks');
  can_recurring:=module_accessible('recurring_todo');
  if can_tasks or can_recurring then
    with mine as materialized (
      select t.id,t.status,t.task_template_id,t.verifier_user_profile_id,t.verification_status,t.requires_form,t.form_template_id,
        exists(select 1 from task_assignees ta where ta.task_instance_id=t.id
          and ta.user_profile_id=a.id and ta.is_active and ta.role_at_task='doer'
          and ta.completed_at is null) owes_work
      from task_instances t where t.tenant_id=a.tenant_id and t.deleted_at is null
        and t.task_type in ('checklist','delegation')
        and (can_tasks or (t.task_template_id is not null and can_recurring))
        and (exists(select 1 from task_assignees ta where ta.task_instance_id=t.id
          and ta.user_profile_id=a.id and ta.is_active and ta.role_at_task='doer'
          and ta.completed_at is null)
          or (t.verifier_user_profile_id=a.id and t.status='completed' and t.verification_status='pending'))
    )
    select count(*) filter(where (owes_work and status not in ('completed','blocked'))
        or (verifier_user_profile_id=a.id and status='completed' and verification_status='pending')),
      count(*) filter(where owes_work and status not in ('completed','blocked') and task_template_id is null),
      count(*) filter(where task_template_id is not null and
        ((owes_work and status not in ('completed','blocked')) or
         (verifier_user_profile_id=a.id and status='completed' and verification_status='pending'))),
      count(*) filter(where can_tasks and owes_work and status not in ('completed','blocked') and requires_form
        and form_template_id is not null and not exists(select 1 from form_submissions fs
          where fs.tenant_id=a.tenant_id and fs.form_template_id=mine.form_template_id
            and fs.linked_record_id=mine.id and fs.submitted_by=a.id
            and fs.linked_module in ('task','checklist_task','delegation_task')))
    into tasks_count,delegation_count,recurring_count,forms_count from mine;
  end if;
  if module_accessible('fms_builder') then
    with mine as (
      select s.id,st.form_template_id,s.form_submission_id
      from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id
      join fms_stages st on st.id=s.fms_stage_id
      where i.tenant_id=a.tenant_id and i.status in ('active','overdue') and s.assigned_to @> array[a.id]
        and s.status in ('pending','in_progress','in_review','overdue')
        and not exists(select 1 from fms_instance_stage_assignees sa where sa.fms_instance_stage_id=s.id
          and sa.user_profile_id=a.id and sa.is_active and sa.status not in ('assigned','claimed'))
        and st.step_type not in ('notification','branch','parallel_start','parallel_join','end')
        and can_read_fms_instance(i.id)
      union all
      select s.id,s.form_template_id,null::uuid from fms_starter_assignments s
      where s.tenant_id=a.tenant_id and s.user_profile_id=a.id and s.status='pending'
    )
    select count(*),forms_count+count(*) filter(where form_template_id is not null and form_submission_id is null)
      into fms_count,forms_count from mine;
    result:=result||jsonb_build_object('fms_builder',fms_count,'fms_tasks',fms_count);
  end if;
  if can_tasks then
    result:=result||jsonb_build_object('checklist_tasks',tasks_count+fms_count,'delegation_tasks',delegation_count);
  end if;
  if can_recurring then
    result:=result||jsonb_build_object('recurring_todo',recurring_count);
  end if;
  if module_accessible('forms_library') then
    result:=result||jsonb_build_object('forms_library',forms_count);
  end if;
  if module_accessible('notifications') then
    select count(*) into unread_count from notifications n
      where n.tenant_id=a.tenant_id and n.user_profile_id=a.id and not n.is_read and n.channel='in_app';
    result:=result||jsonb_build_object('notifications',unread_count);
  end if;
  if module_accessible('availability') then
    select count(*) into leave_count from notifications n
      where n.tenant_id=a.tenant_id and n.user_profile_id=a.id and not n.is_read
        and n.channel='in_app' and n.event_type='leave_status_updated' and n.source_module='availability';
    if has_permission('availability.review_leave') and has_permission('availability.manage_others') then
      select leave_count+count(*) into leave_count from leave_requests l
        where l.tenant_id=a.tenant_id and l.status='pending' and l.applicant_id<>a.id;
    end if;
    result:=result||jsonb_build_object('availability',leave_count);
  end if;
  return result;
end $$;
revoke all on function public.get_my_sidebar_counts() from public,anon,authenticated,service_role;
grant execute on function public.get_my_sidebar_counts() to authenticated;

create function public.get_my_leave_update_ids()
returns uuid[] language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); ids uuid[];
begin
  if auth.uid() is null or a.id is null or not current_profile_is_active() then
    raise exception 'Leave update snapshot denied' using errcode='42501';
  end if;
  perform assert_module_access('availability');
  select coalesce(array_agg(id order by created_at,id),'{}'::uuid[]) into ids from notifications
    where tenant_id=a.tenant_id and user_profile_id=a.id and not is_read
      and channel='in_app' and event_type='leave_status_updated' and source_module='availability';
  return ids;
end $$;
revoke all on function public.get_my_leave_update_ids() from public,anon,authenticated,service_role;
grant execute on function public.get_my_leave_update_ids() to authenticated;

create function public.mark_my_leave_updates_read(p_notification_ids uuid[],p_leave_ids uuid[])
returns integer language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile(); updated_count integer;
begin
  if auth.uid() is null or a.id is null or not current_profile_is_active() then
    raise exception 'Leave update acknowledgement denied' using errcode='42501';
  end if;
  perform assert_module_access('availability');
  update notifications set is_read=true,read_at=coalesce(read_at,now())
    where tenant_id=a.tenant_id and user_profile_id=a.id and not is_read
      and id=any(p_notification_ids)
      and source_record_id=any(p_leave_ids)
      and channel='in_app' and event_type='leave_status_updated' and source_module='availability';
  get diagnostics updated_count=row_count;
  if updated_count>0 then
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
    values(a.tenant_id,a.id,'leave_updates_read','availability',a.id,jsonb_build_object('count',updated_count));
  end if;
  return updated_count;
end $$;
revoke all on function public.mark_my_leave_updates_read(uuid[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.mark_my_leave_updates_read(uuid[],uuid[]) to authenticated;

-- Emit only future status transitions; existing leave and notification history
-- remains intact. The protected review RPC still owns authorization and audit.
create function public.notify_leave_status_update()
returns trigger language plpgsql security definer set search_path=public as $$
declare notification_id uuid;
begin
  if old.status is not distinct from new.status then return new; end if;
  insert into notifications(tenant_id,branch_id,user_profile_id,event_type,title,message,
    link_url,channel,delivered_status,source_module,source_record_id,delivered_at)
  values(new.tenant_id,new.branch_id,new.applicant_id,'leave_status_updated','Leave application updated',
    'Your leave application is '||new.status||'.','/availability','in_app','delivered','availability',new.id,now())
  returning id into notification_id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(new.tenant_id,(current_profile()).id,'leave_status_notification_created','availability',new.id,
    jsonb_build_object('notification_id',notification_id,'status',new.status,'recipient_id',new.applicant_id));
  return new;
end $$;
revoke all on function public.notify_leave_status_update() from public,anon,authenticated,service_role;
create trigger leave_status_update_notification after update of status on public.leave_requests
for each row execute function public.notify_leave_status_update();
notify pgrst,'reload schema';
