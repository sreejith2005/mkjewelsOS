-- 0436: customer master database - one person with two numbers, families
-- found through shared numbers, and the "AHEMDABAD list" tab.
--
-- Owner, 2026-11-19:
--   * "sometimes we get same client with multiple phone numbers. so all these
--     need to be stored ... wherever you can understand the phone number is of
--     the same person, or it is the billing number of the same client. and you
--     can also understand family data in this way."
--   * "you can only merge them into same person if the other phone number was
--     found in any other record with the previous phone number. dont just merge
--     them just because they have the same name. the data has to match."
--   * Approved rule (this chat): two customers whose numbers appear together on
--     a sheet row are
--       - one person, joined into one customer, only when their numbers appear
--         together on at least 2 different sheet rows AND they share a name;
--       - otherwise put in the same family, each kept as a customer; when they
--         share a name (but only one row joins them) both are also flagged
--         "possibly the same person";
--       - never joined or linked across franchises (Mumbai / Ahmedabad);
--       - a do-not-contact person can be joined; the joined customer stays do
--         not contact.
--     Chains (A with B, B with C) end as one customer. Every join and family
--     link is audited with the rows that proved it. The rule runs once over the
--     whole database and after every import batch from now on.
--   * "AHEMDABAD list" (tab of MK CENTRALIZED CLIENT DATABASE, headers on row
--     1, 4,268 rows, read-only probe 2026-11-19): NAME, NUMBER 1, NUMBER 2,
--     NUMBER 3 (a cell can hold two numbers, comma-separated), ADDRESS, SOURCE.
--     Ahmedabad's. SOURCE is the real source: "KAJAL MOTWANI CONTACT" (4,248)
--     and "AHEMDABAD STORE ACCOUNT LIST" (20, Ahmedabad's billing software:
--     they bought, so they are clients). Not live yet, but rows will be added.
--
-- What was there before: when a row's second or billing number already
-- belonged to another customer, the number was not added and the pair went to
-- customer.identity_review, which no one could see (292 open pairs on
-- 2026-11-19).
--
-- Also fixed in merge_clients:
--   * the sheet rows of the removed customer now move to the kept one (safe
--     delete, the walk-in city rule and the page's "sheet rows" read them);
--   * a do-not-contact customer can be merged (it was refused as archived).

create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0436: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Which columns of a sheet hold the row's own person's numbers
-- ---------------------------------------------------------------------------
-- Only layouts with more than one such column can show two numbers of one
-- person. Companion, reference and referral numbers are other people and are
-- not listed.
create table customer.identity_phone_columns (
  importer text not null,
  header text not null,
  primary key (importer, header)
);
comment on table customer.identity_phone_columns is
  'Columns that hold the row''s own person''s numbers, per importer (migration 0436). Two of them on one row are evidence that the numbers belong together.';
insert into customer.identity_phone_columns (importer, header) values
  ('runo', 'Mobile Number'), ('runo', 'Billing Phone Number Add +91'),
  ('walkin', 'CLIENT PHONE'), ('walkin', 'BILLING PHONE'),
  ('not_bought_fms', 'PHONE NUMBER OF THE CLIENT'), ('not_bought_fms', 'BILLING PHONE NUMBER'),
  ('exhibition', 'PHONE 1'), ('exhibition', 'PHONE 2'),
  ('exhibition_old', 'MOBILE NUMBER'), ('exhibition_old', 'ALTERNATE NUMBER'),
  ('customer_data', 'MOBILE NO'), ('customer_data', 'WHATSAPP NUMBER'),
  ('account_list', 'Mobile'), ('account_list', 'Phone'),
  ('contact_list', 'NUMBER 1'), ('contact_list', 'NUMBER 2'), ('contact_list', 'NUMBER 3');

-- The valid numbers of the row's own person, cleaned. A cell may hold several, comma-separated.
create function customer.row_identity_phones(p_source text, p_payload jsonb)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct n.phone), '{}')
    from customer.source_tables st
    join customer.identity_phone_columns c on c.importer = st.importer
    cross join lateral (select customer.row_values(p_payload) as p) v
    cross join lateral unnest(string_to_array(v.p ->> c.header, ',')) as x(part)
    cross join lateral (select case when st.importer = 'customer_data' and c.header = 'MOBILE NO'
                                    then customer.normalize_phone(customer.phone_with_code(v.p ->> 'COUNTRY CODE', btrim(x.part)))
                                    else customer.normalize_phone(btrim(x.part)) end as phone) n
   where st.source = p_source and n.phone is not null;
$$;

-- Each stored row with two or more such numbers, indexed by number.
create table customer.row_phones (
  row_id uuid not null references customer.ingest_rows(id) on delete cascade,
  phone text not null,
  primary key (row_id, phone)
);
create index row_phones_phone_idx on customer.row_phones (phone, row_id);
comment on table customer.row_phones is
  'The own-person numbers of each sheet row that holds two or more (migration 0436): evidence for joining customers and linking families.';

create function customer.on_ingest_row_phones()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_phones text[];
begin
  if tg_op = 'UPDATE' and new.payload is not distinct from old.payload and new.source = old.source then return new; end if;
  delete from customer.row_phones where row_id = new.id;
  v_phones := customer.row_identity_phones(new.source, new.payload);
  if cardinality(v_phones) >= 2 then
    insert into customer.row_phones (row_id, phone) select new.id, x from unnest(v_phones) x on conflict do nothing;
  end if;
  return new;
end $$;
create trigger ingest_rows_phones after insert or update of payload, source on customer.ingest_rows
  for each row execute function customer.on_ingest_row_phones();

-- Rows already stored.
insert into customer.row_phones (row_id, phone)
select r.id, x
  from customer.ingest_rows r
  join customer.source_tables st on st.source = r.source
  cross join lateral (select customer.row_identity_phones(r.source, r.payload) as a) p
  cross join lateral unnest(p.a) x
 where st.importer in (select importer from customer.identity_phone_columns)
   and cardinality(p.a) >= 2
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. The review list learns the new outcomes
-- ---------------------------------------------------------------------------
alter table customer.identity_review drop constraint identity_review_reason_check;
alter table customer.identity_review add constraint identity_review_reason_check
  check (reason in ('two_phones_two_clients', 'previous_number_merge', 'ambiguous', 'possible_same_person'));
alter table customer.identity_review drop constraint identity_review_status_check;
alter table customer.identity_review add constraint identity_review_status_check
  check (status in ('open', 'merged', 'dismissed', 'linked'));
alter table customer.identity_review add column outcome text;
comment on column customer.identity_review.outcome is 'What the automatic check of migration 0436 decided, and why.';
create index identity_review_possible_a_idx on customer.identity_review (client_a) where status = 'open' and reason = 'possible_same_person';
create index identity_review_possible_b_idx on customer.identity_review (client_b) where status = 'open' and reason = 'possible_same_person';

-- ---------------------------------------------------------------------------
-- 3. merge_clients: sheet rows move; a do-not-contact customer can be joined
-- ---------------------------------------------------------------------------
select customer._patch('customer.merge_clients(uuid,uuid,text,uuid)'::regprocedure,
$old$  if v_keep.archived_at is not null or v_remove.archived_at is not null then$old$,
$new$  if (v_keep.archived_at is not null and v_keep.archive_reason is distinct from 'do_not_contact')
     or (v_remove.archived_at is not null and v_remove.archive_reason is distinct from 'do_not_contact') then$new$, 1);

select customer._patch('customer.merge_clients(uuid,uuid,text,uuid)'::regprocedure,
$old$  perform customer.merge_related(v_keep.id, v_remove.id);$old$,
$new$  -- The removed customer's sheet rows belong to the kept one (migration 0436).
  update customer.ingest_rows set client_id = v_keep.id where client_id = v_remove.id;
  -- A family of the removed customer becomes the kept customer's when the kept one has none.
  if v_remove.household_id is distinct from v_keep.household_id
     and exists (select 1 from customer.clients x where x.household_id = v_remove.household_id and x.id <> v_remove.id and x.merged_into_client_id is null)
     and not exists (select 1 from customer.clients x where x.household_id = v_keep.household_id and x.id <> v_keep.id and x.merged_into_client_id is null) then
    update customer.clients set household_id = v_remove.household_id where id = v_keep.id;
  end if;
  perform customer.merge_related(v_keep.id, v_remove.id);$new$, 1);

select customer._patch('customer.merge_clients(uuid,uuid,text,uuid)'::regprocedure,
$old$  perform customer.refresh_primary_name(v_keep.id);
  for v_key in$old$,
$new$  -- A do-not-contact person stays do not contact once joined (migration 0436).
  if v_remove.archive_reason = 'do_not_contact' or v_keep.archive_reason = 'do_not_contact' then
    update customer.clients
       set do_not_call = true, archived_at = coalesce(archived_at, now()), archive_reason = 'do_not_contact'
     where id = v_keep.id;
    update customer.follow_ups set status = 'cancelled' where client_id = v_keep.id and status = 'pending';
    update customer.appointments set status = 'cancelled' where client_id = v_keep.id and status = 'booked';
  end if;
  perform customer.refresh_primary_name(v_keep.id);
  for v_key in$new$, 1);

-- ---------------------------------------------------------------------------
-- 4. The check: join, family, or "possibly the same person"
-- ---------------------------------------------------------------------------
-- The customer a record now is (follows merges).
create function customer.current_client(p_client_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := p_client_id; v_next uuid; i integer := 0;
begin
  loop
    select merged_into_client_id into v_next from customer.clients where id = v;
    exit when v_next is null or i > 20;
    v := v_next; i := i + 1;
  end loop;
  return case when exists (select 1 from customer.clients where id = v) then v end;
end $$;

-- The sheet rows of the customers' franchise on which a number of one and a
-- number of the other appear together.
create function customer.pair_evidence(p_a uuid, p_b uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.row_id), '{}')
    from customer.row_phones x
    join customer.row_phones y on y.row_id = x.row_id
    join customer.ingest_rows r on r.id = x.row_id and r.status <> 'removed'
    join customer.source_tables st on st.source = r.source
    left join public.franchise_groups f on f.code = st.franchise_code and f.tenant_id = r.tenant_id
   where x.phone in (select p.phone from customer.client_phones p where p.client_id = p_a)
     and y.phone in (select p.phone from customer.client_phones p where p.client_id = p_b)
     and f.id is not distinct from (select c.franchise_group_id from customer.clients c where c.id = p_a);
$$;

-- Put two customers in one family: the one who is alone joins the other's family.
create function customer.link_family(p_a uuid, p_b uuid, p_evidence uuid[])
returns text language plpgsql security definer set search_path = '' as $$
declare ca customer.clients; cb customer.clients; na integer; nb integer; v_moved uuid; v_to uuid;
begin
  select * into ca from customer.clients where id = p_a for update;
  select * into cb from customer.clients where id = p_b for update;
  if ca.household_id = cb.household_id then return 'already_family'; end if;
  select count(*) into na from customer.clients where household_id = ca.household_id and merged_into_client_id is null;
  select count(*) into nb from customer.clients where household_id = cb.household_id and merged_into_client_id is null;
  if nb <= 1 then v_moved := cb.id; v_to := ca.household_id;
  elsif na <= 1 then v_moved := ca.id; v_to := cb.household_id;
  else return 'both_have_families';  -- two families are never joined by one number
  end if;
  update customer.households set main_client_id = null
   where id = (select household_id from customer.clients where id = v_moved) and main_client_id = v_moved;
  update customer.clients set household_id = v_to where id = v_moved;
  insert into public.audit_logs (tenant_id, action, module, record_id, new_value)
  values (ca.tenant_id, 'customer_family_linked', 'customer', v_moved,
          jsonb_build_object('client_a', ca.client_code, 'client_b', cb.client_code, 'household_id', v_to, 'evidence_rows', to_jsonb(p_evidence)));
  return 'family_linked';
end $$;

create function customer.reconcile_pair(p_review_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  r customer.identity_review; a uuid; b uuid; ca customer.clients; cb customer.clients;
  v_ev uuid[]; v_same boolean; v_keep uuid; v_remove uuid; v_result text;
begin
  select * into r from customer.identity_review where id = p_review_id and status = 'open' for update skip locked;
  if r.id is null or r.client_b is null or r.reason <> 'two_phones_two_clients' then return 'skipped'; end if;
  a := customer.current_client(r.client_a);
  b := customer.current_client(r.client_b);
  if a is null or b is null then
    update customer.identity_review set status = 'dismissed', resolved_at = now(), outcome = 'customer_deleted' where id = r.id;
    return 'customer_deleted';
  end if;
  if a = b then
    update customer.identity_review set status = 'merged', resolved_at = now(), outcome = 'already_one_customer' where id = r.id;
    return 'already_one_customer';
  end if;
  select * into ca from customer.clients where id = a;
  select * into cb from customer.clients where id = b;
  if ca.franchise_group_id is distinct from cb.franchise_group_id then
    update customer.identity_review set status = 'dismissed', resolved_at = now(), outcome = 'different_franchise' where id = r.id;
    return 'different_franchise';
  end if;

  v_ev := customer.pair_evidence(a, b);
  v_same := exists (select 1 from customer.client_names x join customer.client_names y on y.name_key = x.name_key
                     where x.client_id = a and y.client_id = b);

  if v_same and cardinality(v_ev) >= 2
     and (ca.archived_at is null or ca.archive_reason = 'do_not_contact')
     and (cb.archived_at is null or cb.archive_reason = 'do_not_contact') then
    -- The older record stays, with its codes.
    if coalesce(ca.first_seen_at, 'infinity') < coalesce(cb.first_seen_at, 'infinity')
       or (ca.first_seen_at is not distinct from cb.first_seen_at and ca.client_code <= cb.client_code) then
      v_keep := a; v_remove := b;
    else
      v_keep := b; v_remove := a;
    end if;
    perform customer.merge_clients(v_keep, v_remove, 'same_person_two_numbers', null);
    insert into public.audit_logs (tenant_id, action, module, record_id, new_value)
    values (r.tenant_id, 'customer_same_person_joined', 'customer', v_keep,
            jsonb_build_object('removed_client_id', v_remove, 'phone', r.phone, 'evidence_rows', to_jsonb(v_ev)));
    update customer.identity_review set status = 'merged', resolved_at = now(), outcome = 'joined_same_person'
     where id = r.id and status = 'open';
    return 'joined';
  end if;

  v_result := customer.link_family(a, b, v_ev);
  update customer.identity_review
     set status = 'linked', resolved_at = now(),
         outcome = v_result || case when v_same then ', same name on ' || cardinality(v_ev) || ' row(s)' else ', different names' end
   where id = r.id;
  if v_same then
    insert into customer.identity_review (tenant_id, reason, client_a, client_b, phone, source, source_row, outcome)
    values (r.tenant_id, 'possible_same_person', a, b, r.phone, r.source, r.source_row, 'same name, numbers together on ' || cardinality(v_ev) || ' row(s)')
    on conflict do nothing;
    return 'family_possibly_same';
  end if;
  return 'family';
end $$;

-- Every open pair (of one tenant, or all). A pair that fails is left open.
create function customer.reconcile_open_pairs(p_tenant_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v text; v_counts jsonb := '{}'::jsonb;
begin
  for r in select id from customer.identity_review
            where status = 'open' and reason = 'two_phones_two_clients' and client_b is not null
              and (p_tenant_id is null or tenant_id = p_tenant_id)
            order by created_at, id
  loop
    begin
      v := customer.reconcile_pair(r.id);
    exception when others then
      v := 'error';
    end;
    v_counts := v_counts || jsonb_build_object(v, coalesce((v_counts ->> v)::integer, 0) + 1);
  end loop;
  return v_counts;
end $$;

-- After every import batch (not in the middle of a row, where an importer may
-- still be writing to the customer it found).
select customer._patch('public.customer_ingest_apply(text,integer)'::regprocedure,
  E'  perform customer.project_source_rows(p_source, v_done, false);\n',
  E'  perform customer.project_source_rows(p_source, v_done, false);\n'
  || E'  -- Two numbers on one row that belong to two customers: join, family or flag (migration 0436).\n'
  || E'  if exists (select 1 from customer.identity_review where tenant_id = v_tenant and status = ''open'' and reason = ''two_phones_two_clients'') then\n'
  || E'    perform customer.reconcile_open_pairs(v_tenant);\n'
  || E'  end if;\n', 1);

-- ---------------------------------------------------------------------------
-- 5. "Possibly the same person" on the list and the customer page
-- ---------------------------------------------------------------------------
select customer._patch('customer.client_tags(uuid)'::regprocedure,
  E'    case when c.referred_by_client_id is not null then ''referred'' end,',
  E'    case when exists (select 1 from customer.identity_review r where r.status = ''open'' and r.reason = ''possible_same_person''\n'
  || E'                        and (r.client_a = c.id or r.client_b = c.id)) then ''possible_duplicate'' end,\n'
  || E'    case when c.referred_by_client_id is not null then ''referred'' end,', 1);

select customer._patch('public.customer_get_client_page(text)'::regprocedure,
  E'    ''tags'', customer.client_tags(v_client.id),',
  E'    ''possibly_same_as'', (\n'
  || E'      select coalesce(jsonb_agg(distinct jsonb_build_object(''client_code'', o.client_code, ''name'', o.primary_name)), ''[]''::jsonb)\n'
  || E'        from customer.identity_review r\n'
  || E'        join customer.clients o on o.id = customer.current_client(case when r.client_a = v_client.id then r.client_b else r.client_a end)\n'
  || E'       where r.status = ''open'' and r.reason = ''possible_same_person'' and (r.client_a = v_client.id or r.client_b = v_client.id)\n'
  || E'         and o.id <> v_client.id),\n'
  || E'    ''tags'', customer.client_tags(v_client.id),', 1);

-- ---------------------------------------------------------------------------
-- 6. "AHEMDABAD list"
-- ---------------------------------------------------------------------------
-- Ranked as an old list: it fills gaps and never overrides a walk-in or a call.
insert into customer.sources (source, source_rank, label) values ('ahd_contact_list', 1, 'Ahmedabad list') on conflict (source) do nothing;
alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check
  check (importer in ('runo', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling',
                      'order_fms', 'repair_fms', 'zoho', 'exhibition', 'exhibition_old', 'customer_data', 'master_sheet',
                      'wrong_number', 'dont_contact', 'buyer_list', 'scot', 'chirayu_app', 'account_list', 'referral_list',
                      'contact_list'));
insert into customer.source_tables (source, table_name, label, importer, one_time, franchise_code)
select 'ahd_contact_list', 'sheet_ahmedabad_list', 'Ahmedabad list', 'contact_list', false,
       (select code from public.franchise_groups where lower(btrim(name)) = 'ahmedabad' order by created_at limit 1);

create function customer.apply_contact_list_row(p_ingest_row_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid; v_changed timestamptz; v_at timestamptz; v_client uuid;
  v_origin text; v_name text; v_numbers text[]; v_main text; v_others text[]; v_store boolean; v_value text; v_raw text;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or not exists (select 1 from customer.source_tables where source = v_row.source and importer = 'contact_list') then
    raise exception 'Contact list row not found' using errcode = '22023';
  end if;
  v_tenant := v_row.tenant_id;
  if v_row.attempts > 0 then v_changed := v_row.updated_at; end if;
  p := customer.row_values(v_row.payload);
  if upper(coalesce(p ->> 'NAME', '')) = 'NAME' and upper(coalesce(p ->> 'SOURCE', '')) = 'SOURCE' then
    raise exception 'Header row inside the data' using errcode = '22023';
  end if;
  v_at := v_row.received_at;
  v_name := customer.sheet_value(p ->> 'NAME');
  v_origin := customer.sheet_value(p ->> 'SOURCE');
  -- The store's account list is Ahmedabad's billing software: these people bought from us.
  v_store := upper(coalesce(v_origin, '')) like '%ACCOUNT LIST%';

  -- Every number in sheet order; a cell may hold several.
  select coalesce(array_agg(t.part order by m.ord, t.n), '{}') into v_numbers
    from (values ('NUMBER 1', 1), ('NUMBER 2', 2), ('NUMBER 3', 3)) as m(header, ord)
    cross join lateral unnest(string_to_array(p ->> m.header, ',')) with ordinality as t(part, n)
   where nullif(btrim(t.part), '') is not null;
  v_numbers := array(select btrim(x) from unnest(v_numbers) x);
  select x into v_main from unnest(v_numbers) with ordinality as u(x, n) where customer.normalize_phone(x) is not null order by n limit 1;
  v_others := array(select x from unnest(v_numbers) x
                     where customer.normalize_phone(x) is not null and customer.normalize_phone(x) <> customer.normalize_phone(v_main));

  if v_origin is not null then
    perform set_config('customer.current_origin', v_origin, true);
    insert into customer.origins (origin, label, source) values (v_origin, v_origin, v_row.source) on conflict do nothing;
  end if;
  if v_store then
    -- A purchase at an Ahmedabad store places the person in Ahmedabad, like a walk-in.
    perform customer.claim_for_franchise(v_tenant, v_numbers, v_row.id);
    perform set_config('customer.lists_follow_walkins', '', true);
  end if;

  if v_main is not null then
    v_client := customer.find_or_create_client(v_tenant, v_main, v_name, v_row.source, v_at, v_others, null, null, v_row.id);
  else
    v_client := customer.resolve_client(v_tenant, v_numbers[1], v_name, v_row.source, v_at,
      null, null, v_row.source || ':' || md5(p::text), v_row.id);
  end if;
  perform set_config('customer.lists_follow_walkins', 'on', true);
  -- Numbers that are not valid are kept as written, never used to match.
  foreach v_raw in array v_numbers loop
    continue when customer.normalize_phone(v_raw) is not null;
    insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
    values (v_tenant, v_client, 'unverified_phone', left(v_raw, 60), v_row.source, v_at) on conflict do nothing;
  end loop;
  update customer.clients set archived_at = null, archive_reason = null
   where id = v_client and archived_at is not null and archive_reason = 'removed_from_sheet';

  v_value := customer.sheet_value(p ->> 'ADDRESS');
  if v_value is not null then perform customer.set_source_field(v_client, 'address', v_value, v_row.source, v_at, v_changed, null); end if;
  if v_store then perform customer.set_source_field(v_client, 'software_group', v_origin, v_row.source, v_at, v_changed, null); end if;

  perform customer.refresh_client_stats(v_client);
  perform set_config('customer.current_origin', '', true);
  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return null;
end $$;

select customer._patch('public.customer_ingest_apply(text,integer)'::regprocedure,
  E'        when ''referral_list'' then perform customer.apply_referral_list_row(r.id);\n',
  E'        when ''referral_list'' then perform customer.apply_referral_list_row(r.id);\n        when ''contact_list'' then perform customer.apply_contact_list_row(r.id);\n', 1);

drop function customer._patch(regprocedure, text, text, integer);

alter table customer.identity_phone_columns enable row level security;
alter table customer.row_phones enable row level security;
revoke all on customer.identity_phone_columns, customer.row_phones from public, anon, authenticated;
grant all on customer.identity_phone_columns, customer.row_phones to service_role;
revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function customer.delete_sheet(text) from service_role;
revoke all on function public.customer_ingest_apply(text, integer) from public, anon, authenticated;
grant execute on function public.customer_ingest_apply(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Run the check once over the whole database
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := customer.reconcile_open_pairs(null);
  raise notice '0436: %', v;
end $$;
