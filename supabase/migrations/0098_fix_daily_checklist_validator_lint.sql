set search_path = public, extensions;

create or replace function validate_daily_checklist_items(p_items jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_item jsonb; v_clean jsonb := '[]'::jsonb; v_id uuid; v_text text; v_ids uuid[] := array[]::uuid[];
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'Checklist must contain between 1 and 20 items' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Checklist item ID is invalid' using errcode = '22023';
    end if;
    v_id := (v_item->>'id')::uuid;
    v_text := btrim(coalesce(v_item->>'text', ''));
    if char_length(v_text) not between 1 and 500 then
      raise exception 'Checklist item text is invalid' using errcode = '22023';
    end if;
    if v_id = any(v_ids) then raise exception 'Checklist item IDs must be unique' using errcode = '22023'; end if;
    v_ids := array_append(v_ids, v_id);
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('id', v_id::text, 'text', v_text));
  end loop;
  return v_clean;
end $$;

revoke all on function validate_daily_checklist_items(jsonb) from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
