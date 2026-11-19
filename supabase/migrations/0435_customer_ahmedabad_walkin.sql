-- 0435: customer master database - Ahmedabad walk-ins (sheet "WALKIN DATA
-- (AHMEDABAD)": tabs WALKIN DATASET, FAMILY DATA, REFERRALS).
--
-- Owner, 2026-11-19:
--   * Ahmedabad's data is Ahmedabad's: the same sources as Mumbai, kept apart.
--   * "a same person can walk in both stores - mumbai and ahmedabad as well.
--     so there should be both records stored. but if the person did walkin in
--     ahmedabad, then he should be stored in ahmedabad data. and if he did
--     walkin only in mumbai, then in mumbai data."
--   * BRANCH CGR is CG ROAD AHMEDABAD; SBR is SINDHU BHAVAN AHMEDABAD.
--
-- Facts (read-only probes 2026-11-19): WALKIN DATASET headers on row 3, 6,604
-- rows, REFERENCE NUMBER unique, the Mumbai walk-in form's columns plus
-- WHAT GOLD RATE WAS APPLIED..., FORM FILLED BY, FINAL STATUS and "(FINAL)"
-- copies. FAMILY DATA headers on row 1, 1,803 rows (Mumbai's family layout).
-- REFERRALS headers on row 1, 165 rows: CRM NAME, SALES PERSON NAME,
-- REFERENCE GIVEN BY CLIENT NAME, REFERRAL NAME, NUMBER, LOCATION OF REFERRAL,
-- RELIGION OF REFERRAL - no timestamp.
--
-- 1. Three Ahmedabad sources, read by the Mumbai walk-in and family importers
--    (now by source, not by name), and a referral-list importer.
-- 2. Which city a person is in is decided by walk-ins:
--    * An Ahmedabad walk-in (or family row) for a number held only by a
--      Mumbai record with no Mumbai walk-in moves that record to Ahmedabad
--      (audited). A Mumbai record with a Mumbai walk-in stays, and the person
--      gets a separate Ahmedabad record. The same rule works the other way.
--    * A list (any source that is not a walk-in, family or referral sheet)
--      first looks in its own city; when the number is not there, it uses the
--      person's record in the other city if that record has a walk-in there.
--      So a Mumbai list row never recreates in Mumbai someone who walked in
--      only in Ahmedabad.
-- 3. CGR and SBR are the two Ahmedabad stores (customer.branch_aliases).
-- 4. Ahmedabad's extra walk-in columns are kept as answers: gold rate
--    applied, form filled by, final status. The "(FINAL)" copies, photo and
--    proof links stay in the sheet's own table.
-- 5. REFERRALS has no date and names the giver only by name: the referred
--    person becomes an Ahmedabad lead; the giver's name, location and
--    religion are kept as written; no giver is guessed from a name.

create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0435: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Sources
-- ---------------------------------------------------------------------------
insert into customer.sources (source, source_rank, label) values
  ('ahd_walkin', 4, 'Ahmedabad walk-in form'),
  ('ahd_walkin_family', 4, 'Ahmedabad walk-in family data'),
  ('ahd_referral', 1, 'Ahmedabad referral')
on conflict (source) do nothing;

alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling',
                      'order_fms', 'repair_fms', 'zoho', 'exhibition', 'exhibition_old', 'customer_data', 'master_sheet',
                      'wrong_number', 'dont_contact', 'buyer_list', 'scot', 'chirayu_app', 'account_list', 'referral_list'));
insert into customer.source_tables (source, table_name, label, importer, one_time, franchise_code)
select v.source, v.table_name, v.label, v.importer, false,
       (select code from public.franchise_groups where lower(btrim(name)) = 'ahmedabad' order by created_at limit 1)
  from (values ('ahd_walkin', 'sheet_ahmedabad_walkin', 'Ahmedabad walk-in form', 'walkin'),
               ('ahd_walkin_family', 'sheet_ahmedabad_walkin_family', 'Ahmedabad walk-in family data', 'walkin_family'),
               ('ahd_referral', 'sheet_ahmedabad_referrals', 'Ahmedabad referral', 'referral_list')) as v(source, table_name, label, importer);

-- ---------------------------------------------------------------------------
-- 2. The walk-in and family importers work by source
-- ---------------------------------------------------------------------------
do $$
declare body text; n integer;
begin
  body := replace(pg_get_functiondef('customer.apply_walkin_row(uuid)'::regprocedure), E'\r', '');
  if position('v_row.source <> ''walkin''' in body) = 0 then raise exception '0435: walk-in check not found'; end if;
  body := replace(body, 'v_row.source <> ''walkin''',
    'not exists (select 1 from customer.source_tables where source = v_row.source and importer = ''walkin'')');
  body := replace(body, '''walkin:'' || v_row.row_key', 'v_row.source || '':'' || v_row.row_key');
  n := regexp_count(body, '''walkin''');
  -- 13 source arguments, plus the importer name in the check just written.
  if n <> 14 then raise exception '0435: expected 14 walk-in literals, found %', n; end if;
  body := replace(body, '''walkin''', 'v_row.source');
  body := replace(body, 'importer = v_row.source', 'importer = ''walkin''');
  if position('x.source = ''referral''' in body) = 0 then raise exception '0435: referral lookup not found'; end if;
  body := replace(body, 'x.source = ''referral''',
    'x.source in (select st.source from customer.source_tables st where st.importer = ''referral'' and st.franchise_code is not distinct from (select st2.franchise_code from customer.source_tables st2 where st2.source = v_row.source))');
  execute body;

  body := replace(pg_get_functiondef('customer.apply_walkin_family_row(uuid)'::regprocedure), E'\r', '');
  if position('v_row.source <> ''walkin_family''' in body) = 0 then raise exception '0435: family check not found'; end if;
  body := replace(body, 'v_row.source <> ''walkin_family''',
    'not exists (select 1 from customer.source_tables where source = v_row.source and importer = ''walkin_family'')');
  n := regexp_count(body, '''walkin_family''');
  if n <> 8 then raise exception '0435: expected 8 family literals, found %', n; end if;
  body := replace(body, '''walkin_family''', 'v_row.source');
  body := replace(body, 'importer = v_row.source', 'importer = ''walkin_family''');
  execute body;
end $$;

-- Ahmedabad's extra walk-in columns, as answers (absent from Mumbai's form, so nothing changes there).
select customer._patch('customer.apply_walkin_row(uuid)'::regprocedure,
  E'(''REFERRALS - NO REASON'', null, ''referrals_no_reason'')) as m(header, other, field_key)',
  E'(''REFERRALS - NO REASON'', null, ''referrals_no_reason''),\n'
  || E'      (''WHAT GOLD RATE WAS APPLIED TO THIS PRODUCT FOR THE CLIENT?'', null, ''gold_rate_applied''),\n'
  || E'      (''FORM FILLED BY'', null, ''form_filled_by''), (''FINAL STATUS'', null, ''final_status'')) as m(header, other, field_key)', 1);

-- ---------------------------------------------------------------------------
-- 3. Walk-ins decide the city
-- ---------------------------------------------------------------------------
create function customer.has_walkin(p_client_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from customer.ingest_rows r join customer.source_tables st on st.source = r.source
                  where r.client_id = p_client_id and r.status <> 'removed' and st.importer in ('walkin', 'walkin_family'));
$$;

-- A walk-in in this import's city for a number held only by a record in the
-- other city that has no walk-in there: that record moves to this city.
create function customer.claim_for_franchise(p_tenant_id uuid, p_phones text[], p_source_row uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_franchise uuid := customer.current_import_franchise(); v_phone text; v_client uuid; v_from uuid;
begin
  if v_franchise is null then return; end if;
  foreach v_phone in array coalesce(p_phones, '{}') loop
    v_phone := customer.normalize_phone(v_phone);
    continue when v_phone is null;
    continue when exists (select 1 from customer.client_phones p
                           where p.tenant_id = p_tenant_id and p.franchise_group_id = v_franchise and p.phone = v_phone);
    select c.id, c.franchise_group_id into v_client, v_from
      from customer.client_phones p join customer.clients c on c.id = p.client_id
     where p.tenant_id = p_tenant_id and p.phone = v_phone and c.franchise_group_id is distinct from v_franchise
       and c.merged_into_client_id is null
     order by p.first_seen_at, c.id limit 1;
    continue when v_client is null or customer.has_walkin(v_client);
    -- None of its numbers may already belong to someone in this city.
    continue when exists (select 1 from customer.client_phones mine join customer.client_phones here
                             on here.tenant_id = mine.tenant_id and here.phone = mine.phone and here.franchise_group_id = v_franchise
                           where mine.client_id = v_client);
    update customer.clients set franchise_group_id = v_franchise where id = v_client;
    update customer.client_phones set franchise_group_id = v_franchise where client_id = v_client;
    update customer.client_identifiers set franchise_group_id = v_franchise where client_id = v_client;
    insert into public.audit_logs (tenant_id, action, module, record_id, old_value, new_value)
    values (p_tenant_id, 'customer_moved_franchise', 'customer', v_client,
            jsonb_build_object('franchise_group_id', v_from), jsonb_build_object('franchise_group_id', v_franchise, 'source_row', p_source_row));
  end loop;
end $$;

select customer._patch('customer.apply_walkin_row(uuid)'::regprocedure,
  E'  -- 3.1 Who ---------------------------------------------------------------------\n',
  E'  -- 3.1 Who ---------------------------------------------------------------------\n'
  || E'  -- A walk-in here decides the city (migration 0435).\n'
  || E'  perform customer.claim_for_franchise(v_tenant, array[p ->> ''CLIENT PHONE'', p ->> ''BILLING PHONE'',\n'
  || E'    p ->> ''COMPANION 1 MOBILE'', p ->> ''COMPANION 2 MOBILE'', p ->> ''COMPANION 3 MOBILE'', p ->> ''COMPANION 4 MOBILE'', p ->> ''COMPANION 5 MOBILE'',\n'
  || E'    p ->> ''COMPANION 6 MOBILE'', p ->> ''COMPANION 7 MOBILE'', p ->> ''COMPANION 8 MOBILE'', p ->> ''COMPANION 9 MOBILE'', p ->> ''COMPANION 10 MOBILE''], v_row.id);\n', 1);
select customer._patch('customer.apply_walkin_family_row(uuid)'::regprocedure,
  E'importer = ''walkin_family'') then raise exception ''Family row not found'' using errcode = ''22023''; end if;\n',
  E'importer = ''walkin_family'') then raise exception ''Family row not found'' using errcode = ''22023''; end if;\n'
  || E'  perform customer.claim_for_franchise(v_row.tenant_id, array[v_row.payload ->> ''NUMBER''], v_row.id);\n', 1);

-- A list finds the person in the city where they walked in.
create function customer.lists_follow_walkins()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('customer.lists_follow_walkins', true), '') = 'on';
$$;
select customer._patch('customer.find_or_create_client(uuid,text,text,text,timestamp with time zone,text[],text,uuid,uuid)'::regprocedure,
$old$  select client_id into v_client from customer.client_phones
   where tenant_id = p_tenant_id and customer.same_franchise(franchise_group_id) and phone = v_phone;

  if v_client is null then
    -- Two imports$old$,
$new$  select client_id into v_client from customer.client_phones
   where tenant_id = p_tenant_id and customer.same_franchise(franchise_group_id) and phone = v_phone;
  -- A list row whose person walked in only in the other city: that record (migration 0435).
  if v_client is null and customer.lists_follow_walkins() then
    select p.client_id into v_client from customer.client_phones p join customer.clients c on c.id = p.client_id
     where p.tenant_id = p_tenant_id and p.phone = v_phone and c.merged_into_client_id is null and customer.has_walkin(c.id)
     order by p.first_seen_at, p.client_id limit 1;
  end if;

  if v_client is null then
    -- Two imports$new$, 1);
select customer._patch('public.customer_ingest_apply(text,integer)'::regprocedure,
  E'  -- Everything this source creates or matches belongs to its franchise.\n',
  E'  -- A list (not a walk-in, family or referral sheet) follows a person to the city they walked in (0435).\n'
  || E'  perform set_config(''customer.lists_follow_walkins'', case when v_importer in (''walkin'', ''walkin_family'', ''referral'', ''referral_list'') then '''' else ''on'' end, true);\n'
  || E'  -- Everything this source creates or matches belongs to its franchise.\n', 1);

-- ---------------------------------------------------------------------------
-- 4. CGR and SBR
-- ---------------------------------------------------------------------------
create table customer.branch_aliases (
  alias text primary key check (alias = upper(btrim(alias))),
  branch_code text not null
);
alter table customer.branch_aliases enable row level security;
revoke all on customer.branch_aliases from public, anon, authenticated;
grant all on customer.branch_aliases to service_role;
insert into customer.branch_aliases (alias, branch_code) values ('CGR', 'CGA'), ('SBR', 'SBA');
comment on table customer.branch_aliases is 'Short store names written in sheets, and the store (branches.code) they mean. Owner, 2026-11-19.';

select customer._patch('customer.resolve_branch(uuid,text)'::regprocedure,
  E'  if v_key is null then return null; end if;\n',
  E'  if v_key is null then return null; end if;\n'
  || E'  select b.id into v_id from customer.branch_aliases a join public.branches b on b.tenant_id = p_tenant_id and b.code = a.branch_code\n'
  || E'   where a.alias = upper(btrim(p_name));\n'
  || E'  if v_id is not null then return v_id; end if;\n', 1);

-- ---------------------------------------------------------------------------
-- 5. REFERRALS (Ahmedabad layout)
-- ---------------------------------------------------------------------------
create function customer.apply_referral_list_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_row customer.ingest_rows; p jsonb; v_changed timestamptz; v_at timestamptz; v_client uuid; v_value text; f record;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or not exists (select 1 from customer.source_tables where source = v_row.source and importer = 'referral_list') then
    raise exception 'Referral row not found' using errcode = '22023';
  end if;
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  p := customer.row_values(v_row.payload);
  if upper(coalesce(p ->> 'REFERRAL NAME', '')) = 'REFERRAL NAME' then raise exception 'Header row inside the data' using errcode = '22023'; end if;
  v_at := v_row.received_at;
  v_client := customer.resolve_client(v_row.tenant_id, p ->> 'NUMBER', customer.sheet_value(p ->> 'REFERRAL NAME'), v_row.source, v_at,
    null, null, v_row.source || ':' || v_row.row_key, v_row.id);
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';
  for f in select * from (values ('REFERENCE GIVEN BY CLIENT NAME', 'referred_by_name'), ('LOCATION OF REFERRAL', 'referral_location'),
                                 ('RELIGION OF REFERRAL', 'referral_religion'), ('CRM NAME', 'referral_noted_by'),
                                 ('SALES PERSON NAME', 'referral_salesperson')) as m(header, field_key) loop
    v_value := customer.sheet_value(p ->> f.header);
    continue when v_value is null;
    perform customer.set_source_field(v_client, f.field_key, v_value, v_row.source, v_at, v_changed, null);
  end loop;
  perform customer.refresh_client_stats(v_client);
  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return null;
end $$;

select customer._patch('public.customer_ingest_apply(text,integer)'::regprocedure,
  E'        when ''account_list'' then perform customer.apply_account_list_row(r.id);\n',
  E'        when ''account_list'' then perform customer.apply_account_list_row(r.id);\n        when ''referral_list'' then perform customer.apply_referral_list_row(r.id);\n', 1);

drop function customer._patch(regprocedure, text, text, integer);

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function customer.delete_sheet(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;
