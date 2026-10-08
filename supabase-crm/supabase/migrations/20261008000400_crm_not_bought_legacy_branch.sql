-- Branch for the legacy Not Bought follow-ups (2026-10-08).
--
-- 164 follow-ups imported from the original CRM (created April 2026, status 'NO', no source
-- visit) have no branch_id. Saving one is allowed only through crm_private.works_crm_branch
-- (20261008000300), which needs a branch unless the caller is a super admin, so CRM staff got
-- "Could not save this follow-up". Each row's branch is recovered, in this order:
--   1. the visit with the row's reference number, for the same client;
--   2. the client's last visit branch (clients.last_branch_id);
--   3. the branch code inside the reference number (MK-WK-xxx-BAN-...), mapped to the branch
--      that code belongs to on every other visit (only a code used by exactly one branch).
-- Only branch_id changes: the follow-up history trigger watches status, call response, remark
-- and next date, so no history row is written. One audit row records the counts.

DO $$
DECLARE
  v_visit integer;
  v_client integer;
  v_code integer;
  v_left integer;
BEGIN
  UPDATE public.not_bought_followups f
  SET branch_id = v.branch_id
  FROM (
    SELECT DISTINCT ON (f2.id) f2.id, t.branch_id
    FROM public.not_bought_followups f2
    JOIN public.client_timeline t ON t.reference_number = f2.reference_number AND t.client_id = f2.client_id
    WHERE f2.branch_id IS NULL AND t.branch_id IS NOT NULL
    ORDER BY f2.id, t.event_date DESC, t.id
  ) v
  WHERE f.id = v.id;
  GET DIAGNOSTICS v_visit = ROW_COUNT;

  UPDATE public.not_bought_followups f
  SET branch_id = c.last_branch_id
  FROM public.clients c
  WHERE f.branch_id IS NULL AND c.client_id = f.client_id AND c.last_branch_id IS NOT NULL;
  GET DIAGNOSTICS v_client = ROW_COUNT;

  WITH codes AS (
    SELECT split_part(t.reference_number, '-', 4) AS code, min(t.branch_id::text)::uuid AS branch_id
    FROM public.client_timeline t
    WHERE t.reference_number LIKE 'MK-WK-%' AND t.branch_id IS NOT NULL
    GROUP BY 1
    HAVING count(DISTINCT t.branch_id) = 1
  )
  UPDATE public.not_bought_followups f
  SET branch_id = codes.branch_id
  FROM codes
  WHERE f.branch_id IS NULL AND f.reference_number LIKE 'MK-WK-%'
    AND split_part(f.reference_number, '-', 4) = codes.code;
  GET DIAGNOSTICS v_code = ROW_COUNT;

  SELECT count(*) INTO v_left FROM public.not_bought_followups WHERE branch_id IS NULL;

  PERFORM crm_private.write_audit_log('crm.backfill_not_bought_branch', NULL, jsonb_build_object(
    'from_visit', v_visit, 'from_client', v_client, 'from_reference_code', v_code, 'still_without_branch', v_left));
  RAISE NOTICE 'not bought branch backfill: visit %, client %, reference code %, still without branch %', v_visit, v_client, v_code, v_left;
END $$;
