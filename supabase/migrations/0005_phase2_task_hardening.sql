-- Phase 2A: harden task categories, shared-doer/watchers semantics,
-- recurrence coverage, attachments, validation, RLS, and function grants.
-- This is forward-only: migrations 0001 through 0004 remain unchanged.

set search_path = public, extensions;

-- --------------------------------------------------------------------------
-- Schema and indexes
-- --------------------------------------------------------------------------

alter table task_templates
  add column category_id uuid references dropdown_masters(id);

alter table task_instances
  add column category_id uuid references dropdown_masters(id);

-- Existing rows are intentionally not guessed into a category. The hardened
-- creation/template RPCs require category_id for every new task; nullable
-- legacy rows remain operable until a reviewed data backfill is defined.

create index idx_task_templates_category
  on task_templates(category_id, tenant_id);
create index idx_task_instances_category
  on task_instances(category_id, tenant_id);

-- Preserve every assignment period. The original table-wide unique constraint
-- prevented a previously transferred user from becoming a doer again without
-- overwriting assignment history.
alter table task_assignees
  drop constraint task_assignees_task_instance_id_user_profile_id_key;

create unique index idx_task_assignees_one_active_doer
  on task_assignees(task_instance_id, user_profile_id)
  where is_active;

create table task_watchers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_instance_id uuid not null references task_instances(id) on delete cascade,
  user_profile_id uuid not null references user_profiles(id),
  created_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  constraint task_watchers_task_user_unique
    unique (task_instance_id, user_profile_id)
);

create index idx_task_watchers_task
  on task_watchers(tenant_id, task_instance_id);
create index idx_task_watchers_user
  on task_watchers(user_profile_id, tenant_id, task_instance_id);
create index idx_task_watchers_created_by
  on task_watchers(created_by);

alter table task_watchers enable row level security;

-- --------------------------------------------------------------------------
-- Validation and permission helpers
-- --------------------------------------------------------------------------

create or replace function is_task_participant(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from task_assignees
    where task_instance_id = p_task_id
      and user_profile_id = (current_profile()).id
      and role_at_task = 'doer'
      and is_active
  );
$$;

create or replace function is_task_watcher(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from task_watchers
    where task_instance_id = p_task_id
      and user_profile_id = (current_profile()).id
      and tenant_id = current_tenant_id()
  );
$$;

create or replace function can_read_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_profile_is_active()
    and exists (
      select 1
      from task_instances ti
      where ti.id = p_task_id
        and ti.tenant_id = current_tenant_id()
        and (
          current_role_level() in ('super_admin', 'admin', 'manager')
          or ti.created_by = (current_profile()).id
          or is_task_participant(ti.id)
          or is_task_watcher(ti.id)
        )
    );
$$;

create or replace function normalize_task_checklist(p_checklist jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_normalized jsonb;
begin
  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' then
    raise exception 'Checklist must be an array' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_checklist) item
    where jsonb_typeof(item) <> 'object'
      or item - array['item_text', 'is_required', 'sort_order'] <> '{}'::jsonb
      or nullif(btrim(item->>'item_text'), '') is null
      or (item ? 'is_required' and jsonb_typeof(item->'is_required') <> 'boolean')
      or (item ? 'sort_order' and jsonb_typeof(item->'sort_order') <> 'number')
  ) then
    raise exception 'Every checklist item must contain non-empty item_text and supported fields only'
      using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'item_text', btrim(item->>'item_text'),
        'is_required', coalesce((item->>'is_required')::boolean, true),
        'sort_order', ordinal - 1
      ) order by ordinal
    ),
    '[]'::jsonb
  )
  into v_normalized
  from jsonb_array_elements(p_checklist) with ordinality entries(item, ordinal);

  return v_normalized;
end;
$$;

create or replace function is_supported_task_rrule(p_rule text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_input text := replace(btrim(coalesce(p_rule, '')), E'\r', '');
  v_lines text[];
  v_rule text;
  v_token text;
  v_key text;
  v_value text;
  v_seen text[] := '{}';
  v_number text;
begin
  if v_input = '' then return false; end if;

  v_lines := regexp_split_to_array(v_input, E'\n');
  if cardinality(v_lines) = 1 then
    v_rule := v_lines[1];
  elsif cardinality(v_lines) = 2
    and v_lines[1] ~ '^DTSTART(;TZID=Asia/Kolkata)?:[0-9]{8}T[0-9]{6}Z?$'
    and v_lines[2] ~ '^RRULE:' then
    v_rule := v_lines[2];
  else
    return false;
  end if;

  v_rule := regexp_replace(v_rule, '^RRULE:', '', 'i');
  if v_rule = '' then return false; end if;

  foreach v_token in array string_to_array(v_rule, ';') loop
    if v_token !~ '^[A-Z]+=.+' then return false; end if;
    v_key := split_part(v_token, '=', 1);
    v_value := substr(v_token, length(v_key) + 2);
    if v_key = any(v_seen) then return false; end if;
    v_seen := array_append(v_seen, v_key);

    if v_key = 'FREQ' then
      if v_value not in ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') then return false; end if;
    elsif v_key in ('INTERVAL', 'COUNT') then
      if v_value !~ '^[1-9][0-9]*$' then return false; end if;
    elsif v_key = 'BYDAY' then
      if v_value !~ '^([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)(,([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU))*$' then
        return false;
      end if;
    elsif v_key in ('BYMONTHDAY', 'BYSETPOS') then
      foreach v_number in array string_to_array(v_value, ',') loop
        if v_number !~ '^-?[0-9]+$'
          or v_number::integer = 0
          or (v_key = 'BYMONTHDAY' and abs(v_number::integer) > 31)
          or (v_key = 'BYSETPOS' and abs(v_number::integer) > 366) then
          return false;
        end if;
      end loop;
    elsif v_key = 'BYMONTH' then
      foreach v_number in array string_to_array(v_value, ',') loop
        if v_number !~ '^[0-9]+$' or v_number::integer not between 1 and 12 then
          return false;
        end if;
      end loop;
    elsif v_key = 'UNTIL' then
      if v_value !~ '^[0-9]{8}(T[0-9]{6}Z?)?$' then return false; end if;
    elsif v_key = 'WKST' then
      if v_value not in ('MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU') then return false; end if;
    else
      return false;
    end if;
  end loop;

  if not ('FREQ' = any(v_seen)) then return false; end if;
  if 'BYSETPOS' = any(v_seen) and not ('BYDAY' = any(v_seen)) then return false; end if;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function is_user_available_for_task(
  p_user_profile_id uuid,
  p_target_date date
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from user_profiles up
    where up.id = p_user_profile_id
      and up.working_status = 'active'
      and not exists (
        select 1
        from unnest(up.week_off) day_name
        where lower(btrim(day_name)) = lower(btrim(to_char(p_target_date, 'Day')))
      )
      and not exists (
        select 1
        from user_availability ua
        where ua.user_profile_id = up.id
          and ua.tenant_id = up.tenant_id
          and ua.date = p_target_date
          and ua.status = 'absent'
      )
  );
$$;

-- --------------------------------------------------------------------------
-- RLS: watchers are readers only; all task mutations remain RPC-only.
-- --------------------------------------------------------------------------

drop policy if exists task_instances_select on task_instances;
create policy task_instances_select on task_instances
for select to authenticated
using (can_read_task(id));

drop policy if exists task_watchers_select on task_watchers;
create policy task_watchers_select on task_watchers
for select to authenticated
using (can_read_task(task_instance_id));

drop policy if exists task_assignees_select on task_assignees;
create policy task_assignees_select on task_assignees
for select to authenticated
using (can_read_task(task_instance_id));

drop policy if exists task_checklists_select on task_checklists;
create policy task_checklists_select on task_checklists
for select to authenticated
using (can_read_task(task_instance_id));

drop policy if exists task_comments_select on task_comments;
create policy task_comments_select on task_comments
for select to authenticated
using (can_read_task(task_instance_id));

drop policy if exists task_attachments_select on task_attachments;
create policy task_attachments_select on task_attachments
for select to authenticated
using (can_read_task(task_instance_id));

drop policy if exists task_revisions_select on task_revisions;
create policy task_revisions_select on task_revisions
for select to authenticated
using (can_read_task(task_instance_id));

drop policy if exists task_audit_history_select on audit_logs;
create policy task_audit_history_select on audit_logs
for select to authenticated
using (
  module = 'tasks'
  and record_id is not null
  and can_read_task(record_id)
);

revoke all on task_watchers from anon, authenticated;
grant select on task_watchers to authenticated;

-- --------------------------------------------------------------------------
-- Validated transactional task/template RPCs
-- --------------------------------------------------------------------------

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
  v_assignee_type text;
  v_assignee_user uuid;
  v_assignee_role user_role;
  v_branch uuid;
  v_department uuid;
  v_category uuid;
  v_form uuid;
  v_checklist jsonb;
  v_planned_time time;
  v_priority task_priority;
  v_requires_form boolean;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin', 'admin', 'manager') then
    raise exception 'Only manager, admin, or super_admin can manage task templates'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
     or p_payload - array[
       'title','description','recurrence_rule','planned_time','priority',
       'requires_upload','requires_remark','requires_form','form_template_id',
       'default_assignee_type','default_assignee_user_id','default_assignee_role',
       'branch_id','department_id','category_id','checklist_items','is_active'
     ] <> '{}'::jsonb then
    raise exception 'Template contains unsupported fields' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'title'), '') is null
     or length(btrim(p_payload->>'title')) > 200 then
    raise exception 'Template title must contain 1 to 200 characters' using errcode = '22023';
  end if;
  if not is_supported_task_rrule(p_payload->>'recurrence_rule') then
    raise exception 'Recurrence rule is invalid or unsupported' using errcode = '22023';
  end if;
  if coalesce(p_payload->>'planned_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception 'Planned time is invalid' using errcode = '22023';
  end if;

  v_assignee_type := coalesce(p_payload->>'default_assignee_type', 'specific_user');
  v_assignee_user := nullif(p_payload->>'default_assignee_user_id', '')::uuid;
  v_assignee_role := nullif(p_payload->>'default_assignee_role', '')::user_role;
  v_branch := nullif(p_payload->>'branch_id', '')::uuid;
  if v_actor.user_role = 'manager' then
    if v_branch is not null and v_branch <> v_actor.branch_id then
      raise exception 'Managers can manage templates only in their own branch'
        using errcode = '42501';
    end if;
    -- A manager's empty/global selection is stored as their own branch scope.
    v_branch := v_actor.branch_id;
  end if;
  v_department := nullif(p_payload->>'department_id', '')::uuid;
  v_category := nullif(p_payload->>'category_id', '')::uuid;
  v_form := nullif(p_payload->>'form_template_id', '')::uuid;
  v_checklist := normalize_task_checklist(coalesce(p_payload->'checklist_items', '[]'::jsonb));
  v_planned_time := (p_payload->>'planned_time')::time;
  v_priority := coalesce((p_payload->>'priority')::task_priority, 'medium');
  v_requires_form := coalesce((p_payload->>'requires_form')::boolean, false);

  if v_assignee_type not in ('specific_user', 'role')
     or (v_assignee_type = 'specific_user' and (v_assignee_user is null or v_assignee_role is not null))
     or (v_assignee_type = 'role' and (v_assignee_role is null or v_assignee_user is not null)) then
    raise exception 'Default assignee rule is invalid' using errcode = '22023';
  end if;
  if v_category is null or not exists (
    select 1 from dropdown_masters dm
    where dm.id = v_category
      and dm.tenant_id = v_actor.tenant_id
      and dm.master_type = 'task_category'
      and dm.is_active
  ) then
    raise exception 'Task category is invalid or inactive' using errcode = '23503';
  end if;
  if v_branch is not null and not exists (
    select 1 from branches b
    where b.id = v_branch and b.tenant_id = v_actor.tenant_id and b.is_active
  ) then
    raise exception 'Branch is invalid or inactive' using errcode = '23503';
  end if;
  if v_department is not null and (
    v_branch is null or not exists (
      select 1 from departments d
      where d.id = v_department
        and d.tenant_id = v_actor.tenant_id
        and d.branch_id = v_branch
        and d.is_active
    )
  ) then
    raise exception 'Department must belong to the selected active branch' using errcode = '23503';
  end if;
  if v_assignee_user is not null and not exists (
    select 1 from user_profiles up
    where up.id = v_assignee_user
      and up.tenant_id = v_actor.tenant_id
      and up.working_status = 'active'
      and (v_branch is null or up.branch_id = v_branch)
      and (v_department is null or up.department_id = v_department)
  ) then
    raise exception 'Default assignee is outside the template scope or inactive'
      using errcode = '23503';
  end if;
  if v_requires_form <> (v_form is not null) then
    raise exception 'Required form selection is inconsistent' using errcode = '22023';
  end if;
  if v_form is not null and not exists (
    select 1 from form_templates ft
    where ft.id = v_form and ft.tenant_id = v_actor.tenant_id and ft.is_active
  ) then
    raise exception 'Required form is invalid or inactive' using errcode = '23503';
  end if;

  if p_template_id is null then
    insert into task_templates (
      tenant_id, branch_id, department_id, category_id, title, description,
      task_type, recurrence_rule, planned_time, priority, requires_upload,
      requires_remark, requires_form, form_template_id, default_assignee_type,
      default_assignee_user_id, default_assignee_role, checklist_items,
      is_active, created_by, updated_by
    ) values (
      v_actor.tenant_id, v_branch, v_department, v_category,
      btrim(p_payload->>'title'), nullif(btrim(p_payload->>'description'), ''),
      'checklist', btrim(p_payload->>'recurrence_rule'), v_planned_time, v_priority,
      coalesce((p_payload->>'requires_upload')::boolean, false),
      coalesce((p_payload->>'requires_remark')::boolean, false),
      v_requires_form, v_form, v_assignee_type, v_assignee_user,
      v_assignee_role, v_checklist,
      coalesce((p_payload->>'is_active')::boolean, true), v_actor.id, v_actor.id
    ) returning * into v_new;
    v_id := v_new.id;
  else
    select * into v_old from task_templates where id = p_template_id for update;
    if v_old.id is null or v_old.tenant_id <> v_actor.tenant_id
       or v_old.task_type <> 'checklist' then
      raise exception 'Task template not found' using errcode = '42501';
    end if;
    if v_actor.user_role = 'manager'
       and (v_old.branch_id is null or v_old.branch_id <> v_actor.branch_id) then
      raise exception 'Managers cannot edit tenant-global or other-branch templates'
        using errcode = '42501';
    end if;
    update task_templates set
      branch_id = v_branch,
      department_id = v_department,
      category_id = v_category,
      title = btrim(p_payload->>'title'),
      description = nullif(btrim(p_payload->>'description'), ''),
      recurrence_rule = btrim(p_payload->>'recurrence_rule'),
      planned_time = v_planned_time,
      priority = v_priority,
      requires_upload = coalesce((p_payload->>'requires_upload')::boolean, false),
      requires_remark = coalesce((p_payload->>'requires_remark')::boolean, false),
      requires_form = v_requires_form,
      form_template_id = v_form,
      default_assignee_type = v_assignee_type,
      default_assignee_user_id = v_assignee_user,
      default_assignee_role = v_assignee_role,
      checklist_items = v_checklist,
      is_active = coalesce((p_payload->>'is_active')::boolean, true),
      updated_by = v_actor.id,
      updated_at = now()
    where id = p_template_id
    returning * into v_new;
    v_id := v_new.id;
  end if;

  insert into audit_logs (
    tenant_id, actor_user_id, action, module, record_id, old_value, new_value
  ) values (
    v_actor.tenant_id, v_actor.id,
    case when p_template_id is null then 'task_template_created' else 'task_template_updated' end,
    'task_templates', v_id,
    case when p_template_id is null then null else to_jsonb(v_old) end,
    to_jsonb(v_new)
  );
  return v_id;
end;
$$;

drop function create_delegation_task_with_audit(jsonb, uuid[], jsonb);

create function create_delegation_task_with_audit(
  p_payload jsonb,
  p_doer_ids uuid[],
  p_watcher_ids uuid[] default '{}',
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
  v_doer uuid;
  v_watcher uuid;
  v_branch uuid;
  v_department uuid;
  v_category uuid;
  v_planned_datetime timestamptz;
  v_priority task_priority;
  v_checklist jsonb;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin', 'admin', 'manager') then
    raise exception 'Only manager, admin, or super_admin can create delegation tasks'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
     or p_payload - array[
       'title','description','planned_datetime','priority','branch_id',
       'department_id','category_id','requires_upload','requires_remark'
     ] <> '{}'::jsonb then
    raise exception 'Task payload contains unsupported fields' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'title'), '') is null
     or length(btrim(p_payload->>'title')) > 200 then
    raise exception 'Task title must contain 1 to 200 characters' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'planned_datetime'), '') is null then
    raise exception 'Planned datetime is required' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_doer_ids), 0) < 1 then
    raise exception 'At least one doer is required' using errcode = '22023';
  end if;
  p_watcher_ids := coalesce(p_watcher_ids, '{}'::uuid[]);
  if cardinality(p_doer_ids) <> (select count(distinct id) from unnest(p_doer_ids) requested(id)) then
    raise exception 'Doer list contains duplicates' using errcode = '22023';
  end if;
  if cardinality(p_watcher_ids) <> (select count(distinct id) from unnest(p_watcher_ids) requested(id)) then
    raise exception 'Watcher list contains duplicates' using errcode = '22023';
  end if;
  if p_doer_ids && p_watcher_ids then
    raise exception 'A user cannot be both a watcher and a doer' using errcode = '22023';
  end if;

  if v_actor.user_role = 'manager' then
    if nullif(p_payload->>'branch_id', '') is not null
       and (p_payload->>'branch_id')::uuid <> v_actor.branch_id then
      raise exception 'Managers can create tasks only in their own branch'
        using errcode = '42501';
    end if;
    v_branch := v_actor.branch_id;
  else
    v_branch := coalesce(nullif(p_payload->>'branch_id', '')::uuid, v_actor.branch_id);
  end if;
  v_department := coalesce(nullif(p_payload->>'department_id', '')::uuid, v_actor.department_id);
  v_category := nullif(p_payload->>'category_id', '')::uuid;
  v_planned_datetime := (p_payload->>'planned_datetime')::timestamptz;
  if not isfinite(v_planned_datetime) then
    raise exception 'Planned datetime must be finite' using errcode = '22023';
  end if;
  v_priority := coalesce((p_payload->>'priority')::task_priority, 'medium');
  v_checklist := normalize_task_checklist(p_checklist);

  if v_category is null or not exists (
    select 1 from dropdown_masters dm
    where dm.id = v_category
      and dm.tenant_id = v_actor.tenant_id
      and dm.master_type = 'task_category'
      and dm.is_active
  ) then
    raise exception 'Task category is invalid or inactive' using errcode = '23503';
  end if;
  if not exists (
    select 1 from branches b
    where b.id = v_branch and b.tenant_id = v_actor.tenant_id and b.is_active
  ) then
    raise exception 'Branch is invalid or inactive' using errcode = '23503';
  end if;
  if not exists (
    select 1 from departments d
    where d.id = v_department
      and d.tenant_id = v_actor.tenant_id
      and d.branch_id = v_branch
      and d.is_active
  ) then
    raise exception 'Department must belong to the selected active branch' using errcode = '23503';
  end if;
  if exists (
    select 1
    from unnest(p_doer_ids) requested(id)
    where not exists (
      select 1 from user_profiles up
      where up.id = requested.id
        and up.tenant_id = v_actor.tenant_id
        and up.branch_id = v_branch
        and up.department_id = v_department
        and up.working_status = 'active'
    )
  ) then
    raise exception 'Every doer must be active and belong to the task branch and department'
      using errcode = '23503';
  end if;
  if exists (
    select 1
    from unnest(p_watcher_ids) requested(id)
    where not exists (
      select 1 from user_profiles up
      where up.id = requested.id
        and up.tenant_id = v_actor.tenant_id
        and up.working_status = 'active'
        and (v_actor.user_role <> 'manager' or up.branch_id = v_actor.branch_id)
    )
  ) then
    raise exception 'Every watcher must be active and belong to the permitted tenant and branch'
      using errcode = '23503';
  end if;

  insert into task_instances (
    tenant_id, branch_id, department_id, category_id, task_type, title,
    description, priority, planned_datetime, requires_upload,
    requires_remark, source, created_by, updated_by
  ) values (
    v_actor.tenant_id, v_branch, v_department, v_category, 'delegation',
    btrim(p_payload->>'title'), nullif(btrim(p_payload->>'description'), ''),
    v_priority, v_planned_datetime,
    coalesce((p_payload->>'requires_upload')::boolean, false),
    coalesce((p_payload->>'requires_remark')::boolean, false),
    'manual', v_actor.id, v_actor.id
  ) returning * into v_task;

  foreach v_doer in array p_doer_ids loop
    insert into task_assignees(
      task_instance_id, user_profile_id, role_at_task, is_original, is_active
    ) values (v_task.id, v_doer, 'doer', true, true);
  end loop;

  foreach v_watcher in array p_watcher_ids loop
    insert into task_watchers(
      tenant_id, task_instance_id, user_profile_id, created_by
    ) values (v_actor.tenant_id, v_task.id, v_watcher, v_actor.id);
  end loop;

  insert into task_checklists(
    task_instance_id, item_text, is_required, sort_order
  )
  select
    v_task.id,
    item->>'item_text',
    (item->>'is_required')::boolean,
    (item->>'sort_order')::integer
  from jsonb_array_elements(v_checklist) item;

  insert into audit_logs(
    tenant_id, actor_user_id, action, module, record_id, new_value
  ) values (
    v_actor.tenant_id, v_actor.id, 'delegation_task_created', 'tasks', v_task.id,
    jsonb_build_object(
      'task', to_jsonb(v_task),
      'doer_ids', to_jsonb(p_doer_ids),
      'watcher_ids', to_jsonb(p_watcher_ids),
      'checklist', v_checklist
    )
  );
  return v_task.id;
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'Task payload contains an invalid UUID, priority, or planned datetime'
      using errcode = '22023';
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
  v_resolved_branch uuid;
  v_resolved_department uuid;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin', 'admin', 'manager') then
    raise exception 'Only manager, admin, or super_admin can use task templates'
      using errcode = '42501';
  end if;
  select * into v_template from task_templates where id = p_template_id and is_active;
  if v_template.id is null or v_template.tenant_id <> v_actor.tenant_id
     or v_template.category_id is null then
    raise exception 'Template is not accessible or is missing a valid category'
      using errcode = '42501';
  end if;
  if v_actor.user_role = 'manager'
     and v_template.branch_id is not null
     and v_template.branch_id <> v_actor.branch_id then
    raise exception 'Managers cannot use templates scoped to another branch'
      using errcode = '42501';
  end if;

  v_resolved_branch := coalesce(v_template.branch_id, v_actor.branch_id);
  v_resolved_department := case
    when v_template.department_id is not null then v_template.department_id
    when v_resolved_branch = v_actor.branch_id then v_actor.department_id
    else null
  end;
  if not exists (
    select 1 from branches b
    where b.id = v_resolved_branch
      and b.tenant_id = v_actor.tenant_id
      and b.is_active
  ) then
    raise exception 'Resolved template branch is invalid or inactive'
      using errcode = '23503';
  end if;
  if v_resolved_department is not null and not exists (
    select 1 from departments d
    where d.id = v_resolved_department
      and d.tenant_id = v_actor.tenant_id
      and d.branch_id = v_resolved_branch
      and d.is_active
  ) then
    raise exception 'Resolved template department is outside the task branch'
      using errcode = '23503';
  end if;
  if p_planned_datetime is null or not isfinite(p_planned_datetime) then
    raise exception 'A finite planned datetime is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from dropdown_masters dm
    where dm.id = v_template.category_id
      and dm.tenant_id = v_template.tenant_id
      and dm.master_type = 'task_category'
      and dm.is_active
  ) then
    raise exception 'Template category is invalid or inactive' using errcode = '23503';
  end if;

  insert into task_instances (
    tenant_id, branch_id, department_id, category_id, task_template_id,
    task_type, title, description, priority, planned_datetime,
    requires_upload, requires_remark, requires_form, form_template_id,
    source, created_by, updated_by
  ) values (
    v_template.tenant_id, v_resolved_branch, v_resolved_department,
    v_template.category_id, v_template.id, 'checklist', v_template.title,
    v_template.description, v_template.priority, p_planned_datetime,
    v_template.requires_upload, v_template.requires_remark,
    v_template.requires_form, v_template.form_template_id,
    'manual_template', v_actor.id, v_actor.id
  ) returning * into v_task;

  for v_assignee in
    select up.id
    from user_profiles up
    where up.tenant_id = v_template.tenant_id
      and up.working_status = 'active'
      and up.branch_id = v_resolved_branch
      and (v_resolved_department is null or up.department_id = v_resolved_department)
      and (
        (v_template.default_assignee_type = 'specific_user' and up.id = v_template.default_assignee_user_id)
        or (v_template.default_assignee_type = 'role' and up.user_role = v_template.default_assignee_role)
      )
  loop
    insert into task_assignees(
      task_instance_id, user_profile_id, role_at_task, is_original, is_active
    ) values (v_task.id, v_assignee, 'doer', true, true);
  end loop;
  if not exists (
    select 1 from task_assignees where task_instance_id = v_task.id and is_active
  ) then
    raise exception 'Template has no eligible active doer' using errcode = '23503';
  end if;
  for v_item in select value from jsonb_array_elements(v_template.checklist_items) loop
    insert into task_checklists(task_instance_id, item_text, is_required, sort_order)
    values (
      v_task.id, v_item->>'item_text',
      coalesce((v_item->>'is_required')::boolean, true),
      coalesce((v_item->>'sort_order')::integer, 0)
    );
  end loop;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (
    v_actor.tenant_id, v_actor.id, 'task_created_from_template', 'tasks',
    v_task.id, to_jsonb(v_task)
  );
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
  v_linked_module text;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  select * into v_old from task_instances where id = p_task_id for update;
  if v_actor.id is null or not current_profile_is_active() or v_old.id is null
     or v_old.tenant_id <> v_actor.tenant_id or not (
       v_actor.user_role in ('super_admin', 'admin', 'manager')
       or exists (
         select 1 from task_assignees
         where task_instance_id = p_task_id
           and user_profile_id = v_actor.id
           and role_at_task = 'doer'
           and is_active
       )
     ) then
    raise exception 'Task is not accessible to an active doer'
      using errcode = '42501';
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
       or v_old.status not in ('pending', 'in_progress') then
      raise exception 'Checklist update is invalid for this task state'
        using errcode = '22023';
    end if;
    update task_checklists
    set is_completed = p_completed,
        completed_by = case when p_completed then v_actor.id else null end,
        completed_at = case when p_completed then now() else null end
    where id = p_checklist_id and task_instance_id = p_task_id;
    if not found then
      raise exception 'Checklist item not found' using errcode = '22023';
    end if;
    if v_old.status = 'pending' and p_completed then
      update task_instances
      set status = 'in_progress', updated_by = v_actor.id, updated_at = now()
      where id = p_task_id;
    end if;
    select * into v_new from task_instances where id = p_task_id;
  elsif p_action = 'complete' then
    if v_old.status in ('completed', 'blocked') then
      raise exception 'Completed or coverage-blocked tasks cannot be completed'
        using errcode = '22023';
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
        select 1
        from form_submissions fs
        where fs.tenant_id = v_old.tenant_id
          and fs.linked_record_id = p_task_id
          and fs.linked_module = v_linked_module
          and fs.form_template_id = v_old.form_template_id
      )
    ) then
      raise exception 'The required task form submission is missing' using errcode = '23514';
    end if;
    if v_old.requires_remark and nullif(btrim(p_remark), '') is null then
      raise exception 'A completion remark is required' using errcode = '23514';
    end if;
    update task_instances
    set status = 'completed', actual_datetime = now(),
        completion_remark = nullif(btrim(p_remark), ''),
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
    v_actor.tenant_id, v_actor.id, 'task_' || p_action, 'tasks', p_task_id,
    to_jsonb(v_old), to_jsonb(v_new)
  );
end;
$$;

create or replace function add_task_attachment_with_audit(
  p_task_id uuid,
  p_file_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_id uuid;
  v_task task_instances;
  v_path text := btrim(coalesce(p_file_url, ''));
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  select * into v_task from task_instances where id = p_task_id;
  if v_actor.id is null or not current_profile_is_active() or v_task.id is null
     or v_task.tenant_id <> v_actor.tenant_id or not (
       v_actor.user_role in ('super_admin', 'admin', 'manager')
       or is_task_participant(p_task_id)
     ) then
    raise exception 'Task is not accessible to an active doer'
      using errcode = '42501';
  end if;
  if v_path = ''
     or split_part(v_path, '/', 1) <> v_task.tenant_id::text
     or split_part(v_path, '/', 2) <> p_task_id::text
     or nullif(split_part(v_path, '/', 3), '') is null then
    raise exception 'Attachment path must use the task tenant/task prefix'
      using errcode = '22023';
  end if;

  insert into task_attachments(task_instance_id, file_url, uploaded_by)
  values (p_task_id, v_path, v_actor.id)
  returning id into v_id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (
    v_actor.tenant_id, v_actor.id, 'task_attachment_added', 'tasks', p_task_id,
    jsonb_build_object('attachment_id', v_id, 'storage_path', v_path)
  );
  return v_id;
end;
$$;

drop function delegate_task_with_audit(uuid, uuid, text);

create function delegate_task_with_audit(
  p_task_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_task task_instances;
  v_source_assignment task_assignees;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_actor from user_profiles where auth_user_id = auth.uid();
  select * into v_task from task_instances where id = p_task_id for update;
  if v_actor.id is null or not current_profile_is_active() or v_task.id is null
     or v_task.tenant_id <> v_actor.tenant_id then
    raise exception 'Task cannot be delegated' using errcode = '42501';
  end if;
  if v_task.status = 'completed' then
    raise exception 'Completed tasks cannot be delegated' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Delegation reason is required' using errcode = '22023';
  end if;
  if p_from_user_id = p_to_user_id then
    raise exception 'Self-delegation is not allowed' using errcode = '22023';
  end if;

  select * into v_source_assignment
  from task_assignees
  where task_instance_id = p_task_id
    and user_profile_id = p_from_user_id
    and role_at_task = 'doer'
    and is_active
  for update;
  if v_source_assignment.id is null then
    raise exception 'The source user is not an active doer on this task'
      using errcode = '22023';
  end if;
  if v_actor.user_role not in ('super_admin', 'admin', 'manager')
     and v_actor.id <> p_from_user_id then
    raise exception 'A doer may transfer only their own assignment'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from task_assignees
    where task_instance_id = p_task_id
      and user_profile_id = p_to_user_id
      and role_at_task = 'doer'
      and is_active
  ) then
    raise exception 'Destination user is already an active doer'
      using errcode = '23505';
  end if;
  if exists (
    select 1 from task_watchers
    where task_instance_id = p_task_id and user_profile_id = p_to_user_id
  ) then
    raise exception 'Destination user is already a watcher and cannot also be a doer'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from user_profiles up
    where up.id = p_to_user_id
      and up.tenant_id = v_task.tenant_id
      and up.working_status = 'active'
      and (v_task.branch_id is null or up.branch_id = v_task.branch_id)
      and (v_task.department_id is null or up.department_id = v_task.department_id)
  ) then
    raise exception 'Destination doer is inactive or outside the task scope'
      using errcode = '23503';
  end if;

  select coalesce(jsonb_agg(to_jsonb(ta) order by ta.id), '[]'::jsonb)
  into v_before
  from task_assignees ta
  where ta.task_instance_id = p_task_id;

  update task_assignees
  set is_active = false
  where id = v_source_assignment.id;

  insert into task_assignees(
    task_instance_id, user_profile_id, role_at_task, is_original, is_active
  ) values (p_task_id, p_to_user_id, 'doer', false, true);

  update task_instances
  set updated_by = v_actor.id, updated_at = now()
  where id = p_task_id;

  select coalesce(jsonb_agg(to_jsonb(ta) order by ta.id), '[]'::jsonb)
  into v_after
  from task_assignees ta
  where ta.task_instance_id = p_task_id;

  insert into audit_logs(
    tenant_id, actor_user_id, action, module, record_id, old_value, new_value
  ) values (
    v_actor.tenant_id, v_actor.id, 'task_doer_transferred', 'tasks', p_task_id,
    jsonb_build_object('assignments', v_before),
    jsonb_build_object(
      'assignments', v_after,
      'from_user_id', p_from_user_id,
      'to_user_id', p_to_user_id,
      'reason', btrim(p_reason)
    )
  );
end;
$$;

-- --------------------------------------------------------------------------
-- Server-side recurring generation and coverage escalation
-- --------------------------------------------------------------------------

create or replace function create_recurring_task_instance(
  p_template_id uuid,
  p_target_date date,
  p_assignments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template task_templates;
  v_task task_instances;
  v_assignment jsonb;
  v_normalized_assignments jsonb := '[]'::jsonb;
  v_item jsonb;
  v_original user_profiles;
  v_buddy user_profiles;
  v_effective uuid;
  v_expected_resolution text;
  v_requested_resolution text;
  v_blocked boolean := false;
  v_recipient uuid;
  v_recipient_ids jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_target_date is null or jsonb_typeof(p_assignments) <> 'array'
     or jsonb_array_length(p_assignments) = 0 then
    raise exception 'Target date and assignment array are required' using errcode = '22023';
  end if;

  select * into v_template
  from task_templates
  where id = p_template_id and is_active and task_type = 'checklist'
  for update;
  if v_template.id is null then
    raise exception 'Template not found' using errcode = '22023';
  end if;
  if v_template.category_id is null or not exists (
    select 1 from dropdown_masters dm
    where dm.id = v_template.category_id
      and dm.tenant_id = v_template.tenant_id
      and dm.master_type = 'task_category'
      and dm.is_active
  ) then
    raise exception 'Template category is invalid or inactive' using errcode = '23503';
  end if;

  for v_assignment in select value from jsonb_array_elements(p_assignments) loop
    if jsonb_typeof(v_assignment) <> 'object'
       or v_assignment - array[
         'original_assignee_id','effective_assignee_id','resolution'
       ] <> '{}'::jsonb then
      raise exception 'Recurring assignment contains unsupported fields'
        using errcode = '22023';
    end if;
    select * into v_original
    from user_profiles
    where id = nullif(v_assignment->>'original_assignee_id', '')::uuid
      and tenant_id = v_template.tenant_id
      and (v_template.branch_id is null or branch_id = v_template.branch_id)
      and (v_template.department_id is null or department_id = v_template.department_id)
      and (
        (v_template.default_assignee_type = 'specific_user'
          and id = v_template.default_assignee_user_id)
        or (v_template.default_assignee_type = 'role'
          and user_role = v_template.default_assignee_role)
      );
    if v_original.id is null then
      raise exception 'Original recurring doer is outside the template scope'
        using errcode = '23503';
    end if;

    v_effective := nullif(v_assignment->>'effective_assignee_id', '')::uuid;
    v_requested_resolution := v_assignment->>'resolution';
    v_buddy := null;
    if is_user_available_for_task(v_original.id, p_target_date) then
      v_expected_resolution := 'assigned';
      v_effective := v_original.id;
    else
      if v_original.buddy_id is not null then
        select * into v_buddy
        from user_profiles
        where id = v_original.buddy_id and tenant_id = v_template.tenant_id;
      end if;
      if v_buddy.id is not null and is_user_available_for_task(v_buddy.id, p_target_date) then
        v_expected_resolution := 'buddy';
        v_effective := v_buddy.id;
      else
        v_expected_resolution := 'blocked';
        v_effective := null;
        v_blocked := true;
      end if;
    end if;
    if v_requested_resolution is distinct from v_expected_resolution then
      raise exception 'Recurring assignment resolution is stale or invalid'
        using errcode = '22023';
    end if;
    if nullif(v_assignment->>'effective_assignee_id', '')::uuid is distinct from v_effective then
      raise exception 'Recurring effective assignee is stale or invalid'
        using errcode = '22023';
    end if;
    v_normalized_assignments := v_normalized_assignments || jsonb_build_array(
      jsonb_build_object(
        'original_assignee_id', v_original.id,
        'effective_assignee_id', v_effective,
        'resolution', v_expected_resolution
      )
    );
  end loop;

  insert into task_instances(
    tenant_id, branch_id, department_id, category_id, task_template_id,
    task_type, title, description, priority, status, planned_datetime,
    scheduled_date, requires_upload, requires_remark, requires_form,
    form_template_id, source, created_by
  ) values (
    v_template.tenant_id, v_template.branch_id, v_template.department_id,
    v_template.category_id, v_template.id, 'checklist', v_template.title,
    v_template.description, v_template.priority,
    case when v_blocked then 'blocked'::task_status else 'pending'::task_status end,
    (p_target_date::text || ' '
      || coalesce(v_template.planned_time, '23:59'::time)::text
      || ' Asia/Kolkata')::timestamptz,
    p_target_date, v_template.requires_upload, v_template.requires_remark,
    v_template.requires_form, v_template.form_template_id, 'checklist',
    coalesce(
      v_template.created_by,
      v_template.updated_by,
      (v_normalized_assignments->0->>'original_assignee_id')::uuid
    )
  )
  on conflict do nothing
  returning * into v_task;
  if v_task.id is null then return null; end if;

  for v_item in select value from jsonb_array_elements(v_template.checklist_items) loop
    insert into task_checklists(task_instance_id, item_text, is_required, sort_order)
    values (
      v_task.id, v_item->>'item_text',
      coalesce((v_item->>'is_required')::boolean, true),
      coalesce((v_item->>'sort_order')::integer, 0)
    );
  end loop;

  for v_assignment in select value from jsonb_array_elements(v_normalized_assignments) loop
    select * into v_original
    from user_profiles where id = (v_assignment->>'original_assignee_id')::uuid;
    v_effective := nullif(v_assignment->>'effective_assignee_id', '')::uuid;
    v_expected_resolution := v_assignment->>'resolution';

    if v_effective is not null then
      insert into task_assignees(
        task_instance_id, user_profile_id, role_at_task, is_original, is_active
      ) values (
        v_task.id, v_effective, 'doer', v_expected_resolution = 'assigned', true
      ) on conflict do nothing;
    end if;

    if v_expected_resolution = 'buddy' then
      insert into buddy_assignments(
        tenant_id, original_assignee_id, buddy_id, task_instance_id, date
      ) values (
        v_template.tenant_id, v_original.id, v_effective, v_task.id, p_target_date
      );
      insert into audit_logs(
        tenant_id, actor_user_id, action, module, record_id, old_value, new_value
      ) values (
        v_template.tenant_id, null, 'task_assignment_resolved', 'tasks', v_task.id,
        jsonb_build_object(
          'original_assignee_id', v_original.id,
          'availability_state', 'unavailable'
        ),
        jsonb_build_object(
          'resolution_state', 'buddy_assigned',
          'effective_assignee_id', v_effective
        )
      );
    elsif v_expected_resolution = 'assigned' then
      insert into audit_logs(
        tenant_id, actor_user_id, action, module, record_id, new_value
      ) values (
        v_template.tenant_id, null, 'task_assignment_resolved', 'tasks', v_task.id,
        jsonb_build_object(
          'original_assignee_id', v_original.id,
          'resolution_state', 'original_available'
        )
      );
    else
      v_recipient_ids := '[]'::jsonb;
      v_recipient := null;
      if v_template.department_id is not null then
        select d.head_id into v_recipient
        from departments d
        join user_profiles up on up.id = d.head_id
        where d.id = v_template.department_id
          and d.tenant_id = v_template.tenant_id
          and up.tenant_id = v_template.tenant_id
          and up.working_status = 'active';
      end if;
      if v_recipient is null and v_template.branch_id is not null then
        select b.manager_id into v_recipient
        from branches b
        join user_profiles up on up.id = b.manager_id
        where b.id = v_template.branch_id
          and b.tenant_id = v_template.tenant_id
          and up.tenant_id = v_template.tenant_id
          and up.working_status = 'active';
      end if;

      if v_recipient is not null then
        insert into notifications(
          tenant_id, user_profile_id, event_type, title, message, link_url
        ) values (
          v_template.tenant_id, v_recipient, 'task_coverage_required',
          'Task blocked for coverage',
          'No available doer or buddy was found for ' || v_template.title,
          '/tasks/checklist'
        );
        v_recipient_ids := jsonb_build_array(v_recipient);
      else
        for v_recipient in
          select up.id
          from user_profiles up
          where up.tenant_id = v_template.tenant_id
            and up.user_role in ('admin', 'super_admin')
            and up.working_status = 'active'
        loop
          insert into notifications(
            tenant_id, user_profile_id, event_type, title, message, link_url
          ) values (
            v_template.tenant_id, v_recipient, 'task_coverage_required',
            'Task blocked for coverage',
            'No available doer or buddy was found for ' || v_template.title,
            '/tasks/checklist'
          );
          v_recipient_ids := v_recipient_ids || jsonb_build_array(v_recipient);
        end loop;
      end if;

      insert into audit_logs(
        tenant_id, actor_user_id, action, module, record_id, old_value, new_value
      ) values (
        v_template.tenant_id, null, 'task_coverage_escalated', 'tasks', v_task.id,
        jsonb_build_object(
          'original_assignee_id', v_original.id,
          'availability_state', 'doer_and_buddy_unavailable'
        ),
        jsonb_build_object(
          'resolution_state', 'awaiting_coverage',
          'task_status', 'blocked',
          'notified_user_ids', v_recipient_ids
        )
      );
    end if;
  end loop;

  insert into audit_logs(
    tenant_id, actor_user_id, action, module, record_id, new_value
  ) values (
    v_template.tenant_id, null, 'recurring_task_generated', 'tasks', v_task.id,
    jsonb_build_object(
      'template_id', p_template_id,
      'scheduled_date', p_target_date,
      'coverage_state', case when v_blocked then 'blocked' else 'resolved' end,
      'assignments', v_normalized_assignments
    )
  );
  return v_task.id;
end;
$$;

-- Storage authorization remains doer/manager only. Watchers deliberately do
-- not satisfy is_task_participant() and therefore cannot upload evidence.
create or replace function can_write_task_attachment_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_task_id uuid;
  v_task_tenant uuid;
begin
  if not current_profile_is_active()
     or (storage.foldername(p_name))[1] <> current_tenant_id()::text then
    return false;
  end if;
  v_task_id := (storage.foldername(p_name))[2]::uuid;
  select tenant_id into v_task_tenant from task_instances where id = v_task_id;
  if v_task_tenant is distinct from current_tenant_id() then return false; end if;
  return current_role_level() in ('super_admin', 'admin', 'manager')
    or is_task_participant(v_task_id);
exception when invalid_text_representation or array_subscript_error then
  return false;
end;
$$;

create or replace function can_read_task_attachment_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_task_id uuid;
begin
  if not current_profile_is_active()
     or (storage.foldername(p_name))[1] <> current_tenant_id()::text then
    return false;
  end if;
  v_task_id := (storage.foldername(p_name))[2]::uuid;
  return can_read_task(v_task_id);
exception when invalid_text_representation or array_subscript_error then
  return false;
end;
$$;

create or replace function can_delete_unrecorded_task_attachment_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select can_write_task_attachment_object(p_name)
    and not exists (
      select 1
      from task_attachments ta
      where ta.file_url = p_name
    );
$$;

drop policy if exists task_attachment_objects_select on storage.objects;
create policy task_attachment_objects_select on storage.objects
for select to authenticated
using (
  bucket_id = 'task-attachments'
  and can_read_task_attachment_object(name)
);

drop policy if exists task_attachment_objects_delete on storage.objects;
create policy task_attachment_objects_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'task-attachments'
  and can_delete_unrecorded_task_attachment_object(name)
);

-- Keep blocked coverage tasks visible even though they intentionally have no
-- ordinary assignee. Shared tasks still emit one feed row per active doer.
drop view if exists v_all_tasks;
create view v_all_tasks with (security_invoker = true) as
  select
    ti.id, ti.tenant_id, ti.branch_id, ti.department_id, ti.category_id,
    ti.task_template_id, ti.task_type, ti.title, ti.description, ti.priority,
    ti.status, ti.created_by, ti.planned_datetime, ti.revised_datetime,
    ti.actual_datetime, ti.delay_minutes, ti.source, ti.requires_upload,
    ti.requires_remark, ti.requires_form, ti.form_template_id,
    ta.user_profile_id as assignee_id,
    coalesce(
      round(
        100.0 * count(tc.id) filter (where tc.is_required and tc.is_completed)
        / nullif(count(tc.id) filter (where tc.is_required), 0)
      ),
      case when count(tc.id) filter (where tc.is_required) = 0 then 100 else 0 end
    )::integer as checklist_completion_pct
  from task_instances ti
  left join task_assignees ta
    on ta.task_instance_id = ti.id and ta.is_active and ta.role_at_task = 'doer'
  left join task_checklists tc on tc.task_instance_id = ti.id
  group by ti.id, ta.user_profile_id
  union all
  select
    fis.id, fi.tenant_id, fi.branch_id, null::uuid, null::uuid, null::uuid,
    'fms'::task_type, fs.name, fs.method, fi.priority, fis.status, fi.started_by,
    fis.planned_datetime, null::timestamptz, fis.actual_datetime,
    fis.delay_minutes, 'fms'::text, fs.requires_upload, fs.requires_remark,
    (fs.form_template_id is not null), fs.form_template_id,
    unnest(fis.assigned_to), 0
  from fms_instance_stages fis
  join fms_instances fi on fi.id = fis.fms_instance_id
  join fms_stages fs on fs.id = fis.fms_stage_id;

grant select on v_all_tasks to authenticated;

-- --------------------------------------------------------------------------
-- Least-privilege SECURITY DEFINER execution
-- --------------------------------------------------------------------------

do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public', v_function.identity);
  end loop;
end;
$$;

grant execute on function current_profile() to authenticated;
grant execute on function current_role_level() to authenticated;
grant execute on function current_tenant_id() to authenticated;
grant execute on function current_branch_id() to authenticated;
grant execute on function is_super_admin() to authenticated;
grant execute on function current_profile_is_active() to authenticated;
grant execute on function is_task_participant(uuid) to authenticated;
grant execute on function is_task_watcher(uuid) to authenticated;
grant execute on function can_read_task(uuid) to authenticated;
grant execute on function is_fms_instance_participant(uuid) to authenticated;
grant execute on function can_write_task_attachment_object(text) to authenticated;
grant execute on function can_read_task_attachment_object(text) to authenticated;
grant execute on function can_delete_unrecorded_task_attachment_object(text) to authenticated;

grant execute on function update_user_profile_with_audit(uuid, jsonb) to authenticated;
grant execute on function submit_resignation_with_audit(uuid, jsonb, jsonb) to authenticated;
grant execute on function review_resignation_with_audit(uuid, text) to authenticated;
grant execute on function change_dropdown_with_audit(text, uuid, text, text, text, integer, boolean) to authenticated;

grant execute on function save_task_template_with_audit(uuid, jsonb) to authenticated;
grant execute on function create_delegation_task_with_audit(jsonb, uuid[], uuid[], jsonb) to authenticated;
grant execute on function use_task_template_with_audit(uuid, timestamptz) to authenticated;
grant execute on function update_task_with_audit(uuid, text, uuid, boolean, text) to authenticated;
grant execute on function add_task_attachment_with_audit(uuid, text) to authenticated;
grant execute on function delegate_task_with_audit(uuid, uuid, uuid, text) to authenticated;
grant execute on function revise_task_datetime_with_audit(uuid, timestamptz, text) to authenticated;
grant execute on function record_availability_with_audit(uuid, date, availability_status, text) to authenticated;

grant execute on function invite_profile_with_audit(
  uuid, uuid, text, text, uuid, uuid, uuid, text, text, text[], user_role, text, uuid
) to service_role;
grant execute on function create_recurring_task_instance(uuid, date, jsonb) to service_role;
