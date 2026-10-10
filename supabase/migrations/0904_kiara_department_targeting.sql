-- Ask Kiara: department targeting for knowledge documents (owner decision 2026-10-10).
-- Design: docs/superpowers/specs/2026-10-08-ask-kiara-design.md, section 5.3a.
--
-- SOPs are written for one or more departments (sales, drivers, karigar
-- designers, cleaning, accounts...). A document carries zero or more
-- department tags and one visibility:
--   everyone            every Ask Kiara user may get answers from it; the asker's
--                       own-department documents rank higher among relevant hits;
--   departments         only employees whose department NAME matches a tag, plus
--                       Admin and Super Admin authority and assistant.manage_knowledge
--                       holders;
--   managers_and_above  manager dashboard authority or higher (HR is not included).
-- The 2-value `audience` column becomes `visibility`; its values keep their
-- meaning, so existing rows need no data change.
--
-- Departments are rows per branch (or tenant-wide when branch_id is null), and
-- the same name repeats across branches with different codes. A tag is therefore
-- a department NAME, not a row id: tagging "Sales" once covers Sales in every
-- branch, including branches added later. Names match case- and
-- whitespace-insensitively through kiara_department_key().
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Department keys
-- ---------------------------------------------------------------------------

create function kiara_department_key(p_name text)
returns text language sql immutable parallel safe set search_path = public as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')), '');
$$;

create function kiara_department_keys(p_tags text[])
returns text[] language sql immutable parallel safe set search_path = public as $$
  select coalesce(array_agg(distinct k order by k), '{}'::text[])
  from (select kiara_department_key(t) as k from unnest(coalesce(p_tags, '{}'::text[])) t) keys
  where k is not null;
$$;

-- Who may read a document's excerpts. p_role is the effective role
-- (current_profile(), so dashboard authority counts); p_key is the asker's
-- department key; p_manage is assistant.manage_knowledge for the asker.
create function kiara_document_visible(p_role text, p_key text, p_manage boolean, p_visibility text, p_keys text[])
returns boolean language sql immutable parallel safe set search_path = public as $$
  select case p_visibility
    when 'everyone' then true
    when 'managers_and_above' then p_role in ('manager', 'admin', 'super_admin')
    when 'departments' then p_role in ('admin', 'super_admin') or coalesce(p_manage, false)
      or (p_key is not null and p_key = any(coalesce(p_keys, '{}'::text[])))
    else false
  end;
$$;

alter function kiara_department_key(text) owner to postgres;
alter function kiara_department_keys(text[]) owner to postgres;
alter function kiara_document_visible(text, text, boolean, text, text[]) owner to postgres;
revoke all on function kiara_department_key(text), kiara_department_keys(text[]), kiara_document_visible(text, text, boolean, text, text[])
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Columns: audience -> visibility, department tags
-- ---------------------------------------------------------------------------

alter table kiara_documents rename column audience to visibility;
alter table kiara_documents drop constraint kiara_documents_audience_check;
alter table kiara_documents add constraint kiara_documents_visibility_check
  check (visibility in ('everyone', 'departments', 'managers_and_above'));
-- Display names (the tenant's canonical spelling at tagging time) and their keys.
alter table kiara_documents add column department_tags text[] not null default '{}'
  check (cardinality(department_tags) <= 20);
alter table kiara_documents add column department_keys text[] generated always as (kiara_department_keys(department_tags)) stored;
alter table kiara_documents add constraint kiara_documents_departments_tagged
  check (visibility <> 'departments' or cardinality(department_keys) > 0);
create index kiara_documents_department_keys on kiara_documents using gin(department_keys);

drop trigger kiara_documents_realtime on kiara_documents;
create trigger kiara_documents_realtime after insert or delete or update of status, active_version_id, title, visibility, department_tags
  on kiara_documents for each row execute function emit_realtime_direct_event('assistant');

-- ---------------------------------------------------------------------------
-- 3. Field checks
-- ---------------------------------------------------------------------------

-- Same signature as 0903; the third value is now the visibility.
create or replace function kiara_kb_assert_details(p_title text, p_category text, p_audience text)
returns void language plpgsql immutable set search_path = public as $$
begin
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'Title must be 1 to 200 characters' using errcode = '22023';
  end if;
  if p_category is not null and length(p_category) > 80 then
    raise exception 'Category must be at most 80 characters' using errcode = '22023';
  end if;
  if p_audience is null or p_audience not in ('everyone', 'departments', 'managers_and_above') then
    raise exception 'Visibility must be everyone, departments, or managers_and_above' using errcode = '22023';
  end if;
end $$;

-- The label shown for a department name: the spelling used by most of the
-- tenant's active departments with that name, preferring Title Case on a tie.
create function kiara_department_label(p_tenant_id uuid, p_key text)
returns text language sql stable security definer set search_path = public as $$
  select n.name from (
    select regexp_replace(btrim(d.name), '\s+', ' ', 'g') as name, count(*) as uses
    from departments d
    where d.tenant_id = p_tenant_id and d.is_active and kiara_department_key(d.name) = p_key
    group by 1
  ) n
  order by n.uses desc, (n.name = initcap(n.name)) desc, n.name
  limit 1;
$$;

-- Tags as the tenant's department names: each must name an active department in
-- some branch (or a tenant-wide one), matched case- and space-insensitively;
-- the stored label is kiara_department_label(). Duplicates collapse.
create function kiara_kb_clean_tags(p_actor user_profiles, p_tags text[])
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_tag text;
  v_key text;
  v_label text;
  v_keys text[] := '{}'::text[];
  v_labels text[] := '{}'::text[];
begin
  if p_tags is null then return '{}'::text[]; end if;
  if cardinality(p_tags) > 20 then
    raise exception 'A document can have at most 20 departments' using errcode = '22023';
  end if;
  foreach v_tag in array p_tags loop
    v_key := kiara_department_key(v_tag);
    if v_key is null then continue; end if;
    if length(v_key) > 80 then
      raise exception 'Department names must be at most 80 characters' using errcode = '22023';
    end if;
    if v_key = any(v_keys) then continue; end if;
    v_label := kiara_department_label(p_actor.tenant_id, v_key);
    if v_label is null then
      raise exception 'Unknown department: %', left(btrim(v_tag), 80) using errcode = '22023';
    end if;
    v_keys := v_keys || v_key;
    v_labels := v_labels || v_label;
  end loop;
  return (select coalesce(array_agg(l order by lower(l)), '{}'::text[]) from unnest(v_labels) l);
end $$;

create function kiara_kb_assert_access(p_visibility text, p_tags text[])
returns void language plpgsql immutable set search_path = public as $$
begin
  if p_visibility = 'departments' and cardinality(kiara_department_keys(p_tags)) = 0 then
    raise exception 'Choose at least one department for a department-only document' using errcode = '22023';
  end if;
end $$;

-- The asker's department key (effective profile; null without a department).
create function kiara_actor_department_key(p_actor user_profiles)
returns text language sql stable security definer set search_path = public as $$
  select kiara_department_key(d.name) from departments d where d.id = p_actor.department_id and d.tenant_id = p_actor.tenant_id;
$$;

alter function kiara_department_label(uuid, text) owner to postgres;
alter function kiara_kb_clean_tags(user_profiles, text[]) owner to postgres;
alter function kiara_kb_assert_access(text, text[]) owner to postgres;
alter function kiara_actor_department_key(user_profiles) owner to postgres;
revoke all on function kiara_department_label(uuid, text), kiara_kb_clean_tags(user_profiles, text[]), kiara_kb_assert_access(text, text[]), kiara_actor_department_key(user_profiles)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Knowledge-manager RPCs with visibility and tags
-- ---------------------------------------------------------------------------

drop function create_kiara_document_with_audit(text, text, text, text, integer, text);
drop function save_kiara_document_text_with_audit(uuid, text, text, text, text, jsonb);
drop function update_kiara_document_details_with_audit(uuid, text, text, text);
drop function list_kiara_documents(text, text);

create function create_kiara_document_with_audit(
  p_title text, p_category text, p_visibility text, p_filename text, p_byte_size integer, p_sha256 text,
  p_department_tags text[] default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_document kiara_documents;
  v_version_id uuid := gen_random_uuid();
  v_path text;
  v_tags text[];
begin
  perform kiara_kb_assert_details(p_title, p_category, p_visibility);
  v_tags := kiara_kb_clean_tags(v_actor, p_department_tags);
  perform kiara_kb_assert_access(p_visibility, v_tags);
  perform kiara_kb_assert_upload(p_filename, p_byte_size, p_sha256);
  perform kiara_kb_assert_not_duplicate(v_actor, p_sha256, null);
  insert into kiara_documents(tenant_id, title, category, visibility, department_tags, source_kind, status, created_by, updated_by)
  values (v_actor.tenant_id, btrim(p_title), nullif(btrim(p_category), ''), p_visibility, v_tags, 'upload', 'processing', v_actor.id, v_actor.id)
  returning * into v_document;
  v_path := v_actor.tenant_id || '/' || v_document.id || '/' || v_version_id || '.docx';
  insert into kiara_document_versions(id, tenant_id, document_id, version_number, storage_path, original_filename, byte_size, sha256,
    source, extraction_status, created_by)
  values (v_version_id, v_actor.tenant_id, v_document.id, 1, v_path, p_filename, p_byte_size, p_sha256, 'docx', 'pending', v_actor.id);
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_kb_document_created', 'assistant', v_document.id,
    jsonb_build_object('version_id', v_version_id, 'title', v_document.title, 'visibility', p_visibility,
      'department_tags', to_jsonb(v_tags), 'byte_size', p_byte_size, 'sha256', p_sha256));
  return jsonb_build_object('document_id', v_document.id, 'version_id', v_version_id, 'storage_path', v_path);
end $$;

-- Edit the text in the app, or write a new article (p_document_id null).
-- p_department_tags null keeps an existing document's tags (none for a new one).
create function save_kiara_document_text_with_audit(
  p_document_id uuid, p_title text, p_category text, p_visibility text, p_text text, p_chunks jsonb,
  p_department_tags text[] default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_document kiara_documents;
  v_version_id uuid := gen_random_uuid();
  v_number integer;
  v_previous uuid;
  v_count integer;
  v_words integer;
  v_tags text[];
begin
  perform kiara_kb_assert_details(p_title, p_category, p_visibility);
  perform kiara_kb_assert_chunks(p_text, p_chunks);
  v_words := coalesce(array_length(regexp_split_to_array(btrim(p_text), '\s+'), 1), 0);
  if p_document_id is not null then
    v_document := kiara_kb_document_for_write(v_actor, p_document_id);
  end if;
  v_tags := case when p_department_tags is null then coalesce(v_document.department_tags, '{}') else kiara_kb_clean_tags(v_actor, p_department_tags) end;
  perform kiara_kb_assert_access(p_visibility, v_tags);
  if p_document_id is null then
    insert into kiara_documents(tenant_id, title, category, visibility, department_tags, source_kind, status, created_by, updated_by)
    values (v_actor.tenant_id, btrim(p_title), nullif(btrim(p_category), ''), p_visibility, v_tags, 'manual', 'processing', v_actor.id, v_actor.id)
    returning * into v_document;
  end if;
  v_previous := v_document.active_version_id;
  select coalesce(max(version_number), 0) + 1 into v_number from kiara_document_versions where document_id = v_document.id;
  insert into kiara_document_versions(id, tenant_id, document_id, version_number, source, extraction_status, extracted_text,
    word_count, image_count, created_by, completed_at)
  values (v_version_id, v_actor.tenant_id, v_document.id, v_number, case when p_document_id is null then 'manual' else 'edited_text' end,
    'succeeded', p_text, v_words, 0, v_actor.id, now());
  update kiara_documents set title = btrim(p_title), category = nullif(btrim(p_category), ''), visibility = p_visibility, department_tags = v_tags
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
      'text_length', length(p_text), 'title', v_document.title, 'visibility', p_visibility, 'department_tags', to_jsonb(v_tags)));
  return jsonb_build_object('document_id', v_document.id, 'version_id', v_version_id, 'chunk_count', v_count);
end $$;

-- p_department_tags null keeps the current tags.
create function update_kiara_document_details_with_audit(
  p_document_id uuid, p_title text, p_category text, p_visibility text, p_department_tags text[] default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_document kiara_documents := kiara_kb_document_for_write(v_actor, p_document_id);
  v_tags text[];
begin
  perform kiara_kb_assert_details(p_title, p_category, p_visibility);
  v_tags := case when p_department_tags is null then v_document.department_tags else kiara_kb_clean_tags(v_actor, p_department_tags) end;
  perform kiara_kb_assert_access(p_visibility, v_tags);
  update kiara_documents set title = btrim(p_title), category = nullif(btrim(p_category), ''), visibility = p_visibility,
    department_tags = v_tags, updated_by = v_actor.id, updated_at = now()
  where id = v_document.id;
  update kiara_document_chunks set document_title = btrim(p_title) where document_id = v_document.id and document_title <> btrim(p_title);
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_kb_details_updated', 'assistant', v_document.id,
    jsonb_build_object('title', v_document.title, 'category', v_document.category, 'visibility', v_document.visibility,
      'department_tags', to_jsonb(v_document.department_tags)),
    jsonb_build_object('title', btrim(p_title), 'category', nullif(btrim(p_category), ''), 'visibility', p_visibility,
      'department_tags', to_jsonb(v_tags)));
end $$;

-- Bulk edit from the Knowledge screen: one transaction and one audit row for
-- the whole selection (with every document's previous values). p_visibility
-- null keeps each document's visibility; p_department_tags null keeps tags;
-- p_tag_mode: replace (set exactly), add, or remove.
create function bulk_update_kiara_documents_access_with_audit(
  p_document_ids uuid[], p_visibility text, p_department_tags text[], p_tag_mode text default 'replace')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_ids uuid[] := (select coalesce(array_agg(distinct i), '{}') from unnest(coalesce(p_document_ids, '{}'::uuid[])) i where i is not null);
  v_tags text[];
  v_keys text[];
  v_document kiara_documents;
  v_new_tags text[];
  v_new_visibility text;
  v_changes jsonb := '[]'::jsonb;
  v_changed integer := 0;
begin
  if cardinality(v_ids) < 1 or cardinality(v_ids) > 500 then
    raise exception 'Choose 1 to 500 documents' using errcode = '22023';
  end if;
  if p_visibility is null and p_department_tags is null then
    raise exception 'Choose a visibility or departments to change' using errcode = '22023';
  end if;
  if p_visibility is not null and p_visibility not in ('everyone', 'departments', 'managers_and_above') then
    raise exception 'Visibility must be everyone, departments, or managers_and_above' using errcode = '22023';
  end if;
  if coalesce(p_tag_mode, '') not in ('replace', 'add', 'remove') then
    raise exception 'Tag mode must be replace, add, or remove' using errcode = '22023';
  end if;
  if p_department_tags is not null then
    v_tags := kiara_kb_clean_tags(v_actor, p_department_tags);
    v_keys := kiara_department_keys(v_tags);
  end if;
  for v_document in select * from kiara_documents where id = any(v_ids) order by id for update loop
    null;
  end loop;
  if (select count(*) from kiara_documents where id = any(v_ids) and tenant_id = v_actor.tenant_id and status <> 'deleted') <> cardinality(v_ids) then
    raise exception 'A selected document was not found or was deleted' using errcode = '42501';
  end if;
  for v_document in select * from kiara_documents where id = any(v_ids) order by title, id loop
    v_new_visibility := coalesce(p_visibility, v_document.visibility);
    v_new_tags := case
      when p_department_tags is null then v_document.department_tags
      when p_tag_mode = 'replace' then v_tags
      when p_tag_mode = 'add' then (select coalesce(array_agg(t order by lower(t)), '{}') from (
          select t from unnest(v_document.department_tags) t
          union select t from unnest(v_tags) t where kiara_department_key(t) <> all(v_document.department_keys)) s)
      else (select coalesce(array_agg(t order by lower(t)), '{}') from unnest(v_document.department_tags) t
          where kiara_department_key(t) <> all(v_keys))
    end;
    if v_new_visibility = 'departments' and cardinality(kiara_department_keys(v_new_tags)) = 0 then
      raise exception 'Choose at least one department for a department-only document (%)', v_document.title using errcode = '22023';
    end if;
    if cardinality(v_new_tags) > 20 then
      raise exception 'A document can have at most 20 departments (%)', v_document.title using errcode = '22023';
    end if;
    if v_new_visibility = v_document.visibility and v_new_tags = v_document.department_tags then continue; end if;
    update kiara_documents set visibility = v_new_visibility, department_tags = v_new_tags, updated_by = v_actor.id, updated_at = now()
    where id = v_document.id;
    v_changed := v_changed + 1;
    v_changes := v_changes || jsonb_build_object('document_id', v_document.id,
      'old_visibility', v_document.visibility, 'old_department_tags', to_jsonb(v_document.department_tags),
      'new_visibility', v_new_visibility, 'new_department_tags', to_jsonb(v_new_tags));
  end loop;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_kb_bulk_access_updated', 'assistant', null,
    jsonb_build_object('selected', cardinality(v_ids), 'changed', v_changed, 'visibility', p_visibility,
      'department_tags', to_jsonb(v_tags), 'tag_mode', p_tag_mode, 'changes', v_changes));
  return jsonb_build_object('selected', cardinality(v_ids), 'changed', v_changed);
end $$;

create function list_kiara_documents(p_search text default null, p_status text default null, p_department text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_kb_actor();
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_department text := kiara_department_key(p_department);
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
        'id', d.id, 'title', d.title, 'category', d.category, 'visibility', d.visibility,
        'department_tags', to_jsonb(d.department_tags), 'source_kind', d.source_kind,
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
        and (v_department is null or (v_department = '-' and cardinality(d.department_keys) = 0) or v_department = any(d.department_keys))
        and (v_search is null or d.title ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or coalesce(d.category, '') ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      order by d.updated_at desc, d.id
      limit 1000
    ) rows
  ), '[]'::jsonb);
end $$;

-- Filter and picker data for the Knowledge screen: the tenant's department
-- names (one entry per name across branches, with how many documents carry
-- it) and document counts by status.
create function get_kiara_knowledge_filters()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_kb_actor();
begin
  return jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('name', n.name, 'key', n.key, 'branches', n.branches,
          'documents', (select count(*) from kiara_documents d where d.tenant_id = v_actor.tenant_id and d.status <> 'deleted' and n.key = any(d.department_keys)))
        order by lower(n.name))
      from (
        select kiara_department_key(dep.name) as key, kiara_department_label(v_actor.tenant_id, kiara_department_key(dep.name)) as name,
          count(distinct coalesce(dep.branch_id::text, 'all')) as branches
        from departments dep
        where dep.tenant_id = v_actor.tenant_id and dep.is_active and kiara_department_key(dep.name) is not null
        group by kiara_department_key(dep.name)
      ) n), '[]'::jsonb),
    -- Tags whose department name no longer exists (renamed or removed): shown so they can be fixed.
    'unmatched_tags', coalesce((
      select jsonb_agg(distinct t order by t)
      from kiara_documents d cross join lateral unnest(d.department_tags) t
      where d.tenant_id = v_actor.tenant_id and d.status <> 'deleted'
        and not exists (select 1 from departments dep where dep.tenant_id = v_actor.tenant_id and dep.is_active
          and kiara_department_key(dep.name) = kiara_department_key(t))), '[]'::jsonb),
    'untagged', (select count(*) from kiara_documents d where d.tenant_id = v_actor.tenant_id and d.status <> 'deleted' and cardinality(d.department_keys) = 0),
    'status_counts', coalesce((select jsonb_object_agg(s.status, s.n) from (
      select status, count(*) as n from kiara_documents where tenant_id = v_actor.tenant_id group by status) s), '{}'::jsonb));
end $$;

create or replace function get_kiara_document(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_kb_actor(); v_document kiara_documents;
begin
  select * into v_document from kiara_documents where id = p_id;
  if v_document.id is null or v_document.tenant_id <> v_actor.tenant_id then
    raise exception 'Document not found' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', v_document.id, 'title', v_document.title, 'category', v_document.category, 'visibility', v_document.visibility,
    'department_tags', to_jsonb(v_document.department_tags),
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
-- 5. Reader RPCs: visibility and the own-department boost
-- ---------------------------------------------------------------------------

-- Ranking: full-text rank as in 0903. The asker's own-department documents get
-- a 1.35x boost, but only when their rank is at least half of the best match
-- for this query, so an own-department document that barely matches is never
-- lifted above a clearly relevant one; among comparably relevant hits the
-- asker's department wins. Untagged documents are never boosted.
create or replace function search_kiara_knowledge(p_query text, p_original_terms text default null, p_limit integer default 5)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_actor();
  v_query text := btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'));
  v_terms text := btrim(regexp_replace(coalesce(p_original_terms, ''), '\s+', ' ', 'g'));
  v_limit integer := coalesce(p_limit, 5);
  v_english tsquery;
  v_simple tsquery;
  -- Effective role: dashboard authority counts (current_profile()).
  v_role text := v_actor.user_role::text;
  v_key text := kiara_actor_department_key(v_actor);
  v_manage boolean := has_permission('assistant.manage_knowledge');
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
      'title', r.title, 'heading_path', r.heading_path, 'content', r.content,
      'departments', to_jsonb(r.department_tags), 'own_department', r.own) order by r.score desc, r.id)
    from (
      select m.*, case when m.own and m.rank >= 0.5 * m.top then m.rank * 1.35 else m.rank end as score
      from (
        select c.id, c.document_id, c.version_id, d.title, c.heading_path, c.content, d.department_tags,
          (v_key is not null and v_key = any(d.department_keys)) as own,
          coalesce(ts_rank_cd(c.search_vector, v_english), 0) + 0.5 * coalesce(ts_rank_cd(c.search_vector, v_simple), 0) as rank,
          max(coalesce(ts_rank_cd(c.search_vector, v_english), 0) + 0.5 * coalesce(ts_rank_cd(c.search_vector, v_simple), 0)) over () as top
        from kiara_document_chunks c
        join kiara_documents d on d.id = c.document_id and d.active_version_id = c.version_id
        where c.tenant_id = v_actor.tenant_id and d.tenant_id = v_actor.tenant_id
          and d.status = 'active'
          and kiara_document_visible(v_role, v_key, v_manage, d.visibility, d.department_keys)
          and (c.search_vector @@ v_english or c.search_vector @@ v_simple)
      ) m
      order by score desc, m.id
      limit v_limit
    ) r), '[]'::jsonb));
end $$;

-- The excerpt behind a citation chip, with the same visibility as search.
create or replace function get_kiara_knowledge_excerpt(p_chunk_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_actor();
  v_role text := v_actor.user_role::text;
  v_key text := kiara_actor_department_key(v_actor);
  v_manage boolean := has_permission('assistant.manage_knowledge');
  v_row jsonb;
begin
  select jsonb_build_object('available', true, 'title', d.title, 'heading_path', c.heading_path, 'content', c.content)
    into v_row
  from kiara_document_chunks c
  join kiara_documents d on d.id = c.document_id and d.active_version_id = c.version_id
  where c.id = p_chunk_id and c.tenant_id = v_actor.tenant_id and d.status = 'active'
    and kiara_document_visible(v_role, v_key, v_manage, d.visibility, d.department_keys);
  return coalesce(v_row, jsonb_build_object('available', false));
end $$;

alter function create_kiara_document_with_audit(text,text,text,text,integer,text,text[]) owner to postgres;
alter function save_kiara_document_text_with_audit(uuid,text,text,text,text,jsonb,text[]) owner to postgres;
alter function update_kiara_document_details_with_audit(uuid,text,text,text,text[]) owner to postgres;
alter function bulk_update_kiara_documents_access_with_audit(uuid[],text,text[],text) owner to postgres;
alter function list_kiara_documents(text,text,text) owner to postgres;
alter function get_kiara_knowledge_filters() owner to postgres;

revoke all on function
  create_kiara_document_with_audit(text,text,text,text,integer,text,text[]),
  save_kiara_document_text_with_audit(uuid,text,text,text,text,jsonb,text[]),
  update_kiara_document_details_with_audit(uuid,text,text,text,text[]),
  bulk_update_kiara_documents_access_with_audit(uuid[],text,text[],text),
  list_kiara_documents(text,text,text),
  get_kiara_knowledge_filters()
from public, anon, authenticated, service_role;
grant execute on function
  create_kiara_document_with_audit(text,text,text,text,integer,text,text[]),
  save_kiara_document_text_with_audit(uuid,text,text,text,text,jsonb,text[]),
  update_kiara_document_details_with_audit(uuid,text,text,text,text[]),
  bulk_update_kiara_documents_access_with_audit(uuid[],text,text[],text),
  list_kiara_documents(text,text,text),
  get_kiara_knowledge_filters()
to authenticated;

notify pgrst, 'reload schema';
