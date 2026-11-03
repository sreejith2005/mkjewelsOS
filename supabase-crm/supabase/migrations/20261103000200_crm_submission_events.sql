-- Saved CRM submissions -> JewelOS FMS start triggers (owner request 2026-11-03).
-- Design: docs/superpowers/specs/2026-11-03-fms-start-triggers-design.md; JewelOS side: 0374.
--
-- The existing walkin.changed outbox coalesces queue-state changes and computes its snapshot at
-- claim time, which suits the walk-in task but can lose the answers of a particular save. This
-- migration adds a separate, append-only stream of saved-submission events:
--   crm.walkin_visit_saved     a detailed walk-in visit (visit_forms) was saved
--   crm.queue_registered       a client was registered in the queue (entry_queue)
--   crm.lead_saved             a lead was saved (leads)
--   crm.form_submission_saved  a Form Builder form linked to queue or lead registration was saved
--   crm.not_bought_case_closed an open Not Bought follow-up case was closed (purchase or call outcome)
-- Each event's snapshot is written once, when the original transaction commits (deferred
-- constraint triggers), and never changes. Nothing in the original saves changes: the triggers
-- only read the saved rows and insert into crm_private.submission_outbox. A rolled-back save never
-- produces an event. sync-deliver claims due events and sends them to JewelOS crm-sync-receive,
-- which deduplicates by event id (crm.sub.<id>). Failures back off exponentially (1 minute to 6
-- hours) and become dead after 10 attempts, with an audit row.
--
-- Snapshots carry identity references (client id, MKC code, display name, case id, JewelOS branch
-- and salesperson) and the visit answers used by FMS conditions. They never carry phone numbers,
-- addresses or media. Visits older than two days when saved (imports and backfills) produce no
-- event, so enabling a workflow never starts runs for history.
set search_path=public,extensions;

create table crm_private.submission_outbox (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('crm.walkin_visit_saved','crm.queue_registered','crm.lead_saved','crm.form_submission_saved','crm.not_bought_case_closed')),
  record_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload)='object' and pg_column_size(payload)<=131072),
  created_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  attempts integer not null default 0 check (attempts>=0),
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  dead_at timestamptz,
  last_error text check (char_length(last_error)<=200)
);
-- One event per saved record; a case may close more than once over its life.
create unique index submission_outbox_once on crm_private.submission_outbox(kind,record_id) where kind<>'crm.not_bought_case_closed';
create index submission_outbox_due on crm_private.submission_outbox(next_attempt_at,id) where delivered_at is null and dead_at is null;
revoke all on crm_private.submission_outbox from public,anon,authenticated,service_role;

create function crm_private.submission_outbox_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' or (new.kind,new.record_id,new.payload,new.created_at) is distinct from (old.kind,old.record_id,old.payload,old.created_at) then
    raise exception 'Submission events cannot be changed' using errcode='42501';
  end if;
  return new;
end $$;
create trigger submission_outbox_immutable before update or delete on crm_private.submission_outbox
  for each row execute function crm_private.submission_outbox_immutable();

-- JewelOS person for a CRM user id (active roster grant), or null.
create function crm_private.jewelos_user_for_crm_user(p_crm_user uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select g.jewelos_user_id from public.crm_sso_access_grants g where g.legacy_crm_user_id=p_crm_user and g.active order by g.jewelos_user_id limit 1
$$;
-- JewelOS person for a CRM name in a branch (the queue's salesperson), as walkin_snapshot resolves it.
create function crm_private.jewelos_user_for_crm_name(p_branch uuid,p_name text) returns uuid
language sql stable security definer set search_path='' as $$
  select g.jewelos_user_id
  from public.crm_allocation a
  join public.crm_sso_access_grants g on g.legacy_crm_user_id=a.crm_user_id and g.active
  where a.branch_id=p_branch and public.normalize_crm_roster_value(a.crm_name)=public.normalize_crm_roster_value(p_name)
  order by a.active desc,a.id limit 1
$$;

create function crm_private.walkin_visit_event(p_visit_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v public.visit_forms; t public.client_timeline; c public.clients; b public.branches; f public.not_bought_followups; v_status text; v_seen integer;
begin
  select * into v from public.visit_forms where id=p_visit_id;
  select * into t from public.client_timeline where id=v.client_timeline_id;
  if v.id is null or t.id is null then return null; end if;
  select * into c from public.clients where client_id=t.client_id;
  select * into b from public.branches where id=t.branch_id;
  select * into f from public.not_bought_followups
    where client_id=t.client_id and not public.not_bought_followup_status_is_done(status) order by created_at limit 1;
  v_status:=upper(btrim(coalesce(nullif(v.additional_fields->>'visit_status',''),t.buy_status::text,'')));
  select count(*) into v_seen from unnest(coalesce(t.seen_categories,array[]::text[])) item(value) where upper(btrim(item.value)) not in ('','NA','N/A','-','NONE');
  return jsonb_build_object(
    'kind','crm.walkin_visit_saved','occurred_at',t.event_date,'record_id',v.id,'client_id',t.client_id,'case_id',f.id,
    'jewelos_branch_id',b.jewelos_branch_id,
    'staff_jewelos_user_id',coalesce(crm_private.jewelos_user_for_crm_user(t.salesperson_id),crm_private.jewelos_user_for_crm_name(t.branch_id,t.crm_name)),
    'answers',jsonb_strip_nulls(jsonb_build_object(
      'visit_status',nullif(v_status,''),
      'client_bought',case when v_status in ('YES','YES_AND_ORDER_PLACED','YES AND ORDER_PLACED','PRODUCT_EXCHANGE') or v_status like '%\_AND\_BUYING\_NEW\_PRODUCT' then 'YES' else 'NO' end,
      'not_bought_reasons',to_jsonb(coalesce(v.not_bought_reasons,array[]::text[])),
      'not_bought_other',nullif(btrim(v.not_bought_other),''),
      'product_requirement',nullif(btrim(t.product_requirement),''),
      'seen_categories',to_jsonb(coalesce(t.seen_categories,array[]::text[])),
      'seen_count',v_seen,
      'bought_categories',to_jsonb(coalesce(t.bought_categories,array[]::text[])),
      'order_categories',to_jsonb(coalesce(t.order_categories,array[]::text[])),
      'visit_date',to_char(t.event_date at time zone 'Asia/Kolkata','YYYY-MM-DD'),
      'next_visit_date',to_char(c.next_visit_date,'YYYY-MM-DD'),
      'client_type',v.client_type,
      'bridal_or_non_bridal',v.bridal_or_non_bridal,
      'source_of_lead',v.source_of_lead,
      'has_open_followup',f.id is not null,
      'reference_number',t.reference_number,
      'crm_name',t.crm_name,
      'client_code',c.client_code,
      'client_name',left(c.primary_name,120))));
end $$;

create function crm_private.enqueue_walkin_visit_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare payload jsonb:=crm_private.walkin_visit_event(new.id);
begin
  if payload is null or (payload->>'occurred_at')::timestamptz<now()-interval '2 days' then return null; end if;
  insert into crm_private.submission_outbox(kind,record_id,payload) values('crm.walkin_visit_saved',new.id,payload)
  on conflict (kind,record_id) where kind<>'crm.not_bought_case_closed' do nothing;
  return null;
end $$;
create constraint trigger visit_forms_submission_event after insert on public.visit_forms
  deferrable initially deferred for each row execute function crm_private.enqueue_walkin_visit_event();

create function crm_private.enqueue_queue_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare q public.entry_queue; c public.clients; b public.branches;
begin
  select * into q from public.entry_queue where id=new.id;
  if q.id is null then return null; end if;
  select * into c from public.clients where client_id=q.client_id;
  select * into b from public.branches where id=q.branch_id;
  insert into crm_private.submission_outbox(kind,record_id,payload) values('crm.queue_registered',q.id,jsonb_build_object(
    'kind','crm.queue_registered','occurred_at',q.created_at,'record_id',q.id,'client_id',q.client_id,
    'jewelos_branch_id',b.jewelos_branch_id,'staff_jewelos_user_id',crm_private.jewelos_user_for_crm_name(q.branch_id,q.assigned_crm_name),
    'answers',jsonb_strip_nulls(jsonb_build_object('is_new_client',q.client_is_new,'token',q.token,
      'registered_date',to_char(q.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD'),'crm_name',q.assigned_crm_name,
      'client_code',c.client_code,'client_name',left(coalesce(c.primary_name,q.client_name),120)))))
  on conflict (kind,record_id) where kind<>'crm.not_bought_case_closed' do nothing;
  return null;
end $$;
create constraint trigger entry_queue_submission_event after insert on public.entry_queue
  deferrable initially deferred for each row execute function crm_private.enqueue_queue_event();

create function crm_private.enqueue_lead_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare l public.leads; b public.branches;
begin
  select * into l from public.leads where id=new.id;
  if l.id is null then return null; end if;
  select * into b from public.branches where id=l.branch_id;
  insert into crm_private.submission_outbox(kind,record_id,payload) values('crm.lead_saved',l.id,jsonb_build_object(
    'kind','crm.lead_saved','occurred_at',l.created_at,'record_id',l.id,
    'jewelos_branch_id',b.jewelos_branch_id,'staff_jewelos_user_id',crm_private.jewelos_user_for_crm_user(l.created_by),
    'answers',jsonb_strip_nulls(jsonb_build_object('source_channel',l.source_channel::text,'created_via',l.created_via::text,
      'created_date',to_char(l.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD'),'lead_name',left(l.name,120)))))
  on conflict (kind,record_id) where kind<>'crm.not_bought_case_closed' do nothing;
  return null;
end $$;
create constraint trigger leads_submission_event after insert on public.leads
  deferrable initially deferred for each row execute function crm_private.enqueue_lead_event();

-- A linked Form Builder form: its answers as entered (JewelOS drops phone and file questions on receipt).
create function crm_private.enqueue_form_submission_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.clients; v_branch uuid; b public.branches;
begin
  if new.purpose not in ('queue','lead') then return null; end if;
  select * into c from public.clients where client_id=new.client_id;
  if new.record_type='entry_queue' then select branch_id into v_branch from public.entry_queue where id=new.record_id;
  elsif new.record_type='lead' then select branch_id into v_branch from public.leads where id=new.record_id; end if;
  select * into b from public.branches where id=v_branch;
  insert into crm_private.submission_outbox(kind,record_id,payload) values('crm.form_submission_saved',new.submission_key,jsonb_build_object(
    'kind','crm.form_submission_saved','occurred_at',new.created_at,'record_id',new.record_id,'client_id',new.client_id,
    'jewelos_branch_id',b.jewelos_branch_id,'staff_jewelos_user_id',crm_private.jewelos_user_for_crm_user(new.actor_id),
    'form',jsonb_build_object('formFamilyId',new.source->>'formFamilyId','formTemplateId',new.source->>'formTemplateId','formVersion',new.source->'formVersion','purpose',new.purpose),
    'answers',coalesce(new.source->'answers','{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('client_code',c.client_code,'client_name',left(c.primary_name,120)))))
  on conflict (kind,record_id) where kind<>'crm.not_bought_case_closed' do nothing;
  return null;
end $$;
create constraint trigger form_submission_links_submission_event after insert on crm_private.form_submission_links
  deferrable initially deferred for each row execute function crm_private.enqueue_form_submission_event();

create function crm_private.enqueue_not_bought_closed_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.branches;
begin
  if public.not_bought_followup_status_is_done(old.status) or not public.not_bought_followup_status_is_done(new.status) then return null; end if;
  select * into b from public.branches where id=new.branch_id;
  insert into crm_private.submission_outbox(kind,record_id,payload) values('crm.not_bought_case_closed',new.id,jsonb_build_object(
    'kind','crm.not_bought_case_closed','occurred_at',clock_timestamp(),'record_id',new.id,'case_id',new.id,'client_id',new.client_id,
    'jewelos_branch_id',b.jewelos_branch_id,'status',left(new.status,80)));
  return null;
end $$;
create trigger not_bought_followups_closed_event after update of status on public.not_bought_followups
  for each row execute function crm_private.enqueue_not_bought_closed_event();

-- Delivery (service role, called by sync-deliver).
create function public.crm_sync_claim_submission_events(p_limit integer default 50)
returns table(event_id bigint,kind text,payload jsonb)
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  return query
  with due as (
    select o.id from crm_private.submission_outbox o
    where o.delivered_at is null and o.dead_at is null and o.next_attempt_at<=now()
    order by o.next_attempt_at,o.id
    limit greatest(1,least(coalesce(p_limit,50),200))
    for update skip locked
  ), claimed as (
    update crm_private.submission_outbox o
    set claimed_at=clock_timestamp(),attempts=o.attempts+1,next_attempt_at=now()+interval '5 minutes'
    from due where o.id=due.id
    returning o.id,o.kind,o.payload
  )
  select claimed.id,claimed.kind,claimed.payload from claimed order by claimed.id;
end $$;

create function public.crm_sync_finish_submission_event(p_event_id bigint,p_ok boolean,p_error text default null) returns text
language plpgsql security definer set search_path='' as $$
declare v_event crm_private.submission_outbox; v_error text:=case when p_error~'^[a-z0-9_.:-]{1,80}$' then p_error else 'error' end;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  select * into v_event from crm_private.submission_outbox where id=p_event_id for update;
  if v_event.id is null or v_event.delivered_at is not null or v_event.dead_at is not null or v_event.claimed_at is null then return 'ignored'; end if;
  if p_ok then
    update crm_private.submission_outbox set delivered_at=now(),last_error=null where id=v_event.id;
    return 'delivered';
  end if;
  if v_event.attempts>=10 then
    update crm_private.submission_outbox set dead_at=now(),last_error=v_error where id=v_event.id;
    perform crm_private.write_audit_log('crm.submission_event_dead',v_event.record_id,
      jsonb_build_object('event_id',v_event.id,'kind',v_event.kind,'attempts',v_event.attempts,'error',v_error));
    return 'dead';
  end if;
  update crm_private.submission_outbox
  set next_attempt_at=now()+least(interval '1 minute'*power(2,greatest(v_event.attempts-1,0)),interval '6 hours'),last_error=v_error
  where id=v_event.id;
  return 'retry';
end $$;

-- Counts only, for Super Admin sync health.
create function public.crm_submission_events_health() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if public.current_user_role() is distinct from 'super_admin' then raise exception 'super admin access is required' using errcode='42501'; end if;
  return jsonb_build_object(
    'open',(select count(*) from crm_private.submission_outbox o where o.delivered_at is null and o.dead_at is null),
    'failing',(select count(*) from crm_private.submission_outbox o where o.delivered_at is null and o.dead_at is null and o.last_error is not null),
    'dead',(select count(*) from crm_private.submission_outbox o where o.dead_at is not null),
    'oldest_open_at',(select min(o.created_at) from crm_private.submission_outbox o where o.delivered_at is null and o.dead_at is null),
    'last_delivered_at',(select max(o.delivered_at) from crm_private.submission_outbox o));
end $$;

revoke all on function crm_private.submission_outbox_immutable(),crm_private.jewelos_user_for_crm_user(uuid),crm_private.jewelos_user_for_crm_name(uuid,text),
  crm_private.walkin_visit_event(uuid),crm_private.enqueue_walkin_visit_event(),crm_private.enqueue_queue_event(),crm_private.enqueue_lead_event(),
  crm_private.enqueue_form_submission_event(),crm_private.enqueue_not_bought_closed_event()
  from public,anon,authenticated,service_role;
revoke all on function public.crm_sync_claim_submission_events(integer),public.crm_sync_finish_submission_event(bigint,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.crm_sync_claim_submission_events(integer),public.crm_sync_finish_submission_event(bigint,boolean,text) to service_role;
revoke all on function public.crm_submission_events_health() from public,anon,service_role;
grant execute on function public.crm_submission_events_health() to authenticated;

notify pgrst,'reload schema';
