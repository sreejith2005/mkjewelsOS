-- CRM project upgrade 1/5: lead call history (post-call inbox).
--
-- The original CRM's Prisma migration 20260803010000_lead_calling_foundation was never
-- applied to the CRM project (baseline 20261001000000 has no lead_call_history). The ported
-- /crm screens read it (post-call inbox), so it is applied here verbatim, except:
-- - the Storage policy for lead-call recordings is left out. CRM-project Storage policies
--   were not part of the public-schema baseline, so they are reviewed with the documents
--   bucket when /crm is repointed (step 3).
-- - anon is explicitly revoked on the table and the function (Supabase default privileges
--   would otherwise grant it).
-- 20261001000400_crm_minimal_grants.sql then applies the port's exact grants.

-- Android post-call interactions reuse the existing lead identity, never a
-- second calling-only contact table. Values deliberately match the current
-- Not Bought contract exactly.
CREATE TYPE "public"."lead_call_response" AS ENUM ('CONNECTED', 'NOT PICKED', 'SWITCHED OFF', 'WHATSAPP ONLY', 'WRONG NUMBER');
CREATE TYPE "public"."lead_recording_upload_status" AS ENUM ('pending', 'uploaded', 'failed', 'not_found');

CREATE TABLE "public"."lead_call_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "lead_id" uuid REFERENCES "public"."leads"("id") ON DELETE CASCADE,
  "call_response" "public"."lead_call_response" NOT NULL,
  "remark" text,
  "next_followup_date" date,
  "call_duration_seconds" integer CHECK ("call_duration_seconds" IS NULL OR "call_duration_seconds" >= 0),
  "recording_storage_path" text,
  "recording_upload_status" "public"."lead_recording_upload_status" NOT NULL DEFAULT 'pending',
  "entered_by" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_call_history_recording_state" CHECK (("recording_upload_status" = 'uploaded' AND "recording_storage_path" IS NOT NULL) OR ("recording_upload_status" <> 'uploaded' AND "recording_storage_path" IS NULL))
);
CREATE INDEX "lead_call_history_lead_created_at_idx" ON "public"."lead_call_history" ("lead_id", "created_at" DESC);
CREATE INDEX "lead_call_history_entered_by_created_at_idx" ON "public"."lead_call_history" ("entered_by", "created_at" DESC);

ALTER TABLE "public"."lead_call_history" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "public"."lead_call_history" FROM anon;
GRANT SELECT, INSERT, UPDATE ON "public"."lead_call_history" TO authenticated;
CREATE POLICY "active_staff_read_lead_call_history" ON "public"."lead_call_history" FOR SELECT TO authenticated USING ("public"."current_user_role"() IS NOT NULL);
CREATE POLICY "active_staff_create_own_lead_call_history" ON "public"."lead_call_history" FOR INSERT TO authenticated WITH CHECK ("public"."current_user_role"() IS NOT NULL AND "entered_by" = "auth"."uid"());
CREATE POLICY "entered_by_or_admin_update_lead_call_history" ON "public"."lead_call_history" FOR UPDATE TO authenticated USING ("entered_by" = "auth"."uid"() OR "public"."is_super_admin"()) WITH CHECK ("entered_by" = "auth"."uid"() OR "public"."is_super_admin"());

-- New lead plus its first post-call record must commit atomically.
CREATE OR REPLACE FUNCTION "public"."create_post_call_lead"(p_phone_number text, p_name text, p_field_values jsonb, p_call_response "public"."lead_call_response", p_remark text DEFAULT NULL, p_next_followup_date date DEFAULT NULL, p_call_duration_seconds integer DEFAULT NULL, p_recording_upload_status "public"."lead_recording_upload_status" DEFAULT 'pending') RETURNS "public"."leads"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_lead "public"."leads"; v_actor "public"."user_role";
BEGIN
  v_actor := "public"."current_user_role"();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_phone_number !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'phone number must contain exactly 10 digits' USING ERRCODE = 'check_violation'; END IF;
  IF p_call_duration_seconds IS NOT NULL AND p_call_duration_seconds < 0 THEN RAISE EXCEPTION 'call duration cannot be negative' USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO "public"."leads" ("phone_number", "name", "field_values", "created_via", "created_by") VALUES (p_phone_number, NULLIF(btrim(p_name), ''), COALESCE(p_field_values, '{}'::jsonb), 'mobile_post_call', "auth"."uid"()) RETURNING * INTO v_lead;
  INSERT INTO "public"."lead_call_history" ("lead_id", "call_response", "remark", "next_followup_date", "call_duration_seconds", "recording_upload_status", "entered_by") VALUES (v_lead.id, p_call_response, NULLIF(btrim(p_remark), ''), p_next_followup_date, p_call_duration_seconds, p_recording_upload_status, "auth"."uid"());
  RETURN v_lead;
END; $$;
REVOKE ALL ON FUNCTION "public"."create_post_call_lead"(text,text,jsonb,"public"."lead_call_response",text,date,integer,"public"."lead_recording_upload_status") FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION "public"."create_post_call_lead"(text,text,jsonb,"public"."lead_call_response",text,date,integer,"public"."lead_recording_upload_status") TO authenticated;
