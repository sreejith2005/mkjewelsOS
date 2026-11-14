-- 0407: customer master database, part 3 - sheet import, Runo first.
--
-- The Google Sheets stay the system of record until the owner switches. This
-- migration never writes to a sheet: the Edge Function customer-sheets-sync
-- reads with a read-only Google scope and hands rows to the functions below.
--
--   customer.ingest_rows      every sheet row, unchanged, keyed by source + row key
--   customer.ingest_state     how far each sheet has been read
--   customer.ingest_settings  which company the sheets belong to (only needed
--                             when more than one tenant exists)
--   customer.staff_aliases    a name as written in a sheet -> a JewelOS user
--
-- One Runo row becomes: client (matched on phone) -> interaction (keyed by
-- callId) -> follow-ups / appointments / products / profile answers.
-- A row that cannot be applied is kept with its reason; nothing is discarded.
--
-- Not handled yet (the columns stay in ingest_rows.payload for later parts):
-- exhibitions, orders, repairs, Name Of Buyer, campaign links, AD List.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table customer.ingest_settings (
  singleton boolean primary key default true check (singleton),
  tenant_id uuid not null references public.tenants(id)
);

create table customer.ingest_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  source text not null references customer.sources(source),
  row_key text not null,
  sheet_row integer,
  payload jsonb not null,
  fingerprint text not null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  reject_reason text,
  client_id uuid references customer.clients(id),
  interaction_id uuid references customer.interactions(id) on delete set null,
  attempts integer not null default 0,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (tenant_id, source, row_key)
);
create index ingest_rows_pending_idx on customer.ingest_rows (tenant_id, source, sheet_row) where status = 'pending';
create index ingest_rows_rejected_idx on customer.ingest_rows (tenant_id, source) where status = 'rejected';

create table customer.ingest_state (
  tenant_id uuid not null references public.tenants(id),
  source text not null references customer.sources(source),
  next_row integer not null default 2,
  rows_received bigint not null default 0,
  last_run_at timestamptz,
  last_error text,
  primary key (tenant_id, source)
);

create table customer.staff_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  alias_key text not null,
  raw_name text not null,
  user_id uuid references public.user_profiles(id),
  matched_by text not null default 'none' check (matched_by in ('none', 'full_name', 'first_name', 'manual')),
  seen_count integer not null default 1,
  created_at timestamptz not null default now(),
  unique (tenant_id, alias_key)
);

alter table customer.interactions add column assigned_by_name text;

do $rls$
declare t text;
begin
  foreach t in array array['ingest_settings', 'ingest_rows', 'ingest_state', 'staff_aliases'] loop
    -- Service-only: RLS on with no policy.
    execute format('alter table customer.%I enable row level security', t);
  end loop;
end $rls$;
revoke all on all tables in schema customer from public, anon, authenticated;
grant all on all tables in schema customer to service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

create function customer.ingest_tenant()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid; n integer;
begin
  select tenant_id into v from customer.ingest_settings;
  if v is not null then return v; end if;
  select count(*) into n from public.tenants;
  if n = 1 then select id into v from public.tenants; return v; end if;
  raise exception 'More than one company exists: set customer.ingest_settings.tenant_id first' using errcode = '22023';
end $$;

-- A date or date-time as Google Sheets shows it, read as India time:
-- 01/10/2026 11:41:47, 01/10/2026, 1-10-2026 or 2026-10-01 11:41. Day first.
-- Returns null for an empty or unreadable value; never raises.
create function customer.parse_sheet_timestamp(p_value text)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_value, '')); m text[]; d date; hh int := 0; mi int := 0; ss int := 0; pm text;
begin
  if v = '' then return null; end if;
  m := regexp_match(v, '^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?');
  if m is not null then
    d := make_date(m[1]::int, m[2]::int, m[3]::int);
  else
    m := regexp_match(v, '^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?');
    if m is null then return null; end if;
    d := make_date(m[3]::int, m[2]::int, m[1]::int);
    pm := lower(m[7]);
  end if;
  hh := coalesce(m[4]::int, 0); mi := coalesce(m[5]::int, 0); ss := coalesce(m[6]::int, 0);
  if pm = 'pm' and hh < 12 then hh := hh + 12; elsif pm = 'am' and hh = 12 then hh := 0; end if;
  if hh > 23 or mi > 59 or ss > 59 then return null; end if;
  return (d + make_time(hh, mi, ss)) at time zone 'Asia/Kolkata';
exception when others then
  return null;
end $$;

-- Runo keeps a birthday in three cells: Date, Month, Year. Month may be a
-- number or a name. Returns 1988-04-12, --04-12 (no year) or null.
create function customer.compose_profile_date(p_day text, p_month text, p_year text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  dd int; mm int; yy int;
  mon text := lower(left(btrim(coalesce(p_month, '')), 3));
begin
  dd := nullif(regexp_replace(coalesce(p_day, ''), '\D', '', 'g'), '')::int;
  if btrim(coalesce(p_month, '')) ~ '^\d{1,2}$' then mm := btrim(p_month)::int;
  else mm := nullif(array_position(array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'], mon), 0);
  end if;
  yy := nullif(regexp_replace(coalesce(p_year, ''), '\D', '', 'g'), '')::int;
  if dd is null or mm is null then return null; end if;
  if yy is not null and yy between 1900 and 2100 then
    return to_char(make_date(yy, mm, dd), 'YYYY-MM-DD');
  end if;
  return to_char(make_date(1904, mm, dd), '--MM-DD');
exception when others then
  return null;
end $$;

-- A staff name as written in a sheet -> a user. Full names match first; a lone
-- first name matches when exactly one user has it. Anything else is recorded
-- unmatched in staff_aliases so a person can map it once.
create function customer.resolve_staff(p_tenant_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_key text := customer.name_key(p_name); v_alias customer.staff_aliases; v_user uuid; v_how text := 'none'; n integer;
begin
  if v_key is null then return null; end if;
  select * into v_alias from customer.staff_aliases where tenant_id = p_tenant_id and alias_key = v_key;
  if v_alias.id is not null then
    update customer.staff_aliases set seen_count = seen_count + 1 where id = v_alias.id;
    return v_alias.user_id;
  end if;
  select count(*), (array_agg(u.id))[1] into n, v_user from public.user_profiles u
   where u.tenant_id = p_tenant_id and customer.name_key(u.employee_name) = v_key;
  if n = 1 then v_how := 'full_name';
  else
    select count(*), (array_agg(u.id))[1] into n, v_user from public.user_profiles u
     where u.tenant_id = p_tenant_id and split_part(customer.name_key(u.employee_name), ' ', 1) = v_key;
    if n = 1 then v_how := 'first_name'; else v_user := null; end if;
  end if;
  insert into customer.staff_aliases (tenant_id, alias_key, raw_name, user_id, matched_by)
  values (p_tenant_id, v_key, customer.clean_name(p_name), v_user, v_how)
  on conflict (tenant_id, alias_key) do nothing;
  return v_user;
end $$;

-- Map (or re-map) a sheet name to a user and fix the interactions already
-- imported under that name.
create function customer.set_staff_alias(p_tenant_id uuid, p_raw_name text, p_user_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_key text := customer.name_key(p_raw_name); n integer; total integer := 0;
begin
  if v_key is null then raise exception 'Name is required' using errcode = '22023'; end if;
  if p_user_id is not null and not exists (select 1 from public.user_profiles where id = p_user_id and tenant_id = p_tenant_id) then
    raise exception 'User not found' using errcode = '22023';
  end if;
  insert into customer.staff_aliases (tenant_id, alias_key, raw_name, user_id, matched_by)
  values (p_tenant_id, v_key, customer.clean_name(p_raw_name), p_user_id, 'manual')
  on conflict (tenant_id, alias_key) do update set user_id = excluded.user_id, matched_by = 'manual';
  update customer.interactions set staff_user_id = p_user_id
   where tenant_id = p_tenant_id and customer.name_key(staff_name) = v_key and staff_user_id is distinct from p_user_id;
  get diagnostics n = row_count; total := total + n;
  update customer.interactions set attended_by_user_id = p_user_id
   where tenant_id = p_tenant_id and customer.name_key(attended_by_name) = v_key and attended_by_user_id is distinct from p_user_id;
  get diagnostics n = row_count; total := total + n;
  update customer.interactions set assigned_by_user_id = p_user_id
   where tenant_id = p_tenant_id and customer.name_key(assigned_by_name) = v_key and assigned_by_user_id is distinct from p_user_id;
  get diagnostics n = row_count; total := total + n;
  return total;
end $$;

-- "MK Bandra" in a sheet -> the branch named "MK Bandra" or "Bandra".
create function customer.resolve_branch(p_tenant_id uuid, p_name text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_key text := customer.name_key(p_name); v_short text; v_id uuid; n integer;
begin
  if v_key is null then return null; end if;
  v_short := regexp_replace(v_key, '^MK ', '');
  select count(*), (array_agg(b.id))[1] into n, v_id from public.branches b
   where b.tenant_id = p_tenant_id
     and regexp_replace(customer.name_key(b.name), '^MK ', '') = v_short;
  if n = 1 then return v_id; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 3. One Runo row -> client, interaction and what follows
-- ---------------------------------------------------------------------------
create function customer.apply_runo_row(p_ingest_row_id uuid)
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
  f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.source <> 'runo' then raise exception 'Runo row not found' using errcode = '22023'; end if;
  v_tenant := v_row.tenant_id;
  -- Empty cells are treated as missing.
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';

  v_at := customer.parse_sheet_timestamp(p ->> 'Interaction Date');
  if v_at is null then raise exception 'Interaction Date is missing or unreadable' using errcode = '22007'; end if;

  -- 3.1 Who ---------------------------------------------------------------
  v_client := customer.find_or_create_client(
    v_tenant, p ->> 'Mobile Number', concat_ws(' ', p ->> 'Name', p ->> 'Last Name'), 'runo', v_at,
    '{}', p ->> 'Billing Phone Number Add +91', null, v_row.id);
  select household_id into v_household from customer.clients where id = v_client;

  if p ? 'Customer Id' then
    insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
    values (v_tenant, v_client, 'runo_customer_id', p ->> 'Customer Id', 'runo', v_at) on conflict do nothing;
  end if;
  if (p ->> 'Email') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
    values (v_tenant, v_client, 'email', lower(p ->> 'Email'), 'runo', v_at) on conflict do nothing;
    perform customer.set_field_value(v_client, 'email', lower(p ->> 'Email'), 'runo', v_at);
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
    'occurred_at', v_at, 'channel', v_channel, 'direction', 'outbound', 'purpose', v_purpose, 'source', 'runo',
    'external_ref', v_row.row_key, 'source_row', v_row.id,
    'outcome', v_status, 'result', v_result, 'successful', v_successful, 'non_contact_reason', v_reason,
    'staff_user_id', v_staff, 'staff_name', p ->> 'Assigned To',
    'assigned_by_user_id', customer.resolve_staff(v_tenant, p ->> 'Assigned By'),
    'attended_by_user_id', customer.resolve_staff(v_tenant, p ->> 'Attended By'), 'attended_by_name', p ->> 'Attended By',
    'branch_id', customer.resolve_branch(v_tenant, p ->> 'Store'), 'store_name', p ->> 'Store',
    'contact_role', p ->> 'Buyer OR Family Member', 'customer_type_stated', p ->> 'Old Or New Customer',
    'process_name', p ->> 'Process Name', 'notes', p ->> 'Notes')));
  update customer.interactions set assigned_by_name = p ->> 'Assigned By'
   where id = v_interaction and assigned_by_name is distinct from (p ->> 'Assigned By');

  -- 3.3 Profile answers ----------------------------------------------------
  for f in select * from (values
      ('Street', 'address'), ('City', 'city'), ('State', 'state'), ('Country', 'country'), ('Pincode', 'pincode'),
      ('Marketing Messages', 'marketing_message'), ('Caste', 'community'), ('Beverage', 'beverage'), ('Snack', 'snack'),
      ('Gift Given', 'gift_given'), ('Source', 'lead_source'), ('Source Of Lead', 'lead_source')) as m(header, field_key)
  loop
    if p ? f.header and upper(p ->> f.header) not in ('NA', 'N/A', '-') then
      perform customer.set_field_value(v_client, f.field_key, p ->> f.header, 'runo', v_at, v_interaction);
    end if;
  end loop;

  -- Date Of Birth and Date Of Anniversary are dropdowns; the date itself is in
  -- Date / Month / Year and is the birthday.
  if p ? 'Date Of Birth' then
    if lower(p ->> 'Date Of Birth') like 'not%' then
      perform customer.set_field_value(v_client, 'dob_status', 'declined', 'runo', v_at, v_interaction);
    else
      perform customer.set_field_value(v_client, 'dob_status', 'given', 'runo', v_at, v_interaction);
      v_text := customer.compose_profile_date(p ->> 'Date', p ->> 'Month', p ->> 'Year');
      if v_text is not null then
        perform customer.set_field_value(v_client, 'dob', v_text, 'runo', v_at, v_interaction);
      end if;
    end if;
  end if;
  if p ? 'Date Of Anniversary' then
    perform customer.set_field_value(v_client, 'marital_status',
      case when lower(p ->> 'Date Of Anniversary') like 'un%' then 'Unmarried' else 'Married' end, 'runo', v_at, v_interaction);
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
      ('Not Interested - Set Follow Up 3 Months From Today', 'three_month'), ('Follow Up', 'call_later')) as m(header, kind)
  loop
    v_due := customer.parse_sheet_timestamp(p ->> f.header);
    if v_due is not null then
      perform customer.create_follow_up(v_client, f.kind, v_due, v_interaction, v_staff, p ->> 'Reason');
    end if;
  end loop;

  -- Not reached: try again the next day, at most three misses in a row.
  if not v_successful and lower(coalesce(v_reason, '')) in ('switched off', 'not reachable', 'not picking') then
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
      v_other := customer.find_or_create_client(v_tenant, p ->> 'Spouse Phone', p ->> 'Spouse Name', 'runo', v_at, '{}', null, null, v_row.id);
      -- Join the family only when the spouse is alone in their own.
      if (select household_id from customer.clients where id = v_other) <> v_household
         and (select count(*) from customer.clients c
               where c.household_id = (select household_id from customer.clients where id = v_other)) = 1 then
        update customer.clients set household_id = v_household where id = v_other;
        delete from customer.households h where h.main_client_id = v_other and h.id <> v_household
           and not exists (select 1 from customer.clients c where c.household_id = h.id);
      end if;
    elsif p ? 'Spouse Name' then
      perform customer.create_client_without_phone(v_tenant, v_household, p ->> 'Spouse Name', 'runo', v_at);
    end if;
  end if;

  if customer.normalize_phone(p ->> 'Referrer Number') is not null then
    v_other := customer.find_or_create_client(v_tenant, p ->> 'Referrer Number', p ->> 'Referrer Name', 'runo', v_at, '{}', null, null, v_row.id);
    update customer.clients set referred_by_client_id = v_other
     where id = v_client and referred_by_client_id is null and v_other <> v_client;
  end if;

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, client_id = v_client, interaction_id = v_interaction,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return v_interaction;
end $$;

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;

-- ---------------------------------------------------------------------------
-- 4. Contracts for the Edge Function (service role only)
-- ---------------------------------------------------------------------------

-- Where to continue reading a sheet.
create function public.customer_ingest_state(p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := customer.ingest_tenant(); v customer.ingest_state;
begin
  insert into customer.ingest_state (tenant_id, source) values (v_tenant, p_source) on conflict do nothing;
  select * into v from customer.ingest_state where tenant_id = v_tenant and source = p_source;
  return jsonb_build_object('next_row', v.next_row, 'rows_received', v.rows_received,
    'pending', (select count(*) from customer.ingest_rows where tenant_id = v_tenant and source = p_source and status = 'pending'),
    'rejected', (select count(*) from customer.ingest_rows where tenant_id = v_tenant and source = p_source and status = 'rejected'));
end $$;

-- Store sheet rows unchanged. p_rows = [{ "row_key", "sheet_row", "payload" }].
-- A row seen before with the same content is left alone; a changed row is
-- queued again. p_next_row = the first sheet row not yet read.
create function public.customer_ingest_sheet_rows(p_source text, p_rows jsonb, p_next_row integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := customer.ingest_tenant(); v_new integer := 0; v_changed integer := 0; v_total integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'p_rows must be an array' using errcode = '22023';
  end if;
  with incoming as (
    select distinct on (r ->> 'row_key') btrim(r ->> 'row_key') as row_key, nullif(r ->> 'sheet_row', '')::integer as sheet_row,
           r -> 'payload' as payload, md5((r -> 'payload')::text) as fingerprint
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where btrim(coalesce(r ->> 'row_key', '')) <> '' and jsonb_typeof(r -> 'payload') = 'object'
     order by r ->> 'row_key', nullif(r ->> 'sheet_row', '')::integer desc
  ), up as (
    insert into customer.ingest_rows (tenant_id, source, row_key, sheet_row, payload, fingerprint)
    select v_tenant, p_source, row_key, sheet_row, payload, fingerprint from incoming
    on conflict (tenant_id, source, row_key) do update
      set payload = excluded.payload, fingerprint = excluded.fingerprint, sheet_row = excluded.sheet_row,
          status = 'pending', reject_reason = null, updated_at = now()
      where customer.ingest_rows.fingerprint is distinct from excluded.fingerprint
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted), (select count(*) from incoming)
    into v_new, v_changed, v_total from up;

  insert into customer.ingest_state (tenant_id, source, next_row, rows_received, last_run_at, last_error)
  values (v_tenant, p_source, coalesce(p_next_row, 2), v_new, now(), null)
  on conflict (tenant_id, source) do update
    set next_row = coalesce(p_next_row, customer.ingest_state.next_row),
        rows_received = customer.ingest_state.rows_received + v_new, last_run_at = now(), last_error = null;
  return jsonb_build_object('received', v_total, 'new', v_new, 'changed', v_changed);
end $$;

-- Apply queued rows, oldest sheet row first. One bad row never stops the rest:
-- it is marked rejected with the reason.
create function public.customer_ingest_apply(p_source text, p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := customer.ingest_tenant();
  r record; v_applied integer := 0; v_rejected integer := 0; v_msg text; v_young boolean;
begin
  if p_source <> 'runo' then raise exception 'No importer for source %', p_source using errcode = '22023'; end if;
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
  end loop;

  if v_young and v_applied > 0 then perform customer.refresh_statistics(); end if;

  return jsonb_build_object('applied', v_applied, 'rejected', v_rejected,
    'pending', (select count(*) from customer.ingest_rows where tenant_id = v_tenant and source = p_source and status = 'pending'));
end $$;

create function customer.refresh_statistics()
returns void language plpgsql security definer set search_path = '' as $$
begin
  analyze customer.clients; analyze customer.households; analyze customer.client_phones; analyze customer.client_names;
  analyze customer.client_identifiers; analyze customer.client_field_values; analyze customer.interactions;
  analyze customer.interaction_products; analyze customer.follow_ups; analyze customer.appointments;
  analyze customer.ingest_rows; analyze customer.staff_aliases;
end $$;
revoke all on function customer.refresh_statistics() from public, anon, authenticated;
grant execute on function customer.refresh_statistics() to service_role;

-- Note an import failure (Google unreachable, sheet not shared) for the owner.
create function public.customer_ingest_note_error(p_source text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := customer.ingest_tenant();
begin
  insert into customer.ingest_state (tenant_id, source, last_run_at, last_error)
  values (v_tenant, p_source, now(), left(p_error, 300))
  on conflict (tenant_id, source) do update set last_run_at = now(), last_error = left(p_error, 300);
end $$;

revoke all on function public.customer_ingest_state(text) from public, anon, authenticated;
revoke all on function public.customer_ingest_sheet_rows(text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
revoke all on function public.customer_ingest_note_error(text, text) from public, anon, authenticated;
grant execute on function public.customer_ingest_state(text) to service_role;
grant execute on function public.customer_ingest_sheet_rows(text, jsonb, integer) to service_role;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;
grant execute on function public.customer_ingest_note_error(text, text) to service_role;
