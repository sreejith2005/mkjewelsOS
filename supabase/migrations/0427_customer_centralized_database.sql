-- 0427: customer master database, part 14 - "MK CENTRALIZED CLIENT DATABASE",
-- tab MASTER DATABASE (live; headers on row 3).
--
-- Owner, 2026-11-18: the most important sheet. It already merges every sheet
-- (walk-ins, exhibitions, Instagram, Excel lists, the billing software ...).
-- Every column is kept; new facts about an existing customer are added to
-- their profile; it ranks high; and what a fact shows as its source is the
-- real source named in the sheet (FIRST INTERACTION SOURCE), not this sheet.
--
-- Facts from the sheet (read-only probe, 2026-11-18): 58,863 rows, CONTACT
-- NUMBER on every row and unique. FIRST INTERACTION SOURCE on 37,504 rows (32
-- values: EXCEL, EXHIBITION, WALK-IN, Customer Database, INSTAGRAM, REFERENCE,
-- GUPSHUP, ...). BUYER / NON BUYER on 30,439. Purchase and other dates are
-- written 14-Mar-2025.
--
-- A row becomes:
--   * the customer (CONTACT NUMBER; else a customer of their own); CLIENT ID
--     and FAMILY ID as old-sheet references, FAMILY ID putting families
--     together;
--   * FIRST PURCHASE DATE and RECENT PURCHASE DATE as purchases on the
--     timeline (one when they are the same day): with BUYER, these make the
--     person a client;
--   * every other column as an answer, dated LAST INTERACTION DATE (else the
--     recent purchase, else when read).
-- Each answer and contact of this sheet carries its real source (origin) as
-- written in FIRST INTERACTION SOURCE. customer.origins lists every real
-- source seen, with the sheet it corresponds to where there is one.
--
-- Priority: rank 4, with the store walk-in, above calls, enquiries and every
-- old list; only the billing software (5) ranks above it. Between this sheet
-- and a walk-in, the later answer wins.

-- ---------------------------------------------------------------------------
-- 1. Real sources
-- ---------------------------------------------------------------------------
update customer.sources set source_rank = 4, label = 'Centralized client database' where source = 'master_sheet';

create table customer.origins (
  origin text primary key,
  label text not null,
  -- The sheet this origin is, when we import that sheet too.
  source text references customer.sources(source),
  first_seen_at timestamptz not null default now()
);
alter table customer.origins enable row level security;
create policy tenant_crm_read on customer.origins for select to authenticated
  using ((select public.current_profile_is_active()) and (select public.has_permission('crm.view')));
create policy module_accessible on customer.origins as restrictive for select to authenticated using (public.module_accessible('crm'));
revoke all on customer.origins from public, anon, authenticated;
grant all on customer.origins to service_role;

insert into customer.origins (origin, label, source) values
  ('WALK-IN', 'Walk-in', 'walkin'), ('In-Store', 'In-store', 'walkin'), ('Walking', 'Walk-in', 'walkin'),
  ('EXHIBITION', 'Exhibition', 'exhibition'), ('Exhibition', 'Exhibition', 'exhibition'),
  ('INSTAGRAM', 'Instagram', 'instagram_fms'), ('Instagram', 'Instagram', 'instagram_fms'),
  ('DOUBLE TICK', 'DoubleTick (WhatsApp)', 'doubletick_fms'), ('WEBSITE CHAT', 'Website chat', 'website_chat_fms'),
  ('REFERENCE', 'Reference', 'referral'), ('Reference', 'Reference', 'referral'),
  ('Zoho', 'Zoho CRM', 'zoho'), ('Customer Database', 'Customer database', 'customer_data'),
  ('Client Database', 'Client database', 'customer_data')
on conflict do nothing;

-- Answers and contacts say which real source they come from. The import sets
-- customer.current_origin for the row it applies.
alter table customer.client_field_values add column origin text default nullif(current_setting('customer.current_origin', true), '');
alter table customer.interactions add column origin text default nullif(current_setting('customer.current_origin', true), '');

-- ---------------------------------------------------------------------------
-- 2. The sheet
-- ---------------------------------------------------------------------------
alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling',
                      'order_fms', 'repair_fms', 'zoho', 'exhibition', 'exhibition_old', 'customer_data', 'master_sheet'));
insert into customer.source_tables (source, table_name, label, importer, one_time) values
  ('master_sheet', 'sheet_centralized_database', 'MK centralized client database', 'master_sheet', false);

create function customer.apply_master_sheet_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_changed timestamptz; v_at timestamptz; v_client uuid;
  v_origin text; v_first timestamptz; v_recent timestamptz; v_contact uuid; v_value text; v_date text; f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.source <> 'master_sheet' then raise exception 'Centralized database row not found' using errcode = '22023'; end if;
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

  v_client := customer.resolve_client(v_tenant, p ->> 'CONTACT NUMBER', customer.sheet_value(p ->> 'CLIENT NAME'), 'master_sheet',
    coalesce(v_first, v_at), null, null, 'master_sheet:' || v_row.row_key, v_row.id);
  perform customer.add_identifier(v_client, 'sheet_client_id', p ->> 'CLIENT ID', 'master_sheet', v_at);
  perform customer.link_sheet_family(v_client, p ->> 'FAMILY ID');
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';

  -- Purchases on the timeline, from the dates the sheet gives.
  for f in select * from (values ('first', v_first, 'FIRST PURCHASE DATE'), ('recent', v_recent, 'RECENT PURCHASE DATE')) as m(k, at, header) loop
    continue when f.at is null or (f.k = 'recent' and v_first is not null and (f.at at time zone 'Asia/Kolkata')::date = (v_first at time zone 'Asia/Kolkata')::date);
    v_contact := customer.record_interaction(v_client, jsonb_build_object(
      'occurred_at', f.at, 'channel', 'not_recorded', 'direction', 'not_recorded', 'purpose', 'purchase',
      'source', 'master_sheet', 'external_ref', v_row.row_key || ':' || f.k, 'source_row', v_row.id,
      'outcome', f.header, 'result', 'positive', 'successful', true, 'process_name', 'Centralized client database'));
    update customer.interactions set archived_at = null, archive_reason = null, origin = nullif(coalesce(v_origin, ''), '')
     where id = v_contact and (archived_at is not null or origin is distinct from v_origin);
  end loop;
  -- A purchase date that is gone from the row takes its purchase with it.
  delete from customer.interactions i
   where i.source = 'master_sheet' and i.source_row = v_row.id
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
      values (v_tenant, v_client, 'email', lower(v_value), 'master_sheet', v_at) on conflict do nothing;
      perform customer.set_source_field(v_client, 'email', lower(v_value), 'master_sheet', v_at, v_changed, null);
    else
      perform customer.set_source_field(v_client, f.field_key, v_value, 'master_sheet', v_at, v_changed, null);
    end if;
  end loop;
  for f in select * from (values ('DATE OF BIRTH', 'dob'), ('ANNIVERSARY', 'anniversary'), ('LAST INTERACTION DATE', 'last_interaction_date'))
           as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    continue when v_value is null;
    v_date := customer.as_iso_date(v_value, 'dmy');
    if v_date is not null then
      perform customer.set_source_field(v_client, f.field_key, v_date, 'master_sheet', v_at, v_changed, null);
    else
      perform customer.set_source_field(v_client, f.field_key || '_as_written', v_value, 'master_sheet', v_at, v_changed, null);
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

do $patch$
declare
  body text; found integer; f regprocedure := 'public.customer_ingest_apply(text,integer)'::regprocedure;
  old_text constant text := E'        when ''customer_data'' then perform customer.apply_customer_data_row(r.id);\n';
  new_text constant text := E'        when ''customer_data'' then perform customer.apply_customer_data_row(r.id);\n        when ''master_sheet'' then perform customer.apply_master_sheet_row(r.id);\n';
begin
  body := replace(pg_get_functiondef(f), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then raise exception '0427: expected 1 match in customer_ingest_apply, found %', found; end if;
  execute replace(body, old_text, new_text);
end $patch$;

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function customer.delete_sheet(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;
