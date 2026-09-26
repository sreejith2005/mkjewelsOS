-- Original CRM Storage bucket and object policies (see 0181 header for provenance).
--
-- The original bucket id 'crm-documents' is already used by the old JewelOS CRM
-- (0012 onwards), so the original CRM files live in the distinct private bucket
-- 'crm-legacy-documents'. Object paths are unchanged:
--   <client uuid>/<timeline uuid | general>/<uuid>_<file name>     (visit proofs)
--   lead-calls/<uuid>/<uuid>_<file name>                          (call recordings)
-- The four original policies are ported to the new bucket id with bucket-prefixed names.
-- Storage owner_id is the JewelOS Auth user (JWT subject), so the owner checks keep
-- auth.uid(); CRM role checks read the identity bridge (0182).
-- file_size_limit mirrors the original client-side 10 MB cap (walk-in-form.tsx
-- MAX_UPLOAD_BYTES). MIME types stay unrestricted like the original bucket; see the
-- design's open questions.

insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-legacy-documents', 'crm-legacy-documents', false, 10485760)
on conflict (id) do update
set name = excluded.name, public = false, file_size_limit = excluded.file_size_limit;

create policy crm_legacy_documents_active_staff_read
on storage.objects
for select to authenticated
using (
  bucket_id = 'crm-legacy-documents'
  and (select crm.current_user_role()) is not null
);

create policy crm_legacy_documents_active_staff_upload
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'crm-legacy-documents'
  and (select crm.current_user_role()) is not null
  and owner_id = (select auth.uid())::text
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|general)/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_.+$'
);

create policy crm_legacy_documents_uploader_or_admin_delete
on storage.objects
for delete to authenticated
using (
  bucket_id = 'crm-legacy-documents'
  and (
    owner_id = (select auth.uid())::text
    or (select crm.is_super_admin())
  )
);

create policy crm_legacy_documents_lead_call_recordings_upload
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'crm-legacy-documents'
  and (select crm.current_user_role()) is not null
  and owner_id = (select auth.uid())::text
  and name ~ '^lead-calls/[0-9a-f-]{36}/[0-9a-f-]{36}_[A-Za-z0-9._-]+$'
);
