-- Walk-in registration -> JewelOS task (approved extension, 2026-10-01).
-- Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md
-- ("Event catalog": walkin.registered, walkin.form_completed).
--
-- Registering a walk-in in the CRM queue creates the JewelOS task "Complete walk-in form -
-- {name} ({MKC})" for the queue's salesperson; submitting the walk-in form for that queue
-- entry (status 'complete') closes it. Completion therefore comes from durable CRM state,
-- whichever screen the form was submitted on.
--
-- Outbox, as in JewelOS 0194: a trigger enqueues one event per queue entry in the same
-- transaction as the change (one open event per entry; later changes coalesce); the delivery
-- worker (Edge Function sync-deliver, service_role) receives a snapshot computed at claim time.
-- The snapshot carries the queue id, the client's MKC and display name, the JewelOS branch,
-- and the salesperson resolved to a JewelOS person through the roster link
-- (crm_allocation.crm_user_id -> the active grant). When that does not resolve, it carries the
-- branch managers instead, and JewelOS assigns the task to one of them, flagged.
-- Queue entries created before this migration produce no events.

CREATE TABLE crm_private.sync_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('walkin.changed')),
  aggregate_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  dead_at timestamptz,
  last_error text CHECK (char_length(last_error) <= 200)
);
CREATE UNIQUE INDEX sync_outbox_one_open ON crm_private.sync_outbox (event_type, aggregate_id)
  WHERE delivered_at IS NULL AND dead_at IS NULL;
CREATE INDEX sync_outbox_due ON crm_private.sync_outbox (next_attempt_at, id)
  WHERE delivered_at IS NULL AND dead_at IS NULL;
REVOKE ALL ON crm_private.sync_outbox FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION crm_private.enqueue_walkin_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF tg_op = 'UPDATE'
     AND (NEW.status, NEW.assigned_crm_name, NEW.client_id, NEW.client_name, NEW.branch_id)
         IS NOT DISTINCT FROM (OLD.status, OLD.assigned_crm_name, OLD.client_id, OLD.client_name, OLD.branch_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO crm_private.sync_outbox (event_type, aggregate_id)
  VALUES ('walkin.changed', NEW.id)
  ON CONFLICT (event_type, aggregate_id) WHERE delivered_at IS NULL AND dead_at IS NULL
  DO UPDATE SET changed_at = clock_timestamp(), next_attempt_at = least(crm_private.sync_outbox.next_attempt_at, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER entry_queue_sync_walkin AFTER INSERT OR UPDATE ON public.entry_queue
FOR EACH ROW EXECUTE FUNCTION crm_private.enqueue_walkin_event();

-- The snapshot of one queue entry as the CRM sees it now. No phone, no address: the task
-- needs the client's display name and MKC only.
CREATE FUNCTION crm_private.walkin_snapshot(p_queue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_queue public.entry_queue;
  v_client public.clients;
  v_branch public.branches;
  v_assignee uuid;
  v_managers uuid[];
BEGIN
  SELECT * INTO v_queue FROM public.entry_queue WHERE id = p_queue_id;
  IF v_queue.id IS NULL THEN
    RETURN jsonb_build_object('queue_id', p_queue_id, 'present', false, 'snapshot_at', clock_timestamp());
  END IF;
  SELECT * INTO v_client FROM public.clients WHERE client_id = v_queue.client_id;
  SELECT * INTO v_branch FROM public.branches WHERE id = v_queue.branch_id;
  SELECT g.jewelos_user_id INTO v_assignee
  FROM public.crm_allocation a
  JOIN public.crm_sso_access_grants g ON g.legacy_crm_user_id = a.crm_user_id AND g.active
  WHERE a.branch_id = v_queue.branch_id
    AND public.normalize_crm_roster_value(a.crm_name) = public.normalize_crm_roster_value(v_queue.assigned_crm_name)
  ORDER BY a.active DESC, a.id
  LIMIT 1;
  SELECT COALESCE(array_agg(g.jewelos_user_id ORDER BY u.name, u.id), '{}') INTO v_managers
  FROM public.users u
  JOIN public.crm_sso_access_grants g ON g.legacy_crm_user_id = u.id AND g.active
  WHERE u.active AND u.role = 'branch_manager' AND u.branch_id = v_queue.branch_id;
  RETURN jsonb_build_object(
    'queue_id', v_queue.id,
    'present', true,
    'token', v_queue.token,
    'status', v_queue.status,
    'completed', v_queue.status = 'complete',
    'client_code', v_client.client_code,
    'client_name', left(COALESCE(v_client.primary_name, v_queue.client_name), 120),
    'jewelos_branch_id', v_branch.jewelos_branch_id,
    'assignee_jewelos_user_id', v_assignee,
    'manager_jewelos_user_ids', to_jsonb(v_managers),
    'registered_at', v_queue.created_at,
    'snapshot_at', clock_timestamp()
  );
END
$$;

CREATE FUNCTION public.crm_sync_claim_events(p_limit integer DEFAULT 50)
RETURNS TABLE (event_id bigint, event_type text, aggregate_id uuid, snapshot jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT o.id FROM crm_private.sync_outbox o
    WHERE o.delivered_at IS NULL AND o.dead_at IS NULL AND o.next_attempt_at <= now()
    ORDER BY o.next_attempt_at, o.id
    LIMIT greatest(1, least(COALESCE(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE crm_private.sync_outbox o
    SET claimed_at = clock_timestamp(), attempts = o.attempts + 1, next_attempt_at = now() + interval '5 minutes'
    FROM due WHERE o.id = due.id
    RETURNING o.id, o.event_type, o.aggregate_id
  )
  SELECT claimed.id, claimed.event_type, claimed.aggregate_id, crm_private.walkin_snapshot(claimed.aggregate_id)
  FROM claimed ORDER BY claimed.id;
END
$$;

CREATE FUNCTION public.crm_sync_finish_event(p_event_id bigint, p_ok boolean, p_error text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event crm_private.sync_outbox;
  v_error text := CASE WHEN p_error ~ '^[a-z0-9_.:-]{1,80}$' THEN p_error ELSE 'error' END;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_event FROM crm_private.sync_outbox WHERE id = p_event_id FOR UPDATE;
  IF v_event.id IS NULL OR v_event.delivered_at IS NOT NULL OR v_event.dead_at IS NOT NULL OR v_event.claimed_at IS NULL THEN
    RETURN 'ignored';
  END IF;
  IF p_ok THEN
    IF v_event.changed_at > v_event.claimed_at THEN
      UPDATE crm_private.sync_outbox SET attempts = 0, next_attempt_at = now(), last_error = NULL WHERE id = v_event.id;
      RETURN 'requeued';
    END IF;
    UPDATE crm_private.sync_outbox SET delivered_at = now(), last_error = NULL WHERE id = v_event.id;
    RETURN 'delivered';
  END IF;
  IF v_event.attempts >= 10 THEN
    UPDATE crm_private.sync_outbox SET dead_at = now(), last_error = v_error WHERE id = v_event.id;
    PERFORM crm_private.write_audit_log('crm.sync_event_dead', v_event.aggregate_id,
      jsonb_build_object('event_id', v_event.id, 'event_type', v_event.event_type, 'attempts', v_event.attempts, 'error', v_error));
    RETURN 'dead';
  END IF;
  UPDATE crm_private.sync_outbox
  SET next_attempt_at = now() + least(interval '1 minute' * power(2, greatest(v_event.attempts - 1, 0)), interval '6 hours'),
      last_error = v_error
  WHERE id = v_event.id;
  RETURN 'retry';
END
$$;

-- Sync health gains the outbound side (counts only).
CREATE OR REPLACE FUNCTION public.crm_sync_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
    'outbound_last_delivered_at', (SELECT max(o.delivered_at) FROM crm_private.sync_outbox o)
  );
END
$$;

REVOKE ALL ON FUNCTION crm_private.enqueue_walkin_event(), crm_private.walkin_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_sync_claim_events(integer), public.crm_sync_finish_event(bigint, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sync_claim_events(integer), public.crm_sync_finish_event(bigint, boolean, text) TO service_role;
REVOKE ALL ON FUNCTION public.crm_sync_health() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_sync_health() TO authenticated;
