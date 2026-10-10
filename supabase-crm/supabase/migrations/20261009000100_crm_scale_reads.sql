-- Bounded CRM reads. All public read contracts are invokers and retain source RLS.
-- Pure predicate: qualified built-ins/operators and no session configuration allow
-- PostgreSQL to inline this expression instead of executing a function per row/tab.
create function public.crm_queue_tab(p_status text,p_date date,p_count integer,p_tab text,p_today date,p_converted boolean default false)
returns boolean language sql immutable as $$
 select case p_tab
 when 'converted' then p_converted or p_status OPERATOR(pg_catalog.=) 'CONVERTED TO CLIENT'
 when 'done' then pg_catalog.upper(pg_catalog.btrim(p_status)) OPERATOR(pg_catalog.=) any(array['CONVERTED TO CLIENT','ALREADY PURCHASED FROM MK JEWELS','NOT INTERESTED','NO REQUIREMENT AT THE MOMENT','WRONG NUMBER','DO NOT CALL','CLOSED','CONVERTED','DONE','FOLLOW UP DONE'])
 when 'pending' then not (pg_catalog.upper(pg_catalog.btrim(p_status)) OPERATOR(pg_catalog.=) any(array['CONVERTED TO CLIENT','ALREADY PURCHASED FROM MK JEWELS','NOT INTERESTED','NO REQUIREMENT AT THE MOMENT','WRONG NUMBER','DO NOT CALL','CLOSED','CONVERTED','DONE','FOLLOW UP DONE']))
 when 'inprocess' then not (pg_catalog.upper(pg_catalog.btrim(p_status)) OPERATOR(pg_catalog.=) any(array['CONVERTED TO CLIENT','ALREADY PURCHASED FROM MK JEWELS','NOT INTERESTED','NO REQUIREMENT AT THE MOMENT','WRONG NUMBER','DO NOT CALL','CLOSED','CONVERTED','DONE','FOLLOW UP DONE'])) and pg_catalog.upper(pg_catalog.btrim(p_status)) OPERATOR(pg_catalog.<>) 'HISTORICAL' and (p_count OPERATOR(pg_catalog.>) 0 or pg_catalog.upper(pg_catalog.btrim(p_status)) OPERATOR(pg_catalog.<>) 'PENDING')
 else not (pg_catalog.upper(pg_catalog.btrim(p_status)) OPERATOR(pg_catalog.=) any(array['CONVERTED TO CLIENT','ALREADY PURCHASED FROM MK JEWELS','NOT INTERESTED','NO REQUIREMENT AT THE MOMENT','WRONG NUMBER','DO NOT CALL','CLOSED','CONVERTED','DONE','FOLLOW UP DONE'])) and pg_catalog.upper(pg_catalog.btrim(p_status)) OPERATOR(pg_catalog.<>) 'HISTORICAL' and (p_date is null or p_date OPERATOR(pg_catalog.<=) p_today) end;
$$;
revoke all on function public.crm_queue_tab(text,date,integer,text,date,boolean) from public,anon;
grant execute on function public.crm_queue_tab(text,date,integer,text,date,boolean) to authenticated;

create view public.crm_followup_browse_rows with(security_invoker=true) as
 select 'not_bought'::text as kind,f.id,f.client_id,f.reference_number::text,f.status::text,f.next_followup_date,f.remark,f.action_point,f.branch_id,f.followup_count,f.created_at,
 c.primary_name::text as client_name,coalesce(c.primary_phone,'')::text as phone,coalesce(t.crm_name,'')::text as crm_name,t.event_date as visit_date,
 t.seen_categories,t.product_requirement,t.remark as product_seen_remark,f.source_visit_form_id,
 null::uuid as converted_client_id,null::text as assigned_doer,null::uuid as given_by_client_id,null::text as given_by_name,null::text as referral_name,null::text as referral_number,null::text as salesperson
 from public.not_bought_followups f join public.clients c on c.client_id=f.client_id left join public.client_timeline t on t.id=f.source_timeline_id
 union all
 select 'referral',f.id,null::uuid,null::text,f.status::text,f.next_followup_date,f.remark,f.action_point,r.branch_id,f.followup_count,coalesce(r.created_at,f.created_at),
 null::text,null::text,coalesce(r.crm_name,''),null::timestamptz,null::text[],null::text,null::text,null::uuid,
 f.converted_client_id,r.assigned_doer,r.given_by_client_id,coalesce(c.primary_name,'Client record'),r.referral_name::text,r.referral_number::text,coalesce(u.name,'')::text
 from public.referral_calling f join public.referrals r on r.id=f.referral_id left join public.clients c on c.client_id=r.given_by_client_id left join public.users u on u.id=r.salesperson_id;
revoke all on public.crm_followup_browse_rows from public,anon,authenticated,service_role;
grant select on public.crm_followup_browse_rows to authenticated;

create index not_bought_client_reference_idx on public.not_bought_followups(client_id,reference_number,id);
create index not_bought_history_page_idx on public.not_bought_history(followup_id,created_at desc,id desc);
create index referral_history_page_idx on public.referral_calling_history(referral_calling_id,created_at desc,id desc);
create index followup_due_page_idx on public.not_bought_followups(next_followup_date,id);
create index referral_due_page_idx on public.referral_calling(next_followup_date,id);

create function public.browse_crm_followups(p_kind text,p_filters jsonb default '{}',p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; today date:=(statement_timestamp() at time zone 'Asia/Kolkata')::date;
begin
 if (select public.current_user_role()) is null then raise exception 'active CRM profile required' using errcode='42501'; end if;
 if p_kind not in ('not_bought','referral') then raise exception 'invalid queue kind' using errcode='22023'; end if;
 with roster as materialized(select distinct upper(regexp_replace(btrim(coalesce(crm_name,'')), '[[:space:]]+', ' ', 'g')) as name from public.crm_allocation where active),
 base as materialized(select public.crm_queue_tab(r.status,r.next_followup_date,r.followup_count,'done',today,false) as is_done,upper(btrim(r.status))='HISTORICAL' as is_historical,r.id,r.status,r.next_followup_date,r.branch_id,r.followup_count,r.created_at,r.converted_client_id,upper(regexp_replace(btrim(coalesce(case when p_kind='referral' then coalesce(nullif(r.assigned_doer,''),r.crm_name) else r.crm_name end,'')), '[[:space:]]+', ' ', 'g')) as doer,case when p_filters->>'sort'='client' then lower(btrim(client_name)) when p_filters->>'sort'='referral' then lower(btrim(referral_name)) when p_filters->>'sort'='given_by' then lower(btrim(given_by_name)) when p_filters->>'sort'='crm' then lower(btrim(case when p_kind='referral' then coalesce(nullif(assigned_doer,''),crm_name) else crm_name end)) end as sort_name,case when p_filters->>'sort'='followups' then followup_count end as sort_count,case when p_filters->>'sort'='next_soonest' then next_followup_date::timestamptz when p_filters->>'sort'='visit_oldest' then visit_date when p_filters->>'sort'='oldest' then created_at
 when p_kind='not_bought' and coalesce(p_filters->>'sort','default')='default' and coalesce(p_filters->>'tab','today')='today' then coalesce(next_followup_date::timestamptz,visit_date,'0001-01-01'::timestamptz) end as sort_asc,case when p_filters->>'sort'='next_latest' then next_followup_date::timestamptz when p_filters->>'sort'='visit_newest' then visit_date
 when p_kind='not_bought' and coalesce(p_filters->>'sort','default')='default' and coalesce(p_filters->>'tab','today')<>'today' then coalesce(next_followup_date::timestamptz,visit_date,'0001-01-01'::timestamptz)
 when coalesce(p_filters->>'sort',case when p_kind='referral' then 'newest' else 'default' end)='newest' then created_at end as sort_desc,
 case when coalesce(p_filters->>'search','')<>'' then lower(case when p_kind='not_bought' then concat_ws(' ',r.client_name,r.phone,r.reference_number) else concat_ws(' ',r.given_by_name,r.referral_name,r.referral_number,r.assigned_doer,r.crm_name,r.status,r.remark) end) end as search_text,
 case when coalesce(p_filters->>'search','')<>'' then regexp_replace(case when p_kind='not_bought' then r.phone else r.referral_number end,'[^0-9]','','g') end as search_phone from public.crm_followup_browse_rows r where kind=p_kind),
 filtered as materialized(select r.is_done,r.is_historical,r.id,r.status,r.next_followup_date,r.followup_count,r.created_at,r.converted_client_id,r.sort_name,r.sort_count,r.sort_asc,r.sort_desc from base r where
 (coalesce(p_filters->>'crm','')='' or case when p_filters->>'crm'='__off_roster__' then not exists(select 1 from roster where name=r.doer) else r.doer=p_filters->>'crm' end)
 and (coalesce(p_filters->>'status','')='' or r.status=p_filters->>'status')
 and (coalesce(p_filters->>'branch','')='' or r.branch_id::text=p_filters->>'branch')
 and (coalesce(p_filters->>'search','')='' or strpos(r.search_text,lower(p_filters->>'search'))>0
 or (regexp_replace(p_filters->>'search','[^0-9]','','g')<>'' and strpos(r.search_phone,regexp_replace(p_filters->>'search','[^0-9]','','g'))>0))),
 matching as (select * from filtered where case coalesce(p_filters->>'tab','today') when 'converted' then converted_client_id is not null or status='CONVERTED TO CLIENT' when 'done' then is_done when 'pending' then not is_done when 'inprocess' then not is_done and not is_historical and (followup_count>0 or upper(btrim(status))<>'PENDING') else not is_done and not is_historical and (next_followup_date is null or next_followup_date<=today) end),
 page as materialized(select * from matching order by sort_name asc,sort_count desc,sort_asc asc nulls last,sort_desc desc nulls last,
 created_at desc,id desc offset greatest(p_offset,0) limit least(greatest(p_limit,1),50)),
 page_rows as(select full_row.* from page selected cross join lateral(select r.* from public.crm_followup_browse_rows r where r.kind=p_kind and r.id=selected.id offset 0) full_row),
 enriched as(select (to_jsonb(p)-'doer'-'kind'-'source_visit_form_id'-'seen_categories')||jsonb_build_object(
 'reason',concat_ws(', ',array_to_string(v.not_bought_reasons,', '),nullif(v.not_bought_other,'')),
 'seen_categories',coalesce(array_to_string(p.seen_categories,', '),''),'product_requirement',coalesce(p.product_requirement,''),'product_seen_remark',coalesce(p.product_seen_remark,''),
 'history_count',case when p_kind='referral' then (select count(*) from public.referral_calling_history h where h.referral_calling_id=p.id)
 else (select count(*) from public.not_bought_history h join public.not_bought_followups f on f.id=h.followup_id where f.client_id=p.client_id and
 (f.reference_number is not distinct from p.reference_number or not exists(select 1 from public.not_bought_history exact_h join public.not_bought_followups exact_f on exact_f.id=exact_h.followup_id where exact_f.client_id=p.client_id and exact_f.reference_number is not distinct from p.reference_number))) end,
 'remark_history','','history','') as row from page_rows p left join public.visit_forms v on v.id=p.source_visit_form_id)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(row) from enriched),'[]'::jsonb),'total',(select count(*) from matching),
 'counts',(select jsonb_build_object('today',count(*) filter(where not f.is_done and not f.is_historical and (f.next_followup_date is null or f.next_followup_date<=today)),'pending',count(*) filter(where not f.is_done),'inprocess',count(*) filter(where not f.is_done and not f.is_historical and (f.followup_count>0 or upper(btrim(f.status))<>'PENDING')),'done',count(*) filter(where f.is_done),'converted',count(*) filter(where f.converted_client_id is not null or f.status='CONVERTED TO CLIENT')) from filtered f),
 'roster',coalesce((select jsonb_agg(name order by name) from roster where name<>''),'[]'::jsonb),
 'statuses',coalesce((select jsonb_agg(status order by status) from (select distinct status from base) s),'[]'::jsonb),
 'has_off_roster',exists(select 1 from base b where not exists(select 1 from roster where name=b.doer)),
 'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name) from public.branches b where exists(select 1 from base r where r.branch_id=b.id)),'[]'::jsonb),
 'profile',(select jsonb_build_object('name',u.name,'role',u.role) from public.users u where id=(select public.current_crm_user_id()))) into result;
 return result;
end $$;

create function public.read_crm_followup_history(p_kind text,p_id uuid,p_offset integer default 0,p_limit integer default 100)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if (select public.current_user_role()) is null then raise exception 'active CRM profile required' using errcode='42501'; end if;
 if p_kind not in ('not_bought','referral') then raise exception 'invalid queue kind' using errcode='22023'; end if;
 with target as(select * from public.not_bought_followups where p_kind='not_bought' and id=p_id),
 exact as(select exists(select 1 from public.not_bought_history h join public.not_bought_followups f on f.id=h.followup_id join target t on t.client_id=f.client_id and t.reference_number is not distinct from f.reference_number) as exact_found),
 history as(
 select h.id,h.created_at,concat(h.created_at,': ',h.status,case when coalesce(h.remark,'')<>'' then ' — '||h.remark else '' end) as text
 from public.not_bought_history h join public.not_bought_followups f on f.id=h.followup_id join target t on t.client_id=f.client_id where not (select exact.exact_found from exact) or t.reference_number is not distinct from f.reference_number
 union all select h.id,h.created_at,concat_ws(': ',nullif(h.entered_by,''),nullif(h.remark,'')) from public.referral_calling_history h where p_kind='referral' and h.referral_calling_id=p_id),
 page as(select * from history order by created_at desc,id desc offset greatest(p_offset,0) limit least(greatest(p_limit,1),100))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'text',text)) from page),'[]'::jsonb),'total',(select count(*) from history)) into result;
 return result;
end $$;
revoke all on function public.browse_crm_followups(text,jsonb,integer,integer),public.read_crm_followup_history(text,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.browse_crm_followups(text,jsonb,integer,integer),public.read_crm_followup_history(text,uuid,integer,integer) to authenticated;

-- Derived browse metadata only. Sources remain immutable evidence and authoritative.
create table public.crm_client_browse_state(
 client_id uuid primary key references public.clients(client_id) on delete cascade,
 first_recorded_at timestamptz,latest_interaction_at timestamptz,next_future_contact_at timestamptz,lead_source text
);
alter table public.crm_client_browse_state enable row level security;
create policy crm_client_browse_state_read on public.crm_client_browse_state for select to authenticated using((select public.current_user_role()) is not null);
revoke all on public.crm_client_browse_state from public,anon,authenticated,service_role;
grant select on public.crm_client_browse_state to authenticated;
-- Queue reads are branch scoped, unlike the other client activity sources. Keep that
-- contribution separate so a cached timestamp never widens source visibility.
create table public.crm_client_queue_browse_state(
 client_id uuid references public.clients(client_id) on delete cascade,branch_id uuid references public.branches(id),
 first_recorded_at timestamptz,latest_interaction_at timestamptz,next_future_contact_at timestamptz,primary key(client_id,branch_id)
);
alter table public.crm_client_queue_browse_state enable row level security;
create policy crm_client_queue_browse_state_read on public.crm_client_queue_browse_state for select to authenticated using(
 (select public.is_super_admin()) or ((select public.is_branch_staff(public.current_user_branch_id())) and branch_id=(select public.current_user_branch_id())));
revoke all on public.crm_client_queue_browse_state from public,anon,authenticated,service_role;
grant select on public.crm_client_queue_browse_state to authenticated;
create index crm_browse_latest_idx on public.crm_client_browse_state((coalesce(latest_interaction_at,first_recorded_at)) desc,client_id);
create index crm_browse_registered_idx on public.crm_client_browse_state(first_recorded_at desc,client_id);
create index crm_browse_future_idx on public.crm_client_browse_state(next_future_contact_at) where next_future_contact_at is not null;
create index lead_client_created_idx on public.leads(client_id,created_at desc,id);
create index lead_calls_lead_created_idx on public.lead_call_history(lead_id,created_at desc,id);
create index lead_stages_lead_changed_idx on public.lead_stage_history(lead_id,changed_at desc,id);
create index entry_queue_client_created_idx on public.entry_queue(client_id,created_at desc,id);
create index client_edits_client_created_idx on public.client_edit_log(client_id,created_at desc,id);
create index crm_phone_last_digits_idx on public.client_phone_index((right(phone::text,10)),client_id);

create function crm_private.refresh_client_browse_state(p_client uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_client is null or not exists(select 1 from public.clients where client_id=p_client) then return; end if;
 -- Serialize refreshes for one client before reading sources; concurrent contacts cannot
 -- overwrite a newer projection with a snapshot taken before the other writer committed.
 insert into public.crm_client_browse_state(client_id) values(p_client) on conflict do nothing;
 perform 1 from public.crm_client_browse_state where client_id=p_client for update;
 insert into public.crm_client_browse_state(client_id,first_recorded_at,latest_interaction_at,next_future_contact_at,lead_source)
 select p_client,min(occurred_at),max(occurred_at) filter(where is_contact and occurred_at<=statement_timestamp()),min(occurred_at) filter(where is_contact and occurred_at>statement_timestamp()),
 (select source.channel from (
  select coalesce(nullif(l.field_values->>'source_of_lead',''),l.source_channel::text) as channel,l.created_at as occurred_at,l.id from public.leads l where l.client_id=p_client
  union all select nullif(f.source_of_lead,''),t.event_date,t.id from public.visit_forms f join public.client_timeline t on t.id=f.client_timeline_id where t.client_id=p_client
 ) source where source.channel is not null order by source.occurred_at desc,source.id limit 1)
 from public.crm_client_activity where client_id=p_client and source_table<>'entry_queue'
 on conflict(client_id) do update set first_recorded_at=excluded.first_recorded_at,latest_interaction_at=excluded.latest_interaction_at,next_future_contact_at=excluded.next_future_contact_at,lead_source=excluded.lead_source;
 delete from public.crm_client_queue_browse_state where client_id=p_client;
 insert into public.crm_client_queue_browse_state
 select client_id,branch_id,min(created_at),max(created_at) filter(where created_at<=statement_timestamp()),min(created_at) filter(where created_at>statement_timestamp()) from public.entry_queue where client_id=p_client group by client_id,branch_id;
end $$;

create function public.crm_dashboard_summary(p_from timestamptz default null,p_until timestamptz default null,p_today date default (statement_timestamp() at time zone 'Asia/Kolkata')::date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if (select public.current_user_role()) is null then raise exception 'active CRM profile required' using errcode='42501';end if;
 with visits as materialized(select t.id,t.event_date,t.created_at,t.event_type,t.buy_status,t.branch_id,t.crm_name,t.client_id,t.remark,t.reference_number,b.name as branch_name from public.client_timeline t left join public.branches b on b.id=t.branch_id where (p_from is null or t.event_date>=p_from) and (p_until is null or t.event_date<p_until)),
 statuses as(select coalesce(buy_status::text,'') as status,count(*) as n from visits group by buy_status),
 trend as(select (event_date at time zone 'Asia/Kolkata')::date as day,count(*) as total,count(*) filter(where buy_status::text in ('YES','YES_AND_ORDER_PLACED','YES AND ORDER_PLACED')) as bought,count(*) filter(where buy_status::text='NO') as "notBought" from visits group by (event_date at time zone 'Asia/Kolkata')::date),
 recent as(select * from visits where (event_date at time zone 'Asia/Kolkata')::date in (p_today,p_today-1) order by coalesce(created_at,event_date) desc,id desc limit 25)
 select jsonb_build_object('statuses',coalesce((select jsonb_agg(to_jsonb(statuses)) from statuses),'[]'::jsonb),
 'trend',coalesce((select jsonb_agg(to_jsonb(trend) order by day) from trend),'[]'::jsonb),
 'branchBreakdown',coalesce((select jsonb_agg(to_jsonb(groups) order by visits desc,name) from(select coalesce(branch_name,'UNKNOWN') as name,count(*) as visits from visits group by branch_name) groups),'[]'::jsonb),
 'crmBreakdown',coalesce((select jsonb_agg(to_jsonb(groups) order by visits desc,name) from(select coalesce(crm_name,'UNKNOWN') as name,count(*) as visits from visits group by crm_name) groups),'[]'::jsonb),
 'recentVisits',coalesce((select jsonb_agg((to_jsonb(recent)-'branch_name')||jsonb_build_object('branch',case when branch_name is null then null else jsonb_build_object('name',branch_name) end)) from recent),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.crm_dashboard_summary(timestamptz,timestamptz,date) from public,anon,authenticated,service_role;
grant execute on function public.crm_dashboard_summary(timestamptz,timestamptz,date) to authenticated;
create function crm_private.client_browse_source_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare source jsonb; target uuid; seen uuid[]:='{}';
begin
 for source in select value from jsonb_array_elements(jsonb_build_array(case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end)) where value<>'null'::jsonb loop
  target:=null;
  if tg_table_name in ('leads','client_timeline','entry_queue','not_bought_followups','crm_contacts','client_edit_log') then target:=(source->>'client_id')::uuid;
  elsif tg_table_name in ('lead_call_history','lead_stage_history') then select client_id into target from public.leads where id=(source->>'lead_id')::uuid;
  elsif tg_table_name='visit_forms' then select client_id into target from public.client_timeline where id=(source->>'client_timeline_id')::uuid;
  elsif tg_table_name='not_bought_history' then select client_id into target from public.not_bought_followups where id=(source->>'followup_id')::uuid;
  elsif tg_table_name='referrals' then target:=(source->>'referred_client_id')::uuid;
  elsif tg_table_name='referral_calling' then select referred_client_id into target from public.referrals where id=(source->>'referral_id')::uuid;
  elsif tg_table_name='referral_calling_history' then select r.referred_client_id into target from public.referrals r join public.referral_calling f on f.referral_id=r.id where f.id=(source->>'referral_calling_id')::uuid;
  end if;
  if target is not null and not target=any(seen) then perform crm_private.refresh_client_browse_state(target);seen:=array_append(seen,target);end if;
 end loop;
 return null;
end $$;
revoke all on function crm_private.refresh_client_browse_state(uuid),crm_private.client_browse_source_changed() from public,anon,authenticated,service_role;

-- One set-based backfill, no source edits and no per-client full-database queries.
insert into public.crm_client_browse_state(client_id,first_recorded_at,latest_interaction_at,next_future_contact_at,lead_source)
with activity as(select client_id,min(occurred_at) as first,max(occurred_at) filter(where is_contact and occurred_at<=statement_timestamp()) as latest,min(occurred_at) filter(where is_contact and occurred_at>statement_timestamp()) as future from public.crm_client_activity where source_table<>'entry_queue' group by client_id),
sources as(select distinct on(client_id) client_id,channel from(
 select l.client_id,coalesce(nullif(l.field_values->>'source_of_lead',''),l.source_channel::text) as channel,l.created_at as occurred_at,l.id from public.leads l
 union all select t.client_id,nullif(f.source_of_lead,''),t.event_date,t.id from public.visit_forms f join public.client_timeline t on t.id=f.client_timeline_id
) s where channel is not null order by client_id,occurred_at desc,id)
select c.client_id,a.first,a.latest,a.future,s.channel from public.clients c left join activity a using(client_id) left join sources s using(client_id);
insert into public.crm_client_queue_browse_state
select client_id,branch_id,min(created_at),max(created_at) filter(where created_at<=statement_timestamp()),min(created_at) filter(where created_at>statement_timestamp()) from public.entry_queue where client_id is not null group by client_id,branch_id;
do $$ declare source_table text;begin
 foreach source_table in array array['leads','lead_call_history','lead_stage_history','client_timeline','entry_queue','not_bought_followups','not_bought_history','referrals','referral_calling','referral_calling_history','visit_forms','crm_contacts','client_edit_log'] loop
 execute format('create trigger zz_client_browse_state after insert or update or delete on public.%I for each row execute function crm_private.client_browse_source_changed()',source_table);
 end loop;
end $$;

-- Future-dated contacts become eligible with time, even without a later write.
create or replace view public.crm_client_activity_summary with(security_invoker=true) as
with matured as materialized(select client_id from public.crm_client_browse_state where next_future_contact_at<=statement_timestamp()),
future_contacts as materialized(select m.client_id,(select max(a.occurred_at) from public.crm_client_activity a where a.client_id=m.client_id and a.source_table<>'entry_queue' and a.is_contact and a.occurred_at<=statement_timestamp()) as latest from matured m),
matured_queue as materialized(select client_id,branch_id from public.crm_client_queue_browse_state where next_future_contact_at<=statement_timestamp()),
future_queue as materialized(select m.client_id,m.branch_id,(select max(q.created_at) from public.entry_queue q where q.client_id=m.client_id and q.branch_id=m.branch_id and q.created_at<=statement_timestamp()) as latest from matured_queue m),
queue as materialized(select s.client_id,min(s.first_recorded_at) as first,max(coalesce(f.latest,s.latest_interaction_at)) as latest from public.crm_client_queue_browse_state s left join future_queue f using(client_id,branch_id) group by s.client_id)
select s.client_id,least(s.first_recorded_at,q.first) as first_recorded_at,greatest(q.latest,coalesce(f.latest,s.latest_interaction_at)) as latest_interaction_at,s.lead_source
from public.crm_client_browse_state s left join queue q using(client_id) left join future_contacts f using(client_id);

-- Preserve the complete browse predicate/order contract, replace only its repeated work.
do $$ declare body text; old_source text; thin_output text;begin
 body:=pg_get_functiondef('public.browse_crm_records(jsonb,integer,integer)'::regprocedure);
 body:=replace(body,chr(13),'');
 if position('from public.crm_client_activity group by client_id' in body)=0 then raise exception 'Unexpected client browse activity contract';end if;
 body:=replace(body,'select client_id,max(occurred_at) filter(where is_contact and occurred_at<=statement_timestamp()) as latest,'||chr(10)||' min(occurred_at) as registered from public.crm_client_activity group by client_id',
 'select client_id,latest_interaction_at as latest,first_recorded_at as registered,lead_source from public.crm_client_activity_summary');
 old_source:=$source$(select source.channel from (
   select coalesce(nullif(l.field_values->>'source_of_lead',''),l.source_channel::text) as channel,l.created_at as occurred_at,l.id
   from public.leads l where l.client_id=c.client_id
   union all select nullif(f.source_of_lead,''),t.event_date,t.id from public.visit_forms f join public.client_timeline t on t.id=f.client_timeline_id where t.client_id=c.client_id
  ) source where source.channel is not null order by source.occurred_at desc,source.id limit 1)$source$;
 if position(old_source in body)=0 then raise exception 'Unexpected client browse source contract';end if;
 body:=replace(body,old_source,'a.lead_source');
 body:=replace(body,'with activity as (','with activity as materialized (');
 body:=replace(body,'left join public.client_identity i using(client_id)','left join public.households i on i.id=c.household_id');
 body:=replace(body,'coalesce(i.lifecycle_stage,c.lifecycle_stage)::text','(case when c.total_purchase_visits>0 then ''purchased'' when c.total_visits>0 then ''visited'' else c.lifecycle_stage end)::text');
 body:=replace(body,'select c.*,','select c.client_id,c.client_code,c.primary_name,c.primary_phone,c.city,c.state,c.total_visits,c.last_visit_date,c.last_buy_status,c.other_names,c.last_branch_id,c.client_potential_category,i.household_code,c.referral_code,');
 body:=replace(body,'and exists('||chr(10)||'    select 1 from public.client_phone_index pi where pi.client_id=r.client_id'||chr(10)||'    and right(pi.phone,10)=right(regexp_replace(p_filters->>''search'',''[^0-9]'','''',''g''),10))',
 'and r.client_id in(select pi.client_id from public.client_phone_index pi where right(pi.phone,10)=right(regexp_replace(p_filters->>''search'',''[^0-9]'','''',''g''),10))');
 body:=replace(body,'exists(select 1 from public.client_identity i where i.client_id=r.client_id and'||chr(10)||'    (i.household_code ilike ''%''||(p_filters->>''search'')||''%'' or i.referral_code ilike ''%''||(p_filters->>''search'')||''%''))',
 '(r.household_code ilike ''%''||(p_filters->>''search'')||''%'' or r.referral_code ilike ''%''||(p_filters->>''search'')||''%'')');
 body:=replace(body,'where public.current_user_role() is not null','where (select public.current_user_role()) is not null');
 thin_output:='jsonb_build_object(''client_id'',page.client_id,''client_code'',page.client_code,''primary_name'',page.primary_name,''primary_phone'',page.primary_phone,''city'',page.city,''state'',page.state,''total_visits'',page.total_visits,''last_visit_date'',page.last_visit_date,''last_buy_status'',page.last_buy_status,''record_type'',page.record_type,''registered_at'',page.registered_at,''latest_interaction_at'',page.latest_interaction_at)';
 body:=replace(body,'to_jsonb(page)-''effective_stage''',thin_output);
 -- Keep every field of the existing RPC available to older callers, fetched only
 -- after the bounded page is selected. The new UI RPC returns listing fields only.
 body:=replace(body,'LANGUAGE sql','LANGUAGE plpgsql');
 body:=replace(body,'AS $function$', 'AS $function$ declare result jsonb;begin execute $read$');
 body:=replace(body,chr(10)||'$function$', '$read$ into result using p_filters,p_offset,p_limit;return result;end $function$');
 body:=replace(body,'p_filters->','$1->');
 body:=replace(body,'p_offset,','$2,');
 body:=replace(body,'p_limit,','$3,');
 execute replace(body,thin_output,'(select to_jsonb(c) from public.clients c where c.client_id=page.client_id)||jsonb_build_object(''registered_at'',page.registered_at,''latest_interaction_at'',page.latest_interaction_at,''record_type'',page.record_type,''lead_source'',page.lead_source)');
 -- Count/filter only narrow identifiers and sort fields; hydrate 200 clients after
 -- paging. Wide profile fields never enter the materialized filtered relation.
 body:=replace(body,'select r.* from records r where','select r.client_id,r.primary_name,r.registered_at,r.latest_interaction_at,r.last_visit_date,r.effective_stage,r.record_type from records r where');
 body:=replace(body,' from page)',' from page join public.clients c using(client_id))');
 body:=replace(body,'page.client_code','c.client_code');
 body:=replace(body,'page.primary_phone','c.primary_phone');
 body:=replace(body,'page.city','c.city');
 body:=replace(body,'page.state','c.state');
 body:=replace(body,'page.total_visits','c.total_visits');
 body:=replace(body,'page.last_buy_status','c.last_buy_status');
 body:=replace(body,'FUNCTION public.browse_crm_records(','FUNCTION public.browse_crm_records_page(');
 execute body;
end $$;
revoke all on function public.browse_crm_records_page(jsonb,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.browse_crm_records_page(jsonb,integer,integer) to authenticated;

-- Preserve the old snapshot RPC for compatibility; the UI uses a bounded page now.
do $$ declare body text;begin
 body:=replace(pg_get_functiondef('public.get_walkin_queue_snapshot(uuid,text,uuid)'::regprocedure),chr(13),'');
 body:='create function public.get_walkin_queue_page(p_branch_id uuid default null,p_crm_name text default null,p_completed_client_id uuid default null,p_tab text default ''active'',p_offset integer default 0,p_limit integer default 50) returns jsonb language plpgsql stable security invoker set search_path='''' '||substr(body,strpos(body,'AS $function$'));
 body:=regexp_replace(body,'''items'',coalesce\(.*?''completed_client_code'',',
 $replacement$'items',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc) from (
 select id,token,client_name,mobile,assigned_crm_name,status,created_at,client_id,branch_id,client_is_new from public.entry_queue
 where branch_id=selected_branch and status=case when p_tab='recent' then 'complete' else 'pending' end and (selected_crm is null or assigned_crm_name=selected_crm)
 order by created_at desc,id desc offset greatest(p_offset,0) limit least(greatest(p_limit,1),50)) q),'[]'::jsonb),
 'total_count',(select count(*) from public.entry_queue where branch_id=selected_branch and status=case when p_tab='recent' then 'complete' else 'pending' end and (selected_crm is null or assigned_crm_name=selected_crm)),
 'completed_client_code',$replacement$,'s');
 if position('''total_count''' in body)=0 then raise exception 'Unexpected queue snapshot contract';end if;
 execute body;
end $$;
revoke all on function public.get_walkin_queue_page(uuid,text,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_walkin_queue_page(uuid,text,uuid,text,integer,integer) to authenticated;
alter function public.browse_crm_records(jsonb,integer,integer) set jit=off;
alter function public.browse_crm_records_page(jsonb,integer,integer) set jit=off;
alter function public.browse_crm_followups(text,jsonb,integer,integer) set jit=off;
alter function public.browse_crm_followups(text,jsonb,integer,integer) set work_mem='16MB';
alter function public.browse_crm_followups(text,jsonb,integer,integer) set plan_cache_mode=force_custom_plan;
alter function public.crm_dashboard_summary(timestamptz,timestamptz,date) set jit=off;
alter function public.get_walkin_queue_page(uuid,text,uuid,text,integer,integer) set jit=off;
notify pgrst,'reload schema';
