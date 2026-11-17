-- 0421: a phone number is cleaned once, not twice.
--
-- Production, 2026-11-17: 7 REPAIR FMS rows were rejected with "Not a valid
-- phone number". customer.resolve_client (0416) and customer.apply_enquiry_row
-- (0414) cleaned the number, then handed the cleaned digits to
-- find_or_create_client, which cleaned them again. A number written with "+"
-- or "00" in front loses that mark the first time, so the second cleaning
-- reads it as a local number:
--   0098200123   -> 98200123   -> rejected (too short for a local number)
--   +4420712345  -> 4420712345 -> 914420712345 (an Indian code added)
-- Now the cleaned number is passed on with its "+", which find_or_create_client
-- keeps exactly as it is. The rows rejected for this are applied again.

create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0421: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

do $patches$
begin
  perform customer._patch('customer.resolve_client(uuid,text,text,text,timestamptz,text,text,text,uuid)'::regprocedure,
    'customer.find_or_create_client(p_tenant_id, v_phone, p_name',
    'customer.find_or_create_client(p_tenant_id, ''+'' || v_phone, p_name', 1);
  perform customer._patch('customer.resolve_client(uuid,text,text,text,timestamptz,text,text,text,uuid)'::regprocedure,
    'customer.find_or_create_client(p_tenant_id, v_billing, p_name',
    'customer.find_or_create_client(p_tenant_id, ''+'' || v_billing, p_name', 1);
  perform customer._patch('customer.apply_enquiry_row(uuid)'::regprocedure,
    'customer.find_or_create_client(v_tenant, v_phone, v_name',
    'customer.find_or_create_client(v_tenant, ''+'' || v_phone, v_name', 1);
end $patches$;
drop function customer._patch(regprocedure, text, text, integer);

revoke all on function customer.resolve_client(uuid, text, text, text, timestamptz, text, text, text, uuid) from public, anon, authenticated;
revoke all on function customer.apply_enquiry_row(uuid) from public, anon, authenticated;
grant execute on function customer.resolve_client(uuid, text, text, text, timestamptz, text, text, text, uuid) to service_role;
grant execute on function customer.apply_enquiry_row(uuid) to service_role;

do $again$
declare s text; v jsonb;
begin
  for s in
    update customer.ingest_rows set status = 'pending', reject_reason = null
     where status = 'rejected' and reject_reason = 'Not a valid phone number'
    returning source
  loop null; end loop;
  for s in select distinct source from customer.ingest_rows where status = 'pending' and source in (select source from customer.source_tables) loop
    v := public.customer_ingest_apply(s, 200);
    raise notice '0421: % %', s, v;
  end loop;
end $again$;
