-- 0405: customer master database, part 1 - identity.
--
-- Owner decisions 2026-11-12 (AGENTS.md "One Supabase project"):
--   * the customer master lives in this project, in a new `customer` schema;
--   * one phone number is one client. The newest name is the main name; every
--     other name and number seen is kept. The same name with a different phone
--     is a different client.
--
-- This migration adds only new objects. It does not read, change or drop the
-- retired `crm` schema or the legacy CRM tables in `public`.
--
--   customer.households            family (MKF-)
--   customer.clients               one row per person (MKC-, MKREF-)
--   customer.client_phones         every phone; a phone belongs to one client
--   customer.client_names          every name seen for a client
--   customer.client_identifiers    Instagram handle, email, Runo id, sheet ids
--   customer.sources               data sources and their priority rank
--   customer.profile_fields        profile answers that have a client column
--   customer.client_field_values   every answer with its source and date
--   customer.identity_review       matches a person must decide
--
-- The schema is not exposed through the API. Browsers reach it only through
-- the two read RPCs at the end. Ingest and merge functions are service-only.

create schema customer;
revoke all on schema customer from public, anon, authenticated;
grant usage on schema customer to service_role;

-- ---------------------------------------------------------------------------
-- 1. Codes
-- ---------------------------------------------------------------------------
-- New codes start above the ranges used in the Google Sheets, so an old sheet
-- id (kept as a lookup in client_identifiers) never equals a new code.
create sequence customer.client_code_seq start 500001;
create sequence customer.household_code_seq start 500001;
create sequence customer.referral_code_seq start 500001;

-- ---------------------------------------------------------------------------
-- 2. Pure helpers
-- ---------------------------------------------------------------------------

-- Same rule as phoneKey() in packages/core/src/phone.ts: digits with the
-- country code, no "+". Ten digits without a code are Indian.
create function customer.normalize_phone(p_value text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_raw text := btrim(coalesce(p_value, ''));
  v_digits text := regexp_replace(v_raw, '\D', '', 'g');
  v_intl text;
begin
  if left(v_raw, 1) = '+' then v_intl := v_digits;
  elsif left(v_digits, 2) = '00' then v_intl := substr(v_digits, 3);
  end if;
  if v_intl is not null then
    return case when v_intl ~ '^[1-9][0-9]{7,14}$' then v_intl end;
  end if;
  if length(v_digits) = 10 then return '91' || v_digits; end if;
  if length(v_digits) = 11 and left(v_digits, 1) = '0' then return '91' || substr(v_digits, 2); end if;
  if length(v_digits) between 11 and 15 and left(v_digits, 1) <> '0' then return v_digits; end if;
  return null;
end $$;

create function customer.clean_name(p_value text)
returns text language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')), '');
$$;

-- Comparison key for a name: upper case, letters and digits only.
create function customer.name_key(p_value text)
returns text language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(regexp_replace(upper(coalesce(p_value, '')), '[^[:alnum:]]+', ' ', 'g'), '\s+', ' ', 'g')), '');
$$;

-- A birthday or anniversary. Accepts 2026-10-01, 01/10/2026 (day first, as the
-- Sheets store it, with or without a time) and --10-01 when the year is not
-- known. An unknown year is stored as 1904 (a leap year) with year_known false.
create function customer.parse_profile_date(p_value text, out value date, out year_known boolean)
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_value, '')); m text[];
begin
  m := regexp_match(v, '^(\d{4})-(\d{1,2})-(\d{1,2})');
  if m is not null then
    value := make_date(m[1]::int, m[2]::int, m[3]::int); year_known := true; return;
  end if;
  m := regexp_match(v, '^(\d{1,2})/(\d{1,2})/(\d{4})');
  if m is not null then
    value := make_date(m[3]::int, m[2]::int, m[1]::int); year_known := true; return;
  end if;
  m := regexp_match(v, '^--(\d{1,2})-(\d{1,2})$');
  if m is not null then
    value := make_date(1904, m[1]::int, m[2]::int); year_known := false; return;
  end if;
  raise exception 'Not a date: %', left(v, 40) using errcode = '22007';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

create table customer.households (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  household_code text not null default 'MKF-' || nextval('customer.household_code_seq'),
  main_client_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, household_code)
);

create table customer.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_code text not null default 'MKC-' || nextval('customer.client_code_seq'),
  household_id uuid not null references customer.households(id),
  referral_code text not null default 'MKREF-' || nextval('customer.referral_code_seq'),
  referred_by_client_id uuid references customer.clients(id),
  referral_relation text,
  primary_name text,
  -- Profile answers. Each is the winning row of client_field_values.
  email text,
  gender text,
  dob date,
  dob_year_known boolean not null default true,
  dob_status text,
  anniversary date,
  anniversary_year_known boolean not null default true,
  marital_status text,
  community text,
  occupation text,
  country text,
  state text,
  city text,
  pincode text,
  address text,
  beverage text,
  sugar text,
  snack text,
  marketing_message text,
  communication_preference text,
  -- Status and contact tracking. Later migrations maintain these.
  lifecycle_stage text not null default 'lead' check (lifecycle_stage in ('lead', 'engaged', 'visited')),
  segment text not null default 'lead' check (segment in ('buyer', 'non-buyer', 'lead')),
  first_source text,
  first_seen_at timestamptz,
  last_contacted_at timestamptz,
  last_attempt_at timestamptz,
  interaction_count integer not null default 0,
  successful_interaction_count integer not null default 0,
  first_purchase_at timestamptz,
  last_purchase_at timestamptz,
  do_not_call boolean not null default false,
  -- Archive instead of delete.
  merged_into_client_id uuid references customer.clients(id),
  archived_at timestamptz,
  archived_by uuid references public.user_profiles(id),
  archive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, client_code),
  unique (tenant_id, referral_code),
  check (referred_by_client_id is null or referred_by_client_id <> id),
  check (merged_into_client_id is null or merged_into_client_id <> id)
);
create index clients_household_idx on customer.clients (household_id);
create index clients_referred_by_idx on customer.clients (referred_by_client_id) where referred_by_client_id is not null;
create index clients_segment_idx on customer.clients (tenant_id, segment) where archived_at is null;
create index clients_city_idx on customer.clients (tenant_id, city) where archived_at is null;

alter table customer.households
  add constraint households_main_client_fk foreign key (main_client_id) references customer.clients(id);

create table customer.client_phones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references customer.clients(id),
  phone text not null check (phone ~ '^[1-9][0-9]{7,14}$'),
  kind text not null default 'other' check (kind in ('primary', 'secondary', 'billing', 'other')),
  is_valid boolean not null default true,
  source text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- One phone is one client.
  unique (tenant_id, phone)
);
create unique index client_phones_one_primary_idx on customer.client_phones (client_id) where kind = 'primary';
create index client_phones_client_idx on customer.client_phones (client_id);

create table customer.client_names (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references customer.clients(id),
  name text not null,
  name_key text not null,
  source text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (client_id, name_key)
);
create index client_names_key_idx on customer.client_names (tenant_id, name_key text_pattern_ops);

create table customer.client_identifiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references customer.clients(id),
  id_type text not null check (id_type in ('instagram', 'email', 'runo_customer_id', 'sheet_client_id', 'sheet_family_id', 'software_customer_id', 'zoho_id')),
  value text not null,
  source text,
  first_seen_at timestamptz not null default now(),
  unique (tenant_id, id_type, value, client_id)
);
create index client_identifiers_lookup_idx on customer.client_identifiers (tenant_id, id_type, value);
create index client_identifiers_client_idx on customer.client_identifiers (client_id);

-- Data sources and their priority. A higher rank wins; the same rank goes to
-- the latest answer. Ranks are data, so the order can be changed later.
create table customer.sources (
  source text primary key,
  source_rank integer not null,
  label text not null
);
insert into customer.sources (source, source_rank, label) values
  ('software', 5, 'Billing software'),
  ('walkin', 4, 'Store walk-in form'),
  ('exhibition', 3, 'Exhibition form'),
  ('runo', 2, 'Runo calling'),
  ('references_calling_fms', 2, 'References calling'),
  ('instagram_fms', 1, 'Instagram enquiry'),
  ('instagram_ads_fms', 1, 'Instagram ads enquiry'),
  ('doubletick_fms', 1, 'WhatsApp (DoubleTick) enquiry'),
  ('website_chat_fms', 1, 'Website chat enquiry'),
  ('referral', 1, 'Referral given by another client'),
  ('master_sheet', 0, 'Old master sheet');

-- Answers that are copied to a column of customer.clients.
create table customer.profile_fields (
  field_key text primary key,
  data_type text not null check (data_type in ('text', 'date')),
  label text not null
);
insert into customer.profile_fields (field_key, data_type, label) values
  ('email', 'text', 'Email'),
  ('gender', 'text', 'Gender'),
  ('dob', 'date', 'Date of birth'),
  ('dob_status', 'text', 'Date of birth given or not'),
  ('anniversary', 'date', 'Anniversary'),
  ('marital_status', 'text', 'Marital status'),
  ('community', 'text', 'Community / caste'),
  ('occupation', 'text', 'Occupation'),
  ('country', 'text', 'Country'),
  ('state', 'text', 'State'),
  ('city', 'text', 'City'),
  ('pincode', 'text', 'Pincode'),
  ('address', 'text', 'Full address'),
  ('beverage', 'text', 'Beverage'),
  ('sugar', 'text', 'Sugar'),
  ('snack', 'text', 'Snack'),
  ('marketing_message', 'text', 'Marketing message'),
  ('communication_preference', 'text', 'Communication preference');

-- Every answer ever given, with where and when it came from. A field_key that
-- is not in profile_fields is still stored here (it just has no client column).
create table customer.client_field_values (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references customer.clients(id),
  field_key text not null,
  value text not null,
  source text not null references customer.sources(source),
  observed_at timestamptz not null,
  interaction_id uuid,
  needs_review boolean not null default false,
  review_resolved_at timestamptz,
  created_at timestamptz not null default now()
);
-- The same answer from the same source at the same time is stored once, so an
-- import can be re-run safely.
create unique index client_field_values_once_idx
  on customer.client_field_values (client_id, field_key, source, observed_at, md5(value));
create index client_field_values_review_idx on customer.client_field_values (tenant_id) where needs_review;

create table customer.identity_review (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  reason text not null check (reason in ('two_phones_two_clients', 'previous_number_merge', 'ambiguous')),
  client_a uuid not null references customer.clients(id),
  client_b uuid references customer.clients(id),
  phone text,
  source text,
  source_row uuid,
  status text not null default 'open' check (status in ('open', 'merged', 'dismissed')),
  resolved_by uuid references public.user_profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index identity_review_open_pair_idx
  on customer.identity_review (least(client_a, client_b), greatest(client_a, client_b), reason)
  where status = 'open' and client_b is not null;
create index identity_review_open_idx on customer.identity_review (tenant_id) where status = 'open';

create function customer.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger clients_touch before update on customer.clients
  for each row execute function customer.touch_updated_at();
create trigger households_touch before update on customer.households
  for each row execute function customer.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Access: RLS on, no table grants to browsers
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['households', 'clients', 'client_phones', 'client_names',
                           'client_identifiers', 'client_field_values', 'identity_review'] loop
    execute format('alter table customer.%I enable row level security', t);
    execute format($p$create policy tenant_crm_read on customer.%I for select to authenticated
      using ((select public.current_profile_is_active()) and tenant_id = (select public.current_tenant_id())
        and (select public.has_permission('crm.view')))$p$, t);
    execute format($p$create policy module_accessible on customer.%I as restrictive for select to authenticated
      using (public.module_accessible('crm'))$p$, t);
  end loop;
end $rls$;
alter table customer.sources enable row level security;
alter table customer.profile_fields enable row level security;

revoke all on all tables in schema customer from public, anon, authenticated;
revoke all on all sequences in schema customer from public, anon, authenticated;
grant all on all tables in schema customer to service_role;
grant usage on all sequences in schema customer to service_role;

-- ---------------------------------------------------------------------------
-- 5. Identity functions (service-only)
-- ---------------------------------------------------------------------------

-- The main name is the name seen most recently.
create function customer.refresh_primary_name(p_client_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update customer.clients c
     set primary_name = n.name
    from (select name from customer.client_names
           where client_id = p_client_id
           order by last_seen_at desc, first_seen_at desc, id limit 1) n
   where c.id = p_client_id and c.primary_name is distinct from n.name;
end $$;

create function customer.add_client_name(p_client_id uuid, p_name text, p_source text, p_observed_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text := customer.clean_name(p_name);
  v_key text := customer.name_key(p_name);
  v_at timestamptz := coalesce(p_observed_at, now());
begin
  if v_name is null or v_key is null then return; end if;
  insert into customer.client_names (tenant_id, client_id, name, name_key, source, first_seen_at, last_seen_at)
  select c.tenant_id, c.id, v_name, v_key, p_source, v_at, v_at from customer.clients c where c.id = p_client_id
  on conflict (client_id, name_key) do update
    set name = case when excluded.last_seen_at >= customer.client_names.last_seen_at then excluded.name else customer.client_names.name end,
        first_seen_at = least(customer.client_names.first_seen_at, excluded.first_seen_at),
        last_seen_at = greatest(customer.client_names.last_seen_at, excluded.last_seen_at);
  perform customer.refresh_primary_name(p_client_id);
end $$;

-- Find the client that owns a phone, or create a new lead.
--   p_other_phones   second / alternate numbers on the same row
--   p_billing_phone  billing number on the same row
-- An extra number that already belongs to a different client is never merged:
-- it is written to identity_review for a person to decide.
create function customer.find_or_create_client(
  p_tenant_id uuid,
  p_phone text,
  p_name text,
  p_source text,
  p_observed_at timestamptz default now(),
  p_other_phones text[] default '{}',
  p_billing_phone text default null,
  p_actor_user_id uuid default null,
  p_source_row uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := customer.normalize_phone(p_phone);
  v_at timestamptz := coalesce(p_observed_at, now());
  v_client uuid;
  v_created boolean := false;
  v_household uuid;
  v_extra record;
  v_owner uuid;
begin
  if p_tenant_id is null then raise exception 'Tenant is required' using errcode = '22023'; end if;
  if v_phone is null then raise exception 'Not a valid phone number' using errcode = '22023'; end if;

  select client_id into v_client from customer.client_phones
   where tenant_id = p_tenant_id and phone = v_phone;

  if v_client is null then
    -- Two imports of the same new number at the same moment: the unique phone
    -- lets one create; the other undoes its attempt and uses the winner.
    begin
      insert into customer.households (tenant_id) values (p_tenant_id) returning id into v_household;
      insert into customer.clients (tenant_id, household_id, primary_name, first_source, first_seen_at)
      values (p_tenant_id, v_household, customer.clean_name(p_name), p_source, v_at)
      returning id into v_client;
      update customer.households set main_client_id = v_client where id = v_household;
      insert into customer.client_phones (tenant_id, client_id, phone, kind, source, first_seen_at, last_seen_at)
      values (p_tenant_id, v_client, v_phone, 'primary', p_source, v_at, v_at);
      insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
      values (p_tenant_id, p_actor_user_id, 'customer_client_created', 'customer', v_client,
              jsonb_build_object('source', p_source, 'source_row', p_source_row));
      v_created := true;
    exception when unique_violation then
      select client_id into strict v_client from customer.client_phones
       where tenant_id = p_tenant_id and phone = v_phone;
    end;
  end if;

  if not v_created then
    update customer.client_phones
       set first_seen_at = least(first_seen_at, v_at), last_seen_at = greatest(last_seen_at, v_at)
     where tenant_id = p_tenant_id and phone = v_phone;
    -- Old data can arrive after newer data: the first source is the earliest one.
    update customer.clients
       set first_source = p_source, first_seen_at = v_at
     where id = v_client and (first_seen_at is null or v_at < first_seen_at);
  end if;

  perform customer.add_client_name(v_client, p_name, p_source, v_at);

  for v_extra in
    select distinct on (phone) phone, kind from (
      select customer.normalize_phone(p_billing_phone) as phone, 'billing' as kind, 0 as ord
      union all
      select customer.normalize_phone(x), 'other', 1 from unnest(coalesce(p_other_phones, '{}')) x
    ) e where phone is not null and phone <> v_phone
    order by phone, ord
  loop
    insert into customer.client_phones (tenant_id, client_id, phone, kind, source, first_seen_at, last_seen_at)
    values (p_tenant_id, v_client, v_extra.phone, v_extra.kind, p_source, v_at, v_at)
    on conflict (tenant_id, phone) do nothing;
    select client_id into v_owner from customer.client_phones
     where tenant_id = p_tenant_id and phone = v_extra.phone;
    if v_owner = v_client then
      update customer.client_phones
         set kind = case when kind = 'other' and v_extra.kind = 'billing' then 'billing' else kind end,
             first_seen_at = least(first_seen_at, v_at), last_seen_at = greatest(last_seen_at, v_at)
       where tenant_id = p_tenant_id and phone = v_extra.phone;
    else
      insert into customer.identity_review (tenant_id, reason, client_a, client_b, phone, source, source_row)
      values (p_tenant_id, 'two_phones_two_clients', v_client, v_owner, v_extra.phone, p_source, p_source_row)
      on conflict do nothing;
    end if;
  end loop;

  return v_client;
end $$;

-- A family member with no number of their own (walk-in companion, spouse).
create function customer.create_client_without_phone(
  p_tenant_id uuid,
  p_household_id uuid,
  p_name text,
  p_source text,
  p_observed_at timestamptz default now(),
  p_actor_user_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_client uuid; v_at timestamptz := coalesce(p_observed_at, now());
begin
  if customer.clean_name(p_name) is null then raise exception 'Name is required' using errcode = '22023'; end if;
  if not exists (select 1 from customer.households where id = p_household_id and tenant_id = p_tenant_id) then
    raise exception 'Family not found' using errcode = '22023';
  end if;
  -- The same name entered again for the same family is the same person.
  select c.id into v_client
    from customer.clients c join customer.client_names n on n.client_id = c.id
   where c.household_id = p_household_id and c.archived_at is null
     and n.name_key = customer.name_key(p_name)
     and not exists (select 1 from customer.client_phones p where p.client_id = c.id)
   limit 1;
  if v_client is null then
    insert into customer.clients (tenant_id, household_id, primary_name, first_source, first_seen_at)
    values (p_tenant_id, p_household_id, customer.clean_name(p_name), p_source, v_at)
    returning id into v_client;
    insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
    values (p_tenant_id, p_actor_user_id, 'customer_client_created', 'customer', v_client,
            jsonb_build_object('source', p_source, 'without_phone', true));
  end if;
  perform customer.add_client_name(v_client, p_name, p_source, v_at);
  return v_client;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Profile answers: highest rank wins, then the latest
-- ---------------------------------------------------------------------------

create function customer.recompute_profile_field(p_client_id uuid, p_field_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_type text;
  v_win record;
  v_date date;
  v_year_known boolean;
begin
  select v.value, v.observed_at, s.source_rank into v_win
    from customer.client_field_values v join customer.sources s on s.source = v.source
   where v.client_id = p_client_id and v.field_key = p_field_key
   order by s.source_rank desc, v.observed_at desc, v.created_at desc, v.id
   limit 1;
  if not found then return; end if;

  -- Stale rule: a lower-ranked answer that is 12 months or more newer than the
  -- winner, and different, does not overwrite it. It is flagged for a person.
  update customer.client_field_values v
     set needs_review = f.flag
    from (select v2.id,
                 (s2.source_rank < v_win.source_rank
                  and v2.observed_at >= v_win.observed_at + interval '12 months'
                  and lower(v2.value) <> lower(v_win.value)
                  and v2.review_resolved_at is null) as flag
            from customer.client_field_values v2 join customer.sources s2 on s2.source = v2.source
           where v2.client_id = p_client_id and v2.field_key = p_field_key) f
   where v.id = f.id and v.needs_review is distinct from f.flag;

  select data_type into v_type from customer.profile_fields where field_key = p_field_key;
  if v_type = 'text' then
    execute format('update customer.clients set %I = $1 where id = $2 and %I is distinct from $1', p_field_key, p_field_key)
      using v_win.value, p_client_id;
  elsif v_type = 'date' then
    select d.value, d.year_known into v_date, v_year_known from customer.parse_profile_date(v_win.value) d;
    execute format('update customer.clients set %I = $1, %I = $2 where id = $3 and (%I is distinct from $1 or %I is distinct from $2)',
                   p_field_key, p_field_key || '_year_known', p_field_key, p_field_key || '_year_known')
      using v_date, v_year_known, p_client_id;
  end if;
end $$;

create function customer.set_field_value(
  p_client_id uuid,
  p_field_key text,
  p_value text,
  p_source text,
  p_observed_at timestamptz default now(),
  p_interaction_id uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_value text := customer.clean_name(p_value);
  v_tenant uuid;
  v_type text;
  v_date date;
  v_year_known boolean;
begin
  if v_value is null then return; end if;
  if p_field_key is null or p_field_key !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception 'Invalid field key' using errcode = '22023';
  end if;
  select tenant_id into v_tenant from customer.clients where id = p_client_id;
  if v_tenant is null then raise exception 'Client not found' using errcode = '22023'; end if;
  if not exists (select 1 from customer.sources where source = p_source) then
    raise exception 'Unknown source: %', p_source using errcode = '22023';
  end if;

  select data_type into v_type from customer.profile_fields where field_key = p_field_key;
  if v_type = 'date' then
    -- Stored in one form: 1988-04-12, or --04-12 when the year is not known.
    select d.value, d.year_known into v_date, v_year_known from customer.parse_profile_date(v_value) d;
    v_value := case when v_year_known then to_char(v_date, 'YYYY-MM-DD') else to_char(v_date, '--MM-DD') end;
  end if;

  insert into customer.client_field_values (tenant_id, client_id, field_key, value, source, observed_at, interaction_id)
  values (v_tenant, p_client_id, p_field_key, v_value, p_source, coalesce(p_observed_at, now()), p_interaction_id)
  on conflict do nothing;

  perform customer.recompute_profile_field(p_client_id, p_field_key);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Merge (service-only; the staff-facing review action comes with its
--    permission in a later migration)
-- ---------------------------------------------------------------------------
create function customer.merge_clients(
  p_keep_client_id uuid,
  p_remove_client_id uuid,
  p_reason text,
  p_actor_user_id uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_keep customer.clients; v_remove customer.clients; v_key text;
begin
  if p_keep_client_id = p_remove_client_id then raise exception 'Cannot merge a client into itself' using errcode = '22023'; end if;
  select * into v_keep from customer.clients where id = p_keep_client_id for update;
  select * into v_remove from customer.clients where id = p_remove_client_id for update;
  if v_keep.id is null or v_remove.id is null or v_keep.tenant_id <> v_remove.tenant_id then
    raise exception 'Client not found' using errcode = '22023';
  end if;
  if v_keep.archived_at is not null or v_remove.archived_at is not null then
    raise exception 'An archived client cannot be merged' using errcode = '22023';
  end if;

  -- Phones: every number is kept; the removed client's main number becomes an other number.
  update customer.client_phones
     set client_id = v_keep.id, kind = case when kind = 'primary' then 'other' else kind end
   where client_id = v_remove.id;

  -- Names: every name is kept.
  insert into customer.client_names (tenant_id, client_id, name, name_key, source, first_seen_at, last_seen_at)
  select tenant_id, v_keep.id, name, name_key, source, first_seen_at, last_seen_at
    from customer.client_names where client_id = v_remove.id
  on conflict (client_id, name_key) do update
    set name = case when excluded.last_seen_at >= customer.client_names.last_seen_at then excluded.name else customer.client_names.name end,
        first_seen_at = least(customer.client_names.first_seen_at, excluded.first_seen_at),
        last_seen_at = greatest(customer.client_names.last_seen_at, excluded.last_seen_at);
  delete from customer.client_names where client_id = v_remove.id;

  -- Identifiers.
  delete from customer.client_identifiers r
   where r.client_id = v_remove.id and exists (
     select 1 from customer.client_identifiers k
      where k.client_id = v_keep.id and k.id_type = r.id_type and k.value = r.value);
  update customer.client_identifiers set client_id = v_keep.id where client_id = v_remove.id;

  -- Answers.
  delete from customer.client_field_values r
   where r.client_id = v_remove.id and exists (
     select 1 from customer.client_field_values k
      where k.client_id = v_keep.id and k.field_key = r.field_key and k.source = r.source
        and k.observed_at = r.observed_at and md5(k.value) = md5(r.value));
  update customer.client_field_values set client_id = v_keep.id where client_id = v_remove.id;

  -- Referrals and family links that pointed at the removed client.
  update customer.clients set referred_by_client_id = null
   where id = v_keep.id and referred_by_client_id = v_remove.id;
  update customer.clients set referred_by_client_id = v_keep.id
   where referred_by_client_id = v_remove.id and id <> v_keep.id;
  update customer.households set main_client_id = v_keep.id where main_client_id = v_remove.id;

  update customer.clients
     set first_seen_at = least(first_seen_at, v_remove.first_seen_at),
         first_source = case when v_remove.first_seen_at < first_seen_at then v_remove.first_source else first_source end,
         referred_by_client_id = coalesce(referred_by_client_id, nullif(v_remove.referred_by_client_id, v_keep.id)),
         referral_relation = coalesce(referral_relation, v_remove.referral_relation),
         do_not_call = do_not_call or v_remove.do_not_call
   where id = v_keep.id;

  update customer.clients
     set merged_into_client_id = v_keep.id, archived_at = now(), archived_by = p_actor_user_id,
         archive_reason = coalesce(nullif(btrim(p_reason), ''), 'merged')
   where id = v_remove.id;

  perform customer.refresh_primary_name(v_keep.id);
  for v_key in select distinct field_key from customer.client_field_values where client_id = v_keep.id loop
    perform customer.recompute_profile_field(v_keep.id, v_key);
  end loop;

  update customer.identity_review
     set status = 'merged', resolved_by = p_actor_user_id, resolved_at = now()
   where status = 'open'
     and least(client_a, client_b) = least(v_keep.id, v_remove.id)
     and greatest(client_a, client_b) = greatest(v_keep.id, v_remove.id);

  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_keep.tenant_id, p_actor_user_id, 'customer_clients_merged', 'customer', v_keep.id,
          jsonb_build_object('removed_client_id', v_remove.id, 'removed_client_code', v_remove.client_code),
          jsonb_build_object('kept_client_code', v_keep.client_code, 'reason', p_reason));
end $$;

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;

-- ---------------------------------------------------------------------------
-- 8. Read RPCs for the app
-- ---------------------------------------------------------------------------
-- search_path is public (the repo convention) because public.current_tenant_id()
-- has no pinned search_path of its own. Every customer object is schema-qualified.

-- One search box: MKC / MKF / MKREF code, an old sheet id, a phone, or a name.
create function public.customer_search(p_query text, p_limit integer default 25)
returns table (
  client_id uuid, client_code text, household_code text, referral_code text,
  primary_name text, primary_phone text, segment text, lifecycle_stage text,
  city text, matched_on text
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_q text := btrim(coalesce(p_query, ''));
  v_code text := upper(btrim(coalesce(p_query, '')));
  v_phone text;
  v_name_key text;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant_id();
  if v_q = '' then return; end if;
  if v_q ~ '^[+0-9 ()-]+$' then v_phone := customer.normalize_phone(v_q); end if;
  v_name_key := customer.name_key(v_q);

  return query
  with hits as (
    select c.id, 'client_code'::text as matched_on from customer.clients c
     where c.tenant_id = v_tenant and c.client_code = v_code
    union all
    select c.id, 'referral_code' from customer.clients c
     where c.tenant_id = v_tenant and c.referral_code = v_code
    union all
    select c.id, 'family_code' from customer.households h join customer.clients c on c.household_id = h.id
     where h.tenant_id = v_tenant and h.household_code = v_code
    union all
    select i.client_id, 'old_id' from customer.client_identifiers i
     where i.tenant_id = v_tenant and i.id_type in ('sheet_client_id', 'sheet_family_id') and i.value = v_code
    union all
    select p.client_id, 'phone' from customer.client_phones p
     where v_phone is not null and p.tenant_id = v_tenant and p.phone = v_phone
    union all
    select n.client_id, 'name' from customer.client_names n
     where v_phone is null and v_code !~ '^MK(C|F|REF)-' and length(v_name_key) >= 2
       and n.tenant_id = v_tenant and n.name_key like v_name_key || '%'
  ), first_hit as (
    select distinct on (h.id) h.id, h.matched_on from hits h order by h.id, h.matched_on
  )
  select c.id, c.client_code, hh.household_code, c.referral_code, c.primary_name,
         (select p.phone from customer.client_phones p where p.client_id = c.id and p.kind = 'primary'),
         c.segment, c.lifecycle_stage, c.city, f.matched_on
    from first_hit f
    join customer.clients c on c.id = f.id
    join customer.households hh on hh.id = c.household_id
   where c.archived_at is null
   order by c.primary_name nulls last, c.client_code
   limit v_limit;
end $$;

-- The full identity card of one client: codes, family, every phone and name,
-- referral link, and each profile answer with its source and date.
create function public.customer_get_profile(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid; v_client customer.clients; v_result jsonb;
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant_id();
  select * into v_client from customer.clients where id = p_client_id and tenant_id = v_tenant;
  if v_client.id is null then raise exception 'Client not found' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'client', to_jsonb(v_client) - 'tenant_id',
    'family', (select jsonb_build_object(
        'household_code', h.household_code,
        'main_client_id', h.main_client_id,
        'members', (select coalesce(jsonb_agg(jsonb_build_object('client_id', m.id, 'client_code', m.client_code, 'name', m.primary_name)
                                              order by m.created_at), '[]'::jsonb)
                      from customer.clients m where m.household_id = h.id and m.archived_at is null))
      from customer.households h where h.id = v_client.household_id),
    'phones', (select coalesce(jsonb_agg(jsonb_build_object('phone', p.phone, 'kind', p.kind, 'is_valid', p.is_valid,
                                                             'source', p.source, 'first_seen_at', p.first_seen_at)
                                         order by (p.kind = 'primary') desc, p.first_seen_at), '[]'::jsonb)
                 from customer.client_phones p where p.client_id = v_client.id),
    'names', (select coalesce(jsonb_agg(jsonb_build_object('name', n.name, 'source', n.source,
                                                            'first_seen_at', n.first_seen_at, 'last_seen_at', n.last_seen_at)
                                        order by n.last_seen_at desc), '[]'::jsonb)
                from customer.client_names n where n.client_id = v_client.id),
    'identifiers', (select coalesce(jsonb_agg(jsonb_build_object('type', i.id_type, 'value', i.value, 'source', i.source)
                                              order by i.id_type, i.first_seen_at), '[]'::jsonb)
                      from customer.client_identifiers i where i.client_id = v_client.id),
    'referred_by', (select jsonb_build_object('client_id', r.id, 'client_code', r.client_code,
                                              'referral_code', r.referral_code, 'name', r.primary_name)
                      from customer.clients r where r.id = v_client.referred_by_client_id),
    'field_sources', (select coalesce(jsonb_object_agg(w.field_key, jsonb_build_object(
                          'value', w.value, 'source', w.source, 'observed_at', w.observed_at)), '{}'::jsonb)
                        from (select distinct on (v.field_key) v.field_key, v.value, v.source, v.observed_at
                                from customer.client_field_values v join customer.sources s on s.source = v.source
                               where v.client_id = v_client.id
                               order by v.field_key, s.source_rank desc, v.observed_at desc, v.created_at desc, v.id) w),
    'needs_review_count', (select count(*) from customer.client_field_values v
                            where v.client_id = v_client.id and v.needs_review)
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.customer_search(text, integer) from public, anon;
revoke all on function public.customer_get_profile(uuid) from public, anon;
grant execute on function public.customer_search(text, integer) to authenticated, service_role;
grant execute on function public.customer_get_profile(uuid) to authenticated, service_role;
