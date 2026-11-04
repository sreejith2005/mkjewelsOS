-- CRM walk-in form from the Form Builder (owner request 2026-11-03).
--
-- 1. Two question types for forms CRM uses: "repeat" (a repeating group: "How many?" then the
--    same questions for each person or item, stored in validation.repeat) and "crm_photo"
--    (photos or videos uploaded to CRM documents storage, settings in validation.crm). Text and
--    phone questions may carry validation.crm too: a CRM client lookup by mobile number, a
--    pincode lookup, or the branch's CRM people / salespeople as choices. JewelOS form submission
--    keeps refusing answers to these types ("Deferred field type"), because only CRM can save
--    them; CRM saves them through submit_walkin_visit_from_form (supabase-crm 20261104000100).
-- 2. CRM Form Settings can link the walk-in visit, and one CRM answer may be filled from up to
--    three questions shown in different cases (the first answered one is used), for example
--    "Next visit date", required only after a Not Bought visit.
set search_path=public,extensions;

-- The two CRM question types are also allowed by the table itself.
alter table form_fields drop constraint form_fields_type_check;
alter table form_fields add constraint form_fields_type_check check (field_type in (
  'text','textarea','number','currency','email','phone','date','datetime','select','multiselect','radio','checkbox','rating',
  'section_header','divider','user_dropdown','branch_dropdown','department_dropdown','file','repeat','crm_photo'));

do $$
declare definition text; amended text;
begin
  definition:=pg_get_functiondef('normalize_form_fields_legacy_0362(jsonb,jsonb)'::regprocedure);
  amended:=replace(definition,
    $old$'branch_dropdown','department_dropdown','file') then$old$,
    $new$'branch_dropdown','department_dropdown','file','repeat','crm_photo') then$new$);
  amended:=replace(amended,
    $old$v_validation - array['minLength','maxLength','min','max','allowOther','width'] <> '{}'::jsonb$old$,
    $new$v_validation - array['minLength','maxLength','min','max','allowOther','width','repeat','crm'] <> '{}'::jsonb$new$);
  amended:=replace(amended,
    $old$where setting.key not in ('allowOther','width') and jsonb_typeof(setting.value) <> 'number')$old$,
    $new$where setting.key not in ('allowOther','width','repeat','crm') and jsonb_typeof(setting.value) <> 'number')
       or (v_validation ? 'repeat' and (v_type <> 'repeat' or jsonb_typeof(v_validation->'repeat') <> 'object'
           or jsonb_typeof(v_validation->'repeat'->'fields') <> 'array' or jsonb_array_length(v_validation->'repeat'->'fields') not between 1 and 10
           or octet_length((v_validation->'repeat')::text) > 32768))
       or (v_type = 'repeat' and not (v_validation ? 'repeat'))
       or (v_validation ? 'crm' and (jsonb_typeof(v_validation->'crm') <> 'object' or octet_length((v_validation->'crm')::text) > 1024
           or (v_validation->'crm') - array['lookup','choices','video','maxFiles'] <> '{}'::jsonb))$new$);
  if position($m$'file','repeat','crm_photo') then$m$ in amended)=0
     or position($m$'allowOther','width','repeat','crm']$m$ in amended)=0
     or position($m$setting.key not in ('allowOther','width','repeat','crm')$m$ in amended)=0 then
    raise exception 'Review form field type and validation allowlist markers';
  end if;
  execute amended;
end $$;

-- FMS start triggers (0374) read form questions: CRM-only questions are never JewelOS form
-- answers, so like phone and file questions they are not offered as trigger fields.
create or replace function fms_trigger_question_type(p_type text,p_has_options boolean) returns text
language sql immutable set search_path=public as $$
  select case p_type
    when 'number' then 'number' when 'currency' then 'number' when 'rating' then 'number'
    when 'date' then 'date' when 'datetime' then 'date'
    when 'checkbox' then case when p_has_options then 'multi_choice' else 'boolean' end
    when 'select' then 'choice' when 'radio' then 'choice' when 'department_dropdown' then 'choice'
    when 'multiselect' then 'multi_choice'
    when 'user_dropdown' then 'user' when 'branch_dropdown' then 'branch'
    when 'phone' then null when 'file' then null when 'section_header' then null when 'divider' then null
    when 'repeat' then null when 'crm_photo' then null
    else 'text' end
$$;

-- Walk-in links, and alternative questions for one CRM answer.
create or replace function save_crm_form_binding(p_purpose text,p_form_family_id uuid,p_field_map jsonb,p_expected_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  a user_profiles:=crm_form_binding_actor();
  t form_templates; f form_fields; current_binding crm_form_bindings; saved crm_form_binding_versions;
  item record; question jsonb; used text[]:='{}'; required text[]; question_count integer;
begin
  if p_purpose not in ('queue','lead','walkin') then
    raise exception 'This CRM form cannot be linked yet' using errcode='22023';
  end if;
  if p_field_map is null or jsonb_typeof(p_field_map)<>'object' or octet_length(p_field_map::text)>32768 then
    raise exception 'The question links are not valid' using errcode='22023';
  end if;
  select * into t from form_templates
   where tenant_id=a.tenant_id and family_id=p_form_family_id and lifecycle='published'
   order by version desc limit 1;
  if t.id is null then raise exception 'Choose a published form' using errcode='22023'; end if;

  required:=case p_purpose when 'queue' then array['client_name','mobile'] when 'lead' then array['mobile_no'] else array['primary_name','primary_phone','visit_status'] end;
  if exists(select 1 from unnest(required) r where not (p_field_map ? r) or p_field_map->r in ('""'::jsonb,'[]'::jsonb,'null'::jsonb)) then
    raise exception 'Link every required CRM answer to a question' using errcode='22023';
  end if;
  for item in select key, value from jsonb_each(p_field_map) loop
    if item.key !~ '^[a-z][a-z0-9_]{0,62}$' or jsonb_typeof(item.value) not in ('string','array') then
      raise exception 'The question links are not valid' using errcode='22023';
    end if;
    if p_purpose='queue' and item.key not in ('client_name','mobile') then
      raise exception 'The client queue form only takes the client name and mobile number' using errcode='22023';
    end if;
    question_count:=case when jsonb_typeof(item.value)='array' then jsonb_array_length(item.value) else 1 end;
    if question_count not between 1 and 3 or (question_count>1 and p_purpose<>'walkin') then
      raise exception 'One CRM answer can come from up to three walk-in questions' using errcode='22023';
    end if;
    for question in select value from jsonb_array_elements(case when jsonb_typeof(item.value)='array' then item.value else jsonb_build_array(item.value) end) loop
      if jsonb_typeof(question)<>'string' then raise exception 'The question links are not valid' using errcode='22023'; end if;
      select * into f from form_fields where form_template_id=t.id and field_key=question #>> '{}';
      if not found then raise exception 'A linked question is not in the published form' using errcode='22023'; end if;
      if f.field_type in ('section_header','divider','file') then
        raise exception 'Headings, dividers and file uploads cannot fill a CRM answer' using errcode='22023';
      end if;
      if f.field_type in ('repeat','crm_photo') and p_purpose<>'walkin' then
        raise exception 'Repeating groups and CRM photos belong to the walk-in form' using errcode='22023';
      end if;
      if item.key in ('mobile','mobile_no','primary_phone') and f.field_type not in ('phone','text') then
        raise exception 'The mobile number must come from a phone or text question' using errcode='22023';
      end if;
      if item.key in ('client_name','name','primary_name') and f.field_type not in ('text','textarea') then
        raise exception 'The name must come from a text question' using errcode='22023';
      end if;
      if f.field_key=any(used) then raise exception 'One question can fill only one CRM answer' using errcode='22023'; end if;
      used:=used||f.field_key;
    end loop;
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
revoke all on function save_crm_form_binding(text,uuid,jsonb,uuid) from public,anon;
grant execute on function save_crm_form_binding(text,uuid,jsonb,uuid) to authenticated;

notify pgrst,'reload schema';
