-- Original MK Jewels CRM, ported natively into JewelOS (owner decision 2026-09-25).
-- Design: docs/superpowers/specs/2026-09-25-crm-native-integration-design.md
--
-- Schema, enums, sequences, tables, constraints and indexes in schema crm. This is
-- the final cumulative state of every original Prisma migration
-- (sreejith-crm/web-app/prisma/migrations, 20260723000000 .. 20260803010000),
-- replayed into schema crm and captured with pg_dump. Table, column, enum,
-- constraint, index and sequence names are unchanged so the original queries port
-- 1:1 as supabase.schema("crm"). The SSO migration 20260820110000 is excluded.
-- Functions/triggers: 0183. RLS/grants: 0184. Identity bridge: 0182.
-- Existing public.clients / public.client_timeline (old JewelOS CRM) are untouched.

create schema crm;
comment on schema crm is 'Original MK Jewels CRM (port of sreejith-crm). Parity with the original application is the acceptance criterion.';

CREATE TYPE crm.buy_status AS ENUM (
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

CREATE TYPE crm.event_type AS ENUM (
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

CREATE TYPE crm.lead_call_response AS ENUM (
    'CONNECTED',
    'NOT PICKED',
    'SWITCHED OFF',
    'WHATSAPP ONLY',
    'WRONG NUMBER'
);

CREATE TYPE crm.lead_created_via AS ENUM (
    'crm_desktop',
    'mobile_post_call'
);

CREATE TYPE crm.lead_field_type AS ENUM (
    'text',
    'number',
    'dropdown',
    'date',
    'geo',
    'file'
);

CREATE TYPE crm.lead_recording_upload_status AS ENUM (
    'pending',
    'uploaded',
    'failed',
    'not_found'
);

CREATE TYPE crm.lead_source_channel AS ENUM (
    'open',
    'contacted',
    'converted',
    'lost'
);

CREATE TYPE crm.user_role AS ENUM (
    'super_admin',
    'branch_manager',
    'salesperson'
);

CREATE TABLE crm.referrals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    crm_name character varying(160),
    salesperson_id uuid NOT NULL,
    given_by_client_id uuid NOT NULL,
    referral_name character varying(160) NOT NULL,
    referral_number character varying(30) NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    branch_id uuid,
    source_timeline_id uuid,
    source_visit_form_id uuid,
    relationship character varying(120),
    best_time_to_call character varying(120),
    assigned_doer character varying(160)
);

CREATE TABLE crm.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone_number character varying(30) NOT NULL,
    name character varying(160),
    source_channel crm.lead_source_channel DEFAULT 'open'::crm.lead_source_channel NOT NULL,
    field_values jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_via crm.lead_created_via DEFAULT 'crm_desktop'::crm.lead_created_via NOT NULL,
    created_by uuid NOT NULL,
    branch_id uuid,
    runo_pushed boolean DEFAULT false NOT NULL,
    runo_push_error text,
    runo_customer_id text,
    converted_to_client_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT leads_phone_normalized CHECK (((phone_number)::text ~ '^[0-9]{10}$'::text))
);

CREATE TABLE crm.not_bought_followups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    reference_number character varying(100),
    status character varying(80) NOT NULL,
    next_followup_date date,
    call_response text,
    remark text,
    entered_by uuid NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    branch_id uuid,
    source_timeline_id uuid,
    source_visit_form_id uuid,
    followup_count integer DEFAULT 0 NOT NULL,
    action_point text
);

CREATE TABLE crm.referral_calling (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referral_id uuid NOT NULL,
    status character varying(80) NOT NULL,
    remark text,
    next_followup_date date,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    call_response text,
    converted_client_id uuid,
    followup_count integer DEFAULT 0 NOT NULL,
    action_point text
);

CREATE TABLE crm.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL,
    address text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE crm.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by uuid
);

CREATE TABLE crm.client_campaign_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    tagged_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tagged_by uuid,
    note text
);

CREATE TABLE crm.clients (
    client_id uuid DEFAULT gen_random_uuid() NOT NULL,
    primary_name character varying(160) NOT NULL,
    other_names text[] DEFAULT ARRAY[]::text[],
    primary_phone character varying(30) NOT NULL,
    secondary_phone character varying(30),
    billing_phone character varying(30),
    other_known_phones text[] DEFAULT ARRAY[]::text[],
    gender character varying(40),
    country character varying(100),
    state character varying(100),
    city character varying(120),
    city_other character varying(120),
    pincode character varying(12),
    address text,
    community character varying(120),
    community_other character varying(120),
    dob date,
    anniversary date,
    beverage character varying(100),
    sugar character varying(60),
    snack character varying(100),
    gift_history jsonb,
    total_visits integer DEFAULT 0 NOT NULL,
    total_purchase_visits integer DEFAULT 0 NOT NULL,
    total_non_purchase_visits integer DEFAULT 0 NOT NULL,
    total_repair_visits integer DEFAULT 0 NOT NULL,
    total_order_visits integer DEFAULT 0 NOT NULL,
    first_visit_date timestamp(6) with time zone,
    last_visit_date timestamp(6) with time zone,
    last_buy_status crm.buy_status,
    last_branch_id uuid,
    last_crm_name character varying(160),
    last_salesperson_id uuid,
    last_remark text,
    last_product_requirement text,
    last_seen_categories text[] DEFAULT ARRAY[]::text[],
    last_bought_categories text[] DEFAULT ARRAY[]::text[],
    last_order_categories text[] DEFAULT ARRAY[]::text[],
    client_potential_category character varying(120),
    high_potential_reason text,
    instagram_status character varying(80),
    google_review_status character varying(80),
    testimonial_status character varying(80),
    referral_status character varying(80),
    next_visit_date date,
    profile_updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    profile_updated_by uuid,
    client_code text NOT NULL,
    CONSTRAINT clients_client_code_format_check CHECK ((client_code ~ '^MKC-[0-9]+$'::text))
);

CREATE TABLE crm.client_edit_log (
    id bigint NOT NULL,
    client_id uuid NOT NULL,
    edited_by uuid,
    source character varying(100) DEFAULT 'database_trigger'::character varying NOT NULL,
    field_name character varying(120) NOT NULL,
    old_value jsonb,
    new_value jsonb,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE crm.client_phone_index (
    phone character varying(30) NOT NULL,
    client_id uuid NOT NULL,
    CONSTRAINT client_phone_index_normalized_phone_check CHECK (((phone)::text ~ '^[0-9]{10}$'::text))
);

CREATE TABLE crm.client_timeline (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    event_date timestamp(6) with time zone NOT NULL,
    event_type crm.event_type DEFAULT 'VISIT'::crm.event_type NOT NULL,
    buy_status crm.buy_status,
    branch_id uuid NOT NULL,
    crm_name character varying(160),
    salesperson_id uuid,
    seen_categories text[] DEFAULT ARRAY[]::text[],
    bought_categories text[] DEFAULT ARRAY[]::text[],
    order_categories text[] DEFAULT ARRAY[]::text[],
    product_requirement text,
    remark text,
    reference_number character varying(100),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE crm.crm_allocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    crm_name character varying(160) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE crm.crm_daily_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    crm_name character varying(160) NOT NULL,
    date date NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE crm.crm_queue_round_robin (
    branch_id uuid NOT NULL,
    last_index integer DEFAULT '-1'::integer NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE crm.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    client_timeline_id uuid,
    uploaded_by uuid NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    mime_type character varying(255) NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT documents_file_name_check CHECK (((length(file_name) > 0) AND (POSITION(('/'::text) IN (file_name)) = 0))),
    CONSTRAINT documents_storage_path_check CHECK (((array_length(string_to_array(storage_path, '/'::text), 1) = 3) AND (split_part(storage_path, '/'::text, 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'::text) AND (split_part(storage_path, '/'::text, 2) = COALESCE((client_timeline_id)::text, 'general'::text)) AND (split_part(storage_path, '/'::text, 3) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_.+$'::text) AND (SUBSTRING(split_part(storage_path, '/'::text, 3) FROM 38) = file_name)))
);

CREATE TABLE crm.entry_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token character varying(40) NOT NULL,
    client_name character varying(160) NOT NULL,
    mobile character varying(30) NOT NULL,
    branch_id uuid NOT NULL,
    assigned_crm_name character varying(160),
    status character varying(60) DEFAULT 'waiting'::character varying NOT NULL,
    full_form_timestamp timestamp(6) with time zone,
    client_id uuid,
    remark text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    client_is_new boolean DEFAULT false NOT NULL
);

CREATE TABLE crm.lead_call_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid,
    call_response crm.lead_call_response NOT NULL,
    remark text,
    next_followup_date date,
    call_duration_seconds integer,
    recording_storage_path text,
    recording_upload_status crm.lead_recording_upload_status DEFAULT 'pending'::crm.lead_recording_upload_status NOT NULL,
    entered_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT lead_call_history_call_duration_seconds_check CHECK (((call_duration_seconds IS NULL) OR (call_duration_seconds >= 0))),
    CONSTRAINT lead_call_history_recording_state CHECK ((((recording_upload_status = 'uploaded'::crm.lead_recording_upload_status) AND (recording_storage_path IS NOT NULL)) OR ((recording_upload_status <> 'uploaded'::crm.lead_recording_upload_status) AND (recording_storage_path IS NULL))))
);

CREATE TABLE crm.lead_form_field_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    field_id uuid NOT NULL,
    option_value text NOT NULL,
    display_order integer NOT NULL,
    triggers_field_key text
);

CREATE TABLE crm.lead_form_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    field_key text NOT NULL,
    label text NOT NULL,
    field_type crm.lead_field_type NOT NULL,
    is_mandatory boolean DEFAULT false NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    display_order integer NOT NULL,
    is_runo_synced boolean DEFAULT false NOT NULL,
    runo_field_name text,
    parent_field_key text,
    option_source text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT lead_form_fields_key_format CHECK ((field_key ~ '^[a-z][a-z0-9_]*$'::text)),
    CONSTRAINT lead_form_fields_runo_mapping CHECK (((NOT is_runo_synced) OR (runo_field_name IS NOT NULL)))
);

CREATE TABLE crm.lead_stage_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    old_stage crm.lead_source_channel,
    new_stage crm.lead_source_channel NOT NULL,
    changed_by uuid NOT NULL,
    changed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes text
);

CREATE TABLE crm.legacy_import_keys (
    source_key text NOT NULL,
    target_table text NOT NULL,
    target_id text,
    imported_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE crm.legacy_walkin_ingest_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    source_ip character varying(64),
    payload jsonb NOT NULL,
    payload_hash character varying(64),
    outcome character varying(40) NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE crm.legacy_walkin_ingest_rate_limits (
    bucket_start timestamp(0) with time zone NOT NULL,
    key_name character varying(80) NOT NULL,
    request_count integer DEFAULT 0 NOT NULL
);

CREATE TABLE crm.lookup_beverages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(160) NOT NULL,
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE crm.lookup_cities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(160) NOT NULL,
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE crm.lookup_communities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(160) NOT NULL,
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE crm.lookup_gifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(160) NOT NULL,
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE crm.lookup_not_bought_reasons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(160) NOT NULL,
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE crm.lookup_pincodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pincode character varying(12) NOT NULL,
    city character varying(160),
    state character varying(100),
    country character varying(100),
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE crm.lookup_product_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(160) NOT NULL,
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE crm.lookup_relations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(160) NOT NULL,
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE crm.lookup_snacks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(160) NOT NULL,
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE crm.lookup_source_of_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(160) NOT NULL,
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE crm.lookup_sugar_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(160) NOT NULL,
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE crm.not_bought_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    followup_id uuid NOT NULL,
    status character varying(80) NOT NULL,
    remark text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    previous_status character varying(80),
    call_response text,
    updated_by uuid
);

CREATE TABLE crm.referral_calling_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referral_calling_id uuid NOT NULL,
    status character varying(80) NOT NULL,
    previous_status character varying(80),
    call_response text,
    remark text,
    updated_by uuid,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    entered_by character varying(160),
    followup_date date,
    next_followup_date date,
    source character varying(80),
    request_key uuid
);

CREATE TABLE crm.users (
    id uuid NOT NULL,
    name character varying(160) NOT NULL,
    phone character varying(30),
    email character varying(320) NOT NULL,
    role crm.user_role NOT NULL,
    branch_id uuid,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT users_role_branch_check CHECK ((((role = 'super_admin'::crm.user_role) AND (branch_id IS NULL)) OR ((role <> 'super_admin'::crm.user_role) AND (branch_id IS NOT NULL))))
);

CREATE TABLE crm.visit_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_timeline_id uuid NOT NULL,
    companions jsonb DEFAULT '[]'::jsonb NOT NULL,
    category_details jsonb DEFAULT '{}'::jsonb NOT NULL,
    occupation character varying(120),
    occupation_other character varying(160),
    bridal_or_non_bridal character varying(40),
    wedding_month smallint,
    wedding_year smallint,
    communication_preference character varying(80),
    instagram_asked boolean,
    instagram_no_reason text,
    instagram_proof_url text,
    google_review_asked boolean,
    google_review_no_reason text,
    google_review_proof_url text,
    testimonial_asked boolean,
    testimonial_no_reason text,
    testimonial_proof_url text,
    thank_you_note_asked boolean,
    thank_you_note_no_reason text,
    thank_you_note_proof_url text,
    referrals_asked boolean,
    referrals_no_reason text,
    referrals_proof_url text,
    additional_fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    source_of_lead character varying(120),
    source_of_lead_other character varying(160),
    reference_name character varying(160),
    reference_phone character varying(30),
    client_type character varying(20),
    did_buy boolean,
    not_bought_reasons text[] DEFAULT ARRAY[]::text[] NOT NULL,
    not_bought_other text,
    repair_or_order_approach text,
    marketing_message_sent text,
    feedback_form_asked boolean,
    feedback_form_no_reason text,
    feedback_form_proof_url text,
    CONSTRAINT visit_forms_additional_fields_check CHECK ((jsonb_typeof(additional_fields) = 'object'::text)),
    CONSTRAINT visit_forms_category_details_check CHECK ((jsonb_typeof(category_details) = 'object'::text)),
    CONSTRAINT visit_forms_client_type_check CHECK (((client_type IS NULL) OR ((client_type)::text = ANY ((ARRAY['new'::character varying, 'existing'::character varying])::text[])))),
    CONSTRAINT visit_forms_companions_check CHECK (((jsonb_typeof(companions) = 'array'::text) AND (jsonb_array_length(companions) <= 10))),
    CONSTRAINT visit_forms_wedding_month_check CHECK (((wedding_month IS NULL) OR ((wedding_month >= 1) AND (wedding_month <= 12)))),
    CONSTRAINT visit_forms_wedding_year_check CHECK (((wedding_year IS NULL) OR ((wedding_year >= 2000) AND (wedding_year <= 2200))))
);

CREATE SEQUENCE crm.client_code_sequence
    START WITH 102726
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE crm.client_edit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE crm.client_code_sequence OWNED BY crm.clients.client_code;

ALTER SEQUENCE crm.client_edit_log_id_seq OWNED BY crm.client_edit_log.id;

ALTER TABLE ONLY crm.client_edit_log ALTER COLUMN id SET DEFAULT nextval('crm.client_edit_log_id_seq'::regclass);

ALTER TABLE ONLY crm.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.campaigns
    ADD CONSTRAINT campaigns_name_key UNIQUE (name);

ALTER TABLE ONLY crm.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.client_campaign_tags
    ADD CONSTRAINT client_campaign_tags_client_campaign_key UNIQUE (client_id, campaign_id);

ALTER TABLE ONLY crm.client_campaign_tags
    ADD CONSTRAINT client_campaign_tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.client_edit_log
    ADD CONSTRAINT client_edit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.client_phone_index
    ADD CONSTRAINT client_phone_index_pkey PRIMARY KEY (phone);

ALTER TABLE ONLY crm.client_timeline
    ADD CONSTRAINT client_timeline_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.clients
    ADD CONSTRAINT clients_client_code_key UNIQUE (client_code);

ALTER TABLE ONLY crm.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (client_id);

ALTER TABLE ONLY crm.crm_allocation
    ADD CONSTRAINT crm_allocation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.crm_daily_availability
    ADD CONSTRAINT crm_daily_availability_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.crm_queue_round_robin
    ADD CONSTRAINT crm_queue_round_robin_pkey PRIMARY KEY (branch_id);

ALTER TABLE ONLY crm.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.entry_queue
    ADD CONSTRAINT entry_queue_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lead_call_history
    ADD CONSTRAINT lead_call_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lead_form_field_options
    ADD CONSTRAINT lead_form_field_options_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lead_form_field_options
    ADD CONSTRAINT lead_form_field_options_unique UNIQUE (field_id, option_value);

ALTER TABLE ONLY crm.lead_form_fields
    ADD CONSTRAINT lead_form_fields_field_key_key UNIQUE (field_key);

ALTER TABLE ONLY crm.lead_form_fields
    ADD CONSTRAINT lead_form_fields_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lead_stage_history
    ADD CONSTRAINT lead_stage_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.leads
    ADD CONSTRAINT leads_phone_number_key UNIQUE (phone_number);

ALTER TABLE ONLY crm.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.legacy_import_keys
    ADD CONSTRAINT legacy_import_keys_pkey PRIMARY KEY (source_key);

ALTER TABLE ONLY crm.legacy_walkin_ingest_attempts
    ADD CONSTRAINT legacy_walkin_ingest_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.legacy_walkin_ingest_attempts
    ADD CONSTRAINT legacy_walkin_ingest_attempts_request_id_key UNIQUE (request_id);

ALTER TABLE ONLY crm.legacy_walkin_ingest_rate_limits
    ADD CONSTRAINT legacy_walkin_ingest_rate_limits_pkey PRIMARY KEY (bucket_start, key_name);

ALTER TABLE ONLY crm.lookup_beverages
    ADD CONSTRAINT lookup_beverages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lookup_cities
    ADD CONSTRAINT lookup_cities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lookup_communities
    ADD CONSTRAINT lookup_communities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lookup_gifts
    ADD CONSTRAINT lookup_gifts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lookup_not_bought_reasons
    ADD CONSTRAINT lookup_not_bought_reasons_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lookup_pincodes
    ADD CONSTRAINT lookup_pincodes_pincode_key UNIQUE (pincode);

ALTER TABLE ONLY crm.lookup_pincodes
    ADD CONSTRAINT lookup_pincodes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lookup_product_categories
    ADD CONSTRAINT lookup_product_categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lookup_relations
    ADD CONSTRAINT lookup_relations_label_key UNIQUE (label);

ALTER TABLE ONLY crm.lookup_relations
    ADD CONSTRAINT lookup_relations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lookup_snacks
    ADD CONSTRAINT lookup_snacks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lookup_source_of_leads
    ADD CONSTRAINT lookup_source_of_leads_label_key UNIQUE (label);

ALTER TABLE ONLY crm.lookup_source_of_leads
    ADD CONSTRAINT lookup_source_of_leads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.lookup_sugar_options
    ADD CONSTRAINT lookup_sugar_options_label_key UNIQUE (label);

ALTER TABLE ONLY crm.lookup_sugar_options
    ADD CONSTRAINT lookup_sugar_options_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.not_bought_followups
    ADD CONSTRAINT not_bought_followups_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.not_bought_history
    ADD CONSTRAINT not_bought_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.referral_calling_history
    ADD CONSTRAINT referral_calling_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.referral_calling
    ADD CONSTRAINT referral_calling_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.visit_forms
    ADD CONSTRAINT visit_forms_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX branches_name_key ON crm.branches USING btree (name);

CREATE INDEX campaigns_created_at_idx ON crm.campaigns USING btree (created_at DESC);

CREATE INDEX campaigns_created_by_idx ON crm.campaigns USING btree (created_by);

CREATE INDEX client_campaign_tags_campaign_tagged_at_idx ON crm.client_campaign_tags USING btree (campaign_id, tagged_at DESC);

CREATE INDEX client_campaign_tags_tagged_by_idx ON crm.client_campaign_tags USING btree (tagged_by);

CREATE INDEX client_edit_log_client_id_created_at_idx ON crm.client_edit_log USING btree (client_id, created_at DESC);

CREATE INDEX client_edit_log_edited_by_idx ON crm.client_edit_log USING btree (edited_by);

CREATE INDEX client_phone_index_client_id_idx ON crm.client_phone_index USING btree (client_id);

CREATE INDEX client_timeline_branch_id_event_date_idx ON crm.client_timeline USING btree (branch_id, event_date DESC);

CREATE INDEX client_timeline_client_id_event_date_idx ON crm.client_timeline USING btree (client_id, event_date DESC);

CREATE INDEX client_timeline_event_date_idx ON crm.client_timeline USING btree (event_date DESC);

CREATE UNIQUE INDEX client_timeline_id_client_id_key ON crm.client_timeline USING btree (id, client_id);

CREATE INDEX client_timeline_reference_number_idx ON crm.client_timeline USING btree (reference_number);

CREATE INDEX client_timeline_salesperson_id_event_date_idx ON crm.client_timeline USING btree (salesperson_id, event_date DESC);

CREATE INDEX clients_last_branch_id_last_visit_date_idx ON crm.clients USING btree (last_branch_id, last_visit_date);

CREATE INDEX clients_last_salesperson_id_idx ON crm.clients USING btree (last_salesperson_id);

CREATE INDEX clients_next_visit_date_idx ON crm.clients USING btree (next_visit_date);

CREATE INDEX clients_primary_phone_idx ON crm.clients USING btree (primary_phone);

CREATE INDEX clients_profile_updated_by_idx ON crm.clients USING btree (profile_updated_by);

CREATE INDEX crm_allocation_branch_id_active_idx ON crm.crm_allocation USING btree (branch_id, active);

CREATE UNIQUE INDEX crm_allocation_branch_id_crm_name_key ON crm.crm_allocation USING btree (branch_id, crm_name);

CREATE UNIQUE INDEX crm_daily_availability_branch_id_crm_name_date_key ON crm.crm_daily_availability USING btree (branch_id, crm_name, date);

CREATE INDEX crm_daily_availability_branch_id_date_is_available_idx ON crm.crm_daily_availability USING btree (branch_id, date, is_available);

CREATE INDEX documents_client_id_created_at_idx ON crm.documents USING btree (client_id, created_at DESC);

CREATE INDEX documents_client_timeline_id_idx ON crm.documents USING btree (client_timeline_id);

CREATE UNIQUE INDEX documents_storage_path_key ON crm.documents USING btree (storage_path);

CREATE INDEX documents_uploaded_by_idx ON crm.documents USING btree (uploaded_by);

CREATE INDEX entry_queue_branch_id_status_created_at_idx ON crm.entry_queue USING btree (branch_id, status, created_at);

CREATE INDEX entry_queue_client_id_idx ON crm.entry_queue USING btree (client_id);

CREATE UNIQUE INDEX entry_queue_token_key ON crm.entry_queue USING btree (token);

CREATE INDEX lead_call_history_entered_by_created_at_idx ON crm.lead_call_history USING btree (entered_by, created_at DESC);

CREATE INDEX lead_call_history_lead_created_at_idx ON crm.lead_call_history USING btree (lead_id, created_at DESC);

CREATE INDEX lead_stage_history_lead_changed_at_idx ON crm.lead_stage_history USING btree (lead_id, changed_at DESC);

CREATE INDEX leads_branch_created_at_idx ON crm.leads USING btree (branch_id, created_at DESC);

CREATE INDEX leads_created_by_created_at_idx ON crm.leads USING btree (created_by, created_at DESC);

CREATE INDEX legacy_import_keys_target_table_idx ON crm.legacy_import_keys USING btree (target_table, imported_at DESC);

CREATE INDEX legacy_walkin_ingest_attempts_created_at_idx ON crm.legacy_walkin_ingest_attempts USING btree (created_at DESC);

CREATE INDEX legacy_walkin_ingest_attempts_outcome_created_at_idx ON crm.legacy_walkin_ingest_attempts USING btree (outcome, created_at DESC);

CREATE INDEX lookup_beverages_active_label_idx ON crm.lookup_beverages USING btree (active, label);

CREATE UNIQUE INDEX lookup_beverages_label_key ON crm.lookup_beverages USING btree (label);

CREATE UNIQUE INDEX lookup_beverages_label_normalized_key ON crm.lookup_beverages USING btree (upper(btrim((label)::text)));

CREATE INDEX lookup_cities_active_label_idx ON crm.lookup_cities USING btree (active, label);

CREATE UNIQUE INDEX lookup_cities_label_key ON crm.lookup_cities USING btree (label);

CREATE INDEX lookup_communities_active_label_idx ON crm.lookup_communities USING btree (active, label);

CREATE UNIQUE INDEX lookup_communities_label_key ON crm.lookup_communities USING btree (label);

CREATE UNIQUE INDEX lookup_communities_label_normalized_key ON crm.lookup_communities USING btree (upper(btrim((label)::text)));

CREATE INDEX lookup_gifts_active_label_idx ON crm.lookup_gifts USING btree (active, label);

CREATE UNIQUE INDEX lookup_gifts_label_key ON crm.lookup_gifts USING btree (label);

CREATE UNIQUE INDEX lookup_gifts_label_normalized_key ON crm.lookup_gifts USING btree (upper(btrim((label)::text)));

CREATE INDEX lookup_not_bought_reasons_active_label_idx ON crm.lookup_not_bought_reasons USING btree (active, label);

CREATE UNIQUE INDEX lookup_not_bought_reasons_label_key ON crm.lookup_not_bought_reasons USING btree (label);

CREATE UNIQUE INDEX lookup_not_bought_reasons_label_normalized_key ON crm.lookup_not_bought_reasons USING btree (upper(btrim((label)::text)));

CREATE INDEX lookup_pincodes_active_pincode_idx ON crm.lookup_pincodes USING btree (active, pincode);

CREATE INDEX lookup_pincodes_city_idx ON crm.lookup_pincodes USING btree (city);

CREATE INDEX lookup_product_categories_active_label_idx ON crm.lookup_product_categories USING btree (active, label);

CREATE UNIQUE INDEX lookup_product_categories_label_key ON crm.lookup_product_categories USING btree (label);

CREATE UNIQUE INDEX lookup_product_categories_label_normalized_key ON crm.lookup_product_categories USING btree (upper(btrim((label)::text)));

CREATE INDEX lookup_relations_active_label_idx ON crm.lookup_relations USING btree (active, label);

CREATE UNIQUE INDEX lookup_relations_label_normalized_key ON crm.lookup_relations USING btree (upper(btrim((label)::text)));

CREATE INDEX lookup_snacks_active_label_idx ON crm.lookup_snacks USING btree (active, label);

CREATE UNIQUE INDEX lookup_snacks_label_key ON crm.lookup_snacks USING btree (label);

CREATE UNIQUE INDEX lookup_snacks_label_normalized_key ON crm.lookup_snacks USING btree (upper(btrim((label)::text)));

CREATE INDEX lookup_source_of_leads_active_label_idx ON crm.lookup_source_of_leads USING btree (active, label);

CREATE UNIQUE INDEX lookup_source_of_leads_label_normalized_key ON crm.lookup_source_of_leads USING btree (upper(btrim((label)::text)));

CREATE INDEX lookup_sugar_options_active_label_idx ON crm.lookup_sugar_options USING btree (active, label);

CREATE UNIQUE INDEX lookup_sugar_options_label_normalized_key ON crm.lookup_sugar_options USING btree (upper(btrim((label)::text)));

CREATE INDEX not_bought_followups_branch_status_date_idx ON crm.not_bought_followups USING btree (branch_id, status, next_followup_date);

CREATE INDEX not_bought_followups_client_id_created_at_idx ON crm.not_bought_followups USING btree (client_id, created_at DESC);

CREATE INDEX not_bought_followups_created_at_idx ON crm.not_bought_followups USING btree (created_at DESC);

CREATE INDEX not_bought_followups_entered_by_idx ON crm.not_bought_followups USING btree (entered_by);

CREATE INDEX not_bought_followups_reference_number_idx ON crm.not_bought_followups USING btree (reference_number);

CREATE INDEX not_bought_followups_source_timeline_id_idx ON crm.not_bought_followups USING btree (source_timeline_id);

CREATE INDEX not_bought_followups_source_visit_form_id_idx ON crm.not_bought_followups USING btree (source_visit_form_id);

CREATE INDEX not_bought_followups_status_next_followup_date_idx ON crm.not_bought_followups USING btree (status, next_followup_date);

CREATE INDEX not_bought_history_followup_id_created_at_idx ON crm.not_bought_history USING btree (followup_id, created_at DESC);

CREATE INDEX not_bought_history_updated_by_idx ON crm.not_bought_history USING btree (updated_by);

CREATE INDEX referral_calling_converted_client_id_idx ON crm.referral_calling USING btree (converted_client_id);

CREATE INDEX referral_calling_created_at_idx ON crm.referral_calling USING btree (created_at DESC);

CREATE INDEX referral_calling_history_calling_created_at_idx ON crm.referral_calling_history USING btree (referral_calling_id, created_at DESC);

CREATE UNIQUE INDEX referral_calling_history_request_key ON crm.referral_calling_history USING btree (referral_calling_id, request_key) WHERE (request_key IS NOT NULL);

CREATE INDEX referral_calling_history_updated_by_idx ON crm.referral_calling_history USING btree (updated_by);

CREATE UNIQUE INDEX referral_calling_one_row_per_referral_key ON crm.referral_calling USING btree (referral_id);

CREATE INDEX referral_calling_referral_id_created_at_idx ON crm.referral_calling USING btree (referral_id, created_at DESC);

CREATE INDEX referral_calling_status_next_followup_date_idx ON crm.referral_calling USING btree (status, next_followup_date);

CREATE INDEX referrals_assigned_doer_idx ON crm.referrals USING btree (assigned_doer) WHERE (assigned_doer IS NOT NULL);

CREATE INDEX referrals_branch_id_created_at_idx ON crm.referrals USING btree (branch_id, created_at DESC);

CREATE INDEX referrals_given_by_client_id_idx ON crm.referrals USING btree (given_by_client_id);

CREATE INDEX referrals_referral_number_idx ON crm.referrals USING btree (referral_number);

CREATE INDEX referrals_salesperson_id_created_at_idx ON crm.referrals USING btree (salesperson_id, created_at DESC);

CREATE INDEX referrals_source_timeline_id_idx ON crm.referrals USING btree (source_timeline_id);

CREATE INDEX referrals_source_visit_form_id_idx ON crm.referrals USING btree (source_visit_form_id);

CREATE INDEX users_branch_id_idx ON crm.users USING btree (branch_id);

CREATE UNIQUE INDEX users_email_key ON crm.users USING btree (email);

CREATE INDEX users_role_active_idx ON crm.users USING btree (role, active);

CREATE INDEX visit_forms_bridal_or_non_bridal_wedding_year_wedding_month_idx ON crm.visit_forms USING btree (bridal_or_non_bridal, wedding_year, wedding_month);

CREATE UNIQUE INDEX visit_forms_client_timeline_id_key ON crm.visit_forms USING btree (client_timeline_id);

CREATE INDEX visit_forms_client_type_idx ON crm.visit_forms USING btree (client_type);

CREATE INDEX visit_forms_did_buy_idx ON crm.visit_forms USING btree (did_buy);

CREATE INDEX visit_forms_occupation_idx ON crm.visit_forms USING btree (occupation);

ALTER TABLE ONLY crm.campaigns
    ADD CONSTRAINT campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES crm.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY crm.client_campaign_tags
    ADD CONSTRAINT client_campaign_tags_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES crm.campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY crm.client_campaign_tags
    ADD CONSTRAINT client_campaign_tags_client_id_fkey FOREIGN KEY (client_id) REFERENCES crm.clients(client_id) ON DELETE CASCADE;

ALTER TABLE ONLY crm.client_campaign_tags
    ADD CONSTRAINT client_campaign_tags_tagged_by_fkey FOREIGN KEY (tagged_by) REFERENCES crm.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY crm.client_edit_log
    ADD CONSTRAINT client_edit_log_client_id_fkey FOREIGN KEY (client_id) REFERENCES crm.clients(client_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY crm.client_edit_log
    ADD CONSTRAINT client_edit_log_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES crm.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY crm.client_phone_index
    ADD CONSTRAINT client_phone_index_client_id_fkey FOREIGN KEY (client_id) REFERENCES crm.clients(client_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY crm.client_timeline
    ADD CONSTRAINT client_timeline_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES crm.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY crm.client_timeline
    ADD CONSTRAINT client_timeline_client_id_fkey FOREIGN KEY (client_id) REFERENCES crm.clients(client_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY crm.client_timeline
    ADD CONSTRAINT client_timeline_salesperson_id_fkey FOREIGN KEY (salesperson_id) REFERENCES crm.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY crm.clients
    ADD CONSTRAINT clients_last_branch_id_fkey FOREIGN KEY (last_branch_id) REFERENCES crm.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY crm.clients
    ADD CONSTRAINT clients_last_salesperson_id_fkey FOREIGN KEY (last_salesperson_id) REFERENCES crm.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY crm.clients
    ADD CONSTRAINT clients_profile_updated_by_fkey FOREIGN KEY (profile_updated_by) REFERENCES crm.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY crm.crm_allocation
    ADD CONSTRAINT crm_allocation_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES crm.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY crm.crm_daily_availability
    ADD CONSTRAINT crm_daily_availability_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES crm.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY crm.crm_queue_round_robin
    ADD CONSTRAINT crm_queue_round_robin_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES crm.branches(id) ON DELETE CASCADE;

ALTER TABLE ONLY crm.documents
    ADD CONSTRAINT documents_client_id_fkey FOREIGN KEY (client_id) REFERENCES crm.clients(client_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY crm.documents
    ADD CONSTRAINT documents_client_timeline_id_client_id_fkey FOREIGN KEY (client_timeline_id, client_id) REFERENCES crm.client_timeline(id, client_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY crm.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES crm.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY crm.entry_queue
    ADD CONSTRAINT entry_queue_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES crm.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY crm.entry_queue
    ADD CONSTRAINT entry_queue_client_id_fkey FOREIGN KEY (client_id) REFERENCES crm.clients(client_id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY crm.lead_call_history
    ADD CONSTRAINT lead_call_history_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES crm.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY crm.lead_call_history
    ADD CONSTRAINT lead_call_history_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES crm.leads(id) ON DELETE CASCADE;

ALTER TABLE ONLY crm.lead_form_field_options
    ADD CONSTRAINT lead_form_field_options_field_id_fkey FOREIGN KEY (field_id) REFERENCES crm.lead_form_fields(id) ON DELETE CASCADE;

ALTER TABLE ONLY crm.lead_form_field_options
    ADD CONSTRAINT lead_form_field_options_triggers_field_key_fkey FOREIGN KEY (triggers_field_key) REFERENCES crm.lead_form_fields(field_key) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE ONLY crm.lead_form_fields
    ADD CONSTRAINT lead_form_fields_parent_field_key_fkey FOREIGN KEY (parent_field_key) REFERENCES crm.lead_form_fields(field_key) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE ONLY crm.lead_stage_history
    ADD CONSTRAINT lead_stage_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES crm.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY crm.lead_stage_history
    ADD CONSTRAINT lead_stage_history_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES crm.leads(id) ON DELETE CASCADE;

ALTER TABLE ONLY crm.leads
    ADD CONSTRAINT leads_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES crm.branches(id) ON DELETE SET NULL;

ALTER TABLE ONLY crm.leads
    ADD CONSTRAINT leads_converted_to_client_id_fkey FOREIGN KEY (converted_to_client_id) REFERENCES crm.clients(client_id) ON DELETE SET NULL;

ALTER TABLE ONLY crm.leads
    ADD CONSTRAINT leads_created_by_fkey FOREIGN KEY (created_by) REFERENCES crm.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY crm.not_bought_followups
    ADD CONSTRAINT not_bought_followups_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES crm.branches(id) ON DELETE RESTRICT;

ALTER TABLE ONLY crm.not_bought_followups
    ADD CONSTRAINT not_bought_followups_client_id_fkey FOREIGN KEY (client_id) REFERENCES crm.clients(client_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY crm.not_bought_followups
    ADD CONSTRAINT not_bought_followups_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES crm.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY crm.not_bought_followups
    ADD CONSTRAINT not_bought_followups_source_timeline_id_fkey FOREIGN KEY (source_timeline_id) REFERENCES crm.client_timeline(id) ON DELETE SET NULL;

ALTER TABLE ONLY crm.not_bought_followups
    ADD CONSTRAINT not_bought_followups_source_visit_form_id_fkey FOREIGN KEY (source_visit_form_id) REFERENCES crm.visit_forms(id) ON DELETE SET NULL;

ALTER TABLE ONLY crm.not_bought_history
    ADD CONSTRAINT not_bought_history_followup_id_fkey FOREIGN KEY (followup_id) REFERENCES crm.not_bought_followups(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY crm.not_bought_history
    ADD CONSTRAINT not_bought_history_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES crm.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY crm.referral_calling
    ADD CONSTRAINT referral_calling_converted_client_id_fkey FOREIGN KEY (converted_client_id) REFERENCES crm.clients(client_id) ON DELETE SET NULL;

ALTER TABLE ONLY crm.referral_calling_history
    ADD CONSTRAINT referral_calling_history_referral_calling_id_fkey FOREIGN KEY (referral_calling_id) REFERENCES crm.referral_calling(id) ON DELETE CASCADE;

ALTER TABLE ONLY crm.referral_calling_history
    ADD CONSTRAINT referral_calling_history_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES crm.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY crm.referral_calling
    ADD CONSTRAINT referral_calling_referral_id_fkey FOREIGN KEY (referral_id) REFERENCES crm.referrals(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY crm.referrals
    ADD CONSTRAINT referrals_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES crm.branches(id) ON DELETE RESTRICT;

ALTER TABLE ONLY crm.referrals
    ADD CONSTRAINT referrals_given_by_client_id_fkey FOREIGN KEY (given_by_client_id) REFERENCES crm.clients(client_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY crm.referrals
    ADD CONSTRAINT referrals_salesperson_id_fkey FOREIGN KEY (salesperson_id) REFERENCES crm.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY crm.referrals
    ADD CONSTRAINT referrals_source_timeline_id_fkey FOREIGN KEY (source_timeline_id) REFERENCES crm.client_timeline(id) ON DELETE SET NULL;

ALTER TABLE ONLY crm.referrals
    ADD CONSTRAINT referrals_source_visit_form_id_fkey FOREIGN KEY (source_visit_form_id) REFERENCES crm.visit_forms(id) ON DELETE SET NULL;

ALTER TABLE ONLY crm.users
    ADD CONSTRAINT users_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES crm.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY crm.visit_forms
    ADD CONSTRAINT visit_forms_client_timeline_id_fkey FOREIGN KEY (client_timeline_id) REFERENCES crm.client_timeline(id) ON UPDATE CASCADE ON DELETE CASCADE;
