-- Checkbox remains backward compatible for historical boolean fields. A
-- checkbox with inline or Dropdown Master options is a multi-answer question.
-- Patch the latest installed definitions so this forward migration stays
-- focused on the changed contract and preserves the file-upload lifecycle.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('normalize_form_fields(jsonb,jsonb)'::regprocedure) into v_definition;
  v_updated := replace(v_definition,
    'v_type in (''select'',''multiselect'',''radio'')',
    'v_type in (''select'',''multiselect'',''radio'',''checkbox'')');
  v_updated := replace(v_updated,
    'Options are allowed only for select, multiselect, and radio fields',
    'Options are allowed only for dropdown, radio, checkbox, and legacy multi-select fields');
  v_updated := replace(v_updated,
    'v_type not in (''select'',''radio'')',
    'v_type not in (''select'',''radio'',''checkbox'',''multiselect'')');
  v_updated := replace(v_updated,
    'v_branch->>''operator'' in (''equals'',''not_equals'')',
    'v_branch->>''operator'' in (''equals'',''not_equals'',''contains'')');
  if v_updated = v_definition then
    raise exception 'normalize_form_fields checkbox contract patch did not match';
  end if;
  execute v_updated;

  select pg_get_functiondef('replace_form_draft_fields(uuid,jsonb)'::regprocedure) into v_definition;
  v_updated := replace(v_definition,
    'v_field->>''type'' in (''select'',''multiselect'',''radio'')',
    'v_field->>''type'' in (''select'',''multiselect'',''radio'',''checkbox'')');
  if v_updated = v_definition then
    raise exception 'replace_form_draft_fields checkbox contract patch did not match';
  end if;
  execute v_updated;

  select pg_get_functiondef('submit_form_locked_with_audit(uuid,jsonb,text,uuid)'::regprocedure) into v_definition;
  v_updated := replace(v_definition,
    '(v_field.field_type=''checkbox'' and v_value<>''true''::jsonb)',
    '(v_field.field_type=''checkbox'' and v_field.options is null and v_field.dropdown_master_type is null and v_value<>''true''::jsonb)');
  v_updated := replace(v_updated,
    'elsif v_field.field_type=''checkbox'' then
      if jsonb_typeof(v_value)<>''boolean'' then raise exception ''Field % must be boolean'',v_field.field_key using errcode=''22023''; end if;
    elsif v_field.field_type=''multiselect'' then',
    'elsif v_field.field_type=''checkbox'' and v_field.options is null and v_field.dropdown_master_type is null then
      if jsonb_typeof(v_value)<>''boolean'' then raise exception ''Field % must be boolean'',v_field.field_key using errcode=''22023''; end if;
    elsif v_field.field_type in (''checkbox'',''multiselect'') then');
  if v_updated = v_definition then
    raise exception 'submit_form_locked_with_audit checkbox contract patch did not match';
  end if;
  execute v_updated;
end;
$migration$;

alter function normalize_form_fields(jsonb,jsonb) owner to postgres;
alter function replace_form_draft_fields(uuid,jsonb) owner to postgres;
alter function submit_form_locked_with_audit(uuid,jsonb,text,uuid) owner to postgres;

revoke all on function normalize_form_fields(jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function replace_form_draft_fields(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function submit_form_locked_with_audit(uuid,jsonb,text,uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
