-- Developer Mode is an operational safety control reserved for active Super
-- Admins. Keep the 0051 contract intact while narrowing its authorization.

set search_path = public, extensions;

create or replace function save_section_availability_with_audit(
  p_developer_mode_enabled boolean,
  p_section_availability jsonb,
  p_expected_version integer,
  p_request_key uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a user_profiles; c tenant_section_controls; v_old jsonb; v_clean jsonb; v_replay jsonb;
begin
  a := assert_reporting_actor();
  if a.user_role <> 'super_admin' then
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

alter function save_section_availability_with_audit(boolean, jsonb, integer, uuid) owner to postgres;
revoke all on function save_section_availability_with_audit(boolean, jsonb, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function save_section_availability_with_audit(boolean, jsonb, integer, uuid) to authenticated;

notify pgrst, 'reload schema';
