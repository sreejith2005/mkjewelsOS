-- 0457: every Data standards screen reads only prepared counts.
--
-- Owner, 2026-11-28: after 0456 the page opened, but a field's review list,
-- its values and the decision buttons still hit the request time limit
-- while the first reading of every answer was running.
--
-- * The value counts also keep, per value, the three most common spellings,
--   their sources and (for unclear places) the candidate places, so the
--   review list reads one small table and nothing else per value.
-- * A new answer updates its value's counts at once (the trigger that reads
--   it), so new spellings from imports appear without a full recount.
-- * Full recounts run in the background only for fields whose answers were
--   read again since the last count (every 15 minutes), and for all fields
--   once a night. They no longer run every 10 minutes for everything.
-- * Customers per reference value are counted with the field counts.
-- * A decision reads the counted customers instead of counting live.

set statement_timeout = '30min';

alter table customer.std_value_stats
  add column examples jsonb not null default '[]'::jsonb,
  add column sources jsonb not null default '[]'::jsonb,
  add column candidates uuid[];

create table customer.std_ref_counts (
  value_id uuid primary key references customer.ref_values(id) on delete cascade,
  customers integer not null,
  refreshed_at timestamptz not null default now()
);
alter table customer.std_ref_counts enable row level security;
revoke all on customer.std_ref_counts from public, anon, authenticated;
grant all on customer.std_ref_counts to service_role;

-- A full count of one field.
create or replace function customer.refresh_std_stats(p_field text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare f customer.field_catalog; n integer := 0;
begin
  insert into customer.std_field_stats (field_key, observations, customers, refreshed_at)
  select v.field_key, count(*), count(distinct v.client_id), now() from customer.client_field_values v
   where p_field is null or v.field_key = p_field group by v.field_key
  on conflict (field_key) do update set observations = excluded.observations, customers = excluded.customers, refreshed_at = now();

  for f in select * from customer.field_catalog where policy <> 'none' and (p_field is null or key = p_field) loop
    create temp table if not exists std_obs (client_id uuid, raw text, source text, status text, k text, candidates uuid[], value_id uuid) on commit drop;
    truncate std_obs;
    insert into std_obs
    select v.client_id, case when f.multi then coalesce(i.part, v.value) else v.value end, v.source, coalesce(i.status, 'pending'),
           case when f.multi then customer.std_key(coalesce(i.part, v.value)) else customer.std_key(v.value) end, i.candidates, i.value_id
      from customer.client_field_values v
      left join customer.value_interpretations i on i.field_value_id = v.id and i.output_field = coalesce(f.output_field, f.key)
     where v.field_key = f.key;

    update customer.std_field_stats s set statuses = coalesce((
      select jsonb_object_agg(t.status, t.n) from (select status, count(*) n from std_obs group by status) t), '{}'::jsonb)
     where s.field_key = f.key;

    delete from customer.std_value_stats where field_key = f.key;
    insert into customer.std_value_stats (field_key, input_key, observations, customers, status, has_rule, examples, sources, candidates)
    select f.key, g.k, g.observations, g.customers, g.status,
           exists (select 1 from customer.std_rules r where r.field_key = f.key and r.input_key = g.k and r.status in ('approved', 'draft')),
           coalesce((select jsonb_agg(e.raw) from (select o.raw from std_obs o where o.k = g.k group by o.raw order by count(*) desc limit 3) e), '[]'),
           coalesce((select jsonb_agg(e.label) from (select coalesce(so.label, o.source) as label from std_obs o left join customer.sources so on so.source = o.source
                                                       where o.k = g.k group by 1 order by count(*) desc limit 3) e), '[]'),
           (select o.candidates from std_obs o where o.k = g.k and o.candidates is not null limit 1)
      from (select k, count(*) observations, count(distinct client_id) customers, (array_agg(status order by status))[1] status
              from std_obs where k is not null group by k) g;

    insert into customer.std_ref_counts (value_id, customers, refreshed_at)
    select value_id, count(distinct client_id), now() from std_obs where value_id is not null group by value_id
    on conflict (value_id) do update set customers = excluded.customers, refreshed_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- The background recount: fields read again since their last count (or never counted).
create function customer.refresh_changed_std_stats() returns integer
language plpgsql security definer set search_path = '' as $$
declare f text; n integer := 0;
begin
  for f in
    select c.key from customer.field_catalog c
      left join customer.std_field_stats s on s.field_key = c.key
     where c.policy <> 'none'
       and (s.refreshed_at is null or exists (select 1 from customer.std_jobs j where j.field_key = c.key and j.finished_at > s.refreshed_at))
     order by s.refreshed_at nulls first
  loop
    perform customer.refresh_std_stats(f);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.customer_refresh_std_stats() returns integer
language sql security definer set search_path = '' as $$ select customer.refresh_changed_std_stats(); $$;
create function public.customer_refresh_all_std_stats() returns integer
language sql security definer set search_path = '' as $$ select customer.refresh_std_stats(null); $$;
revoke all on function public.customer_refresh_all_std_stats() from public, anon, authenticated;
grant execute on function public.customer_refresh_all_std_stats() to service_role;
revoke all on function customer.refresh_changed_std_stats() from public, anon, authenticated;

-- A new answer counts at once.
create or replace function customer.on_field_value_added() returns trigger language plpgsql security definer set search_path = '' as $$
declare f customer.field_catalog; i record; v_label text;
begin
  select * into f from customer.field_catalog c where c.key = new.field_key and c.policy <> 'none';
  if f.key is null then return null; end if;
  perform customer.interpret_observation(new.id);
  v_label := (select coalesce(s.label, new.source) from customer.sources s where s.source = new.source);
  for i in select distinct on (k) k, status from (
             select customer.std_key(case when f.multi then coalesce(x.part, new.value) else new.value end) as k, x.status
               from customer.value_interpretations x where x.field_value_id = new.id and x.output_field = coalesce(f.output_field, f.key)
             union all
             select customer.std_key(new.value), 'pending' where not exists (select 1 from customer.value_interpretations x where x.field_value_id = new.id)) t
            where k is not null
  loop
    insert into customer.std_value_stats (field_key, input_key, observations, customers, status, examples, sources)
    values (f.key, i.k, 1, 1, i.status, jsonb_build_array(new.value), jsonb_build_array(v_label))
    on conflict (field_key, input_key) do update
      set observations = customer.std_value_stats.observations + 1,
          customers = customer.std_value_stats.customers + case when exists (
              select 1 from customer.client_field_values o where o.client_id = new.client_id and o.field_key = new.field_key and o.id <> new.id
                 and customer.std_key(o.value) = i.k) then 0 else 1 end,
          refreshed_at = now();
  end loop;
  return null;
end $$;

-- The review list: one small table, plus suggestions from the short alias list.
create or replace function public.customer_std_queue(p_field text, p_show text default 'open', p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f customer.field_catalog; v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform customer.std_require('customers.view_data_quality');
  f := customer.std_field(p_field);
  if f.policy = 'none' then raise exception 'This field is not standardized yet' using errcode = '22023'; end if;
  return (
    with shown as (
      select * from customer.std_value_stats s
       where s.field_key = f.key
         and case p_show when 'open' then s.status in ('unmapped', 'ambiguous', 'wrong_field', 'pending') and not s.has_rule
                         when 'all' then true else s.status = p_show end
    ), page as (
      select * from shown order by customers desc, input_key limit 25 offset v_offset
    )
    select jsonb_build_object(
      'field', f.key, 'label', f.label, 'domain', f.ref_domain, 'policy', f.policy, 'total', (select count(*) from shown),
      'counted_at', (select refreshed_at from customer.std_field_stats where field_key = f.key),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'input_key', s.input_key, 'observations', s.observations, 'customers', s.customers, 'status', s.status,
          'examples', s.examples, 'sources', s.sources,
          'rule', (select jsonb_build_object('id', r.id, 'version', r.version, 'outputs', r.outputs, 'status', r.status)
                     from customer.std_rules r where r.field_key = f.key and r.input_key = s.input_key and r.status in ('approved', 'draft') order by r.status limit 1),
          'candidates', (select coalesce(jsonb_agg(jsonb_build_object('code', customer.ref_code(rv.id), 'label', rv.label, 'kind', rv.kind,
                            'parent', (select p.label from customer.ref_values p where p.id = rv.parent_id))), '[]'::jsonb)
                           from customer.ref_values rv where rv.id = any (coalesce(s.candidates, '{}'))),
          'suggestions', (select coalesce(jsonb_agg(jsonb_build_object('code', customer.ref_code(t.id), 'label', t.label, 'kind', t.kind,
                             'parent', t.parent, 'score', round(t.score::numeric, 2))), '[]'::jsonb)
                            from (select rv.id, rv.label, rv.kind, (select p.label from customer.ref_values p where p.id = rv.parent_id) as parent,
                                         max(extensions.similarity(a.alias_key, s.input_key)) as score
                                    from customer.ref_aliases a join customer.ref_values rv on rv.id = a.value_id
                                   where a.domain = coalesce(f.ref_domain, '') and rv.active and a.alias_key operator(extensions.%) s.input_key
                                   group by rv.id, rv.label, rv.kind, rv.parent_id order by max(extensions.similarity(a.alias_key, s.input_key)) desc limit 3) t))
        order by s.customers desc, s.input_key) from page s), '[]'::jsonb)));
end $$;

-- Values: counted customers.
create or replace function public.customer_ref_values(p_domain text, p_q text default null, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := customer.std_key(p_q);
begin
  perform customer.std_require('customers.view_data_quality');
  if exists (select 1 from customer.field_catalog f where f.ref_domain = p_domain and f.sensitive) and not public.has_permission('customers.view_sensitive') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  return (
    with hits as (
      select v.* from customer.ref_values v
       where v.domain = p_domain
         and (v_q is null or exists (select 1 from customer.ref_aliases a where a.value_id = v.id and a.alias_key like '%' || v_q || '%'))
    )
    select jsonb_build_object(
      'total', (select count(*) from hits),
      'items', coalesce((select jsonb_agg(jsonb_build_object('code', v.domain || ':' || v.code, 'label', v.label, 'kind', v.kind, 'active', v.active,
                 'parent', (select jsonb_build_object('code', p.domain || ':' || p.code, 'label', p.label) from customer.ref_values p where p.id = v.parent_id),
                 'superseded_by', (select s.label from customer.ref_values s where s.id = v.superseded_by),
                 'aliases', (select coalesce(jsonb_agg(a.alias order by a.alias), '[]'::jsonb) from customer.ref_aliases a where a.value_id = v.id and a.kind <> 'label'),
                 'customers', coalesce((select c.customers from customer.std_ref_counts c where c.value_id = v.id), 0),
                 'notes', v.notes) order by coalesce((select c.customers from customer.std_ref_counts c where c.value_id = v.id), 0) desc, v.label)
               from (select * from hits h order by coalesce((select c.customers from customer.std_ref_counts c where c.value_id = h.id), 0) desc, h.label
                      limit 100 offset greatest(coalesce(p_offset, 0), 0)) v), '[]'::jsonb)));
end $$;

-- The preview and a decision read the counted customers.
create or replace function public.customer_std_preview(p_field text, p_input_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f customer.field_catalog; s customer.std_value_stats;
begin
  perform customer.std_require('customers.view_data_quality');
  f := customer.std_field(p_field);
  select * into s from customer.std_value_stats where field_key = f.key and input_key = p_input_key;
  return jsonb_build_object('observations', coalesce(s.observations, 0), 'customers', coalesce(s.customers, 0),
                            'sources', coalesce(s.sources, '[]'::jsonb), 'high_impact', coalesce(s.customers, 0) > 500,
                            'counted_at', s.refreshed_at);
end $$;

-- Schedules: changed fields every 15 minutes, everything nightly.
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'customer-standards-stats') then perform cron.unschedule('customer-standards-stats'); end if;
    perform cron.schedule('customer-standards-stats', '*/15 * * * *', 'set statement_timeout = ''14min''; select public.customer_refresh_std_stats();');
    if exists (select 1 from cron.job where jobname = 'customer-standards-stats-nightly') then perform cron.unschedule('customer-standards-stats-nightly'); end if;
    perform cron.schedule('customer-standards-stats-nightly', '50 22 * * *', 'set statement_timeout = ''30min''; select public.customer_refresh_all_std_stats();');
  end if;
end $$;

select customer.refresh_std_stats(null);
reset statement_timeout;
