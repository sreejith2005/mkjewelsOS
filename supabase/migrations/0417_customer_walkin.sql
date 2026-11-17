-- 0417: customer master database, part 8 - the walk-in sheet "01 WALKIN DATA".
--
-- Three tabs (owner, 2026-11-17: the other tabs of the file copy these):
--   WALKIN DATASET  one row per store visit. Key: REFERENCE NUMBER (4,306 of
--                   4,308 rows; the other two are keyed by row number).
--   FAMILY DATA     one row per family member. Key: CLIENT ID + TIMESTAMP.
--   REFERRALS       one row per person a client referred. Key: TIMESTAMP +
--                   REFERRAL NUMBER + REFERRAL NAME.
--
-- What each row becomes:
--   * a visit: the customer (phone, else billing phone, else a customer of
--     its own - 0416), one store-visit contact dated CLIENT VISIT DATE, the
--     products seen / bought / ordered, the next visit as a store
--     appointment, companions in the customer's family, the person who
--     referred them, and every answer of the form on the profile. Walk-in
--     answers rank above calls and enquiries.
--   * a family row: the member (by NUMBER, else by the old sheet CLIENT ID,
--     else a member of their own), in the family of the old sheet FAMILY ID.
--   * a referral: the referred person as a customer, linked to the client who
--     gave the referral when that client's visit form was sent in the same
--     second (the two tabs are filled by one form).
--
-- Rules followed (owner, 2026-11-17):
--   * values are kept as the sheet wrote them; nothing is read into them.
--     CLIENT BOUGHT ANY PRODUCT? is the visit's outcome as written. Only YES
--     is read: the visit is a purchase and the customer is a buyer.
--   * the old sheet ids (CRM CLIENT ID, FAMILY ID, MAIN CLIENT ID) are not our
--     codes. They are kept as references, used only to put families together.
--   * the master takes the answers from the columns the form fills (CITY, and
--     CITY (OTHER) when CITY is OTHER). The sheet's "FINAL" columns, headed
--     RESERVED COLUMN in row 1, stay unchanged in the sheet's own table.
--   * a row that repeats the header names is not a visit; it is kept in the
--     sheet's table, marked "Header row inside the data".
--
-- Also: "buyer" is now worked out from the timeline, so it follows edits and
-- removals: a customer is a buyer while a contact says they bought (walk-in
-- YES, Runo "Visited - Bought" / "Video Call - Bought", an enquiry marked
-- bought).

-- ---------------------------------------------------------------------------
-- 1. Sheets
-- ---------------------------------------------------------------------------
insert into customer.sources (source, source_rank, label) values ('walkin_family', 4, 'Walk-in family data')
on conflict (source) do nothing;
update customer.sources set label = 'Referral given at a store visit' where source = 'referral';

alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral'));
insert into customer.source_tables (source, table_name, label, importer, one_time) values
  ('walkin', 'sheet_walkin', 'Walk-in dataset', 'walkin', false),
  ('walkin_family', 'sheet_walkin_family', 'Walk-in family data', 'walkin_family', false),
  ('referral', 'sheet_walkin_referrals', 'Walk-in referrals', 'referral', false);

-- Who filled the form, next to who served the customer.
alter table customer.interactions add column recorded_by_user_id uuid references public.user_profiles(id), add column recorded_by_name text;

-- A visit form and its referrals are sent together: same TIMESTAMP.
create index ingest_rows_form_time_idx on customer.ingest_rows (tenant_id, source, customer.parse_sheet_timestamp(payload ->> 'TIMESTAMP'))
  where source in ('walkin', 'referral');

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- A cell as a value: empty and "not applicable" cells are no value.
create function customer.sheet_value(p_value text)
returns text language sql immutable set search_path = '' as $$
  select case when upper(btrim(coalesce(p_value, ''))) in ('', 'NA', 'N/A', 'N.A', 'N A', 'NIL', '-', '_', '.', '#ERROR!', '#REF!', '#N/A')
              then null else btrim(p_value) end
$$;

-- A form answer with its "other" box: the box when the answer is OTHER.
create function customer.answer_with_other(p_answer text, p_other text)
returns text language sql immutable set search_path = '' as $$
  select case
    when customer.sheet_value(p_other) is not null
         and (customer.sheet_value(p_answer) is null or upper(btrim(p_answer)) ~ '^OTHERS?\s*:?$') then customer.sheet_value(p_other)
    else customer.sheet_value(p_answer) end
$$;

-- Put a customer into a family, but only a customer who is alone in their own:
-- two families with members are never joined automatically.
create function customer.join_household(p_client_id uuid, p_household_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_old uuid;
begin
  select household_id into v_old from customer.clients where id = p_client_id;
  if v_old is null or p_household_id is null then return false; end if;
  if v_old = p_household_id then return true; end if;
  if (select count(*) from customer.clients where household_id = v_old) > 1 then return false; end if;
  update customer.clients set household_id = p_household_id where id = p_client_id;
  update customer.households set main_client_id = null where id = v_old;
  delete from customer.households h where h.id = v_old and not exists (select 1 from customer.clients c where c.household_id = h.id);
  return true;
end $$;

-- The old sheet FAMILY ID puts its customers in one family: the family that
-- already has most of them.
create function customer.link_sheet_family(p_client_id uuid, p_family_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_code text := upper(customer.sheet_value(p_family_code)); v_target uuid; c record;
begin
  if v_code is null or v_code !~ '^[A-Z]+-[A-Z0-9]+$' then return null; end if;
  select tenant_id into v_tenant from customer.clients where id = p_client_id;
  insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
  values (v_tenant, p_client_id, 'sheet_family_id', v_code, 'walkin', now()) on conflict do nothing;
  select k.household_id into v_target from (
    select cl.household_id, count(*) as n, min(cl.created_at) as first_at
      from customer.client_identifiers i join customer.clients cl on cl.id = i.client_id
     where i.tenant_id = v_tenant and i.id_type = 'sheet_family_id' and i.value = v_code and cl.merged_into_client_id is null
     group by cl.household_id) k
   order by (select count(*) from customer.clients m where m.household_id = k.household_id) desc, k.first_at limit 1;
  for c in select distinct i.client_id from customer.client_identifiers i
            where i.tenant_id = v_tenant and i.id_type = 'sheet_family_id' and i.value = v_code loop
    perform customer.join_household(c.client_id, v_target);
  end loop;
  return v_target;
end $$;

create function customer.add_identifier(p_client_id uuid, p_type text, p_value text, p_source text, p_at timestamptz)
returns void language sql security definer set search_path = '' as $$
  insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
  select c.tenant_id, c.id, p_type, upper(customer.sheet_value(p_value)), p_source, coalesce(p_at, now())
    from customer.clients c where c.id = p_client_id and customer.sheet_value(p_value) is not null
  on conflict do nothing
$$;

-- Who gave a referral: the client of the visit form sent in the same second,
-- with the same name, or the only visit form sent in that second.
create function customer.referral_giver(p_tenant_id uuid, p_sent_at timestamptz, p_giver_name text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_client uuid; n integer;
begin
  if p_sent_at is null then return null; end if;
  select count(*), (array_agg(r.client_id))[1] into n, v_client from customer.ingest_rows r
   where r.tenant_id = p_tenant_id and r.source = 'walkin' and r.status = 'applied' and r.client_id is not null
     and customer.parse_sheet_timestamp(r.payload ->> 'TIMESTAMP') = p_sent_at
     and customer.name_key(r.payload ->> 'CLIENT NAME') = customer.name_key(p_giver_name);
  if n >= 1 then return v_client; end if;
  select count(*), (array_agg(r.client_id))[1] into n, v_client from customer.ingest_rows r
   where r.tenant_id = p_tenant_id and r.source = 'walkin' and r.status = 'applied' and r.client_id is not null
     and customer.parse_sheet_timestamp(r.payload ->> 'TIMESTAMP') = p_sent_at;
  if n = 1 then return v_client; end if;
  return null;
end $$;

create function customer.set_referrer(p_client_id uuid, p_referrer_id uuid)
returns void language sql security definer set search_path = '' as $$
  update customer.clients set referred_by_client_id = p_referrer_id
   where id = p_client_id and p_referrer_id is not null and p_referrer_id <> p_client_id and referred_by_client_id is null
$$;

-- ---------------------------------------------------------------------------
-- 3. One visit
-- ---------------------------------------------------------------------------
create function customer.apply_walkin_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows;
  p jsonb;
  v_tenant uuid;
  v_changed timestamptz;
  v_stamp timestamptz;
  v_visit timestamptz;
  v_at timestamptz;
  v_client uuid;
  v_household uuid;
  v_interaction uuid;
  v_outcome text;
  v_branch uuid;
  v_other uuid;
  v_name text;
  v_phone text;
  v_value text;
  v_due timestamptz;
  v_item text;
  i integer;
  f record;
  r record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.source <> 'walkin' then raise exception 'Walk-in row not found' using errcode = '22023'; end if;
  v_tenant := v_row.tenant_id;
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';
  if upper(coalesce(p ->> 'CLIENT NAME', '')) = 'CLIENT NAME' or upper(coalesce(p ->> 'GENDER', '')) = 'GENDER' then
    raise exception 'Header row inside the data' using errcode = '22023';
  end if;

  -- When: the visit date, with the form's time when sent the same day.
  v_stamp := customer.parse_sheet_timestamp(p ->> 'TIMESTAMP');
  v_visit := customer.parse_sheet_timestamp(p ->> 'CLIENT VISIT DATE');
  v_at := case
    when v_visit is null then v_stamp
    when (p ->> 'CLIENT VISIT DATE') !~ ':' and v_stamp is not null
         and (v_stamp at time zone 'Asia/Kolkata')::date = (v_visit at time zone 'Asia/Kolkata')::date then v_stamp
    else v_visit end;

  -- 3.1 Who ---------------------------------------------------------------------
  v_client := customer.resolve_client(v_tenant, p ->> 'CLIENT PHONE', p ->> 'CLIENT NAME', 'walkin', coalesce(v_at, v_row.received_at),
    p ->> 'BILLING PHONE', null, 'walkin:' || v_row.row_key, v_row.id);
  perform customer.add_identifier(v_client, 'sheet_client_id', p ->> 'CRM CLIENT ID', 'walkin', v_at);
  perform customer.link_sheet_family(v_client, p ->> 'FAMILY ID');
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';
  select household_id into v_household from customer.clients where id = v_client;

  if v_at is null then
    -- No readable date at all: the customer is kept; there is no visit to date.
    update customer.ingest_rows
       set status = 'applied', reject_reason = 'No visit date: customer kept, no visit recorded', removed_at = null,
           client_id = v_client, interaction_id = null, applied_at = now(), updated_at = now(), attempts = attempts + 1
     where id = v_row.id;
    return null;
  end if;

  -- 3.2 The visit -------------------------------------------------------------------
  v_outcome := customer.sheet_value(p ->> 'CLIENT BOUGHT ANY PRODUCT?');
  v_branch := customer.resolve_branch(v_tenant, p ->> 'BRANCH');
  v_interaction := customer.record_interaction(v_client, jsonb_strip_nulls(jsonb_build_object(
    'occurred_at', v_at, 'channel', 'walk_in', 'direction', 'in_person',
    'purpose', case when upper(coalesce(v_outcome, '')) = 'YES' then 'purchase' else 'visit' end,
    'source', 'walkin', 'external_ref', v_row.row_key, 'source_row', v_row.id,
    'outcome', v_outcome, 'result', case when upper(coalesce(v_outcome, '')) = 'YES' then 'positive' else 'neutral' end,
    'successful', true,
    'staff_user_id', customer.resolve_staff(v_tenant, customer.sheet_value(p ->> 'SALESPERSON')), 'staff_name', customer.sheet_value(p ->> 'SALESPERSON'),
    'branch_id', v_branch, 'store_name', customer.sheet_value(p ->> 'BRANCH'),
    'customer_type_stated', customer.sheet_value(p ->> 'CLIENT TYPE'), 'process_name', 'Walk-in form',
    'notes', customer.sheet_value(p ->> 'REMARK'))));
  update customer.interactions
     set archived_at = null, archive_reason = null,
         recorded_by_user_id = customer.resolve_staff(v_tenant, customer.sheet_value(p ->> 'CRM NAME')),
         recorded_by_name = customer.sheet_value(p ->> 'CRM NAME')
   where id = v_interaction;
  perform customer.refresh_client_stats(v_client);
  perform customer.close_follow_ups(v_client, v_interaction);

  -- Products: tags are product codes, categories are kinds of jewellery.
  delete from customer.interaction_products where interaction_id = v_interaction;
  for f in select * from (values
      ('SEEN TAGS (COMBINED)', 'SEEN CATEGORIES', 'seen'),
      ('BOUGHT TAGS (COMBINED)', 'BOUGHT CATEGORIES', 'bought'),
      ('ORDER/NEW THINGS TAGS (COMBINED)', 'ORDER/NEW THINGS CATEGORIES', 'ordered')) as m(tags, cats, interest) loop
    for v_item in select btrim(x) from regexp_split_to_table(coalesce(p ->> f.tags, ''), '\s*[,;\n]\s*') x loop
      if customer.sheet_value(v_item) is not null then
        perform customer.add_interaction_product(v_interaction, upper(v_item), null, f.interest);
      end if;
    end loop;
    for v_item in select btrim(x) from regexp_split_to_table(coalesce(p ->> f.cats, ''), '\s*[,;\n]\s*') x loop
      if customer.sheet_value(v_item) is not null then
        perform customer.add_interaction_product(v_interaction, null, v_item, f.interest);
      end if;
    end loop;
  end loop;

  -- The next visit the customer gave.
  v_due := customer.parse_sheet_timestamp(p ->> 'NEXT VISIT DATE');
  if v_due is not null then
    perform customer.create_appointment(v_client, 'store', v_due, v_interaction, v_branch);
  end if;

  -- 3.3 Answers -----------------------------------------------------------------------
  for f in select * from (values
      ('GENDER', null, 'gender'), ('COUNTRY', null, 'country'), ('STATE', null, 'state'), ('CITY', 'CITY (OTHER)', 'city'),
      ('PINCODE', null, 'pincode'), ('ADDRESS', null, 'address'), ('COMMUNITY', 'COMMUNITY (OTHER)', 'community'),
      ('OCCUPATION', 'OCCUPATION (OTHER)', 'occupation'), ('MARKETING MESSAGE', null, 'marketing_message'),
      ('COMMUNICATION PREFERENCE', null, 'communication_preference'), ('BEVERAGE', 'BEVERAGE (OTHER)', 'beverage'),
      ('SUGAR', 'SUGAR (OTHER)', 'sugar'), ('SNACK', 'SNACK (OTHER)', 'snack'), ('GIFT GIVEN', 'GIFT (OTHER)', 'gift_given'),
      ('SOURCE OF LEAD', 'SOURCE (OTHER)', 'lead_source'), ('BRIDAL / NON BRIDAL', null, 'bridal'),
      ('MONTH OF WEDDING', null, 'wedding_month'), ('YEAR OF WEDDING', null, 'wedding_year'),
      ('CLIENT POTENTIAL CATEGORY', null, 'potential'), ('WHY IS THIS CLIENT A HIGH-POTENTIAL BUYER?', null, 'potential_reason'),
      ('PRODUCT REQUIREMENT', null, 'product_requirement'), ('OTHER STORE CLIENT WANTS TO VISIT', null, 'other_store_wanted'),
      ('WHICH CATEGORIES CLIENT WANT TO SEE MORE', null, 'categories_wanted'),
      ('REPAIR/ORDER APPROACH', null, 'repair_order_approach'), ('NEW THINGS CHOICE', null, 'new_things_choice'),
      ('INSTAGRAM FOLLOW ASKED', null, 'instagram_follow'), ('INSTAGRAM FOLLOW - NO REASON', null, 'instagram_follow_no_reason'),
      ('GOOGLE REVIEW ASKED', null, 'google_review'), ('GOOGLE REVIEW - NO REASON', null, 'google_review_no_reason'),
      ('TESTIMONIAL ASKED', null, 'testimonial'), ('TESTIMONIAL - NO REASON', null, 'testimonial_no_reason'),
      ('FEEDBACK FORM ASKED', null, 'feedback_form'), ('FEEDBACK FORM - NO REASON', null, 'feedback_form_no_reason'),
      ('THANK-YOU NOTE GIVEN', null, 'thank_you_note'), ('THANK-YOU NOTE - NO REASON', null, 'thank_you_note_no_reason'),
      ('REFERRALS ASKED', null, 'referrals_asked'), ('REFERRALS - NO REASON', null, 'referrals_no_reason')) as m(header, other, field_key)
  loop
    v_value := customer.answer_with_other(p ->> f.header, case when f.other is not null then p ->> f.other end);
    if v_value is not null then
      perform customer.set_source_field(v_client, f.field_key, v_value, 'walkin', v_at, v_changed, v_interaction);
    end if;
  end loop;
  v_value := concat_ws('; ', customer.sheet_value(p ->> 'NOT BOUGHT REASONS'), customer.sheet_value(p ->> 'NOT BOUGHT REASON (OTHER TEXT)'));
  if v_value <> '' then
    perform customer.set_source_field(v_client, 'not_bought_reasons', v_value, 'walkin', v_at, v_changed, v_interaction);
  end if;
  for f in select * from (values ('DOB', 'dob'), ('ANNIVERSARY', 'anniversary')) as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    if v_value is not null then
      begin
        perform customer.set_source_field(v_client, f.field_key, v_value, 'walkin', v_at, v_changed, v_interaction);
      exception when invalid_datetime_format or datetime_field_overflow then
        -- Not a real date (31/02/1990): kept as written, under its own key.
        perform customer.set_source_field(v_client, f.field_key || '_as_written', v_value, 'walkin', v_at, v_changed, v_interaction);
      end;
    end if;
  end loop;

  -- 3.4 Companions: the customer's family ---------------------------------------------
  for i in 1..10 loop
    v_name := customer.sheet_value(p ->> format('COMPANION %s NAME', i));
    v_phone := customer.sheet_value(p ->> format('COMPANION %s MOBILE', i));
    continue when v_name is null and customer.normalize_phone(v_phone) is null;
    continue when upper(coalesce(v_name, '')) like 'COMPANION%';
    if customer.normalize_phone(v_phone) is not null then
      v_other := customer.find_or_create_client(v_tenant, v_phone, v_name, 'walkin', v_at, '{}', null, null, v_row.id);
      continue when v_other = v_client;
      perform customer.join_household(v_other, v_household);
    else
      v_other := customer.create_client_without_phone(v_tenant, v_household, v_name, 'walkin', v_at);
      if v_phone is not null then perform customer.add_identifier(v_other, 'unverified_phone', v_phone, 'walkin', v_at); end if;
    end if;
    v_value := customer.sheet_value(p ->> format('COMPANION %s RELATION', i));
    if v_value is not null then
      perform customer.set_source_field(v_other, 'family_relation', v_value, 'walkin', v_at, v_changed, v_interaction);
    end if;
  end loop;

  -- 3.5 Who referred this customer, and whom this customer referred -------------------
  if customer.normalize_phone(p ->> 'REFERENCE PHONE') is not null then
    v_other := customer.find_or_create_client(v_tenant, p ->> 'REFERENCE PHONE', customer.sheet_value(p ->> 'REFERENCE NAME'), 'walkin', v_at, '{}', null, null, v_row.id);
    perform customer.set_referrer(v_client, v_other);
  elsif customer.sheet_value(p ->> 'REFERENCE NAME') is not null then
    perform customer.set_source_field(v_client, 'referred_by_name', p ->> 'REFERENCE NAME', 'walkin', v_at, v_changed, v_interaction);
  end if;

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client, interaction_id = v_interaction,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  -- Referral rows sent with this form and imported before it (after this row is applied, so it can be found).
  for r in select x.client_id, x.payload ->> 'REFERENCE GIVEN BY CLIENT NAME' as giver from customer.ingest_rows x
            where x.tenant_id = v_tenant and x.source = 'referral' and x.status = 'applied' and x.client_id is not null
              and customer.parse_sheet_timestamp(x.payload ->> 'TIMESTAMP') = v_stamp loop
    if customer.referral_giver(v_tenant, v_stamp, r.giver) = v_client then
      perform customer.set_referrer(r.client_id, v_client);
    end if;
  end loop;
  return v_interaction;
end $$;

-- ---------------------------------------------------------------------------
-- 4. One family row
-- ---------------------------------------------------------------------------
create function customer.apply_walkin_family_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_changed timestamptz; v_at timestamptz;
  v_client uuid; v_main boolean; v_code text; v_family text; v_name text; v_target uuid; v_value text; f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.source <> 'walkin_family' then raise exception 'Family row not found' using errcode = '22023'; end if;
  v_tenant := v_row.tenant_id;
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';
  if upper(coalesce(p ->> 'CLIENT ID', '')) = 'CLIENT ID' then raise exception 'Header row inside the data' using errcode = '22023'; end if;

  v_at := coalesce(customer.parse_sheet_timestamp(p ->> 'TIMESTAMP'), v_row.received_at);
  v_code := upper(customer.sheet_value(p ->> 'CLIENT ID'));
  v_family := upper(customer.sheet_value(p ->> 'FAMILY ID'));
  v_name := customer.sheet_value(p ->> 'FAMILY');
  v_main := upper(coalesce(p ->> 'RELATION', '')) = 'MAIN CLIENT' or v_code = upper(customer.sheet_value(p ->> 'MAIN CLIENT ID'));

  if customer.normalize_phone(p ->> 'NUMBER') is not null then
    -- One phone is one customer.
    v_client := customer.find_or_create_client(v_tenant, p ->> 'NUMBER', v_name, 'walkin_family', v_at, '{}', null, null, v_row.id);
  else
    -- The customer the old sheet knew by this CLIENT ID.
    if v_code is not null then
      select coalesce(c.merged_into_client_id, c.id) into v_client from customer.client_identifiers i join customer.clients c on c.id = i.client_id
       where i.tenant_id = v_tenant and i.id_type = 'sheet_client_id' and i.value = v_code
       order by i.first_seen_at, i.id limit 1;
    end if;
    if v_client is null and not v_main and v_family is not null then
      select cl.household_id into v_target from customer.client_identifiers i join customer.clients cl on cl.id = i.client_id
       where i.tenant_id = v_tenant and i.id_type = 'sheet_family_id' and i.value = v_family order by i.first_seen_at limit 1;
      if v_target is not null and v_name is not null then
        v_client := customer.create_client_without_phone(v_tenant, v_target, v_name, 'walkin_family', v_at);
      end if;
    end if;
    if v_client is null then
      v_client := customer.resolve_client(v_tenant, p ->> 'NUMBER', v_name, 'walkin_family', v_at, null, null,
        'walkin_family:' || coalesce(v_code, v_row.row_key), v_row.id);
    else
      perform customer.add_client_name(v_client, v_name, 'walkin_family', v_at);
    end if;
  end if;

  perform customer.add_identifier(v_client, 'sheet_client_id', v_code, 'walkin_family', v_at);
  v_target := customer.link_sheet_family(v_client, v_family);
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';
  if v_main then
    update customer.households h set main_client_id = v_client
     where h.id = (select household_id from customer.clients where id = v_client) and h.main_client_id is distinct from v_client;
  elsif customer.sheet_value(p ->> 'RELATION') is not null then
    perform customer.set_source_field(v_client, 'family_relation', p ->> 'RELATION', 'walkin_family', v_at, v_changed, null);
  end if;
  for f in select * from (values ('MARKETING MESSAGE', 'marketing_message'), ('COMMUNICATION PREFERENCE', 'communication_preference')) as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    if v_value is not null then
      perform customer.set_source_field(v_client, f.field_key, v_value, 'walkin_family', v_at, v_changed, null);
    end if;
  end loop;

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client, interaction_id = null,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. One referral
-- ---------------------------------------------------------------------------
create function customer.apply_referral_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_at timestamptz; v_client uuid; v_giver uuid;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.source <> 'referral' then raise exception 'Referral row not found' using errcode = '22023'; end if;
  v_tenant := v_row.tenant_id;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';
  if upper(coalesce(p ->> 'REFERRAL NAME', '')) = 'REFERRAL NAME' then raise exception 'Header row inside the data' using errcode = '22023'; end if;

  v_at := customer.parse_sheet_timestamp(p ->> 'TIMESTAMP');
  v_client := customer.resolve_client(v_tenant, p ->> 'REFERRAL NUMBER', customer.sheet_value(p ->> 'REFERRAL NAME'), 'referral',
    coalesce(v_at, v_row.received_at), null, null, 'referral:' || v_row.row_key, v_row.id);
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';

  v_giver := customer.referral_giver(v_tenant, v_at, p ->> 'REFERENCE GIVEN BY CLIENT NAME');
  if v_giver is not null then
    perform customer.set_referrer(v_client, v_giver);
  elsif customer.sheet_value(p ->> 'REFERENCE GIVEN BY CLIENT NAME') is not null then
    perform customer.set_source_field(v_client, 'referred_by_name', p ->> 'REFERENCE GIVEN BY CLIENT NAME', 'referral', coalesce(v_at, v_row.received_at), null, null);
  end if;

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client, interaction_id = null,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Buyer, from the timeline
-- ---------------------------------------------------------------------------
create or replace function customer.refresh_client_stats(p_client_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s record; f record;
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
         segment = case when s.last_purchase is not null then 'buyer'
                        when c.segment = 'buyer' then 'lead'
                        else c.segment end
   where c.id = p_client_id;
end $$;

-- ---------------------------------------------------------------------------
-- 7. One apply contract for every importer
-- ---------------------------------------------------------------------------
create or replace function public.customer_ingest_apply(p_source text, p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := customer.ingest_tenant();
  v_importer text;
  r record; v_applied integer := 0; v_rejected integer := 0; v_msg text; v_young boolean; v_done uuid[] := '{}';
begin
  select importer into v_importer from customer.source_tables where source = p_source;
  if v_importer is null then
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
      case v_importer
        when 'runo' then perform customer.apply_runo_row(r.id);
        when 'enquiry_fms' then perform customer.apply_enquiry_row(r.id);
        when 'walkin' then perform customer.apply_walkin_row(r.id);
        when 'walkin_family' then perform customer.apply_walkin_family_row(r.id);
        when 'referral' then perform customer.apply_referral_row(r.id);
      end case;
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

revoke all on all tables in schema customer from public, anon, authenticated;
grant all on all tables in schema customer to service_role;
revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;

-- Customers already imported: buyer and purchase dates from their timeline.
-- Only those whose timeline says they bought, a few hundred at most today.
do $buyers$
begin
  perform customer.refresh_client_stats(c.client_id) from (
    select distinct client_id from customer.interactions
     where archived_at is null and (purpose = 'purchase' or lower(coalesce(outcome, '')) in ('visited - bought', 'video call - bought'))) c;
end $buyers$;
