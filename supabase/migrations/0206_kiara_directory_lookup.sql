-- Ask Kiara, Phase 2: a narrow colleague directory for every Kiara user
-- (spec 2026-10-08-ask-kiara-design.md, section 8 "Gaps" and section 19 item 8,
-- approved by the owner 2026-10-08).
--
-- Staff cannot read other people's profiles (up_select shows them only their own
-- row), so "who is the HR person in our branch?" had no contract. This lookup
-- returns only four work fields of active colleagues in the caller's tenant:
-- name, designation, department, and branch. It never returns contact data
-- (mobiles, emails, addresses), ids, codes, roles, reporting lines, or
-- availability. It is read-only and needs no audit row of its own: the question's
-- audit row (complete_kiara_turn) already records that the directory tool ran.
set search_path = public, extensions;

create function kiara_directory_lookup(p_query text, p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  -- Active profile and the ask_kiara section (permission and availability).
  v_actor user_profiles := kiara_actor();
  v_query text := btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'));
  v_words text[];
  v_limit integer := coalesce(p_limit, 10);
  v_rows jsonb;
  v_count integer;
begin
  if v_query = '' then
    raise exception 'Give a name, department, designation, or branch to look up' using errcode = '22023';
  end if;
  if length(v_query) > 60 then
    raise exception 'Lookup terms must be at most 60 characters' using errcode = '22023';
  end if;
  if v_limit < 1 or v_limit > 20 then
    raise exception 'Limit must be 1 to 20' using errcode = '22023';
  end if;
  -- Each word is matched as plain text (LIKE wildcards typed by the user are
  -- literal), and every word must match one of the five work fields.
  select array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    into v_words
  from unnest(string_to_array(v_query, ' ')) w where w <> '';
  if array_length(v_words, 1) > 6 then
    raise exception 'Use at most 6 words' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', q.name, 'designation', q.designation, 'department', q.department, 'branch', q.branch)
           order by q.name, q.id) filter (where q.n <= v_limit), '[]'::jsonb),
         count(*)::integer
    into v_rows, v_count
  from (
    select p.id, p.employee_name as name, dm.label as designation, d.name as department, b.name as branch,
      row_number() over (order by p.employee_name, p.id) as n
    from user_profiles p
    left join dropdown_masters dm on dm.id = p.designation_id and dm.master_type = 'designation'
      and (dm.tenant_id = p.tenant_id or dm.tenant_id is null)
    left join departments d on d.id = p.department_id and d.tenant_id = p.tenant_id
    left join branches b on b.id = p.branch_id and b.tenant_id = p.tenant_id
    where p.tenant_id = v_actor.tenant_id
      and p.account_status = 'active'
      and p.is_login_enabled
      and p.working_status not in ('inactive', 'resigned')
      and not exists (
        select 1 from unnest(v_words) w
        where not (p.employee_name ilike w or coalesce(dm.label, '') ilike w or coalesce(d.name, '') ilike w
          or coalesce(b.name, '') ilike w or coalesce(b.code, '') ilike w)
      )
    order by p.employee_name, p.id
    limit v_limit + 1
  ) q;

  return jsonb_build_object('people', v_rows, 'truncated', v_count > v_limit);
end $$;

alter function kiara_directory_lookup(text,integer) owner to postgres;
revoke all on function kiara_directory_lookup(text,integer) from public, anon, authenticated, service_role;
grant execute on function kiara_directory_lookup(text,integer) to authenticated;

notify pgrst, 'reload schema';
