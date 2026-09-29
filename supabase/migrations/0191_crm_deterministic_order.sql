-- D5 (owner decision 2026-09-28): deterministic order in the ported CRM functions.
-- A unique tie-breaker (the table's primary key, same direction as the last sort key) is added
-- to every ORDER BY that can tie, so results are deterministic. Each edit is marked
-- `crm-port: deterministic order`. The bodies are otherwise the 0185 definitions, unchanged; CREATE OR REPLACE
-- keeps owners, privileges and the trigger that uses create_not_bought_followup_from_visit_form.
-- The edit list is scripts/crm-parity/deterministic-order.mjs (SQL_EDITS); the parity harness
-- applies the same edits to the original database at run time only.

CREATE OR REPLACE FUNCTION crm.browse_clients(search_text text, potential_category text, page_offset integer, result_limit integer) RETURNS TABLE(client_id uuid, client_code text, primary_name text, primary_phone text, city text, state text, total_visits integer, last_visit_date timestamp with time zone, last_buy_status text, client_potential_category text)
    LANGUAGE sql STABLE
    SET search_path TO ''
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
  FROM "crm"."clients" client, input
  WHERE "crm"."current_user_role"() IS NOT NULL
    AND (input.potential IS NULL OR client.client_potential_category = input.potential)
    AND (input.value = '' OR client.client_code ILIKE '%' || input.value || '%'
      OR client.primary_name ILIKE '%' || input.value || '%'
      OR EXISTS (SELECT 1 FROM unnest(client.other_names) name WHERE name ILIKE '%' || input.value || '%')
      OR (length(input.last10) = 10 AND EXISTS (
        SELECT 1 FROM "crm"."client_phone_index" phone_index
        WHERE phone_index.client_id = client.client_id AND phone_index.phone = input.last10
      )))
  ORDER BY client.last_visit_date DESC NULLS LAST, client.primary_name, client.client_id -- crm-port: deterministic order
  OFFSET GREATEST(page_offset, 0)
  LIMIT LEAST(GREATEST(result_limit, 1), 200);
$$;

CREATE OR REPLACE FUNCTION crm.search_clients(search_text text, result_limit integer DEFAULT 8) RETURNS TABLE(client_id uuid, primary_name text, primary_phone text, last_visit_date timestamp with time zone, last_branch_name text, matched_phone text, total_visits integer, last_buy_status text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH input AS (SELECT trim(search_text) AS value, regexp_replace(search_text, '[^0-9]', '', 'g') AS digits)
  SELECT c.client_id, c.primary_name::text, c.primary_phone::text, c.last_visit_date, b.name::text, p.phone::text, c.total_visits, c.last_buy_status::text
  FROM "crm"."clients" c LEFT JOIN "crm"."branches" b ON b.id = c.last_branch_id
  LEFT JOIN LATERAL (SELECT pi.phone FROM "crm"."client_phone_index" pi, input WHERE pi.client_id = c.client_id AND input.digits <> '' AND pi.phone LIKE '%' || right(input.digits, 10) || '%' ORDER BY (pi.phone = right(input.digits, 10)) DESC, pi.phone DESC /* crm-port: deterministic order */ LIMIT 1) p ON true, input
  WHERE "crm"."current_user_role"() IS NOT NULL AND ((length(input.digits) >= 3 AND p.phone IS NOT NULL) OR (length(input.value) >= 3 AND (c.primary_name ILIKE '%' || input.value || '%' OR EXISTS (SELECT 1 FROM unnest(c.other_names) name WHERE name ILIKE '%' || input.value || '%'))))
  ORDER BY (p.phone = right(input.digits, 10)) DESC NULLS LAST, c.last_visit_date DESC NULLS LAST, c.primary_name, c.client_id /* crm-port: deterministic order */ LIMIT LEAST(GREATEST(result_limit, 1), 20);
$$;

CREATE OR REPLACE FUNCTION crm.create_not_bought_followup_from_visit_form() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE source_visit record; legacy_status text; has_seen_product boolean; initial_remark text; active_followup "crm"."not_bought_followups"; system_remark text;
BEGIN
  SELECT timeline."client_id", timeline."branch_id", timeline."id" AS timeline_id, timeline."event_date", timeline."reference_number", timeline."salesperson_id", timeline."buy_status"::text AS buy_status, timeline."seen_categories", timeline."bought_categories", timeline."order_categories", timeline."remark" AS timeline_remark, client."next_visit_date"
  INTO source_visit
  FROM "crm"."client_timeline" AS timeline JOIN "crm"."clients" AS client ON client."client_id" = timeline."client_id"
  WHERE timeline."id" = NEW."client_timeline_id";
  IF source_visit."client_id" IS NULL THEN RETURN NEW; END IF;
  legacy_status := upper(btrim(COALESCE(NULLIF(NEW."additional_fields"->>'visit_status', ''), source_visit."buy_status")));
  has_seen_product := EXISTS (SELECT 1 FROM unnest(COALESCE(source_visit."seen_categories", ARRAY[]::text[])) AS item(value) WHERE upper(btrim(item.value)) NOT IN ('', 'NA', 'N/A', '-', 'NONE'))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(NEW."category_details"->'seen_tags', '[]'::jsonb)) AS item(value) WHERE upper(btrim(item.value)) NOT IN ('', 'NA', 'N/A', '-', 'NONE'));

  SELECT * INTO active_followup FROM "crm"."not_bought_followups"
  WHERE "client_id" = source_visit."client_id" AND NOT "crm"."not_bought_followup_status_is_done"("status")
  ORDER BY "created_at", "id" /* crm-port: deterministic order */ FOR UPDATE LIMIT 1;

  -- CRM_CODE.GS:3917-3925, 4101-4135: ready-product purchases and
  -- product exchanges close the one active follow-up; repair/order do not.
  IF legacy_status IN ('YES', 'YES_AND_ORDER_PLACED', 'YES AND ORDER_PLACED', 'PRODUCT_EXCHANGE') THEN
    IF active_followup."id" IS NOT NULL THEN
      system_remark := concat_ws(' | ', 'AUTO CLOSED: CLIENT PURCHASED IN LATER WALK-IN VISIT.', 'PURCHASE REFERENCE: ' || COALESCE(source_visit."reference_number", ''), 'PURCHASE VISIT DATE: ' || (source_visit."event_date" AT TIME ZONE 'Asia/Kolkata')::date::text, 'BUY STATUS: ' || legacy_status, 'BOUGHT: ' || COALESCE(array_to_string(source_visit."bought_categories", ', '), ''), 'ORDER: ' || COALESCE(array_to_string(source_visit."order_categories", ', '), ''), 'REMARK: ' || COALESCE(source_visit."timeline_remark", ''));
      PERFORM set_config('app.not_bought_system_event', 'auto_close', true); PERFORM set_config('app.not_bought_system_remark', system_remark, true);
      UPDATE "crm"."not_bought_followups" SET "status" = 'ALREADY PURCHASED FROM MK JEWELS', "call_response" = 'AUTO CLOSED - CLIENT PURCHASED IN LATER VISIT', "remark" = system_remark, "next_followup_date" = NULL WHERE "id" = active_followup."id";
      PERFORM set_config('app.not_bought_system_event', '', true); PERFORM set_config('app.not_bought_system_remark', '', true);
    END IF;
    RETURN NEW;
  END IF;

  IF legacy_status <> 'NO' AND NOT (legacy_status IN ('REPAIR_PICKUP', 'REPAIR_PLACED', 'ORDER_PICKUP', 'ORDER_PLACED') AND upper(btrim(COALESCE(NEW."repair_or_order_approach", ''))) = 'YES' AND has_seen_product) THEN RETURN NEW; END IF;
  initial_remark := NULLIF(concat_ws('; ', array_to_string(NEW."not_bought_reasons", ', '), NEW."not_bought_other"), '');
  IF active_followup."id" IS NOT NULL THEN
    -- CRM_CODE.GS:4171-4226: preserve the original owner/source link, move
    -- the due date forward from the later visit, and append system history.
    system_remark := concat_ws(' | ', 'CLIENT VISITED AGAIN AND STILL NOT BOUGHT.', 'REFERENCE: ' || COALESCE(source_visit."reference_number", ''), 'CLIENT VISIT DATE: ' || (source_visit."event_date" AT TIME ZONE 'Asia/Kolkata')::date::text, 'SEEN: ' || COALESCE(array_to_string(source_visit."seen_categories", ', '), ''), 'PRODUCT REQUIREMENT: ' || COALESCE((SELECT "product_requirement" FROM "crm"."client_timeline" WHERE "id" = source_visit."timeline_id"), ''), 'REASON: ' || COALESCE(initial_remark, ''), 'ORIGINAL REMARK: ' || COALESCE(source_visit."timeline_remark", ''));
    PERFORM set_config('app.not_bought_system_event', 'merge', true); PERFORM set_config('app.not_bought_system_remark', system_remark, true);
    UPDATE "crm"."not_bought_followups" SET "next_followup_date" = COALESCE(source_visit."next_visit_date", "next_followup_date", (source_visit."event_date" AT TIME ZONE 'Asia/Kolkata')::date) WHERE "id" = active_followup."id";
    PERFORM set_config('app.not_bought_system_event', '', true); PERFORM set_config('app.not_bought_system_remark', '', true);
    RETURN NEW;
  END IF;
  INSERT INTO "crm"."not_bought_followups" ("client_id","reference_number","status","next_followup_date","remark","entered_by","branch_id","source_timeline_id","source_visit_form_id")
  VALUES (source_visit."client_id",source_visit."reference_number",'PENDING',COALESCE(source_visit."next_visit_date",(source_visit."event_date" AT TIME ZONE 'Asia/Kolkata')::date),initial_remark,source_visit."salesperson_id",source_visit."branch_id",source_visit."timeline_id",NEW."id");
  RETURN NEW;
END; $$;
