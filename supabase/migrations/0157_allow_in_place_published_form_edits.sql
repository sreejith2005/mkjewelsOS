-- Published forms remain one stable ID for Task and FMS references. Every
-- submission captures the template/field definition it answered against, so
-- later edits cannot change historical answers or their labels.
set search_path = public, extensions;

update form_submissions s
set template_snapshot = jsonb_build_object(
  'template', to_jsonb(t),
  'fields', coalesce((
    select jsonb_agg(to_jsonb(f) order by f.sort_order, f.id)
    from form_fields f
    where f.form_template_id = t.id
  ), '[]'::jsonb)
)
from form_templates t
where s.template_snapshot is null
  and s.form_template_id = t.id;

comment on column form_submissions.template_snapshot is
  'The exact form_templates row and form_fields rows shown when this submission was created.';

create or replace function snapshot_form_submission_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
begin
  if new.template_snapshot is not null or new.form_template_id is null then
    return new;
  end if;

  select jsonb_build_object(
    'template', to_jsonb(t),
    'fields', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.sort_order, f.id)
      from form_fields f
      where f.form_template_id = t.id
    ), '[]'::jsonb)
  ) into v_snapshot
  from form_templates t
  where t.id = new.form_template_id and t.tenant_id = new.tenant_id;

  if v_snapshot is null then
    raise exception 'Submission form template is not available for history capture' using errcode = '23503';
  end if;

  new.template_snapshot := v_snapshot;
  return new;
end;
$$;

drop trigger if exists form_submission_template_snapshot on form_submissions;
create trigger form_submission_template_snapshot
before insert on form_submissions
for each row execute function snapshot_form_submission_template();

create or replace function save_published_form_with_audit(p_template_id uuid, p_payload jsonb, p_fields jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles; v_old form_templates; v_new form_templates;
  v_permissions jsonb; v_fields jsonb; v_old_fields jsonb; v_sections jsonb;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or not can_manage_form_template(p_template_id) then
    raise exception 'Only authorized active form authors can edit this form' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or p_payload - array['name','description','permissions','sections'] <> '{}'::jsonb then
    raise exception 'Form payload contains unsupported keys' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'name'),'') is null or length(btrim(p_payload->>'name')) > 150 or length(coalesce(p_payload->>'description','')) > 2000 then
    raise exception 'Form name or description exceeds its limit' using errcode = '22023';
  end if;
  v_permissions := normalize_form_permissions(p_payload->'permissions');
  v_sections := normalize_form_sections(p_payload->'sections');
  v_fields := normalize_form_fields(p_fields, v_sections);
  select * into v_old from form_templates where id = p_template_id for update;
  if v_old.id is null or v_old.tenant_id <> v_actor.tenant_id or v_old.lifecycle <> 'published' then
    raise exception 'Editable published form not found' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(ff) order by ff.sort_order),'[]'::jsonb) into v_old_fields from form_fields ff where ff.form_template_id = v_old.id;
  perform set_config('jewelos.allow_published_form_edit', 'on', true);
  update form_templates set name = btrim(p_payload->>'name'), description = nullif(btrim(p_payload->>'description'),''), permissions = v_permissions, sections = v_sections, updated_by = v_actor.id, updated_at = now()
  where id = v_old.id returning * into v_new;
  perform replace_form_draft_fields(v_old.id, v_fields);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'form_published_updated','forms',v_old.id,jsonb_build_object('template',to_jsonb(v_old),'fields',v_old_fields),jsonb_build_object('template',to_jsonb(v_new),'fields',v_fields));
  return v_old.id;
end;
$$;

revoke all privileges on function save_published_form_with_audit(uuid,jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function save_published_form_with_audit(uuid,jsonb,jsonb) to authenticated;

notify pgrst, 'reload schema';
