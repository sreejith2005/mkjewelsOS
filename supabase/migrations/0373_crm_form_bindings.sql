-- CRM forms from the Form Builder (owner request 2026-11-03).
--
-- 1. A Super Admin can link a published Form Builder form to a CRM form purpose
--    (client queue registration, lead registration; the walk-in visit follows).
--    The link stores the form family, so each new published version of that
--    form is used from its next opening, and a field map from stable CRM
--    targets to stable form question keys (never labels). Each save is an
--    immutable version; the active pointer moves in the same audited
--    transaction. Without a link CRM keeps its standard form.
-- 2. New permission crm.manage_forms (Super Admin by default) decides who may
--    change those links; CRM users read the active links with crm.view.
-- 3. Form questions may carry a layout width (validation.width = full, half or
--    third) so authors can place questions side by side on wider screens.
--    Phones always show one question per row. Nothing else about saving or
--    answering a form changes.
--
-- The CRM record is still written only by the CRM project's audited RPCs
-- (supabase-crm 20261103000100); this project only holds the configuration.
set search_path=public,extensions;

-- permission-catalog:begin
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values
('crm.manage_forms', 'action', null, '{super_admin}', 121);
-- permission-catalog:end

-- Question width: accept validation.width ('full','half','third') on any question.
do $$
declare definition text; amended text;
begin
  definition:=pg_get_functiondef('normalize_form_fields_legacy_0362(jsonb,jsonb)'::regprocedure);
  amended:=replace(definition,
    $old$v_validation - array['minLength','maxLength','min','max','allowOther'] <> '{}'::jsonb$old$,
    $new$v_validation - array['minLength','maxLength','min','max','allowOther','width'] <> '{}'::jsonb$new$);
  amended:=replace(amended,
    $old$where setting.key <> 'allowOther' and jsonb_typeof(setting.value) <> 'number')$old$,
    $new$where setting.key not in ('allowOther','width') and jsonb_typeof(setting.value) <> 'number')
       or (v_validation ? 'width' and (jsonb_typeof(v_validation->'width') <> 'string' or v_validation->>'width' not in ('full','half','third')))$new$);
  if position($m$'allowOther','width']$m$ in amended)=0 or position($m$setting.key not in ('allowOther','width')$m$ in amended)=0 then
    raise exception 'Review form field validation allowlist markers';
  end if;
  execute amended;
end $$;

create table crm_form_binding_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  purpose text not null check (purpose in ('queue','lead','walkin')),
  form_family_id uuid not null,
  -- The published version that was checked when this link was saved.
  validated_template_id uuid not null references form_templates(id),
  validated_version integer not null check (validated_version > 0),
  field_map jsonb not null check (jsonb_typeof(field_map) = 'object'),
  created_by uuid not null references user_profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create index crm_form_binding_versions_purpose on crm_form_binding_versions(tenant_id,purpose,created_at desc);
alter table crm_form_binding_versions enable row level security;
create policy module_accessible on crm_form_binding_versions as restrictive for select to authenticated using(module_accessible('crm'));
revoke all on crm_form_binding_versions from public,anon,authenticated,service_role;

create table crm_form_bindings (
  tenant_id uuid not null references tenants(id),
  purpose text not null check (purpose in ('queue','lead','walkin')),
  active_version_id uuid references crm_form_binding_versions(id),
  updated_by uuid not null references user_profiles(id),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id,purpose)
);
alter table crm_form_bindings enable row level security;
create policy module_accessible on crm_form_bindings as restrictive for select to authenticated using(module_accessible('crm'));
revoke all on crm_form_bindings from public,anon,authenticated,service_role;

create function crm_form_binding_immutable() returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'CRM form link versions cannot be changed or deleted' using errcode='42501';
end $$;
create trigger crm_form_binding_versions_immutable before update or delete on crm_form_binding_versions
  for each row execute function crm_form_binding_immutable();
revoke all on function crm_form_binding_immutable() from public,anon,authenticated;

-- The published template of a family, with its questions, as the form renderer reads it.
create function crm_form_published_definition(p_tenant uuid,p_family uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'template', to_jsonb(t) - 'permissions',
    'fields', coalesce((select jsonb_agg(to_jsonb(f) order by f.sort_order, f.id) from form_fields f where f.form_template_id=t.id),'[]'::jsonb))
  from form_templates t
  where t.tenant_id=p_tenant and t.family_id=p_family and t.lifecycle='published'
  order by t.version desc limit 1
$$;
revoke all on function crm_form_published_definition(uuid,uuid) from public,anon,authenticated;

-- CRM users: which form each CRM purpose uses now (none = the standard CRM form).
create function get_crm_form_bindings() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); result jsonb;
begin
  perform assert_module_enabled('crm');
  if a.id is null or not current_profile_is_active() or not has_permission('crm.view') then
    raise exception 'CRM access required' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'purpose', b.purpose,
      'versionId', v.id,
      'formFamilyId', v.form_family_id,
      'fieldMap', v.field_map,
      'validatedTemplateId', v.validated_template_id,
      'validatedVersion', v.validated_version,
      'savedAt', v.created_at,
      'savedBy', p.employee_name,
      'form', crm_form_published_definition(a.tenant_id, v.form_family_id)
    ) order by b.purpose),'[]'::jsonb)
  into result
  from crm_form_bindings b
  join crm_form_binding_versions v on v.id=b.active_version_id
  left join user_profiles p on p.id=v.created_by
  where b.tenant_id=a.tenant_id;
  return jsonb_build_object('canManage', has_permission('crm.manage_forms'), 'bindings', result);
end $$;

create function crm_form_binding_actor() returns user_profiles
language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();
begin
  perform assert_module_enabled('crm');
  if a.id is null or not current_profile_is_active() or not has_permission('crm.manage_forms') then
    raise exception 'Only people allowed to manage CRM forms can change them' using errcode='42501';
  end if;
  return a;
end $$;
revoke all on function crm_form_binding_actor() from public,anon,authenticated;

-- Link a published form to a CRM purpose. p_field_map: {"<crm target>": "<form question key>"}.
-- p_expected_version_id: the link the editor started from (null when there was none),
-- so two editors cannot overwrite each other silently.
create function save_crm_form_binding(p_purpose text,p_form_family_id uuid,p_field_map jsonb,p_expected_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  a user_profiles:=crm_form_binding_actor();
  t form_templates; f form_fields; current_binding crm_form_bindings; saved crm_form_binding_versions;
  item record; used text[]:='{}'; required text[];
begin
  if p_purpose not in ('queue','lead') then
    raise exception 'This CRM form cannot be linked yet' using errcode='22023';
  end if;
  if p_field_map is null or jsonb_typeof(p_field_map)<>'object' or octet_length(p_field_map::text)>16384 then
    raise exception 'The question links are not valid' using errcode='22023';
  end if;
  select * into t from form_templates
   where tenant_id=a.tenant_id and family_id=p_form_family_id and lifecycle='published'
   order by version desc limit 1;
  if t.id is null then raise exception 'Choose a published form' using errcode='22023'; end if;

  required:=case p_purpose when 'queue' then array['client_name','mobile'] else array['mobile_no'] end;
  if exists(select 1 from unnest(required) r where not (p_field_map ? r) or nullif(p_field_map->>r,'') is null) then
    raise exception 'Link every required CRM answer to a question' using errcode='22023';
  end if;
  for item in select key, value from jsonb_each(p_field_map) loop
    if item.key !~ '^[a-z][a-z0-9_]{0,62}$' or jsonb_typeof(item.value)<>'string' then
      raise exception 'The question links are not valid' using errcode='22023';
    end if;
    if p_purpose='queue' and item.key not in ('client_name','mobile') then
      raise exception 'The client queue form only takes the client name and mobile number' using errcode='22023';
    end if;
    select * into f from form_fields where form_template_id=t.id and field_key=item.value #>> '{}';
    if not found then raise exception 'A linked question is not in the published form' using errcode='22023'; end if;
    if f.field_type in ('section_header','divider','file') then
      raise exception 'Headings, dividers and file uploads cannot fill a CRM answer' using errcode='22023';
    end if;
    if item.key in ('mobile','mobile_no') and f.field_type not in ('phone','text') then
      raise exception 'The mobile number must come from a phone or text question' using errcode='22023';
    end if;
    if item.key in ('client_name','name') and f.field_type not in ('text','textarea') then
      raise exception 'The name must come from a text question' using errcode='22023';
    end if;
    if f.field_key=any(used) then raise exception 'One question can fill only one CRM answer' using errcode='22023'; end if;
    used:=used||f.field_key;
  end loop;

  select * into current_binding from crm_form_bindings where tenant_id=a.tenant_id and purpose=p_purpose for update;
  if current_binding.active_version_id is distinct from p_expected_version_id then
    raise exception 'Someone else changed this CRM form. Reload and try again.' using errcode='40001';
  end if;

  insert into crm_form_binding_versions(tenant_id,purpose,form_family_id,validated_template_id,validated_version,field_map,created_by)
  values (a.tenant_id,p_purpose,t.family_id,t.id,t.version,p_field_map,a.id) returning * into saved;
  insert into crm_form_bindings(tenant_id,purpose,active_version_id,updated_by,updated_at)
  values (a.tenant_id,p_purpose,saved.id,a.id,clock_timestamp())
  on conflict (tenant_id,purpose) do update set active_version_id=excluded.active_version_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values (a.tenant_id,a.id,'crm_form_linked','crm',saved.id,
    jsonb_build_object('purpose',p_purpose,'previous_version_id',current_binding.active_version_id),
    jsonb_build_object('purpose',p_purpose,'form_family_id',t.family_id,'template_id',t.id,'version',t.version,'field_map',p_field_map));
  return jsonb_build_object('versionId',saved.id,'templateId',t.id,'version',t.version);
end $$;

-- Go back to the standard CRM form for a purpose. Saved CRM records are untouched.
create function clear_crm_form_binding(p_purpose text,p_expected_version_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare a user_profiles:=crm_form_binding_actor(); current_binding crm_form_bindings;
begin
  select * into current_binding from crm_form_bindings where tenant_id=a.tenant_id and purpose=p_purpose for update;
  if current_binding.active_version_id is null then return; end if;
  if current_binding.active_version_id is distinct from p_expected_version_id then
    raise exception 'Someone else changed this CRM form. Reload and try again.' using errcode='40001';
  end if;
  update crm_form_bindings set active_version_id=null,updated_by=a.id,updated_at=clock_timestamp()
   where tenant_id=a.tenant_id and purpose=p_purpose;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values (a.tenant_id,a.id,'crm_form_unlinked','crm',current_binding.active_version_id,
    jsonb_build_object('purpose',p_purpose,'version_id',current_binding.active_version_id),jsonb_build_object('purpose',p_purpose));
end $$;

revoke all on function get_crm_form_bindings() from public,anon;
revoke all on function save_crm_form_binding(text,uuid,jsonb,uuid) from public,anon;
revoke all on function clear_crm_form_binding(text,uuid) from public,anon;
grant execute on function get_crm_form_bindings() to authenticated;
grant execute on function save_crm_form_binding(text,uuid,jsonb,uuid) to authenticated;
grant execute on function clear_crm_form_binding(text,uuid) to authenticated;

notify pgrst,'reload schema';
