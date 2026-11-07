-- Server-side country rule for form phone answers (MK1 audit 2026-11-07).
--
-- Form Builder phone questions now save "+<country code><number>" (web change
-- of the same date). The browser applies the shared phone rules
-- (@jewelos/core phone.ts); until now the server only checked characters and
-- 7-15 digits. A "+" answer must now also be a real international number:
-- 8 to 15 digits not starting with 0 (crm_private.phone_key's rule) and, for
-- India (+91), exactly 10 digits after the code. Country codes are
-- prefix-free, so every "+91..." answer is Indian.
--
-- Answers without "+" (every answer saved before this change, and other
-- clients) keep the earlier rule unchanged. Nothing already stored is
-- re-checked or rewritten.

create function form_phone_answer_valid(p_value text)
returns boolean language sql immutable set search_path = public as $$
  select case
    when btrim(coalesce(p_value, '')) !~ '^\+' then true
    else digits ~ '^[1-9][0-9]{7,14}$' and (digits !~ '^91' or length(digits) = 12)
  end
  from (select regexp_replace(coalesce(p_value, ''), '\D', '', 'g') as digits) d;
$$;
revoke all on function form_phone_answer_valid(text) from public, anon;
grant execute on function form_phone_answer_valid(text) to authenticated;

create function pg_temp.phone_patch(p_signature text)
returns void language plpgsql as $$
declare body text; found integer;
  old_text constant text := $o$if v_field.field_type='phone' and (v_text !~ '^[0-9+() .-]+$' or length(regexp_replace(v_text,'\D','','g')) not between 7 and 15) then raise exception 'Field % is not a valid phone number',v_field.field_key using errcode='22023'; end if;$o$;
  new_text constant text := $n$if v_field.field_type='phone' and (v_text !~ '^[0-9+() .-]+$' or length(regexp_replace(v_text,'\D','','g')) not between 7 and 15) then raise exception 'Field % is not a valid phone number',v_field.field_key using errcode='22023'; end if; if v_field.field_type='phone' and not public.form_phone_answer_valid(v_text) then raise exception 'Field % is not a valid phone number for its country',v_field.field_key using errcode='22023'; end if;$n$;
begin
  body := replace(pg_get_functiondef(p_signature::regprocedure), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then raise exception '0392: expected 1 phone check in %, found %', p_signature, found; end if;
  execute replace(body, old_text, new_text);
end $$;

select pg_temp.phone_patch('public.submit_form_base_with_audit(uuid,jsonb,text,uuid)');
select pg_temp.phone_patch('public.fms_validate_candidate_form(uuid,jsonb,text,uuid)');
drop function pg_temp.phone_patch(text);

notify pgrst, 'reload schema';
