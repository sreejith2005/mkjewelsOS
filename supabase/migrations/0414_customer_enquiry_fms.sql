-- 0414: customer master database, part 7 - the enquiry FMS tabs.
--
-- Four tabs of "ALL FMS MASTER DATABASE": INSTAGRAM FMS, INSTAGRAM ADDS FMS,
-- DOUBLE TICK FMS and WEBSITE CHAT FMS. They share one layout.
--
-- Facts from the sheet (read-only probe, 2026-11-17):
--   * headers are on row 2; row 1 holds column numbers;
--   * one enquiry (REFERENCE NUMBER) has one row per FMS stage:
--     2. INTRODUCTION CALL, 3. PROPOSAL PRODUCT DEMONSTRATION, 4. NEGOTIATION,
--     5. CLOSER. COMBO (reference + stage) is unique per row and is the row key;
--   * a stage row is done when ACTUAL TIME is filled. Repeated follow-ups of a
--     stage overwrite that stage's row (FOLLOW UP COUNT goes up).
--
--   customer.enquiries       one per REFERENCE NUMBER per tab (MKE-)
--   customer.enquiry_steps   one per sheet row: the stage, its plan, result and remark
--
-- On the customer's timeline an enquiry shows as:
--   * one inbound contact when the message came in (DM RECEIVED DATE /
--     Timestamp), with the product asked about;
--   * one contact per completed stage 2-4, with its STATUS, REMARK and DOER.
--     Stage 5 (CLOSER) is the team closing the enquiry, not a contact with the
--     customer: it closes the enquiry and is kept as a step.
--
-- A row without a usable phone is matched on the Instagram ID, or on the
-- enquiry's other rows. A row with neither is kept, rejected with its reason.
--
-- Also:
--   * customer.source_tables.scheduled: the 5-minute job reads only sheets
--     switched on here, so a new sheet is tested by hand first;
--   * sheet dates written as day numbers (46012.5) are read;
--   * remove, restore, merge and purge cover the new tables.

-- ---------------------------------------------------------------------------
-- 1. Which sheets, and the scheduler switch
-- ---------------------------------------------------------------------------
alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check check (importer in ('runo', 'enquiry_fms'));
alter table customer.source_tables add column scheduled boolean not null default false;
update customer.source_tables set scheduled = true where source = 'runo';

insert into customer.source_tables (source, table_name, label, importer, one_time) values
  ('instagram_fms', 'sheet_instagram_fms', 'Instagram FMS', 'enquiry_fms', false),
  ('instagram_ads_fms', 'sheet_instagram_ads_fms', 'Instagram ads FMS', 'enquiry_fms', false),
  ('doubletick_fms', 'sheet_doubletick_fms', 'DoubleTick FMS', 'enquiry_fms', false),
  ('website_chat_fms', 'sheet_website_chat_fms', 'Website chat FMS', 'enquiry_fms', false);

-- ---------------------------------------------------------------------------
-- 2. Dates: also a sheet day number
-- ---------------------------------------------------------------------------
-- Same as 0407, plus a value Google returns as a day count from 30/12/1899
-- (46012.53 = 21/12/2025 12:43), which happens when a cell lost its date format.
create or replace function customer.parse_sheet_timestamp(p_value text)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_value, '')); m text[]; d date; hh int := 0; mi int := 0; ss int := 0; pm text;
begin
  if v = '' then return null; end if;
  if v ~ '^\d{5}(\.\d+)?$' then
    if v::numeric not between 36526 and 73051 then return null; end if;  -- 2000 to 2099
    return (timestamp '1899-12-30' + make_interval(secs => round(v::numeric * 86400)::double precision)) at time zone 'Asia/Kolkata';
  end if;
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

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------
create sequence customer.enquiry_code_seq start 100001;

create table customer.enquiries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  enquiry_code text not null default 'MKE-' || nextval('customer.enquiry_code_seq'),
  client_id uuid not null references customer.clients(id),
  source text not null references customer.sources(source),
  reference_number text not null,
  channel text not null,
  received_at timestamptz not null,
  lead_source text,
  product_number text,
  pricing text,
  image_url text,
  instagram_id text,
  assigned_by_user_id uuid references public.user_profiles(id),
  assigned_by_name text,
  -- Worked out from the steps by customer.refresh_enquiry.
  current_stage text,
  current_status text,
  outcome text not null default 'open' check (outcome in ('open', 'won', 'lost', 'closed')),
  closed_at timestamptz,
  last_activity_at timestamptz,
  next_stage text,
  next_due_at timestamptz,
  next_doer_user_id uuid references public.user_profiles(id),
  next_doer_name text,
  step_count integer not null default 0,
  opened_interaction_id uuid references customer.interactions(id) on delete set null,
  archived_at timestamptz,
  archive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, enquiry_code),
  unique (tenant_id, source, reference_number)
);
create index enquiries_client_idx on customer.enquiries (client_id);
create index enquiries_open_idx on customer.enquiries (tenant_id, next_due_at) where outcome = 'open' and archived_at is null;
create trigger enquiries_touch before update on customer.enquiries
  for each row execute function customer.touch_updated_at();

create table customer.enquiry_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  enquiry_id uuid not null references customer.enquiries(id) on delete cascade,
  -- The sheet row this step is. One row is one step.
  source_row uuid not null unique references customer.ingest_rows(id) on delete cascade,
  stage text,
  stage_no integer,
  planned_at timestamptz,
  done_at timestamptz,
  status text,
  remark text,
  previous_remark text,
  doer_user_id uuid references public.user_profiles(id),
  doer_name text,
  follow_up_count integer,
  interaction_id uuid references customer.interactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index enquiry_steps_enquiry_idx on customer.enquiry_steps (enquiry_id, stage_no);
create index enquiry_steps_interaction_idx on customer.enquiry_steps (interaction_id) where interaction_id is not null;
create trigger enquiry_steps_touch before update on customer.enquiry_steps
  for each row execute function customer.touch_updated_at();

-- The bare column from 0406 now points at the enquiry a contact belongs to.
alter table customer.interactions
  add constraint interactions_lead_fk foreign key (lead_id) references customer.enquiries(id) on delete set null;

do $rls$
declare t text;
begin
  foreach t in array array['enquiries', 'enquiry_steps'] loop
    execute format('alter table customer.%I enable row level security', t);
    execute format($p$create policy tenant_crm_read on customer.%I for select to authenticated
      using ((select public.current_profile_is_active()) and tenant_id = (select public.current_tenant_id())
        and (select public.has_permission('crm.view')))$p$, t);
    execute format($p$create policy module_accessible on customer.%I as restrictive for select to authenticated
      using (public.module_accessible('crm'))$p$, t);
  end loop;
end $rls$;

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------

-- An FMS STATUS -> how the contact went. Words not listed are kept as written
-- and read as neutral.
create function customer.enquiry_status_reading(p_status text, out result text, out successful boolean, out ends text)
language sql immutable set search_path = '' as $$
  select r.result, r.successful, r.ends
    from (select upper(btrim(coalesce(p_status, ''))) as s) x
    cross join lateral (select
      case
        when x.s in ('YES (INTERESTED)', 'INTERESTED FOLLOW-UP REQUIRED', 'CLIENT REQUESTED ANOTHER VIDEO CALL TO VIEW MORE PRODUCTS',
                     'YES, THE CLIENT BOUGHT THE PRODUCT', 'ORDER CLOSE') then 'positive'
        when x.s in ('NOT INTERESTED CLOSE THIS LEAD', 'NO', 'NO, THE CLIENT DID NOT BUY') then 'negative'
        when x.s in ('NOT REACHABLE', 'BUSY', 'CUSTOMER DECLINED') then 'not_connected'
        else 'neutral' end as result,
      x.s not in ('NOT REACHABLE', 'BUSY', 'CUSTOMER DECLINED') as successful,
      case
        when x.s in ('YES, THE CLIENT BOUGHT THE PRODUCT', 'ORDER CLOSE') then 'won'
        when x.s in ('NOT INTERESTED CLOSE THIS LEAD', 'NO, THE CLIENT DID NOT BUY') then 'lost' end as ends) r
$$;

-- A contact is taken off the timeline: it stops counting, what it created
-- waiting is cancelled, and the answers it gave are withdrawn.
create function customer.withdraw_interaction(p_interaction_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_client uuid; v_keys text[]; v_key text;
begin
  update customer.interactions set archived_at = now(), archive_reason = p_reason
   where id = p_interaction_id and archived_at is null
  returning client_id into v_client;
  if v_client is null then return; end if;
  update customer.follow_ups set status = 'cancelled' where origin_interaction_id = p_interaction_id and status = 'pending';
  update customer.appointments set status = 'cancelled' where origin_interaction_id = p_interaction_id and status = 'booked';
  with gone as (
    delete from customer.client_field_values where interaction_id = p_interaction_id returning field_key
  ) select array_agg(distinct field_key) into v_keys from gone;
  if v_keys is not null then
    foreach v_key in array v_keys loop
      if not exists (select 1 from customer.client_field_values where client_id = v_client and field_key = v_key)
         and exists (select 1 from customer.profile_fields where field_key = v_key) then
        execute format('update customer.clients set %I = null where id = $1', v_key) using v_client;
      else
        perform customer.recompute_profile_field(v_client, v_key);
      end if;
    end loop;
  end if;
  perform customer.refresh_client_stats(v_client);
end $$;

-- An enquiry's state, worked out again from its steps. An enquiry with no
-- steps left (all its rows gone from the sheet) is archived with its opening
-- contact; it comes back when a row does.
create function customer.refresh_enquiry(p_enquiry_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e customer.enquiries; cur record; nxt record; v_outcome text; v_closed timestamptz; n integer;
begin
  select * into e from customer.enquiries where id = p_enquiry_id for update;
  if e.id is null then return null; end if;
  select count(*) into n from customer.enquiry_steps where enquiry_id = e.id;

  if n = 0 then
    update customer.enquiries set archived_at = coalesce(archived_at, now()), archive_reason = 'removed_from_sheet', step_count = 0
     where id = e.id;
    if e.opened_interaction_id is not null then
      perform customer.withdraw_interaction(e.opened_interaction_id, 'removed_from_sheet');
    end if;
    return e.id;
  end if;

  -- The step furthest along; among equals the latest.
  select s.stage, s.status into cur from customer.enquiry_steps s
   where s.enquiry_id = e.id
   order by s.stage_no desc nulls last, coalesce(s.done_at, s.planned_at) desc nulls last, s.created_at desc limit 1;
  -- The step waiting to be done.
  select s.stage, s.planned_at, s.doer_user_id, s.doer_name into nxt from customer.enquiry_steps s
   where s.enquiry_id = e.id and s.done_at is null
   order by s.stage_no nulls last, s.planned_at limit 1;

  select case
           when bool_or(r.ends = 'won') then 'won'
           when bool_or(r.ends = 'lost') then 'lost'
           when bool_or(s.stage_no = 5 and s.done_at is not null) then 'closed'
           else 'open' end,
         coalesce(max(s.done_at) filter (where s.stage_no = 5), max(s.done_at) filter (where r.ends is not null))
    into v_outcome, v_closed
    from customer.enquiry_steps s cross join lateral customer.enquiry_status_reading(s.status) r
   where s.enquiry_id = e.id and (s.done_at is not null or r.ends is not null);

  update customer.enquiries set
    current_stage = cur.stage, current_status = cur.status,
    outcome = coalesce(v_outcome, 'open'), closed_at = case when coalesce(v_outcome, 'open') = 'open' then null else v_closed end,
    last_activity_at = (select max(done_at) from customer.enquiry_steps where enquiry_id = e.id),
    next_stage = nxt.stage, next_due_at = nxt.planned_at, next_doer_user_id = nxt.doer_user_id, next_doer_name = nxt.doer_name,
    step_count = n, archived_at = null, archive_reason = null
  where id = e.id;

  -- Back from the sheet: the opening contact counts again.
  if e.archived_at is not null and e.opened_interaction_id is not null then
    update customer.interactions set archived_at = null, archive_reason = null
     where id = e.opened_interaction_id and archived_at is not null and archive_reason = 'removed_from_sheet';
    perform customer.refresh_client_stats(e.client_id);
  end if;
  return e.id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. One enquiry FMS row
-- ---------------------------------------------------------------------------
create function customer.apply_enquiry_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows;
  p jsonb;
  v_tenant uuid;
  v_channel text;
  v_ref text;
  v_stamp timestamptz;
  v_dm timestamptz;
  v_received timestamptz;
  v_changed timestamptz;
  v_phone text;
  v_insta text;
  v_name text;
  v_client uuid;
  v_household uuid;
  v_enquiry customer.enquiries;
  v_opened uuid;
  v_stage text;
  v_stage_no integer;
  v_planned timestamptz;
  v_done timestamptz;
  v_status text;
  v_reading record;
  v_staff uuid;
  v_step_interaction uuid;
  v_item text;
  f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or not exists (select 1 from customer.source_tables where source = v_row.source and importer = 'enquiry_fms') then
    raise exception 'Enquiry row not found' using errcode = '22023';
  end if;
  v_tenant := v_row.tenant_id;
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';

  v_channel := case v_row.source when 'instagram_fms' then 'instagram' when 'instagram_ads_fms' then 'instagram_ads'
                                 when 'doubletick_fms' then 'whatsapp' when 'website_chat_fms' then 'website' end;
  v_ref := p ->> 'REFERENCE NUMBER';
  if v_ref is null then raise exception 'REFERENCE NUMBER is missing' using errcode = '22023'; end if;

  -- When the message came in: the DM date, with the form's time when the form
  -- was filled the same day.
  v_stamp := customer.parse_sheet_timestamp(p ->> 'Timestamp');
  v_dm := customer.parse_sheet_timestamp(p ->> 'DM RECEIVED DATE');
  v_received := case
    when v_dm is null then v_stamp
    when v_stamp is not null and (v_stamp at time zone 'Asia/Kolkata')::date = (v_dm at time zone 'Asia/Kolkata')::date then v_stamp
    else v_dm end;
  if v_received is null then raise exception 'Timestamp and DM RECEIVED DATE are missing or unreadable' using errcode = '22007'; end if;

  -- 5.1 Who -------------------------------------------------------------------
  v_phone := customer.normalize_phone(p ->> 'CUSTOMER CONTACT NUMBER');
  v_insta := nullif(lower(regexp_replace(coalesce(p ->> 'INSTAGRAM ID', ''), '^@+|\s+', '', 'g')), '');
  v_name := p ->> 'CUSTOMER NAME';
  select * into v_enquiry from customer.enquiries where tenant_id = v_tenant and source = v_row.source and reference_number = v_ref;

  if v_phone is not null then
    v_client := customer.find_or_create_client(v_tenant, v_phone, v_name, v_row.source, v_received, '{}', null, null, v_row.id);
  elsif v_enquiry.id is not null then
    v_client := v_enquiry.client_id;
    perform customer.add_client_name(v_client, v_name, v_row.source, v_received);
  elsif v_insta is not null then
    select i.client_id into v_client from customer.client_identifiers i join customer.clients c on c.id = i.client_id
     where i.tenant_id = v_tenant and i.id_type = 'instagram' and i.value = v_insta and c.merged_into_client_id is null
     order by i.first_seen_at limit 1;
    if v_client is null then
      insert into customer.households (tenant_id) values (v_tenant) returning id into v_household;
      v_client := customer.create_client_without_phone(v_tenant, v_household, coalesce(v_name, '@' || v_insta), v_row.source, v_received);
      update customer.households set main_client_id = v_client where id = v_household;
    else
      perform customer.add_client_name(v_client, v_name, v_row.source, v_received);
    end if;
  elsif p ? 'CUSTOMER CONTACT NUMBER' then
    raise exception 'Not a valid phone number' using errcode = '22023';
  else
    raise exception 'No phone number or Instagram ID' using errcode = '22023';
  end if;

  if v_insta is not null then
    insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
    values (v_tenant, v_client, 'instagram', v_insta, v_row.source, v_received) on conflict do nothing;
  end if;
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';

  -- 5.2 The enquiry and the message that opened it ------------------------------
  insert into customer.enquiries (tenant_id, client_id, source, reference_number, channel, received_at, lead_source,
    product_number, pricing, image_url, instagram_id, assigned_by_user_id, assigned_by_name)
  values (v_tenant, v_client, v_row.source, v_ref, v_channel, v_received, p ->> 'SOURCE OF THE LEAD',
    p ->> 'PRODUCT NUMBER', p ->> 'PRICING', coalesce(p ->> 'IMAGE OF THE  PRODUCT', p ->> 'IMAGE OF THE PRODUCT', p ->> 'IMAGE'),
    p ->> 'INSTAGRAM ID', customer.resolve_staff(v_tenant, p ->> 'ASSIGNED BY'), p ->> 'ASSIGNED BY')
  on conflict (tenant_id, source, reference_number) do update set
    client_id = case when v_phone is not null then excluded.client_id else customer.enquiries.client_id end,
    received_at = least(customer.enquiries.received_at, excluded.received_at),
    lead_source = coalesce(excluded.lead_source, customer.enquiries.lead_source),
    product_number = coalesce(excluded.product_number, customer.enquiries.product_number),
    pricing = coalesce(excluded.pricing, customer.enquiries.pricing),
    image_url = coalesce(excluded.image_url, customer.enquiries.image_url),
    instagram_id = coalesce(excluded.instagram_id, customer.enquiries.instagram_id),
    assigned_by_user_id = coalesce(excluded.assigned_by_user_id, customer.enquiries.assigned_by_user_id),
    assigned_by_name = coalesce(excluded.assigned_by_name, customer.enquiries.assigned_by_name)
  returning * into v_enquiry;
  v_client := v_enquiry.client_id;

  v_opened := customer.record_interaction(v_client, jsonb_strip_nulls(jsonb_build_object(
    'occurred_at', v_enquiry.received_at, 'channel', v_channel, 'direction', 'inbound', 'purpose', 'enquiry',
    'source', v_row.source, 'external_ref', 'enquiry:' || v_ref, 'outcome', 'Enquiry received',
    'result', 'neutral', 'successful', true, 'lead_id', v_enquiry.id,
    'staff_user_id', v_enquiry.assigned_by_user_id, 'staff_name', v_enquiry.assigned_by_name,
    'notes', nullif(concat_ws(' · ',
      'Lead source: ' || v_enquiry.lead_source, 'Product: ' || v_enquiry.product_number, 'Price: ' || v_enquiry.pricing), ''))));
  update customer.interactions set archived_at = null, archive_reason = null
   where id = v_opened and archived_at is not null and archive_reason = 'removed_from_sheet';
  update customer.enquiries set opened_interaction_id = v_opened where id = v_enquiry.id and opened_interaction_id is distinct from v_opened;

  -- The product asked about: a code (letter + digits) or a description.
  delete from customer.interaction_products where interaction_id = v_opened;
  for v_item in select btrim(x) from regexp_split_to_table(coalesce(v_enquiry.product_number, ''), '\s*[,;\n]\s*') x where btrim(x) <> '' loop
    if v_item ~ '^[A-Za-z]{0,4}[- ]?\d{3,}$' then
      perform customer.add_interaction_product(v_opened, upper(v_item), null, 'interested');
    else
      perform customer.add_interaction_product(v_opened, null, v_item, 'interested');
    end if;
  end loop;

  -- Profile answers. These sheets rank lowest, so a walk-in or a call wins.
  for f in select * from (values ('CITY', 'city'), ('STATE', 'state'), ('PIN CODE', 'pincode'), ('ADDRESS', 'address')) as m(header, field_key) loop
    if p ? f.header and upper(p ->> f.header) not in ('NA', 'N/A', '-', '.', 'NIL') then
      perform customer.set_source_field(v_client, f.field_key, p ->> f.header, v_row.source, v_received, v_changed, v_opened);
    end if;
  end loop;

  -- 5.3 This row's stage ------------------------------------------------------------
  v_stage := p ->> 'WORK STAGE';
  v_stage_no := nullif(substring(coalesce(v_stage, '') from '^\s*(\d+)'), '')::integer;
  v_planned := coalesce(customer.parse_sheet_timestamp(p ->> 'NEW PLANNED'), customer.parse_sheet_timestamp(p ->> 'PLANNED'));
  v_done := customer.parse_sheet_timestamp(p ->> 'ACTUAL TIME');
  v_status := p ->> 'STATUS';
  select * into v_reading from customer.enquiry_status_reading(v_status);
  v_staff := customer.resolve_staff(v_tenant, p ->> 'DOER');

  -- A completed stage before the closer is a contact with the customer.
  -- Assumption to confirm with the owner: stage 3 (product demonstration) is a
  -- video call; the other stages are phone calls.
  if v_done is not null and coalesce(v_stage_no, 0) <> 5 then
    v_step_interaction := customer.record_interaction(v_client, jsonb_strip_nulls(jsonb_build_object(
      'occurred_at', v_done, 'channel', case when v_stage_no = 3 then 'video_call' else 'call' end,
      'direction', 'outbound', 'purpose', case when v_reading.ends = 'won' then 'purchase' else 'enquiry' end,
      'source', v_row.source, 'external_ref', v_row.row_key, 'source_row', v_row.id,
      'outcome', v_status, 'result', v_reading.result, 'successful', v_reading.successful,
      'non_contact_reason', case when not v_reading.successful then v_status end,
      'staff_user_id', v_staff, 'staff_name', p ->> 'DOER',
      'assigned_by_user_id', v_enquiry.assigned_by_user_id,
      'fms_stage', v_stage, 'process_name', upper(coalesce(p ->> 'FMS', v_row.source)),
      'lead_id', v_enquiry.id, 'parent_interaction_id', v_opened, 'notes', p ->> 'REMARK')));
    update customer.interactions set archived_at = null, archive_reason = null, assigned_by_name = v_enquiry.assigned_by_name
     where id = v_step_interaction and (archived_at is not null or assigned_by_name is distinct from v_enquiry.assigned_by_name);
    if v_reading.successful then
      perform customer.close_follow_ups(v_client, v_step_interaction);
    end if;
    if v_reading.ends = 'won' then
      perform customer.add_interaction_product(v_step_interaction, upper(x), null, 'bought')
         from regexp_split_to_table(coalesce(v_enquiry.product_number, ''), '\s*[,;\n]\s*') x
        where btrim(x) ~ '^[A-Za-z]{0,4}[- ]?\d{3,}$';
    end if;
  else
    -- The row was a contact before and is not one now (its ACTUAL TIME was cleared).
    select id into v_step_interaction from customer.interactions
     where tenant_id = v_tenant and source = v_row.source and external_ref = v_row.row_key and archived_at is null;
    if v_step_interaction is not null then
      perform customer.withdraw_interaction(v_step_interaction, 'step_not_done');
    end if;
    v_step_interaction := null;
  end if;

  insert into customer.enquiry_steps (tenant_id, enquiry_id, source_row, stage, stage_no, planned_at, done_at, status, remark,
    previous_remark, doer_user_id, doer_name, follow_up_count, interaction_id)
  values (v_tenant, v_enquiry.id, v_row.id, v_stage, v_stage_no, v_planned, v_done, v_status, p ->> 'REMARK',
    p ->> 'PREVIOUS REMARK', v_staff, p ->> 'DOER', nullif(regexp_replace(coalesce(p ->> 'FOLLOW UP COUNT', ''), '\D', '', 'g'), '')::integer,
    v_step_interaction)
  on conflict (source_row) do update set
    enquiry_id = excluded.enquiry_id, stage = excluded.stage, stage_no = excluded.stage_no, planned_at = excluded.planned_at,
    done_at = excluded.done_at, status = excluded.status, remark = excluded.remark, previous_remark = excluded.previous_remark,
    doer_user_id = excluded.doer_user_id, doer_name = excluded.doer_name, follow_up_count = excluded.follow_up_count,
    interaction_id = excluded.interaction_id;
  -- A row whose REFERENCE NUMBER was corrected leaves its old enquiry.
  perform customer.refresh_enquiry(e.id) from customer.enquiries e
   where e.tenant_id = v_tenant and e.source = v_row.source and e.id <> v_enquiry.id
     and e.archived_at is null and not exists (select 1 from customer.enquiry_steps s where s.enquiry_id = e.id);
  perform customer.refresh_enquiry(v_enquiry.id);

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client,
         interaction_id = coalesce(v_step_interaction, v_opened), applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return coalesce(v_step_interaction, v_opened);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Remove, merge and purge cover the new tables
-- ---------------------------------------------------------------------------
create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0414: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

do $patches$
begin
  -- A row gone from the sheet takes its step with it; the enquiry is worked
  -- out again before the client is checked for anything left.
  perform customer._patch('customer.remove_source_row(uuid)'::regprocedure,
    'declare v_row customer.ingest_rows; v_key text; v_keys text[];',
    'declare v_row customer.ingest_rows; v_key text; v_keys text[]; v_enquiries uuid[]; v_enquiry uuid;', 1);
  perform customer._patch('customer.remove_source_row(uuid)'::regprocedure,
    E'  if v_row.client_id is not null then\n    perform customer.refresh_client_stats(v_row.client_id);',
    E'  with gone as (delete from customer.enquiry_steps where source_row = v_row.id returning enquiry_id)\n'
    || E'  select array_agg(distinct enquiry_id) into v_enquiries from gone;\n'
    || E'  if v_enquiries is not null then\n'
    || E'    foreach v_enquiry in array v_enquiries loop perform customer.refresh_enquiry(v_enquiry); end loop;\n'
    || E'  end if;\n\n'
    || E'  if v_row.client_id is not null then\n    perform customer.refresh_client_stats(v_row.client_id);', 1);
  perform customer._patch('customer.remove_source_row(uuid)'::regprocedure,
    'and not exists (select 1 from customer.ingest_rows r where r.client_id = c.id and r.status <> ''removed'');',
    E'and not exists (select 1 from customer.ingest_rows r where r.client_id = c.id and r.status <> ''removed'')\n'
    || E'       and not exists (select 1 from customer.enquiries e where e.client_id = c.id and e.archived_at is null);', 1);

  perform customer._patch('customer.merge_related(uuid,uuid)'::regprocedure,
    '  update customer.appointments set client_id = p_keep_client_id where client_id = p_remove_client_id;',
    E'  update customer.appointments set client_id = p_keep_client_id where client_id = p_remove_client_id;\n'
    || E'  update customer.enquiries set client_id = p_keep_client_id where client_id = p_remove_client_id;', 1);

  perform customer._patch('customer.purge_source(text)'::regprocedure,
    '  delete from customer.interactions where id = any (v_old);',
    E'  delete from customer.enquiries where source = p_source;\n  delete from customer.interactions where id = any (v_old);', 1);
end $patches$;
drop function customer._patch(regprocedure, text, text, integer);

revoke all on all tables in schema customer from public, anon, authenticated;
revoke all on all sequences in schema customer from public, anon, authenticated;
grant all on all tables in schema customer to service_role;
grant usage on all sequences in schema customer to service_role;
revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;

-- ---------------------------------------------------------------------------
-- 7. Contracts for the Edge Function
-- ---------------------------------------------------------------------------
create or replace function public.customer_ingest_state(p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := customer.ingest_tenant(); v customer.ingest_state;
begin
  insert into customer.ingest_state (tenant_id, source) values (v_tenant, p_source) on conflict do nothing;
  select * into v from customer.ingest_state where tenant_id = v_tenant and source = p_source;
  return jsonb_build_object('next_row', v.next_row, 'scan_row', v.scan_row, 'rows_received', v.rows_received,
    'completed', v.completed_at is not null, 'last_full_pass_at', v.last_full_pass_at,
    'scheduled', coalesce((select t.scheduled from customer.source_tables t where t.source = p_source), false),
    'pending', (select count(*) from customer.ingest_rows where tenant_id = v_tenant and source = p_source and status = 'pending'),
    'rejected', (select count(*) from customer.ingest_rows where tenant_id = v_tenant and source = p_source and status = 'rejected'));
end $$;

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
      if v_importer = 'runo' then perform customer.apply_runo_row(r.id);
      else perform customer.apply_enquiry_row(r.id);
      end if;
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
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_state(text) to service_role;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;
