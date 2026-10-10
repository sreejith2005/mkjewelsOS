-- CRM-only analytics. Active CRM read stays company-wide; no write rules change.
create or replace function crm_insights_context_v1(p jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare day date:=(now() at time zone 'Asia/Kolkata')::date;s date;e date;preset text;key text;filter_id uuid;
begin
 if current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501';end if;
 if jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) k where k not in ('version','preset','from','to','tab','groupBy','branch_id','salesperson_id','crm_name','source_channel','event_type','buy_status')) then raise exception 'Invalid CRM filters' using errcode='22023';end if;
 if coalesce(p->>'version','1')<>'1' or coalesce(p->>'tab','visits') not in ('visits','followups','clients','staff') or coalesce(p->>'groupBy','branch') not in ('branch','salesperson','crm','outcome','source') then raise exception 'Invalid CRM view' using errcode='22023';end if;
 preset:=coalesce(p->>'preset','this_month');
 if preset='today' then s:=day;elsif preset='this_week' then s:=date_trunc('week',day::timestamp)::date;elsif preset='this_month' then s:=date_trunc('month',day::timestamp)::date;
 elsif preset='last_7_days' then s:=day-6;elsif preset='last_30_days' then s:=day-29;elsif preset='this_quarter' then s:=date_trunc('quarter',day::timestamp)::date;elsif preset='this_year' then s:=date_trunc('year',day::timestamp)::date;
 elsif preset='custom' then begin s:=(p->>'from')::date;e:=(p->>'to')::date;exception when others then raise exception 'Invalid dates' using errcode='22023';end;else raise exception 'Invalid period' using errcode='22023';end if;
 if preset='custom' and (s is null or e is null) then raise exception 'Choose both dates' using errcode='22023';end if;
 e:=coalesce(e,day);if s is null or e<s or e-s>365 then raise exception 'Choose 1 to 366 dates' using errcode='22023';end if;
 foreach key in array array['branch_id','salesperson_id'] loop
 begin filter_id:=nullif(p->>key,'')::uuid;exception when others then raise exception 'Invalid scope' using errcode='22023';end;
 if filter_id is not null and (case key when 'branch_id' then not exists(select 1 from branches b where b.id=filter_id) else not exists(select 1 from users u where u.id=filter_id) end) then raise exception 'Invalid scope' using errcode='22023';end if;
 end loop;
 if length(coalesce(p->>'crm_name',''))>150 or length(coalesce(p->>'source_channel',''))>100 then raise exception 'Invalid text filter' using errcode='22023';end if;
 if p ? 'event_type' and not exists(select 1 from pg_enum where enumtypid='event_type'::regtype and enumlabel=p->>'event_type') then raise exception 'Invalid visit type' using errcode='22023';end if;
 if p ? 'buy_status' and not exists(select 1 from pg_enum where enumtypid='buy_status'::regtype and enumlabel=p->>'buy_status') then raise exception 'Invalid outcome' using errcode='22023';end if;
 return p||jsonb_build_object('from',s,'to',e,'start_at',s::timestamp at time zone 'Asia/Kolkata','end_at',(e+1)::timestamp at time zone 'Asia/Kolkata','tab',coalesce(p->>'tab','visits'),'groupBy',coalesce(p->>'groupBy','branch'));
end $$;

create or replace function crm_insights_rows_v1(c jsonb)
returns table(record jsonb,kind text,occurred timestamptz,due date,done boolean,purchase boolean,known boolean,branch_id uuid,salesperson_id uuid,crm_name text,outcome text,source text)
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',t.id,'title',concat(cl.client_code,'  |  ',cl.primary_name),'status',coalesce(t.buy_status::text,'Unknown'),'due',t.event_date,'completed',null,'module','crm','client_id',t.client_id,'order_placed',t.buy_status::text in ('YES_AND_ORDER_PLACED','ORDER_PLACED','ORDER_PLACED_AND_BUYING_NEW_PRODUCT','ORDER_PLACED_AND_MAKING_NEW_ORDER','ORDER_PICKUP_AND_MAKING_NEW_ORDER','REPAIR_PLACED_AND_MAKING_NEW_ORDER','REPAIR_PICKUP_AND_MAKING_NEW_ORDER'),'repair_related',t.buy_status::text like 'REPAIR_%'),
 'visit',t.event_date,null::date,true,
 t.buy_status::text in ('YES','YES_AND_ORDER_PLACED','ORDER_PLACED_AND_BUYING_NEW_PRODUCT','ORDER_PICKUP_AND_BUYING_NEW_PRODUCT','REPAIR_PLACED_AND_BUYING_NEW_PRODUCT','REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT'),t.buy_status is not null,
 t.branch_id,t.salesperson_id,t.crm_name,coalesce(t.buy_status::text,'Unknown'),null::text
 from client_timeline t join clients cl on cl.client_id=t.client_id
 where current_user_role() is not null
 and t.event_type::text in ('UPSALE_VISIT','READY_PRODUCT_PURCHASE','ORDER_PLACED_VISIT','ORDER_PICKUP_VISIT','REPAIR_PLACED_VISIT','REPAIR_PICKUP_VISIT','PRODUCT_RETURN_VISIT','PRODUCT_EXCHANGE_VISIT','NON_PURCHASE_VISIT','STORE_VISIT','PRICE_CALCULATION_VISIT','VISIT')
 and (c->>'branch_id' is null or t.branch_id=(c->>'branch_id')::uuid) and (c->>'salesperson_id' is null or t.salesperson_id=(c->>'salesperson_id')::uuid)
 and (c->>'crm_name' is null or t.crm_name=c->>'crm_name') and (c->>'event_type' is null or t.event_type::text=c->>'event_type') and (c->>'buy_status' is null or t.buy_status::text=c->>'buy_status')
 and (c->>'source_channel' is null or exists(select 1 from leads l where (l.client_id=t.client_id or l.converted_to_client_id=t.client_id) and l.source_channel::text=c->>'source_channel'))
 union all
 select jsonb_build_object('id',f.id,'title',concat(cl.client_code,'  |  ',cl.primary_name),'status',f.status,'due',f.next_followup_date::timestamp at time zone 'Asia/Kolkata','completed',null,'module','crm','client_id',f.client_id),
 'followup',f.created_at,f.next_followup_date,not_bought_followup_status_is_done(f.status),false,true,f.branch_id,f.entered_by,null::text,f.status,null::text
 from not_bought_followups f join clients cl on cl.client_id=f.client_id where current_user_role() is not null
 and (c->>'branch_id' is null or f.branch_id=(c->>'branch_id')::uuid) and (c->>'salesperson_id' is null or f.entered_by=(c->>'salesperson_id')::uuid)
 -- Visit-only attribution/outcome filters do not silently narrow follow-up data.
 union all
 select jsonb_build_object('id',l.id,'title',coalesce(l.name,'Unnamed lead'),'status',case when l.converted_to_client_id is null then 'Unconverted' else 'Linked conversion' end,'due',l.created_at,'completed',null,'module','crm','client_id',coalesce(l.converted_to_client_id,l.client_id)),
 'lead',l.created_at,null::date,l.converted_to_client_id is not null,false,true,l.branch_id,l.created_by,null::text,null::text,l.source_channel::text
 from leads l where current_user_role() is not null and (c->>'branch_id' is null or l.branch_id=(c->>'branch_id')::uuid) and (c->>'salesperson_id' is null or l.created_by=(c->>'salesperson_id')::uuid)
 and (c->>'source_channel' is null or l.source_channel::text=c->>'source_channel')
 union all
 select jsonb_build_object('id',h.id,'title',concat(cl.client_code,' | ',cl.primary_name),'status',h.status,'due',h.created_at,'completed',h.created_at,'module','crm','client_id',f.client_id,'contact_recorded',nullif(btrim(h.call_response),'') is not null),
 'followup_activity',h.created_at,null::date,not_bought_followup_status_is_done(h.status) and not not_bought_followup_status_is_done(coalesce(h.previous_status,'')),false,true,f.branch_id,f.entered_by,null::text,h.status,null::text
 from not_bought_history h join not_bought_followups f on f.id=h.followup_id join clients cl on cl.client_id=f.client_id where current_user_role() is not null
 and (c->>'branch_id' is null or f.branch_id=(c->>'branch_id')::uuid) and (c->>'salesperson_id' is null or f.entered_by=(c->>'salesperson_id')::uuid);
$$;

create or replace function crm_insights_metric_matches_v1(m text,kind text,occurred timestamptz,due date,done boolean,purchase boolean,known boolean,s timestamptz,e timestamptz,r_record jsonb default '{}')
returns boolean language sql stable set search_path=public as $$
 select case m when 'visits' then kind='visit' and occurred>=s and occurred<e
 when 'purchases' then kind='visit' and purchase and occurred>=s and occurred<e
 when 'purchase_rate' then kind='visit' and known and occurred>=s and occurred<e
 when 'unknown_outcomes' then kind='visit' and not known and occurred>=s and occurred<e
 when 'order_visits' then kind='visit' and coalesce((r_record->>'order_placed')::boolean,false) and occurred>=s and occurred<e
 when 'repair_visits' then kind='visit' and coalesce((r_record->>'repair_related')::boolean,false) and occurred>=s and occurred<e
 when 'due_soon_followups' then kind='followup' and not done and due>(now() at time zone 'Asia/Kolkata')::date and due<=(now() at time zone 'Asia/Kolkata')::date+7
 when 'aged_followups' then kind='followup' and not done and due<(now() at time zone 'Asia/Kolkata')::date-7
 when 'followup_updates' then kind='followup_activity' and occurred>=s and occurred<e
 when 'completed_followup_updates' then kind='followup_activity' and done and occurred>=s and occurred<e
 when 'contact_response_updates' then kind='followup_activity' and coalesce((r_record->>'contact_recorded')::boolean,false) and occurred>=s and occurred<e
 when 'open_followups' then kind='followup' and not done
 when 'overdue_followups' then kind='followup' and not done and due<(now() at time zone 'Asia/Kolkata')::date
 when 'due_today_followups' then kind='followup' and not done and due=(now() at time zone 'Asia/Kolkata')::date
 when 'undated_followups' then kind='followup' and not done and due is null
 when 'leads' then kind='lead' and occurred>=s and occurred<e
 when 'converted_leads' then kind='lead' and done and occurred>=s and occurred<e
 when 'lead_conversion_rate' then kind='lead' and occurred>=s and occurred<e
 else false end;
$$;

create or replace function crm_insights_group_rows_v1(c jsonb)
returns table(group_id text,group_name text,record_id text,kind text,occurred timestamptz,due date,done boolean,purchase boolean,known boolean)
language sql stable security definer set search_path=public as $$
 select coalesce(case c->>'groupBy' when 'salesperson' then r.salesperson_id::text when 'crm' then r.crm_name when 'outcome' then r.outcome when 'source' then r.source else r.branch_id::text end,'unknown'),
 coalesce(case c->>'groupBy' when 'salesperson' then u.name when 'crm' then r.crm_name when 'outcome' then initcap(replace(r.outcome,'_',' ')) when 'source' then r.source else b.name end,'Unassigned / unknown'),
 r.record->>'id',r.kind,r.occurred,r.due,r.done,r.purchase,r.known from crm_insights_rows_v1(c) r left join branches b on b.id=r.branch_id left join users u on u.id=r.salesperson_id
 where case c->>'tab' when 'followups' then r.kind='followup' and not r.done when 'clients' then r.kind='lead' and r.occurred>=(c->>'start_at')::timestamptz and r.occurred<(c->>'end_at')::timestamptz else r.kind='visit' and r.occurred>=(c->>'start_at')::timestamptz and r.occurred<(c->>'end_at')::timestamptz end;
$$;


-- Distinct selected-period clients; prior visits are recorded history, not inferred first visits.
create or replace function crm_insights_clients_v1(c jsonb,metric text)
returns table(record jsonb,has_prior_visit boolean) language sql stable security definer set search_path=public as $$
 with selected as(select distinct (r.record->>'client_id')::uuid client_id from crm_insights_rows_v1(c)r where r.kind='visit' and r.occurred>=(c->>'start_at')::timestamptz and r.occurred<(c->>'end_at')::timestamptz),
 clients_with_history as(select cl.client_id,cl.client_code,cl.primary_name,exists(select 1 from client_timeline t where t.client_id=cl.client_id and t.event_date<(c->>'start_at')::timestamptz and t.event_type::text in ('UPSALE_VISIT','READY_PRODUCT_PURCHASE','ORDER_PLACED_VISIT','ORDER_PICKUP_VISIT','REPAIR_PLACED_VISIT','REPAIR_PICKUP_VISIT','PRODUCT_RETURN_VISIT','PRODUCT_EXCHANGE_VISIT','NON_PURCHASE_VISIT','STORE_VISIT','PRICE_CALCULATION_VISIT','VISIT')) has_prior_visit from selected x join clients cl on cl.client_id=x.client_id)
 select jsonb_build_object('id',client_id,'client_id',client_id,'title',concat(client_code,' | ',primary_name),'status',case when has_prior_visit then 'Prior recorded visit' else 'No earlier recorded visit' end,'due',null,'completed',null,'module','crm'),has_prior_visit from clients_with_history where metric='unique_clients' or metric='returning_clients' and has_prior_visit;
$$;

create or replace function get_crm_insights_v1(p_context jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c jsonb;s timestamptz;e timestamptz;metrics jsonb;groups jsonb;trend jsonb;outcomes jsonb;reasons jsonb;
begin
 c:=crm_insights_context_v1(coalesce(p_context,'{}'));s:=(c->>'start_at')::timestamptz;e:=(c->>'end_at')::timestamptz;
 with rows as materialized(select * from crm_insights_rows_v1(c)),defs(key,label,basis) as(values ('visits','Recorded visits','period'),('purchases','Purchase-positive visits','period'),('unknown_outcomes','Visits missing outcome','period'),('open_followups','Open follow-ups','current'),('overdue_followups','Overdue follow-ups','current'),('due_today_followups','Follow-ups due today','current'),('undated_followups','Open follow-ups without dates','current'),('due_soon_followups','Due in the next 7 days','current'),('aged_followups','Follow-ups more than 7 days overdue','current'),('followup_updates','Recorded follow-up updates','period'),('completed_followup_updates','Recorded completion transitions','period'),('contact_response_updates','Updates with recorded call response','period'),('order_visits','Visits with an order placed','period'),('repair_visits','Repair-related visits','period'),('leads','New leads','cohort'),('converted_leads','Leads with recorded conversion','cohort')),
 counts as(select d.*,count(*) filter(where crm_insights_metric_matches_v1(key,r.kind,occurred,due,done,purchase,known,s,e,r.record))::numeric value,
 count(*) filter(where crm_insights_metric_matches_v1(key,r.kind,occurred,due,done,purchase,known,s-(e-s),s,r.record))::numeric previous from defs d left join rows r on true group by 1,2,3),
 rates as(select *,null::numeric numerator,null::numeric denominator,null::text unit from counts
 union all select 'purchase_rate','Recorded purchase rate','period',case when count(*)=0 then null else round(100.0*count(*) filter(where purchase)/count(*),1) end,null,count(*) filter(where purchase),count(*),'percent' from rows where kind='visit' and known and occurred>=s and occurred<e
 union all select 'lead_conversion_rate','Recorded lead conversion','cohort',case when count(*)=0 then null else round(100.0*count(*) filter(where done)/count(*),1) end,null,count(*) filter(where done),count(*),'percent' from rows where kind='lead' and occurred>=s and occurred<e
 union all select 'unique_clients','Clients with recorded visits','period',count(*),null,null,null,null from crm_insights_clients_v1(c,'unique_clients')
 union all select 'returning_clients','Clients with prior recorded visits','period',count(*),null,null,null,null from crm_insights_clients_v1(c,'returning_clients'))
 select jsonb_agg(jsonb_build_object('key',key,'label',label,'value',value,'previous',case when basis='current' then null else previous end,'numerator',numerator,'denominator',denominator,'basis',basis,'unit',unit,'module','crm')) into metrics from rates;
 select coalesce(jsonb_agg(to_jsonb(g) order by g.overdue desc,g.total desc,g.name),'[]') into groups from(select group_id id,group_name name,count(*)::int total,count(*) filter(where done and kind<>'visit' or kind='visit' and purchase)::int completed,count(*) filter(where not done)::int open,count(*) filter(where not done and due<(now() at time zone 'Asia/Kolkata')::date)::int overdue,0::int on_time from crm_insights_group_rows_v1(c) group by 1,2)g;
 with r as materialized(select * from crm_insights_rows_v1(c)),buckets as(select generate_series((c->>'from')::date,(c->>'to')::date,case when e-s>interval '60 days' then interval '7 days' else interval '1 day' end) bucket)
 select jsonb_agg(jsonb_build_object('date',bucket::date,'due',(select count(*) from r where kind='visit' and occurred>=bucket::timestamp at time zone 'Asia/Kolkata' and occurred<(bucket+case when e-s>interval '60 days' then interval '7 days' else interval '1 day' end)::timestamp at time zone 'Asia/Kolkata' and occurred<e),'completed',(select count(*) from r where kind='visit' and purchase and occurred>=bucket::timestamp at time zone 'Asia/Kolkata' and occurred<(bucket+case when e-s>interval '60 days' then interval '7 days' else interval '1 day' end)::timestamp at time zone 'Asia/Kolkata' and occurred<e)) order by bucket) into trend from buckets;
 select coalesce(jsonb_agg(jsonb_build_object('name',initcap(replace(outcome,'_',' ')),'id',outcome,'count',n) order by n desc),'[]') into outcomes from(select outcome,count(*) n from crm_insights_rows_v1(c) where kind='visit' and occurred>=s and occurred<e group by outcome)q;
 select coalesce(jsonb_agg(jsonb_build_object('id',reason,'name',reason,'count',n) order by n desc,reason),'[]') into reasons from(
 select reason,count(distinct r.record->>'id') n from crm_insights_rows_v1(c) r join visit_forms vf on vf.client_timeline_id=(r.record->>'id')::uuid cross join lateral unnest(vf.not_bought_reasons) reason where r.kind='visit' and r.occurred>=s and r.occurred<e group by reason)q;
 return jsonb_build_object('version',1,'generatedAt',now(),'timezone','Asia/Kolkata','from',c->>'from','to',c->>'to','scopeLabel','CRM  |  Company-wide read within selected filters','moduleStates',jsonb_build_object('tasks',false,'workflows',false,'forms',false,'people',false,'crm',true),'metrics',metrics,'groups',groups,'trend',trend,'groupBasis',case c->>'tab' when 'followups' then 'Current open follow-ups; includes older and undated work' when 'clients' then 'Leads created in period; only explicit recorded conversion links count' else 'Recorded visits; purchase-positive counts are outcomes, not revenue' end,'missingDeadline',0,'outcomes',outcomes,'reasons',reasons);
end $$;

create or replace function get_crm_insight_records_v1(p_context jsonb,p_metric text,p_group_id text default null,p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c jsonb;result jsonb;
begin
 c:=crm_insights_context_v1(coalesce(p_context,'{}'));
 if p_offset is null or p_limit is null or p_metric is null or p_offset<0 or p_limit not between 1 and 100 or p_metric not in ('visits','purchases','purchase_rate','unknown_outcomes','open_followups','overdue_followups','due_today_followups','undated_followups','leads','converted_leads','lead_conversion_rate','unique_clients','returning_clients','order_visits','repair_visits','due_soon_followups','aged_followups','followup_updates','completed_followup_updates','contact_response_updates','non_buying_reason','group_work') then raise exception 'Invalid CRM detail selector' using errcode='22023';end if;
 if p_metric='non_buying_reason' then
  if p_group_id is null then raise exception 'Select a recorded reason' using errcode='22023';end if;
  with rows as materialized(select r.record from crm_insights_rows_v1(c)r where r.kind='visit' and r.occurred>=(c->>'start_at')::timestamptz and r.occurred<(c->>'end_at')::timestamptz and exists(select 1 from visit_forms vf where vf.client_timeline_id=(r.record->>'id')::uuid and p_group_id=any(vf.not_bought_reasons))),page as(select record from rows order by record->>'id' offset p_offset limit p_limit)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(record) from page),'[]'),'total',(select count(*) from rows),'offset',p_offset,'limit',p_limit) into result;return result;
 end if;
 if p_metric in ('unique_clients','returning_clients') then
  if p_group_id is not null then raise exception 'Client grouping selector unsupported' using errcode='22023';end if;
  with records as materialized(select * from crm_insights_clients_v1(c,p_metric)),page as(select record from records order by record->>'title',record->>'id' offset p_offset limit p_limit)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(record) from page),'[]'),'total',(select count(*) from records),'offset',p_offset,'limit',p_limit) into result;
  return result;
 end if;
 with rows as materialized(select r.* from crm_insights_rows_v1(c) r where
 (p_metric='group_work' and exists(select 1 from crm_insights_group_rows_v1(c) g where g.record_id=r.record->>'id') or crm_insights_metric_matches_v1(p_metric,r.kind,r.occurred,r.due,r.done,r.purchase,r.known,(c->>'start_at')::timestamptz,(c->>'end_at')::timestamptz,r.record))
 and (p_group_id is null or exists(select 1 from crm_insights_group_rows_v1(c) g where g.record_id=r.record->>'id' and g.group_id=p_group_id))), page as(select record from rows order by due nulls last,occurred desc,record->>'id' offset p_offset limit p_limit)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(record) from page),'[]'),'total',(select count(*) from rows),'offset',p_offset,'limit',p_limit) into result;
 return result;
end $$;

create or replace function get_crm_insights_options_v1(p_context jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform crm_insights_context_v1(coalesce(p_context,'{}'));
 return jsonb_build_object('branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'jewelos_branch_id',jewelos_branch_id) order by name) from branches),'[]'),
 'salespeople',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from users),'[]'),
 'crm',coalesce((select jsonb_agg(jsonb_build_object('id',crm_name,'name',crm_name)) from (select distinct crm_name from client_timeline where crm_name is not null)q),'[]'),
 'sources',coalesce((select jsonb_agg(jsonb_build_object('id',source_channel,'name',source_channel)) from (select distinct source_channel from leads where source_channel is not null)q),'[]'),
 'outcomes',(select jsonb_agg(jsonb_build_object('id',enumlabel,'name',initcap(replace(enumlabel,'_',' ')))) from pg_enum where enumtypid='buy_status'::regtype),
 'visitTypes',(select jsonb_agg(jsonb_build_object('id',enumlabel,'name',initcap(replace(enumlabel,'_',' ')))) from pg_enum where enumtypid='event_type'::regtype));
end $$;
create index if not exists crm_timeline_insights_period on client_timeline(event_date,id);
create index if not exists crm_followups_insights_due on not_bought_followups(next_followup_date,id);
revoke all on function crm_insights_clients_v1(jsonb,text) from public,anon,authenticated;
revoke all on function crm_insights_context_v1(jsonb),crm_insights_rows_v1(jsonb),crm_insights_group_rows_v1(jsonb),crm_insights_metric_matches_v1(text,text,timestamptz,date,boolean,boolean,boolean,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function get_crm_insights_v1(jsonb),get_crm_insight_records_v1(jsonb,text,text,integer,integer),get_crm_insights_options_v1(jsonb) from public,anon;
grant execute on function get_crm_insights_v1(jsonb),get_crm_insight_records_v1(jsonb,text,text,integer,integer),get_crm_insights_options_v1(jsonb) to authenticated;
