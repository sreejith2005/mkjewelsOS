-- 0432: ORDER FMS - remove the rows read with the old key, and let a sheet
-- keep rows that are deleted from it.
--
-- What happened (production facts, 2026-11-19): 0431 re-keyed the 1,258
-- stored ORDER FMS rows to WORK ORDER NO | WORK STAGE. The 5-minute job ran
-- once more before the new function was deployed (2026-11-18 13:00 UTC) and
-- stored all 1,103 sheet rows again under the old three-part key, as new rows,
-- with their own client contacts. The next pass then found the 1,258 re-keyed
-- rows missing and stopped (too_many_rows_missing:1258). Nothing was removed.
--
-- 1. Those 1,103 old-key rows are deleted, and with them everything they
--    made (their contacts, FMS steps and answers; migration 0424). The
--    re-keyed rows stay. Only rows with the old three-part key that were
--    first stored in that one run are touched.
-- 2. customer.source_tables.keep_rows_gone_from_sheet: when true, a row
--    deleted from that Google Sheet stays in the database and on the
--    customer's timeline, instead of being archived. Off for every sheet;
--    the owner decides per sheet. 155 stored ORDER FMS rows are no longer in
--    the sheet (1,258 stored, 1,103 in the sheet).

-- Exact-text patch of an existing function; fails unless the text is found
-- exactly the expected number of times. Dropped at the end.
create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0432: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------------
-- 1. The rows of the stale run
-- ---------------------------------------------------------------------------
delete from customer.ingest_rows
 where source = 'order_fms'
   and row_key ~ '^[^|]*\|[^|]*\|'
   and received_at >= '2026-11-18 12:55:00+00' and received_at < '2026-11-18 13:05:00+00';

delete from customer.ingest_pass_keys where source = 'order_fms';
update customer.ingest_state set scan_row = 2, scan_started_at = null,
       last_error = case when last_error like 'too_many_rows_missing%' then null else last_error end
 where source = 'order_fms';

-- ---------------------------------------------------------------------------
-- 2. Keep rows deleted from a sheet, when the owner says so
-- ---------------------------------------------------------------------------
alter table customer.source_tables add column keep_rows_gone_from_sheet boolean not null default false;
comment on column customer.source_tables.keep_rows_gone_from_sheet is
  'When true, a row deleted from the Google Sheet stays in the database and on the timeline (owner choice per sheet).';

select customer._patch('public.customer_ingest_finish_scan(text,integer)'::regprocedure,
$old$  if v_started is null then return jsonb_build_object('removed', 0, 'remaining', false, 'blocked', false); end if;
$old$,
$new$  if v_started is null then return jsonb_build_object('removed', 0, 'remaining', false, 'blocked', false); end if;

  -- A sheet whose deleted rows are kept: the pass ends without removing anything.
  if exists (select 1 from customer.source_tables where source = p_source and keep_rows_gone_from_sheet) then
    update customer.ingest_state
       set scan_row = 2, scan_started_at = null, last_full_pass_at = now(),
           last_error = case when last_error like 'too_many_rows_missing%' then null else last_error end
     where tenant_id = v_tenant and source = p_source;
    delete from customer.ingest_pass_keys where tenant_id = v_tenant and source = p_source;
    return jsonb_build_object('removed', 0, 'kept', true, 'remaining', false, 'blocked', false);
  end if;
$new$, 1);

drop function customer._patch(regprocedure, text, text, integer);
