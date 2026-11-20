-- 0438: customer master database - review "possibly the same person".
--
-- Owner, 2026-11-20: "implement the approve or reject button ... if approved,
-- merge. if reject, seperate records"; "not just for the 5 pairs, but for every
-- pair that you have a doubt on or for every possibly same person. only if you
-- are sure they are the same person, you can merge on your own."
--
-- * Sure (merged automatically, unchanged): the same main name and the two
--   numbers together on at least 2 sheet rows (0436 + 0437).
-- * Every other doubt goes to a person, on the "Possibly same person" review:
--     - open "possibly the same person" flags (same main name, one row);
--     - the 5 joins made on 2026-11-19 whose main names differ (a shared old
--       name joined them under 0436's first rule): "Joined automatically".
-- * Same person: a flag is merged (the older record kept); a join is kept.
--   Different people: a flag is closed; a join is separated. Either way the
--   pair is never flagged or joined again. Every decision is audited.
-- * Who decides: new permission "Review duplicate customers"
--   (customers.review_duplicates), Super Admin by default; grant it to others
--   in Users -> Permissions.
-- * Separating needs to know which numbers and sheet rows were the joined
--   record's. From now on every merge saves that (customer.merge_records).
--   For the joins made before this, it is rebuilt from the rows that linked
--   the pair: the number each of them held on that row, then every sheet row
--   follows its own main number.

create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0438: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Permission
-- ---------------------------------------------------------------------------
-- permission-catalog:begin
insert into public.permission_catalog (key, kind, page_id, default_roles, sort_order) values
('customers.review_duplicates', 'action', null, '{super_admin}', 122);
-- permission-catalog:end

-- ---------------------------------------------------------------------------
-- 2. Review list: decisions and the "joined automatically" kind
-- ---------------------------------------------------------------------------
alter table customer.identity_review drop constraint identity_review_reason_check;
alter table customer.identity_review add constraint identity_review_reason_check
  check (reason in ('two_phones_two_clients', 'previous_number_merge', 'ambiguous', 'possible_same_person', 'joined_check'));
alter table customer.identity_review add column decision text check (decision in ('same', 'different'));
alter table customer.identity_review add column merge_record_id uuid;
comment on column customer.identity_review.decision is 'A person''s verdict on the pair (migration 0438): same person or different people. "different" stops the pair being flagged or joined again.';

-- The main number of a sheet row: the first valid number among the row's own-person columns.
alter table customer.identity_phone_columns add column ord integer not null default 1;
update customer.identity_phone_columns set ord = 2
 where (importer, header) in (('runo', 'Billing Phone Number Add +91'), ('walkin', 'BILLING PHONE'),
   ('not_bought_fms', 'BILLING PHONE NUMBER'), ('exhibition', 'PHONE 2'), ('exhibition_old', 'ALTERNATE NUMBER'),
   ('customer_data', 'WHATSAPP NUMBER'), ('account_list', 'Phone'), ('contact_list', 'NUMBER 2'));
update customer.identity_phone_columns set ord = 3 where importer = 'contact_list' and header = 'NUMBER 3';

create function customer.row_main_phone(p_source text, p_payload jsonb)
returns text language sql stable security definer set search_path = '' as $$
  select n.phone
    from customer.source_tables st
    join customer.identity_phone_columns c on c.importer = st.importer
    cross join lateral (select customer.row_values(p_payload) as p) v
    cross join lateral unnest(string_to_array(v.p ->> c.header, ',')) with ordinality as x(part, n)
    cross join lateral (select case when st.importer = 'customer_data' and c.header = 'MOBILE NO'
                                    then customer.normalize_phone(customer.phone_with_code(v.p ->> 'COUNTRY CODE', btrim(x.part)))
                                    else customer.normalize_phone(btrim(x.part)) end as phone) n
   where st.source = p_source and n.phone is not null
   order by c.ord, x.n
   limit 1;
$$;

-- Every valid number written anywhere on a sheet row.
create function customer.row_any_phones(p_payload jsonb)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct n.phone), '{}')
    from jsonb_each_text(p_payload) e
    cross join lateral unnest(string_to_array(e.value, ',')) as x(part)
    cross join lateral (select customer.normalize_phone(btrim(x.part)) as phone) n
   where e.value ~ '\d{8}' and length(e.value) < 80 and n.phone is not null;
$$;

-- ---------------------------------------------------------------------------
-- 3. Every merge saves what the removed record had
-- ---------------------------------------------------------------------------
create table customer.merge_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  keep_id uuid not null references customer.clients(id),
  removed_id uuid not null references customer.clients(id),
  reason text,
  removed_phones jsonb not null default '[]',   -- [{phone, kind}]
  removed_rows uuid[] not null default '{}',     -- ingest_rows that pointed at the removed record
  removed_primary_name text,
  removed_names jsonb,                           -- [{name, source, first_seen_at, last_seen_at}]; null when rebuilt
  keep_name_keys text[],                         -- the kept record's names before the merge; null when rebuilt
  removed_archive_reason text,
  rebuilt boolean not null default false,        -- true: worked out afterwards (joins before 0438)
  created_at timestamptz not null default now(),
  separated_at timestamptz,
  separated_by uuid references public.user_profiles(id)
);
create index merge_records_pair_idx on customer.merge_records (keep_id, removed_id);
comment on table customer.merge_records is
  'What a merged-away customer had (numbers, sheet rows, main name), so a merge can be separated (migration 0438).';

select customer._patch('customer.merge_clients(uuid,uuid,text,uuid)'::regprocedure,
  E'  -- Phones: every number is kept; the removed client''s main number becomes an other number.\n',
  E'  -- What the removed record had, so the merge can be separated (migration 0438).\n'
  || E'  insert into customer.merge_records (tenant_id, keep_id, removed_id, reason, removed_phones, removed_rows, removed_primary_name,\n'
  || E'    removed_names, keep_name_keys, removed_archive_reason)\n'
  || E'  values (v_keep.tenant_id, v_keep.id, v_remove.id, p_reason,\n'
  || E'    coalesce((select jsonb_agg(jsonb_build_object(''phone'', p.phone, ''kind'', p.kind)) from customer.client_phones p where p.client_id = v_remove.id), ''[]''::jsonb),\n'
  || E'    coalesce((select array_agg(r.id) from customer.ingest_rows r where r.client_id = v_remove.id), ''{}''::uuid[]),\n'
  || E'    v_remove.primary_name,\n'
  || E'    coalesce((select jsonb_agg(jsonb_build_object(''name'', n.name, ''source'', n.source, ''first_seen_at'', n.first_seen_at, ''last_seen_at'', n.last_seen_at))\n'
  || E'                from customer.client_names n where n.client_id = v_remove.id), ''[]''::jsonb),\n'
  || E'    coalesce((select array_agg(n.name_key) from customer.client_names n where n.client_id = v_keep.id), ''{}''::text[]),\n'
  || E'    v_remove.archive_reason);\n'
  || E'  -- Phones: every number is kept; the removed client''s main number becomes an other number.\n', 1);

-- ---------------------------------------------------------------------------
-- 4. A "different people" verdict is final
-- ---------------------------------------------------------------------------
create function customer.pair_decision(p_a uuid, p_b uuid)
returns text language sql stable security definer set search_path = '' as $$
  select d.decision from customer.identity_review d
   where d.decision is not null
     and least(customer.current_client(d.client_a), customer.current_client(d.client_b)) = least(p_a, p_b)
     and greatest(customer.current_client(d.client_a), customer.current_client(d.client_b)) = greatest(p_a, p_b)
   order by d.resolved_at desc nulls last
   limit 1;
$$;

select customer._patch('customer.reconcile_pair(uuid)'::regprocedure,
  E'  if v_same and cardinality(v_ev) >= 2\n',
  E'  -- People judged different are never joined or flagged again (migration 0438).\n'
  || E'  if v_same and customer.pair_decision(a, b) = ''different'' then v_same := false; end if;\n'
  || E'  if v_same and cardinality(v_ev) >= 2\n', 1);

-- ---------------------------------------------------------------------------
-- 5. Separate a merge
-- ---------------------------------------------------------------------------
create function customer.separate_merge(p_merge_record_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m customer.merge_records; v_keep customer.clients; v_rem customer.clients;
  v_phones text[]; v_rows uuid[]; v_interactions uuid[]; v_key text; v_client uuid;
begin
  select * into m from customer.merge_records where id = p_merge_record_id for update;
  if m.id is null then raise exception 'Merge not found' using errcode = 'P0002'; end if;
  if m.separated_at is not null then return; end if;
  select * into v_keep from customer.clients where id = m.keep_id for update;
  select * into v_rem from customer.clients where id = m.removed_id for update;
  if v_rem.merged_into_client_id is distinct from v_keep.id then
    raise exception 'These records have changed since they were joined; they cannot be separated here' using errcode = '22023';
  end if;
  v_phones := array(select x ->> 'phone' from jsonb_array_elements(m.removed_phones) x);
  if cardinality(v_phones) = 0 then
    raise exception 'The numbers of the joined record are not known; they cannot be separated here' using errcode = '22023';
  end if;
  v_rows := array(select r.id from customer.ingest_rows r where r.id = any (m.removed_rows) and r.client_id = v_keep.id);

  -- The record comes back.
  update customer.clients
     set merged_into_client_id = null,
         archived_at = case when m.removed_archive_reason = 'do_not_contact' then now() end,
         archive_reason = case when m.removed_archive_reason = 'do_not_contact' then 'do_not_contact' end,
         updated_at = now()
   where id = v_rem.id;

  -- Its numbers.
  update customer.client_phones p
     set client_id = v_rem.id,
         kind = coalesce((select x ->> 'kind' from jsonb_array_elements(m.removed_phones) x where x ->> 'phone' = p.phone limit 1), 'other')
   where p.client_id = v_keep.id and p.phone = any (v_phones);
  if not exists (select 1 from customer.client_phones where client_id = v_rem.id and kind = 'primary') then
    update customer.client_phones set kind = 'primary'
     where id = (select id from customer.client_phones where client_id = v_rem.id order by first_seen_at nulls last, phone limit 1);
  end if;
  if not exists (select 1 from customer.client_phones where client_id = v_keep.id and kind = 'primary') then
    update customer.client_phones set kind = 'primary'
     where id = (select id from customer.client_phones where client_id = v_keep.id order by first_seen_at nulls last, phone limit 1);
  end if;

  -- Its sheet rows and everything they made.
  v_interactions := array(select i.id from customer.interactions i where i.client_id = v_keep.id and i.source_row = any (v_rows));
  update customer.ingest_rows set client_id = v_rem.id where id = any (v_rows);
  update customer.interactions set client_id = v_rem.id where id = any (v_interactions);
  update customer.interaction_products set client_id = v_rem.id where interaction_id = any (v_interactions);
  update customer.follow_ups set client_id = v_rem.id where origin_interaction_id = any (v_interactions) and client_id = v_keep.id;
  update customer.appointments set client_id = v_rem.id where origin_interaction_id = any (v_interactions) and client_id = v_keep.id;
  update customer.client_field_values set client_id = v_rem.id
   where client_id = v_keep.id and (source_row = any (v_rows) or interaction_id = any (v_interactions));
  update customer.enquiries e set client_id = v_rem.id
   where e.client_id = v_keep.id
     and exists (select 1 from customer.enquiry_steps s where s.enquiry_id = e.id)
     and not exists (select 1 from customer.enquiry_steps s where s.enquiry_id = e.id and (s.source_row is null or not s.source_row = any (v_rows)));

  -- Its names. A merge saved since 0438 restores both lists exactly; a
  -- rebuilt one gives back the main name and leaves the kept record's names.
  if m.removed_names is not null then
    insert into customer.client_names (tenant_id, client_id, name, name_key, source, first_seen_at, last_seen_at)
    select m.tenant_id, v_rem.id, x ->> 'name', customer.name_key(x ->> 'name'), x ->> 'source',
           (x ->> 'first_seen_at')::timestamptz, (x ->> 'last_seen_at')::timestamptz
      from jsonb_array_elements(m.removed_names) x
     where customer.name_key(x ->> 'name') is not null
    on conflict (client_id, name_key) do nothing;
    delete from customer.client_names n where n.client_id = v_keep.id and not n.name_key = any (m.keep_name_keys);
  elsif m.removed_primary_name is not null then
    perform customer.add_client_name(v_rem.id, m.removed_primary_name, 'customer_separated', coalesce(v_rem.first_seen_at, now()));
  end if;

  -- Both profiles are rebuilt from what each now holds.
  foreach v_client in array array[v_keep.id, v_rem.id] loop
    for v_key in select field_key from customer.profile_fields loop
      if exists (select 1 from customer.client_field_values where client_id = v_client and field_key = v_key) then
        perform customer.recompute_profile_field(v_client, v_key);
      else
        execute format('update customer.clients set %I = null where id = $1', v_key) using v_client;
      end if;
    end loop;
    perform customer.refresh_primary_name(v_client);
    perform customer.refresh_client_stats(v_client);
  end loop;

  update customer.merge_records set separated_at = now(), separated_by = p_actor where id = m.id;
  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (m.tenant_id, p_actor, 'customer_separated', 'customer', v_rem.id,
          jsonb_build_object('joined_into', v_keep.client_code),
          jsonb_build_object('client_code', v_rem.client_code, 'phones', to_jsonb(v_phones), 'rows', cardinality(v_rows), 'rebuilt', m.rebuilt));
end $$;

-- ---------------------------------------------------------------------------
-- 6. The joins made before this: rebuild what each record had, and ask
-- ---------------------------------------------------------------------------
create function customer.rebuild_merge_record(p_tenant_id uuid, p_keep_id uuid, p_removed_id uuid, p_phone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_phones text[] := '{}'; v_keep_phones text[]; v_rows uuid[]; v_main text; v_first text; v_any text[]; v_mr uuid; r record;
  v_kept customer.clients; v_rem customer.clients;
begin
  select * into v_kept from customer.clients where id = p_keep_id;
  select * into v_rem from customer.clients where id = p_removed_id;
  if v_rem.merged_into_client_id is distinct from v_kept.id then return null; end if;
  -- The number each held on the rows that linked them.
  for r in select * from customer.identity_review
            where reason = 'two_phones_two_clients' and status = 'merged'
              and p_removed_id in (client_a, client_b) and p_keep_id in (client_a, client_b) loop
    if r.client_b = p_removed_id and r.phone is not null then
      v_phones := v_phones || customer.normalize_phone(r.phone);
    elsif r.client_a = p_removed_id then
      v_main := (select customer.row_main_phone(i.source, i.payload) from customer.ingest_rows i where i.id = r.source_row);
      if v_main is not null then v_phones := v_phones || v_main; end if;
    end if;
  end loop;
  -- The row that first made the removed record.
  v_first := (select customer.row_main_phone(i.source, i.payload) from customer.ingest_rows i where i.id = v_rem.source_row);
  if v_first is null then
    v_any := (select customer.row_any_phones(i.payload) from customer.ingest_rows i where i.id = v_rem.source_row);
    v_keep_phones := array(select phone from customer.client_phones where client_id = v_kept.id);
    if cardinality(array(select x from unnest(coalesce(v_any, '{}')) x where x = any (v_keep_phones))) = 1 then
      v_first := (select x from unnest(v_any) x where x = any (v_keep_phones) limit 1);
    end if;
  end if;
  if v_first is not null then v_phones := v_phones || v_first; end if;
  v_phones := array(select distinct x from unnest(v_phones) x where x is not null
                      and exists (select 1 from customer.client_phones p where p.client_id = v_kept.id and p.phone = x));
  v_keep_phones := array(select phone from customer.client_phones where client_id = v_kept.id and not phone = any (v_phones));
  if cardinality(v_keep_phones) = 0 then v_phones := '{}'; end if;  -- cannot tell them apart

  -- Every row of the kept record follows its own main number.
  v_rows := array(
    select i.id from customer.ingest_rows i
     where i.client_id = v_kept.id and cardinality(v_phones) > 0
       and case
             when customer.row_main_phone(i.source, i.payload) is not null
               then customer.row_main_phone(i.source, i.payload) = any (v_phones)
             else exists (select 1 from unnest(customer.row_any_phones(i.payload)) x where x = any (v_phones))
                  and not exists (select 1 from unnest(customer.row_any_phones(i.payload)) x where x = any (v_keep_phones))
           end);

  insert into customer.merge_records (tenant_id, keep_id, removed_id, reason, removed_phones, removed_rows, removed_primary_name, removed_archive_reason, rebuilt)
  values (p_tenant_id, p_keep_id, p_removed_id, 'same_person_two_numbers',
          coalesce((select jsonb_agg(jsonb_build_object('phone', x, 'kind', case when x = coalesce(v_first, v_phones[1]) then 'primary' else 'other' end)) from unnest(v_phones) x), '[]'),
          v_rows, v_rem.primary_name, null, true)
  returning id into v_mr;

  -- Joins whose main names differ need a person's verdict.
  if customer.name_key(v_rem.primary_name) is distinct from customer.name_key(v_kept.primary_name) then
    insert into customer.identity_review (tenant_id, reason, client_a, client_b, phone, source, status, outcome, merge_record_id)
    values (p_tenant_id, 'joined_check', p_keep_id, p_removed_id, p_phone, 'customer_merge', 'open',
            'joined automatically on a shared other name', v_mr);
  end if;
  return v_mr;
end $$;

select count(customer.rebuild_merge_record(l.tenant_id, l.record_id, (l.new_value ->> 'removed_client_id')::uuid, l.new_value ->> 'phone')) as rebuilt
  from public.audit_logs l
 where l.action = 'customer_same_person_joined'
   and not exists (select 1 from customer.merge_records m where m.keep_id = l.record_id and m.removed_id = (l.new_value ->> 'removed_client_id')::uuid);

-- ---------------------------------------------------------------------------
-- 7. The review list and the verdict
-- ---------------------------------------------------------------------------
create function customer.review_side(p_client_id uuid, p_merge_record_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'client_code', c.client_code,
    'name', coalesce(m.removed_primary_name, c.primary_name),
    'other_names', coalesce((select jsonb_agg(n.name order by n.last_seen_at desc) from customer.client_names n
                              where n.client_id = c.id and m.id is null and n.name_key is distinct from customer.name_key(c.primary_name)), '[]'),
    'phones', case when m.id is not null then coalesce((select jsonb_agg(x ->> 'phone') from jsonb_array_elements(m.removed_phones) x), '[]')
                   else coalesce((select jsonb_agg(p.phone order by p.kind = 'primary' desc, p.first_seen_at) from customer.client_phones p where p.client_id = c.id), '[]') end,
    'franchise', (select f.name from public.franchise_groups f where f.id = c.franchise_group_id),
    'segment', c.segment,
    'city', c.city,
    'first_source', (select s.label from customer.sources s where s.source = c.first_source),
    'first_origin', c.first_origin,
    'first_seen_at', c.first_seen_at,
    'last_contacted_at', c.last_contacted_at,
    'interaction_count', c.interaction_count,
    'sheet_rows', case when m.id is not null then cardinality(m.removed_rows)
                       else (select count(*) from customer.ingest_rows r where r.client_id = c.id and r.status <> 'removed') end)
  from customer.clients c
  left join customer.merge_records m on m.id = p_merge_record_id
  where c.id = p_client_id;
$$;

create function public.customer_review_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid;
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('customers.review_duplicates') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant_id();
  return coalesce((
    select jsonb_agg(item order by kind_order, created_at)
      from (
        select case when r.reason = 'joined_check' then 0 else 1 end as kind_order, r.created_at,
               jsonb_build_object(
                 'id', r.id,
                 'kind', case when r.reason = 'joined_check' then 'joined' else 'possible' end,
                 'note', r.outcome,
                 'created_at', r.created_at,
                 'a', customer.review_side(case when r.reason = 'joined_check' then r.client_a else customer.current_client(r.client_a) end, null),
                 'b', customer.review_side(case when r.reason = 'joined_check' then r.client_b else customer.current_client(r.client_b) end, r.merge_record_id),
                 'linking_rows', case when r.reason = 'joined_check' then null
                   else (select coalesce(jsonb_agg(jsonb_build_object('source', coalesce(st.label, i.source), 'sheet_row', i.sheet_row)), '[]'::jsonb)
                           from customer.ingest_rows i left join customer.source_tables st on st.source = i.source
                          where i.id = any (customer.pair_evidence(customer.current_client(r.client_a), customer.current_client(r.client_b)))) end
               ) as item
          from customer.identity_review r
         where r.tenant_id = v_tenant and r.status = 'open' and r.reason in ('possible_same_person', 'joined_check')
           and (r.reason = 'joined_check' or customer.current_client(r.client_a) is distinct from customer.current_client(r.client_b))
      ) t), '[]'::jsonb);
end $$;

create function public.customer_review_decide(p_review_id uuid, p_same boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_actor uuid; r customer.identity_review; a uuid; b uuid; ca customer.clients; cb customer.clients;
  v_keep uuid; v_remove uuid; v_result text;
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('customers.review_duplicates') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  if p_same is null then raise exception 'Choose same person or different people' using errcode = '22023'; end if;
  v_tenant := public.current_tenant_id();
  select id into v_actor from public.current_profile();
  select * into r from customer.identity_review
   where id = p_review_id and tenant_id = v_tenant and reason in ('possible_same_person', 'joined_check') for update;
  if r.id is null then raise exception 'Review not found' using errcode = 'P0002'; end if;
  if r.status <> 'open' then raise exception 'This pair has already been decided' using errcode = '22023'; end if;

  if r.reason = 'joined_check' then
    if p_same then
      v_result := 'kept_joined';
    else
      perform customer.separate_merge(r.merge_record_id, v_actor);
      v_result := 'separated';
    end if;
  else
    a := customer.current_client(r.client_a);
    b := customer.current_client(r.client_b);
    if a is null or b is null then raise exception 'One of these records no longer exists' using errcode = '22023'; end if;
    if p_same and a <> b then
      select * into ca from customer.clients where id = a;
      select * into cb from customer.clients where id = b;
      if coalesce(ca.first_seen_at, 'infinity') < coalesce(cb.first_seen_at, 'infinity')
         or (ca.first_seen_at is not distinct from cb.first_seen_at and ca.client_code <= cb.client_code) then
        v_keep := a; v_remove := b;
      else
        v_keep := b; v_remove := a;
      end if;
      perform customer.merge_clients(v_keep, v_remove, 'approved_same_person', v_actor);
      v_result := 'merged';
    else
      v_result := case when p_same then 'merged' else 'kept_separate' end;
    end if;
  end if;

  update customer.identity_review
     set status = case when p_same then 'merged' else 'dismissed' end,
         decision = case when p_same then 'same' else 'different' end,
         resolved_by = v_actor, resolved_at = now(),
         outcome = coalesce(outcome, '') || '; decided: ' || v_result
   where id = r.id;
  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_tenant, v_actor, 'customer_duplicate_reviewed', 'customer', coalesce(v_keep, a, r.client_a),
          jsonb_build_object('review_id', r.id, 'kind', r.reason, 'decision', case when p_same then 'same' else 'different' end, 'result', v_result));
  return jsonb_build_object('result', v_result, 'client_code',
    (select client_code from customer.clients where id = coalesce(v_keep, r.client_a)));
end $$;

-- The list page shows how many pairs wait, to those who can decide.
select customer._patch('public.customer_list_filters(text)'::regprocedure,
  E'    ''total'', (select count(*) from customer.clients where tenant_id = v_tenant',
  E'    ''duplicates_to_review'', case when public.has_permission(''customers.review_duplicates'') then\n'
  || E'      (select count(*) from customer.identity_review r where r.tenant_id = v_tenant and r.status = ''open''\n'
  || E'          and r.reason in (''possible_same_person'', ''joined_check'')) end,\n'
  || E'    ''total'', (select count(*) from customer.clients where tenant_id = v_tenant', 1);

drop function customer._patch(regprocedure, text, text, integer);

alter table customer.merge_records enable row level security;
revoke all on customer.merge_records from public, anon, authenticated;
grant all on customer.merge_records to service_role;
revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function customer.delete_sheet(text) from service_role;
revoke all on function public.customer_review_list() from public, anon;
revoke all on function public.customer_review_decide(uuid, boolean) from public, anon;
grant execute on function public.customer_review_list() to authenticated;
grant execute on function public.customer_review_decide(uuid, boolean) to authenticated;
