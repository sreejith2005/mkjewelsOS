-- 0451: customers with bad data are kept out of the main list.
--
-- Owner, 2026-11-28: "the people who are wrong number or wrong data or
-- mismatch or anything similar to that, i dont want them to show in my master
-- customer database. it should be showing up as a filter that i could select
-- and then see ... and the various sub parts of these like wrong number,
-- wrong data etc."
--
-- customer.clients.data_problems holds the problem keys of a customer:
--   invalid_number    not a valid mobile number (too few / too many digits)
--   number_not_exist  "dialed number does not exist", "invalid no." by staff
--   wrong_number      the person said it is the wrong number ("wrong no",
--                     "incorrect number", Runo's "Incorrect number", the FMS
--                     outcome "WRONG NUMBER")
--   wrong_data        DATA STATUS says WRONG DATA
--   staff             DATA STATUS says STAFF
--   not_customer      SCRIPT STATUS says NON-CLIENT
-- (Read-only count 2026-11-28: about 2,520 invalid, 640 not existing, 3,150
-- wrong number.) The three number problems are dropped for a customer who
-- bought or later had a successful call, so they stay in the list.
--
-- customer_list leaves out customers with any problem, except when searching
-- (a search finds everyone) or when the filter names problems:
-- {"data_problems": ["wrong_number"]} or {"data_problems": ["any"]}.
-- customer_list_filters counts each problem; its Clients / Leads counts leave them out. Kept up to date by
-- refresh_client_stats, which every importer calls.

alter table customer.clients add column data_problems text[] not null default '{}';
comment on column customer.clients.data_problems is 'Bad-data keys (migration 0451): invalid_number, number_not_exist, wrong_number, wrong_data, staff, not_customer. Empty for a normal customer.';
create index clients_data_problems_idx on customer.clients using gin (data_problems) where data_problems <> '{}';

create function customer.client_data_problems(p_client_id uuid) returns text[]
language sql stable set search_path = '' as $$
  with c as (select * from customer.clients where id = p_client_id),
  reasons as (select value from customer.client_field_values where client_id = p_client_id and field_key = 'wrong_number_reason'),
  calls as (select outcome, non_contact_reason, successful from customer.interactions where client_id = p_client_id and archived_at is null),
  a as (select upper(btrim(customer.current_answer(p_client_id, 'data_status'))) as data_status,
               upper(customer.current_answer(p_client_id, 'contact_type')) as contact_type),
  -- A customer who bought or was really reached is not a bad number.
  ok as (select c.segment = 'buyer' or exists (
           select 1 from calls where successful and coalesce(outcome, '') !~* '(wrong|incorrect|invalid|not exist|galat)'
             and coalesce(non_contact_reason, '') !~* '(wrong|incorrect|invalid|not exist)') as reached from c),
  n as (select
          exists (select 1 from reasons where value ~* '^invalid number \(\d+ digits\)')
            or (not exists (select 1 from customer.client_phones p where p.client_id = p_client_id)
                and exists (select 1 from customer.client_identifiers i where i.client_id = p_client_id and i.id_type = 'unverified_phone')) as invalid,
          exists (select 1 from reasons where value !~* '^invalid number \(\d+ digits\)'
                    and value ~* '((not|n''t)\s+exists?|invalid)') as not_exist,
          exists (select 1 from reasons where value ~* '(wrong|incorrect|galat)'
                    or (value !~* '^invalid number \(\d+ digits\)' and value !~* '((not|n''t)\s+exists?|invalid)'))
            or exists (select 1 from calls where non_contact_reason ~* '^\s*(incorrect|wrong)\s+(number|no)' or outcome ~* '^\s*wrong\s+(number|no)\.?\s*$') as wrong)
  select array_remove(array[
    case when n.invalid and not ok.reached then 'invalid_number' end,
    case when n.not_exist and not ok.reached then 'number_not_exist' end,
    case when n.wrong and not ok.reached then 'wrong_number' end,
    case when a.data_status = 'WRONG DATA' then 'wrong_data' end,
    case when a.data_status = 'STAFF' then 'staff' end,
    case when a.contact_type like 'NON-CLIENT%' then 'not_customer' end
  ], null)
  from n, ok, a;
$$;
revoke all on function customer.client_data_problems(uuid) from public, anon, authenticated;

create function customer._patch_0451(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0451: expected % match(es) of "%" in %, found %', p_expected, left(p_old, 80), p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

select customer._patch_0451('customer.refresh_client_stats(uuid)'::regprocedure,
  $o$         segment = case when s.last_purchase is not null or v_marked then 'buyer' else 'lead' end
   where c.id = p_client_id;$o$,
  $n$         segment = case when s.last_purchase is not null or v_marked then 'buyer' else 'lead' end
   where c.id = p_client_id;
  -- After the segment: a buyer is not a bad number (migration 0451).
  update customer.clients c set data_problems = x.problems
    from (select customer.client_data_problems(p_client_id) as problems) x
   where c.id = p_client_id and c.data_problems is distinct from x.problems;$n$, 1);

-- The list: problems left out unless asked for or searched.
select customer._patch_0451('public.customer_list(jsonb,integer,integer)'::regprocedure,
  $o$       and (v_ids is null or c.id = any (v_ids))
       and (not (f ? 'segment') or c.segment = f ->> 'segment')$o$,
  $n$       and (v_ids is null or c.id = any (v_ids))
       and (case when jsonb_typeof(f -> 'data_problems') = 'array' and jsonb_array_length(f -> 'data_problems') > 0 then
              (f -> 'data_problems') ? 'any' and c.data_problems <> '{}'
              or c.data_problems && array(select jsonb_array_elements_text(f -> 'data_problems'))
            else v_ids is not null or c.data_problems = '{}' end)
       and (not (f ? 'segment') or c.segment = f ->> 'segment')$n$, 1);
select customer._patch_0451('public.customer_list(jsonb,integer,integer)'::regprocedure,
  $o$           'tags', customer.client_tags(p.id),$o$,
  $n$           'tags', customer.client_tags(p.id), 'data_problems', to_jsonb(p.data_problems),$n$, 1);

select customer._patch_0451('public.customer_list_filters(text)'::regprocedure,
  $o$    'total', (select count(*) from customer.clients where tenant_id = v_tenant and archived_at is null and (v_view is null or franchise_group_id = any (v_view))),$o$,
  $n$    'total', (select count(*) from customer.clients where tenant_id = v_tenant and archived_at is null and (v_view is null or franchise_group_id = any (v_view))),
    -- Customers with bad data, each kind counted (migration 0451); they are not in the main list.
    'data_problems', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
        select k, count(*) n from customer.clients, unnest(data_problems) k
         where tenant_id = v_tenant and archived_at is null and (v_view is null or franchise_group_id = any (v_view)) group by k) t),
    'with_data_problems', (select count(*) from customer.clients where tenant_id = v_tenant and archived_at is null
        and (v_view is null or franchise_group_id = any (v_view)) and data_problems <> '{}'),$n$, 1);

-- The Clients / Leads counts are of the main list, without bad data.
select customer._patch_0451('public.customer_list_filters(text)'::regprocedure,
  $o$from (select segment, count(*) n from customer.clients where tenant_id = v_tenant and archived_at is null and (v_view is null or franchise_group_id = any (v_view)) group by segment) t),$o$,
  $n$from (select segment, count(*) n from customer.clients where tenant_id = v_tenant and archived_at is null and (v_view is null or franchise_group_id = any (v_view)) and data_problems = '{}' group by segment) t),$n$, 1);

drop function customer._patch_0451(regprocedure, text, text, integer);

-- Once, for the customers who can have a problem: only they are checked
-- (checking every customer timed out on the first push, 2026-11-28).
set statement_timeout = '20min';
with candidates as (
  select client_id from customer.client_field_values where field_key = 'wrong_number_reason'
  union
  select client_id from customer.client_field_values
   where (field_key = 'data_status' and upper(btrim(value)) in ('WRONG DATA', 'STAFF'))
      or (field_key = 'contact_type' and upper(value) like 'NON-CLIENT%')
  union
  select client_id from customer.client_identifiers where id_type = 'unverified_phone'
  union
  select client_id from customer.interactions
   where archived_at is null and (non_contact_reason ~* '(incorrect|wrong)' or outcome ~* 'wrong')
)
update customer.clients c set data_problems = x.problems
  from (select k.client_id, customer.client_data_problems(k.client_id) as problems
          from candidates k join customer.clients cl on cl.id = k.client_id and cl.merged_into_client_id is null) x
 where c.id = x.client_id and x.problems <> '{}';
reset statement_timeout;
