-- Google Sheet sync: one-way mode first (owner decision 2026-10-06). The Sheets are the
-- production record; until two-way sync is approved, data flows Sheet -> CRM only and nothing
-- is ever written to a Sheet.
--
-- - crm_private.sheet_sync_settings.two_way (false): while false, web-app writes are not queued
--   for the Sheet, and pull / ack hand out nothing. Turning two-way on later is one UPDATE
--   (docs/CRM_SHEET_SYNC_RUNBOOK.md).
-- - The read-only Apps Script (crm-sheet-push.gs) keeps no state in the Sheets: it asks the CRM
--   for the fingerprints it holds per tab (action 'hashes') and sends only changed rows. A row
--   skipped for a lasting reason keeps its fingerprint with its error, so it is not resent
--   until it changes.

CREATE TABLE crm_private.sheet_sync_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  two_way boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO crm_private.sheet_sync_settings (id, two_way) VALUES (true, false);
REVOKE ALL ON crm_private.sheet_sync_settings FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION crm_private.sheet_two_way()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT COALESCE((SELECT s.two_way FROM crm_private.sheet_sync_settings s WHERE s.id), false) $$;
REVOKE ALL ON FUNCTION crm_private.sheet_two_way() FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE crm_private.sheet_sync_errors ADD COLUMN content_hash text CHECK (content_hash IS NULL OR char_length(content_hash) <= 128);

-- As 20261006000400, plus: nothing is queued while two-way is off.
CREATE OR REPLACE FUNCTION crm_private.sheet_enqueue(p_tab text, p_record uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF current_setting('app.sync_origin', true) = 'sheet' OR p_record IS NULL OR NOT crm_private.sheet_two_way() THEN RETURN; END IF;
  INSERT INTO crm_private.sheet_sync_outbox (tab, record_id) VALUES (p_tab, p_record)
  ON CONFLICT (tab, record_id) WHERE status = 'pending' DO NOTHING;
END
$$;

-- As 20261006000400, plus: a skipped row keeps its fingerprint with its error.
CREATE OR REPLACE FUNCTION crm_private.sheet_push(p_run uuid, p_tab text, p_rows jsonb, p_dry_run boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row jsonb;
  v_key text;
  v_hash text;
  v_values jsonb;
  v_state crm_private.sheet_sync_rows;
  v_result record;
  v_counts jsonb := '{}'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_state_code text;
BEGIN
  IF NOT p_tab = ANY (crm_private.sheet_tabs()) THEN RAISE EXCEPTION 'unknown tab' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION 'rows must be an array of at most 200' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.sync_origin', 'sheet', true);
  PERFORM set_config('app.audit_source', 'sheet_sync', true);

  BEGIN
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
      v_key := upper(btrim(COALESCE(v_row ->> 'key', '')));
      v_hash := v_row ->> 'hash';
      v_values := COALESCE(v_row -> 'values', '{}'::jsonb);
      IF v_key = '' OR char_length(v_key) > 120 OR jsonb_typeof(v_values) <> 'object' THEN
        v_counts := crm_private.sheet_bump(v_counts, 'skipped_invalid_row');
        v_results := v_results || jsonb_build_object('key', left(v_key, 120), 'outcome', 'skipped', 'reason', 'invalid_row');
        CONTINUE;
      END IF;
      SELECT * INTO v_state FROM crm_private.sheet_sync_rows s WHERE s.tab = p_tab AND s.row_key = v_key;
      IF v_state.row_key IS NOT NULL AND v_state.content_hash IS NOT DISTINCT FROM v_hash AND v_state.record_id IS NOT NULL THEN
        v_counts := crm_private.sheet_bump(v_counts, 'matched');
        v_results := v_results || jsonb_build_object('key', v_key, 'outcome', 'matched');
        CONTINUE;
      END IF;
      BEGIN
        CASE p_tab
          WHEN 'CLIENT DATABASE MASTER' THEN SELECT * INTO v_result FROM crm_private.sheet_apply_master(v_key, v_values, CASE WHEN v_state.row_key IS NULL THEN NULL ELSE v_state.sheet_values END);
          WHEN 'WALKIN DATASET' THEN SELECT * INTO v_result FROM crm_private.sheet_apply_walkin(v_key, v_values, COALESCE(v_row -> 'payload', '{}'::jsonb));
          WHEN 'FAMILY DATA' THEN SELECT * INTO v_result FROM crm_private.sheet_apply_family(v_key, v_values);
          WHEN 'REFERRALS' THEN SELECT * INTO v_result FROM crm_private.sheet_apply_referral(v_key, v_values);
          WHEN 'REFERRALS CALLING MASTER' THEN SELECT * INTO v_result FROM crm_private.sheet_apply_calling(v_key, v_values);
          ELSE SELECT * INTO v_result FROM crm_private.sheet_apply_history(v_key, v_values);
        END CASE;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state_code = RETURNED_SQLSTATE;
        SELECT 'skipped'::text AS outcome, 'apply_failed'::text AS reason, NULL::uuid AS record_id INTO v_result;
        RAISE WARNING 'sheet sync: % row failed (%)', p_tab, v_state_code;
      END;
      IF v_result.outcome = 'skipped' THEN
        v_counts := crm_private.sheet_bump(v_counts, 'skipped_' || v_result.reason);
        -- The row's fingerprint is kept with its error (except a passing failure), so an
        -- unchanged skipped row is not sent again (the one-way script asks for these).
        INSERT INTO crm_private.sheet_sync_errors (run_id, tab, row_key, reason, content_hash)
        VALUES (p_run, p_tab, v_key, v_result.reason, CASE WHEN v_result.reason <> 'apply_failed' THEN left(v_hash, 128) END)
        ON CONFLICT (tab, row_key) WHERE resolved_at IS NULL DO UPDATE SET reason = EXCLUDED.reason, run_id = EXCLUDED.run_id,
          content_hash = EXCLUDED.content_hash, created_at = now();
      ELSE
        v_counts := crm_private.sheet_bump(v_counts, v_result.outcome);
        IF v_result.reason IS NOT NULL THEN v_counts := crm_private.sheet_bump(v_counts, 'warning_' || v_result.reason); END IF;
        INSERT INTO crm_private.sheet_sync_rows (tab, row_key, record_id, content_hash, sheet_values, updated_at)
        VALUES (p_tab, v_key, v_result.record_id, left(v_hash, 128), v_values, now())
        ON CONFLICT (tab, row_key) DO UPDATE SET record_id = EXCLUDED.record_id, content_hash = EXCLUDED.content_hash,
          sheet_values = EXCLUDED.sheet_values, updated_at = now();
        UPDATE crm_private.sheet_sync_errors SET resolved_at = now() WHERE tab = p_tab AND row_key = v_key AND resolved_at IS NULL;
        -- Sheet wins over a web-app change to the same record that was still waiting, for
        -- every tab except CLIENT DATABASE MASTER (cell-level, see the header).
        IF p_tab <> 'CLIENT DATABASE MASTER' AND v_result.outcome IN ('updated', 'inserted') THEN
          UPDATE crm_private.sheet_sync_outbox SET status = 'superseded_by_sheet', reason = 'sheet_changed_first', updated_at = now()
          WHERE tab = p_tab AND record_id = v_result.record_id AND status = 'pending';
          IF FOUND THEN v_counts := crm_private.sheet_bump(v_counts, 'superseded_by_sheet'); END IF;
        END IF;
      END IF;
      v_results := v_results || jsonb_strip_nulls(jsonb_build_object('key', v_key, 'outcome', v_result.outcome, 'reason', v_result.reason,
        'client_code', CASE WHEN p_tab IN ('CLIENT DATABASE MASTER', 'FAMILY DATA') THEN v_key
                            WHEN p_tab = 'WALKIN DATASET' THEN (SELECT c.client_code FROM public.client_timeline t JOIN public.clients c ON c.client_id = t.client_id WHERE t.id = v_result.record_id) END));
    END LOOP;
    IF p_dry_run THEN
      RAISE EXCEPTION 'dry run rollback' USING ERRCODE = 'XS001';
    END IF;
  EXCEPTION WHEN SQLSTATE 'XS001' THEN
    NULL; -- every write of the dry run is rolled back; the counts stay.
  END;
  -- Later writes in the same transaction are not Sheet writes.
  PERFORM set_config('app.sync_origin', '', true);
  PERFORM set_config('app.audit_source', '', true);

  IF p_run IS NOT NULL THEN
    UPDATE crm_private.sheet_sync_runs r
    SET counts = jsonb_set(r.counts, '{push}', COALESCE(r.counts -> 'push', '{}'::jsonb)
      || jsonb_build_object(p_tab, crm_private.sheet_add_counts(r.counts -> 'push' -> p_tab, v_counts)))
    WHERE r.id = p_run;
  END IF;
  RETURN jsonb_build_object('counts', v_counts, 'results', v_results);
END
$$;

-- As 20261006000400, plus: action 'hashes'; pull / ack hand out nothing while two-way is off;
-- the import queues CRM-only clients for the Sheet only when two-way is on.
CREATE OR REPLACE FUNCTION public.crm_sheet_sync(p_action text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_run uuid;
  v_mode text;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  p_payload := COALESCE(p_payload, '{}'::jsonb);
  CASE p_action
    WHEN 'run_start' THEN
      v_mode := COALESCE(p_payload ->> 'mode', 'live');
      INSERT INTO crm_private.sheet_sync_runs (mode) VALUES (v_mode) RETURNING id INTO v_run;
      RETURN jsonb_build_object('run_id', v_run);
    WHEN 'push' THEN
      v_run := NULLIF(p_payload ->> 'run_id', '')::uuid;
      RETURN crm_private.sheet_push(v_run, p_payload ->> 'tab', COALESCE(p_payload -> 'rows', '[]'::jsonb),
        COALESCE((p_payload ->> 'dry_run')::boolean, false));
    WHEN 'hashes' THEN
      -- The fingerprints the CRM holds for a tab: rows applied, and rows skipped for a lasting
      -- reason. The one-way script sends only rows whose fingerprint differs.
      IF NOT (p_payload ->> 'tab') = ANY (crm_private.sheet_tabs()) THEN RAISE EXCEPTION 'unknown tab' USING ERRCODE = '22023'; END IF;
      RETURN jsonb_build_object('hashes', COALESCE((
        SELECT jsonb_object_agg(k, h) FROM (
          SELECT r.row_key AS k, r.content_hash AS h FROM crm_private.sheet_sync_rows r
          WHERE r.tab = p_payload ->> 'tab' AND r.content_hash IS NOT NULL
          UNION ALL
          SELECT e.row_key, e.content_hash FROM crm_private.sheet_sync_errors e
          WHERE e.tab = p_payload ->> 'tab' AND e.resolved_at IS NULL AND e.content_hash IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM crm_private.sheet_sync_rows r2 WHERE r2.tab = e.tab AND r2.row_key = e.row_key AND r2.content_hash IS NOT NULL)
        ) known), '{}'::jsonb));
    WHEN 'pull' THEN
      -- One-way mode (owner, 2026-10-06): nothing is written to the Sheet.
      IF NOT crm_private.sheet_two_way() THEN RETURN jsonb_build_object('changes', '[]'::jsonb, 'two_way', false); END IF;
      RETURN crm_private.sheet_pull(NULLIF(p_payload ->> 'limit', '')::int);
    WHEN 'ack' THEN
      IF NOT crm_private.sheet_two_way() THEN RETURN jsonb_build_object('counts', '{}'::jsonb, 'two_way', false); END IF;
      RETURN crm_private.sheet_ack(COALESCE(p_payload -> 'results', '[]'::jsonb));
    WHEN 'run_finish' THEN
      v_run := NULLIF(p_payload ->> 'run_id', '')::uuid;
      SELECT mode INTO v_mode FROM crm_private.sheet_sync_runs WHERE id = v_run;
      v_result := '{}'::jsonb;
      IF v_mode = 'import' AND COALESCE(p_payload ->> 'status', 'finished') = 'finished' AND crm_private.sheet_two_way() THEN
        v_result := jsonb_build_object('crm_only_queued', crm_private.sheet_queue_crm_only());
      END IF;
      IF v_mode IN ('import', 'dry_run') THEN
        v_result := v_result || jsonb_build_object('crm_only', (
          SELECT count(*) FROM public.clients c WHERE c.lifecycle_stage <> 'lead'
            AND NOT EXISTS (SELECT 1 FROM crm_private.sheet_sync_rows s WHERE s.tab = 'CLIENT DATABASE MASTER' AND s.row_key = c.client_code)));
      END IF;
      UPDATE crm_private.sheet_sync_runs SET
        status = CASE WHEN p_payload ->> 'status' = 'failed' THEN 'failed' ELSE 'finished' END,
        finished_at = now(),
        counts = counts || jsonb_build_object('pull', COALESCE(p_payload -> 'pull_counts', '{}'::jsonb)) || v_result
      WHERE id = v_run;
      RETURN v_result;
    ELSE
      RAISE EXCEPTION 'unknown action' USING ERRCODE = '22023';
  END CASE;
END
$$;

-- As 20261006000400, plus sheet.two_way.
CREATE OR REPLACE FUNCTION public.crm_sync_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'super admin access is required' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'staff_events_7d', COALESCE((SELECT jsonb_object_agg(k, n) FROM (
        SELECT COALESCE(i.result ->> 'reason', i.result ->> 'outcome') AS k, count(*) AS n
        FROM crm_private.sync_inbox i WHERE i.event_type = 'staff.access_changed' AND i.received_at > now() - interval '7 days'
        GROUP BY 1) t), '{}'::jsonb),
    'blocked_staff', COALESCE((SELECT jsonb_object_agg(k, n) FROM (
        SELECT s.reason AS k, count(*) AS n FROM crm_private.staff_sync_state s WHERE s.outcome = 'blocked' GROUP BY 1) t), '{}'::jsonb),
    'last_reconciliation', (SELECT jsonb_build_object('run_id', r.run_id, 'at', r.created_at, 'counts', r.counts)
        FROM crm_private.staff_sync_runs r ORDER BY r.created_at DESC LIMIT 1),
    'last_staff_event_at', (SELECT max(i.received_at) FROM crm_private.sync_inbox i WHERE i.event_type = 'staff.access_changed'),
    'active_grants', (SELECT count(*) FROM public.crm_sso_access_grants g WHERE g.active),
    'walkin_ingest_7d', COALESCE((SELECT jsonb_object_agg(k, n) FROM (
        SELECT a.outcome AS k, count(*) AS n FROM public.legacy_walkin_ingest_attempts a
        WHERE a.created_at > now() - interval '7 days' GROUP BY 1) t), '{}'::jsonb),
    'outbound_open', (SELECT count(*) FROM crm_private.sync_outbox o WHERE o.delivered_at IS NULL AND o.dead_at IS NULL),
    'outbound_failing', (SELECT count(*) FROM crm_private.sync_outbox o WHERE o.delivered_at IS NULL AND o.dead_at IS NULL AND o.last_error IS NOT NULL),
    'outbound_dead', (SELECT count(*) FROM crm_private.sync_outbox o WHERE o.dead_at IS NOT NULL),
    'outbound_oldest_open_at', (SELECT min(o.created_at) FROM crm_private.sync_outbox o WHERE o.delivered_at IS NULL AND o.dead_at IS NULL),
    'outbound_last_delivered_at', (SELECT max(o.delivered_at) FROM crm_private.sync_outbox o),
    -- Google Sheet sync (20261006000400).
    'sheet', jsonb_build_object(
      'two_way', crm_private.sheet_two_way(),
      'last_run', (SELECT jsonb_build_object('mode', r.mode, 'status', r.status, 'started_at', r.started_at, 'finished_at', r.finished_at)
          FROM crm_private.sheet_sync_runs r ORDER BY r.started_at DESC LIMIT 1),
      'last_finished_live_at', (SELECT max(r.finished_at) FROM crm_private.sheet_sync_runs r WHERE r.status = 'finished' AND r.mode = 'live'),
      'last_push_by_tab', COALESCE((SELECT jsonb_object_agg(s.tab, s.at) FROM (
          SELECT tab, max(updated_at) AS at FROM crm_private.sheet_sync_rows GROUP BY tab) s), '{}'::jsonb),
      'waiting_for_sheet', (SELECT count(*) FROM crm_private.sheet_sync_outbox o WHERE o.status = 'pending'),
      'oldest_waiting_at', (SELECT min(o.created_at) FROM crm_private.sheet_sync_outbox o WHERE o.status = 'pending'),
      'conflicts_7d', COALESCE((SELECT jsonb_object_agg(o.status, n) FROM (
          SELECT status, count(*) AS n FROM crm_private.sheet_sync_outbox
          WHERE status IN ('sheet_won', 'superseded_by_sheet', 'failed') AND updated_at > now() - interval '7 days' GROUP BY status) o), '{}'::jsonb),
      'open_errors', COALESCE((SELECT jsonb_object_agg(e.reason, n) FROM (
          SELECT reason, count(*) AS n FROM crm_private.sheet_sync_errors WHERE resolved_at IS NULL GROUP BY reason) e), '{}'::jsonb),
      'last_import', (SELECT jsonb_build_object('mode', r.mode, 'status', r.status, 'finished_at', r.finished_at, 'counts', r.counts)
          FROM crm_private.sheet_sync_runs r WHERE r.mode IN ('import', 'dry_run') ORDER BY r.started_at DESC LIMIT 1)
    )
  );
END
$function$;
