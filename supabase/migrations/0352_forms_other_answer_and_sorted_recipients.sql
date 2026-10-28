-- Forms usability (owner request 2026-10-27).
--
-- 1. "Assign to a different employee" lists eligible people A to Z. It was
--    ordered by the internal id, which looks random. Paging keeps the same
--    uuid cursor (the last person shown); the next page now continues after
--    that person's name.
-- 2. Choice questions (dropdown, radio, checkbox list, multi-select) can offer
--    "Other": `validation.allowOther = true` lets the respondent type their own
--    answer. The typed text is stored as the answer itself, so reports, CSV,
--    Ask Kiara and earlier-answer screens show it with no extra lookup. Every
--    other check (required, visibility, section scope, length) is unchanged.
--
-- Function bodies are patched in place, as 0125/0263/0318 did, so the many
-- earlier amendments to these functions are kept exactly.
set search_path=public,extensions;

do $$
declare definition text; amended text;
begin
  definition:=pg_get_functiondef('list_fms_handoff_recipients(jsonb,uuid,text,uuid,integer)'::regprocedure);
  amended:=replace(definition,'and (p_cursor is null or u.id>p_cursor)',
    'and (p_cursor is null or (lower(u.employee_name),u.id)>(select lower(c.employee_name),c.id from user_profiles c where c.id=p_cursor))');
  amended:=replace(amended,'order by u.id limit','order by lower(u.employee_name),u.id limit');
  if position('order by lower(u.employee_name),u.id limit' in amended)=0 or position('(lower(u.employee_name),u.id)>(select' in amended)=0 then
    raise exception 'Review FMS recipient list ordering markers';
  end if;
  execute amended;
end $$;

-- Saving a form: accept a boolean allowOther, only on choice questions.
do $$
declare definition text; amended text;
begin
  definition:=pg_get_functiondef('normalize_form_fields(jsonb,jsonb)'::regprocedure);
  amended:=replace(definition,
    $old$v_validation - array['minLength','maxLength','min','max'] <> '{}'::jsonb$old$,
    $new$v_validation - array['minLength','maxLength','min','max','allowOther'] <> '{}'::jsonb$new$);
  amended:=replace(amended,
    $old$where jsonb_typeof(setting.value) <> 'number') then$old$,
    $new$where setting.key <> 'allowOther' and jsonb_typeof(setting.value) <> 'number')
       or (v_validation ? 'allowOther' and (jsonb_typeof(v_validation->'allowOther') <> 'boolean' or v_type not in ('select','radio','multiselect','checkbox'))) then$new$);
  if position($m$'min','max','allowOther']$m$ in amended)=0 or position($m$setting.key <> 'allowOther'$m$ in amended)=0 then
    raise exception 'Review form field validation allowlist markers';
  end if;
  execute amended;
end $$;

-- Submitting a form: a choice question with allowOther accepts typed text.
do $$
declare definition text; amended text;
begin
  definition:=pg_get_functiondef('fms_validate_candidate_form(uuid,jsonb,text,uuid)'::regprocedure);
  amended:=replace(definition,
    $old$if v_field.field_type in ('select','radio') and not (v_option_values @> jsonb_build_array(to_jsonb(v_text))) then$old$,
    $new$if v_field.field_type in ('select','radio') and not (v_option_values @> jsonb_build_array(to_jsonb(v_text))) and coalesce(v_field.validation->'allowOther','false'::jsonb)<>'true'::jsonb then$new$);
  amended:=replace(amended,
    $old$where jsonb_typeof(choice)<>'string' or not (v_option_values @> jsonb_build_array(choice)))$old$,
    $new$where jsonb_typeof(choice)<>'string' or btrim(choice #>> '{}')='' or length(choice #>> '{}')>500
           or (not (v_option_values @> jsonb_build_array(choice)) and coalesce(v_field.validation->'allowOther','false'::jsonb)<>'true'::jsonb))$new$);
  if position($m$and coalesce(v_field.validation->'allowOther','false'::jsonb)<>'true'::jsonb then$m$ in amended)=0
     or position($m$length(choice #>> '{}')>500$m$ in amended)=0 then
    raise exception 'Review form option validation markers';
  end if;
  execute amended;
end $$;

notify pgrst,'reload schema';
