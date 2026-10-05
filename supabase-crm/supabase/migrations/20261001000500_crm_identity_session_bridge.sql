-- CRM project upgrade 5/5: who is signed in, for the JewelOS login bridge.
--
-- Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md,
-- "Login bridge".
-- - The bridge (a CRM-project Edge Function using service_role) verifies the caller's
--   JewelOS session.
-- - It finds the caller's active crm_sso_access_grants row and opens a CRM session as
--   that grant's CRM user. The CRM auth user id is the CRM users.id, as in the original
--   CRM, where auth.uid() was the CRM user id.
-- - So every original function and policy that uses auth.uid() keeps working unchanged.
--
-- current_crm_user_id() is the single gate behind current_user_role(),
-- current_user_branch_id(), get_my_profile(), is_super_admin() and is_branch_staff(), and
-- therefore behind every RLS policy. A session counts as a CRM user only when:
--   1. an active grant links it, and the grant's crm_auth_user_id is this session;
--   2. that grant's CRM user is this same session (legacy_crm_user_id = auth.uid());
--   3. that CRM user is active.
-- A sign-in without an active grant (for example an old CRM password) resolves to no CRM
-- user and sees nothing. Deactivating a grant (roster sync) removes access immediately.
--
-- This replaces the unused OIDC branch (identity 'sub' = jewelos_user_id). The CRM project
-- had no live users of it (2026-10-01).

CREATE OR REPLACE FUNCTION public.current_crm_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT access_grant.legacy_crm_user_id
  FROM public.crm_sso_access_grants AS access_grant
  JOIN public.users AS profile ON profile.id = access_grant.legacy_crm_user_id
  WHERE access_grant.active = true
    AND profile.active = true
    AND access_grant.crm_auth_user_id = auth.uid()
    AND access_grant.legacy_crm_user_id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.current_crm_user_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_crm_user_id() TO authenticated, service_role;

-- A grant's CRM session is always the CRM user itself. NOT VALID: rows linked by the earlier
-- OIDC experiment, if any, are left as they are (they no longer resolve, see above) and are
-- re-linked by the bridge.
ALTER TABLE public.crm_sso_access_grants
  ADD CONSTRAINT crm_sso_access_grants_session_is_crm_user
  CHECK (crm_auth_user_id IS NULL OR crm_auth_user_id = legacy_crm_user_id) NOT VALID;

-- The JewelOS sign-in's work email is stored normalized, as in JewelOS.
ALTER TABLE public.crm_sso_access_grants
  ADD CONSTRAINT crm_sso_access_grants_work_email_normalized
  CHECK (work_email = lower(btrim(work_email))) NOT VALID;
