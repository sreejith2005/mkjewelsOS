-- Client identity (approved extensions, 2026-10-01): MKF families, MKREF referral codes,
-- optional phone, every lead and referral gets an MKC client at first contact, and one search
-- box for MKC / MKF / MKREF codes.
-- Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md
-- ("Client identity").
--
-- Lifecycle stage. A client created before they ever came to the store (a lead, or a person a
-- client referred) has lifecycle_stage 'lead'. Queue registration moves them to 'engaged';
-- a recorded visit to 'visited'. The display stage is derived: 'purchased' when a purchase
-- visit exists (see client_identity). Existing clients are 'visited'.
-- Why it matters: the original referral calling flow counts a referral as converted as soon
-- as any client has its phone. Referral clients now exist from the start, so a 'lead' client
-- does not count as converted (reconcile_referral_calling_conversions), and queue
-- registration treats a 'lead' client as a new client (client_is_new), as before.
--
-- Families. households(household_code MKF-n); clients.household_id: one family per person.
-- Companions recorded on a walk-in visit join the main client's family: each companion with
-- a 10-digit phone is matched by phone, otherwise by name inside that family, otherwise
-- created (phone optional). A companion already in another family is not moved (counted in
-- the audit row). Membership changes outside a visit go through audited RPCs.
--
-- Referral codes. Every client gets its own MKREF-n. A referred person's client row stores
-- referred_by_client_id and referral_relation ('Referral' unless a relation was given).
-- client_identity derives the owner's columns (Referral ID / Referral person ID / Relation).
--
-- Identity columns (client_code, referral_code, household_id, referred_by_client_id,
-- referral_relation, lifecycle_stage) cannot be written directly by staff; only these
-- functions change them.

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

-- MKC numbering (2026-10-06). The CRM project's codes are one block (MKC-102726 to MKC-104293 on
-- 2026-10-05), from its own counter. The Sheets CRM numbers its own clients from MKC-100001 and
-- renumbers them on every rebuild, so the two ranges can meet. New CRM codes start at MKC-200001:
-- a new CRM code is never also a Sheet number. Existing codes do not change.
SELECT setval('public.client_code_sequence', greatest((SELECT last_value FROM public.client_code_sequence), 200000), true);

ALTER TABLE public.clients ALTER COLUMN primary_phone DROP NOT NULL;

CREATE SEQUENCE public.household_code_sequence;
CREATE SEQUENCE public.referral_code_sequence;
REVOKE ALL ON SEQUENCE public.household_code_sequence, public.referral_code_sequence FROM PUBLIC, anon, authenticated;

CREATE TABLE public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_code text NOT NULL UNIQUE DEFAULT ('MKF-' || nextval('public.household_code_sequence')::text)
    CHECK (household_code ~ '^MKF-[0-9]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users (id)
);
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
CREATE POLICY active_staff_read_households ON public.households FOR SELECT TO authenticated
  USING (public.current_user_role() IS NOT NULL);
REVOKE ALL ON public.households FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.households TO authenticated;

ALTER TABLE public.clients
  ADD COLUMN lifecycle_stage text NOT NULL DEFAULT 'visited'
    CHECK (lifecycle_stage IN ('lead', 'engaged', 'visited', 'purchased')),
  ADD COLUMN household_id uuid REFERENCES public.households (id),
  ADD COLUMN referral_code text CHECK (referral_code ~ '^MKREF-[0-9]+$'),
  ADD COLUMN referred_by_client_id uuid REFERENCES public.clients (client_id),
  ADD COLUMN referral_relation character varying(120);

-- Existing clients get their MKREF in MKC order.
WITH ordered AS (
  SELECT client_id FROM public.clients
  ORDER BY substring(client_code FROM 5)::bigint, client_id
)
UPDATE public.clients c SET referral_code = 'MKREF-' || nextval('public.referral_code_sequence')::text
FROM ordered WHERE ordered.client_id = c.client_id;
ALTER TABLE public.clients ALTER COLUMN referral_code SET NOT NULL;
CREATE UNIQUE INDEX clients_referral_code_key ON public.clients (referral_code);
CREATE INDEX clients_household_id_idx ON public.clients (household_id);
CREATE INDEX clients_referred_by_client_id_idx ON public.clients (referred_by_client_id);

ALTER TABLE public.referrals ADD COLUMN referred_client_id uuid REFERENCES public.clients (client_id);
CREATE INDEX referrals_referred_client_id_idx ON public.referrals (referred_client_id);
ALTER TABLE public.leads ADD COLUMN client_id uuid REFERENCES public.clients (client_id);
CREATE INDEX leads_client_id_idx ON public.leads (client_id);

-- ---------------------------------------------------------------------------
-- Codes and protected identity columns
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.assign_referral_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NULLIF(btrim(NEW.referral_code), '') IS NULL THEN
    NEW.referral_code := 'MKREF-' || nextval('public.referral_code_sequence')::text;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER clients_assign_referral_code BEFORE INSERT ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.assign_referral_code();

-- SECURITY INVOKER: current_user is 'authenticated' only for a staff member's own statement
-- (a direct write or an invoker RPC); the definer functions below run as their owner.
CREATE FUNCTION crm_private.protect_client_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF tg_op = 'INSERT' THEN
    IF NEW.household_id IS NOT NULL OR NEW.referred_by_client_id IS NOT NULL OR NEW.referral_relation IS NOT NULL
       OR NEW.lifecycle_stage <> 'visited' OR NEW.referral_code IS NOT NULL THEN
      RAISE EXCEPTION 'client identity fields are set by the CRM' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.client_code, NEW.referral_code, NEW.household_id, NEW.referred_by_client_id, NEW.referral_relation, NEW.lifecycle_stage)
     IS DISTINCT FROM
     (OLD.client_code, OLD.referral_code, OLD.household_id, OLD.referred_by_client_id, OLD.referral_relation, OLD.lifecycle_stage) THEN
    RAISE EXCEPTION 'client identity fields are set by the CRM' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
-- Named to run before clients_assign_referral_code (triggers fire in name order).
CREATE TRIGGER clients_aa_protect_identity BEFORE INSERT OR UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION crm_private.protect_client_identity();

-- ---------------------------------------------------------------------------
-- Find or create a client for a person known before their first visit
-- ---------------------------------------------------------------------------

-- p_phone may be NULL (optional phone). With a 10-digit phone, an existing client with that
-- phone is reused; nothing else is ever matched here. Returns (client_id, created).
CREATE FUNCTION crm_private.find_or_create_known_client(
  p_name text, p_phone text, p_branch_id uuid, p_stage text,
  p_referred_by uuid DEFAULT NULL, p_relation text DEFAULT NULL,
  OUT client_id uuid, OUT created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := right(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), 10);
  v_name text := left(btrim(COALESCE(p_name, '')), 160);
BEGIN
  created := false;
  IF length(v_phone) = 10 THEN
    SELECT pi.client_id INTO client_id FROM public.client_phone_index pi WHERE pi.phone = v_phone;
    IF client_id IS NOT NULL THEN RETURN; END IF;
  ELSE
    v_phone := NULL;
  END IF;
  IF v_name = '' THEN
    RETURN;
  END IF;
  INSERT INTO public.clients (primary_name, primary_phone, last_branch_id, lifecycle_stage, referred_by_client_id, referral_relation)
  VALUES (v_name, v_phone, p_branch_id, p_stage, p_referred_by,
    CASE WHEN p_referred_by IS NULL THEN NULL ELSE COALESCE(NULLIF(left(btrim(p_relation), 120), ''), 'Referral') END)
  RETURNING clients.client_id INTO client_id;
  created := true;
END
$$;

-- Referrals: the referred person gets a client (stage lead) with its own MKC and MKREF.
CREATE FUNCTION crm_private.link_referral_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_found record;
BEGIN
  IF NEW.referred_client_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_found FROM crm_private.find_or_create_known_client(
    NEW.referral_name, NEW.referral_number, NEW.branch_id, 'lead', NEW.given_by_client_id, NEW.relationship);
  IF v_found.client_id IS NOT NULL AND v_found.client_id <> NEW.given_by_client_id THEN
    UPDATE public.referrals SET referred_client_id = v_found.client_id WHERE id = NEW.id;
    IF v_found.created THEN
      PERFORM crm_private.write_audit_log('crm.client_created_from_referral', v_found.client_id,
        jsonb_build_object('referral_id', NEW.id, 'referred_by_client_id', NEW.given_by_client_id));
    END IF;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER referrals_link_client AFTER INSERT ON public.referrals
FOR EACH ROW EXECUTE FUNCTION crm_private.link_referral_client();

-- Leads: every inquiry gets an MKC at first contact.
CREATE FUNCTION crm_private.link_lead_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_found record;
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_found FROM crm_private.find_or_create_known_client(
    COALESCE(NULLIF(btrim(NEW.name), ''), 'LEAD ' || NEW.phone_number), NEW.phone_number, NEW.branch_id, 'lead');
  IF v_found.client_id IS NOT NULL THEN
    UPDATE public.leads SET client_id = v_found.client_id WHERE id = NEW.id;
    IF v_found.created THEN
      PERFORM crm_private.write_audit_log('crm.client_created_from_lead', v_found.client_id, jsonb_build_object('lead_id', NEW.id));
    END IF;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER leads_link_client AFTER INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION crm_private.link_lead_client();

-- A recorded visit moves a lead or engaged client to visited.
CREATE FUNCTION crm_private.mark_client_visited()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.clients SET lifecycle_stage = 'visited'
  WHERE client_id = NEW.client_id AND lifecycle_stage IN ('lead', 'engaged');
  RETURN NULL;
END
$$;
CREATE TRIGGER client_timeline_mark_client_visited AFTER INSERT ON public.client_timeline
FOR EACH ROW EXECUTE FUNCTION crm_private.mark_client_visited();

-- ---------------------------------------------------------------------------
-- Families
-- ---------------------------------------------------------------------------

-- Puts p_member into p_client's family (creating it when p_client has none). Returns
-- 'joined' | 'already' | 'in_other_family'. Never moves a person between families.
CREATE FUNCTION crm_private.join_family(p_client uuid, p_member uuid, p_actor uuid)
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
  IF v_household IS NULL AND v_member_household IS NOT NULL THEN
    -- The main client joins the companion's existing family.
    UPDATE public.clients SET household_id = v_member_household WHERE client_id = p_client;
    RETURN 'joined';
  END IF;
  IF v_member_household IS NOT NULL THEN
    RETURN 'in_other_family';
  END IF;
  IF v_household IS NULL THEN
    INSERT INTO public.households (created_by) VALUES (p_actor) RETURNING id INTO v_household;
    UPDATE public.clients SET household_id = v_household WHERE client_id = p_client;
  END IF;
  UPDATE public.clients SET household_id = v_household WHERE client_id = p_member;
  RETURN 'joined';
END
$$;

-- Walk-in companions join the main client's family.
CREATE FUNCTION crm_private.link_visit_companions()
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
    v_phone := right(regexp_replace(COALESCE(NULLIF(v_companion ->> 'phone', ''), v_companion ->> 'mobile', ''), '[^0-9]', '', 'g'), 10);
    IF v_name = '' AND length(v_phone) <> 10 THEN CONTINUE; END IF;
    v_member := NULL;
    IF length(v_phone) <> 10 THEN
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
    v_counts := jsonb_set(v_counts, ARRAY[v_result], to_jsonb(COALESCE((v_counts ->> v_result)::int, 0) + 1));
  END LOOP;
  IF v_counts <> '{}'::jsonb THEN
    PERFORM crm_private.write_audit_log('crm.visit_companions_family', v_visit.client_id,
      jsonb_build_object('visit_form_id', NEW.id, 'counts', v_counts));
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER visit_forms_link_companions AFTER INSERT ON public.visit_forms
FOR EACH ROW EXECUTE FUNCTION crm_private.link_visit_companions();

-- Staff actions on families: the original client-write rule (active staff; super admin or the
-- client's branch staff for changes to another branch's client).
CREATE FUNCTION crm_private.assert_can_edit_client(p_client uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_branch uuid;
BEGIN
  IF public.current_user_role() IS NULL THEN
    RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT last_branch_id INTO v_branch FROM public.clients WHERE client_id = p_client;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.is_super_admin() AND v_branch IS NOT NULL AND NOT public.is_branch_staff(v_branch) THEN
    RAISE EXCEPTION 'you may only change families of your own branch''s clients' USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;

CREATE FUNCTION public.add_client_to_family(p_client_id uuid, p_member_client_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result text;
BEGIN
  PERFORM crm_private.assert_can_edit_client(p_client_id);
  PERFORM crm_private.assert_can_edit_client(p_member_client_id);
  v_result := crm_private.join_family(p_client_id, p_member_client_id, public.current_crm_user_id());
  IF v_result = 'in_other_family' THEN
    RAISE EXCEPTION 'this person already belongs to another family' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM crm_private.write_audit_log('crm.add_client_to_family', p_client_id,
    jsonb_build_object('member_client_id', p_member_client_id, 'result', v_result));
  RETURN v_result;
END
$$;

CREATE FUNCTION public.remove_client_from_family(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_household uuid;
BEGIN
  PERFORM crm_private.assert_can_edit_client(p_client_id);
  SELECT household_id INTO v_household FROM public.clients WHERE client_id = p_client_id FOR UPDATE;
  IF v_household IS NULL THEN RETURN; END IF;
  UPDATE public.clients SET household_id = NULL WHERE client_id = p_client_id;
  PERFORM crm_private.write_audit_log('crm.remove_client_from_family', p_client_id, jsonb_build_object('household_id', v_household));
END
$$;

-- ---------------------------------------------------------------------------
-- Derived identity columns
-- ---------------------------------------------------------------------------

-- The owner's columns, derived (not stored twice):
--   referral_id         own MKREF for a main client; the referrer's MKREF for a referred person
--   referral_person_id  own MKREF for a referred person; NULL for a main client
--   relation            'Main client', or the referral relation
CREATE VIEW public.client_identity WITH (security_invoker = true) AS
SELECT
  c.client_id,
  c.client_code,
  c.referral_code,
  h.household_code,
  c.household_id,
  c.referred_by_client_id,
  referrer.client_code AS referred_by_client_code,
  referrer.primary_name AS referred_by_name,
  CASE WHEN c.total_purchase_visits > 0 THEN 'purchased'
       WHEN c.total_visits > 0 THEN 'visited'
       ELSE c.lifecycle_stage END AS lifecycle_stage,
  COALESCE(referrer.referral_code, c.referral_code) AS referral_id,
  CASE WHEN c.referred_by_client_id IS NULL THEN NULL ELSE c.referral_code END AS referral_person_id,
  CASE WHEN c.referred_by_client_id IS NULL THEN 'Main client' ELSE COALESCE(c.referral_relation, 'Referral') END AS relation
FROM public.clients c
LEFT JOIN public.households h ON h.id = c.household_id
LEFT JOIN public.clients referrer ON referrer.client_id = c.referred_by_client_id;
REVOKE ALL ON public.client_identity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_identity TO authenticated;

-- ---------------------------------------------------------------------------
-- Changed original functions
-- ---------------------------------------------------------------------------

-- Referral conversion: a 'lead' client (created for the referral itself) is not a conversion.
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
    JOIN "public"."clients" matched ON matched.client_id = phones.client_id
    WHERE calling.converted_client_id IS NULL
      AND matched.lifecycle_stage <> 'lead'
      AND ("public"."is_super_admin"() OR "public"."is_branch_staff"(referral.branch_id))
  ), updated AS (
    UPDATE "public"."referral_calling" calling
    SET converted_client_id = matches.client_id, status = 'CONVERTED TO CLIENT', next_followup_date = NULL
    FROM matches WHERE calling.id = matches.id
    RETURNING calling.id
  ) SELECT count(*)::integer INTO updated_count FROM updated;
  PERFORM "crm_private"."write_audit_log"('crm.reconcile_referral_calling_conversions', NULL, jsonb_build_object('updated_count', updated_count));
  RETURN updated_count;
END; $function$;

-- Queue registration moves a 'lead' client to 'engaged' and treats them as new.
CREATE FUNCTION crm_private.engage_client(p_client_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_changed integer;
BEGIN
  UPDATE public.clients SET lifecycle_stage = 'engaged' WHERE client_id = p_client_id AND lifecycle_stage = 'lead';
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed > 0;
END
$$;

-- create_entry_queue: as the original, plus the two marked changes.
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

-- search_clients: MKC / MKF / MKREF codes match exactly and rank first; a code-shaped query is
-- never a phone search. An MKF code lists the whole family. Otherwise the original behaviour.
DROP FUNCTION public.search_clients(text, integer);
CREATE FUNCTION public.search_clients(search_text text, result_limit integer DEFAULT 8)
 RETURNS TABLE(client_id uuid, primary_name text, primary_phone text, last_visit_date timestamp with time zone, last_branch_name text, matched_phone text, total_visits integer, last_buy_status text, client_code text, household_code text, referral_code text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH input AS (
    SELECT trim(search_text) AS value,
           regexp_replace(search_text, '[^0-9]', '', 'g') AS digits,
           (regexp_match(upper(regexp_replace(trim(search_text), '\s+', '', 'g')), '^(MKC|MKF|MKREF)-?([0-9]+)$')) AS code
  )
  SELECT c.client_id, c.primary_name::text, c.primary_phone::text, c.last_visit_date, b.name::text, p.phone::text, c.total_visits, c.last_buy_status::text,
         c.client_code, h.household_code, c.referral_code
  FROM "public"."clients" c
  LEFT JOIN "public"."branches" b ON b.id = c.last_branch_id
  LEFT JOIN "public"."households" h ON h.id = c.household_id
  CROSS JOIN input
  LEFT JOIN LATERAL (SELECT pi.phone FROM "public"."client_phone_index" pi WHERE input.code IS NULL AND pi.client_id = c.client_id AND input.digits <> '' AND pi.phone LIKE '%' || right(input.digits, 10) || '%' ORDER BY (pi.phone = right(input.digits, 10)) DESC, pi.phone DESC LIMIT 1) p ON true
  WHERE "public"."current_user_role"() IS NOT NULL AND (
    CASE
      WHEN input.code IS NOT NULL THEN
        (input.code[1] = 'MKC' AND c.client_code = 'MKC-' || ltrim(input.code[2], '0'))
        OR (input.code[1] = 'MKF' AND h.household_code = 'MKF-' || ltrim(input.code[2], '0'))
        OR (input.code[1] = 'MKREF' AND c.referral_code = 'MKREF-' || ltrim(input.code[2], '0'))
      ELSE (length(input.digits) >= 3 AND p.phone IS NOT NULL)
        OR (length(input.value) >= 3 AND (c.primary_name ILIKE '%' || input.value || '%' OR EXISTS (SELECT 1 FROM unnest(c.other_names) name WHERE name ILIKE '%' || input.value || '%')))
    END)
  ORDER BY (p.phone = right(input.digits, 10)) DESC NULLS LAST, c.last_visit_date DESC NULLS LAST, c.primary_name, c.client_id
  LIMIT LEAST(GREATEST(result_limit, 1), 20);
$function$;
REVOKE ALL ON FUNCTION public.search_clients(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_clients(text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_referral_code(), crm_private.find_or_create_known_client(text, text, uuid, text, uuid, text),
  crm_private.link_referral_client(), crm_private.link_lead_client(), crm_private.mark_client_visited(),
  crm_private.join_family(uuid, uuid, uuid), crm_private.link_visit_companions(), crm_private.engage_client(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm_private.engage_client(uuid) TO authenticated;
REVOKE ALL ON FUNCTION crm_private.protect_client_identity(), crm_private.assert_can_edit_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm_private.protect_client_identity(), crm_private.assert_can_edit_client(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.add_client_to_family(uuid, uuid), public.remove_client_from_family(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_client_to_family(uuid, uuid), public.remove_client_from_family(uuid) TO authenticated;

-- Existing leads (first contact already happened) get their client now. Their updated_at is
-- history and stays as it is.
ALTER TABLE public.leads DISABLE TRIGGER leads_updated_at;
DO $backfill$
DECLARE
  v_lead record;
  v_found record;
BEGIN
  FOR v_lead IN SELECT * FROM public.leads WHERE client_id IS NULL ORDER BY created_at, id LOOP
    SELECT * INTO v_found FROM crm_private.find_or_create_known_client(
      COALESCE(NULLIF(btrim(v_lead.name), ''), 'LEAD ' || v_lead.phone_number), v_lead.phone_number, v_lead.branch_id, 'lead');
    UPDATE public.leads SET client_id = v_found.client_id WHERE id = v_lead.id;
  END LOOP;
END
$backfill$;
ALTER TABLE public.leads ENABLE TRIGGER leads_updated_at;
