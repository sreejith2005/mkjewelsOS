-- Store Intelligence integration (owner request 2026-11-06): a recorded conversation can be linked
-- to a genuine CRM customer, the CRM shows a read-only "Store conversation" entry, CRM-confirmed
-- purchases are kept apart from what the AI heard, and suggested next actions become real JewelOS
-- Tasks (or an explicitly chosen manual FMS run) without duplicates.
--
-- Boundaries kept:
-- * The CRM project stays the customer home. JewelOS stores only the chosen CRM identifiers, how
--   they were matched, a minimal display cache (code, name) with its source and expiry, and the
--   delivery state. Audio, transcripts and AI output never leave JewelOS.
-- * A link is "pending" until the CRM acknowledges it through the existing server-to-server
--   transport (crm-customer-sync -> CRM sync-receive). Nothing claims "synced" without that ack.
-- * Purchases come only from the CRM's walkin_purchase_evidence rule (docs/REPORTS.md), read back
--   by the transport; one CRM purchase visit is credited to at most one conversation.
-- * Follow-ups go through create_manual_task_with_mode_with_audit (existing assignment rules and
--   notifications) or start_fms_manual_with_audit (manual-start flows only, audited, idempotent).
--   One follow-up per suggested action per conversation, across retries and rescores.
-- Docs: docs/superpowers/specs/2026-11-06-store-intelligence-integration-design.md
set search_path=public,extensions;

-- ---------------------------------------------------------------------------------------------
-- 1. Settings: attribution window and the optional estimated ticket (off by default).
-- ---------------------------------------------------------------------------------------------
alter table recorder_config
 add column crm_attribution_days integer not null default 30 check(crm_attribution_days between 1 and 90),
 add column estimated_ticket_inr numeric(12,2) check(estimated_ticket_inr is null or estimated_ticket_inr between 1 and 100000000);

-- ---------------------------------------------------------------------------------------------
-- 2. Customer links: append-only, one live link per conversation.
-- ---------------------------------------------------------------------------------------------
create table recording_customer_links (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),
 session_id uuid not null references recorder_sessions(id),
 target_kind text not null check(target_kind in ('client','lead','visit','walkin')),target_id uuid not null,
 match_basis text not null check(match_basis in ('client_code','visit_reference','phone','walkin')),
 candidate_count integer not null check(candidate_count between 1 and 20),
 display_code text check(length(display_code)<=40),display_name text check(length(display_name)<=160),
 display_source text not null check(display_source in ('crm_search','walkin_task','crm_ack')),
 display_cached_at timestamptz not null default now(),display_expires_at timestamptz not null,
 crm_client_id uuid,state text not null default 'pending' check(state in ('pending','verified','rejected')),
 state_reason text check(state_reason ~ '^[a-z_]{1,64}$'),verified_at timestamptz,
 linked_by uuid not null references user_profiles(id),linked_at timestamptz not null default now(),
 replaces_link_id uuid references recording_customer_links(id),link_reason text check(length(link_reason)<=500),
 ended_at timestamptz,ended_by uuid references user_profiles(id),end_kind text check(end_kind in ('unlinked','corrected')),
 end_reason text check(length(end_reason)<=500),request_key uuid not null,
 unique(tenant_id,linked_by,request_key),
 check((ended_at is null)=(end_kind is null))
);
create unique index recording_customer_link_live on recording_customer_links(session_id) where ended_at is null;
create index recording_customer_links_session on recording_customer_links(session_id,linked_at desc);

-- ---------------------------------------------------------------------------------------------
-- 3. Outbox to the CRM (same pattern as crm_sync.customer_events; own table so roster, master and
--    customer-form delivery are untouched).
-- ---------------------------------------------------------------------------------------------
create table crm_sync.recording_events (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 session_id uuid not null references public.recorder_sessions(id),link_id uuid not null references public.recording_customer_links(id),
 event_type text not null check(event_type in ('store_conversation.linked','store_conversation.unlinked')),
 payload jsonb not null check(jsonb_typeof(payload)='object'),payload_digest text not null,
 created_at timestamptz not null default clock_timestamp(),attempts integer not null default 0 check(attempts>=0),
 next_attempt_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz,
 delivered_at timestamptz,held_at timestamptz,rejected_at timestamptz,dead_at timestamptz,
 last_error text check(length(last_error)<=80),result jsonb,unique(link_id,event_type)
);
create index recording_events_due on crm_sync.recording_events(next_attempt_at,created_at,id) where delivered_at is null and rejected_at is null and dead_at is null;
create index recording_events_session on crm_sync.recording_events(session_id,created_at);

-- Latest CRM purchase evidence per link (a cache with its check time; the CRM stays the source).
create table recording_crm_outcomes (
 link_id uuid primary key references recording_customer_links(id),tenant_id uuid not null references tenants(id),
 session_id uuid not null references recorder_sessions(id),
 state text not null check(state in ('purchase_verified','no_purchase_recorded','no_client','not_linked')),
 crm_client_id uuid,purchase_visit_id uuid,purchase_visit_at timestamptz,purchase_outcome text check(purchase_outcome ~ '^[A-Z_]{1,60}$'),
 visits integer not null default 0 check(visits>=0),window_from timestamptz not null,window_until timestamptz not null,
 checked_at timestamptz not null,check_count integer not null default 1,next_check_at timestamptz not null,
 check((state='purchase_verified')=(purchase_visit_id is not null))
);
create index recording_crm_outcomes_visit on recording_crm_outcomes(purchase_visit_id) where purchase_visit_id is not null;
create index recording_crm_outcomes_due on recording_crm_outcomes(next_check_at);

-- ---------------------------------------------------------------------------------------------
-- 4. Follow-ups made from suggested next actions.
-- ---------------------------------------------------------------------------------------------
create table recording_follow_ups (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),
 session_id uuid not null references recorder_sessions(id),analysis_id uuid not null references recording_analyses(id),
 action_index integer not null check(action_index between 0 and 49),action_key text not null check(action_key ~ '^[0-9a-f]{32}$'),
 source_text text not null check(length(source_text) between 1 and 1000),
 title text not null check(length(title) between 1 and 200),note text check(length(note)<=1000),
 channel text not null check(channel in ('call','whatsapp','visit','other')),
 owner_id uuid not null references user_profiles(id),supervisor_id uuid references user_profiles(id),
 due_at timestamptz not null,due_half text check(due_half in ('first_half','second_half')),
 task_id uuid references task_instances(id),fms_instance_id uuid references fms_instances(id),fms_reference text,
 customer_link_id uuid references recording_customer_links(id),
 created_by uuid not null references user_profiles(id),created_at timestamptz not null default now(),request_key uuid not null,
 unique(session_id,action_key),unique(tenant_id,created_by,request_key),
 check((task_id is null)<>(fms_instance_id is null))
);
create index recording_follow_ups_task on recording_follow_ups(task_id) where task_id is not null;
create index recording_follow_ups_tenant_created on recording_follow_ups(tenant_id,created_at);

do $$ declare t text; begin foreach t in array array['recording_customer_links','recording_crm_outcomes','recording_follow_ups'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 execute format('create policy module_accessible on %I as restrictive for select to authenticated using (public.module_accessible(''sales_recording'',false))',t);
end loop; end $$;
alter table crm_sync.recording_events enable row level security;
revoke all on crm_sync.recording_events from public,anon,authenticated,service_role;

-- Identity columns never change; a link only gains its CRM verdict/acknowledged display, then ends once.
create function recording_link_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='DELETE' then raise exception 'recording_evidence_immutable' using errcode='23514'; end if;
 if (new.id,new.tenant_id,new.session_id,new.target_kind,new.target_id,new.match_basis,new.candidate_count,new.linked_by,new.linked_at,new.replaces_link_id,new.link_reason,new.request_key)
   is distinct from (old.id,old.tenant_id,old.session_id,old.target_kind,old.target_id,old.match_basis,old.candidate_count,old.linked_by,old.linked_at,old.replaces_link_id,old.link_reason,old.request_key)
  or (old.ended_at is not null and (new.ended_at,new.ended_by,new.end_kind,new.end_reason) is distinct from (old.ended_at,old.ended_by,old.end_kind,old.end_reason)) then
  raise exception 'recording_evidence_immutable' using errcode='23514'; end if;
 return new;
end $$;
create trigger recording_customer_link_guard before update or delete on recording_customer_links for each row execute function recording_link_guard();
create function crm_sync.recording_event_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or (new.id,new.tenant_id,new.session_id,new.link_id,new.event_type,new.payload,new.payload_digest,new.created_at)
   is distinct from (old.id,old.tenant_id,old.session_id,old.link_id,old.event_type,old.payload,old.payload_digest,old.created_at) then
  raise exception 'recording_evidence_immutable' using errcode='23514'; end if;
 return new;
end $$;
create trigger recording_event_guard before update or delete on crm_sync.recording_events for each row execute function crm_sync.recording_event_guard();
create function recording_follow_up_guard() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'recording_evidence_immutable' using errcode='23514'; end $$;
create trigger recording_follow_up_guard before update or delete on recording_follow_ups for each row execute function recording_follow_up_guard();

-- ---------------------------------------------------------------------------------------------
-- 5. Shared helpers (internal).
-- ---------------------------------------------------------------------------------------------
-- One key per suggested action text, stable across rescores (mirrored by followUpActionKey in core).
create function recording_action_key(p text) returns text language sql immutable parallel safe set search_path=pg_catalog as $$
 select md5(lower(regexp_replace(btrim(coalesce(p,'')),'\s+',' ','g')))
$$;

-- An existing follow-up for this conversation and action text, from either generation of the feature.
create function recording_existing_follow_up(p_session uuid,p_key text) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(
  (select jsonb_build_object('follow_up_id',f.id,'task_id',f.task_id,'fms_instance_id',f.fms_instance_id,'fms_reference',f.fms_reference,'already_created',true)
    from recording_follow_ups f where f.session_id=p_session and f.action_key=p_key),
  (select jsonb_build_object('follow_up_id',null,'task_id',t.task_id,'fms_instance_id',null,'fms_reference',null,'already_created',true)
    from recording_action_tasks t join recording_analyses x on x.id=t.analysis_id
    where t.session_id=p_session and recording_action_key(x.output->'next_best_actions'->t.action_index->>'action')=p_key
    order by t.created_at limit 1))
$$;

create function recording_live_link(p_session uuid) returns recording_customer_links language sql stable security definer set search_path=public as $$
 select * from recording_customer_links where session_id=p_session and ended_at is null
$$;

-- Delivery status of a link's CRM entry, in words the screen can show truthfully.
create function recording_link_sync_state(p_link uuid) returns text language sql stable security definer set search_path=public as $$
 select case when e.id is null then 'not_queued'
  when e.delivered_at is not null then 'synced' when e.rejected_at is not null then 'refused' when e.dead_at is not null then 'failed'
  when e.held_at is not null then 'waiting_for_crm_approval' when e.attempts>0 and e.last_error is not null then 'retrying' else 'queued' end
 from (select 1) one left join crm_sync.recording_events e on e.link_id=p_link and e.event_type='store_conversation.linked'
$$;

-- The CRM window for a conversation: from the start of its India day for the configured days.
create function recording_outcome_window(s recorder_sessions) returns tstzrange language sql stable security definer set search_path=public as $$
 select tstzrange(((s.created_at at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata',
  (((s.created_at at time zone 'Asia/Kolkata')::date)+coalesce((select c.crm_attribution_days from recorder_config c where c.tenant_id=s.tenant_id),30))::timestamp at time zone 'Asia/Kolkata','[)')
$$;

-- A verified purchase visit is credited to the latest live, verified conversation of the same
-- tenant that started on or before it (and whose window contains it). Repeat conversations about
-- the same purchase therefore never count it twice.
create function recording_purchase_credited(p_link uuid) returns boolean language sql stable security definer set search_path=public as $$
 select o.state='purchase_verified' and o.link_id=(
  select o2.link_id from recording_crm_outcomes o2 join recording_customer_links l2 on l2.id=o2.link_id and l2.ended_at is null and l2.state='verified'
   join recorder_sessions s2 on s2.id=o2.session_id
  where o2.tenant_id=o.tenant_id and o2.purchase_visit_id=o.purchase_visit_id and s2.created_at<=o.purchase_visit_at+interval '12 hours'
  order by s2.created_at desc,s2.id desc limit 1)
 from recording_crm_outcomes o where o.link_id=p_link
$$;

-- What the CRM says about this conversation, kept apart from the AI's reading.
create function recording_crm_result(s recorder_sessions) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare l recording_customer_links:=recording_live_link(s.id); o recording_crm_outcomes; w tstzrange:=recording_outcome_window(s); begin
 if l.id is null then return jsonb_build_object('state','pending_crm_confirmation','reason','not_linked'); end if;
 if l.state<>'verified' then return jsonb_build_object('state','pending_crm_confirmation','reason','link_'||l.state); end if;
 select * into o from recording_crm_outcomes where link_id=l.id;
 if o.link_id is null then return jsonb_build_object('state','pending_crm_confirmation','reason','not_checked_yet','window_until',upper(w)); end if;
 if o.state='purchase_verified' then
  return jsonb_build_object('state',case when recording_purchase_credited(l.id) then 'crm_confirmed_purchase' else 'purchase_credited_elsewhere' end,
   'purchase_visit_at',o.purchase_visit_at,'purchase_outcome',o.purchase_outcome,'checked_at',o.checked_at,'window_until',o.window_until);
 end if;
 return jsonb_build_object('state',case when o.state in ('no_client','not_linked') then 'pending_crm_confirmation' when now()>=o.window_until then 'no_crm_purchase_in_window' else 'no_crm_purchase_yet' end,
  'reason',o.state,'visits',o.visits,'checked_at',o.checked_at,'window_until',o.window_until);
end $$;

-- Queue one CRM event inside the caller's transaction.
create function recording_enqueue_crm_event(l recording_customer_links,p_type text,p_reason text) returns void language plpgsql security definer set search_path=public,extensions as $$
declare s recorder_sessions; p jsonb; begin
 select * into s from recorder_sessions where id=l.session_id;
 p:=jsonb_strip_nulls(jsonb_build_object('schemaVersion',1,'sourceProject','jewelos','eventId','jewelos.store_conversation.'||l.id||'.'||split_part(p_type,'.',2),
  'eventType',p_type,'tenantId',s.tenant_id,'branchId',s.branch_id,'actorId',coalesce(l.ended_by,l.linked_by),'linkId',l.id,'sessionId',s.id,
  'occurredAt',s.created_at,'durationSeconds',least(recording_session_duration_ms(s.id)/1000,86400),
  'salespersonName',(select left(u.employee_name,160) from user_profiles u where u.id=s.employee_id),
  'target',case when p_type='store_conversation.linked' then jsonb_build_object('kind',l.target_kind,'id',l.target_id) end,
  'reason',case when p_type='store_conversation.unlinked' then left(p_reason,200) end));
 insert into crm_sync.recording_events(tenant_id,session_id,link_id,event_type,payload,payload_digest)
 values(s.tenant_id,s.id,l.id,p_type,p,encode(digest(p::text,'sha256'),'hex')) on conflict(link_id,event_type) do nothing;
end $$;

-- The person allowed to change a conversation's customer: the recorded salesperson or a branch reviewer, with CRM access.
create function recording_link_actor(p_session uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); s recorder_sessions; begin
 select * into s from recorder_sessions where id=p_session;
 if s.id is null or not recorder_can_read(s.employee_id,s.tenant_id,s.branch_id) or not has_permission('crm.view') or not (s.employee_id=a.id or recording_is_reviewer(s)) then
  raise exception 'recording_link_denied' using errcode='42501'; end if;
 return jsonb_build_object('actor',a.id,'tenant',a.tenant_id);
end $$;

-- Insert a live link (and its CRM event). Caller holds the session lock and has authorized.
create function recording_insert_link(s recorder_sessions,p_actor uuid,p_kind text,p_target uuid,p_basis text,p_candidates integer,p_code text,p_name text,
 p_source text,p_request uuid,p_replaces uuid,p_reason text) returns recording_customer_links language plpgsql security definer set search_path=public as $$
declare l recording_customer_links; begin
 insert into recording_customer_links(tenant_id,session_id,target_kind,target_id,match_basis,candidate_count,display_code,display_name,display_source,
  display_expires_at,linked_by,replaces_link_id,link_reason,request_key)
 values(s.tenant_id,s.id,p_kind,p_target,p_basis,p_candidates,nullif(btrim(left(p_code,40)),''),nullif(btrim(left(p_name,160)),''),p_source,
  now()+interval '7 days',p_actor,p_replaces,nullif(btrim(p_reason),''),p_request) returning * into l;
 perform recording_enqueue_crm_event(l,'store_conversation.linked',null);
 return l;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Browser contracts: link, correct, unlink, retry.
-- ---------------------------------------------------------------------------------------------
-- p_target: {kind, target_id, match_basis, candidate_count, display_code, display_name} exactly as
-- the person chose it from crm_store_conversation_candidates. The display fields are shown as
-- "unconfirmed" until the CRM's acknowledgement replaces them.
create function recording_link_crm_customer(p_session_id uuid,p_target jsonb,p_request_key uuid,p_reason text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare who jsonb:=recording_link_actor(p_session_id); actor uuid:=(who->>'actor')::uuid; s recorder_sessions; live recording_customer_links; l recording_customer_links;
 kind text; target uuid; basis text; n integer; begin
 if p_request_key is null or jsonb_typeof(p_target) is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_target) k where k not in ('kind','target_id','match_basis','candidate_count','display_code','display_name')) then
  raise exception 'recording_invalid_link' using errcode='22023'; end if;
 begin
  kind:=p_target->>'kind'; target:=(p_target->>'target_id')::uuid; basis:=p_target->>'match_basis'; n:=(p_target->>'candidate_count')::integer;
 exception when others then raise exception 'recording_invalid_link' using errcode='22023'; end;
 if kind not in ('client','lead','visit') or target is null or basis not in ('client_code','visit_reference','phone') or n is null or n not between 1 and 20
  or length(coalesce(p_target->>'display_code',''))>40 or length(coalesce(p_target->>'display_name',''))>160 or length(coalesce(p_reason,''))>500
  or (basis='visit_reference')<>(kind='visit') then raise exception 'recording_invalid_link' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('recording.link.'||p_session_id,13));
 select * into s from recorder_sessions where id=p_session_id;
 select * into l from recording_customer_links where tenant_id=s.tenant_id and linked_by=actor and request_key=p_request_key;
 if l.id is not null then
  if l.session_id<>s.id or l.target_id<>target then raise exception 'recording_request_reused' using errcode='23514'; end if;
  return jsonb_build_object('link_id',l.id,'already_linked',true);
 end if;
 live:=recording_live_link(s.id);
 if live.id is not null and live.target_id=target and live.target_kind=kind then return jsonb_build_object('link_id',live.id,'already_linked',true); end if;
 if live.id is not null then
  -- Changing the customer is a correction: it needs a reason and withdraws the old CRM entry.
  if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'recording_reason_required' using errcode='22023'; end if;
  update recording_customer_links set ended_at=now(),ended_by=actor,end_kind='corrected',end_reason=btrim(p_reason) where id=live.id returning * into live;
  perform recording_enqueue_crm_event(live,'store_conversation.unlinked',btrim(p_reason));
 end if;
 l:=recording_insert_link(s,actor,kind,target,basis,n,p_target->>'display_code',p_target->>'display_name','crm_search',p_request_key,live.id,case when live.id is not null then p_reason end);
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
 values(s.tenant_id,actor,case when live.id is null then 'recording_customer_linked' else 'recording_customer_link_corrected' end,'sales_recording',s.id,
  jsonb_build_object('link_id',l.id,'kind',kind,'target_id',target,'match_basis',basis,'candidate_count',n,'replaces_link_id',live.id));
 return jsonb_build_object('link_id',l.id,'already_linked',false);
end $$;

create function recording_unlink_crm_customer(p_session_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare who jsonb:=recording_link_actor(p_session_id); actor uuid:=(who->>'actor')::uuid; s recorder_sessions; live recording_customer_links; begin
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'recording_reason_required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('recording.link.'||p_session_id,13));
 select * into s from recorder_sessions where id=p_session_id;
 live:=recording_live_link(s.id);
 if live.id is null then return jsonb_build_object('unlinked',false); end if;
 update recording_customer_links set ended_at=now(),ended_by=actor,end_kind='unlinked',end_reason=btrim(p_reason) where id=live.id returning * into live;
 perform recording_enqueue_crm_event(live,'store_conversation.unlinked',btrim(p_reason));
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
 values(s.tenant_id,actor,'recording_customer_unlinked','sales_recording',s.id,jsonb_build_object('link_id',live.id,'reason',btrim(p_reason)));
 return jsonb_build_object('unlinked',true,'link_id',live.id);
end $$;

-- Send a held or failed CRM entry again (same event, same payload: the CRM deduplicates).
create function recording_retry_crm_sync(p_session_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare who jsonb:=recording_link_actor(p_session_id); n integer; begin
 update crm_sync.recording_events set dead_at=null,held_at=null,attempts=0,next_attempt_at=now(),last_error=null
  where session_id=p_session_id and delivered_at is null and rejected_at is null and (lease_until is null or lease_until<now());
 get diagnostics n=row_count;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
 values((who->>'tenant')::uuid,(who->>'actor')::uuid,'recording_crm_sync_retried','sales_recording',p_session_id,jsonb_build_object('events',n));
 return jsonb_build_object('requeued',n);
end $$;

-- The older walk-in picker (Start conversation -> Customer (optional)) now creates the same
-- verified link, so the CRM entry and outcome checks follow. Its own checks are unchanged.
do $$ declare d text; marker text:='update recorder_sessions set customer_ref=p_customer_ref,updated_at=now() where id=s.id returning * into s;'; begin
 d:=pg_get_functiondef('recorder_link_customer(uuid,text)'::regprocedure);
 if position(marker in d)=0 then raise exception 'Review recorder_link_customer before linking walk-ins to the CRM'; end if;
 d:=replace(d,marker,marker||$add$
 perform pg_advisory_xact_lock(hashtextextended('recording.link.'||s.id,13));
 if (recording_live_link(s.id)).id is null then
  perform recording_insert_link(s,a.id,'walkin',q,'walkin',1,null,(select t.title from crm_sync.walkin_state w join task_instances t on t.id=w.task_id where w.queue_id=q),
   'walkin_task',gen_random_uuid(),null,null);
 end if;$add$);
 execute d;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Transport contracts (service role, called by crm-customer-sync).
-- ---------------------------------------------------------------------------------------------
-- Oldest first; a conversation's later event waits for its earlier one (unlink before re-link).
create function crm_sync_claim_recording_events(p_limit integer default 10)
returns table(id uuid,lease_token uuid,payload jsonb) language plpgsql security definer set search_path=public as $$
begin
 return query with due as (
  select e.id from crm_sync.recording_events e
  where e.delivered_at is null and e.rejected_at is null and e.dead_at is null and e.next_attempt_at<=now() and (e.lease_until is null or e.lease_until<now())
   and not exists(select 1 from crm_sync.recording_events p where p.session_id=e.session_id and p.created_at<e.created_at and p.delivered_at is null and p.rejected_at is null and p.dead_at is null)
  order by e.next_attempt_at,e.created_at,e.id for update skip locked limit greatest(1,least(coalesce(p_limit,10),10))),
 claimed as (update crm_sync.recording_events e set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=e.attempts+1 from due where e.id=due.id returning e.*)
 select c.id,c.lease_token,c.payload from claimed c order by c.created_at;
end $$;

create function crm_sync_finish_recording_event(p_id uuid,p_lease uuid,p_result jsonb,p_error text default null) returns text
language plpgsql security definer set search_path=public as $$
declare e crm_sync.recording_events; outcome text:=p_result->>'outcome'; reason text; client uuid; begin
 select * into e from crm_sync.recording_events where id=p_id for update;
 if e.id is null or e.lease_token is distinct from p_lease or e.lease_until<now() then raise exception 'Delivery lease changed' using errcode='40001'; end if;
 if p_error is null and outcome='accepted' then
  if e.event_type='store_conversation.linked' then
   begin client:=nullif(p_result->>'client_id','')::uuid; exception when others then client:=null; end;
   if client is null and nullif(p_result->>'lead_id','') is null then p_error:='invalid_ack';
   else
    update recording_customer_links set state='verified',state_reason=null,verified_at=now(),crm_client_id=client,display_source='crm_ack',
     display_code=coalesce(nullif(left(p_result->>'client_code',40),''),display_code),display_name=coalesce(nullif(left(p_result->>'display_name',160),''),display_name),
     display_cached_at=now(),display_expires_at=now()+interval '30 days' where id=e.link_id;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
    values(e.tenant_id,null,'recording_customer_link_verified','sales_recording',e.session_id,jsonb_build_object('link_id',e.link_id,'crm_client_id',client));
   end if;
  end if;
  if p_error is null then
   update crm_sync.recording_events set delivered_at=clock_timestamp(),held_at=null,result=p_result,lease_token=null,lease_until=null,last_error=null where id=p_id;
   return 'delivered';
  end if;
 elsif p_error is null and outcome='rejected' then
  reason:=case when coalesce(p_result->>'reason','') ~ '^[a-z_]{1,64}$' then p_result->>'reason' else 'crm_refused' end;
  update crm_sync.recording_events set rejected_at=clock_timestamp(),result=p_result,lease_token=null,lease_until=null,last_error=reason where id=p_id;
  if e.event_type='store_conversation.linked' then update recording_customer_links set state='rejected',state_reason=reason where id=e.link_id; end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(e.tenant_id,null,'recording_customer_link_refused','sales_recording',e.session_id,jsonb_build_object('link_id',e.link_id,'reason',reason,'event',e.event_type));
  return 'rejected';
 elsif p_error is null and outcome='source_unapproved' then
  -- Held until a CRM administrator approves this JewelOS tenant; checked hourly, never "dead".
  update crm_sync.recording_events set held_at=coalesce(held_at,clock_timestamp()),attempts=greatest(e.attempts-1,0),result=p_result,lease_token=null,lease_until=null,
   last_error='source_unapproved',next_attempt_at=now()+interval '1 hour' where id=p_id;
  return 'held';
 elsif p_error is null and outcome='retry' then
  p_error:='dependency_'||case when coalesce(p_result->>'reason','') ~ '^[a-z_]{1,60}$' then p_result->>'reason' else 'pending' end;
 end if;
 update crm_sync.recording_events set lease_token=null,lease_until=null,last_error=left(coalesce(p_error,'invalid_result'),80),
  next_attempt_at=now()+make_interval(secs=>least(3600,15*power(2,least(e.attempts,8)))::integer),dead_at=case when e.attempts>=10 then clock_timestamp() end where id=p_id;
 return case when e.attempts>=10 then 'dead' else 'retry' end;
end $$;

-- Links whose purchase evidence should be (re)read: verified, live, delivered, window still open
-- (plus one day so a late-entered visit is seen). Re-read every 6 hours; never more than 50.
create function crm_sync_claim_recording_outcome_checks(p_limit integer default 50)
returns table(link_id uuid,tenant_id uuid,since timestamptz,until timestamptz) language plpgsql security definer set search_path=public as $$
begin
 return query select l.id,l.tenant_id,lower(recording_outcome_window(s)),upper(recording_outcome_window(s))
  from recording_customer_links l join recorder_sessions s on s.id=l.session_id
  left join recording_crm_outcomes o on o.link_id=l.id
  where l.ended_at is null and l.state='verified' and now()<upper(recording_outcome_window(s))+interval '1 day'
   and (o.link_id is null or o.next_check_at<=now())
  order by coalesce(o.checked_at,'-infinity'::timestamptz),l.linked_at limit greatest(1,least(coalesce(p_limit,50),50));
end $$;

create function crm_sync_record_recording_outcomes(p_tenant uuid,p_results jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare r jsonb; l recording_customer_links; s recorder_sessions; w tstzrange; n integer:=0; st text; begin
 if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)>50 then raise exception 'Invalid outcome results' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(p_results) loop
  begin select * into l from recording_customer_links where id=(r->>'linkId')::uuid and tenant_id=p_tenant; exception when others then continue; end;
  st:=r->>'state';
  if l.id is null or st not in ('purchase_verified','no_purchase_recorded','no_client','not_linked') then continue; end if;
  select * into s from recorder_sessions where id=l.session_id; w:=recording_outcome_window(s);
  begin
   insert into recording_crm_outcomes(link_id,tenant_id,session_id,state,crm_client_id,purchase_visit_id,purchase_visit_at,purchase_outcome,visits,window_from,window_until,checked_at,next_check_at)
   values(l.id,l.tenant_id,l.session_id,st,nullif(r->>'clientId','')::uuid,case when st='purchase_verified' then (r->>'purchaseVisitId')::uuid end,
    case when st='purchase_verified' then (r->>'purchaseVisitAt')::timestamptz end,case when st='purchase_verified' then nullif(r->>'purchaseOutcome','') end,
    coalesce((r->>'visits')::integer,0),lower(w),upper(w),now(),now()+interval '6 hours')
   on conflict(link_id) do update set state=excluded.state,crm_client_id=excluded.crm_client_id,purchase_visit_id=excluded.purchase_visit_id,
    purchase_visit_at=excluded.purchase_visit_at,purchase_outcome=excluded.purchase_outcome,visits=excluded.visits,window_from=excluded.window_from,
    window_until=excluded.window_until,checked_at=excluded.checked_at,check_count=recording_crm_outcomes.check_count+1,next_check_at=excluded.next_check_at;
   n:=n+1;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or check_violation or numeric_value_out_of_range then continue; end;
 end loop;
 return n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. Follow-ups: review first, then one Task (or one manual FMS run) per suggested action.
-- p_input: {analysis_id, action_index, request_key, title?, note?, channel, owner_id?, supervisor_id?,
--           due_date? (YYYY-MM-DD), due_half? ('first_half'|'second_half'), due_at? (exact, legacy), fms_flow_id?}
-- ---------------------------------------------------------------------------------------------
create function recording_create_follow_up(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); i jsonb:=coalesce(p_input,'{}'::jsonb); an recording_analyses; s recorder_sessions; reviewer boolean; act jsonb;
 idx integer; req uuid; key text; existing jsonb; f recording_follow_ups; v_owner user_profiles; sup user_profiles; emp user_profiles; due timestamptz; half text; d date;
 v_title text; v_note text; v_channel text; flow fms_flows; task uuid; inst uuid; ref text; link recording_customer_links; descr text; begin
 if jsonb_typeof(i)<>'object' or exists(select 1 from jsonb_object_keys(i) k where k not in ('analysis_id','action_index','request_key','title','note','channel','owner_id','supervisor_id','due_date','due_half','due_at','fms_flow_id')) then
  raise exception 'recording_invalid_follow_up' using errcode='22023'; end if;
 begin
  select * into an from recording_analyses where id=(i->>'analysis_id')::uuid; idx:=(i->>'action_index')::integer; req:=(i->>'request_key')::uuid;
  d:=(i->>'due_date')::date; half:=i->>'due_half';
 exception when others then raise exception 'recording_invalid_follow_up' using errcode='22023'; end;
 if an.id is null then raise exception 'recording_action_denied' using errcode='42501'; end if;
 select * into s from recorder_sessions where id=an.session_id;
 if s.id is null or not recorder_can_read(s.employee_id,s.tenant_id,s.branch_id) then raise exception 'recording_action_denied' using errcode='42501'; end if;
 reviewer:=recording_is_reviewer(s);
 -- Same release rule as 0383: the salesperson acts only on a review their manager released.
 if not reviewer and (s.employee_id<>a.id or coalesce(recording_review_state(an.id),'') not in ('approve','edit')) then raise exception 'recording_action_denied' using errcode='42501'; end if;
 if s.expires_at<=now() then raise exception 'recording_retention_expired' using errcode='22023'; end if;
 if req is null then raise exception 'recording_invalid_follow_up' using errcode='22023'; end if;
 if idx is null or jsonb_typeof(an.output->'next_best_actions') is distinct from 'array' or idx<0 or idx>=jsonb_array_length(an.output->'next_best_actions')
  or nullif(btrim(an.output->'next_best_actions'->idx->>'action'),'') is null then raise exception 'recording_action_not_found' using errcode='22023'; end if;
 act:=an.output->'next_best_actions'->idx; key:=recording_action_key(act->>'action');
 -- The same lock as the 0383 path, so a double tap, a retry and a rescore cannot race.
 perform pg_advisory_xact_lock(hashtextextended(s.id::text||':'||key,12));
 select * into f from recording_follow_ups where tenant_id=a.tenant_id and created_by=a.id and request_key=req;
 if f.id is not null then
  if f.session_id<>s.id or f.action_key<>key then raise exception 'recording_request_reused' using errcode='23514'; end if;
  return jsonb_build_object('follow_up_id',f.id,'task_id',f.task_id,'fms_instance_id',f.fms_instance_id,'fms_reference',f.fms_reference,'already_created',true);
 end if;
 existing:=recording_existing_follow_up(s.id,key);
 if existing is not null then return existing; end if;

 v_channel:=coalesce(i->>'channel','other');
 v_title:=btrim(coalesce(nullif(btrim(i->>'title'),''),'Follow up: '||btrim(act->>'action')));
 v_note:=nullif(btrim(i->>'note'),'');
 if v_channel not in ('call','whatsapp','visit','other') or length(v_title)>200 or length(coalesce(v_note,''))>1000 then raise exception 'recording_invalid_follow_up' using errcode='22023'; end if;
 -- Owner: the salesperson by default; yourself; or, for a branch reviewer, any active colleague
 -- the task contract lets them assign to.
 begin select * into v_owner from user_profiles where id=coalesce((i->>'owner_id')::uuid,s.employee_id); exception when others then raise exception 'recording_invalid_follow_up' using errcode='22023'; end;
 if v_owner.id is null or v_owner.tenant_id<>s.tenant_id or v_owner.account_status<>'active' or v_owner.working_status<>'active' then raise exception 'recording_owner_denied' using errcode='42501'; end if;
 if v_owner.id not in (s.employee_id,a.id) and not reviewer then raise exception 'recording_owner_denied' using errcode='42501'; end if;
 if i ? 'supervisor_id' and nullif(i->>'supervisor_id','') is not null then
  begin select * into sup from user_profiles where id=(i->>'supervisor_id')::uuid; exception when others then raise exception 'recording_invalid_follow_up' using errcode='22023'; end;
  if sup.id is null or sup.tenant_id<>s.tenant_id or sup.branch_id<>s.branch_id or sup.account_status<>'active' or sup.working_status<>'active'
   or sup.user_role not in ('super_admin','admin','manager') or sup.id in (v_owner.id,a.id) then raise exception 'recording_supervisor_denied' using errcode='42501'; end if;
 end if;
 -- Due: the first-half / second-half deadline of a chosen India day (migration 0371), or the next
 -- half-day deadline when none is chosen. An exact time is accepted only from the older button.
 if d is not null then
  if half not in ('first_half','second_half') then raise exception 'recording_invalid_due' using errcode='22023'; end if;
  due:=(d+case when half='first_half' then time '15:00' else time '21:00' end) at time zone 'Asia/Kolkata';
 elsif nullif(i->>'due_at','') is not null then
  begin due:=(i->>'due_at')::timestamptz; exception when others then raise exception 'recording_invalid_due' using errcode='22023'; end; half:=null;
 else
  due:=day_half_deadline(now()); half:=case when (due at time zone 'Asia/Kolkata')::time=time '15:00' then 'first_half' else 'second_half' end;
 end if;
 if due<now()-interval '1 day' or due>now()+interval '90 days' then raise exception 'recording_invalid_due' using errcode='22023'; end if;

 select * into emp from user_profiles where id=s.employee_id;
 link:=recording_live_link(s.id);
 descr:=left(concat_ws(E'\n',
  case v_channel when 'call' then 'Recommended follow-up: phone call.' when 'whatsapp' then 'Recommended follow-up: WhatsApp message (nothing is sent automatically).'
   when 'visit' then 'Recommended follow-up: invite for a store visit.' else null end,
  v_note,nullif(btrim(act->>'reason'),''),
  'Source: Store Intelligence conversation '||left(s.id::text,8)||' recorded '||to_char(s.created_at at time zone 'Asia/Kolkata','DD Mon YYYY, HH12:MI AM')||'.',
  'Evidence: /sales-recording/conversations/'||s.id||'?tab=actions',
  case when link.id is not null then 'CRM customer: '||coalesce(link.display_code||' ','')||coalesce(link.display_name,'')||case when link.state='verified' then '' else ' (not yet confirmed by the CRM)' end end),2000);

 if nullif(i->>'fms_flow_id','') is not null then
  -- Only when the person picked a flow, and only flows started by hand: a triggered flow keeps its
  -- real trigger conditions. The audited start contract applies its own scope checks.
  begin select * into flow from fms_flows where id=(i->>'fms_flow_id')::uuid and tenant_id=s.tenant_id; exception when others then raise exception 'recording_invalid_follow_up' using errcode='22023'; end;
  if flow.id is null or flow.start_mode<>'manual' or flow.status::text<>'published' or not coalesce(flow.is_active,true) then raise exception 'recording_flow_not_startable' using errcode='23514'; end if;
  select x.instance_id,x.reference_number into inst,ref from start_fms_manual_with_audit(flow.id,v_title,left(descr,1000),
   case when link.state='verified' then link.display_code end,s.branch_id,emp.department_id,v_owner.id,
   (md5('recording-follow-up:'||s.id||':'||key))::uuid) x;
 else
  task:=create_manual_task_with_mode_with_audit(
   jsonb_build_object('task_type','checklist','title',v_title,'description',descr,'planned_datetime',due,'priority','medium','branch_id',s.branch_id,'department_id',emp.department_id,
    'category_id',(select id from dropdown_masters where tenant_id=s.tenant_id and master_type='task_category' and is_active order by sort_order,label limit 1)),
   array[v_owner.id],case when sup.id is null then '{}'::uuid[] else array[sup.id] end,jsonb_build_array(jsonb_build_object('item_text',left(btrim(act->>'action'),500))));
 end if;
 insert into recording_follow_ups(tenant_id,session_id,analysis_id,action_index,action_key,source_text,title,note,channel,owner_id,supervisor_id,due_at,due_half,
  task_id,fms_instance_id,fms_reference,customer_link_id,created_by,request_key)
 values(s.tenant_id,s.id,an.id,idx,key,left(btrim(act->>'action'),1000),v_title,v_note,v_channel,v_owner.id,sup.id,due,half,task,inst,ref,link.id,a.id,req) returning * into f;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
 values(s.tenant_id,a.id,'recording_follow_up_created','sales_recording',s.id,jsonb_build_object('follow_up_id',f.id,'analysis_id',an.id,'action_index',idx,
  'task_id',task,'fms_instance_id',inst,'owner_id',v_owner.id,'supervisor_id',sup.id,'channel',v_channel,'due_at',due,'customer_link_id',link.id));
 return jsonb_build_object('follow_up_id',f.id,'task_id',task,'fms_instance_id',inst,'fms_reference',ref,'already_created',false);
end $$;

-- The 0383 button keeps working and now shares the rescore-proof duplicate check.
do $$ declare d text; marker text:='if link.id is not null then return jsonb_build_object(''task_id'',link.task_id,''already_created'',true); end if;'; begin
 d:=pg_get_functiondef('recording_create_action_task(uuid,integer,timestamptz)'::regprocedure);
 if position(marker in d)=0 or position('act:=an.output->''next_best_actions''->p_action_index;' in d)=0 then raise exception 'Review recording_create_action_task before patching'; end if;
 d:=replace(d,marker,marker||$add$
 perform pg_advisory_xact_lock(hashtextextended(s.id::text||':'||recording_action_key(an.output->'next_best_actions'->p_action_index->>'action'),12));
 if recording_existing_follow_up(s.id,recording_action_key(an.output->'next_best_actions'->p_action_index->>'action')) is not null then
  return recording_existing_follow_up(s.id,recording_action_key(an.output->'next_best_actions'->p_action_index->>'action'));
 end if;$add$);
 execute d;
end $$;

-- Today's Next actions hide suggestions that already have a follow-up from any analysis version.
do $$ declare d text; marker text:='and not exists(select 1 from recording_action_tasks t where t.analysis_id=an.id and t.action_index=e.ordinality-1)'; begin
 d:=pg_get_functiondef('recording_today()'::regprocedure);
 if position(marker in d)=0 then raise exception 'Review recording_today before patching'; end if;
 d:=replace(d,marker,marker||' and recording_existing_follow_up(s.id,recording_action_key(e.value->>''action'')) is null');
 execute d;
end $$;

-- "Only linked" also finds conversations linked through the CRM search.
do $$ declare d text; marker text:='and (not linked or s.customer_ref is not null)'; begin
 d:=pg_get_functiondef('recording_conversations_page(jsonb,timestamptz,uuid,integer)'::regprocedure);
 if position(marker in d)=0 then raise exception 'Review recording_conversations_page before patching'; end if;
 d:=replace(d,marker,'and (not linked or s.customer_ref is not null or (recording_live_link(s.id)).id is not null)');
 execute d;
end $$;

-- Cards tell apart the AI's reading and the CRM's record.
do $$ declare d text; marker text:='''duration_ms'',recording_session_duration_ms(s.id),''customer_linked'',s.customer_ref is not null,'; begin
 d:=pg_get_functiondef('recording_session_card(recorder_sessions,boolean)'::regprocedure);
 if position(marker in d)=0 then raise exception 'Review recording_session_card before patching'; end if;
 d:=replace(d,marker,'''duration_ms'',recording_session_duration_ms(s.id),''customer_linked'',s.customer_ref is not null or (recording_live_link(s.id)).id is not null,'||
  '''customer'',(select jsonb_build_object(''state'',l.state,''name'',l.display_name,''code'',l.display_code,''sync'',recording_link_sync_state(l.id)) from recording_customer_links l where l.session_id=s.id and l.ended_at is null),'||
  '''crm_result'',recording_crm_result(s)->>''state'',');
 execute d;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 9. Reads for the conversation screen and managers.
-- ---------------------------------------------------------------------------------------------
-- Everything the Customer and Actions panels show, with per-integration readiness.
create function recording_session_integration(p_session_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); s recorder_sessions; reviewer boolean; live recording_customer_links; an recording_analyses; crm jsonb; ai text; begin
 select * into s from recorder_sessions where id=p_session_id;
 if s.id is null or not recorder_can_read(s.employee_id,s.tenant_id,s.branch_id) then raise exception 'recorder_session_denied' using errcode='42501'; end if;
 reviewer:=recording_is_reviewer(s); live:=recording_live_link(s.id); an:=recording_visible_analysis(s.id,reviewer);
 crm:=recording_crm_result(s); ai:=an.output#>>'{signals,sales_outcome,value}';
 return jsonb_build_object(
  'can_link',has_permission('crm.view') and (s.employee_id=a.id or reviewer),
  'can_create_follow_up',reviewer or (s.employee_id=a.id and coalesce(recording_review_state(an.id),'') in ('approve','edit')),
  'is_reviewer',reviewer,
  'customer',case when live.id is null then null else jsonb_build_object('link_id',live.id,'kind',live.target_kind,'target_id',live.target_id,'crm_client_id',live.crm_client_id,
   'code',live.display_code,'name',live.display_name,'display_source',live.display_source,'display_cached_at',live.display_cached_at,'display_stale',live.display_expires_at<=now(),
   'match_basis',live.match_basis,'candidate_count',live.candidate_count,'state',live.state,'state_reason',live.state_reason,'verified_at',live.verified_at,
   'linked_at',live.linked_at,'linked_by_name',(select employee_name from user_profiles where id=live.linked_by),'sync',recording_link_sync_state(live.id),
   'sync_error',(select e.last_error from crm_sync.recording_events e where e.link_id=live.id and e.event_type='store_conversation.linked'),
   'sync_attempts',(select e.attempts from crm_sync.recording_events e where e.link_id=live.id and e.event_type='store_conversation.linked')) end,
  'history',coalesce((select jsonb_agg(jsonb_build_object('link_id',l.id,'name',l.display_name,'code',l.display_code,'state',l.state,'linked_at',l.linked_at,
    'linked_by_name',(select employee_name from user_profiles where id=l.linked_by),'ended_at',l.ended_at,'end_kind',l.end_kind,'end_reason',l.end_reason,
    'ended_by_name',(select employee_name from user_profiles where id=l.ended_by),'link_reason',l.link_reason,
    'withdrawal_sync',(select case when e.delivered_at is not null then 'synced' when e.dead_at is not null then 'failed' else 'queued' end
      from crm_sync.recording_events e where e.link_id=l.id and e.event_type='store_conversation.unlinked')) order by l.linked_at desc)
   from recording_customer_links l where l.session_id=s.id and l.ended_at is not null),'[]'::jsonb),
  'outcome',jsonb_build_object('ai_suggested',coalesce(ai,'unknown'),'ai_label',case ai when 'reported_purchase' then 'converted' when 'no_purchase' then 'not_converted'
    when 'follow_up' then 'follow_up' else 'unknown' end,'crm',crm),
  'follow_ups',coalesce((select jsonb_agg(z order by z->>'created_at') from (
    select jsonb_build_object('follow_up_id',f.id,'action_key',f.action_key,'action_index',f.action_index,'analysis_id',f.analysis_id,'source_text',f.source_text,'title',f.title,'note',f.note,'channel',f.channel,
     'owner_id',f.owner_id,'owner_name',(select employee_name from user_profiles where id=f.owner_id),'supervisor_name',(select employee_name from user_profiles where id=f.supervisor_id),
     'due_at',coalesce(ti.revised_datetime,ti.planned_datetime,fs.planned_datetime,f.due_at),'due_half',f.due_half,'task_id',f.task_id,'fms_instance_id',f.fms_instance_id,'fms_reference',f.fms_reference,
     'fms_stage_id',fs.id,'status',coalesce(case when ti.deleted_at is not null then 'removed' else ti.status::text end,fi.status::text),
     'created_at',f.created_at,'created_by_name',(select employee_name from user_profiles where id=f.created_by),
     'customer',(select jsonb_build_object('name',l.display_name,'code',l.display_code,'state',l.state) from recording_customer_links l where l.id=f.customer_link_id),
     'notification',recording_follow_up_notification(f.task_id,fs.id)) z
    from recording_follow_ups f left join task_instances ti on ti.id=f.task_id left join fms_instances fi on fi.id=f.fms_instance_id
    left join lateral (select w.* from fms_instance_stages w where w.fms_instance_id=f.fms_instance_id order by w.created_at,w.id limit 1) fs on true
    where f.session_id=s.id
    union all
    select jsonb_build_object('follow_up_id',null,'action_key',recording_action_key(x.output->'next_best_actions'->t.action_index->>'action'),'action_index',t.action_index,'analysis_id',t.analysis_id,
     'source_text',x.output->'next_best_actions'->t.action_index->>'action','title',ti.title,'note',null,'channel','other','owner_id',(select ta.user_profile_id from task_assignees ta where ta.task_instance_id=ti.id and ta.is_active limit 1),
     'owner_name',(select u.employee_name from task_assignees ta join user_profiles u on u.id=ta.user_profile_id where ta.task_instance_id=ti.id and ta.is_active limit 1),'supervisor_name',null,
     'due_at',coalesce(ti.revised_datetime,ti.planned_datetime),'due_half',null,'task_id',t.task_id,'fms_instance_id',null,'fms_reference',null,'fms_stage_id',null,
     'status',case when ti.deleted_at is not null then 'removed' else ti.status::text end,'created_at',t.created_at,'created_by_name',(select employee_name from user_profiles where id=t.created_by),
     'customer',null,'notification',recording_follow_up_notification(t.task_id,null)) z
    from recording_action_tasks t join recording_analyses x on x.id=t.analysis_id join task_instances ti on ti.id=t.task_id where t.session_id=s.id) q),'[]'::jsonb),
  'readiness',jsonb_build_object(
   'client_match',case when live.id is null then case when s.customer_ref is not null then 'legacy_walkin' else 'not_linked' end else live.state end,
   'crm_sync',case when live.id is null then 'not_linked' else recording_link_sync_state(live.id) end,
   'crm_outcome',crm->>'state',
   'work',case when exists(select 1 from recording_follow_ups f where f.session_id=s.id) or exists(select 1 from recording_action_tasks t where t.session_id=s.id) then 'created' else 'none' end,
   'notifications',coalesce((select case when count(*)=0 then 'none' when bool_or(n->>'state'='failed') then 'failed' when bool_and(n->>'state'='delivered') then 'delivered' else 'pending' end
     from (select recording_follow_up_notification(f.task_id,null) n from recording_follow_ups f where f.session_id=s.id and f.task_id is not null
      union all select recording_follow_up_notification(t.task_id,null) from recording_action_tasks t where t.session_id=s.id) q where n is not null),'none')),
  'outcome_window_days',coalesce((select c.crm_attribution_days from recorder_config c where c.tenant_id=s.tenant_id),30),
  -- The visible analysis's suggestions, each with the follow-up it already has (any version).
  'suggestions',case when an.id is null or jsonb_typeof(an.output->'next_best_actions') is distinct from 'array' then '[]'::jsonb else coalesce((
   select jsonb_agg(jsonb_build_object('analysis_id',an.id,'action_index',e.ordinality-1,'action',e.value->>'action','reason',e.value->>'reason',
     'evidence',coalesce(e.value->'evidence','[]'::jsonb),'existing',recording_existing_follow_up(s.id,recording_action_key(e.value->>'action'))) order by e.ordinality)
   from jsonb_array_elements(an.output->'next_best_actions') with ordinality e where nullif(btrim(e.value->>'action'),'') is not null),'[]'::jsonb) end);
end $$;

-- What the existing notification paths did with the assignment, as one word. In-app rows written by
-- the task assignment trigger (or the FMS step activation) come first; the provider event queue
-- (email/WhatsApp rules) is the fallback.
create function recording_follow_up_notification(p_task uuid,p_stage uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare inst uuid; r jsonb; begin
 if p_stage is not null then select w.fms_instance_id into inst from fms_instance_stages w where w.id=p_stage; end if;
 select case when count(*)=0 then null else jsonb_build_object('state',case when bool_or(x.delivered_status in ('failed_terminal','blocked_configuration')) then 'failed'
   when bool_or(x.delivered_status='delivered') then 'delivered' else 'pending' end,'channel','in_app','count',count(*)) end into r
  from notifications x where (p_task is not null and x.source_record_id=p_task and x.event_type in ('task_assigned','task_delegated'))
   or (p_stage is not null and (x.source_record_id=p_stage or (inst is not null and x.link_url like '%instance='||inst::text||'%')));
 if r is not null then return r; end if;
 select case when ev.id is null then null else jsonb_build_object('state',case
   when ev.status='failed' or bool_or(d.state in ('failed_terminal','blocked_configuration')) then 'failed'
   when bool_or(d.state='delivered') then 'delivered' else 'pending' end,'channel','provider','count',count(d.id)) end into r
 from (select e.* from notification_events e where (p_task is not null and e.source_record_id=p_task and e.event_type in ('task_assigned','task_delegated'))
   or (p_stage is not null and e.source_record_id=p_stage and e.event_type='fms_stage_assigned') order by e.created_at limit 1) ev
 left join notification_deliveries d on d.event_id=ev.id group by ev.id,ev.status;
 return r;
end $$;

-- People and flows the follow-up form can offer (the write re-checks everything).
create function recording_follow_up_options(p_session_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); s recorder_sessions; reviewer boolean; emp user_profiles; begin
 select * into s from recorder_sessions where id=p_session_id;
 if s.id is null or not recorder_can_read(s.employee_id,s.tenant_id,s.branch_id) then raise exception 'recorder_session_denied' using errcode='42501'; end if;
 reviewer:=recording_is_reviewer(s); select * into emp from user_profiles where id=s.employee_id;
 return jsonb_build_object(
  'owners',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name,'is_salesperson',u.id=s.employee_id) order by u.id<>s.employee_id,u.employee_name)
   from user_profiles u where u.tenant_id=s.tenant_id and u.account_status='active' and u.working_status='active'
    and (u.id in (s.employee_id,a.id) or (reviewer and u.branch_id=s.branch_id))),'[]'::jsonb),
  'supervisors',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name) order by u.employee_name) from user_profiles u
   where u.tenant_id=s.tenant_id and u.branch_id=s.branch_id and u.account_status='active' and u.working_status='active' and u.user_role in ('super_admin','admin','manager')),'[]'::jsonb),
  'flows',case when module_accessible('fms_builder') then coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) order by f.name) from fms_flows f
   where f.tenant_id=s.tenant_id and f.start_mode='manual' and f.status::text='published' and coalesce(f.is_active,true)
    and can_start_fms_flow(f.id,s.branch_id,emp.department_id)),'[]'::jsonb) else '[]'::jsonb end,
  'default_due',day_half_deadline(now()));
end $$;

-- Branch readiness for managers: is each integration working, with counts not contents.
create function recording_integration_health() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); begin
 if not recording_is_branch_reviewer(a) then raise exception 'recording_review_denied' using errcode='42501'; end if;
 return (with ses as (select s.* from recorder_sessions s where s.tenant_id=a.tenant_id and s.branch_id=a.branch_id and s.created_at>now()-interval '30 days'),
  links as (select l.* from recording_customer_links l join ses on ses.id=l.session_id where l.ended_at is null),
  ev as (select e.* from crm_sync.recording_events e join ses on ses.id=e.session_id)
  select jsonb_build_object(
   'client_match',(select jsonb_build_object('conversations',(select count(*) from ses),'linked',count(*),'verified',count(*) filter (where state='verified'),
     'pending',count(*) filter (where state='pending'),'refused',count(*) filter (where state='rejected')) from links),
   'crm_sync',(select jsonb_build_object('synced',count(*) filter (where delivered_at is not null),'queued',count(*) filter (where delivered_at is null and rejected_at is null and dead_at is null and held_at is null),
     'waiting_for_crm_approval',count(*) filter (where held_at is not null and delivered_at is null),'refused',count(*) filter (where rejected_at is not null),
     'failed',count(*) filter (where dead_at is not null),'oldest_waiting_at',min(created_at) filter (where delivered_at is null and rejected_at is null),
     'last_synced_at',max(delivered_at)) from ev),
   'crm_outcomes',(select jsonb_build_object('checked',count(*),'last_checked_at',max(o.checked_at),'purchases_verified',count(*) filter (where o.state='purchase_verified'))
     from recording_crm_outcomes o join links on links.id=o.link_id),
   'work',(select jsonb_build_object('created',count(*),'open',count(*) filter (where coalesce(ti.status::text,fi.status::text) not in ('completed','cancelled') and ti.deleted_at is null),
     'overdue',count(*) filter (where ti.status::text<>'completed' and ti.deleted_at is null and coalesce(ti.revised_datetime,ti.planned_datetime)<now()),'via_fms',count(f.fms_instance_id))
     from recording_follow_ups f join ses on ses.id=f.session_id left join task_instances ti on ti.id=f.task_id left join fms_instances fi on fi.id=f.fms_instance_id),
   'notifications',(select jsonb_build_object('delivered',count(*) filter (where n->>'state'='delivered'),'pending',count(*) filter (where n->>'state'='pending'),
     'failed',count(*) filter (where n->>'state'='failed'),'missing',count(*) filter (where n is null))
     from (select recording_follow_up_notification(f.task_id,null) n from recording_follow_ups f join ses on ses.id=f.session_id where f.task_id is not null) q)));
end $$;

-- Settings: attribution window and the estimated average ticket (blank = no estimate).
create function recording_configure_crm_outcomes(p_attribution_days integer,p_estimated_ticket_inr numeric) returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=recording_rubric_manager(); c recorder_config; begin
 if p_attribution_days is null or p_attribution_days not between 1 and 90 or (p_estimated_ticket_inr is not null and p_estimated_ticket_inr not between 1 and 100000000) then
  raise exception 'recording_invalid_config' using errcode='22023'; end if;
 insert into recorder_config(tenant_id,crm_attribution_days,estimated_ticket_inr) values(a.tenant_id,p_attribution_days,round(p_estimated_ticket_inr,2))
 on conflict(tenant_id) do update set crm_attribution_days=excluded.crm_attribution_days,estimated_ticket_inr=excluded.estimated_ticket_inr returning * into c;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
 values(a.tenant_id,a.id,'recording_crm_outcomes_configured','sales_recording',a.tenant_id,jsonb_build_object('crm_attribution_days',c.crm_attribution_days,'estimated_ticket_inr',c.estimated_ticket_inr));
 return jsonb_build_object('crm_attribution_days',c.crm_attribution_days,'estimated_ticket_inr',c.estimated_ticket_inr);
end $$;

-- Insights: AI-suggested intent and CRM-confirmed results side by side, purchases counted once.
create function recording_crm_insights(p_tenant uuid,p_branch uuid,p_from date,p_to date,p_employee uuid) returns jsonb language sql stable security definer set search_path=public as $$
 with base as (select s.* from recorder_sessions s where s.tenant_id=p_tenant and s.branch_id=p_branch and (s.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
   and (p_employee is null or s.employee_id=p_employee)),
  r as (select b.id,b.employee_id,recording_crm_result(b) crm,(recording_visible_analysis(b.id,true)).output#>>'{signals,sales_outcome,value}' ai from base b),
  credited as (select distinct o.purchase_visit_id,o.session_id from recording_crm_outcomes o join base b on b.id=o.session_id where recording_purchase_credited(o.link_id)),
  cfg as (select c.estimated_ticket_inr,c.crm_attribution_days from recorder_config c where c.tenant_id=p_tenant)
 select jsonb_build_object(
  'ai_suggested',(select jsonb_build_object('converted',count(*) filter (where ai='reported_purchase'),'not_converted',count(*) filter (where ai='no_purchase'),
    'follow_up',count(*) filter (where ai='follow_up'),'unknown',count(*) filter (where ai is null or ai in ('unknown','enquiry'))) from r),
  'crm',(select jsonb_build_object('linked',count(*) filter (where (crm->>'reason') is distinct from 'not_linked'),
    'confirmed_purchases',(select count(distinct purchase_visit_id) from credited),
    'pending_confirmation',count(*) filter (where crm->>'state'='pending_crm_confirmation'),
    'no_purchase_yet',count(*) filter (where crm->>'state'='no_crm_purchase_yet'),'no_purchase_in_window',count(*) filter (where crm->>'state'='no_crm_purchase_in_window'),
    'credited_elsewhere',count(*) filter (where crm->>'state'='purchase_credited_elsewhere'),
    'ai_converted_confirmed',count(*) filter (where ai='reported_purchase' and crm->>'state'='crm_confirmed_purchase'),
    'ai_converted_not_confirmed',count(*) filter (where ai='reported_purchase' and crm->>'state' in ('no_crm_purchase_yet','no_crm_purchase_in_window'))) from r),
  'by_employee',coalesce((select jsonb_agg(jsonb_build_object('employee_id',e.employee_id,'confirmed_purchases',e.n)) from (
    select b.employee_id,count(distinct c.purchase_visit_id) n from credited c join base b on b.id=c.session_id group by b.employee_id) e),'[]'::jsonb),
  'revenue',jsonb_build_object('verified',null,'verified_note','The CRM does not record sale amounts, so no verified revenue can be shown.',
    'estimated',(select case when cfg.estimated_ticket_inr is null then null else (select count(distinct purchase_visit_id) from credited)*cfg.estimated_ticket_inr end from (select 1) one left join cfg on true),
    'ticket_inr',(select estimated_ticket_inr from cfg),
    'formula','Estimated = CRM-confirmed purchases (each CRM purchase visit counted once) × configured average ticket'),
  'window_days',coalesce((select crm_attribution_days from cfg),30))
$$;
do $$ declare d text; marker text:='''crm_outcomes_connected'',false'; begin
 d:=pg_get_functiondef('recording_insights(date,date,uuid)'::regprocedure);
 if position(marker in d)=0 then raise exception 'Review recording_insights before patching'; end if;
 d:=replace(d,marker,'''crm_outcomes_connected'',true,''crm'',recording_crm_insights(a.tenant_id,a.branch_id,p_from,p_to,p_employee_id),'||
  '''follow_ups_all'',(select jsonb_build_object(''created'',count(*),''completed'',count(*) filter (where st=''completed''),''open'',count(*) filter (where st not in (''completed'',''cancelled'',''removed'')),'||
  '''overdue'',count(*) filter (where st not in (''completed'',''cancelled'',''removed'') and due<now())) from ('||
  'select coalesce(case when ti.deleted_at is not null then ''removed'' else ti.status::text end,fi.status::text) st,coalesce(ti.revised_datetime,ti.planned_datetime,f.due_at) due '||
  'from recording_follow_ups f join base b on b.id=f.session_id left join task_instances ti on ti.id=f.task_id left join fms_instances fi on fi.id=f.fms_instance_id '||
  'union all select case when ti.deleted_at is not null then ''removed'' else ti.status::text end,coalesce(ti.revised_datetime,ti.planned_datetime) '||
  'from recording_action_tasks t join base b on b.id=t.session_id join task_instances ti on ti.id=t.task_id) fu)');
 execute d;
end $$;

-- Settings shows the outcome settings too.
do $$ declare d text; marker text:='''cost_tracked'',false'; begin
 d:=pg_get_functiondef('recording_workspace_settings()'::regprocedure);
 if position(marker in d)=0 then raise exception 'Review recording_workspace_settings before patching'; end if;
 d:=replace(d,marker,marker||',''crm_outcomes'',jsonb_build_object(''attribution_days'',coalesce(c.crm_attribution_days,30),''estimated_ticket_inr'',c.estimated_ticket_inr,'||
  '''can_change'',a.user_role in (''super_admin'',''admin'') and has_permission(''recording.manage_rubric''))');
 execute d;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 10. Grants.
-- ---------------------------------------------------------------------------------------------
do $$ declare f text; begin foreach f in array array[
 'recording_link_guard()','crm_sync.recording_event_guard()','recording_follow_up_guard()','recording_action_key(text)','recording_existing_follow_up(uuid,text)',
 'recording_live_link(uuid)','recording_link_sync_state(uuid)','recording_outcome_window(recorder_sessions)','recording_purchase_credited(uuid)','recording_crm_result(recorder_sessions)',
 'recording_enqueue_crm_event(recording_customer_links,text,text)','recording_link_actor(uuid)',
 'recording_insert_link(recorder_sessions,uuid,text,uuid,text,integer,text,text,text,uuid,uuid,text)','recording_follow_up_notification(uuid,uuid)',
 'recording_crm_insights(uuid,uuid,date,date,uuid)',
 'recording_link_crm_customer(uuid,jsonb,uuid,text)','recording_unlink_crm_customer(uuid,text)','recording_retry_crm_sync(uuid)','recording_create_follow_up(jsonb)',
 'recording_session_integration(uuid)','recording_follow_up_options(uuid)','recording_integration_health()','recording_configure_crm_outcomes(integer,numeric)',
 'crm_sync_claim_recording_events(integer)','crm_sync_finish_recording_event(uuid,uuid,jsonb,text)','crm_sync_claim_recording_outcome_checks(integer)',
 'crm_sync_record_recording_outcomes(uuid,jsonb)'] loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f); end loop; end $$;
grant execute on function recording_link_crm_customer(uuid,jsonb,uuid,text),recording_unlink_crm_customer(uuid,text),recording_retry_crm_sync(uuid),
 recording_create_follow_up(jsonb),recording_session_integration(uuid),recording_follow_up_options(uuid),recording_integration_health(),
 recording_configure_crm_outcomes(integer,numeric) to authenticated;
grant execute on function crm_sync_claim_recording_events(integer),crm_sync_finish_recording_event(uuid,uuid,jsonb,text),
 crm_sync_claim_recording_outcome_checks(integer),crm_sync_record_recording_outcomes(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
