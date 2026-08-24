-- Buddies provide branch-and-department absence coverage. Designation is not
-- part of the business requirement and must not make the picker empty.
set search_path = public, extensions;

create or replace function enforce_user_profile_buddy_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_candidate_id uuid; v_candidate user_profiles;
begin
  if new.buddy_id is not null and new.secondary_buddy_id = new.buddy_id then
    raise exception 'Primary and secondary buddies must be different' using errcode='23514';
  end if;
  foreach v_candidate_id in array array[new.buddy_id, new.secondary_buddy_id] loop
    if v_candidate_id is null then continue; end if;
    if v_candidate_id = new.id then raise exception 'A user cannot be their own buddy' using errcode='23514'; end if;
    select * into v_candidate from user_profiles where id=v_candidate_id;
    if v_candidate.id is null or v_candidate.tenant_id<>new.tenant_id
       or v_candidate.account_status<>'active' or v_candidate.is_login_enabled is not true
       or v_candidate.working_status<>'active' then
      raise exception 'Buddy must be an active user in the same tenant' using errcode='23503';
    end if;
    if v_candidate.branch_id<>new.branch_id or v_candidate.department_id<>new.department_id then
      raise exception 'Buddy must be in the same branch and department' using errcode='23503';
    end if;
    if user_role_hierarchy_rank(v_candidate.user_role)<user_role_hierarchy_rank(new.user_role) then
      raise exception 'Buddy assignment cannot point to a higher hierarchy' using errcode='42501';
    end if;
  end loop;
  return new;
end;
$$;

notify pgrst, 'reload schema';
