-- Live walk-in data: the Apps Script walk-in form ("01 WALKIN DATA") feeds the CRM project.
-- Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md
-- (phase 6); owner steps: docs/CRM_SHEETS_INGEST_CUTOVER.md.
--
-- The narrow service_role contract behind the CRM project's crm-walkin-ingest Edge Function,
-- ported from the JewelOS port's 0190 (schema crm -> public):
--   public.consume_legacy_walkin_ingest_rate_limit(text)  existing, now granted to service_role
--   public.legacy_walkin_ingest_log_attempt(...)           ledger row for outcomes decided
--                                                         before the database write
--   public.legacy_walkin_ingest_submit(...)                branch lookup + visit + ledger row +
--                                                         audit in ONE transaction
--
-- Approved addition (2026-10-05): idempotency by the Sheet's REFERENCE NUMBER. The form
-- stamps formDataObj.reference_number before it writes the Sheet row, and the original import
-- stored that number as client_timeline.reference_number. So a submission whose reference
-- number is already known (from this ingest, or from the original import) is not saved again:
-- it answers ALREADY_INGESTED with the existing ids. This makes the Sheet backfill repeatable
-- and stops a re-sent or edited Sheet entry from creating a second visit (edits made in the
-- Sheet form after ingestion are therefore not applied; they are recorded as duplicates).
--
-- Audit rows never contain payload values (names, phones, addresses): only the request id,
-- outcome and result code.

-- The identity gate (20261001000500) resolves a session only through an active grant. The
-- legacy ingest runs as a per-branch system user ('legacy-ingest+<branch>@internal.invalid',
-- created by submit_legacy_walkin_visit, never granted) with a verified service_role JWT whose
-- subject submit_legacy_walkin_visit sets, exactly as the JewelOS port's gate (0184) allowed.
-- Only that combination resolves here; a browser JWT can never carry the service_role role.
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
  UNION ALL
  SELECT profile.id
  FROM public.users AS profile
  WHERE auth.role() = 'service_role'
    AND profile.id = auth.uid()
    AND profile.active = true
    AND profile.email LIKE 'legacy-ingest+%@internal.invalid'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.current_crm_user_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_crm_user_id() TO authenticated, service_role;

CREATE TABLE crm_private.walkin_ingest_keys (
  source_reference text PRIMARY KEY CHECK (source_reference = upper(btrim(source_reference)) AND char_length(source_reference) BETWEEN 1 AND 100),
  client_id uuid NOT NULL,
  timeline_id uuid NOT NULL,
  reference_number text,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON crm_private.walkin_ingest_keys FROM PUBLIC, anon, authenticated, service_role;

-- The ledger insert shared by both RPCs. Not callable by any API role.
CREATE FUNCTION crm_private.record_legacy_walkin_attempt(
  p_request_id uuid,
  p_source_ip text,
  p_payload jsonb,
  p_payload_hash text,
  p_outcome text,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_request_id IS NULL
     OR p_outcome IS NULL
     OR p_outcome NOT IN ('unauthorized', 'payload_too_large', 'rate_limited', 'invalid_json',
                          'invalid_payload', 'rejected_files', 'invalid_branch', 'success', 'failed', 'duplicate') THEN
    RAISE EXCEPTION 'Invalid legacy walk-in ingest attempt' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.legacy_walkin_ingest_attempts (request_id, source_ip, payload, payload_hash, outcome, result)
  VALUES (
    p_request_id, left(p_source_ip, 64), COALESCE(p_payload, '{}'::jsonb),
    left(p_payload_hash, 64), p_outcome, COALESCE(p_result, '{}'::jsonb)
  );

  -- An unauthenticated caller can create ledger rows (as in the original) but must not be
  -- able to fill the audit trail, so 'unauthorized' stays ledger-only.
  IF p_outcome <> 'unauthorized' THEN
    PERFORM crm_private.write_audit_log(
      'crm.legacy_walkin_ingest_attempt', NULL,
      jsonb_build_object('request_id', p_request_id, 'outcome', p_outcome, 'code', p_result ->> 'code')
    );
  END IF;
END
$$;

CREATE FUNCTION public.legacy_walkin_ingest_log_attempt(
  p_request_id uuid,
  p_source_ip text,
  p_payload jsonb,
  p_payload_hash text,
  p_outcome text,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM crm_private.record_legacy_walkin_attempt(p_request_id, p_source_ip, p_payload, p_payload_hash, p_outcome, p_result);
END
$$;

-- Returns the ledger result: {code: INGESTED | ALREADY_INGESTED, clientId, timelineId,
-- referenceNumber}, {code: INVALID_BRANCH} or {code: INGEST_FAILED, sqlstate}. The visit, its
-- ledger row and the audit rows commit or roll back together, except that a failed visit
-- rolls back alone (subtransaction) and is still recorded as 'failed', as the original did.
CREATE FUNCTION public.legacy_walkin_ingest_submit(
  p_request_id uuid,
  p_source_ip text,
  p_branch_name text,
  p_payload jsonb,
  p_audit_payload jsonb,
  p_payload_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_branch uuid;
  v_saved record;
  v_result jsonb;
  v_state text;
  v_source text := upper(btrim(COALESCE(p_payload -> 'additional_fields' ->> 'legacy_reference_number', '')));
  v_known crm_private.walkin_ingest_keys;
  v_timeline record;
BEGIN
  IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid legacy walk-in ingest request' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_source) > 100 THEN
    v_source := '';
  END IF;

  -- Idempotency by the Sheet's reference number (see the header).
  IF v_source <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('crm.walkin_ingest:' || v_source, 0));
    SELECT * INTO v_known FROM crm_private.walkin_ingest_keys k WHERE k.source_reference = v_source;
    IF v_known.source_reference IS NULL THEN
      SELECT t.id, t.client_id, t.reference_number INTO v_timeline
      FROM public.client_timeline t
      WHERE t.reference_number = v_source OR upper(btrim(t.reference_number)) = v_source
      ORDER BY t.event_date, t.id
      LIMIT 1;
      IF v_timeline.id IS NOT NULL THEN
        INSERT INTO crm_private.walkin_ingest_keys (source_reference, client_id, timeline_id, reference_number, request_id)
        VALUES (v_source, v_timeline.client_id, v_timeline.id, v_timeline.reference_number, NULL)
        RETURNING * INTO v_known;
      END IF;
    END IF;
    IF v_known.source_reference IS NOT NULL THEN
      v_result := jsonb_build_object(
        'code', 'ALREADY_INGESTED', 'clientId', v_known.client_id,
        'timelineId', v_known.timeline_id, 'referenceNumber', v_known.reference_number
      );
      PERFORM crm_private.record_legacy_walkin_attempt(p_request_id, p_source_ip, p_audit_payload, p_payload_hash, 'duplicate', v_result);
      RETURN v_result;
    END IF;
  END IF;

  -- Same lookup as the original: an ACTIVE branch whose name matches case-insensitively.
  IF length(trim(COALESCE(p_branch_name, ''))) > 0 THEN
    SELECT b.id INTO v_branch
    FROM public.branches AS b
    WHERE b.active AND lower(b.name) = lower(p_branch_name)
    ORDER BY b.id
    LIMIT 1;
  END IF;
  IF v_branch IS NULL THEN
    v_result := jsonb_build_object('code', 'INVALID_BRANCH');
    PERFORM crm_private.record_legacy_walkin_attempt(p_request_id, p_source_ip, p_audit_payload, p_payload_hash, 'invalid_branch', v_result);
    RETURN v_result;
  END IF;

  BEGIN
    SELECT * INTO v_saved
    FROM public.submit_legacy_walkin_visit(jsonb_set(p_payload, '{branch_id}', to_jsonb(v_branch::text)));
    IF v_saved.client_id IS NULL THEN
      RAISE EXCEPTION 'The database did not return an ingestion result.';
    END IF;
    v_result := jsonb_build_object(
      'code', 'INGESTED', 'clientId', v_saved.client_id,
      'timelineId', v_saved.timeline_id, 'referenceNumber', v_saved.reference_number
    );
    IF v_source <> '' THEN
      INSERT INTO crm_private.walkin_ingest_keys (source_reference, client_id, timeline_id, reference_number, request_id)
      VALUES (v_source, v_saved.client_id, v_saved.timeline_id, v_saved.reference_number, p_request_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    v_result := jsonb_build_object('code', 'INGEST_FAILED');
    PERFORM crm_private.record_legacy_walkin_attempt(p_request_id, p_source_ip, p_audit_payload, p_payload_hash, 'failed', v_result);
    RETURN v_result || jsonb_build_object('sqlstate', v_state);
  END;

  -- A ledger outage must not replace a saved visit's result (original behaviour).
  BEGIN
    PERFORM crm_private.record_legacy_walkin_attempt(p_request_id, p_source_ip, p_audit_payload, p_payload_hash, 'success', v_result);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Could not log legacy walk-in ingestion attempt %', p_request_id;
  END;
  RETURN v_result;
END
$$;

REVOKE ALL ON FUNCTION crm_private.record_legacy_walkin_attempt(uuid, text, jsonb, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.legacy_walkin_ingest_log_attempt(uuid, text, jsonb, text, text, jsonb),
  public.legacy_walkin_ingest_submit(uuid, text, text, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.consume_legacy_walkin_ingest_rate_limit(text),
  public.legacy_walkin_ingest_log_attempt(uuid, text, jsonb, text, text, jsonb),
  public.legacy_walkin_ingest_submit(uuid, text, text, jsonb, jsonb, text)
TO service_role;
