-- 0429: customer master database, part 15 - the other tabs of "MK CENTRALIZED
-- CLIENT DATABASE": WRONG NUMBER, DONT CONTACT ANYMORE, ALL BUYER LIST and
-- ALL OLD FINAL DATA (headers on row 1; read-only probes 2026-11-18).
--
-- Owner, 2026-11-18:
--   * wrong numbers are kept and marked; numbers that are not valid (8 or 9
--     digits and so on) are marked too, and neither is ever called;
--   * people in DONT CONTACT ANYMORE are never contacted and never show up;
--   * ALL BUYER LIST gives each buyer's ticket-size category: SILVER (lowest),
--     GOLD, DIAMOND, ROCKET (highest);
--   * ALL OLD FINAL DATA adds the people not seen yet, with their real source;
--   * one person once: everything is matched by number.
--
-- Facts from the probes: WRONG NUMBER 2,837 rows, DONT CONTACT ANYMORE 59,
-- ALL BUYER LIST 8,271 (SILVER 5,673, GOLD 2,068, DIAMOND 339, ROCKET 191),
-- ALL OLD FINAL DATA 31,894 (the MASTER DATABASE columns without the dates;
-- 825 numbers of 9 digits and 428 of 8). CONTACT NUMBER is unique in each tab.
--
-- What each tab does to the customer with that number (created if new):
--   WRONG NUMBER          answers "Wrong number reason", "Wrong number call
--                         status", "Wrong number remark", "Wrong number date";
--                         tag "Wrong number". No contact on the timeline: the
--                         calls are already there from Runo.
--   DONT CONTACT ANYMORE  do not call, hidden (archived with the reason
--                         do_not_contact), pending follow-ups cancelled and
--                         booked appointments cancelled; answers "Do not
--                         contact reason", "Do not contact date", "Do not
--                         contact noted by". A later row of any sheet with the
--                         same number finds this same hidden person: imports
--                         only bring back people hidden because their sheet
--                         row went away, never these. Taking a person off the
--                         tab does not bring them back.
--   ALL BUYER LIST        "Client category" (as written) and salesperson; being
--                         on the buyer list makes the person a client.
--   ALL OLD FINAL DATA    read exactly like MASTER DATABASE (same importer),
--                         ranked with the old lists (0), so it fills gaps and
--                         never overrides a live sheet.
--
-- Invalid numbers: a number that is not a valid phone was already kept as an
-- unverified number on its own customer. The same unverified number from
-- another sheet now joins that customer instead of making a new one, when it
-- looks like a phone number (8 to 15 digits, not one digit repeated).
--
-- customer.callable(client) is the one rule for who may be called or messaged
-- (call distribution will use it): not hidden, not do-not-call, has a valid
-- number, and not marked wrong number.

-- Exact-text patch of an existing function; fails unless the text is found
-- exactly the expected number of times. Dropped at the end.
create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0429: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Sources and tables
-- ---------------------------------------------------------------------------
insert into customer.sources (source, source_rank, label) values
  ('master_wrong_number', 4, 'Centralized database: wrong numbers'),
  ('master_dont_contact', 4, 'Centralized database: do not contact'),
  ('master_buyer_list', 4, 'Centralized database: all buyer list'),
  ('master_old_final', 0, 'Centralized database: all old final data')
on conflict (source) do nothing;

alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling',
                      'order_fms', 'repair_fms', 'zoho', 'exhibition', 'exhibition_old', 'customer_data', 'master_sheet',
                      'wrong_number', 'dont_contact', 'buyer_list'));
insert into customer.source_tables (source, table_name, label, importer, one_time) values
  ('master_wrong_number', 'sheet_centralized_wrong_number', 'Centralized database: WRONG NUMBER', 'wrong_number', false),
  ('master_dont_contact', 'sheet_centralized_dont_contact', 'Centralized database: DONT CONTACT ANYMORE', 'dont_contact', false),
  ('master_buyer_list', 'sheet_centralized_buyer_list', 'Centralized database: ALL BUYER LIST', 'buyer_list', false),
  ('master_old_final', 'sheet_centralized_old_final', 'Centralized database: ALL OLD FINAL DATA', 'master_sheet', true);

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- "12/4/" (day and month, no year) as --04-12, the form birthdays without a year take.
create function customer.month_day(p_value text)
returns text language sql immutable set search_path = '' as $$
  select case when d between 1 and 31 and m between 1 and 12 then format('--%s-%s', lpad(m::text, 2, '0'), lpad(d::text, 2, '0')) end
    from (select (regexp_match(btrim(p_value), '^(\d{1,2})[/.-](\d{1,2})'))[1]::int as d,
                 (regexp_match(btrim(p_value), '^(\d{1,2})[/.-](\d{1,2})'))[2]::int as m) x;
$$;

-- The row as {header: value}, headers with single spaces, blanks dropped.
create function customer.row_values(p_payload jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(regexp_replace(btrim(key), '\s+', ' ', 'g'), btrim(value)), '{}'::jsonb)
    from jsonb_each_text(p_payload) where btrim(coalesce(value, '')) <> '';
$$;

create function customer.callable(p_client_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select c.archived_at is null and not c.do_not_call
     and exists (select 1 from customer.client_phones p where p.client_id = c.id)
     and not exists (select 1 from customer.client_field_values v where v.client_id = c.id and v.field_key = 'wrong_number_reason')
    from customer.clients c where c.id = p_client_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. One unverified number, one customer
-- ---------------------------------------------------------------------------
select customer._patch('customer.resolve_client(uuid,text,text,text,timestamptz,text,text,text,uuid)'::regprocedure,
$old$    if v_client is null then
      insert into customer.households (tenant_id) values (p_tenant_id) returning id into v_household;$old$,
$new$    -- The same number that is not a valid phone but looks like one (8 or more
    -- digits, not one digit repeated), seen before: the same person. Short or
    -- filler values such as 12345 or 00000000 never join two rows.
    if v_client is null and btrim(coalesce(p_phone, '')) ~ '^\+?[0-9][0-9 -]{6,}[0-9]$'
       and length(regexp_replace(p_phone, '\D', '', 'g')) between 8 and 15
       and regexp_replace(p_phone, '\D', '', 'g') !~ '^(\d)\1+$' then
      select coalesce(c.merged_into_client_id, c.id) into v_client from customer.client_identifiers i join customer.clients c on c.id = i.client_id
       where i.tenant_id = p_tenant_id and i.id_type = 'unverified_phone' and i.value = left(btrim(p_phone), 60)
       order by i.first_seen_at, i.id limit 1;
    end if;
    if v_client is null then
      insert into customer.households (tenant_id) values (p_tenant_id) returning id into v_household;$new$, 1);

-- ---------------------------------------------------------------------------
-- 4. ALL OLD FINAL DATA: the MASTER DATABASE importer, for any tab that uses it
-- ---------------------------------------------------------------------------
create or replace function customer.apply_master_sheet_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_changed timestamptz; v_at timestamptz; v_client uuid;
  v_origin text; v_first timestamptz; v_recent timestamptz; v_contact uuid; v_value text; v_date text; f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or not exists (select 1 from customer.source_tables where source = v_row.source and importer = 'master_sheet') then raise exception 'Centralized database row not found' using errcode = '22023'; end if;
  v_tenant := v_row.tenant_id;
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  -- Headers are read with single spaces: the sheet writes "FIRST  INTERACTION SOURCE".
  select coalesce(jsonb_object_agg(regexp_replace(btrim(key), '\s+', ' ', 'g'), btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';
  if upper(coalesce(p ->> 'CONTACT NUMBER', '')) = 'CONTACT NUMBER' then raise exception 'Header row inside the data' using errcode = '22023'; end if;

  -- The real source of this row, recorded on everything it gives.
  v_origin := customer.sheet_value(p ->> 'FIRST INTERACTION SOURCE');
  if v_origin is not null then
    insert into customer.origins (origin, label) values (v_origin, v_origin) on conflict do nothing;
  end if;
  perform set_config('customer.current_origin', coalesce(v_origin, ''), true);

  v_first := customer.parse_sheet_timestamp(p ->> 'FIRST PURCHASE DATE');
  v_recent := customer.parse_sheet_timestamp(p ->> 'RECENT PURCHASE DATE');
  v_at := coalesce(customer.parse_sheet_timestamp(p ->> 'LAST INTERACTION DATE'), v_recent, v_row.received_at);

  v_client := customer.resolve_client(v_tenant, p ->> 'CONTACT NUMBER', customer.sheet_value(p ->> 'CLIENT NAME'), v_row.source,
    coalesce(v_first, v_at), null, null, v_row.source || ':' || v_row.row_key, v_row.id);
  perform customer.add_identifier(v_client, 'sheet_client_id', p ->> 'CLIENT ID', v_row.source, v_at);
  perform customer.link_sheet_family(v_client, p ->> 'FAMILY ID');
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';

  -- Purchases on the timeline, from the dates the sheet gives.
  for f in select * from (values ('first', v_first, 'FIRST PURCHASE DATE'), ('recent', v_recent, 'RECENT PURCHASE DATE')) as m(k, at, header) loop
    continue when f.at is null or (f.k = 'recent' and v_first is not null and (f.at at time zone 'Asia/Kolkata')::date = (v_first at time zone 'Asia/Kolkata')::date);
    v_contact := customer.record_interaction(v_client, jsonb_build_object(
      'occurred_at', f.at, 'channel', 'not_recorded', 'direction', 'not_recorded', 'purpose', 'purchase',
      'source', v_row.source, 'external_ref', v_row.row_key || ':' || f.k, 'source_row', v_row.id,
      'outcome', f.header, 'result', 'positive', 'successful', true, 'process_name', 'Centralized client database'));
    update customer.interactions set archived_at = null, archive_reason = null, origin = nullif(coalesce(v_origin, ''), '')
     where id = v_contact and (archived_at is not null or origin is distinct from v_origin);
  end loop;
  -- A purchase date that is gone from the row takes its purchase with it.
  delete from customer.interactions i
   where i.source = v_row.source and i.source_row = v_row.id
     and ((v_first is null and i.external_ref = v_row.row_key || ':first')
       or ((v_recent is null or (v_first is not null and (v_recent at time zone 'Asia/Kolkata')::date = (v_first at time zone 'Asia/Kolkata')::date))
           and i.external_ref = v_row.row_key || ':recent'));

  -- Every other column, as written.
  for f in select * from (values
      ('FIRST INTERACTION SOURCE', 'first_interaction_source'), ('BUYER / NON BUYER', 'buyer_status'),
      ('SALESPERSON', 'salesperson'), ('SOURCE OF WALK-IN', 'lead_source'), ('BRANCH', 'store'),
      ('CLIENT BOUGHT ANY PRODUCT?', 'client_bought_any_product'), ('NOT BOUGHT REASONS', 'not_bought_reasons'),
      ('SEEN CATEGORIES', 'seen_categories'), ('SEEN TAGS (COMBINED)', 'seen_tags'),
      ('BOUGHT CATEGORIES', 'bought_categories'), ('BOUGHT TAGS (COMBINED)', 'bought_tags'),
      ('MARKETING MESSAGE', 'marketing_message'), ('COMMUNICATION PREFERENCE', 'communication_preference'),
      ('MONTH OF WEDDING', 'wedding_month'), ('YEAR OF WEDDING', 'wedding_year'), ('OCCUPATION', 'occupation'),
      ('GENDER', 'gender'), ('COMMUNITY / CASTE', 'community'), ('FULL ADDRESS', 'address'), ('CITY', 'city'),
      ('STATE', 'state'), ('COUNTRY', 'country'), ('PINCODE', 'pincode'), ('GOOGLE REVIEW', 'google_review'),
      ('TESTIMONIAL', 'testimonial'), ('FEEDBACK', 'feedback'), ('THANK-YOU NOTE GIVEN', 'thank_you_note'),
      ('REFERRALS GIVEN', 'referrals_given'), ('BEVERAGE', 'beverage'), ('SUGAR', 'sugar'), ('SNACK', 'snack'),
      ('GIFT GIVEN', 'gift_given'), ('STATUS', 'data_status'), ('SCRIPT STATUS', 'contact_type')) as m(header, field_key)
  loop
    v_value := customer.sheet_value(p ->> f.header);
    continue when v_value is null;
    if v_value ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
      values (v_tenant, v_client, 'email', lower(v_value), v_row.source, v_at) on conflict do nothing;
      perform customer.set_source_field(v_client, 'email', lower(v_value), v_row.source, v_at, v_changed, null);
    else
      perform customer.set_source_field(v_client, f.field_key, v_value, v_row.source, v_at, v_changed, null);
    end if;
  end loop;
  for f in select * from (values ('DATE OF BIRTH', 'dob'), ('ANNIVERSARY', 'anniversary'), ('LAST INTERACTION DATE', 'last_interaction_date'))
           as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    continue when v_value is null;
    v_date := case when v_value ~ '^\d{1,2}[/.-]\d{1,2}[/.-]?$'
                   then customer.month_day(v_value) else customer.as_iso_date(v_value, 'dmy') end;
    if v_date is not null then
      perform customer.set_source_field(v_client, f.field_key, v_date, v_row.source, v_at, v_changed, null);
    else
      perform customer.set_source_field(v_client, f.field_key || '_as_written', v_value, v_row.source, v_at, v_changed, null);
    end if;
  end loop;

  perform customer.refresh_client_stats(v_client);
  perform set_config('customer.current_origin', '', true);
  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client, interaction_id = v_contact,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return v_contact;
end $$;


-- ---------------------------------------------------------------------------
-- 5. WRONG NUMBER, DONT CONTACT ANYMORE, ALL BUYER LIST
-- ---------------------------------------------------------------------------
create function customer.apply_centralized_list_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; v_importer text; p jsonb; v_tenant uuid; v_changed timestamptz; v_at timestamptz; v_client uuid;
  v_value text; f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  select importer into v_importer from customer.source_tables where source = v_row.source;
  if v_row.id is null or v_importer not in ('wrong_number', 'dont_contact', 'buyer_list') then
    raise exception 'Centralized list row not found' using errcode = '22023';
  end if;
  v_tenant := v_row.tenant_id;
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  p := customer.row_values(v_row.payload);
  if upper(coalesce(p ->> 'CONTACT NUMBER', '')) = 'CONTACT NUMBER' then raise exception 'Header row inside the data' using errcode = '22023'; end if;
  v_at := coalesce(customer.parse_sheet_timestamp(p ->> 'INTERACTION DATE'), v_row.received_at);

  v_client := customer.resolve_client(v_tenant, p ->> 'CONTACT NUMBER', customer.sheet_value(p ->> 'CLIENT NAME'), v_row.source,
    v_at, null, null, v_row.source || ':' || v_row.row_key, v_row.id);
  if v_importer <> 'dont_contact' then
    update customer.clients set archived_at = null, archive_reason = null
     where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';
  end if;

  for f in select * from (values
      ('wrong_number', 'WRONG NUMBER REASON', 'wrong_number_reason'), ('wrong_number', 'CALL STATUS / CALL GOT CONNECTED', 'wrong_number_call_status'),
      ('wrong_number', 'FINAL REMARK / NOTES', 'wrong_number_remark'), ('wrong_number', 'INTERACTION DATE', 'wrong_number_date'),
      ('wrong_number', 'ATTENDED BY', 'wrong_number_noted_by'), ('wrong_number', 'BRANCH', 'wrong_number_branch'),
      ('wrong_number', 'SOURCE', 'wrong_number_from'),
      ('dont_contact', 'NEGATIVE NOTE / REMARK', 'do_not_contact_reason'), ('dont_contact', 'INTERACTION DATE', 'do_not_contact_date'),
      ('dont_contact', 'ATTENDED BY', 'do_not_contact_noted_by'), ('dont_contact', 'BRANCH', 'do_not_contact_branch'),
      ('dont_contact', 'SOURCE', 'do_not_contact_from'),
      ('buyer_list', 'TYPE OF CLIENT', 'client_category'), ('buyer_list', 'SALES PERSON', 'salesperson')) as m(importer, header, field_key)
    where m.importer = v_importer
  loop
    v_value := customer.sheet_value(p ->> f.header);
    -- A wrong number is marked even when the sheet gives no reason.
    if v_value is null and f.field_key = 'wrong_number_reason' then v_value := 'Listed in WRONG NUMBER'; end if;
    if v_value is null and f.field_key = 'do_not_contact_reason' then v_value := 'Listed in DONT CONTACT ANYMORE'; end if;
    continue when v_value is null;
    perform customer.set_source_field(v_client, f.field_key, v_value, v_row.source, v_at, v_changed, null);
  end loop;

  if v_importer = 'dont_contact' then
    update customer.clients
       set do_not_call = true,
           archived_at = coalesce(archived_at, now()),
           archive_reason = case when archived_at is null or archive_reason = 'removed_from_sheet' then 'do_not_contact' else archive_reason end
     where id = v_client;
    update customer.follow_ups set status = 'cancelled' where client_id = v_client and status = 'pending';
    update customer.appointments set status = 'cancelled' where client_id = v_client and status = 'booked';
    insert into public.audit_logs (tenant_id, action, module, record_id, new_value)
    select v_tenant, 'customer_do_not_contact', 'customer', v_client, jsonb_build_object('source_row', v_row.id)
     where not exists (select 1 from public.audit_logs where record_id = v_client and action = 'customer_do_not_contact');
  end if;

  perform customer.refresh_client_stats(v_client);
  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 6. A buyer-list category makes a client
-- ---------------------------------------------------------------------------
select customer._patch('customer.refresh_client_stats(uuid)'::regprocedure,
$old$where client_id = p_client_id and field_key = 'buyer_status' and upper(btrim(value)) in ('BOUGHT', 'BUYER'));$old$,
$new$where client_id = p_client_id and ((field_key = 'buyer_status' and upper(btrim(value)) in ('BOUGHT', 'BUYER')) or field_key = 'client_category'));$new$, 1);
drop trigger client_field_values_buyer_mark_added on customer.client_field_values;
drop trigger client_field_values_buyer_mark_removed on customer.client_field_values;
create trigger client_field_values_buyer_mark_added after insert on customer.client_field_values
  for each row when (new.field_key in ('buyer_status', 'client_category')) execute function customer.on_buyer_mark_changed();
create trigger client_field_values_buyer_mark_removed after delete on customer.client_field_values
  for each row when (old.field_key in ('buyer_status', 'client_category')) execute function customer.on_buyer_mark_changed();

-- ---------------------------------------------------------------------------
-- 7. Tags: ticket size first, then wrong and invalid numbers
-- ---------------------------------------------------------------------------
create or replace function customer.client_tags(p_client_id uuid)
returns text[] language sql stable set search_path = '' as $$
  with c as (select * from customer.clients where id = p_client_id),
  a as (select customer.current_answer(p_client_id, 'data_status') as data_status,
               customer.current_answer(p_client_id, 'contact_type') as contact_type,
               customer.current_answer(p_client_id, 'store') as store,
               customer.current_answer(p_client_id, 'client_category') as category)
  select array_remove(array[
    case when nullif(btrim(a.category), '') is not null then 'tier:' || upper(btrim(a.category)) end,
    case when c.archive_reason = 'do_not_contact' then 'do_not_contact' end,
    case when exists (select 1 from customer.client_field_values v where v.client_id = c.id and v.field_key = 'wrong_number_reason') then 'wrong_number' end,
    case when not exists (select 1 from customer.client_phones p where p.client_id = c.id)
          and exists (select 1 from customer.client_identifiers i where i.client_id = c.id and i.id_type = 'unverified_phone') then 'invalid_number' end,
    case when (c.country is not null and upper(btrim(c.country)) not in ('INDIA', 'IN', 'IND', 'BHARAT'))
           or exists (select 1 from customer.client_phones p where p.client_id = c.id and p.kind = 'primary' and p.phone !~ '^91')
         then 'abroad' end,
    case when c.do_not_call and c.archive_reason is distinct from 'do_not_contact' then 'do_not_call' end,
    case when upper(a.contact_type) like 'NON-CLIENT%' then 'not_customer' end,
    case when upper(btrim(a.data_status)) = 'STAFF' then 'staff' end,
    case when upper(btrim(a.data_status)) = 'WRONG DATA' then 'wrong_data' end,
    case when c.referred_by_client_id is not null then 'referred' end,
    case when nullif(btrim(a.store), '') is not null then 'store:' || btrim(a.store) end
  ], null)
  from c, a;
$$;

-- ---------------------------------------------------------------------------
-- 8. Dispatch
-- ---------------------------------------------------------------------------
select customer._patch('public.customer_ingest_apply(text,integer)'::regprocedure,
E'        when ''master_sheet'' then perform customer.apply_master_sheet_row(r.id);\n',
E'        when ''master_sheet'' then perform customer.apply_master_sheet_row(r.id);\n        when ''wrong_number'', ''dont_contact'', ''buyer_list'' then perform customer.apply_centralized_list_row(r.id);\n', 1);

drop function customer._patch(regprocedure, text, text, integer);

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function customer.delete_sheet(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;
