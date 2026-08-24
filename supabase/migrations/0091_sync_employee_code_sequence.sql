-- Imported employees can advance employee_code values without advancing the
-- allocating sequence. Move the next allocation beyond every existing code.
set search_path = public, extensions;

do $$
declare
  v_next_code bigint;
begin
  select greatest(
    1,
    coalesce(max(nullif(regexp_replace(employee_code, E'\\D', '', 'g'), '')::bigint), 0) + 1
  ) into v_next_code
  from user_profiles;

  perform setval('employee_code_sequence', v_next_code, false);
end;
$$;
