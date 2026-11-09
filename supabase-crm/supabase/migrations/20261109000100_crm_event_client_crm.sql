-- Saved-submission events name the client's CRM (owner request 2026-11-09).
-- JewelOS 0395 gives a CRM-started FMS task to this person instead of the salesperson.
--
-- crm_jewelos_user_id = the CRM recorded on the walk-in visit, else the CRM the Client Queue
-- chose for this client today (round robin), resolved through the active roster grant. Queue
-- registrations name their queue CRM. Leads have no CRM and send nothing new. The existing
-- staff_jewelos_user_id (salesperson) is unchanged and stays the fallback on the JewelOS side.
-- Already queued events are not rewritten (the outbox is immutable).
set search_path=public,extensions;

create function crm_private.client_crm_jewelos_user(p_client uuid,p_branch uuid,p_crm_name text,p_at timestamptz) returns uuid
language sql stable security definer set search_path='' as $$
  select coalesce(
    crm_private.jewelos_user_for_crm_name(p_branch,nullif(btrim(p_crm_name),'')),
    (select crm_private.jewelos_user_for_crm_name(q.branch_id,q.assigned_crm_name)
       from public.entry_queue q
      where q.client_id=p_client and q.branch_id=p_branch and nullif(btrim(q.assigned_crm_name),'') is not null
        and (q.created_at at time zone 'Asia/Kolkata')::date=(coalesce(p_at,now()) at time zone 'Asia/Kolkata')::date
      order by q.created_at desc,q.id desc limit 1))
$$;

-- Same snapshot as 20261103000200 plus crm_jewelos_user_id.
create or replace function crm_private.walkin_visit_event(p_visit_id uuid) returns jsonb
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
    'crm_jewelos_user_id',crm_private.client_crm_jewelos_user(t.client_id,t.branch_id,t.crm_name,t.event_date),
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

-- Same as 20261103000200 plus crm_jewelos_user_id (the queue's round-robin CRM).
create or replace function crm_private.enqueue_queue_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare q public.entry_queue; c public.clients; b public.branches; v_crm uuid;
begin
  select * into q from public.entry_queue where id=new.id;
  if q.id is null then return null; end if;
  select * into c from public.clients where client_id=q.client_id;
  select * into b from public.branches where id=q.branch_id;
  v_crm:=crm_private.jewelos_user_for_crm_name(q.branch_id,q.assigned_crm_name);
  insert into crm_private.submission_outbox(kind,record_id,payload) values('crm.queue_registered',q.id,jsonb_build_object(
    'kind','crm.queue_registered','occurred_at',q.created_at,'record_id',q.id,'client_id',q.client_id,
    'jewelos_branch_id',b.jewelos_branch_id,'staff_jewelos_user_id',v_crm,'crm_jewelos_user_id',v_crm,
    'answers',jsonb_strip_nulls(jsonb_build_object('is_new_client',q.client_is_new,'token',q.token,
      'registered_date',to_char(q.created_at at time zone 'Asia/Kolkata','YYYY-MM-DD'),'crm_name',q.assigned_crm_name,
      'client_code',c.client_code,'client_name',left(coalesce(c.primary_name,q.client_name),120)))))
  on conflict (kind,record_id) where kind<>'crm.not_bought_case_closed' do nothing;
  return null;
end $$;

-- Same as 20261107000300 plus crm_jewelos_user_id.
create or replace function crm_private.enqueue_form_submission_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.clients; v_branch uuid; b public.branches; visit jsonb; answers jsonb; v_crm uuid;
begin
  if new.purpose not in ('queue','lead','walkin') then return null; end if;
  select * into c from public.clients where client_id=new.client_id;
  if new.record_type='entry_queue' then
    select branch_id,crm_private.jewelos_user_for_crm_name(branch_id,assigned_crm_name) into v_branch,v_crm
      from public.entry_queue where id=new.record_id;
  elsif new.record_type='lead' then
    select branch_id into v_branch from public.leads where id=new.record_id;
  elsif new.record_type='visit' then
    select t.branch_id,crm_private.walkin_visit_event(v.id) into v_branch,visit
      from public.client_timeline t join public.visit_forms v on v.client_timeline_id=t.id
      where t.id=new.record_id;
    if coalesce(visit->>'crm_jewelos_user_id','')<>'' then v_crm:=(visit->>'crm_jewelos_user_id')::uuid; end if;
  end if;
  select * into b from public.branches where id=v_branch;
  -- sourceOf / LinkedWalkinVisit save {answers:{answers:<stored values>,display:<labels>}}.
  -- Older integrations may supply a flat answer object; preserve that supported shape too.
  answers:=case when jsonb_typeof(new.source#>'{answers,answers}')='object' then new.source#>'{answers,answers}'
    when jsonb_typeof(new.source->'answers')='object' then new.source->'answers' else '{}'::jsonb end;
  insert into crm_private.submission_outbox(kind,record_id,payload)
  values('crm.form_submission_saved',new.submission_key,jsonb_build_object(
    'kind','crm.form_submission_saved','occurred_at',new.created_at,'record_id',new.record_id,'client_id',new.client_id,
    'case_id',visit->'case_id','jewelos_branch_id',b.jewelos_branch_id,
    'staff_jewelos_user_id',coalesce(visit->>'staff_jewelos_user_id',crm_private.jewelos_user_for_crm_user(new.actor_id)::text),
    'crm_jewelos_user_id',v_crm,
    'form',jsonb_build_object('formFamilyId',new.source->>'formFamilyId','formTemplateId',new.source->>'formTemplateId','formVersion',new.source->'formVersion','purpose',new.purpose),
    'answers',answers||jsonb_strip_nulls(jsonb_build_object('client_code',c.client_code,'client_name',left(c.primary_name,120)))))
  on conflict (kind,record_id) where kind<>'crm.not_bought_case_closed' do nothing;
  return null;
end $$;

revoke all on function crm_private.client_crm_jewelos_user(uuid,uuid,text,timestamptz),crm_private.walkin_visit_event(uuid),
  crm_private.enqueue_queue_event(),crm_private.enqueue_form_submission_event() from public,anon,authenticated,service_role;
