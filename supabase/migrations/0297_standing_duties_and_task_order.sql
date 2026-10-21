-- Standing duties and deadline-first task order
-- (design: docs/superpowers/specs/2026-10-21-standing-duties-design.md).
--
-- 1. An employee's as-needed duties are standing, low-priority work they may do
--    whenever they like: a self-started occurrence is low priority and due at
--    the end of today. A manager or admin who enforces one with Assign now
--    creates a high-priority occurrence with the duty's due time.
-- 2. The duty list tells the employee what they finished today and which
--    occurrence is still open, so Start continues it instead of duplicating it.
-- 3. Tasks lists put the earliest deadline first and break ties by priority.
--    Completed work keeps newest first.
set search_path=public,extensions;

-- 1. Start (employee) or enforce (manager/admin) one occurrence --------------------

create or replace function public.start_on_demand_task_with_audit(p_template_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_actor user_profiles:=current_profile();
  v_template task_templates; v_task task_instances; v_item jsonb;
  v_assignees uuid[]; v_doers uuid[]; v_self boolean; v_priority task_priority;
  v_today date:=(now() at time zone 'Asia/Kolkata')::date; v_due timestamptz;
  v_end_of_day timestamptz;
begin
  perform assert_module_enabled('checklist_tasks');
  if v_actor.id is null or not current_profile_is_active() then
    raise exception 'On-demand duty is unavailable' using errcode='42501';
  end if;
  select * into v_template from task_templates where id=p_template_id for update;
  if v_template.id is null or v_template.tenant_id<>v_actor.tenant_id or v_template.deleted_at is not null
     or v_template.task_type not in ('checklist','delegation') then
    raise exception 'On-demand duty is unavailable' using errcode='42501';
  end if;
  if v_template.schedule_kind<>'as_required' then
    raise exception 'Only as-required schedules can be started on demand' using errcode='22023';
  end if;
  if v_template.assignment_status is distinct from 'assigned' then
    raise exception 'Assign this duty to an employee first' using errcode='23514';
  end if;

  select coalesce(array_agg(u.id),array[]::uuid[]) into v_assignees from user_profiles u
    where u.tenant_id=v_template.tenant_id and u.account_status='active' and u.is_login_enabled
      and (v_template.branch_id is null or u.branch_id=v_template.branch_id)
      and (v_template.department_id is null or u.department_id=v_template.department_id)
      and ((v_template.default_assignee_type='specific_user' and u.id=v_template.default_assignee_user_id)
        or (v_template.default_assignee_type='role' and u.user_role=v_template.default_assignee_role));
  v_self:=v_actor.id=any(v_assignees);
  if v_self then
    v_doers:=array[v_actor.id];
  else
    if v_actor.user_role not in ('super_admin','admin','manager')
       or (v_actor.user_role='manager' and v_template.branch_id is distinct from v_actor.branch_id) then
      raise exception 'On-demand duty is unavailable' using errcode='42501';
    end if;
    v_doers:=v_assignees;
  end if;
  if cardinality(v_doers)=0 then raise exception 'No eligible duty assignee' using errcode='23514'; end if;
  perform assert_task_assignment_rule('specific_user',doer.id) from unnest(v_doers) doer(id);

  if (select count(*) from task_instances i where i.task_template_id=v_template.id and i.on_demand
      and i.scheduled_date=v_today and i.deleted_at is null)>=50 then
    raise exception 'This duty already has 50 occurrences today' using errcode='23514';
  end if;

  v_end_of_day:=greatest(((v_today::text||' 23:59')::timestamp at time zone 'Asia/Kolkata'),now()+interval '5 minutes');
  if v_self then
    -- Standing work the employee chose to do: no pressure before the day ends.
    v_priority:='low';
    v_due:=v_end_of_day;
  else
    -- Enforced by a manager or admin: it moves up the employee's list.
    v_priority:='high';
    v_due:=((v_today::text||' '||coalesce(v_template.due_time,v_template.planned_time,'20:00'::time)::text)::timestamp
      at time zone 'Asia/Kolkata');
    if v_due<now()+interval '30 minutes' then v_due:=v_end_of_day; end if;
  end if;

  insert into task_instances(tenant_id,branch_id,department_id,category_id,task_template_id,task_type,title,
    description,priority,status,planned_datetime,due_datetime,scheduled_date,requires_upload,requires_remark,
    requires_form,form_template_id,source,created_by,buddy_assignment_allowed,on_demand)
  values(v_template.tenant_id,v_template.branch_id,v_template.department_id,v_template.category_id,v_template.id,
    v_template.task_type,v_template.title,v_template.description,v_priority,'pending',now(),v_due,v_today,
    v_template.task_type='delegation',v_template.requires_remark,v_template.requires_form,v_template.form_template_id,
    'checklist',v_actor.id,v_template.buddy_assignment_allowed,true)
  returning * into v_task;

  if v_template.task_type='checklist' then
    for v_item in select value from jsonb_array_elements(v_template.checklist_items) loop
      insert into task_checklists(task_instance_id,item_text,is_required,sort_order)
      values(v_task.id,v_item->>'item_text',coalesce((v_item->>'is_required')::boolean,true),
        coalesce((v_item->>'sort_order')::integer,0));
    end loop;
  end if;
  insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
  select v_task.id,doer.id,'doer',true,true from unnest(v_doers) doer(id) on conflict do nothing;

  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'task_on_demand_started','tasks',v_task.id,
    jsonb_build_object('template_id',v_template.id,'mode',case when v_self then 'self' else 'assigned' end,
      'doer_ids',to_jsonb(v_doers),'due_datetime',v_due,'priority',v_priority));
  return v_task.id;
end;
$$;

-- 2. The caller's own standing duties -------------------------------------------------

create or replace function public.get_my_on_demand_duties()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles:=current_profile(); v_today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
  perform assert_module_enabled('checklist_tasks');
  if v_actor.id is null or not current_profile_is_active() then
    raise exception 'On-demand duties are unavailable' using errcode='42501';
  end if;
  return jsonb_build_object('duties',coalesce((
    select jsonb_agg(jsonb_build_object(
      'template_id',t.id,'title',t.title,'description',t.description,'trigger_label',t.trigger_label,
      'task_type',t.task_type,'priority',t.priority,'due_time',t.due_time,'requires_upload',t.requires_upload,
      'started_today',(select count(*) from task_instances i join task_assignees a on a.task_instance_id=i.id
        and a.user_profile_id=v_actor.id and a.role_at_task='doer'
        where i.task_template_id=t.id and i.on_demand and i.scheduled_date=v_today and i.deleted_at is null),
      'completed_today',(select count(*) from task_instances i join task_assignees a on a.task_instance_id=i.id
        and a.user_profile_id=v_actor.id and a.role_at_task='doer'
        where i.task_template_id=t.id and i.on_demand and i.status='completed' and i.deleted_at is null
          and (i.actual_datetime at time zone 'Asia/Kolkata')::date=v_today),
      'open_count',(select count(*) from task_instances i join task_assignees a on a.task_instance_id=i.id
        and a.user_profile_id=v_actor.id and a.role_at_task='doer' and a.is_active
        where i.task_template_id=t.id and i.on_demand and i.status not in ('completed','rejected') and i.deleted_at is null),
      'open_task_id',(select i.id from task_instances i join task_assignees a on a.task_instance_id=i.id
        and a.user_profile_id=v_actor.id and a.role_at_task='doer' and a.is_active
        where i.task_template_id=t.id and i.on_demand and i.status not in ('completed','rejected') and i.deleted_at is null
        order by i.priority='high' desc,i.due_datetime,i.id limit 1)
    ) order by t.title,t.id)
    from (select * from task_templates t
      where t.tenant_id=v_actor.tenant_id and t.deleted_at is null and t.schedule_kind='as_required'
        and t.assignment_status='assigned' and t.task_type in ('checklist','delegation')
        and (t.branch_id is null or t.branch_id=v_actor.branch_id)
        and (t.department_id is null or t.department_id=v_actor.department_id)
        and ((t.default_assignee_type='specific_user' and t.default_assignee_user_id=v_actor.id)
          or (t.default_assignee_type='role' and t.default_assignee_role=v_actor.user_role))
      order by t.title,t.id limit 200) t
  ),'[]'::jsonb));
end;
$$;

revoke all on function public.start_on_demand_task_with_audit(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_my_on_demand_duties() from public,anon,authenticated,service_role;
grant execute on function public.start_on_demand_task_with_audit(uuid) to authenticated;
grant execute on function public.get_my_on_demand_duties() to authenticated;

-- 3. Deadline first, then priority ---------------------------------------------------
-- Only the ordering clause changes. Other migrations patch this function's
-- membership and filters by text, so this patch matches the ordering text only
-- and fails closed if that text is not exactly what 0290 wrote.

do $task_order$
declare f text; n text;
begin
  f:=replace(pg_get_functiondef('public.task_workspace_page(jsonb,integer,integer)'::regprocedure),E'\r','');
  n:=replace(f,
    'case when mode=''board'' then deadline end desc nulls last,case when mode=''board'' then id end desc,',
    'case when mode=''board'' and status_filter=''completed'' then deadline end desc nulls last,'
    ||'case when mode=''board'' and status_filter<>''completed'' then deadline end asc nulls last,'
    ||'case when mode=''board'' then case priority when ''high'' then 3 when ''medium'' then 2 else 1 end end desc nulls last,'
    ||'case when mode=''board'' then id end desc,');
  if n=f then raise exception 'Task order upgrade failed: board ordering'; end if;
  f:=n;
  n:=replace(f,
    'case when mode=''explore'' and ordering<>''newest'' then deadline end asc nulls last,id asc) position',
    'case when mode=''explore'' and ordering<>''newest'' then deadline end asc nulls last,'
    ||'case when mode=''explore'' and ordering=''due'' then case priority when ''high'' then 3 when ''medium'' then 2 else 1 end end desc nulls last,'
    ||'id asc) position');
  if n=f then raise exception 'Task order upgrade failed: search ordering'; end if;
  execute n;
end $task_order$;

notify pgrst,'reload schema';
