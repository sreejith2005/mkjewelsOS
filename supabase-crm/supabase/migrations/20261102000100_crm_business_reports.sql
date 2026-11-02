-- Business Reports 2.0 (2026-11-02): one bounded CRM reporting contract for the JewelOS
-- Reports page. Previews call it as the signed-in CRM user through the login bridge;
-- exports reach it only through the existing private export adapter
-- (crm_customer_export_batch), which re-checks the requester when the job runs.
-- Reads only; no CRM record, cache or customer master is copied or written.
set search_path='';

-- Readable text for one stored JSON value (projection values and form answers).
create function crm_private.report_json_text(p_value jsonb) returns text
language sql immutable set search_path='' as $$
 select nullif(btrim(case
  when p_value is null or p_value='null'::jsonb then null
  when jsonb_typeof(p_value)='array' then (select string_agg(case when jsonb_typeof(x)='object' then coalesce(x->>'label',x->>'name',x->>'value') else x#>>'{}' end,', ' order by n) from jsonb_array_elements(p_value) with ordinality e(x,n))
  when jsonb_typeof(p_value)='object' then coalesce(p_value->>'label',p_value->>'name',p_value->>'value')
  when jsonb_typeof(p_value)='boolean' then case when p_value='true'::jsonb then 'Yes' else 'No' end
  else p_value#>>'{}' end),'');
$$;

-- One synced form answer as "Label: value", preferring the option labels it was shown with.
create function crm_private.report_answers_text(p_answers jsonb) returns text
language sql immutable set search_path='' as $$
 select nullif(string_agg(coalesce(nullif(a->>'label',''),a->>'fieldKey')||': '||coalesce(
   case when jsonb_typeof(a->'optionLabels')='array' and jsonb_array_length(a->'optionLabels')>0 then crm_private.report_json_text(a->'optionLabels') end,
   crm_private.report_json_text(a->'normalized'),crm_private.report_json_text(a->'original'),''),' | ' order by n),'')
 from jsonb_array_elements(case when jsonb_typeof(p_answers)='array' then p_answers else '[]'::jsonb end) with ordinality e(a,n);
$$;

-- The latest synced answer a form supplied for one destination (budget, product interest, ...).
create function crm_private.report_projection(p_client uuid,p_destination text) returns text
language sql stable security definer set search_path='' as $$
 select crm_private.report_json_text(p.value) from crm_private.customer_attribute_projection p where p.client_id=p_client and p.destination=p_destination;
$$;

-- A walk-in "source of lead" answer, using the typed Other text when Other was chosen.
create function crm_private.report_visit_source(p_source text,p_other text) returns text
language sql immutable set search_path='' as $$
 select nullif(btrim(case when upper(btrim(coalesce(p_source,''))) in ('OTHER','OTHERS') and nullif(btrim(p_other),'') is not null then p_other else p_source end),'');
$$;

-- Every recorded enquiry source of one customer: CRM leads, starting/synced forms, walk-in forms.
create function crm_private.report_client_sources(p_client uuid) returns table(first_source text,latest_source text)
language sql stable security definer set search_path='' as $$
 with s as (
  select l.created_at at_,nullif(btrim(l.field_values->>'source_of_lead'),'') src from public.leads l where l.client_id=p_client or l.converted_to_client_id=p_client
  union all select e.occurred_at,nullif(btrim(e.channel),'') from public.crm_customer_workflow_events e where e.client_id=p_client and e.kind='form.submitted'
  union all select t.event_date,crm_private.report_visit_source(f.source_of_lead,f.source_of_lead_other) from public.client_timeline t join public.visit_forms f on f.client_timeline_id=t.id where t.client_id=p_client
 ) select (select src from s where src is not null order by at_,src limit 1),(select src from s where src is not null order by at_ desc,src limit 1);
$$;
-- "+91 9876543210". Client phones are stored with their country digits; lead phones without.
create function crm_private.report_phone(p_code text,p_phone text) returns text
language sql immutable set search_path='' as $$
 with v as (select nullif(regexp_replace(coalesce(p_code,''),'[^0-9]','','g'),'') code,nullif(btrim(p_phone),'') phone)
 select case when phone is null then null when code is null then phone
  when phone ~ '^[0-9]+$' and left(phone,length(code))=code and length(phone)-length(code)>=6 then '+'||code||' '||substr(phone,length(code)+1)
  else '+'||code||' '||phone end from v;
$$;

create function crm_private.report_label(p_value text) returns text
language sql immutable set search_path='' as $$ select initcap(replace(lower(p_value),'_',' ')); $$;

/*
 * The one CRM report reader. p_before bounds export snapshots to the request time.
 * Every KPI below counts recorded evidence only; see docs/REPORTS.md.
 */
create function crm_private.business_report(p_key text,p_filters jsonb,p_offset integer,p_limit integer,p_before timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 f jsonb:=coalesce(p_filters,'{}');today date:=(now() at time zone 'Asia/Kolkata')::date;
 v_from date;v_to date;v_start timestamptz;v_end timestamptz;v_branch uuid;v_employee uuid;v_client uuid;
 v_source text:=nullif(btrim(f->>'source'),'');v_crm text:=nullif(btrim(f->>'crmName'),'');v_search text:=nullif(btrim(f->>'search'),'');
 v_type text:=nullif(f->>'customerType','');v_class text:=nullif(f->>'purchaseClass','');v_status text:=nullif(f->>'status','');
 v_before timestamptz:=coalesce(p_before,'infinity'::timestamptz);result jsonb;k text;v_class_ids uuid[];
begin
 if jsonb_typeof(f)<>'object' or pg_column_size(f)>8192 then raise exception 'Invalid report filters' using errcode='22023';end if;
 for k in select jsonb_object_keys(f) loop
  if k not in ('from','to','branchId','employeeId','crmName','source','customerType','purchaseClass','status','search','clientId') then raise exception 'Unknown report filter: %',k using errcode='22023';end if;
 end loop;
 if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid report page' using errcode='22023';end if;
 begin
  v_from:=nullif(f->>'from','')::date;v_to:=nullif(f->>'to','')::date;
  v_branch:=nullif(f->>'branchId','')::uuid;v_employee:=nullif(f->>'employeeId','')::uuid;v_client:=nullif(f->>'clientId','')::uuid;
 exception when others then raise exception 'Invalid report filter value' using errcode='22023';end;
 if v_from is not null and v_to is not null and (v_to<v_from or v_to-v_from>365) then raise exception 'Choose a range of 1 to 366 days' using errcode='22023';end if;
 if length(coalesce(v_source,''))>120 or length(coalesce(v_crm,''))>160 or length(coalesce(v_search,''))>100 then raise exception 'Filter text is too long' using errcode='22023';end if;
 if v_type is not null and v_type not in ('lead','client') then raise exception 'Invalid customer type' using errcode='22023';end if;
 if v_class is not null and v_class not in ('Buyer','Non-Buyer/Prospect','Repair-only Customer','Unknown') then raise exception 'Invalid purchase classification' using errcode='22023';end if;
 if v_status is not null and v_status !~ '^[a-z_]{1,40}$' then raise exception 'Invalid status filter' using errcode='22023';end if;
 v_start:=case when v_from is null then '-infinity'::timestamptz else v_from::timestamp at time zone 'Asia/Kolkata' end;
 v_end:=least(v_before,case when v_to is null then 'infinity'::timestamptz else (v_to+1)::timestamp at time zone 'Asia/Kolkata' end);

 if p_key='customer_report_master' then
  -- One row per customer identity. Leads, forms and channel identities stay on that row.
  -- The purchase filter classifies every customer in one pass with the same rules as
  -- customer_commercial_summary (no visits = Non-Buyer/Prospect).
  if v_class is not null then
   select coalesce(array_agg(client_id),'{}') into v_class_ids from (
    select x.client_id,case when bool_or(x.purchased) then 'Buyer' when bool_or(x.outcome is null and not x.purchased) then 'Unknown'
      when bool_or(x.outcome like 'REPAIR%') then 'Repair-only Customer' else 'Non-Buyer/Prospect' end cls
    from (select t.client_id,crm_private.walkin_purchase_evidence(t.buy_status,t.bought_categories,vf.did_buy,vf.additional_fields) purchased,
      crm_private.saved_walkin_status(t.buy_status,vf.additional_fields)::text outcome
     from public.client_timeline t left join public.visit_forms vf on vf.client_timeline_id=t.id) x group by x.client_id) q
   where case when v_class='Non-Buyer/Prospect' then cls<>'Non-Buyer/Prospect' else cls=v_class end;
  end if;
  with base as materialized (
   select c.client_id,coalesce(b.latest_interaction_at,c.last_visit_date) last_touch from public.clients c left join public.crm_client_browse_state b using(client_id)
   where (v_branch is null or c.last_branch_id=v_branch)
    and (v_type is null or case v_type when 'lead' then c.lifecycle_stage in ('lead','engaged') else c.lifecycle_stage in ('visited','purchased') end)
    and (v_crm is null or lower(btrim(c.last_crm_name))=lower(v_crm))
    and (v_employee is null or c.last_salesperson_id=v_employee)
    and (v_from is null or coalesce(b.latest_interaction_at,c.last_visit_date)>=v_start)
    and (v_to is null or coalesce(b.latest_interaction_at,c.last_visit_date)<v_end)
    and (v_search is null or c.client_id in (select x from public.crm_search_client_ids(v_search) x))
  ), filtered as materialized (
   select * from base where (v_source is null or client_id in (
     select l.client_id from public.leads l where lower(btrim(l.field_values->>'source_of_lead'))=lower(v_source)
     union select l.converted_to_client_id from public.leads l where lower(btrim(l.field_values->>'source_of_lead'))=lower(v_source)
     union select e.client_id from public.crm_customer_workflow_events e where e.kind='form.submitted' and lower(btrim(e.channel))=lower(v_source)
     union select t.client_id from public.client_timeline t join public.visit_forms vf on vf.client_timeline_id=t.id where lower(crm_private.report_visit_source(vf.source_of_lead,vf.source_of_lead_other))=lower(v_source)))
    and (v_class is null or case when v_class='Non-Buyer/Prospect' then client_id not in (select unnest(v_class_ids)) else client_id in (select unnest(v_class_ids)) end)
  ), page as (select * from filtered order by last_touch desc nulls last,client_id offset p_offset limit p_limit)
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce(jsonb_agg(jsonb_build_object(
    'client_id',c.client_id,'customer_id',c.client_code,'name',c.primary_name,
    'primary_phone',crm_private.report_phone(c.primary_phone_country_code,c.primary_phone),
    'alternate_phone',crm_private.report_phone(c.secondary_phone_country_code,c.secondary_phone),
    'billing_phone',crm_private.report_phone(c.billing_phone_country_code,c.billing_phone),
    'instagram',(select '@'||i.normalized from crm_private.customer_source_identities i where i.client_id=c.client_id and i.kind='instagram' order by i.verified desc,i.normalized limit 1),
    'city',coalesce(nullif(btrim(case when upper(btrim(coalesce(c.city,''))) in ('OTHER','OTHERS') then c.city_other else c.city end),''),crm_private.report_projection(c.client_id,'city')),
    'state',nullif(btrim(c.state),''),'branch',br.name,'first_source',src.first_source,'latest_source',src.latest_source,
    'lead_or_client',case when c.lifecycle_stage in ('lead','engaged') then 'Lead' else 'Client' end,
    'lifecycle',initcap(c.lifecycle_stage),
    'new_or_returning',case when c.total_visits>1 then 'Returning' when c.total_visits=1 then 'New' else 'No store visit yet' end,
    'purchase_status',crm_private.customer_commercial_summary(c.client_id)->>'classification',
    'last_interaction',p.last_touch,'last_visit',c.last_visit_date,'assigned_crm',nullif(btrim(c.last_crm_name),''),'salesperson',sp.name,
    'product_interest',coalesce(crm_private.report_projection(c.client_id,'product_interest'),nullif(btrim(c.last_product_requirement),''),nullif(array_to_string(c.last_seen_categories,', '),'')),
    'budget',crm_private.report_projection(c.client_id,'budget'),
    'next_followup',coalesce((select min(nf.next_followup_date) from public.not_bought_followups nf where nf.client_id=c.client_id and not public.not_bought_followup_status_is_done(nf.status))::text,crm_private.report_projection(c.client_id,'next_follow_up')),
    'followup_status',(select nf.status from public.not_bought_followups nf where nf.client_id=c.client_id order by public.not_bought_followup_status_is_done(nf.status),nf.created_at desc,nf.id limit 1)
   ) order by p.last_touch desc nulls last,p.client_id),'[]')) into result
  from page p join public.clients c using(client_id) left join public.branches br on br.id=c.last_branch_id left join public.users sp on sp.id=c.last_salesperson_id
  cross join lateral crm_private.report_client_sources(c.client_id) src;
  return result;
 end if;

 if p_key='customer_report_journey' then
  if v_client is null or not exists(select 1 from public.clients where client_id=v_client) then raise exception 'Choose a customer first' using errcode='22023';end if;
  -- crm_client_activity is the de-duplicated customer history (one row per source record).
  -- Engagement asks are folded into their visit row; profile edits are not business events.
  with acts as materialized (
   select a.* from public.crm_client_activity a where a.client_id=v_client and a.kind not in ('PROFILE_EDIT','ENGAGEMENT_ASK')
    and a.occurred_at>=v_start and a.occurred_at<v_end and a.occurred_at<=v_before
  ), page as (select * from acts order by occurred_at,activity_id offset p_offset limit p_limit)
  select jsonb_build_object('total',(select count(*) from acts),'rows',coalesce(jsonb_agg(jsonb_build_object(
    'activity_id',a.activity_id,'customer_id',c.client_code,'name',c.primary_name,'event_at',a.occurred_at,
    'event_type',case a.kind when 'LEAD_REGISTERED' then 'Lead registered' when 'LEAD_CALL' then 'Lead call' when 'LEAD_STAGE_CHANGED' then 'Lead status changed'
      when 'WALKIN_REGISTERED' then 'Walk-in registered' when 'FOLLOWUP' then 'Follow-up call' when 'REFERRAL_FOLLOWUP' then 'Referral follow-up'
      when 'FMS_CUSTOMER_EVENT' then case coalesce(fe.kind,'') when 'form.submitted' then 'Form submitted' when 'stage.completed' then 'FMS stage completed' else 'FMS workflow update' end
      else crm_private.report_label(a.kind) end,
    'source',nullif(a.channel,''),'workflow',coalesce(a.details#>>'{workflow,referenceNumber}',fe.workflow->>'referenceNumber'),
    'stage',coalesce(a.details#>>'{workflow,stageName}',fe.workflow->>'stageName'),
    'employee',coalesce(u.name,nullif(t.crm_name,''),fe.workflow->>'actorName'),
    'details',nullif(btrim(concat_ws(' | ',
      case when a.source_table='crm_customer_workflow_events' then crm_private.report_answers_text(fe.answers) end,
      case when a.source_table='client_timeline' then concat_ws(' | ',nullif('Requirement: '||nullif(btrim(t.product_requirement),''),''),nullif('Seen: '||nullif(array_to_string(t.seen_categories,', '),''),''),
        nullif('Bought: '||nullif(array_to_string(t.bought_categories,', '),''),''),
        (select nullif('Asked: '||string_agg(x.label,', '),'Asked: ') from public.visit_forms vf cross join lateral (values ('Instagram',vf.instagram_asked),('Google review',vf.google_review_asked),('Testimonial',vf.testimonial_asked),('Feedback form',vf.feedback_form_asked),('Thank-you note',vf.thank_you_note_asked),('Referrals',vf.referrals_asked)) x(label,asked) where vf.client_timeline_id=t.id and x.asked)) end,
      case when a.source_table not in ('crm_customer_workflow_events') then nullif(btrim(a.note),'') end)),''),
    'outcome',case when a.source_table='client_timeline' then crm_private.report_label(coalesce(crm_private.saved_walkin_status(t.buy_status,vf2.additional_fields)::text,'Not recorded'))
      when a.source_table in ('lead_call_history','not_bought_history','referral_calling_history') then coalesce(nullif(a.details->>'call_response',''),null) end,
    'followup_date',nullif(a.details->>'next_followup_date',''),
    'status',case when a.source_table in ('not_bought_history','referral_calling_history','lead_stage_history') then coalesce(a.details->>'status',a.details->>'new_stage')
      when a.source_table='crm_customer_workflow_events' then crm_private.report_label(coalesce(fe.workflow->>'instanceStatus',fe.workflow->>'status')) end
   ) order by a.occurred_at,a.activity_id),'[]')) into result
  from page a join public.clients c on c.client_id=v_client left join public.users u on u.id=a.actor_id
  left join public.client_timeline t on a.source_table='client_timeline' and t.id::text=a.source_id
  left join public.visit_forms vf2 on vf2.client_timeline_id=t.id
  left join public.crm_customer_workflow_events fe on a.source_table='crm_customer_workflow_events' and fe.event_id=a.source_id;
  return result;
 end if;

 if p_key='customer_report_leads' then
  with enquiries as materialized (
   select 'lead:'||l.id record_id,'CRM lead'::text entry_type,l.created_at enquiry_at,coalesce(l.client_id,l.converted_to_client_id) client_id,l.name::text lead_name,
    crm_private.report_phone(l.country_code,l.phone_number) phone,nullif(btrim(l.field_values->>'source_of_lead'),'') source,l.branch_id,l.created_by actor_id,
    crm_private.report_label(l.source_channel::text) lead_status,
    coalesce(nullif(btrim(l.field_values->>'product_requirement'),''),nullif(btrim(l.field_values->>'requirement'),'')) requirement,l.id lead_id
   from public.leads l
   union all
   select 'fms:'||e.journey_key,'Form / FMS enquiry',e.occurred_at,e.client_id,null,null,nullif(btrim(e.channel),''),e.branch_id,e.actor_id,
    crm_private.report_label(coalesce(e.workflow->>'status','submitted')),
    (select crm_private.report_json_text(coalesce(nullif(a->'optionLabels','[]'::jsonb),a->'normalized')) from jsonb_array_elements(e.answers) a where a->>'destination' in ('requirement','product_interest') limit 1),null::uuid
   from (select distinct on (journey_key) * from public.crm_customer_workflow_events where kind='form.submitted' order by journey_key,occurred_at,event_id) e
  ), filtered as materialized (
   select q.* from enquiries q left join public.clients c on c.client_id=q.client_id
   where q.enquiry_at>=v_start and q.enquiry_at<v_end and (v_branch is null or q.branch_id=v_branch) and (v_employee is null or q.actor_id=v_employee)
    and (v_source is null or lower(q.source)=lower(v_source))
    and (v_search is null or strpos(lower(concat_ws(' ',q.lead_name,q.phone,c.primary_name,c.primary_phone,c.client_code)),lower(v_search))>0)
  ), page as (select * from filtered order by enquiry_at desc,record_id offset p_offset limit p_limit)
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce(jsonb_agg(jsonb_build_object(
    'record_id',p.record_id,'enquiry_at',p.enquiry_at,'entry_type',p.entry_type,'customer_id',c.client_code,'name',coalesce(c.primary_name,p.lead_name),
    'phone',coalesce(p.phone,crm_private.report_phone(c.primary_phone_country_code,c.primary_phone)),'source',coalesce(p.source,'Not recorded'),'branch',br.name,
    'registered_by',u.name,'lead_status',p.lead_status,'requirement',p.requirement,
    'last_call_response',(select h.call_response::text from public.lead_call_history h where h.lead_id=p.lead_id order by h.created_at desc,h.id desc limit 1),
    'next_followup',(select h.next_followup_date from public.lead_call_history h where h.lead_id=p.lead_id order by h.created_at desc,h.id desc limit 1)
   ) order by p.enquiry_at desc,p.record_id),'[]')) into result
  from page p left join public.clients c on c.client_id=p.client_id left join public.branches br on br.id=p.branch_id left join public.users u on u.id=p.actor_id;
  return result;
 end if;

 if p_key='customer_report_followups' then
  if v_status is not null and v_status not in ('open','overdue','due_today','undated','done') then raise exception 'Invalid follow-up status' using errcode='22023';end if;
  with items as materialized (
   select 'not_bought:'||nf.id record_id,'Not-bought follow-up'::text followup_type,nf.created_at,nf.client_id,null::text lead_name,null::text lead_phone,nf.branch_id,
    nf.status,nf.next_followup_date due_date,nf.followup_count,nullif(btrim(nf.call_response),'') last_response,nullif(btrim(nf.remark),'') remark,nullif(btrim(nf.action_point),'') action_point,
    nf.entered_by owner_id,public.not_bought_followup_status_is_done(nf.status) done
   from public.not_bought_followups nf
   union all
   select 'lead:'||l.id,'Lead follow-up',h.created_at,coalesce(l.client_id,l.converted_to_client_id),l.name::text,crm_private.report_phone(l.country_code,l.phone_number),l.branch_id,
    crm_private.report_label(l.source_channel::text),h.next_followup_date,(select count(*)::int from public.lead_call_history x where x.lead_id=l.id),h.call_response::text,nullif(btrim(h.remark),''),null,
    h.entered_by,l.source_channel::text in ('converted','lost')
   from public.leads l cross join lateral (select * from public.lead_call_history x where x.lead_id=l.id order by x.created_at desc,x.id desc limit 1) h
   where h.next_followup_date is not null
  ), filtered as materialized (
   select * from items i where i.created_at<=v_before and (v_branch is null or i.branch_id=v_branch) and (v_employee is null or i.owner_id=v_employee)
    and (v_from is null or i.due_date>=v_from) and (v_to is null or i.due_date<=v_to)
    and case coalesce(v_status,'open') when 'open' then not i.done when 'overdue' then not i.done and i.due_date<today when 'due_today' then not i.done and i.due_date=today
      when 'undated' then not i.done and i.due_date is null else i.done end
  ), page as (select * from filtered order by due_date nulls last,created_at,record_id offset p_offset limit p_limit)
  select jsonb_build_object('total',(select count(*) from filtered),
   'summary',(select jsonb_build_object('followups',count(*),'overdue',count(*) filter(where not done and due_date<today),'due_today',count(*) filter(where not done and due_date=today)) from filtered),
   'rows',coalesce(jsonb_agg(jsonb_build_object(
    'record_id',p.record_id,'followup_type',p.followup_type,'customer_id',c.client_code,'name',coalesce(c.primary_name,p.lead_name),
    'phone',coalesce(p.lead_phone,crm_private.report_phone(c.primary_phone_country_code,c.primary_phone)),'branch',br.name,'status',p.status,
    'due_date',p.due_date,'overdue',not p.done and p.due_date<today,'attempts',p.followup_count,'last_response',p.last_response,'remark',p.remark,
    'action_point',p.action_point,'owner',u.name,'created_at',p.created_at
   ) order by p.due_date nulls last,p.created_at,p.record_id),'[]')) into result
  from page p left join public.clients c on c.client_id=p.client_id left join public.branches br on br.id=p.branch_id left join public.users u on u.id=p.owner_id;
  return result;
 end if;

 if p_key='customer_report_sources' then
  if v_from is null or v_to is null then raise exception 'Choose a date range' using errcode='22023';end if;
  -- Enquiries = CRM leads + the first synced form of each FMS/form journey. Walk-in store
  -- visits are visits, not enquiries; they only count as later conversion evidence.
  with enquiries as materialized (
   select coalesce(nullif(btrim(l.field_values->>'source_of_lead'),''),'Not recorded') source,l.created_at at_,coalesce(l.client_id,l.converted_to_client_id) client_id,
    coalesce('client:'||coalesce(l.client_id,l.converted_to_client_id)::text,'phone:'||l.phone_number) person,l.converted_to_client_id is not null converted,null::uuid journey
   from public.leads l where l.created_at>=v_start and l.created_at<v_end and (v_branch is null or l.branch_id=v_branch) and (v_employee is null or l.created_by=v_employee)
   union all
   select coalesce(nullif(btrim(e.channel),''),'Not recorded'),e.occurred_at,e.client_id,'client:'||e.client_id,false,e.journey_key
   from (select distinct on (journey_key) * from public.crm_customer_workflow_events where kind='form.submitted' order by journey_key,occurred_at,event_id) e
   where e.occurred_at>=v_start and e.occurred_at<v_end and (v_branch is null or e.branch_id=v_branch) and (v_employee is null or e.actor_id=v_employee)
  ), scoped as materialized (select * from enquiries where v_source is null or lower(source)=lower(v_source)),
  people as materialized (
   select source,person,(array_agg(client_id) filter(where client_id is not null))[1] client_id,min(at_) first_at,bool_or(converted) converted from scoped group by source,person
  ), evidence as materialized (
   select p.*,
    p.client_id is not null and exists(select 1 from public.crm_client_browse_state b where b.client_id=p.client_id and b.first_recorded_at<p.first_at-interval '1 minute') returning_lead,
    p.client_id is not null and exists(select 1 from public.client_timeline t where t.client_id=p.client_id and t.event_date>=p.first_at and t.event_date<v_end) visited,
    p.client_id is not null and exists(select 1 from public.client_timeline t left join public.visit_forms vf on vf.client_timeline_id=t.id where t.client_id=p.client_id and t.event_date>=p.first_at and t.event_date<v_end
      and crm_private.walkin_purchase_evidence(t.buy_status,t.bought_categories,vf.did_buy,vf.additional_fields)) bought,
    (select count(*) from public.not_bought_followups nf where p.client_id is not null and nf.client_id=p.client_id and not public.not_bought_followup_status_is_done(nf.status)) open_followups
   from people p
  ), grouped as materialized (
   select e.source,(select count(*) from scoped s where s.source=e.source) total_enquiries,count(*) unique_leads,count(*) filter(where returning_lead) returning_leads,
    count(*) filter(where visited) store_visitors,count(*) filter(where converted) converted_leads,count(*) filter(where bought) verified_buyers,
    sum(open_followups) open_followups,
    (select count(distinct s.journey) from scoped s where s.source=e.source and s.journey is not null) fms_started,
    (select count(distinct s.journey) from scoped s where s.source=e.source and s.journey is not null and exists(select 1 from public.crm_customer_workflow_events w where w.journey_key=s.journey and w.workflow->>'instanceStatus'='completed')) fms_completed
   from evidence e group by e.source
  ), page as (select * from grouped order by total_enquiries desc,source offset p_offset limit p_limit)
  select jsonb_build_object('total',(select count(*) from grouped),
   'summary',(select jsonb_build_object('enquiries',coalesce(sum(total_enquiries),0),'unique_leads',coalesce(sum(unique_leads),0),'store_visitors',coalesce(sum(store_visitors),0),'verified_buyers',coalesce(sum(verified_buyers),0)) from grouped),
   'rows',coalesce(jsonb_agg(jsonb_build_object('source',p.source,'total_enquiries',p.total_enquiries,'unique_leads',p.unique_leads,'returning_leads',p.returning_leads,
    'store_visitors',p.store_visitors,'visit_rate',case when p.unique_leads=0 then null else round(100.0*p.store_visitors/p.unique_leads,1) end,
    'converted_leads',p.converted_leads,'verified_buyers',p.verified_buyers,'buyer_rate',case when p.unique_leads=0 then null else round(100.0*p.verified_buyers/p.unique_leads,1) end,
    'open_followups',p.open_followups,'fms_started',p.fms_started,'fms_completed',p.fms_completed) order by p.total_enquiries desc,p.source),'[]')) into result from page p;
  return result;
 end if;

 if p_key in ('customer_report_crm_staff','customer_report_sales') then
  if v_from is null or v_to is null then raise exception 'Choose a date range' using errcode='22023';end if;
 end if;

 if p_key='customer_report_crm_staff' then
  -- Visits name their CRM as text (client_timeline.crm_name); it is matched to the CRM roster
  -- by exact name. Calls, follow-ups and leads carry the user id. Nothing is counted twice:
  -- each fact comes from exactly one source table.
  with roster as (select u.id,u.name,lower(btrim(u.name)) name_key,u.branch_id from public.users u),
  visit_facts as materialized (
   select coalesce((select r.id::text from roster r where r.name_key=lower(btrim(t.crm_name)) order by r.id limit 1),'name:'||lower(btrim(t.crm_name))) person,btrim(t.crm_name) person_name,
    t.client_id,crm_private.walkin_purchase_evidence(t.buy_status,t.bought_categories,vf.did_buy,vf.additional_fields) purchased,
    coalesce(vf.referrals_asked,false) referrals,coalesce(vf.google_review_asked,false) google,coalesce(vf.testimonial_asked,false) testimonial,
    coalesce(vf.thank_you_note_asked,false) thank_you,coalesce(vf.instagram_asked,false) instagram,coalesce(vf.feedback_form_asked,false) feedback
   from public.client_timeline t left join public.visit_forms vf on vf.client_timeline_id=t.id
   where nullif(btrim(t.crm_name),'') is not null and t.event_date>=v_start and t.event_date<v_end and (v_branch is null or t.branch_id=v_branch)
  ), facts as materialized (
   select person,person_name,'visit'::text metric,client_id,purchased,referrals,google,testimonial,thank_you,instagram,feedback,false connected from visit_facts
   union all select l.created_by::text,null,'lead',null,false,false,false,false,false,false,false,false from public.leads l where l.created_at>=v_start and l.created_at<v_end and (v_branch is null or l.branch_id=v_branch)
   union all select h.entered_by::text,null,'lead_call',null,false,false,false,false,false,false,false,h.call_response='CONNECTED' from public.lead_call_history h join public.leads l on l.id=h.lead_id
    where h.created_at>=v_start and h.created_at<v_end and (v_branch is null or l.branch_id=v_branch)
   union all select h.updated_by::text,null,case when public.not_bought_followup_status_is_done(h.status) and not public.not_bought_followup_status_is_done(coalesce(h.previous_status,'')) then 'followup_done' else 'followup_update' end,
    null,false,false,false,false,false,false,false,nullif(btrim(h.call_response),'') is not null and h.call_response not like 'AUTO CLOSED%' and h.call_response not like 'CLIENT REVISITED%'
    from public.not_bought_history h join public.not_bought_followups nf on nf.id=h.followup_id where h.updated_by is not null and h.created_at>=v_start and h.created_at<v_end and (v_branch is null or nf.branch_id=v_branch)
   union all select e.actor_id::text,null,'fms_stage',null,false,false,false,false,false,false,false,false from public.crm_customer_workflow_events e
    where e.kind='stage.completed' and e.actor_id is not null and e.occurred_at>=v_start and e.occurred_at<v_end and (v_branch is null or e.branch_id=v_branch)
   union all select x.actor_id::text,null,case when x.kind='CALL' then 'contact_call' when x.kind='THANK_YOU' then 'contact_thank_you' when x.kind='MESSAGE' and x.channel='WHATSAPP' then 'contact_whatsapp' else 'contact_other' end,
    x.client_id,false,false,false,false,false,false,false,false from public.crm_contacts x where x.occurred_at>=v_start and x.occurred_at<v_end and (v_branch is null or x.branch_id=v_branch)
   union all select nf.entered_by::text,null,case when nf.next_followup_date<today then 'open_overdue' else 'open' end,null,false,false,false,false,false,false,false,false
    from public.not_bought_followups nf where not public.not_bought_followup_status_is_done(nf.status) and (v_branch is null or nf.branch_id=v_branch)
  ), grouped as materialized (
   select f.person,coalesce(r.name,max(f.person_name)) employee,b.name branch,
    count(*) filter(where metric='lead') leads_registered,count(*) filter(where metric='lead_call') lead_calls,count(*) filter(where metric='lead_call' and connected) connected_calls,
    count(*) filter(where metric in ('followup_update','followup_done')) followup_updates,count(*) filter(where metric in ('followup_update','followup_done') and connected) followup_calls_answered,
    count(*) filter(where metric='followup_done') followups_completed,count(*) filter(where metric in ('open','open_overdue')) followups_open,count(*) filter(where metric='open_overdue') followups_overdue,
    count(*) filter(where metric='visit') visits_attended,count(distinct client_id) filter(where metric='visit') customers_attended,count(distinct client_id) filter(where metric='visit' and purchased) customers_converted,
    count(*) filter(where metric='visit' and referrals) referrals_asked,count(*) filter(where metric='visit' and google) google_reviews_asked,count(*) filter(where metric='visit' and testimonial) testimonials_asked,
    count(*) filter(where metric='visit' and thank_you) thank_you_notes_asked,count(*) filter(where metric='visit' and instagram) instagram_asked,count(*) filter(where metric='visit' and feedback) feedback_forms_asked,
    count(*) filter(where metric='contact_call') logged_calls,count(*) filter(where metric='contact_whatsapp') whatsapp_messages,count(*) filter(where metric='contact_thank_you') thank_you_sent,
    count(*) filter(where metric='fms_stage') fms_stages_completed
   from facts f left join roster r on r.id::text=f.person left join public.branches b on b.id=r.branch_id
   where f.person is not null and (v_employee is null or f.person=v_employee::text) and (v_crm is null or lower(coalesce(r.name,f.person_name))=lower(v_crm))
   group by f.person,r.name,b.name
   having count(*) filter(where metric not in ('open','open_overdue'))>0 or count(*) filter(where metric in ('open','open_overdue'))>0
  ), page as (select * from grouped order by employee,person offset p_offset limit p_limit)
  select jsonb_build_object('total',(select count(*) from grouped),'rows',coalesce(jsonb_agg((to_jsonb(p)-'person')||jsonb_build_object('employee_key',p.person) order by p.employee,p.person),'[]')) into result from page p;
  return result;
 end if;

 if p_key='customer_report_sales' then
  -- A sale is a verified purchase on a recorded visit (walkin_purchase_evidence), never a
  -- visit alone and never a completed FMS negotiation stage.
  with visits as materialized (
   select t.salesperson_id,t.client_id,crm_private.saved_walkin_status(t.buy_status,vf.additional_fields)::text status,
    crm_private.walkin_purchase_evidence(t.buy_status,t.bought_categories,vf.did_buy,vf.additional_fields) purchased
   from public.client_timeline t left join public.visit_forms vf on vf.client_timeline_id=t.id
   where t.salesperson_id is not null and t.event_date>=v_start and t.event_date<v_end and (v_branch is null or t.branch_id=v_branch) and (v_employee is null or t.salesperson_id=v_employee)
  ), people as materialized (
   select distinct salesperson_id id from visits
   union select c.last_salesperson_id from public.clients c where c.last_salesperson_id is not null and (v_employee is null or c.last_salesperson_id=v_employee) and (v_branch is null or c.last_branch_id=v_branch)
  ), grouped as materialized (
   select p.id,u.name salesperson,b.name branch,
    (select count(*) from public.clients c where c.last_salesperson_id=p.id) customers_assigned,
    count(v.client_id) visits_attended,count(distinct v.client_id) customers_attended,
    count(*) filter(where v.purchased) purchase_visits,count(distinct v.client_id) filter(where v.purchased) verified_buyers,
    count(*) filter(where v.status='NO') not_bought,
    count(*) filter(where v.status in ('ORDER_PLACED','YES_AND_ORDER_PLACED','ORDER_PLACED_AND_BUYING_NEW_PRODUCT','ORDER_PLACED_AND_MAKING_NEW_ORDER','ORDER_PICKUP_AND_MAKING_NEW_ORDER','REPAIR_PLACED_AND_MAKING_NEW_ORDER','REPAIR_PICKUP_AND_MAKING_NEW_ORDER')) orders_placed,
    count(*) filter(where v.status like 'ORDER_PICKUP%') orders_picked_up,count(*) filter(where v.status='PRODUCT_RETURN') returns,count(*) filter(where v.status='PRODUCT_EXCHANGE') exchanges,
    count(*) filter(where v.status like 'REPAIR_%') repair_visits,count(*) filter(where v.status in ('STORE_VISIT','PRICE_CALCULATION')) browse_only_visits,
    count(*) filter(where v.client_id is not null and v.status is null) outcome_not_recorded,
    (select count(*) from public.not_bought_history h where h.updated_by=p.id and h.created_at>=v_start and h.created_at<v_end
      and public.not_bought_followup_status_is_done(h.status) and not public.not_bought_followup_status_is_done(coalesce(h.previous_status,''))) followups_completed
   from people p left join visits v on v.salesperson_id=p.id left join public.users u on u.id=p.id left join public.branches b on b.id=u.branch_id
   where p.id is not null group by p.id,u.name,b.name
  ), page as (select * from grouped order by salesperson nulls last,id offset p_offset limit p_limit)
  select jsonb_build_object('total',(select count(*) from grouped),'rows',coalesce(jsonb_agg(jsonb_build_object(
    'employee_key',p.id,'salesperson',coalesce(p.salesperson,'Unknown salesperson'),'branch',p.branch,'customers_assigned',p.customers_assigned,
    'visits_attended',p.visits_attended,'customers_attended',p.customers_attended,'purchase_visits',p.purchase_visits,'verified_buyers',p.verified_buyers,
    'conversion_rate',case when p.customers_attended=0 then null else round(100.0*p.verified_buyers/p.customers_attended,1) end,
    'not_bought',p.not_bought,'orders_placed',p.orders_placed,'orders_picked_up',p.orders_picked_up,'returns',p.returns,'exchanges',p.exchanges,
    'repair_visits',p.repair_visits,'browse_only_visits',p.browse_only_visits,'outcome_not_recorded',p.outcome_not_recorded,'followups_completed',p.followups_completed
   ) order by p.salesperson nulls last,p.id),'[]')) into result from page p;
  return result;
 end if;

 raise exception 'Unknown CRM report' using errcode='22023';
end $$;

-- Preview for the signed-in CRM user (same company-wide read every active CRM user already has).
create function public.get_crm_business_report(p_key text,p_filters jsonb default '{}',p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid report page' using errcode='22023';end if;
 return crm_private.business_report(p_key,coalesce(p_filters,'{}'),p_offset,p_limit,null);
end $$;

create function public.get_crm_business_report_options() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501';end if;
 return jsonb_build_object(
  'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'jewelos_branch_id',b.jewelos_branch_id) order by b.name) from public.branches b where b.active),'[]'),
  'employees',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name) order by u.name) from public.users u where u.active),'[]'),
  'crmNames',coalesce((select jsonb_agg(jsonb_build_object('id',n,'name',n) order by n) from (select distinct btrim(crm_name) n from public.client_timeline where nullif(btrim(crm_name),'') is not null and event_date>now()-interval '2 years') q),'[]'),
  'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s,'name',s) order by s) from (
    select distinct btrim(label) s from public.lookup_source_of_leads where active and nullif(btrim(label),'') is not null
    union select distinct btrim(channel) from public.crm_customer_workflow_events where nullif(btrim(channel),'') is not null) q),'[]'));
end $$;

-- Customer picker for the 360 report: name, MKC ID, phone or Instagram ID.
create function public.find_crm_report_customers(p_search text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501';end if;
 if length(btrim(coalesce(p_search,''))) not between 2 and 100 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('client_id',c.client_id,'customer_id',c.client_code,'name',c.primary_name,'phone',crm_private.report_phone(c.primary_phone_country_code,c.primary_phone)) order by c.primary_name,c.client_id)
  from (select c.* from public.clients c where c.client_id in (select x from public.crm_search_client_ids(p_search) x) order by c.primary_name,c.client_id limit 20) c),'[]'::jsonb);
end $$;

-- The existing export adapter, extended with the business reports. Unchanged checks:
-- service role only; requester must still hold an active CRM administrator grant.
create or replace function public.crm_customer_export_batch(p_tenant uuid,p_actor uuid,p_export_id uuid,p_key text,p_filters jsonb,p_before timestamptz,p_offset integer,p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare query text;result jsonb;actor uuid;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Export worker required' using errcode='42501';end if;
 -- Root reports.export is checked separately. CRM grants and source membership are checked again here.
 select u.id into actor from public.users u join public.crm_sso_access_grants g on g.legacy_crm_user_id=u.id
 join crm_private.master_members m on m.jewelos_user_id=g.jewelos_user_id and m.tenant_id=p_tenant and m.active
 where g.jewelos_user_id=p_actor and g.active and u.active and u.role='super_admin';
 if actor is null or not exists(select 1 from crm_private.customer_sources where tenant_id=p_tenant and enabled) then raise exception 'CRM export administrator required' using errcode='42501';end if;
 if p_offset<0 or p_limit not between 1 and 500 or p_before is null or p_export_id is null or jsonb_typeof(p_filters) is distinct from 'object' or pg_column_size(p_filters)>16384 then raise exception 'Invalid export batch' using errcode='22023';end if;
 if p_key like 'customer_report_%' then
  result:=crm_private.business_report(p_key,p_filters,p_offset,p_limit,p_before);
  perform crm_private.write_audit_log('crm.customer_export_batch',null,jsonb_build_object('export_id',p_export_id,'actor_id',actor,'key',p_key,'offset',p_offset,'rows',jsonb_array_length(result->'rows')));
  return result-'summary';
 end if;
 query:=case p_key
 when 'customer_master' then $q$select c.client_id::text source_id,c.client_id,c.primary_name::text name,c.primary_phone::text phone,c.profile_updated_at occurred_at,c.last_branch_id branch_id,null::text channel,null::text workflow_id,null::text stage_id,null::uuid actor_id,null::jsonb assigned_to,c.lifecycle_stage::text status,to_jsonb(c)||crm_private.customer_commercial_summary(c.client_id) details from public.clients c$q$
 when 'customer_enquiries' then $q$select 'lead:'||l.id source_id,l.client_id,l.name::text,l.phone_number::text phone,l.created_at occurred_at,l.branch_id,l.source_channel::text channel,null::text workflow_id,null::text stage_id,l.created_by actor_id,null::jsonb assigned_to,'lead'::text status,l.field_values details from public.leads l
 union all select e.event_id,e.client_id,c.primary_name,c.primary_phone,e.occurred_at,e.branch_id,e.channel,e.workflow->>'instanceId',e.workflow->>'instanceStageId',e.actor_id,e.workflow->'assignedUserIds',e.kind,e.provenance||jsonb_build_object('answers',e.answers,'workflow',e.workflow) from public.crm_customer_workflow_events e join public.clients c using(client_id) where e.kind='form.submitted'$q$
 when 'customer_stages' then $q$select e.event_id source_id,e.client_id,c.primary_name::text name,c.primary_phone::text phone,e.occurred_at,e.branch_id,e.channel,e.workflow->>'instanceId' workflow_id,e.workflow->>'instanceStageId' stage_id,e.actor_id,e.workflow->'assignedUserIds' assigned_to,e.workflow->>'status' status,e.provenance||jsonb_build_object('workflow',e.workflow,'answers',e.answers) details from public.crm_customer_workflow_events e join public.clients c using(client_id)$q$
 when 'customer_activity' then $q$select a.activity_id source_id,a.client_id,c.primary_name::text name,c.primary_phone::text phone,a.occurred_at,a.branch_id,a.channel,a.details#>>'{workflow,instanceId}' workflow_id,a.details#>>'{workflow,instanceStageId}' stage_id,a.actor_id,a.details#>'{workflow,assignedUserIds}' assigned_to,a.kind status,a.details from public.crm_client_activity a join public.clients c using(client_id)$q$
 when 'customer_followups' then $q$select f.id::text source_id,f.client_id,c.primary_name::text name,c.primary_phone::text phone,f.created_at occurred_at,f.branch_id,'CRM'::text channel,null::text workflow_id,null::text stage_id,f.entered_by actor_id,null::jsonb assigned_to,f.status::text,to_jsonb(f) details from public.not_bought_followups f join public.clients c using(client_id)
 union all select e.event_id,e.client_id,c.primary_name,c.primary_phone,e.occurred_at,e.branch_id,e.channel,e.workflow->>'instanceId',e.workflow->>'instanceStageId',e.actor_id,e.workflow->'assignedUserIds',e.kind,jsonb_build_object('answers',e.answers,'provenance',e.provenance,'workflow',e.workflow) from public.crm_customer_workflow_events e join public.clients c using(client_id) where exists(select 1 from jsonb_array_elements(e.answers) a where a->>'destination'='next_follow_up')$q$
 when 'customer_commercial' then $q$select t.id::text source_id,t.client_id,c.primary_name::text name,c.primary_phone::text phone,t.event_date occurred_at,t.branch_id,'STORE'::text channel,null::text workflow_id,null::text stage_id,t.salesperson_id actor_id,null::jsonb assigned_to,t.buy_status::text status,to_jsonb(t)||jsonb_build_object('verifiedPurchase',crm_private.walkin_purchase_evidence(t.buy_status,t.bought_categories,f.did_buy,f.additional_fields),'savedForm',to_jsonb(f)) details from public.client_timeline t join public.clients c using(client_id) left join public.visit_forms f on f.client_timeline_id=t.id$q$
 when 'customer_exceptions' then $q$select e.event_id source_id,e.review_client_id client_id,null::text name,null::text phone,e.received_at occurred_at,nullif(e.payload->>'branchId','')::uuid branch_id,e.payload->>'channel' channel,e.payload#>>'{workflow,instanceId}' workflow_id,e.payload#>>'{workflow,instanceStageId}' stage_id,nullif(e.payload->>'actorId','')::uuid actor_id,e.payload#>'{workflow,assignedUserIds}' assigned_to,e.review_reason status,jsonb_build_object('candidateIds',e.candidates,'result',e.result,'sourceTime',e.payload->'occurredAt') details from crm_private.customer_event_inbox e where e.applied_at is null and e.tenant_id=$4$q$
 else null end;
 if query is null then raise exception 'Unknown customer export' using errcode='22023';end if;
 execute 'with records as materialized(select * from ('||query||')r where occurred_at<=$2
 and (nullif($1->>''clientId'','''') is null or client_id=($1->>''clientId'')::uuid)
 and (nullif($1->>''branchId'','''') is null or branch_id=($1->>''branchId'')::uuid)
 and (nullif($1->>''channel'','''') is null or channel=$1->>''channel'')
 and (nullif($1->>''flowId'','''') is null or details#>>''{workflow,flowId}''=$1->>''flowId'')
 and (nullif($1->>''stageId'','''') is null or details#>>''{workflow,stageId}''=$1->>''stageId'')
 and (nullif($1->>''instanceId'','''') is null or workflow_id=$1->>''instanceId'')
 and (nullif($1->>''assignedId'','''') is null or assigned_to @> jsonb_build_array($1->>''assignedId''))
 and (nullif($1->>''status'','''') is null or status=$1->>''status'')
 and (nullif($1->>''from'','''') is null or occurred_at>=($1->>''from'')::timestamptz)
 and (nullif($1->>''until'','''') is null or occurred_at<($1->>''until'')::timestamptz)),
 page as(select * from records order by occurred_at,source_id offset $3 limit $5)
 select jsonb_build_object(''rows'',coalesce((select jsonb_agg(case when $6=''customer_master'' then to_jsonb(page)||jsonb_build_object(''details'',crm_private.effective_customer_profile(page.client_id)||crm_private.customer_commercial_summary(page.client_id)) else to_jsonb(page) end) from page),''[]''),''total'',(select count(*) from records))'
 into result using p_filters,p_before,p_offset,p_tenant,p_limit,p_key;
 -- Audit only job identity and counts, never exported customer answers.
 perform crm_private.write_audit_log('crm.customer_export_batch',null,jsonb_build_object('export_id',p_export_id,'actor_id',actor,'key',p_key,'offset',p_offset,'rows',jsonb_array_length(result->'rows')));
 return result;
end $$;

create index if not exists crm_workflow_events_kind_journey on public.crm_customer_workflow_events(kind,journey_key,occurred_at,event_id);
create index if not exists crm_lead_call_history_lead_created on public.lead_call_history(lead_id,created_at desc,id desc);
create index if not exists crm_not_bought_history_updated_by on public.not_bought_history(updated_by,created_at);
create index if not exists crm_clients_last_salesperson on public.clients(last_salesperson_id);

revoke all on function crm_private.report_json_text(jsonb),crm_private.report_answers_text(jsonb),crm_private.report_projection(uuid,text),
 crm_private.report_visit_source(text,text),crm_private.report_client_sources(uuid),
 crm_private.report_phone(text,text),crm_private.report_label(text),
 crm_private.business_report(text,jsonb,integer,integer,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.get_crm_business_report(text,jsonb,integer,integer),public.get_crm_business_report_options(),public.find_crm_report_customers(text) from public,anon,service_role;
grant execute on function public.get_crm_business_report(text,jsonb,integer,integer),public.get_crm_business_report_options(),public.find_crm_report_customers(text) to authenticated;
revoke all on function public.crm_customer_export_batch(uuid,uuid,uuid,text,jsonb,timestamptz,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.crm_customer_export_batch(uuid,uuid,uuid,text,jsonb,timestamptz,integer,integer) to service_role;
notify pgrst,'reload schema';
