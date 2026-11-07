-- Filters on a Users question (MK1 audit 2026-11-07).
--
-- A Users question listed every active employee the person filling the form
-- may see. The form builder can now narrow it, for example "Salesperson: only
-- the Sales department" or "only Hyderabad franchise, Sales, Manager role".
--
-- Stored as validation.userFilter on the question (form_fields.validation),
-- so it is captured by revisions, duplicates and published snapshots like any
-- other question setting:
--
--   { "match": "all" | "any",
--     "rules": [ { "attribute": "department" | "designation" | "store" | "franchise" | "role" | "name",
--                  "operator":  "equals" | "not_equals" | "in" | "not_in" | "is_empty" | "is_not_empty"
--                               | "contains" | "not_contains",          -- name only
--                  "values": [ ids, role names or text ] } ] }
--
-- The filter only narrows. It never widens who can be seen or chosen: the
-- people list still comes from v_task_users (franchise boundary, 0387) and a
-- submitted answer still passes assert_form_user_answer (active, same company,
-- location scope) before the filter is checked. A submitted person who does
-- not match is refused, so editing the request cannot pick someone the form
-- does not allow. Every active employee always had to be active; that stays.
--
-- The same rule is mirrored in @jewelos/core (formUserMatchesFilter) to list
-- the choices.

-- ---------------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------------

-- Validates and normalises one filter. Null / absent means "no filter".
create function normalize_form_user_filter(p_filter jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_rule jsonb; v_rules jsonb := '[]'::jsonb; v_values jsonb; v_attr text; v_op text; v_value jsonb;
begin
  if p_filter is null or p_filter = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_filter) <> 'object' or p_filter - array['match', 'rules'] <> '{}'::jsonb then
    raise exception 'Unsupported people filter' using errcode = '22023';
  end if;
  if coalesce(p_filter->>'match', 'all') not in ('all', 'any') then
    raise exception 'People filter must match all or any rules' using errcode = '22023';
  end if;
  if jsonb_typeof(p_filter->'rules') is distinct from 'array' or jsonb_array_length(p_filter->'rules') > 10 then
    raise exception 'A people filter has at most 10 rules' using errcode = '22023';
  end if;
  for v_rule in select value from jsonb_array_elements(p_filter->'rules') loop
    if jsonb_typeof(v_rule) <> 'object' or v_rule - array['attribute', 'operator', 'values'] <> '{}'::jsonb then
      raise exception 'Unsupported people filter rule' using errcode = '22023';
    end if;
    v_attr := v_rule->>'attribute'; v_op := v_rule->>'operator';
    if v_attr is null or v_attr not in ('department', 'designation', 'store', 'franchise', 'role', 'name') then
      raise exception 'Unsupported people filter field' using errcode = '22023';
    end if;
    if v_op is null or v_op not in ('equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty', 'contains', 'not_contains')
       or (v_op in ('contains', 'not_contains')) <> (v_attr = 'name')
       or (v_attr = 'name' and v_op not in ('contains', 'not_contains')) then
      raise exception 'Unsupported people filter condition' using errcode = '22023';
    end if;
    v_values := coalesce(v_rule->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' or jsonb_array_length(v_values) > 50 then
      raise exception 'A people filter rule has at most 50 values' using errcode = '22023';
    end if;
    for v_value in select value from jsonb_array_elements(v_values) loop
      if jsonb_typeof(v_value) <> 'string' or length(v_value #>> '{}') not between 1 and 100 then
        raise exception 'People filter values must be text' using errcode = '22023';
      end if;
      if v_attr in ('department', 'designation', 'store', 'franchise')
         and (v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'People filter values must be identifiers' using errcode = '22023';
      end if;
      if v_attr = 'role' and (v_value #>> '{}') not in ('super_admin', 'admin', 'manager', 'hr', 'crm', 'staff') then
        raise exception 'Unknown role in people filter' using errcode = '22023';
      end if;
    end loop;
    if v_op in ('is_empty', 'is_not_empty') then
      v_values := '[]'::jsonb;
    elsif jsonb_array_length(v_values) = 0 or (v_op in ('equals', 'not_equals', 'contains', 'not_contains') and jsonb_array_length(v_values) <> 1) then
      raise exception 'People filter rule needs a value' using errcode = '22023';
    end if;
    v_rules := v_rules || jsonb_build_array(jsonb_build_object('attribute', v_attr, 'operator', v_op, 'values', v_values));
  end loop;
  if jsonb_array_length(v_rules) = 0 then return null; end if;
  return jsonb_build_object('match', coalesce(p_filter->>'match', 'all'), 'rules', v_rules);
end $$;

-- Does one employee match a (normalised) filter? Null filter = everyone.
create function form_user_matches_filter(p_filter jsonb, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with person as (
    select u.department_id::text as department, u.designation_id::text as designation, u.branch_id::text as store,
           b.franchise_group_id::text as franchise, u.user_role::text as role, lower(coalesce(u.employee_name, '')) as name
    from user_profiles u left join branches b on b.id = u.branch_id where u.id = p_user_id
  ), checks as (
    select case r->>'attribute'
             when 'department' then p.department when 'designation' then p.designation when 'store' then p.store
             when 'franchise' then p.franchise when 'role' then p.role else p.name end as have,
           r->>'operator' as op,
           array(select lower(v) from jsonb_array_elements_text(r->'values') v) as want
    from person p cross join jsonb_array_elements(coalesce(p_filter->'rules', '[]'::jsonb)) r
  ), results as (
    -- A comparison with an empty value is false, never null (bool_and ignores nulls).
    select coalesce(case op
             when 'is_empty' then have is null
             when 'is_not_empty' then have is not null
             when 'equals' then lower(have) = want[1]
             when 'in' then lower(have) = any(want)
             when 'not_equals' then have is null or lower(have) <> want[1]
             when 'not_in' then have is null or not (lower(have) = any(want))
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

create function assert_form_user_filter(p_filter jsonb, p_value text, p_field_key text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_filter is null or p_filter = 'null'::jsonb then return; end if;
  if not form_user_matches_filter(p_filter, p_value::uuid) then
    raise exception 'Field % names an employee this question does not allow', p_field_key using errcode = '23514';
  end if;
end $$;

revoke all on function normalize_form_user_filter(jsonb), form_user_matches_filter(jsonb, uuid),
  assert_form_user_filter(jsonb, text, text) from public, anon, authenticated;
-- The normaliser is a pure check that form saving may run as the signed-in
-- person; the matcher reads employee details and stays server-only.
grant execute on function normalize_form_user_filter(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Saving the setting (validation.userFilter, Users questions only)
-- ---------------------------------------------------------------------------

-- The legacy normaliser accepts a fixed list of validation keys, so the filter
-- is taken out before it runs and put back, normalised, afterwards.
create function pg_temp.filter_patch(p_signature text, p_old text, p_new text)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_signature::regprocedure), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> 1 then raise exception '0391: expected 1 match in %, found %: %', p_signature, found, left(p_old, 80); end if;
  execute replace(body, p_old, p_new);
end $$;

select pg_temp.filter_patch('public.normalize_form_fields(jsonb,jsonb)',
  $o$select coalesce(jsonb_agg(value-'branches'-'assignmentScope'),'[]') into clean from jsonb_array_elements(p_fields);$o$,
  $n$select coalesce(jsonb_agg(case when jsonb_typeof(value->'validation')='object' then jsonb_set(value-'branches'-'assignmentScope','{validation}',(value->'validation')-'userFilter') else value-'branches'-'assignmentScope' end),'[]') into clean from jsonb_array_elements(p_fields);$n$);
select pg_temp.filter_patch('public.normalize_form_fields(jsonb,jsonb)',
  $o$  seen:=array_append(seen,item->>'key'); i:=i+1;$o$,
  $n$  if jsonb_typeof(item->'validation')='object' and item->'validation' ? 'userFilter' and item->'validation'->'userFilter'<>'null' then
   if item->>'type'<>'user_dropdown' then raise exception 'Only a Users question can filter people' using errcode='22023'; end if;
   rule:=normalize_form_user_filter(item->'validation'->'userFilter');
   if rule is not null then result:=jsonb_set(result,array[i::text,'validation'],coalesce(result->i->'validation','{}'::jsonb)||jsonb_build_object('userFilter',rule)); end if;
  end if;
  seen:=array_append(seen,item->>'key'); i:=i+1;$n$);

-- ---------------------------------------------------------------------------
-- 3. Submitting: the chosen person must match
-- ---------------------------------------------------------------------------

select pg_temp.filter_patch('public.submit_form_base_with_audit(uuid,jsonb,text,uuid)',
  $o$if v_field.field_type='user_dropdown' then perform public.assert_form_user_answer(v_actor.tenant_id,v_field.field_key,v_field.assignment_scope,v_text); end if;$o$,
  $n$if v_field.field_type='user_dropdown' then perform public.assert_form_user_answer(v_actor.tenant_id,v_field.field_key,v_field.assignment_scope,v_text); perform public.assert_form_user_filter(v_field.validation->'userFilter',v_text,v_field.field_key); end if;$n$);
select pg_temp.filter_patch('public.fms_validate_candidate_form(uuid,jsonb,text,uuid)',
  $o$if v_field.field_type='user_dropdown' then perform public.assert_form_user_answer(v_actor.tenant_id,v_field.field_key,v_field.assignment_scope,v_text); end if;$o$,
  $n$if v_field.field_type='user_dropdown' then perform public.assert_form_user_answer(v_actor.tenant_id,v_field.field_key,v_field.assignment_scope,v_text); perform public.assert_form_user_filter(v_field.validation->'userFilter',v_text,v_field.field_key); end if;$n$);

drop function pg_temp.filter_patch(text, text, text);

-- ---------------------------------------------------------------------------
-- 4. The people list carries designation, so a form can list by it
-- ---------------------------------------------------------------------------

create or replace view v_task_users as
  select id, tenant_id, branch_id, department_id, employee_name, user_role, employee_code, working_status, buddy_id, designation_id
  from user_profiles
  where tenant_id = current_tenant_id() and current_profile_is_active()
    and (org_record_in_filter((select org_my_branch_filter()), branch_id, null::uuid[])
         or id = (select (current_profile()).id) or org_person_shares_work_with_me(id));

notify pgrst, 'reload schema';
