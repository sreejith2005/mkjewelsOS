-- CSV task imports are intentionally metadata-only: source file contents and
-- row text are never stored outside the tasks and audit records they create.
create table task_import_batches (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  created_by uuid not null references user_profiles(id),
  import_hash text not null check (import_hash ~ '^[a-f0-9]{64}$'),
  source_headers text[] not null,
  requested_count integer not null check (requested_count between 1 and 500),
  created_count integer not null default 0 check (created_count between 0 and 500),
  rejected_count integer not null default 0 check (rejected_count between 0 and 500),
  created_at timestamptz not null default now(),
  unique (tenant_id, import_hash)
);

create index idx_task_import_batches_tenant_created_at
  on task_import_batches(tenant_id, created_at desc);

alter table task_import_batches enable row level security;

create policy task_import_batches_select
  on task_import_batches for select to authenticated
  using (
    current_profile_is_active()
    and tenant_id = current_tenant_id()
    and (created_by = (current_profile()).id or current_role_level() in ('super_admin', 'admin'))
  );

revoke all on table task_import_batches from public, anon, authenticated, service_role;
grant select on task_import_batches to authenticated;

create function import_delegation_tasks_with_audit(p_rows jsonb, p_import_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_row jsonb;
  v_batch task_import_batches;
  v_task_id uuid;
  v_doer_id uuid;
  v_name_id uuid;
  v_email_id uuid;
  v_name_count integer;
  v_email_count integer;
  v_branch_id uuid;
  v_department_id uuid;
  v_category_id uuid;
  v_payload jsonb;
  v_checklist jsonb;
  v_headers text[];
  v_requested integer;
  v_created integer := 0;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin', 'admin', 'manager') then
    raise exception 'Task import denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Task import must contain 1 to 500 rows' using errcode = '22023';
  end if;
  if coalesce(p_import_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Task import hash is invalid' using errcode = '22023';
  end if;

  select * into v_batch from task_import_batches
  where tenant_id = v_actor.tenant_id and import_hash = p_import_hash;
  if v_batch.id is not null then
    return jsonb_build_object('batch_id', v_batch.id, 'created_count', v_batch.created_count, 'rejected_count', v_batch.rejected_count, 'replayed', true);
  end if;

  select coalesce(array_agg(key order by key), '{}'::text[])
  into v_headers
  from jsonb_object_keys(p_rows -> 0) key;
  v_requested := jsonb_array_length(p_rows);
  insert into task_import_batches(tenant_id, created_by, import_hash, source_headers, requested_count)
  values (v_actor.tenant_id, v_actor.id, p_import_hash, v_headers, v_requested)
  returning * into v_batch;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object'
       or v_row - array['title','doer_name','doer_email','description','due_at','priority','category','branch','department','checklist','frequency','source_rows'] <> '{}'::jsonb then
      raise exception 'Task import row contains unsupported fields' using errcode = '22023';
    end if;
    if nullif(btrim(v_row ->> 'title'), '') is null or length(btrim(v_row ->> 'title')) > 200 then
      raise exception 'Task import title must contain 1 to 200 characters' using errcode = '22023';
    end if;
    if coalesce(nullif(lower(btrim(v_row ->> 'frequency')), ''), 'once') <> 'once' then
      raise exception 'Recurring task imports are not available yet' using errcode = '22023';
    end if;
    if nullif(btrim(v_row ->> 'doer_name'), '') is null and nullif(lower(btrim(v_row ->> 'doer_email')), '') is null then
      raise exception 'Task import doer is required' using errcode = '22023';
    end if;

    select count(*), (array_agg(id order by id))[1] into v_name_count, v_name_id
    from user_profiles
    where tenant_id = v_actor.tenant_id and working_status = 'active' and is_login_enabled
      and nullif(btrim(v_row ->> 'doer_name'), '') is not null
      and lower(btrim(employee_name)) = lower(btrim(v_row ->> 'doer_name'));
    select count(*), (array_agg(id order by id))[1] into v_email_count, v_email_id
    from user_profiles
    where tenant_id = v_actor.tenant_id and working_status = 'active' and is_login_enabled
      and nullif(lower(btrim(v_row ->> 'doer_email')), '') is not null
      and lower(btrim(email)) = lower(btrim(v_row ->> 'doer_email'));
    if (nullif(btrim(v_row ->> 'doer_name'), '') is not null and v_name_count <> 1)
       or (nullif(lower(btrim(v_row ->> 'doer_email')), '') is not null and v_email_count <> 1)
       or (v_name_id is not null and v_email_id is not null and v_name_id <> v_email_id) then
      raise exception 'Task import doer is unresolved or ambiguous' using errcode = '23503';
    end if;
    v_doer_id := coalesce(v_name_id, v_email_id);

    v_branch_id := v_actor.branch_id;
    if nullif(btrim(v_row ->> 'branch'), '') is not null then
      select id into v_branch_id from branches
      where tenant_id = v_actor.tenant_id and is_active
        and (lower(btrim(name)) = lower(btrim(v_row ->> 'branch')) or lower(btrim(code)) = lower(btrim(v_row ->> 'branch')));
    end if;
    v_department_id := v_actor.department_id;
    if nullif(btrim(v_row ->> 'department'), '') is not null then
      select id into v_department_id from departments
      where tenant_id = v_actor.tenant_id and is_active and branch_id = v_branch_id
        and (lower(btrim(name)) = lower(btrim(v_row ->> 'department')) or lower(btrim(code)) = lower(btrim(v_row ->> 'department')));
    end if;
    select id into v_category_id from dropdown_masters
    where tenant_id = v_actor.tenant_id and master_type = 'task_category' and is_active
      and (nullif(btrim(v_row ->> 'category'), '') is null or lower(btrim(label)) = lower(btrim(v_row ->> 'category')) or lower(btrim(value)) = lower(btrim(v_row ->> 'category')))
    order by sort_order, label limit 1;
    if v_category_id is null then
      raise exception 'Task import category is invalid or unavailable' using errcode = '23503';
    end if;
    if jsonb_typeof(coalesce(v_row -> 'checklist', '[]'::jsonb)) <> 'array' then
      raise exception 'Task import checklist is invalid' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('item_text', btrim(value), 'is_required', true, 'sort_order', ordinality - 1) order by ordinality), '[]'::jsonb)
    into v_checklist
    from jsonb_array_elements_text(coalesce(v_row -> 'checklist', '[]'::jsonb)) with ordinality items(value, ordinality)
    where nullif(btrim(value), '') is not null;
    v_payload := jsonb_build_object(
      'title', btrim(v_row ->> 'title'),
      'description', nullif(btrim(v_row ->> 'description'), ''),
      'planned_datetime', coalesce(nullif(btrim(v_row ->> 'due_at'), ''), now()::text),
      'priority', coalesce(nullif(lower(btrim(v_row ->> 'priority')), ''), 'medium'),
      'branch_id', v_branch_id,
      'department_id', v_department_id,
      'category_id', v_category_id,
      'requires_upload', false,
      'requires_remark', false,
      'requires_form', false,
      'form_template_id', null
    );
    v_task_id := create_delegation_task_with_audit(v_payload, array[v_doer_id], '{}'::uuid[], v_checklist);
    v_created := v_created + 1;
  end loop;

  update task_import_batches set created_count = v_created where id = v_batch.id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'delegation_tasks_imported', 'task_import_batches', v_batch.id,
    jsonb_build_object('requested_count', v_requested, 'created_count', v_created, 'import_hash', p_import_hash));
  return jsonb_build_object('batch_id', v_batch.id, 'created_count', v_created, 'rejected_count', 0, 'replayed', false);
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'Task import contains an invalid date, priority, or identifier' using errcode = '22023';
end;
$$;

revoke all on function import_delegation_tasks_with_audit(jsonb, text) from public, anon, service_role;
grant execute on function import_delegation_tasks_with_audit(jsonb, text) to authenticated;

notify pgrst, 'reload schema';
