-- Ask Kiara Phase 7: voice questions.
--
-- `ask-kiara/transcribe` turns a short recording into text that the asker edits
-- and sends as an ordinary question. Transcription spends money on the same
-- speech-to-text provider as Tasks voice, so it draws on the same hourly
-- allowance: one row per person in `voice_interpretation_quotas` (0162), shared
-- by both features. It does not count as a Kiara question (owner decision);
-- only sending the edited text does, through start_kiara_turn.
--
-- The Tasks path is unchanged: interpret-task-voice keeps calling the
-- service-role `consume_voice_interpretation_quota` (0162), which this
-- migration does not touch. Ask Kiara holds no service-role key, so it spends
-- the allowance as the caller here.

create function consume_my_voice_quota()
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  -- Active profile and the Ask Kiara section (assistant.view + section switch).
  v_actor user_profiles := kiara_actor();
  v_row voice_interpretation_quotas;
begin
  -- Configurable per role, designation and user in Settings -> Permissions
  -- (defaults super_admin, admin, manager; 0213).
  if not has_permission('assistant.voice') then
    raise exception 'Voice questions are not enabled for your account' using errcode = '42501';
  end if;

  -- The same rolling one-hour window and allowance (40) as
  -- consume_voice_interpretation_quota (0162), on the same row, so a person's
  -- Tasks voice notes and Kiara voice questions share one allowance.
  -- Keep both functions in step if the allowance ever changes (pgTAP 0228).
  insert into voice_interpretation_quotas(user_profile_id, interpretations) values (v_actor.id, 0)
  on conflict (user_profile_id) do nothing;
  select * into v_row from voice_interpretation_quotas where user_profile_id = v_actor.id for update;

  if v_row.window_started_at <= now() - interval '1 hour' then
    update voice_interpretation_quotas
      set interpretations = 1, window_started_at = now(), updated_at = now()
      where user_profile_id = v_actor.id;
    return true;
  end if;

  if v_row.interpretations >= 40 then return false; end if;

  update voice_interpretation_quotas
    set interpretations = interpretations + 1, updated_at = now()
    where user_profile_id = v_actor.id;
  return true;
end $$;

alter function consume_my_voice_quota() owner to postgres;
revoke all on function consume_my_voice_quota() from public, anon, authenticated, service_role;
grant execute on function consume_my_voice_quota() to authenticated;

notify pgrst, 'reload schema';
