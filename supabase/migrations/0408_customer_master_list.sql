-- 0408: customer master database, part 4 - the master list.
--
-- Read RPCs behind the "Customer master" screen (/crm/master): one filtered,
-- paged list of every client and lead, and the values to filter by. Read-only;
-- no table changes. Both require crm.view and the CRM section switch.

create index clients_last_contacted_idx on customer.clients (tenant_id, last_contacted_at) where archived_at is null;
create index clients_community_idx on customer.clients (tenant_id, community) where archived_at is null;
create index clients_first_source_idx on customer.clients (tenant_id, first_source) where archived_at is null;

-- p_filters keys (all optional):
--   q                    code, phone or start of a name
--   segment              buyer | non-buyer | lead
--   lifecycle_stage      lead | engaged | visited
--   cities, communities, first_sources   arrays of exact values
--   not_contacted_days   never reached, or last reached more than N days ago
--   contacted_within_days  reached in the last N days
--   follow_up_due        true = has a pending follow-up due today or earlier
--   sort                 recent (default) | least_recent | name | newest
create function public.customer_list(p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0)
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

-- The values the list can be filtered by, each with how many clients have it.
create function public.customer_list_filters()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid;
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant_id();
  return jsonb_build_object(
    'total', (select count(*) from customer.clients where tenant_id = v_tenant and archived_at is null),
    'cities', (select coalesce(jsonb_agg(jsonb_build_object('value', city, 'count', n) order by n desc, city), '[]'::jsonb)
                 from (select city, count(*) n from customer.clients
                        where tenant_id = v_tenant and archived_at is null and city is not null group by city order by count(*) desc limit 300) t),
    'communities', (select coalesce(jsonb_agg(jsonb_build_object('value', community, 'count', n) order by n desc, community), '[]'::jsonb)
                      from (select community, count(*) n from customer.clients
                             where tenant_id = v_tenant and archived_at is null and community is not null group by community order by count(*) desc limit 300) t),
    'first_sources', (select coalesce(jsonb_agg(jsonb_build_object('value', t.first_source, 'label', coalesce(s.label, t.first_source), 'count', t.n) order by t.n desc), '[]'::jsonb)
                        from (select first_source, count(*) n from customer.clients
                               where tenant_id = v_tenant and archived_at is null and first_source is not null group by first_source) t
                        left join customer.sources s on s.source = t.first_source),
    'segments', (select coalesce(jsonb_object_agg(segment, n), '{}'::jsonb)
                   from (select segment, count(*) n from customer.clients where tenant_id = v_tenant and archived_at is null group by segment) t),
    'import', (select coalesce(jsonb_agg(jsonb_build_object('source', i.source, 'last_run_at', i.last_run_at, 'rows_received', i.rows_received, 'failed', i.last_error is not null)), '[]'::jsonb)
                 from customer.ingest_state i where i.tenant_id = v_tenant));
end $$;

revoke all on function public.customer_list(jsonb, integer, integer) from public, anon;
revoke all on function public.customer_list_filters() from public, anon;
grant execute on function public.customer_list(jsonb, integer, integer) to authenticated, service_role;
grant execute on function public.customer_list_filters() to authenticated, service_role;
