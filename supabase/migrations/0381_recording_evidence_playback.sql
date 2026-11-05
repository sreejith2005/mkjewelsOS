-- Store Intelligence: private, audited evidence playback (design: docs/superpowers/specs/2026-11-05-store-intelligence-processing-design.md).
--
-- A reviewer asks for a short window (at most 60 s) of a finished recording.
-- recording_playback_ticket authorizes them, writes an audit row and returns a
-- single-use 60-second ticket. The private recorder service redeems the ticket
-- through recorder-ingest (service secret) and receives only the canonical
-- chunk keys for that window; the browser never sees an object key or a signed
-- URL. Timeline: chunk N starts at N*2000 ms (same convention as transcripts).

create table recording_playback_grants (
 hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
 tenant_id uuid not null references tenants(id),
 session_id uuid not null references recorder_sessions(id) on delete cascade,
 actor_id uuid not null references user_profiles(id),
 first_sequence integer not null check (first_sequence between 0 and 7200),
 last_sequence integer not null check (last_sequence between 0 and 7200),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 used_at timestamptz,
 check (last_sequence >= first_sequence and last_sequence - first_sequence < 31)
);
create index recording_playback_actor_recent on recording_playback_grants(actor_id, created_at);
alter table recording_playback_grants enable row level security;
revoke all on recording_playback_grants from public, anon, authenticated, service_role;
create policy module_accessible on recording_playback_grants as restrictive for select to authenticated using (public.module_accessible('sales_recording', false));

create function recording_playback_ticket(p_session_id uuid, p_start_ms integer, p_end_ms integer)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
 a user_profiles := current_profile();
 s recorder_sessions := recording_session_for_review(p_session_id);
 first_seq integer; last_seq integer; ticket text; expiry timestamptz := clock_timestamp() + interval '60 seconds';
begin
 if s.status not in ('ready', 'needs_attention') then raise exception 'recording_playback_not_ready' using errcode = '22023'; end if;
 if p_start_ms is null or p_end_ms is null or p_start_ms < 0 or p_end_ms <= p_start_ms or p_end_ms - p_start_ms > 60000 then
  raise exception 'recording_invalid_window' using errcode = '22023';
 end if;
 first_seq := p_start_ms / 2000;
 last_seq := least((p_end_ms - 1) / 2000, first_seq + 30);
 if first_seq > 7200 or not exists (select 1 from recorder_chunks where session_id = s.id and sequence between first_seq and last_seq) then
  raise exception 'recording_audio_not_found' using errcode = '22023';
 end if;
 if (select count(*) from recording_playback_grants where actor_id = a.id and created_at > clock_timestamp() - interval '10 minutes') >= 60 then
  raise exception 'recording_playback_rate_limit' using errcode = '54000';
 end if;
 delete from recording_playback_grants where expires_at < now() - interval '1 hour';
 ticket := encode(gen_random_bytes(32), 'hex');
 insert into recording_playback_grants(hash, tenant_id, session_id, actor_id, first_sequence, last_sequence, expires_at)
  values (encode(digest(ticket, 'sha256'), 'hex'), s.tenant_id, s.id, a.id, first_seq, last_seq, expiry);
 -- Listening to a customer conversation is itself audited (who, which recording, which window).
 insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (s.tenant_id, a.id, 'recording_audio_played', 'sales_recording', s.id,
   jsonb_build_object('start_ms', first_seq * 2000, 'end_ms', (last_seq + 1) * 2000, 'employee_id', s.employee_id));
 return jsonb_build_object('ticket', ticket, 'expires_at', expiry, 'start_ms', first_seq * 2000, 'end_ms', (last_seq + 1) * 2000);
end $$;

-- Service boundary only (recorder-ingest, action playback_redeem).
create function recording_playback_ingest(p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare g recording_playback_grants; s recorder_sessions; begin
 if coalesce(auth.role(), '') <> 'service_role' then raise exception 'recording_service_only' using errcode = '42501'; end if;
 if p_action <> 'playback_redeem' then raise exception 'recording_invalid_action' using errcode = '22023'; end if;
 if coalesce(p_payload->>'ticket', '') !~ '^[0-9a-f]{64}$' then raise exception 'recording_playback_denied' using errcode = '42501'; end if;
 select * into g from recording_playback_grants where hash = encode(digest(p_payload->>'ticket', 'sha256'), 'hex') for update;
 if g.hash is null or g.used_at is not null or g.expires_at <= clock_timestamp() then raise exception 'recording_playback_denied' using errcode = '42501'; end if;
 update recording_playback_grants set used_at = clock_timestamp() where hash = g.hash;
 select * into s from recorder_sessions where id = g.session_id;
 if s.id is null or s.expires_at <= now() then raise exception 'recording_playback_denied' using errcode = '42501'; end if;
 return jsonb_build_object(
  'session', jsonb_build_object('id', s.id, 'tenant_id', s.tenant_id, 'branch_id', s.branch_id, 'employee_id', s.employee_id, 'device_id', s.device_id),
  'first_sequence', g.first_sequence, 'last_sequence', g.last_sequence, 'start_ms', g.first_sequence * 2000,
  'chunks', coalesce((select jsonb_agg(jsonb_build_object('sequence', c.sequence, 'sha256', c.sha256, 'byte_count', c.byte_count, 'object_key', c.object_key) order by c.sequence)
   from recorder_chunks c where c.session_id = s.id and c.sequence between g.first_sequence and g.last_sequence), '[]'::jsonb));
end $$;

revoke all on function recording_playback_ticket(uuid, integer, integer) from public, anon;
revoke all on function recording_playback_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function recording_playback_ticket(uuid, integer, integer) to authenticated;
grant execute on function recording_playback_ingest(text, jsonb) to service_role;
