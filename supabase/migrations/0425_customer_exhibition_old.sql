-- 0425: customer master database, part 13 - the old exhibition data
-- ("OLD EXHIBITION DATA MASTER", tab UNIQUE MASTER). A dead sheet: imported once.
--
-- Facts from the sheet (read-only probe, 2026-11-18): 33,988 rows, headers on
-- row 1, MOBILE NUMBER on every row and unique (one row per person). The tab
-- is itself a merge of older sheets: a cell can hold several values joined by
-- " | " (names, cities, pincodes, exhibitions), and some STATE cells hold an
-- email. VISIT / ENTRY TIMESTAMP is filled on 3,712 rows, a date on 3,226.
--
-- A row becomes:
--   * the customer (MOBILE NUMBER; the first name is the row's name, every
--     other name is kept as another name; ALTERNATE NUMBER as another number);
--   * EXHIBITION / EVENT NAME kept as written ("exhibitions_attended");
--   * one exhibition visit when the visit date is a date (outcome not
--     recorded: the sheet has none);
--   * address, city, state, pincode, email as answers. A cell with several
--     values gives each value; a value that is an email is an email, wherever
--     it was written.
-- Without a visit date the sheet gives no date for the person: they are first
-- seen at LAST UPDATED, the date the old sheet was merged.
--
-- Priority: an old merged sheet, ranked with the old master sheet (-1),
-- below every live source and below Zoho.

insert into customer.sources (source, source_rank, label) values ('exhibition_old', -1, 'Old exhibition data')
on conflict (source) do nothing;

alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling',
                      'order_fms', 'repair_fms', 'zoho', 'exhibition', 'exhibition_old'));
insert into customer.source_tables (source, table_name, label, importer, one_time) values
  ('exhibition_old', 'sheet_exhibition_old', 'Old exhibition data', 'exhibition_old', true);

-- The values of a cell that joins several with " | ".
create function customer.cell_parts(p_value text) returns setof text language sql immutable set search_path = '' as $$
  select distinct on (lower(btrim(x))) btrim(x) from regexp_split_to_table(coalesce(p_value, ''), '\s*\|\s*') x
   where customer.sheet_value(x) is not null
$$;

create function customer.apply_exhibition_old_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_at timestamptz; v_visit timestamptz; v_client uuid; v_contact uuid;
  v_first text; v_part text; f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.source <> 'exhibition_old' then raise exception 'Old exhibition row not found' using errcode = '22023'; end if;
  v_tenant := v_row.tenant_id;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';

  v_visit := customer.parse_sheet_timestamp(p ->> 'VISIT / ENTRY TIMESTAMP');
  v_at := coalesce(v_visit, customer.parse_sheet_timestamp(p ->> 'LAST UPDATED'), v_row.received_at);
  select x into v_first from customer.cell_parts(p ->> 'CLIENT NAME') x limit 1;

  v_client := customer.resolve_client(v_tenant, p ->> 'MOBILE NUMBER', v_first, 'exhibition_old', v_at, null, null,
    'exhibition_old:' || v_row.row_key, v_row.id);
  for v_part in select x from customer.cell_parts(p ->> 'CLIENT NAME') x loop
    perform customer.add_client_name(v_client, v_part, 'exhibition_old', v_at);
  end loop;
  if customer.normalize_phone(p ->> 'ALTERNATE NUMBER') is not null and customer.normalize_phone(p ->> 'MOBILE NUMBER') is not null then
    perform customer.find_or_create_client(v_tenant, '+' || customer.normalize_phone(p ->> 'MOBILE NUMBER'), null, 'exhibition_old', v_at,
      array['+' || customer.normalize_phone(p ->> 'ALTERNATE NUMBER')], null, null, v_row.id);
  end if;
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';

  if v_visit is not null then
    v_contact := customer.record_interaction(v_client, jsonb_strip_nulls(jsonb_build_object(
      'occurred_at', v_visit, 'channel', 'exhibition', 'direction', 'in_person', 'purpose', 'exhibition',
      'source', 'exhibition_old', 'external_ref', v_row.row_key, 'source_row', v_row.id, 'result', 'neutral', 'successful', true,
      'store_name', left(customer.sheet_value(p ->> 'EXHIBITION / EVENT NAME'), 200), 'process_name', 'Old exhibition data',
      'notes', customer.sheet_value(p ->> 'REMARKS'))));
    update customer.interactions set archived_at = null, archive_reason = null where id = v_contact and archived_at is not null;
  end if;

  if customer.sheet_value(p ->> 'EXHIBITION / EVENT NAME') is not null then
    perform customer.set_source_field(v_client, 'exhibitions_attended', p ->> 'EXHIBITION / EVENT NAME', 'exhibition_old', v_at, null, v_contact);
  end if;
  for f in select * from (values ('ADDRESS', 'address'), ('CITY', 'city'), ('STATE', 'state'), ('PINCODE', 'pincode'), ('EMAIL', 'email'))
           as m(header, field_key) loop
    for v_part in select x from customer.cell_parts(p ->> f.header) x loop
      if v_part ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
        values (v_tenant, v_client, 'email', lower(v_part), 'exhibition_old', v_at) on conflict do nothing;
        perform customer.set_source_field(v_client, 'email', lower(v_part), 'exhibition_old', v_at, null, v_contact);
      elsif f.field_key <> 'email' then
        perform customer.set_source_field(v_client, f.field_key, v_part, 'exhibition_old', v_at, null, v_contact);
      end if;
    end loop;
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
  old_text constant text := E'        when ''exhibition'' then perform customer.apply_exhibition_row(r.id);\n';
  new_text constant text := E'        when ''exhibition'' then perform customer.apply_exhibition_row(r.id);\n        when ''exhibition_old'' then perform customer.apply_exhibition_old_row(r.id);\n';
begin
  body := replace(pg_get_functiondef(f), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then raise exception '0425: expected 1 match in customer_ingest_apply, found %', found; end if;
  execute replace(body, old_text, new_text);
end $patch$;

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function customer.delete_sheet(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;
