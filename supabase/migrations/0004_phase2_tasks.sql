-- Phase 2: checklist/delegation tasks, availability, buddy coverage, and the
-- transactional permission boundary used by the web app and recurrence worker.

set search_path = public, extensions;

alter table task_templates
  add column priority task_priority not null default 'medium',
  add column default_assignee_type text not null default 'specific_user',
  add column default_assignee_user_id uuid references user_profiles(id),
  add column default_assignee_role user_role,
  add column checklist_items jsonb not null default '[]'::jsonb,
  add constraint task_templates_assignee_type_check
    check (default_assignee_type in ('specific_user', 'role')),
  add constraint task_templates_assignee_value_check check (
    (default_assignee_type = 'specific_user' and default_assignee_user_id is not null and default_assignee_role is null)
    or (default_assignee_type = 'role' and default_assignee_role is not null and default_assignee_user_id is null)
  ),
  add constraint task_templates_checklist_array_check
    check (jsonb_typeof(checklist_items) = 'array');

alter table task_instances
  add column scheduled_date date,
  add column requires_upload boolean not null default false,
  add column requires_remark boolean not null default false,
  add column requires_form boolean not null default false,
  add column form_template_id uuid references form_templates(id),
  add column completion_remark text;

alter table task_assignees
  add column is_active boolean not null default true;

create unique index idx_task_instances_template_scheduled_date
  on task_instances(task_template_id, scheduled_date)
  where task_template_id is not null and scheduled_date is not null;
create index idx_task_instances_tenant_planned
  on task_instances(tenant_id, planned_datetime desc);
create index idx_task_assignees_active_user
  on task_assignees(user_profile_id, task_instance_id) where is_active;
create index idx_availability_date_user
  on user_availability(date, user_profile_id);

alter table task_templates enable row level security;
alter table task_assignees enable row level security;
alter table task_checklists enable row level security;
alter table task_comments enable row level security;
alter table task_attachments enable row level security;
alter table task_revisions enable row level security;
alter table user_availability enable row level security;
alter table buddy_assignments enable row level security;
alter table notifications enable row level security;
alter table form_submissions enable row level security;
alter table form_templates enable row level security;
alter table fms_stages enable row level security;
alter table fms_instance_stages enable row level security;

create or replace function is_task_participant(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from task_assignees
    where task_instance_id = p_task_id
      and user_profile_id = (current_profile()).id
      and is_active
  );
$$;

create or replace function is_fms_instance_participant(p_instance_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from fms_instance_stages
    where fms_instance_id = p_instance_id
      and (current_profile()).id = any(assigned_to)
  );
$$;

drop policy if exists ti_tenant_isolation on task_instances;
drop policy if exists ti_write on task_instances;
drop policy if exists ti_update on task_instances;

create policy task_templates_select on task_templates for select using (
  current_profile_is_active()
  and tenant_id = current_tenant_id()
  and (
    is_active
    or current_role_level() in ('super_admin', 'admin', 'manager')
  )
);

create policy task_instances_select on task_instances for select using (
  current_profile_is_active()
  and tenant_id = current_tenant_id()
  and (
    current_role_level() in ('super_admin', 'admin', 'manager')
    or created_by = (current_profile()).id
    or is_task_participant(task_instances.id)
  )
);

create policy task_assignees_select on task_assignees for select using (
  exists (select 1 from task_instances ti where ti.id = task_assignees.task_instance_id)
);
create policy task_checklists_select on task_checklists for select using (
  exists (select 1 from task_instances ti where ti.id = task_checklists.task_instance_id)
);
create policy task_comments_select on task_comments for select using (
  exists (select 1 from task_instances ti where ti.id = task_comments.task_instance_id)
);
create policy task_attachments_select on task_attachments for select using (
  exists (select 1 from task_instances ti where ti.id = task_attachments.task_instance_id)
);
create policy task_revisions_select on task_revisions for select using (
  exists (select 1 from task_instances ti where ti.id = task_revisions.task_instance_id)
);

create policy availability_select on user_availability for select using (
  current_profile_is_active()
  and tenant_id = current_tenant_id()
  and (
    user_profile_id = (current_profile()).id
    or current_role_level() in ('super_admin', 'admin', 'manager', 'hr')
  )
);
create policy buddy_assignments_select on buddy_assignments for select using (
  current_profile_is_active()
  and tenant_id = current_tenant_id()
  and (
    original_assignee_id = (current_profile()).id
    or buddy_id = (current_profile()).id
    or current_role_level() in ('super_admin', 'admin', 'manager')
  )
);
create policy notifications_select on notifications for select using (
  current_profile_is_active()
  and tenant_id = current_tenant_id()
  and (
    user_profile_id = (current_profile()).id
    or current_role_level() in ('super_admin', 'admin')
  )
);
create policy form_submissions_task_select on form_submissions for select using (
  current_profile_is_active()
  and tenant_id = current_tenant_id()
  and (
    submitted_by = (current_profile()).id
    or current_role_level() in ('super_admin', 'admin', 'manager')
    or exists (
      select 1 from task_instances ti
      where ti.id = form_submissions.linked_record_id
    )
  )
);
create policy form_templates_select on form_templates for select using (
  current_profile_is_active() and tenant_id = current_tenant_id() and is_active
);
create policy fms_instances_task_feed_select on fms_instances for select using (
  current_profile_is_active() and tenant_id = current_tenant_id() and (
    current_role_level() in ('super_admin','admin','manager')
    or started_by = (current_profile()).id
    or is_fms_instance_participant(id)
  )
);
create policy fms_instance_stages_task_feed_select on fms_instance_stages for select using (
  exists (select 1 from fms_instances fi where fi.id = fms_instance_id)
);
create policy fms_stages_task_feed_select on fms_stages for select using (
  exists (select 1 from fms_flows ff where ff.id = fms_flow_id)
);

create or replace function save_task_template_with_audit(
  p_template_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_old task_templates;
  v_new task_templates;
  v_id uuid;
  v_assignee_type text := coalesce(p_payload->>'default_assignee_type', 'specific_user');
  v_assignee_user uuid := nullif(p_payload->>'default_assignee_user_id', '')::uuid;
  v_assignee_role user_role := nullif(p_payload->>'default_assignee_role', '')::user_role;
  v_branch uuid := nullif(p_payload->>'branch_id', '')::uuid;
  v_department uuid := nullif(p_payload->>'department_id', '')::uuid;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin', 'admin', 'manager') then
    raise exception 'Only manager, admin, or super_admin can manage task templates' using errcode = '42501';
  end if;
  if p_payload - array[
    'title','description','recurrence_rule','planned_time','priority',
    'requires_upload','requires_remark','requires_form','form_template_id',
    'default_assignee_type','default_assignee_user_id','default_assignee_role',
    'branch_id','department_id','checklist_items','is_active'
  ] <> '{}'::jsonb then
    raise exception 'Template contains unsupported fields' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'title'), '') is null
     or length(btrim(p_payload->>'title')) > 200
     or nullif(btrim(p_payload->>'recurrence_rule'), '') is null then
    raise exception 'Title and recurrence rule are required' using errcode = '22023';
  end if;
  if v_assignee_type not in ('specific_user', 'role')
     or (v_assignee_type = 'specific_user' and (v_assignee_user is null or v_assignee_role is not null))
     or (v_assignee_type = 'role' and (v_assignee_role is null or v_assignee_user is not null)) then
    raise exception 'Default assignee rule is invalid' using errcode = '22023';
  end if;
  if v_assignee_user is not null and not exists (
    select 1 from user_profiles where id = v_assignee_user
      and tenant_id = v_actor.tenant_id and working_status = 'active'
  ) then
    raise exception 'Default assignee is invalid' using errcode = '23503';
  end if;
  if v_branch is not null and not exists (
    select 1 from branches where id = v_branch and tenant_id = v_actor.tenant_id
  ) then raise exception 'Branch is invalid' using errcode = '23503'; end if;
  if v_department is not null and not exists (
    select 1 from departments where id = v_department and tenant_id = v_actor.tenant_id
      and (branch_id is null or v_branch is null or branch_id = v_branch)
  ) then raise exception 'Department is invalid' using errcode = '23503'; end if;
  if coalesce(jsonb_typeof(p_payload->'checklist_items'), 'array') <> 'array' then
    raise exception 'Checklist items must be an array' using errcode = '22023';
  end if;

  if p_template_id is null then
    insert into task_templates (
      tenant_id, branch_id, department_id, title, description, task_type,
      recurrence_rule, planned_time, priority, requires_upload, requires_remark,
      requires_form, form_template_id, default_assignee_type,
      default_assignee_user_id, default_assignee_role, checklist_items,
      is_active, created_by, updated_by
    ) values (
      v_actor.tenant_id, v_branch, v_department, btrim(p_payload->>'title'),
      nullif(btrim(p_payload->>'description'), ''), 'checklist',
      btrim(p_payload->>'recurrence_rule'), (p_payload->>'planned_time')::time,
      coalesce((p_payload->>'priority')::task_priority, 'medium'),
      coalesce((p_payload->>'requires_upload')::boolean, false),
      coalesce((p_payload->>'requires_remark')::boolean, false),
      coalesce((p_payload->>'requires_form')::boolean, false),
      nullif(p_payload->>'form_template_id', '')::uuid,
      v_assignee_type, v_assignee_user, v_assignee_role,
      coalesce(p_payload->'checklist_items', '[]'::jsonb),
      coalesce((p_payload->>'is_active')::boolean, true), v_actor.id, v_actor.id
    ) returning * into v_new;
    v_id := v_new.id;
  else
    select * into v_old from task_templates where id = p_template_id for update;
    if v_old.id is null or v_old.tenant_id <> v_actor.tenant_id or v_old.task_type <> 'checklist' then
      raise exception 'Task template not found' using errcode = '42501';
    end if;
    update task_templates set
      branch_id = v_branch, department_id = v_department,
      title = btrim(p_payload->>'title'), description = nullif(btrim(p_payload->>'description'), ''),
      recurrence_rule = btrim(p_payload->>'recurrence_rule'), planned_time = (p_payload->>'planned_time')::time,
      priority = coalesce((p_payload->>'priority')::task_priority, 'medium'),
      requires_upload = coalesce((p_payload->>'requires_upload')::boolean, false),
      requires_remark = coalesce((p_payload->>'requires_remark')::boolean, false),
      requires_form = coalesce((p_payload->>'requires_form')::boolean, false),
      form_template_id = nullif(p_payload->>'form_template_id', '')::uuid,
      default_assignee_type = v_assignee_type,
      default_assignee_user_id = v_assignee_user,
      default_assignee_role = v_assignee_role,
      checklist_items = coalesce(p_payload->'checklist_items', '[]'::jsonb),
      is_active = coalesce((p_payload->>'is_active')::boolean, true),
      updated_by = v_actor.id, updated_at = now()
    where id = p_template_id returning * into v_new;
    v_id := v_new.id;
  end if;

  insert into audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id,
    case when p_template_id is null then 'task_template_created' else 'task_template_updated' end,
    'task_templates', v_id, case when p_template_id is null then null else to_jsonb(v_old) end, to_jsonb(v_new));
  return v_id;
end;
$$;

create or replace function create_delegation_task_with_audit(
  p_payload jsonb,
  p_assignee_ids uuid[],
  p_checklist jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_task task_instances;
  v_item jsonb;
  v_assignee uuid;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or not current_profile_is_active() then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(btrim(p_payload->>'title'), '') is null or cardinality(p_assignee_ids) < 1
     or jsonb_typeof(p_checklist) <> 'array' then
    raise exception 'Title, assignee, and a valid checklist are required' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_assignee_ids) requested(id)
    where not exists (select 1 from user_profiles up where up.id = requested.id
      and up.tenant_id = v_actor.tenant_id and up.working_status = 'active')
  ) then raise exception 'An assignee is invalid' using errcode = '23503'; end if;

  insert into task_instances (
    tenant_id, branch_id, department_id, task_type, title, description,
    priority, planned_datetime, requires_upload, requires_remark,
    source, created_by, updated_by
  ) values (
    v_actor.tenant_id,
    coalesce(nullif(p_payload->>'branch_id', '')::uuid, v_actor.branch_id),
    coalesce(nullif(p_payload->>'department_id', '')::uuid, v_actor.department_id),
    'delegation', btrim(p_payload->>'title'), nullif(btrim(p_payload->>'description'), ''),
    coalesce((p_payload->>'priority')::task_priority, 'medium'),
    (p_payload->>'planned_datetime')::timestamptz,
    coalesce((p_payload->>'requires_upload')::boolean, false),
    coalesce((p_payload->>'requires_remark')::boolean, false),
    'manual', v_actor.id, v_actor.id
  ) returning * into v_task;

  foreach v_assignee in array p_assignee_ids loop
    insert into task_assignees(task_instance_id, user_profile_id, is_original, is_active)
    values (v_task.id, v_assignee, true, true) on conflict do nothing;
  end loop;
  for v_item in select value from jsonb_array_elements(p_checklist) loop
    if nullif(btrim(v_item->>'item_text'), '') is null then
      raise exception 'Checklist item text is required' using errcode = '22023';
    end if;
    insert into task_checklists(task_instance_id, item_text, is_required, sort_order)
    values (v_task.id, btrim(v_item->>'item_text'), coalesce((v_item->>'is_required')::boolean, true),
      coalesce((v_item->>'sort_order')::integer, 0));
  end loop;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'delegation_task_created', 'tasks', v_task.id,
    jsonb_build_object('assignee_ids', to_jsonb(p_assignee_ids), 'task', to_jsonb(v_task)));
  return v_task.id;
end;
$$;

create or replace function use_task_template_with_audit(
  p_template_id uuid,
  p_planned_datetime timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_template task_templates;
  v_task task_instances;
  v_assignee uuid;
  v_item jsonb;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  select * into v_template from task_templates where id = p_template_id and is_active;
  if v_actor.id is null or not current_profile_is_active() or v_template.id is null
     or v_template.tenant_id <> v_actor.tenant_id then
    raise exception 'Template is not accessible' using errcode = '42501';
  end if;
  insert into task_instances (
    tenant_id, branch_id, department_id, task_template_id, task_type, title,
    description, priority, planned_datetime, requires_upload, requires_remark,
    requires_form, form_template_id, source, created_by, updated_by
  ) values (
    v_template.tenant_id, coalesce(v_template.branch_id, v_actor.branch_id),
    coalesce(v_template.department_id, v_actor.department_id), v_template.id,
    'checklist', v_template.title, v_template.description, v_template.priority,
    p_planned_datetime, v_template.requires_upload, v_template.requires_remark,
    v_template.requires_form, v_template.form_template_id, 'manual_template',
    v_actor.id, v_actor.id
  ) returning * into v_task;

  for v_assignee in
    select up.id from user_profiles up
    where up.tenant_id = v_template.tenant_id and up.working_status = 'active'
      and (v_template.branch_id is null or up.branch_id = v_template.branch_id)
      and (v_template.department_id is null or up.department_id = v_template.department_id)
      and ((v_template.default_assignee_type = 'specific_user' and up.id = v_template.default_assignee_user_id)
        or (v_template.default_assignee_type = 'role' and up.user_role = v_template.default_assignee_role))
  loop
    insert into task_assignees(task_instance_id, user_profile_id) values (v_task.id, v_assignee);
  end loop;
  if not exists (select 1 from task_assignees where task_instance_id = v_task.id) then
    raise exception 'Template has no eligible assignee' using errcode = '23503';
  end if;
  for v_item in select value from jsonb_array_elements(v_template.checklist_items) loop
    insert into task_checklists(task_instance_id, item_text, is_required, sort_order)
    values (v_task.id, v_item->>'item_text', coalesce((v_item->>'is_required')::boolean, true),
      coalesce((v_item->>'sort_order')::integer, 0));
  end loop;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'task_created_from_template', 'tasks', v_task.id, to_jsonb(v_task));
  return v_task.id;
end;
$$;

create or replace function update_task_with_audit(
  p_task_id uuid,
  p_action text,
  p_checklist_id uuid default null,
  p_completed boolean default null,
  p_remark text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_old task_instances;
  v_new task_instances;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  select * into v_old from task_instances where id = p_task_id for update;
  if v_actor.id is null or not current_profile_is_active() or v_old.id is null
     or v_old.tenant_id <> v_actor.tenant_id or not (
       v_actor.user_role in ('super_admin', 'admin', 'manager')
       or exists (select 1 from task_assignees where task_instance_id = p_task_id
         and user_profile_id = v_actor.id and is_active)
     ) then raise exception 'Task is not accessible' using errcode = '42501'; end if;

  if p_action = 'start' then
    if v_old.status <> 'pending' then raise exception 'Only pending tasks can be started' using errcode = '22023'; end if;
    update task_instances set status = 'in_progress', updated_by = v_actor.id, updated_at = now()
      where id = p_task_id returning * into v_new;
  elsif p_action = 'checklist' then
    if p_checklist_id is null or p_completed is null or v_old.status = 'completed' then
      raise exception 'Checklist update is invalid' using errcode = '22023';
    end if;
    update task_checklists set is_completed = p_completed,
      completed_by = case when p_completed then v_actor.id else null end,
      completed_at = case when p_completed then now() else null end
    where id = p_checklist_id and task_instance_id = p_task_id;
    if not found then raise exception 'Checklist item not found' using errcode = '22023'; end if;
    if v_old.status = 'pending' and p_completed then
      update task_instances set status = 'in_progress', updated_by = v_actor.id, updated_at = now()
        where id = p_task_id;
    end if;
    select * into v_new from task_instances where id = p_task_id;
  elsif p_action = 'complete' then
    if v_old.status = 'completed' then raise exception 'Task is already complete' using errcode = '22023'; end if;
    if exists (select 1 from task_checklists where task_instance_id = p_task_id and is_required and not is_completed) then
      raise exception 'Complete all required checklist items first' using errcode = '23514';
    end if;
    if v_old.requires_upload and not exists (select 1 from task_attachments where task_instance_id = p_task_id) then
      raise exception 'A required upload is missing' using errcode = '23514';
    end if;
    if v_old.requires_form and not exists (select 1 from form_submissions where linked_record_id = p_task_id) then
      raise exception 'A required form submission is missing' using errcode = '23514';
    end if;
    if v_old.requires_remark and nullif(btrim(p_remark), '') is null then
      raise exception 'A completion remark is required' using errcode = '23514';
    end if;
    update task_instances set status = 'completed', actual_datetime = now(),
      completion_remark = nullif(btrim(p_remark), ''), updated_by = v_actor.id, updated_at = now()
    where id = p_task_id returning * into v_new;
    update task_assignees set completed_at = now() where task_instance_id = p_task_id and is_active;
  else
    raise exception 'Unsupported task action' using errcode = '22023';
  end if;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'task_' || p_action, 'tasks', p_task_id, to_jsonb(v_old), to_jsonb(v_new));
end;
$$;

create or replace function add_task_attachment_with_audit(p_task_id uuid, p_file_url text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_id uuid; v_tenant uuid;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  select tenant_id into v_tenant from task_instances where id = p_task_id;
  if v_actor.id is null or not current_profile_is_active() or v_tenant <> v_actor.tenant_id
     or not (v_actor.user_role in ('super_admin','admin','manager') or is_task_participant(p_task_id)) then
    raise exception 'Task is not accessible' using errcode = '42501';
  end if;
  insert into task_attachments(task_instance_id, file_url, uploaded_by)
  values (p_task_id, btrim(p_file_url), v_actor.id) returning id into v_id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'task_attachment_added', 'tasks', p_task_id,
    jsonb_build_object('attachment_id', v_id));
  return v_id;
end; $$;

create or replace function delegate_task_with_audit(p_task_id uuid, p_to_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_task task_instances; v_old_assignees jsonb;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  select * into v_task from task_instances where id = p_task_id for update;
  if v_actor.id is null or not current_profile_is_active() or v_task.id is null
     or v_task.tenant_id <> v_actor.tenant_id
     or not (v_actor.user_role in ('super_admin','admin','manager') or exists (
       select 1 from task_assignees where task_instance_id = p_task_id
         and user_profile_id = v_actor.id and is_active)) then
    raise exception 'Task cannot be delegated' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Delegation reason is required' using errcode = '22023'; end if;
  if not exists (select 1 from user_profiles where id = p_to_user_id
    and tenant_id = v_actor.tenant_id and working_status = 'active') then
    raise exception 'Delegate is invalid' using errcode = '23503';
  end if;
  select coalesce(jsonb_agg(to_jsonb(ta)), '[]'::jsonb) into v_old_assignees
    from task_assignees ta where ta.task_instance_id = p_task_id and ta.is_active;
  update task_assignees set is_original = false, is_active = false
    where task_instance_id = p_task_id and is_active;
  insert into task_assignees(task_instance_id, user_profile_id, is_original, is_active)
    values (p_task_id, p_to_user_id, true, true)
    on conflict (task_instance_id, user_profile_id) do update set is_original = true, is_active = true, completed_at = null;
  update task_instances set updated_by = v_actor.id, updated_at = now() where id = p_task_id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'task_delegated', 'tasks', p_task_id, v_old_assignees,
    jsonb_build_object('to_user_id', p_to_user_id, 'reason', btrim(p_reason)));
end; $$;

create or replace function revise_task_datetime_with_audit(
  p_task_id uuid, p_revised_datetime timestamptz, p_reason text
)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_task task_instances; v_old timestamptz;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  select * into v_task from task_instances where id = p_task_id for update;
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin','manager')
     or v_task.id is null or v_task.tenant_id <> v_actor.tenant_id or v_task.task_type <> 'delegation' then
    raise exception 'Only manager, admin, or super_admin can revise delegation dates' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Revision reason is required' using errcode = '22023'; end if;
  v_old := v_task.revised_datetime;
  update task_instances set revised_datetime = p_revised_datetime, updated_by = v_actor.id, updated_at = now()
    where id = p_task_id;
  insert into task_revisions(task_instance_id, old_revised_datetime, new_revised_datetime, changed_by, reason)
  values (p_task_id, v_old, p_revised_datetime, v_actor.id, btrim(p_reason));
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'task_revised_datetime_changed', 'tasks', p_task_id,
    jsonb_build_object('revised_datetime', v_old),
    jsonb_build_object('revised_datetime', p_revised_datetime, 'reason', btrim(p_reason)));
end; $$;

create or replace function record_availability_with_audit(
  p_user_profile_id uuid, p_date date, p_status availability_status, p_reason text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_old user_availability; v_new user_availability;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or not current_profile_is_active() or not (
    p_user_profile_id = v_actor.id or v_actor.user_role in ('super_admin','admin','manager','hr')
  ) or not exists (select 1 from user_profiles where id = p_user_profile_id and tenant_id = v_actor.tenant_id) then
    raise exception 'Availability cannot be recorded for this user' using errcode = '42501';
  end if;
  select * into v_old from user_availability where user_profile_id = p_user_profile_id and date = p_date;
  insert into user_availability(tenant_id, user_profile_id, date, status, reason, logged_by)
  values (v_actor.tenant_id, p_user_profile_id, p_date, p_status, nullif(btrim(p_reason), ''), v_actor.id)
  on conflict (user_profile_id, date) do update set status = excluded.status,
    reason = excluded.reason, logged_by = excluded.logged_by
  returning * into v_new;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'availability_recorded', 'availability', v_new.id,
    case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(v_new));
  return v_new.id;
end; $$;

-- Called only by the recurrence Edge Function with the service-role JWT.
create or replace function create_recurring_task_instance(
  p_template_id uuid,
  p_target_date date,
  p_assignments jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_template task_templates;
  v_task task_instances;
  v_assignment jsonb;
  v_item jsonb;
  v_original uuid;
  v_effective uuid;
  v_manager uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into v_template from task_templates
    where id = p_template_id and is_active and task_type = 'checklist' for update;
  if v_template.id is null then raise exception 'Template not found' using errcode = '22023'; end if;
  if exists (select 1 from task_instances where task_template_id = p_template_id and scheduled_date = p_target_date) then
    return null;
  end if;
  insert into task_instances(
    tenant_id, branch_id, department_id, task_template_id, task_type, title,
    description, priority, planned_datetime, scheduled_date, requires_upload,
    requires_remark, requires_form, form_template_id, source, created_by
  ) values (
    v_template.tenant_id, v_template.branch_id, v_template.department_id,
    v_template.id, 'checklist', v_template.title, v_template.description,
    v_template.priority,
    (p_target_date::text || ' ' || coalesce(v_template.planned_time, '23:59'::time)::text || ' Asia/Kolkata')::timestamptz,
    p_target_date, v_template.requires_upload, v_template.requires_remark,
    v_template.requires_form, v_template.form_template_id, 'checklist',
    coalesce(v_template.created_by, v_template.updated_by,
      nullif(p_assignments->0->>'original_assignee_id', '')::uuid)
  ) returning * into v_task;
  for v_item in select value from jsonb_array_elements(v_template.checklist_items) loop
    insert into task_checklists(task_instance_id, item_text, is_required, sort_order)
    values (v_task.id, v_item->>'item_text', coalesce((v_item->>'is_required')::boolean, true),
      coalesce((v_item->>'sort_order')::integer, 0));
  end loop;
  for v_assignment in select value from jsonb_array_elements(p_assignments) loop
    v_original := (v_assignment->>'original_assignee_id')::uuid;
    v_effective := (v_assignment->>'effective_assignee_id')::uuid;
    insert into task_assignees(task_instance_id, user_profile_id, is_original, is_active)
    values (v_task.id, v_effective, v_original = v_effective, true) on conflict do nothing;
    if v_original <> v_effective then
      insert into buddy_assignments(tenant_id, original_assignee_id, buddy_id, task_instance_id, date)
      values (v_template.tenant_id, v_original, v_effective, v_task.id, p_target_date);
      insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
      values (v_template.tenant_id, null, 'buddy_cover_assigned', 'tasks', v_task.id,
        jsonb_build_object('assignee_id', v_original), jsonb_build_object('assignee_id', v_effective));
    elsif coalesce((v_assignment->>'needs_manager_approval')::boolean, false) then
      select head_id into v_manager from departments where id = v_template.department_id;
      insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
      values (v_template.tenant_id, null, 'buddy_cover_unavailable', 'tasks', v_task.id,
        jsonb_build_object('original_assignee_id', v_original, 'manager_id', v_manager));
      if v_manager is not null then
        insert into notifications(tenant_id, user_profile_id, event_type, title, message, link_url)
        values (v_template.tenant_id, v_manager, 'manager_approval_required',
          'Task needs coverage', 'No available buddy was found for ' || v_template.title,
          '/tasks/checklist');
      end if;
    end if;
  end loop;
  if not exists (select 1 from task_assignees where task_instance_id = v_task.id) then
    raise exception 'No assignees supplied' using errcode = '22023';
  end if;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_template.tenant_id, null, 'recurring_task_generated', 'tasks', v_task.id,
    jsonb_build_object('template_id', p_template_id, 'scheduled_date', p_target_date));
  return v_task.id;
exception when unique_violation then
  return null;
end; $$;

revoke all on function save_task_template_with_audit(uuid, jsonb) from public;
revoke all on function create_delegation_task_with_audit(jsonb, uuid[], jsonb) from public;
revoke all on function use_task_template_with_audit(uuid, timestamptz) from public;
revoke all on function update_task_with_audit(uuid, text, uuid, boolean, text) from public;
revoke all on function add_task_attachment_with_audit(uuid, text) from public;
revoke all on function delegate_task_with_audit(uuid, uuid, text) from public;
revoke all on function revise_task_datetime_with_audit(uuid, timestamptz, text) from public;
revoke all on function record_availability_with_audit(uuid, date, availability_status, text) from public;
revoke all on function create_recurring_task_instance(uuid, date, jsonb) from public;
grant execute on function save_task_template_with_audit(uuid, jsonb) to authenticated;
grant execute on function create_delegation_task_with_audit(jsonb, uuid[], jsonb) to authenticated;
grant execute on function use_task_template_with_audit(uuid, timestamptz) to authenticated;
grant execute on function update_task_with_audit(uuid, text, uuid, boolean, text) to authenticated;
grant execute on function add_task_attachment_with_audit(uuid, text) to authenticated;
grant execute on function delegate_task_with_audit(uuid, uuid, text) to authenticated;
grant execute on function revise_task_datetime_with_audit(uuid, timestamptz, text) to authenticated;
grant execute on function record_availability_with_audit(uuid, date, availability_status, text) to authenticated;
grant execute on function create_recurring_task_instance(uuid, date, jsonb) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments', 'task-attachments', false, 10485760,
  array['image/jpeg','image/png','application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function can_write_task_attachment_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = public, storage as $$
declare v_task_id uuid;
begin
  if not current_profile_is_active()
     or (storage.foldername(p_name))[1] <> current_tenant_id()::text then return false; end if;
  v_task_id := (storage.foldername(p_name))[2]::uuid;
  return current_role_level() in ('super_admin','admin','manager') or is_task_participant(v_task_id);
exception when invalid_text_representation or array_subscript_error then
  return false;
end; $$;

create policy task_attachment_objects_select on storage.objects for select to authenticated using (
  bucket_id = 'task-attachments'
  and can_write_task_attachment_object(name)
);
create policy task_attachment_objects_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'task-attachments'
  and can_write_task_attachment_object(name)
);

drop view if exists v_all_tasks;
create view v_all_tasks with (security_invoker = true) as
  select
    ti.id, ti.tenant_id, ti.branch_id, ti.department_id, ti.task_template_id,
    ti.task_type, ti.title, ti.description, ti.priority, ti.status, ti.created_by,
    ti.planned_datetime, ti.revised_datetime, ti.actual_datetime,
    ti.delay_minutes, ti.source, ti.requires_upload, ti.requires_remark,
    ti.requires_form, ta.user_profile_id as assignee_id,
    coalesce(round(100.0 * count(tc.id) filter (where tc.is_required and tc.is_completed)
      / nullif(count(tc.id) filter (where tc.is_required), 0)),
      case when count(tc.id) filter (where tc.is_required) = 0 then 100 else 0 end)::integer
      as checklist_completion_pct
  from task_instances ti
  join task_assignees ta on ta.task_instance_id = ti.id and ta.is_active
  left join task_checklists tc on tc.task_instance_id = ti.id
  group by ti.id, ta.user_profile_id
  union all
  select
    fis.id, fi.tenant_id, fi.branch_id, null::uuid, null::uuid,
    'fms'::task_type, fs.name, fs.method, fi.priority, fis.status, fi.started_by,
    fis.planned_datetime, null::timestamptz, fis.actual_datetime,
    fis.delay_minutes, 'fms'::text, fs.requires_upload, fs.requires_remark,
    (fs.form_template_id is not null), unnest(fis.assigned_to), 0
  from fms_instance_stages fis
  join fms_instances fi on fi.id = fis.fms_instance_id
  join fms_stages fs on fs.id = fis.fms_stage_id;

grant select on v_all_tasks to authenticated;

create view v_task_users as
  select id, tenant_id, branch_id, department_id, employee_name, user_role,
    employee_code, working_status, buddy_id
  from user_profiles
  where tenant_id = current_tenant_id() and current_profile_is_active();
grant select on v_task_users to authenticated;
