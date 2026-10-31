-- Google Sheet <-> CRM sync, behaviour (owner-approved design 2026-10-06,
-- https://claude.ai/artifact/MBHPPoH1pRbPJF9jExCL2D; plan docs/superpowers/plans/2026-10-06-crm-sheet-sync.md).
--
-- Entry point: public.crm_sheet_sync(action, payload), service_role only, called by the
-- crm-sheet-sync Edge Function for the Apps Script in the MK JEWELS CRM SYSTEM project.
--   run_start  {mode}                          -> {run_id}
--   push       {run_id, tab, dry_run, rows[]}  -> {counts, results[]}   Sheet -> CRM
--   pull       {limit}                         -> {changes[]}           CRM -> Sheet
--   ack        {results[]}                     -> {counts}
--   run_finish {run_id, status, counts}        -> {}
--
-- Rules:
-- - Sheet wins. A pushed row is applied over the CRM. For CLIENT DATABASE MASTER only the
--   cells that changed in the Sheet since its last push are applied, so a web-app edit to
--   another cell of the same client survives and is pulled to the Sheet. A pull hands each
--   cell with its base (the Sheet's last known value); the script skips a cell whose Sheet
--   value no longer equals the base and reports sheet_won.
-- - Idempotent. A row whose fingerprint is unchanged is 'matched' without any write; a
--   visit, family membership, referral or history row is found by its key before anything
--   is created.
-- - No echo. Writes made by a push run with app.sync_origin = 'sheet'; the outbox triggers
--   ignore them. Only web-app writes reach the outbox.
-- - Dry run. A push with dry_run = true does all the work in a subtransaction that is rolled
--   back, and returns the same counts.
-- - Logs carry keys, outcomes and reason codes only, never names or phones.

-- ---------------------------------------------------------------------------
-- Parsing helpers (Sheet text -> CRM types)
-- ---------------------------------------------------------------------------

CREATE FUNCTION crm_private.sheet_text(p_values jsonb, p_column text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT NULLIF(btrim(COALESCE(p_values ->> p_column, '')), '') $$;

CREATE FUNCTION crm_private.sheet_parse_date(p_value text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE m text[];
BEGIN
  m := regexp_match(btrim(COALESCE(p_value, '')), '^(\d{4})[-/](\d{1,2})[-/](\d{1,2})');
  IF m IS NOT NULL THEN RETURN make_date(m[1]::int, m[2]::int, m[3]::int); END IF;
  m := regexp_match(btrim(COALESCE(p_value, '')), '^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})');
  IF m IS NOT NULL THEN RETURN make_date(m[3]::int, m[2]::int, m[1]::int); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;

CREATE FUNCTION crm_private.sheet_parse_time(p_value text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_day date := crm_private.sheet_parse_date(p_value);
  m text[];
BEGIN
  IF v_day IS NULL THEN RETURN NULL; END IF;
  m := regexp_match(btrim(p_value), '\s(\d{1,2}):(\d{2})(?::(\d{2}))?');
  RETURN (v_day + make_time(COALESCE(m[1], '0')::int, COALESCE(m[2], '0')::int, COALESCE(m[3], '0')::double precision))
    AT TIME ZONE 'Asia/Kolkata';
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;

CREATE FUNCTION crm_private.sheet_split(p_value text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT COALESCE((SELECT array_agg(item ORDER BY ord) FROM (
    SELECT btrim(part) AS item, ord FROM unnest(string_to_array(COALESCE(p_value, ''), ',')) WITH ORDINALITY AS t(part, ord)
  ) parts WHERE item <> '' AND ord <= 40), ARRAY[]::text[])
$$;

CREATE FUNCTION crm_private.sheet_potential(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT allowed FROM unnest(ARRAY['Cold Lead', 'Cool Lead', 'Warm Lead', 'Hot Lead', 'VIP Lead']) AS allowed
  WHERE lower(allowed) = lower(btrim(COALESCE(p_value, '')))
$$;

CREATE FUNCTION crm_private.sheet_branch_id(p_name text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT b.id FROM public.branches b
  WHERE crm_private.branch_match_key(b.name) = crm_private.branch_match_key(p_name)
    AND crm_private.branch_match_key(p_name) <> ''
  ORDER BY b.active DESC, b.id LIMIT 1
$$;

CREATE FUNCTION crm_private.sheet_user_id(p_name text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT u.id FROM public.users u
  WHERE public.normalize_crm_roster_value(u.name) = public.normalize_crm_roster_value(p_name)
    AND COALESCE(public.normalize_crm_roster_value(p_name), '') <> ''
  ORDER BY u.active DESC, u.id LIMIT 1
$$;

-- The system user named as salesperson on a Sheet referral whose salesperson is not on the
-- roster (referrals.salesperson_id is required). Inactive and without an access grant, so it
-- can never sign in; the role is the one that needs no branch.
INSERT INTO public.users (id, name, email, role, branch_id, active)
VALUES ('5eee5eee-0000-4000-8000-000000000001', 'Google Sheet Sync', 'sheet-sync@internal.invalid', 'super_admin', NULL, false)
ON CONFLICT DO NOTHING;

-- The client with this MKC, when the given phone and name do not contradict it.
CREATE FUNCTION crm_private.sheet_client_by_code(p_code text, p_phone text, p_name text, OUT client_id uuid, OUT conflict boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_phone text := crm_private.phone_key(p_phone);
  v_name text := crm_private.name_key(p_name);
  v_client public.clients;
BEGIN
  conflict := false;
  SELECT * INTO v_client FROM public.clients c WHERE c.client_code = upper(btrim(COALESCE(p_code, '')));
  IF v_client.client_id IS NULL THEN RETURN; END IF;
  IF v_phone IS NOT NULL AND EXISTS (SELECT 1 FROM public.client_phone_index pi WHERE pi.client_id = v_client.client_id)
     AND NOT EXISTS (SELECT 1 FROM public.client_phone_index pi WHERE pi.client_id = v_client.client_id AND pi.phone = v_phone) THEN
    conflict := true; RETURN;
  END IF;
  IF v_name IS NOT NULL AND crm_private.name_key(v_client.primary_name) IS NOT NULL
     AND crm_private.name_key(v_client.primary_name) <> v_name
     AND NOT EXISTS (SELECT 1 FROM unnest(v_client.other_names) other(name) WHERE crm_private.name_key(other.name) = v_name) THEN
    conflict := true; RETURN;
  END IF;
  client_id := v_client.client_id;
END
$$;

-- Finds the person for a Sheet row: by MKC (when it agrees), else phone + name. A found
-- client takes the Sheet's MKC when that code is free. Returns (client_id, outcome) where
-- outcome is 'found' | 'conflict' | 'none'.
CREATE FUNCTION crm_private.sheet_resolve_client(p_code text, p_phone text, p_name text, OUT client_id uuid, OUT outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_code text := NULLIF(upper(btrim(COALESCE(p_code, ''))), '');
  v_by_code record;
BEGIN
  IF v_code IS NOT NULL AND v_code !~ '^MKC-[0-9]+$' THEN v_code := NULL; END IF;
  SELECT * INTO v_by_code FROM crm_private.sheet_client_by_code(v_code, p_phone, p_name);
  IF v_by_code.client_id IS NOT NULL THEN
    client_id := v_by_code.client_id; outcome := 'found'; RETURN;
  END IF;
  client_id := crm_private.match_client(p_phone, p_name);
  IF client_id IS NOT NULL THEN
    IF v_code IS NOT NULL AND NOT v_by_code.conflict
       AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.client_code = v_code) THEN
      UPDATE public.clients SET client_code = v_code WHERE clients.client_id = sheet_resolve_client.client_id;
    END IF;
    outcome := 'found'; RETURN;
  END IF;
  outcome := CASE WHEN v_by_code.conflict THEN 'conflict' ELSE 'none' END;
END
$$;

-- ---------------------------------------------------------------------------
-- Per-tab apply (Sheet -> CRM). Each returns (outcome, reason, record_id);
-- outcome: inserted | updated | matched | skipped.
-- ---------------------------------------------------------------------------

CREATE FUNCTION crm_private.sheet_apply_master(p_key text, p_values jsonb, p_old jsonb,
  OUT outcome text, OUT reason text, OUT record_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v jsonb := p_values;
  v_phone text := COALESCE(crm_private.sheet_text(p_values, 'PHONE KEY'), crm_private.sheet_text(p_values, 'PRIMARY PHONE'), crm_private.sheet_text(p_values, 'BILLING PHONE'));
  v_name text := crm_private.sheet_text(p_values, 'PRIMARY NAME');
  v_resolved record;
  v_changed text[];
  v_before public.clients;
  v_after public.clients;
  v_potential text := crm_private.sheet_text(p_values, 'CLIENT POTENTIAL CATEGORY');
BEGIN
  IF p_key !~ '^MKC-[0-9]+$' THEN outcome := 'skipped'; reason := 'invalid_client_id'; RETURN; END IF;
  IF v_name IS NULL AND v_phone IS NULL THEN outcome := 'skipped'; reason := 'no_phone_no_name'; RETURN; END IF;
  SELECT * INTO v_resolved FROM crm_private.sheet_resolve_client(p_key, v_phone, v_name);
  IF v_resolved.outcome = 'conflict' THEN outcome := 'skipped'; reason := 'mkc_identity_conflict'; RETURN; END IF;

  -- Cells that changed in the Sheet since its last push (all of them the first time).
  SELECT array_agg(k) INTO v_changed FROM jsonb_object_keys(v) AS k
  WHERE p_old IS NULL OR (v ->> k) IS DISTINCT FROM (p_old ->> k);
  v_changed := COALESCE(v_changed, ARRAY[]::text[]);

  IF v_resolved.client_id IS NULL THEN
    INSERT INTO public.clients (client_code, primary_name, primary_phone, lifecycle_stage)
    VALUES (p_key, COALESCE(v_name, 'CLIENT ' || p_key), crm_private.sheet_text(v, 'PRIMARY PHONE'), 'visited')
    RETURNING clients.client_id INTO record_id;
    outcome := 'inserted';
    v_changed := ARRAY(SELECT jsonb_object_keys(v));
  ELSE
    record_id := v_resolved.client_id;
    outcome := 'matched';
  END IF;
  IF v_potential IS NOT NULL AND crm_private.sheet_potential(v_potential) IS NULL THEN
    v_changed := array_remove(v_changed, 'CLIENT POTENTIAL CATEGORY');
    reason := 'invalid_potential_category';
  END IF;

  SELECT * INTO v_before FROM public.clients c WHERE c.client_id = record_id;
  UPDATE public.clients c SET
    primary_name = CASE WHEN 'PRIMARY NAME' = ANY (v_changed) AND v_name IS NOT NULL THEN v_name ELSE c.primary_name END,
    other_names = CASE WHEN 'OTHER NAMES' = ANY (v_changed) THEN crm_private.sheet_split(v ->> 'OTHER NAMES') ELSE c.other_names END,
    primary_phone = CASE WHEN 'PRIMARY PHONE' = ANY (v_changed) THEN crm_private.sheet_text(v, 'PRIMARY PHONE') ELSE c.primary_phone END,
    secondary_phone = CASE WHEN 'SECONDARY PHONE' = ANY (v_changed) THEN crm_private.sheet_text(v, 'SECONDARY PHONE') ELSE c.secondary_phone END,
    billing_phone = CASE WHEN 'BILLING PHONE' = ANY (v_changed) THEN crm_private.sheet_text(v, 'BILLING PHONE') ELSE c.billing_phone END,
    other_known_phones = CASE WHEN 'OTHER KNOWN PHONES' = ANY (v_changed) THEN crm_private.sheet_split(v ->> 'OTHER KNOWN PHONES') ELSE c.other_known_phones END,
    gender = CASE WHEN 'GENDER' = ANY (v_changed) THEN crm_private.sheet_text(v, 'GENDER') ELSE c.gender END,
    country = CASE WHEN 'COUNTRY' = ANY (v_changed) THEN crm_private.sheet_text(v, 'COUNTRY') ELSE c.country END,
    state = CASE WHEN 'STATE' = ANY (v_changed) THEN crm_private.sheet_text(v, 'STATE') ELSE c.state END,
    city = CASE WHEN 'CITY' = ANY (v_changed) THEN crm_private.sheet_text(v, 'CITY') ELSE c.city END,
    city_other = CASE WHEN 'CITY OTHER' = ANY (v_changed) THEN crm_private.sheet_text(v, 'CITY OTHER') ELSE c.city_other END,
    pincode = CASE WHEN 'PINCODE' = ANY (v_changed) THEN crm_private.sheet_text(v, 'PINCODE') ELSE c.pincode END,
    address = CASE WHEN 'ADDRESS' = ANY (v_changed) THEN crm_private.sheet_text(v, 'ADDRESS') ELSE c.address END,
    community = CASE WHEN 'COMMUNITY' = ANY (v_changed) THEN crm_private.sheet_text(v, 'COMMUNITY') ELSE c.community END,
    community_other = CASE WHEN 'COMMUNITY OTHER' = ANY (v_changed) THEN crm_private.sheet_text(v, 'COMMUNITY OTHER') ELSE c.community_other END,
    dob = CASE WHEN 'DOB' = ANY (v_changed) THEN crm_private.sheet_parse_date(v ->> 'DOB') ELSE c.dob END,
    anniversary = CASE WHEN 'ANNIVERSARY' = ANY (v_changed) THEN crm_private.sheet_parse_date(v ->> 'ANNIVERSARY') ELSE c.anniversary END,
    beverage = CASE WHEN 'BEVERAGE' = ANY (v_changed) THEN crm_private.sheet_text(v, 'BEVERAGE') ELSE c.beverage END,
    sugar = CASE WHEN 'SUGAR' = ANY (v_changed) THEN crm_private.sheet_text(v, 'SUGAR') ELSE c.sugar END,
    snack = CASE WHEN 'SNACK' = ANY (v_changed) THEN crm_private.sheet_text(v, 'SNACK') ELSE c.snack END,
    gift_history = CASE WHEN 'GIFT HISTORY' = ANY (v_changed) THEN to_jsonb(crm_private.sheet_split(v ->> 'GIFT HISTORY')) ELSE c.gift_history END,
    client_potential_category = CASE WHEN 'CLIENT POTENTIAL CATEGORY' = ANY (v_changed) THEN crm_private.sheet_potential(v ->> 'CLIENT POTENTIAL CATEGORY') ELSE c.client_potential_category END,
    high_potential_reason = CASE WHEN 'HIGH POTENTIAL REASON' = ANY (v_changed) THEN crm_private.sheet_text(v, 'HIGH POTENTIAL REASON') ELSE c.high_potential_reason END,
    instagram_status = CASE WHEN 'INSTAGRAM STATUS' = ANY (v_changed) THEN crm_private.sheet_text(v, 'INSTAGRAM STATUS') ELSE c.instagram_status END,
    google_review_status = CASE WHEN 'GOOGLE REVIEW STATUS' = ANY (v_changed) THEN crm_private.sheet_text(v, 'GOOGLE REVIEW STATUS') ELSE c.google_review_status END,
    testimonial_status = CASE WHEN 'TESTIMONIAL STATUS' = ANY (v_changed) THEN crm_private.sheet_text(v, 'TESTIMONIAL STATUS') ELSE c.testimonial_status END,
    referral_status = CASE WHEN 'REFERRAL STATUS' = ANY (v_changed) THEN crm_private.sheet_text(v, 'REFERRAL STATUS') ELSE c.referral_status END,
    next_visit_date = CASE WHEN 'NEXT VISIT DATE' = ANY (v_changed) THEN crm_private.sheet_parse_date(v ->> 'NEXT VISIT DATE') ELSE c.next_visit_date END,
    lifecycle_stage = CASE WHEN c.lifecycle_stage IN ('lead', 'engaged') THEN 'visited' ELSE c.lifecycle_stage END
  WHERE c.client_id = record_id
  RETURNING * INTO v_after;
  IF outcome = 'matched' AND (to_jsonb(v_after) - 'profile_updated_at' - 'profile_updated_by')
       IS DISTINCT FROM (to_jsonb(v_before) - 'profile_updated_at' - 'profile_updated_by') THEN
    outcome := 'updated';
  END IF;
END
$$;

-- p_payload is the canonical walk-in payload the Edge Function built from the row (the same
-- mapping as the crm-walkin-ingest feed).
CREATE FUNCTION crm_private.sheet_apply_walkin(p_key text, p_values jsonb, p_payload jsonb,
  OUT outcome text, OUT reason text, OUT record_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_known crm_private.walkin_ingest_keys;
  v_timeline uuid;
  v_branch uuid := crm_private.sheet_branch_id(p_values ->> 'BRANCH');
  v_resolved record;
  v_payload jsonb := p_payload;
  v_saved record;
  v_status text := NULLIF(upper(p_payload -> 'additional_fields' ->> 'visit_status'), '');
  v_before jsonb;
  v_profile public.clients;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('crm.walkin_ingest:' || p_key, 0));
  SELECT * INTO v_known FROM crm_private.walkin_ingest_keys k WHERE k.source_reference = p_key;
  v_timeline := v_known.timeline_id;
  IF v_timeline IS NULL THEN
    SELECT t.id INTO v_timeline FROM public.client_timeline t WHERE upper(btrim(t.reference_number)) = p_key ORDER BY t.event_date, t.id LIMIT 1;
  END IF;

  IF v_timeline IS NOT NULL THEN
    record_id := v_timeline;
    SELECT to_jsonb(t) || COALESCE(to_jsonb(f) - 'id' - 'created_at' - 'updated_at', '{}'::jsonb) INTO v_before
    FROM public.client_timeline t LEFT JOIN public.visit_forms f ON f.client_timeline_id = t.id WHERE t.id = v_timeline;
    -- Sheet wins: the visit takes the row's current values.
    UPDATE public.client_timeline t SET
      event_date = COALESCE(NULLIF(p_payload ->> 'event_date', '')::timestamptz, t.event_date),
      branch_id = COALESCE(v_branch, t.branch_id),
      crm_name = NULLIF(btrim(p_payload ->> 'crm_name'), ''),
      seen_categories = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload -> 'seen_categories', '[]'::jsonb))), ARRAY[]::text[]),
      bought_categories = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload -> 'bought_categories', '[]'::jsonb))), ARRAY[]::text[]),
      order_categories = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload -> 'order_categories', '[]'::jsonb))), ARRAY[]::text[]),
      product_requirement = NULLIF(btrim(p_payload ->> 'product_requirement'), ''),
      remark = NULLIF(btrim(p_payload ->> 'remark'), ''),
      buy_status = CASE WHEN v_status IN (SELECT unnest(enum_range(NULL::public.buy_status))::text) THEN v_status::public.buy_status ELSE t.buy_status END
    WHERE t.id = v_timeline;
    UPDATE public.visit_forms f SET
      category_details = COALESCE(p_payload -> 'category_details', f.category_details),
      not_bought_reasons = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload -> 'not_bought_reasons', '[]'::jsonb))), ARRAY[]::text[]),
      not_bought_other = NULLIF(btrim(p_payload ->> 'not_bought_other'), ''),
      repair_or_order_approach = NULLIF(btrim(p_payload ->> 'repair_or_order_approach'), ''),
      did_buy = COALESCE((p_payload ->> 'did_buy')::boolean, f.did_buy),
      marketing_message_sent = NULLIF(btrim(p_payload ->> 'marketing_message_sent'), ''),
      occupation = NULLIF(btrim(p_payload ->> 'occupation'), ''),
      communication_preference = NULLIF(btrim(p_payload ->> 'communication_preference'), ''),
      instagram_asked = (p_payload -> 'engagement' -> 'instagram' ->> 'asked')::boolean,
      google_review_asked = (p_payload -> 'engagement' -> 'google_review' ->> 'asked')::boolean,
      testimonial_asked = (p_payload -> 'engagement' -> 'testimonial' ->> 'asked')::boolean,
      feedback_form_asked = (p_payload -> 'engagement' -> 'feedback_form' ->> 'asked')::boolean,
      thank_you_note_asked = (p_payload -> 'engagement' -> 'thank_you_note' ->> 'asked')::boolean,
      referrals_asked = (p_payload -> 'engagement' -> 'referrals' ->> 'asked')::boolean,
      instagram_proof_url = NULLIF(p_payload -> 'proof_urls' ->> 'instagram', ''),
      google_review_proof_url = NULLIF(p_payload -> 'proof_urls' ->> 'google_review', ''),
      testimonial_proof_url = NULLIF(p_payload -> 'proof_urls' ->> 'testimonial', ''),
      feedback_form_proof_url = NULLIF(p_payload -> 'proof_urls' ->> 'feedback_form', ''),
      thank_you_note_proof_url = NULLIF(p_payload -> 'proof_urls' ->> 'thank_you_note', ''),
      referrals_proof_url = NULLIF(p_payload -> 'proof_urls' ->> 'referrals', ''),
      additional_fields = f.additional_fields || COALESCE(p_payload -> 'additional_fields', '{}'::jsonb)
    WHERE f.client_timeline_id = v_timeline;
    IF v_known.source_reference IS NULL THEN
      INSERT INTO crm_private.walkin_ingest_keys (source_reference, client_id, timeline_id, reference_number)
      SELECT p_key, t.client_id, t.id, t.reference_number FROM public.client_timeline t WHERE t.id = v_timeline
      ON CONFLICT DO NOTHING;
    END IF;
    outcome := CASE WHEN v_before IS DISTINCT FROM (
      SELECT to_jsonb(t) || COALESCE(to_jsonb(f) - 'id' - 'created_at' - 'updated_at', '{}'::jsonb)
      FROM public.client_timeline t LEFT JOIN public.visit_forms f ON f.client_timeline_id = t.id WHERE t.id = v_timeline)
      THEN 'updated' ELSE 'matched' END;
    RETURN;
  END IF;

  IF v_branch IS NULL THEN outcome := 'skipped'; reason := 'branch_unknown'; RETURN; END IF;
  IF length(regexp_replace(COALESCE(p_payload ->> 'primary_phone', ''), '[^0-9]', '', 'g')) < 10
     OR NULLIF(btrim(p_payload ->> 'primary_name'), '') IS NULL THEN
    outcome := 'skipped'; reason := 'no_phone_or_name'; RETURN;
  END IF;
  SELECT * INTO v_resolved FROM crm_private.sheet_resolve_client(p_values ->> 'CRM CLIENT ID', p_payload ->> 'primary_phone', p_payload ->> 'primary_name');
  IF v_resolved.client_id IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('client_id', v_resolved.client_id);
    SELECT * INTO v_profile FROM public.clients c WHERE c.client_id = v_resolved.client_id;
  END IF;
  v_payload := jsonb_set(v_payload || jsonb_build_object('branch_id', v_branch), '{additional_fields,legacy_reference_number}', to_jsonb(p_key));
  SELECT * INTO v_saved FROM public.submit_legacy_walkin_visit(v_payload);
  record_id := v_saved.timeline_id;
  -- The profile of a known client comes from CLIENT DATABASE MASTER, which merges visits the
  -- Sheet's way (a blank answer keeps the old value); submit_walkin_visit would overwrite it.
  IF v_profile.client_id IS NOT NULL THEN
    UPDATE public.clients c SET
      primary_name = v_profile.primary_name, billing_phone = v_profile.billing_phone, gender = v_profile.gender,
      country = v_profile.country, state = v_profile.state, city = v_profile.city, city_other = v_profile.city_other,
      pincode = v_profile.pincode, address = v_profile.address, community = v_profile.community,
      community_other = v_profile.community_other, dob = v_profile.dob, anniversary = v_profile.anniversary,
      beverage = v_profile.beverage, sugar = v_profile.sugar, snack = v_profile.snack,
      next_visit_date = v_profile.next_visit_date, client_potential_category = v_profile.client_potential_category,
      high_potential_reason = v_profile.high_potential_reason, last_remark = v_profile.last_remark,
      last_product_requirement = v_profile.last_product_requirement, last_seen_categories = v_profile.last_seen_categories,
      last_bought_categories = v_profile.last_bought_categories, last_order_categories = v_profile.last_order_categories
    WHERE c.client_id = v_profile.client_id;
  END IF;
  -- A new client from a Sheet row takes the row's MKC.
  IF v_resolved.client_id IS NULL AND (p_values ->> 'CRM CLIENT ID') ~ '^MKC-[0-9]+$'
     AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.client_code = p_values ->> 'CRM CLIENT ID') THEN
    UPDATE public.clients SET client_code = p_values ->> 'CRM CLIENT ID' WHERE client_id = v_saved.client_id;
  END IF;
  UPDATE public.client_timeline t SET buy_status = v_status::public.buy_status
  WHERE t.id = record_id AND v_status IN (SELECT unnest(enum_range(NULL::public.buy_status))::text);
  UPDATE public.visit_forms f SET
    instagram_proof_url = NULLIF(p_payload -> 'proof_urls' ->> 'instagram', ''),
    google_review_proof_url = NULLIF(p_payload -> 'proof_urls' ->> 'google_review', ''),
    testimonial_proof_url = NULLIF(p_payload -> 'proof_urls' ->> 'testimonial', ''),
    feedback_form_proof_url = NULLIF(p_payload -> 'proof_urls' ->> 'feedback_form', ''),
    thank_you_note_proof_url = NULLIF(p_payload -> 'proof_urls' ->> 'thank_you_note', ''),
    referrals_proof_url = NULLIF(p_payload -> 'proof_urls' ->> 'referrals', '')
  WHERE f.client_timeline_id = record_id;
  INSERT INTO crm_private.walkin_ingest_keys (source_reference, client_id, timeline_id, reference_number)
  VALUES (p_key, v_saved.client_id, v_saved.timeline_id, v_saved.reference_number)
  ON CONFLICT DO NOTHING;
  outcome := 'inserted';
END
$$;

CREATE FUNCTION crm_private.sheet_apply_family(p_key text, p_values jsonb,
  OUT outcome text, OUT reason text, OUT record_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_family text := upper(btrim(COALESCE(p_values ->> 'FAMILY ID', '')));
  v_relation text := upper(btrim(COALESCE(p_values ->> 'RELATION', '')));
  v_resolved record;
  v_household uuid;
  v_before public.clients;
  v_after public.clients;
BEGIN
  IF p_key !~ '^MKC-[0-9]+$' THEN outcome := 'skipped'; reason := 'invalid_client_id'; RETURN; END IF;
  IF v_family !~ '^MKF-[0-9]+$' THEN outcome := 'skipped'; reason := 'invalid_family_id'; RETURN; END IF;
  SELECT * INTO v_resolved FROM crm_private.sheet_resolve_client(p_key, p_values ->> 'NUMBER', p_values ->> 'FAMILY');
  IF v_resolved.outcome = 'conflict' THEN outcome := 'skipped'; reason := 'mkc_identity_conflict'; RETURN; END IF;
  record_id := v_resolved.client_id;
  outcome := 'matched';
  IF record_id IS NULL THEN
    IF crm_private.sheet_text(p_values, 'FAMILY') IS NULL THEN outcome := 'skipped'; reason := 'client_not_found'; RETURN; END IF;
    INSERT INTO public.clients (client_code, primary_name, primary_phone, lifecycle_stage)
    VALUES (p_key, crm_private.sheet_text(p_values, 'FAMILY'), crm_private.phone_key(p_values ->> 'NUMBER'), 'engaged')
    RETURNING client_id INTO record_id;
    outcome := 'inserted';
  END IF;
  SELECT id INTO v_household FROM public.households WHERE household_code = v_family;
  IF v_household IS NULL THEN
    INSERT INTO public.households (household_code, created_at)
    VALUES (v_family, COALESCE(crm_private.sheet_parse_time(p_values ->> 'TIMESTAMP'), now()))
    RETURNING id INTO v_household;
  END IF;
  SELECT * INTO v_before FROM public.clients WHERE client_id = record_id;
  UPDATE public.clients c SET
    household_id = v_household,
    household_relation = CASE WHEN v_relation IN ('', 'MAIN CLIENT') THEN c.household_relation ELSE left(v_relation, 120) END,
    marketing_message = COALESCE(left(crm_private.sheet_text(p_values, 'MARKETING MESSAGE'), 120), c.marketing_message),
    communication_preference = COALESCE(left(crm_private.sheet_text(p_values, 'COMMUNICATION PREFERENCE'), 120), c.communication_preference)
  WHERE c.client_id = record_id RETURNING * INTO v_after;
  IF v_relation = 'MAIN CLIENT' OR upper(btrim(COALESCE(p_values ->> 'MAIN CLIENT ID', ''))) = p_key THEN
    UPDATE public.households SET main_client_id = record_id WHERE id = v_household AND main_client_id IS DISTINCT FROM record_id;
  END IF;
  IF outcome = 'matched' AND (v_after.household_id, v_after.household_relation, v_after.marketing_message, v_after.communication_preference)
       IS DISTINCT FROM (v_before.household_id, v_before.household_relation, v_before.marketing_message, v_before.communication_preference) THEN
    outcome := 'updated';
  END IF;
END
$$;

-- Finds or creates the CRM referral behind a REFERRALS / REFERRALS CALLING MASTER row.
CREATE FUNCTION crm_private.sheet_referral_for(p_key text, p_values jsonb, p_given_by_column text, p_sales_column text,
  OUT referral_id uuid, OUT created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_given_by text := crm_private.sheet_text(p_values, p_given_by_column);
  v_crm text := crm_private.sheet_text(p_values, 'CRM NAME');
  v_giver uuid;
  v_branch uuid;
BEGIN
  created := false;
  SELECT r.record_id INTO referral_id FROM crm_private.sheet_sync_rows r
  WHERE r.tab IN ('REFERRALS', 'REFERRALS CALLING MASTER') AND r.row_key = p_key AND r.record_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.referrals x WHERE x.id = r.record_id)
  LIMIT 1;
  IF referral_id IS NULL THEN
    SELECT v._record_id INTO referral_id FROM crm_private.sheet_referrals v WHERE v._row_key = p_key ORDER BY v."TIMESTAMP" LIMIT 1;
  END IF;
  IF referral_id IS NOT NULL THEN RETURN; END IF;
  IF crm_private.sheet_text(p_values, 'REFERRAL NAME') IS NULL OR crm_private.sheet_text(p_values, 'REFERRAL NUMBER') IS NULL THEN RETURN; END IF;
  v_giver := crm_private.match_client(NULL, v_given_by);
  SELECT a.branch_id INTO v_branch FROM public.crm_allocation a
  WHERE public.normalize_crm_roster_value(a.crm_name) = public.normalize_crm_roster_value(v_crm) ORDER BY a.active DESC, a.created_at LIMIT 1;
  IF v_branch IS NULL THEN SELECT c.last_branch_id INTO v_branch FROM public.clients c WHERE c.client_id = v_giver; END IF;
  INSERT INTO public.referrals (crm_name, salesperson_id, given_by_client_id, given_by_name, referral_name, referral_number, branch_id, created_at)
  VALUES (v_crm,
    COALESCE(crm_private.sheet_user_id(p_values ->> p_sales_column), '5eee5eee-0000-4000-8000-000000000001'::uuid),
    v_giver, v_given_by, crm_private.sheet_text(p_values, 'REFERRAL NAME'),
    right(regexp_replace(p_values ->> 'REFERRAL NUMBER', '[^0-9]', '', 'g'), 10), v_branch,
    COALESCE(crm_private.sheet_parse_time(COALESCE(p_values ->> 'TIMESTAMP', p_values ->> 'CREATED ON')), now()))
  RETURNING id INTO referral_id;
  created := true;
END
$$;

CREATE FUNCTION crm_private.sheet_apply_referral(p_key text, p_values jsonb,
  OUT outcome text, OUT reason text, OUT record_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_found record;
BEGIN
  IF length(regexp_replace(COALESCE(p_values ->> 'REFERRAL NUMBER', ''), '[^0-9]', '', 'g')) < 10 THEN
    outcome := 'skipped'; reason := 'invalid_phone'; RETURN;
  END IF;
  SELECT * INTO v_found FROM crm_private.sheet_referral_for(p_key, p_values, 'REFERENCE GIVEN BY CLIENT NAME', 'SALES PERSON NAME');
  IF v_found.referral_id IS NULL THEN outcome := 'skipped'; reason := 'invalid_row'; RETURN; END IF;
  record_id := v_found.referral_id;
  outcome := CASE WHEN v_found.created THEN 'inserted' ELSE 'matched' END;
  IF NOT v_found.created THEN
    UPDATE public.referrals r SET
      crm_name = COALESCE(crm_private.sheet_text(p_values, 'CRM NAME'), r.crm_name),
      given_by_name = COALESCE(crm_private.sheet_text(p_values, 'REFERENCE GIVEN BY CLIENT NAME'), r.given_by_name)
    WHERE r.id = record_id
      AND (r.crm_name, r.given_by_name) IS DISTINCT FROM (COALESCE(crm_private.sheet_text(p_values, 'CRM NAME'), r.crm_name),
        COALESCE(crm_private.sheet_text(p_values, 'REFERENCE GIVEN BY CLIENT NAME'), r.given_by_name));
    IF FOUND THEN outcome := 'updated'; END IF;
  END IF;
END
$$;

CREATE FUNCTION crm_private.sheet_apply_calling(p_key text, p_values jsonb,
  OUT outcome text, OUT reason text, OUT record_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_found record;
  v_converted uuid;
  v_before public.referral_calling;
  v_after public.referral_calling;
  v_status text := COALESCE(upper(crm_private.sheet_text(p_values, 'FOLLOW UP STATUS')), 'PENDING');
BEGIN
  SELECT * INTO v_found FROM crm_private.sheet_referral_for(p_key, p_values, 'REFERRAL GIVEN BY CLIENT', 'SALESPERSON');
  IF v_found.referral_id IS NULL THEN outcome := 'skipped'; reason := 'invalid_row'; RETURN; END IF;
  SELECT c.client_id INTO v_converted FROM public.clients c WHERE c.client_code = upper(btrim(COALESCE(p_values ->> 'CONVERTED CLIENT ID', '')));
  UPDATE public.referrals SET assigned_doer = COALESCE(crm_private.sheet_text(p_values, 'ASSIGNED CRM / DOER'), assigned_doer)
  WHERE id = v_found.referral_id AND assigned_doer IS DISTINCT FROM COALESCE(crm_private.sheet_text(p_values, 'ASSIGNED CRM / DOER'), assigned_doer);
  SELECT * INTO v_before FROM public.referral_calling WHERE referral_id = v_found.referral_id ORDER BY created_at, id LIMIT 1;
  IF v_before.id IS NULL THEN
    INSERT INTO public.referral_calling (referral_id, status, remark, next_followup_date, converted_client_id, followup_count, action_point, created_at)
    VALUES (v_found.referral_id, v_status, crm_private.sheet_text(p_values, 'LAST FOLLOW UP REMARK'),
      crm_private.sheet_parse_date(p_values ->> 'NEXT FOLLOW UP DATE'), v_converted,
      COALESCE(NULLIF(regexp_replace(COALESCE(p_values ->> 'FOLLOW UP COUNT', ''), '[^0-9]', '', 'g'), '')::int, 0),
      crm_private.sheet_text(p_values, 'ACTION POINT'),
      COALESCE(crm_private.sheet_parse_time(p_values ->> 'CREATED ON'), now()))
    RETURNING id INTO record_id;
    outcome := 'inserted';
    RETURN;
  END IF;
  record_id := v_before.id;
  UPDATE public.referral_calling rc SET
    status = v_status,
    remark = crm_private.sheet_text(p_values, 'LAST FOLLOW UP REMARK'),
    next_followup_date = crm_private.sheet_parse_date(p_values ->> 'NEXT FOLLOW UP DATE'),
    converted_client_id = COALESCE(v_converted, rc.converted_client_id),
    followup_count = COALESCE(NULLIF(regexp_replace(COALESCE(p_values ->> 'FOLLOW UP COUNT', ''), '[^0-9]', '', 'g'), '')::int, rc.followup_count),
    action_point = COALESCE(crm_private.sheet_text(p_values, 'ACTION POINT'), rc.action_point)
  WHERE rc.id = record_id RETURNING * INTO v_after;
  outcome := CASE WHEN to_jsonb(v_after) IS DISTINCT FROM to_jsonb(v_before) THEN 'updated' ELSE 'matched' END;
END
$$;

CREATE FUNCTION crm_private.sheet_apply_history(p_key text, p_values jsonb,
  OUT outcome text, OUT reason text, OUT record_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_calling uuid;
  v_referral_key text := crm_private.sheet_hashed_key('RK', COALESCE(p_values ->> 'REFERRAL KEY', ''));
BEGIN
  SELECT v._record_id INTO record_id FROM crm_private.sheet_referrals_history v WHERE v._row_key = p_key LIMIT 1;
  IF record_id IS NOT NULL THEN outcome := 'matched'; RETURN; END IF;
  SELECT rc.id INTO v_calling FROM public.referral_calling rc
  WHERE rc.referral_id = (SELECT x.record_id FROM crm_private.sheet_sync_rows x
                          WHERE x.tab IN ('REFERRALS', 'REFERRALS CALLING MASTER') AND x.row_key = v_referral_key AND x.record_id IS NOT NULL
                            AND EXISTS (SELECT 1 FROM public.referrals r WHERE r.id = x.record_id) LIMIT 1)
     OR rc.referral_id = (SELECT v._record_id FROM crm_private.sheet_referrals v WHERE v._row_key = v_referral_key LIMIT 1)
  ORDER BY rc.created_at, rc.id LIMIT 1;
  IF v_calling IS NULL THEN outcome := 'skipped'; reason := 'calling_not_found'; RETURN; END IF;
  INSERT INTO public.referral_calling_history (referral_calling_id, status, previous_status, call_response, remark,
    entered_by, followup_date, next_followup_date, source, created_at)
  VALUES (v_calling, COALESCE(upper(crm_private.sheet_text(p_values, 'NEW STATUS')), 'PENDING'),
    upper(crm_private.sheet_text(p_values, 'OLD STATUS')), upper(crm_private.sheet_text(p_values, 'CALL RESPONSE')),
    crm_private.sheet_text(p_values, 'REMARK'), left(upper(crm_private.sheet_text(p_values, 'ENTERED BY')), 200),
    crm_private.sheet_parse_date(p_values ->> 'FOLLOW UP DATE'), crm_private.sheet_parse_date(p_values ->> 'NEXT FOLLOW UP DATE'),
    left(COALESCE(upper(crm_private.sheet_text(p_values, 'SOURCE')), 'GOOGLE SHEET'), 200),
    COALESCE(crm_private.sheet_parse_time(p_values ->> 'TIMESTAMP'), now()))
  RETURNING id INTO record_id;
  outcome := 'inserted';
END
$$;

-- ---------------------------------------------------------------------------
-- Sheet-origin writes stay out of the automatic referral history and the outbox
-- ---------------------------------------------------------------------------

-- As 20261001000000, plus the first statement: a referral calling update applied from the Sheet
-- does not write a CRM history row (the Sheet's REFERRALS HISTORY row arrives separately).
CREATE OR REPLACE FUNCTION public.record_referral_calling_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF current_setting('app.sync_origin', true) = 'sheet' THEN
    RETURN NEW;
  END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status"
     AND NEW."call_response" IS NOT DISTINCT FROM OLD."call_response"
     AND NEW."remark" IS NOT DISTINCT FROM OLD."remark"
     AND NEW."next_followup_date" IS NOT DISTINCT FROM OLD."next_followup_date" THEN
    RETURN NEW;
  END IF;
  NEW."followup_count" := OLD."followup_count" + 1;
  INSERT INTO "public"."referral_calling_history" (
    "referral_calling_id", "status", "previous_status", "call_response", "remark", "updated_by", "entered_by",
    "followup_date", "next_followup_date", "source", "request_key"
  ) VALUES (
    NEW."id", NEW."status", OLD."status", NEW."call_response", NEW."remark", "auth"."uid"(),
    NULLIF(current_setting('app.referral_entered_by', true), ''),
    (timezone('Asia/Kolkata', now()))::date, NEW."next_followup_date", 'CRM FOLLOW UP FORM',
    NULLIF(current_setting('app.referral_request_key', true), '')::uuid
  );
  RETURN NEW;
END; $function$;

CREATE FUNCTION crm_private.sheet_enqueue(p_tab text, p_record uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF current_setting('app.sync_origin', true) = 'sheet' OR p_record IS NULL THEN RETURN; END IF;
  INSERT INTO crm_private.sheet_sync_outbox (tab, record_id) VALUES (p_tab, p_record)
  ON CONFLICT (tab, record_id) WHERE status = 'pending' DO NOTHING;
END
$$;

CREATE FUNCTION crm_private.sheet_outbox_clients()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF current_setting('app.sync_origin', true) = 'sheet' THEN RETURN NULL; END IF;
  PERFORM crm_private.sheet_enqueue('CLIENT DATABASE MASTER', NEW.client_id);
  IF tg_op = 'INSERT' AND NEW.household_id IS NOT NULL
     OR tg_op = 'UPDATE' AND (NEW.household_id, NEW.household_relation, NEW.marketing_message, NEW.communication_preference, NEW.primary_name, NEW.primary_phone)
       IS DISTINCT FROM (OLD.household_id, OLD.household_relation, OLD.marketing_message, OLD.communication_preference, OLD.primary_name, OLD.primary_phone)
       AND (NEW.household_id IS NOT NULL OR OLD.household_id IS NOT NULL) THEN
    PERFORM crm_private.sheet_enqueue('FAMILY DATA', NEW.client_id);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER clients_sheet_outbox AFTER INSERT OR UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION crm_private.sheet_outbox_clients();

CREATE FUNCTION crm_private.sheet_outbox_visit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM crm_private.sheet_enqueue('WALKIN DATASET', NEW.client_timeline_id);
  RETURN NULL;
END
$$;
CREATE TRIGGER visit_forms_sheet_outbox AFTER INSERT ON public.visit_forms
FOR EACH ROW EXECUTE FUNCTION crm_private.sheet_outbox_visit();

CREATE FUNCTION crm_private.sheet_outbox_referral()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF tg_table_name = 'referrals' THEN
    PERFORM crm_private.sheet_enqueue('REFERRALS', NEW.id);
  ELSIF tg_table_name = 'referral_calling' THEN
    PERFORM crm_private.sheet_enqueue('REFERRALS CALLING MASTER', NEW.id);
  ELSE
    PERFORM crm_private.sheet_enqueue('REFERRALS HISTORY', NEW.id);
    PERFORM crm_private.sheet_enqueue('REFERRALS CALLING MASTER', NEW.referral_calling_id);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER referrals_sheet_outbox AFTER INSERT ON public.referrals
FOR EACH ROW EXECUTE FUNCTION crm_private.sheet_outbox_referral();
CREATE TRIGGER referral_calling_sheet_outbox AFTER INSERT OR UPDATE ON public.referral_calling
FOR EACH ROW EXECUTE FUNCTION crm_private.sheet_outbox_referral();
CREATE TRIGGER referral_calling_history_sheet_outbox AFTER INSERT ON public.referral_calling_history
FOR EACH ROW EXECUTE FUNCTION crm_private.sheet_outbox_referral();

-- ---------------------------------------------------------------------------
-- Push (Sheet -> CRM)
-- ---------------------------------------------------------------------------

CREATE FUNCTION crm_private.sheet_bump(p_counts jsonb, p_name text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT p_counts || jsonb_build_object(p_name, COALESCE((p_counts ->> p_name)::int, 0) + 1) $$;

CREATE FUNCTION crm_private.sheet_add_counts(p_a jsonb, p_b jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_object_agg(k, COALESCE((p_a ->> k)::int, 0) + COALESCE((p_b ->> k)::int, 0)), '{}'::jsonb)
  FROM (SELECT jsonb_object_keys(COALESCE(p_a, '{}'::jsonb)) UNION SELECT jsonb_object_keys(COALESCE(p_b, '{}'::jsonb))) AS keys(k)
$$;

CREATE FUNCTION crm_private.sheet_push(p_run uuid, p_tab text, p_rows jsonb, p_dry_run boolean)
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
        INSERT INTO crm_private.sheet_sync_errors (run_id, tab, row_key, reason)
        VALUES (p_run, p_tab, v_key, v_result.reason)
        ON CONFLICT (tab, row_key) WHERE resolved_at IS NULL DO UPDATE SET reason = EXCLUDED.reason, run_id = EXCLUDED.run_id, created_at = now();
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

-- ---------------------------------------------------------------------------
-- Pull and ack (CRM -> Sheet)
-- ---------------------------------------------------------------------------

-- Columns a web-app change may write into an existing Sheet row. A new row is written whole.
-- Visit statistics and the LAST ... columns are derived from visits on each side (the CRM's
-- recalculate_client_rollups, the Sheet's mergeVisitIntoMaster_) and are never copied.
CREATE FUNCTION crm_private.sheet_writable_columns(p_tab text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_tab
    WHEN 'CLIENT DATABASE MASTER' THEN ARRAY['PRIMARY NAME', 'OTHER NAMES', 'PRIMARY PHONE', 'SECONDARY PHONE', 'BILLING PHONE',
      'OTHER KNOWN PHONES', 'GENDER', 'COUNTRY', 'STATE', 'CITY', 'CITY OTHER', 'PINCODE', 'ADDRESS', 'COMMUNITY', 'COMMUNITY OTHER',
      'DOB', 'ANNIVERSARY', 'BEVERAGE', 'SUGAR', 'SNACK', 'GIFT HISTORY', 'CLIENT POTENTIAL CATEGORY',
      'HIGH POTENTIAL REASON', 'INSTAGRAM STATUS', 'GOOGLE REVIEW STATUS', 'TESTIMONIAL STATUS', 'REFERRAL STATUS', 'NEXT VISIT DATE']
    WHEN 'FAMILY DATA' THEN ARRAY['MAIN CLIENT ID', 'FAMILY ID', 'FAMILY', 'NUMBER', 'RELATION', 'MARKETING MESSAGE', 'COMMUNICATION PREFERENCE']
    WHEN 'REFERRALS CALLING MASTER' THEN ARRAY['UPDATED ON', 'ASSIGNED CRM / DOER', 'FOLLOW UP STATUS', 'NEXT FOLLOW UP DATE',
      'LAST FOLLOW UP DATE', 'FOLLOW UP COUNT', 'LAST FOLLOW UP REMARK', 'CONVERTED CLIENT ID', 'CONVERTED ON', 'ACTION POINT']
    ELSE ARRAY[]::text[] END
$$;

-- Two cell values are the same when they differ only in case or spacing.
CREATE FUNCTION crm_private.sheet_same(p_a text, p_b text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT upper(regexp_replace(btrim(COALESCE(p_a, '')), '\s+', ' ', 'g')) = upper(regexp_replace(btrim(COALESCE(p_b, '')), '\s+', ' ', 'g'))
$$;

CREATE FUNCTION crm_private.sheet_view_row(p_tab text, p_record uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v jsonb;
BEGIN
  CASE p_tab
    WHEN 'CLIENT DATABASE MASTER' THEN
      SELECT to_jsonb(x) INTO v FROM crm_private.sheet_client_database_master x
      JOIN public.clients c ON c.client_id = x._record_id
      WHERE x._record_id = p_record AND c.lifecycle_stage <> 'lead';
    WHEN 'WALKIN DATASET' THEN SELECT to_jsonb(x) INTO v FROM crm_private.sheet_walkin_dataset x WHERE x._record_id = p_record;
    WHEN 'FAMILY DATA' THEN SELECT to_jsonb(x) INTO v FROM crm_private.sheet_family_data x WHERE x._record_id = p_record;
    WHEN 'REFERRALS' THEN SELECT to_jsonb(x) INTO v FROM crm_private.sheet_referrals x WHERE x._record_id = p_record;
    WHEN 'REFERRALS CALLING MASTER' THEN SELECT to_jsonb(x) INTO v FROM crm_private.sheet_referrals_calling_master x WHERE x._record_id = p_record;
    ELSE SELECT to_jsonb(x) INTO v FROM crm_private.sheet_referrals_history x WHERE x._record_id = p_record;
  END CASE;
  RETURN v;
END
$$;

CREATE FUNCTION crm_private.sheet_pull(p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_entry crm_private.sheet_sync_outbox;
  v_row jsonb;
  v_key text;
  v_state crm_private.sheet_sync_rows;
  v_values jsonb;
  v_base jsonb;
  v_changes jsonb := '[]'::jsonb;
BEGIN
  FOR v_entry IN
    SELECT * FROM crm_private.sheet_sync_outbox o WHERE o.status = 'pending'
    ORDER BY array_position(ARRAY['CLIENT DATABASE MASTER', 'FAMILY DATA', 'WALKIN DATASET', 'REFERRALS',
      'REFERRALS CALLING MASTER', 'REFERRALS HISTORY'], o.tab), o.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
    FOR UPDATE SKIP LOCKED
  LOOP
    v_row := crm_private.sheet_view_row(v_entry.tab, v_entry.record_id);
    IF v_row IS NULL THEN
      UPDATE crm_private.sheet_sync_outbox SET status = 'no_change', reason = 'not_in_sheet_scope', updated_at = now() WHERE id = v_entry.id;
      CONTINUE;
    END IF;
    v_key := v_row ->> '_row_key';
    v_row := v_row - '_record_id' - '_row_key';
    SELECT * INTO v_state FROM crm_private.sheet_sync_rows s WHERE s.tab = v_entry.tab AND s.row_key = v_key;
    IF v_state.row_key IS NULL THEN
      v_changes := v_changes || jsonb_build_object('id', v_entry.id, 'tab', v_entry.tab, 'key', v_key, 'op', 'append', 'values', v_row);
      UPDATE crm_private.sheet_sync_outbox SET sent_key = v_key, sent_values = v_row, updated_at = now() WHERE id = v_entry.id;
      CONTINUE;
    END IF;
    SELECT COALESCE(jsonb_object_agg(col, v_row ->> col), '{}'::jsonb),
           COALESCE(jsonb_object_agg(col, COALESCE(v_state.sheet_values ->> col, '')), '{}'::jsonb)
      INTO v_values, v_base
    FROM unnest(crm_private.sheet_writable_columns(v_entry.tab)) AS col
    WHERE v_row ? col AND NOT crm_private.sheet_same(v_row ->> col, v_state.sheet_values ->> col);
    IF v_values = '{}'::jsonb THEN
      UPDATE crm_private.sheet_sync_outbox SET status = 'no_change', updated_at = now() WHERE id = v_entry.id;
      CONTINUE;
    END IF;
    v_changes := v_changes || jsonb_build_object('id', v_entry.id, 'tab', v_entry.tab, 'key', v_key, 'op', 'update', 'values', v_values, 'base', v_base);
    UPDATE crm_private.sheet_sync_outbox SET sent_key = v_key, sent_values = v_values, updated_at = now() WHERE id = v_entry.id;
  END LOOP;
  RETURN jsonb_build_object('changes', v_changes);
END
$$;

-- results: [{id, outcome: applied | sheet_won | failed, applied_columns?: [...], reason?}]
CREATE FUNCTION crm_private.sheet_ack(p_results jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_entry crm_private.sheet_sync_outbox;
  v_outcome text;
  v_written jsonb;
  v_counts jsonb := '{}'::jsonb;
BEGIN
  IF jsonb_typeof(p_results) <> 'array' OR jsonb_array_length(p_results) > 200 THEN
    RAISE EXCEPTION 'results must be an array of at most 200' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_results) LOOP
    SELECT * INTO v_entry FROM crm_private.sheet_sync_outbox o
    WHERE o.id = (v_item ->> 'id')::bigint AND o.status = 'pending' FOR UPDATE;
    IF v_entry.id IS NULL THEN v_counts := crm_private.sheet_bump(v_counts, 'already_confirmed'); CONTINUE; END IF;
    v_outcome := v_item ->> 'outcome';
    IF v_outcome IN ('applied', 'sheet_won') AND v_entry.sent_key IS NOT NULL THEN
      -- The cells the Sheet now holds from the CRM become the new base.
      SELECT COALESCE(jsonb_object_agg(col, v_entry.sent_values -> col), '{}'::jsonb) INTO v_written
      FROM jsonb_object_keys(COALESCE(v_entry.sent_values, '{}'::jsonb)) AS col
      WHERE v_outcome = 'applied' OR col IN (SELECT jsonb_array_elements_text(COALESCE(v_item -> 'applied_columns', '[]'::jsonb)));
      INSERT INTO crm_private.sheet_sync_rows (tab, row_key, record_id, sheet_values)
      VALUES (v_entry.tab, v_entry.sent_key, v_entry.record_id, v_written)
      ON CONFLICT (tab, row_key) DO UPDATE SET sheet_values = crm_private.sheet_sync_rows.sheet_values || EXCLUDED.sheet_values,
        record_id = COALESCE(crm_private.sheet_sync_rows.record_id, EXCLUDED.record_id), updated_at = now();
      UPDATE crm_private.sheet_sync_outbox SET status = v_outcome, updated_at = now() WHERE id = v_entry.id;
      v_counts := crm_private.sheet_bump(v_counts, v_outcome);
    ELSE
      UPDATE crm_private.sheet_sync_outbox SET attempts = attempts + 1,
        status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END,
        reason = CASE WHEN (v_item ->> 'reason') ~ '^[a-z_]{1,60}$' THEN v_item ->> 'reason' ELSE 'sheet_write_failed' END,
        updated_at = now()
      WHERE id = v_entry.id;
      v_counts := crm_private.sheet_bump(v_counts, 'failed');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('counts', v_counts);
END
$$;

-- ---------------------------------------------------------------------------
-- Runs, the import's CRM-only clients, and the entry point
-- ---------------------------------------------------------------------------

-- After the import: visited CRM clients the Sheet does not have yet are queued for the Sheet.
CREATE FUNCTION crm_private.sheet_queue_crm_only()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  WITH missing AS (
    SELECT c.client_id FROM public.clients c
    WHERE c.lifecycle_stage <> 'lead'
      AND NOT EXISTS (SELECT 1 FROM crm_private.sheet_sync_rows s WHERE s.tab = 'CLIENT DATABASE MASTER' AND s.row_key = c.client_code)
  ), queued AS (
    INSERT INTO crm_private.sheet_sync_outbox (tab, record_id)
    SELECT 'CLIENT DATABASE MASTER', client_id FROM missing
    ON CONFLICT (tab, record_id) WHERE status = 'pending' DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM queued;
  RETURN v_count;
END
$$;

CREATE FUNCTION public.crm_sheet_sync(p_action text, p_payload jsonb)
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
    WHEN 'pull' THEN
      RETURN crm_private.sheet_pull(NULLIF(p_payload ->> 'limit', '')::int);
    WHEN 'ack' THEN
      RETURN crm_private.sheet_ack(COALESCE(p_payload -> 'results', '[]'::jsonb));
    WHEN 'run_finish' THEN
      v_run := NULLIF(p_payload ->> 'run_id', '')::uuid;
      SELECT mode INTO v_mode FROM crm_private.sheet_sync_runs WHERE id = v_run;
      v_result := '{}'::jsonb;
      IF v_mode = 'import' AND COALESCE(p_payload ->> 'status', 'finished') = 'finished' THEN
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

-- ---------------------------------------------------------------------------
-- Health: the Google Sheet block
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION crm_private.sheet_text(jsonb, text), crm_private.sheet_parse_date(text), crm_private.sheet_parse_time(text),
  crm_private.sheet_split(text), crm_private.sheet_potential(text), crm_private.sheet_branch_id(text), crm_private.sheet_user_id(text),
  crm_private.sheet_client_by_code(text, text, text), crm_private.sheet_resolve_client(text, text, text),
  crm_private.sheet_apply_master(text, jsonb, jsonb), crm_private.sheet_apply_walkin(text, jsonb, jsonb),
  crm_private.sheet_apply_family(text, jsonb), crm_private.sheet_referral_for(text, jsonb, text, text),
  crm_private.sheet_apply_referral(text, jsonb), crm_private.sheet_apply_calling(text, jsonb), crm_private.sheet_apply_history(text, jsonb),
  crm_private.sheet_enqueue(text, uuid), crm_private.sheet_outbox_clients(), crm_private.sheet_outbox_visit(), crm_private.sheet_outbox_referral(),
  crm_private.sheet_bump(jsonb, text), crm_private.sheet_add_counts(jsonb, jsonb), crm_private.sheet_push(uuid, text, jsonb, boolean), crm_private.sheet_writable_columns(text), crm_private.sheet_same(text, text),
  crm_private.sheet_view_row(text, uuid), crm_private.sheet_pull(integer), crm_private.sheet_ack(jsonb), crm_private.sheet_queue_crm_only()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_sheet_sync(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_sheet_sync(text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.crm_sync_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sync_health() TO authenticated;
