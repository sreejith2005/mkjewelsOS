-- 0447: Runo calls tagged "personal" are not customers.
--
-- Read-only probe of the old sheet's "Call logs" tab (2026-11-27): 62,181 calls,
-- Call Tag answered / unanswered / personal, 2,109 of them "personal". Those are
-- staff's own calls on the work phone. A personal call with no interaction form
-- is recorded as seen and skipped: no customer, no interaction. If a form for
-- the same callId arrives, the form makes the interaction as usual and a later
-- read of the call log then adds its call facts.

do $$
declare body text; v_old text; v_new text;
begin
  body := replace(pg_get_functiondef('customer.apply_runo_call_log_row(uuid)'::regprocedure), E'\r', '');
  v_old := $q$  if v_interaction is null then
    if v_started is null then raise exception 'Call Start Date is missing or unreadable' using errcode = '22007'; end if;$q$;
  v_new := $q$  if v_interaction is null and lower(coalesce(v_tag, '')) = 'personal' then
    update customer.ingest_rows
       set status = 'applied', reject_reason = 'Personal call, not a customer', removed_at = null, client_id = null, interaction_id = null,
           applied_at = now(), updated_at = now(), attempts = attempts + 1
     where id = v_row.id;
    return null;
  end if;

  if v_interaction is null then
    if v_started is null then raise exception 'Call Start Date is missing or unreadable' using errcode = '22007'; end if;$q$;
  if (length(body) - length(replace(body, v_old, ''))) / length(v_old) <> 1 then raise exception '0447: call log importer not as expected'; end if;
  execute replace(body, v_old, v_new);
end $$;
