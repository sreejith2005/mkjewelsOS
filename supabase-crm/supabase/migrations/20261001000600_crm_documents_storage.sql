-- CRM project upgrade 6: the crm-documents Storage bucket and its object policies.
--
-- The public-schema baseline (20261001000000) does not include Storage. The hosted CRM project
-- already has the bucket 'crm-documents' and three object policies. The owner read them on
-- 2026-10-05: crm_documents_active_staff_read, crm_documents_active_staff_upload and
-- crm_documents_uploader_or_admin_delete. They are identical to the JewelOS port's 0188 apart
-- from the bucket id. This migration records them, so a fresh CRM database (local, test,
-- branch) matches the hosted project. On the hosted project it changes nothing that exists:
-- - the bucket is inserted only when missing. The hosted bucket's settings are left as they
--   are. The fresh default mirrors the port: private, 10 MB, the original client-side cap.
-- - each policy is created only when a policy of that name does not exist.
--
-- It also adds the one original policy the hosted project lacks:
-- lead_call_recordings_active_staff_upload, from the never-applied Prisma migration
-- 20260803010000_lead_calling_foundation. 20261001000100 deferred it to here.
--
-- Object paths (unchanged from the original):
--   <client uuid>/<timeline uuid | general>/<uuid>_<file name>   visit proofs and documents
--   lead-calls/<uuid>/<uuid>_<file name>                         call recordings
-- owner_id is the uploader's auth.uid(), which under a login-bridge session is the CRM user
-- id (20261001000500).

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('crm-documents', 'crm-documents', false, 10485760)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'crm_documents_active_staff_read') THEN
    CREATE POLICY crm_documents_active_staff_read ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'crm-documents' AND public.current_user_role() IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'crm_documents_active_staff_upload') THEN
    CREATE POLICY crm_documents_active_staff_upload ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'crm-documents'
        AND public.current_user_role() IS NOT NULL
        AND owner_id = (auth.uid())::text
        AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|general)/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_.+$'
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'crm_documents_uploader_or_admin_delete') THEN
    CREATE POLICY crm_documents_uploader_or_admin_delete ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'crm-documents' AND (owner_id = (auth.uid())::text OR public.is_super_admin()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'lead_call_recordings_active_staff_upload') THEN
    CREATE POLICY lead_call_recordings_active_staff_upload ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'crm-documents'
        AND public.current_user_role() IS NOT NULL
        AND owner_id = (auth.uid())::text
        AND name ~ '^lead-calls/[0-9a-f-]{36}/[0-9a-f-]{36}_[A-Za-z0-9._-]+$'
      );
  END IF;
END
$$;
