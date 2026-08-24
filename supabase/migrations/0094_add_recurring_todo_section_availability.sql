-- Keep the section-maintenance RPC contract aligned with the Recurring / To-Do
-- route introduced in the shared role menu.

set search_path = public, extensions;

create or replace function default_section_availability()
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'home', true, 'dashboard', true, 'crm', true, 'checklist_tasks', true,
    'recurring_todo', true, 'delegation_tasks', true, 'fms_tasks', true,
    'fms_builder', true, 'forms_library', true, 'meeting_ai', true,
    'notifications', true, 'users', true, 'availability', true,
    'reports', true, 'dropdown_master', true, 'settings', true
  );
$$;

create or replace function validated_section_availability(p_availability jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_key text;
begin
  perform assert_json_keys(p_availability, array[
    'home','dashboard','crm','checklist_tasks','recurring_todo',
    'delegation_tasks','fms_tasks','fms_builder','forms_library','meeting_ai',
    'notifications','users','availability','reports','dropdown_master','settings'
  ], 'section availability');

  for v_key in select jsonb_object_keys(p_availability) loop
    if jsonb_typeof(p_availability -> v_key) <> 'boolean' then
      raise exception 'Section availability values must be boolean' using errcode = '22023';
    end if;
  end loop;

  return default_section_availability() || p_availability;
end $$;

alter function default_section_availability() owner to postgres;
alter function validated_section_availability(jsonb) owner to postgres;

notify pgrst, 'reload schema';
