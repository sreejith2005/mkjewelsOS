-- 0411: take back a sheet import so the sheet can be imported again.
--
-- Why now: on 2026-11-16 the old Runo sheet was imported on production with
-- the id-only row key, before 0410 was applied. That run created 4,097
-- interactions keyed by "Unique id" (one per id, each overwritten by the last
-- row with that id) and dated some profile answers by the time of the run
-- instead of the call. 0410's own clear is skipped once interactions exist,
-- so this migration removes what that run made, precisely:
--
--   removed   interactions of the source, their products, and the follow-ups
--             and appointments they created; profile answers of the source;
--             the stored sheet rows, the sheet's own table rows and the read
--             position
--   undone    follow-ups of other sources that a removed interaction closed
--             are pending again; appointments it completed are booked again
--   kept      clients, phones, names and identifiers. They are true facts
--             from real rows, cannot be attributed to one source once two
--             sheets have seen them, and the correct import of the same sheet
--             writes all of them again.
--
-- After it, client counters and profile columns are recomputed from what is
-- left. Importing the sheet again rebuilds everything under the right key.

create function customer.purge_source(p_source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old uuid[];
  v_clients uuid[];
  v_pair record;
  v_id uuid;
  n_interactions integer := 0; n_values integer := 0; n_follow_ups integer := 0; n_appointments integer := 0;
  n_reopened integer := 0; n_rebooked integer := 0; n_rows integer := 0;
  v_table text;
begin
  if not exists (select 1 from customer.sources where source = p_source) then
    raise exception 'Unknown source: %', p_source using errcode = '22023';
  end if;

  select coalesce(array_agg(id), '{}') into v_old from customer.interactions where source = p_source;
  select coalesce(array_agg(distinct client_id), '{}') into v_clients from (
    select client_id from customer.interactions where source = p_source
    union select client_id from customer.client_field_values where source = p_source) s;

  -- What a removed interaction did to records of other sources.
  update customer.follow_ups set status = 'pending', closed_by_interaction_id = null, closed_at = null
   where closed_by_interaction_id = any (v_old) and (origin_interaction_id is null or origin_interaction_id <> all (v_old));
  get diagnostics n_reopened = row_count;
  update customer.appointments set status = 'booked', visit_interaction_id = null
   where visit_interaction_id = any (v_old) and (origin_interaction_id is null or origin_interaction_id <> all (v_old));
  get diagnostics n_rebooked = row_count;
  update customer.interactions set parent_interaction_id = null
   where parent_interaction_id = any (v_old) and id <> all (v_old);

  -- What the removed interactions created.
  delete from customer.follow_ups where origin_interaction_id = any (v_old);
  get diagnostics n_follow_ups = row_count;
  delete from customer.appointments where origin_interaction_id = any (v_old);
  get diagnostics n_appointments = row_count;

  -- Profile answers of the source, then each touched field is decided again
  -- from the answers that remain.
  create temp table _purged_fields on commit drop as
    with gone as (delete from customer.client_field_values where source = p_source returning client_id, field_key)
    select distinct client_id, field_key from gone;
  select count(*) into n_values from _purged_fields;
  for v_pair in select * from _purged_fields loop
    if not exists (select 1 from customer.client_field_values where client_id = v_pair.client_id and field_key = v_pair.field_key) then
      if exists (select 1 from customer.profile_fields where field_key = v_pair.field_key) then
        execute format('update customer.clients set %I = null where id = $1', v_pair.field_key) using v_pair.client_id;
      end if;
    else
      perform customer.recompute_profile_field(v_pair.client_id, v_pair.field_key);
    end if;
  end loop;
  drop table _purged_fields;

  -- The stored rows, the sheet's own table and the read position.
  delete from customer.ingest_pass_keys where source = p_source;
  delete from customer.ingest_rows where source = p_source;
  get diagnostics n_rows = row_count;
  select table_name into v_table from customer.source_tables where source = p_source;
  if v_table is not null and to_regclass('customer.' || quote_ident(v_table)) is not null then
    execute format('delete from customer.%I', v_table);
  end if;
  update customer.ingest_state
     set next_row = 2, scan_row = 2, scan_started_at = null, completed_at = null, rows_received = 0, last_error = null
   where source = p_source;

  delete from customer.interactions where id = any (v_old);
  get diagnostics n_interactions = row_count;

  foreach v_id in array v_clients loop
    perform customer.refresh_client_stats(v_id);
  end loop;

  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
  select t.tenant_id, null, 'customer_source_purged', 'customer', null,
         jsonb_build_object('source', p_source, 'interactions', n_interactions, 'answers', n_values, 'sheet_rows', n_rows)
    from (select distinct tenant_id from customer.clients where id = any (v_clients)) t;

  return jsonb_build_object('interactions', n_interactions, 'answers', n_values, 'follow_ups', n_follow_ups,
    'appointments', n_appointments, 'follow_ups_reopened', n_reopened, 'appointments_rebooked', n_rebooked,
    'sheet_rows', n_rows, 'clients_recounted', cardinality(v_clients));
end $$;

-- Not callable by any API role: it is run from a migration or the SQL Editor.
revoke all on function customer.purge_source(text) from public, anon, authenticated, service_role;

do $run$
declare v jsonb;
begin
  v := customer.purge_source('runo_old');
  raise notice '0411: runo_old purged: %', v;
end $run$;
