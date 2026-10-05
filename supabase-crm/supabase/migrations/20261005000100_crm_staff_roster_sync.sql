-- CRM roster sync, CRM-project side: JewelOS Users is the only source of truth for CRM staff.
-- Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md
-- ("Roster sync", "Sync mechanism"); plan: docs/superpowers/plans/2026-10-05-crm-two-project-completion.md.
--
-- The JewelOS worker (crm-staff-sync) delivers one snapshot per staff member to the
-- sync-receive Edge Function, which calls crm_apply_staff_snapshot() as service_role. A
-- snapshot says who the person is in JewelOS now (name, login email, mapped CRM role,
-- JewelOS branch) and whether JewelOS allows CRM access (eligible).
--
-- Rules:
-- - Idempotent: an event id is applied once (crm_private.sync_inbox); an older snapshot
--   never overwrites a newer one (crm_private.staff_sync_state).
-- - Fail closed: not eligible, deleted, an unmapped branch, an email held by another CRM
--   user, or an unusable snapshot -> the grant, the CRM user and their roster rows are made
--   inactive. Nothing is ever deleted: CRM users hold history.
-- - Historical CRM users are linked to JewelOS people ONLY through the owner-approved link
--   list crm_private.staff_links. Nothing matches by name or email.
-- - JewelOS branches map to CRM branches only through branches.jewelos_branch_id, set by
--   the owner-approved branch map.
-- - The CRM roster (crm_allocation) is picked from synced users (crm_user_id); renames and
--   branch moves follow the person; roster rows are active exactly when the person's CRM
--   access is.
-- - Users are no longer written from the CRM API (JewelOS is the source of truth).

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

ALTER TABLE public.branches ADD COLUMN jewelos_branch_id uuid;
CREATE UNIQUE INDEX branches_jewelos_branch_id_key ON public.branches (jewelos_branch_id)
  WHERE jewelos_branch_id IS NOT NULL;
COMMENT ON COLUMN public.branches.jewelos_branch_id IS
  'Owner-approved map: the JewelOS branch whose staff work in this CRM branch.';

ALTER TABLE public.crm_allocation ADD COLUMN crm_user_id uuid REFERENCES public.users (id);
CREATE INDEX crm_allocation_crm_user_id_idx ON public.crm_allocation (crm_user_id);
COMMENT ON COLUMN public.crm_allocation.crm_user_id IS
  'The synced CRM user this roster row is for. Rows created before roster sync may be NULL.';

CREATE TABLE crm_private.staff_links (
  jewelos_user_id uuid PRIMARY KEY,
  legacy_crm_user_id uuid NOT NULL UNIQUE REFERENCES public.users (id),
  approved_by text NOT NULL CHECK (char_length(btrim(approved_by)) BETWEEN 1 AND 160),
  approved_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE crm_private.staff_links IS
  'Owner-approved link list: JewelOS user_profiles.id -> historical CRM users.id. The only way a JewelOS person takes over an existing CRM user.';

CREATE TABLE crm_private.sync_inbox (
  event_id text PRIMARY KEY CHECK (event_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  event_type text NOT NULL,
  aggregate_id uuid,
  result jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_inbox_received_at_idx ON crm_private.sync_inbox (received_at DESC);

CREATE TABLE crm_private.staff_sync_state (
  jewelos_user_id uuid PRIMARY KEY,
  snapshot_at timestamptz NOT NULL,
  outcome text NOT NULL,
  reason text,
  crm_user_id uuid,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm_private.staff_sync_runs (
  run_id text PRIMARY KEY CHECK (run_id ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  counts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON crm_private.staff_links, crm_private.sync_inbox, crm_private.staff_sync_state, crm_private.staff_sync_runs
  FROM PUBLIC, anon, authenticated, service_role;

-- JewelOS is the source of truth for staff: the CRM API no longer writes users.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.users FROM authenticated;

-- ---------------------------------------------------------------------------
-- Roster rows must be picked from synced users
-- ---------------------------------------------------------------------------

-- Applies to writes made by signed-in staff: the roster RPC runs as the caller, so this
-- trigger (SECURITY INVOKER) sees current_user = authenticated. The sync runs inside
-- SECURITY DEFINER functions (current_user = owner) and is not checked here.
CREATE FUNCTION crm_private.roster_user_name(p_user_id uuid, p_branch_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.normalize_crm_roster_value(u.name)
  FROM public.users u
  WHERE u.id = p_user_id
    AND u.active
    AND (u.role = 'super_admin' OR u.branch_id = p_branch_id)
    AND EXISTS (SELECT 1 FROM public.crm_sso_access_grants g WHERE g.legacy_crm_user_id = u.id AND g.active)
$$;

CREATE FUNCTION crm_private.check_roster_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_name text;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF tg_op = 'UPDATE'
     AND (NEW.branch_id, NEW.crm_name, NEW.crm_user_id) IS NOT DISTINCT FROM (OLD.branch_id, OLD.crm_name, OLD.crm_user_id) THEN
    RETURN NEW;
  END IF;
  v_name := crm_private.roster_user_name(NEW.crm_user_id, NEW.branch_id);
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'PLEASE SELECT A CRM USER OF THIS BRANCH.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.crm_name := v_name;
  RETURN NEW;
END
$$;

CREATE TRIGGER crm_allocation_synced_user
BEFORE INSERT OR UPDATE ON public.crm_allocation
FOR EACH ROW EXECUTE FUNCTION crm_private.check_roster_row();

-- Synced users a manager can put on a branch roster: active, with active CRM access, in
-- that branch.
CREATE FUNCTION public.crm_roster_candidates(p_branch_id uuid)
RETURNS TABLE (id uuid, name text, role public.user_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.name::text, u.role
  FROM public.users u
  WHERE public.current_user_role() IS NOT NULL
    AND u.active
    AND u.branch_id = p_branch_id
    AND EXISTS (SELECT 1 FROM public.crm_sso_access_grants g WHERE g.legacy_crm_user_id = u.id AND g.active)
  ORDER BY public.normalize_crm_roster_value(u.name), u.id
$$;

REVOKE ALL ON FUNCTION crm_private.roster_user_name(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_private.roster_user_name(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION crm_private.check_roster_row() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_private.check_roster_row() TO authenticated;
REVOKE ALL ON FUNCTION public.crm_roster_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_roster_candidates(uuid) TO authenticated;

-- manage_crm_roster: ADD and UPDATE take the picked synced user (p_crm_user_id); the stored
-- name is that user's name. Everything else is the original behaviour (audited, as in 0300).
DROP FUNCTION public.manage_crm_roster(text, uuid, uuid, text, uuid);

CREATE FUNCTION public.manage_crm_roster(
  p_operation text,
  p_roster_id uuid DEFAULT NULL::uuid,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_crm_name text DEFAULT NULL::text,
  p_target_branch_id uuid DEFAULT NULL::uuid,
  p_crm_user_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(id uuid, branch_id uuid, crm_name text, active boolean, message text)
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  action text := upper(btrim(COALESCE(p_operation, '')));
  source_row "public"."crm_allocation"%ROWTYPE;
  target_branch uuid := COALESCE(p_target_branch_id, p_branch_id);
  normalized_name text;
  existing_id uuid;
  source_branch uuid;
  actor_role "public"."user_role";
BEGIN
  actor_role := "public"."current_user_role"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF action NOT IN ('ADD', 'UPDATE', 'DELETE') THEN RAISE EXCEPTION 'invalid roster action' USING ERRCODE = 'check_violation'; END IF;
  IF action <> 'DELETE' THEN
    SELECT "public"."normalize_crm_roster_value"(u.name) INTO normalized_name FROM "public"."users" u WHERE u.id = p_crm_user_id;
    IF COALESCE(normalized_name, '') = '' THEN RAISE EXCEPTION 'PLEASE SELECT A CRM USER.' USING ERRCODE = 'check_violation'; END IF;
  END IF;

  IF action = 'ADD' THEN
    IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM "public"."branches" branch WHERE branch.id = p_branch_id AND branch.active) THEN RAISE EXCEPTION 'BRANCH NAME IS REQUIRED.' USING ERRCODE = 'check_violation'; END IF;
    IF actor_role <> 'super_admin' AND NOT "public"."is_branch_manager"(p_branch_id) THEN RAISE EXCEPTION 'branch manager access is required' USING ERRCODE = 'insufficient_privilege'; END IF;
    INSERT INTO "public"."crm_allocation" (branch_id, crm_name, active, crm_user_id) VALUES (p_branch_id, normalized_name, true, p_crm_user_id)
    RETURNING * INTO source_row;
    DELETE FROM "public"."crm_daily_availability" availability WHERE availability.branch_id = p_branch_id;
    PERFORM "crm_private"."write_audit_log"('crm.manage_crm_roster', source_row.id, jsonb_build_object('operation', action, 'branch_id', source_row.branch_id, 'crm_name', source_row.crm_name, 'crm_user_id', source_row.crm_user_id));
    RETURN QUERY SELECT source_row.id, source_row.branch_id, source_row.crm_name::text, source_row.active, 'CRM / Branch added successfully.'::text;
    RETURN;
  END IF;

  SELECT * INTO source_row FROM "public"."crm_allocation" allocation WHERE allocation.id = p_roster_id;
  IF source_row.id IS NULL THEN RAISE EXCEPTION 'CRM NAME NOT FOUND IN THIS BRANCH.' USING ERRCODE = 'check_violation'; END IF;
  source_branch := source_row.branch_id;
  IF actor_role <> 'super_admin' AND NOT "public"."is_branch_manager"(source_row.branch_id) THEN RAISE EXCEPTION 'branch manager access is required' USING ERRCODE = 'insufficient_privilege'; END IF;

  IF action = 'DELETE' THEN
    DELETE FROM "public"."crm_allocation" allocation WHERE allocation.id = source_row.id;
    DELETE FROM "public"."crm_daily_availability" availability WHERE availability.branch_id = source_row.branch_id;
    PERFORM "crm_private"."write_audit_log"('crm.manage_crm_roster', source_row.id, jsonb_build_object('operation', action, 'branch_id', source_row.branch_id, 'crm_name', source_row.crm_name));
    RETURN QUERY SELECT source_row.id, source_row.branch_id, source_row.crm_name::text, false, 'CRM deleted successfully.'::text;
    RETURN;
  END IF;

  IF target_branch IS NULL OR NOT EXISTS (SELECT 1 FROM "public"."branches" branch WHERE branch.id = target_branch AND branch.active) THEN RAISE EXCEPTION 'NEW BRANCH NAME IS REQUIRED.' USING ERRCODE = 'check_violation'; END IF;
  IF actor_role <> 'super_admin' AND NOT "public"."is_branch_manager"(target_branch) THEN RAISE EXCEPTION 'branch manager access is required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT allocation.id INTO existing_id FROM "public"."crm_allocation" allocation
  WHERE allocation.branch_id = target_branch AND "public"."normalize_crm_roster_value"(allocation.crm_name) = normalized_name AND allocation.id <> source_row.id;
  IF existing_id IS NOT NULL THEN
    DELETE FROM "public"."crm_allocation" allocation WHERE allocation.id = source_row.id;
  ELSE
    UPDATE "public"."crm_allocation" allocation SET branch_id = target_branch, crm_name = normalized_name, crm_user_id = p_crm_user_id WHERE allocation.id = source_row.id RETURNING * INTO source_row;
  END IF;
  DELETE FROM "public"."crm_daily_availability" availability WHERE availability.branch_id IN (source_branch, target_branch);
  PERFORM "crm_private"."write_audit_log"('crm.manage_crm_roster', COALESCE(existing_id, source_row.id), jsonb_build_object('operation', action, 'source_branch_id', source_branch, 'branch_id', target_branch, 'crm_name', normalized_name, 'crm_user_id', p_crm_user_id));
  RETURN QUERY SELECT COALESCE(existing_id, source_row.id), target_branch, normalized_name, true, 'CRM / Branch updated successfully.'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.manage_crm_roster(text, uuid, uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_crm_roster(text, uuid, uuid, text, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Applying one staff snapshot
-- ---------------------------------------------------------------------------

-- Makes a person's CRM access inactive (fail closed) and returns the result.
CREATE FUNCTION crm_private.close_staff_access(p_grant public.crm_sso_access_grants, p_outcome text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_grant.id IS NOT NULL THEN
    UPDATE public.crm_sso_access_grants SET active = false, updated_at = now() WHERE id = p_grant.id AND active;
    -- The CRM user stays active only while another active grant still uses it.
    UPDATE public.users u SET active = false
    WHERE u.id = p_grant.legacy_crm_user_id AND u.active
      AND NOT EXISTS (SELECT 1 FROM public.crm_sso_access_grants g WHERE g.legacy_crm_user_id = u.id AND g.active);
    UPDATE public.crm_allocation a SET active = false
    WHERE a.crm_user_id = p_grant.legacy_crm_user_id AND a.active
      AND NOT EXISTS (SELECT 1 FROM public.crm_sso_access_grants g WHERE g.legacy_crm_user_id = a.crm_user_id AND g.active);
  END IF;
  RETURN jsonb_build_object('outcome', p_outcome, 'reason', p_reason, 'crm_user_id', p_grant.legacy_crm_user_id);
END
$$;

CREATE FUNCTION crm_private.apply_staff_state(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jewelos uuid := (p_snapshot ->> 'jewelos_user_id')::uuid;
  v_eligible boolean := COALESCE((p_snapshot ->> 'present')::boolean, false) AND COALESCE((p_snapshot ->> 'eligible')::boolean, false);
  v_name text := left(btrim(COALESCE(p_snapshot ->> 'name', '')), 160);
  v_email text := lower(btrim(COALESCE(p_snapshot ->> 'email', '')));
  v_role_text text := p_snapshot ->> 'crm_role';
  v_role public.user_role;
  v_branch uuid;
  v_grant public.crm_sso_access_grants;
  v_link uuid;
  v_user_id uuid;
  v_old public.users;
  v_created boolean := false;
  v_roster_name text;
  v_old_roster_name text;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_roster_conflicts integer := 0;
  v_row public.crm_allocation;
  v_target_branch uuid;
BEGIN
  SELECT * INTO v_grant FROM public.crm_sso_access_grants WHERE jewelos_user_id = v_jewelos FOR UPDATE;

  IF NOT v_eligible THEN
    IF v_grant.id IS NULL THEN
      RETURN jsonb_build_object('outcome', 'not_eligible', 'reason', NULL, 'crm_user_id', NULL);
    END IF;
    RETURN crm_private.close_staff_access(v_grant, 'deactivated',
      CASE WHEN COALESCE((p_snapshot ->> 'present')::boolean, false) THEN 'not_eligible' ELSE 'deleted' END);
  END IF;

  IF v_role_text IS NULL OR v_role_text NOT IN ('super_admin', 'branch_manager', 'salesperson')
     OR v_name = '' OR v_email = '' OR length(v_email) > 320 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN
    RETURN crm_private.close_staff_access(v_grant, 'blocked', 'invalid_snapshot');
  END IF;
  v_role := v_role_text::public.user_role;

  IF v_role <> 'super_admin' THEN
    SELECT b.id INTO v_branch FROM public.branches b
    WHERE b.jewelos_branch_id = (p_snapshot ->> 'jewelos_branch_id')::uuid AND b.active;
    IF v_branch IS NULL THEN
      RETURN crm_private.close_staff_access(v_grant, 'blocked', 'unmapped_branch');
    END IF;
  END IF;

  -- Which CRM user: the owner-approved link, else the grant's user, else a new one.
  SELECT l.legacy_crm_user_id INTO v_link FROM crm_private.staff_links l WHERE l.jewelos_user_id = v_jewelos;
  v_user_id := COALESCE(v_link, v_grant.legacy_crm_user_id);

  IF v_user_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.users u WHERE lower(btrim(u.email)) = v_email) THEN
      -- A historical CRM user has this email: only the owner-approved link list may connect them.
      RETURN crm_private.close_staff_access(v_grant, 'blocked', 'needs_link');
    END IF;
    v_user_id := gen_random_uuid();
    v_created := true;
    INSERT INTO public.users (id, name, email, role, branch_id, active)
    VALUES (v_user_id, v_name, v_email, v_role, v_branch, true);
  ELSE
    IF EXISTS (SELECT 1 FROM public.users u WHERE lower(btrim(u.email)) = v_email AND u.id <> v_user_id) THEN
      RETURN crm_private.close_staff_access(v_grant, 'blocked', 'email_conflict');
    END IF;
    IF EXISTS (SELECT 1 FROM public.crm_sso_access_grants g
               WHERE g.legacy_crm_user_id = v_user_id AND g.jewelos_user_id <> v_jewelos AND g.active) THEN
      RETURN crm_private.close_staff_access(v_grant, 'blocked', 'crm_user_in_use');
    END IF;
    SELECT * INTO v_old FROM public.users WHERE id = v_user_id FOR UPDATE;
    UPDATE public.users
    SET name = v_name, email = v_email, role = v_role, branch_id = v_branch, active = true
    WHERE id = v_user_id;
  END IF;

  -- A session can belong to one grant only: release it from any other (inactive) grant.
  UPDATE public.crm_sso_access_grants SET crm_auth_user_id = NULL, updated_at = now()
  WHERE crm_auth_user_id = v_user_id AND jewelos_user_id <> v_jewelos;

  IF v_grant.id IS NULL THEN
    INSERT INTO public.crm_sso_access_grants (jewelos_user_id, work_email, legacy_crm_user_id, active)
    VALUES (v_jewelos, v_email, v_user_id, true);
  ELSE
    UPDATE public.crm_sso_access_grants
    SET work_email = v_email,
        legacy_crm_user_id = v_user_id,
        crm_auth_user_id = CASE WHEN legacy_crm_user_id = v_user_id THEN crm_auth_user_id ELSE NULL END,
        active = true,
        updated_at = now()
    WHERE id = v_grant.id;
    -- The grant moved to another CRM user (a new owner-approved link): the old one is closed.
    IF v_grant.legacy_crm_user_id IS DISTINCT FROM v_user_id THEN
      PERFORM crm_private.close_staff_access(v_grant, 'relinked', NULL);
    END IF;
  END IF;

  -- Roster rows follow the person: name, branch, and active exactly when access is.
  v_roster_name := public.normalize_crm_roster_value(v_name);
  v_old_roster_name := public.normalize_crm_roster_value(v_old.name);
  FOR v_row IN SELECT * FROM public.crm_allocation a WHERE a.crm_user_id = v_user_id FOR UPDATE LOOP
    v_target_branch := CASE WHEN v_role = 'super_admin' THEN v_row.branch_id ELSE v_branch END;
    IF EXISTS (SELECT 1 FROM public.crm_allocation other
               WHERE other.id <> v_row.id AND other.branch_id = v_target_branch
                 AND public.normalize_crm_roster_value(other.crm_name) = v_roster_name) THEN
      v_roster_conflicts := v_roster_conflicts + 1;
      UPDATE public.crm_allocation SET active = true WHERE id = v_row.id AND NOT active;
      CONTINUE;
    END IF;
    UPDATE public.crm_allocation SET crm_name = v_roster_name, branch_id = v_target_branch, active = true WHERE id = v_row.id;
    -- Today's and later availability exceptions move with the name.
    UPDATE public.crm_daily_availability d SET crm_name = v_roster_name, branch_id = v_target_branch
    WHERE d.branch_id = v_row.branch_id AND d.crm_name = v_row.crm_name AND d.date >= v_today
      AND (d.branch_id, d.crm_name) IS DISTINCT FROM (v_target_branch, v_roster_name)
      AND NOT EXISTS (SELECT 1 FROM public.crm_daily_availability e
                      WHERE e.branch_id = v_target_branch AND e.crm_name = v_roster_name AND e.date = d.date);
  END LOOP;

  RETURN jsonb_build_object(
    'outcome', 'granted', 'reason', NULL, 'crm_user_id', v_user_id, 'created', v_created,
    'linked', v_link IS NOT NULL, 'renamed', v_old.id IS NOT NULL AND v_old_roster_name IS DISTINCT FROM v_roster_name,
    'roster_conflicts', v_roster_conflicts);
END
$$;

CREATE FUNCTION public.crm_apply_staff_snapshot(p_event_id text, p_snapshot jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prior jsonb;
  v_jewelos uuid;
  v_at timestamptz;
  v_state crm_private.staff_sync_state;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9_.:-]{1,160}$' OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid sync event' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_jewelos := (p_snapshot ->> 'jewelos_user_id')::uuid;
    v_at := (p_snapshot ->> 'snapshot_at')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid sync event' USING ERRCODE = '22023';
  END;
  IF v_jewelos IS NULL OR v_at IS NULL THEN
    RAISE EXCEPTION 'invalid sync event' USING ERRCODE = '22023';
  END IF;

  SELECT i.result INTO v_prior FROM crm_private.sync_inbox i WHERE i.event_id = p_event_id;
  IF FOUND THEN
    RETURN v_prior || jsonb_build_object('duplicate', true);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm.staff_sync:' || v_jewelos::text, 0));
  SELECT * INTO v_state FROM crm_private.staff_sync_state WHERE jewelos_user_id = v_jewelos FOR UPDATE;
  IF v_state.jewelos_user_id IS NOT NULL AND v_state.snapshot_at >= v_at THEN
    v_result := jsonb_build_object('outcome', 'stale', 'reason', NULL, 'crm_user_id', v_state.crm_user_id);
  ELSE
    v_result := crm_private.apply_staff_state(p_snapshot);
    INSERT INTO crm_private.staff_sync_state AS s (jewelos_user_id, snapshot_at, outcome, reason, crm_user_id, applied_at)
    VALUES (v_jewelos, v_at, v_result ->> 'outcome', v_result ->> 'reason', (v_result ->> 'crm_user_id')::uuid, now())
    ON CONFLICT (jewelos_user_id) DO UPDATE
      SET snapshot_at = excluded.snapshot_at, outcome = excluded.outcome, reason = excluded.reason,
          crm_user_id = COALESCE(excluded.crm_user_id, s.crm_user_id), applied_at = excluded.applied_at;
    PERFORM crm_private.write_audit_log('crm.staff_sync_apply', (v_result ->> 'crm_user_id')::uuid,
      jsonb_build_object('event_id', p_event_id, 'jewelos_user_id', v_jewelos, 'outcome', v_result ->> 'outcome',
        'reason', v_result ->> 'reason', 'created', v_result -> 'created', 'linked', v_result -> 'linked'));
  END IF;

  INSERT INTO crm_private.sync_inbox (event_id, event_type, aggregate_id, result)
  VALUES (p_event_id, 'staff.access_changed', v_jewelos, v_result);
  RETURN v_result;
END
$$;

-- ---------------------------------------------------------------------------
-- Daily reconciliation (counts only)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.crm_reconcile_staff_roster(p_run_id text, p_snapshots jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prior jsonb;
  v_snapshot jsonb;
  v_result jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_ids uuid[] := '{}';
  v_ineligible uuid[] := '{}';
  v_grant public.crm_sso_access_grants;
  v_absent integer := 0;
  v_key text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR p_run_id !~ '^[A-Za-z0-9_.:-]{1,80}$' OR jsonb_typeof(p_snapshots) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid reconciliation run' USING ERRCODE = '22023';
  END IF;
  SELECT r.counts INTO v_prior FROM crm_private.staff_sync_runs r WHERE r.run_id = p_run_id;
  IF FOUND THEN
    RETURN v_prior || jsonb_build_object('duplicate', true);
  END IF;

  FOR v_snapshot IN SELECT value FROM jsonb_array_elements(p_snapshots) LOOP
    v_result := public.crm_apply_staff_snapshot('reconcile:' || p_run_id || ':' || (v_snapshot ->> 'jewelos_user_id'), v_snapshot);
    v_key := COALESCE(v_result ->> 'reason', v_result ->> 'outcome');
    v_counts := jsonb_set(v_counts, ARRAY[v_key], to_jsonb(COALESCE((v_counts ->> v_key)::integer, 0) + 1));
    v_ids := v_ids || (v_snapshot ->> 'jewelos_user_id')::uuid;
    IF NOT (COALESCE((v_snapshot ->> 'present')::boolean, false) AND COALESCE((v_snapshot ->> 'eligible')::boolean, false)) THEN
      v_ineligible := v_ineligible || (v_snapshot ->> 'jewelos_user_id')::uuid;
    END IF;
  END LOOP;

  -- Fail closed: an active grant for anyone JewelOS no longer lists.
  FOR v_grant IN SELECT * FROM public.crm_sso_access_grants g WHERE g.active AND NOT (g.jewelos_user_id = ANY (v_ids)) FOR UPDATE LOOP
    PERFORM crm_private.close_staff_access(v_grant, 'deactivated', 'absent');
    v_absent := v_absent + 1;
  END LOOP;

  v_counts := v_counts || jsonb_build_object(
    'snapshots', jsonb_array_length(p_snapshots),
    'absent_deactivated', v_absent,
    'active_grants', (SELECT count(*) FROM public.crm_sso_access_grants g WHERE g.active),
    -- Must be 0: an active grant for a person JewelOS says is not eligible.
    'active_for_ineligible', (SELECT count(*) FROM public.crm_sso_access_grants g WHERE g.active AND g.jewelos_user_id = ANY (v_ineligible)),
    'unmapped_active_branches', (SELECT count(*) FROM public.branches b WHERE b.active AND b.jewelos_branch_id IS NULL),
    'roster_rows_without_user', (SELECT count(*) FROM public.crm_allocation a WHERE a.active AND a.crm_user_id IS NULL));

  INSERT INTO crm_private.staff_sync_runs (run_id, counts) VALUES (p_run_id, v_counts);
  PERFORM crm_private.write_audit_log('crm.staff_sync_reconcile', NULL, jsonb_build_object('run_id', p_run_id, 'counts', v_counts));
  RETURN v_counts;
END
$$;

-- ---------------------------------------------------------------------------
-- Sync health for CRM super admins (counts only)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.crm_sync_health()
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
        WHERE a.created_at > now() - interval '7 days' GROUP BY 1) t), '{}'::jsonb)
  );
END
$$;

REVOKE ALL ON FUNCTION crm_private.close_staff_access(public.crm_sso_access_grants, text, text), crm_private.apply_staff_state(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_apply_staff_snapshot(text, jsonb), public.crm_reconcile_staff_roster(text, jsonb), public.crm_sync_health()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_apply_staff_snapshot(text, jsonb), public.crm_reconcile_staff_roster(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_sync_health() TO authenticated;
