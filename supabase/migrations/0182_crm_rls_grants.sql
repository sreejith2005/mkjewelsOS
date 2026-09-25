-- Original CRM row-level security and privileges in schema crm.
-- Policies are the final original set with two non-semantic/bridge edits:
--   * auth.uid() comparisons (the acting CRM user) read crm.current_crm_user_id();
--   * argument-free identity helpers are wrapped in (select ...) so Postgres evaluates
--     them once per statement instead of once per row (same result).
-- Additions required by JewelOS (AGENTS.md authorization map): a restrictive
-- module_accessible('crm') SELECT policy on every crm table, and explicit minimal
-- grants to authenticated only (the original relied on Supabase public-schema defaults).

ALTER TABLE crm.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.client_campaign_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.client_edit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.client_phone_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.client_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.crm_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.crm_daily_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.crm_queue_round_robin ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.entry_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_call_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_form_field_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.legacy_walkin_ingest_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.legacy_walkin_ingest_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lookup_beverages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lookup_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lookup_communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lookup_gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lookup_not_bought_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lookup_pincodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lookup_product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lookup_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lookup_snacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lookup_source_of_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lookup_sugar_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.not_bought_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.not_bought_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.referral_calling ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.referral_calling_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.visit_forms ENABLE ROW LEVEL SECURITY;
-- Hardening: the original import ledger had no RLS. No role other than the owner uses it.
ALTER TABLE crm.legacy_import_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY active_staff_apply_campaign_tags ON crm.client_campaign_tags FOR INSERT TO authenticated WITH CHECK ((((select crm.current_user_role()) IS NOT NULL) AND (tagged_by = (select crm.current_crm_user_id()))));

CREATE POLICY active_staff_create_own_lead_call_history ON crm.lead_call_history FOR INSERT TO authenticated WITH CHECK ((((select crm.current_user_role()) IS NOT NULL) AND (entered_by = (select crm.current_crm_user_id()))));

CREATE POLICY active_staff_create_own_lead_history ON crm.lead_stage_history FOR INSERT TO authenticated WITH CHECK ((((select crm.current_user_role()) IS NOT NULL) AND (changed_by = (select crm.current_crm_user_id()))));

CREATE POLICY active_staff_create_own_leads ON crm.leads FOR INSERT TO authenticated WITH CHECK ((((select crm.current_user_role()) IS NOT NULL) AND (created_by = (select crm.current_crm_user_id()))));

CREATE POLICY active_staff_delete_phone_index ON crm.client_phone_index FOR DELETE TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_insert_clients ON crm.clients FOR INSERT TO authenticated WITH CHECK (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_insert_documents ON crm.documents FOR INSERT TO authenticated WITH CHECK ((((select crm.current_user_role()) IS NOT NULL) AND (uploaded_by = (select crm.current_crm_user_id()))));

CREATE POLICY active_staff_insert_phone_index ON crm.client_phone_index FOR INSERT TO authenticated WITH CHECK (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_branches ON crm.branches FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_campaign_tags ON crm.client_campaign_tags FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_campaigns ON crm.campaigns FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_client_edit_log ON crm.client_edit_log FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_clients ON crm.clients FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_documents ON crm.documents FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_followup_history ON crm.not_bought_history FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_followups ON crm.not_bought_followups FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_lead_call_history ON crm.lead_call_history FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_lead_field_options ON crm.lead_form_field_options FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_lead_fields ON crm.lead_form_fields FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_lead_stage_history ON crm.lead_stage_history FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_leads ON crm.leads FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_lookup_relations ON crm.lookup_relations FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_lookup_source_of_leads ON crm.lookup_source_of_leads FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_lookup_sugar_options ON crm.lookup_sugar_options FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_phone_index ON crm.client_phone_index FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_referral_calling ON crm.referral_calling FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_referral_calling_history ON crm.referral_calling_history FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_referrals ON crm.referrals FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_timeline ON crm.client_timeline FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_users ON crm.users FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_read_visit_forms ON crm.visit_forms FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_update_clients ON crm.clients FOR UPDATE TO authenticated USING (((select crm.current_user_role()) IS NOT NULL)) WITH CHECK (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_staff_update_phone_index ON crm.client_phone_index FOR UPDATE TO authenticated USING (((select crm.current_user_role()) IS NOT NULL)) WITH CHECK (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_users_read_lookup_beverages ON crm.lookup_beverages FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_users_read_lookup_cities ON crm.lookup_cities FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_users_read_lookup_communities ON crm.lookup_communities FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_users_read_lookup_gifts ON crm.lookup_gifts FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_users_read_lookup_not_bought_reasons ON crm.lookup_not_bought_reasons FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_users_read_lookup_pincodes ON crm.lookup_pincodes FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_users_read_lookup_product_categories ON crm.lookup_product_categories FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY active_users_read_lookup_snacks ON crm.lookup_snacks FOR SELECT TO authenticated USING (((select crm.current_user_role()) IS NOT NULL));

CREATE POLICY branch_manager_delete_own_availability ON crm.crm_daily_availability FOR DELETE TO authenticated USING (crm.is_branch_manager(branch_id));

CREATE POLICY branch_manager_own_branch ON crm.branches TO authenticated USING (crm.is_branch_manager(id)) WITH CHECK (crm.is_branch_manager(id));

CREATE POLICY branch_manager_own_users ON crm.users TO authenticated USING (crm.is_branch_manager(branch_id)) WITH CHECK (crm.is_branch_manager(branch_id));

CREATE POLICY branch_manager_update_own_allocations ON crm.crm_allocation FOR UPDATE TO authenticated USING (crm.is_branch_manager(branch_id)) WITH CHECK (crm.is_branch_manager(branch_id));

CREATE POLICY branch_manager_update_own_availability ON crm.crm_daily_availability FOR UPDATE TO authenticated USING (crm.is_branch_manager(branch_id)) WITH CHECK (crm.is_branch_manager(branch_id));

CREATE POLICY branch_manager_write_own_allocations ON crm.crm_allocation FOR INSERT TO authenticated WITH CHECK (crm.is_branch_manager(branch_id));

CREATE POLICY branch_manager_write_own_availability ON crm.crm_daily_availability FOR INSERT TO authenticated WITH CHECK (crm.is_branch_manager(branch_id));

CREATE POLICY branch_staff_delete_origin_followups ON crm.not_bought_followups FOR DELETE TO authenticated USING (crm.is_branch_staff(branch_id));

CREATE POLICY branch_staff_delete_origin_referral_calling ON crm.referral_calling FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm.referrals referral
  WHERE ((referral.id = referral_calling.referral_id) AND crm.is_branch_staff(referral.branch_id)))));

CREATE POLICY branch_staff_delete_origin_referrals ON crm.referrals FOR DELETE TO authenticated USING (crm.is_branch_staff(branch_id));

CREATE POLICY branch_staff_delete_own_timeline ON crm.client_timeline FOR DELETE TO authenticated USING (crm.is_branch_staff(branch_id));

CREATE POLICY branch_staff_delete_own_visit_forms ON crm.visit_forms FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm.client_timeline timeline
  WHERE ((timeline.id = visit_forms.client_timeline_id) AND crm.is_branch_staff(timeline.branch_id)))));

CREATE POLICY branch_staff_entry_queue ON crm.entry_queue TO authenticated USING (crm.is_branch_staff(branch_id)) WITH CHECK (crm.is_branch_staff(branch_id));

CREATE POLICY branch_staff_insert_origin_followup_history ON crm.not_bought_history FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM crm.not_bought_followups followup
  WHERE ((followup.id = not_bought_history.followup_id) AND crm.is_branch_staff(followup.branch_id)))));

CREATE POLICY branch_staff_insert_origin_followups ON crm.not_bought_followups FOR INSERT TO authenticated WITH CHECK (crm.is_branch_staff(branch_id));

CREATE POLICY branch_staff_insert_origin_referral_calling ON crm.referral_calling FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM crm.referrals referral
  WHERE ((referral.id = referral_calling.referral_id) AND crm.is_branch_staff(referral.branch_id)))));

CREATE POLICY branch_staff_insert_origin_referrals ON crm.referrals FOR INSERT TO authenticated WITH CHECK (crm.is_branch_staff(branch_id));

CREATE POLICY branch_staff_insert_own_timeline ON crm.client_timeline FOR INSERT TO authenticated WITH CHECK (crm.is_branch_staff(branch_id));

CREATE POLICY branch_staff_insert_own_visit_forms ON crm.visit_forms FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM crm.client_timeline timeline
  WHERE ((timeline.id = visit_forms.client_timeline_id) AND crm.is_branch_staff(timeline.branch_id)))));

CREATE POLICY branch_staff_insert_referral_calling_history ON crm.referral_calling_history FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (crm.referral_calling calling
     JOIN crm.referrals referral ON ((referral.id = calling.referral_id)))
  WHERE ((calling.id = referral_calling_history.referral_calling_id) AND crm.is_branch_staff(referral.branch_id)))));

CREATE POLICY branch_staff_read_own_allocations ON crm.crm_allocation FOR SELECT TO authenticated USING (crm.is_branch_staff(branch_id));

CREATE POLICY branch_staff_read_own_availability ON crm.crm_daily_availability FOR SELECT TO authenticated USING (crm.is_branch_staff(branch_id));

CREATE POLICY branch_staff_update_origin_followups ON crm.not_bought_followups FOR UPDATE TO authenticated USING (crm.is_branch_staff(branch_id)) WITH CHECK (crm.is_branch_staff(branch_id));

CREATE POLICY branch_staff_update_origin_referral_calling ON crm.referral_calling FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm.referrals referral
  WHERE ((referral.id = referral_calling.referral_id) AND crm.is_branch_staff(referral.branch_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM crm.referrals referral
  WHERE ((referral.id = referral_calling.referral_id) AND crm.is_branch_staff(referral.branch_id)))));

CREATE POLICY branch_staff_update_origin_referrals ON crm.referrals FOR UPDATE TO authenticated USING (crm.is_branch_staff(branch_id)) WITH CHECK (crm.is_branch_staff(branch_id));

CREATE POLICY branch_staff_update_own_timeline ON crm.client_timeline FOR UPDATE TO authenticated USING (crm.is_branch_staff(branch_id)) WITH CHECK (crm.is_branch_staff(branch_id));

CREATE POLICY branch_staff_update_own_visit_forms ON crm.visit_forms FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm.client_timeline timeline
  WHERE ((timeline.id = visit_forms.client_timeline_id) AND crm.is_branch_staff(timeline.branch_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM crm.client_timeline timeline
  WHERE ((timeline.id = visit_forms.client_timeline_id) AND crm.is_branch_staff(timeline.branch_id)))));

CREATE POLICY creator_or_admin_update_leads ON crm.leads FOR UPDATE TO authenticated USING (((created_by = (select crm.current_crm_user_id())) OR (select crm.is_super_admin()))) WITH CHECK (((created_by = (select crm.current_crm_user_id())) OR (select crm.is_super_admin())));

CREATE POLICY entered_by_or_admin_update_lead_call_history ON crm.lead_call_history FOR UPDATE TO authenticated USING (((entered_by = (select crm.current_crm_user_id())) OR (select crm.is_super_admin()))) WITH CHECK (((entered_by = (select crm.current_crm_user_id())) OR (select crm.is_super_admin())));

CREATE POLICY super_admin_all ON crm.branches TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.campaigns TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.client_campaign_tags TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.client_edit_log TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.client_phone_index TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.client_timeline TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.clients TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.crm_allocation TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.crm_daily_availability TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.documents TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.entry_queue TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.lookup_beverages TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.lookup_cities TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.lookup_communities TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.lookup_gifts TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.lookup_not_bought_reasons TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.lookup_pincodes TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.lookup_product_categories TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.lookup_snacks TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.not_bought_followups TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.not_bought_history TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.referral_calling TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.referral_calling_history TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.referrals TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.users TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_all ON crm.visit_forms TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_delete_leads ON crm.leads FOR DELETE TO authenticated USING ((select crm.is_super_admin()));

CREATE POLICY super_admin_manage_lead_field_options ON crm.lead_form_field_options TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_manage_lead_fields ON crm.lead_form_fields TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_manage_lookup_relations ON crm.lookup_relations TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_manage_lookup_source_of_leads ON crm.lookup_source_of_leads TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_manage_lookup_sugar_options ON crm.lookup_sugar_options TO authenticated USING ((select crm.is_super_admin())) WITH CHECK ((select crm.is_super_admin()));

CREATE POLICY super_admin_read_legacy_walkin_ingest_attempts ON crm.legacy_walkin_ingest_attempts FOR SELECT TO authenticated USING ((select crm.is_super_admin()));

CREATE POLICY tagger_delete_own_campaign_tags ON crm.client_campaign_tags FOR DELETE TO authenticated USING ((tagged_by = (select crm.current_crm_user_id())));

CREATE POLICY tagger_update_own_campaign_tags ON crm.client_campaign_tags FOR UPDATE TO authenticated USING ((tagged_by = (select crm.current_crm_user_id()))) WITH CHECK ((tagged_by = (select crm.current_crm_user_id())));

CREATE POLICY uploader_delete_documents ON crm.documents FOR DELETE TO authenticated USING ((uploaded_by = (select crm.current_crm_user_id())));

CREATE POLICY uploader_update_documents ON crm.documents FOR UPDATE TO authenticated USING ((uploaded_by = (select crm.current_crm_user_id()))) WITH CHECK ((uploaded_by = (select crm.current_crm_user_id())));

-- Section gate (AGENTS.md authorization map): CRM rows are unreadable while the crm
-- section is disabled, whatever the other policies allow.
CREATE POLICY referrals_section_available ON crm.referrals AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY leads_section_available ON crm.leads AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY not_bought_followups_section_available ON crm.not_bought_followups AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY referral_calling_section_available ON crm.referral_calling AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY branches_section_available ON crm.branches AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY campaigns_section_available ON crm.campaigns AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY client_campaign_tags_section_available ON crm.client_campaign_tags AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY clients_section_available ON crm.clients AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY client_edit_log_section_available ON crm.client_edit_log AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY client_phone_index_section_available ON crm.client_phone_index AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY client_timeline_section_available ON crm.client_timeline AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY crm_allocation_section_available ON crm.crm_allocation AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY crm_daily_availability_section_available ON crm.crm_daily_availability AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY crm_queue_round_robin_section_available ON crm.crm_queue_round_robin AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY documents_section_available ON crm.documents AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY entry_queue_section_available ON crm.entry_queue AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lead_call_history_section_available ON crm.lead_call_history AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lead_form_field_options_section_available ON crm.lead_form_field_options AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lead_form_fields_section_available ON crm.lead_form_fields AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lead_stage_history_section_available ON crm.lead_stage_history AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY legacy_import_keys_section_available ON crm.legacy_import_keys AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY legacy_walkin_ingest_attempts_section_available ON crm.legacy_walkin_ingest_attempts AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY legacy_walkin_ingest_rate_limits_section_available ON crm.legacy_walkin_ingest_rate_limits AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lookup_beverages_section_available ON crm.lookup_beverages AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lookup_cities_section_available ON crm.lookup_cities AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lookup_communities_section_available ON crm.lookup_communities AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lookup_gifts_section_available ON crm.lookup_gifts AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lookup_not_bought_reasons_section_available ON crm.lookup_not_bought_reasons AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lookup_pincodes_section_available ON crm.lookup_pincodes AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lookup_product_categories_section_available ON crm.lookup_product_categories AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lookup_relations_section_available ON crm.lookup_relations AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lookup_snacks_section_available ON crm.lookup_snacks AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lookup_source_of_leads_section_available ON crm.lookup_source_of_leads AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY lookup_sugar_options_section_available ON crm.lookup_sugar_options AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY not_bought_history_section_available ON crm.not_bought_history AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY referral_calling_history_section_available ON crm.referral_calling_history AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY users_section_available ON crm.users AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));
CREATE POLICY visit_forms_section_available ON crm.visit_forms AS RESTRICTIVE FOR SELECT TO authenticated USING ((select public.module_accessible('crm', false)));

-- Privileges: nothing for public/anon; authenticated receives what the original granted
-- explicitly (or needed at runtime); RLS remains the row boundary.
revoke all on schema crm from public, anon;
grant usage on schema crm to authenticated;
revoke all on all tables in schema crm from public, anon, authenticated, service_role;
revoke all on all sequences in schema crm from public, anon, authenticated, service_role;
revoke all on all functions in schema crm from public, anon, authenticated, service_role;

grant select, insert, update, delete on
  crm.clients, crm.client_phone_index, crm.client_timeline, crm.client_edit_log, crm.visit_forms,
  crm.documents, crm.entry_queue, crm.crm_allocation, crm.crm_daily_availability,
  crm.not_bought_followups, crm.not_bought_history, crm.referrals, crm.referral_calling,
  crm.lookup_cities, crm.lookup_communities, crm.lookup_product_categories, crm.lookup_beverages,
  crm.lookup_snacks, crm.lookup_gifts, crm.lookup_not_bought_reasons,
  crm.campaigns, crm.client_campaign_tags, crm.lookup_pincodes,
  crm.lookup_relations, crm.lookup_sugar_options, crm.lookup_source_of_leads,
  crm.lead_form_fields, crm.lead_form_field_options, crm.leads, crm.lead_stage_history
to authenticated;
grant select, insert on crm.referral_calling_history to authenticated;
grant select, insert, update on crm.lead_call_history to authenticated;
grant select on crm.legacy_walkin_ingest_attempts to authenticated;
-- Identity-bridge columns (0180) are writable only through the audited link RPCs.
grant select, delete on crm.users, crm.branches to authenticated;
grant insert (id, name, phone, email, role, branch_id, active, created_at),
      update (id, name, phone, email, role, branch_id, active, created_at) on crm.users to authenticated;
grant insert (id, name, address, active, created_at),
      update (id, name, address, active, created_at) on crm.branches to authenticated;
-- client_code is assigned by an invoker trigger, so inserting a client needs the sequence.
grant usage, select on sequence crm.client_edit_log_id_seq, crm.client_code_sequence to authenticated;

-- RPCs and pure helpers the original exposed to signed-in staff. Trigger functions need
-- no grant. The legacy ingest RPCs stay owner-only until the Phase 4 Edge Function.
grant execute on function
  crm.assign_next_available_crm(uuid),
  crm.browse_clients(text, integer, integer),
  crm.browse_clients(text, text, integer, integer),
  crm.convert_referral_to_client(uuid),
  crm.create_client_with_phone(text, text, text, uuid),
  crm.create_entry_queue(text, text, uuid, text, uuid),
  crm.create_manual_referral(uuid, text, text, text, uuid),
  crm.create_manual_referral(uuid, text, text, text, uuid, text, text),
  crm.create_post_call_lead(text, text, jsonb, crm.lead_call_response, text, date, integer, crm.lead_recording_upload_status),
  crm.create_referral_calling_if_open(uuid, text, text, date),
  crm.dedupe_category_array(text[]),
  crm.is_branch_manager(uuid),
  crm.is_branch_staff(uuid),
  crm.is_super_admin(),
  crm.is_user_in_current_branch(uuid),
  crm.legacy_call_outcome_status(text),
  crm.legacy_status_is_done(text),
  crm.lookup_client_by_phone(text),
  crm.manage_crm_roster(text, uuid, uuid, text, uuid),
  crm.next_business_day(date),
  crm.normalize_crm_roster_value(text),
  crm.not_bought_followup_status_is_done(text),
  crm.reconcile_referral_calling_conversions(),
  crm.save_not_bought_followup(uuid, text, text, date, text),
  crm.save_referral_followup(uuid, text, text, date, text, text),
  crm.save_referral_followup(uuid, text, text, date, text, text, uuid),
  crm.search_clients(text, integer),
  crm.submit_walkin_visit(jsonb),
  crm.sync_not_bought_followups(),
  crm.update_not_bought_followup(uuid, text, text, date),
  crm.update_not_bought_reason(uuid, text[], text),
  crm.update_referral_calling(uuid, text, text, date),
  crm.current_crm_user_id(),
  crm.current_user_role(),
  crm.current_user_branch_id(),
  crm.get_my_profile(),
  crm.link_jewelos_profile(uuid, uuid),
  crm.link_jewelos_branch(uuid, uuid),
  crm.list_identity_links()
to authenticated;

notify pgrst, 'reload schema';
