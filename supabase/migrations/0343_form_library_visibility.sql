-- Library discovery is separate from reading a form required by durable work.
alter table public.form_templates add column library_visible boolean not null default true;
comment on column public.form_templates.library_visible is
  'Staff library discovery and standalone submission; assigned work and historical reads remain available.';

-- Visibility is operational metadata, not a form definition edit. Retain the
-- immutable-definition guard and permit only this metadata-only change.
do $$
declare definition text; amended text; marker text:='  if old.lifecycle in (''published'', ''archived'') then';
begin
  definition:=replace(pg_get_functiondef('public.enforce_form_template_immutability()'::regprocedure),E'\r','');
  amended:=replace(definition,marker,$guard$
  if new.library_visible is distinct from old.library_visible
    and (to_jsonb(new)-array['library_visible','updated_by','updated_at'])
      = (to_jsonb(old)-array['library_visible','updated_by','updated_at']) then
    return new;
  end if;
$guard$||marker);
  if amended=definition then raise exception 'Review form immutability metadata guard'; end if;
  execute amended;
end $$;

-- Policy predicate, not an alternative assignment authorization contract.
create function public.can_open_form_from_library(p_template_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select current_profile_is_active() and exists (
    select 1 from form_templates ft
    where ft.id=p_template_id and ft.tenant_id=current_tenant_id()
      and ft.lifecycle='published' and ft.is_active
      and (ft.library_visible or has_permission('forms.manage'))
      and current_role_level() in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
      and (current_role_level() in ('super_admin','admin') or (ft.permissions->'roles') ? current_role_level()::text)
  );
$$;

-- Retain every installed assignment/history read branch. Only replace the
-- general-library branch, and allow permission-based authors to manage all forms.
do $$
declare definition text; amended text; old_branch text;
begin
  definition:=replace(pg_get_functiondef('public.can_access_form_template(uuid)'::regprocedure),E'\r','');
  old_branch:=$branch$(ft.lifecycle='published' and ft.is_active
        and current_role_level() in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
        and (current_role_level() in ('super_admin','admin') or (ft.permissions->'roles') ? current_role_level()::text))$branch$;
  old_branch:=replace(old_branch,E'\r','');
  amended:=replace(definition,old_branch,'(has_permission(''forms.manage'') or can_open_form_from_library(ft.id))');
  if amended=definition then raise exception 'Review form library read predicate against installed contract'; end if;
  execute amended;
end $$;

create function public.set_form_library_visibility_with_audit(p_template_id uuid,p_visible boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare actor user_profiles:=current_profile(); previous form_templates; updated form_templates;
begin
  perform assert_module_enabled('forms_library');
  if actor.id is null or not current_profile_is_active() or not has_permission('forms.manage') then
    raise exception 'Only active form authors can change library visibility' using errcode='42501';
  end if;
  if p_visible is null then raise exception 'Visibility must be true or false' using errcode='22023'; end if;
  select * into previous from form_templates where id=p_template_id and tenant_id=actor.tenant_id for update;
  if previous.id is null then raise exception 'Form not found in your authorized scope' using errcode='42501'; end if;
  if previous.library_visible=p_visible then return previous.id; end if;
  update form_templates set library_visible=p_visible,updated_by=actor.id,updated_at=now()
  where id=previous.id returning * into updated;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(actor.tenant_id,actor.id,'form_library_visibility_changed','forms',previous.id,
    jsonb_build_object('library_visible',previous.library_visible),jsonb_build_object('library_visible',updated.library_visible));
  return updated.id;
end $$;

-- Both final submission and preview validate this distinction. Reading an
-- assigned/historical template must never authorize a standalone submission.
do $$
declare signature text; definition text; amended text;
begin
  foreach signature in array array['submit_form_locked_with_audit(uuid,jsonb,text,uuid)','fms_validate_candidate_form(uuid,jsonb,text,uuid)'] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r','');
    amended:=replace(definition,'if not can_access_form_template(v_template.id) then','if not can_open_form_from_library(v_template.id) then');
    if amended=definition then raise exception 'Review standalone form guard: %',signature; end if;
    execute amended;
  end loop;
  -- A later FMS entry implementation used the standalone call after checking a
  -- starter assignment. Carry that checked assignment into Forms validation.
  definition:=replace(pg_get_functiondef('submit_fms_form_and_progress_with_audit(uuid,jsonb,text,uuid,uuid,text,text,jsonb,uuid)'::regprocedure),E'\r','');
  amended:=replace(definition,'submit_form_with_audit(p_form_template_id,p_answers,null,null)',
    'submit_form_with_audit(p_form_template_id,p_answers,''fms_entry'',p_linked_record_id)');
  if amended=definition then raise exception 'Review exact starter form submission call'; end if;
  execute amended;
  -- Metadata is copied before the original writer creates its audit snapshot.
  foreach signature in array array['create_form_revision_with_audit(uuid,jsonb)','duplicate_form_with_audit(uuid,text)'] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r','');
    amended:=replace(definition,'returning * into v_new;',
      'returning * into v_new; update form_templates set library_visible=v_source.library_visible where id=v_new.id returning * into v_new;');
    if amended=definition then raise exception 'Review visibility inheritance writer: %',signature; end if;
    execute amended;
  end loop;
end $$;

revoke all on function public.can_open_form_from_library(uuid),public.set_form_library_visibility_with_audit(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.can_open_form_from_library(uuid),public.set_form_library_visibility_with_audit(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
