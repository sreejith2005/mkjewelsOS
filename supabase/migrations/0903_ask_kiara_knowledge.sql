-- Ask Kiara, Phase 3: the SOP knowledge base. Design:
-- docs/superpowers/specs/2026-10-08-ask-kiara-design.md (sections 5.3, 5.7, 6 and 10).
--
-- Super Admin (assistant.manage_knowledge) uploads .docx SOPs or writes articles in
-- the app. The ingest Edge Function extracts text as the caller and stores the
-- sections through an audited RPC here. Employees never read documents or chunks
-- directly: Kiara receives excerpts only through search_kiara_knowledge, which
-- enforces the tenant, the document status (only active documents' active
-- versions), and the per-document audience for the caller.
--
-- Owner decisions (2026-10-09): every document has an audience, `everyone`
-- (default) or `managers_and_above` (effective role manager, admin, or super
-- admin, so dashboard authority counts); `suggested` documents (Phase 4
-- escalation answers) are not searchable until Super Admin approves them; there
-- are no file downloads for anyone in v1.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table kiara_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  category text check (category is null or length(category) <= 80),
  audience text not null default 'everyone' check (audience in ('everyone','managers_and_above')),
  source_kind text not null check (source_kind in ('upload','escalation_answer','manual')),
  status text not null check (status in ('processing','active','inactive','suggested','failed','deleted')),
  active_version_id uuid,
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references user_profiles(id) on delete set null,
  constraint kiara_documents_deleted_shape check ((status = 'deleted') = (deleted_at is not null)),
  constraint kiara_documents_live_version check (status not in ('active','inactive','suggested') or active_version_id is not null)
);
create index kiara_documents_tenant_status on kiara_documents(tenant_id, status, updated_at desc);

create table kiara_document_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  document_id uuid not null references kiara_documents(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  -- {tenant_id}/{document_id}/{version_id}.docx for uploads; null for typed text.
  storage_path text check (storage_path is null or storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.docx$'),
  original_filename text check (original_filename is null or length(original_filename) between 1 and 255),
  byte_size integer check (byte_size is null or byte_size between 1 and 10485760),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('docx','edited_text','manual','escalation_answer')),
  extraction_status text not null check (extraction_status in ('pending','succeeded','failed')),
  extraction_error text check (extraction_error is null or length(extraction_error) <= 500),
  -- The full text as Kiara reads it, with #/##/### headings; edited in the app.
  extracted_text text check (extracted_text is null or length(extracted_text) <= 500000),
  word_count integer check (word_count is null or word_count >= 0),
  image_count integer check (image_count is null or image_count >= 0),
  chunk_count integer check (chunk_count is null or chunk_count >= 0),
  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (document_id, version_number),
  constraint kiara_versions_upload_shape check (source <> 'docx' or (storage_path is not null and byte_size is not null and sha256 is not null and original_filename is not null))
);
create index kiara_document_versions_document on kiara_document_versions(document_id, version_number desc);
create index kiara_document_versions_hash on kiara_document_versions(tenant_id, sha256) where sha256 is not null;

alter table kiara_documents add constraint kiara_documents_active_version_fk
  foreign key (active_version_id) references kiara_document_versions(id) on delete set null;

create table kiara_document_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  document_id uuid not null references kiara_documents(id) on delete cascade,
  version_id uuid not null references kiara_document_versions(id) on delete cascade,
  ordinal integer not null check (ordinal >= 1),
  -- The document title, copied so titles weigh in ranking; kept in step on rename.
  document_title text not null check (length(document_title) between 1 and 200),
  heading_path text not null default '' check (length(heading_path) <= 500),
  content text not null check (length(content) between 1 and 8000),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', document_title || ' ' || heading_path), 'A')
    || setweight(to_tsvector('english', content), 'B')
    || to_tsvector('simple', document_title || ' ' || heading_path || ' ' || content)
  ) stored,
  unique (version_id, ordinal)
);
create index kiara_document_chunks_search on kiara_document_chunks using gin(search_vector);
create index kiara_document_chunks_document on kiara_document_chunks(document_id);
create index kiara_document_chunks_tenant on kiara_document_chunks(tenant_id);

-- ---------------------------------------------------------------------------
-- 2. Row-level security and grants
-- ---------------------------------------------------------------------------

alter table kiara_documents enable row level security;
alter table kiara_document_versions enable row level security;
alter table kiara_document_chunks enable row level security;

revoke all on kiara_documents, kiara_document_versions, kiara_document_chunks
  from public, anon, authenticated, service_role;

-- Knowledge managers may read documents and versions (the ingest function reads
-- its version through the RPC below). Chunks have no client grant at all.
grant select on kiara_documents, kiara_document_versions to authenticated;

create policy kiara_documents_manager_read on kiara_documents for select to authenticated
  using (tenant_id = (select current_tenant_id()) and (select current_profile_is_active())
    and (select has_permission('assistant.manage_knowledge')));
create policy kiara_document_versions_manager_read on kiara_document_versions for select to authenticated
  using (tenant_id = (select current_tenant_id()) and (select current_profile_is_active())
    and (select has_permission('assistant.manage_knowledge')));
create policy kiara_documents_section_available on kiara_documents as restrictive for select to authenticated using (module_accessible('ask_kiara'));
create policy kiara_document_versions_section_available on kiara_document_versions as restrictive for select to authenticated using (module_accessible('ask_kiara'));

-- ---------------------------------------------------------------------------
-- 3. Private bucket (no public URLs, .docx only, 10 MB)
-- ---------------------------------------------------------------------------

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('kiara-knowledge', 'kiara-knowledge', false, 10485760,
  array['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Upload: only to the exact path of a pending version this caller created.
create function kiara_knowledge_object_writable(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select current_profile_is_active() and module_accessible('ask_kiara')
    and has_permission('assistant.manage_knowledge')
    and split_part(p_path, '/', 1) = current_tenant_id()::text
    and exists (
      select 1 from kiara_document_versions v
      join kiara_documents d on d.id = v.document_id
      where v.storage_path = p_path and v.tenant_id = current_tenant_id()
        and v.extraction_status = 'pending' and v.created_by = (current_profile()).id
        and d.status <> 'deleted');
$$;

-- Read: knowledge managers of the tenant, for files that belong to a version.
-- Used by the ingest function (as the caller); the UI offers no download.
create function kiara_knowledge_object_readable(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select current_profile_is_active() and module_accessible('ask_kiara')
    and has_permission('assistant.manage_knowledge')
    and split_part(p_path, '/', 1) = current_tenant_id()::text
    and exists (select 1 from kiara_document_versions v where v.storage_path = p_path and v.tenant_id = current_tenant_id());
$$;

-- Delete: only files of deleted documents or of failed versions.
create function kiara_knowledge_object_removable(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select kiara_knowledge_object_readable(p_path)
    and exists (
      select 1 from kiara_document_versions v
      join kiara_documents d on d.id = v.document_id
      where v.storage_path = p_path and v.tenant_id = current_tenant_id()
        and (d.status = 'deleted' or v.extraction_status = 'failed'));
$$;

alter function kiara_knowledge_object_writable(text) owner to postgres;
alter function kiara_knowledge_object_readable(text) owner to postgres;
alter function kiara_knowledge_object_removable(text) owner to postgres;
revoke all on function kiara_knowledge_object_writable(text), kiara_knowledge_object_readable(text), kiara_knowledge_object_removable(text)
  from public, anon, authenticated, service_role;
grant execute on function kiara_knowledge_object_writable(text), kiara_knowledge_object_readable(text), kiara_knowledge_object_removable(text)
  to authenticated;

create policy kiara_knowledge_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'kiara-knowledge' and owner_id = auth.uid()::text and kiara_knowledge_object_writable(name));
create policy kiara_knowledge_read on storage.objects for select to authenticated
  using (bucket_id = 'kiara-knowledge' and kiara_knowledge_object_readable(name));
create policy kiara_knowledge_cleanup on storage.objects for delete to authenticated
  using (bucket_id = 'kiara-knowledge' and kiara_knowledge_object_removable(name));

-- ---------------------------------------------------------------------------
-- 4. Realtime topic `assistant` (payload-free wake-ups, spec 5.7)
-- ---------------------------------------------------------------------------

alter table tenant_realtime_events drop constraint tenant_realtime_events_topic_check;
alter table tenant_realtime_events add constraint tenant_realtime_events_topic_check
  check (topic in ('tasks', 'fms', 'crm', 'forms', 'organization', 'settings', 'assistant'));

create or replace function emit_tenant_realtime_event(p_tenant_id uuid, p_topic text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null then return; end if;
  if p_topic not in ('tasks', 'fms', 'crm', 'forms', 'organization', 'settings', 'assistant') then
    raise exception 'Realtime event topic is invalid' using errcode = '22023';
  end if;
  insert into tenant_realtime_events(tenant_id, topic) values (p_tenant_id, p_topic);
end;
$$;

create trigger kiara_documents_realtime after insert or delete or update of status, active_version_id, title, audience
  on kiara_documents for each row execute function emit_realtime_direct_event('assistant');

-- ---------------------------------------------------------------------------
-- 5. Internal helpers (owner-only)
-- ---------------------------------------------------------------------------

-- Ask Kiara section, active profile, and the knowledge permission.
create function kiara_kb_actor()
returns user_profiles language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_actor();
begin
  if not has_permission('assistant.manage_knowledge') then
    raise exception 'Knowledge base management requires permission' using errcode = '42501';
  end if;
  return v_actor;
end $$;

-- A document of the caller's tenant, locked for a write. Deleted documents are
-- read-only (their tombstone keeps past citations explainable).
create function kiara_kb_document_for_write(p_actor user_profiles, p_document_id uuid)
returns kiara_documents language plpgsql volatile security definer set search_path = public as $$
declare v_document kiara_documents;
begin
  select * into v_document from kiara_documents where id = p_document_id for update;
  if v_document.id is null or v_document.tenant_id <> p_actor.tenant_id then
    raise exception 'Document not found' using errcode = '42501';
  end if;
  if v_document.status = 'deleted' then
    raise exception 'This document was deleted' using errcode = '22023';
  end if;
  return v_document;
end $$;

-- Field checks shared by the create, save, and details RPCs.
create function kiara_kb_assert_details(p_title text, p_category text, p_audience text)
returns void language plpgsql immutable set search_path = public as $$
begin
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'Title must be 1 to 200 characters' using errcode = '22023';
  end if;
  if p_category is not null and length(p_category) > 80 then
    raise exception 'Category must be at most 80 characters' using errcode = '22023';
  end if;
  if p_audience is null or p_audience not in ('everyone','managers_and_above') then
    raise exception 'Audience must be everyone or managers_and_above' using errcode = '22023';
  end if;
end $$;

-- An upload's declared file: a .docx name, 1 byte to 10 MB, and a SHA-256.
-- The ingest function re-checks size and hash against the stored bytes.
create function kiara_kb_assert_upload(p_filename text, p_byte_size integer, p_sha256 text)
returns void language plpgsql immutable set search_path = public as $$
begin
  if p_filename is null or length(p_filename) not between 6 and 255 or lower(p_filename) !~ '\.docx$' or p_filename ~ '[/\\]' then
    raise exception 'Only .docx Word files can be uploaded' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size not between 1 and 10485760 then
    raise exception 'The file must be at most 10 MB' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'The file hash is invalid' using errcode = '22023';
  end if;
end $$;

-- The same file (by SHA-256) already live or being processed in another document.
create function kiara_kb_assert_not_duplicate(p_actor user_profiles, p_sha256 text, p_except_document uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_title text; v_status text;
begin
  select d.title, d.status into v_title, v_status
  from kiara_document_versions v
  join kiara_documents d on d.id = v.document_id
  where v.tenant_id = p_actor.tenant_id and v.sha256 = p_sha256
    and v.extraction_status <> 'failed' and d.status <> 'deleted'
    and d.id is distinct from p_except_document
  order by v.created_at desc
  limit 1;
  if v_title is not null then
    raise exception 'kiara_duplicate_document' using errcode = '23505',
      detail = v_title, hint = v_status;
  end if;
end $$;

-- Chunks are verbatim slices of the stored text (the splitter in
-- packages/core/src/assistant/chunking.ts produces them), so a chunk can never
-- carry text the knowledge manager cannot see and edit.
create function kiara_kb_assert_chunks(p_text text, p_chunks jsonb)
returns integer language plpgsql immutable set search_path = public as $$
declare v_chunk jsonb; v_count integer;
begin
  if p_text is null or length(btrim(p_text)) < 1 or length(p_text) > 500000 then
    raise exception 'The text must be 1 to 500,000 characters' using errcode = '22023';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'Sections are missing' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_chunks);
  if v_count < 1 or v_count > 3000 then
    raise exception 'A document must have 1 to 3,000 sections' using errcode = '22023';
  end if;
  for v_chunk in select value from jsonb_array_elements(p_chunks) loop
    if jsonb_typeof(v_chunk) <> 'object'
      or (select count(*) from jsonb_object_keys(v_chunk) k where k not in ('heading_path','content')) > 0
      or jsonb_typeof(v_chunk -> 'heading_path') <> 'string' or jsonb_typeof(v_chunk -> 'content') <> 'string'
      or length(v_chunk ->> 'heading_path') > 500
      or length(v_chunk ->> 'content') not between 1 and 8000
      or strpos(p_text, v_chunk ->> 'content') = 0 then
      raise exception 'A section is invalid' using errcode = '22023';
    end if;
  end loop;
  return v_count;
end $$;

-- Replaces a version's chunks and makes it the document's live version. Older
-- versions keep their text (history) but lose their chunks.
create function kiara_kb_publish_version(p_document kiara_documents, p_version_id uuid, p_chunks jsonb)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_count integer;
begin
  delete from kiara_document_chunks where document_id = p_document.id;
  insert into kiara_document_chunks(tenant_id, document_id, version_id, ordinal, document_title, heading_path, content)
  select p_document.tenant_id, p_document.id, p_version_id, c.ordinality::integer, p_document.title,
    c.value ->> 'heading_path', c.value ->> 'content'
  from jsonb_array_elements(p_chunks) with ordinality c;
  get diagnostics v_count = row_count;
  update kiara_document_versions set chunk_count = v_count where id = p_version_id;
  return v_count;
end $$;

-- An OR query over the words' lexemes, so a chunk matching more of Kiara's
-- keywords ranks higher instead of needing every word.
create function kiara_or_tsquery(p_config regconfig, p_text text)
returns tsquery language sql immutable set search_path = public as $$
  select nullif(replace(plainto_tsquery(p_config, coalesce(p_text, ''))::text, ' & ', ' | '), '')::tsquery;
$$;

alter function kiara_kb_actor() owner to postgres;
alter function kiara_kb_document_for_write(user_profiles, uuid) owner to postgres;
alter function kiara_kb_assert_details(text, text, text) owner to postgres;
alter function kiara_kb_assert_upload(text, integer, text) owner to postgres;
alter function kiara_kb_assert_not_duplicate(user_profiles, text, uuid) owner to postgres;
alter function kiara_kb_assert_chunks(text, jsonb) owner to postgres;
alter function kiara_kb_publish_version(kiara_documents, uuid, jsonb) owner to postgres;
alter function kiara_or_tsquery(regconfig, text) owner to postgres;
revoke all on function kiara_kb_actor(), kiara_kb_document_for_write(user_profiles, uuid), kiara_kb_assert_details(text, text, text),
  kiara_kb_assert_upload(text, integer, text), kiara_kb_assert_not_duplicate(user_profiles, text, uuid),
  kiara_kb_assert_chunks(text, jsonb), kiara_kb_publish_version(kiara_documents, uuid, jsonb), kiara_or_tsquery(regconfig, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Knowledge-manager RPCs (assistant.manage_knowledge; audited writes)
-- ---------------------------------------------------------------------------

create function create_kiara_document_with_audit(
  p_title text, p_category text, p_audience text, p_filename text, p_byte_size integer, p_sha256 text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_document kiara_documents;
  v_version_id uuid := gen_random_uuid();
  v_path text;
begin
  perform kiara_kb_assert_details(p_title, p_category, p_audience);
  perform kiara_kb_assert_upload(p_filename, p_byte_size, p_sha256);
  perform kiara_kb_assert_not_duplicate(v_actor, p_sha256, null);
  insert into kiara_documents(tenant_id, title, category, audience, source_kind, status, created_by, updated_by)
  values (v_actor.tenant_id, btrim(p_title), nullif(btrim(p_category), ''), p_audience, 'upload', 'processing', v_actor.id, v_actor.id)
  returning * into v_document;
  v_path := v_actor.tenant_id || '/' || v_document.id || '/' || v_version_id || '.docx';
  insert into kiara_document_versions(id, tenant_id, document_id, version_number, storage_path, original_filename, byte_size, sha256,
    source, extraction_status, created_by)
  values (v_version_id, v_actor.tenant_id, v_document.id, 1, v_path, p_filename, p_byte_size, p_sha256, 'docx', 'pending', v_actor.id);
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_kb_document_created', 'assistant', v_document.id,
    jsonb_build_object('version_id', v_version_id, 'title', v_document.title, 'audience', p_audience, 'byte_size', p_byte_size, 'sha256', p_sha256));
  return jsonb_build_object('document_id', v_document.id, 'version_id', v_version_id, 'storage_path', v_path);
end $$;

-- Replace with a new .docx. The current version stays live until this one's
-- extraction succeeds.
create function add_kiara_document_version_with_audit(p_document_id uuid, p_filename text, p_byte_size integer, p_sha256 text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_document kiara_documents := kiara_kb_document_for_write(v_actor, p_document_id);
  v_version_id uuid := gen_random_uuid();
  v_number integer;
  v_path text;
begin
  perform kiara_kb_assert_upload(p_filename, p_byte_size, p_sha256);
  perform kiara_kb_assert_not_duplicate(v_actor, p_sha256, v_document.id);
  select coalesce(max(version_number), 0) + 1 into v_number from kiara_document_versions where document_id = v_document.id;
  v_path := v_actor.tenant_id || '/' || v_document.id || '/' || v_version_id || '.docx';
  insert into kiara_document_versions(id, tenant_id, document_id, version_number, storage_path, original_filename, byte_size, sha256,
    source, extraction_status, created_by)
  values (v_version_id, v_actor.tenant_id, v_document.id, v_number, v_path, p_filename, p_byte_size, p_sha256, 'docx', 'pending', v_actor.id);
  update kiara_documents set status = case when status = 'failed' then 'processing' else status end,
    updated_by = v_actor.id, updated_at = now()
  where id = v_document.id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_kb_version_added', 'assistant', v_document.id,
    jsonb_build_object('version_id', v_version_id, 'version_number', v_number, 'previous_version_id', v_document.active_version_id,
      'byte_size', p_byte_size, 'sha256', p_sha256));
  return jsonb_build_object('document_id', v_document.id, 'version_id', v_version_id, 'storage_path', v_path);
end $$;

-- What the ingest function needs to verify the upload (it runs as the caller).
create function get_kiara_version_for_ingest(p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_kb_actor(); v_version kiara_document_versions;
begin
  select * into v_version from kiara_document_versions where id = p_version_id;
  if v_version.id is null or v_version.tenant_id <> v_actor.tenant_id then
    raise exception 'Version not found' using errcode = '42501';
  end if;
  if v_version.source <> 'docx' or v_version.extraction_status <> 'pending' then
    raise exception 'This version is not waiting for extraction' using errcode = '22023';
  end if;
  if (select status from kiara_documents where id = v_version.document_id) = 'deleted' then
    raise exception 'This document was deleted' using errcode = '22023';
  end if;
  return jsonb_build_object('version_id', v_version.id, 'document_id', v_version.document_id,
    'storage_path', v_version.storage_path, 'byte_size', v_version.byte_size, 'sha256', v_version.sha256);
end $$;

create function store_kiara_extraction_with_audit(p_version_id uuid, p_extracted_text text, p_chunks jsonb, p_word_count integer, p_image_count integer)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_version kiara_document_versions;
  v_document kiara_documents;
  v_previous uuid;
  v_count integer;
begin
  select * into v_version from kiara_document_versions where id = p_version_id for update;
  if v_version.id is null or v_version.tenant_id <> v_actor.tenant_id then
    raise exception 'Version not found' using errcode = '42501';
  end if;
  v_document := kiara_kb_document_for_write(v_actor, v_version.document_id);
  if v_version.source <> 'docx' or v_version.extraction_status <> 'pending' then
    raise exception 'This version is not waiting for extraction' using errcode = '22023';
  end if;
  -- The file must be in the bucket (the function verified its size and hash).
  if not exists (select 1 from storage.objects o where o.bucket_id = 'kiara-knowledge' and o.name = v_version.storage_path) then
    raise exception 'The uploaded file is missing' using errcode = '22023';
  end if;
  if p_word_count is null or p_word_count < 0 or p_image_count is null or p_image_count < 0 then
    raise exception 'Extraction counts are invalid' using errcode = '22023';
  end if;
  perform kiara_kb_assert_chunks(p_extracted_text, p_chunks);
  -- A newer version that already went live wins over this older upload.
  if v_document.active_version_id is not null
    and (select version_number from kiara_document_versions where id = v_document.active_version_id) > v_version.version_number then
    raise exception 'A newer version is already live' using errcode = '22023';
  end if;

  v_previous := v_document.active_version_id;
  update kiara_document_versions set extraction_status = 'succeeded', extraction_error = null, extracted_text = p_extracted_text,
    word_count = p_word_count, image_count = p_image_count, completed_at = now()
  where id = v_version.id;
  v_count := kiara_kb_publish_version(v_document, v_version.id, p_chunks);
  update kiara_documents set active_version_id = v_version.id,
    status = case when status in ('inactive','suggested') then status else 'active' end,
    updated_by = v_actor.id, updated_at = now()
  where id = v_document.id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_kb_extraction_stored', 'assistant', v_document.id,
    jsonb_build_object('version_id', v_version.id, 'previous_version_id', v_previous, 'chunk_count', v_count,
      'word_count', p_word_count, 'image_count', p_image_count, 'text_length', length(p_extracted_text)));
  return jsonb_build_object('document_id', v_document.id, 'version_id', v_version.id, 'chunk_count', v_count);
end $$;

-- A failed extraction keeps the previous live version, if there is one.
create function fail_kiara_extraction_with_audit(p_version_id uuid, p_error text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_version kiara_document_versions;
  v_document kiara_documents;
  v_error text := left(btrim(coalesce(p_error, '')), 500);
begin
  select * into v_version from kiara_document_versions where id = p_version_id for update;
  if v_version.id is null or v_version.tenant_id <> v_actor.tenant_id then
    raise exception 'Version not found' using errcode = '42501';
  end if;
  v_document := kiara_kb_document_for_write(v_actor, v_version.document_id);
  if v_version.extraction_status <> 'pending' then
    raise exception 'This version is not waiting for extraction' using errcode = '22023';
  end if;
  update kiara_document_versions set extraction_status = 'failed', extraction_error = coalesce(nullif(v_error, ''), 'Extraction failed'),
    completed_at = now()
  where id = v_version.id;
  update kiara_documents set status = case when active_version_id is null then 'failed' else status end,
    updated_by = v_actor.id, updated_at = now()
  where id = v_document.id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_kb_extraction_failed', 'assistant', v_document.id,
    jsonb_build_object('version_id', v_version.id, 'kept_version_id', v_document.active_version_id));
end $$;

-- Edit the text in the app, or write a new article (p_document_id null). The
-- text becomes a new version; its sections come from the shared splitter.
create function save_kiara_document_text_with_audit(
  p_document_id uuid, p_title text, p_category text, p_audience text, p_text text, p_chunks jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_document kiara_documents;
  v_version_id uuid := gen_random_uuid();
  v_number integer;
  v_previous uuid;
  v_count integer;
  v_words integer;
begin
  perform kiara_kb_assert_details(p_title, p_category, p_audience);
  perform kiara_kb_assert_chunks(p_text, p_chunks);
  v_words := coalesce(array_length(regexp_split_to_array(btrim(p_text), '\s+'), 1), 0);
  if p_document_id is null then
    insert into kiara_documents(tenant_id, title, category, audience, source_kind, status, created_by, updated_by)
    values (v_actor.tenant_id, btrim(p_title), nullif(btrim(p_category), ''), p_audience, 'manual', 'processing', v_actor.id, v_actor.id)
    returning * into v_document;
  else
    v_document := kiara_kb_document_for_write(v_actor, p_document_id);
  end if;
  v_previous := v_document.active_version_id;
  select coalesce(max(version_number), 0) + 1 into v_number from kiara_document_versions where document_id = v_document.id;
  insert into kiara_document_versions(id, tenant_id, document_id, version_number, source, extraction_status, extracted_text,
    word_count, image_count, created_by, completed_at)
  values (v_version_id, v_actor.tenant_id, v_document.id, v_number, case when p_document_id is null then 'manual' else 'edited_text' end,
    'succeeded', p_text, v_words, 0, v_actor.id, now());
  update kiara_documents set title = btrim(p_title), category = nullif(btrim(p_category), ''), audience = p_audience
    where id = v_document.id returning * into v_document;
  v_count := kiara_kb_publish_version(v_document, v_version_id, p_chunks);
  update kiara_documents set active_version_id = v_version_id,
    status = case when status in ('inactive','suggested') then status else 'active' end,
    updated_by = v_actor.id, updated_at = now()
  where id = v_document.id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id,
    case when p_document_id is null then 'assistant_kb_article_created' else 'assistant_kb_text_saved' end, 'assistant', v_document.id,
    jsonb_build_object('previous_version_id', v_previous, 'version_id', v_version_id, 'chunk_count', v_count,
      'text_length', length(p_text), 'title', v_document.title, 'audience', p_audience));
  return jsonb_build_object('document_id', v_document.id, 'version_id', v_version_id, 'chunk_count', v_count);
end $$;

create function update_kiara_document_details_with_audit(p_document_id uuid, p_title text, p_category text, p_audience text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_document kiara_documents := kiara_kb_document_for_write(v_actor, p_document_id);
begin
  perform kiara_kb_assert_details(p_title, p_category, p_audience);
  update kiara_documents set title = btrim(p_title), category = nullif(btrim(p_category), ''), audience = p_audience,
    updated_by = v_actor.id, updated_at = now()
  where id = v_document.id;
  update kiara_document_chunks set document_title = btrim(p_title) where document_id = v_document.id and document_title <> btrim(p_title);
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_kb_details_updated', 'assistant', v_document.id,
    jsonb_build_object('title', v_document.title, 'category', v_document.category, 'audience', v_document.audience),
    jsonb_build_object('title', btrim(p_title), 'category', nullif(btrim(p_category), ''), 'audience', p_audience));
end $$;

-- active/inactive; approving a suggested document makes it active.
create function set_kiara_document_status_with_audit(p_document_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_document kiara_documents := kiara_kb_document_for_write(v_actor, p_document_id);
begin
  if p_status is null or p_status not in ('active','inactive') then
    raise exception 'Status must be active or inactive' using errcode = '22023';
  end if;
  if v_document.active_version_id is null then
    raise exception 'This document has no extracted text yet' using errcode = '22023';
  end if;
  if v_document.status = p_status then return; end if;
  update kiara_documents set status = p_status, updated_by = v_actor.id, updated_at = now() where id = v_document.id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_kb_status_changed', 'assistant', v_document.id,
    jsonb_build_object('status', v_document.status), jsonb_build_object('status', p_status));
end $$;

-- Tombstone: the title stays so past citations say "document removed"; the
-- chunks and text go now, and the caller removes the returned files (the
-- storage policy allows deleting only files of deleted documents).
create function delete_kiara_document_with_audit(p_document_id uuid)
returns text[] language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_document kiara_documents;
  v_paths text[];
begin
  select * into v_document from kiara_documents where id = p_document_id for update;
  if v_document.id is null or v_document.tenant_id <> v_actor.tenant_id then
    raise exception 'Document not found' using errcode = '42501';
  end if;
  select coalesce(array_agg(storage_path order by version_number), '{}') into v_paths
  from kiara_document_versions where document_id = v_document.id and storage_path is not null;
  if v_document.status = 'deleted' then return v_paths; end if;
  delete from kiara_document_chunks where document_id = v_document.id;
  update kiara_document_versions set extracted_text = null where document_id = v_document.id;
  update kiara_documents set status = 'deleted', active_version_id = null, deleted_at = now(), deleted_by = v_actor.id,
    updated_by = v_actor.id, updated_at = now()
  where id = v_document.id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_kb_document_deleted', 'assistant', v_document.id,
    jsonb_build_object('status', v_document.status, 'title', v_document.title),
    jsonb_build_object('status', 'deleted', 'files', cardinality(v_paths)));
  return v_paths;
end $$;

create function list_kiara_documents(p_search text default null, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if p_status is not null and p_status not in ('processing','active','inactive','suggested','failed','deleted') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  if v_search is not null and length(v_search) > 100 then
    raise exception 'Search must be at most 100 characters' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(item order by (item ->> 'updated_at') desc, item ->> 'id')
    from (
      select jsonb_build_object(
        'id', d.id, 'title', d.title, 'category', d.category, 'audience', d.audience, 'source_kind', d.source_kind,
        'status', d.status, 'updated_at', d.updated_at, 'created_at', d.created_at,
        'active_version_id', d.active_version_id,
        'version_number', av.version_number, 'word_count', av.word_count, 'image_count', av.image_count,
        'chunk_count', coalesce(av.chunk_count, 0), 'original_filename', av.original_filename,
        'latest_version', (select jsonb_build_object('id', lv.id, 'version_number', lv.version_number,
            'extraction_status', lv.extraction_status, 'extraction_error', lv.extraction_error, 'created_at', lv.created_at)
          from kiara_document_versions lv where lv.document_id = d.id order by lv.version_number desc limit 1)
      ) as item
      from kiara_documents d
      left join kiara_document_versions av on av.id = d.active_version_id
      where d.tenant_id = v_actor.tenant_id
        and (p_status is null and d.status <> 'deleted' or d.status = p_status)
        and (v_search is null or d.title ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or coalesce(d.category, '') ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      order by d.updated_at desc, d.id
      limit 1000
    ) rows
  ), '[]'::jsonb);
end $$;

-- One document for the knowledge screen: details, versions, the live text, and
-- the sections exactly as Kiara reads them.
create function get_kiara_document(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_kb_actor(); v_document kiara_documents;
begin
  select * into v_document from kiara_documents where id = p_id;
  if v_document.id is null or v_document.tenant_id <> v_actor.tenant_id then
    raise exception 'Document not found' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', v_document.id, 'title', v_document.title, 'category', v_document.category, 'audience', v_document.audience,
    'source_kind', v_document.source_kind, 'status', v_document.status, 'active_version_id', v_document.active_version_id,
    'created_at', v_document.created_at, 'updated_at', v_document.updated_at,
    'updated_by', (select p.employee_name from user_profiles p where p.id = v_document.updated_by),
    'text', (select v.extracted_text from kiara_document_versions v where v.id = v_document.active_version_id),
    'versions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'version_number', v.version_number, 'source', v.source, 'original_filename', v.original_filename,
        'byte_size', v.byte_size, 'extraction_status', v.extraction_status, 'extraction_error', v.extraction_error,
        'word_count', v.word_count, 'image_count', v.image_count, 'chunk_count', v.chunk_count,
        'created_at', v.created_at, 'created_by', (select p.employee_name from user_profiles p where p.id = v.created_by))
        order by v.version_number desc)
      from kiara_document_versions v where v.document_id = v_document.id), '[]'::jsonb),
    'sections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'ordinal', c.ordinal, 'heading_path', c.heading_path, 'content', c.content)
        order by c.ordinal)
      from kiara_document_chunks c where c.version_id = v_document.active_version_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 7. Reader RPCs (every Ask Kiara user; read-only, no audit row)
-- ---------------------------------------------------------------------------

-- The only read path to knowledge for employees. The question's own audit row
-- (complete_kiara_turn) lists the cited document ids.
create function search_kiara_knowledge(p_query text, p_original_terms text default null, p_limit integer default 5)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_actor();
  v_query text := btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'));
  v_terms text := btrim(regexp_replace(coalesce(p_original_terms, ''), '\s+', ' ', 'g'));
  v_limit integer := coalesce(p_limit, 5);
  v_english tsquery;
  v_simple tsquery;
  -- Effective role: dashboard authority counts (current_profile()).
  v_manager boolean := v_actor.user_role in ('super_admin','admin','manager');
begin
  if v_query = '' and v_terms = '' then
    raise exception 'Give words to search for' using errcode = '22023';
  end if;
  if length(v_query) > 200 or length(v_terms) > 200 then
    raise exception 'Search words must be at most 200 characters' using errcode = '22023';
  end if;
  if v_limit < 1 or v_limit > 8 then
    raise exception 'Limit must be 1 to 8' using errcode = '22023';
  end if;
  v_english := kiara_or_tsquery('english', v_query);
  v_simple := kiara_or_tsquery('simple', nullif(btrim(v_terms || ' ' || v_query), ''));
  return jsonb_build_object('results', coalesce((
    select jsonb_agg(jsonb_build_object('chunk_id', r.id, 'document_id', r.document_id, 'version_id', r.version_id,
      'title', r.title, 'heading_path', r.heading_path, 'content', r.content) order by r.rank desc, r.id)
    from (
      select c.id, c.document_id, c.version_id, d.title, c.heading_path, c.content,
        coalesce(ts_rank_cd(c.search_vector, v_english), 0) + 0.5 * coalesce(ts_rank_cd(c.search_vector, v_simple), 0) as rank
      from kiara_document_chunks c
      join kiara_documents d on d.id = c.document_id and d.active_version_id = c.version_id
      where c.tenant_id = v_actor.tenant_id and d.tenant_id = v_actor.tenant_id
        and d.status = 'active'
        and (d.audience = 'everyone' or v_manager)
        and (c.search_vector @@ v_english or c.search_vector @@ v_simple)
      order by rank desc, c.id
      limit v_limit
    ) r), '[]'::jsonb));
end $$;

-- The excerpt behind a citation chip, with the same visibility as search.
create function get_kiara_knowledge_excerpt(p_chunk_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_actor();
  v_manager boolean := v_actor.user_role in ('super_admin','admin','manager');
  v_row jsonb;
begin
  select jsonb_build_object('available', true, 'title', d.title, 'heading_path', c.heading_path, 'content', c.content)
    into v_row
  from kiara_document_chunks c
  join kiara_documents d on d.id = c.document_id and d.active_version_id = c.version_id
  where c.id = p_chunk_id and c.tenant_id = v_actor.tenant_id and d.status = 'active'
    and (d.audience = 'everyone' or v_manager);
  return coalesce(v_row, jsonb_build_object('available', false));
end $$;

alter function create_kiara_document_with_audit(text,text,text,text,integer,text) owner to postgres;
alter function add_kiara_document_version_with_audit(uuid,text,integer,text) owner to postgres;
alter function get_kiara_version_for_ingest(uuid) owner to postgres;
alter function store_kiara_extraction_with_audit(uuid,text,jsonb,integer,integer) owner to postgres;
alter function fail_kiara_extraction_with_audit(uuid,text) owner to postgres;
alter function save_kiara_document_text_with_audit(uuid,text,text,text,text,jsonb) owner to postgres;
alter function update_kiara_document_details_with_audit(uuid,text,text,text) owner to postgres;
alter function set_kiara_document_status_with_audit(uuid,text) owner to postgres;
alter function delete_kiara_document_with_audit(uuid) owner to postgres;
alter function list_kiara_documents(text,text) owner to postgres;
alter function get_kiara_document(uuid) owner to postgres;
alter function search_kiara_knowledge(text,text,integer) owner to postgres;
alter function get_kiara_knowledge_excerpt(uuid) owner to postgres;

revoke all on function
  create_kiara_document_with_audit(text,text,text,text,integer,text),
  add_kiara_document_version_with_audit(uuid,text,integer,text),
  get_kiara_version_for_ingest(uuid),
  store_kiara_extraction_with_audit(uuid,text,jsonb,integer,integer),
  fail_kiara_extraction_with_audit(uuid,text),
  save_kiara_document_text_with_audit(uuid,text,text,text,text,jsonb),
  update_kiara_document_details_with_audit(uuid,text,text,text),
  set_kiara_document_status_with_audit(uuid,text),
  delete_kiara_document_with_audit(uuid),
  list_kiara_documents(text,text),
  get_kiara_document(uuid),
  search_kiara_knowledge(text,text,integer),
  get_kiara_knowledge_excerpt(uuid)
from public, anon, authenticated, service_role;
grant execute on function
  create_kiara_document_with_audit(text,text,text,text,integer,text),
  add_kiara_document_version_with_audit(uuid,text,integer,text),
  get_kiara_version_for_ingest(uuid),
  store_kiara_extraction_with_audit(uuid,text,jsonb,integer,integer),
  fail_kiara_extraction_with_audit(uuid,text),
  save_kiara_document_text_with_audit(uuid,text,text,text,text,jsonb),
  update_kiara_document_details_with_audit(uuid,text,text,text),
  set_kiara_document_status_with_audit(uuid,text),
  delete_kiara_document_with_audit(uuid),
  list_kiara_documents(text,text),
  get_kiara_document(uuid),
  search_kiara_knowledge(text,text,integer),
  get_kiara_knowledge_excerpt(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Retirement manifest: knowledge tables are retained (never demo data)
-- ---------------------------------------------------------------------------

create or replace function public.production_demo_data_retirement_manifest(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_manifest jsonb;
  v_unclassified text[];
  v_classified constant text[] := array[
    'audit_logs','branches','buddy_assignments','client_assignments','client_contact_aliases',
    'client_followups','client_timeline','clients','crm_branch_mappings','crm_custom_field_values',
    'crm_documents','crm_field_definition_revisions','crm_field_definitions','crm_identity_review',
    'crm_import_exceptions','crm_import_records','crm_import_runs','crm_legacy_people',
    'crm_legacy_timeline_details','crm_migration_registry','crm_source_records','crm_source_systems',
    'crm_staff_mappings','crm_sync_checkpoints','crm_sync_operation_requests','crm_sync_runs',
    'crm_sync_worker_assertions','crm_mutation_keys','departments','dropdown_master_categories','dropdown_masters',
    'export_logs','fms_flows','fms_instance_checklist_items','fms_starter_assignments',
    'form_submissions','form_templates','notification_deliveries','notification_events','notification_logs',
    'notification_provider_configuration','notification_rules','notification_templates','notifications',
    'performance_snapshots','production_demo_data_retirements','resignations','settings_mutation_keys',
    'task_import_batches','task_import_items','task_import_row_registry','task_instances','task_templates',
    'task_watchers',
    'tenant_realtime_events','tenant_section_controls','user_availability','user_organization_history',
    'user_preferences','user_profiles','username_login_rate_limits','walkin_entries','walkin_uploads',
    'daily_checklist_acknowledgements','designation_daily_checklists','fms_evidence',
    'fms_instance_stage_assignees','fms_instances',
    'fms_context_assignee_defaults','fms_workflow_mutation_keys','form_submission_files',
    'leave_requests','task_import_identity_aliases','designation_permission_overrides',
    'role_permissions','user_access_profiles','user_permission_overrides','department_permission_overrides','dashboard_saved_views',
    'kiara_settings','kiara_user_limits','kiara_daily_usage','kiara_conversations','kiara_messages','kiara_question_facts',
    'kiara_documents','kiara_document_versions','kiara_document_chunks'
  ];
begin
  select array_agg(c.relname order by c.relname)
  into v_unclassified
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname <> all(v_classified);

  if coalesce(cardinality(v_unclassified), 0) <> 0 then
    raise exception 'Production demo-data retirement manifest has unclassified tenant tables: %', array_to_string(v_unclassified, ', ')
      using errcode = 'P0001';
  end if;

  v_manifest := jsonb_build_object(
    'removal_counts', jsonb_build_object(
      'task_attachments', (select count(*) from public.task_attachments a join public.task_instances t on t.id = a.task_instance_id where t.tenant_id = p_tenant_id),
      'task_watchers', (select count(*) from public.task_watchers w join public.task_instances t on t.id = w.task_instance_id where t.tenant_id = p_tenant_id),
      'task_assignees', (select count(*) from public.task_assignees a join public.task_instances t on t.id = a.task_instance_id where t.tenant_id = p_tenant_id),
      'task_checklists', (select count(*) from public.task_checklists c join public.task_instances t on t.id = c.task_instance_id where t.tenant_id = p_tenant_id),
      'task_comments', (select count(*) from public.task_comments c join public.task_instances t on t.id = c.task_instance_id where t.tenant_id = p_tenant_id),
      'task_revisions', (select count(*) from public.task_revisions r join public.task_instances t on t.id = r.task_instance_id where t.tenant_id = p_tenant_id),
      'task_import_items', (select count(*) from public.task_import_items where tenant_id = p_tenant_id),
      'task_import_batches', (select count(*) from public.task_import_batches where tenant_id = p_tenant_id),
      'task_instances', (select count(*) from public.task_instances where tenant_id = p_tenant_id),
      'task_templates', (select count(*) from public.task_templates where tenant_id = p_tenant_id),
      'fms_evidence', (select count(*) from public.fms_evidence where tenant_id = p_tenant_id),
      'fms_instances', (select count(*) from public.fms_instances where tenant_id = p_tenant_id),
      'fms_flows', (select count(*) from public.fms_flows where tenant_id = p_tenant_id),
      'form_submissions', (select count(*) from public.form_submissions where tenant_id = p_tenant_id),
      'form_templates', (select count(*) from public.form_templates where tenant_id = p_tenant_id),
      'form_submission_files', (select count(*) from public.form_submission_files where tenant_id = p_tenant_id),
      'notification_deliveries', (select count(*) from public.notification_deliveries where tenant_id = p_tenant_id),
      'notification_events', (select count(*) from public.notification_events where tenant_id = p_tenant_id),
      'notifications', (select count(*) from public.notifications where tenant_id = p_tenant_id),
      'notification_logs', (select count(*) from public.notification_logs where tenant_id = p_tenant_id),
      'notification_rules', (select count(*) from public.notification_rules where tenant_id = p_tenant_id),
      'notification_templates', (select count(*) from public.notification_templates where tenant_id = p_tenant_id),
      'export_logs', (select count(*) from public.export_logs where tenant_id = p_tenant_id),
      'performance_snapshots', (select count(*) from public.performance_snapshots where tenant_id = p_tenant_id),
      'tenant_realtime_events', (select count(*) from public.tenant_realtime_events where tenant_id = p_tenant_id),
      'daily_checklist_acknowledgements', (select count(*) from public.daily_checklist_acknowledgements where tenant_id = p_tenant_id),
      'designation_daily_checklists', (select count(*) from public.designation_daily_checklists where tenant_id = p_tenant_id)
    ),
    'retained_counts', jsonb_build_object(
      'user_profiles', (select count(*) from public.user_profiles where tenant_id = p_tenant_id),
      'branches', (select count(*) from public.branches where tenant_id = p_tenant_id),
      'department_permission_overrides', (select count(*) from public.department_permission_overrides where tenant_id = p_tenant_id),
      'departments', (select count(*) from public.departments where tenant_id = p_tenant_id),
      'user_availability', (select count(*) from public.user_availability where tenant_id = p_tenant_id),
      'leave_requests', (select count(*) from public.leave_requests where tenant_id = p_tenant_id),
      'task_import_identity_aliases', (select count(*) from public.task_import_identity_aliases where tenant_id = p_tenant_id),
      'designation_permission_overrides', (select count(*) from public.designation_permission_overrides where tenant_id = p_tenant_id),
      'role_permissions', (select count(*) from public.role_permissions where tenant_id = p_tenant_id),
      'user_access_profiles', (select count(*) from public.user_access_profiles where tenant_id = p_tenant_id),
      'user_permission_overrides', (select count(*) from public.user_permission_overrides where tenant_id = p_tenant_id),
      'clients', (select count(*) from public.clients where tenant_id = p_tenant_id),
      'crm_documents', (select count(*) from public.crm_documents where tenant_id = p_tenant_id),
      'dashboard_saved_views', (select count(*) from public.dashboard_saved_views where tenant_id = p_tenant_id),
      'audit_logs', (select count(*) from public.audit_logs where tenant_id = p_tenant_id),
      'kiara_settings', (select count(*) from public.kiara_settings where tenant_id = p_tenant_id),
      'kiara_user_limits', (select count(*) from public.kiara_user_limits where tenant_id = p_tenant_id),
      'kiara_daily_usage', (select count(*) from public.kiara_daily_usage where tenant_id = p_tenant_id),
      'kiara_conversations', (select count(*) from public.kiara_conversations where tenant_id = p_tenant_id),
      'kiara_messages', (select count(*) from public.kiara_messages where tenant_id = p_tenant_id),
      'kiara_question_facts', (select count(*) from public.kiara_question_facts where tenant_id = p_tenant_id),
      'kiara_documents', (select count(*) from public.kiara_documents where tenant_id = p_tenant_id),
      'kiara_document_versions', (select count(*) from public.kiara_document_versions where tenant_id = p_tenant_id),
      'kiara_document_chunks', (select count(*) from public.kiara_document_chunks where tenant_id = p_tenant_id)
    )
  );
  return v_manifest;
end;
$$;

revoke all on function public.production_demo_data_retirement_manifest(uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
