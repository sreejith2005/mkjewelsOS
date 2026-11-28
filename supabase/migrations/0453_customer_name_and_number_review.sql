-- 0453: two more duplicate reviews - same name with different numbers, and
-- one number with different names - each with merge / keep separate.
--
-- Owner, 2026-11-28: "another field where i can select and see all the people
-- with the same name but different phone numbers. it should show them
-- together ... and add the merge or seperate button ... so we would only have
-- unique customers. then another field with people with different name, same
-- phone number. and same merge or seperate logic."
--
-- Both are new kinds on the existing "Possibly same person" review
-- (customer.identity_review, migration 0438), decided by people with
-- "Review duplicate customers":
--
-- * same_name_check: two customers of one franchise whose main names are the
--   same full name (two or more words) and whose numbers differ. Groups of up
--   to 10 records; each record is paired with the oldest one of its name.
--   Same person merges them (the older record kept, both numbers kept);
--   different people keeps them apart and the pair is never asked again.
-- * shared_phone_check: one customer (one number) that also carries a clearly
--   different name (another first name, not just an initial or a longer form
--   of the same name). Same person keeps the name as an other name. Different
--   people splits that name off as its own customer in the same family:
--     - the name and the sheet rows written under it move to the new
--       customer (the rows are read again by the next import run, so their
--       calls, visits and answers follow them);
--     - from then on a sheet row with this number and this name belongs to
--       the new customer (customer.phone_name_routes);
--     - the number stays with the original customer and is noted on the new
--       one ("shared number").
-- * The checks are worked out once now and every night (cron
--   customer-review-checks), and never again for a pair decided "different".
-- * Moving an interaction to another customer now takes its follow-ups and
--   appointments with it, and refreshes both customers.

alter table customer.identity_review drop constraint identity_review_reason_check;
alter table customer.identity_review add constraint identity_review_reason_check
  check (reason in ('two_phones_two_clients', 'previous_number_merge', 'ambiguous', 'possible_same_person', 'joined_check',
                    'same_name_check', 'shared_phone_check'));
alter table customer.identity_review add column other_name text;
comment on column customer.identity_review.other_name is 'shared_phone_check (migration 0453): the other name seen on the customer''s number.';
-- The nightly checks look up earlier decisions on a pair and on a customer's names.
create index identity_review_pair_any_idx on customer.identity_review (least(client_a, client_b), greatest(client_a, client_b)) where client_b is not null;
create index identity_review_shared_phone_idx on customer.identity_review (client_a) where reason = 'shared_phone_check';
create unique index identity_review_open_name_idx on customer.identity_review (client_a, customer.name_key(other_name))
  where status = 'open' and reason = 'shared_phone_check';

alter table customer.client_identifiers drop constraint client_identifiers_id_type_check;
alter table customer.client_identifiers add constraint client_identifiers_id_type_check
  check (id_type in ('instagram', 'email', 'runo_customer_id', 'sheet_client_id', 'sheet_family_id', 'software_customer_id', 'zoho_id',
                     'sheet_row', 'unverified_phone', 'shared_phone'));

create table customer.phone_name_routes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  franchise_group_id uuid,
  phone text not null,
  name_key text not null,
  client_id uuid not null references customer.clients(id) on delete cascade,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index phone_name_routes_key_idx on customer.phone_name_routes
  (tenant_id, coalesce(franchise_group_id, '00000000-0000-0000-0000-000000000000'::uuid), phone, name_key);
comment on table customer.phone_name_routes is 'Migration 0453: a person split off a shared number; sheet rows with this number and name belong to client_id.';
alter table customer.phone_name_routes enable row level security;
revoke all on customer.phone_name_routes from public, anon, authenticated;
grant all on customer.phone_name_routes to service_role;

-- ---------------------------------------------------------------------------
-- 1. Finding the pairs
-- ---------------------------------------------------------------------------
-- Two names on one number are different people's when their first names differ
-- (and one is not just the other's initial).
create function customer.names_clearly_differ(p_a text, p_b text) returns boolean
language sql immutable set search_path = '' as $$
  with k as (select split_part(customer.name_key(p_a), ' ', 1) as a, split_part(customer.name_key(p_b), ' ', 1) as b)
  select k.a <> '' and k.b <> '' and k.a <> k.b
     and not (length(k.a) = 1 and left(k.b, 1) = k.a) and not (length(k.b) = 1 and left(k.a, 1) = k.b)
     and k.a not like k.b || '%' and k.b not like k.a || '%'
  from k;
$$;

create function customer.refresh_review_checks(p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_names integer; v_phones integer;
begin
  -- Same full name, different numbers.
  with live as (
    select c.id, c.franchise_group_id, customer.name_key(c.primary_name) as k, c.first_seen_at, c.client_code
      from customer.clients c
     where c.tenant_id = p_tenant_id and c.merged_into_client_id is null
       and (c.archived_at is null or c.archive_reason is distinct from 'do_not_contact')
       and customer.name_key(c.primary_name) like '% %'
  ), groups as (
    select franchise_group_id, k from live group by 1, 2 having count(*) between 2 and 10
  ), ranked as (
    select l.*, first_value(l.id) over (partition by l.franchise_group_id, l.k order by l.first_seen_at nulls last, l.client_code) as anchor
      from live l join groups g on g.k = l.k and g.franchise_group_id is not distinct from l.franchise_group_id
  )
  insert into customer.identity_review (tenant_id, reason, client_a, client_b, source, outcome)
  select p_tenant_id, 'same_name_check', r.anchor, r.id, 'review_checks', 'Same name, different numbers'
    from ranked r
   where r.id <> r.anchor
     and not exists (select 1 from customer.identity_review x
                      where least(x.client_a, x.client_b) = least(r.anchor, r.id) and greatest(x.client_a, x.client_b) = greatest(r.anchor, r.id)
                        and (x.decision = 'different' or (x.status = 'open' and x.reason = 'same_name_check')))
  on conflict do nothing;
  get diagnostics v_names = row_count;

  -- One number, a clearly different name.
  insert into customer.identity_review (tenant_id, reason, client_a, source, other_name, outcome)
  select p_tenant_id, 'shared_phone_check', c.id, 'review_checks', n.name, 'One number, different names'
    from customer.clients c
    join customer.client_names n on n.client_id = c.id
   where c.tenant_id = p_tenant_id and c.merged_into_client_id is null and c.archived_at is null
     and exists (select 1 from customer.client_phones p where p.client_id = c.id)
     and n.name_key <> customer.name_key(c.primary_name)
     and customer.names_clearly_differ(n.name, c.primary_name)
     and not exists (select 1 from customer.identity_review x
                      where x.client_a = c.id and x.reason = 'shared_phone_check' and customer.name_key(x.other_name) = n.name_key)
  on conflict do nothing;
  get diagnostics v_phones = row_count;

  -- Pairs whose records were merged or deleted in the meantime are closed.
  update customer.identity_review r set status = 'dismissed', resolved_at = now(), outcome = coalesce(outcome, '') || '; closed: record merged'
   where r.tenant_id = p_tenant_id and r.status = 'open' and r.reason = 'same_name_check'
     and customer.current_client(r.client_a) = customer.current_client(r.client_b);
  return jsonb_build_object('same_name', v_names, 'shared_phone', v_phones);
end $$;

create function public.customer_refresh_review_checks() returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(t.id, customer.refresh_review_checks(t.id)), '{}'::jsonb)
    from public.tenants t where exists (select 1 from customer.clients c where c.tenant_id = t.id);
$$;
revoke all on function public.customer_refresh_review_checks() from public, anon, authenticated;
grant execute on function public.customer_refresh_review_checks() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Splitting a name off a shared number
-- ---------------------------------------------------------------------------
create function customer.split_shared_phone_name(p_client_id uuid, p_name text, p_actor uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c customer.clients; v_key text := customer.name_key(p_name); v_new uuid; n customer.client_names; v_rows uuid[];
begin
  select * into c from customer.clients where id = p_client_id for update;
  select * into n from customer.client_names where client_id = p_client_id and name_key = v_key;
  if c.id is null or n.id is null then raise exception 'That name is no longer on this customer' using errcode = '22023'; end if;
  if v_key = customer.name_key(c.primary_name) and (select count(*) from customer.client_names where client_id = c.id) < 2 then
    raise exception 'The customer''s only name cannot be split off' using errcode = '22023';
  end if;

  insert into customer.clients (tenant_id, household_id, primary_name, first_source, first_seen_at, franchise_group_id)
  values (c.tenant_id, c.household_id, n.name, coalesce(n.source, c.first_source), n.first_seen_at, c.franchise_group_id)
  returning id into v_new;
  update customer.client_names set client_id = v_new where id = n.id;
  perform customer.refresh_primary_name(c.id);
  insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
  select c.tenant_id, v_new, 'shared_phone', p.phone, 'review', now() from customer.client_phones p where p.client_id = c.id
  on conflict do nothing;
  insert into customer.phone_name_routes (tenant_id, franchise_group_id, phone, name_key, client_id, created_by)
  select c.tenant_id, c.franchise_group_id, p.phone, v_key, v_new, p_actor from customer.client_phones p where p.client_id = c.id
  on conflict do nothing;

  -- The sheet rows written under that name go to the new customer: their answers
  -- leave the original now, and the next import run applies them again.
  select coalesce(array_agg(r.id), '{}') into v_rows from customer.ingest_rows r
   where r.client_id = c.id and r.status <> 'removed'
     and exists (select 1 from jsonb_each_text(r.payload) e where customer.name_key(e.value) = v_key);
  delete from customer.client_field_values where client_id = c.id and source_row = any (v_rows);
  update customer.ingest_rows set status = 'pending', reject_reason = null, updated_at = now() where id = any (v_rows);

  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
  values (c.tenant_id, p_actor, 'customer_shared_phone_split', 'customer', v_new,
          jsonb_build_object('from_client_id', c.id, 'name', n.name, 'sheet_rows', cardinality(v_rows)));
  perform customer.refresh_client_stats(c.id);
  perform customer.refresh_client_stats(v_new);
  return v_new;
end $$;

-- A sheet row with a split-off number and name belongs to that person.
create function customer._patch_0453(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0453: expected % match(es) of "%" in %, found %', p_expected, left(p_old, 80), p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

select customer._patch_0453('customer.find_or_create_client(uuid,text,text,text,timestamptz,text[],text,uuid,uuid)'::regprocedure,
  $o$  if v_phone is null then raise exception 'Not a valid phone number' using errcode = '22023'; end if;
$o$,
  $n$  if v_phone is null then raise exception 'Not a valid phone number' using errcode = '22023'; end if;

  -- A person split off this shared number (migration 0453).
  select customer.current_client(r.client_id) into v_client from customer.phone_name_routes r
   where r.tenant_id = p_tenant_id and customer.same_franchise(r.franchise_group_id) and r.phone = v_phone
     and r.name_key = customer.name_key(p_name);
  if v_client is not null then
    perform customer.add_client_name(v_client, p_name, p_source, v_at);
    return v_client;
  end if;
$n$, 1);

-- An interaction moved to another customer takes its follow-ups and appointments.
create function customer.on_interaction_client_moved() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update customer.follow_ups set client_id = new.client_id, updated_at = now()
   where origin_interaction_id = new.id and client_id = old.client_id;
  update customer.appointments set client_id = new.client_id
   where (origin_interaction_id = new.id or visit_interaction_id = new.id) and client_id = old.client_id;
  if not customer.bulk_delete_running() and exists (select 1 from customer.clients where id = old.client_id) then
    perform customer.refresh_client_stats(old.client_id);
  end if;
  return null;
end $$;
create trigger interactions_client_moved after update of client_id on customer.interactions
  for each row when (old.client_id is distinct from new.client_id) execute function customer.on_interaction_client_moved();

-- ---------------------------------------------------------------------------
-- 3. The review: a page of one kind at a time, and the decision
-- ---------------------------------------------------------------------------
create function public.customer_review_queue(p_kind text, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid; v_reason text; v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('customers.review_duplicates') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  v_reason := case p_kind when 'same_name' then 'same_name_check' when 'shared_phone' then 'shared_phone_check' end;
  if v_reason is null then raise exception 'Unknown review kind' using errcode = '22023'; end if;
  v_tenant := public.current_tenant_id();
  return (
    with open as (
      select r.* from customer.identity_review r
       where r.tenant_id = v_tenant and r.status = 'open' and r.reason = v_reason
         and (v_reason = 'shared_phone_check' or customer.current_client(r.client_a) is distinct from customer.current_client(r.client_b))
    ), page as (
      select o.*, coalesce(customer.name_key(ca.primary_name), '') as k
        from open o join customer.clients ca on ca.id = customer.current_client(o.client_a)
       order by k, o.created_at, o.id
       limit 25 offset v_offset
    )
    select jsonb_build_object(
      'total', (select count(*) from open),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'kind', p_kind, 'note', p.outcome, 'created_at', p.created_at, 'other_name', p.other_name,
          'a', customer.review_side(customer.current_client(p.client_a), null),
          'b', case when p.client_b is not null then customer.review_side(customer.current_client(p.client_b), null) end,
          'other_name_rows', case when v_reason = 'shared_phone_check' then
            (select count(*) from customer.ingest_rows ir where ir.client_id = p.client_a and ir.status <> 'removed'
               and exists (select 1 from jsonb_each_text(ir.payload) e where customer.name_key(e.value) = customer.name_key(p.other_name))) end,
          'linking_rows', null) order by p.k, p.created_at, p.id) from page p), '[]'::jsonb)));
end $$;
revoke all on function public.customer_review_queue(text, integer) from public, anon;
grant execute on function public.customer_review_queue(text, integer) to authenticated;

select customer._patch_0453('public.customer_review_decide(uuid,boolean)'::regprocedure,
  $o$   where id = p_review_id and tenant_id = v_tenant and reason in ('possible_same_person', 'joined_check') for update;$o$,
  $n$   where id = p_review_id and tenant_id = v_tenant and reason in ('possible_same_person', 'joined_check', 'same_name_check', 'shared_phone_check') for update;$n$, 1);
select customer._patch_0453('public.customer_review_decide(uuid,boolean)'::regprocedure,
  $o$  if r.reason = 'joined_check' then$o$,
  $n$  if r.reason = 'shared_phone_check' then
    -- Same person: the name stays an other name. Different people: it is split off.
    if p_same then
      v_result := 'kept_names';
    else
      v_keep := customer.split_shared_phone_name(customer.current_client(r.client_a), r.other_name, v_actor);
      v_result := 'split';
    end if;
  elsif r.reason = 'joined_check' then$n$, 1);

-- The list page counts each kind for those who can decide.
select customer._patch_0453('public.customer_list_filters(text)'::regprocedure,
  $o$          and r.reason in ('possible_same_person', 'joined_check')) end,$o$,
  $n$          and r.reason in ('possible_same_person', 'joined_check')) end,
    'same_name_to_review', case when public.has_permission('customers.review_duplicates') then
      (select count(*) from customer.identity_review r where r.tenant_id = v_tenant and r.status = 'open' and r.reason = 'same_name_check') end,
    'shared_phone_to_review', case when public.has_permission('customers.review_duplicates') then
      (select count(*) from customer.identity_review r where r.tenant_id = v_tenant and r.status = 'open' and r.reason = 'shared_phone_check') end,$n$, 1);

drop function customer._patch_0453(regprocedure, text, text, integer);

revoke all on function customer.names_clearly_differ(text, text) from public, anon, authenticated;
revoke all on function customer.refresh_review_checks(uuid) from public, anon, authenticated;
revoke all on function customer.split_shared_phone_name(uuid, text, uuid) from public, anon, authenticated;
revoke all on function customer.on_interaction_client_moved() from public, anon, authenticated;

-- Once now (up to 20 minutes), then every night.
set statement_timeout = '20min';
select public.customer_refresh_review_checks();
reset statement_timeout;
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('customer-review-checks', '15 22 * * *', 'select public.customer_refresh_review_checks();');
  end if;
end $$;
