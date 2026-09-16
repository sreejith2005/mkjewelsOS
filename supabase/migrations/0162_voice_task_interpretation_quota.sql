-- Voice-assigned tasks: per-author quota for the interpret-task-voice worker.
--
-- Interpreting a voice note spends money on a third-party speech and language
-- API, so the number of interpretations one author can run is bounded here
-- rather than in the client. This table holds no task data and creates no new
-- write path: `create_manual_task_with_mode_with_audit` remains the only way a
-- task is created, and the voice worker only ever produces a draft.

create table if not exists voice_interpretation_quotas (
  user_profile_id uuid primary key references user_profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  interpretations integer not null default 0 check (interpretations >= 0),
  updated_at timestamptz not null default now()
);

alter table voice_interpretation_quotas enable row level security;
revoke all on table voice_interpretation_quotas from public, anon, authenticated;
grant select, insert, update, delete on voice_interpretation_quotas to service_role;

-- Rolling one-hour window. Returns false once the author has spent the window's
-- allowance; the worker turns that into a 429 and nothing is charged.
create or replace function consume_voice_interpretation_quota(p_profile_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_row voice_interpretation_quotas;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_profile_id is null then raise exception 'Profile is required' using errcode = '22023'; end if;
  if not exists (select 1 from user_profiles where id = p_profile_id) then
    raise exception 'Profile is required' using errcode = '22023';
  end if;

  insert into voice_interpretation_quotas(user_profile_id, interpretations) values (p_profile_id, 0)
  on conflict (user_profile_id) do nothing;
  select * into v_row from voice_interpretation_quotas where user_profile_id = p_profile_id for update;

  if v_row.window_started_at <= now() - interval '1 hour' then
    update voice_interpretation_quotas
      set interpretations = 1, window_started_at = now(), updated_at = now()
      where user_profile_id = p_profile_id;
    return true;
  end if;

  if v_row.interpretations >= 40 then return false; end if;

  update voice_interpretation_quotas
    set interpretations = interpretations + 1, updated_at = now()
    where user_profile_id = p_profile_id;
  return true;
end $$;

revoke all on function public.consume_voice_interpretation_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_voice_interpretation_quota(uuid) to service_role;

notify pgrst, 'reload schema';
