-- On-demand duties (design: docs/superpowers/specs/2026-10-20-on-demand-duties-design.md).
-- Event-driven imported work (As Required, Per Customer, After Visit, ...) has no
-- calendar date. An assigned as_required template is a standing duty: its
-- employee starts an occurrence when the event happens, or a manager assigns
-- one now. Several occurrences per day are allowed; scheduled generation keeps
-- its one-per-day contract.
set search_path=public,extensions;

-- 1. Schema ---------------------------------------------------------------------

alter table public.task_templates add column trigger_label text;
alter table public.task_templates add constraint task_templates_trigger_label_check
  check (trigger_label is null or length(btrim(trigger_label)) between 1 and 80);

alter table public.task_instances add column on_demand boolean not null default false;

create unique index idx_task_instances_template_scheduled_date_v0293
  on public.task_instances(task_template_id, scheduled_date)
  where task_template_id is not null and scheduled_date is not null and not on_demand;
drop index public.idx_task_instances_template_scheduled_date;
alter index public.idx_task_instances_template_scheduled_date_v0293
  rename to idx_task_instances_template_scheduled_date;
create index idx_task_instances_on_demand_template
  on public.task_instances(task_template_id, scheduled_date) where on_demand;

-- The live views expanded `*` when 0210 created them; append the new columns.
create or replace view public.task_templates_live with (security_invoker=true) as
  select * from public.task_templates where deleted_at is null;
create or replace view public.task_instances_live with (security_invoker=true) as
  select * from public.task_instances where deleted_at is null;

-- 2. Existing functions -----------------------------------------------------------

do $on_demand$
declare f text; n text;
begin
  -- Scheduled generation ignores on-demand rows when checking for today's occurrence.
  f:=replace(pg_get_functiondef('public.create_recurring_todo_instance(uuid,date,uuid[])'::regprocedure),E'\r\n',E'\n');
  n:=replace(f,'where task_template_id = p_template_id and scheduled_date = p_target_date) then',
    'where task_template_id = p_template_id and scheduled_date = p_target_date and not on_demand) then');
  if n=f then raise exception 'On-demand upgrade failed: create_recurring_todo_instance'; end if;
  execute n;

  -- An employee who starts their own duty is not alerted about it.
  f:=replace(pg_get_functiondef('public.emit_task_notification_event()'::regprocedure),E'\r\n',E'\n');
  n:=replace(f,E'  select * into v_task from task_instances where id=new.task_instance_id;\n',
    E'  select * into v_task from task_instances where id=new.task_instance_id;\n  if v_task.on_demand and v_task.created_by=new.user_profile_id then return new; end if;\n');
  if n=f then raise exception 'On-demand upgrade failed: emit_task_notification_event'; end if;
  execute n;

  -- Task Control shows the trigger label.
  f:=replace(pg_get_functiondef('public.get_task_template_directory(jsonb)'::regprocedure),E'\r\n',E'\n');
  n:=replace(f,'''schedule_kind'', t.schedule_kind,','''schedule_kind'', t.schedule_kind, ''trigger_label'', t.trigger_label,');
  if n=f then raise exception 'On-demand upgrade failed: get_task_template_directory'; end if;
  execute n;

  -- Imports carry the sheet's label; a replayed row fills a missing label.
  f:=replace(pg_get_functiondef('public.commit_task_bulk_import_chunk_v0104(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
  n:=replace(f,'''is_active'',''assignment_status'',''checklist'']<>''{}''::jsonb',
    '''is_active'',''assignment_status'',''checklist'',''trigger_label'']<>''{}''::jsonb');
  if n=f then raise exception 'On-demand upgrade failed: import row fields'; end if;
  f:=n;
  n:=replace(f,E'        if v_assignment_status=''assigned'' and v_row->>''schedule_kind''<>''as_required'' and nullif(v_row->>''starts_on'','''') is not null then\n',
    E'        if v_row->>''schedule_kind''=''as_required'' then\n          update public.task_templates set trigger_label=left(nullif(btrim(v_row->>''trigger_label''),''''),80) where id=v_template;\n        end if;\n        if v_assignment_status=''assigned'' and v_row->>''schedule_kind''<>''as_required'' and nullif(v_row->>''starts_on'','''') is not null then\n');
  if n=f then raise exception 'On-demand upgrade failed: import trigger label'; end if;
  f:=n;
  n:=replace(f,E'''replayed'',v_task,v_template);\n        v_replayed:=v_replayed+1;',
    E'''replayed'',v_task,v_template);\n        update public.task_templates set trigger_label=left(nullif(btrim(v_row->>''trigger_label''),''''),80)\n          where id=v_template and trigger_label is null and schedule_kind=''as_required'' and nullif(btrim(v_row->>''trigger_label''),'''') is not null;\n        v_replayed:=v_replayed+1;');
  if n=f then raise exception 'On-demand upgrade failed: import replay label'; end if;
  execute n;
end $on_demand$;

-- 3. Start or assign one occurrence ------------------------------------------------

create function public.start_on_demand_task_with_audit(p_template_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_actor user_profiles:=current_profile();
  v_template task_templates; v_task task_instances; v_item jsonb;
  v_assignees uuid[]; v_doers uuid[]; v_self boolean;
  v_today date:=(now() at time zone 'Asia/Kolkata')::date; v_due timestamptz;
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

  v_due:=((v_today::text||' '||coalesce(v_template.due_time,v_template.planned_time,'20:00'::time)::text)::timestamp
    at time zone 'Asia/Kolkata');
  if v_due<now()+interval '30 minutes' then
    v_due:=greatest(((v_today::text||' 23:59')::timestamp at time zone 'Asia/Kolkata'),now()+interval '5 minutes');
  end if;

  insert into task_instances(tenant_id,branch_id,department_id,category_id,task_template_id,task_type,title,
    description,priority,status,planned_datetime,due_datetime,scheduled_date,requires_upload,requires_remark,
    requires_form,form_template_id,source,created_by,buddy_assignment_allowed,on_demand)
  values(v_template.tenant_id,v_template.branch_id,v_template.department_id,v_template.category_id,v_template.id,
    v_template.task_type,v_template.title,v_template.description,v_template.priority,'pending',now(),v_due,v_today,
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
      'doer_ids',to_jsonb(v_doers),'due_datetime',v_due));
  return v_task.id;
end;
$$;

-- 4. The caller's own standing duties ---------------------------------------------

create function public.get_my_on_demand_duties()
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
      'open_count',(select count(*) from task_instances i join task_assignees a on a.task_instance_id=i.id
        and a.user_profile_id=v_actor.id and a.role_at_task='doer' and a.is_active
        where i.task_template_id=t.id and i.on_demand and i.status='pending' and i.deleted_at is null)
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

notify pgrst,'reload schema';
