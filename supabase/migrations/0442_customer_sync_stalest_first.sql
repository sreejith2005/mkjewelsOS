-- 0442: the sheet sync reads the sheet that has waited longest first.
--
-- Owner, 2026-11-20: MASTER DATABASE was last read at 16:15 IST while the
-- Account List was read at 17:05. Each 5-minute run of customer-sheets-sync
-- has time for a few sheets only, and with about 30 sheets the fixed rotation
-- left a sheet unread for over an hour. The function now asks for every
-- sheet's last read time and starts with the oldest (never read first).
--
-- public.customer_ingest_last_runs(): { "<source>": "<last_run_at>" | null }
-- for every sheet in customer.source_tables, for the sync function only.

create function public.customer_ingest_last_runs() returns jsonb
language sql
stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.source, i.last_run_at), '{}'::jsonb)
    from customer.source_tables s
    left join customer.ingest_state i
      on i.source = s.source and i.tenant_id = customer.ingest_tenant();
$$;

revoke all on function public.customer_ingest_last_runs() from public, anon, authenticated;
grant execute on function public.customer_ingest_last_runs() to service_role;
