-- 0431: ORDER FMS rows are identified by WORK ORDER NO + WORK STAGE.
--
-- Owner, 2026-11-18: ORDER FMS adds a new row for each stage; compare by WORK
-- ORDER NO and WORK STAGE. Read-only probe the same day: 1,103 rows, and
-- WORK ORDER NO + WORK STAGE is filled and unique on every one. DESIGN NO is
-- blank on 32 rows and can be filled or corrected later, which changed the
-- old key (WORK ORDER NO | DESIGN NO | WORK STAGE): an edited design number
-- looked like a deleted row plus a new one, and the import stopped with
-- too_many_rows_missing:155.
--
-- This re-keys the stored ORDER FMS rows the way the import now keys them
-- ("<WORK ORDER NO>|<WORK STAGE>"), along with the contacts and the sheet's
-- own table that carry the key. Where two stored rows now share one key (the
-- same order and stage, before and after a design number edit), the most
-- recently changed row stays and the other is removed the usual way (its
-- contact archived, nothing deleted). The next full pass starts afresh.

create function customer.rekey_order_fms()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; r record; v_changed integer;
begin
  drop table if exists pg_temp.order_keys;
  create temp table order_keys as
  select id, tenant_id, row_key as old_key, status,
         case when coalesce(payload ->> 'WORK ORDER NO', '') = '' and coalesce(payload ->> 'WORK STAGE', '') = '' then row_key
              else coalesce(payload ->> 'WORK ORDER NO', '') || '|' || coalesce(payload ->> 'WORK STAGE', '') end as new_key,
         row_number() over (
           partition by tenant_id,
             case when coalesce(payload ->> 'WORK ORDER NO', '') = '' and coalesce(payload ->> 'WORK STAGE', '') = '' then row_key
                  else coalesce(payload ->> 'WORK ORDER NO', '') || '|' || coalesce(payload ->> 'WORK STAGE', '') end
           order by (status = 'removed'), updated_at desc, sheet_row desc, id) as n
    from customer.ingest_rows where source = 'order_fms';

  -- The older duplicate goes the way a row gone from the sheet goes.
  for r in select id from pg_temp.order_keys where n > 1 and status <> 'removed' loop
    perform customer.remove_source_row(r.id);
  end loop;
  update pg_temp.order_keys set new_key = new_key || '|replaced:' || id where n > 1;

  -- Two steps, so no key is ever taken twice in between.
  update customer.ingest_rows i set row_key = 'rekey:' || i.id from pg_temp.order_keys k where k.id = i.id and k.old_key <> k.new_key;
  update customer.ingest_rows i set row_key = k.new_key from pg_temp.order_keys k where k.id = i.id and k.old_key <> k.new_key;
  get diagnostics v_changed = row_count;
  update customer.interactions x set external_ref = k.new_key
    from pg_temp.order_keys k
   where x.tenant_id = k.tenant_id and x.source = 'order_fms' and x.external_ref = k.old_key and k.old_key <> k.new_key;

  -- The sheet's own table, rebuilt from the re-keyed rows.
  if to_regclass('customer.sheet_order_fms') is not null then
    delete from customer.sheet_order_fms;
    select array_agg(id) into v_ids from customer.ingest_rows where source = 'order_fms';
    perform customer.project_source_rows('order_fms', v_ids, false);
  end if;

  delete from customer.ingest_pass_keys where source = 'order_fms';
  update customer.ingest_state set scan_row = 2, scan_started_at = null,
         last_error = case when last_error like 'too_many_rows_missing%' then null else last_error end
   where source = 'order_fms';
  drop table pg_temp.order_keys;
  return v_changed;
end $$;
revoke all on function customer.rekey_order_fms() from public, anon, authenticated;
grant execute on function customer.rekey_order_fms() to service_role;

select customer.rekey_order_fms();
