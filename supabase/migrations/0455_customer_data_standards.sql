-- 0455: customer data standards - one framework for clean, traceable values.
--
-- Design: docs/superpowers/specs/2026-11-28-customer-data-standards-design.md
-- Owner decisions (2026-11-28):
--   * A canonical value's label is the spelling used most; every other name
--     stays visible (aliases and the raw values).
--   * Place is kept as country, state, district, city and locality; a known
--     locality (Borivali) shows City Mumbai and Locality Borivali. Ambiguous
--     or conflicting places go to review, never guessed.
--   * Community stays a field and a filter, behind the permission "See
--     sensitive customer fields" (everyone for now; hiding comes later).
--     Only what was written is tidied; nothing is inferred.
--   * "First source" keeps its meaning; "Imported from" and "How they found
--     us" (acquisition source) are separate fields. Unknown stays unknown.
--   * Governance is permission-driven (Super Admin first): view quality,
--     suggest, approve, manage reference values, approve high-impact or
--     cross-field, manage field policies, reprocess, roll back.
--   * Validity before priority: the highest-ranked source with a meaningful
--     value wins ("None" or "P" from a better source does not beat "Mumbai").
--     A verified correction or a requested removal is not overridden by
--     older data.
--
-- Layers:
--   client_field_values (raw observation, unchanged)
--     -> value_interpretations (per observation and output field: reference
--        value or status, and the rule or method that produced it)
--     -> projection (per output field: the winner among eligible
--        interpretations by the existing source ranking) into the typed
--        client columns, clients.std_values / std_codes / std_status, and the
--        customer table.
--   ref_values + ref_aliases: canonical values with stable codes.
--   std_rules: approved interpretations of a normalized raw value, by field
--   (and optionally source), with one or more outputs; versions kept.
--   std_jobs: targeted reprocessing after a rule or value change.

-- Index builds over every answer and the label-by-usage counts can take minutes.
set statement_timeout = '30min';

-- ---------------------------------------------------------------------------
-- 0. Permissions
-- ---------------------------------------------------------------------------
-- permission-catalog:begin
insert into public.permission_catalog (key, kind, page_id, default_roles, sort_order) values
('customers.view_sensitive', 'action', null, '{super_admin,admin,manager,hr,crm,staff,doer,housekeeping}', 1400),
('customers.view_data_quality', 'action', null, '{super_admin}', 1401),
('customers.suggest_mappings', 'action', null, '{super_admin}', 1402),
('customers.approve_mappings', 'action', null, '{super_admin}', 1403),
('customers.manage_reference_values', 'action', null, '{super_admin}', 1404),
('customers.approve_high_impact', 'action', null, '{super_admin}', 1405),
('customers.manage_field_policies', 'action', null, '{super_admin}', 1406),
('customers.reprocess_data', 'action', null, '{super_admin}', 1407),
('customers.rollback_standards', 'action', null, '{super_admin}', 1408);
-- permission-catalog:end

do $$ begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then create extension pg_trgm with schema extensions; end if;
  if not exists (select 1 from pg_extension where extname = 'unaccent') then create extension unaccent with schema extensions; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Field policy on the catalogue
-- ---------------------------------------------------------------------------
alter table customer.field_catalog
  add column policy text not null default 'none' check (policy in ('none', 'reference', 'place')),
  add column ref_domain text,
  add column output_field text,
  add column multi boolean not null default false,
  add column sensitive boolean not null default false,
  add column meaning text;
comment on column customer.field_catalog.policy is 'Migration 0455: none = shown as written; reference = interpreted into values of ref_domain; place = the geography projector (country, state, district, city, locality).';
comment on column customer.field_catalog.output_field is 'Migration 0455: the field an observation of this key feeds (default the key itself), e.g. lead_source feeds acquisition_source.';

alter table customer.clients
  add column locality text,
  add column district text,
  add column std_values jsonb not null default '{}'::jsonb,
  add column std_codes jsonb not null default '{}'::jsonb,
  add column std_status jsonb not null default '{}'::jsonb;
comment on column customer.clients.std_values is 'Migration 0455: the standardized value per output field (label, or the raw text when not yet standardized); lists for multi-value fields.';
comment on column customer.clients.std_codes is 'Migration 0455: the stable reference code(s) per output field.';
comment on column customer.clients.std_status is 'Migration 0455: per output field: standardized, verified, unmapped, derived, cross_field, conflict, cleared.';
create index clients_std_codes_idx on customer.clients using gin (std_codes jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- 2. Reference values
-- ---------------------------------------------------------------------------
create table customer.ref_values (
  id uuid primary key default gen_random_uuid(),
  domain text not null check (domain ~ '^[a-z][a-z0-9_]{0,40}$'),
  code text not null check (code ~ '^[a-z0-9][a-z0-9_-]{0,80}$'),
  label text not null check (length(btrim(label)) between 1 and 120),
  kind text,
  parent_id uuid references customer.ref_values(id),
  active boolean not null default true,
  superseded_by uuid references customer.ref_values(id),
  external_code text,
  notes text,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (domain, code),
  check (superseded_by is null or superseded_by <> id),
  check (parent_id is null or parent_id <> id)
);
create index ref_values_parent_idx on customer.ref_values (parent_id);
comment on table customer.ref_values is 'Migration 0455: canonical values with stable codes (domain + code never change; label can be renamed).';

create table customer.ref_aliases (
  id uuid primary key default gen_random_uuid(),
  value_id uuid not null references customer.ref_values(id) on delete cascade,
  domain text not null,
  alias text not null,
  alias_key text not null,
  kind text not null default 'spelling' check (kind in ('label', 'spelling', 'historical', 'abbreviation', 'other')),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (value_id, alias_key)
);
create index ref_aliases_lookup_idx on customer.ref_aliases (domain, alias_key);
create index ref_aliases_trgm_idx on customer.ref_aliases using gin (alias_key extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. Rules, interpretations, corrections, jobs
-- ---------------------------------------------------------------------------
create table customer.std_rules (
  id uuid primary key default gen_random_uuid(),
  field_key text not null,
  source text references customer.sources(source),
  input_key text not null,
  outputs jsonb not null check (jsonb_typeof(outputs) = 'array' and jsonb_array_length(outputs) between 1 and 6),
  status text not null default 'approved' check (status in ('draft', 'approved', 'inactive', 'rejected')),
  version integer not null default 1,
  replaces uuid references customer.std_rules(id),
  reason text,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid references public.user_profiles(id) on delete set null,
  approved_at timestamptz,
  ended_by uuid references public.user_profiles(id) on delete set null,
  ended_at timestamptz
);
create unique index std_rules_active_idx on customer.std_rules (field_key, coalesce(source, ''), input_key) where status = 'approved';
create index std_rules_field_idx on customer.std_rules (field_key, input_key);
comment on table customer.std_rules is 'Migration 0455: how a normalized raw value of a field (optionally from one source) is read. outputs: [{"field": key, "code": "domain:code"} | {"field": key, "status": "missing|invalid|ambiguous|other"}]. Old versions are kept inactive.';

create table customer.value_interpretations (
  id uuid primary key default gen_random_uuid(),
  field_value_id uuid not null references customer.client_field_values(id) on delete cascade,
  client_id uuid not null,
  part text,
  output_field text not null,
  value_id uuid references customer.ref_values(id),
  status text not null check (status in ('standardized', 'unmapped', 'missing', 'invalid', 'ambiguous', 'other', 'cross_field', 'wrong_field')),
  method text not null check (method in ('rule', 'label', 'alias', 'placeholder', 'context', 'none', 'pattern')),
  rule_id uuid references customer.std_rules(id) on delete set null,
  rule_version integer,
  candidates uuid[],
  interpreted_at timestamptz not null default now()
);
create unique index value_interpretations_one_idx on customer.value_interpretations
  (field_value_id, output_field, coalesce(value_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index value_interpretations_client_idx on customer.value_interpretations (client_id, output_field);
create index value_interpretations_value_idx on customer.value_interpretations (value_id) where value_id is not null;
comment on table customer.value_interpretations is 'Migration 0455: how each raw observation was read, per output field. wrong_field: the value belongs to another field (that field gets a cross_field row).';

create table customer.value_corrections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references customer.clients(id) on delete cascade,
  output_field text not null,
  value_id uuid references customer.ref_values(id),
  cleared boolean not null default false,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  verified_by uuid references public.user_profiles(id) on delete set null,
  verified_at timestamptz not null default now(),
  active boolean not null default true,
  check (cleared or value_id is not null)
);
create unique index value_corrections_active_idx on customer.value_corrections (client_id, output_field) where active;
comment on table customer.value_corrections is 'Migration 0455: a verified value, or a requested removal, for one customer and field. It beats every sheet; a newer different sheet value is flagged for review instead.';

create table customer.std_jobs (
  id uuid primary key default gen_random_uuid(),
  field_key text not null,
  input_key text,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  cursor_id uuid,
  processed integer not null default 0,
  clients integer not null default 0,
  error text,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index std_jobs_open_idx on customer.std_jobs (created_at) where status in ('pending', 'running');
comment on table customer.std_jobs is 'Migration 0455: reprocessing of the observations of one field (one normalized value, or all), in batches, resumable.';

do $$
declare t text;
begin
  foreach t in array array['ref_values', 'ref_aliases', 'std_rules', 'value_interpretations', 'value_corrections', 'std_jobs'] loop
    execute format('alter table customer.%I enable row level security', t);
    execute format('revoke all on customer.%I from public, anon, authenticated', t);
    execute format('grant all on customer.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Normalizing and reading one value
-- ---------------------------------------------------------------------------
-- The comparison key of a categorical value: lower case, accents and
-- punctuation as spaces, single spaces. Keeps word order (no token sorting),
-- so different things are not joined by accident.
create function customer.std_key(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))),
                 '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')), '');
$$;

-- Words that mean "not recorded" in any categorical field.
create function customer.std_placeholder(p_key text) returns boolean
language sql immutable set search_path = '' as $$
  select p_key in ('none', 'na', 'n a', 'nil', 'null', 'not mentioned', 'not available', 'not applicable', 'not known',
                   'unknown', 'dont know', 'don t know', 'no data', 'not given', 'not provided', 'nothing', 'blank', 'xx', 'xxx')
      or p_key ~ '^0+$';
$$;

-- The policy of a field, falling back to none.
create function customer.field_policy(p_field text) returns customer.field_catalog
language sql stable set search_path = '' as $$
  select f.* from customer.field_catalog f where f.key = p_field;
$$;

-- Values of a domain whose label or alias has this key (active ones; a
-- superseded value points to its successor).
create function customer.ref_lookup(p_domain text, p_key text) returns uuid[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(distinct coalesce(v.superseded_by, v.id)), '{}')
    from customer.ref_aliases a join customer.ref_values v on v.id = a.value_id
   where a.domain = p_domain and a.alias_key = p_key and (v.active or v.superseded_by is not null);
$$;

create function customer.ref_by_code(p_code text) returns uuid
language sql stable set search_path = '' as $$
  select coalesce(v.superseded_by, v.id) from customer.ref_values v
   where v.domain = split_part(p_code, ':', 1) and v.code = substr(p_code, length(split_part(p_code, ':', 1)) + 2);
$$;

create function customer.ref_code(p_id uuid) returns text
language sql stable set search_path = '' as $$
  select v.domain || ':' || v.code from customer.ref_values v where v.id = p_id;
$$;

-- The nearest ancestor (or the value itself) of a kind.
create function customer.ref_ancestor(p_id uuid, p_kind text) returns uuid
language sql stable set search_path = '' as $$
  with recursive up(id, parent_id, kind, depth) as (
    select v.id, v.parent_id, v.kind, 0 from customer.ref_values v where v.id = p_id
    union all
    select v.id, v.parent_id, v.kind, up.depth + 1 from customer.ref_values v join up on v.id = up.parent_id where up.depth < 8
  )
  select id from up where kind = p_kind order by depth limit 1;
$$;

-- Place fields and the place kind each one holds.
create function customer.place_output(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind when 'locality' then 'city' when 'city' then 'city' when 'district' then 'district'
                     when 'state' then 'state' when 'country' then 'country' end;
$$;

-- Read one observation: write its interpretations. Deterministic: the same
-- raw value, field, source and rules always give the same result.
create function customer.interpret_observation(p_field_value_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v customer.client_field_values; f customer.field_catalog; v_out text; v_parts text[]; v_part text; v_key text;
  r customer.std_rules; o jsonb; v_ids uuid[]; v_id uuid; v_kind text; v_target text; v_pin text; v_ctx uuid[];
begin
  select * into v from customer.client_field_values where id = p_field_value_id;
  if v.id is null then return; end if;
  delete from customer.value_interpretations where field_value_id = v.id;
  f := customer.field_policy(v.field_key);
  if f.key is null or f.policy = 'none' then return; end if;
  v_out := coalesce(f.output_field, f.key);
  -- Multi-value fields: one interpretation per comma-separated part.
  v_parts := case when f.multi then array(select btrim(x) from unnest(string_to_array(v.value, ',')) x where btrim(x) <> '') else array[v.value] end;

  foreach v_part in array v_parts loop
    v_key := customer.std_key(v_part);
    if v_key is null then continue; end if;
    -- 1. An approved rule, the one for this source first.
    select * into r from customer.std_rules
     where field_key = v.field_key and input_key = v_key and status = 'approved' and (source is null or source = v.source)
     order by (source is not null) desc limit 1;
    if r.id is not null then
      for o in select x from jsonb_array_elements(r.outputs) x loop
        v_id := case when o ? 'code' then customer.ref_by_code(o ->> 'code') end;
        insert into customer.value_interpretations (field_value_id, client_id, part, output_field, value_id, status, method, rule_id, rule_version)
        values (v.id, v.client_id, v_part, coalesce(o ->> 'field', v_out), v_id,
                case when v_id is not null then case when coalesce(o ->> 'field', v_out) = v_out then 'standardized' else 'cross_field' end
                     else coalesce(o ->> 'status', 'unmapped') end,
                'rule', r.id, r.version)
        on conflict do nothing;
        if o ? 'field' and o ->> 'field' <> v_out and v_id is not null then
          insert into customer.value_interpretations (field_value_id, client_id, part, output_field, status, method, rule_id, rule_version)
          values (v.id, v.client_id, v_part, v_out, 'wrong_field', 'rule', r.id, r.version) on conflict do nothing;
        end if;
      end loop;
      r := null;
      continue;
    end if;
    -- 2. Not recorded.
    if customer.std_placeholder(v_key) then
      insert into customer.value_interpretations (field_value_id, client_id, part, output_field, status, method)
      values (v.id, v.client_id, v_part, v_out, 'missing', 'placeholder') on conflict do nothing;
      continue;
    end if;
    -- 3. A place: one letter or no letters is not a place.
    if f.policy = 'place' and (v_key !~ '[a-z]' or length(replace(v_key, ' ', '')) < 2) then
      insert into customer.value_interpretations (field_value_id, client_id, part, output_field, status, method)
      values (v.id, v.client_id, v_part, v_out, 'invalid', 'pattern') on conflict do nothing;
      continue;
    end if;
    -- 4. A label or alias of the field's values.
    v_ids := customer.ref_lookup(f.ref_domain, v_key);
    if cardinality(v_ids) > 1 and f.policy = 'place' then
      -- The same place name in several places: the customer's pincode or
      -- other place answers may pick one; otherwise it waits for a person.
      v_pin := (select c.pincode from customer.clients c where c.id = v.client_id);
      select coalesce(array_agg(x), '{}') into v_ctx from unnest(v_ids) x
       where exists (select 1 from customer.pincodes p where p.pincode = v_pin
                       and customer.ref_ancestor(x, 'city') = any (customer.ref_lookup('place', customer.std_key(p.city))))
          or exists (select 1 from customer.client_field_values o
                      where o.client_id = v.client_id and o.field_key in ('state', 'city') and o.id <> v.id
                        and customer.ref_ancestor(x, 'state') = any (customer.ref_lookup('place', customer.std_key(o.value))));
      if cardinality(v_ctx) = 1 then v_ids := v_ctx; end if;
    end if;
    if cardinality(v_ids) = 1 then
      v_id := v_ids[1];
      v_kind := (select kind from customer.ref_values where id = v_id);
      v_target := case when f.policy = 'place' then customer.place_output(v_kind) else v_out end;
      if v_target = v_out or v_target is null then
        insert into customer.value_interpretations (field_value_id, client_id, part, output_field, value_id, status, method)
        values (v.id, v.client_id, v_part, v_out, v_id, 'standardized', case when cardinality(v_ctx) = 1 then 'context' else 'alias' end)
        on conflict do nothing;
      else
        -- A place of another level in this field ("Haryana" in CITY): it is
        -- kept for that field as a weaker, cross-field observation.
        insert into customer.value_interpretations (field_value_id, client_id, part, output_field, status, method)
        values (v.id, v.client_id, v_part, v_out, 'wrong_field', 'alias') on conflict do nothing;
        insert into customer.value_interpretations (field_value_id, client_id, part, output_field, value_id, status, method)
        values (v.id, v.client_id, v_part, v_target, v_id, 'cross_field', 'alias') on conflict do nothing;
      end if;
    elsif cardinality(v_ids) > 1 then
      insert into customer.value_interpretations (field_value_id, client_id, part, output_field, status, method, candidates)
      values (v.id, v.client_id, v_part, v_out, 'ambiguous', 'alias', v_ids) on conflict do nothing;
    else
      -- 5. Not known yet: kept as written and offered for review. A place
      -- written in a non-place field is noted, never moved.
      insert into customer.value_interpretations (field_value_id, client_id, part, output_field, status, method)
      values (v.id, v.client_id, v_part, v_out,
              case when f.policy <> 'place' and f.sensitive and cardinality(customer.ref_lookup('place', v_key)) > 0 then 'wrong_field' else 'unmapped' end,
              'none') on conflict do nothing;
    end if;
    v_ctx := null;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Choosing the value per field (validity before source rank)
-- ---------------------------------------------------------------------------
-- Eligible interpretations of an output field, best first: a verified
-- correction, then the existing source ranking and date among standardized,
-- unmapped (kept as written) or "other" values. Missing, invalid, ambiguous
-- and wrong-field readings never win. Cross-field readings are a fallback.
create function customer.field_candidates(p_client_id uuid, p_field text)
returns table (field_value_id uuid, value_id uuid, status text, raw text, source text, rank integer, observed_at timestamptz, fallback boolean)
language sql stable set search_path = '' as $$
  select i.field_value_id, i.value_id, i.status, v.value, v.source, s.source_rank, v.observed_at, i.status = 'cross_field'
    from customer.value_interpretations i
    join customer.client_field_values v on v.id = i.field_value_id
    join customer.sources s on s.source = v.source
   where i.client_id = p_client_id and i.output_field = p_field
     and i.status in ('standardized', 'unmapped', 'other', 'cross_field')
   order by (i.status = 'cross_field'), s.source_rank desc, v.observed_at desc, v.created_at desc, v.id;
$$;

-- Write one output field's result onto the customer.
create function customer.set_std_result(p_client_id uuid, p_field text, p_value jsonb, p_code jsonb, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_text text;
begin
  update customer.clients c
     set std_values = case when p_value is null then c.std_values - p_field else jsonb_set(c.std_values, array[p_field], p_value) end,
         std_codes = case when p_code is null then c.std_codes - p_field else jsonb_set(c.std_codes, array[p_field], p_code) end,
         std_status = case when p_status is null then c.std_status - p_field else jsonb_set(c.std_status, array[p_field], to_jsonb(p_status)) end
   where c.id = p_client_id;
  -- Fields with a typed column on the customer keep it in step (the list, the
  -- profile and older readers use it).
  if p_field in ('city', 'state', 'country', 'district', 'locality', 'community', 'beverage', 'sugar', 'snack', 'occupation',
                 'marital_status', 'gender', 'communication_preference') then
    v_text := case when jsonb_typeof(p_value) = 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(p_value) x)
                   else p_value #>> '{}' end;
    execute format('update customer.clients set %I = $1 where id = $2 and %I is distinct from $1', p_field, p_field) using v_text, p_client_id;
  end if;
end $$;

-- A generic reference field: the best eligible observation (all its values for a multi-value field).
create function customer.project_reference_field(p_client_id uuid, p_field text) returns void
language plpgsql security definer set search_path = '' as $$
declare w record; k customer.value_corrections; v_multi boolean; v_values jsonb; v_codes jsonb; v_status text;
begin
  v_multi := coalesce((select bool_or(multi) from customer.field_catalog where coalesce(output_field, key) = p_field and policy <> 'none'), false);
  select * into k from customer.value_corrections where client_id = p_client_id and output_field = p_field and active;
  if k.id is not null then
    if k.cleared then perform customer.set_std_result(p_client_id, p_field, null, null, 'cleared'); return; end if;
    perform customer.set_std_result(p_client_id, p_field,
      case when v_multi then jsonb_build_array((select label from customer.ref_values where id = k.value_id)) else to_jsonb((select label from customer.ref_values where id = k.value_id)) end,
      case when v_multi then jsonb_build_array(customer.ref_code(k.value_id)) else to_jsonb(customer.ref_code(k.value_id)) end, 'verified');
    return;
  end if;
  select * into w from customer.field_candidates(p_client_id, p_field) limit 1;
  if w.field_value_id is null then perform customer.set_std_result(p_client_id, p_field, null, null, null); return; end if;
  if v_multi then
    -- Every part of the winning observation: its label, or as written when not known yet.
    select jsonb_agg(distinct coalesce(rv.label, customer.clean_name(i.part))),
           jsonb_agg(distinct customer.ref_code(i.value_id)) filter (where i.value_id is not null),
           case when bool_and(i.status = 'standardized') then 'standardized' else 'unmapped' end
      into v_values, v_codes, v_status
      from customer.value_interpretations i
      left join customer.ref_values rv on rv.id = i.value_id
     where i.field_value_id = w.field_value_id and i.output_field = p_field and i.status in ('standardized', 'unmapped', 'other');
    perform customer.set_std_result(p_client_id, p_field, v_values, v_codes, v_status);
  else
    perform customer.set_std_result(p_client_id, p_field,
      to_jsonb(coalesce((select label from customer.ref_values where id = w.value_id), customer.clean_name(w.raw))),
      case when w.value_id is not null then to_jsonb(customer.ref_code(w.value_id)) end,
      case when w.fallback then 'cross_field' when w.value_id is not null then 'standardized' else w.status end);
  end if;
end $$;

-- The place projector: country, state, district, city and locality together,
-- so a locality gives its city, and a city its state and country, unless the
-- customer's own answer for that level says otherwise (then: conflict, kept).
create function customer.project_place(p_client_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_field text; w record; v_place jsonb := '{}'; v_codes jsonb := '{}'; v_status jsonb := '{}';
  v_city_val uuid; v_loc_val uuid; v_up uuid; k customer.value_corrections; lvl text; v_has_corr boolean;
  v_win jsonb;
begin
  v_has_corr := exists (select 1 from customer.value_corrections c where c.client_id = p_client_id and c.active);
  -- The best eligible reading of each place field, in one read.
  select coalesce(jsonb_object_agg(t.output_field, jsonb_build_object('field_value_id', t.field_value_id, 'value_id', t.value_id, 'status', t.status,
           'raw', t.raw, 'fallback', t.fallback)), '{}') into v_win
    from (select distinct on (i.output_field) i.output_field, i.field_value_id, i.value_id, i.status, v.value as raw, i.status = 'cross_field' as fallback
            from customer.value_interpretations i
            join customer.client_field_values v on v.id = i.field_value_id
            join customer.sources s on s.source = v.source
           where i.client_id = p_client_id and i.output_field in ('city', 'district', 'state', 'country')
             and i.status in ('standardized', 'unmapped', 'other', 'cross_field')
           order by i.output_field, (i.status = 'cross_field'), s.source_rank desc, v.observed_at desc, v.created_at desc, v.id) t;
  foreach v_field in array array['locality', 'city', 'district', 'state', 'country'] loop
    k := null;
    if v_has_corr then
      select * into k from customer.value_corrections where client_id = p_client_id and output_field = v_field and active;
    end if;
    if k.id is not null then
      if k.cleared then v_status := v_status || jsonb_build_object(v_field, 'cleared');
      else
        v_place := v_place || jsonb_build_object(v_field, (select label from customer.ref_values where id = k.value_id));
        v_codes := v_codes || jsonb_build_object(v_field, customer.ref_code(k.value_id));
        v_status := v_status || jsonb_build_object(v_field, 'verified');
      end if;
      continue;
    end if;
    if v_field = 'locality' or not v_win ? v_field then continue; end if;
    select (v_win -> v_field ->> 'field_value_id')::uuid as field_value_id, (v_win -> v_field ->> 'value_id')::uuid as value_id,
           v_win -> v_field ->> 'status' as status, v_win -> v_field ->> 'raw' as raw, (v_win -> v_field ->> 'fallback')::boolean as fallback into w;
    if w.value_id is null then
      v_place := v_place || jsonb_build_object(v_field, customer.clean_name(w.raw));
      v_status := v_status || jsonb_build_object(v_field, w.status);
      continue;
    end if;
    if v_field = 'city' and (select kind from customer.ref_values where id = w.value_id) = 'locality' then
      v_loc_val := w.value_id;
      v_city_val := customer.ref_ancestor(w.value_id, 'city');
      if not v_status ? 'locality' then
        v_place := v_place || jsonb_build_object('locality', (select label from customer.ref_values where id = v_loc_val));
        v_codes := v_codes || jsonb_build_object('locality', customer.ref_code(v_loc_val));
        v_status := v_status || jsonb_build_object('locality', 'standardized');
      end if;
      if v_city_val is null then continue; end if;
      v_place := v_place || jsonb_build_object('city', (select label from customer.ref_values where id = v_city_val));
      v_codes := v_codes || jsonb_build_object('city', customer.ref_code(v_city_val));
      v_status := v_status || jsonb_build_object('city', 'derived');
      continue;
    end if;
    v_place := v_place || jsonb_build_object(v_field, (select label from customer.ref_values where id = w.value_id));
    v_codes := v_codes || jsonb_build_object(v_field, customer.ref_code(w.value_id));
    v_status := v_status || jsonb_build_object(v_field, case when w.fallback then 'cross_field' else 'standardized' end);
  end loop;

  -- Fill the levels above from the hierarchy; a different own answer is a conflict.
  v_up := coalesce(customer.ref_by_code(v_codes ->> 'city'), customer.ref_by_code(v_codes ->> 'locality'), customer.ref_by_code(v_codes ->> 'district'));
  if v_up is not null then
    foreach lvl in array array['state', 'country'] loop
      if customer.ref_ancestor(v_up, lvl) is null then continue; end if;
      if not v_place ? lvl and not v_status ? lvl then
        v_place := v_place || jsonb_build_object(lvl, (select label from customer.ref_values where id = customer.ref_ancestor(v_up, lvl)));
        v_codes := v_codes || jsonb_build_object(lvl, customer.ref_code(customer.ref_ancestor(v_up, lvl)));
        v_status := v_status || jsonb_build_object(lvl, 'derived');
      elsif v_codes ? lvl and v_codes ->> lvl <> customer.ref_code(customer.ref_ancestor(v_up, lvl)) and v_status ->> lvl <> 'verified' then
        v_status := v_status || jsonb_build_object(lvl, 'conflict');
      end if;
    end loop;
  end if;

  -- One write for all five levels.
  update customer.clients c
     set std_values = (c.std_values - array['locality', 'city', 'district', 'state', 'country']) || jsonb_strip_nulls(v_place),
         std_codes = (c.std_codes - array['locality', 'city', 'district', 'state', 'country']) || jsonb_strip_nulls(v_codes),
         std_status = (c.std_status - array['locality', 'city', 'district', 'state', 'country']) || v_status,
         locality = v_place ->> 'locality', city = v_place ->> 'city', district = v_place ->> 'district',
         state = v_place ->> 'state', country = v_place ->> 'country'
   where c.id = p_client_id
     and (c.std_values, c.std_codes, c.std_status, c.locality, c.city, c.district, c.state, c.country) is distinct from
         ((c.std_values - array['locality', 'city', 'district', 'state', 'country']) || jsonb_strip_nulls(v_place),
          (c.std_codes - array['locality', 'city', 'district', 'state', 'country']) || jsonb_strip_nulls(v_codes),
          (c.std_status - array['locality', 'city', 'district', 'state', 'country']) || v_status,
          v_place ->> 'locality', v_place ->> 'city', v_place ->> 'district', v_place ->> 'state', v_place ->> 'country');
end $$;

-- Re-project the output fields an input field feeds.
create function customer.project_client_field(p_client_id uuid, p_field_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare f customer.field_catalog;
begin
  f := customer.field_policy(p_field_key);
  if f.key is null or f.policy = 'none' then return; end if;
  if f.policy = 'place' then perform customer.project_place(p_client_id);
  else perform customer.project_reference_field(p_client_id, coalesce(f.output_field, f.key));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Hooks: every new observation is read at once; projections replace the
--    raw winner for standardized fields
-- ---------------------------------------------------------------------------
create function customer.on_field_value_added() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from customer.field_catalog f where f.key = new.field_key and f.policy <> 'none') then
    perform customer.interpret_observation(new.id);
  end if;
  return null;
end $$;
create trigger client_field_values_interpret after insert on customer.client_field_values
  for each row execute function customer.on_field_value_added();

create function customer._patch_0455(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0455: expected % match(es) of "%" in %, found %', p_expected, left(p_old, 80), p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- recompute_profile_field: a standardized field is projected instead of
-- copying the raw winner; the stale-answer flag compares standardized codes.
select customer._patch_0455('customer.recompute_profile_field(uuid,text)'::regprocedure,
  $o$  if not found then return; end if;
$o$,
  $n$  if not found then return; end if;
  if exists (select 1 from customer.field_catalog f where f.key = p_field_key and f.policy <> 'none') then
    perform customer.project_client_field(p_client_id, p_field_key);
    return;
  end if;
$n$, 1);
-- Answers in client_answers for standardized fields carry the standardized value.
select customer._patch_0455('customer.refresh_client_answers(uuid)'::regprocedure,
  $o$              order by v.field_key, s.source_rank desc, v.observed_at desc, v.created_at desc, v.id) w), '{}'::jsonb), now()$o$,
  $n$              order by v.field_key, s.source_rank desc, v.observed_at desc, v.created_at desc, v.id) w), '{}'::jsonb)
           || (select coalesce(jsonb_object_agg(e.key, case when jsonb_typeof(e.value) = 'array' then to_jsonb((select string_agg(x, ', ') from jsonb_array_elements_text(e.value) x)) else e.value end), '{}'::jsonb)
                 from jsonb_each(c.std_values) e), now()$n$, 1);

-- ---------------------------------------------------------------------------
-- 7. Targeted reprocessing
-- ---------------------------------------------------------------------------
create index client_field_values_std_key_idx on customer.client_field_values (field_key, customer.std_key(value));
create index client_field_values_field_id_idx on customer.client_field_values (field_key, id);

create function customer.enqueue_std_job(p_field text, p_input_key text, p_reason text, p_actor uuid) returns uuid
language sql security definer set search_path = '' as $$
  insert into customer.std_jobs (field_key, input_key, reason, created_by) values (p_field, p_input_key, p_reason, p_actor) returning id;
$$;

-- Work through open jobs: up to p_limit observations in total, oldest job
-- first. Each batch re-reads its observations, then re-projects each touched
-- customer once. Safe to run again; a crash leaves the job where it was.
create function customer.process_std_jobs(p_limit integer default 3000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j customer.std_jobs; v_ids uuid[]; v_clients uuid[]; v_budget integer := greatest(coalesce(p_limit, 3000), 1); v_done integer := 0;
  v_client uuid; v_last uuid; v_fields text[];
begin
  for j in select * from customer.std_jobs where status in ('pending', 'running') order by created_at, id for update skip locked loop
    exit when v_budget <= 0;
    update customer.std_jobs set status = 'running' where id = j.id;
    if j.input_key is null or not coalesce((select multi from customer.field_catalog where key = j.field_key), false) then
      select coalesce(array_agg(id order by id), '{}') into v_ids from (
        select v.id from customer.client_field_values v
         where v.field_key = j.field_key and (j.input_key is null or customer.std_key(v.value) = j.input_key)
           and (j.cursor_id is null or v.id > j.cursor_id)
         order by v.id limit v_budget) t;
    else
      -- A multi-value field: the value may be one part of the answer.
      select coalesce(array_agg(id order by id), '{}') into v_ids from (
        select v.id from customer.client_field_values v
         where v.field_key = j.field_key
           and exists (select 1 from unnest(string_to_array(v.value, ',')) p where customer.std_key(p) = j.input_key)
           and (j.cursor_id is null or v.id > j.cursor_id)
         order by v.id limit v_budget) t;
    end if;
    foreach v_last in array v_ids loop perform customer.interpret_observation(v_last); end loop;
    select coalesce(array_agg(distinct client_id), '{}') into v_clients from customer.client_field_values where id = any (v_ids);
    foreach v_client in array v_clients loop
      perform customer.project_client_field(v_client, j.field_key);
      perform customer.refresh_client_answers(v_client);
    end loop;
    v_budget := v_budget - cardinality(v_ids);
    v_done := v_done + cardinality(v_ids);
    if cardinality(v_ids) = 0 or v_budget > 0 then
      update customer.std_jobs set status = 'done', finished_at = now(), processed = processed + cardinality(v_ids),
             clients = clients + cardinality(v_clients), cursor_id = coalesce(v_ids[cardinality(v_ids)], cursor_id) where id = j.id;
    else
      update customer.std_jobs set processed = processed + cardinality(v_ids), clients = clients + cardinality(v_clients),
             cursor_id = v_ids[cardinality(v_ids)] where id = j.id;
    end if;
  end loop;
  return jsonb_build_object('processed', v_done,
    'open', (select count(*) from customer.std_jobs where status in ('pending', 'running')));
end $$;

create function public.customer_process_std_jobs() returns jsonb
language sql security definer set search_path = '' as $$ select customer.process_std_jobs(3000); $$;
revoke all on function public.customer_process_std_jobs() from public, anon, authenticated;
grant execute on function public.customer_process_std_jobs() to service_role;

-- ---------------------------------------------------------------------------
-- 8. Governance (Customers -> Data standards)
-- ---------------------------------------------------------------------------
create function customer.std_require(p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') or not public.has_permission(p_permission) then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
end $$;

-- A field a person may govern: known, standardized (or about to be), and
-- for a sensitive field only with "See sensitive customer fields".
create function customer.std_field(p_field text) returns customer.field_catalog
language plpgsql stable security definer set search_path = '' as $$
declare f customer.field_catalog;
begin
  select * into f from customer.field_catalog where key = p_field;
  if f.key is null then raise exception 'Unknown field' using errcode = '22023'; end if;
  if f.sensitive and not public.has_permission('customers.view_sensitive') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  return f;
end $$;

-- The fields under standards, with what their observations look like.
create function public.customer_std_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform customer.std_require('customers.view_data_quality');
  return jsonb_build_object(
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label, 'policy', f.policy, 'domain', f.ref_domain, 'multi', f.multi,
               'sensitive', f.sensitive, 'output_field', coalesce(f.output_field, f.key), 'meaning', f.meaning,
               'observations', (select count(*) from customer.client_field_values v where v.field_key = f.key),
               'customers', (select count(distinct v.client_id) from customer.client_field_values v where v.field_key = f.key),
               'statuses', (select coalesce(jsonb_object_agg(t.status, t.n), '{}'::jsonb) from (
                              select i.status, count(distinct i.field_value_id) n from customer.value_interpretations i
                                join customer.client_field_values v on v.id = i.field_value_id
                               where v.field_key = f.key and i.output_field = coalesce(f.output_field, f.key) group by i.status) t),
               'values', (select count(*) from customer.ref_values r where r.domain = f.ref_domain and r.active))
             order by f.policy = 'none', f.sort_order, f.label)
        from customer.field_catalog f
       where f.kind in ('column', 'answer') and (not f.sensitive or public.has_permission('customers.view_sensitive'))
         and (f.policy <> 'none' or exists (select 1 from customer.client_field_values v where v.field_key = f.key))), '[]'::jsonb),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'field', j.field_key, 'reason', j.reason, 'status', j.status,
               'processed', j.processed, 'clients', j.clients, 'created_at', j.created_at, 'finished_at', j.finished_at) order by j.created_at desc), '[]'::jsonb)
               from (select * from customer.std_jobs order by created_at desc limit 20) j),
    'can', jsonb_build_object('suggest', public.has_permission('customers.suggest_mappings'), 'approve', public.has_permission('customers.approve_mappings'),
             'high_impact', public.has_permission('customers.approve_high_impact'), 'reference', public.has_permission('customers.manage_reference_values'),
             'policies', public.has_permission('customers.manage_field_policies'), 'reprocess', public.has_permission('customers.reprocess_data'),
             'rollback', public.has_permission('customers.rollback_standards')));
end $$;

-- Distinct values of a field to review, most customers first: what was
-- written, how often, where from, what it is read as now, and a suggestion.
create function public.customer_std_queue(p_field text, p_show text default 'open', p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f customer.field_catalog; v_out text; v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform customer.std_require('customers.view_data_quality');
  f := customer.std_field(p_field);
  if f.policy = 'none' then raise exception 'This field is not standardized yet' using errcode = '22023'; end if;
  v_out := coalesce(f.output_field, f.key);
  return (
    with obs as (
      select v.client_id, coalesce(i.status, 'pending') as status, i.rule_id,
             case when f.multi then customer.std_key(i.part) else customer.std_key(v.value) end as k
        from customer.client_field_values v
        left join customer.value_interpretations i on i.field_value_id = v.id and i.output_field = v_out
       where v.field_key = f.key
    ), grouped as (
      select k, count(*) as observations, count(distinct client_id) as customers,
             (array_agg(status order by status))[1] as status, bool_or(rule_id is not null) as has_rule
        from obs where k is not null group by k
    ), shown as (
      select * from grouped
       where case p_show when 'open' then status in ('unmapped', 'ambiguous', 'wrong_field', 'pending') and not has_rule
                         when 'all' then true else status = p_show end
    ), page as (
      select * from shown order by customers desc, k limit 25 offset v_offset
    )
    select jsonb_build_object(
      'field', f.key, 'label', f.label, 'domain', f.ref_domain, 'policy', f.policy, 'total', (select count(*) from shown),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'input_key', s.k, 'observations', s.observations, 'customers', s.customers, 'status', s.status,
          -- How it was written (the most common spellings) and where from.
          'examples', (select coalesce(jsonb_agg(e.value), '[]'::jsonb) from (
                         select v.value from customer.client_field_values v
                          where v.field_key = f.key and (customer.std_key(v.value) = s.k or (f.multi and v.value ilike '%' || s.k || '%'))
                          group by v.value order by count(*) desc limit 3) e),
          'sources', (select coalesce(jsonb_agg(e.label), '[]'::jsonb) from (
                        select coalesce(so.label, v.source) as label from customer.client_field_values v join customer.sources so on so.source = v.source
                         where v.field_key = f.key and customer.std_key(v.value) = s.k group by 1 order by count(*) desc limit 3) e),
          'rule', (select jsonb_build_object('id', r.id, 'version', r.version, 'outputs', r.outputs, 'status', r.status)
                     from customer.std_rules r where r.field_key = f.key and r.input_key = s.k and r.status in ('approved', 'draft') order by r.status limit 1),
          'candidates', (select coalesce(jsonb_agg(distinct jsonb_build_object('code', customer.ref_code(c.x), 'label', rv.label, 'kind', rv.kind,
                            'parent', (select p.label from customer.ref_values p where p.id = rv.parent_id))), '[]'::jsonb)
                           from (select unnest(i.candidates) as x from customer.value_interpretations i
                                  join customer.client_field_values v on v.id = i.field_value_id
                                 where v.field_key = f.key and i.status = 'ambiguous' and customer.std_key(v.value) = s.k limit 20) c
                           join customer.ref_values rv on rv.id = c.x),
          'suggestions', (select coalesce(jsonb_agg(jsonb_build_object('code', customer.ref_code(t.id), 'label', t.label, 'kind', t.kind,
                             'parent', t.parent, 'score', round(t.score::numeric, 2))), '[]'::jsonb)
                            from (select rv.id, rv.label, rv.kind, (select p.label from customer.ref_values p where p.id = rv.parent_id) as parent,
                                         max(extensions.similarity(a.alias_key, s.k)) as score
                                    from customer.ref_aliases a join customer.ref_values rv on rv.id = a.value_id
                                   where a.domain = coalesce(f.ref_domain, '') and rv.active and a.alias_key operator(extensions.%) s.k
                                   group by rv.id, rv.label, rv.kind, rv.parent_id order by max(extensions.similarity(a.alias_key, s.k)) desc limit 3) t))
        order by s.customers desc, s.k) from page s), '[]'::jsonb)));
end $$;

-- Before approving: who and what a decision on this value touches.
create function public.customer_std_preview(p_field text, p_input_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f customer.field_catalog; v_out text;
begin
  perform customer.std_require('customers.view_data_quality');
  f := customer.std_field(p_field);
  v_out := coalesce(f.output_field, f.key);
  return (
    with obs as (
      select v.id, v.client_id, v.source from customer.client_field_values v
       where v.field_key = f.key and (customer.std_key(v.value) = p_input_key
             or (f.multi and exists (select 1 from unnest(string_to_array(v.value, ',')) p where customer.std_key(p) = p_input_key)))
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

-- Decide how a value is read. Saves a new rule version (the old one is
-- kept, inactive) and reprocesses only that value's observations.
--   {"map": "domain:code"} | {"status": "missing"|"invalid"|"ambiguous"|"other"}
--   {"create": {"label": "...", "kind": "...", "parent": "domain:code"}}
--   {"move": {"field": "state", "code": "domain:code"}}   (another field: cross-field)
create function public.customer_std_decide(p_field text, p_input_key text, p_decision jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f customer.field_catalog; v_out text; v_actor uuid; v_tenant uuid; v_outputs jsonb; v_old customer.std_rules; v_new uuid;
  v_draft boolean := false; v_high boolean; v_customers integer; v_value uuid; v_code text; d jsonb := coalesce(p_decision, '{}');
begin
  perform customer.std_require('customers.view_data_quality');
  if not (public.has_permission('customers.approve_mappings') or public.has_permission('customers.suggest_mappings')) then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  f := customer.std_field(p_field);
  if f.policy = 'none' then raise exception 'This field is not standardized yet' using errcode = '22023'; end if;
  if customer.std_key(p_input_key) is distinct from p_input_key then raise exception 'Unknown value' using errcode = '22023'; end if;
  v_out := coalesce(f.output_field, f.key);
  v_actor := (select id from public.current_profile());
  v_tenant := public.current_tenant_id();

  if d ? 'create' then
    if not public.has_permission('customers.manage_reference_values') then raise exception 'Section access denied' using errcode = '42501'; end if;
    v_value := customer.create_ref_value(f.ref_domain, d -> 'create' ->> 'label', nullif(d -> 'create' ->> 'kind', ''),
                                         customer.ref_by_code(d -> 'create' ->> 'parent'), v_actor);
    perform customer.add_ref_alias(v_value, (select string_agg(x, ' ') from jsonb_array_elements_text(d -> 'create' -> 'aliases') x), 'spelling', v_actor);
    v_outputs := jsonb_build_array(jsonb_build_object('field', v_out, 'code', customer.ref_code(v_value)));
  elsif d ? 'map' then
    v_value := customer.ref_by_code(d ->> 'map');
    if v_value is null or split_part(d ->> 'map', ':', 1) <> f.ref_domain then raise exception 'Choose a value of this field' using errcode = '22023'; end if;
    v_outputs := jsonb_build_array(jsonb_build_object('field', v_out, 'code', customer.ref_code(v_value)));
  elsif d ? 'status' then
    if d ->> 'status' not in ('missing', 'invalid', 'ambiguous', 'other') then raise exception 'Unknown status' using errcode = '22023'; end if;
    v_outputs := jsonb_build_array(jsonb_build_object('field', v_out, 'status', d ->> 'status'));
  elsif d ? 'move' then
    v_value := customer.ref_by_code(d -> 'move' ->> 'code');
    if v_value is null or not exists (select 1 from customer.field_catalog t where coalesce(t.output_field, t.key) = d -> 'move' ->> 'field'
                                        and t.ref_domain = split_part(d -> 'move' ->> 'code', ':', 1) and t.policy <> 'none') then
      raise exception 'Choose a value of the other field' using errcode = '22023';
    end if;
    v_outputs := jsonb_build_array(jsonb_build_object('field', d -> 'move' ->> 'field', 'code', customer.ref_code(v_value)));
  else
    raise exception 'Choose what this value means' using errcode = '22023';
  end if;

  v_customers := (public.customer_std_preview(p_field, p_input_key) ->> 'customers')::integer;
  v_high := v_customers > 500 or d ? 'move' or f.sensitive;
  if not public.has_permission('customers.approve_mappings') or (v_high and not public.has_permission('customers.approve_high_impact')) then
    if not public.has_permission('customers.suggest_mappings') then raise exception 'Section access denied' using errcode = '42501'; end if;
    v_draft := true;
  end if;

  if v_draft then
    insert into customer.std_rules (field_key, input_key, outputs, status, reason, created_by)
    values (f.key, p_input_key, v_outputs, 'draft', p_reason, v_actor) returning id into v_new;
  else
    select * into v_old from customer.std_rules where field_key = f.key and source is null and input_key = p_input_key and status = 'approved' for update;
    if v_old.id is not null then
      update customer.std_rules set status = 'inactive', ended_by = v_actor, ended_at = now() where id = v_old.id;
    end if;
    insert into customer.std_rules (field_key, input_key, outputs, status, version, replaces, reason, created_by, approved_by, approved_at)
    values (f.key, p_input_key, v_outputs, 'approved', coalesce(v_old.version, 0) + 1, v_old.id, p_reason, v_actor, v_actor, now())
    returning id into v_new;
    update customer.std_rules set status = 'rejected', ended_by = v_actor, ended_at = now()
     where field_key = f.key and input_key = p_input_key and status = 'draft';
    perform customer.enqueue_std_job(f.key, p_input_key, 'rule', v_actor);
  end if;
  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_tenant, v_actor, case when v_draft then 'customer_std_rule_suggested' else 'customer_std_rule_approved' end, 'customer', v_new,
          case when v_old.id is not null then jsonb_build_object('rule_id', v_old.id, 'outputs', v_old.outputs) end,
          jsonb_build_object('field', f.key, 'input_key', p_input_key, 'outputs', v_outputs, 'customers', v_customers, 'reason', p_reason));
  return jsonb_build_object('rule_id', v_new, 'status', case when v_draft then 'draft' else 'approved' end, 'customers', v_customers);
end $$;

-- Approve or reject a suggested rule.
create function public.customer_std_review_draft(p_rule_id uuid, p_approve boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r customer.std_rules; f customer.field_catalog; v_actor uuid;
begin
  perform customer.std_require('customers.approve_mappings');
  select * into r from customer.std_rules where id = p_rule_id and status = 'draft' for update;
  if r.id is null then raise exception 'Suggestion not found' using errcode = 'P0002'; end if;
  f := customer.std_field(r.field_key);
  if p_approve and (f.sensitive or exists (select 1 from jsonb_array_elements(r.outputs) o where o ->> 'field' <> coalesce(f.output_field, f.key))
                    or (public.customer_std_preview(r.field_key, r.input_key) ->> 'customers')::integer > 500)
     and not public.has_permission('customers.approve_high_impact') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  v_actor := (select id from public.current_profile());
  if p_approve then
    update customer.std_rules set status = 'inactive', ended_by = v_actor, ended_at = now()
     where field_key = r.field_key and source is null and input_key = r.input_key and status = 'approved';
    update customer.std_rules set status = 'approved', approved_by = v_actor, approved_at = now(),
           version = coalesce((select max(version) from customer.std_rules where field_key = r.field_key and input_key = r.input_key and id <> r.id), 0) + 1
     where id = r.id;
    perform customer.enqueue_std_job(r.field_key, r.input_key, 'rule', v_actor);
  else
    update customer.std_rules set status = 'rejected', ended_by = v_actor, ended_at = now() where id = r.id;
  end if;
  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
  values (public.current_tenant_id(), v_actor, case when p_approve then 'customer_std_rule_approved' else 'customer_std_rule_rejected' end, 'customer', r.id,
          jsonb_build_object('field', r.field_key, 'input_key', r.input_key, 'outputs', r.outputs, 'reason', p_reason));
  return jsonb_build_object('rule_id', r.id, 'status', case when p_approve then 'approved' else 'rejected' end);
end $$;

-- Undo a rule: it ends, and the value is read again without it.
create function public.customer_std_end_rule(p_rule_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r customer.std_rules; v_actor uuid;
begin
  perform customer.std_require('customers.rollback_standards');
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why' using errcode = '22023'; end if;
  select * into r from customer.std_rules where id = p_rule_id and status = 'approved' for update;
  if r.id is null then raise exception 'Rule not found' using errcode = 'P0002'; end if;
  perform customer.std_field(r.field_key);
  v_actor := (select id from public.current_profile());
  update customer.std_rules set status = 'inactive', ended_by = v_actor, ended_at = now() where id = r.id;
  perform customer.enqueue_std_job(r.field_key, r.input_key, 'rule ended', v_actor);
  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
  values (public.current_tenant_id(), v_actor, 'customer_std_rule_ended', 'customer', r.id,
          jsonb_build_object('field', r.field_key, 'input_key', r.input_key, 'outputs', r.outputs, 'reason', p_reason));
  return jsonb_build_object('rule_id', r.id, 'status', 'inactive');
end $$;

-- Every rule of a field, newest first, with who decided and when.
create function public.customer_std_rules(p_field text, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform customer.std_require('customers.view_data_quality');
  perform customer.std_field(p_field);
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'input_key', r.input_key, 'source', r.source, 'outputs',
              (select jsonb_agg(o || jsonb_build_object('label', (select v.label from customer.ref_values v where v.id = customer.ref_by_code(o ->> 'code')))) from jsonb_array_elements(r.outputs) o),
              'status', r.status, 'version', r.version, 'reason', r.reason,
              'created_by', (select u.employee_name from public.user_profiles u where u.id = r.created_by), 'created_at', r.created_at,
              'approved_by', (select u.employee_name from public.user_profiles u where u.id = r.approved_by), 'approved_at', r.approved_at,
              'ended_by', (select u.employee_name from public.user_profiles u where u.id = r.ended_by), 'ended_at', r.ended_at)
            order by r.created_at desc)
     from (select * from customer.std_rules where field_key = p_field order by created_at desc limit 50 offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb);
end $$;

-- Turn standards on for a field (the way every future field joins).
create function public.customer_std_set_policy(p_field text, p_policy text, p_multi boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f customer.field_catalog; v_actor uuid;
begin
  perform customer.std_require('customers.manage_field_policies');
  f := customer.std_field(p_field);
  if f.kind not in ('column', 'answer') or f.policy = 'place' then raise exception 'This field cannot change its policy here' using errcode = '22023'; end if;
  if p_policy not in ('none', 'reference') then raise exception 'Unknown policy' using errcode = '22023'; end if;
  v_actor := (select id from public.current_profile());
  update customer.field_catalog set policy = p_policy, ref_domain = coalesce(ref_domain, key), multi = coalesce(p_multi, false) where key = f.key;
  if p_policy = 'none' then
    delete from customer.value_interpretations i using customer.client_field_values v where v.id = i.field_value_id and v.field_key = f.key;
    update customer.clients set std_values = std_values - coalesce(f.output_field, f.key), std_codes = std_codes - coalesce(f.output_field, f.key),
           std_status = std_status - coalesce(f.output_field, f.key)
     where std_values ? coalesce(f.output_field, f.key) or std_status ? coalesce(f.output_field, f.key);
  end if;
  perform customer.enqueue_std_job(f.key, null, 'policy ' || p_policy, v_actor);
  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
  values (public.current_tenant_id(), v_actor, 'customer_std_policy_set', 'customer', null,
          jsonb_build_object('field', f.key, 'policy', p_policy, 'multi', coalesce(p_multi, false)));
  return jsonb_build_object('field', f.key, 'policy', p_policy);
end $$;

create function public.customer_std_reprocess(p_field text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f customer.field_catalog; v_actor uuid; v_job uuid;
begin
  perform customer.std_require('customers.reprocess_data');
  f := customer.std_field(p_field);
  if f.policy = 'none' then raise exception 'This field is not standardized yet' using errcode = '22023'; end if;
  v_actor := (select id from public.current_profile());
  v_job := customer.enqueue_std_job(f.key, null, 'reprocess', v_actor);
  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
  values (public.current_tenant_id(), v_actor, 'customer_std_reprocess', 'customer', v_job, jsonb_build_object('field', f.key));
  return jsonb_build_object('job_id', v_job);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Reference values: create, rename, aliases, deactivate, merge
-- ---------------------------------------------------------------------------
create function customer.ref_slug(p text) returns text
language sql immutable set search_path = '' as $$
  select left(replace(coalesce(customer.std_key(p), 'value'), ' ', '-'), 60);
$$;

create function customer.create_ref_value(p_domain text, p_label text, p_kind text, p_parent uuid, p_actor uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_code text; v_id uuid; n integer := 1; v_label text := btrim(coalesce(p_label, ''));
begin
  if length(v_label) = 0 then raise exception 'Give the value a name' using errcode = '22023'; end if;
  if p_domain = 'place' and coalesce(p_kind, '') not in ('country', 'state', 'district', 'city', 'locality') then
    raise exception 'A place is a country, state, district, city or locality' using errcode = '22023';
  end if;
  -- A locality's code includes its city, so two Shivaji Nagars stay apart.
  v_code := case when p_parent is not null and p_kind in ('locality', 'district') then (select code from customer.ref_values where id = p_parent) || '-' else '' end
            || customer.ref_slug(v_label);
  while exists (select 1 from customer.ref_values where domain = p_domain and code = v_code || case when n > 1 then '-' || n else '' end) loop n := n + 1; end loop;
  v_code := v_code || case when n > 1 then '-' || n else '' end;
  insert into customer.ref_values (domain, code, label, kind, parent_id, created_by, updated_by)
  values (p_domain, v_code, v_label, p_kind, p_parent, p_actor, p_actor) returning id into v_id;
  insert into customer.ref_aliases (value_id, domain, alias, alias_key, kind, created_by)
  values (v_id, p_domain, v_label, customer.std_key(v_label), 'label', p_actor) on conflict do nothing;
  return v_id;
end $$;

-- Aliases: several may be given at once, separated by "|".
create function customer.add_ref_alias(p_value uuid, p_aliases text, p_kind text, p_actor uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare a text; n integer := 0; v customer.ref_values;
begin
  select * into v from customer.ref_values where id = p_value;
  if v.id is null or p_aliases is null then return 0; end if;
  foreach a in array string_to_array(p_aliases, '|') loop
    continue when customer.std_key(a) is null;
    insert into customer.ref_aliases (value_id, domain, alias, alias_key, kind, created_by)
    values (v.id, v.domain, btrim(a), customer.std_key(a), coalesce(p_kind, 'spelling'), p_actor) on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Reprocess everything a value's names touch, in the fields that use its domain.
create function customer.enqueue_value_jobs(p_value uuid, p_reason text, p_actor uuid) returns void
language sql security definer set search_path = '' as $$
  insert into customer.std_jobs (field_key, input_key, reason, created_by)
  select distinct f.key, a.alias_key, p_reason, p_actor
    from customer.ref_aliases a join customer.ref_values v on v.id = a.value_id
    join customer.field_catalog f on f.ref_domain = v.domain and f.policy <> 'none'
   where a.value_id = p_value;
$$;

create function public.customer_ref_values(p_domain text, p_q text default null, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := customer.std_key(p_q);
begin
  perform customer.std_require('customers.view_data_quality');
  if exists (select 1 from customer.field_catalog f where f.ref_domain = p_domain and f.sensitive) and not public.has_permission('customers.view_sensitive') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from customer.ref_values v where v.domain = p_domain
               and (v_q is null or exists (select 1 from customer.ref_aliases a where a.value_id = v.id and a.alias_key like '%' || v_q || '%'))),
    'items', coalesce((select jsonb_agg(jsonb_build_object('code', v.domain || ':' || v.code, 'label', v.label, 'kind', v.kind, 'active', v.active,
               'parent', (select jsonb_build_object('code', p.domain || ':' || p.code, 'label', p.label) from customer.ref_values p where p.id = v.parent_id),
               'superseded_by', (select s.label from customer.ref_values s where s.id = v.superseded_by),
               'aliases', (select coalesce(jsonb_agg(a.alias order by a.alias), '[]'::jsonb) from customer.ref_aliases a where a.value_id = v.id and a.kind <> 'label'),
               'customers', (select count(distinct i.client_id) from customer.value_interpretations i where i.value_id = v.id),
               'notes', v.notes) order by v.kind nulls first, v.label)
             from (select * from customer.ref_values v where v.domain = p_domain
                     and (v_q is null or exists (select 1 from customer.ref_aliases a where a.value_id = v.id and a.alias_key like '%' || v_q || '%'))
                    order by v.kind nulls first, v.label limit 100 offset greatest(coalesce(p_offset, 0), 0)) v), '[]'::jsonb));
end $$;

-- {"action": "create", "domain", "label", "kind", "parent", "aliases"} | {"action": "rename", "code", "label"}
-- {"action": "alias", "code", "aliases"} | {"action": "remove_alias", "code", "alias"}
-- {"action": "deactivate" | "activate", "code"} | {"action": "merge", "code", "into"}
create function public.customer_ref_save(p_request jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := coalesce(p_request, '{}'); v customer.ref_values; v_into uuid; v_actor uuid; v_id uuid; v_old jsonb;
begin
  perform customer.std_require('customers.manage_reference_values');
  v_actor := (select id from public.current_profile());
  if r ->> 'action' = 'create' then
    if not exists (select 1 from customer.field_catalog f where f.ref_domain = r ->> 'domain' and f.policy <> 'none') then
      raise exception 'No field uses these values' using errcode = '22023';
    end if;
    if exists (select 1 from customer.field_catalog f where f.ref_domain = r ->> 'domain' and f.sensitive) and not public.has_permission('customers.view_sensitive') then
      raise exception 'Section access denied' using errcode = '42501';
    end if;
    v_id := customer.create_ref_value(r ->> 'domain', r ->> 'label', nullif(r ->> 'kind', ''), customer.ref_by_code(r ->> 'parent'), v_actor);
    perform customer.add_ref_alias(v_id, r ->> 'aliases', 'spelling', v_actor);
    perform customer.enqueue_value_jobs(v_id, 'value created', v_actor);
  else
    select * into v from customer.ref_values where id = customer.ref_by_code(r ->> 'code') for update;
    if v.id is null then raise exception 'Value not found' using errcode = 'P0002'; end if;
    if exists (select 1 from customer.field_catalog f where f.ref_domain = v.domain and f.sensitive) and not public.has_permission('customers.view_sensitive') then
      raise exception 'Section access denied' using errcode = '42501';
    end if;
    v_id := v.id;
    v_old := to_jsonb(v) - 'created_by' - 'updated_by';
    case r ->> 'action'
      when 'rename' then
        if length(btrim(coalesce(r ->> 'label', ''))) = 0 then raise exception 'Give the value a name' using errcode = '22023'; end if;
        -- The old label stays a name it is known by; the code does not change.
        perform customer.add_ref_alias(v.id, v.label, 'historical', v_actor);
        update customer.ref_values set label = btrim(r ->> 'label'), updated_by = v_actor, updated_at = now() where id = v.id;
        insert into customer.ref_aliases (value_id, domain, alias, alias_key, kind, created_by)
        values (v.id, v.domain, btrim(r ->> 'label'), customer.std_key(r ->> 'label'), 'label', v_actor) on conflict do nothing;
      when 'alias' then perform customer.add_ref_alias(v.id, r ->> 'aliases', coalesce(r ->> 'kind', 'spelling'), v_actor);
      when 'remove_alias' then
        perform customer.enqueue_value_jobs(v.id, 'alias removed', v_actor);
        delete from customer.ref_aliases where value_id = v.id and alias_key = customer.std_key(r ->> 'alias') and kind <> 'label';
      when 'deactivate' then update customer.ref_values set active = false, updated_by = v_actor, updated_at = now() where id = v.id;
      when 'activate' then update customer.ref_values set active = true, updated_by = v_actor, updated_at = now() where id = v.id;
      when 'merge' then
        v_into := customer.ref_by_code(r ->> 'into');
        if v_into is null or v_into = v.id or (select domain from customer.ref_values where id = v_into) <> v.domain then
          raise exception 'Choose another value of the same list' using errcode = '22023';
        end if;
        -- Not a customer merge: only this value now means the other one.
        update customer.ref_values set superseded_by = v_into, active = false, updated_by = v_actor, updated_at = now() where id = v.id;
        update customer.ref_values set superseded_by = v_into where superseded_by = v.id;
      else raise exception 'Unknown action' using errcode = '22023';
    end case;
    perform customer.enqueue_value_jobs(v.id, r ->> 'action', v_actor);
  end if;
  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (public.current_tenant_id(), v_actor, 'customer_ref_value_' || coalesce(r ->> 'action', 'save'), 'customer', v_id, v_old, r);
  return jsonb_build_object('code', customer.ref_code(v_id));
end $$;

-- A verified value or a requested removal for one customer and field.
create function public.customer_set_value_correction(p_client_code text, p_field text, p_code text, p_cleared boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c customer.clients; f customer.field_catalog; v_value uuid; v_actor uuid;
begin
  perform customer.std_require('customers.approve_mappings');
  select * into f from customer.field_catalog where coalesce(output_field, key) = p_field and policy <> 'none' limit 1;
  if f.key is null then raise exception 'Unknown field' using errcode = '22023'; end if;
  perform customer.std_field(f.key);
  select * into c from customer.clients where tenant_id = public.current_tenant_id() and client_code = upper(btrim(coalesce(p_client_code, '')))
     and merged_into_client_id is null and customer.franchise_visible(franchise_group_id) for update;
  if c.id is null then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  if not coalesce(p_cleared, false) then
    v_value := customer.ref_by_code(p_code);
    if v_value is null or split_part(p_code, ':', 1) <> f.ref_domain then raise exception 'Choose a value of this field' using errcode = '22023'; end if;
  end if;
  v_actor := (select id from public.current_profile());
  update customer.value_corrections set active = false where client_id = c.id and output_field = p_field and active;
  insert into customer.value_corrections (tenant_id, client_id, output_field, value_id, cleared, reason, verified_by)
  values (c.tenant_id, c.id, p_field, v_value, coalesce(p_cleared, false), btrim(coalesce(p_reason, '')), v_actor);
  perform customer.project_client_field(c.id, f.key);
  perform customer.refresh_client_answers(c.id);
  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
  values (c.tenant_id, v_actor, 'customer_value_corrected', 'customer', c.id,
          jsonb_build_object('field', p_field, 'code', p_code, 'cleared', coalesce(p_cleared, false), 'reason', p_reason));
  return jsonb_build_object('client_code', c.client_code, 'field', p_field);
end $$;

-- ---------------------------------------------------------------------------
-- 10. Reference values to start with
-- ---------------------------------------------------------------------------
-- Places: countries, the states and union territories of India, cities with
-- their old and common names, Mumbai's localities and three districts. More
-- are added through Data standards (or a later India Post / LGD load).
insert into customer.ref_values (domain, code, label, kind) values
  ('place', 'india', 'India', 'country'),
  ('place', 'usa', 'United States of America', 'country'),
  ('place', 'uk', 'United Kingdom', 'country'),
  ('place', 'uae', 'United Arab Emirates', 'country'),
  ('place', 'canada', 'Canada', 'country'),
  ('place', 'australia', 'Australia', 'country'),
  ('place', 'singapore', 'Singapore', 'country'),
  ('place', 'new-zealand', 'New Zealand', 'country'),
  ('place', 'oman', 'Oman', 'country'),
  ('place', 'qatar', 'Qatar', 'country'),
  ('place', 'kuwait', 'Kuwait', 'country'),
  ('place', 'saudi-arabia', 'Saudi Arabia', 'country'),
  ('place', 'bahrain', 'Bahrain', 'country'),
  ('place', 'nepal', 'Nepal', 'country'),
  ('place', 'hong-kong', 'Hong Kong', 'country'),
  ('place', 'germany', 'Germany', 'country'),
  ('place', 'france', 'France', 'country'),
  ('place', 'kenya', 'Kenya', 'country'),
  ('place', 'south-africa', 'South Africa', 'country'),
  ('place', 'malaysia', 'Malaysia', 'country'),
  ('place', 'thailand', 'Thailand', 'country'),
  ('place', 'bangladesh', 'Bangladesh', 'country'),
  ('place', 'sri-lanka', 'Sri Lanka', 'country'),
  ('place', 'netherlands', 'Netherlands', 'country'),
  ('place', 'switzerland', 'Switzerland', 'country'),
  ('place', 'italy', 'Italy', 'country'),
  ('place', 'japan', 'Japan', 'country'),
  ('place', 'china', 'China', 'country');
insert into customer.ref_values (domain, code, label, kind, parent_id)
select 'place', s.code, s.label, 'state', (select id from customer.ref_values where domain = 'place' and code = 'india') from (values
  ('andhra-pradesh', 'Andhra Pradesh'),
  ('arunachal-pradesh', 'Arunachal Pradesh'),
  ('assam', 'Assam'),
  ('bihar', 'Bihar'),
  ('chhattisgarh', 'Chhattisgarh'),
  ('goa', 'Goa'),
  ('gujarat', 'Gujarat'),
  ('haryana', 'Haryana'),
  ('himachal-pradesh', 'Himachal Pradesh'),
  ('jharkhand', 'Jharkhand'),
  ('karnataka', 'Karnataka'),
  ('kerala', 'Kerala'),
  ('madhya-pradesh', 'Madhya Pradesh'),
  ('maharashtra', 'Maharashtra'),
  ('manipur', 'Manipur'),
  ('meghalaya', 'Meghalaya'),
  ('mizoram', 'Mizoram'),
  ('nagaland', 'Nagaland'),
  ('odisha', 'Odisha'),
  ('punjab', 'Punjab'),
  ('rajasthan', 'Rajasthan'),
  ('sikkim', 'Sikkim'),
  ('tamil-nadu', 'Tamil Nadu'),
  ('telangana', 'Telangana'),
  ('tripura', 'Tripura'),
  ('uttar-pradesh', 'Uttar Pradesh'),
  ('uttarakhand', 'Uttarakhand'),
  ('west-bengal', 'West Bengal'),
  ('andaman-and-nicobar-islands', 'Andaman and Nicobar Islands'),
  ('chandigarh-ut', 'Chandigarh (UT)'),
  ('dadra-and-nagar-haveli-and-daman-and-diu', 'Dadra and Nagar Haveli and Daman and Diu'),
  ('delhi-nct', 'Delhi (NCT)'),
  ('jammu-and-kashmir', 'Jammu and Kashmir'),
  ('ladakh', 'Ladakh'),
  ('lakshadweep', 'Lakshadweep'),
  ('puducherry', 'Puducherry')) s(code, label);
insert into customer.ref_values (domain, code, label, kind, parent_id)
select 'place', s.code, s.label, 'city', (select id from customer.ref_values where domain = 'place' and code = s.parent) from (values
  ('mumbai', 'Mumbai', 'maharashtra'),
  ('navi-mumbai', 'Navi Mumbai', 'maharashtra'),
  ('thane', 'Thane', 'maharashtra'),
  ('pune', 'Pune', 'maharashtra'),
  ('nashik', 'Nashik', 'maharashtra'),
  ('nagpur', 'Nagpur', 'maharashtra'),
  ('chhatrapati-sambhajinagar', 'Chhatrapati Sambhajinagar', 'maharashtra'),
  ('kolhapur', 'Kolhapur', 'maharashtra'),
  ('solapur', 'Solapur', 'maharashtra'),
  ('kalyan', 'Kalyan', 'maharashtra'),
  ('dombivli', 'Dombivli', 'maharashtra'),
  ('vasai-virar', 'Vasai-Virar', 'maharashtra'),
  ('mira-bhayandar', 'Mira-Bhayandar', 'maharashtra'),
  ('bhiwandi', 'Bhiwandi', 'maharashtra'),
  ('panvel', 'Panvel', 'maharashtra'),
  ('lonavala', 'Lonavala', 'maharashtra'),
  ('ulhasnagar', 'Ulhasnagar', 'maharashtra'),
  ('ambernath', 'Ambernath', 'maharashtra'),
  ('badlapur', 'Badlapur', 'maharashtra'),
  ('ahmedabad', 'Ahmedabad', 'gujarat'),
  ('surat', 'Surat', 'gujarat'),
  ('vadodara', 'Vadodara', 'gujarat'),
  ('rajkot', 'Rajkot', 'gujarat'),
  ('gandhinagar', 'Gandhinagar', 'gujarat'),
  ('bhavnagar', 'Bhavnagar', 'gujarat'),
  ('jamnagar', 'Jamnagar', 'gujarat'),
  ('anand', 'Anand', 'gujarat'),
  ('bharuch', 'Bharuch', 'gujarat'),
  ('valsad', 'Valsad', 'gujarat'),
  ('vapi', 'Vapi', 'gujarat'),
  ('navsari', 'Navsari', 'gujarat'),
  ('delhi', 'Delhi', 'delhi-nct'),
  ('gurugram', 'Gurugram', 'haryana'),
  ('noida', 'Noida', 'uttar-pradesh'),
  ('ghaziabad', 'Ghaziabad', 'uttar-pradesh'),
  ('faridabad', 'Faridabad', 'haryana'),
  ('bengaluru', 'Bengaluru', 'karnataka'),
  ('mysuru', 'Mysuru', 'karnataka'),
  ('mangaluru', 'Mangaluru', 'karnataka'),
  ('hubballi', 'Hubballi', 'karnataka'),
  ('chennai', 'Chennai', 'tamil-nadu'),
  ('coimbatore', 'Coimbatore', 'tamil-nadu'),
  ('madurai', 'Madurai', 'tamil-nadu'),
  ('hyderabad', 'Hyderabad', 'telangana'),
  ('secunderabad', 'Secunderabad', 'telangana'),
  ('visakhapatnam', 'Visakhapatnam', 'andhra-pradesh'),
  ('vijayawada', 'Vijayawada', 'andhra-pradesh'),
  ('kolkata', 'Kolkata', 'west-bengal'),
  ('siliguri', 'Siliguri', 'west-bengal'),
  ('jaipur', 'Jaipur', 'rajasthan'),
  ('udaipur', 'Udaipur', 'rajasthan'),
  ('jodhpur', 'Jodhpur', 'rajasthan'),
  ('indore', 'Indore', 'madhya-pradesh'),
  ('bhopal', 'Bhopal', 'madhya-pradesh'),
  ('lucknow', 'Lucknow', 'uttar-pradesh'),
  ('kanpur', 'Kanpur', 'uttar-pradesh'),
  ('varanasi', 'Varanasi', 'uttar-pradesh'),
  ('chandigarh', 'Chandigarh', 'chandigarh-ut'),
  ('ludhiana', 'Ludhiana', 'punjab'),
  ('amritsar', 'Amritsar', 'punjab'),
  ('kochi', 'Kochi', 'kerala'),
  ('thiruvananthapuram', 'Thiruvananthapuram', 'kerala'),
  ('panaji', 'Panaji', 'goa'),
  ('patna', 'Patna', 'bihar'),
  ('bhubaneswar', 'Bhubaneswar', 'odisha'),
  ('raipur', 'Raipur', 'chhattisgarh'),
  ('guwahati', 'Guwahati', 'assam'),
  ('dehradun', 'Dehradun', 'uttarakhand'),
  ('dubai', 'Dubai', 'uae'),
  ('abu-dhabi', 'Abu Dhabi', 'uae'),
  ('sharjah', 'Sharjah', 'uae'),
  ('london', 'London', 'uk'),
  ('new-york', 'New York', 'usa'),
  ('toronto', 'Toronto', 'canada'),
  ('sydney', 'Sydney', 'australia'),
  ('melbourne', 'Melbourne', 'australia'),
  ('muscat', 'Muscat', 'oman'),
  ('doha', 'Doha', 'qatar'),
  ('nairobi', 'Nairobi', 'kenya')) s(code, label, parent);
insert into customer.ref_values (domain, code, label, kind, parent_id)
select 'place', s.code, s.label, 'locality', (select id from customer.ref_values where domain = 'place' and code = 'mumbai') from (values
  ('mumbai-andheri', 'Andheri'),
  ('mumbai-bandra', 'Bandra'),
  ('mumbai-borivali', 'Borivali'),
  ('mumbai-malad', 'Malad'),
  ('mumbai-kandivali', 'Kandivali'),
  ('mumbai-goregaon', 'Goregaon'),
  ('mumbai-dahisar', 'Dahisar'),
  ('mumbai-jogeshwari', 'Jogeshwari'),
  ('mumbai-juhu', 'Juhu'),
  ('mumbai-santacruz', 'Santacruz'),
  ('mumbai-vile-parle', 'Vile Parle'),
  ('mumbai-khar', 'Khar'),
  ('mumbai-powai', 'Powai'),
  ('mumbai-ghatkopar', 'Ghatkopar'),
  ('mumbai-mulund', 'Mulund'),
  ('mumbai-bhandup', 'Bhandup'),
  ('mumbai-vikhroli', 'Vikhroli'),
  ('mumbai-kurla', 'Kurla'),
  ('mumbai-chembur', 'Chembur'),
  ('mumbai-sion', 'Sion'),
  ('mumbai-dadar', 'Dadar'),
  ('mumbai-matunga', 'Matunga'),
  ('mumbai-mahim', 'Mahim'),
  ('mumbai-worli', 'Worli'),
  ('mumbai-lower-parel', 'Lower Parel'),
  ('mumbai-parel', 'Parel'),
  ('mumbai-byculla', 'Byculla'),
  ('mumbai-colaba', 'Colaba'),
  ('mumbai-churchgate', 'Churchgate'),
  ('mumbai-marine-lines', 'Marine Lines'),
  ('mumbai-grant-road', 'Grant Road'),
  ('mumbai-girgaon', 'Girgaon'),
  ('mumbai-malabar-hill', 'Malabar Hill'),
  ('mumbai-breach-candy', 'Breach Candy'),
  ('mumbai-tardeo', 'Tardeo'),
  ('mumbai-mazgaon', 'Mazgaon'),
  ('mumbai-wadala', 'Wadala'),
  ('mumbai-kalbadevi', 'Kalbadevi'),
  ('mumbai-zaveri-bazaar', 'Zaveri Bazaar'),
  ('mumbai-bhuleshwar', 'Bhuleshwar'),
  ('mumbai-charni-road', 'Charni Road'),
  ('mumbai-prabhadevi', 'Prabhadevi'),
  ('mumbai-lokhandwala', 'Lokhandwala'),
  ('mumbai-versova', 'Versova'),
  ('mumbai-oshiwara', 'Oshiwara'),
  ('mumbai-chandivali', 'Chandivali'),
  ('mumbai-saki-naka', 'Saki Naka'),
  ('mumbai-marol', 'Marol'),
  ('mumbai-chakala', 'Chakala'),
  ('mumbai-cuffe-parade', 'Cuffe Parade'),
  ('mumbai-nariman-point', 'Nariman Point'),
  ('mumbai-peddar-road', 'Peddar Road'),
  ('mumbai-napean-sea-road', 'Napean Sea Road'),
  ('mumbai-altamount-road', 'Altamount Road'),
  ('mumbai-kemps-corner', 'Kemps Corner'),
  ('mumbai-walkeshwar', 'Walkeshwar'),
  ('mumbai-gamdevi', 'Gamdevi'),
  ('mumbai-opera-house', 'Opera House'),
  ('mumbai-mumbai-central', 'Mumbai Central'),
  ('mumbai-agripada', 'Agripada'),
  ('mumbai-nagpada', 'Nagpada'),
  ('mumbai-dongri', 'Dongri'),
  ('mumbai-masjid-bunder', 'Masjid Bunder'),
  ('mumbai-crawford-market', 'Crawford Market'),
  ('mumbai-chira-bazar', 'Chira Bazar'),
  ('mumbai-kalachowki', 'Kalachowki'),
  ('mumbai-sewri', 'Sewri'),
  ('mumbai-antop-hill', 'Antop Hill'),
  ('mumbai-dharavi', 'Dharavi'),
  ('mumbai-bandra-kurla-complex', 'Bandra Kurla Complex'),
  ('mumbai-kalina', 'Kalina'),
  ('mumbai-vidyavihar', 'Vidyavihar'),
  ('mumbai-kanjurmarg', 'Kanjurmarg'),
  ('mumbai-nahur', 'Nahur'),
  ('mumbai-govandi', 'Govandi'),
  ('mumbai-mankhurd', 'Mankhurd'),
  ('mumbai-deonar', 'Deonar'),
  ('mumbai-trombay', 'Trombay'),
  ('mumbai-chunabhatti', 'Chunabhatti'),
  ('mumbai-tilak-nagar', 'Tilak Nagar'),
  ('mumbai-kandarpada', 'Kandarpada'),
  ('mumbai-gorai', 'Gorai'),
  ('mumbai-charkop', 'Charkop'),
  ('mumbai-poisar', 'Poisar')) s(code, label);
insert into customer.ref_values (domain, code, label, kind, parent_id) values
  ('place', 'mumbai-city-district', 'Mumbai City', 'district', (select id from customer.ref_values where domain = 'place' and code = 'maharashtra')),
  ('place', 'mumbai-suburban-district', 'Mumbai Suburban', 'district', (select id from customer.ref_values where domain = 'place' and code = 'maharashtra')),
  ('place', 'bengaluru-urban-district', 'Bengaluru Urban', 'district', (select id from customer.ref_values where domain = 'place' and code = 'karnataka'));
insert into customer.ref_aliases (value_id, domain, alias, alias_key, kind)
select v.id, 'place', a.alias, customer.std_key(a.alias), a.kind from (values
  ('india', 'Bharat', 'spelling'),
  ('india', 'IND', 'spelling'),
  ('india', 'IN', 'spelling'),
  ('india', 'Hindustan', 'spelling'),
  ('usa', 'USA', 'spelling'),
  ('usa', 'US', 'spelling'),
  ('usa', 'United States', 'spelling'),
  ('usa', 'America', 'spelling'),
  ('usa', 'U S A', 'spelling'),
  ('uk', 'UK', 'spelling'),
  ('uk', 'U K', 'spelling'),
  ('uk', 'England', 'spelling'),
  ('uk', 'Great Britain', 'spelling'),
  ('uk', 'Britain', 'spelling'),
  ('uae', 'UAE', 'spelling'),
  ('uae', 'U A E', 'spelling'),
  ('uae', 'Emirates', 'spelling'),
  ('new-zealand', 'NZ', 'spelling'),
  ('saudi-arabia', 'KSA', 'spelling'),
  ('saudi-arabia', 'Saudi', 'spelling'),
  ('hong-kong', 'HK', 'spelling'),
  ('netherlands', 'Holland', 'spelling'),
  ('andhra-pradesh', 'AP', 'spelling'),
  ('chhattisgarh', 'Chattisgarh', 'spelling'),
  ('gujarat', 'Gujrat', 'spelling'),
  ('gujarat', 'GJ', 'spelling'),
  ('himachal-pradesh', 'HP', 'spelling'),
  ('karnataka', 'KA', 'spelling'),
  ('madhya-pradesh', 'MP', 'spelling'),
  ('maharashtra', 'Maharastra', 'spelling'),
  ('maharashtra', 'MH', 'spelling'),
  ('odisha', 'Orissa', 'spelling'),
  ('tamil-nadu', 'TN', 'spelling'),
  ('tamil-nadu', 'Tamilnadu', 'spelling'),
  ('telangana', 'Telagana', 'spelling'),
  ('telangana', 'Telengana', 'spelling'),
  ('uttar-pradesh', 'UP', 'spelling'),
  ('uttarakhand', 'Uttaranchal', 'spelling'),
  ('west-bengal', 'WB', 'spelling'),
  ('delhi-nct', 'NCT of Delhi', 'spelling'),
  ('jammu-and-kashmir', 'J&K', 'spelling'),
  ('jammu-and-kashmir', 'J and K', 'spelling'),
  ('puducherry', 'Pondicherry', 'spelling'),
  ('mumbai', 'Bombay', 'historical'),
  ('navi-mumbai', 'New Mumbai', 'spelling'),
  ('pune', 'Poona', 'historical'),
  ('nashik', 'Nasik', 'spelling'),
  ('chhatrapati-sambhajinagar', 'Aurangabad', 'historical'),
  ('solapur', 'Sholapur', 'spelling'),
  ('dombivli', 'Dombivali', 'spelling'),
  ('vasai-virar', 'Vasai', 'spelling'),
  ('vasai-virar', 'Virar', 'spelling'),
  ('mira-bhayandar', 'Mira Road', 'spelling'),
  ('mira-bhayandar', 'Mira Bhayandar', 'spelling'),
  ('mira-bhayandar', 'Bhayandar', 'spelling'),
  ('mira-bhayandar', 'Bhayander', 'spelling'),
  ('lonavala', 'Lonavla', 'spelling'),
  ('ahmedabad', 'Amdavad', 'spelling'),
  ('ahmedabad', 'Ahemdabad', 'spelling'),
  ('ahmedabad', 'Ahmadabad', 'spelling'),
  ('vadodara', 'Baroda', 'historical'),
  ('bharuch', 'Broach', 'historical'),
  ('delhi', 'New Delhi', 'spelling'),
  ('gurugram', 'Gurgaon', 'historical'),
  ('bengaluru', 'Bangalore', 'historical'),
  ('bengaluru', 'Banglore', 'spelling'),
  ('mysuru', 'Mysore', 'historical'),
  ('mangaluru', 'Mangalore', 'historical'),
  ('hubballi', 'Hubli', 'historical'),
  ('chennai', 'Madras', 'historical'),
  ('hyderabad', 'Hyd', 'spelling'),
  ('visakhapatnam', 'Vizag', 'spelling'),
  ('kolkata', 'Calcutta', 'historical'),
  ('varanasi', 'Banaras', 'historical'),
  ('varanasi', 'Benaras', 'historical'),
  ('kochi', 'Cochin', 'historical'),
  ('thiruvananthapuram', 'Trivandrum', 'historical'),
  ('panaji', 'Panjim', 'historical'),
  ('guwahati', 'Gauhati', 'historical'),
  ('dehradun', 'Dehra Dun', 'spelling'),
  ('new-york', 'NYC', 'spelling'),
  ('mumbai-borivali', 'Borivli', 'spelling'),
  ('mumbai-kandivali', 'Kandivli', 'spelling'),
  ('mumbai-santacruz', 'Santa Cruz', 'spelling'),
  ('mumbai-vile-parle', 'Vileparle', 'spelling'),
  ('mumbai-zaveri-bazaar', 'Zaveri Bazar', 'spelling'),
  ('mumbai-zaveri-bazaar', 'Javeri Bazar', 'spelling'),
  ('mumbai-saki-naka', 'Sakinaka', 'spelling'),
  ('mumbai-bandra-kurla-complex', 'BKC', 'spelling'),
  ('bengaluru-urban-district', 'Bangalore Urban', 'historical')) a(code, alias, kind) join customer.ref_values v on v.domain = 'place' and v.code = a.code
on conflict do nothing;
-- Every value is known by its own label.
insert into customer.ref_aliases (value_id, domain, alias, alias_key, kind)
select v.id, v.domain, v.label, customer.std_key(v.label), 'label' from customer.ref_values v on conflict do nothing;

-- "Mumbai Suburban" or "Bangalore Urban" written as a city: the city, and the district.
insert into customer.std_rules (field_key, input_key, outputs, reason, approved_at) values
  ('city', 'mumbai suburban', '[{"field": "city", "code": "place:mumbai"}, {"field": "district", "code": "place:mumbai-suburban-district"}]', 'Starting rule (migration 0455)', now()),
  ('city', 'mumbai city', '[{"field": "city", "code": "place:mumbai"}, {"field": "district", "code": "place:mumbai-city-district"}]', 'Starting rule (migration 0455)', now()),
  ('city', 'bangalore urban', '[{"field": "city", "code": "place:bengaluru"}, {"field": "district", "code": "place:bengaluru-urban-district"}]', 'Starting rule (migration 0455)', now()),
  ('city', 'bengaluru urban', '[{"field": "city", "code": "place:bengaluru"}, {"field": "district", "code": "place:bengaluru-urban-district"}]', 'Starting rule (migration 0455)', now());

-- Community: the spellings seen in the data (owner's list, 2026-11-28),
-- only as written - nothing is inferred.
insert into customer.ref_values (domain, code, label)
select 'community', customer.ref_slug(x.label), x.label from (values
  ('Sindhi'), ('Gujarati'), ('Muslim'), ('Punjabi'), ('Marathi'), ('Jain'), ('Marwadi'), ('Rajasthani'), ('South Indian'), ('Brahmin'),
  ('Rajput'), ('Telugu'), ('Bohra'), ('Catholic'), ('Buddhist'), ('Goan Christian'), ('Tamil Brahmin'), ('Hindu Brahmin'), ('Kannada'), ('Tamil')) x(label);
insert into customer.ref_aliases (value_id, domain, alias, alias_key, kind)
select v.id, 'community', a.alias, customer.std_key(a.alias), 'spelling' from (values
  ('gujarati', 'Gujrati'), ('gujarati', 'Gujraati'), ('telugu', 'Telegu'), ('bohra', 'Bhohra'), ('marwadi', 'Marwari')) a(code, alias)
  join customer.ref_values v on v.domain = 'community' and v.code = a.code;
insert into customer.ref_aliases (value_id, domain, alias, alias_key, kind)
select v.id, v.domain, v.label, customer.std_key(v.label), 'label' from customer.ref_values v where v.domain = 'community' on conflict do nothing;
insert into customer.std_rules (field_key, input_key, outputs, reason, approved_at) values
  ('community', 'other', '[{"field": "community", "status": "other"}]', 'Starting rule (migration 0455)', now());

-- How they found us (acquisition source): only plain names; anything that
-- needs judgement ("THROUGH STORY", "OLD CLIENT") waits for review.
insert into customer.ref_values (domain, code, label)
select 'acquisition', customer.ref_slug(x.label), x.label from (values
  ('Instagram'), ('Facebook'), ('Google Ads'), ('WhatsApp'), ('Walk-in'), ('Exhibition'), ('Referral'), ('Advertisement'), ('Website'), ('Calling')) x(label);
insert into customer.ref_aliases (value_id, domain, alias, alias_key, kind)
select v.id, 'acquisition', a.alias, customer.std_key(a.alias), 'spelling' from (values
  ('google-ads', 'Google Ad'), ('walk-in', 'Walk in'), ('walk-in', 'Walkin'), ('referral', 'Reference')) a(code, alias)
  join customer.ref_values v on v.domain = 'acquisition' and v.code = a.code;
insert into customer.ref_aliases (value_id, domain, alias, alias_key, kind)
select v.id, v.domain, v.label, customer.std_key(v.label), 'label' from customer.ref_values v where v.domain = 'acquisition' on conflict do nothing;

-- The label of a value is the spelling the data uses most (owner, 2026-11-28);
-- every other spelling stays an alias. Run now and when asked.
create function customer.ref_relabel_by_usage(p_domain text) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in
    select distinct on (a.value_id) a.value_id, a.alias, cnt
      from customer.ref_aliases a
      join customer.ref_values v on v.id = a.value_id and v.domain = p_domain
      cross join lateral (select count(*) as cnt from customer.client_field_values o
                           join customer.field_catalog f on f.key = o.field_key and f.ref_domain = p_domain
                          where customer.std_key(o.value) = a.alias_key) u
     where a.kind in ('label', 'spelling', 'historical') and a.alias !~ '^[A-Z]{2,4}$'
     order by a.value_id, cnt desc, (a.kind = 'label') desc
  loop
    continue when r.cnt = 0;
    update customer.ref_values v set label = initcap(lower(r.alias)), updated_at = now()
     where v.id = r.value_id and lower(v.label) <> lower(r.alias)
       and not exists (select 1 from customer.ref_values o where o.domain = v.domain and o.id <> v.id and lower(o.label) = lower(r.alias));
    if found then
      n := n + 1;
      insert into customer.ref_aliases (value_id, domain, alias, alias_key, kind)
      values (r.value_id, p_domain, initcap(lower(r.alias)), customer.std_key(r.alias), 'label') on conflict do nothing;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 11. The fields in the slice, and the new ones
-- ---------------------------------------------------------------------------
update customer.field_catalog set policy = 'place', ref_domain = 'place', output_field = key,
       meaning = 'Where the customer lives, as a place (country, state, district, city, locality).'
 where key in ('city', 'state', 'country');
update customer.field_catalog set policy = 'reference', ref_domain = 'community', multi = true, sensitive = true,
       meaning = 'Community as the customer or the sheet recorded it. Sensitive: never inferred.'
 where key = 'community';
update customer.field_catalog set policy = 'reference', ref_domain = 'acquisition', output_field = 'acquisition_source',
       meaning = 'How the customer said they came to know MK Jewels, as written.'
 where key in ('lead_source', 'first_interaction_source');
update customer.field_catalog set policy = 'reference', ref_domain = 'beverage',
       meaning = 'The drink served at the visit.'
 where key = 'beverage';
update customer.field_catalog set label = 'How they came (as written)' where key = 'lead_source';
update customer.field_catalog set label = 'First contact through (as written)' where key = 'first_interaction_source';

insert into customer.field_catalog (key, label, card, data_type, kind, expr, sort_order, meaning) values
  ('locality', 'Locality / area', 'Address', 'text', 'column', 'c.locality', 81, 'A known locality of the city (from the city or address answers).'),
  ('district', 'District', 'Address', 'text', 'column', 'c.district', 82, 'District, when the data names one.'),
  ('acquisition_source', 'How they found us', 'Customer', 'text', 'computed', '(c.std_values ->> ''acquisition_source'')', 15,
   'Standardized from "How they came" and "First contact through". Unknown when never recorded; never taken from the sheet a record was imported from.'),
  ('imported_from', 'Imported from', 'Customer', 'text', 'computed', '(select s.label from customer.sources s where s.source = c.first_source)', 16,
   'The sheet or system the customer record first came from (data origin). Not how they found us.'),
  ('record_origin', 'Record origin (as written)', 'Customer', 'text', 'column', 'c.first_origin', 17,
   'The source written in the sheet that first held the record.')
on conflict (key) do nothing;
update customer.field_catalog set sort_order = 80 where key = 'city';
update customer.field_catalog set sort_order = 83 where key = 'state';
update customer.field_catalog set sort_order = 84 where key = 'country';
update customer.field_catalog set sort_order = 85 where key = 'pincode';
update customer.field_catalog set sort_order = 86 where key = 'address';
-- Standardized fields filter on their stable codes.
alter table customer.field_catalog add column code_expr text;
update customer.field_catalog set code_expr = format('(c.std_codes -> %L)', coalesce(output_field, key))
 where policy <> 'none' or key in ('locality', 'district', 'acquisition_source');
update customer.field_catalog set data_type = 'list', expr = 'string_to_array(c.community, '', '')' where key = 'community';

-- ---------------------------------------------------------------------------
-- 12. Sensitive fields and codes in the table, values, list and pages
-- ---------------------------------------------------------------------------
create function customer.can_see_field(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not coalesce((select f.sensitive from customer.field_catalog f where f.key = p_key), false)
      or public.has_permission('customers.view_sensitive');
$$;

select customer._patch_0455('public.customer_table_fields()'::regprocedure,
  $o$                                                       'filterable', filterable, 'sortable', sortable) order by sort_order, label)
                     from customer.field_catalog), '[]'::jsonb);$o$,
  $n$                                                       'filterable', filterable, 'sortable', sortable, 'standardized', policy <> 'none' or code_expr is not null,
                                                       'meaning', meaning) order by sort_order, label)
                     from customer.field_catalog where customer.can_see_field(key)), '[]'::jsonb);$n$, 1);

-- A selection of standardized values is matched on codes ("place:mumbai"),
-- so renaming a label keeps saved filters working; plain text still works.
select customer._patch_0455('customer.table_condition(jsonb,integer)'::regprocedure,
  $o$  select * into f from customer.field_catalog where key = p_node ->> 'field' and filterable;
  if f.key is null then raise exception 'Unknown field %', coalesce(p_node ->> 'field', '') using errcode = '22023'; end if;$o$,
  $n$  select * into f from customer.field_catalog where key = p_node ->> 'field' and filterable;
  if f.key is null or not customer.can_see_field(f.key) then raise exception 'Unknown field %', coalesce(p_node ->> 'field', '') using errcode = '22023'; end if;
  if f.code_expr is not null and coalesce(p_node ->> 'op', '') in ('is_any_of', 'is_none_of', 'has_any_of', 'has_none_of')
     and jsonb_typeof(p_node -> 'value') = 'array'
     and exists (select 1 from jsonb_array_elements_text(p_node -> 'value') x where x ~ '^[a-z][a-z0-9_]*:[a-z0-9]')
     and not exists (select 1 from jsonb_array_elements_text(p_node -> 'value') x where x !~ '^[a-z][a-z0-9_]*:[a-z0-9]') then
    if jsonb_array_length(p_node -> 'value') > 500 then raise exception 'Choose 1 to 500 values' using errcode = '22023'; end if;
    -- Containment on the indexed codes; a customer is one row however many of its values match.
    v_like := substring(f.code_expr from '-> ''([a-z_]+)''');
    select string_agg(format('c.std_codes @> %L or c.std_codes @> %L', jsonb_build_object(v_like, z), jsonb_build_object(v_like, jsonb_build_array(z))), ' or ')
      into v_part
      from (select coalesce(customer.ref_code(customer.ref_by_code(x)), x) as z from jsonb_array_elements_text(p_node -> 'value') x) t;
    return case when p_node ->> 'op' in ('is_any_of', 'has_any_of') then '(' || v_part || ')' else 'not (' || v_part || ')' end;
  end if;$n$, 1);

select customer._patch_0455('public.customer_table(jsonb)'::regprocedure,
  $o$      select * into f from customer.field_catalog where key = s ->> 'field' and sortable;$o$,
  $n$      select * into f from customer.field_catalog where key = s ->> 'field' and sortable and customer.can_see_field(key);$n$, 1);
select customer._patch_0455('public.customer_table(jsonb)'::regprocedure,
  $o$  for f in select fc.* from customer.field_catalog fc join unnest(v_cols) with ordinality u(k, n) on u.k = fc.key order by u.n loop$o$,
  $n$  for f in select fc.* from customer.field_catalog fc join unnest(v_cols) with ordinality u(k, n) on u.k = fc.key
             where customer.can_see_field(fc.key) order by u.n loop$n$, 1);

-- The value picker: a standardized field offers each value once, with its
-- code and the number of distinct customers, plus what is not standardized yet.
select customer._patch_0455('public.customer_table_values(text,text,text)'::regprocedure,
  $o$  select * into f from customer.field_catalog where key = p_field and data_type in ('text', 'list');
  if f.key is null then raise exception 'This field has no list of values' using errcode = '22023'; end if;$o$,
  $n$  select * into f from customer.field_catalog where key = p_field and data_type in ('text', 'list');
  if f.key is null or not customer.can_see_field(f.key) then raise exception 'This field has no list of values' using errcode = '22023'; end if;$n$, 1);
select customer._patch_0455('public.customer_table_values(text,text,text)'::regprocedure,
  $o$  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''value'', v, ''count'', n) order by n desc, v), ''[]''::jsonb) from ('$o$,
  $n$  if f.code_expr is not null then
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''value'', coalesce(r.label, t.code), ''code'', t.code, ''count'', t.n) order by t.n desc, r.label), ''[]''::jsonb) from ('
      || ' select z as code, count(distinct c.id) n from customer.clients c'
      || ' cross join lateral jsonb_array_elements_text(case jsonb_typeof(%1$s) when ''array'' then %1$s when ''string'' then jsonb_build_array(%1$s) else ''[]''::jsonb end) z'
      || ' where %2$s group by z) t'
      || ' left join customer.ref_values r on r.id = customer.ref_by_code(t.code)'
      || ' where %3$L = '''' or r.label ilike %4$L or exists (select 1 from customer.ref_aliases a where a.value_id = r.id and a.alias ilike %4$L)',
      f.code_expr, v_where, v_q, '%' || v_q || '%') into v_rows;
    -- Not standardized yet (shown as written), counted together.
    return v_rows || coalesce((select jsonb_agg(x) from (select jsonb_build_object('value', 'Not standardized yet', 'code', null, 'count', count(*)) x
       from customer.clients c where c.tenant_id = v_tenant and c.archived_at is null and c.merged_into_client_id is null
         and (v_view is null or c.franchise_group_id = any (v_view)) and c.std_status ->> coalesce(f.output_field, f.key) in ('unmapped', 'other')
       having count(*) > 0) t), '[]'::jsonb);
  end if;
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''value'', v, ''count'', n) order by n desc, v), ''[]''::jsonb) from ('$n$, 1);

select customer._patch_0455('public.customer_list(jsonb,integer,integer)'::regprocedure,
  $o$       and (v_communities is null or c.community = any (v_communities))$o$,
  $n$       and (v_communities is null or (public.has_permission('customers.view_sensitive') and c.community = any (v_communities)))$n$, 1);
select customer._patch_0455('public.customer_list(jsonb,integer,integer)'::regprocedure,
  $o$'community', p.community,$o$,
  $n$'community', case when public.has_permission('customers.view_sensitive') then p.community end,$n$, 1);
select customer._patch_0455('public.customer_list_filters(text)'::regprocedure,
  $o$    'communities', (select coalesce(jsonb_agg($o$,
  $n$    'communities', (select coalesce(jsonb_agg($n$, 1);
select customer._patch_0455('public.customer_list_filters(text)'::regprocedure,
  $o$and community is not null group by community order by count(*) desc limit 300) t),$o$,
  $n$and community is not null and public.has_permission('customers.view_sensitive') group by community order by count(*) desc limit 300) t),$n$, 1);
select customer._patch_0455('public.customer_list_filters(text)'::regprocedure,
  $o$    'total', (select count(*) from customer.clients where tenant_id = v_tenant and archived_at is null and (v_view is null or franchise_group_id = any (v_view))),$o$,
  $n$    'total', (select count(*) from customer.clients where tenant_id = v_tenant and archived_at is null and (v_view is null or franchise_group_id = any (v_view))),
    'can_view_data_quality', public.has_permission('customers.view_data_quality'),$n$, 1);
select customer._patch_0455('public.customer_form_lookup(text)'::regprocedure,
  $o$    'community', c.community,$o$,
  $n$    'community', case when public.has_permission('customers.view_sensitive') then c.community end,$n$, 1);

-- The customer page and profile: sensitive answers leave out, and each
-- standardized field says what it was read as and from what.
alter function public.customer_get_profile(uuid) rename to customer_get_profile_all;
alter function public.customer_get_client_page(text) rename to customer_get_client_page_all;
select customer._patch_0455('public.customer_get_client_page_all(text)'::regprocedure,
  $o$  return public.customer_get_profile(v_client.id) || jsonb_build_object($o$,
  $n$  return public.customer_get_profile_all(v_client.id) || jsonb_build_object($n$, 1);
revoke all on function public.customer_get_profile_all(uuid) from public, anon, authenticated;
revoke all on function public.customer_get_client_page_all(text) from public, anon, authenticated;

create function customer.strip_sensitive(p_page jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_keys text[]; r jsonb := p_page;
begin
  if public.has_permission('customers.view_sensitive') then return r; end if;
  select coalesce(array_agg(key), '{}') into v_keys from customer.field_catalog where sensitive;
  r := jsonb_set(r, '{client}', (r -> 'client') - v_keys - 'std_values' - 'std_codes' - 'std_status'
         || jsonb_build_object('std_values', (r #> '{client,std_values}') - v_keys, 'std_codes', (r #> '{client,std_codes}') - v_keys,
                               'std_status', (r #> '{client,std_status}') - v_keys));
  if r ? 'field_sources' then r := jsonb_set(r, '{field_sources}', (r -> 'field_sources') - v_keys); end if;
  if r ? 'answers' then
    r := jsonb_set(r, '{answers}', coalesce((select jsonb_agg(a) from jsonb_array_elements(r -> 'answers') a where not (a ->> 'field_key' = any (v_keys))), '[]'::jsonb));
  end if;
  return r;
end $$;

-- What each standardized field of a customer was read as, from which answer and why.
create function customer.client_standards(p_client_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(k.key, jsonb_build_object('value', c.std_values -> k.key, 'code', c.std_codes -> k.key,
           'status', c.std_status ->> k.key,
           'readings', (select coalesce(jsonb_agg(jsonb_build_object('raw', coalesce(i.part, v.value), 'source', coalesce(v.origin, s.label),
                           'observed_at', v.observed_at, 'status', i.status, 'method', i.method,
                           'value', (select r.label from customer.ref_values r where r.id = i.value_id))
                         order by s.source_rank desc, v.observed_at desc), '[]'::jsonb)
                          from customer.value_interpretations i join customer.client_field_values v on v.id = i.field_value_id
                          join customer.sources s on s.source = v.source
                         where i.client_id = p_client_id and i.output_field = k.key))), '{}'::jsonb)
    from customer.clients c
    cross join (select distinct coalesce(f.output_field, f.key) as key from customer.field_catalog f where f.policy <> 'none'
                union select 'locality' union select 'district') k
   where c.id = p_client_id and (c.std_status ? k.key or c.std_values ? k.key);
$$;

create function public.customer_get_profile(p_client_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select customer.strip_sensitive(public.customer_get_profile_all(p_client_id));
$$;
create function public.customer_get_client_page(p_client_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.customer_get_client_page_all(p_client_code);
  r := r || jsonb_build_object('standards', customer.client_standards((r #>> '{client,id}')::uuid));
  if not public.has_permission('customers.view_sensitive') then
    r := jsonb_set(r, '{standards}', (r -> 'standards') - coalesce((select array_agg(key) from customer.field_catalog where sensitive), '{}'));
  end if;
  return customer.strip_sensitive(r);
end $$;
revoke all on function public.customer_get_profile(uuid) from public, anon;
revoke all on function public.customer_get_client_page(text) from public, anon;
grant execute on function public.customer_get_profile(uuid) to authenticated;
grant execute on function public.customer_get_client_page(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. "New lead": a lead contacted once (owner, 2026-11-28)
-- ---------------------------------------------------------------------------
select customer._patch_0455('customer.client_tags(uuid)'::regprocedure,
  $o$    case when c.archive_reason = 'do_not_contact' then 'do_not_contact' end,$o$,
  $n$    case when c.archive_reason = 'do_not_contact' then 'do_not_contact' end,
    case when c.segment is distinct from 'buyer' and c.interaction_count = 1 then 'new_lead' end,$n$, 1);

drop function customer._patch_0455(regprocedure, text, text, integer);

-- ---------------------------------------------------------------------------
-- 14. Access, first run, schedule
-- ---------------------------------------------------------------------------
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'customer' and p.proname in ('std_key', 'std_placeholder', 'field_policy', 'ref_lookup', 'ref_by_code', 'ref_code',
               'ref_ancestor', 'place_output', 'interpret_observation', 'field_candidates', 'set_std_result', 'project_reference_field',
               'project_place', 'project_client_field', 'on_field_value_added', 'enqueue_std_job', 'process_std_jobs', 'std_require',
               'std_field', 'ref_slug', 'create_ref_value', 'add_ref_alias', 'enqueue_value_jobs', 'ref_relabel_by_usage', 'can_see_field',
               'strip_sensitive', 'client_standards')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
do $$
declare fn text;
begin
  foreach fn in array array['customer_std_overview()', 'customer_std_queue(text,text,integer)', 'customer_std_preview(text,text)',
    'customer_std_decide(text,text,jsonb,text)', 'customer_std_review_draft(uuid,boolean,text)', 'customer_std_end_rule(uuid,text)',
    'customer_std_rules(text,integer)', 'customer_std_set_policy(text,text,boolean)', 'customer_std_reprocess(text)',
    'customer_ref_values(text,text,integer)', 'customer_ref_save(jsonb)', 'customer_set_value_correction(text,text,text,boolean,text)'] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- Labels by usage, then every observation of the slice is read in the
-- background (cron below); until a customer is reached, it shows as before.
select customer.ref_relabel_by_usage('place');
select customer.ref_relabel_by_usage('community');
select customer.ref_relabel_by_usage('acquisition');
insert into customer.std_jobs (field_key, reason)
select key, 'first run (migration 0455)' from customer.field_catalog where policy <> 'none' order by sort_order;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('customer-standards-jobs', '* * * * *', 'select public.customer_process_std_jobs();');
  end if;
end $$;

reset statement_timeout;
