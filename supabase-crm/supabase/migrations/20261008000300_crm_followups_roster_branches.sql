-- Referral calling and Not Bought follow-ups for the whole CRM roster (2026-10-08).
--
-- The CRM department is on every branch roster (20261008000100), but the follow-up RPCs
-- still allowed only is_branch_staff(branch): the person's single CRM users.branch_id. A
-- CRM person whose JewelOS branch is Bandra could see an Andheri referral or Not Bought
-- follow-up and was refused ("you may only update ... from your own branch") on save.
--
-- crm_private.works_crm_branch(branch) = super admin, or the original branch staff rule,
-- or an active roster row (crm_allocation, synced from JewelOS Users) for this CRM user in
-- that branch. It replaces the branch check in the RPCs the Referrals Calling and Not
-- Bought pages call: save_referral_followup (both overloads), reconcile_referral_calling_
-- conversions, save_not_bought_followup and sync_not_bought_followups. Bodies are patched
-- in place (as in 20261007001100), so every other rule, the audit rows and the grants stay
-- unchanged. Reads were already company-wide; no table policy changes.

CREATE OR REPLACE FUNCTION crm_private.works_crm_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_super_admin()
    OR public.is_branch_staff(p_branch_id)
    OR EXISTS (
      SELECT 1 FROM public.crm_allocation a
      WHERE a.branch_id = p_branch_id AND a.active
        AND a.crm_user_id = public.current_crm_user_id()
    )
$$;

REVOKE ALL ON FUNCTION crm_private.works_crm_branch(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pg_temp.patch_branch_check(p_function regprocedure, p_old text, p_new text, p_expected integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE body text := replace(pg_get_functiondef(p_function), E'\r', '');
BEGIN
  IF (length(body) - length(replace(body, p_old, ''))) <> p_expected * length(p_old) THEN
    RAISE EXCEPTION '%: unexpected definition; refusing to patch', p_function;
  END IF;
  body := replace(body, p_old, p_new);
  IF body LIKE '%is_branch_staff%' THEN
    RAISE EXCEPTION '%: a branch check was left after the patch', p_function;
  END IF;
  EXECUTE body;
END $$;

SELECT pg_temp.patch_branch_check(
  'public.save_referral_followup(uuid,text,text,date,text,text,uuid)'::regprocedure,
  $o$IF NOT "public"."is_super_admin"() AND NOT "public"."is_branch_staff"(target_branch) THEN$o$,
  $n$IF NOT "crm_private"."works_crm_branch"(target_branch) THEN$n$, 1);

SELECT pg_temp.patch_branch_check(
  'public.save_referral_followup(uuid,text,text,date,text,text)'::regprocedure,
  $o$IF NOT "public"."is_super_admin"() AND NOT "public"."is_branch_staff"(target_branch) THEN$o$,
  $n$IF NOT "crm_private"."works_crm_branch"(target_branch) THEN$n$, 1);

SELECT pg_temp.patch_branch_check(
  'public.reconcile_referral_calling_conversions()'::regprocedure,
  $o$AND ("public"."is_super_admin"() OR "public"."is_branch_staff"(referral.branch_id))$o$,
  $n$AND "crm_private"."works_crm_branch"(referral.branch_id)$n$, 1);

SELECT pg_temp.patch_branch_check(
  'public.save_not_bought_followup(uuid,text,text,date,text)'::regprocedure,
  $o$IF NOT "public"."is_super_admin"() AND NOT "public"."is_branch_staff"(target.branch_id) THEN$o$,
  $n$IF NOT "crm_private"."works_crm_branch"(target.branch_id) THEN$n$, 1);

SELECT pg_temp.patch_branch_check(
  'public.sync_not_bought_followups()'::regprocedure,
  $o$IF NOT ("public"."is_super_admin"() OR "public"."is_branch_staff"(eligible.branch_id)) THEN CONTINUE; END IF;$o$,
  $n$IF NOT "crm_private"."works_crm_branch"(eligible.branch_id) THEN CONTINUE; END IF;$n$, 1);
