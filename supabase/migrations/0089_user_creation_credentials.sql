-- Create the complete employee profile, including absence coverage, in the
-- same server-side transaction that validates the authorised inviter.
set search_path = public, extensions;

create or replace function create_user_profile_with_coverage_and_audit(
  p_auth_user_id uuid,
  p_creator_profile_id uuid,
  p_personal_email text,
  p_first_name text,
  p_last_name text,
  p_official_email text,
  p_branch_id uuid,
  p_department_id uuid,
  p_designation_id uuid,
  p_personal_mobile text,
  p_official_mobile text,
  p_week_off text[],
  p_user_role user_role,
  p_buddy_id uuid,
  p_secondary_buddy_id uuid,
  p_reports_to_user_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  v_profile_id := invite_profile_with_audit_v3(
    p_auth_user_id, p_creator_profile_id, p_personal_email, p_first_name,
    p_last_name, p_official_email, p_branch_id, p_department_id,
    p_designation_id, p_personal_mobile, p_official_mobile, p_week_off,
    p_user_role, p_buddy_id
  );

  perform configure_invited_profile_coverage_with_audit(
    p_creator_profile_id, v_profile_id, p_secondary_buddy_id,
    p_reports_to_user_id
  );

  return v_profile_id;
end;
$$;

revoke all on function create_user_profile_with_coverage_and_audit(uuid,uuid,text,text,text,text,uuid,uuid,uuid,text,text,text[],user_role,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function create_user_profile_with_coverage_and_audit(uuid,uuid,text,text,text,text,uuid,uuid,uuid,text,text,text[],user_role,uuid,uuid,uuid) to service_role;

notify pgrst, 'reload schema';
