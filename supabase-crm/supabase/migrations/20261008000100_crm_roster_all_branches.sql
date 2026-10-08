-- CRM department on every branch roster (2026-10-08 owner decision).
-- JewelOS side: supabase/migrations/0203_crm_department_all_branches.sql.
--
-- The JewelOS CRM department is one company-wide team: a snapshot with
-- `crm_roster_all_branches` true puts the person on the roster of every active CRM branch
-- (walk-in dropdown, round robin), each row with the person's JewelOS absences. Without it
-- (a Role-CRM person outside the department, or JewelOS before 0203) the person stays on
-- their own branch only, as in 20261007000900.
--
-- Per branch, as before: the branch's row under the person's name is taken over when it is
-- theirs or a pre-sync row; another synced person with that name is a conflict, counted, not
-- merged. A person's row in a branch they leave is reused for a branch they join, else a row
-- is added. Rows a person no longer holds become inactive with their future absences
-- cleared; nothing is deleted. Signature unchanged, so apply_staff_state is untouched; the
-- result's roster_conflicts now counts every branch.

CREATE OR REPLACE FUNCTION crm_private.apply_staff_roster(p_user_id uuid, p_branch_id uuid, p_name text, p_on_roster boolean, p_snapshot jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_name text := public.normalize_crm_roster_value(COALESCE(p_name, ''));
  v_branches uuid[] := '{}'::uuid[];
  v_branch uuid;
  v_kept uuid[] := '{}'::uuid[];
  v_keep public.crm_allocation;
  v_named public.crm_allocation;
  v_row public.crm_allocation;
  v_conflicts integer := 0;
  v_from date;
  v_to date;
  v_days integer := 0;
  v_count integer;
BEGIN
  IF p_on_roster AND v_name <> '' THEN
    IF COALESCE((p_snapshot ->> 'crm_roster_all_branches')::boolean, false) THEN
      SELECT COALESCE(array_agg(b.id ORDER BY b.id), '{}') INTO v_branches FROM public.branches b WHERE b.active;
    ELSIF p_branch_id IS NOT NULL THEN
      v_branches := ARRAY[p_branch_id];
    END IF;
  END IF;

  FOREACH v_branch IN ARRAY v_branches LOOP
    v_keep := NULL;
    v_named := NULL;
    v_row := NULL;
    -- The branch's row under this name, if any (one per branch and normalized name).
    SELECT * INTO v_named FROM public.crm_allocation a
    WHERE a.branch_id = v_branch AND public.normalize_crm_roster_value(a.crm_name) = v_name
    FOR UPDATE;
    IF v_named.id IS NOT NULL AND v_named.crm_user_id IS NOT NULL AND v_named.crm_user_id <> p_user_id THEN
      v_conflicts := v_conflicts + 1;
      CONTINUE;
    ELSIF v_named.id IS NOT NULL THEN
      -- The person's own row, or a row from before the sync with this name: take it.
      UPDATE public.crm_allocation SET crm_user_id = p_user_id, crm_name = v_name, active = true
      WHERE id = v_named.id RETURNING * INTO v_keep;
    ELSE
      -- A rename keeps the person's row in this branch; else a row from a branch they left
      -- moves here; else a new row.
      SELECT * INTO v_row FROM public.crm_allocation a
      WHERE a.crm_user_id = p_user_id AND a.id <> ALL (v_kept)
        AND (a.branch_id = v_branch OR NOT (a.branch_id = ANY (v_branches)))
      ORDER BY (a.branch_id = v_branch) DESC, a.active DESC, a.created_at, a.id LIMIT 1 FOR UPDATE;
      IF v_row.id IS NOT NULL THEN
        PERFORM crm_private.clear_future_availability(v_row.branch_id, v_row.crm_name, v_today);
        UPDATE public.crm_allocation SET branch_id = v_branch, crm_name = v_name, active = true
        WHERE id = v_row.id RETURNING * INTO v_keep;
      ELSE
        INSERT INTO public.crm_allocation (branch_id, crm_name, active, crm_user_id)
        VALUES (v_branch, v_name, true, p_user_id) RETURNING * INTO v_keep;
      END IF;
    END IF;
    v_kept := v_kept || v_keep.id;

    -- Absences: JewelOS Availability decides every date of the window from today on.
    IF jsonb_typeof(p_snapshot -> 'unavailable_dates') = 'array' THEN
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
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_days := greatest(v_days, v_count);
      END IF;
    END IF;
  END LOOP;

  -- Any other active row of the person leaves the roster, with its future absences.
  FOR v_row IN SELECT * FROM public.crm_allocation a
               WHERE a.crm_user_id = p_user_id AND a.active AND a.id <> ALL (v_kept) FOR UPDATE LOOP
    UPDATE public.crm_allocation SET active = false WHERE id = v_row.id;
    PERFORM crm_private.clear_future_availability(v_row.branch_id, v_row.crm_name, v_today);
  END LOOP;

  RETURN jsonb_build_object(
    'roster', CASE WHEN cardinality(v_kept) > 0 THEN 'on' WHEN v_conflicts > 0 THEN 'conflict' ELSE 'off' END,
    'roster_branches', cardinality(v_kept),
    'roster_conflicts', v_conflicts,
    'unavailable_days', v_days);
END
$$;

REVOKE ALL ON FUNCTION crm_private.apply_staff_roster(uuid, uuid, text, boolean, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
