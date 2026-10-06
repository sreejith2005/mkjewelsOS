-- Client Database paging (owner 2026-10-06).
--
-- The Client Database page showed only ~205 of 1,500+ clients: browse_clients returns at
-- most 200 rows per call and the page called it once (offset 0, limit 1000).
--
-- browse_clients_page() is browse_clients() plus:
-- - total_count: how many clients match the filter, on every row (count before paging);
-- - exclude_unvisited_leads: the page lists a client that has a lead and no visit once, as
--   its LEAD row, so it asks for those clients to be left out of the client rows and of
--   the total.
-- The 4-argument browse_clients() now reads from it with exclude_unvisited_leads = false,
-- so its columns, filter, order and 200-row cap are unchanged.

CREATE FUNCTION public.browse_clients_page(
  search_text text,
  potential_category text,
  page_offset integer,
  result_limit integer,
  exclude_unvisited_leads boolean DEFAULT false
)
 RETURNS TABLE(client_id uuid, client_code text, primary_name text, primary_phone text, city text, state text, total_visits integer, last_visit_date timestamp with time zone, last_buy_status text, client_potential_category text, total_count bigint)
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
    client.client_potential_category::text,
    count(*) OVER () AS total_count
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
    AND NOT (COALESCE(exclude_unvisited_leads, false)
      AND COALESCE(client.total_visits, 0) = 0
      AND EXISTS (SELECT 1 FROM "public"."leads" lead WHERE lead.client_id = client.client_id))
  ORDER BY client.last_visit_date DESC NULLS LAST, client.primary_name, client.client_id -- crm-port: deterministic order
  OFFSET GREATEST(page_offset, 0)
  LIMIT LEAST(GREATEST(result_limit, 1), 200);
$function$
;

CREATE OR REPLACE FUNCTION public.browse_clients(search_text text, potential_category text, page_offset integer, result_limit integer)
 RETURNS TABLE(client_id uuid, client_code text, primary_name text, primary_phone text, city text, state text, total_visits integer, last_visit_date timestamp with time zone, last_buy_status text, client_potential_category text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT client_id, client_code, primary_name, primary_phone, city, state,
    total_visits, last_visit_date, last_buy_status, client_potential_category
  FROM "public"."browse_clients_page"(search_text, potential_category, page_offset, result_limit, false);
$function$
;

REVOKE ALL ON FUNCTION public.browse_clients_page(text, text, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.browse_clients_page(text, text, integer, integer, boolean) TO authenticated;
