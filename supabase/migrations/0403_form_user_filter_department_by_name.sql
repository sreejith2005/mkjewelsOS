-- 0403: a Users question's Department rule matches the department by name in every store.
--
-- Owner report 2026-11-11: "Assigned to" on the Instagram Assignee Form had
-- Department is in [Sales, CRM] and listed nobody. Each store has its own Sales
-- and CRM department rows, and the filter (0391) stored one store's department
-- ids, so employees in every other store's Sales and CRM never matched.
--
-- Fix: a department rule value still holds a department id (no stored filter
-- changes), but it now stands for that department's name: a person matches when
-- their own department has the same name (trimmed, case-insensitive) in the same
-- company. Saved filters work immediately; departments added to new stores later
-- match too. Other attributes are unchanged. @jewelos/core formUserMatchesFilter
-- mirrors this for listing the choices.
set search_path = public, extensions;

create or replace function form_user_matches_filter(p_filter jsonb, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with person as (
    select u.tenant_id, lower(btrim(d.name)) as department, u.designation_id::text as designation, u.branch_id::text as store,
           b.franchise_group_id::text as franchise, u.user_role::text as role, lower(coalesce(u.employee_name, '')) as name
    from user_profiles u
    left join branches b on b.id = u.branch_id
    left join departments d on d.id = u.department_id
    where u.id = p_user_id
  ), checks as (
    select case r->>'attribute'
             when 'department' then p.department when 'designation' then p.designation when 'store' then p.store
             when 'franchise' then p.franchise when 'role' then p.role else p.name end as have,
           r->>'operator' as op,
           case when r->>'attribute' = 'department'
             -- Department ids stand for their names within the person's company.
             then array(select distinct lower(btrim(d.name)) from jsonb_array_elements_text(r->'values') v
                        join departments d on d.id::text = lower(v) and d.tenant_id = p.tenant_id)
             else array(select lower(v) from jsonb_array_elements_text(r->'values') v) end as want
    from person p cross join jsonb_array_elements(coalesce(p_filter->'rules', '[]'::jsonb)) r
  ), results as (
    -- A comparison with an empty value is false, never null (bool_and ignores nulls).
    select coalesce(case op
             when 'is_empty' then have is null
             when 'is_not_empty' then have is not null
             when 'equals' then lower(have) = want[1]
             when 'in' then lower(have) = any(want)
             when 'not_equals' then have is null or lower(have) is distinct from want[1]
             when 'not_in' then have is null or not coalesce(lower(have) = any(want), false)
             when 'contains' then strpos(have, want[1]) > 0
             when 'not_contains' then strpos(have, want[1]) = 0
           end, false) as ok
    from checks
  )
  select case
    when p_filter is null or p_filter = 'null'::jsonb or jsonb_array_length(coalesce(p_filter->'rules', '[]'::jsonb)) = 0 then true
    when not exists (select 1 from person) then false
    when coalesce(p_filter->>'match', 'all') = 'any' then coalesce(bool_or(ok), false)
    else coalesce(bool_and(ok), false) end
  from results;
$$;

-- create or replace keeps grants; restate them so the matcher stays server-only.
revoke all on function form_user_matches_filter(jsonb, uuid) from public, anon, authenticated;
