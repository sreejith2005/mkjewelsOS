-- One person-search predicate for the header and its paged client results.
-- Invoker reads retain the source tables' RLS. No records/history are copied or edited.
create function public.crm_search_client_ids(p_search text)
returns setof uuid language sql stable security invoker set search_path='' set jit=off as $$
with input as materialized (
 select lower(regexp_replace(btrim(p_search),'[[:space:]]+',' ','g')) as value,
 regexp_replace(p_search,'[^0-9]','','g') as digits,crm_private.phone_key(p_search) as phone,
 regexp_match(upper(regexp_replace(btrim(p_search),'[[:space:]]+','','g')),'^(MKC|MKF|MKREF)-?([0-9]+)$') as code
 where (select public.current_user_role()) is not null and length(btrim(p_search)) between 1 and 200
), matches as (
 select c.client_id from public.clients c left join public.households h on h.id=c.household_id cross join input i
 where case when i.code is not null then
   (i.code[1]='MKC' and c.client_code='MKC-'||ltrim(i.code[2],'0'))
   or (i.code[1]='MKF' and h.household_code='MKF-'||ltrim(i.code[2],'0'))
   or (i.code[1]='MKREF' and c.referral_code='MKREF-'||ltrim(i.code[2],'0'))
 else
   strpos(lower(regexp_replace(c.primary_name,'[[:space:]]+',' ','g')),i.value)>0
   or exists(select 1 from unnest(c.other_names) n where strpos(lower(regexp_replace(n,'[[:space:]]+',' ','g')),i.value)>0)
   or (length(i.digits)>=3 and case when i.phone is not null then regexp_replace(coalesce(c.primary_phone,''),'[^0-9]','','g')=i.phone else strpos(regexp_replace(coalesce(c.primary_phone,''),'[^0-9]','','g'),i.digits)>0 end)
 end
 union
 select p.client_id from public.client_phone_index p cross join input i
 where i.code is null and length(i.digits)>=3 and case when i.phone is not null then regexp_replace(p.phone,'[^0-9]','','g')=i.phone else strpos(regexp_replace(p.phone,'[^0-9]','','g'),i.digits)>0 end
 union
 select l.client_id from public.leads l cross join input i
 where i.code is null and l.client_id is not null and (
 strpos(lower(regexp_replace(coalesce(l.name,''),'[[:space:]]+',' ','g')),i.value)>0
 or (length(i.digits)>=3 and case when i.phone is not null then regexp_replace(l.phone_number,'[^0-9]','','g')=i.phone else strpos(regexp_replace(l.phone_number,'[^0-9]','','g'),i.digits)>0 end))
 union
 select r.referred_client_id from public.referrals r cross join input i
 where i.code is null and r.referred_client_id is not null and (
 strpos(lower(regexp_replace(r.referral_name,'[[:space:]]+',' ','g')),i.value)>0
 or (length(i.digits)>=3 and case when i.phone is not null then regexp_replace(r.referral_number,'[^0-9]','','g')=i.phone else strpos(regexp_replace(r.referral_number,'[^0-9]','','g'),i.digits)>0 end))
 union
 select t.client_id from public.client_timeline t cross join input i
 where i.code is null and strpos(lower(coalesce(t.reference_number,'')),i.value)>0
)
select client_id from matches where client_id is not null;
$$;
revoke all on function public.crm_search_client_ids(text) from public,anon,authenticated,service_role;
grant execute on function public.crm_search_client_ids(text) to authenticated;

create or replace function public.search_clients(search_text text,result_limit integer default 8)
returns table(client_id uuid,primary_name text,primary_phone text,last_visit_date timestamptz,last_branch_name text,matched_phone text,total_visits integer,last_buy_status text,client_code text,household_code text,referral_code text)
language sql stable security invoker set search_path='' set jit=off as $$
with matching as materialized(select public.crm_search_client_ids(search_text) as id),
input as (select regexp_replace(search_text,'[^0-9]','','g') as digits,crm_private.phone_key(search_text) as phone,lower(regexp_replace(btrim(search_text),'[[:space:]]+',' ','g')) as value)
select c.client_id,c.primary_name::text,c.primary_phone::text,c.last_visit_date,b.name::text,p.phone::text,c.total_visits,c.last_buy_status::text,c.client_code,h.household_code,c.referral_code
from matching m join public.clients c on c.client_id=m.id
left join public.branches b on b.id=c.last_branch_id
left join public.households h on h.id=c.household_id cross join input i
left join lateral (select pi.phone from public.client_phone_index pi
 where pi.client_id=c.client_id and length(i.digits)>=3 and case when i.phone is not null then pi.phone=i.phone else strpos(pi.phone,i.digits)>0 end
 order by (pi.phone=i.phone) desc,pi.phone limit 1) p on true
order by (p.phone=i.phone or c.primary_phone=i.phone) desc nulls last,(lower(regexp_replace(btrim(c.primary_name),'[[:space:]]+',' ','g'))=i.value) desc,c.last_visit_date desc nulls last,c.primary_name,c.client_id
limit least(greatest(result_limit,1),20);
$$;
revoke all on function public.search_clients(text,integer) from public,anon,service_role;
grant execute on function public.search_clients(text,integer) to authenticated;

-- Preserve the existing bounded filters, ordering, projection and 200-row server cap.
CREATE OR REPLACE FUNCTION public.browse_crm_records_page(p_filters jsonb DEFAULT '{}'::jsonb, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$ declare result jsonb;begin execute $read$
with activity as materialized (
 select client_id,latest_interaction_at as latest,first_recorded_at as registered,lead_source from public.crm_client_activity_summary
), records as (
 select c.client_id,c.client_code,c.primary_name,c.primary_phone,c.city,c.state,c.total_visits,c.last_visit_date,c.last_buy_status,c.other_names,c.last_branch_id,c.client_potential_category,i.household_code,c.referral_code,coalesce(a.registered,c.profile_updated_at) as registered_at,a.latest as latest_interaction_at,
 (case when c.total_purchase_visits>0 then 'purchased' when c.total_visits>0 then 'visited' else c.lifecycle_stage end)::text as effective_stage,
 case when c.lifecycle_stage in ('lead','engaged') and c.total_visits=0 then 'lead' else 'client' end as record_type,
 a.lead_source as lead_source
 from public.clients c left join activity a using(client_id) left join public.households i on i.id=c.household_id where (select public.current_user_role()) is not null
), filtered as (
 select r.client_id,r.primary_name,r.registered_at,r.latest_interaction_at,r.last_visit_date,r.effective_stage,r.record_type from records r where
 (coalesce($1->>'search','')='' or r.client_id in (select public.crm_search_client_ids($1->>'search')))
 and (coalesce($1->>'type','') in ('','all') or r.record_type=$1->>'type')
 and (coalesce($1->>'stage','')='' or r.effective_stage=$1->>'stage')
 and (coalesce($1->>'branch','')='' or r.last_branch_id::text=$1->>'branch')
 and (coalesce($1->>'city','')='' or r.city ilike '%'||($1->>'city')||'%')
 and (coalesce($1->>'state','')='' or r.state ilike '%'||($1->>'state')||'%')
 and (coalesce($1->>'source','')='' or r.lead_source ilike '%'||($1->>'source')||'%')
 and (coalesce($1->>'potential','')='' or upper(r.client_potential_category)=upper($1->>'potential'))
 and (coalesce($1->>'purchase','')='' or r.last_buy_status::text=$1->>'purchase')
 and (nullif($1->>'min_visits','') is null or r.total_visits>=($1->>'min_visits')::integer)
 and (nullif($1->>'max_visits','') is null or r.total_visits<=($1->>'max_visits')::integer)
 and (nullif($1->>'created_from','') is null or r.registered_at>=(($1->>'created_from')::date::timestamp at time zone 'Asia/Kolkata'))
 and (nullif($1->>'created_to','') is null or r.registered_at<((($1->>'created_to')::date+1)::timestamp at time zone 'Asia/Kolkata'))
 and (nullif($1->>'interaction_from','') is null or r.latest_interaction_at>=(($1->>'interaction_from')::date::timestamp at time zone 'Asia/Kolkata'))
 and (nullif($1->>'interaction_to','') is null or r.latest_interaction_at<((($1->>'interaction_to')::date+1)::timestamp at time zone 'Asia/Kolkata'))
), page as (
 select * from filtered order by
 case when $1->>'sort'='name' then primary_name end asc,
 case when $1->>'sort'='created' then registered_at when $1->>'sort'='visit' then last_visit_date
 else coalesce(latest_interaction_at,registered_at) end desc nulls last,client_id
 offset greatest($2,0) limit least(greatest($3,1),200)
)
select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg((jsonb_build_object('client_id',page.client_id,'client_code',c.client_code,'primary_name',page.primary_name,'primary_phone',c.primary_phone,'city',c.city,'state',c.state,'total_visits',c.total_visits,'last_visit_date',page.last_visit_date,'last_buy_status',c.last_buy_status,'record_type',page.record_type,'registered_at',page.registered_at,'latest_interaction_at',page.latest_interaction_at))||jsonb_build_object('lifecycle_stage',page.effective_stage)) from page join public.clients c using(client_id)),'[]'::jsonb));$read$ into result using p_filters,$2,p_limit;return result;end $function$;
revoke all on function public.browse_crm_records_page(jsonb,integer,integer) from public,anon,service_role;
grant execute on function public.browse_crm_records_page(jsonb,integer,integer) to authenticated;

-- Calling records link to the referred person even before conversion.
create or replace view public.crm_followup_browse_rows with(security_invoker=true) as
 select 'not_bought'::text as kind,f.id,f.client_id,f.reference_number::text,f.status::text,f.next_followup_date,f.remark,f.action_point,f.branch_id,f.followup_count,f.created_at,
 c.primary_name::text as client_name,coalesce(c.primary_phone,'')::text as phone,coalesce(t.crm_name,'')::text as crm_name,t.event_date as visit_date,
 t.seen_categories,t.product_requirement,t.remark as product_seen_remark,f.source_visit_form_id,
 null::uuid as converted_client_id,null::text as assigned_doer,null::uuid as given_by_client_id,null::text as given_by_name,null::text as referral_name,null::text as referral_number,null::text as salesperson,null::uuid as referred_client_id
 from public.not_bought_followups f join public.clients c on c.client_id=f.client_id left join public.client_timeline t on t.id=f.source_timeline_id
 union all
 select 'referral',f.id,null::uuid,null::text,f.status::text,f.next_followup_date,f.remark,f.action_point,r.branch_id,f.followup_count,coalesce(r.created_at,f.created_at),
 null::text,null::text,coalesce(r.crm_name,''),null::timestamptz,null::text[],null::text,null::text,null::uuid,
 f.converted_client_id,r.assigned_doer,r.given_by_client_id,coalesce(c.primary_name,'Client record'),r.referral_name::text,r.referral_number::text,coalesce(u.name,'')::text,r.referred_client_id
 from public.referral_calling f join public.referrals r on r.id=f.referral_id left join public.clients c on c.client_id=r.given_by_client_id left join public.users u on u.id=r.salesperson_id;
