-- Private selection metadata supplied only by the audited JewelOS staff sync.
alter table crm_private.staff_sync_state add column selection_department text not null default 'other'
  check (selection_department in ('crm', 'sales', 'other'));

do $$ declare body text; old_text text; new_text text; begin
  select pg_get_functiondef('public.crm_apply_staff_snapshot(text,jsonb)'::regprocedure) into body;
  old_text := 'crm_user_id, applied_at)';
  new_text := 'crm_user_id, applied_at, selection_department)';
  if position(old_text in body) = 0 then raise exception 'staff snapshot insert contract changed'; end if;
  body := replace(body, old_text, new_text);
  old_text := '(v_result ->> ''crm_user_id'')::uuid, now())';
  new_text := '(v_result ->> ''crm_user_id'')::uuid, now(), case when p_snapshot->>''selection_department'' in (''crm'',''sales'') then p_snapshot->>''selection_department'' else ''other'' end)';
  if position(old_text in body) = 0 then raise exception 'staff snapshot value contract changed'; end if;
  body := replace(body, old_text, new_text);
  old_text := 'applied_at = excluded.applied_at;';
  if position(old_text in body) = 0 then raise exception 'staff snapshot update contract changed'; end if;
  body := replace(body, old_text, 'applied_at = excluded.applied_at, selection_department = excluded.selection_department;');
  execute body;
end $$;

create or replace function public.get_walkin_salespeople()
returns table(branch_id uuid, salesperson_id uuid, salesperson_name text)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_user_role() is null then raise exception 'active CRM profile required' using errcode='42501'; end if;
  return query select b.id, u.id, u.name::text from public.users u
  join public.branches b on b.active and u.branch_id=b.id
  join public.crm_sso_access_grants g on g.legacy_crm_user_id=u.id and g.active
  join crm_private.staff_sync_state s on s.jewelos_user_id=g.jewelos_user_id and s.crm_user_id=u.id
  where u.active and s.selection_department='sales'
  order by b.id,u.name,u.id;
end $$;
revoke all on function public.get_walkin_salespeople() from public,anon;
grant execute on function public.get_walkin_salespeople() to authenticated,service_role;

create function public.get_walkin_crm_roster()
returns setof public.crm_allocation
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_user_role() is null then raise exception 'active CRM profile required' using errcode='42501'; end if;
  return query select a.* from public.crm_allocation a
  join public.users u on u.id=a.crm_user_id and u.active
  join public.branches b on b.id=a.branch_id and b.active
  join public.crm_sso_access_grants g on g.legacy_crm_user_id=u.id and g.active
  join crm_private.staff_sync_state s on s.jewelos_user_id=g.jewelos_user_id and s.crm_user_id=u.id
  where a.active and s.selection_department='crm'
  order by a.branch_id,a.crm_name,a.id;
end $$;
revoke all on function public.get_walkin_crm_roster() from public,anon;
grant execute on function public.get_walkin_crm_roster() to authenticated,service_role;

-- Both queue readers use the same department-filtered roster as the intake page.
do $$ declare signature text; body text; begin
  foreach signature in array array['public.get_walkin_queue_snapshot(uuid,text,uuid)', 'public.get_walkin_queue_page(uuid,text,uuid,text,integer,integer)'] loop
    select pg_get_functiondef(signature::regprocedure) into body;
    if position('from public.crm_allocation' in lower(body))=0 then raise exception 'queue roster contract changed: %',signature; end if;
    body:=regexp_replace(body,'from public\.crm_allocation','from public.get_walkin_crm_roster()','gi');
    execute body;
  end loop;
end $$;
notify pgrst,'reload schema';
