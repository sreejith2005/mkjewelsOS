-- 0419: customer master database, part 9 - NOT BOUGHT FMS and REFERENCES
-- CALLING FMS (file "ALL FMS MASTER DATABASE", headers on row 2).
--
-- Facts from the sheet (read-only probe, 2026-11-17):
--   NOT BOUGHT FMS          336 rows. One row per follow-up stage of a walk-in
--                           that did not buy (NOT BOUGHT FOLLOWUP 1, 2, 3).
--                           REFERENCE NUMBER is the walk-in visit's reference
--                           number. COMBO is unique per row and is the key.
--   REFERENCES CALLING FMS  1,698 rows, one per person referred: the calling of
--                           the REFERRALS tab of the walk-in sheet. One stage,
--                           done on 661 rows. Key: TIMESTAMP + NUMBER OF THE
--                           REFERENCE + NAME OF THE REFERENCE, the same values
--                           as the REFERRALS tab's key.
--
-- What each row becomes:
--   * not bought: one follow-up case per REFERENCE NUMBER (customer.enquiries,
--     source not_bought_fms), one step per row, and for a completed step one
--     contact on the timeline linked to the store visit it follows. NEXT
--     FOLLOW UP DATE is a not-bought follow-up.
--   * reference call: the referred person (the same customer the REFERRALS tab
--     made, even without a valid phone) and, when the call was made (ACTUAL),
--     one contact. LOCATION and RELIGION of the reference are kept as written.
--
-- As with the enquiry tabs, how a call was made is not in the sheet, so a
-- contact's channel and direction are "not_recorded"; a STATUS is read only
-- where its own words say it, everything else is kept as written.

-- ---------------------------------------------------------------------------
-- 1. Sheets
-- ---------------------------------------------------------------------------
alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling'));
insert into customer.source_tables (source, table_name, label, importer, one_time) values
  ('not_bought_fms', 'sheet_not_bought_fms', 'Not bought FMS', 'not_bought_fms', false),
  ('references_calling_fms', 'sheet_references_calling_fms', 'References calling FMS', 'references_calling', false);

-- ---------------------------------------------------------------------------
-- 2. Reading a follow-up STATUS: only what its words say
-- ---------------------------------------------------------------------------
create function customer.follow_up_status_reading(p_status text, out result text, out successful boolean, out ends text)
language sql immutable set search_path = '' as $$
  select r.result, r.successful, r.ends
    from (select upper(btrim(coalesce(p_status, ''))) as s) x
    cross join lateral (select
      case
        when x.s in ('YES (CLIENT NEED FOLLOW-UP)', 'YES INTERESTED', 'YES (INTERESTED FOLLOW UP REQUIRED)') then 'positive'
        when x.s in ('NOT INTERESTED CLOSE THIS LEAD', 'NOT INTERESTED') then 'negative'
        when x.s in ('NO (CALL NOT CONNECTED)', 'RINGING / NOT ANSWERED', 'NOT REACHABLE', 'BUSY') then 'not_connected'
        else 'neutral' end as result,
      x.s not in ('NO (CALL NOT CONNECTED)', 'RINGING / NOT ANSWERED', 'NOT REACHABLE', 'BUSY') as successful,
      case when x.s = 'NOT INTERESTED CLOSE THIS LEAD' then 'lost' end as ends) r
$$;

-- ---------------------------------------------------------------------------
-- 3. One NOT BOUGHT FMS row
-- ---------------------------------------------------------------------------
create function customer.apply_not_bought_fms_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_changed timestamptz; v_ref text; v_at timestamptz;
  v_client uuid; v_visit customer.interactions; v_case customer.enquiries; v_stage text; v_stage_no integer;
  v_planned timestamptz; v_done timestamptz; v_status text; v_reading record; v_staff uuid; v_contact uuid;
  v_due timestamptz; v_value text; f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.source <> 'not_bought_fms' then raise exception 'Not-bought row not found' using errcode = '22023'; end if;
  v_tenant := v_row.tenant_id;
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';

  v_ref := coalesce(p ->> 'REFERENCE NUMBER', 'row:' || v_row.row_key);
  v_at := coalesce(customer.parse_sheet_timestamp(p ->> 'Timestamp'), v_row.received_at);
  -- The store visit this follow-up comes from.
  select * into v_visit from customer.interactions
   where tenant_id = v_tenant and source = 'walkin' and external_ref = p ->> 'REFERENCE NUMBER' and archived_at is null;

  if v_visit.id is not null and customer.normalize_phone(p ->> 'PHONE NUMBER OF THE CLIENT') is null
     and customer.normalize_phone(p ->> 'BILLING PHONE NUMBER') is null then
    v_client := v_visit.client_id;
  else
    v_client := customer.resolve_client(v_tenant, p ->> 'PHONE NUMBER OF THE CLIENT', p ->> 'NAME OF THE CLIENT', 'not_bought_fms', v_at,
      p ->> 'BILLING PHONE NUMBER', null, 'not_bought_fms:' || v_ref, v_row.id);
  end if;
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';

  insert into customer.enquiries (tenant_id, client_id, source, reference_number, channel, received_at, product_number,
    assigned_by_user_id, assigned_by_name)
  values (v_tenant, v_client, 'not_bought_fms', v_ref, 'walk_in', coalesce(v_visit.occurred_at, v_at), customer.sheet_value(p ->> 'TAG NUMBER'),
    customer.resolve_staff(v_tenant, customer.sheet_value(p ->> 'NAME OF THE CRM')), customer.sheet_value(p ->> 'NAME OF THE CRM'))
  on conflict (tenant_id, source, reference_number) do update set
    client_id = excluded.client_id, received_at = least(customer.enquiries.received_at, excluded.received_at),
    product_number = coalesce(excluded.product_number, customer.enquiries.product_number),
    assigned_by_user_id = coalesce(excluded.assigned_by_user_id, customer.enquiries.assigned_by_user_id),
    assigned_by_name = coalesce(excluded.assigned_by_name, customer.enquiries.assigned_by_name)
  returning * into v_case;

  v_stage := p ->> 'WORK STAGE';
  v_stage_no := nullif(substring(coalesce(v_stage, '') from '^\s*(\d+)'), '')::integer;
  v_planned := coalesce(customer.parse_sheet_timestamp(p ->> 'NEW PLANNED'), customer.parse_sheet_timestamp(p ->> 'PLANNED'));
  v_done := customer.parse_sheet_timestamp(p ->> 'ACTUAL');
  v_status := p ->> 'STATUS';
  select * into v_reading from customer.follow_up_status_reading(v_status);
  v_staff := customer.resolve_staff(v_tenant, p ->> 'CRM');

  if v_done is not null then
    v_contact := customer.record_interaction(v_client, jsonb_strip_nulls(jsonb_build_object(
      'occurred_at', v_done, 'channel', 'not_recorded', 'direction', 'not_recorded', 'purpose', 'not_bought',
      'source', 'not_bought_fms', 'external_ref', v_row.row_key, 'source_row', v_row.id,
      'outcome', v_status, 'result', v_reading.result, 'successful', v_reading.successful,
      'non_contact_reason', case when not v_reading.successful then v_status end,
      'staff_user_id', v_staff, 'staff_name', p ->> 'CRM', 'assigned_by_user_id', v_case.assigned_by_user_id,
      'branch_id', customer.resolve_branch(v_tenant, p ->> 'BRANCH'), 'store_name', p ->> 'BRANCH',
      'fms_stage', v_stage, 'process_name', 'NOT BOUGHT FMS', 'lead_id', v_case.id, 'parent_interaction_id', v_visit.id,
      'notes', p ->> 'REMARKS')));
    update customer.interactions set archived_at = null, archive_reason = null, assigned_by_name = v_case.assigned_by_name
     where id = v_contact and (archived_at is not null or assigned_by_name is distinct from v_case.assigned_by_name);
    if v_reading.successful then perform customer.close_follow_ups(v_client, v_contact); end if;
    v_due := customer.parse_sheet_timestamp(p ->> 'NEXT FOLLOW UP DATE');
    if v_due is not null then
      perform customer.create_follow_up(v_client, 'not_bought', v_due, v_contact, v_staff, v_status);
    end if;
  else
    select id into v_contact from customer.interactions
     where tenant_id = v_tenant and source = 'not_bought_fms' and external_ref = v_row.row_key and archived_at is null;
    if v_contact is not null then perform customer.withdraw_interaction(v_contact, 'step_not_done'); end if;
    v_contact := null;
  end if;

  insert into customer.enquiry_steps (tenant_id, enquiry_id, source_row, stage, stage_no, planned_at, done_at, status, remark,
    previous_remark, doer_user_id, doer_name, interaction_id)
  values (v_tenant, v_case.id, v_row.id, v_stage, v_stage_no, v_planned, v_done, v_status, p ->> 'REMARKS',
    p ->> 'REMARK', v_staff, p ->> 'CRM', v_contact)
  on conflict (source_row) do update set
    enquiry_id = excluded.enquiry_id, stage = excluded.stage, stage_no = excluded.stage_no, planned_at = excluded.planned_at,
    done_at = excluded.done_at, status = excluded.status, remark = excluded.remark, previous_remark = excluded.previous_remark,
    doer_user_id = excluded.doer_user_id, doer_name = excluded.doer_name, interaction_id = excluded.interaction_id;
  perform customer.refresh_enquiry(v_case.id);

  for f in select * from (values
      ('GENDER', 'gender'), ('ADDRESS OF THE CLIENT', 'address'), ('COUNTRY', 'country'), ('STATE', 'state'), ('CITY', 'city'),
      ('PINCODE', 'pincode'), ('CLIENT POTENTIAL CATEGORY', 'potential'), ('WHY IS THIS CLIENT A HIGH-POTENTIAL BUYER?', 'potential_reason'),
      ('NOT BOUGHT REASONS', 'not_bought_reasons')) as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    if v_value is not null then
      perform customer.set_source_field(v_client, f.field_key, v_value, 'not_bought_fms', v_at, v_changed, v_contact);
    end if;
  end loop;

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client, interaction_id = v_contact,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return v_contact;
end $$;

-- ---------------------------------------------------------------------------
-- 4. One REFERENCES CALLING FMS row
-- ---------------------------------------------------------------------------
create function customer.apply_references_calling_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_changed timestamptz; v_at timestamptz; v_client uuid;
  v_done timestamptz; v_status text; v_reading record; v_staff_name text; v_contact uuid; v_value text; f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.source <> 'references_calling_fms' then raise exception 'Reference-call row not found' using errcode = '22023'; end if;
  v_tenant := v_row.tenant_id;
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';
  if upper(coalesce(p ->> 'NAME OF THE REFERENCE', '')) = 'NAME OF THE REFERENCE' then raise exception 'Header row inside the data' using errcode = '22023'; end if;

  v_at := coalesce(customer.parse_sheet_timestamp(p ->> 'TIMESTAMP'), v_row.received_at);
  -- The row key equals the REFERRALS tab's key for the same person, so a
  -- person without a valid phone is the same customer in both tabs.
  v_client := customer.resolve_client(v_tenant, p ->> 'NUMBER OF THE REFERENCE', customer.sheet_value(p ->> 'NAME OF THE REFERENCE'),
    'references_calling_fms', v_at, null, null, 'referral:' || v_row.row_key, v_row.id);
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';
  perform customer.set_referrer(v_client, customer.referral_giver(v_tenant, customer.parse_sheet_timestamp(p ->> 'TIMESTAMP'), p ->> 'REFERENCE GIVEN BY'));

  v_done := customer.parse_sheet_timestamp(p ->> 'ACTUAL');
  if v_done is not null then
    v_status := p ->> 'STATUS';
    select * into v_reading from customer.follow_up_status_reading(v_status);
    v_staff_name := coalesce(customer.sheet_value(p ->> 'CRM NAME'), customer.sheet_value(p ->> 'CRM'));
    v_contact := customer.record_interaction(v_client, jsonb_strip_nulls(jsonb_build_object(
      'occurred_at', v_done, 'channel', 'not_recorded', 'direction', 'not_recorded', 'purpose', 'referral',
      'source', 'references_calling_fms', 'external_ref', v_row.row_key, 'source_row', v_row.id,
      'outcome', v_status, 'result', v_reading.result, 'successful', v_reading.successful,
      'non_contact_reason', case when not v_reading.successful then v_status end,
      'staff_user_id', customer.resolve_staff(v_tenant, v_staff_name), 'staff_name', v_staff_name,
      'fms_stage', p ->> 'WORK STAGE', 'process_name', 'REFERENCES CALLING FMS', 'notes', p ->> 'REMARKS')));
    update customer.interactions set archived_at = null, archive_reason = null where id = v_contact and archived_at is not null;
    if v_reading.successful then perform customer.close_follow_ups(v_client, v_contact); end if;
  else
    select id into v_contact from customer.interactions
     where tenant_id = v_tenant and source = 'references_calling_fms' and external_ref = v_row.row_key and archived_at is null;
    if v_contact is not null then perform customer.withdraw_interaction(v_contact, 'step_not_done'); end if;
    v_contact := null;
  end if;

  for f in select * from (values ('LOCATION OF THE REFERENCE', 'location'), ('RELIGION OF THE REFERENCE', 'religion')) as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    if v_value is not null then
      perform customer.set_source_field(v_client, f.field_key, v_value, 'references_calling_fms', v_at, v_changed, v_contact);
    end if;
  end loop;

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client, interaction_id = v_contact,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return v_contact;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Apply contract
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
        when 'not_bought_fms' then perform customer.apply_not_bought_fms_row(r.id);
        when 'references_calling' then perform customer.apply_references_calling_row(r.id);
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

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;
