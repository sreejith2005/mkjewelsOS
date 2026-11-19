-- 0433: customer master database - Mumbai and Ahmedabad kept apart.
--
-- Owner, 2026-11-19: MK Jewels has two franchises, Mumbai (three stores) and
-- Ahmedabad (two). Their customers are kept separate, like tasks, forms and
-- FMS: someone in one franchise sees only that franchise's customers; the
-- same source (walk-in, referrals, ...) exists for each franchise and is never
-- merged across them; only people with company-wide authority can choose to
-- see both together. This replaces the 2026-11-06 decision that CRM customer
-- data is shared by every city (docs/architecture/franchise-scope.md).
--
-- Ownership
--   * Every customer belongs to one franchise (clients.franchise_group_id).
--     Every sheet belongs to one franchise (source_tables.franchise_code);
--     what an import creates belongs to the sheet's franchise.
--   * Phone numbers and sheet ids are unique within a franchise only: the same
--     number in Mumbai and in Ahmedabad is two customers, with separate
--     profiles and timelines. An import matches only inside its franchise.
--     Customers of different franchises are never merged.
--   * Everything imported before today belongs to Mumbai (all of it came from
--     Mumbai sheets).
--
-- Reading (every customer read: list, filters, search, customer page,
-- timeline, interaction page, calls by staff)
--   * Company-wide authority (Super Admin, Admin without Director grants;
--     org_has_company_scope): every franchise. The list opens on the person's
--     own franchise and can switch to another franchise or to all.
--   * Everyone else (Directors included): only the franchises of the stores
--     they may read (org_scope_branch_ids: own store, managed stores, HR's
--     franchise, Director grants). Nothing else, whatever the request asks.
--   * Work without a signed-in person (cron, service role) is unaffected.

-- ---------------------------------------------------------------------------
-- 1. Ownership columns
-- ---------------------------------------------------------------------------
-- The franchise an import is working for; set per source by customer_ingest_apply.
create function customer.current_import_franchise()
returns uuid language sql stable set search_path = '' as $$
  select nullif(current_setting('customer.current_franchise', true), '')::uuid;
$$;
-- In an import, identity lookups see only that franchise.
create function customer.same_franchise(p_franchise_group_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select customer.current_import_franchise() is null or p_franchise_group_id is not distinct from customer.current_import_franchise();
$$;

alter table customer.clients add column franchise_group_id uuid default customer.current_import_franchise();
alter table customer.clients add constraint clients_franchise_fk
  foreign key (tenant_id, franchise_group_id) references public.franchise_groups (tenant_id, id) on delete restrict;
create index clients_franchise_idx on customer.clients (tenant_id, franchise_group_id) where archived_at is null;

alter table customer.client_phones add column franchise_group_id uuid;
alter table customer.client_identifiers add column franchise_group_id uuid;

alter table customer.source_tables add column franchise_code text;
comment on column customer.source_tables.franchise_code is 'The franchise (franchise_groups.code) whose sheet this is; what it imports belongs to that franchise.';

-- Everything so far is Mumbai's.
do $$
declare v_code text;
begin
  select code into v_code from public.franchise_groups where lower(btrim(name)) = 'mumbai' order by created_at limit 1;
  if v_code is not null then
    update customer.source_tables set franchise_code = v_code where franchise_code is null;
    update customer.clients c set franchise_group_id = f.id
      from public.franchise_groups f where f.tenant_id = c.tenant_id and f.code = v_code and c.franchise_group_id is null;
  end if;
end $$;
update customer.client_phones p set franchise_group_id = c.franchise_group_id from customer.clients c where c.id = p.client_id;
update customer.client_identifiers i set franchise_group_id = c.franchise_group_id from customer.clients c where c.id = i.client_id;

-- A phone or id always carries its customer's franchise.
create function customer.take_client_franchise()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.franchise_group_id := (select c.franchise_group_id from customer.clients c where c.id = new.client_id);
  return new;
end $$;
create trigger client_phones_franchise before insert or update of client_id on customer.client_phones
  for each row execute function customer.take_client_franchise();
create trigger client_identifiers_franchise before insert or update of client_id on customer.client_identifiers
  for each row execute function customer.take_client_franchise();

-- A number is unique within a franchise.
alter table customer.client_phones drop constraint client_phones_tenant_id_phone_key;
alter table customer.client_phones add constraint client_phones_franchise_phone_key unique nulls not distinct (tenant_id, franchise_group_id, phone);
drop index customer.client_identifiers_lookup_idx;
create index client_identifiers_lookup_idx on customer.client_identifiers (tenant_id, id_type, value, franchise_group_id);

-- ---------------------------------------------------------------------------
-- 2. Imports work inside their sheet's franchise
-- ---------------------------------------------------------------------------
create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0433: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- Every lookup of a customer by number or sheet id inside an import gains
-- "and customer.same_franchise(<table>.franchise_group_id)".
do $$
declare r record; body text; n1 integer; n2 integer;
begin
  for r in select * from (values
      ('customer.find_or_create_client(uuid,text,text,text,timestamp with time zone,text[],text,uuid,uuid)', 5),
      ('customer.resolve_client(uuid,text,text,text,timestamp with time zone,text,text,text,uuid)', 3),
      ('customer.apply_runo_row(uuid)', 2),
      ('customer.apply_master_sheet_row(uuid)', 1),
      ('customer.apply_walkin_family_row(uuid)', 2),
      ('customer.link_sheet_family(uuid,text)', 2)) as t(fn, expected)
  loop
    body := replace(pg_get_functiondef(r.fn::regprocedure), E'\r', '');
    n1 := regexp_count(body, '(\m[a-z]+)\.tenant_id = (v_tenant|p_tenant_id) and \1\.(phone|id_type) ');
    n2 := regexp_count(body, '(where|and) tenant_id = (v_tenant|p_tenant_id) and phone = ');
    if n1 + n2 <> r.expected then
      raise exception '0433: expected % lookup(s) in %, found %', r.expected, r.fn, n1 + n2;
    end if;
    body := regexp_replace(body, '(\m[a-z]+)\.tenant_id = (v_tenant|p_tenant_id) and \1\.(phone|id_type) ',
                           '\1.tenant_id = \2 and customer.same_franchise(\1.franchise_group_id) and \1.\3 ', 'g');
    body := regexp_replace(body, '(where|and) tenant_id = (v_tenant|p_tenant_id) and phone = ',
                           '\1 tenant_id = \2 and customer.same_franchise(franchise_group_id) and phone = ', 'g');
    execute body;
  end loop;
end $$;

select customer._patch('customer.find_or_create_client(uuid,text,text,text,timestamp with time zone,text[],text,uuid,uuid)'::regprocedure,
  'on conflict (tenant_id, phone) do nothing', 'on conflict (tenant_id, franchise_group_id, phone) do nothing', 1);

-- Each source applies inside its franchise.
select customer._patch('public.customer_ingest_apply(text,integer)'::regprocedure,
$old$  if v_importer is null then
    raise exception 'No importer for source %', p_source using errcode = '22023';
  end if;
$old$,
$new$  if v_importer is null then
    raise exception 'No importer for source %', p_source using errcode = '22023';
  end if;
  -- Everything this source creates or matches belongs to its franchise.
  perform set_config('customer.current_franchise', '', true);
  if (select franchise_code from customer.source_tables where source = p_source) is not null then
    perform set_config('customer.current_franchise', coalesce((
      select f.id::text from customer.source_tables s join public.franchise_groups f on f.tenant_id = v_tenant and f.code = s.franchise_code
       where s.source = p_source), 'missing'), true);
    if current_setting('customer.current_franchise', true) = 'missing' then
      raise exception 'Franchise % of source % not found', (select franchise_code from customer.source_tables where source = p_source), p_source using errcode = '22023';
    end if;
  end if;
$new$, 1);

-- Customers of different franchises are never merged.
select customer._patch('customer.merge_clients(uuid,uuid,text,uuid)'::regprocedure,
$old$  if v_keep.archived_at is not null or v_remove.archived_at is not null then$old$,
$new$  if v_keep.franchise_group_id is distinct from v_remove.franchise_group_id then
    raise exception 'Customers of different franchises are kept apart' using errcode = '22023';
  end if;
  if v_keep.archived_at is not null or v_remove.archived_at is not null then$new$, 1);

-- ---------------------------------------------------------------------------
-- 3. Who sees which franchise
-- ---------------------------------------------------------------------------
-- The franchises the signed-in person may read; null means every franchise
-- (company-wide authority, or no signed-in person).
create function customer.readable_franchise_ids()
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  select p.id into v_actor from public.current_profile() p;
  if v_actor is null or public.org_has_company_scope(v_actor) then return null; end if;
  return coalesce((select array_agg(distinct b.franchise_group_id) from public.branches b
                    where b.id = any (public.org_scope_branch_ids(v_actor, false)) and b.franchise_group_id is not null), '{}'::uuid[]);
end $$;

create function customer.franchise_visible(p_franchise_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select customer.readable_franchise_ids() is null or p_franchise_group_id = any (customer.readable_franchise_ids());
$$;

-- The franchises a list shows. p_choice: 'all', a franchise id, or empty for
-- the default - the person's own store's franchise when they may read more
-- than one, else everything they may read. Never wider than readable.
create function customer.franchises_in_view(p_choice text)
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare v_readable uuid[] := customer.readable_franchise_ids(); v_home uuid; v_choice uuid;
begin
  if p_choice = 'all' then return v_readable; end if;
  if p_choice ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_choice := p_choice::uuid;
    if v_readable is null or v_choice = any (v_readable) then return array[v_choice]; end if;
    return v_readable;
  end if;
  select b.franchise_group_id into v_home from public.current_profile() p join public.branches b on b.id = p.branch_id;
  if v_home is not null and (v_readable is null or v_home = any (v_readable)) then return array[v_home]; end if;
  return v_readable;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Every customer read applies it
-- ---------------------------------------------------------------------------
select customer._patch('public.customer_list(jsonb,integer,integer)'::regprocedure,
  E'  v_total bigint; v_rows jsonb;\nbegin', E'  v_total bigint; v_rows jsonb; v_view uuid[];\nbegin', 1);
select customer._patch('public.customer_list(jsonb,integer,integer)'::regprocedure,
  E'  v_tenant := public.current_tenant_id();\n', E'  v_tenant := public.current_tenant_id();\n  v_view := customer.franchises_in_view(f ->> ''franchise'');\n', 1);
select customer._patch('public.customer_list(jsonb,integer,integer)'::regprocedure,
  E'     where c.tenant_id = v_tenant and c.archived_at is null\n       and (v_ids is null or c.id = any (v_ids))',
  E'     where c.tenant_id = v_tenant and c.archived_at is null\n       and (v_view is null or c.franchise_group_id = any (v_view))\n       and (v_ids is null or c.id = any (v_ids))', 1);
select customer._patch('public.customer_list(jsonb,integer,integer)'::regprocedure,
  E'           ''place'', customer.client_place(',
  E'           ''franchise'', (select fg.name from public.franchise_groups fg where fg.id = p.franchise_group_id),\n           ''place'', customer.client_place(', 1);

-- The filter counts follow the franchise chosen in the list.
do $$
declare body text; n integer;
begin
  body := replace(pg_get_functiondef('public.customer_list_filters()'::regprocedure), E'\r', '');
  body := replace(body, 'public.customer_list_filters()', 'public.customer_list_filters(p_franchise text DEFAULT NULL::text)');
  body := replace(body, E'declare v_tenant uuid;\nbegin', E'declare v_tenant uuid; v_view uuid[];\nbegin');
  body := replace(body, E'  v_tenant := public.current_tenant_id();\n', E'  v_tenant := public.current_tenant_id();\n  v_view := customer.franchises_in_view(p_franchise);\n');
  n := regexp_count(body, 'tenant_id = v_tenant and archived_at is null');
  if n <> 5 then raise exception '0433: expected 5 counts in customer_list_filters, found %', n; end if;
  body := replace(body, 'tenant_id = v_tenant and archived_at is null', 'tenant_id = v_tenant and archived_at is null and (v_view is null or franchise_group_id = any (v_view))');
  body := replace(body, E'  return jsonb_build_object(\n', E'  return jsonb_build_object(\n'
    || E'    ''franchise_view'', to_jsonb(v_view),\n'
    || E'    ''franchises'', (select coalesce(jsonb_agg(jsonb_build_object(''id'', fg.id, ''name'', fg.name) order by fg.name), ''[]''::jsonb)\n'
    || E'                     from public.franchise_groups fg where fg.tenant_id = v_tenant and fg.is_active and customer.franchise_visible(fg.id)),\n');
  if body !~ 'franchise_view' then raise exception '0433: customer_list_filters not patched'; end if;
  execute body;
end $$;
drop function public.customer_list_filters();
revoke all on function public.customer_list_filters(text) from public, anon;
grant execute on function public.customer_list_filters(text) to authenticated, service_role;

select customer._patch('public.customer_search(text,integer)'::regprocedure,
  E'   where c.archived_at is null\n   order by c.primary_name', E'   where c.archived_at is null and customer.franchise_visible(c.franchise_group_id)\n   order by c.primary_name', 1);
select customer._patch('public.customer_get_profile(uuid)'::regprocedure,
  E'  if v_client.id is null then raise exception ''Client not found'' using errcode = ''P0002''; end if;\n',
  E'  if v_client.id is null or not customer.franchise_visible(v_client.franchise_group_id) then raise exception ''Client not found'' using errcode = ''P0002''; end if;\n', 1);
select customer._patch('public.customer_get_profile(uuid)'::regprocedure,
  E'    ''client'', to_jsonb(v_client) - ''tenant_id'',\n',
  E'    ''client'', to_jsonb(v_client) - ''tenant_id'',\n    ''franchise'', (select fg.name from public.franchise_groups fg where fg.id = v_client.franchise_group_id),\n', 1);
select customer._patch('public.customer_get_timeline(uuid,integer,timestamp with time zone)'::regprocedure,
  'if not exists (select 1 from customer.clients where id = p_client_id and tenant_id = v_tenant) then',
  'if not exists (select 1 from customer.clients where id = p_client_id and tenant_id = v_tenant and customer.franchise_visible(franchise_group_id)) then', 1);
select customer._patch('public.customer_get_client_page(text)'::regprocedure,
  E'  if v_client.id is null then raise exception ''Client not found'' using errcode = ''P0002''; end if;\n',
  E'  if v_client.id is null or not customer.franchise_visible(v_client.franchise_group_id) then raise exception ''Client not found'' using errcode = ''P0002''; end if;\n', 1);
select customer._patch('public.customer_get_interaction_page(text)'::regprocedure,
  E'  if i.id is null then raise exception ''Interaction not found'' using errcode = ''P0002''; end if;\n',
  E'  if i.id is null or not customer.franchise_visible((select c.franchise_group_id from customer.clients c where c.id = i.client_id)) then\n    raise exception ''Interaction not found'' using errcode = ''P0002'';\n  end if;\n', 1);
select customer._patch('public.customer_calls_by_staff(date)'::regprocedure,
  E'   where i.tenant_id = v_tenant and i.archived_at is null and i.channel in (''call'', ''video_call'')\n',
  E'   where i.tenant_id = v_tenant and i.archived_at is null and i.channel in (''call'', ''video_call'')\n     and customer.franchise_visible((select c.franchise_group_id from customer.clients c where c.id = i.client_id))\n', 1);

drop function customer._patch(regprocedure, text, text, integer);

revoke all on function customer.current_import_franchise(), customer.same_franchise(uuid), customer.take_client_franchise(),
  customer.readable_franchise_ids(), customer.franchise_visible(uuid), customer.franchises_in_view(text) from public, anon, authenticated;
grant execute on function customer.current_import_franchise(), customer.same_franchise(uuid),
  customer.readable_franchise_ids(), customer.franchise_visible(uuid), customer.franchises_in_view(text) to service_role;
