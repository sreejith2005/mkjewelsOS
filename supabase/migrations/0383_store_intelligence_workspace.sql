-- Store Intelligence workspace: the reads behind Today, Conversations, Coaching,
-- Insights, Devices and Settings, and one audited write (a follow-up task made
-- from a suggested next action, created at most once per action).
--
-- Every read reuses the existing boundaries: recorder_actor() (active profile +
-- section access), recorder_can_read() (own sessions, or a manager with
-- recording.review in the same tenant and branch) and the 0379 rule that the
-- recorded employee sees only manager-approved or manager-edited analyses.
-- Nothing here returns transcript text, audio keys or another branch's rows.
set search_path=public,extensions;

create index if not exists recorder_sessions_scope_created on recorder_sessions(tenant_id,branch_id,created_at desc,id desc);
create index if not exists recording_analyses_tenant_created on recording_analyses(tenant_id,created_at);

-- ---------------------------------------------------------------------------
-- Internal helpers (security definer, never granted to the browser).

-- Latest non-comment review action: the same value the 0379 snapshot calls review_state.
create function recording_review_state(p_analysis uuid) returns text language sql stable security definer set search_path=public as $$
 select rv.action from recording_analysis_reviews rv where rv.analysis_id=p_analysis and rv.action<>'comment' order by rv.created_at desc,rv.id desc limit 1
$$;

-- The analysis a viewer may see for a session: the latest one for a reviewer,
-- otherwise the latest approved or edited one (0379 snapshot rule).
create function recording_visible_analysis(p_session uuid,p_reviewer boolean) returns recording_analyses language sql stable security definer set search_path=public as $$
 select x.* from recording_analyses x where x.session_id=p_session and (p_reviewer or recording_review_state(x.id) in ('approve','edit'))
 order by x.created_at desc,x.id desc limit 1
$$;

-- A manager's latest edit replaces the AI total; otherwise the AI total.
create function recording_effective_score(p_analysis uuid) returns numeric language sql stable security definer set search_path=public as $$
 select case when e.id is not null then e.reviewed_total else an.raw_total end
 from recording_analyses an
 left join lateral (select rv.id,rv.reviewed_total from recording_analysis_reviews rv where rv.analysis_id=an.id and rv.action='edit' order by rv.created_at desc,rv.id desc limit 1) e on true
 where an.id=p_analysis
$$;

-- Per-area ratings after the latest manager edit (overrides replace the AI value for their key).
create function recording_effective_dimensions(p_analysis uuid) returns table(dimension_key text,label text,status text,rating integer)
language sql stable security definer set search_path=public as $$
 with ed as (select rv.dimension_overrides o from recording_analysis_reviews rv where rv.analysis_id=p_analysis and rv.action='edit' order by rv.created_at desc,rv.id desc limit 1)
 select d.dimension_key,d.label,coalesce(ov.x->>'status',d.status),
  case when ov.x is null then d.rating when ov.x->>'status'='assessed' then (ov.x->>'rating')::integer end
 from recording_score_dimensions d
 left join lateral (select value x from ed,jsonb_array_elements(ed.o) where value->>'key'=d.dimension_key limit 1) ov on true
 where d.analysis_id=p_analysis
$$;

-- Captured audio length: canonical PCM is 16 kHz mono 16-bit = 32 bytes per millisecond.
create function recording_session_duration_ms(p_session uuid) returns bigint language sql stable security definer set search_path=public as $$
 select coalesce(sum(byte_count),0)::bigint/32 from recorder_chunks where session_id=p_session
$$;

-- One plain stage per conversation. 'processing' includes a finished transcript
-- whose AI review is still queued or running.
create function recording_session_stage(s recorder_sessions) returns text language sql stable security definer set search_path=public as $$
 select case
  when s.status in ('recording','paused') and s.capture_ended_at is null then 'recording'
  when s.status='saving' then 'saving'
  when s.status='processing' then 'processing'
  when s.status='needs_attention' then 'needs_attention'
  when exists(select 1 from recording_analysis_jobs j where j.session_id=s.id and j.state in ('pending','leased')) then 'processing'
  else 'ready' end
$$;

create function recording_session_card(s recorder_sessions,p_reviewer boolean) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare an recording_analyses:=recording_visible_analysis(s.id,p_reviewer); st text; begin
 if an.id is not null then st:=recording_review_state(an.id); end if;
 return jsonb_build_object(
  'id',s.id,'employee_id',s.employee_id,'employee_name',(select u.employee_name from user_profiles u where u.id=s.employee_id),
  'branch_name',(select b.name from branches b where b.id=s.branch_id),'created_at',s.created_at,'capture_ended_at',s.capture_ended_at,
  'status',s.status,'stage',recording_session_stage(s),'error_reason',s.error_reason,'expires_at',s.expires_at,'retention_expired',s.expires_at<=now(),
  'duration_ms',recording_session_duration_ms(s.id),'customer_linked',s.customer_ref is not null,
  'transcript_ready',exists(select 1 from recording_transcript_revisions v where v.session_id=s.id),
  -- The employee is told a review exists without seeing it before approval.
  'awaiting_review',an.id is null and exists(select 1 from recording_analyses x where x.session_id=s.id),
  'analysis',case when an.id is null then null else jsonb_build_object(
   'id',an.id,'status',an.status,'review_state',st,'score',recording_effective_score(an.id),
   'manager_scored',exists(select 1 from recording_analysis_reviews rv where rv.analysis_id=an.id and rv.action='edit'),
   'outcome',an.output#>>'{signals,sales_outcome,value}','summary',left(an.output->>'summary',280),
   'action_count',case when jsonb_typeof(an.output->'next_best_actions')='array' then jsonb_array_length(an.output->'next_best_actions') else 0 end,
   'status_reasons',to_jsonb(an.status_reasons)) end);
end $$;

create function recording_is_branch_reviewer(a user_profiles) returns boolean language sql stable security definer set search_path=public as $$
 select a.user_role in ('super_admin','admin','manager') and has_permission('recording.review')
$$;

create function recording_ilike_pattern(p text) returns text language sql immutable set search_path=pg_catalog as $$
 select '%'||replace(replace(replace(p,'\','\\'),'%','\%'),'_','\_')||'%'
$$;

-- ---------------------------------------------------------------------------
-- Conversations: keyset-paged, newest first, at most 50 a page.
create function recording_conversations_page(p_filters jsonb default '{}'::jsonb,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); f jsonb:=coalesce(p_filters,'{}'::jsonb); lim integer:=least(greatest(coalesce(p_limit,25),1),50);
 q text; prod text; df date; dt date; emp uuid; stg text; outc text; smin numeric; smax numeric; mmin numeric; mmax numeric; linked boolean; flagged boolean; rows jsonb; begin
 if jsonb_typeof(f)<>'object' or exists(select 1 from jsonb_object_keys(f) k where k not in ('q','product','date_from','date_to','employee_id','stage','outcome','min_score','max_score','min_minutes','max_minutes','linked','flagged')) then
  raise exception 'recording_invalid_filter' using errcode='22023'; end if;
 begin
  q:=nullif(btrim(left(f->>'q',100)),''); prod:=nullif(btrim(left(f->>'product',100)),'');
  df:=(f->>'date_from')::date; dt:=(f->>'date_to')::date; emp:=(f->>'employee_id')::uuid;
  stg:=f->>'stage'; outc:=f->>'outcome';
  smin:=(f->>'min_score')::numeric; smax:=(f->>'max_score')::numeric; mmin:=(f->>'min_minutes')::numeric; mmax:=(f->>'max_minutes')::numeric;
  linked:=coalesce((f->>'linked')::boolean,false); flagged:=coalesce((f->>'flagged')::boolean,false);
 exception when others then raise exception 'recording_invalid_filter' using errcode='22023'; end;
 if (stg is not null and stg not in ('recording','saving','processing','ready','needs_attention'))
  or (outc is not null and outc not in ('unknown','enquiry','follow_up','reported_purchase','no_purchase')) then raise exception 'recording_invalid_filter' using errcode='22023'; end if;
 select coalesce(jsonb_agg(x.c order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from (
  select recording_session_card(s,rv.reviewer) c,s.created_at,s.id
  from recorder_sessions s
  cross join lateral (select recording_is_reviewer(s) reviewer) rv
  left join lateral (select * from recording_visible_analysis(s.id,rv.reviewer)) an on true
  where s.tenant_id=a.tenant_id and s.branch_id=a.branch_id and recorder_can_read(s.employee_id,s.tenant_id,s.branch_id)
   and (p_before is null or (s.created_at,s.id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   and (emp is null or s.employee_id=emp)
   and (df is null or (s.created_at at time zone 'Asia/Kolkata')::date>=df)
   and (dt is null or (s.created_at at time zone 'Asia/Kolkata')::date<=dt)
   and (not linked or s.customer_ref is not null)
   and (stg is null or recording_session_stage(s)=stg)
   and (outc is null or an.output#>>'{signals,sales_outcome,value}'=outc)
   and (smin is null or recording_effective_score(an.id)>=smin)
   and (smax is null or recording_effective_score(an.id)<=smax)
   and (mmin is null or recording_session_duration_ms(s.id)>=mmin*60000)
   and (mmax is null or recording_session_duration_ms(s.id)<=mmax*60000)
   and (not flagged or recording_review_state(an.id)='flag')
   and (prod is null or (an.output->'product_interests')::text ilike recording_ilike_pattern(prod))
   and (q is null or exists(select 1 from user_profiles u where u.id=s.employee_id and u.employee_name ilike recording_ilike_pattern(q))
        or an.output->>'summary' ilike recording_ilike_pattern(q) or (an.output->'product_interests')::text ilike recording_ilike_pattern(q))
  order by s.created_at desc,s.id desc limit lim+1) x;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements(rows) with ordinality where ordinality<=lim),'[]'::jsonb),
  'has_more',jsonb_array_length(rows)>lim,'is_reviewer',recording_is_branch_reviewer(a));
end $$;

-- One conversation card (the detail header), readable by whoever can read the session.
create function recording_conversation_card(p_session_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); s recorder_sessions; begin
 select * into s from recorder_sessions where id=p_session_id;
 if s.id is null or not recorder_can_read(s.employee_id,s.tenant_id,s.branch_id) then raise exception 'recorder_session_denied' using errcode='42501'; end if;
 return recording_session_card(s,recording_is_reviewer(s))||jsonb_build_object('is_reviewer',recording_is_reviewer(s),'is_own',s.employee_id=a.id);
end $$;

-- ---------------------------------------------------------------------------
-- Today: the signed-in person's day, coaching summary and open next actions.
create function recording_today() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); c recorder_config; today date:=(now() at time zone 'Asia/Kolkata')::date; reviewer boolean; begin
 select * into c from recorder_config where tenant_id=a.tenant_id;
 reviewer:=recording_is_branch_reviewer(a);
 return jsonb_build_object(
  'pilot_enabled',coalesce(c.enabled,false),
  'has_capture_permission',has_permission('recording.capture'),
  'can_record',has_permission('recording.capture') and coalesce(c.enabled,false) and a.id=any(coalesce(c.employee_ids,'{}')) and a.branch_id=any(coalesce(c.branch_ids,'{}')),
  'analysis_enabled',coalesce(c.analysis_enabled,false),
  'retention_days',coalesce(c.retention_days,7),'consent_version','pilot-v1','is_reviewer',reviewer,
  'today',(select jsonb_build_object('total',count(*),
     'recording',count(*) filter (where recording_session_stage(s)='recording'),'saving',count(*) filter (where recording_session_stage(s)='saving'),
     'processing',count(*) filter (where recording_session_stage(s)='processing'),'ready',count(*) filter (where recording_session_stage(s)='ready'),
     'needs_attention',count(*) filter (where recording_session_stage(s)='needs_attention'),
     'recorded_ms',coalesce(sum(recording_session_duration_ms(s.id)),0))
   from recorder_sessions s where s.employee_id=a.id and s.tenant_id=a.tenant_id and s.branch_id=a.branch_id and (s.created_at at time zone 'Asia/Kolkata')::date=today),
  'recent',coalesce((select jsonb_agg(recording_session_card(s,false) order by s.created_at desc) from recorder_sessions s where s.id in (
    select r.id from recorder_sessions r where r.employee_id=a.id and r.tenant_id=a.tenant_id and r.branch_id=a.branch_id order by r.created_at desc limit 6)),'[]'::jsonb),
  'coaching',(with mine as (
     select an.id,an.created_at,an.output from recorder_sessions s
     cross join lateral (select * from recording_visible_analysis(s.id,false)) an
     where s.employee_id=a.id and s.tenant_id=a.tenant_id and s.branch_id=a.branch_id and s.created_at>now()-interval '30 days' and an.id is not null),
    dims as (select d.label,avg(d.rating)::numeric(4,1) avg_rating,count(*) n from mine m cross join lateral recording_effective_dimensions(m.id) d where d.status='assessed' group by d.label)
    select jsonb_build_object('reviewed',(select count(*) from mine),
     'average_score',(select round(avg(recording_effective_score(id)),1) from mine where recording_effective_score(id) is not null),
     'strength',(select jsonb_build_object('label',label,'average',avg_rating) from dims order by avg_rating desc,label limit 1),
     'focus',(select jsonb_build_object('label',label,'average',avg_rating) from dims where (select count(*) from dims)>1 order by avg_rating,label limit 1),
     'tip',(select jsonb_build_object('text',m.output#>>'{coaching_interventions,0,text}','reason',m.output#>>'{coaching_interventions,0,reason}')
       from mine m where m.output#>>'{coaching_interventions,0,text}' is not null order by m.created_at desc limit 1))),
  'next_actions',coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select jsonb_build_object('session_id',s.id,'analysis_id',an.id,'action_index',(e.ordinality-1)::integer,'action',e.value->>'action','reason',e.value->>'reason','created_at',s.created_at) x
    from recorder_sessions s
    cross join lateral (select * from recording_visible_analysis(s.id,false)) an
    cross join lateral jsonb_array_elements(case when jsonb_typeof(an.output->'next_best_actions')='array' then an.output->'next_best_actions' else '[]'::jsonb end) with ordinality e
    where s.employee_id=a.id and s.tenant_id=a.tenant_id and s.branch_id=a.branch_id and s.created_at>now()-interval '14 days' and s.expires_at>now() and an.id is not null
     and not exists(select 1 from recording_action_tasks t where t.analysis_id=an.id and t.action_index=e.ordinality-1)
    order by s.created_at desc limit 8) y),'[]'::jsonb),
  'review_queue',case when reviewer then (select count(*) from recorder_sessions s
     cross join lateral (select * from recording_visible_analysis(s.id,true)) an
     where s.tenant_id=a.tenant_id and s.branch_id=a.branch_id and s.expires_at>now() and an.id is not null and recording_review_state(an.id) is null) end);
end $$;

-- ---------------------------------------------------------------------------
-- Follow-up tasks from a suggested next action. One task per action, ever:
-- a second tap returns the task already made (and says so).
create table recording_action_tasks (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),
 session_id uuid not null references recorder_sessions(id),analysis_id uuid not null references recording_analyses(id),
 action_index integer not null check(action_index between 0 and 49),task_id uuid not null references task_instances(id),
 created_by uuid not null references user_profiles(id),created_at timestamptz not null default now(),
 unique(analysis_id,action_index)
);
create index recording_action_tasks_session on recording_action_tasks(session_id);
create index recording_action_tasks_tenant_created on recording_action_tasks(tenant_id,created_at);
alter table recording_action_tasks enable row level security;
revoke all on recording_action_tasks from public,anon,authenticated,service_role;
create policy module_accessible on recording_action_tasks as restrictive for select to authenticated using (public.module_accessible('sales_recording',false));

create function recording_create_action_task(p_analysis_id uuid,p_action_index integer,p_planned_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); an recording_analyses; s recorder_sessions; reviewer boolean; act jsonb; link recording_action_tasks; task uuid; emp user_profiles; begin
 select * into an from recording_analyses where id=p_analysis_id;
 if an.id is null then raise exception 'recording_action_denied' using errcode='42501'; end if;
 select * into s from recorder_sessions where id=an.session_id;
 if s.id is null or not recorder_can_read(s.employee_id,s.tenant_id,s.branch_id) then raise exception 'recording_action_denied' using errcode='42501'; end if;
 reviewer:=recording_is_reviewer(s);
 -- The employee acts only on a review their manager released to them.
 if not reviewer and (s.employee_id<>a.id or recording_review_state(an.id) not in ('approve','edit') or recording_review_state(an.id) is null) then raise exception 'recording_action_denied' using errcode='42501'; end if;
 if s.expires_at<=now() then raise exception 'recording_retention_expired' using errcode='22023'; end if;
 if p_action_index is null or jsonb_typeof(an.output->'next_best_actions') is distinct from 'array' or p_action_index<0 or p_action_index>=jsonb_array_length(an.output->'next_best_actions') then
  raise exception 'recording_action_not_found' using errcode='22023'; end if;
 if p_planned_at is null or p_planned_at<now()-interval '1 day' or p_planned_at>now()+interval '90 days' then raise exception 'recording_invalid_due' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(an.id::text||':'||p_action_index,11));
 select * into link from recording_action_tasks where analysis_id=an.id and action_index=p_action_index;
 if link.id is not null then return jsonb_build_object('task_id',link.task_id,'already_created',true); end if;
 act:=an.output->'next_best_actions'->p_action_index;
 if nullif(btrim(act->>'action'),'') is null then raise exception 'recording_action_not_found' using errcode='22023'; end if;
 select * into emp from user_profiles where id=s.employee_id;
 -- The existing audited task contract applies its own section and authoring rules.
 task:=create_manual_task_with_mode_with_audit(
  jsonb_build_object('task_type','checklist','title',left('Follow up: '||btrim(act->>'action'),200),
   'description',left(coalesce(nullif(btrim(act->>'reason'),'')||E'\n\n','')||'Suggested from a conversation recorded on '||to_char(s.created_at at time zone 'Asia/Kolkata','DD Mon YYYY, HH12:MI AM')||' (Store Intelligence).',2000),
   'planned_datetime',p_planned_at,'priority','medium','branch_id',s.branch_id,'department_id',emp.department_id,
   'category_id',(select id from dropdown_masters where tenant_id=s.tenant_id and master_type='task_category' and is_active order by sort_order,label limit 1)),
  array[s.employee_id],'{}'::uuid[],jsonb_build_array(jsonb_build_object('item_text',left(btrim(act->>'action'),500))));
 insert into recording_action_tasks(tenant_id,session_id,analysis_id,action_index,task_id,created_by) values(s.tenant_id,s.id,an.id,p_action_index,task,a.id);
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(s.tenant_id,a.id,'recording_action_task_created','sales_recording',s.id,
  jsonb_build_object('analysis_id',an.id,'action_index',p_action_index,'task_id',task));
 return jsonb_build_object('task_id',task,'already_created',false);
end $$;

-- Tasks already made from this conversation's suggestions, with their live status.
create function recording_session_action_tasks(p_session_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); s recorder_sessions; begin
 select * into s from recorder_sessions where id=p_session_id;
 if s.id is null or not recorder_can_read(s.employee_id,s.tenant_id,s.branch_id) then raise exception 'recorder_session_denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('analysis_id',t.analysis_id,'action_index',t.action_index,'task_id',t.task_id,'created_at',t.created_at,
   'task_status',ti.status,'planned_datetime',ti.planned_datetime,'deleted',ti.deleted_at is not null) order by t.created_at)
  from recording_action_tasks t join task_instances ti on ti.id=t.task_id where t.session_id=s.id),'[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Devices: a manager's view of the recorders in their branch. Status words are
-- deliberately distinct: "recording" needs a heartbeat inside two minutes, and a
-- quiet phone is "not seen recently", never "offline" (we cannot know that).
create function recording_devices_page(p_status text default null,p_q text default null,p_offset integer default 0,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); today date:=(now() at time zone 'Asia/Kolkata')::date; lim integer:=least(greatest(coalesce(p_limit,25),1),50); off integer:=greatest(coalesce(p_offset,0),0); q text:=nullif(btrim(left(p_q,100)),''); begin
 if not recording_is_branch_reviewer(a) then raise exception 'recording_review_denied' using errcode='42501'; end if;
 if p_status is not null and p_status not in ('recording','paused','saving','interrupted','idle','not_seen') then raise exception 'recording_invalid_filter' using errcode='22023'; end if;
 return (with dev as (
   select d.id,d.employee_id,u.employee_name,d.last_seen_at,o.id open_id,o.created_at open_started,o.error_reason open_error,
    case
     when o.id is not null and o.status='recording' and greatest(o.last_seen_at,d.last_seen_at)>now()-interval '2 minutes' then 'recording'
     when o.id is not null and o.status='paused' then 'paused'
     when o.id is not null then 'interrupted'
     when exists(select 1 from recorder_sessions sv where sv.device_id=d.id and sv.status='saving') then 'saving'
     when d.last_seen_at>now()-interval '15 minutes' then 'idle'
     else 'not_seen' end status,
    (select coalesce(sum(recording_session_duration_ms(st.id)),0) from recorder_sessions st where st.device_id=d.id and (st.created_at at time zone 'Asia/Kolkata')::date=today) recorded_ms_today,
    (select count(*) from recorder_sessions st where st.device_id=d.id and (st.created_at at time zone 'Asia/Kolkata')::date=today) sessions_today
   from recorder_devices d join user_profiles u on u.id=d.employee_id
   left join lateral (select * from recorder_sessions o where o.device_id=d.id and o.capture_ended_at is null order by o.created_at desc limit 1) o on true
   where d.tenant_id=a.tenant_id and d.branch_id=a.branch_id),
  filtered as (select * from dev where (p_status is null or status=p_status) and (q is null or employee_name ilike recording_ilike_pattern(q)))
  select jsonb_build_object(
   'rows',coalesce((select jsonb_agg(jsonb_build_object('device_id',id,'device_label','Phone ending '||right(replace(id::text,'-',''),4),'employee_id',employee_id,'employee_name',employee_name,
     'last_seen_at',last_seen_at,'status',status,'open_session_id',open_id,'open_session_started_at',open_started,'error_reason',open_error,
     'recorded_ms_today',recorded_ms_today,'sessions_today',sessions_today) order by x.rank,x.employee_name,x.id)
    from (select f.*,case f.status when 'interrupted' then 0 when 'recording' then 1 when 'paused' then 2 when 'saving' then 3 when 'idle' then 4 else 5 end rank
     from filtered f order by rank,employee_name,id offset off limit lim) x),'[]'::jsonb),
   'total',(select count(*) from filtered),
   'counts',(select jsonb_build_object('recording',count(*) filter (where status='recording'),'paused',count(*) filter (where status='paused'),
     'saving',count(*) filter (where status='saving'),'interrupted',count(*) filter (where status='interrupted'),'idle',count(*) filter (where status='idle'),
     'not_seen',count(*) filter (where status='not_seen')) from dev)));
end $$;

-- ---------------------------------------------------------------------------
-- Insights and coaching: branch aggregates for a manager. Outcomes are what the
-- AI heard in the conversation, labelled as such; nothing here is a CRM sale.
create function recording_insights(p_from date,p_to date,p_employee_id uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); begin
 if not recording_is_branch_reviewer(a) then raise exception 'recording_review_denied' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'recording_invalid_filter' using errcode='22023'; end if;
 return (with base as (
   select s.id,s.employee_id,s.created_at,(s.created_at at time zone 'Asia/Kolkata') local_at,recording_session_duration_ms(s.id) dur,an.id analysis_id,an.status astatus,an.status_reasons,an.output,an.fallback_used,
    case when an.id is not null then recording_effective_score(an.id) end score,case when an.id is not null then recording_review_state(an.id) end rstate,
    an.output#>>'{signals,sales_outcome,value}' outcome
   from recorder_sessions s left join lateral (select * from recording_visible_analysis(s.id,true)) an on true
   where s.tenant_id=a.tenant_id and s.branch_id=a.branch_id and (s.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    and (p_employee_id is null or s.employee_id=p_employee_id)),
  analysed as (select * from base where analysis_id is not null),
  claims as (select k.kind,lower(btrim(c.value->>'text')) txt from analysed b
   cross join lateral (values ('product',b.output->'product_interests'),('concern',b.output->'customer_concerns'),('blocker',b.output->'purchase_blockers'),('competitor',b.output->'competitor_mentions')) k(kind,arr)
   cross join lateral jsonb_array_elements(case when jsonb_typeof(k.arr)='array' then k.arr else '[]'::jsonb end) c
   where nullif(btrim(c.value->>'text'),'') is not null)
  select jsonb_build_object(
   'range',jsonb_build_object('from',p_from,'to',p_to),
   'totals',(select jsonb_build_object('conversations',count(*),'recorded_ms',coalesce(sum(dur),0),'analysed',count(analysis_id),
     'scored',count(score),'average_score',round(avg(score),1),'needs_review',count(*) filter (where astatus='needs_review'),
     'unreviewed',count(*) filter (where analysis_id is not null and rstate is null),'approved',count(*) filter (where rstate in ('approve','edit')),
     'flagged',count(*) filter (where rstate='flag'),'employees',count(distinct employee_id)) from base),
   'outcomes',(select jsonb_build_object('enquiry',count(*) filter (where outcome='enquiry'),'follow_up',count(*) filter (where outcome='follow_up'),
     'reported_purchase',count(*) filter (where outcome='reported_purchase'),'no_purchase',count(*) filter (where outcome='no_purchase'),
     'unknown',count(*) filter (where outcome='unknown' or outcome is null)) from analysed),
   'signals',(select coalesce(jsonb_object_agg(k,n),'{}'::jsonb) from (select k,count(*) n from analysed b
     cross join lateral unnest(array['objection','price_concern','stock_gap','competitor_mention','customer_questions','conversion_signal','next_step','drop_off','upsell_opportunity']) k
     where (b.output#>>array['signals',k,'detected'])::boolean group by k) z),
   'dimensions',coalesce((select jsonb_agg(jsonb_build_object('label',label,'average',avg_rating,'assessed',n) order by avg_rating) from (
     select d.label,round(avg(d.rating),1) avg_rating,count(*) n from analysed b cross join lateral recording_effective_dimensions(b.analysis_id) d where d.status='assessed' group by d.label) z),'[]'::jsonb),
   'by_day',coalesce((select jsonb_agg(jsonb_build_object('date',on_date,'conversations',n,'average_score',avg_score,'recorded_ms',ms) order by on_date) from (
     select local_at::date as on_date,count(*) n,round(avg(score),1) avg_score,sum(dur) ms from base group by 1) z),'[]'::jsonb),
   'by_hour',coalesce((select jsonb_agg(jsonb_build_object('hour',h,'conversations',n) order by h) from (select extract(hour from local_at)::integer h,count(*) n from base group by 1) z),'[]'::jsonb),
   'by_employee',coalesce((select jsonb_agg(z order by z.employee_name) from (
     select b.employee_id,u.employee_name,count(*) conversations,coalesce(sum(b.dur),0) recorded_ms,count(b.score) scored,round(avg(b.score),1) average_score,
      count(*) filter (where b.outcome='reported_purchase') reported_purchase,count(*) filter (where b.outcome='follow_up') follow_up,
      count(*) filter (where b.rstate='flag') flagged,
      round(avg(b.score) filter (where b.local_at::date<=p_from+(p_to-p_from)/2),1) first_half_score,
      round(avg(b.score) filter (where b.local_at::date>p_from+(p_to-p_from)/2),1) second_half_score,
      (select d.label from analysed x cross join lateral recording_effective_dimensions(x.analysis_id) d where x.employee_id=b.employee_id and d.status='assessed' group by d.label order by avg(d.rating),d.label limit 1) focus,
      (select d.label from analysed x cross join lateral recording_effective_dimensions(x.analysis_id) d where x.employee_id=b.employee_id and d.status='assessed' group by d.label order by avg(d.rating) desc,d.label limit 1) strength
     from base b join user_profiles u on u.id=b.employee_id group by b.employee_id,u.employee_name) z),'[]'::jsonb),
   'top_mentions',(select jsonb_build_object(
     'products',coalesce((select jsonb_agg(jsonb_build_object('text',txt,'count',n) order by n desc,txt) from (select txt,count(*) n from claims where kind='product' group by txt order by n desc,txt limit 10) z),'[]'::jsonb),
     'concerns',coalesce((select jsonb_agg(jsonb_build_object('text',txt,'count',n) order by n desc,txt) from (select txt,count(*) n from claims where kind in ('concern','blocker') group by txt order by n desc,txt limit 10) z),'[]'::jsonb),
     'competitors',coalesce((select jsonb_agg(jsonb_build_object('text',txt,'count',n) order by n desc,txt) from (select txt,count(*) n from claims where kind='competitor' group by txt order by n desc,txt limit 10) z),'[]'::jsonb))),
   'quality',(select jsonb_build_object('not_analysed',(select count(*) from base where analysis_id is null),
     'low_audio',count(*) filter (where 'low_stt_confidence'=any(status_reasons)),'speakers_unverified',count(*) filter (where 'speaker_unverified'=any(status_reasons)),
     'too_little_speech',count(*) filter (where 'too_little_speech'=any(status_reasons)),'backup_model',count(*) filter (where fallback_used),
     'interrupted',(select count(*) from recorder_sessions s where s.tenant_id=a.tenant_id and s.branch_id=a.branch_id and s.error_reason='capture_interrupted'
       and (s.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to and (p_employee_id is null or s.employee_id=p_employee_id))) from analysed),
   'follow_ups',(select jsonb_build_object('created',count(*),'completed',count(*) filter (where ti.status='completed'),
     'open',count(*) filter (where ti.status<>'completed' and ti.deleted_at is null),'overdue',count(*) filter (where ti.status<>'completed' and ti.deleted_at is null and ti.planned_datetime<now()))
    from recording_action_tasks t join base b on b.id=t.session_id join task_instances ti on ti.id=t.task_id),
   'crm_outcomes_connected',false));
end $$;

-- Lists that support coaching conversations: flagged work, strongest examples and notes.
create function recording_coaching_lists(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); begin
 if not recording_is_branch_reviewer(a) then raise exception 'recording_review_denied' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'recording_invalid_filter' using errcode='22023'; end if;
 return (with base as (select s.* from recorder_sessions s where s.tenant_id=a.tenant_id and s.branch_id=a.branch_id and (s.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
  carded as (select b.id,b.created_at,an.id analysis_id,recording_review_state(an.id) rstate,recording_effective_score(an.id) score from base b
   cross join lateral (select * from recording_visible_analysis(b.id,true)) an where an.id is not null)
  select jsonb_build_object(
   'flagged',coalesce((select jsonb_agg(recording_session_card(s,true) order by s.created_at desc) from recorder_sessions s
     join (select c.id from carded c where c.rstate='flag' order by c.created_at desc limit 10) z on z.id=s.id),'[]'::jsonb),
   'to_review',coalesce((select jsonb_agg(recording_session_card(s,true) order by s.created_at desc) from recorder_sessions s
     join (select c.id from carded c where c.rstate is null order by c.created_at desc limit 10) z on z.id=s.id where s.expires_at>now()),'[]'::jsonb),
   'strongest',coalesce((select jsonb_agg(recording_session_card(s,true) order by z.score desc,s.created_at desc) from recorder_sessions s
     join (select c.id,c.score from carded c where c.score is not null and c.rstate in ('approve','edit') order by c.score desc,c.created_at desc limit 5) z on z.id=s.id),'[]'::jsonb),
   'notes',coalesce((select jsonb_agg(z order by z.created_at desc) from (
     select rv.session_id,rv.action,rv.note,rv.created_at,ru.employee_name reviewer_name,eu.employee_name employee_name
     from recording_analysis_reviews rv join base b on b.id=rv.session_id join user_profiles ru on ru.id=rv.actor_id join user_profiles eu on eu.id=b.employee_id
     where rv.note is not null order by rv.created_at desc limit 15) z),'[]'::jsonb)));
end $$;

-- ---------------------------------------------------------------------------
-- Settings: what is configured and how the pipeline is doing. Read-only; the
-- existing audited recorder_configure / 0379 functions make every change.
create function recording_workspace_settings() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); c recorder_config; can_configure boolean:=has_permission('developer_mode.manage'); begin
 if not (can_configure or has_permission('recording.manage_rubric') or recording_is_branch_reviewer(a)) then raise exception 'recording_rubric_denied' using errcode='42501'; end if;
 select * into c from recorder_config where tenant_id=a.tenant_id;
 return jsonb_build_object(
  'can_configure',can_configure,'can_manage_versions',has_permission('recording.manage_rubric'),
  'config',jsonb_build_object('enabled',coalesce(c.enabled,false),'retention_days',coalesce(c.retention_days,7),'coaching_enabled',coalesce(c.coaching_enabled,false),
   'analysis_enabled',coalesce(c.analysis_enabled,false),'analysis_job_version',coalesce(c.analysis_job_version,'mk-sales-v1'),'consent_version','pilot-v1',
   'employees',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name) order by u.employee_name) from user_profiles u where u.id=any(coalesce(c.employee_ids,'{}')) and u.tenant_id=a.tenant_id),'[]'::jsonb),
   'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name) from branches b where b.id=any(coalesce(c.branch_ids,'{}')) and b.tenant_id=a.tenant_id),'[]'::jsonb)),
  -- Pickers for the allowlist, only for the person allowed to change it.
  'choices',case when can_configure then jsonb_build_object(
   'employees',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name,'branch_id',u.branch_id) order by u.employee_name) from (select * from user_profiles u where u.tenant_id=a.tenant_id and u.account_status='active' and u.working_status='active' order by u.employee_name limit 500) u),'[]'::jsonb),
   'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name) from branches b where b.tenant_id=a.tenant_id),'[]'::jsonb)) end,
  'devices',(select jsonb_build_object('registered',count(*),'seen_last_day',count(*) filter (where d.last_seen_at>now()-interval '1 day')) from recorder_devices d where d.tenant_id=a.tenant_id
    and (can_configure or d.branch_id=a.branch_id)),
  'health',jsonb_build_object(
   'transcription_waiting',(select count(*) from recorder_jobs j join recorder_sessions s on s.id=j.session_id where s.tenant_id=a.tenant_id and j.kind='final' and j.state in ('pending','leased')),
   'transcription_failed_7d',(select count(*) from recorder_jobs j join recorder_sessions s on s.id=j.session_id where s.tenant_id=a.tenant_id and j.kind='final' and j.state='dead' and j.created_at>now()-interval '7 days'),
   'analysis_waiting',(select count(*) from recording_analysis_jobs j where j.tenant_id=a.tenant_id and j.state in ('pending','leased')),
   'analysis_failed_7d',(select count(*) from recording_analysis_jobs j where j.tenant_id=a.tenant_id and j.state='dead' and j.created_at>now()-interval '7 days'),
   'oldest_waiting_at',(select min(j.created_at) from recording_analysis_jobs j where j.tenant_id=a.tenant_id and j.state in ('pending','leased')),
   'last_transcript_at',(select max(v.created_at) from recording_transcript_revisions v where v.tenant_id=a.tenant_id and v.source='machine'),
   'last_analysis_at',(select max(an.created_at) from recording_analyses an where an.tenant_id=a.tenant_id)),
  'models',coalesce((select jsonb_agg(jsonb_build_object('provider',analyzer_provider,'model',analyzer_model,'analyses',n,'backup_used',fb) order by n desc) from (
    select an.analyzer_provider,an.analyzer_model,count(*) n,count(*) filter (where an.fallback_used) fb from recording_analyses an where an.tenant_id=a.tenant_id and an.created_at>now()-interval '30 days' group by 1,2) z),'[]'::jsonb),
  'cost_tracked',false);
end $$;

-- ---------------------------------------------------------------------------
-- Grants: the browser gets the named contracts only; helpers stay internal.
do $$ declare f text; begin foreach f in array array[
 'recording_review_state(uuid)','recording_visible_analysis(uuid,boolean)','recording_effective_score(uuid)','recording_effective_dimensions(uuid)',
 'recording_session_duration_ms(uuid)','recording_session_stage(recorder_sessions)','recording_session_card(recorder_sessions,boolean)',
 'recording_is_branch_reviewer(user_profiles)','recording_ilike_pattern(text)',
 'recording_conversations_page(jsonb,timestamptz,uuid,integer)','recording_conversation_card(uuid)','recording_today()',
 'recording_create_action_task(uuid,integer,timestamptz)','recording_session_action_tasks(uuid)','recording_devices_page(text,text,integer,integer)',
 'recording_insights(date,date,uuid)','recording_coaching_lists(date,date)','recording_workspace_settings()'] loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f); end loop; end $$;
grant execute on function recording_conversations_page(jsonb,timestamptz,uuid,integer),recording_conversation_card(uuid),recording_today(),
 recording_create_action_task(uuid,integer,timestamptz),recording_session_action_tasks(uuid),recording_devices_page(text,text,integer,integer),
 recording_insights(date,date,uuid),recording_coaching_lists(date,date),recording_workspace_settings() to authenticated;
notify pgrst,'reload schema';
