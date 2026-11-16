-- 0409: customer master database, part 5 - one table per sheet, full sync.
--
-- Owner requirements 2026-11-14 / 2026-11-16:
--   * every sheet has its own table with the sheet's own columns, next to the
--     master;
--   * the database follows the sheet completely: a new row, an edit to any row
--     however old, and a deleted row all show up;
--   * the old Runo sheet is imported once.
--
--   customer.source_tables / source_columns   which table and columns a sheet has
--   customer.sheet_runo_live, sheet_runo_old   created on first read, columns in sheet order
--   customer.ingest_pass_keys                  the row keys seen during one full pass
--   customer.customer_master                   the master as one flat view, for export
--
-- Flow: sheet row -> customer.ingest_rows (unchanged copy) -> the sheet's own
-- table -> master (client, interaction, follow-ups ...).
--
-- Deletion is a soft delete. A row that is gone from the sheet after a full
-- pass is marked removed; its interaction is archived, its pending follow-ups
-- and appointments are cancelled, the answers it gave are withdrawn, and a
-- client left with nothing is archived. If the row comes back, all of it is
-- restored. Guard: if more than 5% of a sheet (and more than 50 rows) vanish in
-- one pass, nothing is removed and the import records an error instead.

-- ---------------------------------------------------------------------------
-- 1. Columns and tables
-- ---------------------------------------------------------------------------
insert into customer.sources (source, source_rank, label) values ('runo_old', 2, 'Runo calling (old sheet)')
on conflict (source) do nothing;

alter table customer.ingest_rows drop constraint ingest_rows_status_check;
alter table customer.ingest_rows add constraint ingest_rows_status_check check (status in ('pending', 'applied', 'rejected', 'removed'));
alter table customer.ingest_rows add column removed_at timestamptz;

alter table customer.ingest_state
  add column scan_row integer not null default 2,
  add column scan_started_at timestamptz,
  add column last_full_pass_at timestamptz,
  add column completed_at timestamptz;

alter table customer.interactions add column archived_at timestamptz, add column archive_reason text;
create index interactions_archived_idx on customer.interactions (tenant_id) where archived_at is not null;

create table customer.ingest_pass_keys (
  tenant_id uuid not null,
  source text not null,
  row_key text not null,
  primary key (tenant_id, source, row_key)
);

create table customer.source_tables (
  source text primary key references customer.sources(source),
  table_name text not null unique check (table_name ~ '^sheet_[a-z0-9_]{1,40}$'),
  label text not null,
  importer text not null check (importer in ('runo')),
  one_time boolean not null default false
);
insert into customer.source_tables (source, table_name, label, importer, one_time) values
  ('runo', 'sheet_runo_live', 'Runo live interactions', 'runo', false),
  ('runo_old', 'sheet_runo_old', 'Runo old data', 'runo', true);

create table customer.source_columns (
  source text not null references customer.source_tables(source),
  header text not null,
  column_name text not null,
  position integer not null,
  in_sheet boolean not null default true,
  added_at timestamptz not null default now(),
  primary key (source, header),
  unique (source, column_name)
);

alter table customer.ingest_pass_keys enable row level security;
alter table customer.source_tables enable row level security;
alter table customer.source_columns enable row level security;

-- ---------------------------------------------------------------------------
-- 2. A sheet's own table
-- ---------------------------------------------------------------------------

-- Create the sheet's table on first use and add a column for every header not
-- seen before, in sheet order. A header that left the sheet keeps its column
-- and data and is marked in_sheet = false.
create function customer.ensure_source_table(p_source text, p_headers text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_table text; v_header text; v_pos integer; v_col text; v_try integer;
begin
  select table_name into v_table from customer.source_tables where source = p_source;
  if v_table is null then raise exception 'No table is registered for source %', p_source using errcode = '22023'; end if;

  if to_regclass(format('customer.%I', v_table)) is null then
    execute format($t$create table customer.%I (
      _tenant_id uuid not null,
      _row_key text not null,
      _sheet_row integer,
      _status text,
      _reject_reason text,
      _client_id uuid,
      _client_code text,
      _interaction_id uuid,
      _first_seen_at timestamptz,
      _changed_at timestamptz,
      _removed_at timestamptz,
      primary key (_tenant_id, _row_key))$t$, v_table);
    execute format('create index on customer.%I (_client_id)', v_table);
    execute format('alter table customer.%I enable row level security', v_table);
    execute format('revoke all on customer.%I from public, anon, authenticated', v_table);
    execute format('grant all on customer.%I to service_role', v_table);
  end if;
  if p_headers is null or cardinality(p_headers) = 0 then return; end if;

  for v_header, v_pos in
    select btrim(h), ord::integer from unnest(p_headers) with ordinality t(h, ord) where btrim(coalesce(h, '')) <> ''
  loop
    if exists (select 1 from customer.source_columns where source = p_source and header = v_header) then
      update customer.source_columns set in_sheet = true, position = v_pos
       where source = p_source and header = v_header and (not in_sheet or position <> v_pos);
      continue;
    end if;
    -- The column is named like the header. Names starting with "_" are ours.
    v_col := left(case when left(v_header, 1) = '_' then 'col ' || v_header else v_header end, 60);
    v_try := 1;
    while exists (select 1 from customer.source_columns where source = p_source and column_name = v_col) loop
      v_try := v_try + 1;
      v_col := left(v_header, 55) || ' ' || v_try;
    end loop;
    execute format('alter table customer.%I add column %I text', v_table, v_col);
    insert into customer.source_columns (source, header, column_name, position) values (p_source, v_header, v_col, v_pos);
  end loop;

  update customer.source_columns set in_sheet = false
   where source = p_source and in_sheet and header <> all (select btrim(h) from unnest(p_headers) h);
end $$;

-- Copy rows from ingest_rows into the sheet's own table. p_only_missing = true
-- copies only rows the table does not have yet.
create function customer.project_source_rows(p_source text, p_ids uuid[], p_only_missing boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_table text; v_cols text; v_exprs text; v_sets text; n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  select table_name into v_table from customer.source_tables where source = p_source;
  if v_table is null or to_regclass(format('customer.%I', v_table)) is null then return 0; end if;
  select coalesce(string_agg(format(', %I', column_name), '' order by position, header), ''),
         coalesce(string_agg(format(', nullif(btrim(r.payload ->> %L), '''')', header), '' order by position, header), ''),
         coalesce(string_agg(format(', %1$I = excluded.%1$I', column_name), '' order by position, header), '')
    into v_cols, v_exprs, v_sets from customer.source_columns where source = p_source;

  execute format($q$
    insert into customer.%1$I (_tenant_id, _row_key, _sheet_row, _status, _reject_reason, _client_id, _client_code,
                               _interaction_id, _first_seen_at, _changed_at, _removed_at %2$s)
    select r.tenant_id, r.row_key, r.sheet_row, r.status, r.reject_reason, r.client_id, c.client_code,
           r.interaction_id, r.received_at, r.updated_at, r.removed_at %3$s
      from customer.ingest_rows r left join customer.clients c on c.id = r.client_id
     where r.id = any ($1) and r.source = $2
       and (not $3 or not exists (select 1 from customer.%1$I s where s._tenant_id = r.tenant_id and s._row_key = r.row_key))
    on conflict (_tenant_id, _row_key) do update set
      _sheet_row = excluded._sheet_row, _status = excluded._status, _reject_reason = excluded._reject_reason,
      _client_id = excluded._client_id, _client_code = excluded._client_code, _interaction_id = excluded._interaction_id,
      _changed_at = excluded._changed_at, _removed_at = excluded._removed_at %4$s
  $q$, v_table, v_cols, v_exprs, v_sets) using p_ids, p_source, p_only_missing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Answers from a sheet row, and removal
-- ---------------------------------------------------------------------------

-- An answer from a sheet row. First import: dated by the row. A value added to
-- an old row later: dated by when the change was seen, so it counts as new.
create function customer.set_source_field(
  p_client_id uuid, p_field_key text, p_value text, p_source text,
  p_row_at timestamptz, p_changed_at timestamptz, p_interaction_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare v_value text := customer.clean_name(p_value); v_at timestamptz := p_row_at;
begin
  if v_value is null then return; end if;
  if p_changed_at is not null and p_changed_at > p_row_at and not exists (
       select 1 from customer.client_field_values v
        where v.client_id = p_client_id and v.field_key = p_field_key and v.source = p_source and lower(v.value) = lower(v_value)) then
    v_at := p_changed_at;
  end if;
  perform customer.set_field_value(p_client_id, p_field_key, v_value, p_source, v_at, p_interaction_id);
end $$;

-- A row that is gone from its sheet. Nothing is deleted.
create function customer.remove_source_row(p_ingest_row_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row customer.ingest_rows; v_key text; v_keys text[];
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.status = 'removed' then return; end if;
  update customer.ingest_rows set status = 'removed', removed_at = now(), updated_at = now() where id = v_row.id;

  if v_row.interaction_id is not null
     and exists (select 1 from customer.interactions where id = v_row.interaction_id and source_row = v_row.id) then
    update customer.interactions set archived_at = now(), archive_reason = 'removed_from_sheet'
     where id = v_row.interaction_id and archived_at is null;
    update customer.follow_ups set status = 'cancelled' where origin_interaction_id = v_row.interaction_id and status = 'pending';
    update customer.appointments set status = 'cancelled' where origin_interaction_id = v_row.interaction_id and status = 'booked';
    with gone as (
      delete from customer.client_field_values where interaction_id = v_row.interaction_id returning field_key
    ) select array_agg(distinct field_key) into v_keys from gone;
    if v_keys is not null and v_row.client_id is not null then
      foreach v_key in array v_keys loop
        if not exists (select 1 from customer.client_field_values where client_id = v_row.client_id and field_key = v_key)
           and exists (select 1 from customer.profile_fields where field_key = v_key) then
          execute format('update customer.clients set %I = null where id = $1', v_key) using v_row.client_id;
        else
          perform customer.recompute_profile_field(v_row.client_id, v_key);
        end if;
      end loop;
    end if;
  end if;

  if v_row.client_id is not null then
    perform customer.refresh_client_stats(v_row.client_id);
    -- A client that nothing points to any more is archived, not deleted.
    update customer.clients c set archived_at = now(), archive_reason = 'removed_from_sheet'
     where c.id = v_row.client_id and c.archived_at is null
       and not exists (select 1 from customer.interactions i where i.client_id = c.id and i.archived_at is null)
       and not exists (select 1 from customer.ingest_rows r where r.client_id = c.id and r.status <> 'removed');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Archived interactions do not count and are not shown
-- ---------------------------------------------------------------------------
create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0409: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

do $patches$
begin
  perform customer._patch('customer.refresh_client_stats(uuid)'::regprocedure,
  'from customer.interactions where client_id = p_client_id', 'from customer.interactions where client_id = p_client_id and archived_at is null', 1);
  perform customer._patch('customer.refresh_client_stats(uuid)'::regprocedure,
  'where client_id = p_client_id order by occurred_at, created_at limit 1', 'where client_id = p_client_id and archived_at is null order by occurred_at, created_at limit 1', 1);
  perform customer._patch('public.customer_get_timeline(uuid, integer, timestamptz)'::regprocedure,
  'where i.client_id = p_client_id and (p_before', 'where i.client_id = p_client_id and i.archived_at is null and (p_before', 1);
  perform customer._patch('public.customer_calls_by_staff(date)'::regprocedure,
  'where i.tenant_id = v_tenant and i.channel in', 'where i.tenant_id = v_tenant and i.archived_at is null and i.channel in', 1);
end $patches$;
drop function customer._patch(regprocedure, text, text, integer);

-- ---------------------------------------------------------------------------
-- 5. One Runo row (live or old sheet)
-- ---------------------------------------------------------------------------
create or replace function customer.apply_runo_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows;
  p jsonb;
  v_tenant uuid;
  v_at timestamptz;
  v_client uuid;
  v_household uuid;
  v_status text;
  v_reason text;
  v_successful boolean := true;
  v_result text := 'neutral';
  v_purpose text := 'other';
  v_channel text := 'call';
  v_interest text := 'interested';
  v_staff uuid;
  v_interaction uuid;
  v_other uuid;
  v_text text;
  v_due timestamptz;
  v_codes text[];
  v_cats text[];
  v_code text;
  v_misses integer;
  v_changed timestamptz;
  f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.source not in ('runo', 'runo_old') then raise exception 'Runo row not found' using errcode = '22023'; end if;
  v_tenant := v_row.tenant_id;
  -- A row applied before and now changed: what is new in it was learned when
  -- the change was seen, not on the day of the original call.
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  -- Empty cells are treated as missing.
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';

  -- The old and the live Runo sheets overlap for a few weeks. A call already
  -- imported from the live sheet under the same id is not imported twice.
  if v_row.source = 'runo_old' then
    select i.id, i.client_id into v_interaction, v_client from customer.interactions i
     where i.tenant_id = v_tenant and i.source = 'runo' and i.external_ref = v_row.row_key;
    if v_interaction is not null then
      update customer.ingest_rows
         set status = 'applied', reject_reason = 'Same call as the live sheet', removed_at = null, client_id = v_client,
             interaction_id = v_interaction, applied_at = now(), updated_at = now(), attempts = attempts + 1
       where id = v_row.id;
      return v_interaction;
    end if;
  end if;

  v_at := customer.parse_sheet_timestamp(p ->> 'Interaction Date');
  if v_at is null then raise exception 'Interaction Date is missing or unreadable' using errcode = '22007'; end if;

  -- 3.1 Who ---------------------------------------------------------------
  v_client := customer.find_or_create_client(
    v_tenant, p ->> 'Mobile Number', concat_ws(' ', p ->> 'Name', p ->> 'Last Name'), v_row.source, v_at,
    '{}', p ->> 'Billing Phone Number Add +91', null, v_row.id);
  select household_id into v_household from customer.clients where id = v_client;

  if p ? 'Customer Id' then
    insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
    values (v_tenant, v_client, 'runo_customer_id', p ->> 'Customer Id', v_row.source, v_at) on conflict do nothing;
  end if;
  if (p ->> 'Email') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
    values (v_tenant, v_client, 'email', lower(p ->> 'Email'), v_row.source, v_at) on conflict do nothing;
    perform customer.set_source_field(v_client, 'email', lower(p ->> 'Email'), v_row.source, v_at, v_changed, null);
  end if;

  -- 3.2 Outcome -----------------------------------------------------------
  v_status := p ->> 'Status';
  v_reason := p ->> 'Non contact reason';
  case lower(coalesce(v_status, ''))
    when 'not contacted' then v_successful := false; v_result := 'not_connected';
    when 'call back later' then v_result := 'neutral';
    when 'interested' then v_result := 'positive'; v_purpose := 'enquiry';
    when 'price enquiry' then v_result := 'positive'; v_purpose := 'enquiry';
    when 'not interested' then v_result := 'negative';
    when 'invited to store' then v_result := 'positive';
    when 'invited to exhibition' then v_result := 'positive'; v_purpose := 'exhibition';
    when 'video call - scheduled' then v_result := 'positive';
    when 'video call - demonstration' then v_result := 'positive'; v_channel := 'video_call';
    when 'video call - did not buy' then v_result := 'negative'; v_channel := 'video_call';
    when 'video call - bought' then v_result := 'positive'; v_channel := 'video_call'; v_purpose := 'purchase'; v_interest := 'bought';
    when 'visited - did not buy' then v_result := 'negative'; v_purpose := 'visit';
    when 'visited - bought' then v_result := 'positive'; v_purpose := 'visit'; v_interest := 'bought';
    when 'order placed' then v_result := 'positive'; v_purpose := 'order'; v_interest := 'ordered';
    when 'order delivered' then v_result := 'positive'; v_purpose := 'order'; v_interest := 'bought';
    when 'repair placed' then v_purpose := 'repair';
    when 'repair delivered' then v_purpose := 'repair';
    when 'family of buyer' then null;
    when 'nse calling' then null;
    when '' then
      if v_reason is not null and lower(v_reason) <> 'call back later' then v_successful := false; v_result := 'not_connected'; end if;
    else null;  -- a status added to Runo later: kept as written, read as neutral
  end case;

  v_staff := customer.resolve_staff(v_tenant, p ->> 'Assigned To');
  v_interaction := customer.record_interaction(v_client, jsonb_strip_nulls(jsonb_build_object(
    'occurred_at', v_at, 'channel', v_channel, 'direction', 'outbound', 'purpose', v_purpose, 'source', v_row.source,
    'external_ref', v_row.row_key, 'source_row', v_row.id,
    'outcome', v_status, 'result', v_result, 'successful', v_successful, 'non_contact_reason', v_reason,
    'staff_user_id', v_staff, 'staff_name', p ->> 'Assigned To',
    'assigned_by_user_id', customer.resolve_staff(v_tenant, p ->> 'Assigned By'),
    'attended_by_user_id', customer.resolve_staff(v_tenant, p ->> 'Attended By'), 'attended_by_name', p ->> 'Attended By',
    'branch_id', customer.resolve_branch(v_tenant, p ->> 'Store'), 'store_name', p ->> 'Store',
    'contact_role', p ->> 'Buyer OR Family Member', 'customer_type_stated', p ->> 'Old Or New Customer',
    'process_name', p ->> 'Process Name', 'notes', p ->> 'Notes')));
  -- A row that was removed from the sheet and is back restores what it made.
  update customer.interactions set archived_at = null, archive_reason = null where id = v_interaction and archived_at is not null;
  if found then perform customer.refresh_client_stats(v_client); end if;
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';
  update customer.interactions set assigned_by_name = p ->> 'Assigned By'
   where id = v_interaction and assigned_by_name is distinct from (p ->> 'Assigned By');

  -- 3.3 Profile answers ----------------------------------------------------
  for f in select * from (values
      ('Street', 'address'), ('City', 'city'), ('State', 'state'), ('Country', 'country'), ('Pincode', 'pincode'),
      ('Marketing Messages', 'marketing_message'), ('Caste', 'community'), ('Beverage', 'beverage'), ('Snack', 'snack'),
      ('Gift Given', 'gift_given'), ('Source', 'lead_source'), ('Source Of Lead', 'lead_source')) as m(header, field_key)
  loop
    if p ? f.header and upper(p ->> f.header) not in ('NA', 'N/A', '-') then
      perform customer.set_source_field(v_client, f.field_key, p ->> f.header, v_row.source, v_at, v_changed, v_interaction);
    end if;
  end loop;

  -- Date Of Birth and Date Of Anniversary are dropdowns; the date itself is in
  -- Date / Month / Year and is the birthday.
  if p ? 'Date Of Birth' then
    if lower(p ->> 'Date Of Birth') like 'not%' then
      perform customer.set_source_field(v_client, 'dob_status', 'declined', v_row.source, v_at, v_changed, v_interaction);
    else
      perform customer.set_source_field(v_client, 'dob_status', 'given', v_row.source, v_at, v_changed, v_interaction);
      v_text := customer.compose_profile_date(p ->> 'Date', p ->> 'Month', p ->> 'Year');
      if v_text is not null then
        perform customer.set_source_field(v_client, 'dob', v_text, v_row.source, v_at, v_changed, v_interaction);
      end if;
    end if;
  end if;
  if p ? 'Date Of Anniversary' then
    perform customer.set_source_field(v_client, 'marital_status',
      case when lower(p ->> 'Date Of Anniversary') like 'un%' then 'Unmarried' else 'Married' end, v_row.source, v_at, v_changed, v_interaction);
  end if;

  -- 3.4 Products ------------------------------------------------------------
  delete from customer.interaction_products where interaction_id = v_interaction;
  select array_agg(distinct x) into v_codes
    from regexp_split_to_table(concat_ws(',', p ->> 'Product Code', p ->> 'Products Code'), '\s*[,;\n]\s*') x where btrim(x) <> '';
  select array_agg(distinct x) into v_cats
    from regexp_split_to_table(concat_ws(',', p ->> 'Product Category', p ->> 'Product Categories'), '\s*[,;\n]\s*') x where btrim(x) <> '';
  if v_codes is not null then
    foreach v_code in array v_codes loop
      perform customer.add_interaction_product(v_interaction, v_code,
        case when cardinality(v_cats) = 1 then v_cats[1] end, v_interest);
    end loop;
  end if;
  if v_cats is not null and (v_codes is null or cardinality(v_cats) > 1) then
    foreach v_code in array v_cats loop
      perform customer.add_interaction_product(v_interaction, null, v_code, v_interest);
    end loop;
  end if;

  -- 3.5 What this contact leads to ------------------------------------------
  if v_successful then
    perform customer.close_follow_ups(v_client, v_interaction);
  end if;

  for f in select * from (values
      ('Hot Followup On', 'hot'), ('Cold Followup On', 'cold'),
      ('Not Interested - Set Follow Up 3 Months From Today', 'three_month'), ('Set Follow Up For 3 Months Later', 'three_month'),
      ('Follow Up', 'call_later'), ('Non Contact Followup On', 'retry')) as m(header, kind)
  loop
    v_due := customer.parse_sheet_timestamp(p ->> f.header);
    if v_due is not null then
      perform customer.create_follow_up(v_client, f.kind, v_due, v_interaction, v_staff, p ->> 'Reason');
    end if;
  end loop;

  -- Not reached: try again the next day, at most three misses in a row.
  if not v_successful and lower(coalesce(v_reason, '')) in ('switched off', 'not reachable', 'not picking')
     and customer.parse_sheet_timestamp(p ->> 'Non Contact Followup On') is null then
    select count(*) into v_misses from customer.interactions i
     where i.client_id = v_client and not i.successful and i.occurred_at <= v_at
       and i.occurred_at > coalesce((select max(s.occurred_at) from customer.interactions s
                                      where s.client_id = v_client and s.successful and s.occurred_at <= v_at), '-infinity');
    if v_misses < 3 then
      perform customer.create_follow_up(v_client, 'retry', v_at + interval '1 day', v_interaction, v_staff, v_reason);
    end if;
  end if;

  v_due := customer.parse_sheet_timestamp(p ->> 'Interested Now - Set Day Of Visit');
  if v_due is not null then
    perform customer.create_appointment(v_client, 'store', v_due, v_interaction, customer.resolve_branch(v_tenant, p ->> 'Store'));
  end if;
  v_due := customer.parse_sheet_timestamp(p ->> 'Date And Time Of Video Call');
  if v_due is not null and lower(coalesce(v_status, '')) not in ('video call - demonstration', 'video call - did not buy', 'video call - bought') then
    perform customer.create_appointment(v_client, 'video', v_due, v_interaction, null);
  end if;
  -- A video call that happened completes the booked video appointment.
  if v_channel = 'video_call' then
    update customer.appointments a set status = 'visited', visit_interaction_id = v_interaction
     where a.id = (select id from customer.appointments
                    where client_id = v_client and type = 'video' and status = 'booked'
                      and scheduled_at <= v_at + interval '1 day'
                    order by scheduled_at desc limit 1);
  end if;

  -- 3.6 Family and referrer ---------------------------------------------------
  if p ? 'Spouse Name' or p ? 'Spouse Phone' then
    if customer.normalize_phone(p ->> 'Spouse Phone') is not null
       and not exists (select 1 from customer.client_phones
                        where tenant_id = v_tenant and phone = customer.normalize_phone(p ->> 'Spouse Phone') and client_id = v_client) then
      v_other := customer.find_or_create_client(v_tenant, p ->> 'Spouse Phone', p ->> 'Spouse Name', v_row.source, v_at, '{}', null, null, v_row.id);
      -- Join the family only when the spouse is alone in their own.
      if (select household_id from customer.clients where id = v_other) <> v_household
         and (select count(*) from customer.clients c
               where c.household_id = (select household_id from customer.clients where id = v_other)) = 1 then
        update customer.clients set household_id = v_household where id = v_other;
        delete from customer.households h where h.main_client_id = v_other and h.id <> v_household
           and not exists (select 1 from customer.clients c where c.household_id = h.id);
      end if;
    elsif p ? 'Spouse Name' then
      perform customer.create_client_without_phone(v_tenant, v_household, p ->> 'Spouse Name', v_row.source, v_at);
    end if;
  end if;

  if customer.normalize_phone(p ->> 'Referrer Number') is not null then
    v_other := customer.find_or_create_client(v_tenant, p ->> 'Referrer Number', p ->> 'Referrer Name', v_row.source, v_at, '{}', null, null, v_row.id);
    update customer.clients set referred_by_client_id = v_other
     where id = v_client and referred_by_client_id is null and v_other <> v_client;
  end if;

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client, interaction_id = v_interaction,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return v_interaction;
end $$;

revoke all on all tables in schema customer from public, anon, authenticated;
grant all on all tables in schema customer to service_role;
revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;

-- ---------------------------------------------------------------------------
-- 6. Contracts for the Edge Function (service role only)
-- ---------------------------------------------------------------------------
drop function public.customer_ingest_state(text);
create function public.customer_ingest_state(p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := customer.ingest_tenant(); v customer.ingest_state;
begin
  insert into customer.ingest_state (tenant_id, source) values (v_tenant, p_source) on conflict do nothing;
  select * into v from customer.ingest_state where tenant_id = v_tenant and source = p_source;
  return jsonb_build_object('next_row', v.next_row, 'scan_row', v.scan_row, 'rows_received', v.rows_received,
    'completed', v.completed_at is not null, 'last_full_pass_at', v.last_full_pass_at,
    'pending', (select count(*) from customer.ingest_rows where tenant_id = v_tenant and source = p_source and status = 'pending'),
    'rejected', (select count(*) from customer.ingest_rows where tenant_id = v_tenant and source = p_source and status = 'rejected'));
end $$;

-- Store sheet rows. p_rows = [{ "row_key", "sheet_row", "payload" }].
-- p_options: headers (array, sheet order), next_row (tail position),
-- scan (true when the rows come from the full pass), scan_row (pass position),
-- completed (true when a one-time sheet has been read to the end).
create function public.customer_ingest_store(p_source text, p_rows jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := customer.ingest_tenant();
  o jsonb := coalesce(p_options, '{}'::jsonb);
  v_new integer := 0; v_changed integer := 0; v_total integer := 0;
  v_touched uuid[]; v_all uuid[]; v_keys text[];
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'p_rows must be an array' using errcode = '22023';
  end if;
  if jsonb_typeof(o -> 'headers') = 'array' then
    perform customer.ensure_source_table(p_source, array(select jsonb_array_elements_text(o -> 'headers')));
  end if;

  drop table if exists pg_temp._incoming;
  create temp table _incoming on commit drop as
    select distinct on (btrim(r ->> 'row_key')) btrim(r ->> 'row_key') as row_key, nullif(r ->> 'sheet_row', '')::integer as sheet_row,
           r -> 'payload' as payload, md5((r -> 'payload')::text) as fingerprint
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where btrim(coalesce(r ->> 'row_key', '')) <> '' and jsonb_typeof(r -> 'payload') = 'object'
     order by btrim(r ->> 'row_key'), nullif(r ->> 'sheet_row', '')::integer desc;
  select count(*), array_agg(row_key) into v_total, v_keys from _incoming;

  with up as (
    insert into customer.ingest_rows (tenant_id, source, row_key, sheet_row, payload, fingerprint)
    select v_tenant, p_source, row_key, sheet_row, payload, fingerprint from _incoming
    on conflict (tenant_id, source, row_key) do update
      set payload = excluded.payload, fingerprint = excluded.fingerprint, sheet_row = excluded.sheet_row,
          status = 'pending', reject_reason = null, removed_at = null, updated_at = now()
      -- A changed row is queued again; so is a removed row that is back.
      where customer.ingest_rows.fingerprint is distinct from excluded.fingerprint or customer.ingest_rows.status = 'removed'
    returning id, (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted), array_agg(id)
    into v_new, v_changed, v_touched from up;

  -- Every key read counts as seen for the running full pass.
  if coalesce((o ->> 'scan')::boolean, false) then
    insert into customer.ingest_state (tenant_id, source) values (v_tenant, p_source) on conflict do nothing;
    update customer.ingest_state set scan_started_at = now()
     where tenant_id = v_tenant and source = p_source and scan_started_at is null;
    if found then
      -- A new pass starts with an empty list of seen keys.
      delete from customer.ingest_pass_keys where tenant_id = v_tenant and source = p_source;
    end if;
  end if;
  if v_keys is not null then
    insert into customer.ingest_pass_keys (tenant_id, source, row_key)
    select v_tenant, p_source, k from unnest(v_keys) k on conflict do nothing;
    select array_agg(id) into v_all from customer.ingest_rows where tenant_id = v_tenant and source = p_source and row_key = any (v_keys);
  end if;

  perform customer.project_source_rows(p_source, v_touched, false);
  perform customer.project_source_rows(p_source, v_all, true);

  insert into customer.ingest_state (tenant_id, source, next_row, scan_row, completed_at, rows_received, last_run_at, last_error)
  values (v_tenant, p_source, coalesce((o ->> 'next_row')::integer, 2), coalesce((o ->> 'scan_row')::integer, 2),
          case when coalesce((o ->> 'completed')::boolean, false) then now() end, v_new, now(), null)
  on conflict (tenant_id, source) do update
    set next_row = coalesce((o ->> 'next_row')::integer, customer.ingest_state.next_row),
        scan_row = coalesce((o ->> 'scan_row')::integer, customer.ingest_state.scan_row),
        completed_at = case when coalesce((o ->> 'completed')::boolean, false) then coalesce(customer.ingest_state.completed_at, now())
                            else customer.ingest_state.completed_at end,
        rows_received = customer.ingest_state.rows_received + v_new, last_run_at = now(),
        last_error = case when customer.ingest_state.last_error like 'too_many_rows_missing%' then customer.ingest_state.last_error end;
  return jsonb_build_object('received', v_total, 'new', v_new, 'changed', v_changed);
end $$;

-- The full pass has read the whole sheet: rows stored before the pass began and
-- not seen during it are gone from the sheet. Removes up to p_limit per call;
-- call again while "remaining" is true.
create function public.customer_ingest_finish_scan(p_source text, p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := customer.ingest_tenant();
  v_started timestamptz; v_missing integer; v_total integer; v_ids uuid[]; v_id uuid;
begin
  select scan_started_at into v_started from customer.ingest_state where tenant_id = v_tenant and source = p_source;
  if v_started is null then return jsonb_build_object('removed', 0, 'remaining', false, 'blocked', false); end if;

  select count(*) into v_total from customer.ingest_rows where tenant_id = v_tenant and source = p_source and status <> 'removed';
  select count(*) into v_missing from customer.ingest_rows r
   where r.tenant_id = v_tenant and r.source = p_source and r.status <> 'removed' and r.received_at < v_started
     and not exists (select 1 from customer.ingest_pass_keys k where k.tenant_id = v_tenant and k.source = p_source and k.row_key = r.row_key);

  -- Guard against a sheet that was emptied or truncated by mistake.
  if v_missing > greatest(50, v_total * 0.05) then
    update customer.ingest_state
       set last_error = 'too_many_rows_missing:' || v_missing, scan_row = 2, scan_started_at = null
     where tenant_id = v_tenant and source = p_source;
    delete from customer.ingest_pass_keys where tenant_id = v_tenant and source = p_source;
    return jsonb_build_object('removed', 0, 'missing', v_missing, 'remaining', false, 'blocked', true);
  end if;

  select array_agg(id) into v_ids from (
    select r.id from customer.ingest_rows r
     where r.tenant_id = v_tenant and r.source = p_source and r.status <> 'removed' and r.received_at < v_started
       and not exists (select 1 from customer.ingest_pass_keys k where k.tenant_id = v_tenant and k.source = p_source and k.row_key = r.row_key)
     order by r.sheet_row limit least(greatest(coalesce(p_limit, 200), 1), 1000)) s;
  if v_ids is not null then
    foreach v_id in array v_ids loop perform customer.remove_source_row(v_id); end loop;
    perform customer.project_source_rows(p_source, v_ids, false);
  end if;

  if v_missing > coalesce(cardinality(v_ids), 0) then
    return jsonb_build_object('removed', coalesce(cardinality(v_ids), 0), 'missing', v_missing, 'remaining', true, 'blocked', false);
  end if;
  update customer.ingest_state
     set scan_row = 2, scan_started_at = null, last_full_pass_at = now(),
         last_error = case when last_error like 'too_many_rows_missing%' then null else last_error end
   where tenant_id = v_tenant and source = p_source;
  delete from customer.ingest_pass_keys where tenant_id = v_tenant and source = p_source;
  return jsonb_build_object('removed', coalesce(cardinality(v_ids), 0), 'missing', v_missing, 'remaining', false, 'blocked', false);
end $$;

create or replace function public.customer_ingest_apply(p_source text, p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := customer.ingest_tenant();
  r record; v_applied integer := 0; v_rejected integer := 0; v_msg text; v_young boolean; v_done uuid[] := '{}';
begin
  if not exists (select 1 from customer.source_tables where source = p_source and importer = 'runo') then
    raise exception 'No importer for source %', p_source using errcode = '22023';
  end if;
  -- A new table has no statistics, and a long import would plan without its
  -- indexes (measured: 40x slower). While the tables are young, statistics are
  -- refreshed during the batch; later, autovacuum keeps them current.
  v_young := (select reltuples from pg_catalog.pg_class where oid = 'customer.interactions'::regclass) < 20000;
  for r in
    select id from customer.ingest_rows
     where tenant_id = v_tenant and source = p_source and status = 'pending'
     order by sheet_row nulls last, received_at
     limit least(greatest(coalesce(p_limit, 500), 1), 5000)
     for update skip locked
  loop
    begin
      perform customer.apply_runo_row(r.id);
      v_applied := v_applied + 1;
      if v_young and v_applied in (50, 500, 2000) then perform customer.refresh_statistics(); end if;
    exception when others then
      get stacked diagnostics v_msg = message_text;
      update customer.ingest_rows
         set status = 'rejected', reject_reason = left(v_msg, 300), attempts = attempts + 1, updated_at = now()
       where id = r.id;
      v_rejected := v_rejected + 1;
    end;
    v_done := v_done || r.id;
  end loop;
  if v_young and v_applied > 0 then perform customer.refresh_statistics(); end if;
  perform customer.project_source_rows(p_source, v_done, false);

  return jsonb_build_object('applied', v_applied, 'rejected', v_rejected,
    'pending', (select count(*) from customer.ingest_rows where tenant_id = v_tenant and source = p_source and status = 'pending'));
end $$;

revoke all on function public.customer_ingest_state(text) from public, anon, authenticated;
revoke all on function public.customer_ingest_store(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.customer_ingest_finish_scan(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_state(text) to service_role;
grant execute on function public.customer_ingest_store(text, jsonb, jsonb) to service_role;
grant execute on function public.customer_ingest_finish_scan(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7. The master as one flat table, for export from the dashboard
-- ---------------------------------------------------------------------------
create view customer.customer_master with (security_invoker = true) as
select c.client_code, h.household_code as family_code, c.referral_code, c.primary_name as name,
       (select p.phone from customer.client_phones p where p.client_id = c.id and p.kind = 'primary') as phone,
       (select string_agg(p.phone, ', ' order by p.first_seen_at) from customer.client_phones p where p.client_id = c.id and p.kind <> 'primary') as other_phones,
       (select string_agg(n.name, ', ' order by n.last_seen_at desc) from customer.client_names n where n.client_id = c.id and n.name is distinct from c.primary_name) as other_names,
       c.segment, c.lifecycle_stage, c.email, c.gender, c.dob, c.dob_year_known, c.anniversary, c.anniversary_year_known, c.marital_status,
       c.community, c.occupation, c.address, c.city, c.state, c.country, c.pincode, c.beverage, c.sugar, c.snack,
       c.marketing_message, c.communication_preference, c.first_source, c.first_seen_at, c.last_contacted_at, c.last_attempt_at,
       c.interaction_count, c.successful_interaction_count, c.first_purchase_at, c.last_purchase_at, c.do_not_call,
       (select r.client_code from customer.clients r where r.id = c.referred_by_client_id) as referred_by_client_code,
       c.created_at, c.updated_at, c.tenant_id, c.id as client_id
  from customer.clients c join customer.households h on h.id = c.household_id
 where c.archived_at is null;
revoke all on customer.customer_master from public, anon, authenticated;
grant select on customer.customer_master to service_role;
