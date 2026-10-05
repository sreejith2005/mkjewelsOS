-- CRM project upgrade 4/5: minimal grants, as in the JewelOS port (0186/0190).
--
-- The CRM project still had Supabase's default grants: anon and authenticated had every
-- privilege, including TRUNCATE, on every public table. RLS guarded rows, but once JewelOS
-- ships this project's anon key, the port's minimal grants are the contract:
-- - authenticated gets only what the ported UI uses (tables, column-level grants,
--   sequences, functions);
-- - anon gets nothing;
-- - service_role (the login bridge and sync receivers) is unchanged.
-- Generated from the port's catalog (schema crm -> public). Tables that exist only in the CRM
-- project (_prisma_migrations, crm_sso_access_grants, crm_sso_access_audit) keep no
-- anon/authenticated access.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

GRANT DELETE, SELECT ON TABLE public.branches TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.campaigns TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.client_campaign_tags TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.client_edit_log TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.client_phone_index TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.client_timeline TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.clients TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.crm_allocation TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.crm_daily_availability TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.documents TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.entry_queue TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE public.lead_call_history TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lead_form_field_options TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lead_form_fields TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lead_stage_history TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.leads TO authenticated;
GRANT SELECT ON TABLE public.legacy_walkin_ingest_attempts TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lookup_beverages TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lookup_cities TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lookup_communities TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lookup_gifts TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lookup_not_bought_reasons TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lookup_pincodes TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lookup_product_categories TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lookup_relations TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lookup_snacks TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lookup_source_of_leads TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.lookup_sugar_options TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.not_bought_followups TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.not_bought_history TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.referral_calling TO authenticated;
GRANT INSERT, SELECT ON TABLE public.referral_calling_history TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.referrals TO authenticated;
GRANT DELETE, SELECT ON TABLE public.users TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.visit_forms TO authenticated;
-- column-level grants
GRANT INSERT (active, address, created_at, id, name) ON TABLE public.branches TO authenticated;
GRANT UPDATE (active, address, created_at, id, name) ON TABLE public.branches TO authenticated;
GRANT INSERT (active, branch_id, created_at, email, id, name, phone, role) ON TABLE public.users TO authenticated;
GRANT UPDATE (active, branch_id, created_at, email, id, name, phone, role) ON TABLE public.users TO authenticated;

GRANT SELECT, USAGE ON SEQUENCE public.client_edit_log_id_seq TO authenticated;
GRANT SELECT, USAGE ON SEQUENCE public.client_code_sequence TO authenticated;

-- Function execute rights follow the port's ACL for every function present in both.
REVOKE ALL ON FUNCTION public.assign_client_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_next_available_crm(p_branch_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_next_available_crm(p_branch_id uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.audit_client_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.browse_clients(search_text text, page_offset integer, result_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.browse_clients(search_text text, page_offset integer, result_limit integer) TO authenticated;
REVOKE ALL ON FUNCTION public.browse_clients(search_text text, potential_category text, page_offset integer, result_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.browse_clients(search_text text, potential_category text, page_offset integer, result_limit integer) TO authenticated;
REVOKE ALL ON FUNCTION public.consume_legacy_walkin_ingest_rate_limit(p_key_name text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.convert_referral_to_client(p_referral_calling_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_referral_to_client(p_referral_calling_id uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_client_with_phone(p_primary_name text, p_primary_phone text, p_gender text, p_branch_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_client_with_phone(p_primary_name text, p_primary_phone text, p_gender text, p_branch_id uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_entry_queue(p_client_name text, p_mobile text, p_branch_id uuid, p_assigned_crm_name text, p_client_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_entry_queue(p_client_name text, p_mobile text, p_branch_id uuid, p_assigned_crm_name text, p_client_id uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_manual_referral(p_client_id uuid, p_referral_name text, p_referral_number text, p_crm_name text, p_branch_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_referral(p_client_id uuid, p_referral_name text, p_referral_number text, p_crm_name text, p_branch_id uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_manual_referral(p_client_id uuid, p_referral_name text, p_referral_number text, p_crm_name text, p_branch_id uuid, p_relationship text, p_best_time_to_call text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_referral(p_client_id uuid, p_referral_name text, p_referral_number text, p_crm_name text, p_branch_id uuid, p_relationship text, p_best_time_to_call text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_not_bought_followup_from_visit_form() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_referral_calling_if_open(p_referral_id uuid, p_name text, p_number text, p_next_date date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_referral_calling_if_open(p_referral_id uuid, p_name text, p_number text, p_next_date date) TO authenticated;
REVOKE ALL ON FUNCTION public.create_referral_from_visit_form() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_crm_user_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_crm_user_id() TO authenticated;
REVOKE ALL ON FUNCTION public.current_user_branch_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_branch_id() TO authenticated;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
REVOKE ALL ON FUNCTION public.dedupe_category_array(p_values text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dedupe_category_array(p_values text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.dedupe_category_array_columns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
REVOKE ALL ON FUNCTION public.is_branch_manager(row_branch_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_branch_manager(row_branch_id uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.is_branch_staff(row_branch_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_branch_staff(row_branch_id uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
REVOKE ALL ON FUNCTION public.is_user_in_current_branch(row_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_in_current_branch(row_user_id uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.legacy_call_outcome_status(p_outcome text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.legacy_call_outcome_status(p_outcome text) TO authenticated;
REVOKE ALL ON FUNCTION public.legacy_status_is_done(p_status text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.legacy_status_is_done(p_status text) TO authenticated;
REVOKE ALL ON FUNCTION public.lookup_client_by_phone(p_phone text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_client_by_phone(p_phone text) TO authenticated;
REVOKE ALL ON FUNCTION public.manage_crm_roster(p_operation text, p_roster_id uuid, p_branch_id uuid, p_crm_name text, p_target_branch_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_crm_roster(p_operation text, p_roster_id uuid, p_branch_id uuid, p_crm_name text, p_target_branch_id uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.next_business_day(p_date date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_business_day(p_date date) TO authenticated;
REVOKE ALL ON FUNCTION public.normalize_client_phone_index() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_crm_roster_value(value text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_crm_roster_value(value text) TO authenticated;
REVOKE ALL ON FUNCTION public.normalize_lookup_label() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.not_bought_followup_status_is_done(p_status text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.not_bought_followup_status_is_done(p_status text) TO authenticated;
REVOKE ALL ON FUNCTION public.prevent_not_bought_history_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_client_rollups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_referral_calling_conversions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_referral_calling_conversions() TO authenticated;
REVOKE ALL ON FUNCTION public.record_not_bought_followup_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_referral_calling_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_not_bought_followup(p_followup_id uuid, p_followup_status text, p_call_response text, p_next_followup_date date, p_remark text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_not_bought_followup(p_followup_id uuid, p_followup_status text, p_call_response text, p_next_followup_date date, p_remark text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_referral_followup(p_referral_calling_id uuid, p_followup_status text, p_call_response text, p_next_followup_date date, p_remark text, p_entered_by text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_referral_followup(p_referral_calling_id uuid, p_followup_status text, p_call_response text, p_next_followup_date date, p_remark text, p_entered_by text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_referral_followup(p_referral_calling_id uuid, p_followup_status text, p_call_response text, p_next_followup_date date, p_remark text, p_entered_by text, p_request_key uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_referral_followup(p_referral_calling_id uuid, p_followup_status text, p_call_response text, p_next_followup_date date, p_remark text, p_entered_by text, p_request_key uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.search_clients(search_text text, result_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_clients(search_text text, result_limit integer) TO authenticated;
REVOKE ALL ON FUNCTION public.set_client_profile_editor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_lead_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_legacy_walkin_visit(p_payload jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_walkin_visit(p_payload jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_walkin_visit(p_payload jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_client_phone_index() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_not_bought_followups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_not_bought_followups() TO authenticated;
REVOKE ALL ON FUNCTION public.update_not_bought_followup(p_followup_id uuid, p_call_response text, p_remark text, p_next_followup_date date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_not_bought_followup(p_followup_id uuid, p_call_response text, p_remark text, p_next_followup_date date) TO authenticated;
REVOKE ALL ON FUNCTION public.update_not_bought_reason(p_followup_id uuid, p_reasons text[], p_other text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_not_bought_reason(p_followup_id uuid, p_reasons text[], p_other text) TO authenticated;
REVOKE ALL ON FUNCTION public.update_referral_calling(p_referral_calling_id uuid, p_call_response text, p_remark text, p_next_followup_date date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_referral_calling(p_referral_calling_id uuid, p_call_response text, p_remark text, p_next_followup_date date) TO authenticated;
REVOKE ALL ON FUNCTION public.validate_client_potential_category() FROM PUBLIC, anon, authenticated;

-- New objects created by later migrations get no implicit anon/authenticated access; each
-- migration grants what it needs explicitly (AGENTS.md, minimal grants).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
