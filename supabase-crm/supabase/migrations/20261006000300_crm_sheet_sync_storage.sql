-- Google Sheet <-> CRM sync, storage (owner-approved design 2026-10-06,
-- https://claude.ai/artifact/MBHPPoH1pRbPJF9jExCL2D; plan docs/superpowers/plans/2026-10-06-crm-sheet-sync.md).
--
-- - New columns the Sheet's FAMILY DATA and REFERRALS tabs carry.
-- - Private sync state (crm_private, never reachable from the web app):
--     sheet_sync_rows    per Sheet row: its key, fingerprint, the CRM record it maps to, and the
--                        values the Sheet last had (the "base" a web-app change is checked against)
--     sheet_sync_outbox  web-app changes waiting for the Sheet (one pending entry per record)
--     sheet_sync_runs    one row per sync run, with counts
--     sheet_sync_errors  one row per failed Sheet row (tab, key, reason code; never values)
-- - One sheet-shaped view per tab: the tab's header names as column names, values formatted
--   as the Sheet stores them (upper-case branch / staff names, yyyy-MM-dd dates,
--   yyyy-MM-dd HH:mm:ss times, comma-separated lists). _record_id and _row_key are not Sheet
--   columns.

-- ---------------------------------------------------------------------------
-- New columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.households ADD COLUMN main_client_id uuid REFERENCES public.clients (client_id);
ALTER TABLE public.clients
  ADD COLUMN household_relation character varying(120),
  ADD COLUMN marketing_message character varying(120),
  ADD COLUMN communication_preference character varying(120);
-- The Sheet's REFERRALS tab names the referrer; a referrer the CRM cannot identify by name
-- keeps the name only.
ALTER TABLE public.referrals
  ADD COLUMN given_by_name character varying(200),
  ALTER COLUMN given_by_client_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Sync state
-- ---------------------------------------------------------------------------

CREATE FUNCTION crm_private.sheet_tabs()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['CLIENT DATABASE MASTER', 'WALKIN DATASET', 'FAMILY DATA', 'REFERRALS',
               'REFERRALS CALLING MASTER', 'REFERRALS HISTORY']
$$;

CREATE TABLE crm_private.sheet_sync_rows (
  tab text NOT NULL CHECK (tab = ANY (crm_private.sheet_tabs())),
  row_key text NOT NULL CHECK (char_length(row_key) BETWEEN 1 AND 120),
  record_id uuid,
  content_hash text CHECK (content_hash IS NULL OR char_length(content_hash) <= 128),
  sheet_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(sheet_values) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tab, row_key)
);
CREATE INDEX sheet_sync_rows_record_idx ON crm_private.sheet_sync_rows (tab, record_id);

CREATE TABLE crm_private.sheet_sync_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tab text NOT NULL CHECK (tab = ANY (crm_private.sheet_tabs())),
  record_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'no_change', 'sheet_won', 'superseded_by_sheet', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  reason text CHECK (reason IS NULL OR reason ~ '^[a-z_]{1,60}$'),
  -- What the last pull handed to the Sheet: the row key and the cells (confirmed by ack).
  sent_key text,
  sent_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sheet_sync_outbox_pending_key ON crm_private.sheet_sync_outbox (tab, record_id) WHERE status = 'pending';
CREATE INDEX sheet_sync_outbox_status_idx ON crm_private.sheet_sync_outbox (status, id);

CREATE TABLE crm_private.sheet_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('live', 'dry_run', 'import')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'finished', 'failed')),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object'),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX sheet_sync_runs_started_idx ON crm_private.sheet_sync_runs (started_at DESC);

CREATE TABLE crm_private.sheet_sync_errors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid REFERENCES crm_private.sheet_sync_runs (id) ON DELETE SET NULL,
  tab text NOT NULL CHECK (tab = ANY (crm_private.sheet_tabs())),
  row_key text NOT NULL,
  reason text NOT NULL CHECK (reason ~ '^[a-z_]{1,60}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX sheet_sync_errors_open_key ON crm_private.sheet_sync_errors (tab, row_key) WHERE resolved_at IS NULL;

REVOKE ALL ON crm_private.sheet_sync_rows, crm_private.sheet_sync_outbox, crm_private.sheet_sync_runs,
  crm_private.sheet_sync_errors FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Formatting helpers (the Sheet's way of writing values)
-- ---------------------------------------------------------------------------

CREATE FUNCTION crm_private.sheet_date(p_value date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT COALESCE(to_char(p_value, 'YYYY-MM-DD'), '') $$;

CREATE FUNCTION crm_private.sheet_day(p_value timestamptz)
RETURNS text LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT COALESCE(to_char(p_value AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD'), '') $$;

CREATE FUNCTION crm_private.sheet_time(p_value timestamptz)
RETURNS text LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT COALESCE(to_char(p_value AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS'), '') $$;

CREATE FUNCTION crm_private.sheet_list(p_value text[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT COALESCE(array_to_string(p_value, ', '), '') $$;

CREATE FUNCTION crm_private.sheet_list(p_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE jsonb_typeof(p_value)
    WHEN 'array' THEN COALESCE((SELECT string_agg(item, ', ') FROM jsonb_array_elements_text(p_value) AS item), '')
    WHEN 'string' THEN p_value #>> '{}'
    ELSE '' END
$$;

CREATE FUNCTION crm_private.sheet_yes_no(p_value boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT CASE p_value WHEN true THEN 'YES' WHEN false THEN 'NO' ELSE '' END $$;

-- The Sheet's mergeOtherChoice_: an OTHER choice shows its typed value.
CREATE FUNCTION crm_private.sheet_other(p_main text, p_other text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_main, '')), '') IS NULL THEN upper(btrim(COALESCE(p_other, '')))
    WHEN NULLIF(btrim(COALESCE(p_other, '')), '') IS NULL THEN upper(btrim(p_main))
    WHEN upper(btrim(p_main)) LIKE 'OTHER%' THEN upper(btrim(p_other))
    ELSE upper(btrim(p_main)) END
$$;

-- Branch names: the Sheet writes ZAVERI BAZAR, the CRM Zaveri Bazaar.
CREATE FUNCTION crm_private.branch_match_key(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT replace(replace(regexp_replace(upper(COALESCE(p_name, '')), '[^A-Z]', '', 'g'), 'BAZAAR', 'BAZAR'), 'ZAVARI', 'ZAVERI')
$$;

CREATE FUNCTION crm_private.sheet_branch(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT replace(upper(btrim(COALESCE(p_name, ''))), 'BAZAAR', 'BAZAR') $$;

-- The Sheet's referralKey_ (Code.gs) and the sync's hashed row keys (prefix + first 24 hex
-- digits of SHA-256, upper case; the Apps Script computes the same).
CREATE FUNCTION crm_private.sheet_referral_key(p_name text, p_number text, p_given_by text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  WITH v AS (
    SELECT CASE WHEN length(d) > 0 THEN right(d, 10) ELSE '' END AS phone,
           regexp_replace(upper(regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g')), '[^A-Z0-9]', '', 'g') AS name,
           left(regexp_replace(upper(regexp_replace(btrim(COALESCE(p_given_by, '')), '\s+', ' ', 'g')), '[^A-Z0-9]', '', 'g'), 20) AS by_name
    FROM (SELECT regexp_replace(COALESCE(p_number, ''), '[^0-9]', '', 'g') AS d) digits
  )
  SELECT COALESCE(NULLIF(phone, ''), NULLIF(name, ''), 'REF') || '|' || name || '|' || by_name FROM v
$$;

CREATE FUNCTION crm_private.sheet_hashed_key(p_prefix text, p_raw text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT p_prefix || '-' || upper(left(encode(extensions.digest(convert_to(p_raw, 'UTF8'), 'sha256'), 'hex'), 24)) $$;

-- ---------------------------------------------------------------------------
-- Sheet-shaped views
-- ---------------------------------------------------------------------------

CREATE VIEW crm_private.sheet_client_database_master AS
SELECT
  c.client_id AS _record_id,
  c.client_code AS _row_key,
  c.client_code AS "CLIENT ID",
  COALESCE(crm_private.phone_key(c.primary_phone), crm_private.phone_key(c.billing_phone), '') AS "PHONE KEY",
  COALESCE(crm_private.name_key(c.primary_name), '') AS "NAME KEY",
  COALESCE(c.primary_name, '') AS "PRIMARY NAME",
  crm_private.sheet_list(c.other_names) AS "OTHER NAMES",
  COALESCE(c.primary_phone, '') AS "PRIMARY PHONE",
  COALESCE(c.secondary_phone, '') AS "SECONDARY PHONE",
  COALESCE(c.billing_phone, '') AS "BILLING PHONE",
  crm_private.sheet_list(c.other_known_phones) AS "OTHER KNOWN PHONES",
  COALESCE(c.gender, '') AS "GENDER",
  COALESCE(c.country, '') AS "COUNTRY",
  COALESCE(c.state, '') AS "STATE",
  COALESCE(c.city, '') AS "CITY",
  COALESCE(c.city_other, '') AS "CITY OTHER",
  COALESCE(c.pincode, '') AS "PINCODE",
  COALESCE(c.address, '') AS "ADDRESS",
  COALESCE(c.community, '') AS "COMMUNITY",
  COALESCE(c.community_other, '') AS "COMMUNITY OTHER",
  crm_private.sheet_date(c.dob) AS "DOB",
  crm_private.sheet_date(c.anniversary) AS "ANNIVERSARY",
  COALESCE(c.beverage, '') AS "BEVERAGE",
  COALESCE(c.sugar, '') AS "SUGAR",
  COALESCE(c.snack, '') AS "SNACK",
  crm_private.sheet_list(c.gift_history) AS "GIFT HISTORY",
  crm_private.sheet_day(c.first_visit_date) AS "FIRST VISIT DATE",
  crm_private.sheet_day(c.last_visit_date) AS "LAST VISIT DATE",
  COALESCE(c.total_visits, 0)::text AS "TOTAL VISITS",
  COALESCE(c.total_purchase_visits, 0)::text AS "TOTAL PURCHASE VISITS",
  COALESCE(c.total_non_purchase_visits, 0)::text AS "TOTAL NON PURCHASE VISITS",
  COALESCE(c.total_repair_visits, 0)::text AS "TOTAL REPAIR VISITS",
  COALESCE(c.total_order_visits, 0)::text AS "TOTAL ORDER VISITS",
  COALESCE(c.last_buy_status::text, '') AS "LAST BUY STATUS",
  crm_private.sheet_branch(b.name) AS "LAST BRANCH",
  upper(COALESCE(c.last_crm_name, '')) AS "LAST CRM",
  upper(COALESCE(sp.name, '')) AS "LAST SALESPERSON",
  COALESCE(c.last_remark, '') AS "LAST REMARK",
  COALESCE(c.last_product_requirement, '') AS "LAST PRODUCT REQUIREMENT",
  crm_private.sheet_list(c.last_seen_categories) AS "LAST SEEN CATEGORIES",
  crm_private.sheet_list(c.last_bought_categories) AS "LAST BOUGHT CATEGORIES",
  crm_private.sheet_list(c.last_order_categories) AS "LAST ORDER CATEGORIES",
  upper(COALESCE(c.client_potential_category, '')) AS "CLIENT POTENTIAL CATEGORY",
  COALESCE(c.high_potential_reason, '') AS "HIGH POTENTIAL REASON",
  COALESCE(c.instagram_status, '') AS "INSTAGRAM STATUS",
  COALESCE(c.google_review_status, '') AS "GOOGLE REVIEW STATUS",
  COALESCE(c.testimonial_status, '') AS "TESTIMONIAL STATUS",
  COALESCE(c.referral_status, '') AS "REFERRAL STATUS",
  crm_private.sheet_date(c.next_visit_date) AS "NEXT VISIT DATE",
  crm_private.sheet_time(c.profile_updated_at) AS "PROFILE LAST UPDATED ON",
  upper(COALESCE(editor.name, '')) AS "PROFILE UPDATED BY"
FROM public.clients c
LEFT JOIN public.branches b ON b.id = c.last_branch_id
LEFT JOIN public.users sp ON sp.id = c.last_salesperson_id
LEFT JOIN public.users editor ON editor.id = c.profile_updated_by;

CREATE VIEW crm_private.sheet_walkin_dataset AS
SELECT
  t.id AS _record_id,
  upper(t.reference_number) AS _row_key,
  crm_private.sheet_time(t.created_at) AS "TIMESTAMP",
  c.client_code AS "CRM CLIENT ID",
  COALESCE(to_char(t.event_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'), '') AS "CLIENT VISIT DATE",
  upper(COALESCE(f.client_type, '')) AS "CLIENT TYPE",
  upper(COALESCE(f.source_of_lead, '')) AS "SOURCE OF LEAD",
  upper(COALESCE(f.source_of_lead_other, '')) AS "SOURCE (OTHER)",
  upper(COALESCE(f.reference_name, '')) AS "REFERENCE NAME",
  COALESCE(f.reference_phone, '') AS "REFERENCE PHONE",
  crm_private.sheet_branch(b.name) AS "BRANCH",
  upper(COALESCE(t.crm_name, '')) AS "CRM NAME",
  upper(COALESCE(c.primary_name, '')) AS "CLIENT NAME",
  upper(COALESCE(c.gender, '')) AS "GENDER",
  COALESCE(c.primary_phone, '') AS "CLIENT PHONE",
  COALESCE(c.billing_phone, '') AS "BILLING PHONE",
  upper(COALESCE(c.country, '')) AS "COUNTRY",
  upper(COALESCE(c.state, '')) AS "STATE",
  upper(COALESCE(c.city, '')) AS "CITY",
  upper(COALESCE(c.city_other, '')) AS "CITY (OTHER)",
  COALESCE(c.pincode, '') AS "PINCODE",
  upper(COALESCE(c.address, '')) AS "ADDRESS",
  upper(COALESCE(c.community, '')) AS "COMMUNITY",
  upper(COALESCE(c.community_other, '')) AS "COMMUNITY (OTHER)",
  crm_private.sheet_date(c.dob) AS "DOB",
  crm_private.sheet_date(c.anniversary) AS "ANNIVERSARY",
  upper(COALESCE(f.additional_fields ->> 'salesperson', sp.name, '')) AS "SALESPERSON",
  CASE WHEN jsonb_typeof(f.companions) = 'array' THEN jsonb_array_length(f.companions)::text ELSE '' END AS "COMPANIONS COUNT",
  upper(COALESCE(f.companions -> 0 ->> 'name', '')) AS "COMPANION 1 NAME", COALESCE(f.companions -> 0 ->> 'mobile', f.companions -> 0 ->> 'phone', '') AS "COMPANION 1 MOBILE", upper(COALESCE(f.companions -> 0 ->> 'relation', '')) AS "COMPANION 1 RELATION",
  upper(COALESCE(f.companions -> 1 ->> 'name', '')) AS "COMPANION 2 NAME", COALESCE(f.companions -> 1 ->> 'mobile', f.companions -> 1 ->> 'phone', '') AS "COMPANION 2 MOBILE", upper(COALESCE(f.companions -> 1 ->> 'relation', '')) AS "COMPANION 2 RELATION",
  upper(COALESCE(f.companions -> 2 ->> 'name', '')) AS "COMPANION 3 NAME", COALESCE(f.companions -> 2 ->> 'mobile', f.companions -> 2 ->> 'phone', '') AS "COMPANION 3 MOBILE", upper(COALESCE(f.companions -> 2 ->> 'relation', '')) AS "COMPANION 3 RELATION",
  upper(COALESCE(f.companions -> 3 ->> 'name', '')) AS "COMPANION 4 NAME", COALESCE(f.companions -> 3 ->> 'mobile', f.companions -> 3 ->> 'phone', '') AS "COMPANION 4 MOBILE", upper(COALESCE(f.companions -> 3 ->> 'relation', '')) AS "COMPANION 4 RELATION",
  upper(COALESCE(f.companions -> 4 ->> 'name', '')) AS "COMPANION 5 NAME", COALESCE(f.companions -> 4 ->> 'mobile', f.companions -> 4 ->> 'phone', '') AS "COMPANION 5 MOBILE", upper(COALESCE(f.companions -> 4 ->> 'relation', '')) AS "COMPANION 5 RELATION",
  upper(COALESCE(f.companions -> 5 ->> 'name', '')) AS "COMPANION 6 NAME", COALESCE(f.companions -> 5 ->> 'mobile', f.companions -> 5 ->> 'phone', '') AS "COMPANION 6 MOBILE", upper(COALESCE(f.companions -> 5 ->> 'relation', '')) AS "COMPANION 6 RELATION",
  upper(COALESCE(f.companions -> 6 ->> 'name', '')) AS "COMPANION 7 NAME", COALESCE(f.companions -> 6 ->> 'mobile', f.companions -> 6 ->> 'phone', '') AS "COMPANION 7 MOBILE", upper(COALESCE(f.companions -> 6 ->> 'relation', '')) AS "COMPANION 7 RELATION",
  upper(COALESCE(f.companions -> 7 ->> 'name', '')) AS "COMPANION 8 NAME", COALESCE(f.companions -> 7 ->> 'mobile', f.companions -> 7 ->> 'phone', '') AS "COMPANION 8 MOBILE", upper(COALESCE(f.companions -> 7 ->> 'relation', '')) AS "COMPANION 8 RELATION",
  upper(COALESCE(f.companions -> 8 ->> 'name', '')) AS "COMPANION 9 NAME", COALESCE(f.companions -> 8 ->> 'mobile', f.companions -> 8 ->> 'phone', '') AS "COMPANION 9 MOBILE", upper(COALESCE(f.companions -> 8 ->> 'relation', '')) AS "COMPANION 9 RELATION",
  upper(COALESCE(f.companions -> 9 ->> 'name', '')) AS "COMPANION 10 NAME", COALESCE(f.companions -> 9 ->> 'mobile', f.companions -> 9 ->> 'phone', '') AS "COMPANION 10 MOBILE", upper(COALESCE(f.companions -> 9 ->> 'relation', '')) AS "COMPANION 10 RELATION",
  COALESCE(f.additional_fields ->> 'visit_status', t.buy_status::text, '') AS "CLIENT BOUGHT ANY PRODUCT?",
  upper(crm_private.sheet_list(f.not_bought_reasons)) AS "NOT BOUGHT REASONS",
  upper(COALESCE(f.not_bought_other, '')) AS "NOT BOUGHT REASON (OTHER TEXT)",
  upper(COALESCE(f.repair_or_order_approach, '')) AS "REPAIR/ORDER APPROACH",
  upper(COALESCE(f.category_details ->> 'new_things_choice', '')) AS "NEW THINGS CHOICE",
  upper(COALESCE(f.category_details ->> 'new_things_salesperson', '')) AS "NEW THINGS SALESPERSON",
  upper(crm_private.sheet_list(t.seen_categories)) AS "SEEN CATEGORIES",
  COALESCE(f.category_details ->> 'seen_count', '') AS "SEEN PRODUCTS COUNT",
  upper(crm_private.sheet_list(f.category_details -> 'seen_tags')) AS "SEEN TAGS (COMBINED)",
  upper(COALESCE(f.category_details ->> 'seen_other_text', '')) AS "SEEN OTHER TEXT",
  upper(crm_private.sheet_list(t.bought_categories)) AS "BOUGHT CATEGORIES",
  COALESCE(f.category_details ->> 'bought_count', '') AS "BOUGHT PRODUCTS COUNT",
  upper(crm_private.sheet_list(f.category_details -> 'bought_tags')) AS "BOUGHT TAGS (COMBINED)",
  upper(COALESCE(f.category_details ->> 'bought_other_text', '')) AS "BOUGHT OTHER TEXT",
  upper(crm_private.sheet_list(t.order_categories)) AS "ORDER/NEW THINGS CATEGORIES",
  COALESCE(f.category_details ->> 'order_count', '') AS "ORDER/NEW THINGS COUNT",
  upper(crm_private.sheet_list(f.category_details -> 'order_tags')) AS "ORDER/NEW THINGS TAGS (COMBINED)",
  upper(COALESCE(f.category_details ->> 'order_other_text', '')) AS "ORDER/NEW THINGS OTHER TEXT",
  upper(COALESCE(f.category_details ->> 'other_order', '')) AS "OTHER ORDER",
  upper(COALESCE(f.marketing_message_sent, '')) AS "MARKETING MESSAGE",
  crm_private.sheet_yes_no(f.instagram_asked) AS "INSTAGRAM FOLLOW ASKED",
  upper(COALESCE(f.instagram_no_reason, '')) AS "INSTAGRAM FOLLOW - NO REASON",
  COALESCE(f.instagram_proof_url, '') AS "INSTAGRAM FOLLOW - PROOF URL",
  crm_private.sheet_yes_no(f.google_review_asked) AS "GOOGLE REVIEW ASKED",
  upper(COALESCE(f.google_review_no_reason, '')) AS "GOOGLE REVIEW - NO REASON",
  COALESCE(f.google_review_proof_url, '') AS "GOOGLE REVIEW - SCREENSHOT URL",
  crm_private.sheet_yes_no(f.testimonial_asked) AS "TESTIMONIAL ASKED",
  upper(COALESCE(f.testimonial_no_reason, '')) AS "TESTIMONIAL - NO REASON",
  COALESCE(f.testimonial_proof_url, '') AS "TESTIMONIAL - MEDIA URL",
  crm_private.sheet_yes_no(f.feedback_form_asked) AS "FEEDBACK FORM ASKED",
  upper(COALESCE(f.feedback_form_no_reason, '')) AS "FEEDBACK FORM - NO REASON",
  COALESCE(f.feedback_form_proof_url, '') AS "FEEDBACK FORM - SCREENSHOT URL",
  crm_private.sheet_yes_no(f.thank_you_note_asked) AS "THANK-YOU NOTE GIVEN",
  upper(COALESCE(f.thank_you_note_no_reason, '')) AS "THANK-YOU NOTE - NO REASON",
  COALESCE(f.thank_you_note_proof_url, '') AS "THANK-YOU NOTE - PHOTO URL",
  crm_private.sheet_yes_no(f.referrals_asked) AS "REFERRALS ASKED",
  upper(COALESCE(f.referrals_no_reason, '')) AS "REFERRALS - NO REASON",
  COALESCE(f.referrals_proof_url, '') AS "REFERRALS - PROOF URL",
  upper(COALESCE(c.beverage, '')) AS "BEVERAGE",
  upper(COALESCE(f.additional_fields ->> 'beverage_other', '')) AS "BEVERAGE (OTHER)",
  upper(COALESCE(c.sugar, '')) AS "SUGAR",
  upper(COALESCE(f.additional_fields ->> 'sugar_other', '')) AS "SUGAR (OTHER)",
  upper(COALESCE(c.snack, '')) AS "SNACK",
  upper(COALESCE(f.additional_fields ->> 'snack_other', '')) AS "SNACK (OTHER)",
  upper(COALESCE(f.additional_fields ->> 'gift_given', '')) AS "GIFT GIVEN",
  upper(COALESCE(f.additional_fields ->> 'gift_other', '')) AS "GIFT (OTHER)",
  crm_private.sheet_date(c.next_visit_date) AS "NEXT VISIT DATE",
  upper(COALESCE(c.client_potential_category, '')) AS "CLIENT POTENTIAL CATEGORY",
  upper(COALESCE(c.high_potential_reason, '')) AS "WHY IS THIS CLIENT A HIGH-POTENTIAL BUYER?",
  upper(COALESCE(t.remark, '')) AS "REMARK",
  '' AS "UPLOAD",
  upper(COALESCE(t.product_requirement, '')) AS "REQUIREMENTS OF CLIENT",
  upper(COALESCE(f.additional_fields ->> 'other_store_visit', '')) AS "IF CLIENT WANTS TO VISIT ANOTHER STORE",
  upper(crm_private.sheet_list(f.additional_fields -> 'more_design_categories')) AS "WHICH CATEGORIES CLIENT WANT TO SEE MORE",
  upper(COALESCE(f.occupation, '')) AS "OCCUPATION",
  upper(COALESCE(f.occupation_other, '')) AS "OCCUPATION (OTHER)",
  upper(COALESCE(f.bridal_or_non_bridal, '')) AS "BRIDAL / NON BRIDAL",
  COALESCE(f.wedding_month::text, '') AS "MONTH OF WEDDING",
  COALESCE(f.wedding_year::text, '') AS "YEAR OF WEDDING",
  upper(COALESCE(f.communication_preference, '')) AS "COMMUNICATION PREFERENCE",
  -- The Sheet's calculated columns, written only where the Sheet has no formula.
  COALESCE(f.additional_fields ->> 'visit_status', t.buy_status::text, '') AS "FINAL STATUS",
  crm_private.sheet_other(f.source_of_lead, f.source_of_lead_other) AS "SOURCE",
  crm_private.sheet_other(c.city, c.city_other) AS "CITY (FINAL)",
  upper(crm_private.sheet_list(f.not_bought_reasons)) AS "NOT BOUGHT REASONS (FINAL)",
  upper(crm_private.sheet_list(t.seen_categories)) AS "SEEN CATEGORIES (FINAL)",
  upper(crm_private.sheet_list(t.bought_categories)) AS "BOUGHT CATEGORIES(FINAL)",
  upper(crm_private.sheet_list(t.order_categories)) AS "OTHER/ NEW PRODUCTS",
  crm_private.sheet_other(c.beverage, f.additional_fields ->> 'beverage_other') AS "BEVERAGE (FINAL)",
  crm_private.sheet_other(c.sugar, f.additional_fields ->> 'sugar_other') AS "SUGAR (FINAL)",
  crm_private.sheet_other(c.snack, f.additional_fields ->> 'snack_other') AS "SNACK (FINAL)",
  crm_private.sheet_other(f.additional_fields ->> 'gift_given', f.additional_fields ->> 'gift_other') AS "GIFT GIVEN (FINAL)",
  upper(t.reference_number) AS "REFERENCE NUMBER",
  COALESCE(to_char(t.event_date AT TIME ZONE 'Asia/Kolkata', 'DD/MM/YYYY'), '') AS "DATE",
  COALESCE('Week-' || to_char(t.event_date AT TIME ZONE 'Asia/Kolkata', 'IW')::int::text, '') AS "WEEK",
  CASE WHEN c.primary_phone ~ '^[0-9]{10}$' THEN '91' || c.primary_phone ELSE COALESCE(c.primary_phone, '') END AS "FINAL NUMBER",
  COALESCE(to_char(t.event_date AT TIME ZONE 'Asia/Kolkata', 'Mon'), '') AS "MONTH",
  '' AS "VISIT FINAL STATUS",
  COALESCE(h.household_code, '') AS "FAMILY ID"
FROM public.client_timeline t
JOIN public.clients c ON c.client_id = t.client_id
LEFT JOIN public.visit_forms f ON f.client_timeline_id = t.id
LEFT JOIN public.branches b ON b.id = t.branch_id
LEFT JOIN public.users sp ON sp.id = t.salesperson_id
LEFT JOIN public.households h ON h.id = c.household_id;

CREATE VIEW crm_private.sheet_family_data AS
SELECT
  c.client_id AS _record_id,
  c.client_code AS _row_key,
  crm_private.sheet_time(h.created_at) AS "TIMESTAMP",
  '' AS "CRM NAME",
  '' AS "SALES PERSON NAME",
  COALESCE(main.client_code, first_member.client_code, '') AS "MAIN CLIENT ID",
  c.client_code AS "CLIENT ID",
  COALESCE(h.household_code, '') AS "FAMILY ID",
  upper(COALESCE(c.primary_name, '')) AS "FAMILY",
  CASE WHEN c.primary_phone ~ '^[0-9]{10}$' THEN '91' || c.primary_phone ELSE COALESCE(c.primary_phone, '') END AS "NUMBER",
  CASE WHEN c.client_id = COALESCE(main.client_id, first_member.client_id) THEN 'MAIN CLIENT'
       ELSE upper(COALESCE(c.household_relation, '')) END AS "RELATION",
  upper(COALESCE(c.marketing_message, '')) AS "MARKETING MESSAGE",
  upper(COALESCE(c.communication_preference, '')) AS "COMMUNICATION PREFERENCE"
FROM public.clients c
JOIN public.households h ON h.id = c.household_id
LEFT JOIN public.clients main ON main.client_id = h.main_client_id
LEFT JOIN LATERAL (
  SELECT m.client_id, m.client_code FROM public.clients m
  WHERE m.household_id = h.id ORDER BY m.client_code, m.client_id LIMIT 1
) first_member ON true;

CREATE VIEW crm_private.sheet_referral_parts AS
SELECT
  r.id AS referral_id,
  upper(COALESCE(NULLIF(btrim(r.given_by_name), ''), giver.primary_name, '')) AS given_by,
  crm_private.sheet_referral_key(r.referral_name, r.referral_number,
    COALESCE(NULLIF(btrim(r.given_by_name), ''), giver.primary_name, '')) AS raw_key
FROM public.referrals r
LEFT JOIN public.clients giver ON giver.client_id = r.given_by_client_id;

CREATE VIEW crm_private.sheet_referrals AS
SELECT
  r.id AS _record_id,
  crm_private.sheet_hashed_key('RK', p.raw_key) AS _row_key,
  crm_private.sheet_time(r.created_at) AS "TIMESTAMP",
  upper(COALESCE(r.crm_name, '')) AS "CRM NAME",
  upper(COALESCE(sp.name, '')) AS "SALES PERSON NAME",
  p.given_by AS "REFERENCE GIVEN BY CLIENT NAME",
  upper(btrim(r.referral_name)) AS "REFERRAL NAME",
  regexp_replace(COALESCE(r.referral_number, ''), '[^0-9]', '', 'g') AS "REFERRAL NUMBER"
FROM public.referrals r
JOIN crm_private.sheet_referral_parts p ON p.referral_id = r.id
LEFT JOIN public.users sp ON sp.id = r.salesperson_id;

CREATE VIEW crm_private.sheet_referrals_calling_master AS
SELECT
  rc.id AS _record_id,
  crm_private.sheet_hashed_key('RK', p.raw_key) AS _row_key,
  crm_private.sheet_time(rc.created_at) AS "CREATED ON",
  crm_private.sheet_time(GREATEST(rc.created_at, last_history.created_at)) AS "UPDATED ON",
  p.raw_key AS "REFERRAL KEY",
  'CRM WEB APP' AS "SOURCE",
  upper(COALESCE(r.crm_name, '')) AS "CRM NAME",
  upper(COALESCE(sp.name, '')) AS "SALESPERSON",
  p.given_by AS "REFERRAL GIVEN BY CLIENT",
  upper(btrim(r.referral_name)) AS "REFERRAL NAME",
  regexp_replace(COALESCE(r.referral_number, ''), '[^0-9]', '', 'g') AS "REFERRAL NUMBER",
  upper(COALESCE(NULLIF(btrim(r.assigned_doer), ''), r.crm_name, '')) AS "ASSIGNED CRM / DOER",
  upper(COALESCE(rc.status, '')) AS "FOLLOW UP STATUS",
  crm_private.sheet_date(rc.next_followup_date) AS "NEXT FOLLOW UP DATE",
  crm_private.sheet_date(last_history.followup_date) AS "LAST FOLLOW UP DATE",
  COALESCE(rc.followup_count, 0)::text AS "FOLLOW UP COUNT",
  COALESCE(rc.remark, '') AS "LAST FOLLOW UP REMARK",
  COALESCE(converted.client_code, '') AS "CONVERTED CLIENT ID",
  crm_private.sheet_date(converted_on.followup_date) AS "CONVERTED ON",
  COALESCE(rc.action_point, '') AS "ACTION POINT"
FROM public.referral_calling rc
JOIN public.referrals r ON r.id = rc.referral_id
JOIN crm_private.sheet_referral_parts p ON p.referral_id = r.id
LEFT JOIN public.users sp ON sp.id = r.salesperson_id
LEFT JOIN public.clients converted ON converted.client_id = rc.converted_client_id
LEFT JOIN LATERAL (
  SELECT hist.created_at, hist.followup_date FROM public.referral_calling_history hist
  WHERE hist.referral_calling_id = rc.id ORDER BY hist.created_at DESC, hist.id DESC LIMIT 1
) last_history ON true
LEFT JOIN LATERAL (
  SELECT hist.followup_date FROM public.referral_calling_history hist
  WHERE hist.referral_calling_id = rc.id AND upper(hist.status) = 'CONVERTED TO CLIENT'
  ORDER BY hist.created_at, hist.id LIMIT 1
) converted_on ON true;

CREATE VIEW crm_private.sheet_referrals_history AS
SELECT
  hist.id AS _record_id,
  crm_private.sheet_hashed_key('RH', p.raw_key || '|' || crm_private.sheet_time(hist.created_at) || '|' || upper(COALESCE(hist.status, ''))) AS _row_key,
  crm_private.sheet_time(hist.created_at) AS "TIMESTAMP",
  p.raw_key AS "REFERRAL KEY",
  p.given_by AS "REFERRAL GIVEN BY CLIENT",
  upper(btrim(r.referral_name)) AS "REFERRAL NAME",
  regexp_replace(COALESCE(r.referral_number, ''), '[^0-9]', '', 'g') AS "REFERRAL NUMBER",
  upper(COALESCE(NULLIF(btrim(r.assigned_doer), ''), r.crm_name, '')) AS "CRM NAME",
  upper(COALESCE(hist.previous_status, '')) AS "OLD STATUS",
  upper(COALESCE(hist.status, '')) AS "NEW STATUS",
  crm_private.sheet_date(hist.followup_date) AS "FOLLOW UP DATE",
  crm_private.sheet_date(hist.next_followup_date) AS "NEXT FOLLOW UP DATE",
  upper(COALESCE(hist.call_response, '')) AS "CALL RESPONSE",
  COALESCE(hist.remark, '') AS "REMARK",
  upper(COALESCE(hist.entered_by, '')) AS "ENTERED BY",
  upper(COALESCE(hist.source, '')) AS "SOURCE"
FROM public.referral_calling_history hist
JOIN public.referral_calling rc ON rc.id = hist.referral_calling_id
JOIN public.referrals r ON r.id = rc.referral_id
JOIN crm_private.sheet_referral_parts p ON p.referral_id = r.id;

REVOKE ALL ON crm_private.sheet_client_database_master, crm_private.sheet_walkin_dataset, crm_private.sheet_family_data,
  crm_private.sheet_referral_parts, crm_private.sheet_referrals, crm_private.sheet_referrals_calling_master,
  crm_private.sheet_referrals_history FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION crm_private.sheet_tabs(), crm_private.sheet_date(date), crm_private.sheet_day(timestamptz),
  crm_private.sheet_time(timestamptz), crm_private.sheet_list(text[]), crm_private.sheet_list(jsonb),
  crm_private.sheet_yes_no(boolean), crm_private.sheet_other(text, text), crm_private.branch_match_key(text),
  crm_private.sheet_branch(text), crm_private.sheet_referral_key(text, text, text), crm_private.sheet_hashed_key(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
