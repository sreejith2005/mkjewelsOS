-- 0444: a failed sheet read says which sheet, what went wrong, since when, and
-- when it was last read without a problem (owner, 2026-11-27: "The last read of
-- a sheet failed" kept appearing with no detail).
--
-- * customer.ingest_state.error_since: when the current problem started
--   (kept while the same sheet keeps failing; cleared when a read succeeds).
-- * customer.ingest_state.last_ok_at: the last read that ended without a problem.
--   Both are kept by a trigger, so every function that sets or clears
--   last_error keeps them right without being changed.
-- * customer_list_filters(): the 'import' list also carries each sheet's name,
--   error code, error_since, last_ok_at, last_full_pass_at and whether it is
--   read on the schedule. Codes only; never sheet content.

alter table customer.ingest_state add column error_since timestamptz, add column last_ok_at timestamptz;

update customer.ingest_state set last_ok_at = last_run_at where last_error is null;
update customer.ingest_state set error_since = last_run_at where last_error is not null;

create function customer.ingest_state_error_times() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.last_error is null then
    new.error_since := null;
    if tg_op = 'INSERT' or new.last_run_at is distinct from old.last_run_at or old.last_error is not null then
      new.last_ok_at := coalesce(new.last_run_at, now());
    end if;
  elsif tg_op = 'INSERT' or old.last_error is null then
    new.error_since := now();
  end if;
  return new;
end $$;

create trigger ingest_state_error_times before insert or update on customer.ingest_state
for each row execute function customer.ingest_state_error_times();

do $$
declare body text; v_old text; v_new text;
begin
  body := replace(pg_get_functiondef('public.customer_list_filters(text)'::regprocedure), E'\r', '');
  v_old := $q$'import', (select coalesce(jsonb_agg(jsonb_build_object('source', i.source, 'last_run_at', i.last_run_at, 'rows_received', i.rows_received, 'failed', i.last_error is not null)), '[]'::jsonb)
                 from customer.ingest_state i where i.tenant_id = v_tenant));$q$;
  v_new := $q$'import', (select coalesce(jsonb_agg(jsonb_build_object('source', i.source, 'label', coalesce(s.label, i.source), 'scheduled', coalesce(s.scheduled, false),
                         'last_run_at', i.last_run_at, 'rows_received', i.rows_received, 'failed', i.last_error is not null,
                         'error', i.last_error, 'error_since', i.error_since, 'last_ok_at', i.last_ok_at, 'last_full_pass_at', i.last_full_pass_at)
                         order by coalesce(s.label, i.source)), '[]'::jsonb)
                 from customer.ingest_state i left join customer.source_tables s on s.source = i.source
                where i.tenant_id = v_tenant));$q$;
  if (length(body) - length(replace(body, v_old, ''))) / length(v_old) <> 1 then
    raise exception '0444: customer_list_filters import list not found as expected';
  end if;
  execute replace(body, v_old, v_new);
end $$;

-- ---------------------------------------------------------------------------
-- Customer history kept for 12 months (owner decision 3, 2026-11-20).
--
-- Only automatic customer history is removed: audit_logs rows of module
-- 'customer' written without a person (actor_user_id is null: sheet imports,
-- automatic joins), older than 12 months. Everything a person did (edits,
-- deletes, approve/reject, exports) and every other section's history is kept.
-- Runs nightly at 03:15 India time (21:45 UTC), at most 50,000 rows a night,
-- and writes one audit row saying how many it removed.
-- ---------------------------------------------------------------------------
create index if not exists audit_logs_customer_auto_created_idx on public.audit_logs (created_at)
  where module = 'customer' and actor_user_id is null;

create function public.purge_customer_auto_history(p_limit integer default 50000) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_tenant uuid;
begin
  with doomed as (
    select id from public.audit_logs
     where module = 'customer' and actor_user_id is null and created_at < now() - interval '12 months'
     order by created_at limit greatest(1, least(coalesce(p_limit, 50000), 200000)))
  delete from public.audit_logs a using doomed d where a.id = d.id;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    for v_tenant in select id from public.tenants loop
      insert into public.audit_logs (tenant_id, action, module, new_value)
      values (v_tenant, 'customer_auto_history_purged', 'customer_data', jsonb_build_object('removed', v_count, 'older_than', '12 months'));
    end loop;
  end if;
  return v_count;
end $$;
revoke all on function public.purge_customer_auto_history(integer) from public, anon, authenticated;
grant execute on function public.purge_customer_auto_history(integer) to service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('customer-history-retention', '45 21 * * *', 'select public.purge_customer_auto_history();');
  end if;
end $$;
