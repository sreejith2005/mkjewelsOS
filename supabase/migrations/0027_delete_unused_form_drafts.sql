-- A form definition can be permanently removed only while it is an unused
-- draft. Published versions and any version with history remain immutable so
-- submissions and task links always retain their exact historical template.
create or replace function delete_form_draft_with_audit(p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_template form_templates;
  v_field_count integer;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin', 'admin', 'manager') then
    raise exception 'Only active form authors can delete form drafts' using errcode = '42501';
  end if;

  select * into v_template from form_templates where id = p_template_id for update;
  if v_template.id is null or v_template.tenant_id <> v_actor.tenant_id or v_template.lifecycle <> 'draft' then
    raise exception 'Only an unused form draft can be deleted' using errcode = '42501';
  end if;
  if exists (select 1 from form_submissions where form_template_id = v_template.id) then
    raise exception 'Forms with submissions cannot be deleted; archive them instead' using errcode = '23503';
  end if;
  if exists (select 1 from form_links where form_template_id = v_template.id)
     or exists (select 1 from task_instances where form_template_id = v_template.id) then
    raise exception 'Forms linked to work cannot be deleted; archive them instead' using errcode = '23503';
  end if;

  select count(*) into v_field_count from form_fields where form_template_id = v_template.id;
  delete from form_fields where form_template_id = v_template.id;
  delete from form_templates where id = v_template.id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (
    v_actor.tenant_id, v_actor.id, 'form_draft_deleted', 'forms', v_template.id,
    jsonb_build_object('template', to_jsonb(v_template), 'field_count', v_field_count),
    jsonb_build_object('deleted', true)
  );
  return v_template.id;
end;
$$;

revoke all privileges on function delete_form_draft_with_audit(uuid) from public, anon, authenticated, service_role;
grant execute on function delete_form_draft_with_audit(uuid) to authenticated;

notify pgrst, 'reload schema';
