-- CRM department roster per franchise (JewelOS 0386_franchise_module_scope.sql).
--
-- Since 20261008000100 a snapshot with `crm_roster_all_branches` true puts a CRM
-- department member on the roster of every active CRM branch. Once JewelOS
-- franchise isolation is on, the snapshot also carries
-- `crm_roster_jewelos_branch_ids`: the JewelOS stores of the person's own
-- franchise. The person then joins only the CRM branches mapped to those stores,
-- so a Mumbai CRM member never appears in an Ahmedabad walk-in dropdown or
-- round robin. Without the key (isolation off, or an older JewelOS) nothing
-- changes. Rows a person no longer holds become inactive as before; nothing is
-- deleted.

DO $$
DECLARE
  v_body text;
  v_old text := E'      SELECT COALESCE(array_agg(b.id ORDER BY b.id), ''{}'') INTO v_branches FROM public.branches b WHERE b.active;';
  v_new text := E'      SELECT COALESCE(array_agg(b.id ORDER BY b.id), ''{}'') INTO v_branches FROM public.branches b WHERE b.active\n'
    || E'        AND (jsonb_typeof(p_snapshot -> ''crm_roster_jewelos_branch_ids'') IS DISTINCT FROM ''array''\n'
    || E'          OR b.jewelos_branch_id::text IN (SELECT jsonb_array_elements_text(p_snapshot -> ''crm_roster_jewelos_branch_ids'')));';
BEGIN
  v_body := replace(pg_get_functiondef('crm_private.apply_staff_roster(uuid,uuid,text,boolean,jsonb)'::regprocedure), E'\r', '');
  IF (length(v_body) - length(replace(v_body, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'CRM roster contract changed: expected one all-branches roster query';
  END IF;
  EXECUTE replace(v_body, v_old, v_new);
END $$;
