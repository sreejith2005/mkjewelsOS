-- 0454: customer master - the full table: every field as a column, any filter.
--
-- Owner, 2026-11-28: "implement the full view table ... properly be able to
-- filter anything that we want to ... infinitely customizable." Researched
-- (this chat): CRMs (HubSpot, Salesforce, Attio) pick columns from a field
-- catalogue, filter on the server with nested AND/OR groups, and keep fast
-- read models; Postgres guidance is real columns for common fields and an
-- indexed JSONB column for the rest, instead of filtering the per-source
-- history (customer.client_field_values) directly.
--
-- * customer.field_catalog: every field the table offers - label, card,
--   type, and the SQL expression that reads it. Written only by migrations
--   and by the nightly discovery of new answer keys; the browser sends only
--   field keys, never SQL.
-- * customer.client_answers: each customer's current answer per field (the
--   winning source, as on the customer page), one JSONB row per customer,
--   GIN-indexed. Kept up to date by refresh_client_stats, rebuilt nightly.
-- * public.customer_table(p_request): one page of rows with the chosen
--   columns, a filter tree (groups with "all"/"any", conditions with a type-
--   checked operator), a sort, and the total. Bad-data customers stay out
--   unless the filter asks about data problems or include_data_problems.
-- * public.customer_table_fields() and customer_table_values(p_field, p_q,
--   p_franchise) for the column picker and the value picker.
-- * Same reader rules as the list: module crm, permission crm.view, the
--   person's franchise view, merged and archived records left out.

create table customer.field_catalog (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  label text not null,
  card text not null,
  data_type text not null check (data_type in ('text', 'number', 'date', 'datetime', 'boolean', 'list')),
  kind text not null check (kind in ('column', 'answer', 'computed')),
  expr text not null,
  sort_order integer not null default 1000,
  filterable boolean not null default true,
  sortable boolean not null default true
);
comment on table customer.field_catalog is 'Migration 0454: the fields of the customer table. expr reads the value from c (customer.clients) and a (customer.client_answers); written only by migrations and customer.discover_answer_fields().';
alter table customer.field_catalog enable row level security;
revoke all on customer.field_catalog from public, anon, authenticated;
grant all on customer.field_catalog to service_role;

create table customer.client_answers (
  client_id uuid primary key references customer.clients(id) on delete cascade,
  tenant_id uuid not null,
  answers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index client_answers_answers_idx on customer.client_answers using gin (answers jsonb_path_ops);
comment on table customer.client_answers is 'Migration 0454: each customer''s current answer per field key (highest-ranked source, then newest), for the customer table.';
alter table customer.client_answers enable row level security;
revoke all on customer.client_answers from public, anon, authenticated;
grant all on customer.client_answers to service_role;

-- A date written as 2026-11-28 (or a timestamp); null for anything else.
create function customer.try_date(p text) returns date
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return left(p, 10)::date;
exception when others then return null;
end $$;

create function customer.try_number(p text) returns numeric
language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(p, '')) ~ '^-?\d{1,15}(\.\d{1,6})?$' then btrim(p)::numeric end;
$$;

-- How an answer field is read (keys are checked by the catalogue's key rule).
create function customer.answer_expr(p_key text, p_type text) returns text
language sql immutable set search_path = '' as $$
  select case p_type
    when 'date' then format('customer.try_date(a.answers ->> %L)', p_key)
    when 'number' then format('customer.try_number(a.answers ->> %L)', p_key)
    else format('(a.answers ->> %L)', p_key) end;
$$;

-- ---------------------------------------------------------------------------
-- 1. The catalogue
-- ---------------------------------------------------------------------------
insert into customer.field_catalog (key, label, card, data_type, kind, expr, sort_order, sortable) values
  ('client_code', 'Customer code', 'Customer', 'text', 'column', 'c.client_code', 1, true),
  ('name', 'Name', 'Customer', 'text', 'column', 'c.primary_name', 2, true),
  ('phone', 'Phone', 'Customer', 'text', 'computed', '(select ph.phone from customer.client_phones ph where ph.client_id = c.id and ph.kind = ''primary'' limit 1)', 3, false),
  ('other_phones', 'Other numbers', 'Customer', 'list', 'computed', 'array(select ph.phone from customer.client_phones ph where ph.client_id = c.id and ph.kind <> ''primary'' order by ph.first_seen_at)', 4, false),
  ('other_names', 'Other names', 'Customer', 'list', 'computed', 'array(select n.name from customer.client_names n where n.client_id = c.id and n.name_key is distinct from customer.name_key(c.primary_name) order by n.last_seen_at desc)', 5, false),
  ('segment', 'Client or lead', 'Customer', 'text', 'computed', 'case when c.segment = ''buyer'' then ''Client'' else ''Lead'' end', 6, true),
  ('lifecycle_stage', 'Stage', 'Customer', 'text', 'computed', 'case c.lifecycle_stage when ''lead'' then ''New lead'' when ''engaged'' then ''Spoken to'' when ''visited'' then ''Visited'' end', 7, true),
  ('franchise', 'Franchise', 'Customer', 'text', 'computed', '(select f.name from public.franchise_groups f where f.id = c.franchise_group_id)', 8, true),
  ('household_code', 'Family code', 'Customer', 'text', 'computed', '(select h.household_code from customer.households h where h.id = c.household_id)', 9, true),
  ('data_problems', 'Data problems', 'Customer', 'list', 'column', 'c.data_problems', 10, false),
  ('first_source', 'First source', 'Customer', 'text', 'computed', 'coalesce(c.first_origin, (select s.label from customer.sources s where s.source = c.first_source), c.first_source)', 11, true),
  ('first_seen_at', 'First seen', 'Customer', 'datetime', 'column', 'c.first_seen_at', 12, true),
  ('do_not_call', 'Do not call', 'Customer', 'boolean', 'column', 'c.do_not_call', 13, true),
  ('referred', 'Referred by someone', 'Customer', 'boolean', 'column', '(c.referred_by_client_id is not null)', 14, true),
  ('last_contacted_at', 'Last reached', 'Contact', 'datetime', 'column', 'c.last_contacted_at', 20, true),
  ('last_attempt_at', 'Last interaction', 'Contact', 'datetime', 'column', 'c.last_attempt_at', 21, true),
  ('interaction_count', 'Interactions', 'Contact', 'number', 'column', 'c.interaction_count', 22, true),
  ('successful_interaction_count', 'Interactions reached', 'Contact', 'number', 'column', 'c.successful_interaction_count', 23, true),
  ('next_follow_up_at', 'Next follow-up', 'Contact', 'datetime', 'computed', '(select min(fu.due_at) from customer.follow_ups fu where fu.client_id = c.id and fu.status = ''pending'')', 24, false),
  ('email', 'Email', 'Contact', 'text', 'column', 'c.email', 25, true),
  ('communication_preference', 'Prefers', 'Contact', 'text', 'column', 'c.communication_preference', 26, true),
  ('marketing_message', 'Marketing messages', 'Contact', 'text', 'column', 'c.marketing_message', 27, true),
  ('first_purchase_at', 'First purchase', 'Visits and purchases', 'datetime', 'column', 'c.first_purchase_at', 40, true),
  ('last_purchase_at', 'Last purchase', 'Visits and purchases', 'datetime', 'column', 'c.last_purchase_at', 41, true),
  ('gender', 'Gender', 'Personal', 'text', 'column', 'c.gender', 60, true),
  ('dob', 'Date of birth', 'Personal', 'date', 'column', 'c.dob', 61, true),
  ('anniversary', 'Anniversary', 'Personal', 'date', 'column', 'c.anniversary', 62, true),
  ('marital_status', 'Marital status', 'Personal', 'text', 'column', 'c.marital_status', 63, true),
  ('community', 'Community', 'Personal', 'text', 'column', 'c.community', 64, true),
  ('occupation', 'Occupation', 'Personal', 'text', 'column', 'c.occupation', 65, true),
  ('address', 'Address', 'Address', 'text', 'column', 'c.address', 80, true),
  ('city', 'City', 'Address', 'text', 'column', 'c.city', 81, true),
  ('state', 'State', 'Address', 'text', 'column', 'c.state', 82, true),
  ('country', 'Country', 'Address', 'text', 'column', 'c.country', 83, true),
  ('pincode', 'Pincode', 'Address', 'text', 'column', 'c.pincode', 84, true),
  ('beverage', 'Beverage', 'Hospitality', 'text', 'column', 'c.beverage', 240, true),
  ('sugar', 'Sugar', 'Hospitality', 'text', 'column', 'c.sugar', 241, true),
  ('snack', 'Snack', 'Hospitality', 'text', 'column', 'c.snack', 242, true);

-- Answers named on the customer page; their expression reads client_answers.
insert into customer.field_catalog (key, label, card, data_type, kind, expr, sort_order)
select key, label, card, data_type, kind, customer.answer_expr(key, data_type), sort_order from (values
  ('wedding_month', 'Wedding month', 'Personal', 'text', 'answer', 301),
  ('wedding_year', 'Wedding year', 'Personal', 'text', 'answer', 302),
  ('client_category', 'Ticket size', 'Store and sales', 'text', 'answer', 303),
  ('store', 'Store', 'Store and sales', 'text', 'answer', 304),
  ('salesperson', 'Salesperson', 'Store and sales', 'text', 'answer', 305),
  ('lead_source', 'How they came', 'Store and sales', 'text', 'answer', 306),
  ('first_interaction_source', 'First contact through', 'Store and sales', 'text', 'answer', 307),
  ('buyer_status', 'Buyer status (as written)', 'Store and sales', 'text', 'answer', 308),
  ('first_purchase_date', 'First purchase (sheet)', 'Store and sales', 'date', 'answer', 309),
  ('recent_purchase_date', 'Latest purchase (sheet)', 'Store and sales', 'date', 'answer', 310),
  ('last_interaction_date', 'Last interaction (sheet)', 'Store and sales', 'date', 'answer', 311),
  ('client_bought_any_product', 'Bought any product', 'Store and sales', 'text', 'answer', 312),
  ('not_bought_reasons', 'Why not bought', 'Store and sales', 'text', 'answer', 313),
  ('seen_categories', 'Seen categories', 'Product interests', 'text', 'answer', 314),
  ('bought_categories', 'Bought categories', 'Product interests', 'text', 'answer', 315),
  ('seen_tags', 'Seen tags', 'Product interests', 'text', 'answer', 316),
  ('bought_tags', 'Bought tags', 'Product interests', 'text', 'answer', 317),
  ('gift_given', 'Gift given', 'Hospitality', 'text', 'answer', 318),
  ('google_review', 'Google review', 'Feedback and reviews', 'text', 'answer', 319),
  ('testimonial', 'Testimonial', 'Feedback and reviews', 'text', 'answer', 320),
  ('feedback', 'Feedback', 'Feedback and reviews', 'text', 'answer', 321),
  ('thank_you_note', 'Thank-you note', 'Feedback and reviews', 'text', 'answer', 322),
  ('referrals_given', 'Referrals given', 'Feedback and reviews', 'text', 'answer', 323),
  ('do_not_contact_reason', 'Do not contact, why', 'Calling', 'text', 'answer', 324),
  ('do_not_contact_date', 'Do not contact since', 'Calling', 'date', 'answer', 325),
  ('do_not_contact_noted_by', 'Do not contact, noted by', 'Calling', 'text', 'answer', 326),
  ('wrong_number_reason', 'Wrong number, why', 'Calling', 'text', 'answer', 327),
  ('wrong_number_call_status', 'Wrong number, call status', 'Calling', 'text', 'answer', 328),
  ('wrong_number_remark', 'Wrong number, remark', 'Calling', 'text', 'answer', 329),
  ('wrong_number_date', 'Wrong number, noted on', 'Calling', 'date', 'answer', 330),
  ('data_status', 'Data status', 'Data checks', 'text', 'answer', 331),
  ('contact_type', 'Script status', 'Data checks', 'text', 'answer', 332)) v(key, label, card, data_type, kind, sort_order)
on conflict (key) do nothing;

-- Every other answer key seen in the data is offered too, under "Other details".
create function customer.discover_answer_fields() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_added integer;
begin
  insert into customer.field_catalog (key, label, card, data_type, kind, expr, sort_order)
  select k.field_key,
         initcap(replace(k.field_key, '_', ' ')),
         'Other details',
         case when k.field_key ~ '_date$' then 'date' else 'text' end,
         'answer',
         customer.answer_expr(k.field_key, case when k.field_key ~ '_date$' then 'date' else 'text' end),
         2000
    from (select distinct field_key from customer.client_field_values) k
   where k.field_key ~ '^[a-z][a-z0-9_]{0,62}$'
     and not exists (select 1 from customer.field_catalog f where f.key = k.field_key)
  on conflict (key) do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Current answers per customer
-- ---------------------------------------------------------------------------
create function customer.refresh_client_answers(p_client_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into customer.client_answers (client_id, tenant_id, answers, updated_at)
  select c.id, c.tenant_id, coalesce((
           select jsonb_object_agg(w.field_key, w.value) from (
             select distinct on (v.field_key) v.field_key, v.value
               from customer.client_field_values v join customer.sources s on s.source = v.source
              where v.client_id = c.id
              order by v.field_key, s.source_rank desc, v.observed_at desc, v.created_at desc, v.id) w), '{}'::jsonb), now()
    from customer.clients c where c.id = p_client_id
  on conflict (client_id) do update set answers = excluded.answers, updated_at = now()
   where customer.client_answers.answers is distinct from excluded.answers;
$$;

-- Everyone at once (the first fill and the nightly rebuild).
create function customer.rebuild_client_answers() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  insert into customer.client_answers (client_id, tenant_id, answers, updated_at)
  select w.client_id, (array_agg(w.tenant_id))[1], jsonb_object_agg(w.field_key, w.value), now()
    from (select distinct on (v.client_id, v.field_key) v.client_id, v.tenant_id, v.field_key, v.value
            from customer.client_field_values v join customer.sources s on s.source = v.source
           order by v.client_id, v.field_key, s.source_rank desc, v.observed_at desc, v.created_at desc, v.id) w
    join customer.clients c on c.id = w.client_id and c.merged_into_client_id is null
   group by w.client_id
  on conflict (client_id) do update set answers = excluded.answers, updated_at = now()
   where customer.client_answers.answers is distinct from excluded.answers;
  get diagnostics v_rows = row_count;
  -- Customers whose last answer went away.
  update customer.client_answers a set answers = '{}'::jsonb, updated_at = now()
   where a.answers <> '{}'::jsonb and not exists (select 1 from customer.client_field_values v where v.client_id = a.client_id);
  perform customer.discover_answer_fields();
  return v_rows;
end $$;

create function public.customer_rebuild_table() returns integer
language sql security definer set search_path = '' as $$ select customer.rebuild_client_answers(); $$;
revoke all on function public.customer_rebuild_table() from public, anon, authenticated;
grant execute on function public.customer_rebuild_table() to service_role;

create function customer._patch_0454(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0454: expected % match(es) of "%" in %, found %', p_expected, left(p_old, 80), p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

select customer._patch_0454('customer.refresh_client_stats(uuid)'::regprocedure,
  $o$  -- After the segment: a buyer is not a bad number (migration 0451).$o$,
  $n$  perform customer.refresh_client_answers(p_client_id);
  -- After the segment: a buyer is not a bad number (migration 0451).$n$, 1);
drop function customer._patch_0454(regprocedure, text, text, integer);

-- ---------------------------------------------------------------------------
-- 3. The filter: a tree of groups and conditions, checked against the catalogue
-- ---------------------------------------------------------------------------
-- group:     {"match": "all"|"any", "items": [condition or group, ...]}
-- condition: {"field": key, "op": operator, "value": ...}
--   text:     is_any_of [..], is_none_of [..], contains "x", not_contains "x", is_empty, is_not_empty
--   number:   eq, gt, gte, lt, lte (number), between [a, b], is_empty, is_not_empty
--   date, datetime: on, before, after (YYYY-MM-DD), between [a, b], in_last_days n,
--             more_than_days_ago n, in_next_days n, is_empty, is_not_empty
--   boolean:  is_true, is_false
--   list:     has_any_of [..], has_none_of [..], contains "x", is_empty, is_not_empty
create function customer.table_condition(p_node jsonb, p_depth integer default 0) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  f customer.field_catalog; v_op text; v_val jsonb; v_e text; v_parts text[] := '{}'; v_item jsonb; v_text text[]; v_part text; v_like text;
begin
  if p_depth > 4 then raise exception 'Filter is nested too deeply' using errcode = '22023'; end if;
  if jsonb_typeof(p_node) is distinct from 'object' then raise exception 'Filter is not readable' using errcode = '22023'; end if;
  if p_node ? 'items' then
    if jsonb_typeof(p_node -> 'items') <> 'array' or jsonb_array_length(p_node -> 'items') > 50 then
      raise exception 'A filter group holds up to 50 conditions' using errcode = '22023';
    end if;
    for v_item in select x from jsonb_array_elements(p_node -> 'items') x loop
      v_part := customer.table_condition(v_item, p_depth + 1);
      if v_part is not null then v_parts := v_parts || ('(' || v_part || ')'); end if;
    end loop;
    if cardinality(v_parts) = 0 then return null; end if;
    return array_to_string(v_parts, case when p_node ->> 'match' = 'any' then ' or ' else ' and ' end);
  end if;

  select * into f from customer.field_catalog where key = p_node ->> 'field' and filterable;
  if f.key is null then raise exception 'Unknown field %', coalesce(p_node ->> 'field', '') using errcode = '22023'; end if;
  v_op := coalesce(p_node ->> 'op', '');
  v_val := p_node -> 'value';
  v_e := f.expr;
  if v_op = 'is_empty' then
    return case when f.data_type = 'list' then format('coalesce(cardinality(%s), 0) = 0', v_e)
                when f.data_type = 'text' then format('nullif(btrim(%s), '''') is null', v_e)
                else format('%s is null', v_e) end;
  elsif v_op = 'is_not_empty' then
    return case when f.data_type = 'list' then format('coalesce(cardinality(%s), 0) > 0', v_e)
                when f.data_type = 'text' then format('nullif(btrim(%s), '''') is not null', v_e)
                else format('%s is not null', v_e) end;
  end if;

  if (f.data_type = 'text' and v_op in ('is_any_of', 'is_none_of')) or (f.data_type = 'list' and v_op in ('has_any_of', 'has_none_of')) then
    if jsonb_typeof(v_val) is distinct from 'array' or jsonb_array_length(v_val) = 0 or jsonb_array_length(v_val) > 500 then
      raise exception 'Choose 1 to 500 values' using errcode = '22023';
    end if;
    select array_agg(lower(btrim(x))) into v_text from jsonb_array_elements_text(v_val) x;
    return case v_op
      when 'is_any_of' then format('lower(btrim(%s)) = any (%L::text[])', v_e, v_text)
      when 'is_none_of' then format('(%s is null or lower(btrim(%s)) <> all (%L::text[]))', v_e, v_e, v_text)
      when 'has_any_of' then format('exists (select 1 from unnest(%s) z where lower(btrim(z)) = any (%L::text[]))', v_e, v_text)
      else format('not exists (select 1 from unnest(%s) z where lower(btrim(z)) = any (%L::text[]))', v_e, v_text) end;
  end if;
  if f.data_type in ('text', 'list') and v_op in ('contains', 'not_contains') then
    if jsonb_typeof(v_val) is distinct from 'string' or length(btrim(v_val #>> '{}')) = 0 then raise exception 'Type the text to look for' using errcode = '22023'; end if;
    v_like := '%' || replace(replace(replace(btrim(v_val #>> '{}'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_part := case when f.data_type = 'list' then format('exists (select 1 from unnest(%s) z where z ilike %L)', v_e, v_like)
                   else format('coalesce(%s ilike %L, false)', v_e, v_like) end;
    return case when v_op = 'contains' then v_part else format('not %s', v_part) end;
  end if;
  if f.data_type = 'number' and v_op in ('eq', 'gt', 'gte', 'lt', 'lte', 'between') then
    if v_op = 'between' then
      if jsonb_typeof(v_val) is distinct from 'array' or jsonb_array_length(v_val) <> 2 or customer.try_number(v_val ->> 0) is null or customer.try_number(v_val ->> 1) is null then
        raise exception 'Give two numbers' using errcode = '22023';
      end if;
      return format('%s between %s and %s', v_e, customer.try_number(v_val ->> 0), customer.try_number(v_val ->> 1));
    end if;
    if customer.try_number(v_val #>> '{}') is null then raise exception 'Give a number' using errcode = '22023'; end if;
    return format('%s %s %s', v_e, case v_op when 'eq' then '=' when 'gt' then '>' when 'gte' then '>=' when 'lt' then '<' else '<=' end,
                  customer.try_number(v_val #>> '{}'));
  end if;
  if f.data_type in ('date', 'datetime') and v_op in ('on', 'before', 'after', 'between', 'in_last_days', 'more_than_days_ago', 'in_next_days') then
    -- Dates compare as calendar days in India.
    if f.data_type = 'datetime' then v_e := format('((%s) at time zone ''Asia/Kolkata'')::date', v_e); end if;
    if v_op in ('on', 'before', 'after') then
      if customer.try_date(v_val #>> '{}') is null then raise exception 'Give a date as YYYY-MM-DD' using errcode = '22023'; end if;
      return format('%s %s %L::date', v_e, case v_op when 'on' then '=' when 'before' then '<' else '>' end, customer.try_date(v_val #>> '{}'));
    elsif v_op = 'between' then
      if jsonb_typeof(v_val) is distinct from 'array' or jsonb_array_length(v_val) <> 2 or customer.try_date(v_val ->> 0) is null or customer.try_date(v_val ->> 1) is null then
        raise exception 'Give two dates as YYYY-MM-DD' using errcode = '22023';
      end if;
      return format('%s between %L::date and %L::date', v_e, customer.try_date(v_val ->> 0), customer.try_date(v_val ->> 1));
    end if;
    if coalesce(v_val #>> '{}', '') !~ '^\d{1,5}$' then raise exception 'Give a number of days' using errcode = '22023'; end if;
    return case v_op
      when 'in_last_days' then format('%s between (now() at time zone ''Asia/Kolkata'')::date - %s and (now() at time zone ''Asia/Kolkata'')::date', v_e, (v_val #>> '{}')::integer)
      when 'more_than_days_ago' then format('%s < (now() at time zone ''Asia/Kolkata'')::date - %s', v_e, (v_val #>> '{}')::integer)
      else format('%s between (now() at time zone ''Asia/Kolkata'')::date and (now() at time zone ''Asia/Kolkata'')::date + %s', v_e, (v_val #>> '{}')::integer) end;
  end if;
  if f.data_type = 'boolean' and v_op in ('is_true', 'is_false') then
    return format('coalesce(%s, false) = %s', v_e, v_op = 'is_true');
  end if;
  raise exception 'The filter "%" does not work on %', v_op, f.label using errcode = '22023';
end $$;

-- Whether a filter tree has a condition on a field.
create function customer.filter_mentions(p_node jsonb, p_field text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_path_exists(p_node, '$.** ? (@.field == $f)', jsonb_build_object('f', p_field)), false);
$$;

-- ---------------------------------------------------------------------------
-- 4. The readers
-- ---------------------------------------------------------------------------
create function public.customer_table_fields() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then raise exception 'Section access denied' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'card', card, 'type', data_type,
                                                       'filterable', filterable, 'sortable', sortable) order by sort_order, label)
                     from customer.field_catalog), '[]'::jsonb);
end $$;

-- p_request: {"columns": [keys], "filter": group, "sort": [{"field": key, "dir": "asc"|"desc"}],
--             "franchise": "" | "all" | id, "q": search text, "include_data_problems": bool,
--             "limit": 1..200, "offset": n}
create function public.customer_table(p_request jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb := coalesce(p_request, '{}'::jsonb);
  v_tenant uuid; v_view uuid[]; v_where text; v_filter text; v_order text := ''; v_cols text[]; v_select text := '';
  v_limit integer; v_offset integer;
  v_q text := btrim(coalesce(r ->> 'q', '')); v_phone text; v_key text;
  f customer.field_catalog; s jsonb; v_total bigint; v_rows jsonb;
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then raise exception 'Section access denied' using errcode = '42501'; end if;
  v_limit := least(greatest(coalesce(customer.try_number(r ->> 'limit')::integer, 50), 1), 200);
  v_offset := greatest(coalesce(customer.try_number(r ->> 'offset')::integer, 0), 0);
  v_tenant := public.current_tenant_id();
  v_view := customer.franchises_in_view(r ->> 'franchise');

  v_where := format('c.tenant_id = %L and c.archived_at is null and c.merged_into_client_id is null', v_tenant);
  if v_view is not null then v_where := v_where || format(' and c.franchise_group_id = any (%L::uuid[])', v_view); end if;
  if v_q <> '' then
    if v_q ~ '^[+0-9 ()-]+$' then v_phone := customer.normalize_phone(v_q); end if;
    v_key := customer.name_key(v_q);
    v_where := v_where || format(' and (c.client_code = %L or exists (select 1 from customer.client_phones p where p.client_id = c.id and p.phone = %L)'
      || ' or exists (select 1 from customer.client_names n where n.client_id = c.id and n.name_key like %L))',
      upper(v_q), coalesce(v_phone, '-'), case when v_phone is null and length(coalesce(v_key, '')) >= 2 then v_key || '%' else '-' end);
  end if;
  if jsonb_typeof(r -> 'filter') = 'object' then v_filter := customer.table_condition(r -> 'filter'); end if;
  if v_filter is not null then v_where := v_where || ' and (' || v_filter || ')'; end if;
  -- Bad data stays out unless asked about or searched for (migrations 0451, 0452).
  if not coalesce((r ->> 'include_data_problems')::boolean, false) and not customer.filter_mentions(r -> 'filter', 'data_problems') and v_q = '' then
    v_where := v_where || ' and (c.data_problems = ''{}'' or c.data_review = ''main'')';
  end if;

  if jsonb_typeof(r -> 'sort') = 'array' then
    for s in select x from jsonb_array_elements(r -> 'sort') x limit 3 loop
      select * into f from customer.field_catalog where key = s ->> 'field' and sortable;
      if f.key is null then raise exception 'Cannot sort by %', coalesce(s ->> 'field', '') using errcode = '22023'; end if;
      v_order := v_order || case when f.data_type = 'text' then format('lower(%s)', f.expr) else f.expr end
                 || case when s ->> 'dir' = 'desc' then ' desc nulls last, ' else ' asc nulls last, ' end;
    end loop;
  end if;
  v_order := v_order || 'c.client_code';

  if jsonb_typeof(r -> 'columns') = 'array' then
    select array_agg(x) into v_cols from (select x from jsonb_array_elements_text(r -> 'columns') x limit 60) t;
  end if;
  v_cols := coalesce(v_cols, array['name', 'phone', 'segment', 'city', 'last_attempt_at']);
  for f in select fc.* from customer.field_catalog fc join unnest(v_cols) with ordinality u(k, n) on u.k = fc.key order by u.n loop
    v_select := v_select || format('%L, %s, ', f.key, f.expr);
  end loop;
  if v_select = '' then raise exception 'Choose at least one column' using errcode = '22023'; end if;

  execute format('select count(*) from customer.clients c left join customer.client_answers a on a.client_id = c.id where %s', v_where) into v_total;
  execute format(
    'select coalesce(jsonb_agg(t.row order by t.n), ''[]''::jsonb) from ('
    || ' select p.n, jsonb_build_object(''client_code'', c.client_code, ''values'', jsonb_build_object(%s)) as row'
    || ' from (select c.id, row_number() over (order by %s) as n from customer.clients c left join customer.client_answers a on a.client_id = c.id'
    || '        where %s order by %s limit %s offset %s) p'
    || ' join customer.clients c on c.id = p.id left join customer.client_answers a on a.client_id = c.id) t',
    left(v_select, length(v_select) - 2), v_order, v_where, v_order, v_limit, v_offset) into v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows, 'offset', v_offset, 'limit', v_limit);
end $$;

create function public.customer_table_values(p_field text, p_q text default null, p_franchise text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid; v_view uuid[]; f customer.field_catalog; v_rows jsonb; v_where text; v_q text := btrim(coalesce(p_q, ''));
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('crm.view') then raise exception 'Section access denied' using errcode = '42501'; end if;
  select * into f from customer.field_catalog where key = p_field and data_type in ('text', 'list');
  if f.key is null then raise exception 'This field has no list of values' using errcode = '22023'; end if;
  v_tenant := public.current_tenant_id();
  v_view := customer.franchises_in_view(p_franchise);
  v_where := format('c.tenant_id = %L and c.archived_at is null and c.merged_into_client_id is null', v_tenant);
  if v_view is not null then v_where := v_where || format(' and c.franchise_group_id = any (%L::uuid[])', v_view); end if;
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''value'', v, ''count'', n) order by n desc, v), ''[]''::jsonb) from ('
    || ' select v, count(*) n from (select %s from customer.clients c left join customer.client_answers a on a.client_id = c.id where %s) x(v)'
    || ' where nullif(btrim(v), '''') is not null and (%L = '''' or v ilike %L) group by v order by count(*) desc, v limit 300) t',
    case when f.data_type = 'list' then format('unnest(%s)', f.expr) else f.expr end, v_where, v_q, '%' || v_q || '%') into v_rows;
  return v_rows;
end $$;

revoke all on function customer.try_date(text) from public, anon, authenticated;
revoke all on function customer.try_number(text) from public, anon, authenticated;
revoke all on function customer.answer_expr(text, text) from public, anon, authenticated;
revoke all on function customer.discover_answer_fields() from public, anon, authenticated;
revoke all on function customer.refresh_client_answers(uuid) from public, anon, authenticated;
revoke all on function customer.rebuild_client_answers() from public, anon, authenticated;
revoke all on function customer.table_condition(jsonb, integer) from public, anon, authenticated;
revoke all on function customer.filter_mentions(jsonb, text) from public, anon, authenticated;
revoke all on function public.customer_table_fields() from public, anon;
revoke all on function public.customer_table(jsonb) from public, anon;
revoke all on function public.customer_table_values(text, text, text) from public, anon;
grant execute on function public.customer_table_fields() to authenticated;
grant execute on function public.customer_table(jsonb) to authenticated;
grant execute on function public.customer_table_values(text, text, text) to authenticated;

-- First fill (up to 20 minutes), then nightly.
set statement_timeout = '20min';
select customer.rebuild_client_answers();
reset statement_timeout;
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('customer-table-rebuild', '35 22 * * *', 'select public.customer_rebuild_table();');
  end if;
end $$;
