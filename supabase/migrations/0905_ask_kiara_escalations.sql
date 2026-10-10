-- Ask Kiara, Phase 4: human step-in. Design:
-- docs/superpowers/specs/2026-10-08-ask-kiara-design.md (sections 5.4, 5.6, 6, 16).
--
-- When Kiara cannot answer a valid company-procedure question confidently, it
-- offers to pass the question to a person (the offer is stored on Kiara's
-- answer by complete_kiara_turn). The employee confirms; the question goes to
-- the people allowed to answer it (approved rule, spec 19 item 1): managers
-- above the asker in the reports-to chain, the asker's department head, the
-- asker's branch manager, and every admin and super admin, each only while
-- holding assistant.answer_escalations. The first answer wins. It is appended
-- to the asker's conversation and notified to the asker; the answerers' own
-- notifications are closed by a trigger on the escalation (never by a
-- client). An answer can be saved as a `suggested` knowledge document that
-- Super Admin approves, edits, or rejects. Escalations never count against the
-- daily question limit.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table kiara_escalations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- The asker's branch and department when the question was sent.
  branch_id uuid references branches(id) on delete set null,
  department_id uuid references departments(id) on delete set null,
  asker_id uuid not null references user_profiles(id) on delete cascade,
  -- Conversation rows may be purged on the retention schedule; the escalation stays.
  conversation_id uuid references kiara_conversations(id) on delete set null,
  question_message_id uuid references kiara_messages(id) on delete set null,
  offer_message_id uuid unique references kiara_messages(id) on delete set null,
  offer_id uuid not null unique,
  question_text text not null check (length(question_text) between 1 and 2000),
  summary_en text check (summary_en is null or length(summary_en) <= 300),
  reason text not null check (reason in ('no_kb_match', 'conflicting_policy', 'needs_judgment')),
  status text not null default 'open' check (status in ('open', 'answered', 'withdrawn')),
  answered_by uuid references user_profiles(id) on delete set null,
  -- "Name (Designation)" at answer time, shown with the answer.
  answered_by_label text check (answered_by_label is null or length(answered_by_label) <= 200),
  answered_at timestamptz,
  answer_text text check (answer_text is null or length(answer_text) between 1 and 4000),
  answer_message_id uuid references kiara_messages(id) on delete set null,
  saved_document_id uuid references kiara_documents(id) on delete set null,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  constraint kiara_escalations_answered_shape check ((status = 'answered') = (answered_at is not null and answer_text is not null)),
  constraint kiara_escalations_withdrawn_shape check ((status = 'withdrawn') = (withdrawn_at is not null))
);
create index kiara_escalations_tenant_status on kiara_escalations(tenant_id, status, created_at desc);
create index kiara_escalations_asker on kiara_escalations(asker_id, created_at desc);

-- A human answer in the asker's conversation points at its escalation.
alter table kiara_messages add column escalation_id uuid references kiara_escalations(id) on delete set null;
alter table kiara_messages add constraint kiara_messages_human_answer_shape
  check (role <> 'human_answer' or (api_content is null and reply_to_message_id is null));

-- ---------------------------------------------------------------------------
-- 2. Who may answer (spec 5.6)
-- ---------------------------------------------------------------------------

-- Effective role of any profile: dashboard authority wins (as current_profile()).
create function kiara_effective_role(p_profile_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(a.dashboard_authority, p.user_role)::text
  from user_profiles p left join user_access_profiles a on a.user_profile_id = p.id
  where p.id = p_profile_id;
$$;

-- True when the actor may see and answer a question from the asker: an active
-- colleague in the same tenant (never the asker) holding
-- assistant.answer_escalations who is an admin or super admin, a manager above
-- the asker in the reports-to chain, the head of the asker's department, or the
-- manager of the asker's branch. A manager elsewhere in the same branch is not.
create function kiara_escalation_answerer(p_actor_id uuid, p_asker_id uuid, p_branch_id uuid, p_department_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from user_profiles actor
    join user_profiles asker on asker.id = p_asker_id and asker.tenant_id = actor.tenant_id
    where actor.id = p_actor_id
      and actor.id <> asker.id
      and actor.is_login_enabled is true and actor.working_status <> 'resigned' and actor.account_status = 'active'
      and permission_effective_for(actor.id, 'assistant.answer_escalations')
      and (
        kiara_effective_role(actor.id) in ('admin', 'super_admin')
        or is_reporting_descendant(actor.id, asker.id)
        or exists (select 1 from departments d where d.id = p_department_id and d.tenant_id = actor.tenant_id and d.head_id = actor.id)
        or exists (select 1 from branches b where b.id = p_branch_id and b.tenant_id = actor.tenant_id and b.manager_id = actor.id)
      )
  );
$$;

-- RLS helper: the caller may answer this escalation.
create function kiara_can_answer_escalation(p_escalation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from kiara_escalations e
    where e.id = p_escalation_id and e.tenant_id = current_tenant_id()
      and kiara_escalation_answerer((current_profile()).id, e.asker_id, e.branch_id, e.department_id));
$$;

-- "Name (Designation)" for an answer, falling back to the role.
create function kiara_person_label(p_profile_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select left(coalesce(nullif(btrim(p.employee_name), ''), 'A colleague') || ' (' || coalesce(
      nullif(btrim((select d.label from dropdown_masters d where d.id = p.designation_id)), ''),
      case kiara_effective_role(p.id)
        when 'super_admin' then 'Super Admin' when 'admin' then 'Admin' when 'manager' then 'Manager'
        when 'hr' then 'HR' else 'Staff' end) || ')', 200)
  from user_profiles p where p.id = p_profile_id;
$$;

alter function kiara_effective_role(uuid) owner to postgres;
alter function kiara_escalation_answerer(uuid, uuid, uuid, uuid) owner to postgres;
alter function kiara_can_answer_escalation(uuid) owner to postgres;
alter function kiara_person_label(uuid) owner to postgres;
revoke all on function kiara_effective_role(uuid), kiara_escalation_answerer(uuid, uuid, uuid, uuid),
  kiara_can_answer_escalation(uuid), kiara_person_label(uuid)
  from public, anon, authenticated, service_role;
-- The RLS policy below calls it as the reader.
grant execute on function kiara_can_answer_escalation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Row-level security and grants (reads only; writes are RPCs)
-- ---------------------------------------------------------------------------

alter table kiara_escalations enable row level security;
revoke all on kiara_escalations from public, anon, authenticated, service_role;
grant select on kiara_escalations to authenticated;
create policy kiara_escalations_read on kiara_escalations for select to authenticated
  using (tenant_id = (select current_tenant_id()) and (select current_profile_is_active())
    and (asker_id = (select (current_profile()).id) or kiara_can_answer_escalation(id)));
create policy kiara_escalations_section_available on kiara_escalations as restrictive for select to authenticated
  using (module_accessible('ask_kiara'));

-- ---------------------------------------------------------------------------
-- 4. Derived state: closing answerers' notifications, realtime wake-ups
-- ---------------------------------------------------------------------------

-- An escalation that leaves `open` (answered or withdrawn) closes every
-- answerer's open-question notification. History is kept: rows are marked
-- read, never deleted, and an earlier read time is preserved.
create function close_kiara_escalation_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'open' and new.status <> 'open' then
    update notifications set is_read = true, read_at = coalesce(read_at, now())
    where tenant_id = new.tenant_id and event_type = 'kiara_escalation_open'
      and source_module = 'assistant' and source_record_id = new.id and not coalesce(is_read, false);
  end if;
  return new;
end $$;
revoke all on function close_kiara_escalation_notifications() from public, anon, authenticated, service_role;
create trigger kiara_escalation_notifications_close after update of status on kiara_escalations
  for each row execute function close_kiara_escalation_notifications();

create trigger kiara_escalations_realtime after insert or delete or update of status on kiara_escalations
  for each row execute function emit_realtime_direct_event('assistant');

-- ---------------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------------

-- The asker confirms Kiara's offer. Free: never counts against the daily limit.
create function create_kiara_escalation(p_message_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_actor();
  v_answer kiara_messages;
  v_question kiara_messages;
  v_conversation kiara_conversations;
  v_offer jsonb;
  v_offer_id uuid;
  v_escalation kiara_escalations;
  v_recipients uuid[];
  v_direct uuid[];
begin
  select * into v_answer from kiara_messages where id = p_message_id for update;
  select * into v_conversation from kiara_conversations where id = v_answer.conversation_id;
  if v_answer.id is null or v_answer.role <> 'assistant' or v_conversation.user_profile_id <> v_actor.id
    or v_conversation.tenant_id <> v_actor.tenant_id then
    raise exception 'Message not found' using errcode = '42501';
  end if;
  v_offer := v_answer.escalation_offer;
  if v_offer is null or jsonb_typeof(v_offer) <> 'object'
    or coalesce(v_offer ->> 'offer_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(v_offer ->> 'reason', '') not in ('no_kb_match', 'conflicting_policy', 'needs_judgment')
    or length(coalesce(v_offer ->> 'summary_en', '')) > 300 then
    raise exception 'Kiara did not offer to pass this question on' using errcode = '22023';
  end if;
  v_offer_id := (v_offer ->> 'offer_id')::uuid;
  if exists (select 1 from kiara_escalations where offer_message_id = v_answer.id or offer_id = v_offer_id) then
    raise exception 'kiara_escalation_exists' using errcode = '23505';
  end if;
  select * into v_question from kiara_messages where id = v_answer.reply_to_message_id;

  insert into kiara_escalations(tenant_id, branch_id, department_id, asker_id, conversation_id, question_message_id, offer_message_id,
    offer_id, question_text, summary_en, reason)
  values (v_actor.tenant_id, v_actor.branch_id, v_actor.department_id, v_actor.id, v_conversation.id, v_question.id, v_answer.id,
    v_offer_id, left(v_question.display_text, 2000), nullif(btrim(v_offer ->> 'summary_en'), ''), v_offer ->> 'reason')
  returning * into v_escalation;
  update kiara_question_facts set escalated = true where message_id = v_question.id and user_profile_id = v_actor.id;

  -- Notified directly: the asker's own manager, department head, and branch
  -- manager who may answer; without any, every admin and super admin who may.
  -- Everyone allowed still sees it in "Questions for you".
  select coalesce(array_agg(distinct c.id), '{}') into v_direct
  from (
    select v_actor.reports_to_user_id as id
    union all select d.head_id from departments d where d.id = v_actor.department_id and d.tenant_id = v_actor.tenant_id
    union all select b.manager_id from branches b where b.id = v_actor.branch_id and b.tenant_id = v_actor.tenant_id
  ) c
  where c.id is not null and kiara_escalation_answerer(c.id, v_actor.id, v_escalation.branch_id, v_escalation.department_id);
  v_recipients := v_direct;
  if cardinality(v_recipients) = 0 then
    select coalesce(array_agg(p.id), '{}') into v_recipients
    from user_profiles p
    where p.tenant_id = v_actor.tenant_id and kiara_effective_role(p.id) in ('admin', 'super_admin')
      and kiara_escalation_answerer(p.id, v_actor.id, v_escalation.branch_id, v_escalation.department_id);
  end if;
  insert into notifications(tenant_id, branch_id, department_id, user_profile_id, event_type, title, message, link_url, channel,
    delivered_status, priority, source_module, source_record_id, delivered_at)
  select v_actor.tenant_id, v_escalation.branch_id, v_escalation.department_id, r, 'kiara_escalation_open',
    'Question for you from ' || left(coalesce(nullif(btrim(v_actor.employee_name), ''), 'a colleague'), 80),
    left(coalesce(v_escalation.summary_en, v_escalation.question_text), 300),
    '/ask-kiara?tab=questions&escalation=' || v_escalation.id, 'in_app', 'delivered', 'medium', 'assistant', v_escalation.id, now()
  from unnest(v_recipients) r;

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_escalation_created', 'assistant', v_escalation.id,
    jsonb_build_object('escalation_id', v_escalation.id, 'conversation_id', v_conversation.id, 'reason', v_escalation.reason,
      'recipients_count', cardinality(v_recipients)));
  return jsonb_build_object('escalation_id', v_escalation.id, 'status', v_escalation.status, 'recipients_count', cardinality(v_recipients));
end $$;

-- Questions the caller may answer (spec 5.6). Never other conversation content.
create function list_kiara_escalations(p_status text default 'open', p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_actor();
begin
  if not has_permission('assistant.answer_escalations') then
    raise exception 'Answering questions requires permission' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('open', 'answered', 'withdrawn', 'all') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(item order by (item ->> 'created_at') desc, item ->> 'id')
    from (
      select jsonb_build_object(
        'id', e.id, 'status', e.status, 'reason', e.reason, 'question', e.question_text, 'summary', e.summary_en,
        'created_at', e.created_at, 'asker_name', a.employee_name,
        'asker_designation', (select d.label from dropdown_masters d where d.id = a.designation_id),
        'department', (select d.name from departments d where d.id = e.department_id),
        'branch', (select b.name from branches b where b.id = e.branch_id),
        'answered_by', e.answered_by_label, 'answered_at', e.answered_at, 'answer', e.answer_text,
        'saved_document_id', e.saved_document_id, 'withdrawn_at', e.withdrawn_at
      ) as item
      from kiara_escalations e
      join user_profiles a on a.id = e.asker_id
      where e.tenant_id = v_actor.tenant_id
        and (p_status = 'all' or e.status = p_status)
        and kiara_escalation_answerer(v_actor.id, e.asker_id, e.branch_id, e.department_id)
      order by e.created_at desc, e.id
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) rows), '[]'::jsonb);
end $$;

-- The navigation badge: open questions the caller may answer (0 without the permission).
create function get_kiara_escalation_badge()
returns integer language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_actor();
begin
  if not has_permission('assistant.answer_escalations') then return 0; end if;
  return (select count(*)::integer from kiara_escalations e
    where e.tenant_id = v_actor.tenant_id and e.status = 'open'
      and kiara_escalation_answerer(v_actor.id, e.asker_id, e.branch_id, e.department_id));
end $$;

-- First answer wins (row lock). The answer joins the asker's conversation, the
-- asker is notified, and optionally a `suggested` knowledge document is made.
create function answer_kiara_escalation_with_audit(p_escalation_id uuid, p_answer text, p_save_to_kb boolean default false, p_kb_title text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_actor();
  v_escalation kiara_escalations;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_label text;
  v_message_id uuid;
  v_ordinal integer;
  v_document kiara_documents;
  v_version_id uuid;
  v_title text;
  v_text text;
  v_chunk text;
  v_tag text;
begin
  if not has_permission('assistant.answer_escalations') then
    raise exception 'Answering questions requires permission' using errcode = '42501';
  end if;
  select * into v_escalation from kiara_escalations where id = p_escalation_id for update;
  if v_escalation.id is null or v_escalation.tenant_id <> v_actor.tenant_id
    or not kiara_escalation_answerer(v_actor.id, v_escalation.asker_id, v_escalation.branch_id, v_escalation.department_id) then
    raise exception 'Question not found' using errcode = '42501';
  end if;
  if v_escalation.status = 'answered' then
    raise exception 'kiara_escalation_already_answered' using errcode = 'P0001', detail = coalesce(v_escalation.answered_by_label, 'someone');
  end if;
  if v_escalation.status = 'withdrawn' then
    raise exception 'kiara_escalation_withdrawn' using errcode = 'P0001';
  end if;
  if length(v_answer) not between 1 and 4000 then
    raise exception 'Answers must be 1 to 4,000 characters' using errcode = '22023';
  end if;
  if coalesce(p_save_to_kb, false) and p_kb_title is not null and length(btrim(p_kb_title)) > 200 then
    raise exception 'Title must be 1 to 200 characters' using errcode = '22023';
  end if;
  v_label := kiara_person_label(v_actor.id);

  -- The answer in the asker's conversation (it reappears if it was archived).
  if v_escalation.conversation_id is not null then
    select coalesce(max(ordinal), 0) + 1 into v_ordinal from kiara_messages where conversation_id = v_escalation.conversation_id;
    insert into kiara_messages(tenant_id, conversation_id, ordinal, role, display_text, escalation_id)
    values (v_escalation.tenant_id, v_escalation.conversation_id, v_ordinal, 'human_answer', v_answer, v_escalation.id)
    returning id into v_message_id;
    update kiara_conversations set last_message_at = now(), archived_at = null where id = v_escalation.conversation_id;
  end if;

  if coalesce(p_save_to_kb, false) then
    v_title := left(coalesce(nullif(btrim(p_kb_title), ''), nullif(btrim(v_escalation.summary_en), ''), v_escalation.question_text), 200);
    v_chunk := 'Question: ' || v_escalation.question_text || E'\n\nAnswer: ' || v_answer;
    v_text := '# ' || regexp_replace(v_title, '\s+', ' ', 'g') || E'\n\n' || v_chunk;
    -- Prefilled with the asker's department; visibility everyone (spec, Phase 4).
    select kiara_department_label(v_escalation.tenant_id, kiara_department_key(d.name)) into v_tag
    from departments d where d.id = v_escalation.department_id and d.is_active;
    insert into kiara_documents(tenant_id, title, category, visibility, department_tags, source_kind, status, created_by, updated_by)
    values (v_escalation.tenant_id, v_title, 'Answered question', 'everyone', case when v_tag is null then '{}'::text[] else array[v_tag] end,
      'escalation_answer', 'processing', v_actor.id, v_actor.id)
    returning * into v_document;
    v_version_id := gen_random_uuid();
    insert into kiara_document_versions(id, tenant_id, document_id, version_number, source, extraction_status, extracted_text,
      word_count, image_count, created_by, completed_at)
    values (v_version_id, v_escalation.tenant_id, v_document.id, 1, 'escalation_answer', 'succeeded', v_text,
      coalesce(array_length(regexp_split_to_array(btrim(v_text), '\s+'), 1), 0), 0, v_actor.id, now());
    perform kiara_kb_publish_version(v_document, v_version_id, jsonb_build_array(jsonb_build_object('heading_path', v_title, 'content', v_chunk)));
    -- Not searchable until Super Admin approves it in the Knowledge screen.
    update kiara_documents set active_version_id = v_version_id, status = 'suggested' where id = v_document.id;
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
    values (v_escalation.tenant_id, v_actor.id, 'assistant_kb_suggestion_created', 'assistant', v_document.id,
      jsonb_build_object('escalation_id', v_escalation.id, 'version_id', v_version_id, 'title', v_title,
        'department_tags', to_jsonb(case when v_tag is null then '{}'::text[] else array[v_tag] end)));
  end if;

  update kiara_escalations set status = 'answered', answered_by = v_actor.id, answered_by_label = v_label, answered_at = now(),
    answer_text = v_answer, answer_message_id = v_message_id, saved_document_id = v_document.id
  where id = v_escalation.id;

  insert into notifications(tenant_id, branch_id, department_id, user_profile_id, event_type, title, message, link_url, channel,
    delivered_status, priority, source_module, source_record_id, delivered_at)
  values (v_escalation.tenant_id, v_escalation.branch_id, v_escalation.department_id, v_escalation.asker_id, 'kiara_escalation_answered',
    'Your question was answered', left('Answered by ' || v_label || ': ' || v_answer, 300),
    case when v_escalation.conversation_id is null then '/ask-kiara' else '/ask-kiara?conversation=' || v_escalation.conversation_id end,
    'in_app', 'delivered', 'medium', 'assistant', v_escalation.id, now());

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_escalation.tenant_id, v_actor.id, 'assistant_escalation_answered', 'assistant', v_escalation.id,
    jsonb_build_object('escalation_id', v_escalation.id, 'answer_message_id', v_message_id, 'saved_document_id', v_document.id,
      'answer_length', length(v_answer)));
  return jsonb_build_object('escalation_id', v_escalation.id, 'status', 'answered', 'answer_message_id', v_message_id,
    'saved_document_id', v_document.id);
end $$;

create function withdraw_my_kiara_escalation(p_escalation_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_actor user_profiles := kiara_actor(); v_escalation kiara_escalations;
begin
  select * into v_escalation from kiara_escalations where id = p_escalation_id for update;
  if v_escalation.id is null or v_escalation.asker_id <> v_actor.id or v_escalation.tenant_id <> v_actor.tenant_id then
    raise exception 'Question not found' using errcode = '42501';
  end if;
  if v_escalation.status = 'withdrawn' then return; end if;
  if v_escalation.status <> 'open' then
    raise exception 'kiara_escalation_already_answered' using errcode = 'P0001', detail = coalesce(v_escalation.answered_by_label, 'someone');
  end if;
  update kiara_escalations set status = 'withdrawn', withdrawn_at = now() where id = v_escalation.id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_escalation_withdrawn', 'assistant', v_escalation.id,
    jsonb_build_object('escalation_id', v_escalation.id));
end $$;

-- The asker's conversation, now with each offer's escalation state and who
-- answered (0901 shape plus `escalation` and `answered_by`).
create or replace function get_my_kiara_conversation(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_actor(); v_conversation kiara_conversations;
begin
  select * into v_conversation from kiara_conversations where id = p_id;
  if v_conversation.id is null or v_conversation.user_profile_id <> v_actor.id or v_conversation.tenant_id <> v_actor.tenant_id
    or v_conversation.archived_at is not null then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', v_conversation.id, 'title', v_conversation.title, 'created_at', v_conversation.created_at,
    'last_message_at', v_conversation.last_message_at,
    'question_count', (select count(*) from kiara_messages m where m.conversation_id = p_id and m.role = 'user'),
    'messages', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'ordinal', m.ordinal, 'role', m.role, 'display_text', m.display_text,
        'reply_to_message_id', m.reply_to_message_id, 'refunded', m.refunded_at is not null,
        'language', m.language, 'citations', coalesce(m.citations, '[]'::jsonb), 'escalation_offer', m.escalation_offer,
        'escalation', (select jsonb_build_object('id', e.id, 'status', e.status, 'answered_by', e.answered_by_label, 'answered_at', e.answered_at)
          from kiara_escalations e where e.offer_message_id = m.id),
        'answered_by', (select e.answered_by_label from kiara_escalations e where e.id = m.escalation_id and m.role = 'human_answer'),
        'stop_reason', m.stop_reason, 'created_at', m.created_at) order by m.ordinal)
      from kiara_messages m where m.conversation_id = p_id), '[]'::jsonb));
end $$;

alter function create_kiara_escalation(uuid) owner to postgres;
alter function list_kiara_escalations(text, integer) owner to postgres;
alter function get_kiara_escalation_badge() owner to postgres;
alter function answer_kiara_escalation_with_audit(uuid, text, boolean, text) owner to postgres;
alter function withdraw_my_kiara_escalation(uuid) owner to postgres;
revoke all on function create_kiara_escalation(uuid), list_kiara_escalations(text, integer), get_kiara_escalation_badge(),
  answer_kiara_escalation_with_audit(uuid, text, boolean, text), withdraw_my_kiara_escalation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function create_kiara_escalation(uuid), list_kiara_escalations(text, integer), get_kiara_escalation_badge(),
  answer_kiara_escalation_with_audit(uuid, text, boolean, text), withdraw_my_kiara_escalation(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Retirement manifest: escalations are retained (never demo data)
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
    'kiara_documents','kiara_document_versions','kiara_document_chunks','kiara_escalations'
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
      'kiara_document_chunks', (select count(*) from public.kiara_document_chunks where tenant_id = p_tenant_id),
      'kiara_escalations', (select count(*) from public.kiara_escalations where tenant_id = p_tenant_id)
    )
  );
  return v_manifest;
end;
$$;

revoke all on function public.production_demo_data_retirement_manifest(uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
