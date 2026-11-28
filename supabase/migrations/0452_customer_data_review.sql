-- 0452: a set-aside customer can be moved back into the main list.
--
-- Owner, 2026-11-28: "i want an option to be able to mark if the data can be
-- merged into the main master customer database." A customer with a data
-- problem (migration 0451) is set aside from the main list; someone allowed
-- to review customer data can move them into the main list (the problem
-- stays shown on their page) or set them aside again. Each decision is
-- audited.
--
-- * customer.clients.data_review: 'main' when moved into the main list.
-- * New permission "Review customer data" (customers.review_data), Super Admin
--   by default; grant it to others in Users -> Permissions.
-- * public.customer_set_data_review(p_client_code, p_main).
-- * The list, the Clients / Leads counts and "with_data_problems" treat a
--   customer moved into the main list like a normal one.
-- * customer_get_client_page gains data_problems, data_review and
--   can_review_data.

-- permission-catalog:begin
insert into public.permission_catalog (key, kind, page_id, default_roles, sort_order) values
('customers.review_data', 'action', null, '{super_admin}', 123);
-- permission-catalog:end

alter table customer.clients
  add column data_review text check (data_review in ('main')),
  add column data_reviewed_by uuid references public.user_profiles(id) on delete set null,
  add column data_reviewed_at timestamptz;
comment on column customer.clients.data_review is 'Migration 0452: ''main'' when a person moved this customer with a data problem into the main list.';

create function public.customer_set_data_review(p_client_code text, p_main boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_actor uuid; c customer.clients;
begin
  perform public.assert_module_enabled('crm');
  if not public.has_permission('customers.review_data') then
    raise exception 'Section access denied' using errcode = '42501';
  end if;
  if p_main is null then raise exception 'Choose main list or set aside' using errcode = '22023'; end if;
  v_tenant := public.current_tenant_id();
  select id into v_actor from public.current_profile();
  select * into c from customer.clients
   where tenant_id = v_tenant and client_code = upper(btrim(coalesce(p_client_code, ''))) and merged_into_client_id is null
     and customer.franchise_visible(franchise_group_id)
   for update;
  if c.id is null then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  if p_main and c.data_problems = '{}' then raise exception 'This customer has no data problem' using errcode = '22023'; end if;

  update customer.clients
     set data_review = case when p_main then 'main' end,
         data_reviewed_by = v_actor, data_reviewed_at = now()
   where id = c.id;
  insert into public.audit_logs (tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_tenant, v_actor, 'customer_data_reviewed', 'customer', c.id,
          jsonb_build_object('data_review', c.data_review),
          jsonb_build_object('data_review', case when p_main then 'main' end, 'data_problems', to_jsonb(c.data_problems)));
  return jsonb_build_object('client_code', c.client_code, 'data_review', case when p_main then 'main' end);
end $$;
revoke all on function public.customer_set_data_review(text, boolean) from public, anon;
grant execute on function public.customer_set_data_review(text, boolean) to authenticated;

create function customer._patch_0452(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0452: expected % match(es) of "%" in %, found %', p_expected, left(p_old, 80), p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

select customer._patch_0452('public.customer_list(jsonb,integer,integer)'::regprocedure,
  $o$            else v_ids is not null or c.data_problems = '{}' end)$o$,
  $n$            else v_ids is not null or c.data_problems = '{}' or c.data_review = 'main' end)$n$, 1);
select customer._patch_0452('public.customer_list(jsonb,integer,integer)'::regprocedure,
  $o$'data_problems', to_jsonb(p.data_problems),$o$,
  $n$'data_problems', to_jsonb(p.data_problems), 'data_review', p.data_review,$n$, 1);
select customer._patch_0452('public.customer_list_filters(text)'::regprocedure,
  $o$and data_problems = '{}' group by segment$o$,
  $n$and (data_problems = '{}' or data_review = 'main') group by segment$n$, 1);
select customer._patch_0452('public.customer_list_filters(text)'::regprocedure,
  $o$and (v_view is null or franchise_group_id = any (v_view)) and data_problems <> '{}'),$o$,
  $n$and (v_view is null or franchise_group_id = any (v_view)) and data_problems <> '{}' and data_review is distinct from 'main'),$n$, 1);
select customer._patch_0452('public.customer_get_client_page(text)'::regprocedure,
  $o$    'tags', customer.client_tags(v_client.id),$o$,
  $n$    'tags', customer.client_tags(v_client.id),
    'data_problems', to_jsonb(v_client.data_problems), 'data_review', v_client.data_review,
    'data_reviewed_at', v_client.data_reviewed_at,
    'data_reviewed_by', (select u.employee_name from public.user_profiles u where u.id = v_client.data_reviewed_by),
    'can_review_data', public.has_permission('customers.review_data'),$n$, 1);

drop function customer._patch_0452(regprocedure, text, text, integer);
