-- CRM project upgrade 3/5: audited CRM RPCs and deterministic ordering, from the port.
--
-- Generated from the JewelOS port's current definitions (schema crm, migrations
-- 0184/0185/0189/0191) of the 19 CRM functions (plus create_post_call_lead, at the end) whose bodies differ from the CRM project only by:
-- - an added crm_private.write_audit_log(...) call (audit of the mutation, 0184); or
-- - added tie-breakers in ORDER BY ("crm-port: deterministic order", 0191).
-- The conversion back to the CRM project:
-- - "crm".x and unqualified-schema crm.x become "public".x;
-- - 'crm.<action>' audit literals are kept;
-- - the port's identity swap (crm.current_crm_user_id() in place of the original
--   auth.uid()) is reversed. In the CRM project the session is the CRM user itself
--   (20261001000500).
-- Verified after apply: each body equals the CRM baseline body plus only those additions.

CREATE OR REPLACE FUNCTION public.assign_next_available_crm(p_branch_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  crm_list text[];
  previous_index integer;
  next_index integer;
  actor_role "public"."user_role";
BEGIN
  actor_role := "public"."current_user_role"();
  IF actor_role IS NULL
    OR (actor_role <> 'super_admin' AND NOT "public"."is_branch_staff"(p_branch_id))
  THEN
    RAISE EXCEPTION 'an active branch you may write to is required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT array_agg(allocation.crm_name ORDER BY allocation.created_at, allocation.id)
  INTO crm_list
  FROM "public"."crm_allocation" allocation
  LEFT JOIN "public"."crm_daily_availability" availability
    ON availability.branch_id = allocation.branch_id
    AND "public"."normalize_crm_roster_value"(availability.crm_name) = "public"."normalize_crm_roster_value"(allocation.crm_name)
    AND availability.date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
  WHERE allocation.branch_id = p_branch_id
    AND allocation.active
    AND COALESCE(availability.is_available, true);

  IF COALESCE(array_length(crm_list, 1), 0) = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO "public"."crm_queue_round_robin" (branch_id, last_index)
  VALUES (p_branch_id, -1)
  ON CONFLICT (branch_id) DO NOTHING;
  SELECT last_index INTO previous_index
  FROM "public"."crm_queue_round_robin" WHERE branch_id = p_branch_id FOR UPDATE;
  next_index := (previous_index + 1) % array_length(crm_list, 1);
  UPDATE "public"."crm_queue_round_robin"
  SET last_index = next_index, updated_at = CURRENT_TIMESTAMP
  WHERE branch_id = p_branch_id;
  PERFORM "crm_private"."write_audit_log"('crm.assign_next_available_crm', p_branch_id, jsonb_build_object('crm_name', crm_list[next_index + 1]));
  RETURN crm_list[next_index + 1];
END;
$function$
;

CREATE OR REPLACE FUNCTION public.browse_clients(search_text text, page_offset integer, result_limit integer)
 RETURNS TABLE(client_id uuid, client_code text, primary_name text, primary_phone text, city text, state text, total_visits integer, last_visit_date timestamp with time zone, last_buy_status text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT client_id, client_code, primary_name, primary_phone, city, state,
    total_visits, last_visit_date, last_buy_status
  FROM "public"."browse_clients"(search_text, NULL, page_offset, result_limit);
$function$
;

CREATE OR REPLACE FUNCTION public.browse_clients(search_text text, potential_category text, page_offset integer, result_limit integer)
 RETURNS TABLE(client_id uuid, client_code text, primary_name text, primary_phone text, city text, state text, total_visits integer, last_visit_date timestamp with time zone, last_buy_status text, client_potential_category text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH input AS (
    SELECT trim(COALESCE(search_text, '')) AS value,
      right(regexp_replace(COALESCE(search_text, ''), '[^0-9]', '', 'g'), 10) AS last10,
      NULLIF(trim(potential_category), '') AS potential
  )
  SELECT client.client_id, client.client_code::text, client.primary_name::text,
    client.primary_phone::text, client.city::text, client.state::text,
    client.total_visits, client.last_visit_date, client.last_buy_status::text,
    client.client_potential_category::text
  FROM "public"."clients" client, input
  WHERE "public"."current_user_role"() IS NOT NULL
    AND (input.potential IS NULL OR client.client_potential_category = input.potential)
    AND (input.value = '' OR client.client_code ILIKE '%' || input.value || '%'
      OR client.primary_name ILIKE '%' || input.value || '%'
      OR EXISTS (SELECT 1 FROM unnest(client.other_names) name WHERE name ILIKE '%' || input.value || '%')
      OR (length(input.last10) = 10 AND EXISTS (
        SELECT 1 FROM "public"."client_phone_index" phone_index
        WHERE phone_index.client_id = client.client_id AND phone_index.phone = input.last10
      )))
  ORDER BY client.last_visit_date DESC NULLS LAST, client.primary_name, client.client_id -- crm-port: deterministic order
  OFFSET GREATEST(page_offset, 0)
  LIMIT LEAST(GREATEST(result_limit, 1), 200);
$function$
;

CREATE OR REPLACE FUNCTION public.consume_legacy_walkin_ingest_rate_limit(p_key_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  bucket timestamptz(0) := date_trunc('minute', CURRENT_TIMESTAMP);
  count_after integer;
BEGIN
  IF length(trim(COALESCE(p_key_name, ''))) = 0 OR length(p_key_name) > 80 THEN
    RAISE EXCEPTION 'invalid rate-limit key' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO "public"."legacy_walkin_ingest_rate_limits" (bucket_start, key_name, request_count)
  VALUES (bucket, trim(p_key_name), 1)
  ON CONFLICT (bucket_start, key_name)
  DO UPDATE SET request_count = "legacy_walkin_ingest_rate_limits".request_count + 1
  RETURNING request_count INTO count_after;
  PERFORM "crm_private"."write_audit_log"('crm.consume_legacy_walkin_ingest_rate_limit', NULL, jsonb_build_object('key_name', trim(p_key_name), 'request_count', count_after));
  RETURN count_after <= 30;
END; $function$
;

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
  SELECT client_id INTO target_client_id FROM "public"."client_phone_index" WHERE phone = normalized_phone;
  IF target_client_id IS NULL THEN
    INSERT INTO "public"."clients" (primary_name, primary_phone, last_branch_id)
    VALUES (btrim(referral.referral_name), normalized_phone, target_branch) RETURNING client_id INTO target_client_id;
  END IF;
  UPDATE "public"."referral_calling" SET converted_client_id = target_client_id, status = 'CONVERTED TO CLIENT', next_followup_date = NULL WHERE id = calling.id;
  PERFORM "crm_private"."write_audit_log"('crm.convert_referral_to_client', calling.id, jsonb_build_object('converted_client_id', target_client_id));
  RETURN target_client_id;
END; $function$
;

CREATE OR REPLACE FUNCTION public.create_client_with_phone(p_primary_name text, p_primary_phone text, p_gender text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ DECLARE actor_role "public"."user_role"; own_branch uuid; target_branch uuid; new_client_id uuid; phone_digits text; BEGIN actor_role := "public"."current_user_role"(); own_branch := "public"."current_user_branch_id"(); IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF; IF length(trim(COALESCE(p_primary_name, ''))) = 0 THEN RAISE EXCEPTION 'primary name is required' USING ERRCODE = 'check_violation'; END IF; phone_digits := right(regexp_replace(COALESCE(p_primary_phone, ''), '[^0-9]', '', 'g'), 10); IF length(phone_digits) <> 10 THEN RAISE EXCEPTION 'phone must contain at least 10 digits' USING ERRCODE = 'check_violation'; END IF; IF actor_role = 'super_admin' THEN target_branch := p_branch_id; ELSE target_branch := own_branch; END IF; IF target_branch IS NULL OR NOT EXISTS (SELECT 1 FROM "public"."branches" WHERE id = target_branch AND active = true) THEN RAISE EXCEPTION 'an active branch is required' USING ERRCODE = 'check_violation'; END IF; INSERT INTO "public"."clients" (primary_name, primary_phone, gender, last_branch_id) VALUES (trim(p_primary_name), phone_digits, NULLIF(trim(p_gender), ''), target_branch) RETURNING client_id INTO new_client_id; PERFORM "crm_private"."write_audit_log"('crm.create_client_with_phone', new_client_id, jsonb_build_object('branch_id', target_branch)); RETURN new_client_id; END; $function$
;

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
    SELECT clients.client_id, clients.client_code, clients.primary_name, clients.primary_phone INTO found_client, found_client_code, canonical_name, phone_digits FROM "public"."clients" WHERE clients.client_id = p_client_id;
    IF found_client IS NULL THEN RAISE EXCEPTION 'selected client is not available' USING ERRCODE = 'insufficient_privilege'; END IF;
  ELSE
    phone_digits := right(regexp_replace(COALESCE(p_mobile, ''), '[^0-9]', '', 'g'), 10); canonical_name := trim(COALESCE(p_client_name, ''));
    IF length(canonical_name) = 0 OR length(phone_digits) <> 10 THEN RAISE EXCEPTION 'client name and a 10-digit phone are required' USING ERRCODE = 'check_violation'; END IF;
    SELECT phone_index.client_id, clients.client_code INTO found_client, found_client_code FROM "public"."client_phone_index" phone_index JOIN "public"."clients" clients ON clients.client_id = phone_index.client_id WHERE phone_index.phone = phone_digits;
    IF found_client IS NULL THEN
      BEGIN
        INSERT INTO "public"."clients" (primary_name, primary_phone, last_branch_id)
        VALUES (canonical_name, phone_digits, target_branch)
        RETURNING clients.client_id, clients.client_code INTO found_client, found_client_code;
        created_client := true;
      EXCEPTION WHEN unique_violation THEN
        SELECT phone_index.client_id, clients.client_code INTO found_client, found_client_code FROM "public"."client_phone_index" phone_index JOIN "public"."clients" clients ON clients.client_id = phone_index.client_id WHERE phone_index.phone = phone_digits;
        IF found_client IS NULL THEN RAISE; END IF;
      END;
    END IF;
  END IF;
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_manual_referral(p_client_id uuid, p_referral_name text, p_referral_number text, p_crm_name text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS public.referrals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor_role "public"."user_role"; own_branch uuid; target_branch uuid; normalized_phone text; created_referral "public"."referrals";
BEGIN
  actor_role := "public"."current_user_role"(); own_branch := "public"."current_user_branch_id"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  target_branch := CASE WHEN actor_role = 'super_admin' THEN p_branch_id ELSE own_branch END;
  normalized_phone := right(regexp_replace(COALESCE(p_referral_number, ''), '[^0-9]', '', 'g'), 10);
  IF p_client_id IS NULL OR length(btrim(COALESCE(p_referral_name, ''))) = 0 OR length(normalized_phone) <> 10 THEN RAISE EXCEPTION 'referring client, referral name, and a 10-digit referral number are required' USING ERRCODE = 'check_violation'; END IF;
  IF target_branch IS NULL OR NOT "public"."is_branch_staff"(target_branch) THEN RAISE EXCEPTION 'an own branch is required' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "public"."clients" WHERE client_id = p_client_id) THEN RAISE EXCEPTION 'referring client not found' USING ERRCODE = 'no_data_found'; END IF;
  INSERT INTO "public"."referrals" ("crm_name", "salesperson_id", "given_by_client_id", "referral_name", "referral_number", "branch_id")
  VALUES (NULLIF(btrim(p_crm_name), ''), auth.uid(), p_client_id, btrim(p_referral_name), normalized_phone, target_branch)
  RETURNING * INTO created_referral;
  PERFORM "public"."create_referral_calling_if_open"(created_referral.id, created_referral.referral_name, normalized_phone, "public"."next_business_day"(CURRENT_DATE));
  PERFORM "crm_private"."write_audit_log"('crm.create_manual_referral', created_referral.id, jsonb_build_object('given_by_client_id', created_referral.given_by_client_id, 'branch_id', created_referral.branch_id));
  RETURN created_referral;
END; $function$
;

CREATE OR REPLACE FUNCTION public.create_manual_referral(p_client_id uuid, p_referral_name text, p_referral_number text, p_crm_name text, p_branch_id uuid, p_relationship text, p_best_time_to_call text)
 RETURNS public.referrals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor_role "public"."user_role"; own_branch uuid; target_branch uuid; normalized_phone text; created_referral "public"."referrals";
BEGIN
  actor_role := "public"."current_user_role"(); own_branch := "public"."current_user_branch_id"(); target_branch := CASE WHEN actor_role = 'super_admin' THEN p_branch_id ELSE own_branch END;
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  normalized_phone := right(regexp_replace(COALESCE(p_referral_number, ''), '[^0-9]', '', 'g'), 10);
  IF p_client_id IS NULL OR length(btrim(COALESCE(p_referral_name, ''))) = 0 OR length(normalized_phone) <> 10 THEN RAISE EXCEPTION 'referring client, referral name, and a 10-digit referral number are required' USING ERRCODE = 'check_violation'; END IF;
  IF target_branch IS NULL OR NOT "public"."is_branch_staff"(target_branch) THEN RAISE EXCEPTION 'an own branch is required' USING ERRCODE = 'insufficient_privilege'; END IF;
  INSERT INTO "public"."referrals" ("crm_name","salesperson_id","given_by_client_id","referral_name","referral_number","branch_id","relationship","best_time_to_call") VALUES (NULLIF(btrim(p_crm_name),''),auth.uid(),p_client_id,btrim(p_referral_name),normalized_phone,target_branch,NULLIF(btrim(p_relationship),''),NULLIF(btrim(p_best_time_to_call),'')) RETURNING * INTO created_referral;
  PERFORM "public"."create_referral_calling_if_open"(created_referral.id,created_referral.referral_name,normalized_phone,"public"."next_business_day"(CURRENT_DATE)); PERFORM "crm_private"."write_audit_log"('crm.create_manual_referral', created_referral.id, jsonb_build_object('given_by_client_id', created_referral.given_by_client_id, 'branch_id', created_referral.branch_id)); RETURN created_referral;
END; $function$
;

CREATE OR REPLACE FUNCTION public.create_not_bought_followup_from_visit_form()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE source_visit record; legacy_status text; has_seen_product boolean; initial_remark text; active_followup "public"."not_bought_followups"; system_remark text;
BEGIN
  SELECT timeline."client_id", timeline."branch_id", timeline."id" AS timeline_id, timeline."event_date", timeline."reference_number", timeline."salesperson_id", timeline."buy_status"::text AS buy_status, timeline."seen_categories", timeline."bought_categories", timeline."order_categories", timeline."remark" AS timeline_remark, client."next_visit_date"
  INTO source_visit
  FROM "public"."client_timeline" AS timeline JOIN "public"."clients" AS client ON client."client_id" = timeline."client_id"
  WHERE timeline."id" = NEW."client_timeline_id";
  IF source_visit."client_id" IS NULL THEN RETURN NEW; END IF;
  legacy_status := upper(btrim(COALESCE(NULLIF(NEW."additional_fields"->>'visit_status', ''), source_visit."buy_status")));
  has_seen_product := EXISTS (SELECT 1 FROM unnest(COALESCE(source_visit."seen_categories", ARRAY[]::text[])) AS item(value) WHERE upper(btrim(item.value)) NOT IN ('', 'NA', 'N/A', '-', 'NONE'))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(NEW."category_details"->'seen_tags', '[]'::jsonb)) AS item(value) WHERE upper(btrim(item.value)) NOT IN ('', 'NA', 'N/A', '-', 'NONE'));

  SELECT * INTO active_followup FROM "public"."not_bought_followups"
  WHERE "client_id" = source_visit."client_id" AND NOT "public"."not_bought_followup_status_is_done"("status")
  ORDER BY "created_at", "id" /* crm-port: deterministic order */ FOR UPDATE LIMIT 1;

  -- CRM_CODE.GS:3917-3925, 4101-4135: ready-product purchases and
  -- product exchanges close the one active follow-up; repair/order do not.
  IF legacy_status IN ('YES', 'YES_AND_ORDER_PLACED', 'YES AND ORDER_PLACED', 'PRODUCT_EXCHANGE') THEN
    IF active_followup."id" IS NOT NULL THEN
      system_remark := concat_ws(' | ', 'AUTO CLOSED: CLIENT PURCHASED IN LATER WALK-IN VISIT.', 'PURCHASE REFERENCE: ' || COALESCE(source_visit."reference_number", ''), 'PURCHASE VISIT DATE: ' || (source_visit."event_date" AT TIME ZONE 'Asia/Kolkata')::date::text, 'BUY STATUS: ' || legacy_status, 'BOUGHT: ' || COALESCE(array_to_string(source_visit."bought_categories", ', '), ''), 'ORDER: ' || COALESCE(array_to_string(source_visit."order_categories", ', '), ''), 'REMARK: ' || COALESCE(source_visit."timeline_remark", ''));
      PERFORM set_config('app.not_bought_system_event', 'auto_close', true); PERFORM set_config('app.not_bought_system_remark', system_remark, true);
      UPDATE "public"."not_bought_followups" SET "status" = 'ALREADY PURCHASED FROM MK JEWELS', "call_response" = 'AUTO CLOSED - CLIENT PURCHASED IN LATER VISIT', "remark" = system_remark, "next_followup_date" = NULL WHERE "id" = active_followup."id";
      PERFORM set_config('app.not_bought_system_event', '', true); PERFORM set_config('app.not_bought_system_remark', '', true);
    END IF;
    RETURN NEW;
  END IF;

  IF legacy_status <> 'NO' AND NOT (legacy_status IN ('REPAIR_PICKUP', 'REPAIR_PLACED', 'ORDER_PICKUP', 'ORDER_PLACED') AND upper(btrim(COALESCE(NEW."repair_or_order_approach", ''))) = 'YES' AND has_seen_product) THEN RETURN NEW; END IF;
  initial_remark := NULLIF(concat_ws('; ', array_to_string(NEW."not_bought_reasons", ', '), NEW."not_bought_other"), '');
  IF active_followup."id" IS NOT NULL THEN
    -- CRM_CODE.GS:4171-4226: preserve the original owner/source link, move
    -- the due date forward from the later visit, and append system history.
    system_remark := concat_ws(' | ', 'CLIENT VISITED AGAIN AND STILL NOT BOUGHT.', 'REFERENCE: ' || COALESCE(source_visit."reference_number", ''), 'CLIENT VISIT DATE: ' || (source_visit."event_date" AT TIME ZONE 'Asia/Kolkata')::date::text, 'SEEN: ' || COALESCE(array_to_string(source_visit."seen_categories", ', '), ''), 'PRODUCT REQUIREMENT: ' || COALESCE((SELECT "product_requirement" FROM "public"."client_timeline" WHERE "id" = source_visit."timeline_id"), ''), 'REASON: ' || COALESCE(initial_remark, ''), 'ORIGINAL REMARK: ' || COALESCE(source_visit."timeline_remark", ''));
    PERFORM set_config('app.not_bought_system_event', 'merge', true); PERFORM set_config('app.not_bought_system_remark', system_remark, true);
    UPDATE "public"."not_bought_followups" SET "next_followup_date" = COALESCE(source_visit."next_visit_date", "next_followup_date", (source_visit."event_date" AT TIME ZONE 'Asia/Kolkata')::date) WHERE "id" = active_followup."id";
    PERFORM set_config('app.not_bought_system_event', '', true); PERFORM set_config('app.not_bought_system_remark', '', true);
    RETURN NEW;
  END IF;
  INSERT INTO "public"."not_bought_followups" ("client_id","reference_number","status","next_followup_date","remark","entered_by","branch_id","source_timeline_id","source_visit_form_id")
  VALUES (source_visit."client_id",source_visit."reference_number",'PENDING',COALESCE(source_visit."next_visit_date",(source_visit."event_date" AT TIME ZONE 'Asia/Kolkata')::date),initial_remark,source_visit."salesperson_id",source_visit."branch_id",source_visit."timeline_id",NEW."id");
  RETURN NEW;
END; $function$
;

CREATE OR REPLACE FUNCTION public.manage_crm_roster(p_operation text, p_roster_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid, p_crm_name text DEFAULT NULL::text, p_target_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, branch_id uuid, crm_name text, active boolean, message text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  action text := upper(btrim(COALESCE(p_operation, '')));
  source_row "public"."crm_allocation"%ROWTYPE;
  target_branch uuid := COALESCE(p_target_branch_id, p_branch_id);
  normalized_name text := "public"."normalize_crm_roster_value"(p_crm_name);
  existing_id uuid;
  source_branch uuid;
  actor_role "public"."user_role";
BEGIN
  actor_role := "public"."current_user_role"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF action NOT IN ('ADD', 'UPDATE', 'DELETE') THEN RAISE EXCEPTION 'invalid roster action' USING ERRCODE = 'check_violation'; END IF;
  IF action <> 'DELETE' AND normalized_name = '' THEN RAISE EXCEPTION 'CRM NAME IS REQUIRED.' USING ERRCODE = 'check_violation'; END IF;

  IF action = 'ADD' THEN
    IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM "public"."branches" branch WHERE branch.id = p_branch_id AND branch.active) THEN RAISE EXCEPTION 'BRANCH NAME IS REQUIRED.' USING ERRCODE = 'check_violation'; END IF;
    IF actor_role <> 'super_admin' AND NOT "public"."is_branch_manager"(p_branch_id) THEN RAISE EXCEPTION 'branch manager access is required' USING ERRCODE = 'insufficient_privilege'; END IF;
    INSERT INTO "public"."crm_allocation" (branch_id, crm_name, active) VALUES (p_branch_id, normalized_name, true)
    RETURNING * INTO source_row;
    DELETE FROM "public"."crm_daily_availability" availability WHERE availability.branch_id = p_branch_id;
    PERFORM "crm_private"."write_audit_log"('crm.manage_crm_roster', source_row.id, jsonb_build_object('operation', action, 'branch_id', source_row.branch_id, 'crm_name', source_row.crm_name));
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
    UPDATE "public"."crm_allocation" allocation SET branch_id = target_branch, crm_name = normalized_name WHERE allocation.id = source_row.id RETURNING * INTO source_row;
  END IF;
  DELETE FROM "public"."crm_daily_availability" availability WHERE availability.branch_id IN (source_branch, target_branch);
  PERFORM "crm_private"."write_audit_log"('crm.manage_crm_roster', COALESCE(existing_id, source_row.id), jsonb_build_object('operation', action, 'source_branch_id', source_branch, 'branch_id', target_branch, 'crm_name', normalized_name));
  RETURN QUERY SELECT COALESCE(existing_id, source_row.id), target_branch, normalized_name, true, 'CRM / Branch updated successfully.'::text;
END;
$function$
;

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
    SELECT calling.id, phones.client_id
    FROM "public"."referral_calling" calling
    JOIN "public"."referrals" referral ON referral.id = calling.referral_id
    JOIN "public"."client_phone_index" phones ON phones.phone = right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10)
    WHERE calling.converted_client_id IS NULL
      AND ("public"."is_super_admin"() OR "public"."is_branch_staff"(referral.branch_id))
  ), updated AS (
    UPDATE "public"."referral_calling" calling
    SET converted_client_id = matches.client_id, status = 'CONVERTED TO CLIENT', next_followup_date = NULL
    FROM matches WHERE calling.id = matches.id
    RETURNING calling.id
  ) SELECT count(*)::integer INTO updated_count FROM updated;
  PERFORM "crm_private"."write_audit_log"('crm.reconcile_referral_calling_conversions', NULL, jsonb_build_object('updated_count', updated_count));
  RETURN updated_count;
END; $function$
;

CREATE OR REPLACE FUNCTION public.save_not_bought_followup(p_followup_id uuid, p_followup_status text, p_call_response text, p_next_followup_date date DEFAULT NULL::date, p_remark text DEFAULT NULL::text)
 RETURNS public.not_bought_followups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor_role "public"."user_role"; target "public"."not_bought_followups"; normalized_status text;
BEGIN
  actor_role := "public"."current_user_role"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO target FROM "public"."not_bought_followups" WHERE id = p_followup_id FOR UPDATE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'follow-up not found' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT "public"."is_super_admin"() AND NOT "public"."is_branch_staff"(target.branch_id) THEN RAISE EXCEPTION 'you may only update follow-ups from your own branch' USING ERRCODE = 'insufficient_privilege'; END IF;
  normalized_status := upper(btrim(COALESCE(p_followup_status, '')));
  IF normalized_status NOT IN (
    'PENDING', 'CLIENT ASKED TO CALL LATER', 'INTERESTED - NEED FOLLOW UP',
    'NEGOTIATION / PRICE DISCUSSION', 'VISIT PLANNED', 'WHATSAPP SENT', 'NOT DECIDED YET',
    'ALREADY PURCHASED FROM MK JEWELS', 'ALREADY PURCHASED FROM ANOTHER JEWELLER',
    'NO REQUIREMENT AT THE MOMENT (FOLLOW UP AFTER A FEW MONTHS)', 'CALL NOT PICKED',
    -- Safe compatibility for records written by the previous canonical RPC.
    'IN PROCESS', 'FOLLOW UP DONE'
  ) THEN RAISE EXCEPTION 'invalid follow-up status' USING ERRCODE = 'check_violation'; END IF;
  IF upper(btrim(COALESCE(p_call_response, ''))) NOT IN ('CONNECTED', 'NOT PICKED', 'SWITCHED OFF', 'WHATSAPP ONLY', 'WRONG NUMBER') THEN RAISE EXCEPTION 'invalid call response' USING ERRCODE = 'check_violation'; END IF;
  IF NOT "public"."not_bought_followup_status_is_done"(normalized_status)
     AND NULLIF(btrim(COALESCE(p_remark, '')), '') IS NULL THEN
    RAISE EXCEPTION 'follow-up remark is required unless done' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE "public"."not_bought_followups"
  SET status = normalized_status,
      call_response = upper(btrim(p_call_response)),
      remark = CASE WHEN "public"."not_bought_followup_status_is_done"(normalized_status) THEN NULL ELSE NULLIF(btrim(p_remark), '') END,
      next_followup_date = CASE WHEN "public"."not_bought_followup_status_is_done"(normalized_status) THEN NULL ELSE p_next_followup_date END
  WHERE id = p_followup_id RETURNING * INTO target;
  PERFORM "crm_private"."write_audit_log"('crm.save_not_bought_followup', target.id, jsonb_build_object('status', target.status, 'call_response', target.call_response));
  RETURN target;
END; $function$
;

CREATE OR REPLACE FUNCTION public.save_referral_followup(p_referral_calling_id uuid, p_followup_status text, p_call_response text, p_next_followup_date date DEFAULT NULL::date, p_remark text DEFAULT NULL::text, p_entered_by text DEFAULT NULL::text)
 RETURNS public.referral_calling
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor_role "public"."user_role"; target "public"."referral_calling"; target_branch uuid; normalized_status text; converted_id uuid;
BEGIN
  actor_role := "public"."current_user_role"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT calling.* INTO target FROM "public"."referral_calling" calling WHERE calling.id = p_referral_calling_id FOR UPDATE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'referral call not found' USING ERRCODE = 'no_data_found'; END IF;
  SELECT referral.branch_id INTO target_branch FROM "public"."referrals" referral WHERE referral.id = target.referral_id;
  IF NOT "public"."is_super_admin"() AND NOT "public"."is_branch_staff"(target_branch) THEN RAISE EXCEPTION 'you may only update referrals from your own branch' USING ERRCODE = 'insufficient_privilege'; END IF;
  normalized_status := upper(btrim(COALESCE(p_followup_status, '')));
  IF normalized_status NOT IN ('PENDING', 'IN PROCESS', 'FOLLOW UP DONE', 'CONVERTED TO CLIENT') THEN RAISE EXCEPTION 'invalid follow-up status' USING ERRCODE = 'check_violation'; END IF;
  IF upper(btrim(COALESCE(p_call_response, ''))) NOT IN ('CONNECTED', 'CALL NOT PICKED', 'NOT ANSWERED', 'WRONG NUMBER', 'WHATSAPP SENT') THEN RAISE EXCEPTION 'invalid call response' USING ERRCODE = 'check_violation'; END IF;
  IF normalized_status NOT IN ('FOLLOW UP DONE', 'CONVERTED TO CLIENT') AND NULLIF(btrim(COALESCE(p_remark, '')), '') IS NULL THEN RAISE EXCEPTION 'follow-up remark is required unless done' USING ERRCODE = 'check_violation'; END IF;
  IF normalized_status = 'CONVERTED TO CLIENT' THEN
    SELECT phones.client_id INTO converted_id FROM "public"."referrals" referral JOIN "public"."client_phone_index" phones ON phones.phone = right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10) WHERE referral.id = target.referral_id;
    IF converted_id IS NULL THEN RAISE EXCEPTION 'no existing client matches this referral number; use Convert to Client to create one' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  PERFORM set_config('app.referral_entered_by', NULLIF(btrim(COALESCE(p_entered_by, '')), ''), true);
  UPDATE "public"."referral_calling"
  SET status = normalized_status, call_response = upper(btrim(p_call_response)), remark = NULLIF(btrim(p_remark), ''),
      next_followup_date = CASE WHEN normalized_status IN ('FOLLOW UP DONE', 'CONVERTED TO CLIENT') THEN NULL ELSE p_next_followup_date END,
      converted_client_id = CASE WHEN normalized_status = 'CONVERTED TO CLIENT' THEN converted_id ELSE converted_client_id END
  WHERE id = p_referral_calling_id RETURNING * INTO target;
  PERFORM "crm_private"."write_audit_log"('crm.save_referral_followup', target.id, jsonb_build_object('status', target.status, 'call_response', target.call_response));
  RETURN target;
END; $function$
;

CREATE OR REPLACE FUNCTION public.save_referral_followup(p_referral_calling_id uuid, p_followup_status text, p_call_response text, p_next_followup_date date DEFAULT NULL::date, p_remark text DEFAULT NULL::text, p_entered_by text DEFAULT NULL::text, p_request_key uuid DEFAULT NULL::uuid)
 RETURNS public.referral_calling
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor_role "public"."user_role"; target "public"."referral_calling"; target_branch uuid;
  normalized_status text; normalized_response text; actor_name text;
BEGIN
  actor_role := "public"."current_user_role"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT calling.* INTO target FROM "public"."referral_calling" calling WHERE calling.id = p_referral_calling_id FOR UPDATE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'referral call not found' USING ERRCODE = 'no_data_found'; END IF;
  SELECT referral.branch_id INTO target_branch FROM "public"."referrals" referral WHERE referral.id = target.referral_id;
  IF NOT "public"."is_super_admin"() AND NOT "public"."is_branch_staff"(target_branch) THEN RAISE EXCEPTION 'you may only update referrals from your own branch' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_request_key IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."referral_calling_history" WHERE referral_calling_id = target.id AND request_key = p_request_key) THEN RETURN target; END IF;
  normalized_status := upper(btrim(COALESCE(p_followup_status, '')));
  normalized_response := upper(btrim(COALESCE(p_call_response, '')));
  IF normalized_status NOT IN ('PENDING','FOLLOW REQUIRED','CALL NOT PICKED','NOT ANSWERED','CALL CONNECTED','YES INTERESTED','INTERESTED - NEED FOLLOW UP','VISIT PLANNED','WHATSAPP SENT','CONVERTED TO CLIENT','ALREADY PURCHASED FROM MK JEWELS','NOT INTERESTED','NO REQUIREMENT AT THE MOMENT','WRONG NUMBER','DO NOT CALL') THEN RAISE EXCEPTION 'invalid follow-up status' USING ERRCODE = 'check_violation'; END IF;
  IF normalized_response NOT IN ('CONNECTED','CALL NOT PICKED','NOT ANSWERED','WRONG NUMBER','WHATSAPP SENT') THEN RAISE EXCEPTION 'invalid call response' USING ERRCODE = 'check_violation'; END IF;
  IF normalized_status NOT IN ('CONVERTED TO CLIENT','ALREADY PURCHASED FROM MK JEWELS','NOT INTERESTED','NO REQUIREMENT AT THE MOMENT','WRONG NUMBER','DO NOT CALL') AND p_next_followup_date IS NULL THEN RAISE EXCEPTION 'next follow-up date is required' USING ERRCODE = 'check_violation'; END IF;
  IF normalized_status NOT IN ('CONVERTED TO CLIENT','ALREADY PURCHASED FROM MK JEWELS','NOT INTERESTED','NO REQUIREMENT AT THE MOMENT','WRONG NUMBER','DO NOT CALL') AND NULLIF(btrim(COALESCE(p_remark, '')), '') IS NULL THEN RAISE EXCEPTION 'follow-up remark is required' USING ERRCODE = 'check_violation'; END IF;
  SELECT name INTO actor_name FROM "public"."users" WHERE id = auth.uid();
  PERFORM set_config('app.referral_entered_by', COALESCE(actor_name, 'CRM'), true);
  PERFORM set_config('app.referral_request_key', COALESCE(p_request_key::text, ''), true);
  UPDATE "public"."referral_calling" SET status = normalized_status, call_response = normalized_response,
    remark = NULLIF(btrim(p_remark), ''), next_followup_date = CASE WHEN normalized_status IN ('CONVERTED TO CLIENT','ALREADY PURCHASED FROM MK JEWELS','NOT INTERESTED','NO REQUIREMENT AT THE MOMENT','WRONG NUMBER','DO NOT CALL') THEN NULL ELSE p_next_followup_date END
  WHERE id = target.id RETURNING * INTO target;
  PERFORM "crm_private"."write_audit_log"('crm.save_referral_followup', target.id, jsonb_build_object('status', target.status, 'call_response', target.call_response, 'request_key', p_request_key));
  RETURN target;
END; $function$
;

CREATE OR REPLACE FUNCTION public.search_clients(search_text text, result_limit integer DEFAULT 8)
 RETURNS TABLE(client_id uuid, primary_name text, primary_phone text, last_visit_date timestamp with time zone, last_branch_name text, matched_phone text, total_visits integer, last_buy_status text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH input AS (SELECT trim(search_text) AS value, regexp_replace(search_text, '[^0-9]', '', 'g') AS digits)
  SELECT c.client_id, c.primary_name::text, c.primary_phone::text, c.last_visit_date, b.name::text, p.phone::text, c.total_visits, c.last_buy_status::text
  FROM "public"."clients" c LEFT JOIN "public"."branches" b ON b.id = c.last_branch_id
  LEFT JOIN LATERAL (SELECT pi.phone FROM "public"."client_phone_index" pi, input WHERE pi.client_id = c.client_id AND input.digits <> '' AND pi.phone LIKE '%' || right(input.digits, 10) || '%' ORDER BY (pi.phone = right(input.digits, 10)) DESC, pi.phone DESC /* crm-port: deterministic order */ LIMIT 1) p ON true, input
  WHERE "public"."current_user_role"() IS NOT NULL AND ((length(input.digits) >= 3 AND p.phone IS NOT NULL) OR (length(input.value) >= 3 AND (c.primary_name ILIKE '%' || input.value || '%' OR EXISTS (SELECT 1 FROM unnest(c.other_names) name WHERE name ILIKE '%' || input.value || '%'))))
  ORDER BY (p.phone = right(input.digits, 10)) DESC NULLS LAST, c.last_visit_date DESC NULLS LAST, c.primary_name, c.client_id /* crm-port: deterministic order */ LIMIT LEAST(GREATEST(result_limit, 1), 20);
$function$
;

CREATE OR REPLACE FUNCTION public.submit_legacy_walkin_visit(p_payload jsonb)
 RETURNS TABLE(client_id uuid, timeline_id uuid, reference_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  target_branch uuid;
  ingest_actor uuid;
  actor_email text;
  queue_token text;
  queue_id uuid;
BEGIN
  target_branch := NULLIF(p_payload->>'branch_id', '')::uuid;
  IF target_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM "public"."branches" WHERE id = target_branch AND active
  ) THEN
    RAISE EXCEPTION 'an active branch is required' USING ERRCODE = 'check_violation';
  END IF;

  actor_email := 'legacy-ingest+' || target_branch::text || '@internal.invalid';
  SELECT id INTO ingest_actor FROM "public"."users" WHERE email = actor_email;
  IF ingest_actor IS NULL THEN
    INSERT INTO "public"."users" (id, name, email, role, branch_id, active)
    VALUES (gen_random_uuid(), 'Legacy Apps Script Ingestion', actor_email, 'salesperson', target_branch, true)
    RETURNING id INTO ingest_actor;
  END IF;

  queue_token := NULLIF(p_payload->>'entry_queue_id', '');
  IF queue_token IS NOT NULL THEN
    SELECT id INTO queue_id
    FROM "public"."entry_queue"
    WHERE token = queue_token AND branch_id = target_branch;
    IF queue_id IS NULL THEN
      RAISE EXCEPTION 'legacy entry token does not belong to this branch' USING ERRCODE = 'check_violation';
    END IF;
    p_payload := jsonb_set(p_payload, '{entry_queue_id}', to_jsonb(queue_id::text));
  END IF;

  PERFORM set_config('request.jwt.claim.sub', ingest_actor::text, true);
  PERFORM set_config('app.audit_source', 'legacy_apps_script_ingest', true);
  PERFORM "crm_private"."write_audit_log"('crm.submit_legacy_walkin_visit', queue_id, jsonb_build_object('branch_id', target_branch, 'ingest_actor', ingest_actor));
  RETURN QUERY SELECT * FROM "public"."submit_walkin_visit"(p_payload);
END; $function$
;

CREATE OR REPLACE FUNCTION public.submit_walkin_visit(p_payload jsonb)
 RETURNS TABLE(client_id uuid, timeline_id uuid, reference_number text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  actor_role "public"."user_role"; own_branch uuid; target_branch uuid; target_client uuid; new_client boolean;
  phone_digits text; queue_id uuid; visit_id uuid; ref text; seq integer; event_at timestamptz;
  purchase_status "public"."buy_status"; profile jsonb; details jsonb; proof jsonb; doc jsonb;
BEGIN
  actor_role := "public"."current_user_role"(); own_branch := "public"."current_user_branch_id"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  target_branch := NULLIF(p_payload->>'branch_id', '')::uuid;
  IF target_branch IS NULL OR (actor_role <> 'super_admin' AND NOT "public"."is_branch_staff"(target_branch)) THEN RAISE EXCEPTION 'you may only submit visits for your own branch' USING ERRCODE = 'insufficient_privilege'; END IF;
  phone_digits := right(regexp_replace(COALESCE(p_payload->>'primary_phone', ''), '[^0-9]', '', 'g'), 10);
  IF length(phone_digits) <> 10 OR length(trim(COALESCE(p_payload->>'primary_name', ''))) = 0 THEN RAISE EXCEPTION 'client name and a 10-digit phone are required' USING ERRCODE = 'check_violation'; END IF;
  target_client := NULLIF(p_payload->>'client_id', '')::uuid;
  IF target_client IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "public"."clients" AS existing_client WHERE existing_client.client_id = target_client) THEN target_client := NULL; END IF;
  IF target_client IS NULL THEN SELECT phone_index.client_id INTO target_client FROM "public"."client_phone_index" AS phone_index WHERE phone_index.phone = phone_digits; END IF;
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
  SELECT count(*) + 1 INTO seq FROM "public"."client_timeline" WHERE branch_id = target_branch AND event_date::date = event_at::date;
  ref := upper(COALESCE((SELECT substr(name, 1, 3) FROM "public"."branches" WHERE id = target_branch), 'MJK')) || '-' || to_char(event_at, 'YYMMDD') || '-' || lpad(seq::text, 4, '0');
  LOOP BEGIN
    INSERT INTO "public"."client_timeline" (id,client_id,event_date,buy_status,branch_id,crm_name,salesperson_id,seen_categories,bought_categories,order_categories,product_requirement,remark,reference_number)
    VALUES (COALESCE(NULLIF(p_payload->>'proposed_timeline_id', '')::uuid, gen_random_uuid()),target_client,event_at,purchase_status,target_branch,NULLIF(trim(p_payload->>'crm_name'), ''),auth.uid(),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'seen_categories','[]'::jsonb))),ARRAY[]::text[]),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'bought_categories','[]'::jsonb))),ARRAY[]::text[]),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'order_categories','[]'::jsonb))),ARRAY[]::text[]),NULLIF(trim(p_payload->>'product_requirement'), ''),NULLIF(trim(p_payload->>'remark'), ''),ref) RETURNING id INTO visit_id;
    EXIT; EXCEPTION WHEN unique_violation THEN seq := seq + 1; ref := upper(COALESCE((SELECT substr(name, 1, 3) FROM "public"."branches" WHERE id = target_branch), 'MJK')) || '-' || to_char(event_at, 'YYMMDD') || '-' || lpad(seq::text, 4, '0'); END; END LOOP;
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
END; $function$
;

CREATE OR REPLACE FUNCTION public.sync_not_bought_followups()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor_role "public"."user_role"; eligible record; inserted_count integer := 0;
BEGIN
  actor_role := "public"."current_user_role"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  FOR eligible IN
    SELECT timeline.id AS timeline_id, timeline.client_id, timeline.reference_number, timeline.branch_id,
      timeline.event_date, timeline.salesperson_id, client.next_visit_date, form.id AS visit_form_id,
      NULLIF(concat_ws('; ', array_to_string(form.not_bought_reasons, ', '), form.not_bought_other), '') AS initial_remark
    FROM "public"."visit_forms" AS form
    JOIN "public"."client_timeline" AS timeline ON timeline.id = form.client_timeline_id
    JOIN "public"."clients" AS client ON client.client_id = timeline.client_id
    WHERE upper(btrim(COALESCE(NULLIF(form.additional_fields->>'visit_status', ''), timeline.buy_status::text))) = 'NO'
       OR (
         upper(btrim(COALESCE(NULLIF(form.additional_fields->>'visit_status', ''), timeline.buy_status::text))) IN ('REPAIR_PICKUP', 'REPAIR_PLACED', 'ORDER_PICKUP', 'ORDER_PLACED')
         AND upper(btrim(COALESCE(form.repair_or_order_approach, ''))) = 'YES'
         AND (
           EXISTS (SELECT 1 FROM unnest(COALESCE(timeline.seen_categories, ARRAY[]::text[])) AS item(value) WHERE upper(btrim(item.value)) NOT IN ('', 'NA', 'N/A', '-', 'NONE'))
           OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(form.category_details->'seen_tags', '[]'::jsonb)) AS item(value) WHERE upper(btrim(item.value)) NOT IN ('', 'NA', 'N/A', '-', 'NONE'))
         )
       )
  LOOP
    IF NOT ("public"."is_super_admin"() OR "public"."is_branch_staff"(eligible.branch_id)) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM "public"."not_bought_followups" AS current WHERE current.source_timeline_id = eligible.timeline_id)
       OR EXISTS (
         SELECT 1 FROM "public"."not_bought_followups" AS current
         WHERE current.client_id = eligible.client_id
           AND NOT "public"."not_bought_followup_status_is_done"(current.status)
       ) THEN CONTINUE; END IF;
    INSERT INTO "public"."not_bought_followups" (client_id, reference_number, status, next_followup_date, remark, entered_by, branch_id, source_timeline_id, source_visit_form_id)
    VALUES (eligible.client_id, eligible.reference_number, 'PENDING',
      COALESCE(eligible.next_visit_date, (eligible.event_date AT TIME ZONE 'Asia/Kolkata')::date),
      eligible.initial_remark, eligible.salesperson_id, eligible.branch_id, eligible.timeline_id, eligible.visit_form_id);
    inserted_count := inserted_count + 1;
  END LOOP;
  PERFORM "crm_private"."write_audit_log"('crm.sync_not_bought_followups', NULL, jsonb_build_object('inserted_count', inserted_count));
  RETURN inserted_count;
END; $function$
;

CREATE OR REPLACE FUNCTION public.update_not_bought_followup(p_followup_id uuid, p_call_response text, p_remark text DEFAULT NULL::text, p_next_followup_date date DEFAULT NULL::date)
 RETURNS public.not_bought_followups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor_role "public"."user_role"; target "public"."not_bought_followups"; target_status varchar(80); next_date date;
BEGIN
  actor_role := "public"."current_user_role"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO target FROM "public"."not_bought_followups" WHERE "id" = p_followup_id FOR UPDATE;
  IF target."id" IS NULL THEN RAISE EXCEPTION 'follow-up not found' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT "public"."is_super_admin"() AND NOT "public"."is_branch_staff"(target."branch_id") THEN RAISE EXCEPTION 'you may only update follow-ups from your own branch' USING ERRCODE = 'insufficient_privilege'; END IF;
  target_status := "public"."legacy_call_outcome_status"(p_call_response);
  next_date := CASE WHEN "public"."legacy_status_is_done"(target_status) THEN NULL ELSE COALESCE(p_next_followup_date, CURRENT_DATE + 3) END;
  UPDATE "public"."not_bought_followups"
  SET "status" = target_status, "call_response" = CASE WHEN lower(btrim(p_call_response)) IN ('interested','no_response','converted','not_interested','reschedule') THEN lower(btrim(p_call_response)) ELSE upper(btrim(p_call_response)) END, "remark" = NULLIF(btrim(p_remark), ''), "next_followup_date" = next_date
  WHERE "id" = p_followup_id RETURNING * INTO target;
  PERFORM "crm_private"."write_audit_log"('crm.update_not_bought_followup', target.id, jsonb_build_object('status', target.status, 'call_response', target.call_response));
  RETURN target;
END; $function$
;

CREATE OR REPLACE FUNCTION public.update_not_bought_reason(p_followup_id uuid, p_reasons text[], p_other text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE target "public"."not_bought_followups";
BEGIN
  SELECT * INTO target FROM "public"."not_bought_followups" WHERE "id" = p_followup_id FOR UPDATE;
  IF target."id" IS NULL THEN RAISE EXCEPTION 'follow-up not found' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT "public"."is_super_admin"() AND NOT "public"."is_branch_staff"(target."branch_id") THEN RAISE EXCEPTION 'you may only update follow-ups from your own branch' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF target."source_visit_form_id" IS NULL THEN RAISE EXCEPTION 'follow-up has no source visit form' USING ERRCODE = 'check_violation'; END IF;
  UPDATE "public"."visit_forms" SET "not_bought_reasons" = COALESCE(p_reasons, ARRAY[]::text[]), "not_bought_other" = NULLIF(btrim(p_other), '') WHERE "id" = target."source_visit_form_id";
  PERFORM "crm_private"."write_audit_log"('crm.update_not_bought_reason', target.id, jsonb_build_object('source_visit_form_id', target.source_visit_form_id));
END; $function$
;

CREATE OR REPLACE FUNCTION public.update_referral_calling(p_referral_calling_id uuid, p_call_response text, p_remark text DEFAULT NULL::text, p_next_followup_date date DEFAULT NULL::date)
 RETURNS public.referral_calling
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor_role "public"."user_role"; target "public"."referral_calling"; target_branch uuid; target_status varchar(80); next_date date;
BEGIN
  actor_role := "public"."current_user_role"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT calling.* INTO target FROM "public"."referral_calling" calling WHERE calling.id = p_referral_calling_id FOR UPDATE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'referral call not found' USING ERRCODE = 'no_data_found'; END IF;
  SELECT referral.branch_id INTO target_branch FROM "public"."referrals" referral WHERE referral.id = target.referral_id;
  IF NOT "public"."is_super_admin"() AND NOT "public"."is_branch_staff"(target_branch) THEN RAISE EXCEPTION 'you may only update referrals from your own branch' USING ERRCODE = 'insufficient_privilege'; END IF;
  target_status := "public"."legacy_call_outcome_status"(p_call_response);
  next_date := CASE WHEN "public"."legacy_status_is_done"(target_status) THEN NULL ELSE COALESCE(p_next_followup_date, CURRENT_DATE + 3) END;
  UPDATE "public"."referral_calling"
  SET "status" = target_status, "call_response" = CASE WHEN lower(btrim(p_call_response)) IN ('interested','no_response','converted','not_interested','reschedule') THEN lower(btrim(p_call_response)) ELSE upper(btrim(p_call_response)) END, "remark" = NULLIF(btrim(p_remark), ''), "next_followup_date" = next_date
  WHERE id = p_referral_calling_id RETURNING * INTO target;
  PERFORM "crm_private"."write_audit_log"('crm.update_referral_calling', target.id, jsonb_build_object('status', target.status, 'call_response', target.call_response));
  RETURN target;
END; $function$
;

-- create_post_call_lead: the port also audits it (0189 era). The original definition is in
-- 20261001000100, which runs before crm_private exists, so the audited version is applied here.
CREATE OR REPLACE FUNCTION public.create_post_call_lead(p_phone_number text, p_name text, p_field_values jsonb, p_call_response public.lead_call_response, p_remark text DEFAULT NULL::text, p_next_followup_date date DEFAULT NULL::date, p_call_duration_seconds integer DEFAULT NULL::integer, p_recording_upload_status public.lead_recording_upload_status DEFAULT 'pending'::public.lead_recording_upload_status)
 RETURNS public.leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_lead "public"."leads"; v_actor "public"."user_role";
BEGIN
  v_actor := "public"."current_user_role"();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_phone_number !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'phone number must contain exactly 10 digits' USING ERRCODE = 'check_violation'; END IF;
  IF p_call_duration_seconds IS NOT NULL AND p_call_duration_seconds < 0 THEN RAISE EXCEPTION 'call duration cannot be negative' USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO "public"."leads" ("phone_number", "name", "field_values", "created_via", "created_by") VALUES (p_phone_number, NULLIF(btrim(p_name), ''), COALESCE(p_field_values, '{}'::jsonb), 'mobile_post_call', auth.uid()) RETURNING * INTO v_lead;
  INSERT INTO "public"."lead_call_history" ("lead_id", "call_response", "remark", "next_followup_date", "call_duration_seconds", "recording_upload_status", "entered_by") VALUES (v_lead.id, p_call_response, NULLIF(btrim(p_remark), ''), p_next_followup_date, p_call_duration_seconds, p_recording_upload_status, auth.uid());
  PERFORM "crm_private"."write_audit_log"('crm.create_post_call_lead', v_lead.id, jsonb_build_object('created_via', v_lead.created_via));
  RETURN v_lead;
END; $function$
;
