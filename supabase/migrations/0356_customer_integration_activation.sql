-- Customer integration activation (2026-10-29).
-- 0354 captured customer events correctly but production never produced one: no form had a
-- mapping, the CRM could only see a mapping after its first event, events answered "awaiting
-- approval" or "identity review" stopped for good, stage events waiting on an unresolved
-- starting form were retired after about two hours, and a revised form silently lost its
-- mapping. This migration closes those gaps without auto-approving anything: approval stays an
-- independent CRM decision, and every status read is metadata only (no customer values).
set search_path=public,extensions;

-- 1. CRM approval state per mapping, learned by registering mappings ahead of any event.
create table crm_sync.customer_mapping_registrations(
 mapping_id uuid primary key references public.form_customer_mapping_versions(id),
 tenant_id uuid not null references public.tenants(id),
 crm_outcome text not null check(crm_outcome in ('source_unapproved','mapping_unapproved','accepted','failed')),
 checked_at timestamptz not null default clock_timestamp(),
 next_check_at timestamptz not null default now(),
 accepted_at timestamptz
);
create index customer_mapping_registration_due on crm_sync.customer_mapping_registrations(next_check_at);
alter table crm_sync.customer_mapping_registrations enable row level security;
revoke all on crm_sync.customer_mapping_registrations from public,anon,authenticated,service_role;

-- Status reads look events up by journey (the FMS instance) and by mapping.
create index customer_events_journey on crm_sync.customer_events((payload->>'journeyKey'),created_at);
create index customer_events_mapping on crm_sync.customer_events(mapping_id,created_at);
create index customer_events_review_due on crm_sync.customer_events(next_attempt_at,id)
 where delivered_at is null and dead_at is null and rejected_at is null and review_at is not null;

-- Mappings the CRM must (re)learn: the live enabled mapping of each form, plus any mapping that
-- still has events held for approval.
create function crm_sync_claim_customer_mappings(p_limit integer default 10)
returns table(mapping_id uuid,descriptor jsonb,digest text)
language sql security definer set search_path=public as $$
 select m.id,m.descriptor,m.digest from form_customer_mapping_versions m
 left join crm_sync.customer_mapping_registrations r on r.mapping_id=m.id
 where (r.mapping_id is null or r.next_check_at<=now())
  and ((m.enabled and not(m.descriptor ? 'historicalSnapshotDigest')
        and m.version=(select max(v.version) from form_customer_mapping_versions v where v.template_id=m.template_id and not(v.descriptor ? 'historicalSnapshotDigest')))
   or exists(select 1 from crm_sync.customer_events e where e.mapping_id=m.id and e.delivered_at is null and e.rejected_at is null
        and e.dead_at is null and e.review_at is not null and e.last_error in ('mapping_unapproved','source_unapproved')))
 order by r.next_check_at nulls first,m.created_at,m.id
 limit greatest(1,least(coalesce(p_limit,10),10));
$$;

-- Records what the CRM answered. An approval releases that mapping's held events at once.
create function crm_sync_record_customer_mapping(p_mapping_id uuid,p_outcome text) returns integer
language plpgsql security definer set search_path=public as $$
declare m form_customer_mapping_versions;previous text;released integer:=0;
begin
 select * into m from form_customer_mapping_versions where id=p_mapping_id;
 if m.id is null or p_outcome is null or p_outcome not in ('source_unapproved','mapping_unapproved','accepted','failed') then
  raise exception 'Invalid customer mapping registration' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('customer.mapping.registration.'||m.id,0));
 select crm_outcome into previous from crm_sync.customer_mapping_registrations where mapping_id=m.id;
 insert into crm_sync.customer_mapping_registrations as r(mapping_id,tenant_id,crm_outcome,checked_at,next_check_at,accepted_at)
 values(m.id,m.tenant_id,p_outcome,clock_timestamp(),
  now()+case p_outcome when 'accepted' then interval '6 hours' when 'failed' then interval '10 minutes' else interval '2 minutes' end,
  case when p_outcome='accepted' then clock_timestamp() end)
 on conflict(mapping_id) do update set crm_outcome=excluded.crm_outcome,checked_at=excluded.checked_at,next_check_at=excluded.next_check_at,
  accepted_at=case when excluded.crm_outcome='accepted' then coalesce(r.accepted_at,excluded.accepted_at) else r.accepted_at end;
 if p_outcome='accepted' then
  update crm_sync.customer_events set review_at=null,attempts=0,next_attempt_at=now(),last_error=null
   where mapping_id=m.id and delivered_at is null and rejected_at is null and dead_at is null
    and review_at is not null and last_error in ('mapping_unapproved','source_unapproved')
    and (lease_until is null or lease_until<now());
  get diagnostics released=row_count;
 end if;
 if previous is distinct from p_outcome then
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(m.tenant_id,null,'customer_mapping_crm_status','forms',m.template_id,jsonb_build_object('mapping_id',m.id,'outcome',p_outcome,'previous',previous,'released',released));
 end if;
 return released;
end $$;

-- 2. Events waiting for a CRM identity decision are re-offered every 30 minutes for 30 days, so
-- a decision taken in the CRM completes the link without anyone pressing retry in JewelOS.
-- Events held for approval are released by the mapping registration above instead.
create or replace function crm_sync_claim_customer_events(p_limit integer default 50)
returns table(id uuid,lease_token uuid,payload jsonb,descriptor jsonb,mapping_id uuid,mapping_digest text)
language plpgsql security definer set search_path=public as $$
begin
 return query with due as (select e.id from crm_sync.customer_events e where e.delivered_at is null and e.dead_at is null and e.rejected_at is null
  and (e.review_at is null or (e.last_error not in ('mapping_unapproved','source_unapproved') and e.review_at>now()-interval '30 days'))
  and e.next_attempt_at<=now() and (e.lease_until is null or e.lease_until<now()) order by e.next_attempt_at,e.created_at,e.id for update skip locked limit greatest(1,least(coalesce(p_limit,50),50))),
 claimed as (update crm_sync.customer_events e set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=e.attempts+1 from due where e.id=due.id returning e.*)
 select e.id,e.lease_token,e.payload,m.descriptor,e.mapping_id,m.digest from claimed e join form_customer_mapping_versions m on m.id=e.mapping_id;
end $$;

-- Same acknowledgement contract as 0354, plus: a link clears any earlier review state; a review
-- keeps its first review time (so the 30-day window is real) and schedules its next check; an
-- approval answer tells the mapping registration to look again on the next run; and a stage
-- event waiting for its starting form is never retired early (its backoff is capped at 30 min,
-- and it is retired only after 30 days).
create or replace function crm_sync_finish_customer_event(p_id uuid,p_lease uuid,p_result jsonb,p_error text default null) returns text
language plpgsql security definer set search_path=public as $$
declare e crm_sync.customer_events;outcome text;v_instance_id uuid;v_client_id uuid;dependency boolean:=coalesce(p_error,'')='dependency_pending';
begin
 select * into e from crm_sync.customer_events where id=p_id for update;
 if e.id is null or e.lease_token is distinct from p_lease or e.lease_until<now() then raise exception 'Delivery lease changed' using errcode='40001';end if;
 outcome:=p_result->>'outcome';
 if p_error is null and outcome in ('accepted','duplicate') then
  v_client_id:=nullif(p_result->>'client_id','')::uuid;v_instance_id:=nullif(e.payload#>>'{workflow,instanceId}','')::uuid;
  if v_client_id is null then raise exception 'Customer acknowledgement required' using errcode='22023';end if;
  if v_instance_id is not null then
   insert into crm_sync.customer_workflow_links(tenant_id,instance_id,client_id) values(e.tenant_id,v_instance_id,v_client_id)
   on conflict(instance_id) do update set acknowledged_at=clock_timestamp() where crm_sync.customer_workflow_links.client_id=excluded.client_id;
   if not found then raise exception 'Conflicting customer acknowledgement' using errcode='23514';end if;
  end if;
  update crm_sync.customer_events set delivered_at=clock_timestamp(),review_at=null,result=p_result,lease_until=null,lease_token=null,last_error=null where id=p_id;return 'delivered';
 elsif p_error is null and outcome='rejected' then
  update crm_sync.customer_events set rejected_at=clock_timestamp(),result=p_result,lease_until=null,lease_token=null,last_error='reviewer_rejected' where id=p_id;return 'rejected';
 elsif p_error is null and outcome in ('mapping_unapproved','source_unapproved') then
  update crm_sync.customer_events set review_at=coalesce(review_at,clock_timestamp()),result=p_result,lease_until=null,lease_token=null,last_error=outcome where id=p_id;
  update crm_sync.customer_mapping_registrations set crm_outcome=outcome,next_check_at=least(next_check_at,now()) where mapping_id=e.mapping_id;
  return 'review';
 elsif p_error is null and outcome='review' then
  update crm_sync.customer_events set review_at=coalesce(review_at,clock_timestamp()),result=p_result,lease_until=null,lease_token=null,
   last_error=left(coalesce(nullif(p_result->>'reason',''),'review'),80),next_attempt_at=now()+interval '30 minutes' where id=p_id;
  return 'review';
 end if;
 update crm_sync.customer_events set lease_until=null,lease_token=null,last_error=left(coalesce(p_error,'invalid_result'),80),
  next_attempt_at=now()+make_interval(secs=>least(case when dependency then 1800 else 3600 end,15*power(2,least(attempts,8)))::integer),
  dead_at=case when dependency then case when created_at<now()-interval '30 days' then clock_timestamp() end
   when attempts>=10 then clock_timestamp() end where id=p_id;
 return case when (dependency and e.created_at<now()-interval '30 days') or (not dependency and e.attempts>=10) then 'dead' else 'retry' end;
end $$;

-- 3. One delivery state for a workflow, for the people who can open that work. Metadata only;
-- the CRM customer id is returned only to people with CRM access.
create function crm_sync.customer_event_state(e crm_sync.customer_events) returns text language sql stable set search_path='' as $$
 select case when e.delivered_at is not null then 'linked'
  when e.rejected_at is not null then 'rejected'
  when e.dead_at is not null then 'failed'
  when e.review_at is not null and e.last_error in ('mapping_unapproved','source_unapproved','actor_or_branch_denied','customer_branch_denied') then 'waiting_authorization'
  when e.review_at is not null then 'awaiting_identity_review'
  when e.lease_until is not null and e.lease_until>now() then 'delivering'
  when e.last_error is not null then 'retrying'
  else 'queued' end;
$$;
revoke all on function crm_sync.customer_event_state(crm_sync.customer_events) from public,anon,authenticated,service_role;

create function get_fms_customer_sync_status(p_instance_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();link crm_sync.customer_workflow_links;first_event crm_sync.customer_events;
 pending integer;crm boolean;state text;
begin
 perform assert_module_enabled('fms_builder');
 if a.id is null or not current_profile_is_active() or not exists(select 1 from fms_instances i where i.id=p_instance_id and i.tenant_id=a.tenant_id and
  (i.started_by=a.id or exists(select 1 from fms_instance_stages w where w.fms_instance_id=i.id and can_read_fms_work_context(w.id)))) then raise exception 'Workflow access required' using errcode='42501';end if;
 crm:=module_accessible('crm');
 select * into link from crm_sync.customer_workflow_links where instance_id=p_instance_id and tenant_id=a.tenant_id;
 select count(*) into pending from crm_sync.customer_events e where e.tenant_id=a.tenant_id and e.payload->>'journeyKey'=p_instance_id::text
  and e.delivered_at is null and e.rejected_at is null and e.dead_at is null;
 if link.instance_id is not null then
  return jsonb_build_object('state','linked','pendingUpdates',pending,'linkedAt',link.acknowledged_at,'clientId',case when crm then link.client_id end);
 end if;
 -- The first undelivered event decides the state: later stages wait for the starting form.
 select * into first_event from crm_sync.customer_events e where e.tenant_id=a.tenant_id and e.payload->>'journeyKey'=p_instance_id::text
  and e.delivered_at is null order by e.created_at,e.id limit 1;
 if first_event.id is null then return jsonb_build_object('state','not_configured','pendingUpdates',0);end if;
 state:=crm_sync.customer_event_state(first_event);
 return jsonb_build_object('state',state,'pendingUpdates',pending,'since',first_event.created_at,
  'reason',case when state in ('waiting_authorization','awaiting_identity_review','failed','retrying') then first_event.last_error end);
end $$;
revoke all on function get_fms_customer_sync_status(uuid) from public,anon,authenticated,service_role;
grant execute on function get_fms_customer_sync_status(uuid) to authenticated;

-- 4. Form Builder: offer the previous revision's mapping when a revised form has none (it must
-- be saved again, which the CRM re-approves), and show the CRM's answer for the saved mapping.
create or replace function get_form_customer_mapping(p_template_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();t form_templates;m form_customer_mapping_versions;inherited boolean:=false;r crm_sync.customer_mapping_registrations;begin
 perform assert_module_access('forms_library');
 if a.id is null or not current_profile_is_active() or not has_permission('forms.manage') then raise exception 'Form author access required' using errcode='42501';end if;
 select * into t from form_templates where id=p_template_id and tenant_id=a.tenant_id;
 if t.id is null then return null;end if;
 select * into m from form_customer_mapping_versions v where v.template_id=t.id and v.tenant_id=a.tenant_id and not(v.descriptor ? 'historicalSnapshotDigest') order by v.version desc limit 1;
 if m.id is null then
  select v.* into m from form_customer_mapping_versions v join form_templates o on o.id=v.template_id
   where o.family_id=t.family_id and o.tenant_id=a.tenant_id and v.template_id<>t.id and not(v.descriptor ? 'historicalSnapshotDigest')
   order by o.version desc,v.version desc limit 1;
  inherited:=m.id is not null;
 end if;
 if m.id is null then return null;end if;
 select * into r from crm_sync.customer_mapping_registrations where mapping_id=m.id;
 return to_jsonb(m)||jsonb_build_object('inherited',inherited,'crmStatus',case when inherited then null else r.crm_outcome end,'crmCheckedAt',case when inherited then null else r.checked_at end);
end $$;

-- New mappings carry the form name so the CRM approver sees which form they are approving.
do $$declare definition text;marker text:='''identityScope'',btrim(p_config->>''identityScope''),''fields'',fields,';begin
 definition:=pg_get_functiondef('crm_sync.save_customer_mapping(uuid,jsonb,uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'Review customer mapping descriptor marker';end if;
 execute replace(definition,marker,marker||'''formName'',t.name,');
end $$;

-- 5. One overview for administrators: every customer-relevant form with its setup state and
-- actual delivery, plus the other cross-project connections. Counts and opaque references only.
create function customer_integration_overview() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();forms jsonb;connections jsonb;worker jsonb;begin
 perform assert_module_access('settings');
 if a.id is null or not current_profile_is_active() or not has_permission('settings.manage_organization') then raise exception 'Integration administration required' using errcode='42501';end if;
 with families as (
  select distinct o.family_id from form_customer_mapping_versions v join form_templates o on o.id=v.template_id where v.tenant_id=a.tenant_id
  union select distinct t.family_id from form_submissions s join form_templates t on t.id=s.form_template_id
   where s.tenant_id=a.tenant_id and s.submitted_at>now()-interval '90 days' and exists(select 1 from fms_instance_stages w where w.form_submission_id=s.id)
 ), live as (
  select t.* from families f join lateral(select * from form_templates t where t.family_id=f.family_id and t.tenant_id=a.tenant_id
   order by (t.lifecycle='published' and t.is_active) desc,t.version desc limit 1) t on true
 ), state as (
  select l.id template_id,l.family_id,l.name,l.version template_version,m.id mapping_id,m.version mapping_version,m.enabled,m.template_id mapping_template,
   m.descriptor->>'channel' channel,r.crm_outcome,r.checked_at,
   (m.id is not null and m.template_id=l.id and m.descriptor->>'definitionDigest' is distinct from crm_sync.customer_definition_digest(jsonb_build_object('template',to_jsonb(l),
     'fields',coalesce((select jsonb_agg(to_jsonb(ff) order by ff.sort_order,ff.id) from form_fields ff where ff.form_template_id=l.id),'[]')))) definition_changed,
   exists(select 1 from form_customer_mapping_versions e where e.template_id=m.template_id and e.enabled and e.id<>m.id) was_enabled
  from live l
  left join lateral(select v.* from form_customer_mapping_versions v join form_templates o on o.id=v.template_id where o.family_id=l.family_id and v.tenant_id=a.tenant_id
   and not(v.descriptor ? 'historicalSnapshotDigest') order by o.version desc,v.version desc limit 1) m on true
  left join crm_sync.customer_mapping_registrations r on r.mapping_id=m.id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'templateId',s.template_id,'familyId',s.family_id,'name',s.name,'templateVersion',s.template_version,'mappingVersion',s.mapping_version,'channel',s.channel,
   'setup',case when s.mapping_id is null then 'not_configured'
     when s.mapping_template<>s.template_id or s.definition_changed then 'form_changed'
     when not s.enabled then case when s.was_enabled then 'disabled' else 'draft' end
     when s.crm_outcome is null or s.crm_outcome in ('source_unapproved','mapping_unapproved') then 'awaiting_crm_approval'
     when s.crm_outcome='failed' then 'blocked' else 'active' end,
   'crmOutcome',s.crm_outcome,'crmCheckedAt',s.checked_at,
   'delivery',(select jsonb_build_object(
     'queued',count(*) filter(where crm_sync.customer_event_state(e) in ('queued','delivering','retrying')),
     'waitingAuthorization',count(*) filter(where crm_sync.customer_event_state(e)='waiting_authorization'),
     'identityReview',count(*) filter(where crm_sync.customer_event_state(e)='awaiting_identity_review'),
     'failed',count(*) filter(where crm_sync.customer_event_state(e)='failed'),
     'linked',count(*) filter(where e.delivered_at is not null),
     'delayed',count(*) filter(where e.delivered_at is null and e.rejected_at is null and e.created_at<now()-interval '15 minutes'),
     'oldestPending',min(e.created_at) filter(where e.delivered_at is null and e.rejected_at is null),
     'lastLinkedAt',max(e.delivered_at),
     'lastSourceRef',left((array_agg(e.source_id::text order by e.delivered_at desc nulls last))[1],8),
     'lastClientRef',left((array_agg(e.result->>'client_id' order by e.delivered_at desc nulls last) filter(where e.delivered_at is not null))[1],8))
    from crm_sync.customer_events e join form_customer_mapping_versions v on v.id=e.mapping_id join form_templates o on o.id=v.template_id
    where e.tenant_id=a.tenant_id and o.family_id=s.family_id),
   -- Submitted on the live form while its mapping is active but never captured: a real gap.
   'uncaptured',case when s.mapping_id is not null and s.enabled and s.mapping_template=s.template_id then
     (select count(*) from form_submissions fs where fs.form_template_id=s.template_id and fs.status='submitted'
      and fs.submitted_at>(select created_at from form_customer_mapping_versions where id=s.mapping_id)
      and not exists(select 1 from crm_sync.submission_mappings p where p.submission_id=fs.id)) else 0 end,
   'submissions90d',(select count(*) from form_submissions fs join form_templates o on o.id=fs.form_template_id where o.family_id=s.family_id and fs.status='submitted' and fs.submitted_at>now()-interval '90 days')
  ) order by s.mapping_id is null,s.name),'[]') into forms from state s;
 select jsonb_build_object(
  'rosterToCrm',(select jsonb_build_object('pending',count(*) filter(where delivered_at is null and dead_at is null),'failed',count(*) filter(where dead_at is not null),
    'oldestPending',min(created_at) filter(where delivered_at is null and dead_at is null),'lastDelivered',max(delivered_at)) from crm_sync.outbox),
  'crmWalkinsToTasks',(select jsonb_build_object('received',count(*),'lastReceived',max(received_at)) from crm_sync.inbox),
  'customerWorkflowLinks',(select count(*) from crm_sync.customer_workflow_links where tenant_id=a.tenant_id)) into connections;
 begin
  select jsonb_build_object('lastRun',max(d.start_time),'failedLastDay',count(*) filter(where d.status='failed' and d.start_time>now()-interval '1 day'))
   into worker from cron.job j join cron.job_run_details d on d.jobid=j.jobid where j.jobname='crm-customer-sync-deliver' and d.start_time>now()-interval '1 day';
 exception when others then worker:=null; -- scheduler metadata is optional for this read
 end;
 return jsonb_build_object('forms',forms,'connections',connections,'worker',worker,'generatedAt',now());
end $$;
revoke all on function customer_integration_overview() from public,anon,authenticated,service_role;
grant execute on function customer_integration_overview() to authenticated;

revoke all on function crm_sync_claim_customer_mappings(integer),crm_sync_record_customer_mapping(uuid,text) from public,anon,authenticated,service_role;
grant execute on function crm_sync_claim_customer_mappings(integer),crm_sync_record_customer_mapping(uuid,text) to service_role;
revoke all on function crm_sync_claim_customer_events(integer),crm_sync_finish_customer_event(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function crm_sync_claim_customer_events(integer),crm_sync_finish_customer_event(uuid,uuid,jsonb,text) to service_role;
revoke all on function get_form_customer_mapping(uuid) from public,anon,authenticated,service_role;
grant execute on function get_form_customer_mapping(uuid) to authenticated;
notify pgrst,'reload schema';
