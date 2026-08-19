-- Form authors may remove any unused form version, including a published one.
-- Historical submissions and workflow/task references remain immutable.
create or replace function enforce_form_template_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.lifecycle in ('published', 'archived')
       and current_setting('jewelos.allow_form_deletion', true) is distinct from 'on' then
      raise exception 'Published and archived form definitions are immutable; delete them through the audited form deletion action' using errcode = '55000';
    end if;
    return old;
  end if;

  if old.lifecycle in ('published', 'archived') then
    if old.lifecycle = 'published' and new.lifecycle = 'archived'
       and (to_jsonb(new) - array['lifecycle','is_active','archived_by','archived_at','updated_by','updated_at'])
         = (to_jsonb(old) - array['lifecycle','is_active','archived_by','archived_at','updated_by','updated_at']) then
      return new;
    end if;
    raise exception 'Published and archived form definitions are immutable; create a revision' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function enforce_form_field_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_template_id uuid := coalesce(new.form_template_id, old.form_template_id);
begin
  if current_setting('jewelos.allow_form_definition_bootstrap', true) = 'on'
     or current_setting('jewelos.allow_form_deletion', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from form_templates
    where id = v_template_id and lifecycle = 'published'
      and created_by is null and published_by is null
  ) then
    return new;
  end if;
  if exists (select 1 from form_templates where id = v_template_id and lifecycle in ('published','archived')) then
    raise exception 'Fields on published and archived forms are immutable; create a revision' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function delete_form_with_audit(p_template_id uuid)
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
     or not can_manage_form_template(p_template_id) then
    raise exception 'Only authorized active form authors can delete this form' using errcode = '42501';
  end if;

  select * into v_template from form_templates where id = p_template_id for update;
  if v_template.id is null or v_template.tenant_id <> v_actor.tenant_id then
    raise exception 'Form to delete was not found' using errcode = '42501';
  end if;
  if exists (select 1 from form_submissions where form_template_id = v_template.id) then
    raise exception 'Forms with submissions cannot be deleted' using errcode = '23503';
  end if;
  if exists (select 1 from form_links where form_template_id = v_template.id)
     or exists (select 1 from task_instances where form_template_id = v_template.id)
     or exists (select 1 from fms_stages where form_template_id = v_template.id) then
    raise exception 'Forms linked to tasks or FMS stages cannot be deleted' using errcode = '23503';
  end if;

  select count(*) into v_field_count from form_fields where form_template_id = v_template.id;
  perform set_config('jewelos.allow_form_deletion', 'on', true);
  delete from form_templates where id = v_template.id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (
    v_actor.tenant_id, v_actor.id, 'form_deleted', 'forms', v_template.id,
    jsonb_build_object('template', to_jsonb(v_template), 'field_count', v_field_count),
    jsonb_build_object('deleted', true)
  );
  return v_template.id;
end;
$$;

-- Seed useful starter questions into every existing empty form. The migration
-- only fills templates with zero fields and never changes an authored form.
select set_config('jewelos.allow_form_definition_bootstrap', 'on', true);
with empty_templates as (
  select id, name from form_templates ft
  where not exists (select 1 from form_fields ff where ff.form_template_id = ft.id)
), starter_fields as (
  select empty_templates.id, v.*
  from empty_templates
  cross join lateral (
    values
      (0, case name when 'Walk-in Form' then 'customer_name' when 'Task Completion Form' then 'completion_summary' when 'FMS Stage Completion Form' then 'stage_summary' when 'Resignation Form' then 'requested_last_working_day' else 'response_details' end,
       case name when 'Walk-in Form' then 'Customer name' when 'Task Completion Form' then 'Completion summary' when 'FMS Stage Completion Form' then 'Stage completion summary' when 'Resignation Form' then 'Requested last working day' else 'Response details' end,
       case when name = 'Resignation Form' then 'date' else 'textarea' end, true),
      (1, case name when 'Walk-in Form' then 'customer_phone' when 'Task Completion Form' then 'completed_on' when 'FMS Stage Completion Form' then 'completion_notes' when 'Resignation Form' then 'reason' else 'notes' end,
       case name when 'Walk-in Form' then 'Customer phone number' when 'Task Completion Form' then 'Completion date' when 'FMS Stage Completion Form' then 'Completion notes' when 'Resignation Form' then 'Reason for resignation' else 'Additional notes' end,
       case when name = 'Walk-in Form' then 'phone' when name = 'Task Completion Form' then 'date' else 'textarea' end,
       name in ('Walk-in Form', 'Task Completion Form', 'Resignation Form')),
      (2, case name when 'Walk-in Form' then 'visit_purpose' when 'Task Completion Form' then 'remarks' when 'FMS Stage Completion Form' then 'outcome_notes' when 'Resignation Form' then 'handover_notes' else 'reference_notes' end,
       case name when 'Walk-in Form' then 'Visit purpose' when 'Task Completion Form' then 'Remarks' when 'FMS Stage Completion Form' then 'Outcome notes' when 'Resignation Form' then 'Handover notes' else 'Reference notes' end,
       'textarea', false)
  ) as v(sort_order, field_key, field_name, field_type, is_required)
)
insert into form_fields(form_template_id, field_key, field_name, field_type, is_shown, is_editable, is_required, sort_order, validation)
select id, field_key, field_name, field_type, true, true, is_required, sort_order, '{}'::jsonb
from starter_fields;

revoke all privileges on function delete_form_with_audit(uuid) from public, anon, authenticated, service_role;
grant execute on function delete_form_with_audit(uuid) to authenticated;
notify pgrst, 'reload schema';
