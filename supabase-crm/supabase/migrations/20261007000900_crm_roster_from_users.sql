-- CRM roster from JewelOS Users and Availability (2026-10-07 owner decision).
-- JewelOS side: supabase/migrations/0201_crm_roster_from_users.sql.
--
-- The branch roster (crm_allocation) and "present today" (crm_daily_availability) are no
-- longer kept by hand on the CRM ROSTER / ALLOCATION page; that page is removed. Both follow
-- the JewelOS staff snapshot:
-- - `crm_roster` true (effective JewelOS role CRM) and CRM access granted -> exactly one
--   active roster row, in the person's branch, under their name. Otherwise none is active.
--   A row from before the sync with the same name in that branch is taken over; another
--   synced person with the same name in the branch is a conflict, reported, not merged.
-- - `unavailable_dates` within [`availability_from`, `availability_to`] replace the
--   person's absence rows for those dates (dates before today are history and stay).
-- - A snapshot without `crm_roster` (JewelOS before 0201) keeps the 20261005000100
--   behaviour, so the two projects can be migrated in either order.
-- - The daily reconciliation, once snapshots carry `crm_roster`, makes active roster rows
--   that no synced person holds inactive (rows are never deleted).
-- - Signed-in staff can no longer write the roster or availability.

-- ---------------------------------------------------------------------------
-- Roster and availability for one granted person
-- ---------------------------------------------------------------------------

CREATE FUNCTION crm_private.clear_future_availability(p_branch_id uuid, p_crm_name text, p_from date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.crm_daily_availability d
  WHERE d.branch_id = p_branch_id
    AND public.normalize_crm_roster_value(d.crm_name) = public.normalize_crm_roster_value(p_crm_name)
    AND d.date >= p_from;
$$;

CREATE FUNCTION crm_private.apply_staff_roster(p_user_id uuid, p_branch_id uuid, p_name text, p_on_roster boolean, p_snapshot jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_name text := public.normalize_crm_roster_value(COALESCE(p_name, ''));
  v_keep public.crm_allocation;
  v_named public.crm_allocation;
  v_row public.crm_allocation;
  v_state text := 'off';
  v_from date;
  v_to date;
  v_days integer := 0;
BEGIN
  IF p_on_roster AND p_branch_id IS NOT NULL AND v_name <> '' THEN
    -- The branch's row under this name, if any (one per branch and normalized name).
    SELECT * INTO v_named FROM public.crm_allocation a
    WHERE a.branch_id = p_branch_id AND public.normalize_crm_roster_value(a.crm_name) = v_name
    FOR UPDATE;
    IF v_named.id IS NOT NULL AND v_named.crm_user_id IS NOT NULL AND v_named.crm_user_id <> p_user_id THEN
      v_state := 'conflict';
    ELSIF v_named.id IS NOT NULL THEN
      -- The person's own row, or a row from before the sync with this name: take it.
      UPDATE public.crm_allocation SET crm_user_id = p_user_id, crm_name = v_name, active = true
      WHERE id = v_named.id RETURNING * INTO v_keep;
    ELSE
      -- A rename or branch move carries the person's existing row; else a new row.
      SELECT * INTO v_row FROM public.crm_allocation a WHERE a.crm_user_id = p_user_id
      ORDER BY a.active DESC, a.created_at, a.id LIMIT 1 FOR UPDATE;
      IF v_row.id IS NOT NULL THEN
        PERFORM crm_private.clear_future_availability(v_row.branch_id, v_row.crm_name, v_today);
        UPDATE public.crm_allocation SET branch_id = p_branch_id, crm_name = v_name, active = true
        WHERE id = v_row.id RETURNING * INTO v_keep;
      ELSE
        INSERT INTO public.crm_allocation (branch_id, crm_name, active, crm_user_id)
        VALUES (p_branch_id, v_name, true, p_user_id) RETURNING * INTO v_keep;
      END IF;
    END IF;
    IF v_keep.id IS NOT NULL THEN v_state := 'on'; END IF;
  END IF;

  -- Any other active row of the person leaves the roster, with its future absences.
  FOR v_row IN SELECT * FROM public.crm_allocation a
               WHERE a.crm_user_id = p_user_id AND a.active AND a.id IS DISTINCT FROM v_keep.id FOR UPDATE LOOP
    UPDATE public.crm_allocation SET active = false WHERE id = v_row.id;
    PERFORM crm_private.clear_future_availability(v_row.branch_id, v_row.crm_name, v_today);
  END LOOP;

  -- Absences: JewelOS Availability decides every date of the window from today on.
  IF v_keep.id IS NOT NULL AND jsonb_typeof(p_snapshot -> 'unavailable_dates') = 'array' THEN
    v_from := greatest((p_snapshot ->> 'availability_from')::date, v_today);
    v_to := (p_snapshot ->> 'availability_to')::date;
    IF v_to IS NOT NULL AND v_to >= v_from AND v_to <= v_from + 366 THEN
      DELETE FROM public.crm_daily_availability d
      WHERE d.branch_id = v_keep.branch_id
        AND public.normalize_crm_roster_value(d.crm_name) = v_keep.crm_name
        AND d.date BETWEEN v_from AND v_to;
      INSERT INTO public.crm_daily_availability (branch_id, crm_name, date, is_available)
      SELECT DISTINCT v_keep.branch_id, v_keep.crm_name, day.value::date, false
      FROM jsonb_array_elements_text(p_snapshot -> 'unavailable_dates') AS day
      WHERE day.value::date BETWEEN v_from AND v_to;
      GET DIAGNOSTICS v_days = ROW_COUNT;
    END IF;
  END IF;

  RETURN jsonb_build_object('roster', v_state, 'unavailable_days', v_days);
END
$$;

-- ---------------------------------------------------------------------------
-- apply_staff_state: as 20261005000100, with the roster step above when the snapshot
-- carries `crm_roster`.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm_private.apply_staff_state(p_snapshot jsonb)
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
  v_roster jsonb;
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

  v_roster_name := public.normalize_crm_roster_value(v_name);
  v_old_roster_name := public.normalize_crm_roster_value(v_old.name);

  IF p_snapshot ? 'crm_roster' THEN
    -- The roster follows JewelOS Users and Availability.
    v_roster := crm_private.apply_staff_roster(v_user_id, v_branch, v_name,
      COALESCE((p_snapshot ->> 'crm_roster')::boolean, false), p_snapshot);
    IF v_roster ->> 'roster' = 'conflict' THEN v_roster_conflicts := 1; END IF;
  ELSE
    -- JewelOS before 0201: roster rows follow the person (20261005000100 behaviour).
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
      UPDATE public.crm_daily_availability d SET crm_name = v_roster_name, branch_id = v_target_branch
      WHERE d.branch_id = v_row.branch_id AND d.crm_name = v_row.crm_name AND d.date >= v_today
        AND (d.branch_id, d.crm_name) IS DISTINCT FROM (v_target_branch, v_roster_name)
        AND NOT EXISTS (SELECT 1 FROM public.crm_daily_availability e
                        WHERE e.branch_id = v_target_branch AND e.crm_name = v_roster_name AND e.date = d.date);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'granted', 'reason', NULL, 'crm_user_id', v_user_id, 'created', v_created,
    'linked', v_link IS NOT NULL, 'renamed', v_old.id IS NOT NULL AND v_old_roster_name IS DISTINCT FROM v_roster_name,
    'roster_conflicts', v_roster_conflicts)
    || COALESCE(v_roster, '{}'::jsonb);
END
$$;

-- ---------------------------------------------------------------------------
-- Reconciliation: as 20261005000100, plus roster counts; with roster-carrying snapshots,
-- active roster rows that no synced person holds are made inactive.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.crm_reconcile_staff_roster(p_run_id text, p_snapshots jsonb)
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
  v_ids uuid[] := '{}'::uuid[];
  v_ineligible uuid[] := '{}'::uuid[];
  v_grant public.crm_sso_access_grants;
  v_absent integer := 0;
  v_key text;
  v_managed boolean := false;
  v_roster_conflicts integer := 0;
  v_unheld integer := 0;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_row public.crm_allocation;
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
    v_managed := v_managed OR v_snapshot ? 'crm_roster';
    v_roster_conflicts := v_roster_conflicts + COALESCE((v_result ->> 'roster_conflicts')::integer, 0);
  END LOOP;

  -- Fail closed: an active grant for anyone JewelOS no longer lists.
  FOR v_grant IN SELECT * FROM public.crm_sso_access_grants g WHERE g.active AND NOT (g.jewelos_user_id = ANY (v_ids)) FOR UPDATE LOOP
    PERFORM crm_private.close_staff_access(v_grant, 'deactivated', 'absent');
    v_absent := v_absent + 1;
  END LOOP;

  -- The roster is JewelOS's: a row no synced person holds leaves it (kept as history).
  IF v_managed THEN
    FOR v_row IN SELECT * FROM public.crm_allocation a WHERE a.active AND a.crm_user_id IS NULL FOR UPDATE LOOP
      UPDATE public.crm_allocation SET active = false WHERE id = v_row.id;
      PERFORM crm_private.clear_future_availability(v_row.branch_id, v_row.crm_name, v_today);
      v_unheld := v_unheld + 1;
    END LOOP;
  END IF;

  v_counts := v_counts || jsonb_build_object(
    'snapshots', jsonb_array_length(p_snapshots),
    'absent_deactivated', v_absent,
    'active_grants', (SELECT count(*) FROM public.crm_sso_access_grants g WHERE g.active),
    -- Must be 0: an active grant for a person JewelOS says is not eligible.
    'active_for_ineligible', (SELECT count(*) FROM public.crm_sso_access_grants g WHERE g.active AND g.jewelos_user_id = ANY (v_ineligible)),
    'unmapped_active_branches', (SELECT count(*) FROM public.branches b WHERE b.active AND b.jewelos_branch_id IS NULL),
    'roster_rows_without_user', (SELECT count(*) FROM public.crm_allocation a WHERE a.active AND a.crm_user_id IS NULL),
    'roster_unheld_deactivated', v_unheld,
    'roster_conflicts', v_roster_conflicts,
    'active_roster_rows', (SELECT count(*) FROM public.crm_allocation a WHERE a.active));

  INSERT INTO crm_private.staff_sync_runs (run_id, counts) VALUES (p_run_id, v_counts);
  PERFORM crm_private.write_audit_log('crm.staff_sync_reconcile', NULL, jsonb_build_object('run_id', p_run_id, 'counts', v_counts));
  RETURN v_counts;
END
$$;

-- ---------------------------------------------------------------------------
-- Staff no longer write the roster or availability
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON TABLE public.crm_allocation, public.crm_daily_availability FROM authenticated;
REVOKE ALL ON FUNCTION public.manage_crm_roster(text, uuid, uuid, text, uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.crm_roster_candidates(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION crm_private.clear_future_availability(uuid, text, date),
  crm_private.apply_staff_roster(uuid, uuid, text, boolean, jsonb), crm_private.apply_staff_state(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_reconcile_staff_roster(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_reconcile_staff_roster(text, jsonb) TO service_role;
