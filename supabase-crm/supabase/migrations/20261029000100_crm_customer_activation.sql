-- Customer integration activation (2026-10-29), CRM side.
-- 1. An optional, audited "roster contributor" authority per approved source. When a CRM super
--    admin switches it on, an active JewelOS roster member may append evidence through an
--    approved mapping even without a CRM login, and to a customer of another branch. Everything
--    else still applies: source approval, exact mapping approval, mapped branch, identity rules.
--    Nobody gets CRM screen access or a CRM role from this; it only lets reviewed FMS evidence in.
-- 2. The review queue shows source state, form names and readable reasons, so approval can be
--    done before the first submission (JewelOS now registers mappings ahead of events).
-- No identity, profile or history row is rewritten.
set search_path=public,extensions;

alter table crm_private.customer_sources
 add column roster_contributors boolean not null default false,
 add column contributors_changed_by uuid references public.users(id),
 add column contributors_changed_at timestamptz;

create function public.configure_customer_contributors(p_tenant uuid,p_enabled boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=crm_private.customer_admin();begin
 if p_tenant is null or p_enabled is null or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
  raise exception 'Source, choice and reason required' using errcode='22023';end if;
 update crm_private.customer_sources set roster_contributors=p_enabled,contributors_changed_by=actor,contributors_changed_at=now() where tenant_id=p_tenant;
 if not found then raise exception 'Approve the source before choosing contributors' using errcode='23514';end if;
 perform crm_private.write_audit_log('crm.customer_contributors_configured',p_tenant,jsonb_build_object('enabled',p_enabled,'reason',btrim(p_reason)));
end $$;

-- CRM users keep the original branch rule; roster contributors need the explicit source switch.
create function crm_private.customer_contribution_allowed(p_tenant uuid,p_source_actor uuid,p_crm_actor uuid,p_branch uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select crm_private.customer_actor_can_write(p_crm_actor,p_branch)
  or (exists(select 1 from crm_private.customer_sources s where s.tenant_id=p_tenant and s.enabled and s.roster_contributors)
   and exists(select 1 from crm_private.master_members mm where mm.jewelos_user_id=p_source_actor and mm.tenant_id=p_tenant and mm.active)
   and exists(select 1 from public.branches b where b.id=p_branch and b.active));
$$;
revoke all on function crm_private.customer_contribution_allowed(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

do $$declare definition text;amended text;gate text:='crm_private.customer_actor_can_write(authority_actor,';
 provenance text:='''reviewerId'',receipt.reviewed_by)';begin
 definition:=pg_get_functiondef('public.crm_apply_customer_event(text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,gate,'')))/length(gate)<>2 or position(provenance in definition)=0 then
  raise exception 'Review customer event authorization markers';end if;
 amended:=replace(definition,gate,'crm_private.customer_contribution_allowed(tenant,(p_payload->>''actorId'')::uuid,authority_actor,');
 amended:=replace(amended,provenance,'''reviewerId'',receipt.reviewed_by,''authority'',case when receipt.reviewed_by is not null then ''reviewer'' when crm_private.customer_actor_can_write(actor,coalesce(known.last_branch_id,branch)) then ''crm_user'' else ''roster_contributor'' end)');
 execute amended;
end $$;

create or replace function public.customer_integration_review_queue() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform crm_private.customer_admin();
 return jsonb_build_object(
  'sources',(select coalesce(jsonb_agg(jsonb_build_object('tenant_id',tenant_id,'enabled',enabled,'approved_at',approved_at,'roster_contributors',roster_contributors,'contributors_changed_at',contributors_changed_at)),'[]') from crm_private.customer_sources),
  'mappings',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select mapping_id,tenant_id,descriptor,digest,registered_at,approved_at,
    (select count(*) from crm_private.customer_event_inbox i where i.payload->>'mappingId'=m.mapping_id::text and i.applied_at is null and i.review_action is distinct from 'reject') as waiting_events
   from crm_private.customer_mapping_registry m order by approved_at is not null,registered_at desc limit 100)r),
  'events',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select event_id,tenant_id,review_reason,candidates,received_at,payload->'answers' as answers,
    payload->>'eventType' as event_type,payload->>'occurredAt' as occurred_at,payload->>'actorName' as actor_name,payload#>>'{workflow,stageName}' as stage_name,
    (select m.descriptor->>'formName' from crm_private.customer_mapping_registry m where m.mapping_id::text=inbox.payload->>'mappingId') as form_name,
    (select coalesce(jsonb_agg(jsonb_build_object('id',c.client_id,'code',c.client_code,'name',c.primary_name)),'[]') from public.clients c where c.client_id=any(inbox.candidates)) as candidate_profiles
   from crm_private.customer_event_inbox inbox where applied_at is null and review_action is distinct from 'reject' order by received_at limit 100)r),
  'reasons',(select coalesce(jsonb_object_agg(coalesce(review_reason,'not_yet_applied'),n),'{}') from(select review_reason,count(*) n from crm_private.customer_event_inbox where applied_at is null and review_action is distinct from 'reject' group by review_reason)q),
  'quality',jsonb_build_object('missingContactIdentity',(select count(*) from public.clients c where c.primary_phone is null and not exists(select 1 from crm_private.customer_source_identities e where e.client_id=c.client_id)),
   'ambiguousEvents',(select count(*) from crm_private.customer_event_inbox where review_reason in('ambiguous_phone','ambiguous_identity','unverified_identity') and applied_at is null),
   'conflictingProfileValues',(select count(*) from crm_private.customer_attribute_projection p join public.clients c using(client_id) where nullif(to_jsonb(c)->>p.destination,'') is not null and (to_jsonb(c)->p.destination) is distinct from p.value),
   'clientsWithoutRecordedVisit',(select count(*) from public.clients c where c.lifecycle_stage not in ('lead','engaged') and c.total_visits=0),
   'eventTableBytes',pg_total_relation_size('public.crm_customer_workflow_events'::regclass)),
  'pending',(select count(*) from crm_private.customer_event_inbox where applied_at is null and review_action is distinct from 'reject'),
  'delivered',(select count(*) from crm_private.customer_event_inbox where applied_at is not null),
  'lastApplied',(select max(applied_at) from crm_private.customer_event_inbox),
  'identities',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select tenant_id,scope,kind,normalized,client_id,source_event_id from crm_private.customer_source_identities where not verified and kind<>'phone' order by tenant_id,scope,kind,normalized limit 100)r));
end $$;

revoke all on function public.configure_customer_contributors(uuid,boolean,text),public.customer_integration_review_queue() from public,anon,authenticated,service_role;
grant execute on function public.configure_customer_contributors(uuid,boolean,text),public.customer_integration_review_queue() to authenticated;
notify pgrst,'reload schema';
