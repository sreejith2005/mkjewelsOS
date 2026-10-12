begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture (synthetic text only). Tenant A: 1 Super Admin, 2 admin, 3 manager,
-- 4 staff, 5 HR, 6 staff with manager dashboard authority, 7 disabled staff,
-- 9 staff with an individual grant of assistant.manage_knowledge.
-- Tenant B: 8 Super Admin, 10 staff.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('20800000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated', 'kb-' || n || '@example.invalid',
  crypt('local-test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 10) n;

insert into tenants(id, name, slug, timezone) values
  ('20810000-0000-4000-8000-000000000001', 'KB fixture A', 'kb-fixture-a', 'Asia/Kolkata'),
  ('20810000-0000-4000-8000-000000000002', 'KB fixture B', 'kb-fixture-b', 'Asia/Kolkata');
insert into branches(id, tenant_id, name, code) values
  ('20820000-0000-4000-8000-000000000001', '20810000-0000-4000-8000-000000000001', 'KB branch A', 'KB-A'),
  ('20820000-0000-4000-8000-000000000002', '20810000-0000-4000-8000-000000000002', 'KB branch B', 'KB-B');
insert into departments(id, tenant_id, branch_id, name, code) values
  ('20830000-0000-4000-8000-000000000001', '20810000-0000-4000-8000-000000000001', '20820000-0000-4000-8000-000000000001', 'KB dept A', 'KB-DA'),
  ('20830000-0000-4000-8000-000000000002', '20810000-0000-4000-8000-000000000002', '20820000-0000-4000-8000-000000000002', 'KB dept B', 'KB-DB');

insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
select ('20840000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid, ('20800000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid,
  case when f.b then '20810000-0000-4000-8000-000000000002'::uuid else '20810000-0000-4000-8000-000000000001'::uuid end,
  case when f.b then '20820000-0000-4000-8000-000000000002'::uuid else '20820000-0000-4000-8000-000000000001'::uuid end,
  case when f.b then '20830000-0000-4000-8000-000000000002'::uuid else '20830000-0000-4000-8000-000000000001'::uuid end,
  f.name, '0000208' || lpad(f.n::text, 3, '0'), 'kb-' || f.n || '@example.invalid', 'KB-' || f.n, f.role::user_role,
  'active', 'active', f.enabled, '{}'
from (values
  (1, 'KB Super Admin', 'super_admin', true, false),
  (2, 'KB Admin', 'admin', true, false),
  (3, 'KB Manager', 'manager', true, false),
  (4, 'KB Staff', 'staff', true, false),
  (5, 'KB HR', 'hr', true, false),
  (6, 'KB Staff Authority', 'staff', true, false),
  (7, 'KB Disabled', 'staff', false, false),
  (8, 'KB Other Super Admin', 'super_admin', true, true),
  (9, 'KB Granted Staff', 'staff', true, false),
  (10, 'KB Other Staff', 'staff', true, true)
) as f(n, name, role, enabled, b);
insert into user_access_profiles(user_profile_id, tenant_id, dashboard_authority)
values ('20840000-0000-4000-8000-000000000006', '20810000-0000-4000-8000-000000000001', 'manager');
insert into user_permission_overrides(tenant_id, user_profile_id, permission_key, effect)
values ('20810000-0000-4000-8000-000000000001', '20840000-0000-4000-8000-000000000009', 'assistant.manage_knowledge', 'grant');

create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '20800000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'), true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;
create function pg_temp.sha(p_n integer) returns text language sql immutable as $$ select repeat(to_hex(p_n % 16), 64) $$;
-- Chunk titles visible to the caller for a search (titles are synthetic and distinct).
create function pg_temp.found(p_query text, p_terms text default null) returns text[] language sql as $$
  select coalesce(array_agg(distinct r ->> 'title' order by r ->> 'title'), '{}')
  from jsonb_array_elements(search_kiara_knowledge(p_query, p_terms, 8) -> 'results') r
$$;
create function pg_temp.chunks(p_text text) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('heading_path', 'Synthetic', 'content', p_text))
$$;
create temp table ids(name text primary key, id uuid, path text);
grant all on ids to authenticated;
grant execute on function pg_temp.as_user(integer), pg_temp.sha(integer), pg_temp.found(text, text), pg_temp.chunks(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants, bucket, helpers
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'kiara_document_chunks', 'SELECT'), 'chunks have no client grant (search RPC only)');
select ok(not has_table_privilege('authenticated', 'kiara_documents', 'INSERT') and not has_table_privilege('authenticated', 'kiara_documents', 'UPDATE')
  and not has_table_privilege('authenticated', 'kiara_document_versions', 'UPDATE') and not has_table_privilege('authenticated', 'kiara_document_versions', 'DELETE'),
  'no direct client writes to documents or versions');
select ok(not has_table_privilege('service_role', 'kiara_documents', 'SELECT') and not has_table_privilege('anon', 'kiara_documents', 'SELECT'), 'service role and anon cannot read documents');
select ok(not has_function_privilege('anon', 'search_kiara_knowledge(text,text,integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'create_kiara_document_with_audit(text,text,text,text,integer,text,text[])', 'EXECUTE'), 'anon and service role cannot call KB RPCs');
select ok(not has_function_privilege('authenticated', 'kiara_kb_publish_version(kiara_documents,uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'kiara_kb_actor()', 'EXECUTE'), 'internal helpers stay owner-only');
select is((select array[public::text, file_size_limit::text, array_to_string(allowed_mime_types, ',')] from storage.buckets where id = 'kiara-knowledge'),
  array['false', '10485760', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], 'private bucket: .docx only, 10 MB');
select ok(production_demo_data_retirement_manifest('20810000-0000-4000-8000-000000000001') -> 'retained_counts' ? 'kiara_document_chunks', 'knowledge tables are classified and retained');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'tenant_realtime_events_topic_check')) like '%assistant%', 'realtime topic list includes assistant');

set local role service_role;
select throws_ok($$select search_kiara_knowledge('keys', null, 5)$$, '42501', null, 'service role cannot search');
reset role;

-- ---------------------------------------------------------------------------
-- Who may manage the knowledge base
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select list_kiara_documents(null, null)$$, '42501', 'Active profile required', 'unauthenticated callers are refused');
select pg_temp.as_user(7);
select throws_ok($$select list_kiara_documents(null, null)$$, '42501', 'Active profile required', 'a disabled account is refused');
select pg_temp.as_user(4);
select throws_ok(format('select create_kiara_document_with_audit(%L, null, %L, %L, 100, %L)', 'Staff upload', 'everyone', 'x.docx', pg_temp.sha(1)),
  '42501', 'Knowledge base management requires permission', 'staff cannot upload');
select throws_ok($$select list_kiara_documents(null, null)$$, '42501', 'Knowledge base management requires permission', 'staff cannot list documents');
select pg_temp.as_user(2);
select throws_ok($$select list_kiara_documents(null, null)$$, '42501', 'Knowledge base management requires permission', 'admin cannot manage by default (Super Admin only)');
select pg_temp.as_user(9);
select lives_ok(format('select create_kiara_document_with_audit(%L, null, %L, %L, 100, %L)', 'Granted upload', 'everyone', 'granted.docx', pg_temp.sha(2)),
  'an individual grant of assistant.manage_knowledge allows uploads');

-- Input validation (Super Admin).
select pg_temp.as_user(1);
select throws_ok(format('select create_kiara_document_with_audit(%L, null, %L, %L, 100, %L)', 'Old', 'everyone', 'old.doc', pg_temp.sha(3)), '22023', 'Only .docx Word files can be uploaded', '.doc is refused');
select throws_ok(format('select create_kiara_document_with_audit(%L, null, %L, %L, 100, %L)', 'Pdf', 'everyone', 'scan.pdf', pg_temp.sha(3)), '22023', 'Only .docx Word files can be uploaded', 'PDF is refused');
select throws_ok(format('select create_kiara_document_with_audit(%L, null, %L, %L, 10485761, %L)', 'Big', 'everyone', 'big.docx', pg_temp.sha(3)), '22023', 'The file must be at most 10 MB', 'over 10 MB is refused');
select throws_ok(format('select create_kiara_document_with_audit(%L, null, %L, %L, 100, %L)', 'Hash', 'everyone', 'a.docx', 'nothex'), '22023', 'The file hash is invalid', 'a bad hash is refused');
select throws_ok(format('select create_kiara_document_with_audit(%L, null, %L, %L, 100, %L)', 'Aud', 'staff_only', 'a.docx', pg_temp.sha(3)), '22023', 'Visibility must be everyone, departments, or managers_and_above', 'an unknown visibility is refused');
select throws_ok(format('select create_kiara_document_with_audit(%L, null, %L, %L, 100, %L)', '  ', 'everyone', 'a.docx', pg_temp.sha(3)), '22023', 'Title must be 1 to 200 characters', 'a blank title is refused');

-- ---------------------------------------------------------------------------
-- Upload, storage path policy, extraction
-- ---------------------------------------------------------------------------
insert into ids select 'd1', (r ->> 'document_id')::uuid, r ->> 'storage_path'
from (select create_kiara_document_with_audit('Synthetic Key Control SOP', 'Store', 'everyone', 'Key control.docx', 2048, pg_temp.sha(5)) r) s;
insert into ids select 'v1', id, storage_path from kiara_document_versions where document_id = (select id from ids where name = 'd1');
select is((select status from kiara_documents where id = (select id from ids where name = 'd1')), 'processing', 'a new upload starts processing');
select ok(exists (select 1 from audit_logs where action = 'assistant_kb_document_created' and record_id = (select id from ids where name = 'd1')), 'creation is audited');
select throws_ok(format('select create_kiara_document_with_audit(%L, null, %L, %L, 2048, %L)', 'Again', 'everyone', 'again.docx', pg_temp.sha(5)),
  '23505', 'kiara_duplicate_document', 'the same file (by SHA-256) is reported as a duplicate');

select throws_ok(format('select store_kiara_extraction_with_audit(%L, %L, %L, 5, 0)', (select id from ids where name = 'v1'), 'Keys stay in the safe.', pg_temp.chunks('Keys stay in the safe.')),
  '22023', 'The uploaded file is missing', 'extraction is refused until the file is in the bucket');

-- Storage insert policy: exact pending path, by its creator, with the permission.
select pg_temp.as_user(4);
select throws_ok(format($$insert into storage.objects(bucket_id, name, owner_id, metadata) values ('kiara-knowledge', %L, '20800000-0000-4000-8000-000000000004', '{}')$$, (select path from ids where name = 'v1')),
  '42501', null, 'staff cannot upload into the knowledge bucket');
select pg_temp.as_user(8);
select throws_ok(format($$insert into storage.objects(bucket_id, name, owner_id, metadata) values ('kiara-knowledge', %L, '20800000-0000-4000-8000-000000000008', '{}')$$, (select path from ids where name = 'v1')),
  '42501', null, 'another tenant cannot upload into this tenant''s path');
select pg_temp.as_user(1);
select throws_ok($$insert into storage.objects(bucket_id, name, owner_id, metadata) values ('kiara-knowledge', '20810000-0000-4000-8000-000000000001/20810000-0000-4000-8000-000000000001/20810000-0000-4000-8000-000000000001.docx', '20800000-0000-4000-8000-000000000001', '{}')$$,
  '42501', null, 'a path without a pending version is refused');
select lives_ok(format($$insert into storage.objects(bucket_id, name, owner_id, metadata) values ('kiara-knowledge', %L, '20800000-0000-4000-8000-000000000001', '{"mimetype":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","size":2048}')$$, (select path from ids where name = 'v1')),
  'Super Admin uploads to the registered path');
select is((select get_kiara_version_for_ingest((select id from ids where name = 'v1')) ->> 'storage_path'), (select path from ids where name = 'v1'), 'the ingest read returns the path to verify');
select pg_temp.as_user(4);
select throws_ok(format('select get_kiara_version_for_ingest(%L)', (select id from ids where name = 'v1')), '42501', 'Knowledge base management requires permission', 'staff cannot read versions for ingest');
select is((select count(*)::integer from storage.objects where bucket_id = 'kiara-knowledge'), 0, 'staff cannot see knowledge files');
select pg_temp.as_user(1);

select throws_ok(format('select store_kiara_extraction_with_audit(%L, %L, %L, 5, 0)', (select id from ids where name = 'v1'), '# Keys\n\nKeys stay in the safe.', pg_temp.chunks('Invented text not in the document')),
  '22023', 'A section is invalid', 'a chunk that is not a slice of the text is refused');
select lives_ok(format('select store_kiara_extraction_with_audit(%L, %L, %L, 9, 1)', (select id from ids where name = 'v1'),
  E'# Keys\n\nThe store keys stay in the locker safe overnight.\n\n# Opening\n\nUnlock the shutter at ten.',
  '[{"heading_path":"Keys","content":"The store keys stay in the locker safe overnight."},{"heading_path":"Opening","content":"Unlock the shutter at ten."}]'),
  'the extraction is stored');
select is((select array[d.status, v.extraction_status, v.chunk_count::text, v.image_count::text] from kiara_documents d join kiara_document_versions v on v.id = d.active_version_id where d.id = (select id from ids where name = 'd1')),
  array['active', 'succeeded', '2', '1'], 'the document is live with its chunks and counts');
select ok((select new_value ->> 'chunk_count' = '2' and new_value::text not like '%locker%' from audit_logs where action = 'assistant_kb_extraction_stored' and record_id = (select id from ids where name = 'd1')),
  'the extraction audit has counts, never the text');
select ok(exists (select 1 from tenant_realtime_events where tenant_id = '20810000-0000-4000-8000-000000000001' and topic = 'assistant'), 'document changes emit the assistant realtime topic');

-- ---------------------------------------------------------------------------
-- Reading: search is the only path, and it enforces status and visibility
-- ---------------------------------------------------------------------------
select pg_temp.as_user(4);
select is((select count(*)::integer from kiara_documents), 0, 'staff cannot select documents directly');
select throws_ok($$select count(*) from kiara_document_chunks$$, '42501', null, 'staff cannot select chunks directly');
select is(pg_temp.found('locker keys'), array['Synthetic Key Control SOP'], 'staff find an active document by English keywords');
select is((search_kiara_knowledge('locker keys', null, 5) -> 'results' -> 0 ->> 'heading_path'), 'Keys', 'results carry the section heading');
select throws_ok($$select search_kiara_knowledge('  ', null, 5)$$, '22023', 'Give words to search for', 'an empty search is refused');
select throws_ok($$select search_kiara_knowledge('keys', null, 9)$$, '22023', 'Limit must be 1 to 8', 'at most 8 results');

-- A managers-only article (typed in the app) and a Hindi one.
select pg_temp.as_user(1);
insert into ids select 'd2', (save_kiara_document_text_with_audit(null, 'Synthetic Discount Authority', 'Sales', 'managers_and_above',
  E'# Approval\n\nDiscount approval above five percent needs the branch head.', '[{"heading_path":"Approval","content":"Discount approval above five percent needs the branch head."}]') ->> 'document_id')::uuid, null;
insert into ids select 'd3', (save_kiara_document_text_with_audit(null, 'Synthetic Leave Hindi', null, 'everyone',
  E'# छुट्टी\n\nछुट्टी के लिए दो दिन पहले आवेदन करें।', '[{"heading_path":"छुट्टी","content":"छुट्टी के लिए दो दिन पहले आवेदन करें।"}]') ->> 'document_id')::uuid, null;
select is((select array[source_kind, status] from kiara_documents where id = (select id from ids where name = 'd2')), array['manual', 'active'], 'a typed article is live at once');
reset role;
insert into ids select 'c2', id, null from kiara_document_chunks where document_id = (select id from ids where name = 'd2') limit 1;
set local role authenticated;
select ok(exists (select 1 from audit_logs where action = 'assistant_kb_article_created' and record_id = (select id from ids where name = 'd2')), 'articles are audited');
select is(pg_temp.found('discount approval'), array['Synthetic Discount Authority'], 'Super Admin finds managers-only documents');
select pg_temp.as_user(3);
select is(pg_temp.found('discount approval'), array['Synthetic Discount Authority'], 'a manager finds managers-only documents');
select is((get_kiara_knowledge_excerpt((select id from ids where name = 'c2')) ->> 'available'), 'true', 'a manager can open the managers-only excerpt');
select pg_temp.as_user(6);
select is(pg_temp.found('discount approval'), array['Synthetic Discount Authority'], 'manager dashboard authority counts as managers and above');
select pg_temp.as_user(4);
select is(pg_temp.found('discount approval'), '{}'::text[], 'staff never retrieve managers-only documents');
select is((get_kiara_knowledge_excerpt((select id from ids where name = 'c2')) ->> 'available'), 'false', 'staff cannot open a managers-only excerpt either');
select pg_temp.as_user(5);
select is(pg_temp.found('discount approval'), '{}'::text[], 'HR is not managers and above');
select pg_temp.as_user(4);
select is(pg_temp.found('leave', 'छुट्टी आवेदन'), array['Synthetic Leave Hindi'], 'Devanagari terms match Hindi text through the simple configuration');

-- Status: inactive and suggested documents are not searchable.
select pg_temp.as_user(1);
select lives_ok(format('select set_kiara_document_status_with_audit(%L, %L)', (select id from ids where name = 'd1'), 'inactive'), 'deactivate');
select pg_temp.as_user(4);
select is(pg_temp.found('locker keys'), '{}'::text[], 'inactive documents are not searchable');
select pg_temp.as_user(1);
select lives_ok(format('select set_kiara_document_status_with_audit(%L, %L)', (select id from ids where name = 'd1'), 'active'), 'reactivate');
select ok(exists (select 1 from audit_logs where action = 'assistant_kb_status_changed' and record_id = (select id from ids where name = 'd1')), 'status changes are audited');

reset role;
insert into kiara_documents(id, tenant_id, title, visibility, source_kind, status) values
  ('20850000-0000-4000-8000-000000000001', '20810000-0000-4000-8000-000000000001', 'Synthetic Suggested Answer', 'everyone', 'escalation_answer', 'processing');
insert into kiara_document_versions(id, tenant_id, document_id, version_number, source, extraction_status, extracted_text)
values ('20850000-0000-4000-8000-000000000002', '20810000-0000-4000-8000-000000000001', '20850000-0000-4000-8000-000000000001', 1, 'escalation_answer', 'succeeded', 'Gift wrapping is free for bridal orders.');
insert into kiara_document_chunks(tenant_id, document_id, version_id, ordinal, document_title, content)
values ('20810000-0000-4000-8000-000000000001', '20850000-0000-4000-8000-000000000001', '20850000-0000-4000-8000-000000000002', 1, 'Synthetic Suggested Answer', 'Gift wrapping is free for bridal orders.');
update kiara_documents set status = 'suggested', active_version_id = '20850000-0000-4000-8000-000000000002' where id = '20850000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user(4);
select is(pg_temp.found('gift wrapping bridal'), '{}'::text[], 'suggested documents are not searchable');
select pg_temp.as_user(1);
select lives_ok($$select set_kiara_document_status_with_audit('20850000-0000-4000-8000-000000000001', 'active')$$, 'Super Admin approves a suggested document');
select pg_temp.as_user(4);
select is(pg_temp.found('gift wrapping bridal'), array['Synthetic Suggested Answer'], 'an approved suggestion becomes searchable');

-- ---------------------------------------------------------------------------
-- Replace: the old version stays live until the new one is extracted
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
insert into ids select 'v2', (add_kiara_document_version_with_audit((select id from ids where name = 'd1'), 'Key control v2.docx', 3000, pg_temp.sha(6)) ->> 'version_id')::uuid, null;
update ids set path = (select storage_path from kiara_document_versions where id = ids.id) where name = 'v2';
select is((select array[d.status, d.active_version_id::text] from kiara_documents d where d.id = (select id from ids where name = 'd1')),
  array['active', (select id::text from ids where name = 'v1')], 'a pending replacement leaves the old version live');
select pg_temp.as_user(4);
select is(pg_temp.found('locker keys'), array['Synthetic Key Control SOP'], 'search still returns the old version while the new one is pending');
select pg_temp.as_user(1);
select lives_ok(format('select fail_kiara_extraction_with_audit(%L, %L)', (select id from ids where name = 'v2'), 'Word could not read this file.'), 'a failed replacement is recorded');
select is((select array[d.status, d.active_version_id::text, v.extraction_status] from kiara_documents d join kiara_document_versions v on v.id = (select id from ids where name = 'v2') where d.id = (select id from ids where name = 'd1')),
  array['active', (select id::text from ids where name = 'v1'), 'failed'], 'after a failed replacement the old version is still live');
insert into ids select 'v3', (add_kiara_document_version_with_audit((select id from ids where name = 'd1'), 'Key control v3.docx', 3000, pg_temp.sha(7)) ->> 'version_id')::uuid, null;
update ids set path = (select storage_path from kiara_document_versions where id = ids.id) where name = 'v3';
insert into storage.objects(bucket_id, name, owner_id, metadata) select 'kiara-knowledge', path, '20800000-0000-4000-8000-000000000001', '{}' from ids where name = 'v3';
select lives_ok(format('select store_kiara_extraction_with_audit(%L, %L, %L, 6, 0)', (select id from ids where name = 'v3'),
  E'# Keys\n\nThe vault keys go to the cashier at closing.', '[{"heading_path":"Keys","content":"The vault keys go to the cashier at closing."}]'), 'the replacement is extracted');
select is((select active_version_id from kiara_documents where id = (select id from ids where name = 'd1')), (select id from ids where name = 'v3'), 'the new version is live');
reset role;
select is((select count(*)::integer from kiara_document_chunks where version_id = (select id from ids where name = 'v1')), 0, 'the old version''s chunks are removed');
set local role authenticated;
select pg_temp.as_user(4);
select is(pg_temp.found('locker'), '{}'::text[], 'old text is no longer retrieved');
select is(pg_temp.found('vault cashier'), array['Synthetic Key Control SOP'], 'new text is retrieved');

-- ---------------------------------------------------------------------------
-- Edit text, details, visibility
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
select lives_ok(format('select save_kiara_document_text_with_audit(%L, %L, %L, %L, %L, %L)', (select id from ids where name = 'd1'), 'Synthetic Key Control SOP', 'Store', 'everyone',
  E'# Keys\n\nThe vault keys go to the cashier at closing and are signed for.', '[{"heading_path":"Keys","content":"The vault keys go to the cashier at closing and are signed for."}]'), 'in-app edits save a new version');
select is((select v.source from kiara_documents d join kiara_document_versions v on v.id = d.active_version_id where d.id = (select id from ids where name = 'd1')), 'edited_text', 'the edit is the live version');
select ok(exists (select 1 from audit_logs where action = 'assistant_kb_text_saved' and record_id = (select id from ids where name = 'd1') and new_value ? 'previous_version_id'), 'edits are audited with old and new version ids');
select lives_ok(format('select update_kiara_document_details_with_audit(%L, %L, %L, %L)', (select id from ids where name = 'd1'), 'Synthetic Vault Key SOP', 'Store', 'managers_and_above'), 'details change');
reset role;
select is((select distinct document_title from kiara_document_chunks where document_id = (select id from ids where name = 'd1')), 'Synthetic Vault Key SOP', 'a rename reaches the chunks');
set local role authenticated;
select pg_temp.as_user(4);
select is(pg_temp.found('vault cashier'), '{}'::text[], 'changing the visibility to managers hides it from staff at once');
select pg_temp.as_user(3);
select is(pg_temp.found('vault cashier'), array['Synthetic Vault Key SOP'], 'and managers still find it');

-- ---------------------------------------------------------------------------
-- Cross-tenant
-- ---------------------------------------------------------------------------
select pg_temp.as_user(8);
select throws_ok(format('select get_kiara_document(%L)', (select id from ids where name = 'd1')), '42501', 'Document not found', 'another tenant''s Super Admin cannot read the document');
select throws_ok(format('select set_kiara_document_status_with_audit(%L, %L)', (select id from ids where name = 'd1'), 'inactive'), '42501', 'Document not found', 'or change it');
select throws_ok(format('select delete_kiara_document_with_audit(%L)', (select id from ids where name = 'd1')), '42501', 'Document not found', 'or delete it');
select is(jsonb_array_length(list_kiara_documents(null, null)), 0, 'another tenant lists none of these documents');
select is(pg_temp.found('vault cashier keys locker discount'), '{}'::text[], 'another tenant''s search never returns them');
select pg_temp.as_user(10);
select is(pg_temp.found('gift wrapping'), '{}'::text[], 'another tenant''s staff never retrieve them');

-- ---------------------------------------------------------------------------
-- Delete: tombstone, chunks and text removed, files removable afterwards only
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'kiara-knowledge' and name = (select path from ids where name = 'v3');
select is((select count(*)::integer from storage.objects where name = (select path from ids where name = 'v3')), 1, 'files of a live document cannot be deleted');
select is(cardinality(delete_kiara_document_with_audit((select id from ids where name = 'd1'))), 3, 'delete returns every stored file path');
select is((select array[status, coalesce(active_version_id::text, 'none')] from kiara_documents where id = (select id from ids where name = 'd1')), array['deleted', 'none'], 'the document is a tombstone');
reset role;
select is((select count(*)::integer from kiara_document_chunks where document_id = (select id from ids where name = 'd1')), 0, 'its chunks are gone');
set local role authenticated;
select is((select count(*)::integer from kiara_document_versions where document_id = (select id from ids where name = 'd1') and extracted_text is not null), 0, 'its text is gone');
delete from storage.objects where bucket_id = 'kiara-knowledge' and name in (select path from ids where name in ('v1', 'v3'));
select is((select count(*)::integer from storage.objects where name in (select path from ids where name in ('v1', 'v3'))), 0, 'its files can now be removed');
select throws_ok(format('select set_kiara_document_status_with_audit(%L, %L)', (select id from ids where name = 'd1'), 'active'), '22023', 'This document was deleted', 'a deleted document cannot be revived');
select ok(exists (select 1 from audit_logs where action = 'assistant_kb_document_deleted' and record_id = (select id from ids where name = 'd1')), 'deletion is audited');
select pg_temp.as_user(3);
select is(pg_temp.found('vault cashier'), '{}'::text[], 'a deleted document is never retrieved');

-- ---------------------------------------------------------------------------
-- The section switch
-- ---------------------------------------------------------------------------
reset role;
insert into tenant_section_controls(tenant_id, developer_mode_enabled, section_availability, settings_version)
values ('20810000-0000-4000-8000-000000000001', false, default_section_availability() || '{"ask_kiara": false}', 1)
on conflict (tenant_id) do update set section_availability = excluded.section_availability;
set local role authenticated;
select pg_temp.as_user(4);
select throws_ok($$select search_kiara_knowledge('gift', null, 5)$$, '42501', 'This section is currently unavailable', 'search is refused while the section is off');
select pg_temp.as_user(1);
select lives_ok($$select search_kiara_knowledge('gift', null, 5)$$, 'Super Admin keeps access through Developer Mode');

select * from finish();
rollback;
