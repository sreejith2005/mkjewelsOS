-- Store Intelligence analytics (owner request 2026-11-06): one light, filterable dashboard over
-- recorded conversations, built on bounded server-side roll-ups instead of per-read recomputation.
--
-- What this adds
-- * recording_session_facts: one row per conversation with the numbers analytics needs (India
--   day/hour, captured duration, stage, reviewer-visible score and review state, AI outcome,
--   evidence-based engagement stages, product categories, CRM outcome class inputs). It is a
--   derived cache: the source tables stay the truth. Triggers put changed conversations on
--   recording_fact_queue; every analytics read first drains a bounded part of the queue for the
--   caller's tenant, and reports what is still waiting (data freshness).
-- * recorder_device_days: per phone and India day, connected time = the sum of gaps between
--   consecutive recorder contacts that are at most 2 minutes apart (the same threshold that makes
--   a phone "Recording now"). Counting starts when this migration is applied; no history exists.
-- * Browser reads: recording_analytics (summary, once per filter revision),
--   recording_analytics_sessions (keyset-paged drill-down, metadata only),
--   recording_device_days_page (paged daily device time) and recording_analytics_options.
--
-- Boundaries kept
-- * Manager-level reviewers only (recording_is_branch_reviewer, as for 0383 Insights). Their own
--   branch by default; the new action permission recording.analytics_all_branches (default Super
--   Admin and Admin, like company-wide Reports) widens aggregates and drill-down metadata to the
--   tenant's other branches. Opening a conversation still goes through recorder_can_read (own
--   branch only); drill-down rows say whether they can be opened. No summary, transcript, audio or
--   customer identity is returned by any of these reads.
-- * Retention is unchanged. When a recording expires, 0379 deletes its analysis; the fact row
--   then loses every analysis-derived value and the conversation is counted as "removed after
--   retention", never as unscored or zero. Duration and CRM outcomes are not content and stay.
-- * Purchases are CRM-verified only (0384 recording_purchase_credited: one purchase visit is
--   credited to one conversation). The AI outcome is always labelled as what was said.
-- * Nothing here writes business data, changes recording, review, CRM or task behaviour.
-- Docs: docs/REPORTS.md "Store Intelligence analytics".
set search_path=public,extensions;

-- permission-catalog:begin
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values
('recording.analytics_all_branches', 'action', null, '{super_admin,admin}', 1205);
-- permission-catalog:end

-- ---------------------------------------------------------------------------------------------
-- 1. Pure helpers for the roll-up (internal).
-- ---------------------------------------------------------------------------------------------
-- A claim or signal counts as evidence only when it cites at least one transcript segment.
create function recording_evidenced(p jsonb) returns boolean language sql immutable parallel safe set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(p)='object' and jsonb_typeof(p->'evidence')='array' and jsonb_array_length(p->'evidence')>0,false)
$$;

-- Normalised claim texts (lower case, single spaces, at most 80 characters), distinct, at most p_max.
create function recording_claim_texts(p jsonb,p_max integer) returns text[] language sql immutable parallel safe set search_path=pg_catalog as $$
 select coalesce(array_agg(t order by first_at),'{}') from (
  select t,min(o) first_at from (
   select left(lower(btrim(regexp_replace(e.value->>'text','\s+',' ','g'))),80) t,e.o
   from jsonb_array_elements(case when jsonb_typeof(p)='array' then p else '[]'::jsonb end) with ordinality e(value,o)
   where jsonb_typeof(e.value)='object' and nullif(btrim(e.value->>'text'),'') is not null) x
  group by t order by min(o) limit greatest(p_max,0)) y
$$;

-- Product type from the words used (English and common Indian jewellery words). Deterministic,
-- so a category is never guessed by a model; unmatched products stay uncategorised.
create function recording_product_categories(p text[]) returns text[] language sql immutable parallel safe set search_path=pg_catalog as $$
 with t as (select ' '||lower(coalesce(array_to_string(p,' | '),''))||' ' s)
 select coalesce(array_agg(c order by c),'{}') from t,(values
  ('ring','(?<!ear |nose )\mrings?\M'),('necklace','necklace|\mhaar\M|choker'),('chain','\mchains?\M'),('earrings','ear ?rings?|jhumk|\mstuds?\M|\mtops\M'),
  ('bangle','bangle|\mkada|kangan'),('bracelet','bracelet'),('pendant','pendant|locket'),('mangalsutra','mangal ?sutra'),
  ('nose_pin','nose ?(pin|ring)|\mnath\M'),('anklet','anklet|payal'),('coin_bar','\mcoins?\M|\mbars?\M|biscuit')) v(c,re)
 where t.s ~ v.re
$$;

-- Metal and design words, same rules.
create function recording_product_elements(p text[]) returns text[] language sql immutable parallel safe set search_path=pg_catalog as $$
 with t as (select ' '||lower(coalesce(array_to_string(p,' | '),''))||' ' s)
 select coalesce(array_agg(c order by c),'{}') from t,(values
  ('gold','\mgold'),('diamond','diamond'),('silver','silver'),('platinum','platinum'),('polki_kundan','polki|kundan'),
  ('gemstone','gem ?stone|ruby|emerald|sapphire|\mpearls?\M'),('temple_antique','temple|antique'),('bridal','bridal|wedding'),
  ('lightweight_daily','light ?weight|daily ?wear|office ?wear')) v(c,re)
 where t.s ~ v.re
$$;

-- Budget band from the evidenced budget statement ("around 50k", "1.5 lakh", "Rs 40,000").
-- A bare number below 1,000 without a unit is ambiguous and gives no band.
create function recording_price_band(p text) returns text language plpgsql immutable parallel safe set search_path=pg_catalog as $$
declare m text[]; v numeric; begin
 if p is null then return null; end if;
 m:=regexp_match(replace(lower(p),',',''),'(\d+(?:\.\d+)?)\s*(crores?|cr\M|lakhs?|lacs?|l\M|k\M|thousand)?');
 if m is null then return null; end if;
 v:=m[1]::numeric;
 v:=v*case when m[2] ~ '^(crore|cr)' then 10000000 when m[2] ~ '^(lakh|lac|l$)' then 100000 when m[2] ~ '^(k|thousand)' then 1000 else 1 end;
 if m[2] is null and v<1000 then return null; end if;
 return case when v<25000 then 'under_25k' when v<50000 then '25k_50k' when v<100000 then '50k_1l' when v<200000 then '1l_2l' when v<500000 then '2l_5l' else '5l_plus' end;
exception when others then return null;
end $$;

-- The CRM outcome class shown everywhere (0384 rules), decided at read time because an
-- attribution window closes with the clock, not with a write.
create function recording_crm_class(p_link_state text,p_crm_state text,p_window_until timestamptz) returns text language sql stable set search_path=pg_catalog as $$
 select case when p_link_state is null then 'not_linked'
  when p_link_state<>'verified' or p_crm_state is null or p_crm_state='not_checked' then 'pending'
  when p_crm_state='purchase_credited' then 'confirmed'
  when p_crm_state='purchase_elsewhere' then 'credited_elsewhere'
  when p_window_until is not null and p_window_until<=now() then 'lost' else 'open' end
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. The roll-up and its queue.
-- ---------------------------------------------------------------------------------------------
create table recording_session_facts (
 session_id uuid primary key references recorder_sessions(id),tenant_id uuid not null references tenants(id),
 branch_id uuid not null references branches(id),employee_id uuid not null references user_profiles(id),device_id uuid not null references recorder_devices(id),
 created_at timestamptz not null,local_date date not null,local_hour smallint not null check(local_hour between 0 and 23),
 local_dow smallint not null check(local_dow between 1 and 7),expires_at timestamptz not null,
 duration_ms bigint not null default 0 check(duration_ms>=0),stage text not null,error_reason text,
 analysis_id uuid,analysis_status text,review_state text,score numeric(5,2),manager_scored boolean not null default false,ai_outcome text,
 engaged boolean not null default false,interest boolean not null default false,price_discussed boolean not null default false,
 signals text[] not null default '{}',products text[] not null default '{}',categories text[] not null default '{}',elements text[] not null default '{}',
 concerns text[] not null default '{}',competitors text[] not null default '{}',strengths text[] not null default '{}',price_band text,
 quality_reasons text[] not null default '{}',fallback_used boolean not null default false,
 dimensions jsonb not null default '[]' check(jsonb_typeof(dimensions)='array'),
 link_state text,crm_state text,crm_window_until timestamptz,crm_purchase_visit_id uuid,
 refreshed_at timestamptz not null default now()
);
create index recording_session_facts_period on recording_session_facts(tenant_id,local_date,branch_id);
create index recording_session_facts_page on recording_session_facts(tenant_id,branch_id,created_at desc,session_id desc);
create index recording_session_facts_employee on recording_session_facts(tenant_id,employee_id,local_date);
create index recording_session_facts_device on recording_session_facts(device_id,local_date);

create table recording_fact_queue (
 session_id uuid primary key references recorder_sessions(id),tenant_id uuid not null references tenants(id),queued_at timestamptz not null default now()
);
create index recording_fact_queue_tenant on recording_fact_queue(tenant_id,queued_at);

create table recorder_device_days (
 device_id uuid not null references recorder_devices(id),local_date date not null,tenant_id uuid not null references tenants(id),
 branch_id uuid not null references branches(id),employee_id uuid not null references user_profiles(id),
 connected_ms bigint not null default 0 check(connected_ms>=0),contacts integer not null default 0 check(contacts>=0),
 first_contact_at timestamptz not null,last_contact_at timestamptz not null,primary key(device_id,local_date)
);
create index recorder_device_days_scope on recorder_device_days(tenant_id,local_date,branch_id);

do $$ declare t text; begin foreach t in array array['recording_session_facts','recording_fact_queue','recorder_device_days'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 execute format('create policy module_accessible on %I as restrictive for select to authenticated using (public.module_accessible(''sales_recording'',false))',t);
 end loop; end $$;

-- Queue a conversation for recount (any change that can move one of its numbers).
create function recording_fact_touch(p_session uuid) returns void language sql security definer set search_path=public as $$
 insert into recording_fact_queue(session_id,tenant_id) select s.id,s.tenant_id from recorder_sessions s where s.id=p_session on conflict(session_id) do nothing
$$;
-- A CRM purchase credit can move between conversations: recount every conversation whose
-- outcome names the same purchase visit.
create function recording_fact_touch_visit(p_visit uuid) returns void language sql security definer set search_path=public as $$
 insert into recording_fact_queue(session_id,tenant_id) select distinct o.session_id,o.tenant_id from recording_crm_outcomes o where p_visit is not null and o.purchase_visit_id=p_visit
 on conflict(session_id) do nothing
$$;

create function recording_fact_trigger() returns trigger language plpgsql security definer set search_path=public as $$
declare r jsonb:=to_jsonb(case when tg_op='DELETE' then old else new end); col text:=tg_argv[0]; begin
 perform recording_fact_touch((r->>col)::uuid);
 if tg_op='UPDATE' and (to_jsonb(old)->>col) is distinct from (r->>col) then perform recording_fact_touch((to_jsonb(old)->>col)::uuid); end if;
 if tg_table_name in ('recording_crm_outcomes','recording_customer_links') then
  perform recording_fact_touch_visit(o.purchase_visit_id) from recording_crm_outcomes o where o.session_id=(r->>col)::uuid and o.purchase_visit_id is not null;
  if tg_table_name='recording_crm_outcomes' and tg_op='UPDATE' then perform recording_fact_touch_visit(old.purchase_visit_id); end if;
 end if;
 return null;
end $$;

create trigger recording_facts_session after insert or update of status,capture_ended_at,error_reason,expires_at,branch_id,employee_id on recorder_sessions
 for each row execute function recording_fact_trigger('id');
create trigger recording_facts_chunk after insert or delete on recorder_chunks for each row execute function recording_fact_trigger('session_id');
create trigger recording_facts_revision after insert or delete on recording_transcript_revisions for each row execute function recording_fact_trigger('session_id');
create trigger recording_facts_job after insert or update of state or delete on recording_analysis_jobs for each row execute function recording_fact_trigger('session_id');
create trigger recording_facts_analysis after insert or update or delete on recording_analyses for each row execute function recording_fact_trigger('session_id');
create trigger recording_facts_review after insert or delete on recording_analysis_reviews for each row execute function recording_fact_trigger('session_id');
create trigger recording_facts_link after insert or update on recording_customer_links for each row execute function recording_fact_trigger('session_id');
create trigger recording_facts_outcome after insert or update on recording_crm_outcomes for each row execute function recording_fact_trigger('session_id');

-- Dimension ratings arrive in the analysis transaction; the queue entry from the analysis row covers them.
-- The attribution window moves with the tenant setting: recount that tenant's conversations.
create function recording_fact_config_trigger() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into recording_fact_queue(session_id,tenant_id) select s.id,s.tenant_id from recorder_sessions s where s.tenant_id=new.tenant_id on conflict(session_id) do nothing;
 return null;
end $$;
create trigger recording_facts_config after update of crm_attribution_days on recorder_config
 for each row when (old.crm_attribution_days is distinct from new.crm_attribution_days) execute function recording_fact_config_trigger();

-- Connected time: a contact within 2 minutes of the previous one adds the gap; a longer silence adds nothing.
create function recorder_device_presence_trigger() returns trigger language plpgsql security definer set search_path=public as $$
declare gap bigint:=0; day date:=(new.last_seen_at at time zone 'Asia/Kolkata')::date; begin
 if tg_op='UPDATE' then
  if new.last_seen_at<=old.last_seen_at then return null; end if;
  if new.last_seen_at-old.last_seen_at<=interval '2 minutes' then gap:=(extract(epoch from new.last_seen_at-old.last_seen_at)*1000)::bigint; end if;
 end if;
 insert into recorder_device_days(device_id,local_date,tenant_id,branch_id,employee_id,connected_ms,contacts,first_contact_at,last_contact_at)
 values(new.id,day,new.tenant_id,new.branch_id,new.employee_id,gap,1,new.last_seen_at,new.last_seen_at)
 on conflict(device_id,local_date) do update set connected_ms=recorder_device_days.connected_ms+excluded.connected_ms,contacts=recorder_device_days.contacts+1,
  last_contact_at=greatest(recorder_device_days.last_contact_at,excluded.last_contact_at),branch_id=excluded.branch_id,employee_id=excluded.employee_id;
 return null;
end $$;
create trigger recorder_device_presence after insert or update of last_seen_at on recorder_devices for each row execute function recorder_device_presence_trigger();

-- Recount up to p_limit queued conversations of one tenant. Queue rows are removed first, so a
-- change made while this runs queues the conversation again instead of being lost.
create function recording_refresh_facts(p_tenant uuid,p_limit integer) returns integer language plpgsql security definer set search_path=public as $$
declare n integer; begin
 with picked as (select q.session_id from recording_fact_queue q where q.tenant_id=p_tenant order by q.queued_at,q.session_id limit greatest(coalesce(p_limit,0),0) for update skip locked),
 gone as (delete from recording_fact_queue q using picked p where q.session_id=p.session_id returning q.session_id),
 src as (
  select s.*,s srow,an.id an_id,an.status an_status,an.status_reasons an_reasons,an.output an_out,an.fallback_used an_fallback,l.id link_id,l.state link_state,o.link_id o_link,o.state o_state,o.window_until o_until,o.purchase_visit_id o_visit
  from gone g join recorder_sessions s on s.id=g.session_id
  left join lateral (select * from recording_visible_analysis(s.id,true)) an on true
  left join lateral (select * from recording_customer_links x where x.session_id=s.id and x.ended_at is null) l on true
  left join recording_crm_outcomes o on o.link_id=l.id),
 calc as (
  select src.*,recording_claim_texts(an_out->'product_interests',8) prods,
   (an_id is not null and not ('too_little_speech'=any(coalesce(an_reasons,'{}')))) eng,
   case when an_id is not null then recording_review_state(an_id) end rstate
  from src)
 insert into recording_session_facts as f(session_id,tenant_id,branch_id,employee_id,device_id,created_at,local_date,local_hour,local_dow,expires_at,duration_ms,stage,error_reason,
  analysis_id,analysis_status,review_state,score,manager_scored,ai_outcome,engaged,interest,price_discussed,signals,products,categories,elements,concerns,competitors,strengths,price_band,
  quality_reasons,fallback_used,dimensions,link_state,crm_state,crm_window_until,crm_purchase_visit_id,refreshed_at)
 select c.id,c.tenant_id,c.branch_id,c.employee_id,c.device_id,c.created_at,(c.created_at at time zone 'Asia/Kolkata')::date,
  extract(hour from c.created_at at time zone 'Asia/Kolkata')::smallint,extract(isodow from c.created_at at time zone 'Asia/Kolkata')::smallint,c.expires_at,
  recording_session_duration_ms(c.id),recording_session_stage(c.srow),c.error_reason,
  c.an_id,c.an_status,c.rstate,case when c.an_id is not null then recording_effective_score(c.an_id) end,
  coalesce(c.an_id is not null and exists(select 1 from recording_analysis_reviews rv where rv.analysis_id=c.an_id and rv.action='edit'),false),
  c.an_out#>>'{signals,sales_outcome,value}',
  c.eng,
  c.eng and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.an_out->'product_interests')='array' then c.an_out->'product_interests' else '[]'::jsonb end) e where recording_evidenced(e.value)),
  c.eng and (recording_evidenced(c.an_out#>'{customer_requirements,budget}') or (coalesce((c.an_out#>>'{signals,price_concern,detected}')='true',false) and recording_evidenced(c.an_out#>'{signals,price_concern}'))),
  coalesce((select array_agg(k order by k) from unnest(array['objection','price_concern','stock_gap','competitor_mention','customer_questions','conversion_signal','next_step','drop_off','upsell_opportunity']) k
   where (c.an_out#>>array['signals',k,'detected'])='true'),'{}'),
  c.prods,recording_product_categories(c.prods),recording_product_elements(c.prods),
  recording_claim_texts(coalesce(c.an_out->'customer_concerns','[]'::jsonb)||case when jsonb_typeof(c.an_out->'purchase_blockers')='array' then c.an_out->'purchase_blockers' else '[]'::jsonb end,8),
  recording_claim_texts(c.an_out->'competitor_mentions',5),recording_claim_texts(c.an_out->'coaching_strengths',5),
  case when recording_evidenced(c.an_out#>'{customer_requirements,budget}') then recording_price_band(c.an_out#>>'{customer_requirements,budget,text}') end,
  coalesce(c.an_reasons,'{}'),coalesce(c.an_fallback,false),
  case when c.an_id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('k',d.dimension_key,'l',d.label,'r',d.rating) order by d.dimension_key)
   from recording_effective_dimensions(c.an_id) d where d.status='assessed' and d.rating is not null),'[]'::jsonb) end,
  c.link_state,
  case when c.link_id is null then null when c.link_state<>'verified' then 'link_pending' when c.o_link is null or c.o_state in ('no_client','not_linked') then 'not_checked'
   when c.o_state='purchase_verified' then case when recording_purchase_credited(c.link_id) then 'purchase_credited' else 'purchase_elsewhere' end else 'no_purchase' end,
  case when c.link_id is null then null else coalesce(c.o_until,upper(recording_outcome_window(c.srow))) end,
  case when c.o_state='purchase_verified' and recording_purchase_credited(c.link_id) then c.o_visit end,
  now()
 from calc c
 on conflict(session_id) do update set tenant_id=excluded.tenant_id,branch_id=excluded.branch_id,employee_id=excluded.employee_id,device_id=excluded.device_id,created_at=excluded.created_at,
  local_date=excluded.local_date,local_hour=excluded.local_hour,local_dow=excluded.local_dow,expires_at=excluded.expires_at,duration_ms=excluded.duration_ms,stage=excluded.stage,
  error_reason=excluded.error_reason,analysis_id=excluded.analysis_id,analysis_status=excluded.analysis_status,review_state=excluded.review_state,score=excluded.score,
  manager_scored=excluded.manager_scored,ai_outcome=excluded.ai_outcome,engaged=excluded.engaged,interest=excluded.interest,price_discussed=excluded.price_discussed,
  signals=excluded.signals,products=excluded.products,categories=excluded.categories,elements=excluded.elements,concerns=excluded.concerns,competitors=excluded.competitors,
  strengths=excluded.strengths,price_band=excluded.price_band,quality_reasons=excluded.quality_reasons,fallback_used=excluded.fallback_used,dimensions=excluded.dimensions,
  link_state=excluded.link_state,crm_state=excluded.crm_state,crm_window_until=excluded.crm_window_until,crm_purchase_visit_id=excluded.crm_purchase_visit_id,refreshed_at=excluded.refreshed_at;
 get diagnostics n=row_count;
 return n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Filters and scope (internal).
-- ---------------------------------------------------------------------------------------------
create type recording_analytics_args as (
 date_from date,date_to date,prior_from date,prior_to date,branch_ids uuid[],employee_ids uuid[],device_id uuid,
 category text,element text,product text,stage text,outcome text,crm text
);

-- p: {from, to, branch_ids?, employee_ids?, device_id?, category?, element?, product?, stage?, outcome?, crm?}.
-- Dates are India business days, inclusive, at most 366 days. The prior period is the same
-- number of days immediately before. Branches are checked against the caller's scope.
create function recording_analytics_parse(a user_profiles,p jsonb) returns recording_analytics_args language plpgsql stable security definer set search_path=public as $$
declare r recording_analytics_args; f jsonb:=coalesce(p,'{}'::jsonb); allowed uuid[]; all_branches boolean; begin
 if not recording_is_branch_reviewer(a) then raise exception 'recording_review_denied' using errcode='42501'; end if;
 if jsonb_typeof(f)<>'object' or exists(select 1 from jsonb_object_keys(f) k where k not in ('from','to','branch_ids','employee_ids','device_id','category','element','product','stage','outcome','crm')) then
  raise exception 'recording_invalid_filter' using errcode='22023'; end if;
 begin
  r.date_from:=(f->>'from')::date; r.date_to:=(f->>'to')::date;
  r.branch_ids:=case when jsonb_typeof(f->'branch_ids')='array' then array(select jsonb_array_elements_text(f->'branch_ids')::uuid) end;
  r.employee_ids:=case when jsonb_typeof(f->'employee_ids')='array' then array(select jsonb_array_elements_text(f->'employee_ids')::uuid) end;
  r.device_id:=(f->>'device_id')::uuid;
  r.category:=nullif(btrim(f->>'category'),''); r.element:=nullif(btrim(f->>'element'),''); r.product:=nullif(lower(btrim(left(f->>'product',100))),'');
  r.stage:=nullif(f->>'stage',''); r.outcome:=nullif(f->>'outcome',''); r.crm:=nullif(f->>'crm','');
 exception when others then raise exception 'recording_invalid_filter' using errcode='22023'; end;
 if r.date_from is null or r.date_to is null or r.date_to<r.date_from or r.date_to-r.date_from>365
  or coalesce(cardinality(r.branch_ids),0)>50 or coalesce(cardinality(r.employee_ids),0)>50
  or (f ? 'branch_ids' and jsonb_typeof(f->'branch_ids')<>'array') or (f ? 'employee_ids' and jsonb_typeof(f->'employee_ids')<>'array')
  or (r.category is not null and r.category not in ('ring','necklace','chain','earrings','bangle','bracelet','pendant','mangalsutra','nose_pin','anklet','coin_bar'))
  or (r.element is not null and r.element not in ('gold','diamond','silver','platinum','polki_kundan','gemstone','temple_antique','bridal','lightweight_daily'))
  or (r.stage is not null and r.stage not in ('recording','saving','processing','ready','needs_attention'))
  or (r.outcome is not null and r.outcome not in ('unknown','enquiry','follow_up','reported_purchase','no_purchase'))
  or (r.crm is not null and r.crm not in ('confirmed','lost','open','pending','not_linked','credited_elsewhere')) then
  raise exception 'recording_invalid_filter' using errcode='22023'; end if;
 r.prior_to:=r.date_from-1; r.prior_from:=r.date_from-(r.date_to-r.date_from)-1;
 all_branches:=has_permission('recording.analytics_all_branches');
 allowed:=case when all_branches then array(select b.id from branches b where b.tenant_id=a.tenant_id and coalesce(b.is_active,true)) else array[a.branch_id] end;
 if coalesce(cardinality(r.branch_ids),0)=0 then r.branch_ids:=allowed;
 elsif exists(select 1 from unnest(r.branch_ids) x where not x=any(allowed)) then raise exception 'recording_branch_denied' using errcode='42501'; end if;
 return r;
end $$;

-- The filtered rows behind every figure, with analysis-derived values hidden once a recording
-- has passed retention (whether or not the queue has caught up yet).
create function recording_fact_rows(p_tenant uuid,r recording_analytics_args,p_from date,p_to date)
returns table(session_id uuid,branch_id uuid,employee_id uuid,device_id uuid,created_at timestamptz,local_date date,local_hour smallint,local_dow smallint,
 duration_ms bigint,stage text,error_reason text,retention_removed boolean,analysis_id uuid,analysis_status text,review_state text,score numeric,manager_scored boolean,
 ai_outcome text,engaged boolean,interest boolean,price_discussed boolean,signals text[],products text[],categories text[],elements text[],concerns text[],competitors text[],
 strengths text[],price_band text,quality_reasons text[],fallback_used boolean,dimensions jsonb,crm_class text,refreshed_at timestamptz)
language sql stable security definer set search_path=public as $$
 select x.session_id,x.branch_id,x.employee_id,x.device_id,x.created_at,x.local_date,x.local_hour,x.local_dow,x.duration_ms,x.stage,x.error_reason,not x.live,
  case when x.live then x.analysis_id end,case when x.live then x.analysis_status end,case when x.live then x.review_state end,case when x.live then x.score end,
  x.live and x.manager_scored,case when x.live then x.ai_outcome end,x.live and x.engaged,x.live and x.interest,x.live and x.price_discussed,
  case when x.live then x.signals else '{}' end,case when x.live then x.products else '{}' end,case when x.live then x.categories else '{}' end,
  case when x.live then x.elements else '{}' end,case when x.live then x.concerns else '{}' end,case when x.live then x.competitors else '{}' end,
  case when x.live then x.strengths else '{}' end,case when x.live then x.price_band end,case when x.live then x.quality_reasons else '{}' end,
  x.live and x.fallback_used,case when x.live then x.dimensions else '[]'::jsonb end,x.crm_class,x.refreshed_at
 from (select f.*,f.expires_at>now() live,recording_crm_class(f.link_state,f.crm_state,f.crm_window_until) crm_class from recording_session_facts f
  where f.tenant_id=p_tenant and f.branch_id=any(r.branch_ids) and f.local_date between p_from and p_to
   and (coalesce(cardinality(r.employee_ids),0)=0 or f.employee_id=any(r.employee_ids)) and (r.device_id is null or f.device_id=r.device_id)) x
 where (r.stage is null or x.stage=r.stage)
  and (r.category is null or (x.live and r.category=any(x.categories))) and (r.element is null or (x.live and r.element=any(x.elements)))
  and (r.product is null or (x.live and exists(select 1 from unnest(x.products) p where strpos(p,r.product)>0)))
  and (r.outcome is null or (x.live and x.ai_outcome=r.outcome)) and (r.crm is null or x.crm_class=r.crm)
$$;

-- Queue state for the caller's tenant and the processing pipeline, for the freshness line.
create function recording_analytics_freshness(p_tenant uuid,p_branches uuid[]) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'queued',(select count(*) from recording_fact_queue q where q.tenant_id=p_tenant),
  'oldest_queued_at',(select min(q.queued_at) from recording_fact_queue q where q.tenant_id=p_tenant),
  'refreshed_at',(select max(f.refreshed_at) from recording_session_facts f where f.tenant_id=p_tenant and f.branch_id=any(p_branches)),
  'transcription_waiting',(select count(*) from recorder_jobs j join recorder_sessions s on s.id=j.session_id where s.tenant_id=p_tenant and s.branch_id=any(p_branches) and j.kind='final' and j.state in ('pending','leased')),
  'analysis_waiting',(select count(*) from recording_analysis_jobs j join recorder_sessions s on s.id=j.session_id where j.tenant_id=p_tenant and s.branch_id=any(p_branches) and j.state in ('pending','leased')),
  'oldest_analysis_waiting_at',(select min(j.created_at) from recording_analysis_jobs j join recorder_sessions s on s.id=j.session_id where j.tenant_id=p_tenant and s.branch_id=any(p_branches) and j.state in ('pending','leased')),
  'analysis_enabled',coalesce((select c.analysis_enabled from recorder_config c where c.tenant_id=p_tenant),false))
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Browser reads.
-- ---------------------------------------------------------------------------------------------
-- Summary for one filter revision: current and prior period, trends, breakdowns and rankings inputs.
-- Every count is of conversations (one fact row each); customers are never counted from text.
create function recording_analytics(p_filters jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); r recording_analytics_args; cfg recorder_config; begin
 r:=recording_analytics_parse(a,p_filters);
 perform recording_refresh_facts(a.tenant_id,2000);
 select * into cfg from recorder_config where tenant_id=a.tenant_id;
 return (with f as (select x.*,x.local_date>=r.date_from cur,x.crm_class in ('confirmed','credited_elsewhere','lost','open') eligible from recording_fact_rows(a.tenant_id,r,r.prior_from,r.date_to) x),
  periods as (select p.cur,
    jsonb_build_object('sessions',count(f.session_id),'recorded_ms',coalesce(sum(f.duration_ms),0),'with_audio',count(*) filter (where f.duration_ms>0),
     'average_duration_ms',round(avg(f.duration_ms) filter (where f.duration_ms>0)),
     'analysed',count(f.analysis_id),'scored',count(f.score),'score_sum',coalesce(sum(f.score),0),'average_score',round(avg(f.score),1),
     'unscored',count(*) filter (where f.analysis_id is not null and f.score is null),
     'not_analysed',count(*) filter (where f.session_id is not null and f.analysis_id is null and not f.retention_removed),
     'retention_removed',count(*) filter (where f.retention_removed),'processing',count(*) filter (where f.stage in ('recording','saving','processing')),
     'needs_attention',count(*) filter (where f.stage='needs_attention'),'interrupted',count(*) filter (where f.error_reason='capture_interrupted'),
     'unreviewed',count(*) filter (where f.analysis_id is not null and f.review_state is null),'flagged',count(*) filter (where f.review_state='flag'),
     'manager_scored',count(*) filter (where f.manager_scored),'employees',count(distinct f.employee_id),'branches',count(distinct f.branch_id),
     'outcomes',jsonb_build_object('reported_purchase',count(*) filter (where f.ai_outcome='reported_purchase'),'follow_up',count(*) filter (where f.ai_outcome='follow_up'),
       'enquiry',count(*) filter (where f.ai_outcome='enquiry'),'no_purchase',count(*) filter (where f.ai_outcome='no_purchase'),
       'unknown',count(*) filter (where f.analysis_id is not null and (f.ai_outcome is null or f.ai_outcome='unknown'))),
     'crm',jsonb_build_object('eligible',count(*) filter (where f.eligible),'confirmed',count(*) filter (where f.crm_class='confirmed'),
       'lost',count(*) filter (where f.crm_class='lost'),'open',count(*) filter (where f.crm_class='open'),'pending',count(*) filter (where f.crm_class='pending'),
       'credited_elsewhere',count(*) filter (where f.crm_class='credited_elsewhere'),'not_linked',count(*) filter (where f.session_id is not null and f.crm_class='not_linked')),
     'funnel',jsonb_build_object('engaged',count(*) filter (where f.engaged),'interest',count(*) filter (where f.engaged and f.interest),
       'price',count(*) filter (where f.engaged and f.interest and f.price_discussed),'confirmed',count(*) filter (where f.engaged and f.crm_class='confirmed'),
       'engaged_eligible',count(*) filter (where f.engaged and f.eligible)),
     'at_risk',count(*) filter (where f.interest and f.crm_class in ('open','lost'))) j
   from (values (true),(false)) p(cur) left join f on f.cur=p.cur group by p.cur),
  emp as (select f.employee_id,max(f.branch_id::text)::uuid branch_id,
    count(*) filter (where f.cur) sessions,count(*) filter (where not f.cur) prior_sessions,coalesce(sum(f.duration_ms) filter (where f.cur),0) recorded_ms,
    count(f.score) filter (where f.cur) scored,round(avg(f.score) filter (where f.cur),1) average_score,
    count(f.score) filter (where not f.cur) prior_scored,round(avg(f.score) filter (where not f.cur),1) prior_average_score,
    count(*) filter (where f.cur and f.eligible) eligible,count(*) filter (where f.cur and f.crm_class='confirmed') confirmed,
    count(*) filter (where not f.cur and f.eligible) prior_eligible,count(*) filter (where not f.cur and f.crm_class='confirmed') prior_confirmed,
    count(*) filter (where f.cur and f.crm_class='lost') lost,count(*) filter (where f.cur and f.ai_outcome='follow_up') follow_up,
    count(*) filter (where f.cur and f.ai_outcome='reported_purchase') reported_purchase,count(*) filter (where f.cur and f.review_state='flag') flagged,
    count(*) filter (where f.cur and f.analysis_id is not null and f.review_state is null) unreviewed
   from f group by f.employee_id),
  br as (select f.branch_id,count(*) filter (where f.cur) sessions,count(*) filter (where not f.cur) prior_sessions,
    count(f.score) filter (where f.cur) scored,round(avg(f.score) filter (where f.cur),1) average_score,
    count(f.score) filter (where not f.cur) prior_scored,round(avg(f.score) filter (where not f.cur),1) prior_average_score,
    count(*) filter (where f.cur and f.eligible) eligible,count(*) filter (where f.cur and f.crm_class='confirmed') confirmed,
    count(*) filter (where not f.cur and f.eligible) prior_eligible,count(*) filter (where not f.cur and f.crm_class='confirmed') prior_confirmed,
    count(*) filter (where f.cur and f.crm_class='not_linked') not_linked,count(*) filter (where f.cur and f.analysis_id is not null and f.review_state is null) unreviewed,
    count(*) filter (where f.cur and f.review_state='flag') flagged,count(*) filter (where f.cur and f.error_reason='capture_interrupted') interrupted,
    count(*) filter (where f.cur and f.interest and f.crm_class in ('open','lost')) at_risk,count(distinct f.employee_id) filter (where f.cur) employees,
    coalesce(sum(f.duration_ms) filter (where f.cur),0) recorded_ms
   from f group by f.branch_id),
  dims as (select d->>'k' k,max(d->>'l') l,f.cur,round(avg((d->>'r')::numeric),1) avg_rating,count(*) n from f cross join lateral jsonb_array_elements(f.dimensions) d group by 1,3),
  emp_points as (select e.*,round(100.0*e.confirmed/nullif(e.eligible,0),1) conversion_rate from emp e where e.scored>=5 and e.eligible>=5)
  select jsonb_build_object(
   'meta',jsonb_build_object('from',r.date_from,'to',r.date_to,'prior_from',r.prior_from,'prior_to',r.prior_to,'timezone','Asia/Kolkata','generated_at',now(),
     'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name) from branches b where b.id=any(r.branch_ids) and b.tenant_id=a.tenant_id),'[]'::jsonb),
     'all_branches',has_permission('recording.analytics_all_branches'),'min_sample',5,
     'ticket_inr',cfg.estimated_ticket_inr,'attribution_days',coalesce(cfg.crm_attribution_days,30),'retention_days',coalesce(cfg.retention_days,7),
     'freshness',recording_analytics_freshness(a.tenant_id,r.branch_ids)),
   'current',(select j from periods where cur),'prior',(select j from periods where not cur),
   'by_day',coalesce((select jsonb_agg(jsonb_build_object('date',d,'sessions',n,'scored',sc,'average_score',av,'recorded_ms',ms,'average_duration_ms',ad,'confirmed',cf,'eligible',el) order by d) from (
     select f.local_date d,count(*) n,count(f.score) sc,round(avg(f.score),1) av,coalesce(sum(f.duration_ms),0) ms,round(avg(f.duration_ms) filter (where f.duration_ms>0)) ad,
      count(*) filter (where f.crm_class='confirmed') cf,count(*) filter (where f.eligible) el from f where f.cur group by 1) z),'[]'::jsonb),
   'by_slot',coalesce((select jsonb_agg(jsonb_build_object('dow',dw,'hour',h,'sessions',n) order by dw,h) from (select f.local_dow dw,f.local_hour h,count(*) n from f where f.cur group by 1,2) z),'[]'::jsonb),
   'by_employee',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('employee_name',u.employee_name,
      'focus',(select d->>'l' from f cross join lateral jsonb_array_elements(f.dimensions) d where f.cur and f.employee_id=e.employee_id group by d->>'k',d->>'l' having count(*)>=2 order by avg((d->>'r')::numeric),d->>'l' limit 1))
     order by u.employee_name,e.employee_id) from emp e join user_profiles u on u.id=e.employee_id where e.sessions>0 or e.prior_sessions>0),'[]'::jsonb),
   'by_branch',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('branch_name',bn.name,
      'weakest_dimension',(select d->>'l' from f cross join lateral jsonb_array_elements(f.dimensions) d where f.cur and f.branch_id=b.branch_id group by d->>'k',d->>'l' having count(*)>=5 order by avg((d->>'r')::numeric),d->>'l' limit 1))
     order by bn.name) from br b join branches bn on bn.id=b.branch_id),'[]'::jsonb),
   'dimensions',coalesce((select jsonb_agg(jsonb_build_object('key',c.k,'label',c.l,'average',c.avg_rating,'assessed',c.n,'prior_average',p.avg_rating,'prior_assessed',coalesce(p.n,0)) order by c.avg_rating,c.l)
     from dims c left join dims p on p.k=c.k and not p.cur where c.cur),'[]'::jsonb),
   'dimension_weeks',coalesce((select jsonb_agg(jsonb_build_object('week',w,'key',k,'average',av,'assessed',n) order by w,k) from (
     select date_trunc('week',f.local_date)::date w,d->>'k' k,round(avg((d->>'r')::numeric),1) av,count(*) n from f cross join lateral jsonb_array_elements(f.dimensions) d where f.cur group by 1,2) z),'[]'::jsonb),
   'categories',coalesce((select jsonb_agg(jsonb_build_object('key',c,'sessions',n,'eligible',el,'confirmed',cf) order by n desc,c) from (
     select c,count(*) n,count(*) filter (where f.eligible) el,count(*) filter (where f.crm_class='confirmed') cf from f cross join unnest(f.categories) c where f.cur group by c) z),'[]'::jsonb),
   'elements',coalesce((select jsonb_agg(jsonb_build_object('key',c,'sessions',n,'eligible',el,'confirmed',cf) order by n desc,c) from (
     select c,count(*) n,count(*) filter (where f.eligible) el,count(*) filter (where f.crm_class='confirmed') cf from f cross join unnest(f.elements) c where f.cur group by c) z),'[]'::jsonb),
   'products',coalesce((select jsonb_agg(jsonb_build_object('text',t,'sessions',n,'confirmed',cf) order by n desc,t) from (
     select t,count(*) n,count(*) filter (where f.crm_class='confirmed') cf from f cross join unnest(f.products) t where f.cur group by t order by count(*) desc,t limit 10) z),'[]'::jsonb),
   'price_bands',coalesce((select jsonb_agg(jsonb_build_object('key',k,'sessions',n) order by k) from (
     select coalesce(f.price_band,'not_stated') k,count(*) n from f where f.cur and f.analysis_id is not null group by 1) z),'[]'::jsonb),
   'signals',coalesce((select jsonb_object_agg(k,n) from (select k,count(*) n from f cross join unnest(f.signals) k where f.cur group by k) z),'{}'::jsonb),
   'mentions',jsonb_build_object(
     'concerns',coalesce((select jsonb_agg(jsonb_build_object('text',t,'sessions',n) order by n desc,t) from (select t,count(*) n from f cross join unnest(f.concerns) t where f.cur group by t order by count(*) desc,t limit 10) z),'[]'::jsonb),
     'competitors',coalesce((select jsonb_agg(jsonb_build_object('text',t,'sessions',n) order by n desc,t) from (select t,count(*) n from f cross join unnest(f.competitors) t where f.cur group by t order by count(*) desc,t limit 10) z),'[]'::jsonb),
     'strengths',coalesce((select jsonb_agg(jsonb_build_object('text',t,'sessions',n) order by n desc,t) from (select t,count(*) n from f cross join unnest(f.strengths) t where f.cur and f.score>=80 group by t order by count(*) desc,t limit 10) z),'[]'::jsonb)),
   'quality',(select jsonb_build_object('low_audio',count(*) filter (where 'low_stt_confidence'=any(f.quality_reasons)),'speakers_unverified',count(*) filter (where 'speaker_unverified'=any(f.quality_reasons)),
     'too_little_speech',count(*) filter (where 'too_little_speech'=any(f.quality_reasons)),'backup_model',count(*) filter (where f.fallback_used)) from f where f.cur),
   'correlation',jsonb_build_object(
     'sessions',(select jsonb_build_object('r',round(corr(f.score::float8,(f.crm_class='confirmed')::int::float8)::numeric,2),'n',count(*)) from f where f.cur and f.score is not null and f.eligible),
     'employees',(select jsonb_build_object('r',round(corr(p.average_score::float8,p.conversion_rate::float8)::numeric,2),'n',count(*),
       'points',coalesce(jsonb_agg(jsonb_build_object('employee_id',p.employee_id,'average_score',p.average_score,'conversion_rate',p.conversion_rate,'scored',p.scored,'eligible',p.eligible)),'[]'::jsonb)) from emp_points p)))
 );
end $$;

-- Drill-down: the conversations behind one figure, newest first, at most 50 a page. Metadata only.
-- p_metric: sessions | with_audio | analysed | scored | unscored | not_analysed | retention_removed | processing | needs_attention | interrupted
--  | unreviewed | flagged | at_risk | outcome:<value> | crm:<class|eligible> | funnel:<engaged|interest|price|confirmed> | signal:<key>
--  | category:<key> | element:<key> | product:<text> | price_band:<key|not_stated> | concern:<text> | competitor:<text> | dimension:<key> | slot:<dow>-<hour>
create function recording_analytics_sessions(p_filters jsonb,p_metric text default 'sessions',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); r recording_analytics_args; lim integer:=least(greatest(coalesce(p_limit,25),1),50);
 mk text:=split_part(coalesce(p_metric,'sessions'),':',1); mv text:=nullif(substr(coalesce(p_metric,''),length(split_part(coalesce(p_metric,'sessions'),':',1))+2),''); rows jsonb; total bigint; slot_dow smallint; slot_hour smallint; begin
 r:=recording_analytics_parse(a,p_filters);
 if length(coalesce(p_metric,''))>140 or mk not in ('sessions','with_audio','analysed','scored','unscored','not_analysed','retention_removed','processing','needs_attention','interrupted',
   'unreviewed','flagged','at_risk','outcome','crm','funnel','signal','category','element','product','price_band','concern','competitor','dimension','slot')
  or ((mk in ('outcome','crm','funnel','signal','category','element','product','price_band','concern','competitor','dimension','slot')) <> (mv is not null))
  or (mk='slot' and mv !~ '^[1-7]-([0-9]|1[0-9]|2[0-3])$') then raise exception 'recording_invalid_filter' using errcode='22023'; end if;
 -- Parsed here, never inside the query: a constant cast in an unused CASE arm could fail at plan time.
 if mk='slot' then slot_dow:=split_part(mv,'-',1)::smallint; slot_hour:=split_part(mv,'-',2)::smallint; end if;
 perform recording_refresh_facts(a.tenant_id,2000);
 with m as (select x.session_id,x.created_at,x.branch_id,x.employee_id,x.duration_ms,x.stage,x.score,x.review_state,x.ai_outcome,x.crm_class,x.retention_removed,x.manager_scored
 from recording_fact_rows(a.tenant_id,r,r.date_from,r.date_to) x
 where case mk when 'sessions' then true when 'with_audio' then x.duration_ms>0 when 'analysed' then x.analysis_id is not null when 'scored' then x.score is not null
  when 'unscored' then x.analysis_id is not null and x.score is null when 'not_analysed' then x.analysis_id is null and not x.retention_removed
  when 'retention_removed' then x.retention_removed when 'processing' then x.stage in ('recording','saving','processing') when 'needs_attention' then x.stage='needs_attention'
  when 'interrupted' then x.error_reason='capture_interrupted' when 'unreviewed' then x.analysis_id is not null and x.review_state is null when 'flagged' then x.review_state='flag'
  when 'at_risk' then x.interest and x.crm_class in ('open','lost')
  when 'outcome' then case when mv='unknown' then x.analysis_id is not null and (x.ai_outcome is null or x.ai_outcome='unknown') else x.ai_outcome=mv end
  when 'crm' then case when mv='eligible' then x.crm_class in ('confirmed','credited_elsewhere','lost','open') else x.crm_class=mv end
  when 'funnel' then case mv when 'engaged' then x.engaged when 'interest' then x.engaged and x.interest when 'price' then x.engaged and x.interest and x.price_discussed
   when 'confirmed' then x.engaged and x.crm_class='confirmed' else false end
  when 'signal' then mv=any(x.signals) when 'category' then mv=any(x.categories) when 'element' then mv=any(x.elements) when 'product' then mv=any(x.products)
  when 'price_band' then case when mv='not_stated' then x.analysis_id is not null and x.price_band is null else x.price_band=mv end
  when 'concern' then mv=any(x.concerns) when 'competitor' then mv=any(x.competitors)
  when 'dimension' then exists(select 1 from jsonb_array_elements(x.dimensions) d where d->>'k'=mv)
  when 'slot' then x.local_dow=slot_dow and x.local_hour=slot_hour
  else false end)
 select (select count(*) from m),(select coalesce(jsonb_agg(z.j order by z.created_at desc,z.session_id desc),'[]'::jsonb) from (
  select d.created_at,d.session_id,jsonb_build_object('session_id',d.session_id,'created_at',d.created_at,'branch_id',d.branch_id,'branch_name',b.name,
    'employee_id',d.employee_id,'employee_name',u.employee_name,'duration_ms',d.duration_ms,'stage',d.stage,'score',d.score,'manager_scored',d.manager_scored,
    'review_state',d.review_state,'ai_outcome',d.ai_outcome,'crm_class',d.crm_class,'retention_removed',d.retention_removed,
    'can_open',recorder_can_read(d.employee_id,a.tenant_id,d.branch_id)) j
  from m d join branches b on b.id=d.branch_id join user_profiles u on u.id=d.employee_id
  where p_before is null or (d.created_at,d.session_id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by d.created_at desc,d.session_id desc limit lim+1) z) into total,rows;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements(rows) with ordinality where ordinality<=lim),'[]'::jsonb),
  'has_more',jsonb_array_length(rows)>lim,'total',total);
end $$;

-- Daily time per phone: connected (contacts no more than 2 minutes apart) and recorded (saved audio).
create function recording_device_days_page(p_filters jsonb,p_offset integer default 0,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); r recording_analytics_args; lim integer:=least(greatest(coalesce(p_limit,25),1),50); off integer:=least(greatest(coalesce(p_offset,0),0),100000); begin
 r:=recording_analytics_parse(a,p_filters);
 perform recording_refresh_facts(a.tenant_id,2000);
 return (with rec as (select f.device_id,f.local_date,count(*) sessions,coalesce(sum(f.duration_ms),0) recorded_ms from recording_session_facts f
    where f.tenant_id=a.tenant_id and f.branch_id=any(r.branch_ids) and f.local_date between r.date_from and r.date_to
     and (coalesce(cardinality(r.employee_ids),0)=0 or f.employee_id=any(r.employee_ids)) and (r.device_id is null or f.device_id=r.device_id) group by 1,2),
  pres as (select d.* from recorder_device_days d where d.tenant_id=a.tenant_id and d.branch_id=any(r.branch_ids) and d.local_date between r.date_from and r.date_to
     and (coalesce(cardinality(r.employee_ids),0)=0 or d.employee_id=any(r.employee_ids)) and (r.device_id is null or d.device_id=r.device_id)),
  days as (select coalesce(p.device_id,x.device_id) device_id,coalesce(p.local_date,x.local_date) local_date,p.connected_ms,p.contacts,p.first_contact_at,p.last_contact_at,
    coalesce(x.sessions,0) sessions,coalesce(x.recorded_ms,0) recorded_ms
   from pres p full join rec x on x.device_id=p.device_id and x.local_date=p.local_date),
  named as (select d.*,dv.employee_id,dv.branch_id,u.employee_name,b.name branch_name,dv.last_seen_at from days d join recorder_devices dv on dv.id=d.device_id
   join user_profiles u on u.id=dv.employee_id join branches b on b.id=dv.branch_id where dv.tenant_id=a.tenant_id)
  select jsonb_build_object(
   'rows',coalesce((select jsonb_agg(jsonb_build_object('date',n.local_date,'device_id',n.device_id,'device_label','Phone ending '||right(replace(n.device_id::text,'-',''),4),
     'employee_id',n.employee_id,'employee_name',n.employee_name,'branch_id',n.branch_id,'branch_name',n.branch_name,'connected_ms',n.connected_ms,'contacts',n.contacts,
     'first_contact_at',n.first_contact_at,'last_contact_at',n.last_contact_at,'sessions',n.sessions,'recorded_ms',n.recorded_ms,'last_seen_at',n.last_seen_at) order by n.local_date desc,n.employee_name,n.device_id)
    from (select * from named order by local_date desc,employee_name,device_id offset off limit lim) n),'[]'::jsonb),
   'total',(select count(*) from named),
   'totals',(select jsonb_build_object('connected_ms',coalesce(sum(connected_ms),0),'recorded_ms',coalesce(sum(recorded_ms),0),'sessions',coalesce(sum(sessions),0),
     'devices',count(distinct device_id),'days_without_presence',count(*) filter (where connected_ms is null)) from named),
   'presence_since',(select min(d.local_date) from recorder_device_days d where d.tenant_id=a.tenant_id),
   'gap_seconds',120,'generated_at',now(),'timezone','Asia/Kolkata'));
end $$;

-- Filter choices within the caller's scope (bounded lists).
create function recording_analytics_options() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); all_branches boolean; allowed uuid[]; begin
 if not recording_is_branch_reviewer(a) then raise exception 'recording_review_denied' using errcode='42501'; end if;
 all_branches:=has_permission('recording.analytics_all_branches');
 allowed:=case when all_branches then array(select b.id from branches b where b.tenant_id=a.tenant_id and coalesce(b.is_active,true)) else array[a.branch_id] end;
 return jsonb_build_object('all_branches',all_branches,'home_branch_id',a.branch_id,
  'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name) from branches b where b.id=any(allowed)),'[]'::jsonb),
  'employees',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name,'branch_id',u.branch_id) order by u.employee_name) from (
    select u.* from user_profiles u where u.tenant_id=a.tenant_id and (u.branch_id=any(allowed) and (exists(select 1 from recorder_sessions s where s.employee_id=u.id and s.branch_id=any(allowed))
     or u.id=any(coalesce((select c.employee_ids from recorder_config c where c.tenant_id=a.tenant_id),'{}')))) order by u.employee_name limit 500) u),'[]'::jsonb),
  'devices',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'label','Phone ending '||right(replace(d.id::text,'-',''),4),'employee_name',u.employee_name,'branch_id',d.branch_id) order by u.employee_name,d.id)
    from (select * from recorder_devices d where d.tenant_id=a.tenant_id and d.branch_id=any(allowed) order by d.last_seen_at desc limit 500) d join user_profiles u on u.id=d.employee_id),'[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Grants and backfill.
-- ---------------------------------------------------------------------------------------------
do $$ declare f text; begin foreach f in array array[
 'recording_evidenced(jsonb)','recording_claim_texts(jsonb,integer)','recording_product_categories(text[])','recording_product_elements(text[])','recording_price_band(text)',
 'recording_crm_class(text,text,timestamptz)','recording_fact_touch(uuid)','recording_fact_touch_visit(uuid)','recording_fact_trigger()','recording_fact_config_trigger()',
 'recorder_device_presence_trigger()','recording_refresh_facts(uuid,integer)','recording_analytics_parse(user_profiles,jsonb)',
 'recording_fact_rows(uuid,recording_analytics_args,date,date)','recording_analytics_freshness(uuid,uuid[])',
 'recording_analytics(jsonb)','recording_analytics_sessions(jsonb,text,timestamptz,uuid,integer)','recording_device_days_page(jsonb,integer,integer)','recording_analytics_options()'] loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f); end loop; end $$;
grant execute on function recording_analytics(jsonb),recording_analytics_sessions(jsonb,text,timestamptz,uuid,integer),recording_device_days_page(jsonb,integer,integer),
 recording_analytics_options() to authenticated;

-- Count every existing conversation now, so the first read is complete.
insert into recording_fact_queue(session_id,tenant_id) select id,tenant_id from recorder_sessions on conflict(session_id) do nothing;
do $$ declare t uuid; begin for t in select distinct tenant_id from recording_fact_queue loop perform recording_refresh_facts(t,1000000); end loop; end $$;
notify pgrst,'reload schema';
