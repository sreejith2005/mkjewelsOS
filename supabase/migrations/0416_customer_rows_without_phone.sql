-- 0416: no sheet row is left out for want of a phone number.
--
-- Owner, 2026-11-17: a row with no phone, or a phone that is not a valid
-- number, is still a customer. Keep it under its own client code; never match
-- it to anyone on that number; match it later when a real number arrives.
--
-- customer.resolve_client finds the customer for one sheet row, in order:
--   1. the row's phone, if it is a valid number (one phone is one customer);
--   2. else the row's billing phone, if valid;
--   3. else the row's Instagram ID, already seen on a customer;
--   4. else the customer made earlier for this same row (re-import);
--   5. else a new customer with no phone. The row is kept as the link
--      (identifier "sheet_row"), so the same row always finds the same
--      customer again.
-- What the row wrote in a phone cell that is not a valid number is kept on
-- the customer as an "unverified_phone", never used for matching.
--
-- The Runo and enquiry importers now use it. Rows rejected before for a
-- missing or invalid phone are applied again.

alter table customer.client_identifiers drop constraint client_identifiers_id_type_check;
alter table customer.client_identifiers add constraint client_identifiers_id_type_check
  check (id_type in ('instagram', 'email', 'runo_customer_id', 'sheet_client_id', 'sheet_family_id', 'software_customer_id', 'zoho_id',
                     'sheet_row', 'unverified_phone'));

create function customer.resolve_client(
  p_tenant_id uuid,
  p_phone text,
  p_name text,
  p_source text,
  p_observed_at timestamptz,
  p_billing_phone text default null,
  p_instagram text default null,
  p_row_ref text default null,
  p_source_row uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := customer.normalize_phone(p_phone);
  v_billing text := customer.normalize_phone(p_billing_phone);
  v_insta text := nullif(lower(regexp_replace(coalesce(p_instagram, ''), '^@+|\s+', '', 'g')), '');
  v_ref text := nullif(btrim(coalesce(p_row_ref, '')), '');
  v_at timestamptz := coalesce(p_observed_at, now());
  v_client uuid;
  v_household uuid;
  v_raw text;
begin
  if p_tenant_id is null then raise exception 'Tenant is required' using errcode = '22023'; end if;

  if v_phone is not null then
    v_client := customer.find_or_create_client(p_tenant_id, v_phone, p_name, p_source, v_at, '{}', p_billing_phone, null, p_source_row);
  elsif v_billing is not null then
    v_client := customer.find_or_create_client(p_tenant_id, v_billing, p_name, p_source, v_at, '{}', null, null, p_source_row);
  else
    if v_insta is not null then
      select i.client_id into v_client from customer.client_identifiers i join customer.clients c on c.id = i.client_id
       where i.tenant_id = p_tenant_id and i.id_type = 'instagram' and i.value = v_insta and c.merged_into_client_id is null
       order by i.first_seen_at, i.id limit 1;
    end if;
    if v_client is null and v_ref is not null then
      select coalesce(c.merged_into_client_id, c.id) into v_client from customer.client_identifiers i join customer.clients c on c.id = i.client_id
       where i.tenant_id = p_tenant_id and i.id_type = 'sheet_row' and i.value = v_ref
       order by i.first_seen_at, i.id limit 1;
    end if;
    if v_client is null then
      insert into customer.households (tenant_id) values (p_tenant_id) returning id into v_household;
      insert into customer.clients (tenant_id, household_id, primary_name, first_source, first_seen_at)
      values (p_tenant_id, v_household, customer.clean_name(p_name), p_source, v_at)
      returning id into v_client;
      update customer.households set main_client_id = v_client where id = v_household;
      insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, new_value)
      values (p_tenant_id, null, 'customer_client_created', 'customer', v_client,
              jsonb_build_object('source', p_source, 'source_row', p_source_row, 'without_phone', true));
    end if;
    perform customer.add_client_name(v_client, p_name, p_source, v_at);
  end if;

  if v_ref is not null and v_phone is null and v_billing is null then
    insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
    values (p_tenant_id, v_client, 'sheet_row', v_ref, p_source, v_at) on conflict do nothing;
  end if;
  if v_insta is not null then
    insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
    values (p_tenant_id, v_client, 'instagram', v_insta, p_source, v_at) on conflict do nothing;
  end if;
  foreach v_raw in array array[case when v_phone is null then p_phone end, case when v_billing is null then p_billing_phone end] loop
    v_raw := nullif(btrim(coalesce(v_raw, '')), '');
    if v_raw is not null and upper(v_raw) not in ('NA', 'N/A', '-', '.', 'NIL', '0') then
      insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
      values (p_tenant_id, v_client, 'unverified_phone', left(v_raw, 60), p_source, v_at) on conflict do nothing;
    end if;
  end loop;
  return v_client;
end $$;

create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0416: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

do $patches$
begin
  perform customer._patch('customer.apply_runo_row(uuid)'::regprocedure,
    $o$  v_client := customer.find_or_create_client(
    v_tenant, p ->> 'Mobile Number', concat_ws(' ', p ->> 'Name', p ->> 'Last Name'), v_row.source, v_at,
    '{}', p ->> 'Billing Phone Number Add +91', null, v_row.id);$o$,
    $n$  v_client := customer.resolve_client(
    v_tenant, p ->> 'Mobile Number', concat_ws(' ', p ->> 'Name', p ->> 'Last Name'), v_row.source, v_at,
    p ->> 'Billing Phone Number Add +91', null, v_row.source || ':' || v_row.row_key, v_row.id);$n$, 1);

  perform customer._patch('customer.apply_enquiry_row(uuid)'::regprocedure,
    $o$  if v_phone is not null then
    v_client := customer.find_or_create_client(v_tenant, v_phone, v_name, v_row.source, v_received, '{}', null, null, v_row.id);
  elsif v_enquiry.id is not null then
    v_client := v_enquiry.client_id;
    perform customer.add_client_name(v_client, v_name, v_row.source, v_received);
  elsif v_insta is not null then
    select i.client_id into v_client from customer.client_identifiers i join customer.clients c on c.id = i.client_id
     where i.tenant_id = v_tenant and i.id_type = 'instagram' and i.value = v_insta and c.merged_into_client_id is null
     order by i.first_seen_at limit 1;
    if v_client is null then
      insert into customer.households (tenant_id) values (v_tenant) returning id into v_household;
      v_client := customer.create_client_without_phone(v_tenant, v_household, coalesce(v_name, '@' || v_insta), v_row.source, v_received);
      update customer.households set main_client_id = v_client where id = v_household;
    else
      perform customer.add_client_name(v_client, v_name, v_row.source, v_received);
    end if;
  elsif p ? 'CUSTOMER CONTACT NUMBER' then
    raise exception 'Not a valid phone number' using errcode = '22023';
  else
    raise exception 'No phone number or Instagram ID' using errcode = '22023';
  end if;$o$,
    $n$  if v_phone is not null then
    v_client := customer.find_or_create_client(v_tenant, v_phone, v_name, v_row.source, v_received, '{}', null, null, v_row.id);
  elsif v_enquiry.id is not null then
    v_client := v_enquiry.client_id;
    perform customer.add_client_name(v_client, v_name, v_row.source, v_received);
    if p ? 'CUSTOMER CONTACT NUMBER' then
      insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
      values (v_tenant, v_client, 'unverified_phone', left(p ->> 'CUSTOMER CONTACT NUMBER', 60), v_row.source, v_received) on conflict do nothing;
    end if;
  else
    -- No valid phone: Instagram ID, then this enquiry's own customer, then a new one.
    v_client := customer.resolve_client(v_tenant, p ->> 'CUSTOMER CONTACT NUMBER', v_name, v_row.source, v_received,
      null, v_insta, v_row.source || ':enquiry:' || v_ref, v_row.id);
  end if;$n$, 1);
end $patches$;
drop function customer._patch(regprocedure, text, text, integer);

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;

-- The rows left out before: apply them now. Each is a handful per sheet.
do $again$
declare s text; v jsonb;
begin
  for s in
    update customer.ingest_rows set status = 'pending', reject_reason = null
     where status = 'rejected' and reject_reason in ('Not a valid phone number', 'No phone number or Instagram ID')
    returning source
  loop null; end loop;
  for s in select distinct source from customer.ingest_rows where status = 'pending' and reject_reason is null
             and source in (select source from customer.source_tables) loop
    v := public.customer_ingest_apply(s, 2000);
    raise notice '0416: % %', s, v;
  end loop;
end $again$;
