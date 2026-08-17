-- A published form can keep its identity (and therefore its FMS links) when
-- it has no submissions and no active FMS work. Once history exists, revisions
-- remain the only safe editing path.
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
  if current_setting('jewelos.allow_published_form_edit', true) = 'on' then return new; end if;
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
     or current_setting('jewelos.allow_form_deletion', true) = 'on'
     or current_setting('jewelos.allow_published_form_edit', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from form_templates
    where id = v_template_id and lifecycle = 'published'
      and created_by is null and published_by is null
  ) then return new; end if;
  if exists (select 1 from form_templates where id = v_template_id and lifecycle in ('published','archived')) then
    raise exception 'Fields on published and archived forms are immutable; create a revision' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create function save_published_form_with_audit(p_template_id uuid, p_payload jsonb, p_fields jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles; v_old form_templates; v_new form_templates;
  v_permissions jsonb; v_fields jsonb; v_old_fields jsonb;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or not can_manage_form_template(p_template_id) then
    raise exception 'Only authorized active form authors can edit this form' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or p_payload - array['name','description','permissions'] <> '{}'::jsonb then
    raise exception 'Form payload contains unsupported keys' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'name'),'') is null or length(btrim(p_payload->>'name')) > 150 or length(coalesce(p_payload->>'description','')) > 2000 then
    raise exception 'Form name or description exceeds its limit' using errcode = '22023';
  end if;
  v_permissions := normalize_form_permissions(p_payload->'permissions');
  v_fields := normalize_form_fields(p_fields);
  select * into v_old from form_templates where id = p_template_id for update;
  if v_old.id is null or v_old.tenant_id <> v_actor.tenant_id or v_old.lifecycle <> 'published' then
    raise exception 'Editable published form not found' using errcode = '42501';
  end if;
  if exists (select 1 from form_submissions where form_template_id = v_old.id) then
    raise exception 'Forms with submissions must be revised to preserve submitted history' using errcode = '23503';
  end if;
  if exists (
    select 1 from fms_stages d join fms_instance_stages s on s.fms_stage_id = d.id
    join fms_instances i on i.id = s.fms_instance_id
    where d.form_template_id = v_old.id and i.status in ('active','overdue','on_hold')
      and s.status in ('pending','in_progress','in_review','overdue')
  ) then
    raise exception 'Forms used by active FMS stages must be revised to preserve in-progress work' using errcode = '23514';
  end if;
  select coalesce(jsonb_agg(to_jsonb(ff) order by ff.sort_order),'[]'::jsonb) into v_old_fields from form_fields ff where ff.form_template_id = v_old.id;
  perform set_config('jewelos.allow_published_form_edit', 'on', true);
  update form_templates set name = btrim(p_payload->>'name'), description = nullif(btrim(p_payload->>'description'),''), permissions = v_permissions, updated_by = v_actor.id, updated_at = now()
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
