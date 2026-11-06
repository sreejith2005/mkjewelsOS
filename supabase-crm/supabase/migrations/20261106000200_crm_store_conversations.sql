-- Store Intelligence conversations in the CRM (owner request 2026-11-06).
--
-- JewelOS keeps the audio, transcript, score and every AI suggestion. The CRM receives only a
-- minimal, read-only "Store conversation" activity entry for a customer that a signed-in JewelOS
-- user explicitly chose, delivered server-to-server through the existing sync-receive transport
-- (x-crm-sync-secret). Nothing here creates a client, merges profiles, edits a profile field or
-- treats a conversation as a sale: purchases stay what crm_private.walkin_purchase_evidence says.
--
-- Contracts:
--   crm_store_conversation_candidates(text)          browser, as the CRM user: exact code /
--                                                     reference / phone matches, never fuzzy names
--   crm_apply_store_conversation_event(text,jsonb)   service role: link / unlink, idempotent
--   crm_store_conversation_outcomes(uuid,jsonb)      service role: verified purchase evidence
set search_path=public,extensions;

create table crm_private.store_conversation_inbox(
 event_id text primary key,tenant_id uuid not null,payload jsonb not null,digest text not null,
 result jsonb not null,received_at timestamptz not null default now()
);
create table public.crm_store_conversations(
 link_id uuid primary key,source_tenant uuid not null,session_id uuid not null,
 client_id uuid references public.clients(client_id),lead_id uuid references public.leads(id),visit_id uuid references public.client_timeline(id),
 occurred_at timestamptz not null,duration_seconds integer check(duration_seconds between 0 and 86400),
 salesperson_name text check(length(salesperson_name)<=160),actor_id uuid not null references public.users(id),branch_id uuid references public.branches(id),
 jewelos_path text not null check(jewelos_path ~ '^/sales-recording/conversations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 linked_event_id text not null references crm_private.store_conversation_inbox(event_id),
 withdrawn_at timestamptz,withdrawn_event_id text references crm_private.store_conversation_inbox(event_id),
 withdrawn_reason text check(length(withdrawn_reason)<=200),received_at timestamptz not null default now(),
 check(client_id is not null or lead_id is not null)
);
-- One live link per recorded conversation; a corrected link withdraws the old one first.
create unique index store_conversation_live_session on public.crm_store_conversations(source_tenant,session_id) where withdrawn_at is null;
create index store_conversation_client on public.crm_store_conversations(client_id,occurred_at desc) where client_id is not null;
create index store_conversation_lead on public.crm_store_conversations(lead_id) where lead_id is not null;
alter table crm_private.store_conversation_inbox enable row level security;
revoke all on crm_private.store_conversation_inbox from public,anon,authenticated,service_role;
alter table public.crm_store_conversations enable row level security;
revoke all on public.crm_store_conversations from public,anon,authenticated,service_role;
grant select on public.crm_store_conversations to authenticated;
-- Same read rule as every other CRM history source: an active CRM user.
create policy active_crm_store_conversation_read on public.crm_store_conversations for select to authenticated using((select public.current_user_role()) is not null);

-- Evidence never changes except the one-way withdrawal of a live link.
create function crm_private.store_conversation_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Store conversation evidence is immutable' using errcode='23514';end if;
 if tg_table_name='store_conversation_inbox' or old.withdrawn_at is not null or new.withdrawn_at is null
  or (to_jsonb(new)-'withdrawn_at'-'withdrawn_event_id'-'withdrawn_reason') is distinct from (to_jsonb(old)-'withdrawn_at'-'withdrawn_event_id'-'withdrawn_reason') then
  raise exception 'Store conversation evidence is immutable' using errcode='23514';
 end if;
 return new;
end $$;
create trigger store_conversation_inbox_immutable before update or delete on crm_private.store_conversation_inbox for each row execute function crm_private.store_conversation_immutable();
create trigger store_conversation_immutable before update or delete on public.crm_store_conversations for each row execute function crm_private.store_conversation_immutable();

-- ---------------------------------------------------------------------------------------------
-- Candidate search for the JewelOS "Link customer" drawer. Exact identifiers only: a client code
-- (MKC-…), a visit reference (MKREF-…), or a full phone number. Every client sharing that phone
-- is returned (family members often share one), so a person always chooses; nothing is merged or
-- created. Only an active CRM user gets rows (the CRM's existing company-wide read rule).
-- ---------------------------------------------------------------------------------------------
create function public.crm_store_conversation_candidates(p_query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text:=upper(regexp_replace(btrim(coalesce(p_query,'')),'\s+','','g'));kind text;v_phone text;rows jsonb;begin
 if public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501';end if;
 if length(q) not between 4 and 40 then return jsonb_build_object('query_kind','invalid','candidates','[]'::jsonb);end if;
 if q ~ '^MKC-?[0-9]{1,12}$' then
  kind:='client_code';q:=regexp_replace(q,'^MKC-?','MKC-');
  select coalesce(jsonb_agg(crm_private.store_conversation_candidate('client',c.client_id,null,null) order by c.client_code),'[]') into rows
   from public.clients c where upper(c.client_code)=q;
 elsif q ~ '^MKREF-[A-Z0-9-]{1,40}$' then
  kind:='visit_reference';
  select coalesce(jsonb_agg(crm_private.store_conversation_candidate('visit',t.client_id,null,t.id) order by t.event_date desc),'[]') into rows
   from (select t.* from public.client_timeline t where upper(t.reference_number)=q order by t.event_date desc limit 5) t;
 else
  v_phone:=crm_private.phone_key(p_query);
  if v_phone is null then return jsonb_build_object('query_kind','invalid','candidates','[]'::jsonb);end if;
  kind:='phone';
  select coalesce(jsonb_agg(x.c order by x.ord,x.name),'[]') into rows from (
   select crm_private.store_conversation_candidate('client',c.client_id,null,null) c,0 ord,c.primary_name::text name
    from public.clients c where c.client_id in (select i.client_id from public.client_phone_index i where i.phone=v_phone)
   union all
   select crm_private.store_conversation_candidate('lead',null,l.id,null),1,coalesce(l.name,'')::text from public.leads l
    where l.phone_number=v_phone and l.converted_to_client_id is null
     and not exists(select 1 from public.client_phone_index i where i.phone=v_phone) -- the lead's own CRM record already listed
   limit 20) x;
 end if;
 return jsonb_build_object('query_kind',kind,'candidates',rows);
end $$;

-- Minimal display fields only: code, name, a masked phone and visit recency to tell people apart.
create function crm_private.store_conversation_candidate(p_kind text,p_client uuid,p_lead uuid,p_visit uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when p_kind in ('client','visit') then (
   select jsonb_build_object('kind',p_kind,'target_id',coalesce(p_visit,c.client_id),'client_id',c.client_id,'client_code',c.client_code,
    'name',c.primary_name,'phone_hint',case when length(c.primary_phone)>=4 then '••'||right(c.primary_phone,4) end,
    'last_visit_at',c.last_visit_date,'total_visits',c.total_visits,
    'visit_at',(select t.event_date from public.client_timeline t where t.id=p_visit),
    'visit_reference',(select t.reference_number from public.client_timeline t where t.id=p_visit))
   from public.clients c where c.client_id=p_client)
 else (select jsonb_build_object('kind','lead','target_id',l.id,'client_id',null,'client_code',null,'name',coalesce(l.name,'Lead without a name'),
    'phone_hint','••'||right(l.phone_number,4),'last_visit_at',null,'total_visits',0,'visit_at',null,'visit_reference',null)
   from public.leads l where l.id=p_lead) end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Link / unlink from JewelOS (service role through sync-receive).
-- Outcomes: accepted | source_unapproved (held; JewelOS retries) | retry (dependency pending)
--         | rejected (final, with a fixed reason). Same event id + same payload replays the
-- stored result; a reused id with a different payload is refused.
-- ---------------------------------------------------------------------------------------------
create function public.crm_apply_store_conversation_event(p_event_id text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare receipt crm_private.store_conversation_inbox;tenant uuid;checksum text;actor uuid;branch uuid;kind text;target uuid;
 v_client uuid;v_lead uuid;v_visit uuid;link uuid;session uuid;existing public.crm_store_conversations;result jsonb;path text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 if p_event_id is null or p_event_id !~ '^jewelos\.store_conversation\.[0-9a-f-]{36}\.(linked|unlinked)$' or jsonb_typeof(p_payload) is distinct from 'object'
  or pg_column_size(p_payload)>8192 or p_payload->>'eventId' is distinct from p_event_id or p_payload->>'sourceProject' is distinct from 'jewelos'
  or p_payload->>'schemaVersion' is distinct from '1' or coalesce(p_payload->>'eventType','') not in ('store_conversation.linked','store_conversation.unlinked')
  or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('schemaVersion','sourceProject','eventId','eventType','tenantId','branchId','actorId',
   'linkId','sessionId','occurredAt','durationSeconds','salespersonName','target','reason')) then
  raise exception 'Invalid store conversation event' using errcode='22023';end if;
 begin
  tenant:=(p_payload->>'tenantId')::uuid;link:=(p_payload->>'linkId')::uuid;session:=(p_payload->>'sessionId')::uuid;
 exception when others then raise exception 'Invalid store conversation event' using errcode='22023';end;
 if tenant is null or link is null or session is null or p_event_id<>'jewelos.store_conversation.'||link||'.'||split_part(p_payload->>'eventType','.',2) then
  raise exception 'Invalid store conversation event' using errcode='22023';end if;
 checksum:=encode(digest(p_payload::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('store_conversation.'||tenant||'.'||session,0));
 select * into receipt from crm_private.store_conversation_inbox where event_id=p_event_id;
 if receipt.event_id is not null then
  if receipt.digest<>checksum then raise exception 'Event identity reused with conflicting payload' using errcode='23514';end if;
  return receipt.result||'{"duplicate":true}'::jsonb;
 end if;
 -- The source tenant must be approved by a CRM administrator (the existing customer-source switch).
 if not exists(select 1 from crm_private.customer_sources where tenant_id=tenant and enabled) then return '{"outcome":"source_unapproved"}'::jsonb;end if;

 if p_payload->>'eventType'='store_conversation.unlinked' then
  select * into existing from public.crm_store_conversations where link_id=link and source_tenant=tenant;
  if existing.link_id is not null and existing.withdrawn_at is null then
   insert into crm_private.store_conversation_inbox(event_id,tenant_id,payload,digest,result) values(p_event_id,tenant,p_payload,checksum,'{}');
   update public.crm_store_conversations set withdrawn_at=clock_timestamp(),withdrawn_event_id=p_event_id,withdrawn_reason=left(nullif(btrim(p_payload->>'reason'),''),200) where link_id=link;
   if existing.client_id is not null then perform crm_private.refresh_client_browse_state(existing.client_id);end if;
   perform crm_private.write_audit_log('crm.store_conversation_unlinked',coalesce(existing.client_id,existing.lead_id),jsonb_build_object('event_id',p_event_id,'link_id',link));
   result:=jsonb_build_object('outcome','accepted','withdrawn',true);
  else
   -- The link never reached the CRM (or was already withdrawn): nothing to remove, and that is final.
   insert into crm_private.store_conversation_inbox(event_id,tenant_id,payload,digest,result) values(p_event_id,tenant,p_payload,checksum,'{}');
   result:=jsonb_build_object('outcome','accepted','withdrawn',false);
  end if;
  return result;
 end if;

 -- Linked: the JewelOS person who chose the customer must be an active CRM user of this tenant.
 select u.id into actor from public.crm_sso_access_grants g join public.users u on u.id=g.legacy_crm_user_id
  join crm_private.master_members mm on mm.jewelos_user_id=g.jewelos_user_id and mm.tenant_id=tenant and mm.active
  where g.jewelos_user_id=(p_payload->>'actorId')::uuid and g.active and u.active limit 1;
 if actor is null then result:='{"outcome":"rejected","reason":"actor_not_crm_user"}'::jsonb;end if;
 kind:=p_payload#>>'{target,kind}';
 begin target:=(p_payload#>>'{target,id}')::uuid;exception when others then target:=null;end;
 if result is null and (kind not in ('client','lead','visit','walkin') or target is null) then result:='{"outcome":"rejected","reason":"invalid_target"}'::jsonb;end if;
 if result is null then
  if kind='client' then select client_id into v_client from public.clients where client_id=target;
  elsif kind='lead' then select id,converted_to_client_id into v_lead,v_client from public.leads where id=target;
  elsif kind='visit' then select id,client_id into v_visit,v_client from public.client_timeline where id=target;
  else
   select client_id into v_client from public.entry_queue where id=target;
   if not found then result:='{"outcome":"rejected","reason":"target_not_found"}'::jsonb;
   -- A walk-in becomes a client when its visit form is saved: wait for it, never invent one.
   elsif v_client is null then return '{"outcome":"retry","reason":"walkin_not_registered"}'::jsonb;end if;
  end if;
  if result is null and v_client is null and v_lead is null then result:='{"outcome":"rejected","reason":"target_not_found"}'::jsonb;end if;
 end if;
 if result is null and exists(select 1 from public.crm_store_conversations where source_tenant=tenant and session_id=session and withdrawn_at is null and link_id<>link) then
  -- The previous link's withdrawal has not arrived yet: try again after it.
  return '{"outcome":"retry","reason":"previous_link_live"}'::jsonb;
 end if;
 if result is null then
  select id into branch from public.branches where jewelos_branch_id=(p_payload->>'branchId')::uuid and active limit 1;
  path:='/sales-recording/conversations/'||session;
  -- The acknowledgement carries the CRM's own identifiers and display fields, never JewelOS's guess.
  result:=jsonb_build_object('outcome','accepted','client_id',v_client,'lead_id',v_lead,'visit_id',v_visit,
   'client_code',(select client_code from public.clients where client_id=v_client),
   'display_name',coalesce((select primary_name from public.clients where client_id=v_client),(select name from public.leads where id=v_lead)));
  insert into crm_private.store_conversation_inbox(event_id,tenant_id,payload,digest,result) values(p_event_id,tenant,p_payload,checksum,result);
  begin
   insert into public.crm_store_conversations(link_id,source_tenant,session_id,client_id,lead_id,visit_id,occurred_at,duration_seconds,salesperson_name,actor_id,branch_id,jewelos_path,linked_event_id)
   values(link,tenant,session,v_client,v_lead,v_visit,(p_payload->>'occurredAt')::timestamptz,nullif(p_payload->>'durationSeconds','')::integer,
    left(nullif(btrim(p_payload->>'salespersonName'),''),160),actor,branch,path,p_event_id);
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or check_violation or numeric_value_out_of_range then
   raise exception 'Invalid store conversation event' using errcode='22023';
  end;
  if v_client is not null then perform crm_private.refresh_client_browse_state(v_client);end if;
  perform crm_private.write_audit_log('crm.store_conversation_linked',coalesce(v_client,v_lead),jsonb_build_object('event_id',p_event_id,'link_id',link,'kind',kind));
  return result;
 end if;
 -- A final refusal is recorded too, so a replay answers the same way.
 insert into crm_private.store_conversation_inbox(event_id,tenant_id,payload,digest,result) values(p_event_id,tenant,p_payload,checksum,result);
 return result;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Verified purchase evidence for linked conversations (service role). One row per requested link.
-- A purchase is exactly crm_private.walkin_purchase_evidence (docs/REPORTS.md): repairs, pickups,
-- exchanges, returns, price checks and plain visits are never sales unless that rule says so.
-- The window [since, until) is chosen by JewelOS (recording day .. attribution window end).
-- ---------------------------------------------------------------------------------------------
create function public.crm_store_conversation_outcomes(p_tenant uuid,p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item jsonb;rows jsonb:='[]'::jsonb;s public.crm_store_conversations;v_client uuid;since timestamptz;until timestamptz;ev record;visits integer;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 if p_tenant is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Invalid outcome request' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  begin
   select * into s from public.crm_store_conversations where link_id=(item->>'linkId')::uuid and source_tenant=p_tenant;
   since:=(item->>'since')::timestamptz;until:=(item->>'until')::timestamptz;
  exception when others then raise exception 'Invalid outcome request' using errcode='22023';end;
  if since is null or until is null or until<=since or until-since>interval '120 days' then raise exception 'Invalid outcome request' using errcode='22023';end if;
  if s.link_id is null or s.withdrawn_at is not null then
   rows:=rows||jsonb_build_array(jsonb_build_object('linkId',item->>'linkId','state','not_linked'));continue;
  end if;
  v_client:=coalesce(s.client_id,(select converted_to_client_id from public.leads where id=s.lead_id));
  if v_client is null then
   rows:=rows||jsonb_build_array(jsonb_build_object('linkId',s.link_id,'state','no_client'));continue;
  end if;
  select count(*)::integer into visits from public.client_timeline t where t.client_id=v_client and t.event_date>=since and t.event_date<until;
  select t.id,t.event_date,crm_private.saved_walkin_status(t.buy_status,f.additional_fields)::text as outcome into ev
   from public.client_timeline t left join public.visit_forms f on f.client_timeline_id=t.id
   where t.client_id=v_client and t.event_date>=since and t.event_date<until
    and crm_private.walkin_purchase_evidence(t.buy_status,t.bought_categories,f.did_buy,f.additional_fields)
   order by t.event_date,t.id limit 1;
  rows:=rows||jsonb_build_array(jsonb_build_object('linkId',s.link_id,'state',case when ev.id is null then 'no_purchase_recorded' else 'purchase_verified' end,
   'clientId',v_client,'visits',visits,'purchaseVisitId',ev.id,'purchaseVisitAt',ev.event_date,'purchaseOutcome',ev.outcome));
 end loop;
 return jsonb_build_object('results',rows,'checkedAt',now());
end $$;

-- ---------------------------------------------------------------------------------------------
-- The customer's history shows the entry (read-only). Withdrawn links disappear from the history
-- but stay as evidence. Appended to the current view definition, like the FMS evidence source.
-- ---------------------------------------------------------------------------------------------
do $$declare definition text;begin
 definition:=rtrim(pg_get_viewdef('public.crm_client_activity'::regclass,true),E';\n ');
 if position('crm_store_conversations' in definition)>0 then raise exception 'Store conversations are already in the activity view';end if;
 execute 'create or replace view public.crm_client_activity with(security_invoker=true) as '||definition||
  ' union all select ''store:''||s.link_id::text,s.client_id,s.occurred_at,''STORE_CONVERSATION''::text,''IN_PERSON''::text,s.actor_id,s.branch_id,''Store conversation recorded''::text,'||
  'jsonb_build_object(''jewelosPath'',s.jewelos_path,''durationSeconds'',s.duration_seconds,''salespersonName'',s.salesperson_name),false,''crm_store_conversations''::text,s.link_id::text '||
  'from public.crm_store_conversations s where s.client_id is not null and s.withdrawn_at is null';
end $$;

revoke all on function crm_private.store_conversation_immutable(),crm_private.store_conversation_candidate(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.crm_store_conversation_candidates(text),public.crm_apply_store_conversation_event(text,jsonb),public.crm_store_conversation_outcomes(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.crm_store_conversation_candidates(text) to authenticated;
grant execute on function public.crm_apply_store_conversation_event(text,jsonb),public.crm_store_conversation_outcomes(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
