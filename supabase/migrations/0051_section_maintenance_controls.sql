-- Tenant-scoped, audited controls for temporarily taking application sections offline.
-- The controls are intentionally separate from ordinary organization settings so
-- availability changes have a narrow, reviewable authorization surface.

set search_path = public, extensions;

create table tenant_section_controls (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  developer_mode_enabled boolean not null default false,
  section_availability jsonb not null default '{}'::jsonb,
  settings_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references user_profiles(id),
  constraint tenant_section_controls_availability_object check (jsonb_typeof(section_availability) = 'object'),
  constraint tenant_section_controls_version check (settings_version >= 0)
);

alter table tenant_section_controls enable row level security;
revoke all on tenant_section_controls from public, anon, authenticated, service_role;

create function default_section_availability()
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'home', true, 'dashboard', true, 'crm', true, 'checklist_tasks', true,
    'delegation_tasks', true, 'fms_tasks', true, 'fms_builder', true,
    'forms_library', true, 'meeting_ai', true, 'notifications', true,
    'users', true, 'availability', true, 'reports', true,
    'dropdown_master', true, 'settings', true
  );
$$;

create function validated_section_availability(p_availability jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_key text;
begin
  perform assert_json_keys(p_availability, array[
    'home','dashboard','crm','checklist_tasks','delegation_tasks','fms_tasks',
    'fms_builder','forms_library','meeting_ai','notifications','users',
    'availability','reports','dropdown_master','settings'
  ], 'section availability');

  for v_key in select jsonb_object_keys(p_availability) loop
    if jsonb_typeof(p_availability -> v_key) <> 'boolean' then
      raise exception 'Section availability values must be boolean' using errcode = '22023';
    end if;
  end loop;

  return default_section_availability() || p_availability;
end $$;

create function get_section_availability()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles; c tenant_section_controls;
begin
  a := assert_reporting_actor();
  select * into c from tenant_section_controls where tenant_id = a.tenant_id;
  return jsonb_build_object(
    'developer_mode_enabled', coalesce(c.developer_mode_enabled, false),
    'settings_version', coalesce(c.settings_version, 0),
    'section_availability', default_section_availability() || coalesce(c.section_availability, '{}'::jsonb)
  );
end $$;

create function save_section_availability_with_audit(
  p_developer_mode_enabled boolean,
  p_section_availability jsonb,
  p_expected_version integer,
  p_request_key uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a user_profiles; c tenant_section_controls; v_old jsonb; v_clean jsonb; v_replay jsonb;
begin
  a := assert_reporting_actor();
  if a.user_role not in ('super_admin', 'admin') then
    raise exception 'Section controls denied' using errcode = '42501';
  end if;
  if p_developer_mode_enabled is null or p_expected_version is null or p_expected_version < 0 or p_request_key is null then
    raise exception 'Developer mode, version, and request key are required' using errcode = '22023';
  end if;
  v_clean := validated_section_availability(p_section_availability);

  select result into v_replay from settings_mutation_keys
    where tenant_id = a.tenant_id and actor_id = a.id and operation = 'section_availability' and request_key = p_request_key;
  if v_replay is not null then return v_replay; end if;

  select * into c from tenant_section_controls where tenant_id = a.tenant_id for update;
  if c.tenant_id is null then
    if p_expected_version <> 0 then raise exception 'Section controls changed; refresh and retry' using errcode = '40001'; end if;
    insert into tenant_section_controls(tenant_id, developer_mode_enabled, section_availability, settings_version, updated_by)
    values(a.tenant_id, p_developer_mode_enabled, v_clean, 1, a.id)
    returning * into c;
    v_old := jsonb_build_object('developer_mode_enabled', false, 'section_availability', default_section_availability(), 'settings_version', 0);
  else
    if c.settings_version <> p_expected_version then raise exception 'Section controls changed; refresh and retry' using errcode = '40001'; end if;
    v_old := jsonb_build_object('developer_mode_enabled', c.developer_mode_enabled, 'section_availability', c.section_availability, 'settings_version', c.settings_version);
    update tenant_section_controls set developer_mode_enabled = p_developer_mode_enabled, section_availability = v_clean,
      settings_version = settings_version + 1, updated_at = now(), updated_by = a.id
      where tenant_id = a.tenant_id returning * into c;
  end if;

  v_replay := jsonb_build_object('developer_mode_enabled', c.developer_mode_enabled, 'section_availability', c.section_availability, 'settings_version', c.settings_version);
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values(a.tenant_id, a.id, 'section_availability_saved', 'developer_controls', a.tenant_id, v_old, v_replay || jsonb_build_object('request_key', p_request_key));
  insert into settings_mutation_keys(tenant_id, actor_id, operation, request_key, result)
    values(a.tenant_id, a.id, 'section_availability', p_request_key, v_replay);
  return v_replay;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('default_section_availability', 'validated_section_availability', 'get_section_availability', 'save_section_availability_with_audit')
  loop
    execute format('alter function %s owner to postgres', f.identity);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.identity);
  end loop;
end $$;

grant execute on function get_section_availability(), save_section_availability_with_audit(boolean, jsonb, integer, uuid) to authenticated;

notify pgrst, 'reload schema';
