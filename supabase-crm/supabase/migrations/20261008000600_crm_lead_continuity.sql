-- Preserve original lead evidence; project only missing profile fields. Contacts never
-- enter client_timeline, whose triggers maintain visit/purchase totals.
create table crm_private.lead_profile_contributions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  client_id uuid not null references public.clients(client_id),
  field_key text not null,
  value jsonb not null,
  applied boolean not null,
  contributed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  applied_at timestamptz,
  unique(lead_id,field_key,value)
);
revoke all on crm_private.lead_profile_contributions from public,anon,authenticated,service_role;

create function crm_private.project_lead_profile(p_lead uuid,p_apply boolean default true,p_count_conflicts boolean default false) returns integer
language plpgsql security definer set search_path='' as $$
declare l public.leads; c public.clients; k text; source_key text; v text;
  patch jsonb := '{}'::jsonb; did_apply boolean; n integer := 0; conflicts integer := 0; converted jsonb; max_lengths jsonb;
begin
  select * into l from public.leads where id=p_lead;
  if l.client_id is null then return 0; end if;
  select * into c from public.clients where client_id=l.client_id for update;
  select jsonb_object_agg(column_name,character_maximum_length) into max_lengths
    from information_schema.columns where table_schema='public' and table_name='clients';
  for k in select unnest(array['gender','dob','anniversary','country','state','city','city_other',
    'pincode','address','community','community_other','beverage','sugar','snack',
    'communication_preference','client_potential_category','high_potential_reason',
    'secondary_phone','billing_phone','google_review_status','testimonial_status','instagram_status']) loop
    source_key := k;
    if nullif(btrim(l.field_values->>k),'') is null then
      source_key := case k when 'dob' then 'date_of_birth' when 'anniversary' then 'anniversary_date'
        when 'community' then case when l.field_values ? 'community_caste' then 'community_caste' else 'caste' end
        when 'beverage' then 'beverages' when 'sugar' then 'sugar_option' when 'snack' then 'snack_option'
        when 'address' then 'full_address' when 'google_review_status' then 'google_reviews'
        when 'testimonial_status' then 'testimonial' when 'instagram_status' then 'instagram_followers'
        when 'pincode' then 'pin_code' else k end;
    end if;
    v := nullif(btrim(l.field_values->>source_key),'');
    if v is null then continue; end if;
    -- Invalid historical dates stay in the original lead JSON, never cast or guessed.
    if k in ('dob','anniversary') then
      begin
        if v !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
        converted := to_jsonb(v::date);
      exception when datetime_field_overflow or invalid_datetime_format then continue;
      end;
    else converted := to_jsonb(v); end if;
    did_apply := nullif(btrim(to_jsonb(c)->>k),'') is null;
    if k in ('secondary_phone','billing_phone') then
      begin
        if crm_private.phone_key(v) is null then did_apply:=false;
        else converted:=to_jsonb(crm_private.phone_key(v)); end if;
      exception when invalid_parameter_value or check_violation or invalid_text_representation then did_apply:=false;
      end;
    end if;
    -- Respect the actual varchar limits; oversized historical answers remain evidence.
    if length(v)>(max_lengths->>k)::integer then
      did_apply := false;
    end if;
    if not did_apply and nullif(btrim(to_jsonb(c)->>k),'') is not null and to_jsonb(c)->k is distinct from converted then conflicts:=conflicts+1; end if;
    if p_apply then insert into crm_private.lead_profile_contributions(lead_id,client_id,field_key,value,applied,contributed_at,applied_at)
      values(l.id,l.client_id,k,converted,did_apply,l.created_at,case when did_apply then clock_timestamp() end)
      on conflict(lead_id,field_key,value) do update set applied=true,applied_at=coalesce(lead_profile_contributions.applied_at,excluded.applied_at)
      where not lead_profile_contributions.applied and excluded.applied;
    end if;
    if did_apply then patch := patch || jsonb_build_object(k,converted); n := n+1; end if;
  end loop;
  v:=nullif(btrim(l.field_values->>'alternate_name'),'');
  if v is not null and length(v)<=160 and upper(v)<>upper(c.primary_name)
    and not exists(select 1 from unnest(c.other_names) existing where upper(existing)=upper(v)) then
    patch:=patch||jsonb_build_object('other_names',to_jsonb(coalesce(c.other_names,'{}'::text[])||v)); n:=n+1;
    if p_apply then insert into crm_private.lead_profile_contributions(lead_id,client_id,field_key,value,applied,contributed_at,applied_at)
      values(l.id,l.client_id,'other_names',to_jsonb(v),true,l.created_at,clock_timestamp()) on conflict(lead_id,field_key,value) do update set applied=true,applied_at=coalesce(lead_profile_contributions.applied_at,excluded.applied_at) where not lead_profile_contributions.applied; end if;
  end if;
  if n>0 and p_apply then
    -- Whitelist keys above; jsonb_populate_record preserves typed dates and existing values.
    c := jsonb_populate_record(c,patch);
    update public.clients set gender=c.gender,dob=c.dob,anniversary=c.anniversary,country=c.country,
      state=c.state,city=c.city,city_other=c.city_other,pincode=c.pincode,address=c.address,
      community=c.community,community_other=c.community_other,beverage=c.beverage,sugar=c.sugar,
      snack=c.snack,communication_preference=c.communication_preference,
      client_potential_category=c.client_potential_category,high_potential_reason=c.high_potential_reason,
      other_names=c.other_names,secondary_phone=c.secondary_phone,billing_phone=c.billing_phone,google_review_status=c.google_review_status,
      testimonial_status=c.testimonial_status,instagram_status=c.instagram_status where client_id=l.client_id;
    perform crm_private.write_audit_log('crm.lead_profile_projected',l.client_id,
      jsonb_build_object('lead_id',l.id,'fields',to_jsonb(array(select jsonb_object_keys(patch)))));
  end if;
  return case when p_count_conflicts then conflicts else n end;
end $$;
create function crm_private.lead_profile_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform crm_private.project_lead_profile(new.id); return null; end $$;
create trigger leads_project_profile after insert or update of field_values on public.leads
for each row execute function crm_private.lead_profile_changed();
revoke all on function crm_private.project_lead_profile(uuid,boolean,boolean),crm_private.lead_profile_changed()
from public,anon,authenticated,service_role;

create function public.reconcile_crm_lead_profiles(p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n integer:=0; affected integer:=0; conflicts integer:=0; l record;
begin
  if not coalesce(public.is_super_admin(),false) then raise exception 'CRM admin required' using errcode='42501'; end if;
  for l in select id from public.leads where client_id is not null order by created_at,id loop
    n:=n+1;
    conflicts:=conflicts+crm_private.project_lead_profile(l.id,false,true);
    affected:=affected+crm_private.project_lead_profile(l.id,p_apply);
  end loop;
  if p_apply then perform crm_private.write_audit_log('crm.lead_profiles_reconciled',null,jsonb_build_object('leads',n,'fields_filled',affected,'fields_conflicting',conflicts)); end if;
  return jsonb_build_object('apply',p_apply,'leads_checked',n,'fields_filled',affected,'fields_conflicting',conflicts);
end $$;

create function public.save_crm_lead(p_phone text,p_name text,p_fields jsonb) returns public.leads
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.current_crm_user_id(); branch uuid:=public.current_user_branch_id();
  saved public.leads; f public.lead_form_fields; k text; shown text[]; expanded text[];
begin
  if actor is null or public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501'; end if;
  p_phone:=crm_private.phone_key(p_phone);
  if p_phone is null then raise exception 'A valid mobile number is required' using errcode='22023'; end if;
  if length(coalesce(p_name,''))>160 or jsonb_typeof(p_fields) is distinct from 'object' or octet_length(p_fields::text)>65536 then
    raise exception 'Invalid lead details' using errcode='22023'; end if;
  -- Conditional fields use the same durable configured triggers as the lead renderer.
  select coalesce(array_agg(field_key),'{}') into shown from public.lead_form_fields
    where not is_hidden and field_key not in ('source_of_lead','type_of_calling','name_of_exhibition','exhibition_name','invitation_offer_name');
  loop
    select coalesce(array_agg(distinct o.triggers_field_key),'{}') into expanded
    from public.lead_form_field_options o join public.lead_form_fields configured on configured.id=o.field_id
    where configured.field_key=any(shown) and o.option_value=p_fields->>configured.field_key and o.triggers_field_key is not null;
    exit when expanded <@ shown;
    shown:=shown||expanded;
  end loop;
  for k in select jsonb_object_keys(p_fields) loop
    if not k=any(shown) or jsonb_typeof(p_fields->k) is distinct from 'string' then raise exception 'Invalid lead field' using errcode='22023'; end if;
  end loop;
  for f in select * from public.lead_form_fields where not is_hidden and field_key=any(shown) loop
    if f.is_mandatory and nullif(btrim(case f.field_key when 'mobile_no' then p_phone when 'name' then p_name else p_fields->>f.field_key end),'') is null then
      raise exception 'A required lead field is missing' using errcode='22023'; end if;
    if f.field_type='date' and nullif(p_fields->>f.field_key,'') is not null then
      if (p_fields->>f.field_key) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date' using errcode='22023'; end if;
      perform (p_fields->>f.field_key)::date;
    end if;
    if f.field_type='dropdown' and f.option_source is null and nullif(p_fields->>f.field_key,'') is not null
      and not exists(select 1 from public.lead_form_field_options o where o.field_id=f.id and o.option_value=p_fields->>f.field_key) then
      raise exception 'Invalid lead option' using errcode='22023'; end if;
  end loop;
  insert into public.leads(phone_number,name,field_values,created_by,branch_id)
    values('+'||p_phone,nullif(btrim(p_name),''),p_fields,actor,branch) returning * into saved;
  select * into saved from public.leads where id=saved.id; -- AFTER identity trigger has linked the client.
  perform crm_private.write_audit_log('crm.lead_saved',saved.id,jsonb_build_object('client_id',saved.client_id));
  return saved;
end $$;
-- Existing post-call and direct legacy callers omit branch. Derive it from
-- the authorized actor before the restrictive branch policy is evaluated.
create function crm_private.assign_lead_branch() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.branch_id is null and public.current_crm_user_id() is not null then
  new.branch_id:=public.current_user_branch_id();
 end if;
 return new;
end $$;
create trigger leads_assign_branch before insert on public.leads for each row execute function crm_private.assign_lead_branch();
revoke all on function crm_private.assign_lead_branch() from public,anon,authenticated,service_role;
create policy leads_branch_create on public.leads as restrictive for insert to authenticated
with check (public.is_super_admin() or (branch_id=public.current_user_branch_id()));

-- Preserve the existing deterministic phone lookup and its identity behavior.
create function public.lookup_client_profile_by_phone(p_phone text) returns setof public.clients
language sql stable set search_path='' as $$
 select c.* from public.lookup_client_by_phone(p_phone) m join public.clients c on c.client_id=m.client_id;
$$;

create table public.crm_contacts (
 id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(client_id),
 kind text not null check(kind in ('CALL','MESSAGE','THANK_YOU','NOTE')),
 channel text not null check(channel in ('PHONE','WHATSAPP','INSTAGRAM','EMAIL','IN_PERSON','OTHER')),
 note text not null check(length(btrim(note)) between 1 and 4000),
 actor_id uuid not null references public.users(id),branch_id uuid references public.branches(id),
 occurred_at timestamptz not null default clock_timestamp(),request_key uuid not null,
 unique(actor_id,request_key)
);
alter table public.crm_contacts enable row level security;
create policy crm_contacts_read on public.crm_contacts for select to authenticated using ((select public.current_user_role()) is not null);
revoke all on public.crm_contacts from public,anon,authenticated,service_role;
grant select on public.crm_contacts to authenticated;
create index crm_contacts_client_time on public.crm_contacts(client_id,occurred_at desc);
create function public.record_crm_contact(p_client uuid,p_kind text,p_channel text,p_note text,p_request uuid)
returns public.crm_contacts language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.current_crm_user_id(); branch uuid; saved public.crm_contacts;
begin
 if actor is null or public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501'; end if;
 select last_branch_id into branch from public.clients where client_id=p_client;
 if branch is null then branch:=public.current_user_branch_id(); end if;
 if not coalesce(public.is_super_admin() or public.is_branch_staff(branch),false) then raise exception 'Client branch access required' using errcode='42501'; end if;
 if p_request is null then raise exception 'Request key required' using errcode='22023'; end if;
 insert into public.crm_contacts(client_id,kind,channel,note,actor_id,branch_id,request_key)
 values(p_client,p_kind,p_channel,btrim(p_note),actor,branch,p_request)
 on conflict(actor_id,request_key) do nothing returning * into saved;
 if saved.id is null then
   select * into saved from public.crm_contacts where actor_id=actor and request_key=p_request;
   if (saved.client_id,saved.kind,saved.channel,saved.note) is distinct from (p_client,p_kind,p_channel,btrim(p_note)) then
     raise exception 'Request key already used' using errcode='22023'; end if;
 else perform crm_private.write_audit_log('crm.contact_recorded',saved.id,jsonb_build_object('client_id',p_client,'kind',p_kind)); end if;
 return saved;
end $$;

-- Invoker projection: all underlying reader policies still apply. No history copies,
-- migration-time contact dates, or duplicated rows on reconciliation.
create view public.crm_client_activity with (security_invoker=true) as
select 'lead:'||l.id as activity_id,l.client_id,l.created_at as occurred_at,'LEAD_REGISTERED'::text as kind,
 coalesce(l.field_values->>'source_of_lead',l.source_channel::text) as channel,l.created_by as actor_id,l.branch_id,
 l.name::text as note,l.field_values as details,true as is_contact,'leads'::text as source_table,l.id::text as source_id
from public.leads l where l.client_id is not null
union all select 'lead-call:'||h.id,l.client_id,h.created_at,'LEAD_CALL','PHONE',h.entered_by,l.branch_id,
 h.remark,to_jsonb(h)-'recording_storage_path',true,'lead_call_history',h.id::text
from public.lead_call_history h join public.leads l on l.id=h.lead_id
union all select 'lead-stage:'||h.id,l.client_id,h.changed_at,'LEAD_STAGE_CHANGED',l.source_channel::text,h.changed_by,l.branch_id,
 h.notes,to_jsonb(h),false,'lead_stage_history',h.id::text from public.lead_stage_history h join public.leads l on l.id=h.lead_id
union all select 'visit:'||t.id,t.client_id,t.event_date,t.event_type::text,'IN_PERSON',t.salesperson_id,t.branch_id,t.remark,
 jsonb_build_object('reference_number',t.reference_number,'buy_status',t.buy_status),true,'client_timeline',t.id::text from public.client_timeline t
union all select 'queue:'||q.id,q.client_id,q.created_at,'WALKIN_REGISTERED','IN_PERSON',null::uuid,q.branch_id,q.remark,
 jsonb_build_object('token',q.token),true,'entry_queue',q.id::text from public.entry_queue q where q.client_id is not null
union all select 'followup:'||h.id,f.client_id,h.created_at,'FOLLOWUP','PHONE',h.updated_by,f.branch_id,h.remark,to_jsonb(h),
 coalesce(h.call_response,'') not like 'AUTO CLOSED%' and coalesce(h.call_response,'') not like 'CLIENT REVISITED%',
 'not_bought_history',h.id::text from public.not_bought_history h join public.not_bought_followups f on f.id=h.followup_id
union all select 'referral-followup:'||h.id,r.referred_client_id,h.created_at,'REFERRAL_FOLLOWUP','PHONE',h.updated_by,r.branch_id,
 h.remark,to_jsonb(h),h.status<>'CONVERTED TO CLIENT' or h.source='CRM CONTACT FOLLOW UP FORM','referral_calling_history',h.id::text
 from public.referral_calling_history h join public.referral_calling f on f.id=h.referral_calling_id join public.referrals r on r.id=f.referral_id
union all select 'engagement:'||f.id||':'||action.key,t.client_id,t.event_date,'ENGAGEMENT_ASK','IN_PERSON',t.salesperson_id,t.branch_id,
 action.key,jsonb_build_object('asked',action.asked,'reason',action.reason),true,'visit_forms',f.id::text
 from public.visit_forms f join public.client_timeline t on t.id=f.client_timeline_id
 cross join lateral (values
 ('instagram',f.instagram_asked,f.instagram_no_reason),('google_review',f.google_review_asked,f.google_review_no_reason),
 ('testimonial',f.testimonial_asked,f.testimonial_no_reason),('feedback_form',f.feedback_form_asked,f.feedback_form_no_reason),
 ('thank_you_note',f.thank_you_note_asked,f.thank_you_note_no_reason),('referrals',f.referrals_asked,f.referrals_no_reason)
 ) action(key,asked,reason) where action.asked is not null
union all select 'contact:'||c.id,c.client_id,c.occurred_at,c.kind,c.channel,c.actor_id,c.branch_id,c.note,'{}'::jsonb,true,'crm_contacts',c.id::text from public.crm_contacts c
union all select 'edit:'||e.id,e.client_id,e.created_at,'PROFILE_EDIT',null::text,e.edited_by,null::uuid,e.field_name,
 jsonb_build_object('old_value',e.old_value,'new_value',e.new_value),false,'client_edit_log',e.id::text from public.client_edit_log e;
revoke all on public.crm_client_activity from public,anon,authenticated,service_role;
grant select on public.crm_client_activity to authenticated;
create view public.crm_client_activity_summary with (security_invoker=true) as
select client_id,min(occurred_at) as first_recorded_at,
 max(occurred_at) filter(where is_contact and occurred_at<=statement_timestamp()) as latest_interaction_at
from public.crm_client_activity group by client_id;
revoke all on public.crm_client_activity_summary from public,anon,authenticated,service_role;
grant select on public.crm_client_activity_summary to authenticated;

create function public.browse_crm_records(p_filters jsonb default '{}'::jsonb,p_offset integer default 0,p_limit integer default 200)
returns jsonb language sql stable set search_path='' as $$
with activity as (
 select client_id,max(occurred_at) filter(where is_contact and occurred_at<=statement_timestamp()) as latest,
 min(occurred_at) as registered from public.crm_client_activity group by client_id
), records as (
 select c.*,coalesce(a.registered,c.profile_updated_at) as registered_at,a.latest as latest_interaction_at,
 coalesce(i.lifecycle_stage,c.lifecycle_stage)::text as effective_stage,
 case when c.lifecycle_stage in ('lead','engaged') and c.total_visits=0 then 'lead' else 'client' end as record_type,
 (select source.channel from (
   select coalesce(nullif(l.field_values->>'source_of_lead',''),l.source_channel::text) as channel,l.created_at as occurred_at,l.id
   from public.leads l where l.client_id=c.client_id
   union all select nullif(f.source_of_lead,''),t.event_date,t.id from public.visit_forms f join public.client_timeline t on t.id=f.client_timeline_id where t.client_id=c.client_id
  ) source where source.channel is not null order by source.occurred_at desc,source.id limit 1) as lead_source
 from public.clients c left join activity a using(client_id) left join public.client_identity i using(client_id) where public.current_user_role() is not null
), filtered as (
 select r.* from records r where
 (coalesce(p_filters->>'search','')='' or r.client_code ilike '%'||(p_filters->>'search')||'%' or r.primary_name ilike '%'||(p_filters->>'search')||'%'
  or exists(select 1 from unnest(r.other_names) n where n ilike '%'||(p_filters->>'search')||'%')
  or (length(regexp_replace(p_filters->>'search','[^0-9]','','g'))>=10 and exists(
    select 1 from public.client_phone_index pi where pi.client_id=r.client_id
    and right(pi.phone,10)=right(regexp_replace(p_filters->>'search','[^0-9]','','g'),10)))
  or exists(select 1 from public.client_identity i where i.client_id=r.client_id and
    (i.household_code ilike '%'||(p_filters->>'search')||'%' or i.referral_code ilike '%'||(p_filters->>'search')||'%')))
 and (coalesce(p_filters->>'type','') in ('','all') or r.record_type=p_filters->>'type')
 and (coalesce(p_filters->>'stage','')='' or r.effective_stage=p_filters->>'stage')
 and (coalesce(p_filters->>'branch','')='' or r.last_branch_id::text=p_filters->>'branch')
 and (coalesce(p_filters->>'city','')='' or r.city ilike '%'||(p_filters->>'city')||'%')
 and (coalesce(p_filters->>'state','')='' or r.state ilike '%'||(p_filters->>'state')||'%')
 and (coalesce(p_filters->>'source','')='' or r.lead_source ilike '%'||(p_filters->>'source')||'%')
 and (coalesce(p_filters->>'potential','')='' or upper(r.client_potential_category)=upper(p_filters->>'potential'))
 and (coalesce(p_filters->>'purchase','')='' or r.last_buy_status::text=p_filters->>'purchase')
 and (nullif(p_filters->>'min_visits','') is null or r.total_visits>=(p_filters->>'min_visits')::integer)
 and (nullif(p_filters->>'max_visits','') is null or r.total_visits<=(p_filters->>'max_visits')::integer)
 and (nullif(p_filters->>'created_from','') is null or r.registered_at>=((p_filters->>'created_from')::date::timestamp at time zone 'Asia/Kolkata'))
 and (nullif(p_filters->>'created_to','') is null or r.registered_at<(((p_filters->>'created_to')::date+1)::timestamp at time zone 'Asia/Kolkata'))
 and (nullif(p_filters->>'interaction_from','') is null or r.latest_interaction_at>=((p_filters->>'interaction_from')::date::timestamp at time zone 'Asia/Kolkata'))
 and (nullif(p_filters->>'interaction_to','') is null or r.latest_interaction_at<(((p_filters->>'interaction_to')::date+1)::timestamp at time zone 'Asia/Kolkata'))
), page as (
 select * from filtered order by
 case when p_filters->>'sort'='name' then primary_name end asc,
 case when p_filters->>'sort'='created' then registered_at when p_filters->>'sort'='visit' then last_visit_date
 else coalesce(latest_interaction_at,registered_at) end desc nulls last,client_id
 offset greatest(p_offset,0) limit least(greatest(p_limit,1),200)
)
select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg((to_jsonb(page)-'effective_stage')||jsonb_build_object('lifecycle_stage',page.effective_stage)) from page),'[]'::jsonb));
$$;
revoke all on function public.save_crm_lead(text,text,jsonb),public.reconcile_crm_lead_profiles(boolean),
 public.lookup_client_profile_by_phone(text),public.record_crm_contact(uuid,text,text,text,uuid),public.browse_crm_records(jsonb,integer,integer)
from public,anon,authenticated,service_role;
grant execute on function public.save_crm_lead(text,text,jsonb),public.reconcile_crm_lead_profiles(boolean),
 public.lookup_client_profile_by_phone(text),public.record_crm_contact(uuid,text,text,text,uuid),public.browse_crm_records(jsonb,integer,integer) to authenticated;

-- An explicit follow-up save is another contact even when its outcome is the
-- same as the previous call. Preserve existing changed-row triggers and retry keys.
do $$
declare signature text; body text; table_name text; insertion text;
begin
 for signature in select unnest(array[
  'public.save_not_bought_followup(uuid,text,text,date,text)',
  'public.save_referral_followup(uuid,text,text,date,text,text)',
  'public.save_referral_followup(uuid,text,text,date,text,text,uuid)']) loop
  body:=pg_get_functiondef(signature::regprocedure);
  table_name:=case when signature like '%save_not_bought%' then 'not_bought_followups' else 'referral_calling' end;
  if position('RETURNING * INTO target;' in body)=0 then raise exception 'Unexpected follow-up save contract: %',signature; end if;
  body:=replace(body,'DECLARE actor_role','DECLARE prior_followup_count integer; actor_role');
  body:=replace(body,'  UPDATE "public"."'||table_name||'"', '  prior_followup_count := target.followup_count;'||chr(10)||'  UPDATE "public"."'||table_name||'"');
  if table_name='not_bought_followups' then
   insertion:=$patch$
  IF target.followup_count = prior_followup_count THEN
    INSERT INTO public.not_bought_history(followup_id,status,previous_status,remark,call_response,updated_by)
    VALUES(target.id,target.status,target.status,target.remark,target.call_response,public.current_crm_user_id());
    UPDATE public.not_bought_followups SET followup_count=followup_count+1 WHERE id=target.id RETURNING * INTO target;
  END IF;
$patch$;
  else
   insertion:=$patch$
  IF target.followup_count = prior_followup_count THEN
    INSERT INTO public.referral_calling_history(referral_calling_id,status,previous_status,remark,call_response,updated_by,entered_by,followup_date,next_followup_date,source,request_key)
    VALUES(target.id,target.status,target.status,target.remark,target.call_response,public.current_crm_user_id(),
      (select name from public.users where id=public.current_crm_user_id()),
      (statement_timestamp() at time zone 'Asia/Kolkata')::date,target.next_followup_date,'CRM FOLLOW UP FORM',REQUEST_KEY_VALUE);
    UPDATE public.referral_calling SET followup_count=followup_count+1 WHERE id=target.id RETURNING * INTO target;
  END IF;
$patch$;
   insertion:=replace(insertion,'REQUEST_KEY_VALUE',case when signature like '%text,uuid)' then 'p_request_key' else 'null' end);
  end if;
  if table_name='referral_calling' then
   body:=replace(body,'DECLARE prior_followup_count integer;','DECLARE previous_contact_source text; prior_followup_count integer;');
   body:=replace(body,'  prior_followup_count := target.followup_count;',E'  previous_contact_source := current_setting(''app.referral_contact_source'',true);\n  PERFORM set_config(''app.referral_contact_source'',''CRM CONTACT FOLLOW UP FORM'',true);\n  prior_followup_count := target.followup_count;');
   insertion:=replace(insertion,'CRM FOLLOW UP FORM','CRM CONTACT FOLLOW UP FORM');
   insertion:=insertion||E'  PERFORM set_config(''app.referral_contact_source'',coalesce(previous_contact_source,''''),true);\n';
  end if;
  body:=replace(body,'  PERFORM "crm_private"."write_audit_log"',insertion||'  PERFORM "crm_private"."write_audit_log"');
  execute body;
 end loop;
end $$;

revoke insert on public.leads from authenticated;

do $$
declare body text;
begin
 body:=pg_get_functiondef('public.record_referral_calling_update()'::regprocedure);
 if position('CRM FOLLOW UP FORM' in body)=0 then raise exception 'Unexpected referral history contract'; end if;
 body:=replace(body,'''CRM FOLLOW UP FORM''','coalesce(nullif(current_setting(''app.referral_contact_source'',true),''''),''CRM FOLLOW UP FORM'')');
 execute body;
end $$;
