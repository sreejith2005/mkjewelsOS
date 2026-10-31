-- Every client has a family (owner decision 2026-10-07).
--
-- Until now an MKF family was created only when a walk-in recorded companions, so a client who
-- came alone had no Family ID. The owner wants every client to get three IDs the moment the
-- record is created: MKC (client), MKREF (referral) and MKF (family). Family members may be
-- added on a later visit; they then share the main client's MKF.
--
-- - A new client gets their own family, with themselves as its main client
--   (clients_assign_family + clients_family_main_client).
-- - Existing clients without a family get one now, numbered in MKC order.
-- - Joining (crm_private.join_family, used by walk-in companions and add_client_to_family):
--   a person alone in their family moves into the other person's family. Two families that
--   both have other members are never merged ('in_other_family', as before). When the main
--   client is the one alone and the companion's family has others, the main client joins the
--   companion's family, as before ('joined_their_family').
-- - Relation: the main client of a family is 'Main client'. A walk-in companion who joins the
--   buyer's family stores the relation chosen on the form (clients.household_relation, the
--   Sheet's FAMILY DATA RELATION). client_identity.relation shows it; a referred person still
--   shows the referral relation. client_identity.family_relation is the family relation alone.
-- - remove_client_from_family gives the person a new family of their own instead of none.
-- - A family left with no members is deleted (its MKF is not reused); a family whose main
--   client leaves falls back to its first member by MKC, as the FAMILY DATA view already does.
-- - households.main_client_id is cleared, not blocking, when that client row is deleted.

-- ---------------------------------------------------------------------------
-- A new client gets a family
-- ---------------------------------------------------------------------------

-- BEFORE INSERT: the household row is created first and main_client_id set AFTER INSERT,
-- because households.main_client_id references the client row. Runs after
-- clients_aa_protect_identity (name order), which still rejects a staff-chosen family.
CREATE FUNCTION crm_private.assign_client_family()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.household_id IS NULL THEN
    INSERT INTO public.households DEFAULT VALUES RETURNING id INTO NEW.household_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER clients_assign_family BEFORE INSERT ON public.clients
FOR EACH ROW EXECUTE FUNCTION crm_private.assign_client_family();

CREATE FUNCTION crm_private.set_family_main_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.households SET main_client_id = NEW.client_id
  WHERE id = NEW.household_id AND main_client_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.household_id = NEW.household_id AND c.client_id <> NEW.client_id);
  RETURN NULL;
END
$$;
CREATE TRIGGER clients_family_main_client AFTER INSERT ON public.clients
FOR EACH ROW EXECUTE FUNCTION crm_private.set_family_main_client();

-- ---------------------------------------------------------------------------
-- Families left behind
-- ---------------------------------------------------------------------------

ALTER TABLE public.households DROP CONSTRAINT households_main_client_id_fkey;
ALTER TABLE public.households ADD CONSTRAINT households_main_client_id_fkey
  FOREIGN KEY (main_client_id) REFERENCES public.clients (client_id) ON DELETE SET NULL;
CREATE INDEX households_main_client_id_idx ON public.households (main_client_id);

CREATE FUNCTION crm_private.tidy_left_family()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.household_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF tg_op = 'UPDATE' THEN
    IF NEW.household_id IS NOT DISTINCT FROM OLD.household_id THEN
      RETURN NULL;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.household_id = OLD.household_id) THEN
    DELETE FROM public.households WHERE id = OLD.household_id;
  ELSE
    UPDATE public.households SET main_client_id = NULL
    WHERE id = OLD.household_id AND main_client_id = OLD.client_id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER clients_tidy_left_family AFTER UPDATE OF household_id OR DELETE ON public.clients
FOR EACH ROW EXECUTE FUNCTION crm_private.tidy_left_family();

-- ---------------------------------------------------------------------------
-- Existing clients without a family
-- ---------------------------------------------------------------------------

-- The backfill is not a profile edit: it leaves profile_updated_at/_by and client_edit_log as
-- they are, and writes one summary audit row instead (triggers re-enabled in this transaction).
ALTER TABLE public.clients DISABLE TRIGGER clients_set_profile_editor;
ALTER TABLE public.clients DISABLE TRIGGER clients_field_level_audit;
DO $$
DECLARE
  v_client record;
  v_household uuid;
  v_count integer := 0;
BEGIN
  FOR v_client IN
    SELECT client_id FROM public.clients WHERE household_id IS NULL
    ORDER BY substring(client_code FROM 5)::bigint, client_id
  LOOP
    INSERT INTO public.households (main_client_id) VALUES (v_client.client_id) RETURNING id INTO v_household;
    UPDATE public.clients SET household_id = v_household WHERE client_id = v_client.client_id;
    v_count := v_count + 1;
  END LOOP;
  IF v_count > 0 THEN
    PERFORM crm_private.write_audit_log('crm.backfill_client_families', NULL, jsonb_build_object('families_created', v_count));
  END IF;
END
$$;
ALTER TABLE public.clients ENABLE TRIGGER clients_set_profile_editor;
ALTER TABLE public.clients ENABLE TRIGGER clients_field_level_audit;

-- ---------------------------------------------------------------------------
-- Joining a family
-- ---------------------------------------------------------------------------

-- Puts p_member into p_client's family. Returns
--   'already'             same family already
--   'joined'              p_member moved into p_client's family
--   'joined_their_family' p_client (alone) moved into p_member's family
--   'in_other_family'     both families have other members; nothing changed
-- A person who moves keeps no relation from their old family (household_relation cleared).
CREATE OR REPLACE FUNCTION crm_private.join_family(p_client uuid, p_member uuid, p_actor uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_household uuid;
  v_member_household uuid;
BEGIN
  IF p_client IS NULL OR p_member IS NULL OR p_client = p_member THEN
    RETURN 'already';
  END IF;
  SELECT household_id INTO v_household FROM public.clients WHERE client_id = p_client FOR UPDATE;
  SELECT household_id INTO v_member_household FROM public.clients WHERE client_id = p_member FOR UPDATE;
  IF v_household IS NOT NULL AND v_household = v_member_household THEN
    RETURN 'already';
  END IF;
  IF v_household IS NULL THEN
    INSERT INTO public.households (created_by, main_client_id) VALUES (p_actor, p_client) RETURNING id INTO v_household;
    UPDATE public.clients SET household_id = v_household WHERE client_id = p_client;
  END IF;
  IF v_member_household IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.household_id = v_member_household AND c.client_id <> p_member) THEN
    UPDATE public.clients SET household_id = v_household, household_relation = NULL WHERE client_id = p_member;
    RETURN 'joined';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.household_id = v_household AND c.client_id <> p_client) THEN
    UPDATE public.clients SET household_id = v_member_household, household_relation = NULL WHERE client_id = p_client;
    RETURN 'joined_their_family';
  END IF;
  RETURN 'in_other_family';
END
$$;

-- As 20261007001100, plus: a companion in the buyer's family stores the relation from the form.
CREATE OR REPLACE FUNCTION crm_private.link_visit_companions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_visit record;
  v_companion jsonb;
  v_name text;
  v_phone text;
  v_relation text;
  v_member uuid;
  v_found record;
  v_household uuid;
  v_result text;
  v_counts jsonb := '{}'::jsonb;
BEGIN
  IF jsonb_typeof(NEW.companions) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.companions) = 0 THEN
    RETURN NULL;
  END IF;
  SELECT t.client_id, t.branch_id, t.salesperson_id INTO v_visit FROM public.client_timeline t WHERE t.id = NEW.client_timeline_id;
  IF v_visit.client_id IS NULL THEN
    RETURN NULL;
  END IF;
  FOR v_companion IN SELECT value FROM jsonb_array_elements(NEW.companions) LOOP
    IF jsonb_typeof(v_companion) <> 'object' THEN CONTINUE; END IF;
    v_name := left(btrim(COALESCE(v_companion ->> 'name', '')), 160);
    -- The /crm form stores 'mobile'; the Sheet ingest stores 'phone'.
    v_phone := crm_private.phone_key(COALESCE(NULLIF(v_companion ->> 'phone', ''), v_companion ->> 'mobile', ''));
    v_relation := NULLIF(left(btrim(COALESCE(v_companion ->> 'relation', '')), 120), '');
    IF v_name = '' AND v_phone IS NULL THEN CONTINUE; END IF;
    v_member := NULL;
    IF v_phone IS NULL THEN
      -- No phone: the same name inside this family is the same person.
      SELECT household_id INTO v_household FROM public.clients WHERE client_id = v_visit.client_id;
      IF v_household IS NOT NULL THEN
        SELECT c.client_id INTO v_member FROM public.clients c
        WHERE c.household_id = v_household AND c.client_id <> v_visit.client_id
          AND public.normalize_crm_roster_value(c.primary_name) = public.normalize_crm_roster_value(v_name)
        ORDER BY c.client_code LIMIT 1;
      END IF;
    END IF;
    IF v_member IS NULL THEN
      SELECT * INTO v_found FROM crm_private.find_or_create_known_client(
        CASE WHEN v_name = '' THEN 'COMPANION ' || v_phone ELSE v_name END, v_phone, v_visit.branch_id, 'engaged');
      v_member := v_found.client_id;
      IF v_found.created THEN v_counts := jsonb_set(v_counts, '{created}', to_jsonb(COALESCE((v_counts ->> 'created')::int, 0) + 1)); END IF;
    END IF;
    IF v_member IS NULL OR v_member = v_visit.client_id THEN CONTINUE; END IF;
    v_result := crm_private.join_family(v_visit.client_id, v_member, v_visit.salesperson_id);
    -- The relation on the form is to the buyer: stored only when the buyer's family is the one
    -- the companion is in (not when the buyer joined the companion's family).
    IF v_relation IS NOT NULL AND v_result IN ('joined', 'already') THEN
      UPDATE public.clients SET household_relation = v_relation
      WHERE client_id = v_member AND household_relation IS DISTINCT FROM v_relation;
    END IF;
    v_counts := jsonb_set(v_counts, ARRAY[v_result], to_jsonb(COALESCE((v_counts ->> v_result)::int, 0) + 1));
  END LOOP;
  IF v_counts <> '{}'::jsonb THEN
    PERFORM crm_private.write_audit_log('crm.visit_companions_family', v_visit.client_id,
      jsonb_build_object('visit_form_id', NEW.id, 'counts', v_counts));
  END IF;
  RETURN NULL;
END
$$;

-- As 20261005000300, but the person gets a new family of their own (as main client) instead of
-- none. A person already alone in their family is left as is.
CREATE OR REPLACE FUNCTION public.remove_client_from_family(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_household uuid;
  v_new_household uuid;
BEGIN
  PERFORM crm_private.assert_can_edit_client(p_client_id);
  SELECT household_id INTO v_household FROM public.clients WHERE client_id = p_client_id FOR UPDATE;
  IF v_household IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.household_id = v_household AND c.client_id <> p_client_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.households (created_by) VALUES (public.current_crm_user_id()) RETURNING id INTO v_new_household;
  UPDATE public.clients SET household_id = v_new_household, household_relation = NULL WHERE client_id = p_client_id;
  UPDATE public.households SET main_client_id = p_client_id WHERE id = v_new_household;
  PERFORM crm_private.write_audit_log('crm.remove_client_from_family', p_client_id,
    jsonb_build_object('household_id', v_household, 'new_household_id', v_new_household));
END
$$;

-- add_client_to_family: unchanged; join_family's new 'joined_their_family' result is a success.

-- ---------------------------------------------------------------------------
-- Derived relation
-- ---------------------------------------------------------------------------

-- As 20261005000300, with family_relation appended and relation using it for a person who was
-- not referred. The main client is households.main_client_id, else the first member by MKC (the
-- FAMILY DATA view's rule).
CREATE OR REPLACE VIEW public.client_identity WITH (security_invoker = true) AS
SELECT
  c.client_id,
  c.client_code,
  c.referral_code,
  h.household_code,
  c.household_id,
  c.referred_by_client_id,
  referrer.client_code AS referred_by_client_code,
  referrer.primary_name AS referred_by_name,
  CASE
    WHEN c.total_purchase_visits > 0 THEN 'purchased'
    WHEN c.total_visits > 0 THEN 'visited'
    ELSE c.lifecycle_stage
  END AS lifecycle_stage,
  COALESCE(referrer.referral_code, c.referral_code) AS referral_id,
  CASE WHEN c.referred_by_client_id IS NULL THEN NULL ELSE c.referral_code END AS referral_person_id,
  CASE
    WHEN c.referred_by_client_id IS NOT NULL THEN COALESCE(c.referral_relation, 'Referral')
    ELSE COALESCE(family.relation, 'Main client')
  END::character varying AS relation,
  family.relation AS family_relation
FROM public.clients c
LEFT JOIN public.households h ON h.id = c.household_id
LEFT JOIN public.clients referrer ON referrer.client_id = c.referred_by_client_id
LEFT JOIN LATERAL (
  SELECT CASE
    WHEN c.client_id = COALESCE(h.main_client_id, (
      SELECT m.client_id FROM public.clients m WHERE m.household_id = h.id ORDER BY m.client_code, m.client_id LIMIT 1))
      THEN 'Main client'
    ELSE COALESCE(c.household_relation, 'Family member')
  END::character varying AS relation
  WHERE h.id IS NOT NULL
) family ON true;

REVOKE ALL ON FUNCTION crm_private.assign_client_family(), crm_private.set_family_main_client(),
  crm_private.tidy_left_family() FROM PUBLIC, anon, authenticated;
