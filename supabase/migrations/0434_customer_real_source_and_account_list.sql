-- 0434: customer master database - the real source, never the centralized
-- sheet; and the Account List tab (Mumbai's billing software).
--
-- Owner, 2026-11-19: "in the source, the centralized data sheet should never
-- be mentioned. it is just like another master sheet which we are building.
-- in the centralized master sheet there is a column called SOURCE OF
-- WALK-IN. only this should be mentioned as the source." And: the Account
-- List tab is Mumbai's billing software data.
--
-- 1. Real source
--   * Rows of the MASTER DATABASE layout (MASTER DATABASE, ALL OLD FINAL DATA,
--     NO NAME, NO NUMBER, BANGALORE BUYER LIST) take their source from SOURCE
--     OF WALK-IN, as written (0427 used FIRST INTERACTION SOURCE; that column
--     stays an answer). Rows already imported are corrected from their stored
--     sheet row.
--   * A customer's first source (clients.first_origin), each answer and each
--     contact show that source. When the row names none, they show "Source not
--     recorded". The other tabs show what they are ("Buyer list", "Wrong number
--     list", ...), never "Centralized".
-- 2. Account List (16,999 rows; read-only probe 2026-11-18)
--   * Columns A/c Name, Group, Location, City, Phone, Mobile, Date Of Birth,
--     Anniversary. No unique column: read by row number; identical rows are
--     one person, and a number joins the customer who has it.
--   * Group CUSTOMER (16,632), PLATINUM, SILVER, BRONZE are customers. Other
--     groups (SUPPLIER, SALESMAN, KARIGAR, BANK, expenses, loans, taxes, ...)
--     are not customers: their rows are kept in the sheet's own table and
--     marked rejected with the group, nothing else is made from them.
--   * The real source is "Billing software"; it ranks 5, above every sheet.
--     A billing software customer has bought from us, so is a client. Group
--     is kept as written ("Software group"); Location as "Area".
--   * Mumbai's. One-time.

-- ---------------------------------------------------------------------------
-- 1. Names that never say "centralized"
-- ---------------------------------------------------------------------------
update customer.sources s set label = v.label
  from (values ('master_sheet', 'Source not recorded'), ('master_old_final', 'Source not recorded'),
               ('master_no_name', 'Source not recorded'), ('master_no_number', 'Source not recorded'),
               ('master_buyer_list', 'Buyer list'), ('master_dont_contact', 'Do not contact list'),
               ('master_wrong_number', 'Wrong number list'), ('master_bangalore_buyers', 'Bangalore buyer list'),
               ('master_scot', 'SCOT calling list'), ('master_chirayu_app', 'Chirayu app')) as v(source, label)
 where s.source = v.source;
update customer.source_tables t set label = s.label from customer.sources s where s.source = t.source and t.source like 'master\_%';

-- ---------------------------------------------------------------------------
-- 2. A customer's first source
-- ---------------------------------------------------------------------------
alter table customer.clients add column first_origin text default nullif(current_setting('customer.current_origin', true), '');

create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0434: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- The MASTER DATABASE layout takes its source from SOURCE OF WALK-IN.
select customer._patch('customer.apply_master_sheet_row(uuid)'::regprocedure,
  E'v_origin := customer.sheet_value(p ->> ''FIRST INTERACTION SOURCE'');',
  E'v_origin := customer.sheet_value(p ->> ''SOURCE OF WALK-IN'');', 1);
select customer._patch('customer.apply_master_sheet_row(uuid)'::regprocedure,
  E'''process_name'', ''Centralized client database''', E'''process_name'', v_origin', 1);

-- Rows already imported, corrected from their stored sheet row.
create temp table master_origins as
select r.id, customer.sheet_value(customer.row_values(r.payload) ->> 'SOURCE OF WALK-IN') as origin
  from customer.ingest_rows r join customer.source_tables st on st.source = r.source and st.importer = 'master_sheet';
create index on master_origins (id);
insert into customer.origins (origin, label) select distinct origin, origin from master_origins where origin is not null on conflict do nothing;
update customer.client_field_values v set origin = m.origin from master_origins m where v.source_row = m.id and v.origin is distinct from m.origin;
update customer.interactions i set origin = m.origin, process_name = m.origin
  from master_origins m where i.source_row = m.id and (i.origin is distinct from m.origin or i.process_name = 'Centralized client database');
update customer.clients c set first_origin = m.origin from master_origins m where c.source_row = m.id and m.origin is not null;
update customer.clients c set first_origin = 'Chirayu app' where c.first_source = 'master_chirayu_app' and c.first_origin is null;
drop table master_origins;

-- ---------------------------------------------------------------------------
-- 3. The screens show the real source
-- ---------------------------------------------------------------------------
select customer._patch('public.customer_get_client_page(text)'::regprocedure,
  'v.value, v.source, s.label as source_label,', 'v.value, v.source, coalesce(v.origin, s.label) as source_label,', 1);
select customer._patch('public.customer_get_client_page(text)'::regprocedure,
$old$      select coalesce(jsonb_agg(jsonb_build_object('source', t.source, 'label', coalesce(st.label, s.label), 'rows', t.n) order by t.n desc), '[]'::jsonb)
      from (select r.source, count(*) n from customer.ingest_rows r
             where r.client_id = v_client.id and r.status <> 'removed' group by r.source) t$old$,
$new$      select coalesce(jsonb_agg(jsonb_build_object('source', t.source, 'label', coalesce(t.origin, st.label, s.label), 'rows', t.n) order by t.n desc), '[]'::jsonb)
      from (select r.source, case when rt.importer = 'master_sheet' then customer.sheet_value(customer.row_values(r.payload) ->> 'SOURCE OF WALK-IN') end as origin, count(*) n
              from customer.ingest_rows r left join customer.source_tables rt on rt.source = r.source
             where r.client_id = v_client.id and r.status <> 'removed' group by 1, 2) t$new$, 1);
select customer._patch('public.customer_get_interaction_page(text)'::regprocedure,
  E'''source_label'', (select s.label from customer.sources s where s.source = i.source)',
  E'''source_label'', coalesce(i.origin, (select s.label from customer.sources s where s.source = i.source))', 1);
-- The list: filter and count by the real first source.
select customer._patch('public.customer_list(jsonb,integer,integer)'::regprocedure,
  'and (v_sources is null or c.first_source = any (v_sources))', 'and (v_sources is null or coalesce(c.first_origin, c.first_source) = any (v_sources))', 1);
select customer._patch('public.customer_list(jsonb,integer,integer)'::regprocedure,
  E'''first_source'', p.first_source,', E'''first_source'', p.first_source, ''first_origin'', p.first_origin,', 1);
select customer._patch('public.customer_list_filters(text)'::regprocedure,
$old$                        from (select first_source, count(*) n from customer.clients$old$,
$new$                        from (select coalesce(first_origin, first_source) as first_source, count(*) n from customer.clients$new$, 1);
select customer._patch('public.customer_list_filters(text)'::regprocedure,
  'and first_source is not null group by first_source) t', 'and first_source is not null group by 1) t', 1);

-- ---------------------------------------------------------------------------
-- 4. Account List: Mumbai's billing software
-- ---------------------------------------------------------------------------
insert into customer.sources (source, source_rank, label) values ('software_account_list', 5, 'Billing software') on conflict (source) do nothing;
alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling',
                      'order_fms', 'repair_fms', 'zoho', 'exhibition', 'exhibition_old', 'customer_data', 'master_sheet',
                      'wrong_number', 'dont_contact', 'buyer_list', 'scot', 'chirayu_app', 'account_list'));
insert into customer.source_tables (source, table_name, label, importer, one_time, franchise_code)
select 'software_account_list', 'sheet_software_account_list', 'Billing software', 'account_list', true,
       (select code from public.franchise_groups where lower(btrim(name)) = 'mumbai' order by created_at limit 1);

create function customer.apply_account_list_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_changed timestamptz; v_at timestamptz; v_client uuid;
  v_group text; v_mobile text; v_phone text; v_name text; v_value text; v_date text; f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or not exists (select 1 from customer.source_tables where source = v_row.source and importer = 'account_list') then
    raise exception 'Account list row not found' using errcode = '22023';
  end if;
  v_tenant := v_row.tenant_id;
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  p := customer.row_values(v_row.payload);
  v_group := upper(customer.sheet_value(p ->> 'Group'));
  if coalesce(v_group, '') not in ('CUSTOMER', 'PLATINUM', 'SILVER', 'BRONZE') then
    -- Kept in the sheet's own table; nothing else is made from it.
    raise exception 'Not a customer account (Group %)', coalesce(v_group, 'blank') using errcode = '22023';
  end if;
  v_at := v_row.received_at;
  v_name := customer.sheet_value(p ->> 'A/c Name');
  v_mobile := customer.sheet_value(p ->> 'Mobile');
  v_phone := customer.sheet_value(p ->> 'Phone');
  perform set_config('customer.current_origin', 'Billing software', true);

  if customer.normalize_phone(v_mobile) is not null then
    v_client := customer.find_or_create_client(v_tenant, v_mobile, v_name, v_row.source, v_at,
      case when customer.normalize_phone(v_phone) is not null and customer.normalize_phone(v_phone) <> customer.normalize_phone(v_mobile)
           then array[v_phone] else '{}'::text[] end, null, null, v_row.id);
  else
    -- Identical rows are one person.
    v_client := customer.resolve_client(v_tenant, coalesce(case when customer.normalize_phone(v_phone) is not null then v_phone end, v_mobile, v_phone),
      v_name, v_row.source, v_at, null, null, v_row.source || ':' || md5(p::text), v_row.id);
  end if;
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';

  perform customer.set_source_field(v_client, 'software_group', v_group, v_row.source, v_at, v_changed, null);
  v_value := customer.sheet_value(regexp_replace(coalesce(p ->> 'City', ''), '^[\s.,-]+', ''));
  if v_value is not null then perform customer.set_source_field(v_client, 'city', v_value, v_row.source, v_at, v_changed, null); end if;
  v_value := customer.sheet_value(regexp_replace(coalesce(p ->> 'Location', ''), '^[\s.,-]+', ''));
  if v_value is not null then perform customer.set_source_field(v_client, 'area', v_value, v_row.source, v_at, v_changed, null); end if;
  for f in select * from (values ('Date Of Birth', 'dob'), ('Anniversary.', 'anniversary')) as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    continue when v_value is null;
    v_date := customer.as_iso_date(v_value, 'dmy');
    perform customer.set_source_field(v_client, case when v_date is null then f.field_key || '_as_written' else f.field_key end,
      coalesce(v_date, v_value), v_row.source, v_at, v_changed, null);
  end loop;

  perform customer.refresh_client_stats(v_client);
  perform set_config('customer.current_origin', '', true);
  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return null;
end $$;

-- A billing software customer has bought from us.
select customer._patch('customer.refresh_client_stats(uuid)'::regprocedure,
  E'or field_key = ''client_category''));', E'or field_key in (''client_category'', ''software_group'')));', 1);
drop trigger client_field_values_buyer_mark_added on customer.client_field_values;
drop trigger client_field_values_buyer_mark_removed on customer.client_field_values;
create trigger client_field_values_buyer_mark_added after insert on customer.client_field_values
  for each row when (new.field_key in ('buyer_status', 'client_category', 'software_group')) execute function customer.on_buyer_mark_changed();
create trigger client_field_values_buyer_mark_removed after delete on customer.client_field_values
  for each row when (old.field_key in ('buyer_status', 'client_category', 'software_group')) execute function customer.on_buyer_mark_changed();

select customer._patch('public.customer_ingest_apply(text,integer)'::regprocedure,
  E'        when ''master_sheet'' then perform customer.apply_master_sheet_row(r.id);\n',
  E'        when ''master_sheet'' then perform customer.apply_master_sheet_row(r.id);\n        when ''account_list'' then perform customer.apply_account_list_row(r.id);\n', 1);

drop function customer._patch(regprocedure, text, text, integer);

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function customer.delete_sheet(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;
