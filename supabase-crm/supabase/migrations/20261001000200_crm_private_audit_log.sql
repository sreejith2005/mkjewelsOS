-- CRM project upgrade 2/5: the CRM project's own audit log.
--
-- In the JewelOS port, CRM mutating RPCs (0184) and direct table writes (0189) wrote audit
-- rows to JewelOS public.audit_logs. In the two-project design
-- (docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md) each project
-- audits its own writes, so the CRM project keeps them in crm_private.audit_logs.
--
-- crm_private is not an API-exposed schema. authenticated may only USE it, so that
-- invoker-rights RPCs can call write_audit_log. The table itself has no grant to
-- anon/authenticated. An audit row records the action, the record id, the actor and
-- non-value details (for example changed column names), never customer values.

CREATE SCHEMA IF NOT EXISTS crm_private;
REVOKE ALL ON SCHEMA crm_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA crm_private TO authenticated, service_role;

CREATE TABLE crm_private.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  action text NOT NULL CONSTRAINT audit_logs_action_format CHECK (action ~ '^crm\.[a-z_]+$'),
  record_id uuid,
  actor_auth_user_id uuid,
  actor_crm_user_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_logs_created_at_idx ON crm_private.audit_logs (created_at DESC);
CREATE INDEX audit_logs_record_created_at_idx ON crm_private.audit_logs (record_id, created_at DESC);
CREATE INDEX audit_logs_action_created_at_idx ON crm_private.audit_logs (action, created_at DESC);
ALTER TABLE crm_private.audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE crm_private.audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE crm_private.audit_logs TO service_role;

-- Additive audit row for a CRM mutation, written in the caller's transaction, so an exception
-- in the RPC rolls it back with everything else. Same signature as the port's
-- crm_private.write_audit_log, so the ported RPC bodies call it unchanged.
CREATE FUNCTION crm_private.write_audit_log(p_action text, p_record_id uuid, p_details jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_action IS NULL OR p_action !~ '^crm\.[a-z_]+$' THEN
    RAISE EXCEPTION 'Invalid CRM audit action' USING ERRCODE = '22023';
  END IF;
  INSERT INTO crm_private.audit_logs (action, record_id, actor_auth_user_id, actor_crm_user_id, details)
  VALUES (p_action, p_record_id, auth.uid(), public.current_crm_user_id(), COALESCE(p_details, '{}'::jsonb));
END
$$;
REVOKE ALL ON FUNCTION crm_private.write_audit_log(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_private.write_audit_log(text, uuid, jsonb) TO authenticated, service_role;

-- Direct (non-RPC) writes the original UI makes under RLS: same contract as the port's 0189.
-- Audited: a row-level INSERT/UPDATE/DELETE executed as role authenticated by the statement
-- itself (trigger depth 1), outside a PostgREST RPC call. The row records the entity, the
-- operation and the changed column names only.
CREATE FUNCTION crm_private.audit_direct_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row jsonb;
  v_old jsonb;
  v_columns text[];
BEGIN
  IF current_user <> 'authenticated'
    OR pg_trigger_depth() > 1
    OR COALESCE(current_setting('request.path', true), '') LIKE '/rpc/%' THEN
    RETURN NULL;
  END IF;

  IF tg_op = 'DELETE' THEN
    v_row := to_jsonb(old);
    v_columns := '{}';
  ELSIF tg_op = 'UPDATE' THEN
    v_row := to_jsonb(new);
    v_old := to_jsonb(old);
    SELECT COALESCE(array_agg(changed.key ORDER BY changed.key), '{}') INTO v_columns
    FROM jsonb_each(v_row) AS changed
    WHERE changed.value IS DISTINCT FROM v_old -> changed.key;
  ELSE
    v_row := to_jsonb(new);
    SELECT COALESCE(array_agg(assigned.key ORDER BY assigned.key), '{}') INTO v_columns
    FROM jsonb_each(v_row) AS assigned
    WHERE assigned.value <> 'null'::jsonb;
  END IF;

  PERFORM crm_private.write_audit_log(
    'crm.' || tg_table_name || '_' || lower(tg_op),
    (v_row ->> tg_argv[0])::uuid,
    jsonb_build_object('entity', tg_table_name, 'operation', lower(tg_op), 'changed_columns', to_jsonb(v_columns))
  );
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION crm_private.audit_direct_write() FROM PUBLIC, anon;

CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('client_id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.crm_daily_availability
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.lead_call_history
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.lookup_beverages
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.lookup_cities
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.lookup_communities
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.lookup_gifts
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.lookup_not_bought_reasons
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.lookup_pincodes
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.lookup_product_categories
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.lookup_relations
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.lookup_snacks
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.lookup_source_of_leads
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
CREATE TRIGGER crm_direct_write_audit AFTER INSERT OR UPDATE OR DELETE ON public.lookup_sugar_options
  FOR EACH ROW EXECUTE FUNCTION crm_private.audit_direct_write('id');
