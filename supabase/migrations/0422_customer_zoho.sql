-- 0422: customer master database, part 11 - the old Zoho CRM export
-- ("Zoho Clients - DATA", tab ZOHO DATA). A dead sheet: imported once.
--
-- Facts from the sheet (read-only probe, 2026-11-17): 21,553 rows, headers
-- on row 1, "Sr. No" unique. Mobile on 21,513 rows (21,464 different numbers).
--
-- What a row becomes:
--   * the customer (Mobile; else a customer of their own, 0416), with the
--     Zoho "Created Time" as when they were first seen;
--   * when Visit Date is filled: one store visit on that date, with Sales
--     Person and Store as written; "Buying ?" is its outcome as written, and
--     only YES (any case) is read: a purchase;
--   * Email, Date of Birth, Anniversary, Pin Code, Address, Lead Source as
--     profile answers.
--
-- Priority (owner, 2026-11-17): Zoho ranks just above the old master sheet,
-- below every live source. The master sheet moves from 0 to -1 to make room.
--
-- Dates. Created Time is written month first with a two-digit year
-- (5/14/23 13:10); Date of Birth, Anniversary and Visit Date day first
-- (14/5/1990). A part above 12 is the day whatever the column; only when both
-- parts are 12 or below does the column's order decide.

insert into customer.sources (source, source_rank, label) values ('zoho', 0, 'Zoho CRM (old)')
on conflict (source) do nothing;
update customer.sources set source_rank = -1 where source = 'master_sheet';

alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling', 'order_fms', 'repair_fms', 'zoho'));
insert into customer.source_tables (source, table_name, label, importer, one_time) values
  ('zoho', 'sheet_zoho', 'Zoho CRM export', 'zoho', true);

-- A d/m/y or m/d/y date, two- or four-digit year, optional time, India time.
-- p_order 'dmy' | 'mdy' decides only when both parts are 12 or below.
create function customer.parse_date_ordered(p_value text, p_order text)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare m text[]; a int; b int; y int; dd int; mm int;
begin
  m := regexp_match(btrim(coalesce(p_value, '')), '^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$');
  if m is null then return null; end if;
  a := m[1]::int; b := m[2]::int; y := m[3]::int;
  if length(m[3]) = 2 then y := 2000 + y; end if;
  if a > 12 then dd := a; mm := b;
  elsif b > 12 then mm := a; dd := b;
  elsif p_order = 'mdy' then mm := a; dd := b;
  else dd := a; mm := b;
  end if;
  return (make_date(y, mm, dd) + make_time(coalesce(m[4]::int, 0), coalesce(m[5]::int, 0), coalesce(m[6]::int, 0))) at time zone 'Asia/Kolkata';
exception when others then
  return null;
end $$;

create function customer.apply_zoho_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_created timestamptz; v_visit timestamptz; v_client uuid;
  v_contact uuid; v_buying text; v_yes boolean; v_value text; v_date timestamptz; f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or v_row.source <> 'zoho' then raise exception 'Zoho row not found' using errcode = '22023'; end if;
  v_tenant := v_row.tenant_id;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';

  v_created := customer.parse_date_ordered(p ->> 'Created Time', 'mdy');
  v_visit := customer.parse_date_ordered(p ->> 'Visit Date', 'dmy');
  v_client := customer.resolve_client(v_tenant, p ->> 'Mobile', customer.sheet_value(p ->> 'Contact Name'), 'zoho',
    coalesce(v_created, v_visit, v_row.received_at), null, null, 'zoho:' || v_row.row_key, v_row.id);
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';

  if (p ->> 'Email ID') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
    values (v_tenant, v_client, 'email', lower(p ->> 'Email ID'), 'zoho', coalesce(v_created, v_row.received_at)) on conflict do nothing;
  end if;

  if v_visit is not null then
    v_buying := customer.sheet_value(p ->> 'Buying ?');
    v_yes := upper(coalesce(v_buying, '')) = 'YES';
    v_contact := customer.record_interaction(v_client, jsonb_strip_nulls(jsonb_build_object(
      'occurred_at', v_visit, 'channel', 'walk_in', 'direction', 'in_person', 'purpose', case when v_yes then 'purchase' else 'visit' end,
      'source', 'zoho', 'external_ref', v_row.row_key, 'source_row', v_row.id,
      'outcome', v_buying, 'result', case when v_yes then 'positive' else 'neutral' end, 'successful', true,
      'staff_user_id', customer.resolve_staff(v_tenant, customer.sheet_value(p ->> 'Sales Person')), 'staff_name', customer.sheet_value(p ->> 'Sales Person'),
      'branch_id', customer.resolve_branch(v_tenant, p ->> 'Store'), 'store_name', customer.sheet_value(p ->> 'Store'),
      'process_name', 'Zoho CRM')));
    update customer.interactions set archived_at = null, archive_reason = null where id = v_contact and archived_at is not null;
  end if;

  for f in select * from (values ('Email ID', 'email'), ('Pin Code', 'pincode'), ('Address', 'address'), ('Lead Source', 'lead_source'),
                                 ('Store', 'store')) as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    if v_value is not null then
      if f.field_key = 'email' then v_value := lower(v_value); end if;
      perform customer.set_source_field(v_client, f.field_key, v_value, 'zoho', coalesce(v_created, v_visit, v_row.received_at), null, v_contact);
    end if;
  end loop;
  for f in select * from (values ('Date of Birth', 'dob'), ('Anniversary', 'anniversary')) as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    continue when v_value is null;
    v_date := customer.parse_date_ordered(v_value, 'dmy');
    if v_date is not null then
      perform customer.set_source_field(v_client, f.field_key, to_char(v_date at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), 'zoho',
        coalesce(v_created, v_row.received_at), null, v_contact);
    else
      perform customer.set_source_field(v_client, f.field_key || '_as_written', v_value, 'zoho', coalesce(v_created, v_row.received_at), null, v_contact);
    end if;
  end loop;

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client, interaction_id = v_contact,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return v_contact;
end $$;

-- Apply contract: one more importer.
do $patch$
declare
  body text; found integer; f regprocedure := 'public.customer_ingest_apply(text,integer)'::regprocedure;
  old_text constant text := E'        when ''repair_fms'' then perform customer.apply_repair_fms_row(r.id);\n';
  new_text constant text := E'        when ''repair_fms'' then perform customer.apply_repair_fms_row(r.id);\n        when ''zoho'' then perform customer.apply_zoho_row(r.id);\n';
begin
  body := replace(pg_get_functiondef(f), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then raise exception '0422: expected 1 match in customer_ingest_apply, found %', found; end if;
  execute replace(body, old_text, new_text);
end $patch$;

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;
