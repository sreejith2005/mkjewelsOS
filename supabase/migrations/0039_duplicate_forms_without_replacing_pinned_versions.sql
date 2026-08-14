-- Published form versions can be referenced by active FMS stages. Editing or
-- duplicating them therefore creates an independent draft family rather than
-- replacing the pinned version and changing work already in progress.
create or replace function duplicate_form_with_audit(
  p_source_template_id uuid,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_source form_templates;
  v_new form_templates;
  v_name text;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin', 'admin', 'manager') then
    raise exception 'Only active form authors can duplicate forms' using errcode = '42501';
  end if;

  select * into v_source from form_templates where id = p_source_template_id for share;
  if v_source.id is null or v_source.tenant_id <> v_actor.tenant_id then
    raise exception 'Form to duplicate was not found' using errcode = '42501';
  end if;

  v_name := btrim(coalesce(nullif(p_name, ''), 'Copy of ' || v_source.name));
  if length(v_name) not between 1 and 150 then
    raise exception 'Duplicated form name must be between 1 and 150 characters' using errcode = '22023';
  end if;

  insert into form_templates(
    tenant_id, family_id, version, lifecycle, is_active, name, description,
    branch_id, department_id, permissions, created_by, updated_by, published_at
  ) values (
    v_actor.tenant_id, extensions.uuid_generate_v4(), 1, 'draft', false,
    v_name, v_source.description, null, null, v_source.permissions,
    v_actor.id, v_actor.id, null
  ) returning * into v_new;

  insert into form_fields(
    form_template_id, field_key, field_name, field_type, group_name,
    is_shown, is_editable, is_required, initial_value, options,
    conditional_logic, sort_order, validation, placeholder, helper_text
  )
  select v_new.id, field_key, field_name, field_type, group_name,
    is_shown, is_editable, is_required, initial_value, options,
    null, sort_order, validation, placeholder, helper_text
  from form_fields
  where form_template_id = v_source.id
  order by sort_order;

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'form_duplicated', 'forms', v_new.id,
    jsonb_build_object('source_template_id', v_source.id), to_jsonb(v_new));
  return v_new.id;
end;
$$;

revoke all privileges on function duplicate_form_with_audit(uuid, text) from public, anon, authenticated, service_role;
grant execute on function duplicate_form_with_audit(uuid, text) to authenticated;
notify pgrst, 'reload schema';
