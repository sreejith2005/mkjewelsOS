-- 0423: customer master database, part 12 - exhibition walk-ins
-- ("EXHIBITION WALKIN DATASET (FOR PORTAL)", tab Master; live).
--
-- Facts from the sheet (read-only probe, 2026-11-17): 1,906 rows, headers on
-- row 1, 6 exhibitions. REFERENCE NUMBER is the exhibition's code
-- (BANGALORE-002 ...), shared by all its visitors; the row key is TIMESTAMP +
-- PHONE 1.
--
-- A row becomes: the customer (PHONE 1, PHONE 2 kept as another number; else
-- a customer of their own, 0416), one exhibition visit on TIMESTAMP with
-- EXHIBITION NAME, SALESPERSON, CRM NAME and REMARK as written, STATUS as its
-- outcome (only BOUGHT is read: a purchase), the references the visitor gave
-- (REFERENCE n NAME / NUMBER) as customers referred by them, and the other
-- columns as profile answers. Exhibition answers rank 3: above calls and
-- enquiries, below the store walk-in.

alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling',
                      'order_fms', 'repair_fms', 'zoho', 'exhibition'));
insert into customer.source_tables (source, table_name, label, importer, one_time) values
  ('exhibition', 'sheet_exhibition', 'Exhibition walk-ins', 'exhibition', false);

create function customer.apply_exhibition_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_changed timestamptz; v_at timestamptz; v_client uuid; v_other uuid;
  v_contact uuid; v_status text; v_bought boolean; v_value text; v_name text; v_phone text; i integer; f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.source <> 'exhibition' then raise exception 'Exhibition row not found' using errcode = '22023'; end if;
  v_tenant := v_row.tenant_id;
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';
  if upper(coalesce(p ->> 'CLIENT NAME', '')) = 'CLIENT NAME' then raise exception 'Header row inside the data' using errcode = '22023'; end if;

  v_at := coalesce(customer.parse_sheet_timestamp(p ->> 'TIMESTAMP'), v_row.received_at);
  v_client := customer.resolve_client(v_tenant, p ->> 'PHONE 1', customer.sheet_value(p ->> 'CLIENT NAME'), 'exhibition', v_at,
    null, null, 'exhibition:' || v_row.row_key, v_row.id);
  if customer.normalize_phone(p ->> 'PHONE 2') is not null and customer.normalize_phone(p ->> 'PHONE 1') is not null then
    -- A second number of the same visitor: kept, or sent to review if it is someone else's.
    perform customer.find_or_create_client(v_tenant, '+' || customer.normalize_phone(p ->> 'PHONE 1'), null, 'exhibition', v_at,
      array['+' || customer.normalize_phone(p ->> 'PHONE 2')], null, null, v_row.id);
  end if;
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';

  v_status := customer.sheet_value(p ->> 'STATUS');
  v_bought := upper(coalesce(v_status, '')) = 'BOUGHT';
  v_contact := customer.record_interaction(v_client, jsonb_strip_nulls(jsonb_build_object(
    'occurred_at', v_at, 'channel', 'exhibition', 'direction', 'in_person', 'purpose', case when v_bought then 'purchase' else 'exhibition' end,
    'source', 'exhibition', 'external_ref', v_row.row_key, 'source_row', v_row.id,
    'outcome', v_status, 'result', case when v_bought then 'positive' else 'neutral' end, 'successful', true,
    'staff_user_id', customer.resolve_staff(v_tenant, customer.sheet_value(p ->> 'SALESPERSON')), 'staff_name', customer.sheet_value(p ->> 'SALESPERSON'),
    'store_name', customer.sheet_value(p ->> 'EXHIBITION NAME'), 'process_name', 'Exhibition form', 'notes', customer.sheet_value(p ->> 'REMARK'))));
  update customer.interactions
     set archived_at = null, archive_reason = null,
         recorded_by_user_id = customer.resolve_staff(v_tenant, customer.sheet_value(p ->> 'CRM NAME')), recorded_by_name = customer.sheet_value(p ->> 'CRM NAME')
   where id = v_contact;
  perform customer.close_follow_ups(v_client, v_contact);

  for f in select * from (values ('MARRIAGE STATUS', 'marital_status'), ('ADDRESS', 'address'), ('COUNTRY', 'country'), ('STATE', 'state'),
      ('CITY', 'city'), ('PINCODE', 'pincode'), ('AREA', 'area'), ('POTENTIAL', 'potential'), ('ANNIVERSARY DATE', 'anniversary_as_written'),
      ('EXHIBITION NAME', 'exhibition_name')) as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    if v_value is not null then
      perform customer.set_source_field(v_client, f.field_key, v_value, 'exhibition', v_at, v_changed, v_contact);
    end if;
  end loop;

  -- The references this visitor gave.
  for i in 1..20 loop
    v_name := customer.sheet_value(p ->> format('REFERENCE %s NAME', i));
    v_phone := customer.sheet_value(p ->> format('REFERENCE %s NUMBER', i));
    continue when v_name is null and v_phone is null;
    v_other := customer.resolve_client(v_tenant, v_phone, v_name, 'exhibition', v_at, null, null,
      'exhibition:' || v_row.row_key || ':ref' || i, v_row.id);
    perform customer.set_referrer(v_other, v_client);
  end loop;

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client, interaction_id = v_contact,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return v_contact;
end $$;

do $patch$
declare
  body text; found integer; f regprocedure := 'public.customer_ingest_apply(text,integer)'::regprocedure;
  old_text constant text := E'        when ''zoho'' then perform customer.apply_zoho_row(r.id);\n';
  new_text constant text := E'        when ''zoho'' then perform customer.apply_zoho_row(r.id);\n        when ''exhibition'' then perform customer.apply_exhibition_row(r.id);\n';
begin
  body := replace(pg_get_functiondef(f), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then raise exception '0423: expected 1 match in customer_ingest_apply, found %', found; end if;
  execute replace(body, old_text, new_text);
end $patch$;

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;
