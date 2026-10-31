-- CRM owns identity. Operational source evidence is delivered asynchronously, never via a browser transaction.
set search_path=public,extensions;
create table crm_private.customer_sources(tenant_id uuid primary key,enabled boolean not null default false,approved_by uuid not null references public.users(id),approved_at timestamptz not null default now());
create table crm_private.customer_mapping_registry(
 mapping_id uuid primary key,tenant_id uuid not null,descriptor jsonb not null,digest text not null,
 registered_at timestamptz not null default now(),approved_at timestamptz,approved_by uuid references public.users(id)
);
create table crm_private.customer_event_inbox(
 event_id text primary key,tenant_id uuid not null,payload jsonb not null,digest text not null,
 received_at timestamptz not null default now(),result jsonb not null default '{}',applied_at timestamptz,
 review_reason text,candidates uuid[] not null default '{}',review_client_id uuid,reviewed_by uuid references public.users(id),reviewed_at timestamptz,
 review_action text,review_fingerprint text
);
create table crm_private.customer_journeys(
 tenant_id uuid not null,journey_key uuid not null,client_id uuid not null references public.clients(client_id),
 reference_number text,created_at timestamptz not null default now(),primary key(tenant_id,journey_key)
);
create index customer_journey_client on crm_private.customer_journeys(client_id,journey_key);
create index customer_journey_reference on crm_private.customer_journeys(lower(reference_number) text_pattern_ops);
create table crm_private.customer_source_identities(
 tenant_id uuid not null,scope text not null,kind text not null,normalized text not null,
 client_id uuid not null references public.clients(client_id),verified boolean not null default false,
 source_event_id text not null references crm_private.customer_event_inbox(event_id),
 primary key(tenant_id,scope,kind,normalized,client_id)
);
create unique index customer_identity_verified on crm_private.customer_source_identities(tenant_id,scope,kind,normalized) where verified;
create index customer_phone_alias_lookup on crm_private.customer_source_identities(tenant_id,kind,normalized,client_id);
create index customer_identity_search on crm_private.customer_source_identities(lower(normalized) text_pattern_ops);
create table public.crm_customer_workflow_events(
 event_id text primary key,client_id uuid not null references public.clients(client_id),source_tenant uuid not null,
 journey_key uuid not null,source_actor_id uuid,actor_id uuid references public.users(id),branch_id uuid references public.branches(id),
 occurred_at timestamptz not null,kind text not null,channel text not null,workflow jsonb,
 answers jsonb not null,provenance jsonb not null default '{}',is_contact boolean not null default false,received_at timestamptz not null default now()
);
create index customer_workflow_history on public.crm_customer_workflow_events(client_id,occurred_at desc,event_id desc);
create index customer_workflow_journey on public.crm_customer_workflow_events(source_tenant,journey_key);
alter table public.crm_customer_workflow_events enable row level security;
create policy active_crm_customer_workflow_read on public.crm_customer_workflow_events for select to authenticated using((select public.current_user_role()) is not null);
revoke all on public.crm_customer_workflow_events from public,anon,authenticated,service_role;
grant select on public.crm_customer_workflow_events to authenticated;
create table crm_private.customer_attribute_projection(
 client_id uuid not null references public.clients(client_id),destination text not null,value jsonb not null,
 event_id text not null references public.crm_customer_workflow_events(event_id),source_at timestamptz not null,
 primary key(client_id,destination)
);
do $$declare name text;begin
 foreach name in array array['customer_sources','customer_mapping_registry','customer_event_inbox','customer_journeys','customer_source_identities','customer_attribute_projection'] loop
  execute format('alter table crm_private.%I enable row level security',name);
  execute format('revoke all on crm_private.%I from public,anon,authenticated,service_role',name);
 end loop;
end $$;

create function crm_private.customer_admin() returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_user_role() is null or not coalesce(public.is_super_admin(),false) then raise exception 'CRM integration administrator required' using errcode='42501';end if;
 return public.current_crm_user_id();
end $$;
create function public.configure_customer_source(p_tenant uuid,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=crm_private.customer_admin();begin
 if p_tenant is null then raise exception 'Source tenant required' using errcode='22023';end if;
 insert into crm_private.customer_sources values(p_tenant,p_enabled,actor,now()) on conflict(tenant_id) do update set enabled=excluded.enabled,approved_by=excluded.approved_by,approved_at=now();
 perform crm_private.write_audit_log('crm.customer_source_configured',p_tenant,jsonb_build_object('enabled',p_enabled));
end $$;
create function public.crm_register_customer_mapping(p_mapping_id uuid,p_descriptor jsonb,p_digest text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare existing crm_private.customer_mapping_registry;item jsonb;t uuid;seen text[]:='{}';begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 if p_mapping_id is null or jsonb_typeof(p_descriptor) is distinct from 'object' or pg_column_size(p_descriptor)>65536
  or p_descriptor->>'sourceProject' is distinct from 'jewelos' or p_descriptor->>'schemaVersion' is distinct from '1'
  or jsonb_typeof(p_descriptor->'fields') is distinct from 'array' or jsonb_array_length(p_descriptor->'fields')>250
  or encode(digest(p_descriptor::text,'sha256'),'hex') is distinct from p_digest then raise exception 'Invalid mapping descriptor' using errcode='22023';end if;
 t:=(p_descriptor->>'tenantId')::uuid;
 if t is null or (p_descriptor->>'templateId')::uuid is null or (p_descriptor->>'templateVersion')::integer<1
  or coalesce(p_descriptor->>'channel','') !~ '^[A-Z][A-Z0-9_]{0,39}$' or length(btrim(coalesce(p_descriptor->>'identityScope',''))) not between 1 and 120 then raise exception 'Invalid mapping identity' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_descriptor->'fields') loop
  if coalesce(item->>'fieldKey','')='' or item->>'fieldKey'=any(seen) or coalesce(item->>'mode','') not in ('operational','profile','history','both')
    or coalesce(item->>'destination','') not in ('primary_name','primary_phone','secondary_phone','billing_phone','crm_client_id','instagram','whatsapp','email','website_chat','external_reference','city','dob','anniversary','communication_preference','budget','product_interest','occasion','requirement','next_follow_up','outcome','contact_outcome','note','source')
    or (item->>'mode'<>'operational' and item->>'type' in ('user_dropdown','branch_dropdown','department_dropdown','file','section_header','divider')) then raise exception 'Destination is not allowed' using errcode='22023';end if;
  seen:=array_append(seen,item->>'fieldKey');
  if item ? 'contactConfirmedValues' then
   if item->>'destination'<>'contact_outcome' or jsonb_typeof(item->'contactConfirmedValues') is distinct from 'array' then raise exception 'Invalid contact mapping' using errcode='22023';end if;
   if jsonb_array_length(item->'contactConfirmedValues')>0 and (coalesce(item->>'contactKind','') not in ('CALL','MESSAGE','THANK_YOU','NOTE') or coalesce(item->>'contactChannel','') not in ('PHONE','WHATSAPP','INSTAGRAM','EMAIL','IN_PERSON','OTHER')) then raise exception 'Contact kind and channel required' using errcode='22023';end if;
   if exists(select 1 from jsonb_array_elements(item->'contactConfirmedValues') selected where not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(item->'options')='array' then item->'options' else '[]'::jsonb end) option where option->'value'=selected)) then raise exception 'Unknown confirmed option' using errcode='22023';end if;
  end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('customer.mapping.'||p_mapping_id,0));
 select * into existing from crm_private.customer_mapping_registry where mapping_id=p_mapping_id;
 if existing.mapping_id is not null and (existing.digest,existing.descriptor) is distinct from(p_digest,p_descriptor) then raise exception 'Mapping identity already used' using errcode='23514';end if;
 if existing.mapping_id is null then insert into crm_private.customer_mapping_registry(mapping_id,tenant_id,descriptor,digest) values(p_mapping_id,t,p_descriptor,p_digest);end if;
 return jsonb_build_object('outcome',case when not exists(select 1 from crm_private.customer_sources where tenant_id=t and enabled) then 'source_unapproved' when existing.approved_at is null then 'mapping_unapproved' else 'accepted' end);
end $$;
create function public.approve_customer_mapping(p_mapping_id uuid,p_digest text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=crm_private.customer_admin();begin
 update crm_private.customer_mapping_registry set approved_at=coalesce(approved_at,clock_timestamp()),approved_by=coalesce(approved_by,actor) where mapping_id=p_mapping_id and digest=p_digest;
 if not found then raise exception 'Mapping changed or unavailable' using errcode='40001';end if;
 perform crm_private.write_audit_log('crm.customer_mapping_approved',p_mapping_id,'{}');
end $$;
create function crm_private.customer_actor_can_write(p_actor uuid,p_branch uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.users u where u.id=p_actor and u.active
  and exists(select 1 from public.crm_sso_access_grants g where g.legacy_crm_user_id=u.id and g.active)
  and (u.role='super_admin' or u.branch_id=p_branch));
$$;

-- Every reviewer and receiver uses the same journey lock. A review never moves accepted work.
create function crm_private.lock_customer_journey(p_tenant uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare target uuid;parent uuid;journey uuid:=(p_payload->>'journeyKey')::uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('customer.journey.'||p_tenant||'.'||journey,0));
 select client_id into target from crm_private.customer_journeys where tenant_id=p_tenant and journey_key=journey;
 if nullif(p_payload#>>'{workflow,parentInstanceId}','') is not null then
  select client_id into parent from crm_private.customer_journeys where tenant_id=p_tenant and journey_key=(p_payload#>>'{workflow,parentInstanceId}')::uuid;
  if target is not null and parent is not null and target<>parent then raise exception 'Journey identity conflict' using errcode='23514';end if;
 end if;
 return coalesce(target,parent);
end $$;
revoke all on function crm_private.lock_customer_journey(uuid,jsonb) from public,anon,authenticated,service_role;

create function public.crm_apply_customer_event(p_event_id text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare receipt crm_private.customer_event_inbox;mapping crm_private.customer_mapping_registry;tenant uuid;journey uuid;target uuid;actor uuid;branch uuid;at_time timestamptz;
 checksum text;reason text;item jsonb;definition jsonb;name text;phone text;explicit_id uuid;v_scope text;kind text;normalized_value text;v_candidates uuid[]:='{}';ids uuid[];aliases jsonb:='[]';alias jsonb;authority_actor uuid;
 v_result jsonb;created boolean:=false;known public.clients;channel text;contact boolean:=false;contact_kind text;contact_channel text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 if p_event_id is null or p_event_id !~ '^[A-Za-z0-9_.:-]{1,160}$' or jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>131072
  or p_payload->>'eventId' is distinct from p_event_id or p_payload->>'sourceProject' is distinct from 'jewelos' or p_payload->>'schemaVersion' is distinct from '1'
  or coalesce(p_payload->>'eventType','') not in ('form.submitted','stage.completed','workflow.changed')
  or jsonb_typeof(p_payload->'answers') is distinct from 'array' or jsonb_array_length(p_payload->'answers')>250 then raise exception 'Invalid customer event' using errcode='22023';end if;
 tenant:=(p_payload->>'tenantId')::uuid;journey:=(p_payload->>'journeyKey')::uuid;at_time:=(p_payload->>'occurredAt')::timestamptz;
 if tenant is null or journey is null or at_time is null or at_time>now()+interval '5 minutes' then raise exception 'Invalid customer source identity or time' using errcode='22023';end if;
 checksum:=encode(digest(p_payload::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('customer.event.'||p_event_id,0));
 select * into receipt from crm_private.customer_event_inbox where event_id=p_event_id for update;
 if receipt.event_id is not null then
  if receipt.digest<>checksum or receipt.payload<>p_payload then raise exception 'Event identity reused with conflicting payload' using errcode='23514';end if;
  if receipt.review_action='reject' then return '{"outcome":"rejected","reason":"reviewer_rejected"}';end if;
  if receipt.applied_at is not null then return receipt.result||'{"duplicate":true}'::jsonb;end if;
 else insert into crm_private.customer_event_inbox(event_id,tenant_id,payload,digest) values(p_event_id,tenant,p_payload,checksum);end if;
 if not exists(select 1 from crm_private.customer_sources where tenant_id=tenant and enabled) then reason:='source_unapproved';end if;
 select * into mapping from crm_private.customer_mapping_registry where mapping_id=(p_payload->>'mappingId')::uuid and tenant_id=tenant and digest=p_payload->>'mappingDigest';
 if reason is null and (mapping.mapping_id is null or mapping.approved_at is null) then reason:='mapping_unapproved';end if;
 if reason is null then
  select u.id into actor from public.crm_sso_access_grants g join public.users u on u.id=g.legacy_crm_user_id
   join crm_private.master_members mm on mm.jewelos_user_id=g.jewelos_user_id and mm.tenant_id=tenant
   where g.jewelos_user_id=(p_payload->>'actorId')::uuid;
  authority_actor:=case when receipt.reviewed_by is not null and exists(select 1 from public.users where id=receipt.reviewed_by and active and role='super_admin') then receipt.reviewed_by else actor end;
  select id into branch from public.branches where jewelos_branch_id=(p_payload->>'branchId')::uuid and active;
  if branch is null or not crm_private.customer_actor_can_write(authority_actor,branch) or
   (receipt.reviewed_by is null and not exists(select 1 from crm_private.master_members where jewelos_user_id=(p_payload->>'actorId')::uuid and tenant_id=tenant and active)) then reason:='actor_or_branch_denied';end if;
 end if;
 if reason is null then
  v_scope:=mapping.descriptor->>'identityScope';channel:=mapping.descriptor->>'channel';
  for item in select value from jsonb_array_elements(p_payload->'answers') loop
   select value into definition from jsonb_array_elements(mapping.descriptor->'fields') where value->>'fieldKey'=item->>'fieldKey';
   if definition is null or definition->>'mode'='operational' or (definition->>'mode',definition->>'destination',definition->>'type',definition->>'label')
    is distinct from(item->>'mode',item->>'destination',item->>'type',item->>'label') then reason:='mapping_snapshot_changed';exit;end if;
   if item->'normalized' is null or item->'normalized'='null'::jsonb or (jsonb_typeof(item->'normalized')='string' and btrim(item->>'normalized')='') then raise exception 'Empty contribution not permitted' using errcode='22023';end if;
   if definition->>'destination'='contact_outcome' and jsonb_typeof(definition->'contactConfirmedValues')='array' and definition->'contactConfirmedValues' @> jsonb_build_array(item->'original') then contact:=true;contact_kind:=definition->>'contactKind';contact_channel:=definition->>'contactChannel';end if;
   if item->>'mode' not in ('profile','both') then continue;end if;
   kind:=item->>'destination';normalized_value:=nullif(btrim(item->>'normalized'),'');
   if kind='primary_name' then name:=left(normalized_value,160);
   elsif kind='crm_client_id' then explicit_id:=normalized_value::uuid;
   elsif kind in ('primary_phone','secondary_phone','billing_phone') then
    normalized_value:=crm_private.phone_key(normalized_value);if normalized_value is not null then aliases:=aliases||jsonb_build_array(jsonb_build_object('kind','phone','value',normalized_value));if kind='primary_phone' then phone:=normalized_value;end if;end if;
   elsif kind in ('instagram','email','whatsapp','website_chat','external_reference') and normalized_value is not null then
    if kind in('instagram','email') then normalized_value:=lower(normalized_value);end if;if kind='instagram' then normalized_value:=regexp_replace(normalized_value,'^@','');if normalized_value !~ '^[a-z0-9_.]{1,30}$' then reason:='invalid_external_identity';exit;end if;end if;
    if kind='email' and normalized_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then reason:='invalid_external_identity';exit;end if;
    if length(normalized_value)>200 then reason:='invalid_external_identity';exit;end if;
    aliases:=aliases||jsonb_build_array(jsonb_build_object('kind',kind,'value',normalized_value));
   end if;
  end loop;
 end if;
 if reason is null then
  target:=crm_private.lock_customer_journey(tenant,p_payload);
  if target is null and nullif(p_payload#>>'{workflow,parentInstanceId}','') is not null then select client_id into target from crm_private.customer_journeys where tenant_id=tenant and journey_key=(p_payload#>>'{workflow,parentInstanceId}')::uuid;if target is null then reason:='journey_pending';end if;end if;
  if target is null and p_payload#>>'{workflow,instanceId}' is not null and p_payload->>'isStartingForm' is distinct from 'true' then reason:='journey_pending';end if;
  if receipt.review_client_id is not null then
   if target is not null and target<>receipt.review_client_id then reason:='journey_identity_conflict';else target:=receipt.review_client_id;end if;
  end if;
  if explicit_id is not null then
   if target is not null and target<>explicit_id then reason:='journey_identity_conflict';else target:=explicit_id;end if;
  end if;
  for alias in select distinct value from jsonb_array_elements(aliases) order by value loop
   perform pg_advisory_xact_lock(hashtextextended(case when alias->>'kind'='phone' then 'customer.phone.'||(alias->>'value') else 'customer.identity.'||tenant||'.'||v_scope||'.'||(alias->>'kind')||'.'||(alias->>'value') end,0));
   if target is null then
    select array_agg(distinct client_id) into ids from crm_private.customer_source_identities where tenant_id=tenant and customer_source_identities.scope=v_scope and customer_source_identities.kind=alias->>'kind' and normalized=alias->>'value' and verified;
    if cardinality(ids)=1 then target:=ids[1];elsif cardinality(ids)>1 then reason:='ambiguous_identity';end if;
   end if;
  end loop;
  if target is null and reason is null then
   select array_agg(distinct candidate) into v_candidates from (select pi.client_id candidate from public.client_phone_index pi join jsonb_array_elements(aliases) v on v->>'kind'='phone' and pi.phone=v->>'value' union select e.client_id from crm_private.customer_source_identities e join jsonb_array_elements(aliases) v on v->>'kind'='phone' and e.kind='phone' and e.normalized=v->>'value' where e.tenant_id=tenant)matched;
   if cardinality(v_candidates)=1 then target:=v_candidates[1];elsif cardinality(v_candidates)>1 then reason:='ambiguous_phone';end if;
  end if;
  if target is null and reason is null then
   select array_agg(distinct e.client_id) into ids from crm_private.customer_source_identities e join jsonb_array_elements(aliases) v on e.kind=v->>'kind' and e.normalized=v->>'value' where e.tenant_id=tenant and e.scope=v_scope;
   if cardinality(ids)>0 then v_candidates:=ids;reason:='unverified_identity';end if;
  end if;
  if target is null and reason is null then
   if name is null then reason:=case when p_payload#>>'{workflow,instanceId}' is not null and jsonb_array_length(aliases)=0 then 'journey_pending' else 'missing_customer_name' end;
   else insert into public.clients(primary_name,primary_phone,last_branch_id,lifecycle_stage) values(name,case when phone is null then null else crm_private.as_phone_input(phone) end,branch,'lead') returning client_id into target;created:=true;end if;
  end if;
  if target is not null and reason is null then
   select * into known from public.clients where client_id=target for update;
   if known.client_id is null or not crm_private.customer_actor_can_write(authority_actor,coalesce(known.last_branch_id,branch)) then reason:='customer_branch_denied';end if;
  end if;
 end if;
 if reason is not null then
  v_result:=jsonb_build_object('outcome',case when reason in ('source_unapproved','mapping_unapproved') then reason when reason='journey_pending' then 'retry' else 'review' end,'reason',reason);
  update crm_private.customer_event_inbox set review_reason=reason,candidates=coalesce(v_candidates,'{}'),result=v_result where event_id=p_event_id;
  return v_result;
 end if;
 insert into crm_private.customer_journeys(tenant_id,journey_key,client_id,reference_number) values(tenant,journey,target,p_payload#>>'{workflow,referenceNumber}') on conflict(tenant_id,journey_key) do nothing;
 for alias in select value from jsonb_array_elements(aliases) loop
  insert into crm_private.customer_source_identities(tenant_id,scope,kind,normalized,client_id,source_event_id) values(tenant,v_scope,alias->>'kind',alias->>'value',target,p_event_id) on conflict do nothing;
 end loop;
 insert into public.crm_customer_workflow_events(event_id,client_id,source_tenant,journey_key,source_actor_id,actor_id,branch_id,occurred_at,kind,channel,workflow,answers,provenance,is_contact)
 values(p_event_id,target,tenant,journey,(p_payload->>'actorId')::uuid,actor,branch,at_time,p_payload->>'eventType',channel,(case when jsonb_typeof(p_payload->'workflow')='object' then p_payload->'workflow' else '{}'::jsonb end)||jsonb_build_object('actorName',p_payload->'actorName'),p_payload->'answers',
  jsonb_build_object('mappingId',mapping.mapping_id,'mappingVersion',mapping.descriptor->'mappingVersion','mappingDigest',mapping.digest,'formTemplateId',mapping.descriptor->'templateId','formVersion',mapping.descriptor->'templateVersion','formFamilyId',mapping.descriptor->'familyId','submissionId',p_payload->'submissionId','reviewerId',receipt.reviewed_by),contact);
 for item in select value from jsonb_array_elements(p_payload->'answers') where value->>'mode' in ('profile','both') loop
  insert into crm_private.customer_attribute_projection(client_id,destination,value,event_id,source_at) values(target,item->>'destination',item->'normalized',p_event_id,at_time)
  on conflict(client_id,destination) do update set value=excluded.value,event_id=excluded.event_id,source_at=excluded.source_at
   where (excluded.source_at,excluded.event_id)>(customer_attribute_projection.source_at,customer_attribute_projection.event_id);
 end loop;
 if contact and actor is not null then insert into public.crm_contacts(client_id,kind,channel,note,actor_id,branch_id,occurred_at,request_key)
  values(target,contact_kind,contact_channel,'Contact confirmed in reviewed FMS form',actor,branch,at_time,(p_payload->>'submissionId')::uuid) on conflict(actor_id,request_key) do nothing;end if;
 v_result:=jsonb_build_object('outcome','accepted','client_id',target,'created',created);
 update crm_private.customer_event_inbox set result=v_result,applied_at=clock_timestamp(),review_reason=null where event_id=p_event_id;
 perform crm_private.refresh_client_browse_state(target);
 perform crm_private.write_audit_log('crm.customer_event_applied',target,jsonb_build_object('event_id',p_event_id,'source_actor_id',p_payload->>'actorId','created',created));
 return v_result;
end $$;

-- Public history includes only mapped customer evidence; private unresolved payloads remain private.
create function public.get_customer_workflow_history(p_client uuid,p_before timestamptz default null,p_before_id text default null,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(row) order by row.occurred_at desc,row.event_id desc),'[]') into result from (
  select e.* from public.crm_customer_workflow_events e where e.client_id=p_client
   and (p_before is null or (e.occurred_at,e.event_id)<(p_before,coalesce(p_before_id,''))) order by e.occurred_at desc,e.event_id desc limit greatest(1,least(coalesce(p_limit,25),100))
 ) row;return result;end $$;

create function public.customer_integration_review_queue() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform crm_private.customer_admin();
 return jsonb_build_object('mappings',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select mapping_id,tenant_id,descriptor,digest,registered_at,approved_at from crm_private.customer_mapping_registry order by registered_at desc limit 100)r),
  'events',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select event_id,tenant_id,review_reason,candidates,received_at,payload->'answers' as answers,(select coalesce(jsonb_agg(jsonb_build_object('id',c.client_id,'code',c.client_code,'name',c.primary_name)),'[]') from public.clients c where c.client_id=any(inbox.candidates)) as candidate_profiles from crm_private.customer_event_inbox inbox where applied_at is null and review_action is distinct from 'reject' order by received_at limit 100)r),
 'quality',jsonb_build_object('missingContactIdentity',(select count(*) from public.clients c where c.primary_phone is null and not exists(select 1 from crm_private.customer_source_identities e where e.client_id=c.client_id)),
 'ambiguousEvents',(select count(*) from crm_private.customer_event_inbox where review_reason in('ambiguous_phone','ambiguous_identity','unverified_identity') and applied_at is null),
 'conflictingProfileValues',(select count(*) from crm_private.customer_attribute_projection p join public.clients c using(client_id) where nullif(to_jsonb(c)->>p.destination,'') is not null and (to_jsonb(c)->p.destination) is distinct from p.value),
 'eventTableBytes',pg_total_relation_size('public.crm_customer_workflow_events'::regclass)),
 'pending',(select count(*) from crm_private.customer_event_inbox where applied_at is null and review_action is distinct from 'reject'),'delivered',(select count(*) from crm_private.customer_event_inbox where applied_at is not null),
 'identities',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select tenant_id,scope,kind,normalized,client_id,source_event_id from crm_private.customer_source_identities where not verified and kind<>'phone' order by tenant_id,scope,kind,normalized limit 100)r));
end $$;
create function public.review_customer_identity(p_event_id text,p_client uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=crm_private.customer_admin();r crm_private.customer_event_inbox;bound uuid;begin
 if length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Review reason required' using errcode='22023';end if;
 select * into r from crm_private.customer_event_inbox where event_id=p_event_id for update;
 if r.event_id is null or r.applied_at is not null then raise exception 'Event is unavailable for identity review' using errcode='23514';end if;
 if not exists(select 1 from public.clients where client_id=p_client) then raise exception 'Customer unavailable' using errcode='22023';end if;
 bound:=crm_private.lock_customer_journey(r.tenant_id,r.payload);
 if bound is not null and bound<>p_client then raise exception 'Journey identity conflict' using errcode='23514';end if;
 update crm_private.customer_event_inbox set review_client_id=p_client,reviewed_by=actor,reviewed_at=clock_timestamp(),review_action='attach' where event_id=p_event_id;
 perform crm_private.write_audit_log('crm.customer_identity_reviewed',p_client,jsonb_build_object('event_id',p_event_id,'reason',p_reason));
end $$;

create function public.create_customer_from_event_review(p_event_id text,p_name text,p_reason text) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=crm_private.customer_admin();r crm_private.customer_event_inbox;branch uuid;client uuid;phone text;fingerprint text;begin
 if length(btrim(coalesce(p_name,''))) not between 1 and 160 or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Customer name and review reason required' using errcode='22023';end if;
 select * into r from crm_private.customer_event_inbox where event_id=p_event_id for update;
 fingerprint:=encode(digest(jsonb_build_object('name',btrim(p_name),'reason',btrim(p_reason),'actor',actor)::text,'sha256'),'hex');
 if r.review_action='create' then if r.review_fingerprint<>fingerprint then raise exception 'Review identity already used' using errcode='23514';end if;return r.review_client_id;end if;
 if r.event_id is null or r.applied_at is not null or r.review_reason not in ('ambiguous_phone','unverified_identity','missing_customer_name','invalid_external_identity') then raise exception 'Event is not eligible for distinct identity review' using errcode='23514';end if;
 if crm_private.lock_customer_journey(r.tenant_id,r.payload) is not null then raise exception 'Journey already has a customer' using errcode='23514';end if;
 select id into branch from public.branches where jewelos_branch_id=(r.payload->>'branchId')::uuid and active;
 if branch is null then raise exception 'Source branch mapping required' using errcode='23514';end if;
 select crm_private.phone_key(a->>'normalized') into phone from jsonb_array_elements(r.payload->'answers') a where a->>'destination'='primary_phone' and a->>'mode' in ('both','profile') limit 1;
 insert into public.clients(primary_name,primary_phone,last_branch_id,lifecycle_stage) values(btrim(p_name),case when phone is null then null else crm_private.as_phone_input(phone) end,branch,'lead') returning client_id into client;
 update crm_private.customer_event_inbox set review_client_id=client,reviewed_by=actor,reviewed_at=clock_timestamp(),review_action='create',review_fingerprint=fingerprint where event_id=p_event_id;
 perform crm_private.write_audit_log('crm.customer_distinct_identity_created',client,jsonb_build_object('event_id',p_event_id,'reason',p_reason));return client;
end $$;
create function public.reject_customer_event(p_event_id text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=crm_private.customer_admin();begin
 if length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'Review reason required' using errcode='22023';end if;
 update crm_private.customer_event_inbox set review_action='reject',reviewed_by=actor,reviewed_at=clock_timestamp(),result='{"outcome":"rejected","reason":"reviewer_rejected"}' where event_id=p_event_id and applied_at is null;
 if not found then raise exception 'Event unavailable for rejection' using errcode='23514';end if;
 perform crm_private.write_audit_log('crm.customer_event_rejected',null,jsonb_build_object('event_id',p_event_id,'reason',p_reason));
end $$;
create function public.verify_customer_external_identity(p_tenant uuid,p_scope text,p_kind text,p_value text,p_client uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=crm_private.customer_admin();begin
 if p_kind not in ('instagram','whatsapp','email','website_chat','external_reference') or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'External identity and evidence reason required' using errcode='22023';end if;
 update crm_private.customer_source_identities set verified=true where tenant_id=p_tenant and scope=p_scope and kind=p_kind and normalized=p_value and client_id=p_client;
 if not found then raise exception 'Existing source identity evidence required' using errcode='23514';end if;
 perform crm_private.write_audit_log('crm.customer_identity_verified',p_client,jsonb_build_object('source_tenant',p_tenant,'kind',p_kind,'reviewer',actor,'reason',p_reason));
end $$;

create function crm_private.customer_evidence_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or tg_table_name='crm_customer_workflow_events' then raise exception 'Customer source evidence is immutable' using errcode='23514';end if;
 if tg_table_name='customer_event_inbox' then
  if (new.event_id,new.tenant_id,new.payload,new.digest,new.received_at) is distinct from(old.event_id,old.tenant_id,old.payload,old.digest,old.received_at) then raise exception 'Customer source evidence is immutable' using errcode='23514';end if;
 elsif (new.mapping_id,new.tenant_id,new.descriptor,new.digest) is distinct from(old.mapping_id,old.tenant_id,old.descriptor,old.digest) then raise exception 'Mapping descriptor is immutable' using errcode='23514';end if;
 return new;
end $$;
create trigger customer_event_evidence_immutable before update or delete on public.crm_customer_workflow_events for each row execute function crm_private.customer_evidence_immutable();
create trigger customer_inbox_evidence_immutable before update or delete on crm_private.customer_event_inbox for each row execute function crm_private.customer_evidence_immutable();
create trigger customer_mapping_evidence_immutable before update or delete on crm_private.customer_mapping_registry for each row execute function crm_private.customer_evidence_immutable();

-- Extend the existing activity view rather than replacing its historical sources.
do $$declare definition text;begin
 definition:=rtrim(pg_get_viewdef('public.crm_client_activity'::regclass,true),E';\n ');
 execute 'create or replace view public.crm_client_activity with(security_invoker=true) as '||definition||
  ' union all select ''fms:''||e.event_id,e.client_id,e.occurred_at,''FMS_CUSTOMER_EVENT''::text,e.channel,e.actor_id,e.branch_id,coalesce(e.workflow->>''stageName'',''Customer enquiry''),jsonb_build_object(''workflow'',e.workflow,''answers'',e.answers),false,''crm_customer_workflow_events''::text,e.event_id from public.crm_customer_workflow_events e';
end $$;
-- Confirmed contacts already appear through crm_contacts: the stage evidence never counts twice.
alter table public.crm_client_browse_state add column customer_city text,add column purchase_classification text not null default 'Unknown';
create index customer_commercial_filter on public.crm_client_browse_state(purchase_classification,client_id);
create function crm_private.customer_commercial_summary(p_client uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with evidence as (
  select t.event_date,crm_private.walkin_purchase_evidence(t.buy_status,t.bought_categories,f.did_buy,f.additional_fields) as purchased,
   crm_private.saved_walkin_status(t.buy_status,f.additional_fields)::text as outcome
  from public.client_timeline t left join public.visit_forms f on f.client_timeline_id=t.id where t.client_id=p_client
 ) select jsonb_build_object('classification',case when bool_or(purchased) then 'Buyer'
  when bool_or(outcome is null and not purchased) then 'Unknown'
  when bool_or(outcome like 'REPAIR%') then 'Repair-only Customer' else 'Non-Buyer/Prospect' end,
  'firstVerifiedPurchase',min(event_date) filter(where purchased),'latestVerifiedPurchase',max(event_date) filter(where purchased),
  'purchaseVisits',count(*) filter(where purchased)) from evidence;
$$;
create function public.get_customer_commercial_summary(p_client uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_user_role() is null or not exists(select 1 from public.clients where client_id=p_client) then raise exception 'Active CRM customer access required' using errcode='42501';end if;
 return crm_private.customer_commercial_summary(p_client);
end $$;
-- Extract the existing native composer without changing its answer precedence. Internal
-- cache/export callers have their own authority; the public-facing wrapper stays gated.
do $$declare definition text;guard text:='if public.current_user_role() is null then raise exception ''active CRM profile required'' using errcode=''42501''; end if;';begin
 definition:=pg_get_functiondef('crm_private.cumulative_profile_answers(uuid)'::regprocedure);
 if position(guard in definition)=0 then raise exception 'Review native cumulative profile authorization marker';end if;
 definition:=replace(definition,'crm_private.cumulative_profile_answers(', 'crm_private.native_customer_profile(');
 definition:=replace(definition,guard,'');
 definition:=replace(definition,'SET search_path', 'SECURITY DEFINER SET search_path');
 execute definition;
end $$;
revoke all on function crm_private.native_customer_profile(uuid) from public,anon,authenticated,service_role;
create or replace function crm_private.cumulative_profile_answers(p_client uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_user_role() is null then raise exception 'active CRM profile required' using errcode='42501';end if;
 return crm_private.effective_customer_profile(p_client);
end $$;

alter function crm_private.refresh_client_browse_state(uuid) rename to refresh_client_browse_state_before_customer_events;
create function crm_private.refresh_client_browse_state(p_client uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform crm_private.refresh_client_browse_state_before_customer_events(p_client);
 update public.crm_client_browse_state set lead_source=coalesce(lead_source,(select channel from public.crm_customer_workflow_events where client_id=p_client order by occurred_at,event_id limit 1)),
  purchase_classification=crm_private.customer_commercial_summary(p_client)->>'classification',
  customer_city=crm_private.effective_customer_profile(p_client)->>'city'
  where client_id=p_client;
end $$;
-- Rebuild only the derived classification cache; no identity or source evidence is rewritten.
update public.crm_client_browse_state b set purchase_classification=crm_private.customer_commercial_summary(b.client_id)->>'classification';

create function crm_private.customer_profile_patch_internal(p_client uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.clients;p record;result jsonb:='{}';native jsonb;begin
 select * into c from public.clients where client_id=p_client;
 native:=crm_private.native_customer_profile(p_client);
 for p in select * from crm_private.customer_attribute_projection where client_id=p_client and destination in ('city','dob','anniversary','communication_preference') loop
  if nullif(btrim(native->>p.destination),'') is not null and upper(btrim(native->>p.destination)) not in('NA','N/A','NULL','UNDEFINED','-') then continue;end if;
  begin
   if p.destination in ('dob','anniversary') and p.value#>>'{}' !~ '^\d{4}-\d{2}-\d{2}$' then continue;end if;
   perform jsonb_populate_record(null::public.clients,jsonb_build_object(p.destination,p.value));
   result:=result||jsonb_build_object(p.destination,p.value);
  exception when data_exception then continue;end;
 end loop;return result;end $$;
revoke all on function crm_private.customer_profile_patch_internal(uuid) from public,anon,authenticated,service_role;
create function crm_private.customer_profile_patch(p_client uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501';end if;
 return crm_private.customer_profile_patch_internal(p_client);
end $$;
create function crm_private.effective_customer_profile(p_client uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select crm_private.native_customer_profile(p_client)||crm_private.customer_profile_patch_internal(p_client);
$$;
revoke all on function crm_private.effective_customer_profile(uuid) from public,anon,authenticated,service_role;

-- Refresh only indexed phone-related cache rows when native evidence changes.
create function crm_private.refresh_customer_family(p_client uuid) returns void language plpgsql security definer set search_path='' as $$
declare target uuid;begin
 for target in select p_client union select sibling.client_id from public.client_phone_index own join public.client_phone_index sibling using(phone) where own.client_id=p_client loop
  perform crm_private.refresh_client_browse_state(target);
 end loop;
end $$;
revoke all on function crm_private.refresh_customer_family(uuid) from public,anon,authenticated,service_role;
do $$declare definition text;begin
 definition:=pg_get_functiondef('crm_private.client_browse_source_changed()'::regprocedure);
 if position('perform crm_private.refresh_client_browse_state(target)' in definition)=0 then raise exception 'Review browse source refresh marker';end if;
 definition:=replace(definition,'perform crm_private.refresh_client_browse_state(target)','perform crm_private.refresh_customer_family(target)');
 execute definition;
end $$;

create function crm_private.customer_client_cache_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;phones text[];begin
 phones:=array[crm_private.stored_phone(new.primary_phone)];
 if tg_op='UPDATE' then phones:=array_append(phones,crm_private.stored_phone(old.primary_phone));end if;
 for target in select new.client_id union select pi.client_id from public.client_phone_index pi where pi.phone=any(phones) loop
  perform crm_private.refresh_client_browse_state(target);
 end loop;
 return null;
end $$;
revoke all on function crm_private.customer_client_cache_changed() from public,anon,authenticated,service_role;
create trigger zzz_customer_client_cache after insert or update on public.clients for each row execute function crm_private.customer_client_cache_changed();

create or replace function public.get_client_profile(p_client_id uuid) returns setof public.clients language plpgsql stable security invoker set search_path='' as $$
declare profile public.clients;begin
 if public.current_user_role() is null then raise exception 'active CRM profile required' using errcode='42501';end if;
 profile:=crm_private.cumulative_client_profile(p_client_id);
 if profile.client_id is not null then
  return next profile;
 end if;
end $$;

-- One bounded Client Database query; optional new classification and cached channel city.
do $$declare definition text;amended text;marker text;begin
 definition:=pg_get_functiondef('public.browse_crm_records_page(jsonb,integer,integer)'::regprocedure);
 if position('c.city,c.state' in definition)=0 or position('from page join public.clients c using(client_id)' in definition)=0 or position('a.lead_source as lead_source' in definition)=0 then raise exception 'Review current CRM browse contract before extending customer filters';end if;
 amended:=replace(definition,'c.city,c.state','coalesce(cp.customer_city,c.city) as city,c.state');
 amended:=replace(amended,'left join activity a using(client_id)','left join public.crm_client_browse_state cp using(client_id) left join activity a using(client_id)');
 amended:=replace(amended,'a.lead_source as lead_source','a.lead_source as lead_source,coalesce(cp.purchase_classification,''Unknown'') as purchase_classification');
 marker:='and (coalesce($1->>''stage'','''')='''' or r.effective_stage=$1->>''stage'')';
 if position(marker in amended)=0 then raise exception 'Review CRM browse filter marker';end if;
 amended:=replace(amended,marker,marker||E'\n and (coalesce($1->>''commercial'','''')='''' or r.purchase_classification=$1->>''commercial'')');
 amended:=replace(amended,'''city'',c.city','''city'',coalesce(cp.customer_city,c.city)');
 amended:=replace(amended,'from page join public.clients c using(client_id)','from page join public.clients c using(client_id) left join public.crm_client_browse_state cp using(client_id)');
 amended:=replace(amended,'''lifecycle_stage'',page.effective_stage)','''lifecycle_stage'',page.effective_stage,''purchase_classification'',coalesce(cp.purchase_classification,''Unknown''))');
 execute amended;
end $$;

create function crm_private.customer_search_ids(p_search text) returns setof uuid language plpgsql stable security definer set search_path='' as $$
declare term text:=lower(btrim(p_search));begin
 if public.current_user_role() is null or length(term) not between 2 and 200 then return;end if;
 return query select distinct e.client_id from crm_private.customer_source_identities e where lower(e.normalized) like replace(replace(replace(term,'\','\\'),'%','\%'),'_','\_')||'%' escape '\'
 union select j.client_id from crm_private.customer_journeys j where lower(j.reference_number) like replace(replace(replace(term,'\','\\'),'%','\%'),'_','\_')||'%' escape '\';
end $$;
alter function public.crm_search_client_ids(text) rename to crm_search_client_ids_before_customer_events;
create function public.crm_search_client_ids(p_search text) returns setof uuid language sql stable security invoker set search_path='' as $$
 select public.crm_search_client_ids_before_customer_events(p_search) union select crm_private.customer_search_ids(p_search);
$$;

revoke all on function crm_private.customer_admin(),crm_private.customer_actor_can_write(uuid,uuid),crm_private.customer_search_ids(text),crm_private.customer_profile_patch(uuid) from public,anon,authenticated,service_role;
grant execute on function crm_private.customer_search_ids(text),crm_private.customer_profile_patch(uuid) to authenticated;
revoke all on function public.configure_customer_source(uuid,boolean),public.approve_customer_mapping(uuid,text),public.get_customer_workflow_history(uuid,timestamptz,text,integer),public.customer_integration_review_queue(),public.review_customer_identity(text,uuid,text),public.crm_search_client_ids(text) from public,anon,authenticated,service_role;
grant execute on function public.configure_customer_source(uuid,boolean),public.approve_customer_mapping(uuid,text),public.get_customer_workflow_history(uuid,timestamptz,text,integer),public.customer_integration_review_queue(),public.review_customer_identity(text,uuid,text),public.crm_search_client_ids(text) to authenticated;
revoke all on function public.crm_register_customer_mapping(uuid,jsonb,text),public.crm_apply_customer_event(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.crm_register_customer_mapping(uuid,jsonb,text),public.crm_apply_customer_event(text,jsonb) to service_role;
revoke all on function public.create_customer_from_event_review(text,text,text),public.reject_customer_event(text,text),public.verify_customer_external_identity(uuid,text,text,text,uuid,text),crm_private.customer_evidence_immutable() from public,anon,authenticated,service_role;
grant execute on function public.create_customer_from_event_review(text,text,text),public.reject_customer_event(text,text),public.verify_customer_external_identity(uuid,text,text,text,uuid,text) to authenticated;
revoke all on function crm_private.refresh_client_browse_state(uuid),public.get_customer_commercial_summary(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_customer_commercial_summary(uuid) to authenticated;
revoke all on function crm_private.customer_commercial_summary(uuid) from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
-- Reconcile imported CRM/Sheet values with retained FMS evidence; never resolves or overwrites.
create function public.preview_customer_reconciliation(p_event_ids text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=crm_private.customer_admin();rows jsonb;begin
 if p_event_ids is null or cardinality(p_event_ids) not between 1 and 200 then raise exception 'Select 1–200 source events' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('eventId',id,'classification',case when e.event_id is null then 'missing_source_event'
 when e.review_reason in('ambiguous_phone','ambiguous_identity','unverified_identity') then 'possible_duplicate'
 when e.applied_at is null then 'invalid_or_incomplete' when e.result->>'created'='true' then 'new_record' else 'matched_record' end,
 'clientId',e.result->>'client_id','conflictingValues',coalesce((select jsonb_agg(jsonb_build_object('fieldKey',answer->>'fieldKey','destination',answer->>'destination','sourceValue',answer->'original','crmValue',to_jsonb(c)->(answer->>'destination')))
 from public.clients c cross join jsonb_array_elements(e.payload->'answers') answer where c.client_id=nullif(e.result->>'client_id','')::uuid
 and answer->>'mode' in('profile','both') and nullif(to_jsonb(c)->>(answer->>'destination'),'') is not null
 and (to_jsonb(c)->(answer->>'destination')) is distinct from answer->'normalized'),'[]'))),'[]') into rows
 from unnest(p_event_ids)id left join crm_private.customer_event_inbox e on e.event_id=id;
 perform crm_private.write_audit_log('crm.customer_reconciliation_preview',null,jsonb_build_object('actor_id',actor,'selected',cardinality(p_event_ids)));
 return jsonb_build_object('dryRun',true,'rows',rows,'counts',(select jsonb_object_agg(classification,n) from(select value->>'classification' classification,count(*) n from jsonb_array_elements(rows) group by value->>'classification')q));
end $$;
revoke all on function public.preview_customer_reconciliation(text[]) from public,anon,authenticated,service_role;
grant execute on function public.preview_customer_reconciliation(text[]) to authenticated;
notify pgrst,'reload schema';
