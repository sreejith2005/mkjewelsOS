-- 0418: a referral is linked to the visit it was given at, within an hour.
--
-- Production, 2026-11-17: 0417 linked a referral to its giver only when the
-- giver's visit form was sent in the same second. No referral row is: the
-- REFERRALS tab is saved after the visit form. Of 1,698 referral rows, the
-- nearest visit form from a client with the giver's name was sent
--   under 1 minute away: 273, 1 minute to 1 hour: 1,039, 1 hour to 1 day: 14,
--   none within a day: 372.
--
-- Rule now: the giver is the client with the same name whose visit form was
-- sent within one hour of the referral, the nearest one. Without such a visit
-- the giver's name stays as written and nothing is linked. Referrals already
-- imported are linked again under this rule.

create or replace function customer.referral_giver(p_tenant_id uuid, p_sent_at timestamptz, p_giver_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  select r.client_id from customer.ingest_rows r
   where r.tenant_id = p_tenant_id and r.source = 'walkin' and r.status = 'applied' and r.client_id is not null
     and p_sent_at is not null and customer.name_key(p_giver_name) is not null
     and customer.parse_sheet_timestamp(r.payload ->> 'TIMESTAMP') between p_sent_at - interval '1 hour' and p_sent_at + interval '1 hour'
     and customer.name_key(r.payload ->> 'CLIENT NAME') = customer.name_key(p_giver_name)
   order by abs(extract(epoch from (customer.parse_sheet_timestamp(r.payload ->> 'TIMESTAMP') - p_sent_at))), r.sheet_row
   limit 1
$$;

-- A visit that arrives after its referrals looks for them in the same hour.
do $patch$
declare
  body text; found integer; f regprocedure := 'customer.apply_walkin_row(uuid)'::regprocedure;
  old_text constant text := $o$and customer.parse_sheet_timestamp(x.payload ->> 'TIMESTAMP') = v_stamp loop$o$;
  new_text constant text := $n$and customer.parse_sheet_timestamp(x.payload ->> 'TIMESTAMP') between v_stamp - interval '1 hour' and v_stamp + interval '1 hour' loop$n$;
begin
  body := replace(pg_get_functiondef(f), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then raise exception '0418: expected 1 match of the referral lookup in apply_walkin_row, found %', found; end if;
  execute replace(body, old_text, new_text);
end $patch$;

revoke all on function customer.referral_giver(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function customer.apply_walkin_row(uuid) from public, anon, authenticated;
grant execute on function customer.referral_giver(uuid, timestamptz, text) to service_role;
grant execute on function customer.apply_walkin_row(uuid) to service_role;

-- Link the referrals already imported. A customer who already has a referrer keeps it.
do $relink$
declare n integer;
begin
  with linked as (
    update customer.clients c set referred_by_client_id = g.giver
      from (select distinct on (r.client_id) r.client_id,
                   customer.referral_giver(r.tenant_id, customer.parse_sheet_timestamp(r.payload ->> 'TIMESTAMP'),
                                           r.payload ->> 'REFERENCE GIVEN BY CLIENT NAME') as giver
              from customer.ingest_rows r
             where r.source = 'referral' and r.status = 'applied' and r.client_id is not null
             order by r.client_id, r.sheet_row) g
     where c.id = g.client_id and g.giver is not null and g.giver <> c.id and c.referred_by_client_id is null
    returning 1)
  select count(*) into n from linked;
  raise notice '0418: % referred customers linked to their giver', n;
end $relink$;
