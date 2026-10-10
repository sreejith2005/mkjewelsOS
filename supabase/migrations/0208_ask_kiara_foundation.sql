-- Ask Kiara, Phase 1: the section, its permissions, conversations, and the daily
-- question limit. Design: docs/superpowers/specs/2026-10-08-ask-kiara-design.md
-- (sections 5, 6, 9 and 15). Kiara is read-only: these tables hold only the
-- asker's own questions and Kiara's answers, and every write is an audited RPC
-- that runs as the asker. The Edge Function never uses the service role.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Permissions (catalog parity: packages/core/src/permissions/catalog.ts)
-- ---------------------------------------------------------------------------

-- All six keys land now so later phases need no catalog change.
-- permission-catalog:begin
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values
('assistant.view', 'module', 'ask_kiara', '{super_admin,admin,manager,hr,crm,staff,doer,housekeeping}', 310),
('assistant.voice', 'action', null, '{super_admin,admin,manager}', 311),
('assistant.answer_escalations', 'action', null, '{super_admin,admin,manager}', 312),
('assistant.view_insights', 'action', null, '{super_admin,admin,manager}', 313),
('assistant.manage_knowledge', 'action', null, '{super_admin}', 314),
('assistant.manage_limits', 'protected', null, '{super_admin}', 315);
-- permission-catalog:end

-- ---------------------------------------------------------------------------
-- 2. The section key, and launch dark for existing tenants
-- ---------------------------------------------------------------------------

create or replace function default_section_availability()
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'home', true, 'dashboard', true, 'crm', true, 'checklist_tasks', true,
    'recurring_todo', true, 'task_templates', true, 'task_evidence', true,
    'delegation_tasks', true, 'fms_tasks', true, 'fms_builder', true,
    'forms_library', true, 'meeting_ai', true, 'notifications', true,
    'users', true, 'availability', true, 'reports', true,
    'dropdown_master', true, 'settings', true, 'ask_kiara', true
  );
$$;

create or replace function validated_section_availability(p_availability jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_key text;
begin
  perform assert_json_keys(p_availability, array[
    'home','dashboard','crm','checklist_tasks','recurring_todo','task_templates',
    'task_evidence','delegation_tasks','fms_tasks','fms_builder','forms_library',
    'meeting_ai','notifications','users','availability','reports','dropdown_master','settings',
    'ask_kiara'
  ], 'section availability');

  for v_key in select jsonb_object_keys(p_availability) loop
    if jsonb_typeof(p_availability -> v_key) <> 'boolean' then
      raise exception 'Section availability values must be boolean' using errcode = '22023';
    end if;
  end loop;

  return default_section_availability() || p_availability;
end $$;

alter function default_section_availability() owner to postgres;
alter function validated_section_availability(jsonb) owner to postgres;

-- Launch dark (owner decision 2026-10-08): the section is off for every
-- existing tenant until the owner switches it on in Developer Mode. Super Admin
-- keeps access through the Developer Mode bypass. New tenants get the default.
do $launch_dark$
declare t record; c tenant_section_controls;
begin
  for t in select id from tenants order by id loop
    select * into c from tenant_section_controls where tenant_id = t.id for update;
    if c.tenant_id is null then
      insert into tenant_section_controls(tenant_id, developer_mode_enabled, section_availability, settings_version)
      values (t.id, false, default_section_availability() || '{"ask_kiara": false}'::jsonb, 1);
    else
      update tenant_section_controls
        set section_availability = section_availability || '{"ask_kiara": false}'::jsonb,
            settings_version = settings_version + 1, updated_at = now()
        where tenant_id = t.id;
    end if;
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (t.id, null, 'section_availability_launch_dark', 'developer_controls', t.id,
      case when c.tenant_id is null then null else jsonb_build_object('section_availability', c.section_availability, 'settings_version', c.settings_version) end,
      jsonb_build_object('ask_kiara', false, 'reason', 'Ask Kiara launches dark until the owner enables it (migration 0208).'));
  end loop;
end $launch_dark$;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

create table kiara_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  daily_question_limit integer not null default 10 check (daily_question_limit between 0 and 500),
  conversation_retention_days integer not null default 180 check (conversation_retention_days between 30 and 730),
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  settings_version integer not null default 1 check (settings_version >= 1)
);

create table kiara_user_limits (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_profile_id uuid primary key references user_profiles(id) on delete cascade,
  -- null means unlimited for this user.
  daily_question_limit integer check (daily_question_limit is null or daily_question_limit between 0 and 500),
  reason text check (reason is null or length(reason) <= 300),
  updated_by uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table kiara_daily_usage (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_profile_id uuid not null references user_profiles(id) on delete cascade,
  local_date date not null,
  questions integer not null default 0 check (questions >= 0),
  refunded integer not null default 0 check (refunded >= 0 and refunded <= questions),
  primary key (user_profile_id, local_date)
);
create index kiara_daily_usage_tenant_date on kiara_daily_usage(tenant_id, local_date);

create table kiara_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_profile_id uuid not null references user_profiles(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  client text not null check (client in ('web','android')),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  archived_at timestamptz
);
create index kiara_conversations_owner_recent on kiara_conversations(user_profile_id, last_message_at desc);
create index kiara_conversations_tenant_created on kiara_conversations(tenant_id, created_at);

create table kiara_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references kiara_conversations(id) on delete cascade,
  ordinal integer not null check (ordinal >= 1),
  role text not null check (role in ('user','assistant','human_answer')),
  display_text text not null check (length(display_text) <= 20000),
  -- The exact Anthropic messages of one completed turn (the user turn with its
  -- context block, every assistant turn including thinking and tool_use blocks,
  -- and the tool_result turns), replayed verbatim so history stays append-only.
  -- Never selectable by clients (column grant below).
  api_content jsonb check (api_content is null or (jsonb_typeof(api_content) = 'array' and octet_length(api_content::text) <= 262144)),
  -- User rows: the client idempotency key and the day the question was counted.
  request_id uuid unique,
  quota_date date,
  refunded_at timestamptz,
  -- Assistant rows: the question they answer (one answer per question).
  reply_to_message_id uuid unique references kiara_messages(id) on delete cascade,
  language text check (language is null or language in ('en','hi','hinglish','hi_latn')),
  escalation_offer jsonb check (escalation_offer is null or jsonb_typeof(escalation_offer) = 'object'),
  citations jsonb check (citations is null or jsonb_typeof(citations) = 'array'),
  tools_used text[] not null default '{}',
  data_categories text[] not null default '{}',
  model text check (model is null or length(model) <= 100),
  stop_reason text check (stop_reason is null or length(stop_reason) <= 60),
  usage jsonb check (usage is null or jsonb_typeof(usage) = 'object'),
  created_at timestamptz not null default now(),
  unique (conversation_id, ordinal),
  constraint kiara_messages_user_shape check (role <> 'user' or (request_id is not null and quota_date is not null and api_content is null)),
  constraint kiara_messages_assistant_shape check (role <> 'assistant' or (reply_to_message_id is not null and api_content is not null))
);
create index kiara_messages_conversation on kiara_messages(conversation_id, ordinal);

-- Content-free facts about each answered question. They outlive the messages
-- (365 days) and feed the insights job (Phase 6). No client grant.
create table kiara_question_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_profile_id uuid not null references user_profiles(id) on delete cascade,
  message_id uuid references kiara_messages(id) on delete set null,
  asked_at timestamptz not null default now(),
  local_date date not null,
  category text check (category is null or category in ('sop','app_help','data','other')),
  sop_level text check (sop_level is null or sop_level in ('basic','intermediate','advanced')),
  topic text check (topic is null or length(topic) <= 120),
  kb_hit boolean not null default false,
  escalated boolean not null default false,
  data_categories text[] not null default '{}',
  labelled_at timestamptz
);
create index kiara_question_facts_owner_recent on kiara_question_facts(user_profile_id, asked_at desc);
create index kiara_question_facts_tenant_date on kiara_question_facts(tenant_id, local_date);

-- Every tenant has settings; new tenants receive them on creation.
insert into kiara_settings(tenant_id) select id from tenants on conflict do nothing;

create function seed_kiara_settings_for_new_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into kiara_settings(tenant_id) values (new.id) on conflict do nothing;
  return new;
end $$;
alter function seed_kiara_settings_for_new_tenant() owner to postgres;
revoke all on function seed_kiara_settings_for_new_tenant() from public, anon, authenticated, service_role;
create trigger tenant_default_kiara_settings after insert on tenants
  for each row execute function seed_kiara_settings_for_new_tenant();

-- ---------------------------------------------------------------------------
-- 4. Row-level security and grants (reads only; no direct client writes)
-- ---------------------------------------------------------------------------

alter table kiara_settings enable row level security;
alter table kiara_user_limits enable row level security;
alter table kiara_daily_usage enable row level security;
alter table kiara_conversations enable row level security;
alter table kiara_messages enable row level security;
alter table kiara_question_facts enable row level security;

revoke all on kiara_settings, kiara_user_limits, kiara_daily_usage, kiara_conversations, kiara_messages, kiara_question_facts
  from public, anon, authenticated, service_role;

grant select on kiara_settings, kiara_user_limits, kiara_daily_usage, kiara_conversations to authenticated;
-- api_content is deliberately absent: clients never read model transcripts.
grant select (id, tenant_id, conversation_id, ordinal, role, display_text, request_id, quota_date, refunded_at,
  reply_to_message_id, language, escalation_offer, citations, tools_used, data_categories, model, stop_reason, usage, created_at)
  on kiara_messages to authenticated;

create policy kiara_settings_read on kiara_settings for select to authenticated
  using (tenant_id = (select current_tenant_id()) and (select current_profile_is_active()));
create policy kiara_user_limits_read on kiara_user_limits for select to authenticated
  using (tenant_id = (select current_tenant_id()) and (select current_profile_is_active())
    and (user_profile_id = (select (current_profile()).id) or (select has_permission('assistant.manage_limits'))));
create policy kiara_daily_usage_read on kiara_daily_usage for select to authenticated
  using (tenant_id = (select current_tenant_id()) and (select current_profile_is_active())
    and (user_profile_id = (select (current_profile()).id) or (select has_permission('assistant.manage_limits'))));
-- Conversations are readable by their owner only, including for Super Admin
-- (owner decision 2026-10-08: no in-app transcript access for anyone).
create policy kiara_conversations_owner_read on kiara_conversations for select to authenticated
  using (user_profile_id = (select (current_profile()).id) and (select current_profile_is_active()));
create policy kiara_messages_owner_read on kiara_messages for select to authenticated
  using ((select current_profile_is_active()) and exists (
    select 1 from kiara_conversations c
    where c.id = kiara_messages.conversation_id and c.user_profile_id = (select (current_profile()).id)));

-- Section-owned tables follow the section switch (AGENTS.md authorization map).
create policy kiara_settings_section_available on kiara_settings as restrictive for select to authenticated using (module_accessible('ask_kiara'));
create policy kiara_user_limits_section_available on kiara_user_limits as restrictive for select to authenticated using (module_accessible('ask_kiara'));
create policy kiara_daily_usage_section_available on kiara_daily_usage as restrictive for select to authenticated using (module_accessible('ask_kiara'));
create policy kiara_conversations_section_available on kiara_conversations as restrictive for select to authenticated using (module_accessible('ask_kiara'));
create policy kiara_messages_section_available on kiara_messages as restrictive for select to authenticated using (module_accessible('ask_kiara'));

-- ---------------------------------------------------------------------------
-- 5. Internal helpers (owner-only)
-- ---------------------------------------------------------------------------

-- Section gate plus active profile, resolved through current_profile() so
-- dashboard authority applies. Every Kiara RPC starts here.
create function kiara_actor()
returns user_profiles language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles;
begin
  v_actor := current_profile();
  if v_actor.id is null or not current_profile_is_active() then
    raise exception 'Active profile required' using errcode = '42501';
  end if;
  perform assert_module_access('ask_kiara');
  return v_actor;
end $$;

create function kiara_time_zone(p_tenant_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select timezone from tenants where id = p_tenant_id), ''), 'Asia/Kolkata');
$$;

-- The effective limit: Super Admin (effective role) unlimited, then the
-- per-user exception (null = unlimited), then the tenant default.
create function kiara_quota_for(p_actor user_profiles)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_zone text := kiara_time_zone(p_actor.tenant_id);
  v_date date := (now() at time zone v_zone)::date;
  v_limit integer;
  v_unlimited boolean := false;
  v_used integer;
begin
  if p_actor.user_role = 'super_admin' then
    v_unlimited := true;
  elsif exists (select 1 from kiara_user_limits l where l.user_profile_id = p_actor.id and l.tenant_id = p_actor.tenant_id) then
    select l.daily_question_limit into v_limit from kiara_user_limits l where l.user_profile_id = p_actor.id;
    v_unlimited := v_limit is null;
  else
    select coalesce((select s.daily_question_limit from kiara_settings s where s.tenant_id = p_actor.tenant_id), 10) into v_limit;
  end if;
  select coalesce((select u.questions - u.refunded from kiara_daily_usage u where u.user_profile_id = p_actor.id and u.local_date = v_date), 0)
    into v_used;
  return jsonb_build_object(
    'used', v_used,
    'limit', case when v_unlimited then null else v_limit end,
    'local_date', v_date,
    'timezone', v_zone,
    'resets_at', ((v_date + 1)::timestamp at time zone v_zone));
end $$;

-- The replayable history: each completed turn's API messages, in order.
create function kiara_history(p_conversation_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(turn.message order by m.ordinal, turn.position), '[]'::jsonb)
  from kiara_messages m
  cross join lateral jsonb_array_elements(m.api_content) with ordinality as turn(message, position)
  where m.conversation_id = p_conversation_id and m.role = 'assistant';
$$;

alter function kiara_actor() owner to postgres;
alter function kiara_time_zone(uuid) owner to postgres;
alter function kiara_quota_for(user_profiles) owner to postgres;
alter function kiara_history(uuid) owner to postgres;
revoke all on function kiara_actor(), kiara_time_zone(uuid), kiara_quota_for(user_profiles), kiara_history(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. RPCs
-- ---------------------------------------------------------------------------

create function start_kiara_turn(p_conversation_id uuid, p_request_id uuid, p_message text, p_client text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_actor();
  v_existing kiara_messages;
  v_conversation kiara_conversations;
  v_quota jsonb;
  v_date date;
  v_usage kiara_daily_usage;
  v_message text := btrim(coalesce(p_message, ''));
  v_message_id uuid;
  v_ordinal integer;
  v_replayed boolean := false;
  v_zone text := kiara_time_zone(v_actor.tenant_id);
begin
  if p_request_id is null then raise exception 'A request id is required' using errcode = '22023'; end if;
  if p_client is null or p_client not in ('web','android') then raise exception 'Unknown client' using errcode = '22023'; end if;
  if length(v_message) < 1 or length(v_message) > 2000 then
    raise exception 'Questions must be 1 to 2,000 characters' using errcode = '22023';
  end if;

  -- Idempotent on the client's request id: a retried send never counts twice.
  select * into v_existing from kiara_messages where request_id = p_request_id;
  if v_existing.id is not null then
    select * into v_conversation from kiara_conversations where id = v_existing.conversation_id;
    if v_conversation.user_profile_id <> v_actor.id then
      raise exception 'Request id already used' using errcode = '22023';
    end if;
    if exists (select 1 from kiara_messages a where a.reply_to_message_id = v_existing.id) then
      raise exception 'kiara_request_completed' using errcode = 'P0001';
    end if;
    if v_existing.refunded_at is not null then
      raise exception 'kiara_request_refunded' using errcode = 'P0001';
    end if;
    v_message_id := v_existing.id;
    v_replayed := true;
  else
    if p_conversation_id is not null then
      select * into v_conversation from kiara_conversations where id = p_conversation_id for update;
      if v_conversation.id is null or v_conversation.user_profile_id <> v_actor.id or v_conversation.tenant_id <> v_actor.tenant_id then
        raise exception 'Conversation not found' using errcode = '42501';
      end if;
      if v_conversation.archived_at is not null then
        raise exception 'Conversation not found' using errcode = '42501';
      end if;
      if (select count(*) from kiara_messages m where m.conversation_id = v_conversation.id and m.role = 'user') >= 15 then
        raise exception 'kiara_conversation_full' using errcode = 'P0001';
      end if;
    end if;

    -- Quota: serialize this user's sends on their usage row for today.
    v_quota := kiara_quota_for(v_actor);
    v_date := (v_quota->>'local_date')::date;
    insert into kiara_daily_usage(tenant_id, user_profile_id, local_date) values (v_actor.tenant_id, v_actor.id, v_date)
      on conflict (user_profile_id, local_date) do nothing;
    select * into v_usage from kiara_daily_usage where user_profile_id = v_actor.id and local_date = v_date for update;
    v_quota := kiara_quota_for(v_actor);
    if v_quota->>'limit' is not null and (v_usage.questions - v_usage.refunded) >= (v_quota->>'limit')::integer then
      raise exception 'kiara_daily_limit_reached' using errcode = 'P0001';
    end if;
    update kiara_daily_usage set questions = questions + 1 where user_profile_id = v_actor.id and local_date = v_date;

    if v_conversation.id is null then
      insert into kiara_conversations(tenant_id, user_profile_id, title, client)
      values (v_actor.tenant_id, v_actor.id, left(regexp_replace(v_message, '\s+', ' ', 'g'), 120), p_client)
      returning * into v_conversation;
    end if;
    select coalesce(max(ordinal), 0) + 1 into v_ordinal from kiara_messages where conversation_id = v_conversation.id;
    insert into kiara_messages(tenant_id, conversation_id, ordinal, role, display_text, request_id, quota_date)
    values (v_actor.tenant_id, v_conversation.id, v_ordinal, 'user', v_message, p_request_id, v_date)
    returning id into v_message_id;
    update kiara_conversations set last_message_at = now() where id = v_conversation.id;

    -- Ids and shape only: question text never enters audit_logs.
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
    values (v_actor.tenant_id, v_actor.id, 'assistant_question_started', 'assistant', v_message_id,
      jsonb_build_object('conversation_id', v_conversation.id, 'client', p_client, 'request_id', p_request_id));
  end if;

  return jsonb_build_object(
    'conversation_id', v_conversation.id,
    'message_id', v_message_id,
    'replayed', v_replayed,
    'history', kiara_history(v_conversation.id),
    'quota', kiara_quota_for(v_actor),
    'context', jsonb_build_object(
      'name', coalesce(nullif(btrim(v_actor.employee_name), ''), 'Employee'),
      'role', v_actor.user_role,
      'designation', (select d.label from dropdown_masters d where d.id = v_actor.designation_id),
      'department', (select d.name from departments d where d.id = v_actor.department_id),
      'branch', (select b.name from branches b where b.id = v_actor.branch_id),
      'tenant_today', (now() at time zone v_zone)::date,
      'timezone', v_zone));
end $$;

create function complete_kiara_turn(
  p_request_id uuid, p_display_text text, p_api_content jsonb, p_language text, p_citations jsonb,
  p_escalation_offer jsonb, p_tools_used text[], p_data_categories text[], p_kb_hit boolean,
  p_model text, p_stop_reason text, p_usage jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_actor();
  v_question kiara_messages;
  v_conversation kiara_conversations;
  v_answer_id uuid;
  v_ordinal integer;
begin
  select * into v_question from kiara_messages where request_id = p_request_id and role = 'user' for update;
  if v_question.id is null then raise exception 'Question not found' using errcode = '42501'; end if;
  select * into v_conversation from kiara_conversations where id = v_question.conversation_id;
  if v_conversation.user_profile_id <> v_actor.id or v_conversation.tenant_id <> v_actor.tenant_id then
    raise exception 'Question not found' using errcode = '42501';
  end if;
  if v_question.refunded_at is not null then raise exception 'This question was refunded' using errcode = '22023'; end if;
  if exists (select 1 from kiara_messages a where a.reply_to_message_id = v_question.id) then
    raise exception 'This question has already been answered' using errcode = '22023';
  end if;
  if p_display_text is null or length(p_display_text) > 20000 then raise exception 'Invalid answer text' using errcode = '22023'; end if;
  if p_api_content is null or jsonb_typeof(p_api_content) <> 'array' or jsonb_array_length(p_api_content) < 2
    or octet_length(p_api_content::text) > 262144 then
    raise exception 'Invalid answer content' using errcode = '22023';
  end if;
  if p_language is not null and p_language not in ('en','hi','hinglish','hi_latn') then raise exception 'Invalid language' using errcode = '22023'; end if;
  if p_citations is not null and jsonb_typeof(p_citations) <> 'array' then raise exception 'Invalid citations' using errcode = '22023'; end if;
  if p_escalation_offer is not null and jsonb_typeof(p_escalation_offer) <> 'object' then raise exception 'Invalid escalation offer' using errcode = '22023'; end if;
  if p_usage is not null and jsonb_typeof(p_usage) <> 'object' then raise exception 'Invalid usage' using errcode = '22023'; end if;
  if coalesce(cardinality(p_tools_used), 0) > 16 or exists (select 1 from unnest(coalesce(p_tools_used, '{}')) t where t !~ '^[a-z_]{1,60}$')
    or coalesce(cardinality(p_data_categories), 0) > 16 or exists (select 1 from unnest(coalesce(p_data_categories, '{}')) c where c !~ '^[a-z_]{1,60}$') then
    raise exception 'Invalid tool list' using errcode = '22023';
  end if;

  select coalesce(max(ordinal), 0) + 1 into v_ordinal from kiara_messages where conversation_id = v_conversation.id;
  insert into kiara_messages(tenant_id, conversation_id, ordinal, role, display_text, api_content, reply_to_message_id,
    language, escalation_offer, citations, tools_used, data_categories, model, stop_reason, usage)
  values (v_actor.tenant_id, v_conversation.id, v_ordinal, 'assistant', p_display_text, p_api_content, v_question.id,
    p_language, p_escalation_offer, coalesce(p_citations, '[]'::jsonb), coalesce(p_tools_used, '{}'), coalesce(p_data_categories, '{}'),
    left(p_model, 100), left(p_stop_reason, 60), p_usage)
  returning id into v_answer_id;
  update kiara_conversations set last_message_at = now() where id = v_conversation.id;

  insert into kiara_question_facts(tenant_id, user_profile_id, message_id, asked_at, local_date, kb_hit, escalated, data_categories)
  values (v_actor.tenant_id, v_actor.id, v_question.id, v_question.created_at, v_question.quota_date,
    coalesce(p_kb_hit, false), false, coalesce(p_data_categories, '{}'));

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_question_answered', 'assistant', v_answer_id,
    jsonb_build_object(
      'conversation_id', v_conversation.id, 'message_id', v_answer_id, 'question_message_id', v_question.id,
      'tools_used', to_jsonb(coalesce(p_tools_used, '{}')), 'data_categories', to_jsonb(coalesce(p_data_categories, '{}')),
      'kb_document_ids', coalesce((select jsonb_agg(distinct c->'document_id') from jsonb_array_elements(coalesce(p_citations, '[]'::jsonb)) c where c ? 'document_id'), '[]'::jsonb),
      'escalation_offered', p_escalation_offer is not null,
      'model', left(p_model, 100), 'stop_reason', left(p_stop_reason, 60),
      'input_tokens', p_usage->'input_tokens', 'output_tokens', p_usage->'output_tokens',
      'cache_read_tokens', p_usage->'cache_read_input_tokens', 'cache_creation_tokens', p_usage->'cache_creation_input_tokens',
      'model_requests', p_usage->'requests'));
  return v_answer_id;
end $$;

-- A provider failure before any answer text gives the question back.
create function refund_kiara_question(p_request_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_actor();
  v_question kiara_messages;
  v_owner uuid;
begin
  select * into v_question from kiara_messages where request_id = p_request_id and role = 'user' for update;
  select user_profile_id into v_owner from kiara_conversations where id = v_question.conversation_id;
  if v_question.id is null or v_owner is distinct from v_actor.id then
    raise exception 'Question not found' using errcode = '42501';
  end if;
  if v_question.refunded_at is not null then return; end if;
  if exists (select 1 from kiara_messages a where a.reply_to_message_id = v_question.id)
    or v_question.created_at < now() - interval '15 minutes' then
    raise exception 'This question cannot be refunded' using errcode = '22023';
  end if;
  update kiara_messages set refunded_at = now() where id = v_question.id;
  update kiara_daily_usage set refunded = refunded + 1
    where user_profile_id = v_actor.id and local_date = v_question.quota_date and refunded < questions;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_question_refunded', 'assistant', v_question.id,
    jsonb_build_object('conversation_id', v_question.conversation_id, 'request_id', p_request_id, 'local_date', v_question.quota_date));
end $$;

create function list_my_kiara_conversations(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_actor();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'client', c.client, 'created_at', c.created_at,
      'last_message_at', c.last_message_at,
      'question_count', (select count(*) from kiara_messages m where m.conversation_id = c.id and m.role = 'user'))
      order by c.last_message_at desc, c.id)
    from (select * from kiara_conversations
      where user_profile_id = v_actor.id and tenant_id = v_actor.tenant_id and archived_at is null
      order by last_message_at desc, id limit least(greatest(coalesce(p_limit, 30), 1), 100)) c
  ), '[]'::jsonb);
end $$;

create function get_my_kiara_conversation(p_id uuid)
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
        'stop_reason', m.stop_reason, 'created_at', m.created_at) order by m.ordinal)
      from kiara_messages m where m.conversation_id = p_id), '[]'::jsonb));
end $$;

create function archive_my_kiara_conversation(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_actor user_profiles := kiara_actor(); v_conversation kiara_conversations;
begin
  select * into v_conversation from kiara_conversations where id = p_id for update;
  if v_conversation.id is null or v_conversation.user_profile_id <> v_actor.id or v_conversation.tenant_id <> v_actor.tenant_id then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  if v_conversation.archived_at is not null then return; end if;
  update kiara_conversations set archived_at = now() where id = p_id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_conversation_archived', 'assistant', p_id, '{}'::jsonb);
end $$;

create function get_my_kiara_quota()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_actor();
begin
  return kiara_quota_for(v_actor) - 'local_date';
end $$;

alter function start_kiara_turn(uuid,uuid,text,text) owner to postgres;
alter function complete_kiara_turn(uuid,text,jsonb,text,jsonb,jsonb,text[],text[],boolean,text,text,jsonb) owner to postgres;
alter function refund_kiara_question(uuid) owner to postgres;
alter function list_my_kiara_conversations(integer) owner to postgres;
alter function get_my_kiara_conversation(uuid) owner to postgres;
alter function archive_my_kiara_conversation(uuid) owner to postgres;
alter function get_my_kiara_quota() owner to postgres;

revoke all on function
  start_kiara_turn(uuid,uuid,text,text),
  complete_kiara_turn(uuid,text,jsonb,text,jsonb,jsonb,text[],text[],boolean,text,text,jsonb),
  refund_kiara_question(uuid),
  list_my_kiara_conversations(integer),
  get_my_kiara_conversation(uuid),
  archive_my_kiara_conversation(uuid),
  get_my_kiara_quota()
from public, anon, authenticated, service_role;
grant execute on function
  start_kiara_turn(uuid,uuid,text,text),
  complete_kiara_turn(uuid,text,jsonb,text,jsonb,jsonb,text[],text[],boolean,text,text,jsonb),
  refund_kiara_question(uuid),
  list_my_kiara_conversations(integer),
  get_my_kiara_conversation(uuid),
  archive_my_kiara_conversation(uuid),
  get_my_kiara_quota()
to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Retirement manifest: Kiara tables are retained (never demo data)
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
    'kiara_settings','kiara_user_limits','kiara_daily_usage','kiara_conversations','kiara_messages','kiara_question_facts'
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
      'kiara_question_facts', (select count(*) from public.kiara_question_facts where tenant_id = p_tenant_id)
    )
  );
  return v_manifest;
end;
$$;

revoke all on function public.production_demo_data_retirement_manifest(uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
