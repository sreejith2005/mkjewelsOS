-- 0125 allowed option-backed Checkbox fields. Preserve the historical
-- optionless Checkbox path as a boolean instead of normalizing it as an empty
-- option list.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('normalize_form_fields(jsonb,jsonb)'::regprocedure) into v_definition;
  v_updated := replace(v_definition,
    'if v_type in (''select'',''multiselect'',''radio'',''checkbox'') then',
    'if v_type in (''select'',''multiselect'',''radio'')
       or (v_type = ''checkbox'' and (
         (v_option_source is not null and v_option_source <> ''null''::jsonb)
         or (jsonb_typeof(v_options) = ''array'' and jsonb_array_length(v_options) > 0)
       )) then');
  if v_updated = v_definition then
    raise exception 'normalize_form_fields legacy Checkbox correction did not match';
  end if;
  execute v_updated;

  select pg_get_functiondef('replace_form_draft_fields(uuid,jsonb)'::regprocedure) into v_definition;
  v_updated := replace(v_definition,
    'v_field->>''type'' in (''select'',''multiselect'',''radio'',''checkbox'')',
    '(v_field->>''type'' in (''select'',''multiselect'',''radio'')
       or (v_field->>''type'' = ''checkbox'' and (
         v_field->''optionSource'' is not null
         or jsonb_array_length(coalesce(v_field->''options'',''[]''::jsonb)) > 0
       )))');
  if v_updated = v_definition then
    raise exception 'replace_form_draft_fields legacy Checkbox correction did not match';
  end if;
  execute v_updated;
end;
$migration$;

alter function normalize_form_fields(jsonb,jsonb) owner to postgres;
alter function replace_form_draft_fields(uuid,jsonb) owner to postgres;

revoke all on function normalize_form_fields(jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function replace_form_draft_fields(uuid,jsonb) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
