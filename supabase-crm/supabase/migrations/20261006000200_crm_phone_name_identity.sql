-- Client identity = phone + name (owner decision 2026-10-06, "option 2"), as the Google Sheet
-- CRM (Code.gs findMatchingClientId_): the same mobile used by two people is two clients.
-- Design: "CRM Sheet Sync Design" (https://claude.ai/artifact/MBHPPoH1pRbPJF9jExCL2D),
-- plan: docs/superpowers/plans/2026-10-06-crm-sheet-sync.md.
--
-- - client_phone_index is keyed by (phone, client_id); one phone may index several clients.
-- - crm_private.name_key() is the Sheet's deriveNameKey_: upper case, letters/digits/spaces only.
-- - crm_private.match_client(phone, name): the Sheet's rule.
--     phone + name: a client with that phone whose primary or other name has that name key;
--     phone only:   the one client with that phone (none when several share it);
--     name only:    the one client with that name key (none when several share it).
-- - Callers that create or find a person now use match_client: find_or_create_known_client
--   (leads, referrals, companions), create_entry_queue, submit_walkin_visit,
--   convert_referral_to_client. Where the Sheet matches by phone alone
--   (lookup_client_by_phone, reconcile_referral_calling_conversions) the pick is made
--   deterministic: the most recently visited client.
-- - Web-app walk-ins get a Sheet-style reference MK-WK-CRM-<BRANCH>-<CRM initials>-<n>
--   (unique: a dedicated sequence, skipping any number already used). A visit that came from
--   the Sheet keeps the Sheet's REFERENCE NUMBER (additional_fields.legacy_reference_number).
-- - Families created in the CRM are numbered from MKF-500001, apart from the Sheet's MKF-1xxxxx.

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

ALTER TABLE public.client_phone_index DROP CONSTRAINT client_phone_index_pkey;
ALTER TABLE public.client_phone_index ADD CONSTRAINT client_phone_index_pkey PRIMARY KEY (phone, client_id);

SELECT setval('public.household_code_sequence', greatest((SELECT last_value FROM public.household_code_sequence), 500000), true);

CREATE SEQUENCE public.walkin_reference_sequence;
REVOKE ALL ON SEQUENCE public.walkin_reference_sequence FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Matching
-- ---------------------------------------------------------------------------

CREATE FUNCTION crm_private.name_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT NULLIF(btrim(regexp_replace(regexp_replace(upper(COALESCE(p_name, '')), '[^A-Z0-9 ]', '', 'g'), '\s+', ' ', 'g')), '')
$$;

CREATE FUNCTION crm_private.phone_key(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN length(d) >= 10 THEN right(d, 10) END
  FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') AS d) digits
$$;

CREATE FUNCTION crm_private.match_client(p_phone text, p_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := crm_private.phone_key(p_phone);
  v_name text := crm_private.name_key(p_name);
  v_ids uuid[];
BEGIN
  IF v_phone IS NOT NULL AND v_name IS NOT NULL THEN
    RETURN (
      SELECT c.client_id
      FROM public.client_phone_index pi
      JOIN public.clients c ON c.client_id = pi.client_id
      WHERE pi.phone = v_phone
        AND (crm_private.name_key(c.primary_name) = v_name
          OR EXISTS (SELECT 1 FROM unnest(c.other_names) other(name) WHERE crm_private.name_key(other.name) = v_name))
      ORDER BY c.last_visit_date DESC NULLS LAST, c.client_code, c.client_id
      LIMIT 1);
  END IF;
  IF v_phone IS NOT NULL THEN
    SELECT array_agg(DISTINCT pi.client_id) INTO v_ids FROM public.client_phone_index pi WHERE pi.phone = v_phone;
  ELSIF v_name IS NOT NULL THEN
    SELECT array_agg(c.client_id) INTO v_ids FROM public.clients c WHERE crm_private.name_key(c.primary_name) = v_name;
  END IF;
  RETURN CASE WHEN cardinality(v_ids) = 1 THEN v_ids[1] END;
END
$$;

REVOKE ALL ON FUNCTION crm_private.name_key(text), crm_private.phone_key(text), crm_private.match_client(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
-- create_entry_queue and submit_walkin_visit run as the signed-in staff member.
GRANT EXECUTE ON FUNCTION crm_private.name_key(text), crm_private.phone_key(text), crm_private.match_client(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Changed functions
-- ---------------------------------------------------------------------------

-- As 20261005000300, with match_client in place of the phone-only lookup.
CREATE OR REPLACE FUNCTION crm_private.find_or_create_known_client(
  p_name text, p_phone text, p_branch_id uuid, p_stage text,
  p_referred_by uuid DEFAULT NULL, p_relation text DEFAULT NULL,
  OUT client_id uuid, OUT created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := crm_private.phone_key(p_phone);
  v_name text := left(btrim(COALESCE(p_name, '')), 160);
BEGIN
  created := false;
  -- 'LEAD <phone>' / 'COMPANION <phone>' are the placeholders the lead and companion triggers
  -- pass for a person without a name: they match as "no name" (the one client with that phone).
  client_id := crm_private.match_client(v_phone,
    CASE WHEN v_name ~ '^(LEAD|COMPANION) [0-9]+$' THEN NULL ELSE v_name END);
  IF client_id IS NOT NULL OR v_name = '' THEN
    RETURN;
  END IF;
  INSERT INTO public.clients (primary_name, primary_phone, last_branch_id, lifecycle_stage, referred_by_client_id, referral_relation)
  VALUES (v_name, v_phone, p_branch_id, p_stage, p_referred_by,
    CASE WHEN p_referred_by IS NULL THEN NULL ELSE COALESCE(NULLIF(left(btrim(p_relation), 120), ''), 'Referral') END)
  RETURNING clients.client_id INTO client_id;
  created := true;
END
$$;

-- As 20261005000300 ("create_entry_queue: as the original, plus the two marked changes"), with
-- the phone lookup replaced by match_client (phone + name).
CREATE OR REPLACE FUNCTION public.create_entry_queue(p_client_name text, p_mobile text, p_branch_id uuid DEFAULT NULL::uuid, p_assigned_crm_name text DEFAULT NULL::text, p_client_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, token text, client_id uuid, client_code text, client_type text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  actor_role "public"."user_role"; own_branch uuid; target_branch uuid; phone_digits text;
  generated_token text; found_client uuid; found_client_code text; canonical_name text;
  assigned_crm text; created_client boolean := false;
BEGIN
  actor_role := "public"."current_user_role"(); own_branch := "public"."current_user_branch_id"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  target_branch := CASE WHEN actor_role = 'super_admin' THEN p_branch_id ELSE own_branch END;
  IF target_branch IS NULL OR (actor_role <> 'super_admin' AND NOT "public"."is_branch_staff"(target_branch)) OR NOT EXISTS (SELECT 1 FROM "public"."branches" WHERE branches.id = target_branch AND active) THEN RAISE EXCEPTION 'an active branch you may write to is required' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_client_id IS NOT NULL THEN
    SELECT clients.client_id, clients.client_code, clients.primary_name, COALESCE(clients.primary_phone, '') INTO found_client, found_client_code, canonical_name, phone_digits FROM "public"."clients" WHERE clients.client_id = p_client_id;
    IF found_client IS NULL THEN RAISE EXCEPTION 'selected client is not available' USING ERRCODE = 'insufficient_privilege'; END IF;
  ELSE
    phone_digits := right(regexp_replace(COALESCE(p_mobile, ''), '[^0-9]', '', 'g'), 10); canonical_name := trim(COALESCE(p_client_name, ''));
    IF length(canonical_name) = 0 OR length(phone_digits) <> 10 THEN RAISE EXCEPTION 'client name and a 10-digit phone are required' USING ERRCODE = 'check_violation'; END IF;
    -- Phone + name identity (2026-10-06).
    found_client := crm_private.match_client(phone_digits, canonical_name);
    IF found_client IS NULL THEN
      INSERT INTO "public"."clients" (primary_name, primary_phone, last_branch_id)
      VALUES (canonical_name, phone_digits, target_branch)
      RETURNING clients.client_id, clients.client_code INTO found_client, found_client_code;
      created_client := true;
    ELSE
      SELECT clients.client_code INTO found_client_code FROM "public"."clients" WHERE clients.client_id = found_client;
    END IF;
  END IF;
  -- A client known only as a lead or referral registers as a new client (client identity, 2026-10-05).
  IF crm_private.engage_client(found_client) THEN created_client := true; END IF;
  assigned_crm := NULLIF("public"."normalize_crm_roster_value"(p_assigned_crm_name), '');
  IF assigned_crm IS NULL THEN assigned_crm := "public"."assign_next_available_crm"(target_branch); END IF;
  IF assigned_crm IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "public"."crm_allocation" allocation LEFT JOIN "public"."crm_daily_availability" availability ON availability.branch_id = allocation.branch_id AND "public"."normalize_crm_roster_value"(availability.crm_name) = "public"."normalize_crm_roster_value"(allocation.crm_name) AND availability.date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date WHERE allocation.branch_id = target_branch AND "public"."normalize_crm_roster_value"(allocation.crm_name) = assigned_crm AND allocation.active AND COALESCE(availability.is_available, true)) THEN RAISE EXCEPTION 'assigned CRM is not available for this branch today' USING ERRCODE = 'check_violation'; END IF;
  LOOP
    generated_token := upper(to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata', 'MMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
    BEGIN INSERT INTO "public"."entry_queue" (token, client_name, mobile, branch_id, assigned_crm_name, status, client_id, client_is_new)
      VALUES (generated_token, canonical_name, phone_digits, target_branch, assigned_crm, 'pending', found_client, created_client) RETURNING entry_queue.id INTO id; EXIT;
    EXCEPTION WHEN unique_violation THEN END;
  END LOOP;
  PERFORM "crm_private"."write_audit_log"('crm.create_entry_queue', id, jsonb_build_object('client_id', found_client, 'branch_id', target_branch, 'token', generated_token, 'client_is_new', created_client));
  RETURN QUERY SELECT id, generated_token, found_client, found_client_code, CASE WHEN created_client THEN 'new' ELSE 'existing' END;
END;
$function$;

-- The Sheet-style reference for a visit recorded in the web app (see the header).
CREATE FUNCTION crm_private.next_walkin_reference(p_branch_id uuid, p_crm_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_branch text;
  v_words text[];
  v_initials text;
  v_ref text;
BEGIN
  SELECT upper(left(regexp_replace(COALESCE(b.name, ''), '[^A-Za-z]', '', 'g'), 3)) INTO v_branch FROM public.branches b WHERE b.id = p_branch_id;
  v_branch := COALESCE(NULLIF(v_branch, ''), 'MKJ');
  v_words := regexp_split_to_array(COALESCE(crm_private.name_key(p_crm_name), ''), ' ');
  v_initials := CASE
    WHEN v_words[1] IS NULL OR v_words[1] = '' THEN 'NA'
    WHEN cardinality(v_words) = 1 THEN rpad(left(v_words[1], 2), 2, 'X')
    ELSE left(v_words[1], 1) || left(v_words[cardinality(v_words)], 1)
  END;
  LOOP
    v_ref := 'MK-WK-CRM-' || v_branch || '-' || v_initials || '-' || nextval('public.walkin_reference_sequence')::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.client_timeline t WHERE upper(t.reference_number) = v_ref)
      AND NOT EXISTS (SELECT 1 FROM crm_private.walkin_ingest_keys k WHERE k.source_reference = v_ref);
  END LOOP;
  RETURN v_ref;
END
$$;
REVOKE ALL ON FUNCTION crm_private.next_walkin_reference(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_private.next_walkin_reference(uuid, text) TO authenticated;

-- As 20261001000300, with two marked changes: the client is matched by phone + name, and the
-- reference is the Sheet's (a visit from the Sheet) or a Sheet-style one (a web-app visit).
CREATE OR REPLACE FUNCTION public.submit_walkin_visit(p_payload jsonb)
 RETURNS TABLE(client_id uuid, timeline_id uuid, reference_number text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  actor_role "public"."user_role"; own_branch uuid; target_branch uuid; target_client uuid; new_client boolean;
  phone_digits text; queue_id uuid; visit_id uuid; ref text; event_at timestamptz;
  purchase_status "public"."buy_status"; details jsonb; doc jsonb;
BEGIN
  actor_role := "public"."current_user_role"(); own_branch := "public"."current_user_branch_id"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  target_branch := NULLIF(p_payload->>'branch_id', '')::uuid;
  IF target_branch IS NULL OR (actor_role <> 'super_admin' AND NOT "public"."is_branch_staff"(target_branch)) THEN RAISE EXCEPTION 'you may only submit visits for your own branch' USING ERRCODE = 'insufficient_privilege'; END IF;
  phone_digits := right(regexp_replace(COALESCE(p_payload->>'primary_phone', ''), '[^0-9]', '', 'g'), 10);
  IF length(phone_digits) <> 10 OR length(trim(COALESCE(p_payload->>'primary_name', ''))) = 0 THEN RAISE EXCEPTION 'client name and a 10-digit phone are required' USING ERRCODE = 'check_violation'; END IF;
  target_client := NULLIF(p_payload->>'client_id', '')::uuid;
  IF target_client IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "public"."clients" AS existing_client WHERE existing_client.client_id = target_client) THEN target_client := NULL; END IF;
  -- Phone + name identity (2026-10-06).
  IF target_client IS NULL THEN target_client := crm_private.match_client(phone_digits, p_payload->>'primary_name'); END IF;
  new_client := target_client IS NULL;
  IF new_client THEN
    INSERT INTO "public"."clients" (client_id, primary_name, primary_phone, gender, country, state, city, city_other, pincode, address, community, community_other, dob, anniversary, beverage, sugar, snack, last_branch_id)
    VALUES (COALESCE(NULLIF(p_payload->>'proposed_client_id', '')::uuid, gen_random_uuid()), trim(p_payload->>'primary_name'), phone_digits, NULLIF(trim(p_payload->>'gender'), ''), NULLIF(trim(p_payload->>'country'), ''), NULLIF(trim(p_payload->>'state'), ''), NULLIF(trim(p_payload->>'city'), ''), NULLIF(trim(p_payload->>'city_other'), ''), NULLIF(trim(p_payload->>'pincode'), ''), NULLIF(trim(p_payload->>'address'), ''), NULLIF(trim(p_payload->>'community'), ''), NULLIF(trim(p_payload->>'community_other'), ''), NULLIF(p_payload->>'dob', '')::date, NULLIF(p_payload->>'anniversary', '')::date, NULLIF(trim(p_payload->>'beverage'), ''), NULLIF(trim(p_payload->>'sugar'), ''), NULLIF(trim(p_payload->>'snack'), ''), target_branch) RETURNING client_id INTO target_client;
  ELSE
    UPDATE "public"."clients" SET primary_name = trim(p_payload->>'primary_name'), billing_phone = NULLIF(trim(p_payload->>'billing_phone'), ''), gender = NULLIF(trim(p_payload->>'gender'), ''), country = NULLIF(trim(p_payload->>'country'), ''), state = NULLIF(trim(p_payload->>'state'), ''), city = NULLIF(trim(p_payload->>'city'), ''), city_other = NULLIF(trim(p_payload->>'city_other'), ''), pincode = NULLIF(trim(p_payload->>'pincode'), ''), address = NULLIF(trim(p_payload->>'address'), ''), community = NULLIF(trim(p_payload->>'community'), ''), community_other = NULLIF(trim(p_payload->>'community_other'), ''), dob = NULLIF(p_payload->>'dob', '')::date, anniversary = NULLIF(p_payload->>'anniversary', '')::date, beverage = NULLIF(trim(p_payload->>'beverage'), ''), sugar = NULLIF(trim(p_payload->>'sugar'), ''), snack = NULLIF(trim(p_payload->>'snack'), ''), next_visit_date = NULLIF(p_payload->>'next_visit_date', '')::date, client_potential_category = NULLIF(trim(p_payload->>'client_potential_category'), ''), high_potential_reason = NULLIF(trim(p_payload->>'high_potential_reason'), ''), last_remark = NULLIF(trim(p_payload->>'remark'), ''), last_product_requirement = NULLIF(trim(p_payload->>'product_requirement'), ''), last_seen_categories = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'seen_categories', '[]'::jsonb))), ARRAY[]::text[]), last_bought_categories = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'bought_categories', '[]'::jsonb))), ARRAY[]::text[]), last_order_categories = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'order_categories', '[]'::jsonb))), ARRAY[]::text[]) WHERE client_id = target_client;
  END IF;
  IF new_client THEN UPDATE "public"."clients" SET next_visit_date = NULLIF(p_payload->>'next_visit_date', '')::date, client_potential_category = NULLIF(trim(p_payload->>'client_potential_category'), ''), high_potential_reason = NULLIF(trim(p_payload->>'high_potential_reason'), ''), last_remark = NULLIF(trim(p_payload->>'remark'), ''), last_product_requirement = NULLIF(trim(p_payload->>'product_requirement'), ''), last_seen_categories = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'seen_categories', '[]'::jsonb))), ARRAY[]::text[]), last_bought_categories = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'bought_categories', '[]'::jsonb))), ARRAY[]::text[]), last_order_categories = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'order_categories', '[]'::jsonb))), ARRAY[]::text[]) WHERE client_id = target_client; END IF;
  event_at := COALESCE(NULLIF(p_payload->>'event_date', '')::timestamptz, CURRENT_TIMESTAMP);
  purchase_status := CASE WHEN COALESCE((p_payload->>'did_buy')::boolean, false) THEN 'YES'::"public"."buy_status" ELSE 'NO'::"public"."buy_status" END;
  -- Reference (2026-10-06): the Sheet's own number for a Sheet visit, else a Sheet-style one.
  ref := NULLIF(upper(btrim(COALESCE(p_payload->'additional_fields'->>'legacy_reference_number', ''))), '');
  IF ref IS NULL OR char_length(ref) > 100 THEN ref := crm_private.next_walkin_reference(target_branch, p_payload->>'crm_name'); END IF;
  INSERT INTO "public"."client_timeline" (id,client_id,event_date,buy_status,branch_id,crm_name,salesperson_id,seen_categories,bought_categories,order_categories,product_requirement,remark,reference_number)
  VALUES (COALESCE(NULLIF(p_payload->>'proposed_timeline_id', '')::uuid, gen_random_uuid()),target_client,event_at,purchase_status,target_branch,NULLIF(trim(p_payload->>'crm_name'), ''),auth.uid(),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'seen_categories','[]'::jsonb))),ARRAY[]::text[]),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'bought_categories','[]'::jsonb))),ARRAY[]::text[]),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'order_categories','[]'::jsonb))),ARRAY[]::text[]),NULLIF(trim(p_payload->>'product_requirement'), ''),NULLIF(trim(p_payload->>'remark'), ''),ref) RETURNING id INTO visit_id;
  details := COALESCE(p_payload->'category_details', '{}'::jsonb);
  INSERT INTO "public"."visit_forms" (client_timeline_id,companions,category_details,occupation,occupation_other,bridal_or_non_bridal,wedding_month,wedding_year,communication_preference,source_of_lead,source_of_lead_other,reference_name,reference_phone,client_type,did_buy,not_bought_reasons,not_bought_other,repair_or_order_approach,marketing_message_sent,instagram_asked,instagram_no_reason,google_review_asked,google_review_no_reason,testimonial_asked,testimonial_no_reason,feedback_form_asked,feedback_form_no_reason,thank_you_note_asked,thank_you_note_no_reason,referrals_asked,referrals_no_reason,additional_fields)
  VALUES (visit_id,COALESCE(p_payload->'companions','[]'::jsonb),details,NULLIF(trim(p_payload->>'occupation'), ''),NULLIF(trim(p_payload->>'occupation_other'), ''),NULLIF(trim(p_payload->>'bridal_or_non_bridal'), ''),NULLIF(p_payload->>'wedding_month','')::smallint,NULLIF(p_payload->>'wedding_year','')::smallint,NULLIF(trim(p_payload->>'communication_preference'), ''),NULLIF(trim(p_payload->>'source_of_lead'), ''),NULLIF(trim(p_payload->>'source_of_lead_other'), ''),NULLIF(trim(p_payload->>'reference_name'), ''),NULLIF(trim(p_payload->>'reference_phone'), ''),CASE WHEN new_client THEN 'new' ELSE 'existing' END,COALESCE((p_payload->>'did_buy')::boolean,false),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'not_bought_reasons','[]'::jsonb))),ARRAY[]::text[]),NULLIF(trim(p_payload->>'not_bought_other'), ''),NULLIF(trim(p_payload->>'repair_or_order_approach'), ''),NULLIF(trim(p_payload->>'marketing_message_sent'), ''),(p_payload->'engagement'->'instagram'->>'asked')::boolean,NULLIF(p_payload->'engagement'->'instagram'->>'no_reason',''),(p_payload->'engagement'->'google_review'->>'asked')::boolean,NULLIF(p_payload->'engagement'->'google_review'->>'no_reason',''),(p_payload->'engagement'->'testimonial'->>'asked')::boolean,NULLIF(p_payload->'engagement'->'testimonial'->>'no_reason',''),(p_payload->'engagement'->'feedback_form'->>'asked')::boolean,NULLIF(p_payload->'engagement'->'feedback_form'->>'no_reason',''),(p_payload->'engagement'->'thank_you_note'->>'asked')::boolean,NULLIF(p_payload->'engagement'->'thank_you_note'->>'no_reason',''),(p_payload->'engagement'->'referrals'->>'asked')::boolean,NULLIF(p_payload->'engagement'->'referrals'->>'no_reason',''),COALESCE(p_payload->'additional_fields','{}'::jsonb));
  FOR doc IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'documents','[]'::jsonb)) LOOP
    INSERT INTO "public"."documents" (client_id,client_timeline_id,uploaded_by,file_name,storage_path,mime_type) VALUES (target_client,visit_id,auth.uid(),doc->>'file_name',doc->>'storage_path',doc->>'mime_type');
  END LOOP;
  queue_id := NULLIF(p_payload->>'entry_queue_id','')::uuid;
  IF queue_id IS NOT NULL THEN UPDATE "public"."entry_queue" SET status = 'complete', full_form_timestamp = CURRENT_TIMESTAMP, client_id = target_client WHERE id = queue_id AND branch_id = target_branch; IF NOT FOUND THEN RAISE EXCEPTION 'queue token does not belong to this branch' USING ERRCODE = 'insufficient_privilege'; END IF; END IF;
  PERFORM "crm_private"."write_audit_log"('crm.submit_walkin_visit', visit_id, jsonb_build_object('client_id', target_client, 'branch_id', target_branch, 'reference_number', ref, 'new_client', new_client, 'entry_queue_id', queue_id));
  RETURN QUERY SELECT target_client, visit_id, ref;
END; $function$;

-- As 20261001000300, with the client matched by referral phone + referral name.
CREATE OR REPLACE FUNCTION public.convert_referral_to_client(p_referral_calling_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor_role "public"."user_role"; calling "public"."referral_calling"; referral "public"."referrals"; target_client_id uuid; target_branch uuid; normalized_phone text;
BEGIN
  actor_role := "public"."current_user_role"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO calling FROM "public"."referral_calling" WHERE id = p_referral_calling_id FOR UPDATE;
  IF calling.id IS NULL THEN RAISE EXCEPTION 'referral call not found' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO referral FROM "public"."referrals" WHERE id = calling.referral_id;
  target_branch := referral.branch_id;
  IF NOT "public"."is_super_admin"() AND NOT "public"."is_branch_staff"(target_branch) THEN RAISE EXCEPTION 'you may only convert referrals from your own branch' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF calling.converted_client_id IS NOT NULL THEN RETURN calling.converted_client_id; END IF;
  normalized_phone := right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10);
  target_client_id := crm_private.match_client(normalized_phone, referral.referral_name);
  IF target_client_id IS NULL THEN
    INSERT INTO "public"."clients" (primary_name, primary_phone, last_branch_id)
    VALUES (btrim(referral.referral_name), normalized_phone, target_branch) RETURNING client_id INTO target_client_id;
  END IF;
  UPDATE "public"."referral_calling" SET converted_client_id = target_client_id, status = 'CONVERTED TO CLIENT', next_followup_date = NULL WHERE id = calling.id;
  PERFORM "crm_private"."write_audit_log"('crm.convert_referral_to_client', calling.id, jsonb_build_object('converted_client_id', target_client_id));
  RETURN target_client_id;
END; $function$;

-- As 20261001000000, with a deterministic pick when several clients share the phone.
CREATE OR REPLACE FUNCTION public.lookup_client_by_phone(p_phone text)
 RETURNS TABLE(client_id uuid, client_code text, primary_name text, primary_phone text, gender text, dob date, community text, address text, pincode text, country text, state text, city text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH input AS (
    SELECT right(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), 10) AS phone
  )
  SELECT c.client_id, c.client_code::text, c.primary_name::text,
    c.primary_phone::text, c.gender::text, c.dob, c.community::text,
    c.address::text, c.pincode::text, c.country::text, c.state::text, c.city::text
  FROM "public"."client_phone_index" phone_index
  JOIN "public"."clients" c ON c.client_id = phone_index.client_id
  JOIN input ON input.phone = phone_index.phone
  WHERE length(input.phone) = 10
    AND "public"."current_user_role"() IS NOT NULL
  ORDER BY c.last_visit_date DESC NULLS LAST, c.client_code, c.client_id
  LIMIT 1;
$function$;

-- As 20261005000300, with one deterministic client per referral when several share the phone.
CREATE OR REPLACE FUNCTION public.reconcile_referral_calling_conversions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor_role "public"."user_role"; updated_count integer;
BEGIN
  actor_role := "public"."current_user_role"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  WITH matches AS (
    SELECT DISTINCT ON (calling.id) calling.id, phones.client_id
    FROM "public"."referral_calling" calling
    JOIN "public"."referrals" referral ON referral.id = calling.referral_id
    JOIN "public"."client_phone_index" phones ON phones.phone = right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10)
    JOIN "public"."clients" matched ON matched.client_id = phones.client_id
    WHERE calling.converted_client_id IS NULL
      AND matched.lifecycle_stage <> 'lead'
      AND ("public"."is_super_admin"() OR "public"."is_branch_staff"(referral.branch_id))
    ORDER BY calling.id, matched.last_visit_date DESC NULLS LAST, matched.client_code
  ), updated AS (
    UPDATE "public"."referral_calling" calling
    SET converted_client_id = matches.client_id, status = 'CONVERTED TO CLIENT', next_followup_date = NULL
    FROM matches WHERE calling.id = matches.id
    RETURNING calling.id
  ) SELECT count(*)::integer INTO updated_count FROM updated;
  PERFORM "crm_private"."write_audit_log"('crm.reconcile_referral_calling_conversions', NULL, jsonb_build_object('updated_count', updated_count));
  RETURN updated_count;
END; $function$;
