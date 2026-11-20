-- All active task authors can assign across departments and hierarchy.
-- Task-only contracts change; FMS/form recipient predicates remain unchanged.
set search_path = public, extensions;

create function pg_temp.patch_0438(sig text, old_text text, new_text text, expected int default 1)
returns void language plpgsql as $$
declare body text; matches int;
begin
  body := replace(pg_get_functiondef(sig::regprocedure), E'\r', '');
  old_text := replace(old_text,E'\r','');
  new_text := replace(new_text,E'\r','');
  matches := (length(body)-length(replace(body,old_text,'')))/length(old_text);
  if matches <> expected then raise exception '0438: unexpected contract in % (% matches)',sig,matches; end if;
  execute replace(body,old_text,new_text);
end $$;

create function task_author_recipient_eligible(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select current_profile_is_active() and exists (
    select 1 from user_profiles u cross join current_profile() actor
    join branches b on b.id=u.branch_id and b.tenant_id=u.tenant_id and b.is_active
    join departments d on d.id=u.department_id and d.tenant_id=u.tenant_id and d.is_active
    where u.id=p_user_id and u.tenant_id=actor.tenant_id and u.removed_at is null
      and u.working_status='active' and u.account_status in ('active','invited')
      and (u.account_status='invited' or u.is_login_enabled));
$$;
revoke all on function task_author_recipient_eligible(uuid) from public,anon,authenticated,service_role;

create or replace function assert_task_assignment_targets(p_doer_ids uuid[],p_watcher_ids uuid[] default '{}')
returns void language plpgsql stable security definer set search_path=public as $$
begin
  perform assert_module_access('tasks');
  if not current_profile_is_active() then raise exception 'Active task author is required' using errcode='42501'; end if;
  if exists(select 1 from unnest(coalesce(p_doer_ids,'{}')||coalesce(p_watcher_ids,'{}')) r(id)
    where not task_author_recipient_eligible(id)) then
    raise exception 'Task participant is inactive or outside your company' using errcode='42501';
  end if;
end $$;

select pg_temp.patch_0438('public.list_task_assignment_users()',
$o$and (allowed or u.id=a.id) and task_assignment_user_in_scope(u.id) and task_assignment_recipient_allowed(u.id)$o$,
$n$and task_author_recipient_eligible(u.id)$n$, 1);

select pg_temp.patch_0438('public.assert_task_assignment_rule(text,uuid)',
$o$  if not has_permission('tasks.assign_others')$o$,
$n$  if p_type='specific_user' then
    perform assert_task_assignment_targets(array[p_user_id]);
    return;
  end if;
  if not has_permission('tasks.assign_others')$n$, 1);

select pg_temp.patch_0438('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)',
$o$  if v_actor.id is null or not current_profile_is_active()
     or (
      not public.org_cross_location_task_active()
      and v_actor.user_role not in ('super_admin', 'admin', 'manager')
      and not public.has_permission('tasks.assign_company_wide')
      and not exists (select 1 from dropdown_masters designation where designation.id = v_actor.designation_id and designation.master_type = 'designation' and designation.is_active and (designation.tenant_id = v_actor.tenant_id or designation.tenant_id is null) and lower(designation.value) = 'process_coordinator')
      and not (coalesce(nullif(p_payload->>'department_id', '')::uuid, v_actor.department_id) = v_actor.department_id and not exists (select 1 from unnest(coalesce(p_doer_ids, '{}'::uuid[]) || coalesce(p_watcher_ids, '{}'::uuid[])) requested(id) where not exists (select 1 from user_profiles participant where participant.id = requested.id and participant.tenant_id = v_actor.tenant_id and participant.department_id = v_actor.department_id and participant.working_status = 'active')))
    ) then
    raise exception 'Only manager, admin, or super_admin can create delegation tasks'
      using errcode = '42501';
  end if;
$o$,
$n$  perform assert_task_assignment_targets(p_doer_ids,p_watcher_ids);
$n$, 1);

select pg_temp.patch_0438('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)',
$o$  if task_assignment_scope() = 'branch' and not public.org_cross_location_task_active() then
    if nullif(p_payload->>'branch_id', '') is not null
       and (p_payload->>'branch_id')::uuid <> v_actor.branch_id then
      raise exception 'Managers can create tasks only in their own branch'
        using errcode = '42501';
    end if;
    v_branch := v_actor.branch_id;
  else
    v_branch := coalesce(nullif(p_payload->>'branch_id', '')::uuid, v_actor.branch_id);
  end if;
$o$,
$n$  v_branch := coalesce(nullif(p_payload->>'branch_id', '')::uuid, v_actor.branch_id);
$n$, 1);

select pg_temp.patch_0438('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)',
$o$        and (task_assignment_scope() <> 'branch' or up.branch_id = v_actor.branch_id)$o$,
$n$$n$, 1);

select pg_temp.patch_0438('public.org_begin_cross_location_task(jsonb,uuid[],uuid[])',
$o$  if a.id is null or not current_profile_is_active()
     or not has_permission('tasks.assign_cross_location') or not has_permission('tasks.assign_others') then
    return false;
  end if;
  begin v_branch := nullif(p_payload->>'branch_id', '')::uuid;
  exception when invalid_text_representation then return false; end;
  if v_branch is null or v_branch = a.branch_id or coalesce(cardinality(p_doer_ids), 0) = 0 then return false; end if;
  if not exists (select 1 from branches b where b.id = v_branch and b.tenant_id = a.tenant_id and b.is_active) then return false; end if;
  -- Only between stores the owner has mapped into franchises: before the
  -- franchise structure exists, today's local rules apply unchanged.
  if franchise_of_branch(v_branch) is null or franchise_of_branch(a.branch_id) is null then return false; end if;
  if exists (select 1 from unnest(p_doer_ids) d(id)
             where not exists (select 1 from user_profiles u where u.id = d.id and u.tenant_id = a.tenant_id and u.branch_id = v_branch)
                or not org_cross_location_recipient_eligible(d.id)) then
    return false;
  end if;
  -- Watchers stay with the author's own team or the destination store.
  if exists (select 1 from unnest(coalesce(p_watcher_ids, '{}'::uuid[])) w(id)
             where not exists (select 1 from user_profiles u where u.id = w.id and u.tenant_id = a.tenant_id
                               and (u.branch_id = v_branch or org_recipient_in_local_scope(a.id, u.id)))) then
    return false;
  end if;
$o$,
$n$  if a.id is null or not current_profile_is_active() then return false; end if;
  perform assert_task_assignment_targets(p_doer_ids,p_watcher_ids);
  begin v_branch := nullif(p_payload->>'branch_id','')::uuid;
  exception when invalid_text_representation then return false; end;
  if v_branch is null or v_branch is not distinct from a.branch_id then return false; end if;
  if coalesce(cardinality(p_doer_ids),0)=0 or exists (
    select 1 from unnest(p_doer_ids) r(id) where not exists (
      select 1 from user_profiles u where u.id=r.id and u.branch_id=v_branch and u.tenant_id=a.tenant_id)) then return false; end if;
$n$, 1);

select pg_temp.patch_0438('public.org_recipient_allowed(uuid)',
$o$(org_cross_location_task_active() and org_cross_location_recipient_eligible(p_user_id))$o$,
$n$(org_cross_location_task_active() and task_author_recipient_eligible(p_user_id))$n$, 1);

select pg_temp.patch_0438('public.assert_cross_location_lookup(jsonb)',
$o$    if not has_permission('tasks.assign_cross_location') then
      raise exception 'Assigning work to other locations is not allowed for you' using errcode = '42501';
    end if;
    perform assert_module_access('tasks');
    if not has_permission('tasks.assign_others') then raise exception 'Assigning tasks to other users is denied' using errcode = '42501'; end if;
$o$,
$n$    perform assert_module_access('tasks');
$n$, 1);

select pg_temp.patch_0438('public.search_assignment_recipients(jsonb,uuid,text,integer,integer)',
$o$and org_cross_location_recipient_eligible(u.id)$o$,
$n$and (case when p_context->>'kind'='task' then task_author_recipient_eligible(u.id) else org_cross_location_recipient_eligible(u.id) end)$n$, 1);

select pg_temp.patch_0438('public.save_task_template_with_audit(uuid,jsonb)',
$o$  if v_actor.user_role = 'manager' then$o$,
$n$  if v_actor.user_role = 'manager' and (p_template_id is not null or v_assignee_type <> 'specific_user') then$n$, 1);

select pg_temp.patch_0438('public.create_manual_task_with_mode_with_audit(jsonb,uuid[],uuid[],jsonb)',
$o$v_actor user_profiles; v_legacy_payload jsonb;$o$,
$n$v_actor user_profiles; v_legacy_payload jsonb; v_watcher uuid;$n$, 1);

select pg_temp.patch_0438('public.create_manual_task_with_mode_with_audit(jsonb,uuid[],uuid[],jsonb)',
$o$  v_legacy_payload :=$o$,
$n$  perform assert_task_assignment_targets(p_doer_ids,p_watcher_ids);
  if p_doer_ids && coalesce(p_watcher_ids,'{}') then raise exception 'A user cannot be both a watcher and a doer' using errcode='22023'; end if;
  if cardinality(p_watcher_ids) <> (select count(distinct id) from unnest(p_watcher_ids) r(id)) then raise exception 'Watcher list contains duplicates' using errcode='22023'; end if;
  v_legacy_payload :=$n$, 1);

select pg_temp.patch_0438('public.create_manual_task_with_mode_with_audit(jsonb,uuid[],uuid[],jsonb)',
$o$v_legacy_payload,p_doer_ids,p_watcher_ids,$o$,
$n$v_legacy_payload,p_doer_ids,'{}'::uuid[],$n$, 1);

select pg_temp.patch_0438('public.create_manual_task_with_mode_with_audit(jsonb,uuid[],uuid[],jsonb)',
$o$  insert into audit_logs($o$,
$n$  foreach v_watcher in array coalesce(p_watcher_ids,'{}'::uuid[]) loop
    insert into task_watchers(tenant_id,task_instance_id,user_profile_id,created_by)
    values(v_actor.tenant_id,v_task_id,v_watcher,v_actor.id);
  end loop;
  insert into audit_logs($n$, 1);

select pg_temp.patch_0438('public.create_manual_task_with_mode_with_audit(jsonb,uuid[],uuid[],jsonb)',
$o$jsonb_build_object('task_type',v_mode)$o$,
$n$jsonb_build_object('task_type',v_mode,'watcher_ids',to_jsonb(coalesce(p_watcher_ids,'{}'::uuid[])))$n$, 1);

-- In Loop owns review, while doers alone still supply evidence and complete work.
create function sync_task_in_loop_review()
returns trigger language plpgsql security definer set search_path=public as $$
declare task_id uuid := case when tg_op='DELETE' then old.task_instance_id else new.task_instance_id end;
  reviewer uuid; prior text:=current_setting('jewelos.in_loop_sync',true);
begin
  -- Serialize watcher changes with completion and review.
  perform 1 from task_instances where id=task_id for update;
  select w.user_profile_id into reviewer from task_watchers w join task_instances t on t.id=w.task_instance_id
    where w.task_instance_id=task_id
    order by (w.user_profile_id=t.verifier_user_profile_id) desc nulls last,w.created_at,w.id limit 1;
  perform set_config('jewelos.in_loop_sync',task_id::text,true);
  update task_instances set verifier_user_profile_id=reviewer,
    verification_status=case when verification_status in ('verified','rejected') then verification_status
      when reviewer is null then 'not_required' else 'pending' end
    where id=task_id and deleted_at is null;
  perform set_config('jewelos.in_loop_sync',coalesce(prior,''),true);
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger task_watchers_sync_review after insert or delete on task_watchers
  for each row execute function sync_task_in_loop_review();

-- Existing scheduled verifier columns remain compatible with installed clients.
-- Each occurrence puts that person in In Loop, including future generated work.
create function sync_task_legacy_reviewer_to_in_loop()
returns trigger language plpgsql security definer set search_path=public as $$
declare prior text:=current_setting('jewelos.in_loop_sync',true);
begin
  if prior=new.id::text or new.deleted_at is not null then return new; end if;
  if tg_op='INSERT' and current_setting('jewelos.in_loop_generation',true)=new.task_template_id::text then return new; end if;
  if tg_op='UPDATE' and old.verifier_user_profile_id is not distinct from new.verifier_user_profile_id then return new; end if;
  perform set_config('jewelos.in_loop_sync',new.id::text,true);
  if tg_op='UPDATE' and new.task_template_id is not null and old.verifier_user_profile_id is not null and new.status<>'completed' then
    delete from task_watchers where task_instance_id=new.id and user_profile_id=old.verifier_user_profile_id;
  end if;
  if new.verifier_user_profile_id is not null and not exists(select 1 from task_assignees a
      where a.task_instance_id=new.id and a.user_profile_id=new.verifier_user_profile_id and a.is_active and a.role_at_task='doer') then
    insert into task_watchers(tenant_id,task_instance_id,user_profile_id,created_by)
    values(new.tenant_id,new.id,new.verifier_user_profile_id,new.created_by) on conflict do nothing;
  end if;
  perform set_config('jewelos.in_loop_sync',coalesce(prior,''),true);
  return new;
end $$;
create trigger task_instances_sync_in_loop after insert or update of verifier_user_profile_id on task_instances
  for each row execute function sync_task_legacy_reviewer_to_in_loop();
revoke all on function sync_task_in_loop_review(),sync_task_legacy_reviewer_to_in_loop() from public,anon,authenticated,service_role;

select pg_temp.patch_0438('public.reject_watcher_task_mutation()',
$o$  if v_actor_id is not null$o$,
$n$  if tg_table_name='task_instances' and tg_op='UPDATE'
    and current_setting('jewelos.in_loop_sync',true)=v_task_id::text
    and to_jsonb(old)-array['verifier_user_profile_id','verification_status','updated_at']
      =to_jsonb(new)-array['verifier_user_profile_id','verification_status','updated_at'] then return new; end if;
  if tg_table_name='task_watchers' and current_setting('jewelos.in_loop_sync',true)=v_task_id::text then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_table_name='task_instances' and tg_op='UPDATE'
    and current_setting('jewelos.schedule_edit_id',true)=to_jsonb(new)->>'task_template_id'
    and to_jsonb(old)-array['task_type','requires_upload','buddy_assignment_allowed','due_datetime','verifier_user_profile_id','verification_status','updated_by','updated_at','delay_minutes']
      =to_jsonb(new)-array['task_type','requires_upload','buddy_assignment_allowed','due_datetime','verifier_user_profile_id','verification_status','updated_by','updated_at','delay_minutes'] then return new; end if;
  if current_setting('jewelos.task_review_id',true)=v_task_id::text then
    if tg_table_name='task_instances' and tg_op='UPDATE'
      and to_jsonb(old)-array['verification_status','verified_by','verified_at','verification_note','status','actual_datetime','completed_by','completion_mode','completion_delay_minutes','delay_minutes','on_time_status','updated_by','updated_at']
        =to_jsonb(new)-array['verification_status','verified_by','verified_at','verification_note','status','actual_datetime','completed_by','completion_mode','completion_delay_minutes','delay_minutes','on_time_status','updated_by','updated_at'] then return new; end if;
    if tg_table_name='task_assignees' and tg_op='UPDATE' and (to_jsonb(new)->>'completed_at') is null
      and to_jsonb(old)-'completed_at'=to_jsonb(new)-'completed_at' then return new; end if;
  end if;
  if tg_table_name='task_watchers' and tg_op='INSERT'
    and current_setting('jewelos.task_create_id',true)=v_task_id::text
    and to_jsonb(new)->>'created_by'=v_actor_id::text then return new; end if;
  if v_actor_id is not null$n$, 1);

select pg_temp.patch_0438('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)',
$o$  foreach v_watcher in array$o$,
$n$  perform set_config('jewelos.task_create_id',v_task.id::text,true);
  foreach v_watcher in array$n$, 1);

select pg_temp.patch_0438('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)',
$o$  insert into task_checklists($o$,
$n$  perform set_config('jewelos.task_create_id','',true);
  insert into task_checklists($n$, 1);

select pg_temp.patch_0438('public.create_manual_task_with_mode_with_audit(jsonb,uuid[],uuid[],jsonb)',
$o$  foreach v_watcher in array$o$,
$n$  perform set_config('jewelos.task_create_id',v_task_id::text,true);
  foreach v_watcher in array$n$, 1);

select pg_temp.patch_0438('public.create_manual_task_with_mode_with_audit(jsonb,uuid[],uuid[],jsonb)',
$o$  insert into audit_logs($o$,
$n$  perform set_config('jewelos.task_create_id','',true);
  insert into audit_logs($n$, 1);

do $backfill$
declare notification_definition text;
begin
  -- Historical membership is a compatibility migration, not a new assignment:
  -- keep it from producing an alert for every old verifier assignment.
  notification_definition:=pg_get_functiondef('public.emit_task_watcher_notification_event()'::regprocedure);
  execute $quiet$create or replace function public.emit_task_watcher_notification_event()
    returns trigger language plpgsql security definer set search_path=public as $body$ begin return new; end $body$;$quiet$;
  insert into task_watchers(tenant_id,task_instance_id,user_profile_id,created_by)
select t.tenant_id,t.id,t.verifier_user_profile_id,t.created_by from task_instances t
join user_profiles u on u.id=t.verifier_user_profile_id and u.tenant_id=t.tenant_id
where t.deleted_at is null and not exists(select 1 from task_assignees a where a.task_instance_id=t.id
  and a.user_profile_id=t.verifier_user_profile_id and a.is_active and a.role_at_task='doer')
on conflict do nothing;
  -- Existing open manual tasks already have watcher rows. Give those rows the
  -- same review rule without reopening completed historical work.
  update task_instances t set verifier_user_profile_id=coalesce(t.verifier_user_profile_id,reviewer.id),
    verification_status=case when t.verification_status='not_required' then 'pending' else t.verification_status end
  from (select distinct on (w.task_instance_id) w.task_instance_id,u.id
    from task_watchers w join user_profiles u on u.id=w.user_profile_id and u.tenant_id=w.tenant_id
    where u.account_status='active' and u.is_login_enabled and u.working_status='active'
    order by w.task_instance_id,w.created_at,w.id) reviewer
  where t.id=reviewer.task_instance_id and t.task_type in ('delegation','checklist')
    and t.deleted_at is null and t.status<>'completed';
  execute notification_definition;
end $backfill$;

CREATE OR REPLACE FUNCTION public.verify_recurring_task_with_audit(p_task_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor public.user_profiles; v_task public.task_instances; named_reviewer boolean; prior text:=current_setting('jewelos.task_review_id',true);
begin
  perform public.assert_module_access('tasks');
  select * into v_actor from current_profile() where auth_user_id = auth.uid();
  select * into v_task from public.task_instances where id = p_task_id for update;
  named_reviewer := v_task.verifier_user_profile_id=v_actor.id or exists(
    select 1 from task_watchers where task_instance_id=p_task_id and user_profile_id=v_actor.id);
  if not coalesce(named_reviewer,false) then perform public.org_assert_task_in_my_scope(p_task_id); end if;
  if v_actor.id is null or not public.current_profile_is_active() or v_task.id is null
    or v_task.tenant_id <> v_actor.tenant_id or v_task.deleted_at is not null or v_task.task_type not in ('delegation','checklist')
    or not (v_actor.user_role in ('super_admin','admin') or coalesce(named_reviewer,false)) then
    raise exception 'Recurring task verification denied' using errcode = '42501';
  end if;
  if v_task.status <> 'completed' or v_task.verification_status not in ('pending','rejected') then
    raise exception 'Only completed tasks awaiting verification can be reviewed' using errcode = '23514';
  end if;
  if p_decision is null or p_decision not in ('verified','rejected') then raise exception 'Verification decision is invalid' using errcode = '22023'; end if;
  if v_actor.user_role in ('super_admin','admin') and not coalesce(named_reviewer,false)
    and nullif(btrim(p_note),'') is null then raise exception 'An admin override note is required' using errcode = '22023'; end if;
  if p_decision = 'rejected' and nullif(btrim(p_note),'') is null then raise exception 'A rejection note is required' using errcode = '22023'; end if;

  perform set_config('jewelos.task_review_id',p_task_id::text,true);
  if p_decision = 'rejected' then
    -- The reference puts a rejected occurrence back in front of the doer as
    -- work still owed, so the completion is withdrawn along with the verdict.
    update public.task_instances set verification_status='rejected',verified_by=v_actor.id,verified_at=now(),
      verification_note=nullif(btrim(p_note),''),status='rejected',actual_datetime=null,
      completed_by=null,completion_mode=null,completion_delay_minutes=null,on_time_status=null,
      updated_by=v_actor.id,updated_at=now() where id=p_task_id;
    update public.task_assignees set completed_at=null where task_instance_id=p_task_id and is_active;
    insert into public.notifications(tenant_id,user_profile_id,event_type,title,message,link_url)
    select v_actor.tenant_id,a.user_profile_id,'recurring_task_rejected','Task returned for rework',
      v_task.title||' was rejected: '||btrim(p_note),'/tasks?task_id='||p_task_id::text
    from public.task_assignees a where a.task_instance_id=p_task_id and a.is_active;
  else
    update public.task_instances set verification_status='verified',verified_by=v_actor.id,verified_at=now(),
      verification_note=nullif(btrim(p_note),''),updated_by=v_actor.id,updated_at=now() where id=p_task_id;
  end if;

  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'recurring_task_'||p_decision,'recurring_todo',p_task_id,
    jsonb_build_object('verification_status',v_task.verification_status,'status',v_task.status),
    jsonb_build_object('verification_status',p_decision,'note',nullif(btrim(p_note),''),
      'admin_override',v_actor.user_role in ('super_admin','admin') and not coalesce(named_reviewer,false)));
  perform set_config('jewelos.task_review_id',coalesce(prior,''),true);
end;
$function$;

-- The existing, authorized schedule editor may also be an In Loop person.
-- Its transaction receives only a narrow schedule-metadata exception.
select pg_temp.patch_0438('public.save_recurring_todo_template_with_audit(uuid,jsonb)',
$o$v_verifier uuid; v_verification boolean;$o$,
$n$v_verifier uuid; v_verification boolean; v_prior_edit text:=current_setting('jewelos.schedule_edit_id',true);$n$);
select pg_temp.patch_0438('public.save_recurring_todo_template_with_audit(uuid,jsonb)',
$o$  v_id:=save_task_template_with_audit(p_template_id,v_base);$o$,
$n$  perform set_config('jewelos.schedule_edit_id',coalesce(p_template_id::text,''),true);
  v_id:=save_task_template_with_audit(p_template_id,v_base);
  perform set_config('jewelos.schedule_edit_id',v_id::text,true);$n$);
select pg_temp.patch_0438('public.save_recurring_todo_template_with_audit(uuid,jsonb)',
$o$  return v_id;$o$,
$n$  perform set_config('jewelos.schedule_edit_id',coalesce(v_prior_edit,''),true);
  return v_id;$n$);

-- Add scheduled reviewers after checklist and doer creation, so a reviewer
-- triggering Assign now is not mistaken for someone performing the work.
select pg_temp.patch_0438('public.create_recurring_todo_instance(uuid,date,uuid[])',
$o$declare
$o$,
$n$declare
  v_in_loop_prior text:=current_setting('jewelos.in_loop_generation',true);
$n$);
select pg_temp.patch_0438('public.create_recurring_todo_instance(uuid,date,uuid[])',
$o$  insert into task_instances($o$,
$n$  perform set_config('jewelos.in_loop_generation',v_template.id::text,true);
  insert into task_instances($n$);
select pg_temp.patch_0438('public.create_recurring_todo_instance(uuid,date,uuid[])',
$o$  return v_task.id;$o$,
$n$  perform set_config('jewelos.in_loop_generation',coalesce(v_in_loop_prior,''),true);
  if v_task.verifier_user_profile_id is not null and not exists(select 1 from task_assignees a
    where a.task_instance_id=v_task.id and a.user_profile_id=v_task.verifier_user_profile_id and a.is_active and a.role_at_task='doer') then
    insert into task_watchers(tenant_id,task_instance_id,user_profile_id,created_by)
    values(v_task.tenant_id,v_task.id,v_task.verifier_user_profile_id,v_task.created_by) on conflict do nothing;
  end if;
  return v_task.id;$n$);
select pg_temp.patch_0438('public.start_on_demand_task_with_audit(uuid)',
$o$declare
$o$,
$n$declare
  v_in_loop_prior text:=current_setting('jewelos.in_loop_generation',true);
$n$);
select pg_temp.patch_0438('public.start_on_demand_task_with_audit(uuid)',
$o$  insert into task_instances($o$,
$n$  perform set_config('jewelos.in_loop_generation',v_template.id::text,true);
  insert into task_instances($n$);
select pg_temp.patch_0438('public.start_on_demand_task_with_audit(uuid)',
$o$  return v_task.id;$o$,
$n$  perform set_config('jewelos.in_loop_generation',coalesce(v_in_loop_prior,''),true);
  if v_task.verifier_user_profile_id is not null and not exists(select 1 from task_assignees a
    where a.task_instance_id=v_task.id and a.user_profile_id=v_task.verifier_user_profile_id and a.is_active and a.role_at_task='doer') then
    insert into task_watchers(tenant_id,task_instance_id,user_profile_id,created_by)
    values(v_task.tenant_id,v_task.id,v_task.verifier_user_profile_id,v_task.created_by) on conflict do nothing;
  end if;
  return v_task.id;$n$);

-- Pending In Loop reviews remain actionable after the doer completes work.
-- Date filters and every other subsection retain their existing meaning.
select pg_temp.patch_0438('public.task_workspace_page(jsonb,integer,integer)',
$o$case when status='completed' then 'completed' when status='overdue'$o$,
$n$case when status='completed' and watched and not assigned and exists (
  select 1 from task_instances review_task where review_task.id=t.id
    and review_task.verification_status in ('pending','rejected')) then 'pending'
  when status='completed' then 'completed' when status='overdue'$n$,1);

notify pgrst, 'reload schema';
