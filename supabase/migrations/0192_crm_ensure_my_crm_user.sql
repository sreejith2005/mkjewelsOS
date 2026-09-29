-- D2 (owner decision 2026-09-28): first-use provisioning of a CRM user for an eligible JewelOS
-- profile. Design: docs/superpowers/specs/2026-09-25-crm-native-integration-design.md
-- ("Identity bridge", "Provisioning").
--
-- crm.ensure_my_crm_user() is called once by the CRM root loader before any other CRM query.
-- When the caller
--   - has an active JewelOS profile, holds crm.view, and the crm section is available
--     (the same checks as crm_private.current_crm_identity(), including Developer Mode),
--   - has a JewelOS role that maps to a CRM role (crm_private.jewelos_role_to_crm_role),
--   - (non-super roles) works in a JewelOS branch linked to a crm.branches row, and
--   - is not yet linked to any crm.users row,
-- it creates one crm.users row (name and email from the profile, the derived role, the mapped
-- branch, active) linked to the profile, and writes one public.audit_logs row
-- (crm.ensure_my_crm_user), all in one transaction.
--
-- It never matches or links an existing crm.users row by name or email. If a crm.users row
-- already carries the profile's email, nothing is created (email_in_use): that historical user
-- is linked only through the owner-approved link list (crm.link_jewelos_profile), which Phase 7
-- runs BEFORE go-live. Every other case creates nothing and changes nothing (fail closed); access
-- is still decided only by the unchanged, STABLE identity functions of 0184.
--
-- Result (for the caller's information only; the UI does not branch on it):
--   'created' | 'already_linked' | 'not_eligible' | 'email_in_use'

create function crm.ensure_my_crm_user()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.user_profiles;
  v_role crm.user_role;
  v_branch_id uuid;
  v_email text;
  v_name text;
  v_user crm.users;
begin
  if auth.role() is distinct from 'authenticated' then
    return 'not_eligible';
  end if;

  v_profile := public.current_profile();
  if v_profile.id is null
     or not public.current_profile_is_active()
     or not public.has_permission('crm.view')
     or not public.module_accessible('crm', false) then
    return 'not_eligible';
  end if;

  v_role := crm_private.jewelos_role_to_crm_role(v_profile.user_role);
  if v_role is null then
    return 'not_eligible';
  end if;

  if v_role <> 'super_admin' then
    select b.id into v_branch_id
    from crm.branches as b
    where b.jewelos_branch_id = v_profile.branch_id;
    if v_branch_id is null then
      return 'not_eligible';
    end if;
  end if;

  -- One provisioning at a time per profile (two tabs opening /crm together).
  perform pg_advisory_xact_lock(hashtextextended('crm.ensure_my_crm_user:' || v_profile.id::text, 0));

  if exists (select 1 from crm.users as u where u.jewelos_profile_id = v_profile.id) then
    return 'already_linked';
  end if;

  v_email := nullif(btrim(v_profile.email), '');
  v_name := nullif(btrim(v_profile.employee_name), '');
  if v_email is null or v_name is null or length(v_email) > 320 then
    return 'not_eligible';
  end if;
  if exists (select 1 from crm.users as u where lower(btrim(u.email)) = lower(v_email)) then
    return 'email_in_use';
  end if;

  insert into crm.users(id, name, email, role, branch_id, active, jewelos_profile_id)
  values (gen_random_uuid(), left(v_name, 160), v_email, v_role, v_branch_id, true, v_profile.id)
  returning * into v_user;

  insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (
    v_profile.tenant_id, v_profile.id, 'crm.ensure_my_crm_user', 'crm', v_user.id,
    jsonb_build_object(
      'crm_user_id', v_user.id, 'jewelos_profile_id', v_profile.id,
      'role', v_user.role, 'crm_branch_id', v_user.branch_id
    )
  );
  return 'created';
end
$$;

comment on function crm.ensure_my_crm_user() is
  'D2: creates and links a crm.users row for an eligible, not yet linked JewelOS profile (audited). Never matches existing CRM users by name or email.';

revoke all on function crm.ensure_my_crm_user() from public, anon, service_role;
grant execute on function crm.ensure_my_crm_user() to authenticated;
