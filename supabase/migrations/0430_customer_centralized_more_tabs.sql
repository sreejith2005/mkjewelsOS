-- 0430: customer master database, part 16 - five more tabs of "MK CENTRALIZED
-- CLIENT DATABASE" (owner, 2026-11-18: "import all these and make sure
-- unique"). Headers on row 1; read-only probes 2026-11-18.
--
--   NO NAME (9,224 rows)        the MASTER DATABASE columns, numbers but no
--                               names. Key CONTACT NUMBER (unique).
--   NO NUMBER (8,694 rows)      the MASTER DATABASE columns, names but no
--                               numbers; 6,167 from "Sales Register", 7,850
--                               BUYER. Key CLIENT ID (unique).
--   BANGALORE BUYER LIST (172)  BUYER / NON BUYER, CLIENT NAME, CONTACT NUMBER.
--                               Key CONTACT NUMBER (unique).
--   SCOT (8,776 rows)           Contact Number (8,490 filled, 8,435 distinct),
--                               Customer, Other Client Name(s), Sales Person,
--                               LAST INTERACTION DATE (dd/mm/yyyy), ASSINGED
--                               CALL PERSON, Remark. No unique column: read by
--                               row number.
--   CHIRAYU APP (2,796 rows)    Name, Mobile (2,404 distinct), City, Mobile
--                               Type, Entry Date Time (dd-mm-yyyy). Read by row
--                               number; the real source is the Chirayu app.
--   MISMATCH DATA               not imported: one column of client IDs under an
--                               automation status line, no customer details.
--
-- One person once:
--   * a valid number joins the customer who has it (as everywhere);
--   * a row with no valid number but a CLIENT ID joins the customer that
--     already carries that sheet CLIENT ID (so NO NUMBER rows meet their
--     people from the other tabs); otherwise it is a customer of its own;
--   * a tab read by row number gives identical rows one customer.
-- All five rank 0 (old lists): they fill gaps and never override MASTER
-- DATABASE or a live sheet. All are one-time imports.
--
-- Also: DONT CONTACT ANYMORE now writes its audit row only when the person
-- first becomes do not contact, without searching the audit log each time.

-- Exact-text patch of an existing function; fails unless the text is found
-- exactly the expected number of times. Dropped at the end.
create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0430: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Sources and tables
-- ---------------------------------------------------------------------------
insert into customer.sources (source, source_rank, label) values
  ('master_no_name', 0, 'Centralized database: no name'),
  ('master_no_number', 0, 'Centralized database: no number'),
  ('master_bangalore_buyers', 0, 'Centralized database: Bangalore buyer list'),
  ('master_scot', 0, 'Centralized database: SCOT'),
  ('master_chirayu_app', 0, 'Centralized database: Chirayu app')
on conflict (source) do nothing;

alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling',
                      'order_fms', 'repair_fms', 'zoho', 'exhibition', 'exhibition_old', 'customer_data', 'master_sheet',
                      'wrong_number', 'dont_contact', 'buyer_list', 'scot', 'chirayu_app'));
insert into customer.source_tables (source, table_name, label, importer, one_time) values
  ('master_no_name', 'sheet_centralized_no_name', 'Centralized database: NO NAME', 'master_sheet', true),
  ('master_no_number', 'sheet_centralized_no_number', 'Centralized database: NO NUMBER', 'master_sheet', true),
  ('master_bangalore_buyers', 'sheet_centralized_bangalore_buyers', 'Centralized database: BANGALORE BUYER LIST', 'master_sheet', true),
  ('master_scot', 'sheet_centralized_scot', 'Centralized database: SCOT', 'scot', true),
  ('master_chirayu_app', 'sheet_centralized_chirayu_app', 'Centralized database: CHIRAYU APP', 'chirayu_app', true);

-- ---------------------------------------------------------------------------
-- 2. No valid number: the sheet CLIENT ID finds the person
-- ---------------------------------------------------------------------------
select customer._patch('customer.apply_master_sheet_row(uuid)'::regprocedure,
$old$  v_client := customer.resolve_client(v_tenant, p ->> 'CONTACT NUMBER', customer.sheet_value(p ->> 'CLIENT NAME'), v_row.source,
    coalesce(v_first, v_at), null, null, v_row.source || ':' || v_row.row_key, v_row.id);$old$,
$new$  -- No valid number but a CLIENT ID: the customer who already carries that ID.
  if customer.normalize_phone(p ->> 'CONTACT NUMBER') is null and customer.sheet_value(p ->> 'CLIENT ID') is not null then
    select coalesce(c.merged_into_client_id, c.id) into v_client
      from customer.client_identifiers i join customer.clients c on c.id = i.client_id
     where i.tenant_id = v_tenant and i.id_type = 'sheet_client_id' and i.value = upper(customer.sheet_value(p ->> 'CLIENT ID'))
     order by i.first_seen_at, i.id limit 1;
  end if;
  if v_client is null then
    v_client := customer.resolve_client(v_tenant, p ->> 'CONTACT NUMBER', customer.sheet_value(p ->> 'CLIENT NAME'), v_row.source,
      coalesce(v_first, v_at), null, null, v_row.source || ':' || v_row.row_key, v_row.id);
  else
    perform customer.add_client_name(v_client, customer.sheet_value(p ->> 'CLIENT NAME'), v_row.source, coalesce(v_first, v_at));
  end if;$new$, 1);

-- ---------------------------------------------------------------------------
-- 3. SCOT and CHIRAYU APP
-- ---------------------------------------------------------------------------
create or replace function customer.apply_centralized_list_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; v_importer text; p jsonb; v_tenant uuid; v_changed timestamptz; v_at timestamptz; v_client uuid;
  v_value text; f record; v_phone text; v_name text; v_ref text;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  select importer into v_importer from customer.source_tables where source = v_row.source;
  if v_row.id is null or v_importer not in ('wrong_number', 'dont_contact', 'buyer_list', 'scot', 'chirayu_app') then
    raise exception 'Centralized list row not found' using errcode = '22023';
  end if;
  v_tenant := v_row.tenant_id;
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  p := customer.row_values(v_row.payload);
  -- Each tab names the number, the name and the date its own way.
  v_phone := coalesce(p ->> 'CONTACT NUMBER', p ->> 'Contact Number', p ->> 'Mobile');
  v_name := customer.sheet_value(coalesce(p ->> 'CLIENT NAME', p ->> 'Customer', p ->> 'Name'));
  if upper(coalesce(v_phone, '')) in ('CONTACT NUMBER', 'MOBILE') then raise exception 'Header row inside the data' using errcode = '22023'; end if;
  v_at := coalesce(customer.parse_sheet_timestamp(p ->> 'INTERACTION DATE'),
                   customer.parse_date_ordered(coalesce(p ->> 'LAST INTERACTION DATE', p ->> 'Entry Date Time'), 'dmy'),
                   v_row.received_at);
  -- Tabs read by row number (no unique column): the same row content is one person.
  v_ref := v_row.source || ':' || case when v_row.row_key like 'row:%' then md5(p::text) else v_row.row_key end;
  -- The app is the real source of the people who signed up in it.
  if v_importer = 'chirayu_app' then perform set_config('customer.current_origin', 'Chirayu app', true); end if;

  v_client := customer.resolve_client(v_tenant, v_phone, v_name, v_row.source, v_at, null, null, v_ref, v_row.id);
  if v_importer = 'scot' then
    perform customer.add_client_name(v_client, t.x, v_row.source, v_at - make_interval(secs => t.n::int))
       from customer.cell_parts(p ->> 'Other Client Name(s)') with ordinality as t(x, n);
  end if;
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
      ('buyer_list', 'TYPE OF CLIENT', 'client_category'), ('buyer_list', 'SALES PERSON', 'salesperson'),
      ('scot', 'Sales Person', 'salesperson'), ('scot', 'LAST INTERACTION DATE', 'last_interaction_date'),
      ('scot', 'ASSINGED CALL PERSON', 'assigned_call_person'), ('scot', 'Remark', 'scot_remark'),
      ('chirayu_app', 'City', 'city'), ('chirayu_app', 'Mobile Type', 'app_mobile_type'),
      ('chirayu_app', 'Entry Date Time', 'app_signed_up_on')) as m(importer, header, field_key)
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
    -- Logged once, when the person first becomes do not contact.
    if exists (select 1 from customer.clients where id = v_client and archive_reason is distinct from 'do_not_contact') then
      insert into public.audit_logs (tenant_id, action, module, record_id, new_value)
      values (v_tenant, 'customer_do_not_contact', 'customer', v_client, jsonb_build_object('source_row', v_row.id));
    end if;
    update customer.clients
       set do_not_call = true,
           archived_at = coalesce(archived_at, now()),
           archive_reason = case when archived_at is null or archive_reason = 'removed_from_sheet' then 'do_not_contact' else archive_reason end
     where id = v_client;
    update customer.follow_ups set status = 'cancelled' where client_id = v_client and status = 'pending';
    update customer.appointments set status = 'cancelled' where client_id = v_client and status = 'booked';
  end if;

  perform customer.refresh_client_stats(v_client);
  perform set_config('customer.current_origin', '', true);
  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return null;
end $$;


select customer._patch('public.customer_ingest_apply(text,integer)'::regprocedure,
E'        when ''wrong_number'', ''dont_contact'', ''buyer_list'' then',
E'        when ''wrong_number'', ''dont_contact'', ''buyer_list'', ''scot'', ''chirayu_app'' then', 1);

drop function customer._patch(regprocedure, text, text, integer);

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function customer.delete_sheet(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;
