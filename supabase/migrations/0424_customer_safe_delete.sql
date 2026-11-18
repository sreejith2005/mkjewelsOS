-- 0424: delete imported data safely, from the Table Editor or with one line.
--
-- Owner, 2026-11-18: "make it possible that i can delete any data at any time.
-- if i import any wrong or bad data, then i can just delete the table or the
-- records, and it wont affect anything. the related records will just get
-- removed."
--
-- What deleting does now:
--   * A row of a sheet's own table (customer.sheet_*), or of
--     customer.ingest_rows: everything that row made goes with it - its
--     contact on the timeline (and what that contact created: follow-ups,
--     appointments, products, answers), the answers it gave, its FMS step
--     (and the case, when no step is left), and a customer it created who has
--     nothing else left. A customer who also came from other rows stays, with
--     that row's part removed and the profile worked out again.
--   * A customer (customer.clients): their phones, names, ids, answers,
--     contacts, cases, follow-ups and appointments go with them. Customers
--     they referred, merged or lived with stay, unlinked from them.
--   * A whole sheet: select customer.delete_sheet('<source>'); it stops the
--     5-minute job for that sheet first, so it is not read again.
-- A row still in a live Google Sheet comes back at the next read: delete it in
-- the sheet too, or delete the whole sheet with delete_sheet.
--
-- To know which row made which customer and which answer, each now records
-- its sheet row (source_row). Customers and answers made before today are
-- linked from the audit log and from their contact where that is known;
-- the others are never deleted automatically.

-- ---------------------------------------------------------------------------
-- 1. Which row made a customer, and an answer
-- ---------------------------------------------------------------------------
alter table customer.clients add column source_row uuid default nullif(current_setting('customer.current_row', true), '')::uuid;
alter table customer.client_field_values add column source_row uuid default nullif(current_setting('customer.current_row', true), '')::uuid;
create index clients_source_row_idx on customer.clients (source_row) where source_row is not null;
create index client_field_values_source_row_idx on customer.client_field_values (source_row) where source_row is not null;
create index if not exists interactions_source_row_idx on customer.interactions (source_row) where source_row is not null;
create index if not exists clients_referred_by_idx on customer.clients (referred_by_client_id) where referred_by_client_id is not null;
create index if not exists enquiries_opened_idx on customer.enquiries (opened_interaction_id) where opened_interaction_id is not null;

update customer.clients c set source_row = (a.new_value ->> 'source_row')::uuid
  from public.audit_logs a
 where a.action = 'customer_client_created' and a.record_id = c.id
   and a.new_value ->> 'source_row' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and c.source_row is null;
update customer.client_field_values v set source_row = i.source_row
  from customer.interactions i
 where i.id = v.interaction_id and i.source_row is not null and v.source_row is null;

-- ---------------------------------------------------------------------------
-- 2. Deleting a customer or a contact takes what hangs on it
-- ---------------------------------------------------------------------------
do $fks$
declare r record;
begin
  for r in select * from (values
      ('appointments', 'appointments_client_id_fkey', 'client_id', 'clients', 'cascade'),
      ('client_field_values', 'client_field_values_client_id_fkey', 'client_id', 'clients', 'cascade'),
      ('client_identifiers', 'client_identifiers_client_id_fkey', 'client_id', 'clients', 'cascade'),
      ('client_names', 'client_names_client_id_fkey', 'client_id', 'clients', 'cascade'),
      ('client_phones', 'client_phones_client_id_fkey', 'client_id', 'clients', 'cascade'),
      ('enquiries', 'enquiries_client_id_fkey', 'client_id', 'clients', 'cascade'),
      ('follow_ups', 'follow_ups_client_id_fkey', 'client_id', 'clients', 'cascade'),
      ('identity_review', 'identity_review_client_a_fkey', 'client_a', 'clients', 'cascade'),
      ('identity_review', 'identity_review_client_b_fkey', 'client_b', 'clients', 'cascade'),
      ('interaction_products', 'interaction_products_client_id_fkey', 'client_id', 'clients', 'cascade'),
      ('interactions', 'interactions_client_id_fkey', 'client_id', 'clients', 'cascade'),
      ('clients', 'clients_merged_into_client_id_fkey', 'merged_into_client_id', 'clients', 'set null'),
      ('clients', 'clients_referred_by_client_id_fkey', 'referred_by_client_id', 'clients', 'set null'),
      ('households', 'households_main_client_fk', 'main_client_id', 'clients', 'set null'),
      ('ingest_rows', 'ingest_rows_client_id_fkey', 'client_id', 'clients', 'set null'),
      ('appointments', 'appointments_origin_interaction_id_fkey', 'origin_interaction_id', 'interactions', 'cascade'),
      ('appointments', 'appointments_visit_interaction_id_fkey', 'visit_interaction_id', 'interactions', 'set null'),
      ('follow_ups', 'follow_ups_origin_interaction_id_fkey', 'origin_interaction_id', 'interactions', 'cascade'),
      ('follow_ups', 'follow_ups_closed_by_interaction_id_fkey', 'closed_by_interaction_id', 'interactions', 'set null'),
      ('interactions', 'interactions_parent_interaction_id_fkey', 'parent_interaction_id', 'interactions', 'set null'),
      ('client_field_values', 'client_field_values_interaction_fk', 'interaction_id', 'interactions', 'cascade')
    ) as t(tbl, con, col, ref, act)
  loop
    execute format('alter table customer.%I drop constraint %I', r.tbl, r.con);
    execute format('alter table customer.%I add constraint %I foreign key (%I) references customer.%I(id) on delete %s',
      r.tbl, r.con, r.col, r.ref, r.act);
  end loop;
end $fks$;

-- ---------------------------------------------------------------------------
-- 3. Keeping the rest right after a delete
-- ---------------------------------------------------------------------------
-- Bulk deletes (purge_source, delete_sheet) set customer.bulk and do this work
-- once at the end instead of row by row.
create function customer.bulk_delete_running() returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('customer.bulk', true), '') = 'on'
$$;

-- A customer with nothing left: no contact, no sheet row, no case, no answer,
-- and nobody they referred.
create function customer.client_is_empty(p_client_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from customer.clients where id = p_client_id)
     and not exists (select 1 from customer.interactions where client_id = p_client_id)
     and not exists (select 1 from customer.ingest_rows where client_id = p_client_id)
     and not exists (select 1 from customer.enquiries where client_id = p_client_id)
     and not exists (select 1 from customer.client_field_values where client_id = p_client_id)
     and not exists (select 1 from customer.clients where referred_by_client_id = p_client_id)
$$;

-- An answer gone: the profile column takes the next answer, or empties.
create function customer.on_field_value_deleted() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if customer.bulk_delete_running() or not exists (select 1 from customer.clients where id = old.client_id) then return null; end if;
  if not exists (select 1 from customer.client_field_values where client_id = old.client_id and field_key = old.field_key) then
    if exists (select 1 from customer.profile_fields where field_key = old.field_key) then
      execute format('update customer.clients set %I = null where id = $1', old.field_key) using old.client_id;
    end if;
  else
    perform customer.recompute_profile_field(old.client_id, old.field_key);
  end if;
  return null;
end $$;
create trigger client_field_values_deleted after delete on customer.client_field_values
  for each row execute function customer.on_field_value_deleted();

-- A contact gone: the customer's counts and dates are worked out again.
create function customer.on_interaction_deleted() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not customer.bulk_delete_running() and exists (select 1 from customer.clients where id = old.client_id) then
    perform customer.refresh_client_stats(old.client_id);
  end if;
  return null;
end $$;
create trigger interactions_deleted after delete on customer.interactions
  for each row execute function customer.on_interaction_deleted();

-- A sheet row gone: what it made goes with it. Done after the row is gone:
-- removing its contact first would update the row being deleted (its
-- interaction_id is set null), which Postgres refuses.
create function customer.on_ingest_row_deleted() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_case record; v_client uuid;
begin
  if customer.bulk_delete_running() then return null; end if;
  delete from customer.interactions where source_row = old.id;
  delete from customer.client_field_values where source_row = old.id;
  -- Cases of this sheet with no step left (the step went with the row).
  for v_case in select e.id, e.opened_interaction_id from customer.enquiries e
                 where e.tenant_id = old.tenant_id and e.source = old.source
                   and not exists (select 1 from customer.enquiry_steps s where s.enquiry_id = e.id) loop
    delete from customer.enquiries where id = v_case.id;
    if v_case.opened_interaction_id is not null then delete from customer.interactions where id = v_case.opened_interaction_id; end if;
  end loop;
  -- The customer of the row, and any customer the row made.
  for v_client in select old.client_id where old.client_id is not null
                  union select id from customer.clients where source_row = old.id loop
    if customer.client_is_empty(v_client) then
      delete from customer.clients where id = v_client;
    elsif exists (select 1 from customer.clients where id = v_client) then
      perform customer.refresh_client_stats(v_client);
    end if;
  end loop;
  return null;
end $$;
create trigger ingest_rows_deleted after delete on customer.ingest_rows
  for each row execute function customer.on_ingest_row_deleted();

-- A row deleted from a sheet's own table deletes the stored row behind it.
create function customer.on_sheet_table_row_deleted() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not customer.bulk_delete_running() then
    delete from customer.ingest_rows where tenant_id = old._tenant_id and source = tg_argv[0] and row_key = old._row_key;
  end if;
  return null;
end $$;

create function customer.attach_sheet_table_trigger(p_source text) returns void language plpgsql security definer set search_path = '' as $$
declare v_table text;
begin
  select table_name into v_table from customer.source_tables where source = p_source;
  if v_table is not null and to_regclass(format('customer.%I', v_table)) is not null then
    execute format('create or replace trigger sheet_row_deleted after delete on customer.%I for each row execute function customer.on_sheet_table_row_deleted(%L)',
      v_table, p_source);
  end if;
end $$;
do $attach$
declare s text;
begin
  for s in select source from customer.source_tables loop perform customer.attach_sheet_table_trigger(s); end loop;
end $attach$;

-- ---------------------------------------------------------------------------
-- 4. Patches: new sheet tables get the trigger; imports record their row;
--    purge works in bulk.
-- ---------------------------------------------------------------------------
create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0424: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

do $patches$
begin
  perform customer._patch('customer.ensure_source_table(text,text[])'::regprocedure,
    E'    execute format(''grant all on customer.%I to service_role'', v_table);\n  end if;',
    E'    execute format(''grant all on customer.%I to service_role'', v_table);\n    perform customer.attach_sheet_table_trigger(p_source);\n  end if;', 1);
  perform customer._patch('public.customer_ingest_apply(text,integer)'::regprocedure,
    E'    begin\n      case v_importer',
    E'    begin\n      perform set_config(''customer.current_row'', r.id::text, true);\n      case v_importer', 1);
  perform customer._patch('public.customer_ingest_apply(text,integer)'::regprocedure,
    E'    v_done := v_done || r.id;\n  end loop;',
    E'    v_done := v_done || r.id;\n  end loop;\n  perform set_config(''customer.current_row'', '''', true);', 1);
  perform customer._patch('customer.purge_source(text)'::regprocedure,
    E'  if not exists (select 1 from customer.sources where source = p_source) then',
    E'  perform set_config(''customer.bulk'', ''on'', true);\n  if not exists (select 1 from customer.sources where source = p_source) then', 1);
end $patches$;
drop function customer._patch(regprocedure, text, text, integer);

-- ---------------------------------------------------------------------------
-- 5. A whole sheet
-- ---------------------------------------------------------------------------
-- Stops the sheet's 5-minute job, removes everything it brought in, then the
-- customers it made who have nothing left. Run from the SQL Editor:
--   select customer.delete_sheet('exhibition');
-- Import it again later with a named run of customer-sheets-sync.
create function customer.delete_sheet(p_source text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_candidates uuid[]; v_result jsonb; v_id uuid; n integer := 0;
begin
  if not exists (select 1 from customer.source_tables where source = p_source) then
    raise exception 'Unknown sheet: %', p_source using errcode = '22023';
  end if;
  update customer.source_tables set scheduled = false where source = p_source;
  select coalesce(array_agg(distinct c), '{}') into v_candidates from (
    select client_id as c from customer.ingest_rows where source = p_source and client_id is not null
    union select cl.id from customer.clients cl join customer.ingest_rows r on r.id = cl.source_row where r.source = p_source) x;
  delete from customer.enquiries where source = p_source;
  v_result := customer.purge_source(p_source);
  foreach v_id in array v_candidates loop
    if customer.client_is_empty(v_id) then
      delete from customer.clients where id = v_id;
      n := n + 1;
    end if;
  end loop;
  return v_result || jsonb_build_object('customers_deleted', n, 'scheduled', false);
end $$;

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function customer.delete_sheet(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;
