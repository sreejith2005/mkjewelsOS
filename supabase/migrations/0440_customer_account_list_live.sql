-- 0440: the Account List (Mumbai's billing software) is live.
--
-- Owner, 2026-11-20: "the account list is not a live sheet. we add the rows
-- manually into it. so we want it to be live with our database live sync.
-- anytime i add rows into that sheet it should come live sync into the
-- database."
--
-- * The tab has no ID column, so 0434 read it by row number. That is unsafe
--   for a sheet people edit: sorting it, or adding or deleting a row in the
--   middle, would shift every row below onto another person. A row is now
--   identified by A/c Name + Mobile (probe 2026-11-20: A/c Name alone has
--   26,048 distinct values in 26,084 rows). Rows with the same name and mobile
--   are one person and stored once.
-- * The 26,084 stored rows get the new identifier, so nothing is imported
--   twice. Where two stored rows now share one identifier, the first (lowest
--   sheet row) keeps it; the other keeps its old row-number identifier and is
--   taken out at the end of the next full read, as a row gone from the sheet
--   (its person stays, held by the row that has the same name and mobile).
-- * The sheet's own table (customer.sheet_software_account_list) takes the
--   new identifiers in place (never cleared: a delete there removes the row).
-- * The tab becomes a live source. It stays switched off here: the owner
--   switches it on (customer.source_tables.scheduled) after the function with
--   the new identifier is deployed, so the 5-minute job never reads it with
--   the old one.
-- The sync function change of the same pull request also removes rows gone
-- from a sheet in smaller batches (MASTER DATABASE timed out doing 200 at once).

update customer.source_tables set one_time = false, scheduled = false where source = 'software_account_list';

-- Gives every stored row its A/c Name + Mobile identifier, in the sheet's own
-- table too. Returns how many rows got a new identifier.
create function customer.rekey_account_list()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_changed integer;
begin
  with keyed as (
    select r.id,
           case when coalesce(r.payload ->> 'A/c Name', '') <> '' or coalesce(r.payload ->> 'Mobile', '') <> ''
                then coalesce(r.payload ->> 'A/c Name', '') || '|' || coalesce(r.payload ->> 'Mobile', '')
                else 'row:' || r.sheet_row end as new_key
      from customer.ingest_rows r
     where r.source = 'software_account_list'),
  ranked as (
    select k.id, k.new_key,
           row_number() over (partition by r.tenant_id, k.new_key order by (r.status = 'removed'), r.sheet_row, r.id) as n
      from keyed k join customer.ingest_rows r on r.id = k.id)
  update customer.ingest_rows r
     set row_key = k.new_key
    from ranked k
   where r.id = k.id and k.n = 1 and r.row_key is distinct from k.new_key;
  get diagnostics v_changed = row_count;

  -- The sheet's own table takes the new identifiers in place. Never delete
  -- from it: deleting a row there removes the stored row (0424 safe delete).
  -- (The table is made when the sheet's first rows are stored.)
  if to_regclass('customer.sheet_software_account_list') is not null then
    update customer.sheet_software_account_list s
       set _row_key = r.row_key
      from customer.ingest_rows r
     where r.source = 'software_account_list' and r.tenant_id = s._tenant_id and r.sheet_row = s._sheet_row
       and s._row_key is distinct from r.row_key;
  end if;
  return v_changed;
end $$;
revoke all on function customer.rekey_account_list() from public, anon, authenticated;

select customer.rekey_account_list() as rows_rekeyed;

-- A live source carries on from where the one-time import stopped, and its
-- first full read starts from the top.
update customer.ingest_state
   set completed_at = null, scan_row = 2, scan_started_at = null, last_error = null
 where source = 'software_account_list';
