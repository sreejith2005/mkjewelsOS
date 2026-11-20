-- 0441: client details in every form come from the customer database.
--
-- Owner request 2026-11-04 (kept): when someone with CRM access types a phone
-- number that belongs to a customer into any form, the form fills the
-- questions it recognises with what is known about that person; a pincode
-- fills city, state and country. Until now this read the old CRM project
-- through its login bridge. The old CRM screens are removed (owner decision
-- 2026-11-20), so the form now reads the customer master database.
--
-- * public.customer_form_lookup(p_phone): the customer who owns that number,
--   as an object of text values keyed like packages/core CLIENT_PROFILE_KEYS,
--   or null. One phone is one client per franchise (0433); if the number is
--   known in two franchises, the asker's own franchise wins, then the most
--   recently contacted record. Merged and archived records are never returned.
-- * public.customer_pincode_lookup(p_pincode): city, state and country of a
--   6-digit pincode, or null.
-- * customer.pincodes holds the pincode list. It starts from this project's
--   copy (crm.lookup_pincodes); the owner copies the CRM project's list in with
--   customer.load_pincodes(jsonb) before that project is deleted (see the pull
--   request). load_pincodes runs only from the SQL editor (no API grant).
-- Both RPCs follow /crm access: the CRM section switch and crm.view, called as
-- the asker. They only read; nothing is audited, as for customer_search.

create table customer.pincodes (
  pincode text primary key check (pincode ~ '^[0-9]{6}$'),
  city text,
  state text,
  country text,
  updated_at timestamptz not null default now()
);
alter table customer.pincodes enable row level security;
revoke all on customer.pincodes from public, anon, authenticated;
grant all on customer.pincodes to service_role;

-- This project's copy of the list (the retired JewelOS crm schema; dropped later).
do $$
begin
  if to_regclass('crm.lookup_pincodes') is not null then
    insert into customer.pincodes (pincode, city, state, country)
    select distinct on (btrim(l.pincode)) btrim(l.pincode), nullif(btrim(l.city), ''), nullif(btrim(l.state), ''), nullif(btrim(l.country), '')
      from crm.lookup_pincodes l
     where l.active and btrim(l.pincode) ~ '^[0-9]{6}$'
     order by btrim(l.pincode), l.city nulls last
    on conflict (pincode) do nothing;
  end if;
end $$;

-- Owner-run copy of a pincode list: a JSON array of {"pincode", "city", "state", "country"}.
-- A pincode already present takes the new names. Returns how many rows it wrote.
create function customer.load_pincodes(p_rows jsonb) returns integer
language plpgsql
set search_path = ''
as $$
declare v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Give a JSON array of pincodes'; end if;
  insert into customer.pincodes as p (pincode, city, state, country, updated_at)
  select distinct on (btrim(r->>'pincode')) btrim(r->>'pincode'), nullif(btrim(r->>'city'), ''), nullif(btrim(r->>'state'), ''), nullif(btrim(r->>'country'), ''), now()
    from jsonb_array_elements(p_rows) r
   where btrim(coalesce(r->>'pincode', '')) ~ '^[0-9]{6}$'
     and coalesce((r->>'active')::boolean, true)
   order by btrim(r->>'pincode')
  on conflict (pincode) do update set city = excluded.city, state = excluded.state, country = excluded.country, updated_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create function public.customer_pincode_lookup(p_pincode text) returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $$
declare v_pin text := btrim(coalesce(p_pincode, ''));
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  if v_pin !~ '^[0-9]{6}$' then return null; end if;
  return (select jsonb_build_object('city', p.city, 'state', p.state, 'country', p.country)
            from customer.pincodes p where p.pincode = v_pin);
end $$;

create function public.customer_form_lookup(p_phone text) returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_phone text := customer.normalize_phone(p_phone);
  v_home uuid[];
  c customer.clients;
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  if v_phone is null then return null; end if;
  v_tenant := public.current_tenant_id();
  v_home := customer.franchises_in_view('home');

  select k.* into c
    from customer.client_phones p
    join customer.clients k on k.id = p.client_id
   where p.tenant_id = v_tenant and p.phone = v_phone and p.is_valid
     and k.merged_into_client_id is null and k.archived_at is null
     and customer.franchise_visible(k.franchise_group_id)
   order by (k.franchise_group_id = any (coalesce(v_home, '{}'))) desc,
            k.last_contacted_at desc nulls last, k.created_at desc
   limit 1;
  if c.id is null then return null; end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'primary_name', c.primary_name,
    'gender', c.gender,
    -- A date whose year is not known is not filled: the form would show a wrong year.
    'dob', case when c.dob_year_known then to_char(c.dob, 'YYYY-MM-DD') end,
    'anniversary', case when c.anniversary_year_known then to_char(c.anniversary, 'YYYY-MM-DD') end,
    'community', c.community,
    'occupation', c.occupation,
    'address', c.address,
    'pincode', c.pincode,
    'country', c.country,
    'state', c.state,
    'city', c.city,
    'beverage', c.beverage,
    'sugar', c.sugar,
    'snack', c.snack,
    'communication_preference', c.communication_preference,
    'billing_phone', (select '+' || b.phone from customer.client_phones b
                       where b.client_id = c.id and b.kind = 'billing' and b.is_valid
                       order by b.last_seen_at desc limit 1)));
end $$;

revoke all on function customer.load_pincodes(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.customer_pincode_lookup(text) from public, anon;
revoke all on function public.customer_form_lookup(text) from public, anon;
grant execute on function public.customer_pincode_lookup(text) to authenticated;
grant execute on function public.customer_form_lookup(text) to authenticated;
