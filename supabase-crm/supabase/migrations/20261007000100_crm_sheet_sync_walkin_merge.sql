-- Google Sheet sync, owner clarification (2026-10-07): the sync reads ONE spreadsheet with two
-- tabs, WALKIN DATASET and FAMILY DATA. There is no client-database tab to sync, so a walk-in
-- now updates its client the way the Sheet merges visits (Code.gs mergeVisitIntoMaster_):
-- a filled answer replaces the old value, a blank answer keeps it. Before, a known client's
-- details were left for CLIENT DATABASE MASTER to carry.

-- As 20261006000400, with the merge above in place of keeping the old details.
CREATE OR REPLACE FUNCTION crm_private.sheet_apply_walkin(p_key text, p_values jsonb, p_payload jsonb,
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
  -- The client's details merge the visit the Sheet's way (mergeVisitIntoMaster_): an answer
  -- replaces the old value, a blank answer keeps it, the longer name is kept, the later next
  -- visit date is kept. The LAST ... fields and visit statistics are the CRM's own rollups.
  IF v_profile.client_id IS NOT NULL THEN
    UPDATE public.clients c SET
      primary_name = CASE WHEN length(COALESCE(v_profile.primary_name, '')) > length(COALESCE(c.primary_name, '')) THEN v_profile.primary_name ELSE c.primary_name END,
      billing_phone = COALESCE(c.billing_phone, v_profile.billing_phone), gender = COALESCE(c.gender, v_profile.gender),
      country = COALESCE(c.country, v_profile.country), state = COALESCE(c.state, v_profile.state),
      city = COALESCE(c.city, v_profile.city), city_other = COALESCE(c.city_other, v_profile.city_other),
      pincode = COALESCE(c.pincode, v_profile.pincode),
      address = CASE WHEN length(COALESCE(v_profile.address, '')) > length(COALESCE(c.address, '')) THEN v_profile.address ELSE c.address END,
      community = COALESCE(c.community, v_profile.community), community_other = COALESCE(c.community_other, v_profile.community_other),
      dob = COALESCE(c.dob, v_profile.dob), anniversary = COALESCE(c.anniversary, v_profile.anniversary),
      beverage = COALESCE(c.beverage, v_profile.beverage), sugar = COALESCE(c.sugar, v_profile.sugar), snack = COALESCE(c.snack, v_profile.snack),
      next_visit_date = GREATEST(c.next_visit_date, v_profile.next_visit_date),
      client_potential_category = COALESCE(c.client_potential_category, v_profile.client_potential_category),
      high_potential_reason = COALESCE(c.high_potential_reason, v_profile.high_potential_reason)
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
