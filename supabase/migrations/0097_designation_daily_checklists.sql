set search_path = public, extensions;

create table designation_daily_checklists (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  designation_id uuid not null references dropdown_masters(id),
  title text not null check (char_length(title) between 1 and 120),
  instruction text check (instruction is null or char_length(instruction) between 1 and 500),
  items jsonb not null,
  confirmation_text text not null check (char_length(confirmation_text) between 1 and 240),
  is_active boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references user_profiles(id),
  updated_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, designation_id)
);

create table daily_checklist_acknowledgements (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_profile_id uuid not null references user_profiles(id) on delete cascade,
  designation_id uuid not null references dropdown_masters(id),
  checklist_id uuid not null references designation_daily_checklists(id),
  checklist_revision integer not null check (checklist_revision > 0),
  acknowledgement_date date not null,
  checklist_title text not null,
  checklist_items jsonb not null,
  confirmation_text text not null,
  acknowledged_at timestamptz not null default now(),
  created_by uuid not null references user_profiles(id),
  updated_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_profile_id, acknowledgement_date)
);

create index daily_checklist_acknowledgements_employee_date_idx
  on daily_checklist_acknowledgements (tenant_id, user_profile_id, acknowledgement_date desc);

alter table designation_daily_checklists enable row level security;
alter table daily_checklist_acknowledgements enable row level security;
revoke all on table designation_daily_checklists, daily_checklist_acknowledgements from public, anon, authenticated;

create or replace function validate_daily_checklist_items(p_items jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_item jsonb; v_clean jsonb := '[]'::jsonb; v_id uuid; v_text text; v_ids uuid[] := '{}';
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'Checklist must contain between 1 and 20 items' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Checklist item ID is invalid' using errcode = '22023';
    end if;
    v_id := (v_item->>'id')::uuid;
    v_text := btrim(coalesce(v_item->>'text', ''));
    if char_length(v_text) not between 1 and 500 then
      raise exception 'Checklist item text is invalid' using errcode = '22023';
    end if;
    if v_id = any(v_ids) then raise exception 'Checklist item IDs must be unique' using errcode = '22023'; end if;
    v_ids := array_append(v_ids, v_id);
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('id', v_id::text, 'text', v_text));
  end loop;
  return v_clean;
end $$;

create or replace function get_my_daily_checklist_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare a user_profiles; c designation_daily_checklists; v_date date := timezone('Asia/Kolkata', now())::date; v_weekday text := lower(trim(to_char(timezone('Asia/Kolkata', now()), 'FMDay')));
begin
  select * into a from current_profile();
  if a.id is null or a.account_status is distinct from 'active' or a.is_login_enabled is distinct from true
    or a.working_status <> 'active' or a.designation_id is null or v_weekday = any(coalesce(a.week_off, '{}'::text[])) then
    return jsonb_build_object('required', false, 'date', v_date);
  end if;
  if exists (select 1 from daily_checklist_acknowledgements x where x.tenant_id = a.tenant_id and x.user_profile_id = a.id and x.acknowledgement_date = v_date) then
    return jsonb_build_object('required', false, 'date', v_date);
  end if;
  select * into c from designation_daily_checklists where tenant_id = a.tenant_id and designation_id = a.designation_id and is_active;
  if c.id is null then return jsonb_build_object('required', false, 'date', v_date); end if;
  return jsonb_build_object('required', true, 'date', v_date, 'checklist', jsonb_build_object(
    'id', c.id, 'designationId', c.designation_id, 'title', c.title, 'instruction', c.instruction,
    'items', c.items, 'confirmationText', c.confirmation_text, 'revision', c.revision
  ));
end $$;

create or replace function acknowledge_daily_checklist_with_audit(p_checklist_id uuid, p_revision integer, p_checked_item_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare a user_profiles; c designation_daily_checklists; x daily_checklist_acknowledgements; v_date date := timezone('Asia/Kolkata', now())::date; v_weekday text := lower(trim(to_char(timezone('Asia/Kolkata', now()), 'FMDay'))); v_expected uuid[];
begin
  select * into a from current_profile();
  if a.id is null or a.account_status is distinct from 'active' or a.is_login_enabled is distinct from true
    or a.working_status <> 'active' or a.designation_id is null or v_weekday = any(coalesce(a.week_off, '{}'::text[])) then
    raise exception 'Daily checklist acknowledgement is not required' using errcode = '22023';
  end if;
  select * into x from daily_checklist_acknowledgements where tenant_id = a.tenant_id and user_profile_id = a.id and acknowledgement_date = v_date;
  if x.id is not null then return get_my_daily_checklist_status(); end if;
  select * into c from designation_daily_checklists where id = p_checklist_id and tenant_id = a.tenant_id and designation_id = a.designation_id and is_active for update;
  if c.id is null then raise exception 'Daily checklist is not available' using errcode = '42501'; end if;
  if p_revision is null or p_revision <> c.revision then raise exception 'Daily checklist changed; refresh and retry' using errcode = '40001'; end if;
  if p_checked_item_ids is null or cardinality(p_checked_item_ids) <> cardinality(array(select distinct unnest(p_checked_item_ids))) then
    raise exception 'All displayed checklist items must be checked' using errcode = '22023';
  end if;
  select array_agg((value->>'id')::uuid order by (value->>'id')::uuid) into v_expected from jsonb_array_elements(c.items);
  if array(select unnest(p_checked_item_ids) order by 1) is distinct from v_expected then
    raise exception 'All displayed checklist items must be checked' using errcode = '22023';
  end if;
  insert into daily_checklist_acknowledgements(tenant_id, user_profile_id, designation_id, checklist_id, checklist_revision, acknowledgement_date, checklist_title, checklist_items, confirmation_text, created_by, updated_by)
  values(a.tenant_id, a.id, a.designation_id, c.id, c.revision, v_date, c.title, c.items, c.confirmation_text, a.id, a.id);
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values(a.tenant_id, a.id, 'daily_checklist_acknowledged', 'daily_checklist', c.id, null, jsonb_build_object('revision', c.revision, 'acknowledgement_date', v_date, 'item_count', jsonb_array_length(c.items)));
  return get_my_daily_checklist_status();
end $$;

create or replace function list_designation_daily_checklists()
returns jsonb language plpgsql security definer set search_path = public as $$
declare a user_profiles;
begin
  select * into a from current_profile();
  if a.id is null or a.user_role not in ('super_admin', 'hr') then raise exception 'Daily checklist management denied' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'designationId', c.designation_id, 'designationLabel', d.label, 'title', c.title, 'instruction', c.instruction, 'items', c.items, 'confirmationText', c.confirmation_text, 'isActive', c.is_active, 'revision', c.revision) order by d.label)
    from designation_daily_checklists c join dropdown_masters d on d.id = c.designation_id where c.tenant_id = a.tenant_id), '[]'::jsonb);
end $$;

create or replace function save_designation_daily_checklist_with_audit(p_checklist_id uuid, p_designation_id uuid, p_title text, p_instruction text, p_items jsonb, p_confirmation_text text, p_is_active boolean, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a user_profiles; c designation_daily_checklists; v_clean jsonb; v_title text := btrim(coalesce(p_title, '')); v_instruction text := nullif(btrim(coalesce(p_instruction, '')), ''); v_confirmation text := btrim(coalesce(p_confirmation_text, '')); v_old jsonb;
begin
  select * into a from current_profile();
  if a.id is null or a.user_role not in ('super_admin', 'hr') then raise exception 'Daily checklist management denied' using errcode = '42501'; end if;
  if v_title = '' or char_length(v_title) > 120 or (v_instruction is not null and char_length(v_instruction) > 500) or v_confirmation = '' or char_length(v_confirmation) > 240 then raise exception 'Daily checklist text is invalid' using errcode = '22023'; end if;
  if not exists(select 1 from dropdown_masters d where d.id = p_designation_id and d.tenant_id = a.tenant_id and d.master_type = 'designation' and d.is_active) then raise exception 'Designation is invalid' using errcode = '23503'; end if;
  v_clean := validate_daily_checklist_items(p_items);
  select * into c from designation_daily_checklists where tenant_id = a.tenant_id and designation_id = p_designation_id for update;
  if c.id is null then
    if p_checklist_id is not null or coalesce(p_expected_revision, -1) <> 0 then raise exception 'Daily checklist changed; refresh and retry' using errcode = '40001'; end if;
    insert into designation_daily_checklists(tenant_id, designation_id, title, instruction, items, confirmation_text, is_active, created_by, updated_by)
    values(a.tenant_id, p_designation_id, v_title, v_instruction, v_clean, v_confirmation, coalesce(p_is_active, false), a.id, a.id) returning * into c;
    v_old := null;
  else
    if p_checklist_id is distinct from c.id or p_expected_revision is distinct from c.revision then raise exception 'Daily checklist changed; refresh and retry' using errcode = '40001'; end if;
    v_old := jsonb_build_object('revision', c.revision, 'isActive', c.is_active, 'itemCount', jsonb_array_length(c.items));
    update designation_daily_checklists set title = v_title, instruction = v_instruction, items = v_clean, confirmation_text = v_confirmation, is_active = coalesce(p_is_active, false), revision = case when row(title, instruction, items, confirmation_text) is distinct from row(v_title, v_instruction, v_clean, v_confirmation) then revision + 1 else revision end, updated_by = a.id, updated_at = now() where id = c.id returning * into c;
  end if;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values(a.tenant_id, a.id, 'daily_checklist_saved', 'daily_checklist', c.id, v_old, jsonb_build_object('revision', c.revision, 'isActive', c.is_active, 'itemCount', jsonb_array_length(c.items)));
  return jsonb_build_object('id', c.id, 'revision', c.revision);
end $$;

revoke all on function validate_daily_checklist_items(jsonb) from public, anon, authenticated, service_role;
revoke all on function get_my_daily_checklist_status() from public, anon, authenticated, service_role;
revoke all on function acknowledge_daily_checklist_with_audit(uuid, integer, uuid[]) from public, anon, authenticated, service_role;
revoke all on function list_designation_daily_checklists() from public, anon, authenticated, service_role;
revoke all on function save_designation_daily_checklist_with_audit(uuid, uuid, text, text, jsonb, text, boolean, integer) from public, anon, authenticated, service_role;
grant execute on function get_my_daily_checklist_status(), acknowledge_daily_checklist_with_audit(uuid, integer, uuid[]), list_designation_daily_checklists(), save_designation_daily_checklist_with_audit(uuid, uuid, text, text, jsonb, text, boolean, integer) to authenticated;
notify pgrst, 'reload schema';
