


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."buy_status" AS ENUM (
    'ORDER_PLACED',
    'ORDER_PICKUP',
    'REPAIR_PLACED',
    'REPAIR_PICKUP',
    'PRODUCT_RETURN',
    'PRODUCT_EXCHANGE',
    'STORE_VISIT',
    'PRICE_CALCULATION',
    'YES',
    'NO',
    'YES_AND_ORDER_PLACED',
    'ORDER_PLACED_AND_BUYING_NEW_PRODUCT',
    'ORDER_PLACED_AND_MAKING_NEW_ORDER',
    'ORDER_PICKUP_AND_BUYING_NEW_PRODUCT',
    'ORDER_PICKUP_AND_MAKING_NEW_ORDER',
    'REPAIR_PLACED_AND_BUYING_NEW_PRODUCT',
    'REPAIR_PLACED_AND_MAKING_NEW_ORDER',
    'REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT',
    'REPAIR_PICKUP_AND_MAKING_NEW_ORDER'
);


ALTER TYPE "public"."buy_status" OWNER TO "postgres";


CREATE TYPE "public"."event_type" AS ENUM (
    'UPSALE_VISIT',
    'READY_PRODUCT_PURCHASE',
    'ORDER_PLACED_VISIT',
    'ORDER_PICKUP_VISIT',
    'REPAIR_PLACED_VISIT',
    'REPAIR_PICKUP_VISIT',
    'PRODUCT_RETURN_VISIT',
    'PRODUCT_EXCHANGE_VISIT',
    'NON_PURCHASE_VISIT',
    'STORE_VISIT',
    'PRICE_CALCULATION_VISIT',
    'VISIT'
);


ALTER TYPE "public"."event_type" OWNER TO "postgres";


CREATE TYPE "public"."lead_created_via" AS ENUM (
    'crm_desktop',
    'mobile_post_call'
);


ALTER TYPE "public"."lead_created_via" OWNER TO "postgres";


CREATE TYPE "public"."lead_field_type" AS ENUM (
    'text',
    'number',
    'dropdown',
    'date',
    'geo',
    'file'
);


ALTER TYPE "public"."lead_field_type" OWNER TO "postgres";


CREATE TYPE "public"."lead_source_channel" AS ENUM (
    'open',
    'contacted',
    'converted',
    'lost'
);


ALTER TYPE "public"."lead_source_channel" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'super_admin',
    'branch_manager',
    'salesperson'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_client_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NULLIF(btrim(NEW."client_code"), '') IS NULL THEN
    NEW."client_code" := 'MKC-' || nextval('"public"."client_code_sequence"')::text;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."assign_client_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_next_available_crm"("p_branch_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  RETURN crm_list[next_index + 1];
END;
$$;


ALTER FUNCTION "public"."assign_next_available_crm"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_client_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$ DECLARE changed_field text; actor_id uuid; audit_source text; BEGIN actor_id := COALESCE("auth"."uid"(), NEW.profile_updated_by); audit_source := COALESCE(NULLIF(current_setting('app.audit_source', true), ''), 'database_trigger'); FOR changed_field IN SELECT new_fields.key FROM jsonb_each(to_jsonb(NEW)) AS new_fields WHERE new_fields.key NOT IN ('profile_updated_at', 'profile_updated_by') AND (to_jsonb(OLD) -> new_fields.key) IS DISTINCT FROM (to_jsonb(NEW) -> new_fields.key) LOOP INSERT INTO "public"."client_edit_log" (client_id, edited_by, source, field_name, old_value, new_value) VALUES (NEW.client_id, actor_id, audit_source, changed_field, to_jsonb(OLD) -> changed_field, to_jsonb(NEW) -> changed_field); END LOOP; RETURN NEW; END; $$;


ALTER FUNCTION "public"."audit_client_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."browse_clients"("search_text" "text", "page_offset" integer, "result_limit" integer) RETURNS TABLE("client_id" "uuid", "client_code" "text", "primary_name" "text", "primary_phone" "text", "city" "text", "state" "text", "total_visits" integer, "last_visit_date" timestamp with time zone, "last_buy_status" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  SELECT client_id, client_code, primary_name, primary_phone, city, state,
    total_visits, last_visit_date, last_buy_status
  FROM "public"."browse_clients"(search_text, NULL, page_offset, result_limit);
$$;


ALTER FUNCTION "public"."browse_clients"("search_text" "text", "page_offset" integer, "result_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."browse_clients"("search_text" "text", "potential_category" "text", "page_offset" integer, "result_limit" integer) RETURNS TABLE("client_id" "uuid", "client_code" "text", "primary_name" "text", "primary_phone" "text", "city" "text", "state" "text", "total_visits" integer, "last_visit_date" timestamp with time zone, "last_buy_status" "text", "client_potential_category" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
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
  ORDER BY client.last_visit_date DESC NULLS LAST, client.primary_name
  OFFSET GREATEST(page_offset, 0)
  LIMIT LEAST(GREATEST(result_limit, 1), 200);
$$;


ALTER FUNCTION "public"."browse_clients"("search_text" "text", "potential_category" "text", "page_offset" integer, "result_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_legacy_walkin_ingest_rate_limit"("p_key_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  RETURN count_after <= 30;
END; $$;


ALTER FUNCTION "public"."consume_legacy_walkin_ingest_rate_limit"("p_key_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."convert_referral_to_client"("p_referral_calling_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  RETURN target_client_id;
END; $$;


ALTER FUNCTION "public"."convert_referral_to_client"("p_referral_calling_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_client_with_phone"("p_primary_name" "text", "p_primary_phone" "text", "p_gender" "text" DEFAULT NULL::"text", "p_branch_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$ DECLARE actor_role "public"."user_role"; own_branch uuid; target_branch uuid; new_client_id uuid; phone_digits text; BEGIN actor_role := "public"."current_user_role"(); own_branch := "public"."current_user_branch_id"(); IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF; IF length(trim(COALESCE(p_primary_name, ''))) = 0 THEN RAISE EXCEPTION 'primary name is required' USING ERRCODE = 'check_violation'; END IF; phone_digits := right(regexp_replace(COALESCE(p_primary_phone, ''), '[^0-9]', '', 'g'), 10); IF length(phone_digits) <> 10 THEN RAISE EXCEPTION 'phone must contain at least 10 digits' USING ERRCODE = 'check_violation'; END IF; IF actor_role = 'super_admin' THEN target_branch := p_branch_id; ELSE target_branch := own_branch; END IF; IF target_branch IS NULL OR NOT EXISTS (SELECT 1 FROM "public"."branches" WHERE id = target_branch AND active = true) THEN RAISE EXCEPTION 'an active branch is required' USING ERRCODE = 'check_violation'; END IF; INSERT INTO "public"."clients" (primary_name, primary_phone, gender, last_branch_id) VALUES (trim(p_primary_name), phone_digits, NULLIF(trim(p_gender), ''), target_branch) RETURNING client_id INTO new_client_id; RETURN new_client_id; END; $$;


ALTER FUNCTION "public"."create_client_with_phone"("p_primary_name" "text", "p_primary_phone" "text", "p_gender" "text", "p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_entry_queue"("p_client_name" "text", "p_mobile" "text", "p_branch_id" "uuid" DEFAULT NULL::"uuid", "p_assigned_crm_name" "text" DEFAULT NULL::"text", "p_client_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "token" "text", "client_id" "uuid", "client_code" "text", "client_type" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
  RETURN QUERY SELECT id, generated_token, found_client, found_client_code, CASE WHEN created_client THEN 'new' ELSE 'existing' END;
END;
$$;


ALTER FUNCTION "public"."create_entry_queue"("p_client_name" "text", "p_mobile" "text", "p_branch_id" "uuid", "p_assigned_crm_name" "text", "p_client_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "crm_name" character varying(160),
    "salesperson_id" "uuid" NOT NULL,
    "given_by_client_id" "uuid" NOT NULL,
    "referral_name" character varying(160) NOT NULL,
    "referral_number" character varying(30) NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "branch_id" "uuid",
    "source_timeline_id" "uuid",
    "source_visit_form_id" "uuid",
    "relationship" character varying(120),
    "best_time_to_call" character varying(120),
    "assigned_doer" character varying(160)
);


ALTER TABLE "public"."referrals" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_manual_referral"("p_client_id" "uuid", "p_referral_name" "text", "p_referral_number" "text", "p_crm_name" "text" DEFAULT NULL::"text", "p_branch_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."referrals"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  VALUES (NULLIF(btrim(p_crm_name), ''), "auth"."uid"(), p_client_id, btrim(p_referral_name), normalized_phone, target_branch)
  RETURNING * INTO created_referral;
  PERFORM "public"."create_referral_calling_if_open"(created_referral.id, created_referral.referral_name, normalized_phone, "public"."next_business_day"(CURRENT_DATE));
  RETURN created_referral;
END; $$;


ALTER FUNCTION "public"."create_manual_referral"("p_client_id" "uuid", "p_referral_name" "text", "p_referral_number" "text", "p_crm_name" "text", "p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_manual_referral"("p_client_id" "uuid", "p_referral_name" "text", "p_referral_number" "text", "p_crm_name" "text", "p_branch_id" "uuid", "p_relationship" "text", "p_best_time_to_call" "text") RETURNS "public"."referrals"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE actor_role "public"."user_role"; own_branch uuid; target_branch uuid; normalized_phone text; created_referral "public"."referrals";
BEGIN
  actor_role := "public"."current_user_role"(); own_branch := "public"."current_user_branch_id"(); target_branch := CASE WHEN actor_role = 'super_admin' THEN p_branch_id ELSE own_branch END;
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  normalized_phone := right(regexp_replace(COALESCE(p_referral_number, ''), '[^0-9]', '', 'g'), 10);
  IF p_client_id IS NULL OR length(btrim(COALESCE(p_referral_name, ''))) = 0 OR length(normalized_phone) <> 10 THEN RAISE EXCEPTION 'referring client, referral name, and a 10-digit referral number are required' USING ERRCODE = 'check_violation'; END IF;
  IF target_branch IS NULL OR NOT "public"."is_branch_staff"(target_branch) THEN RAISE EXCEPTION 'an own branch is required' USING ERRCODE = 'insufficient_privilege'; END IF;
  INSERT INTO "public"."referrals" ("crm_name","salesperson_id","given_by_client_id","referral_name","referral_number","branch_id","relationship","best_time_to_call") VALUES (NULLIF(btrim(p_crm_name),''),"auth"."uid"(),p_client_id,btrim(p_referral_name),normalized_phone,target_branch,NULLIF(btrim(p_relationship),''),NULLIF(btrim(p_best_time_to_call),'')) RETURNING * INTO created_referral;
  PERFORM "public"."create_referral_calling_if_open"(created_referral.id,created_referral.referral_name,normalized_phone,"public"."next_business_day"(CURRENT_DATE)); RETURN created_referral;
END; $$;


ALTER FUNCTION "public"."create_manual_referral"("p_client_id" "uuid", "p_referral_name" "text", "p_referral_number" "text", "p_crm_name" "text", "p_branch_id" "uuid", "p_relationship" "text", "p_best_time_to_call" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_not_bought_followup_from_visit_form"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
  ORDER BY "created_at" FOR UPDATE LIMIT 1;

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
END; $$;


ALTER FUNCTION "public"."create_not_bought_followup_from_visit_form"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_referral_calling_if_open"("p_referral_id" "uuid", "p_name" "text", "p_number" "text", "p_next_date" "date") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "public"."referral_calling" calling
    JOIN "public"."referrals" referral ON referral.id = calling.referral_id
    JOIN "public"."clients" referral_giver ON referral_giver.client_id = referral.given_by_client_id
    WHERE lower(btrim(referral.referral_name)) = lower(btrim(p_name))
      AND right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10) = right(regexp_replace(p_number, '[^0-9]', '', 'g'), 10)
      AND left(regexp_replace(upper(btrim(referral_giver.primary_name)), '[^A-Z0-9]', '', 'g'), 20) = (
        SELECT left(regexp_replace(upper(btrim(source_giver.primary_name)), '[^A-Z0-9]', '', 'g'), 20)
        FROM "public"."referrals" source_referral
        JOIN "public"."clients" source_giver ON source_giver.client_id = source_referral.given_by_client_id
        WHERE source_referral.id = p_referral_id
      )
      AND calling.status NOT IN ('CONVERTED TO CLIENT','ALREADY PURCHASED FROM MK JEWELS','NOT INTERESTED','NO REQUIREMENT AT THE MOMENT','WRONG NUMBER','DO NOT CALL')
  ) THEN RETURN; END IF;
  INSERT INTO "public"."referral_calling" ("referral_id", "status", "next_followup_date", "action_point")
  VALUES (p_referral_id, 'PENDING', p_next_date,
    'Referral Follow Up: Call using referral giver name for trust, confirm jewellery requirement, note occasion/budget, and set next follow-up date.')
  ON CONFLICT ("referral_id") DO NOTHING;
END; $$;


ALTER FUNCTION "public"."create_referral_calling_if_open"("p_referral_id" "uuid", "p_name" "text", "p_number" "text", "p_next_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_referral_from_visit_form"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  source_visit record;
  referral_item jsonb;
  v_referral_name text;
  v_normalized_phone text;
  new_referral_id uuid;
BEGIN
  SELECT timeline."client_id", timeline."branch_id", timeline."id" AS timeline_id,
         timeline."event_date", timeline."salesperson_id", timeline."crm_name"
  INTO source_visit
  FROM "public"."client_timeline" AS timeline
  WHERE timeline."id" = NEW."client_timeline_id";

  IF source_visit."client_id" IS NULL THEN
    RAISE EXCEPTION 'walk-in referral source visit is missing' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Preserve the established single-referral capture path.
  IF NEW."referrals_asked" IS TRUE
     AND length(btrim(COALESCE(NEW."reference_name", ''))) > 0 THEN
    v_referral_name := btrim(NEW."reference_name");
    v_normalized_phone := right(regexp_replace(COALESCE(NEW."reference_phone", ''), '[^0-9]', '', 'g'), 10);
    IF length(v_normalized_phone) = 10 THEN
      INSERT INTO "public"."referrals" (
        "crm_name", "salesperson_id", "given_by_client_id", "referral_name", "referral_number",
        "branch_id", "source_timeline_id", "source_visit_form_id"
      )
      SELECT source_visit."crm_name", source_visit."salesperson_id", source_visit."client_id", v_referral_name, v_normalized_phone,
             source_visit."branch_id", source_visit."timeline_id", NEW."id"
      WHERE NOT EXISTS (
        SELECT 1 FROM "public"."referrals" AS existing
        WHERE existing."source_visit_form_id" = NEW."id"
          AND lower(btrim(existing."referral_name")) = lower(v_referral_name)
          AND existing."referral_number" = v_normalized_phone
      )
      RETURNING "id" INTO new_referral_id;
      IF new_referral_id IS NOT NULL THEN
        PERFORM "public"."create_referral_calling_if_open"(
          new_referral_id, v_referral_name, v_normalized_phone,
          "public"."next_business_day"(source_visit."event_date"::date)
        );
      END IF;
    END IF;
  END IF;

  IF NEW."additional_fields" ? 'referrals'
     AND jsonb_typeof(NEW."additional_fields"->'referrals') <> 'array' THEN
    RAISE EXCEPTION 'walk-in referrals must be an array' USING ERRCODE = 'check_violation';
  END IF;

  FOR referral_item IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(NEW."additional_fields"->'referrals', '[]'::jsonb))
  LOOP
    IF jsonb_typeof(referral_item) <> 'object' THEN
      RAISE EXCEPTION 'each walk-in referral must include a name and 10-digit phone' USING ERRCODE = 'check_violation';
    END IF;
    v_referral_name := btrim(COALESCE(referral_item->>'name', ''));
    v_normalized_phone := right(regexp_replace(COALESCE(referral_item->>'mobile', ''), '[^0-9]', '', 'g'), 10);
    IF length(v_referral_name) = 0 OR length(v_normalized_phone) <> 10 THEN
      RAISE EXCEPTION 'each walk-in referral requires a name and 10-digit phone' USING ERRCODE = 'check_violation';
    END IF;

    new_referral_id := NULL;
    INSERT INTO "public"."referrals" (
      "crm_name", "salesperson_id", "given_by_client_id", "referral_name", "referral_number",
      "branch_id", "source_timeline_id", "source_visit_form_id"
    )
    SELECT source_visit."crm_name", source_visit."salesperson_id", source_visit."client_id", v_referral_name, v_normalized_phone,
           source_visit."branch_id", source_visit."timeline_id", NEW."id"
    WHERE NOT EXISTS (
      SELECT 1 FROM "public"."referrals" AS existing
      WHERE existing."source_visit_form_id" = NEW."id"
        AND lower(btrim(existing."referral_name")) = lower(v_referral_name)
        AND existing."referral_number" = v_normalized_phone
    )
    RETURNING "id" INTO new_referral_id;

    IF new_referral_id IS NOT NULL THEN
      PERFORM "public"."create_referral_calling_if_open"(
        new_referral_id, v_referral_name, v_normalized_phone,
        "public"."next_business_day"(source_visit."event_date"::date)
      );
    END IF;
  END LOOP;

  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."create_referral_from_visit_form"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_crm_user_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT access_grant."legacy_crm_user_id"
  FROM "public"."crm_sso_access_grants" AS access_grant
  JOIN "public"."users" AS profile ON profile."id" = access_grant."legacy_crm_user_id"
  WHERE access_grant."active" = true
    AND profile."active" = true
    AND EXISTS (
      SELECT 1
      FROM "auth"."identities" AS identity
      WHERE identity."user_id" = "auth"."uid"()
        AND identity."identity_data" ->> 'sub' = access_grant."jewelos_user_id"::text
    )
$$;


ALTER FUNCTION "public"."current_crm_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_branch_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT profile."branch_id"
  FROM "public"."users" AS profile
  WHERE profile."id" = "public"."current_crm_user_id"()
    AND profile."active" = true
$$;


ALTER FUNCTION "public"."current_user_branch_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role"() RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT profile."role"
  FROM "public"."users" AS profile
  WHERE profile."id" = "public"."current_crm_user_id"()
    AND profile."active" = true
$$;


ALTER FUNCTION "public"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dedupe_category_array"("p_values" "text"[]) RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT value
      FROM (
        SELECT btrim(value) AS value, min(ordinality) AS first_position
        FROM unnest(COALESCE(p_values, ARRAY[]::text[])) WITH ORDINALITY AS input(value, ordinality)
        WHERE btrim(value) <> ''
        GROUP BY btrim(value)
      ) AS distinct_values
      ORDER BY first_position
    ),
    ARRAY[]::text[]
  );
$$;


ALTER FUNCTION "public"."dedupe_category_array"("p_values" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dedupe_category_array_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'client_timeline' THEN
    NEW.seen_categories := "public"."dedupe_category_array"(NEW.seen_categories);
    NEW.bought_categories := "public"."dedupe_category_array"(NEW.bought_categories);
    NEW.order_categories := "public"."dedupe_category_array"(NEW.order_categories);
  ELSE
    NEW.last_seen_categories := "public"."dedupe_category_array"(NEW.last_seen_categories);
    NEW.last_bought_categories := "public"."dedupe_category_array"(NEW.last_bought_categories);
    NEW.last_order_categories := "public"."dedupe_category_array"(NEW.last_order_categories);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."dedupe_category_array_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_profile"() RETURNS TABLE("name" "text", "role" "public"."user_role", "branch_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT profile."name"::text, profile."role", branch."name"::text
  FROM "public"."users" AS profile
  LEFT JOIN "public"."branches" AS branch ON branch."id" = profile."branch_id"
  WHERE profile."id" = "public"."current_crm_user_id"()
    AND profile."active" = true
$$;


ALTER FUNCTION "public"."get_my_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_branch_manager"("row_branch_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT COALESCE(
        "public"."current_user_role"() = 'branch_manager'
        AND "public"."current_user_branch_id"() = row_branch_id,
        false
    )
$$;


ALTER FUNCTION "public"."is_branch_manager"("row_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_branch_staff"("row_branch_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT COALESCE(
        "public"."current_user_role"() IN ('branch_manager', 'salesperson')
        AND "public"."current_user_branch_id"() = row_branch_id,
        false
    )
$$;


ALTER FUNCTION "public"."is_branch_staff"("row_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT COALESCE("public"."current_user_role"() = 'super_admin', false)
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_user_in_current_branch"("row_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT COALESCE(
        EXISTS (
            SELECT 1
            FROM "public"."users" AS profile
            WHERE profile.id = row_user_id
              AND profile.active = true
              AND profile.branch_id = "public"."current_user_branch_id"()
        ),
        false
    )
$$;


ALTER FUNCTION "public"."is_user_in_current_branch"("row_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."legacy_call_outcome_status"("p_outcome" "text") RETURNS character varying
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
BEGIN
  CASE upper(btrim(COALESCE(p_outcome, '')))
    WHEN 'YES (CLIENT NEED FOLLOW-UP)' THEN RETURN 'INTERESTED - NEED FOLLOW UP';
    WHEN 'NO (CLIENT ASKED FOR APPOINTMENT)' THEN RETURN 'VISIT PLANNED';
    WHEN 'NO (CALL NOT CONNECTED)' THEN RETURN 'CALL NOT PICKED';
    WHEN 'RINGING / NOT ANSWERED' THEN RETURN 'CALL NOT PICKED';
    WHEN 'SWITCHED OFF' THEN RETURN 'CALL NOT PICKED';
    WHEN 'BUSY / DECLINED' THEN RETURN 'CALL NOT PICKED';
    WHEN 'ALREADY PURCHASED FROM MK JEWELS' THEN RETURN 'ALREADY PURCHASED FROM MK JEWELS';
    WHEN 'ALREADY PURCHASED FROM ANOTHER JEWELLER' THEN RETURN 'ALREADY PURCHASED FROM ANOTHER JEWELLER';
    WHEN 'NO REQUIREMENT AT THE MOMENT (FOLLOW UP AFTER A FEW MONTHS)' THEN RETURN 'NO REQUIREMENT AT THE MOMENT (FOLLOW UP AFTER A FEW MONTHS)';
    WHEN 'INTERESTED' THEN RETURN 'pending';
    WHEN 'NO_RESPONSE' THEN RETURN 'pending';
    WHEN 'CONVERTED' THEN RETURN 'converted';
    WHEN 'NOT_INTERESTED' THEN RETURN 'closed';
    WHEN 'RESCHEDULE' THEN RETURN 'pending';
    ELSE RAISE EXCEPTION 'invalid legacy call outcome' USING ERRCODE = 'check_violation';
  END CASE;
END; $$;


ALTER FUNCTION "public"."legacy_call_outcome_status"("p_outcome" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."legacy_status_is_done"("p_status" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  SELECT upper(btrim(COALESCE(p_status, ''))) IN (
    'ALREADY PURCHASED FROM MK JEWELS',
    'ALREADY PURCHASED FROM ANOTHER JEWELLER',
    'NO REQUIREMENT AT THE MOMENT (FOLLOW UP AFTER A FEW MONTHS)',
    'CONVERTED TO CLIENT'
  )
$$;


ALTER FUNCTION "public"."legacy_status_is_done"("p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_client_by_phone"("p_phone" "text") RETURNS TABLE("client_id" "uuid", "client_code" "text", "primary_name" "text", "primary_phone" "text", "gender" "text", "dob" "date", "community" "text", "address" "text", "pincode" "text", "country" "text", "state" "text", "city" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
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
  LIMIT 1;
$$;


ALTER FUNCTION "public"."lookup_client_by_phone"("p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."manage_crm_roster"("p_operation" "text", "p_roster_id" "uuid" DEFAULT NULL::"uuid", "p_branch_id" "uuid" DEFAULT NULL::"uuid", "p_crm_name" "text" DEFAULT NULL::"text", "p_target_branch_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "branch_id" "uuid", "crm_name" "text", "active" boolean, "message" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
  RETURN QUERY SELECT COALESCE(existing_id, source_row.id), target_branch, normalized_name, true, 'CRM / Branch updated successfully.'::text;
END;
$$;


ALTER FUNCTION "public"."manage_crm_roster"("p_operation" "text", "p_roster_id" "uuid", "p_branch_id" "uuid", "p_crm_name" "text", "p_target_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_business_day"("p_date" "date") RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  SELECT p_date + CASE extract(isodow FROM p_date)::integer WHEN 5 THEN 3 WHEN 6 THEN 2 ELSE 1 END
$$;


ALTER FUNCTION "public"."next_business_day"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_client_phone_index"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    digits text;
BEGIN
    digits := regexp_replace(NEW.phone, '[^0-9]', '', 'g');

    IF length(digits) < 10 THEN
        RAISE EXCEPTION 'phone must contain at least 10 digits'
            USING ERRCODE = 'check_violation';
    END IF;

    NEW.phone := right(digits, 10);
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."normalize_client_phone_index"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_crm_roster_value"("value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  SELECT upper(regexp_replace(btrim(COALESCE(value, '')), '[[:space:]]+', ' ', 'g'))
$$;


ALTER FUNCTION "public"."normalize_crm_roster_value"("value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_lookup_label"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW."label" := upper(btrim(NEW."label"));
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."normalize_lookup_label"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."not_bought_followup_status_is_done"("p_status" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  SELECT upper(btrim(COALESCE(p_status, ''))) IN (
    'ALREADY PURCHASED FROM MK JEWELS',
    'ALREADY PURCHASED FROM ANOTHER JEWELLER',
    'NO REQUIREMENT AT THE MOMENT (FOLLOW UP AFTER A FEW MONTHS)',
    'CALL NOT PICKED',
    'FOLLOW UP DONE',
    'CLOSED',
    'CONVERTED',
    'CONVERTED TO CLIENT'
  )
$$;


ALTER FUNCTION "public"."not_bought_followup_status_is_done"("p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_not_bought_history_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'not-bought follow-up history is immutable' USING ERRCODE = 'insufficient_privilege';
END; $$;


ALTER FUNCTION "public"."prevent_not_bought_history_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_client_rollups"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    latest_event "public"."client_timeline"%ROWTYPE;
BEGIN
    IF TG_WHEN = 'BEFORE' THEN
        NEW.event_type := CASE
            WHEN NEW.buy_status IN (
                'ORDER_PLACED_AND_BUYING_NEW_PRODUCT',
                'ORDER_PLACED_AND_MAKING_NEW_ORDER',
                'ORDER_PICKUP_AND_MAKING_NEW_ORDER',
                'ORDER_PICKUP_AND_BUYING_NEW_PRODUCT',
                'REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT',
                'REPAIR_PICKUP_AND_MAKING_NEW_ORDER',
                'REPAIR_PLACED_AND_BUYING_NEW_PRODUCT',
                'REPAIR_PLACED_AND_MAKING_NEW_ORDER'
            ) THEN 'UPSALE_VISIT'::"public"."event_type"
            WHEN NEW.buy_status IN (
                'YES',
                'YES_AND_ORDER_PLACED'
            ) THEN 'READY_PRODUCT_PURCHASE'::"public"."event_type"
            WHEN NEW.buy_status = 'ORDER_PLACED'
                THEN 'ORDER_PLACED_VISIT'::"public"."event_type"
            WHEN NEW.buy_status = 'ORDER_PICKUP'
                THEN 'ORDER_PICKUP_VISIT'::"public"."event_type"
            WHEN NEW.buy_status = 'REPAIR_PLACED'
                THEN 'REPAIR_PLACED_VISIT'::"public"."event_type"
            WHEN NEW.buy_status = 'REPAIR_PICKUP'
                THEN 'REPAIR_PICKUP_VISIT'::"public"."event_type"
            WHEN NEW.buy_status = 'PRODUCT_RETURN'
                THEN 'PRODUCT_RETURN_VISIT'::"public"."event_type"
            WHEN NEW.buy_status = 'PRODUCT_EXCHANGE'
                THEN 'PRODUCT_EXCHANGE_VISIT'::"public"."event_type"
            WHEN NEW.buy_status = 'NO'
                THEN 'NON_PURCHASE_VISIT'::"public"."event_type"
            WHEN NEW.buy_status = 'STORE_VISIT'
                THEN 'STORE_VISIT'::"public"."event_type"
            WHEN NEW.buy_status = 'PRICE_CALCULATION'
                THEN 'PRICE_CALCULATION_VISIT'::"public"."event_type"
            ELSE 'VISIT'::"public"."event_type"
        END;

        RETURN NEW;
    END IF;

    SELECT timeline.*
    INTO latest_event
    FROM "public"."client_timeline" AS timeline
    WHERE timeline.client_id = NEW.client_id
    ORDER BY timeline.event_date DESC, timeline.created_at DESC, timeline.id DESC
    LIMIT 1;

    UPDATE "public"."clients" AS client
    SET
        total_visits = aggregates.total_visits,
        total_purchase_visits = aggregates.total_purchase_visits,
        total_non_purchase_visits = aggregates.total_non_purchase_visits,
        total_repair_visits = aggregates.total_repair_visits,
        total_order_visits = aggregates.total_order_visits,
        first_visit_date = aggregates.first_visit_date,
        last_visit_date = aggregates.last_visit_date,
        last_buy_status = latest_event.buy_status,
        last_branch_id = latest_event.branch_id,
        last_crm_name = latest_event.crm_name,
        last_salesperson_id = latest_event.salesperson_id,
        last_remark = latest_event.remark,
        last_product_requirement = latest_event.product_requirement,
        last_seen_categories = latest_event.seen_categories,
        last_bought_categories = latest_event.bought_categories,
        last_order_categories = latest_event.order_categories,
        profile_updated_at = now()
    FROM (
        SELECT
            count(*)::integer AS total_visits,
            count(*) FILTER (
                WHERE t.buy_status IN (
                    'YES',
                    'YES_AND_ORDER_PLACED'
                )
            )::integer AS total_purchase_visits,
            count(*) FILTER (
                WHERE t.buy_status IN (
                    'NO',
                    'PRODUCT_RETURN',
                    'STORE_VISIT',
                    'PRICE_CALCULATION'
                )
            )::integer AS total_non_purchase_visits,
            count(*) FILTER (
                WHERE t.buy_status::text LIKE 'REPAIR_PLACED%'
                   OR t.buy_status::text LIKE 'REPAIR_PICKUP%'
            )::integer AS total_repair_visits,
            count(*) FILTER (
                WHERE t.buy_status::text LIKE 'ORDER_PLACED%'
                   OR t.buy_status::text LIKE 'ORDER_PICKUP%'
            )::integer AS total_order_visits,
            min(t.event_date) AS first_visit_date,
            max(t.event_date) AS last_visit_date
        FROM "public"."client_timeline" AS t
        WHERE t.client_id = NEW.client_id
    ) AS aggregates
    WHERE client.client_id = NEW.client_id;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."recalculate_client_rollups"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_referral_calling_conversions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  RETURN updated_count;
END; $$;


ALTER FUNCTION "public"."reconcile_referral_calling_conversions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_not_bought_followup_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE system_event text := current_setting('app.not_bought_system_event', true);
BEGIN
  IF NEW."status" IS NOT DISTINCT FROM OLD."status"
     AND NEW."call_response" IS NOT DISTINCT FROM OLD."call_response"
     AND NEW."remark" IS NOT DISTINCT FROM OLD."remark"
     AND NEW."next_followup_date" IS NOT DISTINCT FROM OLD."next_followup_date" THEN
    RETURN NEW;
  END IF;
  IF system_event IN ('merge', 'auto_close') THEN
    INSERT INTO "public"."not_bought_history" ("followup_id","status","previous_status","remark","call_response","updated_by")
    VALUES (
      NEW."id", NEW."status", OLD."status",
      NULLIF(current_setting('app.not_bought_system_remark', true), ''),
      CASE WHEN system_event = 'merge' THEN 'CLIENT REVISITED - STILL NOT BOUGHT' ELSE 'AUTO CLOSED - CLIENT PURCHASED IN LATER VISIT' END,
      "auth"."uid"()
    );
    RETURN NEW;
  END IF;
  NEW."followup_count" := OLD."followup_count" + 1;
  INSERT INTO "public"."not_bought_history" ("followup_id","status","previous_status","remark","call_response","updated_by")
  VALUES (NEW."id",NEW."status",OLD."status",NEW."remark",NEW."call_response","auth"."uid"());
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."record_not_bought_followup_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_referral_calling_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
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
END; $$;


ALTER FUNCTION "public"."record_referral_calling_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."not_bought_followups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "reference_number" character varying(100),
    "status" character varying(80) NOT NULL,
    "next_followup_date" "date",
    "call_response" "text",
    "remark" "text",
    "entered_by" "uuid" NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "branch_id" "uuid",
    "source_timeline_id" "uuid",
    "source_visit_form_id" "uuid",
    "followup_count" integer DEFAULT 0 NOT NULL,
    "action_point" "text"
);


ALTER TABLE "public"."not_bought_followups" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_not_bought_followup"("p_followup_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date" DEFAULT NULL::"date", "p_remark" "text" DEFAULT NULL::"text") RETURNS "public"."not_bought_followups"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  RETURN target;
END; $$;


ALTER FUNCTION "public"."save_not_bought_followup"("p_followup_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referral_calling" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referral_id" "uuid" NOT NULL,
    "status" character varying(80) NOT NULL,
    "remark" "text",
    "next_followup_date" "date",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "call_response" "text",
    "converted_client_id" "uuid",
    "followup_count" integer DEFAULT 0 NOT NULL,
    "action_point" "text"
);


ALTER TABLE "public"."referral_calling" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_referral_followup"("p_referral_calling_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date" DEFAULT NULL::"date", "p_remark" "text" DEFAULT NULL::"text", "p_entered_by" "text" DEFAULT NULL::"text") RETURNS "public"."referral_calling"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  RETURN target;
END; $$;


ALTER FUNCTION "public"."save_referral_followup"("p_referral_calling_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text", "p_entered_by" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_referral_followup"("p_referral_calling_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date" DEFAULT NULL::"date", "p_remark" "text" DEFAULT NULL::"text", "p_entered_by" "text" DEFAULT NULL::"text", "p_request_key" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."referral_calling"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  SELECT name INTO actor_name FROM "public"."users" WHERE id = "auth"."uid"();
  PERFORM set_config('app.referral_entered_by', COALESCE(actor_name, 'CRM'), true);
  PERFORM set_config('app.referral_request_key', COALESCE(p_request_key::text, ''), true);
  UPDATE "public"."referral_calling" SET status = normalized_status, call_response = normalized_response,
    remark = NULLIF(btrim(p_remark), ''), next_followup_date = CASE WHEN normalized_status IN ('CONVERTED TO CLIENT','ALREADY PURCHASED FROM MK JEWELS','NOT INTERESTED','NO REQUIREMENT AT THE MOMENT','WRONG NUMBER','DO NOT CALL') THEN NULL ELSE p_next_followup_date END
  WHERE id = target.id RETURNING * INTO target;
  RETURN target;
END; $$;


ALTER FUNCTION "public"."save_referral_followup"("p_referral_calling_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text", "p_entered_by" "text", "p_request_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_clients"("search_text" "text", "result_limit" integer DEFAULT 8) RETURNS TABLE("client_id" "uuid", "primary_name" "text", "primary_phone" "text", "last_visit_date" timestamp with time zone, "last_branch_name" "text", "matched_phone" "text", "total_visits" integer, "last_buy_status" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  WITH input AS (SELECT trim(search_text) AS value, regexp_replace(search_text, '[^0-9]', '', 'g') AS digits)
  SELECT c.client_id, c.primary_name::text, c.primary_phone::text, c.last_visit_date, b.name::text, p.phone::text, c.total_visits, c.last_buy_status::text
  FROM "public"."clients" c LEFT JOIN "public"."branches" b ON b.id = c.last_branch_id
  LEFT JOIN LATERAL (SELECT pi.phone FROM "public"."client_phone_index" pi, input WHERE pi.client_id = c.client_id AND input.digits <> '' AND pi.phone LIKE '%' || right(input.digits, 10) || '%' ORDER BY (pi.phone = right(input.digits, 10)) DESC LIMIT 1) p ON true, input
  WHERE "public"."current_user_role"() IS NOT NULL AND ((length(input.digits) >= 3 AND p.phone IS NOT NULL) OR (length(input.value) >= 3 AND (c.primary_name ILIKE '%' || input.value || '%' OR EXISTS (SELECT 1 FROM unnest(c.other_names) name WHERE name ILIKE '%' || input.value || '%'))))
  ORDER BY (p.phone = right(input.digits, 10)) DESC NULLS LAST, c.last_visit_date DESC NULLS LAST, c.primary_name LIMIT LEAST(GREATEST(result_limit, 1), 20);
$$;


ALTER FUNCTION "public"."search_clients"("search_text" "text", "result_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_client_profile_editor"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$ BEGIN NEW.profile_updated_at := CURRENT_TIMESTAMP; NEW.profile_updated_by := "auth"."uid"(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."set_client_profile_editor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_lead_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN NEW."updated_at" := CURRENT_TIMESTAMP; RETURN NEW; END;
$$;


ALTER FUNCTION "public"."set_lead_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_legacy_walkin_visit"("p_payload" "jsonb") RETURNS TABLE("client_id" "uuid", "timeline_id" "uuid", "reference_number" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  RETURN QUERY SELECT * FROM "public"."submit_walkin_visit"(p_payload);
END; $$;


ALTER FUNCTION "public"."submit_legacy_walkin_visit"("p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_walkin_visit"("p_payload" "jsonb") RETURNS TABLE("client_id" "uuid", "timeline_id" "uuid", "reference_number" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
    VALUES (COALESCE(NULLIF(p_payload->>'proposed_timeline_id', '')::uuid, gen_random_uuid()),target_client,event_at,purchase_status,target_branch,NULLIF(trim(p_payload->>'crm_name'), ''),"auth"."uid"(),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'seen_categories','[]'::jsonb))),ARRAY[]::text[]),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'bought_categories','[]'::jsonb))),ARRAY[]::text[]),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'order_categories','[]'::jsonb))),ARRAY[]::text[]),NULLIF(trim(p_payload->>'product_requirement'), ''),NULLIF(trim(p_payload->>'remark'), ''),ref) RETURNING id INTO visit_id;
    EXIT; EXCEPTION WHEN unique_violation THEN seq := seq + 1; ref := upper(COALESCE((SELECT substr(name, 1, 3) FROM "public"."branches" WHERE id = target_branch), 'MJK')) || '-' || to_char(event_at, 'YYMMDD') || '-' || lpad(seq::text, 4, '0'); END; END LOOP;
  details := COALESCE(p_payload->'category_details', '{}'::jsonb);
  INSERT INTO "public"."visit_forms" (client_timeline_id,companions,category_details,occupation,occupation_other,bridal_or_non_bridal,wedding_month,wedding_year,communication_preference,source_of_lead,source_of_lead_other,reference_name,reference_phone,client_type,did_buy,not_bought_reasons,not_bought_other,repair_or_order_approach,marketing_message_sent,instagram_asked,instagram_no_reason,google_review_asked,google_review_no_reason,testimonial_asked,testimonial_no_reason,feedback_form_asked,feedback_form_no_reason,thank_you_note_asked,thank_you_note_no_reason,referrals_asked,referrals_no_reason,additional_fields)
  VALUES (visit_id,COALESCE(p_payload->'companions','[]'::jsonb),details,NULLIF(trim(p_payload->>'occupation'), ''),NULLIF(trim(p_payload->>'occupation_other'), ''),NULLIF(trim(p_payload->>'bridal_or_non_bridal'), ''),NULLIF(p_payload->>'wedding_month','')::smallint,NULLIF(p_payload->>'wedding_year','')::smallint,NULLIF(trim(p_payload->>'communication_preference'), ''),NULLIF(trim(p_payload->>'source_of_lead'), ''),NULLIF(trim(p_payload->>'source_of_lead_other'), ''),NULLIF(trim(p_payload->>'reference_name'), ''),NULLIF(trim(p_payload->>'reference_phone'), ''),CASE WHEN new_client THEN 'new' ELSE 'existing' END,COALESCE((p_payload->>'did_buy')::boolean,false),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'not_bought_reasons','[]'::jsonb))),ARRAY[]::text[]),NULLIF(trim(p_payload->>'not_bought_other'), ''),NULLIF(trim(p_payload->>'repair_or_order_approach'), ''),NULLIF(trim(p_payload->>'marketing_message_sent'), ''),(p_payload->'engagement'->'instagram'->>'asked')::boolean,NULLIF(p_payload->'engagement'->'instagram'->>'no_reason',''),(p_payload->'engagement'->'google_review'->>'asked')::boolean,NULLIF(p_payload->'engagement'->'google_review'->>'no_reason',''),(p_payload->'engagement'->'testimonial'->>'asked')::boolean,NULLIF(p_payload->'engagement'->'testimonial'->>'no_reason',''),(p_payload->'engagement'->'feedback_form'->>'asked')::boolean,NULLIF(p_payload->'engagement'->'feedback_form'->>'no_reason',''),(p_payload->'engagement'->'thank_you_note'->>'asked')::boolean,NULLIF(p_payload->'engagement'->'thank_you_note'->>'no_reason',''),(p_payload->'engagement'->'referrals'->>'asked')::boolean,NULLIF(p_payload->'engagement'->'referrals'->>'no_reason',''),COALESCE(p_payload->'additional_fields','{}'::jsonb));
  FOR doc IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'documents','[]'::jsonb)) LOOP
    INSERT INTO "public"."documents" (client_id,client_timeline_id,uploaded_by,file_name,storage_path,mime_type) VALUES (target_client,visit_id,"auth"."uid"(),doc->>'file_name',doc->>'storage_path',doc->>'mime_type');
  END LOOP;
  queue_id := NULLIF(p_payload->>'entry_queue_id','')::uuid;
  IF queue_id IS NOT NULL THEN UPDATE "public"."entry_queue" SET status = 'complete', full_form_timestamp = CURRENT_TIMESTAMP, client_id = target_client WHERE id = queue_id AND branch_id = target_branch; IF NOT FOUND THEN RAISE EXCEPTION 'queue token does not belong to this branch' USING ERRCODE = 'insufficient_privilege'; END IF; END IF;
  RETURN QUERY SELECT target_client, visit_id, ref;
END; $$;


ALTER FUNCTION "public"."submit_walkin_visit"("p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_client_phone_index"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  phone_value text;
  normalized_phone text;
BEGIN
  DELETE FROM "public"."client_phone_index"
  WHERE client_id = NEW.client_id;

  FOREACH phone_value IN ARRAY array_cat(
    ARRAY[NEW.primary_phone, NEW.secondary_phone, NEW.billing_phone],
    COALESCE(NEW.other_known_phones, ARRAY[]::text[])
  ) LOOP
    normalized_phone := right(regexp_replace(COALESCE(phone_value, ''), '[^0-9]', '', 'g'), 10);
    IF length(normalized_phone) = 10
       AND NOT EXISTS (
         SELECT 1
         FROM "public"."client_phone_index"
         WHERE phone = normalized_phone
           AND client_id = NEW.client_id
       ) THEN
      INSERT INTO "public"."client_phone_index" (phone, client_id)
      VALUES (normalized_phone, NEW.client_id);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_client_phone_index"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_not_bought_followups"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  RETURN inserted_count;
END; $$;


ALTER FUNCTION "public"."sync_not_bought_followups"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_not_bought_followup"("p_followup_id" "uuid", "p_call_response" "text", "p_remark" "text" DEFAULT NULL::"text", "p_next_followup_date" "date" DEFAULT NULL::"date") RETURNS "public"."not_bought_followups"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  RETURN target;
END; $$;


ALTER FUNCTION "public"."update_not_bought_followup"("p_followup_id" "uuid", "p_call_response" "text", "p_remark" "text", "p_next_followup_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_not_bought_reason"("p_followup_id" "uuid", "p_reasons" "text"[], "p_other" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE target "public"."not_bought_followups";
BEGIN
  SELECT * INTO target FROM "public"."not_bought_followups" WHERE "id" = p_followup_id FOR UPDATE;
  IF target."id" IS NULL THEN RAISE EXCEPTION 'follow-up not found' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT "public"."is_super_admin"() AND NOT "public"."is_branch_staff"(target."branch_id") THEN RAISE EXCEPTION 'you may only update follow-ups from your own branch' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF target."source_visit_form_id" IS NULL THEN RAISE EXCEPTION 'follow-up has no source visit form' USING ERRCODE = 'check_violation'; END IF;
  UPDATE "public"."visit_forms" SET "not_bought_reasons" = COALESCE(p_reasons, ARRAY[]::text[]), "not_bought_other" = NULLIF(btrim(p_other), '') WHERE "id" = target."source_visit_form_id";
END; $$;


ALTER FUNCTION "public"."update_not_bought_reason"("p_followup_id" "uuid", "p_reasons" "text"[], "p_other" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_referral_calling"("p_referral_calling_id" "uuid", "p_call_response" "text", "p_remark" "text" DEFAULT NULL::"text", "p_next_followup_date" "date" DEFAULT NULL::"date") RETURNS "public"."referral_calling"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  RETURN target;
END; $$;


ALTER FUNCTION "public"."update_referral_calling"("p_referral_calling_id" "uuid", "p_call_response" "text", "p_remark" "text", "p_next_followup_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_client_potential_category"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.client_potential_category IS NULL OR (TG_OP = 'UPDATE' AND NEW.client_potential_category IS NOT DISTINCT FROM OLD.client_potential_category) THEN
    RETURN NEW;
  END IF;
  IF NEW.client_potential_category IN ('Cold Lead', 'Cool Lead', 'Warm Lead', 'Hot Lead', 'VIP Lead') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'client potential category must be one of: Cold Lead, Cool Lead, Warm Lead, Hot Lead, VIP Lead'
    USING ERRCODE = 'check_violation';
END;
$$;


ALTER FUNCTION "public"."validate_client_potential_category"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_prisma_migrations" (
    "id" character varying(36) NOT NULL,
    "checksum" character varying(64) NOT NULL,
    "finished_at" timestamp with time zone,
    "migration_name" character varying(255) NOT NULL,
    "logs" "text",
    "rolled_back_at" timestamp with time zone,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "applied_steps_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."_prisma_migrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(120) NOT NULL,
    "address" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."branches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(200) NOT NULL,
    "description" "text",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_campaign_tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "tagged_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "tagged_by" "uuid",
    "note" "text"
);


ALTER TABLE "public"."client_campaign_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "client_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "primary_name" character varying(160) NOT NULL,
    "other_names" "text"[] DEFAULT ARRAY[]::"text"[],
    "primary_phone" character varying(30) NOT NULL,
    "secondary_phone" character varying(30),
    "billing_phone" character varying(30),
    "other_known_phones" "text"[] DEFAULT ARRAY[]::"text"[],
    "gender" character varying(40),
    "country" character varying(100),
    "state" character varying(100),
    "city" character varying(120),
    "city_other" character varying(120),
    "pincode" character varying(12),
    "address" "text",
    "community" character varying(120),
    "community_other" character varying(120),
    "dob" "date",
    "anniversary" "date",
    "beverage" character varying(100),
    "sugar" character varying(60),
    "snack" character varying(100),
    "gift_history" "jsonb",
    "total_visits" integer DEFAULT 0 NOT NULL,
    "total_purchase_visits" integer DEFAULT 0 NOT NULL,
    "total_non_purchase_visits" integer DEFAULT 0 NOT NULL,
    "total_repair_visits" integer DEFAULT 0 NOT NULL,
    "total_order_visits" integer DEFAULT 0 NOT NULL,
    "first_visit_date" timestamp(6) with time zone,
    "last_visit_date" timestamp(6) with time zone,
    "last_buy_status" "public"."buy_status",
    "last_branch_id" "uuid",
    "last_crm_name" character varying(160),
    "last_salesperson_id" "uuid",
    "last_remark" "text",
    "last_product_requirement" "text",
    "last_seen_categories" "text"[] DEFAULT ARRAY[]::"text"[],
    "last_bought_categories" "text"[] DEFAULT ARRAY[]::"text"[],
    "last_order_categories" "text"[] DEFAULT ARRAY[]::"text"[],
    "client_potential_category" character varying(120),
    "high_potential_reason" "text",
    "instagram_status" character varying(80),
    "google_review_status" character varying(80),
    "testimonial_status" character varying(80),
    "referral_status" character varying(80),
    "next_visit_date" "date",
    "profile_updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "profile_updated_by" "uuid",
    "client_code" "text" NOT NULL,
    CONSTRAINT "clients_client_code_format_check" CHECK (("client_code" ~ '^MKC-[0-9]+$'::"text"))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."client_code_sequence"
    START WITH 102726
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."client_code_sequence" OWNER TO "postgres";


ALTER SEQUENCE "public"."client_code_sequence" OWNED BY "public"."clients"."client_code";



CREATE TABLE IF NOT EXISTS "public"."client_edit_log" (
    "id" bigint NOT NULL,
    "client_id" "uuid" NOT NULL,
    "edited_by" "uuid",
    "source" character varying(100) DEFAULT 'database_trigger'::character varying NOT NULL,
    "field_name" character varying(120) NOT NULL,
    "old_value" "jsonb",
    "new_value" "jsonb",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."client_edit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."client_edit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."client_edit_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."client_edit_log_id_seq" OWNED BY "public"."client_edit_log"."id";



CREATE TABLE IF NOT EXISTS "public"."client_phone_index" (
    "phone" character varying(30) NOT NULL,
    "client_id" "uuid" NOT NULL,
    CONSTRAINT "client_phone_index_normalized_phone_check" CHECK ((("phone")::"text" ~ '^[0-9]{10}$'::"text"))
);


ALTER TABLE "public"."client_phone_index" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_timeline" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "event_date" timestamp(6) with time zone NOT NULL,
    "event_type" "public"."event_type" DEFAULT 'VISIT'::"public"."event_type" NOT NULL,
    "buy_status" "public"."buy_status",
    "branch_id" "uuid" NOT NULL,
    "crm_name" character varying(160),
    "salesperson_id" "uuid",
    "seen_categories" "text"[] DEFAULT ARRAY[]::"text"[],
    "bought_categories" "text"[] DEFAULT ARRAY[]::"text"[],
    "order_categories" "text"[] DEFAULT ARRAY[]::"text"[],
    "product_requirement" "text",
    "remark" "text",
    "reference_number" character varying(100),
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."client_timeline" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_allocation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "crm_name" character varying(160) NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."crm_allocation" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_daily_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "crm_name" character varying(160) NOT NULL,
    "date" "date" NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."crm_daily_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_queue_round_robin" (
    "branch_id" "uuid" NOT NULL,
    "last_index" integer DEFAULT '-1'::integer NOT NULL,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."crm_queue_round_robin" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_sso_access_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "grant_id" "uuid",
    "actor_crm_auth_user_id" "uuid",
    "action" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."crm_sso_access_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_sso_access_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "crm_auth_user_id" "uuid",
    "jewelos_user_id" "uuid" NOT NULL,
    "work_email" character varying(320) NOT NULL,
    "legacy_crm_user_id" "uuid" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."crm_sso_access_grants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "client_timeline_id" "uuid",
    "uploaded_by" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" character varying(255) NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "documents_file_name_check" CHECK ((("length"("file_name") > 0) AND (POSITION(('/'::"text") IN ("file_name")) = 0))),
    CONSTRAINT "documents_storage_path_check" CHECK ((("array_length"("string_to_array"("storage_path", '/'::"text"), 1) = 3) AND ("split_part"("storage_path", '/'::"text", 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'::"text") AND ("split_part"("storage_path", '/'::"text", 2) = COALESCE(("client_timeline_id")::"text", 'general'::"text")) AND ("split_part"("storage_path", '/'::"text", 3) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_.+$'::"text") AND (SUBSTRING("split_part"("storage_path", '/'::"text", 3) FROM 38) = "file_name")))
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entry_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" character varying(40) NOT NULL,
    "client_name" character varying(160) NOT NULL,
    "mobile" character varying(30) NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "assigned_crm_name" character varying(160),
    "status" character varying(60) DEFAULT 'waiting'::character varying NOT NULL,
    "full_form_timestamp" timestamp(6) with time zone,
    "client_id" "uuid",
    "remark" "text",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "client_is_new" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."entry_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_form_field_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "field_id" "uuid" NOT NULL,
    "option_value" "text" NOT NULL,
    "display_order" integer NOT NULL,
    "triggers_field_key" "text"
);


ALTER TABLE "public"."lead_form_field_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_form_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "field_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "field_type" "public"."lead_field_type" NOT NULL,
    "is_mandatory" boolean DEFAULT false NOT NULL,
    "is_hidden" boolean DEFAULT false NOT NULL,
    "display_order" integer NOT NULL,
    "is_runo_synced" boolean DEFAULT false NOT NULL,
    "runo_field_name" "text",
    "parent_field_key" "text",
    "option_source" "text",
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "lead_form_fields_key_format" CHECK (("field_key" ~ '^[a-z][a-z0-9_]*$'::"text")),
    CONSTRAINT "lead_form_fields_runo_mapping" CHECK (((NOT "is_runo_synced") OR ("runo_field_name" IS NOT NULL)))
);


ALTER TABLE "public"."lead_form_fields" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_stage_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "old_stage" "public"."lead_source_channel",
    "new_stage" "public"."lead_source_channel" NOT NULL,
    "changed_by" "uuid" NOT NULL,
    "changed_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."lead_stage_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone_number" character varying(30) NOT NULL,
    "name" character varying(160),
    "source_channel" "public"."lead_source_channel" DEFAULT 'open'::"public"."lead_source_channel" NOT NULL,
    "field_values" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_via" "public"."lead_created_via" DEFAULT 'crm_desktop'::"public"."lead_created_via" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "branch_id" "uuid",
    "runo_pushed" boolean DEFAULT false NOT NULL,
    "runo_push_error" "text",
    "runo_customer_id" "text",
    "converted_to_client_id" "uuid",
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "leads_phone_normalized" CHECK ((("phone_number")::"text" ~ '^[0-9]{10}$'::"text"))
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legacy_import_keys" (
    "source_key" "text" NOT NULL,
    "target_table" "text" NOT NULL,
    "target_id" "text",
    "imported_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."legacy_import_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legacy_walkin_ingest_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_id" "uuid" NOT NULL,
    "source_ip" character varying(64),
    "payload" "jsonb" NOT NULL,
    "payload_hash" character varying(64),
    "outcome" character varying(40) NOT NULL,
    "result" "jsonb" NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE "public"."legacy_walkin_ingest_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legacy_walkin_ingest_rate_limits" (
    "bucket_start" timestamp(0) with time zone NOT NULL,
    "key_name" character varying(80) NOT NULL,
    "request_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."legacy_walkin_ingest_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lookup_beverages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" character varying(160) NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."lookup_beverages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lookup_cities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" character varying(160) NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."lookup_cities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lookup_communities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" character varying(160) NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."lookup_communities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lookup_gifts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" character varying(160) NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."lookup_gifts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lookup_not_bought_reasons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" character varying(160) NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."lookup_not_bought_reasons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lookup_pincodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pincode" character varying(12) NOT NULL,
    "city" character varying(160),
    "state" character varying(100),
    "country" character varying(100),
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."lookup_pincodes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lookup_product_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" character varying(160) NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."lookup_product_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lookup_relations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" character varying(160) NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."lookup_relations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lookup_snacks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" character varying(160) NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."lookup_snacks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lookup_source_of_leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" character varying(160) NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."lookup_source_of_leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lookup_sugar_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" character varying(160) NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."lookup_sugar_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."not_bought_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "followup_id" "uuid" NOT NULL,
    "status" character varying(80) NOT NULL,
    "remark" "text",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "previous_status" character varying(80),
    "call_response" "text",
    "updated_by" "uuid"
);


ALTER TABLE "public"."not_bought_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referral_calling_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referral_calling_id" "uuid" NOT NULL,
    "status" character varying(80) NOT NULL,
    "previous_status" character varying(80),
    "call_response" "text",
    "remark" "text",
    "updated_by" "uuid",
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "entered_by" character varying(160),
    "followup_date" "date",
    "next_followup_date" "date",
    "source" character varying(80),
    "request_key" "uuid"
);


ALTER TABLE "public"."referral_calling_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "name" character varying(160) NOT NULL,
    "phone" character varying(30),
    "email" character varying(320) NOT NULL,
    "role" "public"."user_role" NOT NULL,
    "branch_id" "uuid",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "users_role_branch_check" CHECK (((("role" = 'super_admin'::"public"."user_role") AND ("branch_id" IS NULL)) OR (("role" <> 'super_admin'::"public"."user_role") AND ("branch_id" IS NOT NULL))))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visit_forms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_timeline_id" "uuid" NOT NULL,
    "companions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "category_details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occupation" character varying(120),
    "occupation_other" character varying(160),
    "bridal_or_non_bridal" character varying(40),
    "wedding_month" smallint,
    "wedding_year" smallint,
    "communication_preference" character varying(80),
    "instagram_asked" boolean,
    "instagram_no_reason" "text",
    "instagram_proof_url" "text",
    "google_review_asked" boolean,
    "google_review_no_reason" "text",
    "google_review_proof_url" "text",
    "testimonial_asked" boolean,
    "testimonial_no_reason" "text",
    "testimonial_proof_url" "text",
    "thank_you_note_asked" boolean,
    "thank_you_note_no_reason" "text",
    "thank_you_note_proof_url" "text",
    "referrals_asked" boolean,
    "referrals_no_reason" "text",
    "referrals_proof_url" "text",
    "additional_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "source_of_lead" character varying(120),
    "source_of_lead_other" character varying(160),
    "reference_name" character varying(160),
    "reference_phone" character varying(30),
    "client_type" character varying(20),
    "did_buy" boolean,
    "not_bought_reasons" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "not_bought_other" "text",
    "repair_or_order_approach" "text",
    "marketing_message_sent" "text",
    "feedback_form_asked" boolean,
    "feedback_form_no_reason" "text",
    "feedback_form_proof_url" "text",
    CONSTRAINT "visit_forms_additional_fields_check" CHECK (("jsonb_typeof"("additional_fields") = 'object'::"text")),
    CONSTRAINT "visit_forms_category_details_check" CHECK (("jsonb_typeof"("category_details") = 'object'::"text")),
    CONSTRAINT "visit_forms_client_type_check" CHECK ((("client_type" IS NULL) OR (("client_type")::"text" = ANY ((ARRAY['new'::character varying, 'existing'::character varying])::"text"[])))),
    CONSTRAINT "visit_forms_companions_check" CHECK ((("jsonb_typeof"("companions") = 'array'::"text") AND ("jsonb_array_length"("companions") <= 10))),
    CONSTRAINT "visit_forms_wedding_month_check" CHECK ((("wedding_month" IS NULL) OR (("wedding_month" >= 1) AND ("wedding_month" <= 12)))),
    CONSTRAINT "visit_forms_wedding_year_check" CHECK ((("wedding_year" IS NULL) OR (("wedding_year" >= 2000) AND ("wedding_year" <= 2200))))
);


ALTER TABLE "public"."visit_forms" OWNER TO "postgres";


ALTER TABLE ONLY "public"."client_edit_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."client_edit_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."_prisma_migrations"
    ADD CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_campaign_tags"
    ADD CONSTRAINT "client_campaign_tags_client_campaign_key" UNIQUE ("client_id", "campaign_id");



ALTER TABLE ONLY "public"."client_campaign_tags"
    ADD CONSTRAINT "client_campaign_tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_edit_log"
    ADD CONSTRAINT "client_edit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_phone_index"
    ADD CONSTRAINT "client_phone_index_pkey" PRIMARY KEY ("phone");



ALTER TABLE ONLY "public"."client_timeline"
    ADD CONSTRAINT "client_timeline_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_client_code_key" UNIQUE ("client_code");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("client_id");



ALTER TABLE ONLY "public"."crm_allocation"
    ADD CONSTRAINT "crm_allocation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_daily_availability"
    ADD CONSTRAINT "crm_daily_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_queue_round_robin"
    ADD CONSTRAINT "crm_queue_round_robin_pkey" PRIMARY KEY ("branch_id");



ALTER TABLE ONLY "public"."crm_sso_access_audit"
    ADD CONSTRAINT "crm_sso_access_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_sso_access_grants"
    ADD CONSTRAINT "crm_sso_access_grants_crm_auth_user_id_key" UNIQUE ("crm_auth_user_id");



ALTER TABLE ONLY "public"."crm_sso_access_grants"
    ADD CONSTRAINT "crm_sso_access_grants_jewelos_user_id_key" UNIQUE ("jewelos_user_id");



ALTER TABLE ONLY "public"."crm_sso_access_grants"
    ADD CONSTRAINT "crm_sso_access_grants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entry_queue"
    ADD CONSTRAINT "entry_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_form_field_options"
    ADD CONSTRAINT "lead_form_field_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_form_field_options"
    ADD CONSTRAINT "lead_form_field_options_unique" UNIQUE ("field_id", "option_value");



ALTER TABLE ONLY "public"."lead_form_fields"
    ADD CONSTRAINT "lead_form_fields_field_key_key" UNIQUE ("field_key");



ALTER TABLE ONLY "public"."lead_form_fields"
    ADD CONSTRAINT "lead_form_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_stage_history"
    ADD CONSTRAINT "lead_stage_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_phone_number_key" UNIQUE ("phone_number");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legacy_import_keys"
    ADD CONSTRAINT "legacy_import_keys_pkey" PRIMARY KEY ("source_key");



ALTER TABLE ONLY "public"."legacy_walkin_ingest_attempts"
    ADD CONSTRAINT "legacy_walkin_ingest_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legacy_walkin_ingest_attempts"
    ADD CONSTRAINT "legacy_walkin_ingest_attempts_request_id_key" UNIQUE ("request_id");



ALTER TABLE ONLY "public"."legacy_walkin_ingest_rate_limits"
    ADD CONSTRAINT "legacy_walkin_ingest_rate_limits_pkey" PRIMARY KEY ("bucket_start", "key_name");



ALTER TABLE ONLY "public"."lookup_beverages"
    ADD CONSTRAINT "lookup_beverages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lookup_cities"
    ADD CONSTRAINT "lookup_cities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lookup_communities"
    ADD CONSTRAINT "lookup_communities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lookup_gifts"
    ADD CONSTRAINT "lookup_gifts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lookup_not_bought_reasons"
    ADD CONSTRAINT "lookup_not_bought_reasons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lookup_pincodes"
    ADD CONSTRAINT "lookup_pincodes_pincode_key" UNIQUE ("pincode");



ALTER TABLE ONLY "public"."lookup_pincodes"
    ADD CONSTRAINT "lookup_pincodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lookup_product_categories"
    ADD CONSTRAINT "lookup_product_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lookup_relations"
    ADD CONSTRAINT "lookup_relations_label_key" UNIQUE ("label");



ALTER TABLE ONLY "public"."lookup_relations"
    ADD CONSTRAINT "lookup_relations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lookup_snacks"
    ADD CONSTRAINT "lookup_snacks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lookup_source_of_leads"
    ADD CONSTRAINT "lookup_source_of_leads_label_key" UNIQUE ("label");



ALTER TABLE ONLY "public"."lookup_source_of_leads"
    ADD CONSTRAINT "lookup_source_of_leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lookup_sugar_options"
    ADD CONSTRAINT "lookup_sugar_options_label_key" UNIQUE ("label");



ALTER TABLE ONLY "public"."lookup_sugar_options"
    ADD CONSTRAINT "lookup_sugar_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."not_bought_followups"
    ADD CONSTRAINT "not_bought_followups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."not_bought_history"
    ADD CONSTRAINT "not_bought_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referral_calling_history"
    ADD CONSTRAINT "referral_calling_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referral_calling"
    ADD CONSTRAINT "referral_calling_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visit_forms"
    ADD CONSTRAINT "visit_forms_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "branches_name_key" ON "public"."branches" USING "btree" ("name");



CREATE INDEX "campaigns_created_at_idx" ON "public"."campaigns" USING "btree" ("created_at" DESC);



CREATE INDEX "campaigns_created_by_idx" ON "public"."campaigns" USING "btree" ("created_by");



CREATE INDEX "client_campaign_tags_campaign_tagged_at_idx" ON "public"."client_campaign_tags" USING "btree" ("campaign_id", "tagged_at" DESC);



CREATE INDEX "client_campaign_tags_tagged_by_idx" ON "public"."client_campaign_tags" USING "btree" ("tagged_by");



CREATE INDEX "client_edit_log_client_id_created_at_idx" ON "public"."client_edit_log" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "client_edit_log_edited_by_idx" ON "public"."client_edit_log" USING "btree" ("edited_by");



CREATE INDEX "client_phone_index_client_id_idx" ON "public"."client_phone_index" USING "btree" ("client_id");



CREATE INDEX "client_timeline_branch_id_event_date_idx" ON "public"."client_timeline" USING "btree" ("branch_id", "event_date" DESC);



CREATE INDEX "client_timeline_client_id_event_date_idx" ON "public"."client_timeline" USING "btree" ("client_id", "event_date" DESC);



CREATE INDEX "client_timeline_event_date_idx" ON "public"."client_timeline" USING "btree" ("event_date" DESC);



CREATE UNIQUE INDEX "client_timeline_id_client_id_key" ON "public"."client_timeline" USING "btree" ("id", "client_id");



CREATE INDEX "client_timeline_reference_number_idx" ON "public"."client_timeline" USING "btree" ("reference_number");



CREATE INDEX "client_timeline_salesperson_id_event_date_idx" ON "public"."client_timeline" USING "btree" ("salesperson_id", "event_date" DESC);



CREATE INDEX "clients_last_branch_id_last_visit_date_idx" ON "public"."clients" USING "btree" ("last_branch_id", "last_visit_date");



CREATE INDEX "clients_last_salesperson_id_idx" ON "public"."clients" USING "btree" ("last_salesperson_id");



CREATE INDEX "clients_next_visit_date_idx" ON "public"."clients" USING "btree" ("next_visit_date");



CREATE INDEX "clients_primary_phone_idx" ON "public"."clients" USING "btree" ("primary_phone");



CREATE INDEX "clients_profile_updated_by_idx" ON "public"."clients" USING "btree" ("profile_updated_by");



CREATE INDEX "crm_allocation_branch_id_active_idx" ON "public"."crm_allocation" USING "btree" ("branch_id", "active");



CREATE UNIQUE INDEX "crm_allocation_branch_id_crm_name_key" ON "public"."crm_allocation" USING "btree" ("branch_id", "crm_name");



CREATE UNIQUE INDEX "crm_allocation_branch_normalized_name_key" ON "public"."crm_allocation" USING "btree" ("branch_id", "public"."normalize_crm_roster_value"(("crm_name")::"text"));



CREATE UNIQUE INDEX "crm_daily_availability_branch_id_crm_name_date_key" ON "public"."crm_daily_availability" USING "btree" ("branch_id", "crm_name", "date");



CREATE INDEX "crm_daily_availability_branch_id_date_is_available_idx" ON "public"."crm_daily_availability" USING "btree" ("branch_id", "date", "is_available");



CREATE INDEX "crm_sso_access_audit_grant_id_created_at_idx" ON "public"."crm_sso_access_audit" USING "btree" ("grant_id", "created_at" DESC);



CREATE INDEX "crm_sso_access_grants_legacy_crm_user_id_active_idx" ON "public"."crm_sso_access_grants" USING "btree" ("legacy_crm_user_id", "active");



CREATE INDEX "crm_sso_access_grants_work_email_idx" ON "public"."crm_sso_access_grants" USING "btree" ("work_email");



CREATE INDEX "documents_client_id_created_at_idx" ON "public"."documents" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "documents_client_timeline_id_idx" ON "public"."documents" USING "btree" ("client_timeline_id");



CREATE UNIQUE INDEX "documents_storage_path_key" ON "public"."documents" USING "btree" ("storage_path");



CREATE INDEX "documents_uploaded_by_idx" ON "public"."documents" USING "btree" ("uploaded_by");



CREATE INDEX "entry_queue_branch_id_status_created_at_idx" ON "public"."entry_queue" USING "btree" ("branch_id", "status", "created_at");



CREATE INDEX "entry_queue_client_id_idx" ON "public"."entry_queue" USING "btree" ("client_id");



CREATE UNIQUE INDEX "entry_queue_token_key" ON "public"."entry_queue" USING "btree" ("token");



CREATE INDEX "lead_stage_history_lead_changed_at_idx" ON "public"."lead_stage_history" USING "btree" ("lead_id", "changed_at" DESC);



CREATE INDEX "leads_branch_created_at_idx" ON "public"."leads" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "leads_created_by_created_at_idx" ON "public"."leads" USING "btree" ("created_by", "created_at" DESC);



CREATE INDEX "legacy_import_keys_target_table_idx" ON "public"."legacy_import_keys" USING "btree" ("target_table", "imported_at" DESC);



CREATE INDEX "legacy_walkin_ingest_attempts_created_at_idx" ON "public"."legacy_walkin_ingest_attempts" USING "btree" ("created_at" DESC);



CREATE INDEX "legacy_walkin_ingest_attempts_outcome_created_at_idx" ON "public"."legacy_walkin_ingest_attempts" USING "btree" ("outcome", "created_at" DESC);



CREATE INDEX "lookup_beverages_active_label_idx" ON "public"."lookup_beverages" USING "btree" ("active", "label");



CREATE UNIQUE INDEX "lookup_beverages_label_key" ON "public"."lookup_beverages" USING "btree" ("label");



CREATE UNIQUE INDEX "lookup_beverages_label_normalized_key" ON "public"."lookup_beverages" USING "btree" ("upper"("btrim"(("label")::"text")));



CREATE INDEX "lookup_cities_active_label_idx" ON "public"."lookup_cities" USING "btree" ("active", "label");



CREATE UNIQUE INDEX "lookup_cities_label_key" ON "public"."lookup_cities" USING "btree" ("label");



CREATE INDEX "lookup_communities_active_label_idx" ON "public"."lookup_communities" USING "btree" ("active", "label");



CREATE UNIQUE INDEX "lookup_communities_label_key" ON "public"."lookup_communities" USING "btree" ("label");



CREATE UNIQUE INDEX "lookup_communities_label_normalized_key" ON "public"."lookup_communities" USING "btree" ("upper"("btrim"(("label")::"text")));



CREATE INDEX "lookup_gifts_active_label_idx" ON "public"."lookup_gifts" USING "btree" ("active", "label");



CREATE UNIQUE INDEX "lookup_gifts_label_key" ON "public"."lookup_gifts" USING "btree" ("label");



CREATE UNIQUE INDEX "lookup_gifts_label_normalized_key" ON "public"."lookup_gifts" USING "btree" ("upper"("btrim"(("label")::"text")));



CREATE INDEX "lookup_not_bought_reasons_active_label_idx" ON "public"."lookup_not_bought_reasons" USING "btree" ("active", "label");



CREATE UNIQUE INDEX "lookup_not_bought_reasons_label_key" ON "public"."lookup_not_bought_reasons" USING "btree" ("label");



CREATE UNIQUE INDEX "lookup_not_bought_reasons_label_normalized_key" ON "public"."lookup_not_bought_reasons" USING "btree" ("upper"("btrim"(("label")::"text")));



CREATE INDEX "lookup_pincodes_active_pincode_idx" ON "public"."lookup_pincodes" USING "btree" ("active", "pincode");



CREATE INDEX "lookup_pincodes_city_idx" ON "public"."lookup_pincodes" USING "btree" ("city");



CREATE INDEX "lookup_product_categories_active_label_idx" ON "public"."lookup_product_categories" USING "btree" ("active", "label");



CREATE UNIQUE INDEX "lookup_product_categories_label_key" ON "public"."lookup_product_categories" USING "btree" ("label");



CREATE UNIQUE INDEX "lookup_product_categories_label_normalized_key" ON "public"."lookup_product_categories" USING "btree" ("upper"("btrim"(("label")::"text")));



CREATE INDEX "lookup_relations_active_label_idx" ON "public"."lookup_relations" USING "btree" ("active", "label");



CREATE UNIQUE INDEX "lookup_relations_label_normalized_key" ON "public"."lookup_relations" USING "btree" ("upper"("btrim"(("label")::"text")));



CREATE INDEX "lookup_snacks_active_label_idx" ON "public"."lookup_snacks" USING "btree" ("active", "label");



CREATE UNIQUE INDEX "lookup_snacks_label_key" ON "public"."lookup_snacks" USING "btree" ("label");



CREATE UNIQUE INDEX "lookup_snacks_label_normalized_key" ON "public"."lookup_snacks" USING "btree" ("upper"("btrim"(("label")::"text")));



CREATE INDEX "lookup_source_of_leads_active_label_idx" ON "public"."lookup_source_of_leads" USING "btree" ("active", "label");



CREATE UNIQUE INDEX "lookup_source_of_leads_label_normalized_key" ON "public"."lookup_source_of_leads" USING "btree" ("upper"("btrim"(("label")::"text")));



CREATE INDEX "lookup_sugar_options_active_label_idx" ON "public"."lookup_sugar_options" USING "btree" ("active", "label");



CREATE UNIQUE INDEX "lookup_sugar_options_label_normalized_key" ON "public"."lookup_sugar_options" USING "btree" ("upper"("btrim"(("label")::"text")));



CREATE INDEX "not_bought_followups_branch_status_date_idx" ON "public"."not_bought_followups" USING "btree" ("branch_id", "status", "next_followup_date");



CREATE INDEX "not_bought_followups_client_id_created_at_idx" ON "public"."not_bought_followups" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "not_bought_followups_created_at_idx" ON "public"."not_bought_followups" USING "btree" ("created_at" DESC);



CREATE INDEX "not_bought_followups_entered_by_idx" ON "public"."not_bought_followups" USING "btree" ("entered_by");



CREATE INDEX "not_bought_followups_reference_number_idx" ON "public"."not_bought_followups" USING "btree" ("reference_number");



CREATE INDEX "not_bought_followups_source_timeline_id_idx" ON "public"."not_bought_followups" USING "btree" ("source_timeline_id");



CREATE INDEX "not_bought_followups_source_visit_form_id_idx" ON "public"."not_bought_followups" USING "btree" ("source_visit_form_id");



CREATE INDEX "not_bought_followups_status_next_followup_date_idx" ON "public"."not_bought_followups" USING "btree" ("status", "next_followup_date");



CREATE INDEX "not_bought_history_followup_id_created_at_idx" ON "public"."not_bought_history" USING "btree" ("followup_id", "created_at" DESC);



CREATE INDEX "not_bought_history_updated_by_idx" ON "public"."not_bought_history" USING "btree" ("updated_by");



CREATE INDEX "referral_calling_converted_client_id_idx" ON "public"."referral_calling" USING "btree" ("converted_client_id");



CREATE INDEX "referral_calling_created_at_idx" ON "public"."referral_calling" USING "btree" ("created_at" DESC);



CREATE INDEX "referral_calling_history_calling_created_at_idx" ON "public"."referral_calling_history" USING "btree" ("referral_calling_id", "created_at" DESC);



CREATE UNIQUE INDEX "referral_calling_history_request_key" ON "public"."referral_calling_history" USING "btree" ("referral_calling_id", "request_key") WHERE ("request_key" IS NOT NULL);



CREATE INDEX "referral_calling_history_updated_by_idx" ON "public"."referral_calling_history" USING "btree" ("updated_by");



CREATE UNIQUE INDEX "referral_calling_one_row_per_referral_key" ON "public"."referral_calling" USING "btree" ("referral_id");



CREATE INDEX "referral_calling_referral_id_created_at_idx" ON "public"."referral_calling" USING "btree" ("referral_id", "created_at" DESC);



CREATE INDEX "referral_calling_status_next_followup_date_idx" ON "public"."referral_calling" USING "btree" ("status", "next_followup_date");



CREATE INDEX "referrals_assigned_doer_idx" ON "public"."referrals" USING "btree" ("assigned_doer") WHERE ("assigned_doer" IS NOT NULL);



CREATE INDEX "referrals_branch_id_created_at_idx" ON "public"."referrals" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "referrals_given_by_client_id_idx" ON "public"."referrals" USING "btree" ("given_by_client_id");



CREATE INDEX "referrals_referral_number_idx" ON "public"."referrals" USING "btree" ("referral_number");



CREATE INDEX "referrals_salesperson_id_created_at_idx" ON "public"."referrals" USING "btree" ("salesperson_id", "created_at" DESC);



CREATE INDEX "referrals_source_timeline_id_idx" ON "public"."referrals" USING "btree" ("source_timeline_id");



CREATE INDEX "referrals_source_visit_form_id_idx" ON "public"."referrals" USING "btree" ("source_visit_form_id");



CREATE INDEX "users_branch_id_idx" ON "public"."users" USING "btree" ("branch_id");



CREATE UNIQUE INDEX "users_email_key" ON "public"."users" USING "btree" ("email");



CREATE INDEX "users_role_active_idx" ON "public"."users" USING "btree" ("role", "active");



CREATE INDEX "visit_forms_bridal_or_non_bridal_wedding_year_wedding_month_idx" ON "public"."visit_forms" USING "btree" ("bridal_or_non_bridal", "wedding_year", "wedding_month");



CREATE UNIQUE INDEX "visit_forms_client_timeline_id_key" ON "public"."visit_forms" USING "btree" ("client_timeline_id");



CREATE INDEX "visit_forms_client_type_idx" ON "public"."visit_forms" USING "btree" ("client_type");



CREATE INDEX "visit_forms_did_buy_idx" ON "public"."visit_forms" USING "btree" ("did_buy");



CREATE INDEX "visit_forms_occupation_idx" ON "public"."visit_forms" USING "btree" ("occupation");



CREATE OR REPLACE TRIGGER "client_phone_index_normalize" BEFORE INSERT OR UPDATE OF "phone" ON "public"."client_phone_index" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_client_phone_index"();



CREATE OR REPLACE TRIGGER "client_timeline_dedupe_category_arrays" BEFORE INSERT OR UPDATE OF "seen_categories", "bought_categories", "order_categories" ON "public"."client_timeline" FOR EACH ROW EXECUTE FUNCTION "public"."dedupe_category_array_columns"();



CREATE OR REPLACE TRIGGER "client_timeline_derive_event_type" BEFORE INSERT OR UPDATE OF "buy_status" ON "public"."client_timeline" FOR EACH ROW EXECUTE FUNCTION "public"."recalculate_client_rollups"();



CREATE OR REPLACE TRIGGER "client_timeline_recalculate_rollups" AFTER INSERT ON "public"."client_timeline" FOR EACH ROW EXECUTE FUNCTION "public"."recalculate_client_rollups"();



CREATE OR REPLACE TRIGGER "client_timeline_recalculate_rollups_after_update" AFTER UPDATE OF "event_date", "buy_status", "branch_id", "crm_name", "salesperson_id", "seen_categories", "bought_categories", "order_categories", "product_requirement", "remark" ON "public"."client_timeline" FOR EACH ROW EXECUTE FUNCTION "public"."recalculate_client_rollups"();



CREATE OR REPLACE TRIGGER "clients_assign_client_code" BEFORE INSERT ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."assign_client_code"();



CREATE OR REPLACE TRIGGER "clients_dedupe_category_arrays" BEFORE UPDATE OF "last_seen_categories", "last_bought_categories", "last_order_categories" ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."dedupe_category_array_columns"();



CREATE OR REPLACE TRIGGER "clients_field_level_audit" AFTER UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."audit_client_changes"();



CREATE OR REPLACE TRIGGER "clients_set_profile_editor" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_client_profile_editor"();



CREATE OR REPLACE TRIGGER "clients_sync_phone_index" AFTER INSERT OR UPDATE OF "primary_phone", "secondary_phone", "billing_phone", "other_known_phones" ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."sync_client_phone_index"();



CREATE OR REPLACE TRIGGER "clients_validate_potential_category" BEFORE INSERT OR UPDATE OF "client_potential_category" ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."validate_client_potential_category"();



CREATE OR REPLACE TRIGGER "lead_form_fields_updated_at" BEFORE UPDATE ON "public"."lead_form_fields" FOR EACH ROW EXECUTE FUNCTION "public"."set_lead_updated_at"();



CREATE OR REPLACE TRIGGER "leads_updated_at" BEFORE UPDATE ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."set_lead_updated_at"();



CREATE OR REPLACE TRIGGER "lookup_beverages_normalize_label" BEFORE INSERT OR UPDATE OF "label" ON "public"."lookup_beverages" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_lookup_label"();



CREATE OR REPLACE TRIGGER "lookup_communities_normalize_label" BEFORE INSERT OR UPDATE OF "label" ON "public"."lookup_communities" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_lookup_label"();



CREATE OR REPLACE TRIGGER "lookup_gifts_normalize_label" BEFORE INSERT OR UPDATE OF "label" ON "public"."lookup_gifts" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_lookup_label"();



CREATE OR REPLACE TRIGGER "lookup_not_bought_reasons_normalize_label" BEFORE INSERT OR UPDATE OF "label" ON "public"."lookup_not_bought_reasons" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_lookup_label"();



CREATE OR REPLACE TRIGGER "lookup_product_categories_normalize_label" BEFORE INSERT OR UPDATE OF "label" ON "public"."lookup_product_categories" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_lookup_label"();



CREATE OR REPLACE TRIGGER "lookup_relations_normalize_label" BEFORE INSERT OR UPDATE OF "label" ON "public"."lookup_relations" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_lookup_label"();



CREATE OR REPLACE TRIGGER "lookup_snacks_normalize_label" BEFORE INSERT OR UPDATE OF "label" ON "public"."lookup_snacks" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_lookup_label"();



CREATE OR REPLACE TRIGGER "lookup_source_of_leads_normalize_label" BEFORE INSERT OR UPDATE OF "label" ON "public"."lookup_source_of_leads" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_lookup_label"();



CREATE OR REPLACE TRIGGER "lookup_sugar_options_normalize_label" BEFORE INSERT OR UPDATE OF "label" ON "public"."lookup_sugar_options" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_lookup_label"();



CREATE OR REPLACE TRIGGER "not_bought_followups_record_update" BEFORE UPDATE OF "status", "call_response", "remark", "next_followup_date" ON "public"."not_bought_followups" FOR EACH ROW EXECUTE FUNCTION "public"."record_not_bought_followup_update"();



CREATE OR REPLACE TRIGGER "not_bought_history_immutable" BEFORE DELETE OR UPDATE ON "public"."not_bought_history" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_not_bought_history_mutation"();



CREATE OR REPLACE TRIGGER "referral_calling_record_update" BEFORE UPDATE OF "status", "call_response", "remark", "next_followup_date" ON "public"."referral_calling" FOR EACH ROW EXECUTE FUNCTION "public"."record_referral_calling_update"();



CREATE OR REPLACE TRIGGER "visit_forms_create_not_bought_followup" AFTER INSERT ON "public"."visit_forms" FOR EACH ROW EXECUTE FUNCTION "public"."create_not_bought_followup_from_visit_form"();



CREATE OR REPLACE TRIGGER "visit_forms_create_referral" AFTER INSERT ON "public"."visit_forms" FOR EACH ROW EXECUTE FUNCTION "public"."create_referral_from_visit_form"();



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_campaign_tags"
    ADD CONSTRAINT "client_campaign_tags_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_campaign_tags"
    ADD CONSTRAINT "client_campaign_tags_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_campaign_tags"
    ADD CONSTRAINT "client_campaign_tags_tagged_by_fkey" FOREIGN KEY ("tagged_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_edit_log"
    ADD CONSTRAINT "client_edit_log_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_edit_log"
    ADD CONSTRAINT "client_edit_log_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_phone_index"
    ADD CONSTRAINT "client_phone_index_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_timeline"
    ADD CONSTRAINT "client_timeline_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."client_timeline"
    ADD CONSTRAINT "client_timeline_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_timeline"
    ADD CONSTRAINT "client_timeline_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_last_branch_id_fkey" FOREIGN KEY ("last_branch_id") REFERENCES "public"."branches"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_last_salesperson_id_fkey" FOREIGN KEY ("last_salesperson_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_profile_updated_by_fkey" FOREIGN KEY ("profile_updated_by") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_allocation"
    ADD CONSTRAINT "crm_allocation_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_daily_availability"
    ADD CONSTRAINT "crm_daily_availability_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_queue_round_robin"
    ADD CONSTRAINT "crm_queue_round_robin_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_sso_access_audit"
    ADD CONSTRAINT "crm_sso_access_audit_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "public"."crm_sso_access_grants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_sso_access_grants"
    ADD CONSTRAINT "crm_sso_access_grants_legacy_crm_user_id_fkey" FOREIGN KEY ("legacy_crm_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_client_timeline_id_client_id_fkey" FOREIGN KEY ("client_timeline_id", "client_id") REFERENCES "public"."client_timeline"("id", "client_id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."entry_queue"
    ADD CONSTRAINT "entry_queue_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."entry_queue"
    ADD CONSTRAINT "entry_queue_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_form_field_options"
    ADD CONSTRAINT "lead_form_field_options_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "public"."lead_form_fields"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_form_field_options"
    ADD CONSTRAINT "lead_form_field_options_triggers_field_key_fkey" FOREIGN KEY ("triggers_field_key") REFERENCES "public"."lead_form_fields"("field_key") ON UPDATE RESTRICT ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."lead_form_fields"
    ADD CONSTRAINT "lead_form_fields_parent_field_key_fkey" FOREIGN KEY ("parent_field_key") REFERENCES "public"."lead_form_fields"("field_key") ON UPDATE RESTRICT ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."lead_stage_history"
    ADD CONSTRAINT "lead_stage_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."lead_stage_history"
    ADD CONSTRAINT "lead_stage_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_converted_to_client_id_fkey" FOREIGN KEY ("converted_to_client_id") REFERENCES "public"."clients"("client_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."not_bought_followups"
    ADD CONSTRAINT "not_bought_followups_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."not_bought_followups"
    ADD CONSTRAINT "not_bought_followups_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."not_bought_followups"
    ADD CONSTRAINT "not_bought_followups_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."not_bought_followups"
    ADD CONSTRAINT "not_bought_followups_source_timeline_id_fkey" FOREIGN KEY ("source_timeline_id") REFERENCES "public"."client_timeline"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."not_bought_followups"
    ADD CONSTRAINT "not_bought_followups_source_visit_form_id_fkey" FOREIGN KEY ("source_visit_form_id") REFERENCES "public"."visit_forms"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."not_bought_history"
    ADD CONSTRAINT "not_bought_history_followup_id_fkey" FOREIGN KEY ("followup_id") REFERENCES "public"."not_bought_followups"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."not_bought_history"
    ADD CONSTRAINT "not_bought_history_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referral_calling"
    ADD CONSTRAINT "referral_calling_converted_client_id_fkey" FOREIGN KEY ("converted_client_id") REFERENCES "public"."clients"("client_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referral_calling_history"
    ADD CONSTRAINT "referral_calling_history_referral_calling_id_fkey" FOREIGN KEY ("referral_calling_id") REFERENCES "public"."referral_calling"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referral_calling_history"
    ADD CONSTRAINT "referral_calling_history_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referral_calling"
    ADD CONSTRAINT "referral_calling_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_given_by_client_id_fkey" FOREIGN KEY ("given_by_client_id") REFERENCES "public"."clients"("client_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_source_timeline_id_fkey" FOREIGN KEY ("source_timeline_id") REFERENCES "public"."client_timeline"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_source_visit_form_id_fkey" FOREIGN KEY ("source_visit_form_id") REFERENCES "public"."visit_forms"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."visit_forms"
    ADD CONSTRAINT "visit_forms_client_timeline_id_fkey" FOREIGN KEY ("client_timeline_id") REFERENCES "public"."client_timeline"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "active_staff_apply_campaign_tags" ON "public"."client_campaign_tags" FOR INSERT TO "authenticated" WITH CHECK ((("public"."current_user_role"() IS NOT NULL) AND ("tagged_by" = "auth"."uid"())));



CREATE POLICY "active_staff_create_own_lead_history" ON "public"."lead_stage_history" FOR INSERT TO "authenticated" WITH CHECK ((("public"."current_user_role"() IS NOT NULL) AND ("changed_by" = "auth"."uid"())));



CREATE POLICY "active_staff_create_own_leads" ON "public"."leads" FOR INSERT TO "authenticated" WITH CHECK ((("public"."current_user_role"() IS NOT NULL) AND ("created_by" = "auth"."uid"())));



CREATE POLICY "active_staff_delete_phone_index" ON "public"."client_phone_index" FOR DELETE TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_insert_clients" ON "public"."clients" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_insert_documents" ON "public"."documents" FOR INSERT TO "authenticated" WITH CHECK ((("public"."current_user_role"() IS NOT NULL) AND ("uploaded_by" = "auth"."uid"())));



CREATE POLICY "active_staff_insert_phone_index" ON "public"."client_phone_index" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_branches" ON "public"."branches" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_campaign_tags" ON "public"."client_campaign_tags" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_campaigns" ON "public"."campaigns" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_client_edit_log" ON "public"."client_edit_log" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_clients" ON "public"."clients" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_documents" ON "public"."documents" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_followup_history" ON "public"."not_bought_history" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_followups" ON "public"."not_bought_followups" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_lead_field_options" ON "public"."lead_form_field_options" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_lead_fields" ON "public"."lead_form_fields" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_lead_stage_history" ON "public"."lead_stage_history" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_leads" ON "public"."leads" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_lookup_relations" ON "public"."lookup_relations" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_lookup_source_of_leads" ON "public"."lookup_source_of_leads" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_lookup_sugar_options" ON "public"."lookup_sugar_options" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_phone_index" ON "public"."client_phone_index" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_referral_calling" ON "public"."referral_calling" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_referral_calling_history" ON "public"."referral_calling_history" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_referrals" ON "public"."referrals" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_timeline" ON "public"."client_timeline" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_users" ON "public"."users" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_read_visit_forms" ON "public"."visit_forms" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_update_clients" ON "public"."clients" FOR UPDATE TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL)) WITH CHECK (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_staff_update_phone_index" ON "public"."client_phone_index" FOR UPDATE TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL)) WITH CHECK (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_users_read_lookup_beverages" ON "public"."lookup_beverages" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_users_read_lookup_cities" ON "public"."lookup_cities" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_users_read_lookup_communities" ON "public"."lookup_communities" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_users_read_lookup_gifts" ON "public"."lookup_gifts" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_users_read_lookup_not_bought_reasons" ON "public"."lookup_not_bought_reasons" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_users_read_lookup_pincodes" ON "public"."lookup_pincodes" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_users_read_lookup_product_categories" ON "public"."lookup_product_categories" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "active_users_read_lookup_snacks" ON "public"."lookup_snacks" FOR SELECT TO "authenticated" USING (("public"."current_user_role"() IS NOT NULL));



CREATE POLICY "branch_manager_delete_own_availability" ON "public"."crm_daily_availability" FOR DELETE TO "authenticated" USING ("public"."is_branch_manager"("branch_id"));



CREATE POLICY "branch_manager_own_branch" ON "public"."branches" TO "authenticated" USING ("public"."is_branch_manager"("id")) WITH CHECK ("public"."is_branch_manager"("id"));



CREATE POLICY "branch_manager_own_users" ON "public"."users" TO "authenticated" USING ("public"."is_branch_manager"("branch_id")) WITH CHECK ("public"."is_branch_manager"("branch_id"));



CREATE POLICY "branch_manager_update_own_allocations" ON "public"."crm_allocation" FOR UPDATE TO "authenticated" USING ("public"."is_branch_manager"("branch_id")) WITH CHECK ("public"."is_branch_manager"("branch_id"));



CREATE POLICY "branch_manager_update_own_availability" ON "public"."crm_daily_availability" FOR UPDATE TO "authenticated" USING ("public"."is_branch_manager"("branch_id")) WITH CHECK ("public"."is_branch_manager"("branch_id"));



CREATE POLICY "branch_manager_write_own_allocations" ON "public"."crm_allocation" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_branch_manager"("branch_id"));



CREATE POLICY "branch_manager_write_own_availability" ON "public"."crm_daily_availability" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_branch_manager"("branch_id"));



CREATE POLICY "branch_staff_delete_origin_followups" ON "public"."not_bought_followups" FOR DELETE TO "authenticated" USING ("public"."is_branch_staff"("branch_id"));



CREATE POLICY "branch_staff_delete_origin_referral_calling" ON "public"."referral_calling" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."referrals" "referral"
  WHERE (("referral"."id" = "referral_calling"."referral_id") AND "public"."is_branch_staff"("referral"."branch_id")))));



CREATE POLICY "branch_staff_delete_origin_referrals" ON "public"."referrals" FOR DELETE TO "authenticated" USING ("public"."is_branch_staff"("branch_id"));



CREATE POLICY "branch_staff_delete_own_timeline" ON "public"."client_timeline" FOR DELETE TO "authenticated" USING ("public"."is_branch_staff"("branch_id"));



CREATE POLICY "branch_staff_delete_own_visit_forms" ON "public"."visit_forms" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."client_timeline" "timeline"
  WHERE (("timeline"."id" = "visit_forms"."client_timeline_id") AND "public"."is_branch_staff"("timeline"."branch_id")))));



CREATE POLICY "branch_staff_entry_queue" ON "public"."entry_queue" TO "authenticated" USING ("public"."is_branch_staff"("branch_id")) WITH CHECK ("public"."is_branch_staff"("branch_id"));



CREATE POLICY "branch_staff_insert_origin_followup_history" ON "public"."not_bought_history" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."not_bought_followups" "followup"
  WHERE (("followup"."id" = "not_bought_history"."followup_id") AND "public"."is_branch_staff"("followup"."branch_id")))));



CREATE POLICY "branch_staff_insert_origin_followups" ON "public"."not_bought_followups" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_branch_staff"("branch_id"));



CREATE POLICY "branch_staff_insert_origin_referral_calling" ON "public"."referral_calling" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."referrals" "referral"
  WHERE (("referral"."id" = "referral_calling"."referral_id") AND "public"."is_branch_staff"("referral"."branch_id")))));



CREATE POLICY "branch_staff_insert_origin_referrals" ON "public"."referrals" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_branch_staff"("branch_id"));



CREATE POLICY "branch_staff_insert_own_timeline" ON "public"."client_timeline" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_branch_staff"("branch_id"));



CREATE POLICY "branch_staff_insert_own_visit_forms" ON "public"."visit_forms" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."client_timeline" "timeline"
  WHERE (("timeline"."id" = "visit_forms"."client_timeline_id") AND "public"."is_branch_staff"("timeline"."branch_id")))));



CREATE POLICY "branch_staff_insert_referral_calling_history" ON "public"."referral_calling_history" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."referral_calling" "calling"
     JOIN "public"."referrals" "referral" ON (("referral"."id" = "calling"."referral_id")))
  WHERE (("calling"."id" = "referral_calling_history"."referral_calling_id") AND "public"."is_branch_staff"("referral"."branch_id")))));



CREATE POLICY "branch_staff_read_own_allocations" ON "public"."crm_allocation" FOR SELECT TO "authenticated" USING ("public"."is_branch_staff"("branch_id"));



CREATE POLICY "branch_staff_read_own_availability" ON "public"."crm_daily_availability" FOR SELECT TO "authenticated" USING ("public"."is_branch_staff"("branch_id"));



CREATE POLICY "branch_staff_update_origin_followups" ON "public"."not_bought_followups" FOR UPDATE TO "authenticated" USING ("public"."is_branch_staff"("branch_id")) WITH CHECK ("public"."is_branch_staff"("branch_id"));



CREATE POLICY "branch_staff_update_origin_referral_calling" ON "public"."referral_calling" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."referrals" "referral"
  WHERE (("referral"."id" = "referral_calling"."referral_id") AND "public"."is_branch_staff"("referral"."branch_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."referrals" "referral"
  WHERE (("referral"."id" = "referral_calling"."referral_id") AND "public"."is_branch_staff"("referral"."branch_id")))));



CREATE POLICY "branch_staff_update_origin_referrals" ON "public"."referrals" FOR UPDATE TO "authenticated" USING ("public"."is_branch_staff"("branch_id")) WITH CHECK ("public"."is_branch_staff"("branch_id"));



CREATE POLICY "branch_staff_update_own_timeline" ON "public"."client_timeline" FOR UPDATE TO "authenticated" USING ("public"."is_branch_staff"("branch_id")) WITH CHECK ("public"."is_branch_staff"("branch_id"));



CREATE POLICY "branch_staff_update_own_visit_forms" ON "public"."visit_forms" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."client_timeline" "timeline"
  WHERE (("timeline"."id" = "visit_forms"."client_timeline_id") AND "public"."is_branch_staff"("timeline"."branch_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."client_timeline" "timeline"
  WHERE (("timeline"."id" = "visit_forms"."client_timeline_id") AND "public"."is_branch_staff"("timeline"."branch_id")))));



ALTER TABLE "public"."branches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_campaign_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_edit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_phone_index" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_timeline" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "creator_or_admin_update_leads" ON "public"."leads" FOR UPDATE TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR "public"."is_super_admin"())) WITH CHECK ((("created_by" = "auth"."uid"()) OR "public"."is_super_admin"()));



ALTER TABLE "public"."crm_allocation" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_daily_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_queue_round_robin" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_sso_access_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_sso_access_grants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."entry_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_form_field_options" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_form_fields" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_stage_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legacy_import_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legacy_walkin_ingest_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legacy_walkin_ingest_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lookup_beverages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lookup_cities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lookup_communities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lookup_gifts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lookup_not_bought_reasons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lookup_pincodes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lookup_product_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lookup_relations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lookup_snacks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lookup_source_of_leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lookup_sugar_options" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."not_bought_followups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."not_bought_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referral_calling" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referral_calling_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referrals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "super_admin_all" ON "public"."branches" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."campaigns" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."client_campaign_tags" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."client_edit_log" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."client_phone_index" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."client_timeline" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."clients" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."crm_allocation" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."crm_daily_availability" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."documents" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."entry_queue" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."lookup_beverages" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."lookup_cities" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."lookup_communities" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."lookup_gifts" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."lookup_not_bought_reasons" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."lookup_pincodes" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."lookup_product_categories" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."lookup_snacks" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."not_bought_followups" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."not_bought_history" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."referral_calling" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."referral_calling_history" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."referrals" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."users" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_all" ON "public"."visit_forms" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_delete_leads" ON "public"."leads" FOR DELETE TO "authenticated" USING ("public"."is_super_admin"());



CREATE POLICY "super_admin_manage_lead_field_options" ON "public"."lead_form_field_options" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_manage_lead_fields" ON "public"."lead_form_fields" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_manage_lookup_relations" ON "public"."lookup_relations" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_manage_lookup_source_of_leads" ON "public"."lookup_source_of_leads" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_manage_lookup_sugar_options" ON "public"."lookup_sugar_options" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_read_legacy_walkin_ingest_attempts" ON "public"."legacy_walkin_ingest_attempts" FOR SELECT TO "authenticated" USING ("public"."is_super_admin"());



CREATE POLICY "tagger_delete_own_campaign_tags" ON "public"."client_campaign_tags" FOR DELETE TO "authenticated" USING (("tagged_by" = "auth"."uid"()));



CREATE POLICY "tagger_update_own_campaign_tags" ON "public"."client_campaign_tags" FOR UPDATE TO "authenticated" USING (("tagged_by" = "auth"."uid"())) WITH CHECK (("tagged_by" = "auth"."uid"()));



CREATE POLICY "uploader_delete_documents" ON "public"."documents" FOR DELETE TO "authenticated" USING (("uploaded_by" = "auth"."uid"()));



CREATE POLICY "uploader_update_documents" ON "public"."documents" FOR UPDATE TO "authenticated" USING (("uploaded_by" = "auth"."uid"())) WITH CHECK (("uploaded_by" = "auth"."uid"()));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visit_forms" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_client_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_client_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_client_code"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_next_available_crm"("p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_next_available_crm"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."assign_next_available_crm"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_next_available_crm"("p_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_client_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_client_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_client_changes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."browse_clients"("search_text" "text", "page_offset" integer, "result_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."browse_clients"("search_text" "text", "page_offset" integer, "result_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."browse_clients"("search_text" "text", "page_offset" integer, "result_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."browse_clients"("search_text" "text", "page_offset" integer, "result_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."browse_clients"("search_text" "text", "potential_category" "text", "page_offset" integer, "result_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."browse_clients"("search_text" "text", "potential_category" "text", "page_offset" integer, "result_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."browse_clients"("search_text" "text", "potential_category" "text", "page_offset" integer, "result_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."browse_clients"("search_text" "text", "potential_category" "text", "page_offset" integer, "result_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_legacy_walkin_ingest_rate_limit"("p_key_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_legacy_walkin_ingest_rate_limit"("p_key_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."consume_legacy_walkin_ingest_rate_limit"("p_key_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."consume_legacy_walkin_ingest_rate_limit"("p_key_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."convert_referral_to_client"("p_referral_calling_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."convert_referral_to_client"("p_referral_calling_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."convert_referral_to_client"("p_referral_calling_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."convert_referral_to_client"("p_referral_calling_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_client_with_phone"("p_primary_name" "text", "p_primary_phone" "text", "p_gender" "text", "p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_client_with_phone"("p_primary_name" "text", "p_primary_phone" "text", "p_gender" "text", "p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_client_with_phone"("p_primary_name" "text", "p_primary_phone" "text", "p_gender" "text", "p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_client_with_phone"("p_primary_name" "text", "p_primary_phone" "text", "p_gender" "text", "p_branch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_entry_queue"("p_client_name" "text", "p_mobile" "text", "p_branch_id" "uuid", "p_assigned_crm_name" "text", "p_client_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_entry_queue"("p_client_name" "text", "p_mobile" "text", "p_branch_id" "uuid", "p_assigned_crm_name" "text", "p_client_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_entry_queue"("p_client_name" "text", "p_mobile" "text", "p_branch_id" "uuid", "p_assigned_crm_name" "text", "p_client_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_entry_queue"("p_client_name" "text", "p_mobile" "text", "p_branch_id" "uuid", "p_assigned_crm_name" "text", "p_client_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."referrals" TO "anon";
GRANT ALL ON TABLE "public"."referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."referrals" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_manual_referral"("p_client_id" "uuid", "p_referral_name" "text", "p_referral_number" "text", "p_crm_name" "text", "p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_manual_referral"("p_client_id" "uuid", "p_referral_name" "text", "p_referral_number" "text", "p_crm_name" "text", "p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_manual_referral"("p_client_id" "uuid", "p_referral_name" "text", "p_referral_number" "text", "p_crm_name" "text", "p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_manual_referral"("p_client_id" "uuid", "p_referral_name" "text", "p_referral_number" "text", "p_crm_name" "text", "p_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_manual_referral"("p_client_id" "uuid", "p_referral_name" "text", "p_referral_number" "text", "p_crm_name" "text", "p_branch_id" "uuid", "p_relationship" "text", "p_best_time_to_call" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_manual_referral"("p_client_id" "uuid", "p_referral_name" "text", "p_referral_number" "text", "p_crm_name" "text", "p_branch_id" "uuid", "p_relationship" "text", "p_best_time_to_call" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_manual_referral"("p_client_id" "uuid", "p_referral_name" "text", "p_referral_number" "text", "p_crm_name" "text", "p_branch_id" "uuid", "p_relationship" "text", "p_best_time_to_call" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_not_bought_followup_from_visit_form"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_not_bought_followup_from_visit_form"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_not_bought_followup_from_visit_form"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_referral_calling_if_open"("p_referral_id" "uuid", "p_name" "text", "p_number" "text", "p_next_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."create_referral_calling_if_open"("p_referral_id" "uuid", "p_name" "text", "p_number" "text", "p_next_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_referral_calling_if_open"("p_referral_id" "uuid", "p_name" "text", "p_number" "text", "p_next_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_referral_from_visit_form"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_referral_from_visit_form"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_referral_from_visit_form"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_crm_user_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_crm_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_crm_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_crm_user_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_branch_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_branch_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_branch_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_branch_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."dedupe_category_array"("p_values" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."dedupe_category_array"("p_values" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dedupe_category_array"("p_values" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."dedupe_category_array_columns"() TO "anon";
GRANT ALL ON FUNCTION "public"."dedupe_category_array_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."dedupe_category_array_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_profile"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_branch_manager"("row_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_branch_manager"("row_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_branch_manager"("row_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_branch_manager"("row_branch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_branch_staff"("row_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_branch_staff"("row_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_branch_staff"("row_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_branch_staff"("row_branch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_user_in_current_branch"("row_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_user_in_current_branch"("row_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_user_in_current_branch"("row_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_user_in_current_branch"("row_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."legacy_call_outcome_status"("p_outcome" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."legacy_call_outcome_status"("p_outcome" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."legacy_call_outcome_status"("p_outcome" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."legacy_status_is_done"("p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."legacy_status_is_done"("p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."legacy_status_is_done"("p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."lookup_client_by_phone"("p_phone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lookup_client_by_phone"("p_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_client_by_phone"("p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_client_by_phone"("p_phone" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."manage_crm_roster"("p_operation" "text", "p_roster_id" "uuid", "p_branch_id" "uuid", "p_crm_name" "text", "p_target_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."manage_crm_roster"("p_operation" "text", "p_roster_id" "uuid", "p_branch_id" "uuid", "p_crm_name" "text", "p_target_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."manage_crm_roster"("p_operation" "text", "p_roster_id" "uuid", "p_branch_id" "uuid", "p_crm_name" "text", "p_target_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."manage_crm_roster"("p_operation" "text", "p_roster_id" "uuid", "p_branch_id" "uuid", "p_crm_name" "text", "p_target_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."next_business_day"("p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."next_business_day"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."next_business_day"("p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_client_phone_index"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_client_phone_index"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_client_phone_index"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."normalize_crm_roster_value"("value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_crm_roster_value"("value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_crm_roster_value"("value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_crm_roster_value"("value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_lookup_label"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_lookup_label"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_lookup_label"() TO "service_role";



GRANT ALL ON FUNCTION "public"."not_bought_followup_status_is_done"("p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."not_bought_followup_status_is_done"("p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."not_bought_followup_status_is_done"("p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_not_bought_history_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_not_bought_history_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_not_bought_history_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_client_rollups"() TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_client_rollups"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_client_rollups"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_referral_calling_conversions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_referral_calling_conversions"() TO "anon";
GRANT ALL ON FUNCTION "public"."reconcile_referral_calling_conversions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_referral_calling_conversions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."record_not_bought_followup_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."record_not_bought_followup_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_not_bought_followup_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."record_referral_calling_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."record_referral_calling_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_referral_calling_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON TABLE "public"."not_bought_followups" TO "anon";
GRANT ALL ON TABLE "public"."not_bought_followups" TO "authenticated";
GRANT ALL ON TABLE "public"."not_bought_followups" TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_not_bought_followup"("p_followup_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_not_bought_followup"("p_followup_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."save_not_bought_followup"("p_followup_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_not_bought_followup"("p_followup_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text") TO "service_role";



GRANT ALL ON TABLE "public"."referral_calling" TO "anon";
GRANT ALL ON TABLE "public"."referral_calling" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_calling" TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_referral_followup"("p_referral_calling_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text", "p_entered_by" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_referral_followup"("p_referral_calling_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text", "p_entered_by" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."save_referral_followup"("p_referral_calling_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text", "p_entered_by" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_referral_followup"("p_referral_calling_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text", "p_entered_by" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_referral_followup"("p_referral_calling_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text", "p_entered_by" "text", "p_request_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_referral_followup"("p_referral_calling_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text", "p_entered_by" "text", "p_request_key" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."save_referral_followup"("p_referral_calling_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text", "p_entered_by" "text", "p_request_key" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_referral_followup"("p_referral_calling_id" "uuid", "p_followup_status" "text", "p_call_response" "text", "p_next_followup_date" "date", "p_remark" "text", "p_entered_by" "text", "p_request_key" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_clients"("search_text" "text", "result_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_clients"("search_text" "text", "result_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_clients"("search_text" "text", "result_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_client_profile_editor"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_client_profile_editor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_client_profile_editor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_lead_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_lead_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_lead_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_legacy_walkin_visit"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_legacy_walkin_visit"("p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_legacy_walkin_visit"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_legacy_walkin_visit"("p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_walkin_visit"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_walkin_visit"("p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_walkin_visit"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_walkin_visit"("p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_client_phone_index"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_client_phone_index"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_client_phone_index"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_not_bought_followups"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_not_bought_followups"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_not_bought_followups"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_not_bought_followups"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_not_bought_followup"("p_followup_id" "uuid", "p_call_response" "text", "p_remark" "text", "p_next_followup_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_not_bought_followup"("p_followup_id" "uuid", "p_call_response" "text", "p_remark" "text", "p_next_followup_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."update_not_bought_followup"("p_followup_id" "uuid", "p_call_response" "text", "p_remark" "text", "p_next_followup_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_not_bought_followup"("p_followup_id" "uuid", "p_call_response" "text", "p_remark" "text", "p_next_followup_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_not_bought_reason"("p_followup_id" "uuid", "p_reasons" "text"[], "p_other" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_not_bought_reason"("p_followup_id" "uuid", "p_reasons" "text"[], "p_other" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_not_bought_reason"("p_followup_id" "uuid", "p_reasons" "text"[], "p_other" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_not_bought_reason"("p_followup_id" "uuid", "p_reasons" "text"[], "p_other" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_referral_calling"("p_referral_calling_id" "uuid", "p_call_response" "text", "p_remark" "text", "p_next_followup_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_referral_calling"("p_referral_calling_id" "uuid", "p_call_response" "text", "p_remark" "text", "p_next_followup_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."update_referral_calling"("p_referral_calling_id" "uuid", "p_call_response" "text", "p_remark" "text", "p_next_followup_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_referral_calling"("p_referral_calling_id" "uuid", "p_call_response" "text", "p_remark" "text", "p_next_followup_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_client_potential_category"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_client_potential_category"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_client_potential_category"() TO "service_role";



GRANT ALL ON TABLE "public"."_prisma_migrations" TO "anon";
GRANT ALL ON TABLE "public"."_prisma_migrations" TO "authenticated";
GRANT ALL ON TABLE "public"."_prisma_migrations" TO "service_role";



GRANT ALL ON TABLE "public"."branches" TO "anon";
GRANT ALL ON TABLE "public"."branches" TO "authenticated";
GRANT ALL ON TABLE "public"."branches" TO "service_role";



GRANT ALL ON TABLE "public"."campaigns" TO "anon";
GRANT ALL ON TABLE "public"."campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."client_campaign_tags" TO "anon";
GRANT ALL ON TABLE "public"."client_campaign_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."client_campaign_tags" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_code_sequence" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_code_sequence" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_code_sequence" TO "service_role";



GRANT ALL ON TABLE "public"."client_edit_log" TO "anon";
GRANT ALL ON TABLE "public"."client_edit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."client_edit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_edit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_edit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_edit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."client_phone_index" TO "anon";
GRANT ALL ON TABLE "public"."client_phone_index" TO "authenticated";
GRANT ALL ON TABLE "public"."client_phone_index" TO "service_role";



GRANT ALL ON TABLE "public"."client_timeline" TO "anon";
GRANT ALL ON TABLE "public"."client_timeline" TO "authenticated";
GRANT ALL ON TABLE "public"."client_timeline" TO "service_role";



GRANT ALL ON TABLE "public"."crm_allocation" TO "anon";
GRANT ALL ON TABLE "public"."crm_allocation" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_allocation" TO "service_role";



GRANT ALL ON TABLE "public"."crm_daily_availability" TO "anon";
GRANT ALL ON TABLE "public"."crm_daily_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_daily_availability" TO "service_role";



GRANT ALL ON TABLE "public"."crm_queue_round_robin" TO "anon";
GRANT ALL ON TABLE "public"."crm_queue_round_robin" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_queue_round_robin" TO "service_role";



GRANT ALL ON TABLE "public"."crm_sso_access_audit" TO "anon";
GRANT ALL ON TABLE "public"."crm_sso_access_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_sso_access_audit" TO "service_role";



GRANT ALL ON TABLE "public"."crm_sso_access_grants" TO "anon";
GRANT ALL ON TABLE "public"."crm_sso_access_grants" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_sso_access_grants" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."entry_queue" TO "anon";
GRANT ALL ON TABLE "public"."entry_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."entry_queue" TO "service_role";



GRANT ALL ON TABLE "public"."lead_form_field_options" TO "anon";
GRANT ALL ON TABLE "public"."lead_form_field_options" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_form_field_options" TO "service_role";



GRANT ALL ON TABLE "public"."lead_form_fields" TO "anon";
GRANT ALL ON TABLE "public"."lead_form_fields" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_form_fields" TO "service_role";



GRANT ALL ON TABLE "public"."lead_stage_history" TO "anon";
GRANT ALL ON TABLE "public"."lead_stage_history" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_stage_history" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."legacy_import_keys" TO "anon";
GRANT ALL ON TABLE "public"."legacy_import_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."legacy_import_keys" TO "service_role";



GRANT ALL ON TABLE "public"."legacy_walkin_ingest_attempts" TO "anon";
GRANT ALL ON TABLE "public"."legacy_walkin_ingest_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."legacy_walkin_ingest_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."legacy_walkin_ingest_rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."legacy_walkin_ingest_rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."legacy_walkin_ingest_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."lookup_beverages" TO "anon";
GRANT ALL ON TABLE "public"."lookup_beverages" TO "authenticated";
GRANT ALL ON TABLE "public"."lookup_beverages" TO "service_role";



GRANT ALL ON TABLE "public"."lookup_cities" TO "anon";
GRANT ALL ON TABLE "public"."lookup_cities" TO "authenticated";
GRANT ALL ON TABLE "public"."lookup_cities" TO "service_role";



GRANT ALL ON TABLE "public"."lookup_communities" TO "anon";
GRANT ALL ON TABLE "public"."lookup_communities" TO "authenticated";
GRANT ALL ON TABLE "public"."lookup_communities" TO "service_role";



GRANT ALL ON TABLE "public"."lookup_gifts" TO "anon";
GRANT ALL ON TABLE "public"."lookup_gifts" TO "authenticated";
GRANT ALL ON TABLE "public"."lookup_gifts" TO "service_role";



GRANT ALL ON TABLE "public"."lookup_not_bought_reasons" TO "anon";
GRANT ALL ON TABLE "public"."lookup_not_bought_reasons" TO "authenticated";
GRANT ALL ON TABLE "public"."lookup_not_bought_reasons" TO "service_role";



GRANT ALL ON TABLE "public"."lookup_pincodes" TO "anon";
GRANT ALL ON TABLE "public"."lookup_pincodes" TO "authenticated";
GRANT ALL ON TABLE "public"."lookup_pincodes" TO "service_role";



GRANT ALL ON TABLE "public"."lookup_product_categories" TO "anon";
GRANT ALL ON TABLE "public"."lookup_product_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."lookup_product_categories" TO "service_role";



GRANT ALL ON TABLE "public"."lookup_relations" TO "anon";
GRANT ALL ON TABLE "public"."lookup_relations" TO "authenticated";
GRANT ALL ON TABLE "public"."lookup_relations" TO "service_role";



GRANT ALL ON TABLE "public"."lookup_snacks" TO "anon";
GRANT ALL ON TABLE "public"."lookup_snacks" TO "authenticated";
GRANT ALL ON TABLE "public"."lookup_snacks" TO "service_role";



GRANT ALL ON TABLE "public"."lookup_source_of_leads" TO "anon";
GRANT ALL ON TABLE "public"."lookup_source_of_leads" TO "authenticated";
GRANT ALL ON TABLE "public"."lookup_source_of_leads" TO "service_role";



GRANT ALL ON TABLE "public"."lookup_sugar_options" TO "anon";
GRANT ALL ON TABLE "public"."lookup_sugar_options" TO "authenticated";
GRANT ALL ON TABLE "public"."lookup_sugar_options" TO "service_role";



GRANT ALL ON TABLE "public"."not_bought_history" TO "anon";
GRANT ALL ON TABLE "public"."not_bought_history" TO "authenticated";
GRANT ALL ON TABLE "public"."not_bought_history" TO "service_role";



GRANT ALL ON TABLE "public"."referral_calling_history" TO "anon";
GRANT ALL ON TABLE "public"."referral_calling_history" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_calling_history" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."visit_forms" TO "anon";
GRANT ALL ON TABLE "public"."visit_forms" TO "authenticated";
GRANT ALL ON TABLE "public"."visit_forms" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
