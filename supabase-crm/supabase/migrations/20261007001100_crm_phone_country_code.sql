-- Phone numbers keep their country code (owner requests 2026-10-07).
--
-- Until now every phone was cut to its last 10 digits, so an 11- or 12-digit number lost
-- digits and the country was implied (+91). From here on:
-- - a phone column holds one digit string, country code + number, without '+' or spaces
--   (919987323456, 6591234567);
-- - a country-code column beside it holds that code (91, 65), so the country is always
--   known: clients.primary_phone_country_code / secondary_phone_country_code /
--   billing_phone_country_code, leads.country_code, referrals.country_code,
--   entry_queue.country_code, visit_forms.reference_phone_country_code. It is derived by the
--   database from the stored number and crm_private.phone_country_codes (E.164 codes are
--   prefix-free, so exactly one code matches) and cannot be set to anything else.
--   (Postgres adds a column at the end of a table; it cannot be placed beside the phone.)
--
-- Typed input is read once, on the way in; a stored number is never re-read as input:
-- - crm_private.phone_key(input): typed or Sheet input -> stored form:
--     '+<digits>' or '00<digits>'      -> the digits (8-15, no leading 0);
--     10 digits                         -> '91' + digits (an Indian number entered without code);
--     0 + 10 digits                     -> '91' + the 10 digits;
--     11-15 digits not starting with 0  -> the digits (already include a country code);
--     anything else                     -> NULL (not a phone).
--   The Google Sheets, the Apps Script walk-in feed and older app builds send 10-digit Indian
--   numbers and keep working. The /crm forms send '+' + the code chosen in a mandatory
--   dropdown + the number.
-- - crm_private.stored_phone(stored): a stored number as it is (6591234567 stays Singapore).
-- - crm_private.as_phone_input(stored): a stored number handed to a function or column that
--   takes input ('+' + digits), so it is not mistaken for an Indian number without code.
-- - A BEFORE trigger stores every newly entered or changed phone (clients, leads, referrals,
--   queue, visit reference) in that form and sets its country code; an unchanged phone is
--   left as stored; a value that is not a phone is kept as typed (country code NULL).
-- - Existing rows are rewritten once (10 digits -> 91 + digits) without audit, Sheet-outbox or
--   JewelOS-sync side effects; client_phone_index is rebuilt from the clients.
-- - Every RPC that cut to 10 digits now uses these functions. Each is patched in place from its
--   live definition (as 20261007001000 does), so later changes such as the walk-in persistence
--   fix are kept; a definition that does not look as expected stops the migration. The Sheet's own keys stay last-10-digits, as Code.gs computes them:
--   sheet_referral_key (unchanged) and the "PHONE KEY" column of sheet_client_database_master.

-- ---------------------------------------------------------------------------
-- Country codes and the three phone functions
-- ---------------------------------------------------------------------------

CREATE TABLE crm_private.phone_country_codes (
  code text PRIMARY KEY CHECK (code ~ '^[1-9][0-9]{0,2}$'),
  country text NOT NULL
);
-- Keep in step with COUNTRY_CODES in packages/crm-ui/src/lib/phone.ts (tests/phone.test.ts checks).
INSERT INTO crm_private.phone_country_codes (code, country) VALUES
  ('1', 'USA / Canada'),
  ('7', 'Russia / Kazakhstan'),
  ('20', 'Egypt'),
  ('27', 'South Africa'),
  ('30', 'Greece'),
  ('31', 'Netherlands'),
  ('32', 'Belgium'),
  ('33', 'France'),
  ('34', 'Spain'),
  ('36', 'Hungary'),
  ('39', 'Italy'),
  ('40', 'Romania'),
  ('41', 'Switzerland'),
  ('43', 'Austria'),
  ('44', 'United Kingdom'),
  ('45', 'Denmark'),
  ('46', 'Sweden'),
  ('47', 'Norway'),
  ('48', 'Poland'),
  ('49', 'Germany'),
  ('51', 'Peru'),
  ('52', 'Mexico'),
  ('53', 'Cuba'),
  ('54', 'Argentina'),
  ('55', 'Brazil'),
  ('56', 'Chile'),
  ('57', 'Colombia'),
  ('58', 'Venezuela'),
  ('60', 'Malaysia'),
  ('61', 'Australia'),
  ('62', 'Indonesia'),
  ('63', 'Philippines'),
  ('64', 'New Zealand'),
  ('65', 'Singapore'),
  ('66', 'Thailand'),
  ('81', 'Japan'),
  ('82', 'South Korea'),
  ('84', 'Vietnam'),
  ('86', 'China'),
  ('90', 'Turkey'),
  ('91', 'India'),
  ('92', 'Pakistan'),
  ('93', 'Afghanistan'),
  ('94', 'Sri Lanka'),
  ('95', 'Myanmar'),
  ('98', 'Iran'),
  ('211', 'South Sudan'),
  ('212', 'Morocco'),
  ('213', 'Algeria'),
  ('216', 'Tunisia'),
  ('218', 'Libya'),
  ('220', 'Gambia'),
  ('221', 'Senegal'),
  ('222', 'Mauritania'),
  ('223', 'Mali'),
  ('224', 'Guinea'),
  ('225', 'Ivory Coast'),
  ('226', 'Burkina Faso'),
  ('227', 'Niger'),
  ('228', 'Togo'),
  ('229', 'Benin'),
  ('230', 'Mauritius'),
  ('231', 'Liberia'),
  ('232', 'Sierra Leone'),
  ('233', 'Ghana'),
  ('234', 'Nigeria'),
  ('235', 'Chad'),
  ('236', 'Central African Republic'),
  ('237', 'Cameroon'),
  ('238', 'Cape Verde'),
  ('239', 'Sao Tome and Principe'),
  ('240', 'Equatorial Guinea'),
  ('241', 'Gabon'),
  ('242', 'Congo'),
  ('243', 'DR Congo'),
  ('244', 'Angola'),
  ('245', 'Guinea-Bissau'),
  ('246', 'Diego Garcia'),
  ('248', 'Seychelles'),
  ('249', 'Sudan'),
  ('250', 'Rwanda'),
  ('251', 'Ethiopia'),
  ('252', 'Somalia'),
  ('253', 'Djibouti'),
  ('254', 'Kenya'),
  ('255', 'Tanzania'),
  ('256', 'Uganda'),
  ('257', 'Burundi'),
  ('258', 'Mozambique'),
  ('260', 'Zambia'),
  ('261', 'Madagascar'),
  ('262', 'Reunion / Mayotte'),
  ('263', 'Zimbabwe'),
  ('264', 'Namibia'),
  ('265', 'Malawi'),
  ('266', 'Lesotho'),
  ('267', 'Botswana'),
  ('268', 'Eswatini'),
  ('269', 'Comoros'),
  ('290', 'Saint Helena'),
  ('291', 'Eritrea'),
  ('297', 'Aruba'),
  ('298', 'Faroe Islands'),
  ('299', 'Greenland'),
  ('350', 'Gibraltar'),
  ('351', 'Portugal'),
  ('352', 'Luxembourg'),
  ('353', 'Ireland'),
  ('354', 'Iceland'),
  ('355', 'Albania'),
  ('356', 'Malta'),
  ('357', 'Cyprus'),
  ('358', 'Finland'),
  ('359', 'Bulgaria'),
  ('370', 'Lithuania'),
  ('371', 'Latvia'),
  ('372', 'Estonia'),
  ('373', 'Moldova'),
  ('374', 'Armenia'),
  ('375', 'Belarus'),
  ('376', 'Andorra'),
  ('377', 'Monaco'),
  ('378', 'San Marino'),
  ('380', 'Ukraine'),
  ('381', 'Serbia'),
  ('382', 'Montenegro'),
  ('383', 'Kosovo'),
  ('385', 'Croatia'),
  ('386', 'Slovenia'),
  ('387', 'Bosnia and Herzegovina'),
  ('389', 'North Macedonia'),
  ('420', 'Czech Republic'),
  ('421', 'Slovakia'),
  ('423', 'Liechtenstein'),
  ('500', 'Falkland Islands'),
  ('501', 'Belize'),
  ('502', 'Guatemala'),
  ('503', 'El Salvador'),
  ('504', 'Honduras'),
  ('505', 'Nicaragua'),
  ('506', 'Costa Rica'),
  ('507', 'Panama'),
  ('508', 'Saint Pierre and Miquelon'),
  ('509', 'Haiti'),
  ('590', 'Guadeloupe'),
  ('591', 'Bolivia'),
  ('592', 'Guyana'),
  ('593', 'Ecuador'),
  ('594', 'French Guiana'),
  ('595', 'Paraguay'),
  ('596', 'Martinique'),
  ('597', 'Suriname'),
  ('598', 'Uruguay'),
  ('599', 'Curacao / Caribbean Netherlands'),
  ('670', 'Timor-Leste'),
  ('672', 'Norfolk Island'),
  ('673', 'Brunei'),
  ('674', 'Nauru'),
  ('675', 'Papua New Guinea'),
  ('676', 'Tonga'),
  ('677', 'Solomon Islands'),
  ('678', 'Vanuatu'),
  ('679', 'Fiji'),
  ('680', 'Palau'),
  ('681', 'Wallis and Futuna'),
  ('682', 'Cook Islands'),
  ('683', 'Niue'),
  ('685', 'Samoa'),
  ('686', 'Kiribati'),
  ('687', 'New Caledonia'),
  ('688', 'Tuvalu'),
  ('689', 'French Polynesia'),
  ('690', 'Tokelau'),
  ('691', 'Micronesia'),
  ('692', 'Marshall Islands'),
  ('850', 'North Korea'),
  ('852', 'Hong Kong'),
  ('853', 'Macau'),
  ('855', 'Cambodia'),
  ('856', 'Laos'),
  ('880', 'Bangladesh'),
  ('886', 'Taiwan'),
  ('960', 'Maldives'),
  ('961', 'Lebanon'),
  ('962', 'Jordan'),
  ('963', 'Syria'),
  ('964', 'Iraq'),
  ('965', 'Kuwait'),
  ('966', 'Saudi Arabia'),
  ('967', 'Yemen'),
  ('968', 'Oman'),
  ('970', 'Palestine'),
  ('971', 'United Arab Emirates'),
  ('972', 'Israel'),
  ('973', 'Bahrain'),
  ('974', 'Qatar'),
  ('975', 'Bhutan'),
  ('976', 'Mongolia'),
  ('977', 'Nepal'),
  ('992', 'Tajikistan'),
  ('993', 'Turkmenistan'),
  ('994', 'Azerbaijan'),
  ('995', 'Georgia'),
  ('996', 'Kyrgyzstan'),
  ('998', 'Uzbekistan');
REVOKE ALL ON crm_private.phone_country_codes FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION crm_private.phone_key(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN intl IS NOT NULL THEN CASE WHEN length(intl) BETWEEN 8 AND 15 AND intl !~ '^0' THEN intl END
    WHEN length(d) = 10 THEN '91' || d
    WHEN length(d) = 11 AND d ~ '^0' THEN '91' || right(d, 10)
    WHEN length(d) BETWEEN 11 AND 15 AND d !~ '^0' THEN d
  END
  FROM (
    SELECT d, CASE WHEN raw ~ '^\+' THEN d WHEN d ~ '^00' THEN substr(d, 3) END AS intl
    FROM (SELECT btrim(COALESCE(p_phone, '')) AS raw, regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') AS d) input
  ) parsed
$$;

CREATE FUNCTION crm_private.stored_phone(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN d ~ '^[1-9][0-9]{7,14}$' THEN d END
  FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') AS d) digits
$$;

CREATE FUNCTION crm_private.as_phone_input(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT CASE WHEN p_phone ~ '^[0-9]+$' THEN '+' || p_phone ELSE p_phone END $$;

-- A phone column written from input: the stored form, or the value as typed when it is not a phone.
CREATE FUNCTION crm_private.canonical_phone(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT COALESCE(crm_private.phone_key(p_phone), NULLIF(btrim(p_phone), '')) $$;

CREATE FUNCTION crm_private.phone_country(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.code FROM crm_private.phone_country_codes c
  WHERE crm_private.stored_phone(p_phone) LIKE c.code || '%'
  ORDER BY length(c.code) DESC LIMIT 1
$$;

REVOKE ALL ON FUNCTION crm_private.stored_phone(text), crm_private.as_phone_input(text), crm_private.canonical_phone(text),
  crm_private.phone_country(text) FROM PUBLIC, anon, authenticated, service_role;
-- The phone index trigger and the invoker RPCs run as the writer (staff or the service role).
GRANT EXECUTE ON FUNCTION crm_private.phone_key(text), crm_private.stored_phone(text), crm_private.as_phone_input(text),
  crm_private.canonical_phone(text), crm_private.phone_country(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Country-code columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.clients
  ADD COLUMN primary_phone_country_code text,
  ADD COLUMN secondary_phone_country_code text,
  ADD COLUMN billing_phone_country_code text;
ALTER TABLE public.leads ADD COLUMN country_code text;
ALTER TABLE public.referrals ADD COLUMN country_code text;
ALTER TABLE public.entry_queue ADD COLUMN country_code text;
ALTER TABLE public.visit_forms ADD COLUMN reference_phone_country_code text;
COMMENT ON COLUMN public.clients.primary_phone_country_code IS 'Country calling code of primary_phone (set by the database).';
COMMENT ON COLUMN public.clients.secondary_phone_country_code IS 'Country calling code of secondary_phone (set by the database).';
COMMENT ON COLUMN public.clients.billing_phone_country_code IS 'Country calling code of billing_phone (set by the database).';
COMMENT ON COLUMN public.leads.country_code IS 'Country calling code of phone_number (set by the database).';
COMMENT ON COLUMN public.referrals.country_code IS 'Country calling code of referral_number (set by the database).';
COMMENT ON COLUMN public.entry_queue.country_code IS 'Country calling code of mobile (set by the database).';
COMMENT ON COLUMN public.visit_forms.reference_phone_country_code IS 'Country calling code of reference_phone (set by the database).';

-- ---------------------------------------------------------------------------
-- Phone index
-- ---------------------------------------------------------------------------

ALTER TABLE public.client_phone_index DROP CONSTRAINT client_phone_index_normalized_phone_check;
ALTER TABLE public.leads DROP CONSTRAINT leads_phone_normalized;

-- Index rows come from stored client phones (sync_client_phone_index).
CREATE OR REPLACE FUNCTION public.normalize_client_phone_index()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.phone := crm_private.stored_phone(NEW.phone);
  IF NEW.phone IS NULL THEN
    RAISE EXCEPTION 'phone must be a valid number with country code' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_client_phone_index()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    normalized_phone := crm_private.stored_phone(phone_value);
    IF normalized_phone IS NOT NULL
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
$function$;

-- ---------------------------------------------------------------------------
-- Existing rows (one-time rewrite; no audit, profile-editor, Sheet-outbox or sync events).
-- Every stored phone so far is input-shaped (10 digits), so it is read with phone_key.
-- ---------------------------------------------------------------------------

ALTER TABLE public.clients
  DISABLE TRIGGER clients_field_level_audit,
  DISABLE TRIGGER clients_set_profile_editor,
  DISABLE TRIGGER clients_sheet_outbox,
  DISABLE TRIGGER clients_sync_phone_index,
  DISABLE TRIGGER crm_direct_write_audit;
ALTER TABLE public.leads
  DISABLE TRIGGER crm_direct_write_audit,
  DISABLE TRIGGER leads_updated_at;
ALTER TABLE public.entry_queue DISABLE TRIGGER entry_queue_sync_walkin;

UPDATE public.clients c SET
  primary_phone = crm_private.canonical_phone(c.primary_phone),
  secondary_phone = crm_private.canonical_phone(c.secondary_phone),
  billing_phone = crm_private.canonical_phone(c.billing_phone),
  other_known_phones = CASE WHEN c.other_known_phones IS NULL THEN NULL ELSE ARRAY(
    SELECT COALESCE(crm_private.canonical_phone(o.v), o.v) FROM unnest(c.other_known_phones) WITH ORDINALITY o(v, n) ORDER BY o.n) END;
UPDATE public.clients SET
  primary_phone_country_code = crm_private.phone_country(primary_phone),
  secondary_phone_country_code = crm_private.phone_country(secondary_phone),
  billing_phone_country_code = crm_private.phone_country(billing_phone);

UPDATE public.leads SET phone_number = COALESCE(crm_private.phone_key(phone_number), phone_number);
UPDATE public.leads SET country_code = crm_private.phone_country(phone_number);
UPDATE public.referrals SET referral_number = COALESCE(crm_private.phone_key(referral_number), referral_number);
UPDATE public.referrals SET country_code = crm_private.phone_country(referral_number);
UPDATE public.entry_queue SET mobile = COALESCE(crm_private.phone_key(mobile), mobile);
UPDATE public.entry_queue SET country_code = crm_private.phone_country(mobile);
UPDATE public.visit_forms SET reference_phone = crm_private.canonical_phone(reference_phone)
WHERE reference_phone IS NOT NULL;
UPDATE public.visit_forms SET reference_phone_country_code = crm_private.phone_country(reference_phone)
WHERE reference_phone IS NOT NULL;

DELETE FROM public.client_phone_index;
INSERT INTO public.client_phone_index (phone, client_id)
SELECT DISTINCT crm_private.stored_phone(p.v), c.client_id
FROM public.clients c
CROSS JOIN LATERAL unnest(array_cat(ARRAY[c.primary_phone, c.secondary_phone, c.billing_phone]::text[], COALESCE(c.other_known_phones, ARRAY[]::text[]))) p(v)
WHERE crm_private.stored_phone(p.v) IS NOT NULL;

ALTER TABLE public.clients
  ENABLE TRIGGER clients_field_level_audit,
  ENABLE TRIGGER clients_set_profile_editor,
  ENABLE TRIGGER clients_sheet_outbox,
  ENABLE TRIGGER clients_sync_phone_index,
  ENABLE TRIGGER crm_direct_write_audit;
ALTER TABLE public.leads
  ENABLE TRIGGER crm_direct_write_audit,
  ENABLE TRIGGER leads_updated_at;
ALTER TABLE public.entry_queue ENABLE TRIGGER entry_queue_sync_walkin;

ALTER TABLE public.client_phone_index ADD CONSTRAINT client_phone_index_normalized_phone_check
  CHECK (phone::text ~ '^[1-9][0-9]{7,14}$');
ALTER TABLE public.leads ADD CONSTRAINT leads_phone_normalized
  CHECK (phone_number::text ~ '^[1-9][0-9]{7,14}$');
ALTER TABLE public.leads ADD CONSTRAINT leads_country_code_known CHECK (country_code IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Every later write
-- ---------------------------------------------------------------------------

CREATE FUNCTION crm_private.canonicalize_phone_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_insert boolean := TG_OP = 'INSERT';
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'clients' THEN
      IF v_insert OR NEW.primary_phone IS DISTINCT FROM OLD.primary_phone THEN NEW.primary_phone := crm_private.canonical_phone(NEW.primary_phone); END IF;
      IF v_insert OR NEW.secondary_phone IS DISTINCT FROM OLD.secondary_phone THEN NEW.secondary_phone := crm_private.canonical_phone(NEW.secondary_phone); END IF;
      IF v_insert OR NEW.billing_phone IS DISTINCT FROM OLD.billing_phone THEN NEW.billing_phone := crm_private.canonical_phone(NEW.billing_phone); END IF;
      -- Only numbers added to the list are input; numbers already on it stay as stored.
      IF NEW.other_known_phones IS NOT NULL AND (v_insert OR NEW.other_known_phones IS DISTINCT FROM OLD.other_known_phones) THEN
        NEW.other_known_phones := ARRAY(
          SELECT CASE WHEN NOT v_insert AND o.v = ANY (COALESCE(OLD.other_known_phones, ARRAY[]::text[])) THEN o.v
                      ELSE COALESCE(crm_private.canonical_phone(o.v), o.v) END
          FROM unnest(NEW.other_known_phones) WITH ORDINALITY o(v, n) ORDER BY o.n);
      END IF;
      NEW.primary_phone_country_code := crm_private.phone_country(NEW.primary_phone);
      NEW.secondary_phone_country_code := crm_private.phone_country(NEW.secondary_phone);
      NEW.billing_phone_country_code := crm_private.phone_country(NEW.billing_phone);
    WHEN 'leads' THEN
      IF v_insert OR NEW.phone_number IS DISTINCT FROM OLD.phone_number THEN NEW.phone_number := COALESCE(crm_private.phone_key(NEW.phone_number), NEW.phone_number); END IF;
      NEW.country_code := crm_private.phone_country(NEW.phone_number);
    WHEN 'referrals' THEN
      IF v_insert OR NEW.referral_number IS DISTINCT FROM OLD.referral_number THEN NEW.referral_number := COALESCE(crm_private.phone_key(NEW.referral_number), NEW.referral_number); END IF;
      NEW.country_code := crm_private.phone_country(NEW.referral_number);
    WHEN 'entry_queue' THEN
      IF v_insert OR NEW.mobile IS DISTINCT FROM OLD.mobile THEN NEW.mobile := COALESCE(crm_private.phone_key(NEW.mobile), NEW.mobile); END IF;
      NEW.country_code := crm_private.phone_country(NEW.mobile);
    WHEN 'visit_forms' THEN
      IF v_insert OR NEW.reference_phone IS DISTINCT FROM OLD.reference_phone THEN NEW.reference_phone := crm_private.canonical_phone(NEW.reference_phone); END IF;
      NEW.reference_phone_country_code := crm_private.phone_country(NEW.reference_phone);
  END CASE;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION crm_private.canonicalize_phone_columns() FROM PUBLIC, anon, authenticated, service_role;

-- 'ab': after clients_aa_protect_identity, before the other BEFORE triggers.
CREATE TRIGGER clients_ab_canonical_phones
  BEFORE INSERT OR UPDATE OF primary_phone, secondary_phone, billing_phone, other_known_phones,
    primary_phone_country_code, secondary_phone_country_code, billing_phone_country_code
  ON public.clients FOR EACH ROW EXECUTE FUNCTION crm_private.canonicalize_phone_columns();
CREATE TRIGGER leads_canonical_phone BEFORE INSERT OR UPDATE OF phone_number, country_code
  ON public.leads FOR EACH ROW EXECUTE FUNCTION crm_private.canonicalize_phone_columns();
CREATE TRIGGER referrals_canonical_phone BEFORE INSERT OR UPDATE OF referral_number, country_code
  ON public.referrals FOR EACH ROW EXECUTE FUNCTION crm_private.canonicalize_phone_columns();
CREATE TRIGGER entry_queue_canonical_phone BEFORE INSERT OR UPDATE OF mobile, country_code
  ON public.entry_queue FOR EACH ROW EXECUTE FUNCTION crm_private.canonicalize_phone_columns();
CREATE TRIGGER visit_forms_canonical_phone BEFORE INSERT OR UPDATE OF reference_phone, reference_phone_country_code
  ON public.visit_forms FOR EACH ROW EXECUTE FUNCTION crm_private.canonicalize_phone_columns();

-- ---------------------------------------------------------------------------
-- Functions that cut phones to 10 digits, patched in place: phone_key for input,
-- stored_phone for a stored number, as_phone_input to hand a stored number on.
-- ---------------------------------------------------------------------------

-- public.browse_clients_page
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.browse_clients_page(text,text,integer,integer,boolean)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$right(regexp_replace(COALESCE(search_text, ''), '[^0-9]', '', 'g'), 10) AS last10,$o$, '')) <> 1 * length($o$right(regexp_replace(COALESCE(search_text, ''), '[^0-9]', '', 'g'), 10) AS last10,$o$) THEN
    RAISE EXCEPTION 'public.browse_clients_page: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$right(regexp_replace(COALESCE(search_text, ''), '[^0-9]', '', 'g'), 10) AS last10,$o$, $n$crm_private.phone_key(search_text) AS phone,
      regexp_replace(COALESCE(search_text, ''), '[^0-9]', '', 'g') AS digits,$n$);
  IF length(body) - length(replace(body, $o$OR (length(input.last10) = 10 AND EXISTS ($o$, '')) <> 1 * length($o$OR (length(input.last10) = 10 AND EXISTS ($o$) THEN
    RAISE EXCEPTION 'public.browse_clients_page: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$OR (length(input.last10) = 10 AND EXISTS ($o$, $n$OR (length(input.digits) >= 10 AND EXISTS ($n$);
  IF length(body) - length(replace(body, $o$AND phone_index.phone = input.last10$o$, '')) <> 1 * length($o$AND phone_index.phone = input.last10$o$) THEN
    RAISE EXCEPTION 'public.browse_clients_page: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$AND phone_index.phone = input.last10$o$, $n$AND (phone_index.phone = input.phone OR phone_index.phone LIKE '%' || input.digits)$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.browse_clients_page: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.create_client_with_phone
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.create_client_with_phone(text,text,text,uuid)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$phone_digits := right(regexp_replace(COALESCE(p_primary_phone, ''), '[^0-9]', '', 'g'), 10); IF length(phone_digits) <> 10 THEN RAISE EXCEPTION 'phone must contain at least 10 digits'$o$, '')) <> 1 * length($o$phone_digits := right(regexp_replace(COALESCE(p_primary_phone, ''), '[^0-9]', '', 'g'), 10); IF length(phone_digits) <> 10 THEN RAISE EXCEPTION 'phone must contain at least 10 digits'$o$) THEN
    RAISE EXCEPTION 'public.create_client_with_phone: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$phone_digits := right(regexp_replace(COALESCE(p_primary_phone, ''), '[^0-9]', '', 'g'), 10); IF length(phone_digits) <> 10 THEN RAISE EXCEPTION 'phone must contain at least 10 digits'$o$, $n$phone_digits := crm_private.phone_key(p_primary_phone); IF phone_digits IS NULL THEN RAISE EXCEPTION 'a valid phone number with country code is required'$n$);
  IF length(body) - length(replace(body, $o$VALUES (trim(p_primary_name), phone_digits, NULLIF(trim(p_gender), ''), target_branch)$o$, '')) <> 1 * length($o$VALUES (trim(p_primary_name), phone_digits, NULLIF(trim(p_gender), ''), target_branch)$o$) THEN
    RAISE EXCEPTION 'public.create_client_with_phone: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$VALUES (trim(p_primary_name), phone_digits, NULLIF(trim(p_gender), ''), target_branch)$o$, $n$VALUES (trim(p_primary_name), crm_private.as_phone_input(phone_digits), NULLIF(trim(p_gender), ''), target_branch)$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.create_client_with_phone: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.create_manual_referral
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.create_manual_referral(uuid,text,text,text,uuid)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$normalized_phone := right(regexp_replace(COALESCE(p_referral_number, ''), '[^0-9]', '', 'g'), 10);$o$, '')) <> 1 * length($o$normalized_phone := right(regexp_replace(COALESCE(p_referral_number, ''), '[^0-9]', '', 'g'), 10);$o$) THEN
    RAISE EXCEPTION 'public.create_manual_referral: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$normalized_phone := right(regexp_replace(COALESCE(p_referral_number, ''), '[^0-9]', '', 'g'), 10);$o$, $n$normalized_phone := crm_private.phone_key(p_referral_number);$n$);
  IF length(body) - length(replace(body, $o$OR length(normalized_phone) <> 10 THEN RAISE EXCEPTION 'referring client, referral name, and a 10-digit referral number are required'$o$, '')) <> 1 * length($o$OR length(normalized_phone) <> 10 THEN RAISE EXCEPTION 'referring client, referral name, and a 10-digit referral number are required'$o$) THEN
    RAISE EXCEPTION 'public.create_manual_referral: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$OR length(normalized_phone) <> 10 THEN RAISE EXCEPTION 'referring client, referral name, and a 10-digit referral number are required'$o$, $n$OR normalized_phone IS NULL THEN RAISE EXCEPTION 'referring client, referral name, and a valid referral number with country code are required'$n$);
  IF length(body) - length(replace(body, $o$btrim(p_referral_name), normalized_phone, target_branch)$o$, '')) <> 1 * length($o$btrim(p_referral_name), normalized_phone, target_branch)$o$) THEN
    RAISE EXCEPTION 'public.create_manual_referral: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$btrim(p_referral_name), normalized_phone, target_branch)$o$, $n$btrim(p_referral_name), crm_private.as_phone_input(normalized_phone), target_branch)$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.create_manual_referral: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.create_manual_referral
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.create_manual_referral(uuid,text,text,text,uuid,text,text)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$normalized_phone := right(regexp_replace(COALESCE(p_referral_number, ''), '[^0-9]', '', 'g'), 10);$o$, '')) <> 1 * length($o$normalized_phone := right(regexp_replace(COALESCE(p_referral_number, ''), '[^0-9]', '', 'g'), 10);$o$) THEN
    RAISE EXCEPTION 'public.create_manual_referral: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$normalized_phone := right(regexp_replace(COALESCE(p_referral_number, ''), '[^0-9]', '', 'g'), 10);$o$, $n$normalized_phone := crm_private.phone_key(p_referral_number);$n$);
  IF length(body) - length(replace(body, $o$OR length(normalized_phone) <> 10 THEN RAISE EXCEPTION 'referring client, referral name, and a 10-digit referral number are required'$o$, '')) <> 1 * length($o$OR length(normalized_phone) <> 10 THEN RAISE EXCEPTION 'referring client, referral name, and a 10-digit referral number are required'$o$) THEN
    RAISE EXCEPTION 'public.create_manual_referral: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$OR length(normalized_phone) <> 10 THEN RAISE EXCEPTION 'referring client, referral name, and a 10-digit referral number are required'$o$, $n$OR normalized_phone IS NULL THEN RAISE EXCEPTION 'referring client, referral name, and a valid referral number with country code are required'$n$);
  IF length(body) - length(replace(body, $o$btrim(p_referral_name),normalized_phone,target_branch,$o$, '')) <> 1 * length($o$btrim(p_referral_name),normalized_phone,target_branch,$o$) THEN
    RAISE EXCEPTION 'public.create_manual_referral: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$btrim(p_referral_name),normalized_phone,target_branch,$o$, $n$btrim(p_referral_name),crm_private.as_phone_input(normalized_phone),target_branch,$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.create_manual_referral: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.create_post_call_lead
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.create_post_call_lead(text,text,jsonb,public.lead_call_response,text,date,integer,public.lead_recording_upload_status)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$DECLARE v_lead "public"."leads"; v_actor "public"."user_role";$o$, '')) <> 1 * length($o$DECLARE v_lead "public"."leads"; v_actor "public"."user_role";$o$) THEN
    RAISE EXCEPTION 'public.create_post_call_lead: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$DECLARE v_lead "public"."leads"; v_actor "public"."user_role";$o$, $n$DECLARE v_lead "public"."leads"; v_actor "public"."user_role"; v_phone text;$n$);
  IF length(body) - length(replace(body, $o$IF p_phone_number !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'phone number must contain exactly 10 digits' USING ERRCODE = 'check_violation'; END IF;$o$, '')) <> 1 * length($o$IF p_phone_number !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'phone number must contain exactly 10 digits' USING ERRCODE = 'check_violation'; END IF;$o$) THEN
    RAISE EXCEPTION 'public.create_post_call_lead: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$IF p_phone_number !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'phone number must contain exactly 10 digits' USING ERRCODE = 'check_violation'; END IF;$o$, $n$v_phone := crm_private.phone_key(p_phone_number);
  IF v_phone IS NULL THEN RAISE EXCEPTION 'a valid phone number with country code is required' USING ERRCODE = 'check_violation'; END IF;$n$);
  IF length(body) - length(replace(body, $o$VALUES (p_phone_number,$o$, '')) <> 1 * length($o$VALUES (p_phone_number,$o$) THEN
    RAISE EXCEPTION 'public.create_post_call_lead: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$VALUES (p_phone_number,$o$, $n$VALUES (crm_private.as_phone_input(v_phone),$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.create_post_call_lead: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.create_referral_calling_if_open
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.create_referral_calling_if_open(uuid,text,text,date)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$AND right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10) = right(regexp_replace(p_number, '[^0-9]', '', 'g'), 10)$o$, '')) <> 1 * length($o$AND right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10) = right(regexp_replace(p_number, '[^0-9]', '', 'g'), 10)$o$) THEN
    RAISE EXCEPTION 'public.create_referral_calling_if_open: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$AND right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10) = right(regexp_replace(p_number, '[^0-9]', '', 'g'), 10)$o$, $n$AND crm_private.stored_phone(referral.referral_number) = crm_private.stored_phone(p_number)$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.create_referral_calling_if_open: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.create_referral_from_visit_form
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.create_referral_from_visit_form()'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$right(regexp_replace(COALESCE(NEW."reference_phone", ''), '[^0-9]', '', 'g'), 10)$o$, '')) <> 1 * length($o$right(regexp_replace(COALESCE(NEW."reference_phone", ''), '[^0-9]', '', 'g'), 10)$o$) THEN
    RAISE EXCEPTION 'public.create_referral_from_visit_form: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$right(regexp_replace(COALESCE(NEW."reference_phone", ''), '[^0-9]', '', 'g'), 10)$o$, $n$crm_private.stored_phone(NEW."reference_phone")$n$);
  IF length(body) - length(replace(body, $o$IF length(v_normalized_phone) = 10 THEN$o$, '')) <> 1 * length($o$IF length(v_normalized_phone) = 10 THEN$o$) THEN
    RAISE EXCEPTION 'public.create_referral_from_visit_form: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$IF length(v_normalized_phone) = 10 THEN$o$, $n$IF v_normalized_phone IS NOT NULL THEN$n$);
  IF length(body) - length(replace(body, $o$right(regexp_replace(COALESCE(referral_item->>'mobile', ''), '[^0-9]', '', 'g'), 10)$o$, '')) <> 1 * length($o$right(regexp_replace(COALESCE(referral_item->>'mobile', ''), '[^0-9]', '', 'g'), 10)$o$) THEN
    RAISE EXCEPTION 'public.create_referral_from_visit_form: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$right(regexp_replace(COALESCE(referral_item->>'mobile', ''), '[^0-9]', '', 'g'), 10)$o$, $n$crm_private.phone_key(referral_item->>'mobile')$n$);
  IF length(body) - length(replace(body, $o$OR length(v_normalized_phone) <> 10 THEN$o$, '')) <> 1 * length($o$OR length(v_normalized_phone) <> 10 THEN$o$) THEN
    RAISE EXCEPTION 'public.create_referral_from_visit_form: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$OR length(v_normalized_phone) <> 10 THEN$o$, $n$OR v_normalized_phone IS NULL THEN$n$);
  IF length(body) - length(replace(body, $o$must include a name and 10-digit phone$o$, '')) <> 1 * length($o$must include a name and 10-digit phone$o$) THEN
    RAISE EXCEPTION 'public.create_referral_from_visit_form: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$must include a name and 10-digit phone$o$, $n$must include a name and a valid phone$n$);
  IF length(body) - length(replace(body, $o$requires a name and 10-digit phone$o$, '')) <> 1 * length($o$requires a name and 10-digit phone$o$) THEN
    RAISE EXCEPTION 'public.create_referral_from_visit_form: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$requires a name and 10-digit phone$o$, $n$requires a name and a valid phone$n$);
  IF length(body) - length(replace(body, $o$source_visit."client_id", v_referral_name, v_normalized_phone,$o$, '')) <> 2 * length($o$source_visit."client_id", v_referral_name, v_normalized_phone,$o$) THEN
    RAISE EXCEPTION 'public.create_referral_from_visit_form: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$source_visit."client_id", v_referral_name, v_normalized_phone,$o$, $n$source_visit."client_id", v_referral_name, crm_private.as_phone_input(v_normalized_phone),$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.create_referral_from_visit_form: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- crm_private.link_visit_companions
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('crm_private.link_visit_companions()'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$v_phone := right(regexp_replace(COALESCE(NULLIF(v_companion ->> 'phone', ''), v_companion ->> 'mobile', ''), '[^0-9]', '', 'g'), 10);$o$, '')) <> 1 * length($o$v_phone := right(regexp_replace(COALESCE(NULLIF(v_companion ->> 'phone', ''), v_companion ->> 'mobile', ''), '[^0-9]', '', 'g'), 10);$o$) THEN
    RAISE EXCEPTION 'crm_private.link_visit_companions: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$v_phone := right(regexp_replace(COALESCE(NULLIF(v_companion ->> 'phone', ''), v_companion ->> 'mobile', ''), '[^0-9]', '', 'g'), 10);$o$, $n$v_phone := crm_private.phone_key(COALESCE(NULLIF(v_companion ->> 'phone', ''), v_companion ->> 'mobile', ''));$n$);
  IF length(body) - length(replace(body, $o$IF v_name = '' AND length(v_phone) <> 10 THEN$o$, '')) <> 1 * length($o$IF v_name = '' AND length(v_phone) <> 10 THEN$o$) THEN
    RAISE EXCEPTION 'crm_private.link_visit_companions: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$IF v_name = '' AND length(v_phone) <> 10 THEN$o$, $n$IF v_name = '' AND v_phone IS NULL THEN$n$);
  IF length(body) - length(replace(body, $o$IF length(v_phone) <> 10 THEN$o$, '')) <> 1 * length($o$IF length(v_phone) <> 10 THEN$o$) THEN
    RAISE EXCEPTION 'crm_private.link_visit_companions: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$IF length(v_phone) <> 10 THEN$o$, $n$IF v_phone IS NULL THEN$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'crm_private.link_visit_companions: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- crm_private.find_or_create_known_client
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('crm_private.find_or_create_known_client(text,text,uuid,text,uuid,text)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$v_phone text := crm_private.phone_key(p_phone);$o$, '')) <> 1 * length($o$v_phone text := crm_private.phone_key(p_phone);$o$) THEN
    RAISE EXCEPTION 'crm_private.find_or_create_known_client: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$v_phone text := crm_private.phone_key(p_phone);$o$, $n$v_phone text := crm_private.stored_phone(p_phone);$n$);
  IF length(body) - length(replace(body, $o$client_id := crm_private.match_client(v_phone,$o$, '')) <> 1 * length($o$client_id := crm_private.match_client(v_phone,$o$) THEN
    RAISE EXCEPTION 'crm_private.find_or_create_known_client: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$client_id := crm_private.match_client(v_phone,$o$, $n$client_id := crm_private.match_client(crm_private.as_phone_input(v_phone),$n$);
  IF length(body) - length(replace(body, $o$VALUES (v_name, v_phone, p_branch_id,$o$, '')) <> 1 * length($o$VALUES (v_name, v_phone, p_branch_id,$o$) THEN
    RAISE EXCEPTION 'crm_private.find_or_create_known_client: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$VALUES (v_name, v_phone, p_branch_id,$o$, $n$VALUES (v_name, crm_private.as_phone_input(v_phone), p_branch_id,$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'crm_private.find_or_create_known_client: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.save_referral_followup
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.save_referral_followup(uuid,text,text,date,text,text)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$phones.phone = right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10)$o$, '')) <> 1 * length($o$phones.phone = right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10)$o$) THEN
    RAISE EXCEPTION 'public.save_referral_followup: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$phones.phone = right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10)$o$, $n$phones.phone = crm_private.stored_phone(referral.referral_number)$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.save_referral_followup: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.search_clients
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.search_clients(text,integer)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$regexp_replace(search_text, '[^0-9]', '', 'g') AS digits,$o$, '')) <> 1 * length($o$regexp_replace(search_text, '[^0-9]', '', 'g') AS digits,$o$) THEN
    RAISE EXCEPTION 'public.search_clients: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$regexp_replace(search_text, '[^0-9]', '', 'g') AS digits,$o$, $n$regexp_replace(search_text, '[^0-9]', '', 'g') AS digits,
           crm_private.phone_key(search_text) AS phone,$n$);
  IF length(body) - length(replace(body, $o$AND pi.phone LIKE '%' || right(input.digits, 10) || '%' ORDER BY (pi.phone = right(input.digits, 10)) DESC$o$, '')) <> 1 * length($o$AND pi.phone LIKE '%' || right(input.digits, 10) || '%' ORDER BY (pi.phone = right(input.digits, 10)) DESC$o$) THEN
    RAISE EXCEPTION 'public.search_clients: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$AND pi.phone LIKE '%' || right(input.digits, 10) || '%' ORDER BY (pi.phone = right(input.digits, 10)) DESC$o$, $n$AND (pi.phone LIKE '%' || input.digits || '%' OR pi.phone = input.phone) ORDER BY (pi.phone = input.phone) DESC NULLS LAST$n$);
  IF length(body) - length(replace(body, $o$ORDER BY (p.phone = right(input.digits, 10)) DESC NULLS LAST$o$, '')) <> 1 * length($o$ORDER BY (p.phone = right(input.digits, 10)) DESC NULLS LAST$o$) THEN
    RAISE EXCEPTION 'public.search_clients: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$ORDER BY (p.phone = right(input.digits, 10)) DESC NULLS LAST$o$, $n$ORDER BY (p.phone = input.phone) DESC NULLS LAST$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.search_clients: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- crm_private.sheet_referral_for
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('crm_private.sheet_referral_for(text,jsonb,text,text)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$right(regexp_replace(p_values ->> 'REFERRAL NUMBER', '[^0-9]', '', 'g'), 10), v_branch,$o$, '')) <> 1 * length($o$right(regexp_replace(p_values ->> 'REFERRAL NUMBER', '[^0-9]', '', 'g'), 10), v_branch,$o$) THEN
    RAISE EXCEPTION 'crm_private.sheet_referral_for: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$right(regexp_replace(p_values ->> 'REFERRAL NUMBER', '[^0-9]', '', 'g'), 10), v_branch,$o$, $n$p_values ->> 'REFERRAL NUMBER', v_branch,$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'crm_private.sheet_referral_for: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- crm_private.sheet_apply_family
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('crm_private.sheet_apply_family(text,jsonb)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$crm_private.phone_key(p_values ->> 'NUMBER'), 'engaged')$o$, '')) <> 1 * length($o$crm_private.phone_key(p_values ->> 'NUMBER'), 'engaged')$o$) THEN
    RAISE EXCEPTION 'crm_private.sheet_apply_family: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$crm_private.phone_key(p_values ->> 'NUMBER'), 'engaged')$o$, $n$crm_private.as_phone_input(crm_private.phone_key(p_values ->> 'NUMBER')), 'engaged')$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'crm_private.sheet_apply_family: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.convert_referral_to_client
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.convert_referral_to_client(uuid)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$normalized_phone := right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10);$o$, '')) <> 1 * length($o$normalized_phone := right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10);$o$) THEN
    RAISE EXCEPTION 'public.convert_referral_to_client: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$normalized_phone := right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10);$o$, $n$normalized_phone := crm_private.stored_phone(referral.referral_number);$n$);
  IF length(body) - length(replace(body, $o$crm_private.match_client(normalized_phone,$o$, '')) <> 1 * length($o$crm_private.match_client(normalized_phone,$o$) THEN
    RAISE EXCEPTION 'public.convert_referral_to_client: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$crm_private.match_client(normalized_phone,$o$, $n$crm_private.match_client(crm_private.as_phone_input(normalized_phone),$n$);
  IF length(body) - length(replace(body, $o$VALUES (btrim(referral.referral_name), normalized_phone, target_branch)$o$, '')) <> 1 * length($o$VALUES (btrim(referral.referral_name), normalized_phone, target_branch)$o$) THEN
    RAISE EXCEPTION 'public.convert_referral_to_client: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$VALUES (btrim(referral.referral_name), normalized_phone, target_branch)$o$, $n$VALUES (btrim(referral.referral_name), crm_private.as_phone_input(normalized_phone), target_branch)$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.convert_referral_to_client: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.lookup_client_by_phone
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.lookup_client_by_phone(text)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$SELECT right(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), 10) AS phone$o$, '')) <> 1 * length($o$SELECT right(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), 10) AS phone$o$) THEN
    RAISE EXCEPTION 'public.lookup_client_by_phone: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$SELECT right(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), 10) AS phone$o$, $n$SELECT crm_private.phone_key(p_phone) AS phone$n$);
  IF length(body) - length(replace(body, $o$WHERE length(input.phone) = 10$o$, '')) <> 1 * length($o$WHERE length(input.phone) = 10$o$) THEN
    RAISE EXCEPTION 'public.lookup_client_by_phone: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$WHERE length(input.phone) = 10$o$, $n$WHERE input.phone IS NOT NULL$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.lookup_client_by_phone: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.reconcile_referral_calling_conversions
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.reconcile_referral_calling_conversions()'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$phones.phone = right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10)$o$, '')) <> 1 * length($o$phones.phone = right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10)$o$) THEN
    RAISE EXCEPTION 'public.reconcile_referral_calling_conversions: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$phones.phone = right(regexp_replace(referral.referral_number, '[^0-9]', '', 'g'), 10)$o$, $n$phones.phone = crm_private.stored_phone(referral.referral_number)$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.reconcile_referral_calling_conversions: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.submit_walkin_visit
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.submit_walkin_visit(jsonb)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$phone_digits := right(regexp_replace(COALESCE(p_payload->>'primary_phone', ''), '[^0-9]', '', 'g'), 10);$o$, '')) <> 1 * length($o$phone_digits := right(regexp_replace(COALESCE(p_payload->>'primary_phone', ''), '[^0-9]', '', 'g'), 10);$o$) THEN
    RAISE EXCEPTION 'public.submit_walkin_visit: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$phone_digits := right(regexp_replace(COALESCE(p_payload->>'primary_phone', ''), '[^0-9]', '', 'g'), 10);$o$, $n$phone_digits := crm_private.phone_key(p_payload->>'primary_phone');$n$);
  IF length(body) - length(replace(body, $o$IF length(phone_digits) <> 10 OR length(trim($o$, '')) <> 1 * length($o$IF length(phone_digits) <> 10 OR length(trim($o$) THEN
    RAISE EXCEPTION 'public.submit_walkin_visit: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$IF length(phone_digits) <> 10 OR length(trim($o$, $n$IF phone_digits IS NULL OR length(trim($n$);
  IF length(body) - length(replace(body, $o$'client name and a 10-digit phone are required'$o$, '')) <> 1 * length($o$'client name and a 10-digit phone are required'$o$) THEN
    RAISE EXCEPTION 'public.submit_walkin_visit: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$'client name and a 10-digit phone are required'$o$, $n$'client name and a valid phone number with country code are required'$n$);
  IF length(body) - length(replace(body, $o$crm_private.match_client(phone_digits,$o$, '')) <> 1 * length($o$crm_private.match_client(phone_digits,$o$) THEN
    RAISE EXCEPTION 'public.submit_walkin_visit: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$crm_private.match_client(phone_digits,$o$, $n$crm_private.match_client(crm_private.as_phone_input(phone_digits),$n$);
  IF length(body) - length(replace(body, $o$trim(p_payload->>'primary_name'), phone_digits, NULLIF(trim(p_payload->>'gender'), '')$o$, '')) <> 1 * length($o$trim(p_payload->>'primary_name'), phone_digits, NULLIF(trim(p_payload->>'gender'), '')$o$) THEN
    RAISE EXCEPTION 'public.submit_walkin_visit: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$trim(p_payload->>'primary_name'), phone_digits, NULLIF(trim(p_payload->>'gender'), '')$o$, $n$trim(p_payload->>'primary_name'), crm_private.as_phone_input(phone_digits), NULLIF(trim(p_payload->>'gender'), '')$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.submit_walkin_visit: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- public.create_entry_queue
DO $patch$
DECLARE body text;
BEGIN
  body := replace(pg_get_functiondef('public.create_entry_queue(text,text,uuid,text,uuid)'::regprocedure), E'\r', '');
  IF length(body) - length(replace(body, $o$phone_digits := right(regexp_replace(COALESCE(p_mobile, ''), '[^0-9]', '', 'g'), 10);$o$, '')) <> 1 * length($o$phone_digits := right(regexp_replace(COALESCE(p_mobile, ''), '[^0-9]', '', 'g'), 10);$o$) THEN
    RAISE EXCEPTION 'public.create_entry_queue: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$phone_digits := right(regexp_replace(COALESCE(p_mobile, ''), '[^0-9]', '', 'g'), 10);$o$, $n$phone_digits := crm_private.phone_key(p_mobile);$n$);
  IF length(body) - length(replace(body, $o$OR length(phone_digits) <> 10 THEN RAISE EXCEPTION 'client name and a 10-digit phone are required'$o$, '')) <> 1 * length($o$OR length(phone_digits) <> 10 THEN RAISE EXCEPTION 'client name and a 10-digit phone are required'$o$) THEN
    RAISE EXCEPTION 'public.create_entry_queue: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$OR length(phone_digits) <> 10 THEN RAISE EXCEPTION 'client name and a 10-digit phone are required'$o$, $n$OR phone_digits IS NULL THEN RAISE EXCEPTION 'client name and a valid phone number with country code are required'$n$);
  IF length(body) - length(replace(body, $o$crm_private.match_client(phone_digits, canonical_name)$o$, '')) <> 1 * length($o$crm_private.match_client(phone_digits, canonical_name)$o$) THEN
    RAISE EXCEPTION 'public.create_entry_queue: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$crm_private.match_client(phone_digits, canonical_name)$o$, $n$crm_private.match_client(crm_private.as_phone_input(phone_digits), canonical_name)$n$);
  IF length(body) - length(replace(body, $o$VALUES (canonical_name, phone_digits, target_branch)$o$, '')) <> 1 * length($o$VALUES (canonical_name, phone_digits, target_branch)$o$) THEN
    RAISE EXCEPTION 'public.create_entry_queue: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$VALUES (canonical_name, phone_digits, target_branch)$o$, $n$VALUES (canonical_name, crm_private.as_phone_input(phone_digits), target_branch)$n$);
  IF length(body) - length(replace(body, $o$VALUES (generated_token, canonical_name, phone_digits, target_branch,$o$, '')) <> 1 * length($o$VALUES (generated_token, canonical_name, phone_digits, target_branch,$o$) THEN
    RAISE EXCEPTION 'public.create_entry_queue: unexpected definition; refusing to patch'; END IF;
  body := replace(body, $o$VALUES (generated_token, canonical_name, phone_digits, target_branch,$o$, $n$VALUES (generated_token, canonical_name, crm_private.as_phone_input(phone_digits), target_branch,$n$);
  IF body ~ 'right\(regexp_replace\([^;]*?, 10\)' THEN
    RAISE EXCEPTION 'public.create_entry_queue: 10-digit logic left after patch'; END IF;
  EXECUTE body;
END $patch$;

-- ---------------------------------------------------------------------------
-- Sheet views: the stored number (which already carries its code); the Sheet's PHONE KEY
-- stays its last 10 digits (Code.gs). Otherwise as 20261006000300.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW crm_private.sheet_client_database_master AS
SELECT
  c.client_id AS _record_id,
  c.client_code AS _row_key,
  c.client_code AS "CLIENT ID",
  COALESCE(right(crm_private.stored_phone(c.primary_phone), 10), right(crm_private.stored_phone(c.billing_phone), 10), '') AS "PHONE KEY",
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

CREATE OR REPLACE VIEW crm_private.sheet_walkin_dataset AS
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
  COALESCE(c.primary_phone, '') AS "FINAL NUMBER",
  COALESCE(to_char(t.event_date AT TIME ZONE 'Asia/Kolkata', 'Mon'), '') AS "MONTH",
  '' AS "VISIT FINAL STATUS",
  COALESCE(h.household_code, '') AS "FAMILY ID"
FROM public.client_timeline t
JOIN public.clients c ON c.client_id = t.client_id
LEFT JOIN public.visit_forms f ON f.client_timeline_id = t.id
LEFT JOIN public.branches b ON b.id = t.branch_id
LEFT JOIN public.users sp ON sp.id = t.salesperson_id
LEFT JOIN public.households h ON h.id = c.household_id;

CREATE OR REPLACE VIEW crm_private.sheet_family_data AS
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
  COALESCE(c.primary_phone, '') AS "NUMBER",
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

notify pgrst, 'reload schema';
