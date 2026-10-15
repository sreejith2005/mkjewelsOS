-- Ask Kiara Phase 4 follow-up (see the plan's "Migration numbering"):
-- Kiara sees a person's answer to an escalated question in later turns of the same chat.
--
-- start_kiara_turn also returns `human_answers`: every answered escalation of the
-- conversation (escalation id, who answered, when, the question summary, the answer).
-- Stored history is unchanged: kiara_history still replays only Kiara's own stored turns
-- byte for byte. The ask-kiara worker adds an answer the replayed history does not yet
-- contain (matched by escalation id) as a wrapped data block inside the NEW user turn, which
-- complete_kiara_turn then stores with that turn, so the request stays append-only and the
-- answer is sent exactly once into the history.
--
-- Full copy of 0213's start_kiara_turn with one added key; no other behaviour changes.

create or replace function start_kiara_turn(p_conversation_id uuid, p_request_id uuid, p_message text, p_client text)
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
    -- Answers from people (Phase 4 follow-up). Answer text is the answerer's own words: the
    -- worker passes it to the model only inside an untrusted-data wrapper.
    'human_answers', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'escalation_id', e.id,
          'answered_by', coalesce(e.answered_by_label, 'A colleague'),
          'answered_at', e.answered_at,
          'question', left(coalesce(nullif(btrim(e.summary_en), ''), e.question_text), 300),
          'answer', m.display_text)
        order by m.ordinal), '[]'::jsonb)
      from kiara_messages m
      join kiara_escalations e on e.id = m.escalation_id
      where m.conversation_id = v_conversation.id and m.role = 'human_answer'),
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

alter function start_kiara_turn(uuid,uuid,text,text) owner to postgres;
revoke all on function start_kiara_turn(uuid,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function start_kiara_turn(uuid,uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
