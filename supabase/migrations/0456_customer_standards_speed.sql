-- 0456: Data standards and Review duplicates within the request time limit.
--
-- Owner, 2026-11-28: both pages failed with "canceling statement due to
-- statement timeout", and the first standards jobs had not moved.
--
-- * customer.ingest_rows had no index on client_id. Every review card counts
--   a customer's sheet rows (customer.review_side), so each card scanned the
--   whole table. Index added.
-- * Data standards counted every answer of every field on each open. The
--   counts now come from two small tables (customer.std_field_stats,
--   customer.std_value_stats), refreshed in the background every 10 minutes
--   and right after a decision for that value.
-- * The jobs worker runs smaller batches, with its own time limit, and one bad
--   answer no longer stops a batch: it is noted on the job and skipped.

set statement_timeout = '30min';

create index if not exists ingest_rows_client_idx on customer.ingest_rows (client_id) where client_id is not null;

create table customer.std_field_stats (
  field_key text primary key,
  observations integer not null default 0,
  customers integer not null default 0,
  statuses jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now()
);
create table customer.std_value_stats (
  field_key text not null,
  input_key text not null,
  observations integer not null,
  customers integer not null,
  status text not null,
  has_rule boolean not null default false,
  refreshed_at timestamptz not null default now(),
  primary key (field_key, input_key)
);
create index std_value_stats_rank_idx on customer.std_value_stats (field_key, customers desc, input_key);
do $$
declare t text;
begin
  foreach t in array array['std_field_stats', 'std_value_stats'] loop
    execute format('alter table customer.%I enable row level security', t);
    execute format('revoke all on customer.%I from public, anon, authenticated', t);
    execute format('grant all on customer.%I to service_role', t);
  end loop;
end $$;

-- Counts for one standardized field (or every field when null).
create function customer.refresh_std_stats(p_field text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare f customer.field_catalog; n integer := 0;
begin
  insert into customer.std_field_stats (field_key, observations, customers, refreshed_at)
  select v.field_key, count(*), count(distinct v.client_id), now() from customer.client_field_values v
   where p_field is null or v.field_key = p_field group by v.field_key
  on conflict (field_key) do update set observations = excluded.observations, customers = excluded.customers, refreshed_at = now();

  for f in select * from customer.field_catalog where policy <> 'none' and (p_field is null or key = p_field) loop
    update customer.std_field_stats s set statuses = coalesce((
      select jsonb_object_agg(t.status, t.n) from (
        select i.status, count(distinct i.field_value_id) n from customer.value_interpretations i
          join customer.client_field_values v on v.id = i.field_value_id
         where v.field_key = f.key and i.output_field = coalesce(f.output_field, f.key) group by i.status) t), '{}'::jsonb)
     where s.field_key = f.key;
    delete from customer.std_value_stats where field_key = f.key;
    insert into customer.std_value_stats (field_key, input_key, observations, customers, status, has_rule)
    select f.key, o.k, count(*), count(distinct o.client_id), (array_agg(o.status order by o.status))[1],
           exists (select 1 from customer.std_rules r where r.field_key = f.key and r.input_key = o.k and r.status in ('approved', 'draft'))
      from (select v.client_id, coalesce(i.status, 'pending') as status,
                   case when f.multi then customer.std_key(i.part) else customer.std_key(v.value) end as k
              from customer.client_field_values v
              left join customer.value_interpretations i on i.field_value_id = v.id and i.output_field = coalesce(f.output_field, f.key)
             where v.field_key = f.key) o
     where o.k is not null group by o.k;
    n := n + 1;
  end loop;
  return n;
end $$;

create function public.customer_refresh_std_stats() returns integer
language sql security definer set search_path = '' as $$ select customer.refresh_std_stats(null); $$;
revoke all on function public.customer_refresh_std_stats() from public, anon, authenticated;
grant execute on function public.customer_refresh_std_stats() to service_role;
revoke all on function customer.refresh_std_stats(text) from public, anon, authenticated;

-- The overview reads the counts.
create or replace function public.customer_std_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform customer.std_require('customers.view_data_quality');
  return jsonb_build_object(
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label, 'policy', f.policy, 'domain', f.ref_domain, 'multi', f.multi,
               'sensitive', f.sensitive, 'output_field', coalesce(f.output_field, f.key), 'meaning', f.meaning,
               'observations', coalesce(s.observations, 0), 'customers', coalesce(s.customers, 0), 'statuses', coalesce(s.statuses, '{}'::jsonb),
               'values', (select count(*) from customer.ref_values r where r.domain = f.ref_domain and r.active),
               'counted_at', s.refreshed_at)
             order by f.policy = 'none', f.sort_order, f.label)
        from customer.field_catalog f
        left join customer.std_field_stats s on s.field_key = f.key
       where f.kind in ('column', 'answer') and (not f.sensitive or public.has_permission('customers.view_sensitive'))
         and (f.policy <> 'none' or coalesce(s.observations, 0) > 0)), '[]'::jsonb),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'field', j.field_key, 'reason', j.reason, 'status', j.status,
               'processed', j.processed, 'clients', j.clients, 'created_at', j.created_at, 'finished_at', j.finished_at, 'error', j.error) order by j.created_at desc), '[]'::jsonb)
               from (select * from customer.std_jobs order by created_at desc limit 20) j),
    'can', jsonb_build_object('suggest', public.has_permission('customers.suggest_mappings'), 'approve', public.has_permission('customers.approve_mappings'),
             'high_impact', public.has_permission('customers.approve_high_impact'), 'reference', public.has_permission('customers.manage_reference_values'),
             'policies', public.has_permission('customers.manage_field_policies'), 'reprocess', public.has_permission('customers.reprocess_data'),
             'rollback', public.has_permission('customers.rollback_standards')));
end $$;

-- The review queue reads the counted values; details only for the 25 shown.
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
      'counted_at', (select max(refreshed_at) from customer.std_value_stats where field_key = f.key),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'input_key', s.input_key, 'observations', s.observations, 'customers', s.customers, 'status', s.status,
          'examples', (select coalesce(jsonb_agg(e.value), '[]'::jsonb) from (
                         select v.value from customer.client_field_values v
                          where v.field_key = f.key and customer.std_key(v.value) = s.input_key
                          group by v.value order by count(*) desc limit 3) e),
          'sources', (select coalesce(jsonb_agg(e.label), '[]'::jsonb) from (
                        select coalesce(so.label, v.source) as label from customer.client_field_values v join customer.sources so on so.source = v.source
                         where v.field_key = f.key and customer.std_key(v.value) = s.input_key group by 1 order by count(*) desc limit 3) e),
          'rule', (select jsonb_build_object('id', r.id, 'version', r.version, 'outputs', r.outputs, 'status', r.status)
                     from customer.std_rules r where r.field_key = f.key and r.input_key = s.input_key and r.status in ('approved', 'draft') order by r.status limit 1),
          'candidates', (select coalesce(jsonb_agg(distinct jsonb_build_object('code', customer.ref_code(c.x), 'label', rv.label, 'kind', rv.kind,
                            'parent', (select p.label from customer.ref_values p where p.id = rv.parent_id))), '[]'::jsonb)
                           from (select unnest(i.candidates) as x from customer.value_interpretations i
                                  join customer.client_field_values v on v.id = i.field_value_id
                                 where v.field_key = f.key and i.status = 'ambiguous' and customer.std_key(v.value) = s.input_key limit 20) c
                           join customer.ref_values rv on rv.id = c.x),
          'suggestions', (select coalesce(jsonb_agg(jsonb_build_object('code', customer.ref_code(t.id), 'label', t.label, 'kind', t.kind,
                             'parent', t.parent, 'score', round(t.score::numeric, 2))), '[]'::jsonb)
                            from (select rv.id, rv.label, rv.kind, (select p.label from customer.ref_values p where p.id = rv.parent_id) as parent,
                                         max(extensions.similarity(a.alias_key, s.input_key)) as score
                                    from customer.ref_aliases a join customer.ref_values rv on rv.id = a.value_id
                                   where a.domain = coalesce(f.ref_domain, '') and rv.active and a.alias_key operator(extensions.%) s.input_key
                                   group by rv.id, rv.label, rv.kind, rv.parent_id order by max(extensions.similarity(a.alias_key, s.input_key)) desc limit 3) t))
        order by s.customers desc, s.input_key) from page s), '[]'::jsonb)));
end $$;

-- The preview counts with the index on (field_key, normalized value).
create or replace function public.customer_std_preview(p_field text, p_input_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f customer.field_catalog; v_out text;
begin
  perform customer.std_require('customers.view_data_quality');
  f := customer.std_field(p_field);
  v_out := coalesce(f.output_field, f.key);
  return (
    with obs as (
      select v.id, v.client_id, v.source from customer.client_field_values v
       where v.field_key = f.key and customer.std_key(v.value) = p_input_key
      union
      select v.id, v.client_id, v.source from customer.client_field_values v
       where f.multi and v.field_key = f.key and v.value like '%,%'
         and exists (select 1 from unnest(string_to_array(v.value, ',')) p where customer.std_key(p) = p_input_key)
    )
    select jsonb_build_object(
      'observations', (select count(*) from obs),
      'customers', (select count(distinct client_id) from obs),
      'sources', (select coalesce(jsonb_object_agg(coalesce(s.label, o.source), o.n), '{}'::jsonb) from (select source, count(*) n from obs group by source) o
                    left join customer.sources s on s.source = o.source),
      'shown_now', (select coalesce(jsonb_agg(jsonb_build_object('value', t.v, 'customers', t.n) order by t.n desc), '[]'::jsonb) from (
                      select c.std_values ->> v_out as v, count(*) n from customer.clients c
                       where c.id in (select client_id from obs) group by 1 order by 2 desc limit 5) t),
      'high_impact', (select count(distinct client_id) from obs) > 500));
end $$;

-- A decision leaves the "to review" list at once.
create function customer.on_std_rule_changed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update customer.std_value_stats s set has_rule = exists (
           select 1 from customer.std_rules r where r.field_key = new.field_key and r.input_key = new.input_key and r.status in ('approved', 'draft'))
   where s.field_key = new.field_key and s.input_key = new.input_key;
  return null;
end $$;
create trigger std_rules_stats after insert or update of status on customer.std_rules
  for each row execute function customer.on_std_rule_changed();
revoke all on function customer.on_std_rule_changed() from public, anon, authenticated;

-- The worker: one bad answer is noted and skipped, not a stopped batch.
create or replace function customer.process_std_jobs(p_limit integer default 1000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j customer.std_jobs; v_ids uuid[]; v_clients uuid[]; v_budget integer := greatest(coalesce(p_limit, 1000), 1); v_done integer := 0;
  v_client uuid; v_last uuid; v_msg text; v_failed text;
begin
  for j in select * from customer.std_jobs where status in ('pending', 'running') order by created_at, id for update skip locked loop
    exit when v_budget <= 0;
    v_failed := null;
    if j.input_key is null or not coalesce((select multi from customer.field_catalog where key = j.field_key), false) then
      select coalesce(array_agg(id order by id), '{}') into v_ids from (
        select v.id from customer.client_field_values v
         where v.field_key = j.field_key and (j.input_key is null or customer.std_key(v.value) = j.input_key)
           and (j.cursor_id is null or v.id > j.cursor_id)
         order by v.id limit v_budget) t;
    else
      select coalesce(array_agg(id order by id), '{}') into v_ids from (
        select v.id from customer.client_field_values v
         where v.field_key = j.field_key
           and exists (select 1 from unnest(string_to_array(v.value, ',')) p where customer.std_key(p) = j.input_key)
           and (j.cursor_id is null or v.id > j.cursor_id)
         order by v.id limit v_budget) t;
    end if;
    foreach v_last in array v_ids loop
      begin
        perform customer.interpret_observation(v_last);
      exception when others then
        get stacked diagnostics v_msg = message_text;
        v_failed := left(coalesce(v_failed || '; ', '') || v_last || ': ' || v_msg, 1000);
      end;
    end loop;
    select coalesce(array_agg(distinct client_id), '{}') into v_clients from customer.client_field_values where id = any (v_ids);
    foreach v_client in array v_clients loop
      begin
        perform customer.project_client_field(v_client, j.field_key);
        perform customer.refresh_client_answers(v_client);
      exception when others then
        get stacked diagnostics v_msg = message_text;
        v_failed := left(coalesce(v_failed || '; ', '') || v_client || ': ' || v_msg, 1000);
      end;
    end loop;
    v_budget := v_budget - cardinality(v_ids);
    v_done := v_done + cardinality(v_ids);
    update customer.std_jobs
       set status = case when cardinality(v_ids) = 0 or v_budget > 0 then 'done' else 'running' end,
           finished_at = case when cardinality(v_ids) = 0 or v_budget > 0 then now() end,
           processed = processed + cardinality(v_ids), clients = clients + cardinality(v_clients),
           cursor_id = coalesce(v_ids[cardinality(v_ids)], cursor_id),
           error = coalesce(v_failed, error)
     where id = j.id;
    -- A finished value job refreshes that value's counts.
    if (cardinality(v_ids) = 0 or v_budget > 0) and j.input_key is not null then
      update customer.std_value_stats s set status = coalesce((
               select (array_agg(coalesce(i.status, 'pending') order by i.status))[1] from customer.client_field_values v
                 left join customer.value_interpretations i on i.field_value_id = v.id
                where v.field_key = j.field_key and customer.std_key(v.value) = j.input_key), s.status), refreshed_at = now()
       where s.field_key = j.field_key and s.input_key = j.input_key;
    end if;
  end loop;
  return jsonb_build_object('processed', v_done, 'open', (select count(*) from customer.std_jobs where status in ('pending', 'running')));
end $$;
create or replace function public.customer_process_std_jobs() returns jsonb
language sql security definer set search_path = '' as $$ select customer.process_std_jobs(1000); $$;
revoke all on function customer.process_std_jobs(integer) from public, anon, authenticated;

-- Schedules with their own time limits (a minute's batch must end inside the minute).
do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'customer-standards-jobs') then perform cron.unschedule('customer-standards-jobs'); end if;
    perform cron.schedule('customer-standards-jobs', '* * * * *', 'set statement_timeout = ''55s''; select public.customer_process_std_jobs();');
    if exists (select 1 from cron.job where jobname = 'customer-standards-stats') then perform cron.unschedule('customer-standards-stats'); end if;
    perform cron.schedule('customer-standards-stats', '*/10 * * * *', 'set statement_timeout = ''9min''; select public.customer_refresh_std_stats();');
  end if;
end $$;

select customer.refresh_std_stats(null);
reset statement_timeout;
