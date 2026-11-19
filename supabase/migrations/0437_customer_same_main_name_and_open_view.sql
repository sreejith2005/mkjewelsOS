-- 0437: customer master database - "same person" needs the same main name;
-- every signed-in person can read both franchises.
--
-- 1. Owner, 2026-11-19, on MKC-103200 flagged "possibly same person" with
--    MKC-109333: "everything was very different for the two people". The
--    record holds 7 names (its number was used by several people); the name it
--    shares with the other record is one of its other names. From now on two
--    records count as having the same name only when their MAIN names are the
--    same. This applies to joining (still also: numbers together on 2+ rows)
--    and to the "possibly same person" flag. Open flags that fail it are
--    closed (their family link stays). Joins already made are not undone.
--
-- 2. Owner, 2026-11-19: "everyone should be able to view the client database
--    ... there will be no restriction for the client database by store or
--    franchisee"; Decision 1 = yes (everyone sees Mumbai and Ahmedabad, the
--    records stay separate, the franchise buttons are shown to all). Every
--    signed-in person may read every franchise; the list still opens on the
--    person's own franchise. Imports still match only inside their franchise
--    (0433). Who may use the section at all stays the permission "Use CRM"
--    (crm.view), which Super Admin can switch off per department, designation
--    or person in Users -> Permissions. This replaces the reading rule of 0433.

create function customer._patch(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0437: expected % match(es) of "%" in %, found %', p_expected, p_old, p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Same person: the same main name
-- ---------------------------------------------------------------------------
select customer._patch('customer.reconcile_pair(uuid)'::regprocedure,
$old$  v_same := exists (select 1 from customer.client_names x join customer.client_names y on y.name_key = x.name_key
                     where x.client_id = a and y.client_id = b);$old$,
$new$  -- The same MAIN name (migration 0437): a shared old or other name is not enough.
  v_same := customer.name_key(ca.primary_name) is not null and customer.name_key(ca.primary_name) = customer.name_key(cb.primary_name);$new$, 1);

-- Open flags whose two records do not have the same main name.
with open_flags as (
  select r.id, customer.current_client(r.client_a) as a, customer.current_client(r.client_b) as b
    from customer.identity_review r
   where r.status = 'open' and r.reason = 'possible_same_person')
update customer.identity_review r
   set status = 'linked', resolved_at = now(),
       outcome = coalesce(r.outcome, '') || '; closed by 0437: main names differ'
  from open_flags f
  left join customer.clients ca on ca.id = f.a
  left join customer.clients cb on cb.id = f.b
 where r.id = f.id
   and (ca.id is null or cb.id is null
        or customer.name_key(ca.primary_name) is null
        or customer.name_key(ca.primary_name) is distinct from customer.name_key(cb.primary_name));

-- ---------------------------------------------------------------------------
-- 2. Everyone reads every franchise
-- ---------------------------------------------------------------------------
create or replace function customer.readable_franchise_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  -- Null means every franchise (migration 0437). Kept as a function so a
  -- narrower rule can come back in one place.
  select null::uuid[];
$$;

drop function customer._patch(regprocedure, text, text, integer);

revoke all on all functions in schema customer from public, anon, authenticated;
grant execute on all functions in schema customer to service_role;
revoke all on function customer.purge_source(text) from service_role;
revoke all on function customer.delete_sheet(text) from service_role;
