-- 0428: customer master list - where a customer is, and their tags.
--
-- Owner, 2026-11-18: the list shows only what helps - the name, client or
-- lead, a place (taken from the address when there is no city, never "No
-- city"), the last contact - and colour-coded categories.
--
-- customer_list rows gain:
--   place  the city; else the last place named in the address (a part with
--          letters that is not a pincode, India or the state); else the state;
--          else the country. Null when nothing is known.
--   tags   category keys, in this order, each from data already held:
--          abroad        the country is not India, or the main number is not +91
--          do_not_call   the customer is marked do not call
--          not_customer  SCRIPT STATUS says NON-CLIENT
--          staff         the data status says STAFF
--          wrong_data    the data status says WRONG DATA
--          referred      someone referred them
--          store:<name>  the store or branch they belong to, as written
-- customer_get_client_page gains the same tags. Read-only: no table changes. Labels and colours live in @jewelos/core.

-- The winning answer for one field: the highest-ranked source, then the newest.
create function customer.current_answer(p_client_id uuid, p_field_key text)
returns text language sql stable set search_path = '' as $$
  select v.value from customer.client_field_values v join customer.sources s on s.source = v.source
   where v.client_id = p_client_id and v.field_key = p_field_key
   order by s.source_rank desc, v.observed_at desc, v.created_at desc, v.id
   limit 1;
$$;

create function customer.client_place(p_city text, p_address text, p_state text, p_country text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(btrim(p_city), ''),
    -- A trailing pincode is dropped from a part ("Mumbai - 400094" is Mumbai).
    (select x.part from (
       select btrim(regexp_replace(part, '[-[:space:]]*[0-9]{6}[[:space:]]*$', '')) as part, n
         from unnest(string_to_array(regexp_replace(coalesce(p_address, ''), '[\n;]+', ',', 'g'), ',')) with ordinality as a(part, n)) x
      where x.part ~ '[[:alpha:]]{3,}' and length(x.part) <= 40
        and upper(x.part) not in ('INDIA', 'BHARAT', upper(coalesce(btrim(p_state), '')))
      order by x.n desc limit 1),
    nullif(btrim(p_state), ''),
    nullif(btrim(p_country), ''));
$$;

create function customer.client_tags(p_client_id uuid)
returns text[] language sql stable set search_path = '' as $$
  with c as (select * from customer.clients where id = p_client_id),
  a as (select customer.current_answer(p_client_id, 'data_status') as data_status,
               customer.current_answer(p_client_id, 'contact_type') as contact_type,
               customer.current_answer(p_client_id, 'store') as store)
  select array_remove(array[
    case when (c.country is not null and upper(btrim(c.country)) not in ('INDIA', 'IN', 'IND', 'BHARAT'))
           or exists (select 1 from customer.client_phones p where p.client_id = c.id and p.kind = 'primary' and p.phone !~ '^91')
         then 'abroad' end,
    case when c.do_not_call then 'do_not_call' end,
    case when upper(a.contact_type) like 'NON-CLIENT%' then 'not_customer' end,
    case when upper(btrim(a.data_status)) = 'STAFF' then 'staff' end,
    case when upper(btrim(a.data_status)) = 'WRONG DATA' then 'wrong_data' end,
    case when c.referred_by_client_id is not null then 'referred' end,
    case when nullif(btrim(a.store), '') is not null then 'store:' || btrim(a.store) end
  ], null)
  from c, a;
$$;

create or replace function public.customer_list(p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid;
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_q text := btrim(coalesce(f ->> 'q', ''));
  v_code text := upper(btrim(coalesce(f ->> 'q', '')));
  v_phone text;
  v_name_key text;
  v_ids uuid[];
  v_cities text[]; v_communities text[]; v_sources text[];
  v_not_days integer; v_within_days integer;
  v_sort text := coalesce(f ->> 'sort', 'recent');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint; v_rows jsonb;
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant_id();

  if jsonb_typeof(f -> 'cities') = 'array' and jsonb_array_length(f -> 'cities') > 0 then
    select array_agg(x) into v_cities from jsonb_array_elements_text(f -> 'cities') x; end if;
  if jsonb_typeof(f -> 'communities') = 'array' and jsonb_array_length(f -> 'communities') > 0 then
    select array_agg(x) into v_communities from jsonb_array_elements_text(f -> 'communities') x; end if;
  if jsonb_typeof(f -> 'first_sources') = 'array' and jsonb_array_length(f -> 'first_sources') > 0 then
    select array_agg(x) into v_sources from jsonb_array_elements_text(f -> 'first_sources') x; end if;
  if (f ->> 'not_contacted_days') ~ '^\d{1,5}$' then v_not_days := (f ->> 'not_contacted_days')::integer; end if;
  if (f ->> 'contacted_within_days') ~ '^\d{1,5}$' then v_within_days := (f ->> 'contacted_within_days')::integer; end if;

  -- The search box narrows to a set of clients first.
  if v_q <> '' then
    if v_q ~ '^[+0-9 ()-]+$' then v_phone := customer.normalize_phone(v_q); end if;
    v_name_key := customer.name_key(v_q);
    select coalesce(array_agg(distinct id), '{}') into v_ids from (
      select c.id from customer.clients c where c.tenant_id = v_tenant and (c.client_code = v_code or c.referral_code = v_code)
      union all
      select c.id from customer.households h join customer.clients c on c.household_id = h.id
       where h.tenant_id = v_tenant and h.household_code = v_code
      union all
      select p.client_id from customer.client_phones p
       where v_phone is not null and p.tenant_id = v_tenant and p.phone = v_phone
      union all
      (select n.client_id from customer.client_names n
        where v_phone is null and v_code !~ '^MK(C|F|REF)-' and length(v_name_key) >= 2
          and n.tenant_id = v_tenant and n.name_key like v_name_key || '%'
        limit 5000)
    ) s;
  end if;

  with filtered as (
    select c.*
      from customer.clients c
     where c.tenant_id = v_tenant and c.archived_at is null
       and (v_ids is null or c.id = any (v_ids))
       and (not (f ? 'segment') or c.segment = f ->> 'segment')
       and (not (f ? 'lifecycle_stage') or c.lifecycle_stage = f ->> 'lifecycle_stage')
       and (v_cities is null or c.city = any (v_cities))
       and (v_communities is null or c.community = any (v_communities))
       and (v_sources is null or c.first_source = any (v_sources))
       and (v_not_days is null or c.last_contacted_at is null or c.last_contacted_at < now() - make_interval(days => v_not_days))
       and (v_within_days is null or c.last_contacted_at >= now() - make_interval(days => v_within_days))
       and (coalesce((f ->> 'follow_up_due')::boolean, false) is false or exists (
             select 1 from customer.follow_ups fu
              where fu.client_id = c.id and fu.status = 'pending' and fu.due_at < (now() at time zone 'Asia/Kolkata')::date + 1))
  ), page as (
    select * from filtered
     order by
       case when v_sort = 'recent' then last_contacted_at end desc nulls last,
       case when v_sort = 'least_recent' then last_contacted_at end asc nulls first,
       case when v_sort = 'name' then primary_name end asc nulls last,
       case when v_sort = 'newest' then created_at end desc,
       client_code
     limit v_limit offset v_offset
  )
  select (select count(*) from filtered),
         coalesce((select jsonb_agg(jsonb_build_object(
           'client_id', p.id, 'client_code', p.client_code,
           'household_code', (select h.household_code from customer.households h where h.id = p.household_id),
           'primary_name', p.primary_name,
           'primary_phone', (select ph.phone from customer.client_phones ph where ph.client_id = p.id and ph.kind = 'primary'),
           'segment', p.segment, 'lifecycle_stage', p.lifecycle_stage, 'city', p.city, 'community', p.community,
           'first_source', p.first_source, 'first_seen_at', p.first_seen_at,
           'place', customer.client_place(p.city, p.address, p.state, p.country),
           'tags', customer.client_tags(p.id),
           'last_contacted_at', p.last_contacted_at, 'last_attempt_at', p.last_attempt_at,
           'interaction_count', p.interaction_count, 'successful_interaction_count', p.successful_interaction_count,
           'next_follow_up_at', (select min(fu.due_at) from customer.follow_ups fu where fu.client_id = p.id and fu.status = 'pending')
         ) order by
           case when v_sort = 'recent' then p.last_contacted_at end desc nulls last,
           case when v_sort = 'least_recent' then p.last_contacted_at end asc nulls first,
           case when v_sort = 'name' then p.primary_name end asc nulls last,
           case when v_sort = 'newest' then p.created_at end desc,
           p.client_code) from page p), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;


-- The customer page carries the same tags.
do $patch$
declare
  body text; found integer; f regprocedure := 'public.customer_get_client_page(text)'::regprocedure;
  old_text constant text := E'    ''archived'', v_client.archived_at is not null,\n';
  new_text constant text := E'    ''tags'', customer.client_tags(v_client.id),\n    ''archived'', v_client.archived_at is not null,\n';
begin
  body := replace(pg_get_functiondef(f), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then raise exception '0428: expected 1 match in customer_get_client_page, found %', found; end if;
  execute replace(body, old_text, new_text);
end $patch$;

revoke all on function customer.current_answer(uuid, text) from public, anon, authenticated;
revoke all on function customer.client_place(text, text, text, text) from public, anon, authenticated;
revoke all on function customer.client_tags(uuid) from public, anon, authenticated;
grant execute on function customer.current_answer(uuid, text), customer.client_place(text, text, text, text), customer.client_tags(uuid) to service_role;
