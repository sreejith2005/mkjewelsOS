-- 0406: customer master database, part 2 - interactions.
--
-- Director's requirement: every contact with a customer gets our own
-- interaction id, an outcome, and a link to what it leads to (follow-up,
-- appointment), so the whole journey reads in date order on one timeline.
--
--   customer.interactions          one row per contact (MKI-)
--   customer.interaction_products  products seen / asked about in a contact
--   customer.follow_ups            the next call that a contact created (MKFU-)
--   customer.appointments          store or video appointments (MKA-)
--
-- Also:
--   * client codes restart at 100001 (owner decision 2026-11-13: every
--     customer from every sheet gets one new code; the scattered sheet ids are
--     not carried over);
--   * client counters and last-contact dates are recomputed from interactions;
--   * merge_clients moves the new tables too.
--
-- Adds only new objects, apart from one exact-text patch to
-- customer.merge_clients (created in 0405).

-- ---------------------------------------------------------------------------
-- 1. Codes
-- ---------------------------------------------------------------------------
do $codes$
begin
  -- Safe only while no client exists. After the first import the numbering is
  -- left alone.
  if not exists (select 1 from customer.clients) then
    alter sequence customer.client_code_seq restart with 100001;
    alter sequence customer.household_code_seq restart with 100001;
    alter sequence customer.referral_code_seq restart with 100001;
  end if;
end $codes$;

create sequence customer.interaction_code_seq start 1000001;
create sequence customer.follow_up_code_seq start 100001;
create sequence customer.appointment_code_seq start 100001;

insert into customer.sources (source, source_rank, label) values
  ('app', 4, 'Entered in JewelOS'),
  ('not_bought_fms', 2, 'Not-bought follow-up'),
  ('order_fms', 2, 'Order tracking'),
  ('repair_fms', 2, 'Repair tracking')
on conflict (source) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

create table customer.interactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  interaction_code text not null default 'MKI-' || nextval('customer.interaction_code_seq'),
  client_id uuid not null references customer.clients(id),
  occurred_at timestamptz not null,
  channel text not null check (channel in ('call', 'video_call', 'whatsapp', 'instagram', 'instagram_ads', 'website', 'walk_in', 'exhibition', 'software')),
  direction text not null check (direction in ('inbound', 'outbound', 'in_person')),
  purpose text not null check (purpose in ('enquiry', 'offer', 'exhibition', 'kit', 'birthday', 'anniversary', 'follow_up', 'not_bought', 'referral', 'order', 'repair', 'visit', 'purchase', 'other')),
  -- outcome keeps the words the source used (Runo Status, FMS STATUS).
  -- result is the director's three-way reading of it, plus neutral.
  outcome text,
  result text not null default 'neutral' check (result in ('positive', 'negative', 'not_connected', 'neutral')),
  -- successful = the customer was actually reached, whatever the answer.
  successful boolean not null default true,
  non_contact_reason text,
  staff_user_id uuid references public.user_profiles(id),
  assigned_by_user_id uuid references public.user_profiles(id),
  attended_by_user_id uuid references public.user_profiles(id),
  -- Names as the source wrote them, for rows whose staff name matches no user.
  staff_name text,
  attended_by_name text,
  branch_id uuid references public.branches(id),
  store_name text,
  contact_role text,
  customer_type_stated text,
  process_name text,
  -- Links filled by later migrations (campaigns, enquiries, exhibitions).
  campaign_id uuid,
  campaign_member_id uuid,
  lead_id uuid,
  exhibition_id uuid,
  fms_instance_id uuid,
  fms_stage text,
  parent_interaction_id uuid references customer.interactions(id),
  source text not null references customer.sources(source),
  external_ref text,
  source_row uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, interaction_code),
  check (not (successful and result = 'not_connected'))
);
-- The same source row is imported once; a changed row updates it.
create unique index interactions_source_ref_idx on customer.interactions (tenant_id, source, external_ref) where external_ref is not null;
create index interactions_client_time_idx on customer.interactions (client_id, occurred_at desc);
create index interactions_tenant_time_idx on customer.interactions (tenant_id, occurred_at desc);
create index interactions_staff_time_idx on customer.interactions (staff_user_id, occurred_at desc) where staff_user_id is not null;
create index interactions_campaign_idx on customer.interactions (campaign_id) where campaign_id is not null;
create index interactions_lead_idx on customer.interactions (lead_id) where lead_id is not null;
create trigger interactions_touch before update on customer.interactions
  for each row execute function customer.touch_updated_at();

alter table customer.client_field_values
  add constraint client_field_values_interaction_fk foreign key (interaction_id) references customer.interactions(id) on delete set null;

create table customer.interaction_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  interaction_id uuid not null references customer.interactions(id) on delete cascade,
  client_id uuid not null references customer.clients(id),
  product_code text,
  product_category text,
  interest text not null default 'interested' check (interest in ('seen', 'interested', 'ordered', 'bought')),
  created_at timestamptz not null default now(),
  check (product_code is not null or product_category is not null)
);
create unique index interaction_products_once_idx
  on customer.interaction_products (interaction_id, coalesce(product_code, ''), coalesce(product_category, ''));
create index interaction_products_client_idx on customer.interaction_products (client_id);

create table customer.follow_ups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  follow_up_code text not null default 'MKFU-' || nextval('customer.follow_up_code_seq'),
  client_id uuid not null references customer.clients(id),
  kind text not null check (kind in ('hot', 'cold', 'three_month', 'call_later', 'retry', 'no_show', 'not_bought', 'other')),
  origin_interaction_id uuid references customer.interactions(id),
  due_at timestamptz not null,
  reason text,
  assigned_to_user_id uuid references public.user_profiles(id),
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  closed_by_interaction_id uuid references customer.interactions(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, follow_up_code)
);
create unique index follow_ups_origin_once_idx on customer.follow_ups (origin_interaction_id, kind) where origin_interaction_id is not null;
create index follow_ups_due_idx on customer.follow_ups (tenant_id, due_at) where status = 'pending';
create index follow_ups_assignee_idx on customer.follow_ups (assigned_to_user_id, due_at) where status = 'pending';
create index follow_ups_client_idx on customer.follow_ups (client_id);
create trigger follow_ups_touch before update on customer.follow_ups
  for each row execute function customer.touch_updated_at();

create table customer.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  appointment_code text not null default 'MKA-' || nextval('customer.appointment_code_seq'),
  client_id uuid not null references customer.clients(id),
  type text not null check (type in ('store', 'video')),
  origin_interaction_id uuid references customer.interactions(id),
  scheduled_at timestamptz not null,
  branch_id uuid references public.branches(id),
  status text not null default 'booked' check (status in ('booked', 'visited', 'no_show', 'cancelled')),
  visit_interaction_id uuid references customer.interactions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, appointment_code)
);
create unique index appointments_origin_once_idx on customer.appointments (origin_interaction_id, type) where origin_interaction_id is not null;
create index appointments_schedule_idx on customer.appointments (tenant_id, scheduled_at) where status = 'booked';
create index appointments_client_idx on customer.appointments (client_id);
create trigger appointments_touch before update on customer.appointments
  for each row execute function customer.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Access: same rule as 0405
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['interactions', 'interaction_products', 'follow_ups', 'appointments'] loop
    execute format('alter table customer.%I enable row level security', t);
    execute format($p$create policy tenant_crm_read on customer.%I for select to authenticated
      using ((select public.current_profile_is_active()) and tenant_id = (select public.current_tenant_id())
        and (select public.has_permission('crm.view')))$p$, t);
    execute format($p$create policy module_accessible on customer.%I as restrictive for select to authenticated
      using (public.module_accessible('crm'))$p$, t);
  end loop;
end $rls$;
revoke all on all tables in schema customer from public, anon, authenticated;
revoke all on all sequences in schema customer from public, anon, authenticated;
grant all on all tables in schema customer to service_role;
grant usage on all sequences in schema customer to service_role;

-- ---------------------------------------------------------------------------
-- 4. Functions (service-only)
-- ---------------------------------------------------------------------------

-- Counters and dates on the client, always recomputed from its interactions,
-- so the order in which old data is loaded does not matter.
create function customer.refresh_client_stats(p_client_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s record; f record;
begin
  select count(*) as total,
         count(*) filter (where successful) as reached,
         max(occurred_at) filter (where successful) as last_contacted,
         max(occurred_at) as last_attempt,
         bool_or(successful) as any_reached,
         bool_or(channel in ('walk_in', 'exhibition')) as any_visit
    into s from customer.interactions where client_id = p_client_id;
  select occurred_at, source into f from customer.interactions
   where client_id = p_client_id order by occurred_at, created_at limit 1;

  update customer.clients c
     set interaction_count = s.total,
         successful_interaction_count = s.reached,
         last_contacted_at = s.last_contacted,
         last_attempt_at = s.last_attempt,
         lifecycle_stage = case when coalesce(s.any_visit, false) then 'visited'
                                when coalesce(s.any_reached, false) then 'engaged'
                                else c.lifecycle_stage end,
         first_seen_at = least(c.first_seen_at, f.occurred_at),
         first_source = case when f.occurred_at < c.first_seen_at or c.first_seen_at is null
                             then coalesce(f.source, c.first_source) else c.first_source end
   where c.id = p_client_id;
end $$;

-- Write (or update) one interaction. p_row holds any column of
-- customer.interactions by name; missing keys take the column default.
-- With an external_ref the call is repeatable: the same source row never
-- creates a second interaction.
create function customer.record_interaction(p_client_id uuid, p_row jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_client customer.clients;
  r customer.interactions;
  v_id uuid;
begin
  select * into v_client from customer.clients where id = p_client_id;
  if v_client.id is null then raise exception 'Client not found' using errcode = '22023'; end if;
  -- A merged client's history belongs to the client it was merged into.
  if v_client.merged_into_client_id is not null then
    select * into v_client from customer.clients where id = v_client.merged_into_client_id;
  end if;

  r := jsonb_populate_record(null::customer.interactions, coalesce(p_row, '{}'::jsonb));
  if r.occurred_at is null or r.channel is null or r.direction is null or r.purpose is null or r.source is null then
    raise exception 'occurred_at, channel, direction, purpose and source are required' using errcode = '22023';
  end if;
  r.successful := coalesce(r.successful, true);
  r.result := coalesce(r.result, case when r.successful then 'neutral' else 'not_connected' end);
  r.external_ref := nullif(btrim(r.external_ref), '');

  if r.external_ref is not null then
    select id into v_id from customer.interactions
     where tenant_id = v_client.tenant_id and source = r.source and external_ref = r.external_ref;
  end if;

  if v_id is null then
    insert into customer.interactions (
      tenant_id, client_id, occurred_at, channel, direction, purpose, outcome, result, successful,
      non_contact_reason, staff_user_id, assigned_by_user_id, attended_by_user_id, staff_name, attended_by_name,
      branch_id, store_name, contact_role, customer_type_stated, process_name, campaign_id, campaign_member_id,
      lead_id, exhibition_id, fms_instance_id, fms_stage, parent_interaction_id, source, external_ref, source_row, notes)
    values (
      v_client.tenant_id, v_client.id, r.occurred_at, r.channel, r.direction, r.purpose, r.outcome, r.result, r.successful,
      r.non_contact_reason, r.staff_user_id, r.assigned_by_user_id, r.attended_by_user_id, r.staff_name, r.attended_by_name,
      r.branch_id, r.store_name, r.contact_role, r.customer_type_stated, r.process_name, r.campaign_id, r.campaign_member_id,
      r.lead_id, r.exhibition_id, r.fms_instance_id, r.fms_stage, r.parent_interaction_id, r.source, r.external_ref, r.source_row, r.notes)
    on conflict (tenant_id, source, external_ref) where external_ref is not null do nothing
    returning id into v_id;
    if v_id is null then
      select id into strict v_id from customer.interactions
       where tenant_id = v_client.tenant_id and source = r.source and external_ref = r.external_ref;
    end if;
  else
    update customer.interactions set
      client_id = v_client.id, occurred_at = r.occurred_at, channel = r.channel, direction = r.direction, purpose = r.purpose,
      outcome = r.outcome, result = r.result, successful = r.successful, non_contact_reason = r.non_contact_reason,
      staff_user_id = r.staff_user_id, assigned_by_user_id = r.assigned_by_user_id, attended_by_user_id = r.attended_by_user_id,
      staff_name = r.staff_name, attended_by_name = r.attended_by_name, branch_id = r.branch_id, store_name = r.store_name,
      contact_role = r.contact_role, customer_type_stated = r.customer_type_stated, process_name = r.process_name,
      campaign_id = coalesce(r.campaign_id, campaign_id), campaign_member_id = coalesce(r.campaign_member_id, campaign_member_id),
      lead_id = coalesce(r.lead_id, lead_id), exhibition_id = coalesce(r.exhibition_id, exhibition_id),
      fms_instance_id = r.fms_instance_id, fms_stage = r.fms_stage,
      parent_interaction_id = coalesce(r.parent_interaction_id, parent_interaction_id),
      source_row = coalesce(r.source_row, source_row), notes = r.notes
    where id = v_id;
  end if;

  perform customer.refresh_client_stats(v_client.id);
  return v_id;
end $$;

create function customer.add_interaction_product(p_interaction_id uuid, p_product_code text, p_product_category text, p_interest text default 'interested')
returns void language plpgsql security definer set search_path = '' as $$
declare v_code text := customer.clean_name(p_product_code); v_cat text := customer.clean_name(p_product_category);
begin
  if v_code is null and v_cat is null then return; end if;
  insert into customer.interaction_products (tenant_id, interaction_id, client_id, product_code, product_category, interest)
  select i.tenant_id, i.id, i.client_id, v_code, v_cat, coalesce(p_interest, 'interested')
    from customer.interactions i where i.id = p_interaction_id
  on conflict do nothing;
end $$;

-- The next call a contact created. Repeatable per (origin interaction, kind):
-- a re-import moves the due date instead of adding a second follow-up.
create function customer.create_follow_up(
  p_client_id uuid, p_kind text, p_due_at timestamptz,
  p_origin_interaction_id uuid default null, p_assigned_to_user_id uuid default null, p_reason text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_id uuid;
begin
  if p_due_at is null then raise exception 'A follow-up needs a date' using errcode = '22023'; end if;
  select tenant_id into v_tenant from customer.clients where id = p_client_id;
  if v_tenant is null then raise exception 'Client not found' using errcode = '22023'; end if;
  if p_origin_interaction_id is not null then
    update customer.follow_ups
       set due_at = p_due_at, reason = coalesce(p_reason, reason),
           assigned_to_user_id = coalesce(p_assigned_to_user_id, assigned_to_user_id)
     where origin_interaction_id = p_origin_interaction_id and kind = p_kind and status = 'pending'
    returning id into v_id;
    if v_id is null then
      select id into v_id from customer.follow_ups where origin_interaction_id = p_origin_interaction_id and kind = p_kind;
    end if;
    if v_id is not null then return v_id; end if;
  end if;
  insert into customer.follow_ups (tenant_id, client_id, kind, origin_interaction_id, due_at, reason, assigned_to_user_id)
  values (v_tenant, p_client_id, p_kind, p_origin_interaction_id, p_due_at, p_reason, p_assigned_to_user_id)
  returning id into v_id;
  return v_id;
end $$;

-- A later contact that reached the customer closes the follow-ups that were
-- waiting for it (any caller, any campaign).
create function customer.close_follow_ups(p_client_id uuid, p_closing_interaction_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz; v_ok boolean; n integer;
begin
  select occurred_at, successful into v_at, v_ok from customer.interactions
   where id = p_closing_interaction_id and client_id = p_client_id;
  if v_at is null or not v_ok then return 0; end if;
  update customer.follow_ups f
     set status = 'done', closed_by_interaction_id = p_closing_interaction_id, closed_at = v_at
   where f.client_id = p_client_id and f.status = 'pending'
     and (f.origin_interaction_id is null
          or exists (select 1 from customer.interactions o
                      where o.id = f.origin_interaction_id and o.occurred_at < v_at));
  get diagnostics n = row_count;
  return n;
end $$;

create function customer.create_appointment(
  p_client_id uuid, p_type text, p_scheduled_at timestamptz,
  p_origin_interaction_id uuid default null, p_branch_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_id uuid;
begin
  if p_scheduled_at is null then raise exception 'An appointment needs a date' using errcode = '22023'; end if;
  select tenant_id into v_tenant from customer.clients where id = p_client_id;
  if v_tenant is null then raise exception 'Client not found' using errcode = '22023'; end if;
  if p_origin_interaction_id is not null then
    update customer.appointments
       set scheduled_at = p_scheduled_at, branch_id = coalesce(p_branch_id, branch_id)
     where origin_interaction_id = p_origin_interaction_id and type = p_type and status = 'booked'
    returning id into v_id;
    if v_id is null then
      select id into v_id from customer.appointments where origin_interaction_id = p_origin_interaction_id and type = p_type;
    end if;
    if v_id is not null then return v_id; end if;
  end if;
  insert into customer.appointments (tenant_id, client_id, type, origin_interaction_id, scheduled_at, branch_id)
  values (v_tenant, p_client_id, p_type, p_origin_interaction_id, p_scheduled_at, p_branch_id)
  returning id into v_id;
  return v_id;
end $$;

-- Everything that hangs off a client and must move when two clients merge.
-- Later migrations replace this function as they add tables.
create function customer.merge_related(p_keep_client_id uuid, p_remove_client_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update customer.interactions set client_id = p_keep_client_id where client_id = p_remove_client_id;
  update customer.interaction_products set client_id = p_keep_client_id where client_id = p_remove_client_id;
  update customer.follow_ups set client_id = p_keep_client_id where client_id = p_remove_client_id;
  update customer.appointments set client_id = p_keep_client_id where client_id = p_remove_client_id;
  perform customer.refresh_client_stats(p_keep_client_id);
  perform customer.refresh_client_stats(p_remove_client_id);
end $$;

-- merge_clients (0405) now calls merge_related. Exact-text patch, as in 0404:
-- the migration fails unless the expected line is found exactly once.
do $patch$
declare body text; found integer;
  old_text constant text := '  perform customer.refresh_primary_name(v_keep.id);';
  new_text constant text := E'  perform customer.merge_related(v_keep.id, v_remove.id);\n  perform customer.refresh_primary_name(v_keep.id);';
begin
  body := replace(pg_get_functiondef('customer.merge_clients(uuid,uuid,text,uuid)'::regprocedure), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then
    raise exception '0406: expected 1 match in customer.merge_clients, found %', found;
  end if;
  execute replace(body, old_text, new_text);
end $patch$;

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;

-- ---------------------------------------------------------------------------
-- 5. Read RPCs for the app
-- ---------------------------------------------------------------------------

-- One client's full journey, newest first: every contact from every source,
-- with what each one led to. Page with p_before = the last occurred_at shown.
create function public.customer_get_timeline(p_client_id uuid, p_limit integer default 50, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid; v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200); v_result jsonb;
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant_id();
  if not exists (select 1 from customer.clients where id = p_client_id and tenant_id = v_tenant) then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(row_json order by occurred_at desc, created_at desc), '[]'::jsonb) into v_result
  from (
    select i.occurred_at, i.created_at, jsonb_build_object(
      'interaction_id', i.id, 'interaction_code', i.interaction_code, 'occurred_at', i.occurred_at,
      'channel', i.channel, 'direction', i.direction, 'purpose', i.purpose,
      'outcome', i.outcome, 'result', i.result, 'successful', i.successful,
      'non_contact_reason', i.non_contact_reason, 'notes', i.notes, 'source', i.source,
      'staff', coalesce(su.employee_name, i.staff_name), 'attended_by', coalesce(au.employee_name, i.attended_by_name),
      'branch', coalesce(b.name, i.store_name), 'fms_stage', i.fms_stage,
      'campaign_id', i.campaign_id, 'lead_id', i.lead_id, 'parent_interaction_id', i.parent_interaction_id,
      'products', (select coalesce(jsonb_agg(jsonb_build_object('code', p.product_code, 'category', p.product_category, 'interest', p.interest)), '[]'::jsonb)
                     from customer.interaction_products p where p.interaction_id = i.id),
      'follow_ups', (select coalesce(jsonb_agg(jsonb_build_object('code', f.follow_up_code, 'kind', f.kind, 'due_at', f.due_at, 'status', f.status)), '[]'::jsonb)
                       from customer.follow_ups f where f.origin_interaction_id = i.id),
      'appointments', (select coalesce(jsonb_agg(jsonb_build_object('code', a.appointment_code, 'type', a.type, 'scheduled_at', a.scheduled_at, 'status', a.status)), '[]'::jsonb)
                         from customer.appointments a where a.origin_interaction_id = i.id)
    ) as row_json
    from customer.interactions i
    left join public.user_profiles su on su.id = i.staff_user_id
    left join public.user_profiles au on au.id = i.attended_by_user_id
    left join public.branches b on b.id = i.branch_id
    where i.client_id = p_client_id and (p_before is null or i.occurred_at < p_before)
    order by i.occurred_at desc, i.created_at desc
    limit v_limit
  ) t;
  return v_result;
end $$;

-- Live call view: calls per person for one day (India time), with how many
-- reached the customer.
create function public.customer_calls_by_staff(p_day date default null)
returns table (staff_user_id uuid, staff_name text, calls bigint, reached bigint, positive bigint, negative bigint, not_connected bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_day date := coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date);
  v_from timestamptz;
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant_id();
  v_from := v_day::timestamp at time zone 'Asia/Kolkata';
  return query
  select i.staff_user_id, coalesce(u.employee_name, i.staff_name),
         count(*), count(*) filter (where i.successful),
         count(*) filter (where i.result = 'positive'), count(*) filter (where i.result = 'negative'),
         count(*) filter (where i.result = 'not_connected')
    from customer.interactions i
    left join public.user_profiles u on u.id = i.staff_user_id
   where i.tenant_id = v_tenant and i.channel in ('call', 'video_call')
     and i.occurred_at >= v_from and i.occurred_at < v_from + interval '1 day'
   group by i.staff_user_id, coalesce(u.employee_name, i.staff_name)
   order by count(*) desc;
end $$;

revoke all on function public.customer_get_timeline(uuid, integer, timestamptz) from public, anon;
revoke all on function public.customer_calls_by_staff(date) from public, anon;
grant execute on function public.customer_get_timeline(uuid, integer, timestamptz) to authenticated, service_role;
grant execute on function public.customer_calls_by_staff(date) to authenticated, service_role;
