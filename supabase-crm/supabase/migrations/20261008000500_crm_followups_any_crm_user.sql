-- Any active CRM user may save any follow-up (owner decision 2026-10-08).
--
-- Owner: "anybody can get in contact and can fill the follow-up form." Referral calling and
-- Not Bought follow-ups are no longer limited by branch or roster. crm_private.works_crm_branch
-- (20261008000300) is the one check behind save_referral_followup (both overloads),
-- reconcile_referral_calling_conversions, save_not_bought_followup and
-- sync_not_bought_followups; it now passes every active CRM user, in every branch, including a
-- follow-up without a branch. The active-user rule stays: current_user_role() is NULL for a
-- person whose CRM access grant or profile is inactive (removed in JewelOS Users), and those
-- RPCs already refuse such a caller before this check. The branch argument is kept so the
-- RPC bodies stay unchanged; audit rows, status/remark validation and grants are unchanged.

CREATE OR REPLACE FUNCTION crm_private.works_crm_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.current_user_role() IS NOT NULL
$$;

REVOKE ALL ON FUNCTION crm_private.works_crm_branch(uuid) FROM PUBLIC, anon, authenticated, service_role;
