-- 0410: the old Runo sheet - one row per call, not one row per id.
--
-- Facts from the sheet (owner, 2026-11-16): 36,577 rows, 20,707 distinct
-- "Unique id", 36,575 distinct "Unique id" + "Interaction Date". So the id
-- repeats across calls, and keying a row on the id alone kept one call per id
-- and dropped about 15,900. The Edge Function now keys the old sheet on
-- "Unique id" + "Interaction Date".
--
-- Two database changes follow from that:
--   1. The overlap check between the old and the live sheet can no longer
--      compare ids. The same call is now: the same phone at the same second.
--   2. The old-sheet rows stored under the id-only key are cleared so the
--      sheet is read again from the top. They produced no customer data: every
--      one was rejected (the copy had no Interaction Date) or pointed at an
--      existing live interaction. The clear is skipped if that is not so.

do $patch$
declare
  body text; found integer; f regprocedure := 'customer.apply_runo_row(uuid)'::regprocedure;
  old_text constant text := $o$    select i.id, i.client_id into v_interaction, v_client from customer.interactions i
     where i.tenant_id = v_tenant and i.source = 'runo' and i.external_ref = v_row.row_key;$o$;
  new_text constant text := $n$    select i.id, i.client_id into v_interaction, v_client from customer.interactions i
      join customer.client_phones ph on ph.client_id = i.client_id
     where i.tenant_id = v_tenant and i.source = 'runo' and i.archived_at is null
       and i.occurred_at = customer.parse_sheet_timestamp(p ->> 'Interaction Date')
       and ph.tenant_id = v_tenant and ph.phone = customer.normalize_phone(p ->> 'Mobile Number')
     limit 1;$n$;
  old_note constant text := '  -- imported from the live sheet under the same id is not imported twice.';
  new_note constant text := '  -- imported from the live sheet (same phone, same second) is not imported twice.';
begin
  body := replace(pg_get_functiondef(f), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then raise exception '0410: expected 1 match of the overlap check in apply_runo_row, found %', found; end if;
  body := replace(body, old_text, new_text);
  found := (length(body) - length(replace(body, old_note, ''))) / length(old_note);
  if found <> 1 then raise exception '0410: expected 1 match of the overlap comment in apply_runo_row, found %', found; end if;
  execute replace(body, old_note, new_note);
end $patch$;

do $clear$
declare v_made bigint;
begin
  -- Anything the old sheet itself created? Then leave everything as it is.
  select (select count(*) from customer.interactions where source = 'runo_old')
       + (select count(*) from customer.clients where first_source = 'runo_old')
    into v_made;
  if v_made > 0 then
    raise notice '0410: runo_old already created % record(s); stored rows are not cleared', v_made;
    return;
  end if;
  if to_regclass('customer.sheet_runo_old') is not null then
    delete from customer.sheet_runo_old;
  end if;
  delete from customer.ingest_pass_keys where source = 'runo_old';
  delete from customer.ingest_rows where source = 'runo_old';
  update customer.ingest_state
     set next_row = 2, scan_row = 2, scan_started_at = null, completed_at = null, rows_received = 0, last_error = null
   where source = 'runo_old';
end $clear$;
