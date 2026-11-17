-- 0420: customer master database, part 10 - ORDER FMS and REPAIR FMS, and
-- three corrections from production.
--
-- Facts from the sheet (read-only probes, 2026-11-17; headers on row 2):
--   ORDER FMS   1,216 rows, 446 work orders. One row per design per stage
--               (3. ORDER ISSUE TO KARIGAR ... 10. UPDATE TO CLIENT (PRODUCT
--               READY AT STORE)). The customer is only the BILLING PHONE
--               NUMBER. Key: WORK ORDER NO + DESIGN NO + WORK STAGE (unique).
--   REPAIR FMS  5,040 rows, 1,001 repairs (UNIQUE ID). One row per repair item
--               per stage (3. PRODUCT ISSUED TO KARIGAR ... 9. CLIENT CONTACTED
--               FOR PRODUCT PICKUP). Key: UNIQUE ID + REPAIR NUMBER + WORK
--               STAGE (unique).
--
-- Each work order and each repair is one case (customer.enquiries, like the
-- enquiry and not-bought tabs), each row one step. On the customer's timeline:
--   * one contact when the order was placed / the repair was handed in;
--   * one contact when the stage that reaches the customer is done (order
--     stage 10, repair stage 9), with what the sheet wrote.
-- The other stages (karigar, QC, hallmark, transfers) are work inside the
-- company: kept as steps, not as contacts. A case is closed when its last
-- stage is done. Columns that describe the order or repair item (category,
-- karigar, weight, expected pickup ...) are kept on the case as written.
--
-- Corrections:
--   * "CUSTOMER DECLINED" (and "CUSTOMBER DECLINED") means the customer said
--     no (owner, 2026-11-17): read as negative. "BUSY / DECLINED" can mean
--     either and stays as written.
--   * A row that meets another import writing the same customer (deadlock)
--     stays pending for the next run instead of being rejected. The row
--     rejected that way on production is queued again.
--   * Which stage closes a case is set per sheet (enquiry tabs: 5).

-- ---------------------------------------------------------------------------
-- 1. Sheets and case columns
-- ---------------------------------------------------------------------------
alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling', 'order_fms', 'repair_fms'));
insert into customer.source_tables (source, table_name, label, importer, one_time) values
  ('order_fms', 'sheet_order_fms', 'Order FMS', 'order_fms', false),
  ('repair_fms', 'sheet_repair_fms', 'Repair FMS', 'repair_fms', false);

alter table customer.enquiries add column final_stage_no integer, add column details jsonb not null default '{}'::jsonb;
update customer.enquiries e set final_stage_no = 5
  from customer.source_tables t where t.source = e.source and t.importer = 'enquiry_fms';
alter table customer.enquiry_steps add column item_ref text;

create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0420: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

do $patches$
begin
  -- The stage that closes a case comes from the case.
  perform customer._patch('customer.refresh_enquiry(uuid)'::regprocedure, 's.stage_no = 5', 's.stage_no = e.final_stage_no', 2);
  -- New enquiry cases close at stage 5, as before.
  perform customer._patch('customer.apply_enquiry_row(uuid)'::regprocedure,
    $o$  insert into customer.enquiries (tenant_id, client_id, source, reference_number, channel, received_at, lead_source,
    product_number, pricing, image_url, instagram_id, assigned_by_user_id, assigned_by_name)
  values (v_tenant, v_client, v_row.source, v_ref, v_channel, v_received, p ->> 'SOURCE OF THE LEAD',$o$,
    $n$  insert into customer.enquiries (tenant_id, client_id, source, reference_number, channel, received_at, lead_source,
    product_number, pricing, image_url, instagram_id, assigned_by_user_id, assigned_by_name, final_stage_no)
  values (v_tenant, v_client, v_row.source, v_ref, v_channel, v_received, p ->> 'SOURCE OF THE LEAD',$n$, 1);
  perform customer._patch('customer.apply_enquiry_row(uuid)'::regprocedure,
    $o$    p ->> 'INSTAGRAM ID', customer.resolve_staff(v_tenant, p ->> 'ASSIGNED BY'), p ->> 'ASSIGNED BY')
  on conflict$o$,
    $n$    p ->> 'INSTAGRAM ID', customer.resolve_staff(v_tenant, p ->> 'ASSIGNED BY'), p ->> 'ASSIGNED BY', 5)
  on conflict$n$, 1);
end $patches$;
drop function customer._patch(regprocedure, text, text, integer);

-- ---------------------------------------------------------------------------
-- 2. CUSTOMER DECLINED: the customer said no
-- ---------------------------------------------------------------------------
create or replace function customer.enquiry_status_reading(p_status text, out result text, out successful boolean, out ends text)
language sql immutable set search_path = '' as $$
  select r.result, r.successful, r.ends
    from (select upper(btrim(coalesce(p_status, ''))) as s) x
    cross join lateral (select
      case
        when x.s in ('YES (INTERESTED)', 'INTERESTED FOLLOW-UP REQUIRED', 'CLIENT REQUESTED ANOTHER VIDEO CALL TO VIEW MORE PRODUCTS',
                     'YES, THE CLIENT BOUGHT THE PRODUCT') then 'positive'
        when x.s in ('NOT INTERESTED CLOSE THIS LEAD', 'NO, THE CLIENT DID NOT BUY', 'CUSTOMER DECLINED', 'CUSTOMBER DECLINED') then 'negative'
        when x.s in ('NOT REACHABLE', 'BUSY') then 'not_connected'
        else 'neutral' end as result,
      x.s not in ('NOT REACHABLE', 'BUSY') as successful,
      case
        when x.s = 'YES, THE CLIENT BOUGHT THE PRODUCT' then 'won'
        when x.s in ('NOT INTERESTED CLOSE THIS LEAD', 'NO, THE CLIENT DID NOT BUY') then 'lost' end as ends) r
$$;

create or replace function customer.follow_up_status_reading(p_status text, out result text, out successful boolean, out ends text)
language sql immutable set search_path = '' as $$
  select r.result, r.successful, r.ends
    from (select upper(btrim(coalesce(p_status, ''))) as s) x
    cross join lateral (select
      case
        when x.s in ('YES (CLIENT NEED FOLLOW-UP)', 'YES INTERESTED', 'YES (INTERESTED FOLLOW UP REQUIRED)') then 'positive'
        when x.s in ('NOT INTERESTED CLOSE THIS LEAD', 'NOT INTERESTED', 'CUSTOMER DECLINED', 'CUSTOMBER DECLINED') then 'negative'
        when x.s in ('NO (CALL NOT CONNECTED)', 'RINGING / NOT ANSWERED', 'NOT REACHABLE', 'BUSY') then 'not_connected'
        else 'neutral' end as result,
      x.s not in ('NO (CALL NOT CONNECTED)', 'RINGING / NOT ANSWERED', 'NOT REACHABLE', 'BUSY') as successful,
      case when x.s = 'NOT INTERESTED CLOSE THIS LEAD' then 'lost' end as ends) r
$$;

-- ---------------------------------------------------------------------------
-- 3. One case row: shared by ORDER FMS and REPAIR FMS
-- ---------------------------------------------------------------------------
-- p_kind 'order' | 'repair'. What differs is passed in: the case number, the
-- item, the customer's phone and name, when it started, the staff, the stage
-- that reaches the customer, and the columns that describe the item.
create function customer.apply_service_case_row(
  p_ingest_row_id uuid, p_kind text, p_case_no text, p_item_ref text, p_phone text, p_name text, p_started_at timestamptz,
  p_staff text, p_recorded_by text, p_branch text, p_step_status text, p_done_header text, p_contact_stage integer,
  p_details jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_case_no text; v_at timestamptz; v_client uuid; v_case customer.enquiries;
  v_opened uuid; v_stage text; v_stage_no integer; v_planned timestamptz; v_done timestamptz; v_doer uuid; v_contact uuid;
  v_branch uuid; v_label text := case p_kind when 'order' then 'Order placed' else 'Repair handed in' end;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  v_tenant := v_row.tenant_id;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';
  v_case_no := coalesce(customer.sheet_value(p_case_no), 'row:' || v_row.row_key);
  v_at := coalesce(p_started_at, v_row.received_at);
  v_branch := customer.resolve_branch(v_tenant, p_branch);

  v_client := customer.resolve_client(v_tenant, p_phone, customer.sheet_value(p_name), v_row.source, v_at, null, null,
    v_row.source || ':' || v_case_no, v_row.id);
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';

  insert into customer.enquiries (tenant_id, client_id, source, reference_number, channel, received_at, assigned_by_user_id, assigned_by_name,
    final_stage_no, details)
  values (v_tenant, v_client, v_row.source, v_case_no, p_kind, v_at, customer.resolve_staff(v_tenant, customer.sheet_value(p_staff)),
    customer.sheet_value(p_staff), case p_kind when 'order' then 10 else 9 end,
    jsonb_build_object(coalesce(customer.sheet_value(p_item_ref), '-'), jsonb_strip_nulls(p_details)))
  on conflict (tenant_id, source, reference_number) do update set
    client_id = case when customer.normalize_phone(p_phone) is not null then excluded.client_id else customer.enquiries.client_id end,
    received_at = least(customer.enquiries.received_at, excluded.received_at),
    assigned_by_user_id = coalesce(excluded.assigned_by_user_id, customer.enquiries.assigned_by_user_id),
    assigned_by_name = coalesce(excluded.assigned_by_name, customer.enquiries.assigned_by_name),
    details = customer.enquiries.details || excluded.details
  returning * into v_case;
  v_client := v_case.client_id;

  -- The order placed / the repair handed in.
  v_opened := customer.record_interaction(v_client, jsonb_strip_nulls(jsonb_build_object(
    'occurred_at', v_case.received_at, 'channel', 'not_recorded', 'direction', 'not_recorded', 'purpose', p_kind,
    'source', v_row.source, 'external_ref', p_kind || ':' || v_case_no, 'outcome', v_label, 'result', 'neutral', 'successful', true,
    'staff_user_id', v_case.assigned_by_user_id, 'staff_name', v_case.assigned_by_name,
    'branch_id', v_branch, 'store_name', customer.sheet_value(p_branch), 'lead_id', v_case.id,
    'process_name', upper(p_kind) || ' FMS', 'notes', p_kind || ' ' || v_case_no)));
  update customer.interactions
     set archived_at = null, archive_reason = null,
         recorded_by_user_id = customer.resolve_staff(v_tenant, customer.sheet_value(p_recorded_by)), recorded_by_name = customer.sheet_value(p_recorded_by)
   where id = v_opened;
  update customer.enquiries set opened_interaction_id = v_opened where id = v_case.id and opened_interaction_id is distinct from v_opened;

  -- This row's stage.
  v_stage := p ->> 'WORK STAGE';
  v_stage_no := nullif(substring(coalesce(v_stage, '') from '^\s*(\d+)'), '')::integer;
  v_planned := customer.parse_sheet_timestamp(p ->> 'PLANNED');
  v_done := customer.parse_sheet_timestamp(p ->> p_done_header);
  v_doer := customer.resolve_staff(v_tenant, customer.sheet_value(p ->> 'DOER'));

  if v_done is not null and v_stage_no = p_contact_stage then
    -- The stage that reaches the customer.
    v_contact := customer.record_interaction(v_client, jsonb_strip_nulls(jsonb_build_object(
      'occurred_at', v_done, 'channel', 'not_recorded', 'direction', 'not_recorded', 'purpose', p_kind,
      'source', v_row.source, 'external_ref', v_row.row_key, 'source_row', v_row.id,
      'outcome', coalesce(customer.sheet_value(p_step_status), v_stage), 'result', 'neutral', 'successful', true,
      'staff_user_id', v_doer, 'staff_name', customer.sheet_value(p ->> 'DOER'), 'branch_id', v_branch, 'store_name', customer.sheet_value(p_branch),
      'fms_stage', v_stage, 'process_name', upper(p_kind) || ' FMS', 'lead_id', v_case.id, 'parent_interaction_id', v_opened,
      'notes', p ->> 'REMARK')));
    update customer.interactions set archived_at = null, archive_reason = null where id = v_contact and archived_at is not null;
    perform customer.close_follow_ups(v_client, v_contact);
  else
    select id into v_contact from customer.interactions
     where tenant_id = v_tenant and source = v_row.source and external_ref = v_row.row_key and archived_at is null;
    if v_contact is not null then perform customer.withdraw_interaction(v_contact, 'step_not_done'); end if;
    v_contact := null;
  end if;

  insert into customer.enquiry_steps (tenant_id, enquiry_id, source_row, item_ref, stage, stage_no, planned_at, done_at, status, remark,
    previous_remark, doer_user_id, doer_name, interaction_id)
  values (v_tenant, v_case.id, v_row.id, customer.sheet_value(p_item_ref), v_stage, v_stage_no, v_planned, v_done,
    customer.sheet_value(p_step_status), p ->> 'REMARK', p ->> 'PREVIOUS REMARK', v_doer, customer.sheet_value(p ->> 'DOER'), v_contact)
  on conflict (source_row) do update set
    enquiry_id = excluded.enquiry_id, item_ref = excluded.item_ref, stage = excluded.stage, stage_no = excluded.stage_no,
    planned_at = excluded.planned_at, done_at = excluded.done_at, status = excluded.status, remark = excluded.remark,
    previous_remark = excluded.previous_remark, doer_user_id = excluded.doer_user_id, doer_name = excluded.doer_name,
    interaction_id = excluded.interaction_id;
  perform customer.refresh_enquiry(e.id) from customer.enquiries e
   where e.tenant_id = v_tenant and e.source = v_row.source and e.id <> v_case.id
     and e.archived_at is null and not exists (select 1 from customer.enquiry_steps s where s.enquiry_id = e.id);
  perform customer.refresh_enquiry(v_case.id);

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client, interaction_id = coalesce(v_contact, v_opened),
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return coalesce(v_contact, v_opened);
end $$;

create function customer.apply_order_fms_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_row customer.ingest_rows; p jsonb;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id;
  if v_row.id is null or v_row.source <> 'order_fms' then raise exception 'Order row not found' using errcode = '22023'; end if;
  p := v_row.payload;
  return customer.apply_service_case_row(v_row.id, 'order', p ->> 'WORK ORDER NO', p ->> 'DESIGN NO', p ->> 'BILLING PHONE NUMBER', null,
    customer.parse_sheet_timestamp(p ->> 'DATE OF ORDER'), p ->> 'SALE PERSON', null, null, null, 'ACTUAL', 10,
    jsonb_build_object('design_no', customer.sheet_value(p ->> 'DESIGN NO'), 'category', customer.sheet_value(p ->> 'CATEGORY'),
      'karigar', customer.sheet_value(p ->> 'KARIGAR'), 'delivery_date', customer.sheet_value(p ->> 'DELIVERY DATE'),
      'status', customer.sheet_value(p ->> 'STATUS'), 'huid_by', customer.sheet_value(p ->> 'WHO WILL DO HUID?'),
      'cad_cam_required', customer.sheet_value(p ->> 'CAD CAM PIECE REQUIRED?'), 'type_of_order', customer.sheet_value(p ->> 'TYPE OF ORDER'),
      'priority', customer.sheet_value(p ->> 'PRIORITY')));
end $$;

create function customer.apply_repair_fms_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_row customer.ingest_rows; p jsonb;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id;
  if v_row.id is null or v_row.source <> 'repair_fms' then raise exception 'Repair row not found' using errcode = '22023'; end if;
  p := v_row.payload;
  return customer.apply_service_case_row(v_row.id, 'repair', p ->> 'UNIQUE ID', p ->> 'REPAIR NUMBER', p ->> 'CONTACT NUMBER', p ->> 'CLIENT NAME',
    customer.parse_sheet_timestamp(p ->> 'TIMESTAMP'), p ->> 'NAME OF THE SALEPERSON ATTENDING CLIENT', p ->> 'NAME OF THE PERSON FILLING THE FORM',
    p ->> 'BRANCH', p ->> 'STATUS (2)', 'ACTUAL TIME', 9,
    jsonb_build_object('repair_number', customer.sheet_value(p ->> 'REPAIR NUMBER'), 'product_type', customer.sheet_value(p ->> 'PRODUCT TYPE'),
      'product_category', customer.sheet_value(p ->> 'PRODUCT CATEGORY'), 'pieces', customer.sheet_value(p ->> 'NUMBER OF PIECES'),
      'gross_weight', customer.sheet_value(p ->> 'GROSS WEIGHT OF THE PRODUCT'), 'expected_pickup', customer.sheet_value(p ->> 'EXPECTED PICKUP DATE'),
      'status', customer.sheet_value(p ->> 'STATUS'), 'image', customer.sheet_value(p ->> 'IMAGE OF THE PRODUCT LINK')));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Apply contract: new importers; a deadlock leaves the row pending
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
        when 'order_fms' then perform customer.apply_order_fms_row(r.id);
        when 'repair_fms' then perform customer.apply_repair_fms_row(r.id);
      end case;
      v_applied := v_applied + 1;
      if v_young and v_applied in (50, 500, 2000) then perform customer.refresh_statistics(); end if;
    exception
      when deadlock_detected or lock_not_available or serialization_failure then
        -- Another import was writing the same customer: not a fault of the
        -- row. It stays pending and is applied by the next run.
        null;
      when others then
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

-- ---------------------------------------------------------------------------
-- 5. Rows to apply again
-- ---------------------------------------------------------------------------
update customer.ingest_rows set status = 'pending', reject_reason = null
 where status = 'rejected' and reject_reason in ('deadlock detected', 'could not serialize access due to concurrent update');
update customer.ingest_rows set status = 'pending'
 where status = 'applied' and upper(btrim(coalesce(payload ->> 'STATUS', ''))) in ('CUSTOMER DECLINED', 'CUSTOMBER DECLINED')
   and source in (select source from customer.source_tables where importer in ('enquiry_fms', 'references_calling'));
