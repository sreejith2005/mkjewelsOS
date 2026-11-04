-- Approved recorder pilot. Disabled until owner configures server allowlists and transports.
set search_path=public,extensions;
-- permission-catalog:begin
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values
('module.sales_recording', 'module', 'sales_recording', '{super_admin,admin,manager}', 1200),
('recording.capture', 'action', null, '{}', 1201),
('recording.review', 'action', null, '{super_admin,admin,manager}', 1202),
('recording.coach', 'action', null, '{super_admin,admin,manager}', 1203);
-- permission-catalog:end
create table recorder_config (
 tenant_id uuid primary key references tenants(id),enabled boolean not null default false,
 employee_ids uuid[] not null default '{}',branch_ids uuid[] not null default '{}',
 coaching_enabled boolean not null default false,retention_days integer not null default 7 check(retention_days between 1 and 90)
);
create table recorder_devices (
 id uuid primary key,tenant_id uuid not null references tenants(id),branch_id uuid not null references branches(id),employee_id uuid not null references user_profiles(id),
 last_seen_at timestamptz not null default now(),health text not null default 'unknown' check(health in ('unknown','recent_upload','paused','stale','needs_attention'))
);
create table recorder_sessions (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),branch_id uuid not null references branches(id),employee_id uuid not null references user_profiles(id),
 device_id uuid not null references recorder_devices(id),request_id uuid not null,consent_version text not null check(consent_version='pilot-v1'),consented_at timestamptz not null default now(),
 status text not null default 'recording' check(status in ('recording','paused','saving','processing','ready','needs_attention')),
 next_sequence integer not null default 0 check(next_sequence between 0 and 7201),last_sequence integer check(last_sequence between -1 and 7200),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),
 capture_ended_at timestamptz,error_reason text check(error_reason is null or error_reason ~ '^[a-z_]{1,64}$'),
 expires_at timestamptz not null default now()+interval '7 days',unique(employee_id,request_id)
);
create unique index recorder_device_open on recorder_sessions(device_id) where capture_ended_at is null;
create table recorder_tickets(hash text primary key,session_id uuid not null references recorder_sessions(id),expires_at timestamptz not null,used_at timestamptz);
create index recorder_ticket_session_expiry on recorder_tickets(session_id,expires_at);
create table recorder_chunks (
 session_id uuid not null references recorder_sessions(id),sequence integer not null check(sequence between 0 and 7200),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),byte_count integer not null check(byte_count between 2 and 64000 and byte_count%2=0),
 object_key text not null unique,created_at timestamptz not null default now(),primary key(session_id,sequence)
);
create table recorder_jobs (
 id uuid primary key default gen_random_uuid(),session_id uuid not null references recorder_sessions(id),kind text not null check(kind in ('provisional','final')),
 sequence integer not null default -1,state text not null default 'pending' check(state in ('pending','leased','done','dead')),
 attempts integer not null default 0,available_at timestamptz not null default now(),worker_id uuid,lease_token uuid,lease_until timestamptz,
 error_reason text check(error_reason is null or error_reason ~ '^[a-z_]{1,64}$'),created_at timestamptz not null default now(),unique(session_id,kind,sequence)
);
create index recorder_job_claim on recorder_jobs(state,available_at);
create table recorder_segments (
 session_id uuid not null references recorder_sessions(id),segment_id uuid not null,sequence integer not null check(sequence>=0),revision integer not null check(revision>=0),
 text text not null check(octet_length(text)<=16384),is_final boolean not null,started_ms integer not null check(started_ms>=0),ended_ms integer not null check(ended_ms>=started_ms),
 updated_at timestamptz not null default now(),primary key(session_id,segment_id)
);
create table recorder_alerts (
 id uuid primary key default gen_random_uuid(),session_id uuid not null references recorder_sessions(id),segment_id uuid not null,
 code text not null check(code in ('critical_compliance','critical_customer_safety')),created_at timestamptz not null default now(),unique(session_id,segment_id,code),
 foreign key(session_id,segment_id) references recorder_segments(session_id,segment_id)
);
create function recorder_actor() returns user_profiles language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); begin
 if a.id is null or not current_profile_is_active() or a.working_status<>'active' then raise exception 'recorder_actor_denied' using errcode='42501'; end if;
 perform assert_module_access('sales_recording'); return a;
end $$;

create function recorder_can_read(p_employee uuid,p_tenant uuid,p_branch uuid) returns boolean language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); begin
 return coalesce(a.id is not null and current_profile_is_active() and module_accessible('sales_recording') and a.tenant_id=p_tenant and a.branch_id=p_branch and
 (a.id=p_employee or (a.user_role in ('super_admin','admin','manager') and has_permission('recording.review'))),false);
end $$;
do $$ declare t text; begin foreach t in array array['recorder_config','recorder_devices','recorder_sessions','recorder_tickets','recorder_chunks','recorder_jobs','recorder_segments','recorder_alerts'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 execute format('create policy module_accessible on %I as restrictive for select to authenticated using (public.module_accessible(''sales_recording'',false))',t);
 end loop; end $$;
grant select on recorder_sessions,recorder_devices,recorder_segments,recorder_alerts to authenticated;
create policy recorder_session_read on recorder_sessions for select to authenticated using(recorder_can_read(employee_id,tenant_id,branch_id));
create policy recorder_device_read on recorder_devices for select to authenticated using(recorder_can_read(employee_id,tenant_id,branch_id));
create policy recorder_segment_read on recorder_segments for select to authenticated using(exists(select 1 from recorder_sessions s where s.id=session_id));
create policy recorder_alert_read on recorder_alerts for select to authenticated using(has_permission('recording.coach') and current_role_level() in ('super_admin','admin','manager') and exists(select 1 from recorder_sessions s where s.id=session_id));
create function recorder_issue_ticket(p_device_id uuid,p_request_id uuid default null,p_session_id uuid default null,p_consent boolean default false,p_consent_version text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a user_profiles:=recorder_actor(); c recorder_config; s recorder_sessions; d recorder_devices; ticket text; expiry timestamptz:=clock_timestamp()+interval '60 seconds'; begin
 if not has_permission('recording.capture') then raise exception 'recorder_capture_denied' using errcode='42501'; end if;
 select * into c from recorder_config where tenant_id=a.tenant_id;
 if not coalesce(c.enabled,false) or not(a.id=any(c.employee_ids)) or not(a.branch_id=any(c.branch_ids)) then raise exception 'recorder_pilot_disabled' using errcode='42501'; end if;
 if p_device_id is null then raise exception 'recorder_invalid_device' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a.id::text,2));
 if (select count(*) from recorder_tickets t join recorder_sessions rs on rs.id=t.session_id where rs.employee_id=a.id and t.expires_at>clock_timestamp())>=12 then raise exception 'recorder_ticket_rate_limit' using errcode='54000'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_device_id::text,0));
 select * into d from recorder_devices where id=p_device_id for update;
 if d.id is not null and (d.employee_id<>a.id or d.tenant_id<>a.tenant_id or d.branch_id<>a.branch_id) then raise exception 'recorder_device_scope_denied' using errcode='42501'; end if;
 if p_session_id is null then
  if p_request_id is null or p_consent is not true or p_consent_version is distinct from 'pilot-v1' then raise exception 'recorder_consent_required' using errcode='22023'; end if;
  insert into recorder_devices(id,tenant_id,branch_id,employee_id) values(p_device_id,a.tenant_id,a.branch_id,a.id) on conflict(id) do nothing;
  select * into s from recorder_sessions where employee_id=a.id and request_id=p_request_id;
  if s.id is null then
   if exists(select 1 from recorder_sessions where device_id=p_device_id and capture_ended_at is null) then raise exception 'recorder_device_busy' using errcode='23505'; end if;
   insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,expires_at)
    values(a.tenant_id,a.branch_id,a.id,p_device_id,p_request_id,p_consent_version,now()+make_interval(days=>c.retention_days)) returning * into s;
   insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'recording_started','sales_recording',s.id,jsonb_build_object('device_id',p_device_id,'consent_version',p_consent_version));
  end if;
 else select * into s from recorder_sessions where id=p_session_id; end if;
 if s.id is null or s.employee_id<>a.id or s.device_id<>p_device_id or s.branch_id<>a.branch_id or s.tenant_id<>a.tenant_id then raise exception 'recorder_session_denied' using errcode='42501'; end if;
 -- Sealed sessions still need a lease to recover a lost final commit ACK.
 -- chunk/check_chunk below reject new audio after the seal.
 if s.expires_at<=now() then raise exception 'recorder_session_closed' using errcode='22023'; end if;
 ticket:=encode(gen_random_bytes(32),'hex');
 insert into recorder_tickets(hash,session_id,expires_at) values(encode(digest(ticket,'sha256'),'hex'),s.id,expiry);
 return jsonb_build_object('session',to_jsonb(s),'ticket',ticket,'expires_at',expiry);
end $$;
create function recorder_control_session(p_session_id uuid,p_action text,p_last_sequence integer default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); s recorder_sessions; begin
 select * into s from recorder_sessions where id=p_session_id for update;
 if s.id is null or s.employee_id<>a.id or s.branch_id<>a.branch_id or s.tenant_id<>a.tenant_id or not has_permission('recording.capture') then raise exception 'recorder_session_denied' using errcode='42501'; end if;
 if p_action='stop' then
  if p_last_sequence is null or p_last_sequence < -1 or p_last_sequence>7200 or p_last_sequence<s.next_sequence-1 then raise exception 'recorder_invalid_end' using errcode='22023'; end if;
  if s.last_sequence is not null and s.last_sequence<>p_last_sequence then raise exception 'recorder_end_conflict' using errcode='22023'; end if;
  if s.capture_ended_at is null then update recorder_sessions set status='saving',last_sequence=p_last_sequence,capture_ended_at=now(),updated_at=now() where id=s.id returning * into s; end if;
 elsif p_action in ('pause','resume') then
  if s.capture_ended_at is not null or now()>s.created_at+interval '4 hours' then raise exception 'recorder_session_closed' using errcode='22023'; end if;
  update recorder_sessions set status=case p_action when 'pause' then 'paused' else 'recording' end,error_reason=null,last_seen_at=now(),updated_at=now() where id=s.id returning * into s;
  update recorder_devices set last_seen_at=now(),health=case p_action when 'pause' then 'paused' else 'unknown' end where id=s.device_id;
 else raise exception 'recorder_invalid_action' using errcode='22023'; end if;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'recording_'||p_action,'sales_recording',s.id,jsonb_build_object('status',s.status,'last_sequence',s.last_sequence));
 return to_jsonb(s);
end $$;
create function recorder_session_snapshot(p_session_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); s recorder_sessions; begin
 select * into s from recorder_sessions where id=p_session_id;
 if s.id is null or not recorder_can_read(s.employee_id,s.tenant_id,s.branch_id) then raise exception 'recorder_session_denied' using errcode='42501'; end if;
 return jsonb_build_object('session',to_jsonb(s),'segments',coalesce((select jsonb_agg(to_jsonb(x) order by sequence,started_ms,segment_id) from recorder_segments x where session_id=s.id),'[]'::jsonb),
 'alerts',case when a.user_role in ('super_admin','admin','manager') and has_permission('recording.coach') then coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('message',case x.code when 'critical_compliance' then 'Critical compliance concern in confirmed transcript.' else 'Critical customer safety concern in confirmed transcript.' end) order by created_at) from recorder_alerts x where session_id=s.id),'[]'::jsonb) else '[]'::jsonb end);
end $$;
create function recorder_list_sessions() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); begin return coalesce((select jsonb_agg(to_jsonb(s) order by created_at desc) from (select * from recorder_sessions where recorder_can_read(employee_id,tenant_id,branch_id) order by created_at desc limit 100) s),'[]'::jsonb); end $$;
create function recorder_link_customer(p_session_id uuid,p_customer_ref text) returns jsonb language plpgsql security definer set search_path=public as $$ begin perform recorder_session_snapshot(p_session_id); raise exception 'recorder_crm_verification_unavailable' using errcode='0A000'; end $$;
-- Only the Edge boundary has service_role. The ingestion host gets a dedicated
-- recorder secret, never a Supabase key. Every action below is explicitly allowlisted.
create function recorder_ingest(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s recorder_sessions; t recorder_tickets; ch recorder_chunks; j recorder_jobs; seg recorder_segments;
 seq integer; hash text; bytes integer; key text; ending integer; wid uuid; affected integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'recorder_service_only' using errcode='42501'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>32768 then raise exception 'recorder_invalid_payload' using errcode='22023'; end if;
 if p_action='redeem' then
  if (p_payload->>'ticket') !~ '^[0-9a-f]{64}$' then raise exception 'recorder_ticket_denied' using errcode='42501'; end if;
  select * into t from recorder_tickets where recorder_tickets.hash=encode(digest(p_payload->>'ticket','sha256'),'hex') for update;
  if t.hash is null or t.used_at is not null or t.expires_at<=clock_timestamp() then raise exception 'recorder_ticket_denied' using errcode='42501'; end if;
  select * into s from recorder_sessions where id=t.session_id for update;
  -- Recheck employment, original branch, explicit pilot allowlists and permission
  -- at each fresh lease; transfer/deactivation cannot reuse an old ticket.
  if s.expires_at<=now() or not exists(
   select 1 from user_profiles u join recorder_config c on c.tenant_id=u.tenant_id
   where u.id=s.employee_id and u.tenant_id=s.tenant_id and u.branch_id=s.branch_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
    and c.enabled and u.id=any(c.employee_ids) and u.branch_id=any(c.branch_ids) and permission_effective_for(u.id,'recording.capture')
  ) then raise exception 'recorder_session_denied' using errcode='42501'; end if;
  update recorder_tickets set used_at=clock_timestamp() where recorder_tickets.hash=t.hash;
  return jsonb_build_object('session',to_jsonb(s),'next_sequence',s.next_sequence);
 elsif p_action in ('check_chunk','chunk','commit','event','alert','heartbeat') then
  select * into s from recorder_sessions where id=(p_payload->>'session_id')::uuid for update;
  if s.id is null or s.device_id::text is distinct from p_payload->>'device_id' or s.employee_id::text is distinct from p_payload->>'employee_id'
   or s.tenant_id::text is distinct from p_payload->>'tenant_id' or s.branch_id::text is distinct from p_payload->>'branch_id' or s.expires_at<=now() then
   raise exception 'recorder_scope_denied' using errcode='42501'; end if;
  if p_action in ('event','alert') and not exists(select 1 from recorder_jobs q where q.id=(p_payload->>'job_id')::uuid and q.session_id=s.id and q.state='leased' and q.worker_id::text=p_payload->>'worker_id' and q.lease_token::text=p_payload->>'lease_token' and q.lease_until>clock_timestamp()) then raise exception 'recorder_job_lease_denied' using errcode='42501'; end if;
  if p_action in ('check_chunk','chunk') then
   seq:=(p_payload->>'sequence')::integer; hash:=p_payload->>'sha256'; bytes:=(p_payload->>'byte_count')::integer; key:=p_payload->>'object_key';
   if seq is null or seq<0 or seq>7200 or hash is null or hash !~ '^[0-9a-f]{64}$' or bytes is null or bytes<2 or bytes>64000 or bytes%2<>0 then raise exception 'recorder_invalid_chunk' using errcode='22023'; end if;
   if key is distinct from ('recordings/'||s.tenant_id||'/'||s.branch_id||'/'||s.employee_id||'/'||s.device_id||'/'||s.id||'/'||lpad(seq::text,8,'0')||'-'||hash||'.pcm') then raise exception 'recorder_object_scope_denied' using errcode='42501'; end if;
   select * into ch from recorder_chunks where session_id=s.id and sequence=seq;
   if ch.session_id is not null then
    if ch.sha256<>hash or ch.byte_count<>bytes or ch.object_key<>key then raise exception 'recorder_chunk_conflict' using errcode='23505'; end if;
   else
    if s.status in ('processing','ready') or seq<>s.next_sequence or (s.last_sequence is not null and seq>s.last_sequence) then raise exception 'recorder_chunk_order' using errcode='22023'; end if;
    if s.next_sequence>=7201 then raise exception 'recorder_session_limit' using errcode='22023'; end if;
    if (select count(*) from recorder_jobs where state in ('pending','leased'))>=10000 then raise exception 'recorder_queue_full' using errcode='54000'; end if;
    if (select coalesce(sum(byte_count),0) from recorder_chunks where session_id=s.id)+bytes>460800000 then raise exception 'recorder_session_limit' using errcode='22023'; end if;
    if p_action='check_chunk' then return jsonb_build_object('allowed',true,'next_sequence',s.next_sequence); end if;
    insert into recorder_chunks values(s.id,seq,hash,bytes,key,now());
    if (select count(*) from recorder_jobs where state in ('pending','leased'))>=10000 then raise exception 'recorder_queue_full' using errcode='54000'; end if;
    insert into recorder_jobs(session_id,kind,sequence) values(s.id,'provisional',seq);
    update recorder_sessions set next_sequence=next_sequence+1,last_seen_at=now(),updated_at=now() where id=s.id returning * into s;
   end if;
   if p_action='check_chunk' then return jsonb_build_object('allowed',true,'next_sequence',s.next_sequence); end if;
   update recorder_devices set last_seen_at=now(),health='recent_upload' where id=s.device_id;
   return jsonb_build_object('type','ack','sequence',seq,'sha256',hash,'next_sequence',s.next_sequence);
  elsif p_action='commit' then
   ending:=(p_payload->>'last_sequence')::integer;
   if ending is null or ending< -1 or ending>7200 or ending<>s.next_sequence-1 or (s.last_sequence is not null and s.last_sequence<>ending) then raise exception 'recorder_commit_gap' using errcode='22023'; end if;
   if s.status not in ('ready','processing') then
    if (select count(*) from recorder_jobs where state in ('pending','leased'))>=10000 then raise exception 'recorder_queue_full' using errcode='54000'; end if;
    update recorder_sessions set status='processing',last_sequence=ending,capture_ended_at=coalesce(capture_ended_at,now()),updated_at=now() where id=s.id returning * into s;
    insert into recorder_jobs(session_id,kind) values(s.id,'final') on conflict do nothing;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(s.tenant_id,s.employee_id,'recording_committed','sales_recording',s.id,jsonb_build_object('last_sequence',ending));
   end if;
   return jsonb_build_object('session',to_jsonb(s));
  elsif p_action='event' then
   if (p_payload->>'segment_id') is null or (p_payload->>'sequence')::integer not between 0 and greatest(s.next_sequence-1,0) then raise exception 'recorder_invalid_segment' using errcode='22023'; end if;
   select * into seg from recorder_segments where session_id=s.id and segment_id=(p_payload->>'segment_id')::uuid;
   if seg.segment_id is not null and (seg.revision>=(p_payload->>'revision')::integer or (seg.is_final and not (p_payload->>'is_final')::boolean)) then return jsonb_build_object('accepted',false); end if;
   insert into recorder_segments(session_id,segment_id,sequence,revision,text,is_final,started_ms,ended_ms)
   values(s.id,(p_payload->>'segment_id')::uuid,(p_payload->>'sequence')::integer,(p_payload->>'revision')::integer,p_payload->>'text',(p_payload->>'is_final')::boolean,(p_payload->>'started_ms')::integer,(p_payload->>'ended_ms')::integer)
   on conflict(session_id,segment_id) do update set revision=excluded.revision,text=excluded.text,is_final=excluded.is_final,started_ms=excluded.started_ms,ended_ms=excluded.ended_ms,updated_at=now();
   return jsonb_build_object('accepted',true);
  elsif p_action='alert' then
   if not exists(select 1 from recorder_jobs where id=(p_payload->>'job_id')::uuid and kind='final') or not exists(select 1 from recorder_config where tenant_id=s.tenant_id and coaching_enabled) or not exists(select 1 from recorder_segments where session_id=s.id and segment_id=(p_payload->>'segment_id')::uuid and is_final and btrim(text)=p_payload->>'evidence_text') or p_payload->>'unambiguous' is distinct from 'true'
    or jsonb_typeof(p_payload->'confidence') is distinct from 'number' or not coalesce((p_payload->>'confidence')::numeric between 0.99 and 1,false) then raise exception 'recorder_coaching_denied' using errcode='42501'; end if;
   if not exists(select 1 from recorder_alerts where session_id=s.id and created_at>now()-interval '60 seconds') then
    insert into recorder_alerts(session_id,segment_id,code) values(s.id,(p_payload->>'segment_id')::uuid,p_payload->>'code') on conflict do nothing; get diagnostics affected=row_count;
   end if; return jsonb_build_object('accepted',coalesce(affected,0)>0);
  else
   update recorder_devices set last_seen_at=now(),health=case when s.status='paused' then 'paused' else 'unknown' end where id=s.device_id;
   update recorder_sessions set last_seen_at=now() where id=s.id;
   return jsonb_build_object('accepted',true);
  end if;
 elsif p_action='claim_job' then
  wid:=(p_payload->>'worker_id')::uuid;
  if wid is null then raise exception 'recorder_invalid_worker' using errcode='22023'; end if;
  select * into j from recorder_jobs q where q.state='pending' and q.available_at<=now() and not exists(select 1 from recorder_jobs other where other.session_id=q.session_id and other.state='leased')
   and (q.kind='provisional' or not exists(select 1 from recorder_jobs other where other.session_id=q.session_id and other.kind='provisional' and other.state in ('pending','leased')))
   order by created_at,sequence for update skip locked limit 1;
  if j.id is null then return jsonb_build_object('job',null); end if;
  perform pg_advisory_xact_lock(hashtextextended(j.session_id::text,1));
  if exists(select 1 from recorder_jobs where session_id=j.session_id and state='leased') then return jsonb_build_object('job',null); end if;
  update recorder_jobs set state='leased',worker_id=wid,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=j.id returning * into j;
  select * into s from recorder_sessions where id=j.session_id;
  return jsonb_build_object('job',to_jsonb(j)||jsonb_build_object('session',to_jsonb(s),'coaching_enabled',coalesce((select coaching_enabled from recorder_config where tenant_id=s.tenant_id),false),'last_sequence',s.last_sequence,'chunks',coalesce((select jsonb_agg(to_jsonb(x) order by sequence) from recorder_chunks x where session_id=s.id and (j.kind='final' or sequence between greatest(0,j.sequence-1) and j.sequence)),'[]'::jsonb)));
 elsif p_action='finish_job' then
  select * into j from recorder_jobs where id=(p_payload->>'job_id')::uuid for update;
  if j.id is null or j.state<>'leased' or j.lease_token::text is distinct from p_payload->>'lease_token' or j.worker_id::text is distinct from p_payload->>'worker_id' or j.lease_until<=now() then raise exception 'recorder_job_lease_denied' using errcode='42501'; end if;
  if (p_payload->>'success')::boolean is true then
   update recorder_jobs set state='done',lease_until=null where id=j.id returning * into j;
   if j.kind='final' then
    if exists(select 1 from recorder_chunks cq where cq.session_id=j.session_id and not exists(select 1 from recorder_segments sg where sg.session_id=cq.session_id and sg.sequence=cq.sequence and sg.is_final)) then raise exception 'recorder_final_segments_missing' using errcode='22023'; end if;
    update recorder_sessions set status='ready',error_reason=null,updated_at=now() where id=j.session_id;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id) select tenant_id,employee_id,'recording_ready','sales_recording',id from recorder_sessions where id=j.session_id;
   end if;
  else
   update recorder_jobs set state=case when attempts>=5 then 'dead' else 'pending' end,available_at=now()+make_interval(secs=>least(900,10*(2^attempts)::integer)),lease_until=null,error_reason=coalesce(p_payload->>'error_reason','processing_failed') where id=j.id returning * into j;
   if j.kind='final' then update recorder_sessions set status='needs_attention',error_reason=j.error_reason,updated_at=now() where id=j.session_id; end if;
  end if;
  return jsonb_build_object('job',to_jsonb(j));
 elsif p_action='reconcile' then
  update recorder_jobs set state=case when attempts>=5 then 'dead' else 'pending' end,lease_until=null,error_reason='worker_lease_expired',available_at=now()+interval '30 seconds' where state='leased' and lease_until<now();
  update recorder_sessions set status='needs_attention',error_reason='capture_interrupted',updated_at=now() where capture_ended_at is null and status in ('recording','paused') and last_seen_at<now()-interval '10 minutes';
  get diagnostics affected=row_count;
  update recorder_sessions set status='needs_attention',error_reason='processing_retries_exhausted',updated_at=now() where status='processing' and exists(select 1 from recorder_jobs dead_job where dead_job.session_id=recorder_sessions.id and dead_job.kind='final' and dead_job.state='dead');
  update recorder_devices set health='stale' where last_seen_at<now()-interval '2 minutes' and health<>'unknown';
  update recorder_sessions set status='needs_attention',error_reason='retention_expired',capture_ended_at=coalesce(capture_ended_at,now()),updated_at=now() where expires_at<=now() and status not in ('ready','needs_attention');
  -- Interrupted sessions are already needs_attention; expiry must nevertheless
  -- release their device slot, without inventing a successful completion.
  update recorder_sessions set capture_ended_at=now(),updated_at=now() where expires_at<=now() and capture_ended_at is null;
  update recorder_jobs set state='dead',error_reason='retention_expired',lease_until=null where state in ('pending','leased') and session_id in (select id from recorder_sessions where expires_at<=now());
  delete from recorder_alerts where session_id in (select id from recorder_sessions where expires_at<=now());
  delete from recorder_segments where session_id in (select id from recorder_sessions where expires_at<=now());
  delete from recorder_tickets where expires_at<now()-interval '1 hour';
  return jsonb_build_object('interrupted',affected);
 elsif p_action='health' then
  return jsonb_build_object('pending',(select count(*) from recorder_jobs where state='pending'),'leased',(select count(*) from recorder_jobs where state='leased'),'dead',(select count(*) from recorder_jobs where state='dead'),'capacity',10000);
 else raise exception 'recorder_invalid_action' using errcode='22023'; end if;
end $$;
-- Explicit grants: no direct service table access, no public definer defaults.
do $$ declare f record; begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'recorder_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig); end loop; end $$;
grant execute on function recorder_can_read(uuid,uuid,uuid) to authenticated;
grant execute on function recorder_issue_ticket(uuid,uuid,uuid,boolean,text),recorder_control_session(uuid,text,integer),recorder_session_snapshot(uuid),recorder_list_sessions(),recorder_link_customer(uuid,text) to authenticated;
grant execute on function recorder_ingest(text,jsonb) to service_role;
notify pgrst,'reload schema';

-- Preserve all existing availability defaults while adding the new page. The
-- pilot's separate server allowlist remains disabled irrespective of this flag.
do $$ declare d text; begin
 d:=pg_get_functiondef('default_section_availability()'::regprocedure);
 if position('''sales_recording''' in d)=0 then execute replace(d,'''home'', true,','''sales_recording'', true, ''home'', true,'); end if;
 d:=pg_get_functiondef('validated_section_availability(jsonb)'::regprocedure);
 if position('''sales_recording''' in d)=0 then execute replace(d,'''ask_kiara''','''ask_kiara'',''sales_recording'''); end if;
end $$;

alter table recorder_sessions add column customer_ref text;
create or replace function recorder_link_customer(p_session_id uuid,p_customer_ref text) returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); s recorder_sessions; q uuid; begin
 select * into s from recorder_sessions where id=p_session_id for update;
 if s.id is null or not recorder_can_read(s.employee_id,s.tenant_id,s.branch_id) or not has_permission('crm.view') then raise exception 'recorder_link_denied' using errcode='42501'; end if;
 if p_customer_ref !~ '^walkin:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'recorder_crm_verification_unavailable' using errcode='0A000'; end if;
 q:=substring(p_customer_ref from 8)::uuid;
 if not exists(select 1 from crm_sync.walkin_state w join task_instances t on t.id=w.task_id where w.queue_id=q and t.source='crm_walkin' and t.source_ref_id=q and t.tenant_id=s.tenant_id and t.branch_id=s.branch_id
  and ((a.user_role in ('super_admin','admin','manager') and has_permission('recording.review')) or exists(select 1 from task_assignees ta where ta.task_instance_id=t.id and ta.user_profile_id=a.id and ta.is_active))) then raise exception 'recorder_link_denied' using errcode='42501'; end if;
 update recorder_sessions set customer_ref=p_customer_ref,updated_at=now() where id=s.id returning * into s;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'recording_walkin_linked','sales_recording',s.id,jsonb_build_object('walkin_ref',p_customer_ref));
 return to_jsonb(s);
end $$;
create function recorder_linkable_walkins() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); begin
 if not has_permission('crm.view') then raise exception 'recorder_link_denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('ref','walkin:'||queue_id,'label',title)) from (
 select w.queue_id,t.title from crm_sync.walkin_state w join task_instances t on t.id=w.task_id where t.source='crm_walkin' and t.source_ref_id=w.queue_id and t.tenant_id=a.tenant_id and t.branch_id=a.branch_id
 and ((a.user_role in ('super_admin','admin','manager') and has_permission('recording.review')) or exists(select 1 from task_assignees ta where ta.task_instance_id=t.id and ta.user_profile_id=a.id and ta.is_active)) order by w.applied_at desc limit 100) x),'[]'::jsonb);
end $$;
revoke all on function recorder_linkable_walkins() from public,anon,authenticated,service_role;
grant execute on function recorder_linkable_walkins() to authenticated;

create function recorder_configure(p_enabled boolean,p_employee_ids uuid[],p_branch_ids uuid[],p_retention_days integer default 7,p_coaching_enabled boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile(); c recorder_config; begin
 if a.id is null or not current_profile_is_active() or not has_permission('developer_mode.manage') then raise exception 'recorder_config_denied' using errcode='42501'; end if;
 if p_enabled is null or p_coaching_enabled is null or p_retention_days is null or p_retention_days not between 1 and 90 or p_employee_ids is null or p_branch_ids is null
 or cardinality(p_employee_ids)>100 or cardinality(p_branch_ids)>20
 or exists(select 1 from unnest(p_employee_ids) x where not exists(select 1 from user_profiles where id=x and tenant_id=a.tenant_id and account_status='active' and working_status='active'))
 or exists(select 1 from unnest(p_branch_ids) x where not exists(select 1 from branches where id=x and tenant_id=a.tenant_id)) then raise exception 'recorder_invalid_config' using errcode='22023'; end if;
 insert into recorder_config(tenant_id,enabled,employee_ids,branch_ids,retention_days,coaching_enabled) values(a.tenant_id,p_enabled,p_employee_ids,p_branch_ids,p_retention_days,p_coaching_enabled)
 on conflict(tenant_id) do update set enabled=excluded.enabled,employee_ids=excluded.employee_ids,branch_ids=excluded.branch_ids,retention_days=excluded.retention_days,coaching_enabled=excluded.coaching_enabled returning * into c;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'recording_configured','sales_recording',a.tenant_id,to_jsonb(c));
 return to_jsonb(c);
end $$;
revoke all on function recorder_configure(boolean,uuid[],uuid[],integer,boolean) from public,anon,authenticated,service_role;
grant execute on function recorder_configure(boolean,uuid[],uuid[],integer,boolean) to authenticated;
