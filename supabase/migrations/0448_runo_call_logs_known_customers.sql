-- 0448: a Runo call log alone does not create a customer.
--
-- Read-only probes (2026-11-27): the call-log tabs hold about 62,800 calls to
-- roughly 25,000 numbers, mostly unanswered outgoing calls. A call log with no
-- interaction form is now added only when its number already belongs to a
-- customer; otherwise it is recorded as seen and skipped ("Not a known
-- customer"). When an interaction form for the same callId arrives later, the
-- form makes the interaction and its skipped call-log rows are queued again,
-- so the call facts join it on the next run.

create function customer._patch_0448(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0448: expected % match(es) of "%" in %, found %', p_expected, left(p_old, 80), p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

select customer._patch_0448('customer.apply_runo_call_log_row(uuid)'::regprocedure,
$o$  if v_interaction is null then
    if v_started is null then raise exception 'Call Start Date is missing or unreadable' using errcode = '22007'; end if;$o$,
$n$  if v_interaction is null and not exists (
       select 1 from customer.client_phones ph join customer.clients c on c.id = ph.client_id
        where ph.tenant_id = v_tenant and customer.same_franchise(ph.franchise_group_id)
          and ph.phone = customer.normalize_phone(v_phone) and c.merged_into_client_id is null) then
    update customer.ingest_rows
       set status = 'applied', reject_reason = 'Not a known customer', removed_at = null, client_id = null, interaction_id = null,
           applied_at = now(), updated_at = now(), attempts = attempts + 1
     where id = v_row.id;
    return null;
  end if;

  if v_interaction is null then
    if v_started is null then raise exception 'Call Start Date is missing or unreadable' using errcode = '22007'; end if;$n$, 1);

-- An interaction form queues again any call-log row of the same call that was
-- skipped before the form arrived.
select customer._patch_0448('customer.apply_runo_row(uuid)'::regprocedure,
$o$  update customer.interactions set has_interaction_form = true where id = v_interaction and not has_interaction_form;$o$,
$n$  update customer.interactions set has_interaction_form = true where id = v_interaction and not has_interaction_form;
  update customer.ingest_rows r set status = 'pending', reject_reason = null, updated_at = now()
    from customer.source_tables st
   where st.source = r.source and st.importer = 'runo_call_log'
     and r.tenant_id = v_tenant and r.row_key = v_row.row_key
     and r.status = 'applied' and r.interaction_id is null;$n$, 1);

drop function customer._patch_0448(regprocedure, text, text, integer);
