-- Recurring / To-Do parity with the authoritative Google Apps Script rules.
--
-- Five corrections, all inside the existing contracts:
--
-- 1. Weekly off creates no task instance at all. Authorized leave still routes
--    to the profile buddy chain; a weekly off is not work that moved, it is
--    work that does not exist for that date.
-- 2. `create_recurring_todo_instance` records coverage again. The 0085 rewrite
--    dropped the coverage columns, the buddy_assignments row, the manager
--    notification and the coverage audit trail that 0084 wrote, which left the
--    Coverage Required and Manager Review queues permanently empty.
-- 3. Completion records who completed the work, whether it was completed on
--    behalf of the doer (which now demands a remark) and whether it landed on
--    time against the effective deadline.
-- 4. A rejected verification returns the occurrence to the doer to redo,
--    exactly as the reference `REJECTED` status does.
-- 5. The workspace read contract filters on status, branch, department,
--    priority and schedule kind again, not only on search text and dates.

set search_path = public, extensions;

-- 1. Completion bookkeeping columns ------------------------------------------

alter table public.task_instances
  add column if not exists completed_by uuid references public.user_profiles(id),
  add column if not exists completion_mode text,
  add column if not exists completion_delay_minutes integer,
  add column if not exists on_time_status text;

alter table public.task_instances drop constraint if exists task_instances_completion_mode_check;
alter table public.task_instances add constraint task_instances_completion_mode_check
  check (completion_mode is null or completion_mode in ('own','on_behalf'));
alter table public.task_instances drop constraint if exists task_instances_on_time_status_check;
alter table public.task_instances add constraint task_instances_on_time_status_check
  check (on_time_status is null or on_time_status in ('on_time','delayed'));

-- 2. Weekly off is not availability -------------------------------------------
--
-- `is_user_available_for_task` deliberately folds a weekly off into general
-- unavailability so short-deadline coverage can still react to it. Generation
-- needs the narrower question on its own.

create or replace function public.is_user_week_off_on_date(p_user_profile_id uuid, p_target_date date)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1
    from public.user_profiles up, unnest(up.week_off) day_name
    where up.id = p_user_profile_id
      and lower(btrim(day_name)) = lower(btrim(to_char(p_target_date, 'Day')))
  );
$$;

-- 3. Generation: skip weekly offs, restore the coverage trail -----------------

create or replace function public.create_recurring_todo_instance(
  p_template_id uuid, p_target_date date, p_original_assignee_ids uuid[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_template task_templates; v_task task_instances; v_original_id uuid; v_resolution record;
  v_item jsonb; v_doers uuid[] := array[]::uuid[];
  v_uncovered boolean := false; v_first_uncovered uuid; v_manager uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' and not exists(
    select 1 from user_profiles u where u.auth_user_id = auth.uid()
      and u.account_status = 'active' and u.is_login_enabled
      and u.user_role in ('super_admin','admin','manager')
  ) then raise exception 'Recurring task creation denied' using errcode = '42501'; end if;
  if p_target_date is null or coalesce(array_length(p_original_assignee_ids,1),0) = 0 then
    raise exception 'Target date and original assignees are required' using errcode = '22023';
  end if;
  select * into v_template from task_templates where id = p_template_id
    and (is_active or schedule_kind = 'as_required') and task_type in ('checklist','delegation') for update;
  if v_template.id is null then raise exception 'Template not found' using errcode = '22023'; end if;
  if exists(select 1 from task_instances where task_template_id = p_template_id and scheduled_date = p_target_date) then
    return null;
  end if;

  -- Keep only doers this template actually addresses, and never on their
  -- weekly off. A template whose every doer is off produces no occurrence.
  foreach v_original_id in array p_original_assignee_ids loop
    if exists(
      select 1 from user_profiles u where u.id = v_original_id and u.tenant_id = v_template.tenant_id
        and (v_template.branch_id is null or u.branch_id = v_template.branch_id)
        and (v_template.department_id is null or u.department_id = v_template.department_id)
        and ((v_template.default_assignee_type = 'specific_user' and u.id = v_template.default_assignee_user_id)
          or (v_template.default_assignee_type = 'role' and u.user_role = v_template.default_assignee_role))
    ) and not is_user_week_off_on_date(v_original_id, p_target_date) then
      v_doers := array_append(v_doers, v_original_id);
    end if;
  end loop;
  if cardinality(v_doers) = 0 then
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
    values(v_template.tenant_id,null,'recurring_task_skipped','tasks',p_template_id,
      jsonb_build_object('scheduled_date',p_target_date,'reason','weekly_off_or_out_of_scope'));
    return null;
  end if;

  insert into task_instances(tenant_id,branch_id,department_id,category_id,task_template_id,task_type,title,
    description,priority,status,planned_datetime,scheduled_date,requires_upload,requires_remark,requires_form,
    form_template_id,source,created_by,buddy_assignment_allowed)
  values(v_template.tenant_id,v_template.branch_id,v_template.department_id,v_template.category_id,v_template.id,
    v_template.task_type,v_template.title,v_template.description,v_template.priority,'pending',
    (p_target_date::text||' '||coalesce(v_template.planned_time,'23:59'::time)::text||' Asia/Kolkata')::timestamptz,
    p_target_date,v_template.task_type = 'delegation',v_template.requires_remark,v_template.requires_form,
    v_template.form_template_id,'checklist',coalesce(v_template.created_by,v_template.updated_by,v_doers[1]),
    v_template.buddy_assignment_allowed)
  returning * into v_task;

  if v_template.task_type = 'checklist' then
    for v_item in select value from jsonb_array_elements(v_template.checklist_items) loop
      insert into task_checklists(task_instance_id,item_text,is_required,sort_order)
      values(v_task.id,v_item->>'item_text',coalesce((v_item->>'is_required')::boolean,true),
        coalesce((v_item->>'sort_order')::integer,0));
    end loop;
  end if;

  foreach v_original_id in array v_doers loop
    if not v_template.buddy_assignment_allowed then
      insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
      values(v_task.id,v_original_id,'doer',true,true) on conflict do nothing;
      continue;
    end if;
    select * into v_resolution from resolve_task_coverage(v_original_id,p_target_date);
    if v_resolution.effective_assignee_id is null then
      v_uncovered := true; v_first_uncovered := coalesce(v_first_uncovered,v_original_id);
      insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
      values(v_task.id,v_original_id,'doer',true,false) on conflict do nothing;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(v_template.tenant_id,null,'coverage_required','tasks',v_task.id,
        jsonb_build_object('original_assignee_id',v_original_id,'date',p_target_date));
    else
      insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
      values(v_task.id,v_resolution.effective_assignee_id,'doer',v_resolution.resolution = 'original',true)
      on conflict do nothing;
      if v_resolution.resolution <> 'original' then
        insert into buddy_assignments(tenant_id,original_assignee_id,buddy_id,task_instance_id,date,escalated_to_manager)
        values(v_template.tenant_id,v_original_id,v_resolution.effective_assignee_id,v_task.id,p_target_date,
          v_resolution.resolution = 'reporting_manager');
        update task_instances set coverage_status='covered',coverage_original_assignee_id=v_original_id,
          coverage_resolution=v_resolution.resolution,coverage_resolved_for_date=p_target_date where id=v_task.id;
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
      -- `converge_legacy_notification_insert` drops direct `task_coverage_required`
      -- rows, so this class has to reach the recipient through the rules engine.
      perform enqueue_notification_event(v_template.tenant_id,v_template.branch_id,v_template.department_id,
        'task_coverage_required','tasks',v_task.id,null,
        jsonb_build_object('_assigned_user_ids',jsonb_build_array(v_manager),
          '_link_url','/recurring-todo','alert_title','Task needs coverage',
          'alert_message',v_template.title||' has no available buddy for '||p_target_date::text),
        'task_coverage_required:'||v_task.id||':'||v_manager);
    end if;
  end if;

  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_template.tenant_id,null,'recurring_task_generated','tasks',v_task.id,
    jsonb_build_object('template_id',p_template_id,'scheduled_date',p_target_date,'coverage_required',v_uncovered));
  return v_task.id;
exception when unique_violation then return null;
end;
$$;

-- 4. Completion: on-behalf remark, completion identity, on-time outcome -------

create or replace function public.update_task_with_audit(
  p_task_id uuid,
  p_action text,
  p_checklist_id uuid default null,
  p_completed boolean default null,
  p_remark text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor user_profiles;
  v_old task_instances;
  v_new task_instances;
  v_linked_module text;
  v_own boolean;
  v_due timestamptz;
  v_delay integer;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  select * into v_old from task_instances where id = p_task_id for update;
  v_own := exists (
    select 1 from task_assignees
    where task_instance_id = p_task_id and user_profile_id = v_actor.id
      and role_at_task = 'doer' and is_active
  );
  if v_actor.id is null or not current_profile_is_active() or v_old.id is null
     or v_old.tenant_id <> v_actor.tenant_id
     or not (v_actor.user_role in ('super_admin','admin','manager') or v_own) then
    raise exception 'Task is not accessible to an active doer' using errcode = '42501';
  end if;

  if p_action = 'start' then
    if v_old.status <> 'pending' then
      raise exception 'Only pending tasks can be started' using errcode = '22023';
    end if;
    update task_instances
    set status = 'in_progress', updated_by = v_actor.id, updated_at = now()
    where id = p_task_id
    returning * into v_new;
  elsif p_action = 'checklist' then
    if p_checklist_id is null or p_completed is null
       or v_old.status not in ('pending','in_progress','rejected') then
      raise exception 'Checklist update is invalid for this task state' using errcode = '22023';
    end if;
    update task_checklists
    set is_completed = p_completed,
        completed_by = case when p_completed then v_actor.id else null end,
        completed_at = case when p_completed then now() else null end
    where id = p_checklist_id and task_instance_id = p_task_id;
    if not found then
      raise exception 'Checklist item not found' using errcode = '22023';
    end if;
    if v_old.status in ('pending','rejected') and p_completed then
      update task_instances
      set status = 'in_progress', updated_by = v_actor.id, updated_at = now()
      where id = p_task_id;
    end if;
    select * into v_new from task_instances where id = p_task_id;
  elsif p_action = 'complete' then
    if v_old.status in ('completed','blocked') then
      raise exception 'Completed or coverage-blocked tasks cannot be completed' using errcode = '22023';
    end if;
    if exists (
      select 1 from task_checklists
      where task_instance_id = p_task_id and is_required and not is_completed
    ) then
      raise exception 'Complete all required checklist items first' using errcode = '23514';
    end if;
    if v_old.requires_upload and not exists (
      select 1 from task_attachments where task_instance_id = p_task_id
    ) then
      raise exception 'A required upload is missing' using errcode = '23514';
    end if;
    v_linked_module := case v_old.task_type
      when 'checklist' then 'checklist_task'
      when 'delegation' then 'delegation_task'
      else null
    end;
    if v_old.requires_form and (
      v_old.form_template_id is null or v_linked_module is null or not exists (
        select 1 from form_submissions fs
        where fs.tenant_id = v_old.tenant_id
          and fs.linked_record_id = p_task_id
          and fs.linked_module = v_linked_module
          and fs.form_template_id = v_old.form_template_id
      )
    ) then
      raise exception 'The required task form submission is missing' using errcode = '23514';
    end if;
    if v_old.requires_remark and nullif(btrim(p_remark),'') is null then
      raise exception 'A completion remark is required' using errcode = '23514';
    end if;
    -- Completing someone else's work is an exception that has to be explained,
    -- exactly as the reference demands for an on-behalf completion.
    if not v_own and nullif(btrim(p_remark),'') is null then
      raise exception 'A remark is required when completing a task on behalf of the doer'
        using errcode = '23514';
    end if;
    v_due := task_effective_due_datetime(v_old);
    v_delay := greatest(0, (round(extract(epoch from (now() - v_due)) / 60))::integer);
    update task_instances
    set status = 'completed', actual_datetime = now(),
        completion_remark = nullif(btrim(p_remark),''),
        completed_by = v_actor.id,
        completion_mode = case when v_own then 'own' else 'on_behalf' end,
        completion_delay_minutes = v_delay,
        on_time_status = case when v_delay > 0 then 'delayed' else 'on_time' end,
        -- A redone occurrence goes back in front of its verifier.
        verification_status = case when verification_status = 'not_required'
          then verification_status else 'pending' end,
        verified_by = case when verification_status = 'not_required' then verified_by else null end,
        verified_at = case when verification_status = 'not_required' then verified_at else null end,
        updated_by = v_actor.id, updated_at = now()
    where id = p_task_id
    returning * into v_new;
    update task_assignees
    set completed_at = now()
    where task_instance_id = p_task_id and role_at_task = 'doer' and is_active;
  else
    raise exception 'Unsupported task action' using errcode = '22023';
  end if;

  insert into audit_logs(
    tenant_id, actor_user_id, action, module, record_id, old_value, new_value
  ) values (
    v_actor.tenant_id, v_actor.id,
    case when p_action = 'complete' and not v_own then 'task_complete_on_behalf' else 'task_' || p_action end,
    'tasks', p_task_id, to_jsonb(v_old), to_jsonb(v_new)
  );
end;
$$;

-- 5. Rejection returns the occurrence to the doer -----------------------------

create or replace function public.verify_recurring_task_with_audit(p_task_id uuid,p_decision text,p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor public.user_profiles; v_task public.task_instances;
begin
  select * into v_actor from public.user_profiles where auth_user_id = auth.uid();
  select * into v_task from public.task_instances where id = p_task_id for update;
  if v_actor.id is null or not public.current_profile_is_active() or v_task.id is null
    or v_task.tenant_id <> v_actor.tenant_id or v_task.task_template_id is null
    or not (v_actor.user_role in ('super_admin','admin') or v_task.verifier_user_profile_id = v_actor.id) then
    raise exception 'Recurring task verification denied' using errcode = '42501';
  end if;
  if v_task.status <> 'completed' or v_task.verification_status not in ('pending','rejected') then
    raise exception 'Only completed tasks awaiting verification can be reviewed' using errcode = '23514';
  end if;
  if p_decision not in ('verified','rejected') then raise exception 'Verification decision is invalid' using errcode = '22023'; end if;
  if v_actor.user_role in ('super_admin','admin') and v_task.verifier_user_profile_id is distinct from v_actor.id
    and nullif(btrim(p_note),'') is null then raise exception 'An admin override note is required' using errcode = '22023'; end if;
  if p_decision = 'rejected' and nullif(btrim(p_note),'') is null then raise exception 'A rejection note is required' using errcode = '22023'; end if;

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
      v_task.title||' was rejected: '||btrim(p_note),'/recurring-todo'
    from public.task_assignees a where a.task_instance_id=p_task_id and a.is_active;
  else
    update public.task_instances set verification_status='verified',verified_by=v_actor.id,verified_at=now(),
      verification_note=nullif(btrim(p_note),''),updated_by=v_actor.id,updated_at=now() where id=p_task_id;
  end if;

  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'recurring_task_'||p_decision,'recurring_todo',p_task_id,
    jsonb_build_object('verification_status',v_task.verification_status,'status',v_task.status),
    jsonb_build_object('verification_status',p_decision,'note',nullif(btrim(p_note),''),
      'admin_override',v_actor.user_role in ('super_admin','admin') and v_task.verifier_user_profile_id is distinct from v_actor.id));
end;
$$;

-- 6. Workspace read contract: the reference filter set ------------------------

create or replace function public.get_recurring_todo_workspace(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_actor public.user_profiles; v_from date; v_to date; v_search text;
  v_status text; v_priority text; v_branch uuid; v_department uuid; v_kind text;
  v_templates jsonb; v_instances jsonb; v_stats jsonb;
begin
  select * into v_actor from public.user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or not public.current_profile_is_active() or v_actor.user_role not in ('super_admin','admin') then
    raise exception 'Recurring workspace access denied' using errcode = '42501';
  end if;
  v_from := coalesce(nullif(p_filter->>'date_from','')::date,(now() at time zone 'Asia/Kolkata')::date-7);
  v_to := coalesce(nullif(p_filter->>'date_to','')::date,(now() at time zone 'Asia/Kolkata')::date+30);
  v_search := lower(btrim(coalesce(p_filter->>'search','')));
  v_status := nullif(p_filter->>'status','');
  v_priority := nullif(p_filter->>'priority','');
  v_branch := nullif(p_filter->>'branch_id','')::uuid;
  v_department := nullif(p_filter->>'department_id','')::uuid;
  v_kind := nullif(p_filter->>'schedule_kind','');
  if v_status is not null and v_status not in ('pending','in_progress','in_review','completed','rejected','blocked','overdue') then
    raise exception 'Status filter is invalid' using errcode = '22023';
  end if;
  if v_priority is not null and v_priority not in ('high','medium','low') then
    raise exception 'Priority filter is invalid' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.title),'[]'::jsonb) into v_templates
  from public.task_templates t
  where t.tenant_id = v_actor.tenant_id and t.task_type in ('checklist','delegation')
    and t.recurrence_rule is not null
    and (v_search = '' or lower(t.title||' '||coalesce(t.description,'')) like '%'||v_search||'%')
    and (v_branch is null or t.branch_id = v_branch)
    and (v_department is null or t.department_id = v_department)
    and (v_priority is null or t.priority::text = v_priority)
    and (v_kind is null or t.schedule_kind = v_kind);

  with visible as (
    select ti.* from public.task_instances ti
    where ti.tenant_id = v_actor.tenant_id and ti.task_template_id is not null
      and (ti.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to
      and (v_search = '' or lower(ti.title||' '||coalesce(ti.description,'')) like '%'||v_search||'%')
      and (v_branch is null or ti.branch_id = v_branch)
      and (v_department is null or ti.department_id = v_department)
      and (v_priority is null or ti.priority::text = v_priority)
      and (v_status is null or ti.status::text = v_status)
      and (v_kind is null or exists(
        select 1 from public.task_templates t where t.id = ti.task_template_id and t.schedule_kind = v_kind))
  )
  select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object(
    'assignees',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name,'is_original',a.is_original)),'[]'::jsonb)
      from public.task_assignees a join public.user_profiles u on u.id = a.user_profile_id
      where a.task_instance_id = v.id and a.is_active),
    'checklist',(select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order),'[]'::jsonb)
      from public.task_checklists c where c.task_instance_id = v.id),
    'has_attachment',exists(select 1 from public.task_attachments a where a.task_instance_id = v.id),
    'has_form_submission',exists(select 1 from public.form_submissions s
      where s.linked_record_id = v.id and s.form_template_id = v.form_template_id),
    -- The reference keeps a follow-up log beside the task; `send_recurring_followup_with_audit`
    -- already writes one comment per reminder, so the workspace returns that thread.
    'followups',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',f.id,'comment',f.comment,'created_at',f.created_at,'author',fu.employee_name)
      order by f.created_at desc),'[]'::jsonb)
      from public.task_comments f join public.user_profiles fu on fu.id = f.user_profile_id
      where f.task_instance_id = v.id)
  ) order by public.task_effective_due_datetime(v)),'[]'::jsonb) into v_instances from visible v;

  select jsonb_build_object(
    'total',count(*),'pending',count(*) filter(where status='pending'),
    'in_progress',count(*) filter(where status='in_progress'),
    'completed',count(*) filter(where status='completed'),
    'rejected',count(*) filter(where status='rejected'),
    'overdue',count(*) filter(where status not in ('completed','rejected')
      and public.task_effective_due_datetime(ti) < now()),
    'on_time',count(*) filter(where on_time_status='on_time'),
    'delayed',count(*) filter(where on_time_status='delayed'),
    'completed_on_behalf',count(*) filter(where completion_mode='on_behalf'),
    'coverage_required',count(*) filter(where coverage_status='coverage_required'),
    'manager_review',count(*) filter(where coverage_status='manager_review')) into v_stats
  from public.task_instances ti
  where ti.tenant_id = v_actor.tenant_id and ti.task_template_id is not null
    and (ti.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to
    and (v_branch is null or ti.branch_id = v_branch)
    and (v_department is null or ti.department_id = v_department)
    and (v_priority is null or ti.priority::text = v_priority);

  return jsonb_build_object('filters',jsonb_build_object('date_from',v_from,'date_to',v_to),
    'templates',v_templates,'instances',v_instances,'stats',v_stats);
end;
$$;

-- 7. The schedule editor can name a verifier ----------------------------------
--
-- `save_task_template_with_audit` keeps its strict field allowlist, so the
-- recurring wrapper strips `verifier_user_profile_id` before delegating and
-- applies it itself, exactly as it already does for `due_time`. Toggling
-- verification now also re-states the requirement on every open occurrence of
-- the schedule, not only the one dated on its start date.

create or replace function public.save_recurring_todo_template_with_audit(p_template_id uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_actor user_profiles; v_old task_templates; v_new task_templates;
  v_base jsonb; v_kind text; v_starts_on date; v_task_type task_type; v_due_time time;
  v_verifier uuid; v_verification boolean;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then
    raise exception 'Recurring schedule management denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_payload)<>'object' then raise exception 'Recurring schedule payload is invalid' using errcode='22023'; end if;
  v_task_type:=coalesce(nullif(p_payload->>'task_type','')::task_type,'checklist');
  if v_task_type not in ('checklist','delegation') then raise exception 'Recurring task type is unsupported' using errcode='22023'; end if;
  v_kind:=coalesce(nullif(p_payload->>'schedule_kind',''),'recurring');
  if v_kind not in ('recurring','daily','weekly','monthly','nth_weekday','quarterly','yearly','one_time','as_required') then raise exception 'Schedule kind is unsupported' using errcode='22023'; end if;
  v_starts_on:=coalesce(nullif(p_payload->>'starts_on','')::date,case when p_template_id is null then (now() at time zone 'Asia/Kolkata')::date else null end);
  if p_template_id is not null then
    select * into v_old from task_templates where id=p_template_id for update;
    if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id or (v_actor.user_role='manager' and v_old.branch_id is distinct from v_actor.branch_id) then raise exception 'Recurring schedule not found' using errcode='42501'; end if;
    -- task_templates_due_after_start compares the stored due time against the
    -- incoming start time, so shifting a schedule later in one save would trip
    -- it inside the delegate. Release the deadline here and restore it below
    -- once the new start time is in place.
    update task_templates set task_type='checklist', due_time=null where id=p_template_id;
  end if;
  v_due_time:=case when p_payload ? 'due_time' then nullif(p_payload->>'due_time','')::time else v_old.due_time end;
  v_verification:=coalesce((p_payload->>'verification_required')::boolean,false);
  v_verifier:=case when p_payload ? 'verifier_user_profile_id'
    then nullif(p_payload->>'verifier_user_profile_id','')::uuid else v_old.verifier_user_profile_id end;
  if not v_verification then v_verifier:=null; end if;
  if v_verifier is not null and not exists(
    select 1 from user_profiles u where u.id=v_verifier and u.tenant_id=v_actor.tenant_id
      and u.account_status='active' and u.is_login_enabled
  ) then raise exception 'Verifier is invalid or inactive' using errcode='23503'; end if;
  v_base:=p_payload-array['schedule_kind','starts_on','verification_required','followup_enabled',
    'personal_performance_enabled','task_type','buddy_assignment_allowed','due_time','verifier_user_profile_id'];
  v_base:=v_base||jsonb_build_object('requires_upload',v_task_type='delegation','checklist_items',case when v_task_type='delegation' then '[]'::jsonb else coalesce(p_payload->'checklist_items','[]'::jsonb) end);
  if v_kind='as_required' then
    v_base:=v_base||jsonb_build_object('is_active',false);
  elsif p_template_id is null then
    v_base:=v_base||jsonb_build_object('initial_planned_datetime',(v_starts_on::text||' '||coalesce(nullif(p_payload->>'planned_time',''),'09:00')||' Asia/Kolkata')::timestamptz);
  end if;
  v_id:=save_task_template_with_audit(p_template_id,v_base);
  update task_templates set task_type=v_task_type, buddy_assignment_allowed=coalesce((p_payload->>'buddy_assignment_allowed')::boolean,true),
    requires_upload=(v_task_type='delegation'), checklist_items=case when v_task_type='delegation' then '[]'::jsonb else checklist_items end,
    schedule_kind=v_kind,starts_on=coalesce(v_starts_on,starts_on),verification_required=v_verification,
    verifier_user_profile_id=v_verifier,
    followup_enabled=coalesce((p_payload->>'followup_enabled')::boolean,false),personal_performance_enabled=coalesce((p_payload->>'personal_performance_enabled')::boolean,true),
    due_time=v_due_time,
    updated_by=v_actor.id,updated_at=now() where id=v_id returning * into v_new;
  update task_instances set task_type=v_task_type,requires_upload=(v_task_type='delegation'),buddy_assignment_allowed=v_new.buddy_assignment_allowed,
    due_datetime=case when v_new.due_time is null then due_datetime
      else (coalesce(scheduled_date,(planned_datetime at time zone 'Asia/Kolkata')::date)::text||' '||v_new.due_time::text||' Asia/Kolkata')::timestamptz end,
    updated_by=v_actor.id,updated_at=now() where task_template_id=v_id and status='pending'
    and (planned_datetime at time zone 'Asia/Kolkata')::date=coalesce(v_starts_on,v_new.starts_on);
  -- Every occurrence still open carries the schedule's current review rule.
  update task_instances set verifier_user_profile_id=v_verifier,
    verification_status=case when v_new.verification_required then 'pending' else 'not_required' end,
    updated_by=v_actor.id,updated_at=now()
    where task_template_id=v_id and status in ('pending','in_progress','rejected');
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values
    (v_actor.tenant_id,v_actor.id,case when p_template_id is null then 'recurring_todo_created' else 'recurring_todo_updated' end,'recurring_todo',v_id,
     case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
  return v_id;
end;
$$;

-- 8. Grants -------------------------------------------------------------------

revoke all on function public.is_user_week_off_on_date(uuid,date) from public,anon;
grant execute on function public.is_user_week_off_on_date(uuid,date) to authenticated,service_role;
revoke all on function public.create_recurring_todo_instance(uuid,date,uuid[]) from public,anon,authenticated;
grant execute on function public.create_recurring_todo_instance(uuid,date,uuid[]) to service_role;
revoke all on function public.update_task_with_audit(uuid,text,uuid,boolean,text) from public,anon;
grant execute on function public.update_task_with_audit(uuid,text,uuid,boolean,text) to authenticated;
revoke all on function public.verify_recurring_task_with_audit(uuid,text,text) from public,anon;
grant execute on function public.verify_recurring_task_with_audit(uuid,text,text) to authenticated;
revoke all on function public.get_recurring_todo_workspace(jsonb) from public,anon;
grant execute on function public.get_recurring_todo_workspace(jsonb) to authenticated;
revoke all on function public.save_recurring_todo_template_with_audit(uuid,jsonb) from public,anon;
grant execute on function public.save_recurring_todo_template_with_audit(uuid,jsonb) to authenticated;

notify pgrst,'reload schema';
