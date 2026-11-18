-- 0426: client or lead, and the old "Database CUSTOMER DATA" sheet.
--
-- 1. Client or lead (owner, 2026-11-18): "a client is a person who has bought
--    from us; every person who has not yet bought is a lead." segment is now
--    exactly that: 'buyer' (shown as Client) when anything says the person
--    bought - a contact that is a purchase (walk-in / Zoho YES, exhibition
--    BOUGHT, enquiry bought, Runo "Visited - Bought" / "Video Call - Bought")
--    or a sheet that marks them a buyer (STATUS "Bought", BUYER / NON BUYER
--    "BUYER"); otherwise 'lead'. 'non-buyer' is no longer used.
-- 2. Dates written with a month name (14-Mar-2025) are read.
-- 3. "Database CUSTOMER DATA" (dead; imported once), tabs Masterdata and Abroad
--    (probe 2026-11-18). Masterdata: 8,838 rows, every one TAG "Customer",
--    STATUS "Bought" - a list of buyers. MOBILE NO repeats (6,001 numbers) and
--    is "#N/A" on 1,782 rows, so rows are keyed by their row number. COUNTRY
--    CODE is its own column (+91, +1, +971 ...). Abroad: 53 foreign customers,
--    same layout.
--    A row becomes the customer (country code + number; WHATSAPP NUMBER kept;
--    without a number, a customer of their own, the same one for identical
--    rows), the spouse (SPOUSE NUMBER) in their family, and every column as an
--    answer, STATUS "Bought" making them a client. No contact: the sheet has
--    no dates. Rank 0, with Zoho.

-- ---------------------------------------------------------------------------
-- 1. Dates with a month name
-- ---------------------------------------------------------------------------
create or replace function customer.parse_sheet_timestamp(p_value text)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_value, '')); m text[]; d date; hh int := 0; mi int := 0; ss int := 0; pm text; mon int;
begin
  if v = '' then return null; end if;
  if v ~ '^\d{5}(\.\d+)?$' then
    if v::numeric not between 36526 and 73051 then return null; end if;  -- 2000 to 2099
    return (timestamp '1899-12-30' + make_interval(secs => round(v::numeric * 86400)::double precision)) at time zone 'Asia/Kolkata';
  end if;
  -- 14-Mar-2025, 14 March 2025, 14-Mar-25
  m := regexp_match(v, '^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ,]+(\d{4}|\d{2})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$');
  if m is not null then
    mon := array_position(array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'], lower(left(m[2], 3)));
    if mon is null then return null; end if;
    d := make_date(case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end, mon, m[1]::int);
  else
    m := regexp_match(v, '^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?');
    if m is not null then
      d := make_date(m[1]::int, m[2]::int, m[3]::int);
    else
      m := regexp_match(v, '^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?');
      if m is null then return null; end if;
      d := make_date(m[3]::int, m[2]::int, m[1]::int);
      pm := lower(m[7]);
    end if;
  end if;
  hh := coalesce(m[4]::int, 0); mi := coalesce(m[5]::int, 0); ss := coalesce(m[6]::int, 0);
  if pm = 'pm' and hh < 12 then hh := hh + 12; elsif pm = 'am' and hh = 12 then hh := 0; end if;
  if hh > 23 or mi > 59 or ss > 59 then return null; end if;
  return (d + make_time(hh, mi, ss)) at time zone 'Asia/Kolkata';
exception when others then
  return null;
end $$;
-- The 0417 index uses this function; values it reads differently now had no
-- date before (month names), but the index is rebuilt to be exact.
reindex index customer.ingest_rows_form_time_idx;

-- A date answer from any written form, as YYYY-MM-DD; null when it is not a date.
create function customer.as_iso_date(p_value text, p_order text default 'dmy')
returns text language sql immutable set search_path = '' as $$
  select to_char(coalesce(customer.parse_date_ordered(p_value, p_order), customer.parse_sheet_timestamp(p_value)) at time zone 'Asia/Kolkata', 'YYYY-MM-DD')
$$;

-- ---------------------------------------------------------------------------
-- 2. Client or lead
-- ---------------------------------------------------------------------------
create or replace function customer.refresh_client_stats(p_client_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s record; f record; v_marked boolean;
begin
  select count(*) as total,
         count(*) filter (where successful) as reached,
         max(occurred_at) filter (where successful) as last_contacted,
         max(occurred_at) as last_attempt,
         bool_or(successful) as any_reached,
         bool_or(channel in ('walk_in', 'exhibition')) as any_visit,
         min(occurred_at) filter (where purpose = 'purchase' or lower(coalesce(outcome, '')) in ('visited - bought', 'video call - bought')) as first_purchase,
         max(occurred_at) filter (where purpose = 'purchase' or lower(coalesce(outcome, '')) in ('visited - bought', 'video call - bought')) as last_purchase
    into s from customer.interactions where client_id = p_client_id and archived_at is null;
  select occurred_at, source into f from customer.interactions
   where client_id = p_client_id and archived_at is null order by occurred_at, created_at limit 1;
  -- A sheet that says in so many words that the person bought.
  v_marked := exists (select 1 from customer.client_field_values
                       where client_id = p_client_id and field_key = 'buyer_status' and upper(btrim(value)) in ('BOUGHT', 'BUYER'));

  update customer.clients c
     set interaction_count = s.total,
         successful_interaction_count = s.reached,
         last_contacted_at = s.last_contacted,
         last_attempt_at = s.last_attempt,
         lifecycle_stage = case when coalesce(s.any_visit, false) then 'visited'
                                when coalesce(s.any_reached, false) then 'engaged'
                                else c.lifecycle_stage end,
         first_seen_at = least(c.first_seen_at, f.occurred_at),
         first_source = case when f.occurred_at < c.first_seen_at or c.first_seen_at is null
                             then coalesce(f.source, c.first_source) else c.first_source end,
         first_purchase_at = s.first_purchase,
         last_purchase_at = s.last_purchase,
         segment = case when s.last_purchase is not null or v_marked then 'buyer' else 'lead' end
   where c.id = p_client_id;
end $$;

-- A buyer mark that goes away (row or sheet deleted) is taken into account.
create function customer.on_buyer_mark_changed() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_client uuid := case when tg_op = 'DELETE' then old.client_id else new.client_id end;
begin
  if not customer.bulk_delete_running() and exists (select 1 from customer.clients where id = v_client) then
    perform customer.refresh_client_stats(v_client);
  end if;
  return null;
end $$;
create trigger client_field_values_buyer_mark_added after insert on customer.client_field_values
  for each row when (new.field_key = 'buyer_status') execute function customer.on_buyer_mark_changed();
create trigger client_field_values_buyer_mark_removed after delete on customer.client_field_values
  for each row when (old.field_key = 'buyer_status') execute function customer.on_buyer_mark_changed();

update customer.clients set segment = 'lead' where segment = 'non-buyer';

-- ---------------------------------------------------------------------------
-- 3. Database CUSTOMER DATA
-- ---------------------------------------------------------------------------
insert into customer.sources (source, source_rank, label) values
  ('customer_data', 0, 'Customer data (old)'),
  ('customer_data_abroad', 0, 'Customer data - abroad (old)')
on conflict (source) do nothing;

alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling',
                      'order_fms', 'repair_fms', 'zoho', 'exhibition', 'exhibition_old', 'customer_data'));
insert into customer.source_tables (source, table_name, label, importer, one_time) values
  ('customer_data', 'sheet_customer_data', 'Customer data - Masterdata', 'customer_data', true),
  ('customer_data_abroad', 'sheet_customer_data_abroad', 'Customer data - Abroad', 'customer_data', true);

-- COUNTRY CODE + MOBILE NO as one number. +91 or no code: the number as written.
create function customer.phone_with_code(p_code text, p_number text)
returns text language sql immutable set search_path = '' as $$
  select case
    when customer.sheet_value(p_number) is null then null
    when nullif(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), '') is null
         or regexp_replace(p_code, '\D', '', 'g') = '91' then btrim(p_number)
    else '+' || regexp_replace(p_code, '\D', '', 'g') || regexp_replace(p_number, '\D', '', 'g') end
$$;

create function customer.apply_customer_data_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_at timestamptz; v_client uuid; v_other uuid; v_household uuid;
  v_phone text; v_value text; v_part text; f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.source not in ('customer_data', 'customer_data_abroad') then
    raise exception 'Customer data row not found' using errcode = '22023';
  end if;
  v_tenant := v_row.tenant_id;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';
  -- The sheet has no dates: answers are dated when the old sheet was read.
  v_at := coalesce(customer.parse_sheet_timestamp(p ->> 'Timestamp'), v_row.received_at);
  v_phone := customer.phone_with_code(p ->> 'COUNTRY CODE', p ->> 'MOBILE NO');

  -- Identical rows without a number are one customer: the link is the row's content.
  v_client := customer.resolve_client(v_tenant, v_phone,
    nullif(concat_ws(' ', customer.sheet_value(p ->> 'FIRST NAME'), customer.sheet_value(p ->> 'SURNAME')), ''),
    v_row.source, v_at, null, null, v_row.source || ':' || md5(p::text), v_row.id);
  if customer.normalize_phone(p ->> 'WHATSAPP NUMBER') is not null and customer.normalize_phone(v_phone) is not null then
    perform customer.find_or_create_client(v_tenant, '+' || customer.normalize_phone(v_phone), null, v_row.source, v_at,
      array['+' || customer.normalize_phone(p ->> 'WHATSAPP NUMBER')], null, null, v_row.id);
  end if;
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';

  -- The spouse, in the same family.
  if customer.normalize_phone(p ->> 'SPOUSE NUMBER') is not null then
    select household_id into v_household from customer.clients where id = v_client;
    v_other := customer.find_or_create_client(v_tenant, p ->> 'SPOUSE NUMBER', customer.sheet_value(p ->> 'SPOUSE NAME'), v_row.source, v_at, '{}', null, null, v_row.id);
    if v_other <> v_client then perform customer.join_household(v_other, v_household); end if;
  end if;

  for f in select * from (values
      ('GENDER', 'gender'), ('CASTE', 'community'), ('FLAT', 'flat'), ('WING', 'wing'), ('BUILDING', 'building'), ('AREA', 'area'),
      ('PINCODE', 'pincode'), ('CITY', 'city'), ('STATE', 'state'), ('COUNTRY', 'country'), ('EMAIL', 'email'),
      ('SPOUSE NAME', 'spouse_name'), ('FEEDBACK', 'feedback'), ('REFERED BY', 'referred_by_name'), ('TAG', 'customer_tag'),
      ('STATUS', 'buyer_status'), ('STORE', 'store'), ('SALES PERSON', 'salesperson'), ('SOURCE', 'lead_source'),
      ('GROUP NAME', 'group_name'), ('PREFERRED WAY OF CONTACT', 'communication_preference'), ('NOTES', 'notes'),
      ('Address', 'address'), ('WHO CALLED', 'who_called'), ('REASON', 'call_reason')) as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    continue when v_value is null;
    if v_value ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      -- An email is an email, whichever column it was written in.
      insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
      values (v_tenant, v_client, 'email', lower(v_value), v_row.source, v_at) on conflict do nothing;
      perform customer.set_source_field(v_client, 'email', lower(v_value), v_row.source, v_at, null, null);
    elsif f.field_key <> 'email' then
      perform customer.set_source_field(v_client, f.field_key, v_value, v_row.source, v_at, null, null);
    end if;
  end loop;
  for f in select * from (values ('DOB', 'dob'), ('ANNIVERSARY', 'anniversary')) as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    continue when v_value is null;
    v_part := customer.as_iso_date(v_value, 'dmy');
    if v_part is not null then
      perform customer.set_source_field(v_client, f.field_key, v_part, v_row.source, v_at, null, null);
    else
      perform customer.set_source_field(v_client, f.field_key || '_as_written', v_value, v_row.source, v_at, null, null);
    end if;
  end loop;

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client, interaction_id = null,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return null;
end $$;

do $patch$
declare
  body text; found integer; f regprocedure := 'public.customer_ingest_apply(text,integer)'::regprocedure;
  old_text constant text := E'        when ''exhibition_old'' then perform customer.apply_exhibition_old_row(r.id);\n';
  new_text constant text := E'        when ''exhibition_old'' then perform customer.apply_exhibition_old_row(r.id);\n        when ''customer_data'' then perform customer.apply_customer_data_row(r.id);\n';
begin
  body := replace(pg_get_functiondef(f), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then raise exception '0426: expected 1 match in customer_ingest_apply, found %', found; end if;
  execute replace(body, old_text, new_text);
end $patch$;

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function customer.delete_sheet(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;

-- Every customer is a client or a lead under the rule above. Only those whose
-- answer changes are touched: buyers without a purchase left, and leads with a
-- purchase or a buyer mark.
do $recount$
begin
  perform customer.refresh_client_stats(c.id) from customer.clients c
   where (c.segment = 'buyer') <> (
     exists (select 1 from customer.interactions i where i.client_id = c.id and i.archived_at is null
              and (i.purpose = 'purchase' or lower(coalesce(i.outcome, '')) in ('visited - bought', 'video call - bought')))
     or exists (select 1 from customer.client_field_values v where v.client_id = c.id and v.field_key = 'buyer_status'
              and upper(btrim(v.value)) in ('BOUGHT', 'BUYER')));
end $recount$;

-- ---------------------------------------------------------------------------
-- 4. Fix (0425): the first name written in a joined cell is the main name
-- ---------------------------------------------------------------------------
-- cell_parts returned the values of "Asha Mehta | Asha M" in alphabetical
-- order, and every value was added as a name at the same time, so which one
-- became the main name (the name seen last) was chance. Now the values keep
-- the order they are written in, each later name is dated a second earlier so
-- the first is the main name, and customers of the old exhibition data whose
-- main name is a later value of their cell are corrected.
create or replace function customer.cell_parts(p_value text) returns setof text language sql immutable set search_path = '' as $$
  select part from (
    select btrim(t.x) as part, t.n, row_number() over (partition by lower(btrim(t.x)) order by t.n) as rn
      from regexp_split_to_table(coalesce(p_value, ''), '\s*\|\s*') with ordinality as t(x, n)
     where customer.sheet_value(t.x) is not null) s
   where rn = 1 order by n
$$;

do $patch$
declare
  body text; found integer; f regprocedure := 'customer.apply_exhibition_old_row(uuid)'::regprocedure;
  old_text constant text := $o$  for v_part in select x from customer.cell_parts(p ->> 'CLIENT NAME') x loop
    perform customer.add_client_name(v_client, v_part, 'exhibition_old', v_at);
  end loop;$o$;
  new_text constant text := $n$  -- The main name is the one seen last: each later name of the cell is dated a
  -- second earlier, so the first name written stays the main name.
  perform customer.add_client_name(v_client, t.x, 'exhibition_old', v_at - make_interval(secs => t.n - 1))
     from customer.cell_parts(p ->> 'CLIENT NAME') with ordinality as t(x, n);$n$;
begin
  body := replace(pg_get_functiondef(f), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then raise exception '0426: expected 1 match in apply_exhibition_old_row, found %', found; end if;
  execute replace(body, old_text, new_text);
end $patch$;
revoke all on function customer.cell_parts(text) from public, anon, authenticated;
revoke all on function customer.apply_exhibition_old_row(uuid) from public, anon, authenticated;
grant execute on function customer.cell_parts(text) to service_role;
grant execute on function customer.apply_exhibition_old_row(uuid) to service_role;

-- The first name of the cell is made the name seen last, then the main name is
-- worked out again by the usual rule.
do $names$
declare x record;
begin
  for x in
    select r.client_id, (select v from customer.cell_parts(r.payload ->> 'CLIENT NAME') v limit 1) as first_name
      from customer.ingest_rows r join customer.clients c on c.id = r.client_id
     where r.source = 'exhibition_old' and r.status = 'applied' and r.payload ->> 'CLIENT NAME' like '%|%'
       and lower(c.primary_name) = any (array(select lower(v) from customer.cell_parts(r.payload ->> 'CLIENT NAME') v offset 1))
  loop
    update customer.client_names n
       set last_seen_at = (select max(m.last_seen_at) from customer.client_names m where m.client_id = x.client_id) + interval '1 second'
     where n.client_id = x.client_id and n.name = customer.clean_name(x.first_name);
    perform customer.refresh_primary_name(x.client_id);
  end loop;
end $names$;
