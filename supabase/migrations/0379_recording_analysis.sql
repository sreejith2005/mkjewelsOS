-- Store Intelligence processing and MK Sales Score on the Sales Recording pipeline.
-- Design: docs/superpowers/specs/2026-11-05-store-intelligence-processing-design.md
-- Dark by default: recorder_config.analysis_enabled=false. AI output is a
-- recommendation only; nothing here writes CRM, purchases or reports.
set search_path=public,extensions;

-- permission-catalog:begin
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values
('recording.manage_rubric', 'action', null, '{super_admin,admin}', 1204);
-- permission-catalog:end

alter table recorder_config
 add column analysis_enabled boolean not null default false,
 add column analysis_job_version text not null default 'mk-sales-v1' check(analysis_job_version ~ '^[a-z0-9][a-z0-9._-]{0,39}$');

-- ---------------------------------------------------------------------------
-- Shared pure helpers. Redaction and quote normalisation are mirrored in
-- services/recorder/redact.py and packages/core/src/salesScore/redact.ts.
create function recording_redact(p text) returns text language sql immutable parallel safe set search_path=pg_catalog as $$
 select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p,''),
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','[EMAIL]','g'),
  '[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}','[UPI]','g'),
  '(?<![A-Za-z0-9])[A-Za-z]{5}[0-9]{4}[A-Za-z](?![A-Za-z0-9])','[PAN]','g'),
  '(?<![0-9])[0-9](?:[ -]?[0-9]){12,18}(?![0-9])','[CARD]','g'),
  '(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])','[AADHAAR]','g'),
  '(?<![0-9])(?:\+?91[ -]?)?[6-9][0-9]{4}[ -]?[0-9]{5}(?![0-9])','[PHONE]','g')
$$;
create function recording_norm(p text) returns text language sql immutable parallel safe set search_path=pg_catalog as $$
 select btrim(regexp_replace(translate(lower(coalesce(p,'')),'!"#$%&''()*+,-./:;<=>?@[\]^_`{|}~',''),'\s+',' ','g'))
$$;

create function recording_valid_rubric_dimensions(p jsonb) returns boolean language sql immutable set search_path=pg_catalog as $$
 select jsonb_typeof(p)='array' and jsonb_array_length(p) between 1 and 12
  and not exists(select 1 from jsonb_array_elements(p) d where jsonb_typeof(d)<>'object'
   or not (d ? 'key' and d ? 'label' and d ? 'weight')
   or exists(select 1 from jsonb_object_keys(d) k where k not in ('key','label','weight','description'))
   or jsonb_typeof(d->'key')<>'string' or (d->>'key') !~ '^[a-z][a-z0-9_]{1,39}$'
   or jsonb_typeof(d->'label')<>'string' or length(d->>'label') not between 1 and 80
   or jsonb_typeof(d->'weight')<>'number' or (d->>'weight')::numeric<>trunc((d->>'weight')::numeric) or (d->>'weight')::numeric not between 1 and 100
   or (d ? 'description' and (jsonb_typeof(d->'description')<>'string' or length(d->>'description')>500)))
  and (select count(distinct d->>'key') from jsonb_array_elements(p) d)=jsonb_array_length(p)
  and (select sum((d->>'weight')::numeric) from jsonb_array_elements(p) d)=100
$$;

create function recording_valid_sop_clauses(p jsonb) returns boolean language sql immutable set search_path=pg_catalog as $$
 select jsonb_typeof(p)='array' and jsonb_array_length(p) between 1 and 500
  and not exists(select 1 from jsonb_array_elements(p) c where jsonb_typeof(c)<>'object'
   or not (c ? 'clause_id' and c ? 'topic' and c ? 'text')
   or exists(select 1 from jsonb_object_keys(c) k where k not in ('clause_id','topic','title','text'))
   or jsonb_typeof(c->'clause_id')<>'string' or (c->>'clause_id') !~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'
   or jsonb_typeof(c->'topic')<>'string' or (c->>'topic') not in ('making_charges','gold_knowledge','diamond_knowledge','certification','old_gold_exchange','buyback','sales_script','objections','hospitality','other')
   or jsonb_typeof(c->'text')<>'string' or length(c->>'text') not between 1 and 4000
   or (c ? 'title' and (jsonb_typeof(c->'title')<>'string' or length(c->>'title')>200)))
  and (select count(distinct c->>'clause_id') from jsonb_array_elements(p) c)=jsonb_array_length(p)
$$;

-- The one score formula. packages/core/src/salesScore/score.ts mirrors it exactly.
-- total = 10 * Σ(rating*weight) / assessed_weight, over assessed dimensions only.
create function recording_compute_score(p_dims jsonb,p_rubric jsonb,p_min_assessed numeric) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare assessed numeric:=0; weighted numeric:=0; d jsonb; r jsonb; w numeric; rating numeric; out_dims jsonb:='[]'::jsonb; st text; begin
 for r in select value from jsonb_array_elements(p_rubric) loop
  select value into d from jsonb_array_elements(p_dims) where value->>'key'=r->>'key' limit 1;
  if d is null then raise exception 'recording_dimension_missing' using errcode='22023'; end if;
  if (d->>'status')='assessed' then assessed:=assessed+(r->>'weight')::numeric; weighted:=weighted+(d->>'rating')::numeric*(r->>'weight')::numeric; end if;
 end loop;
 st:=case when assessed>0 and assessed>=p_min_assessed then 'scored'::text else 'insufficient_evidence'::text end;
 for r in select value from jsonb_array_elements(p_rubric) loop
  select value into d from jsonb_array_elements(p_dims) where value->>'key'=r->>'key' limit 1;
  w:=(r->>'weight')::numeric; rating:=case when d->>'status'='assessed' then (d->>'rating')::numeric end;
  out_dims:=out_dims||jsonb_build_array(jsonb_build_object('key',r->>'key','configured_weight',w,
   'effective_weight',case when st='scored' and rating is not null then round(w*100/assessed,4) end,
   'points',case when st='scored' and rating is not null then round(rating*w*10/assessed,4) end));
 end loop;
 return jsonb_build_object('status',st,'assessed_weight',assessed,'raw_total',case when st='scored' then round(weighted*10/assessed,2) end,'dimensions',out_dims);
end $$;

create function recording_default_rubric_dimensions() returns jsonb language sql immutable set search_path=pg_catalog as $$
 select '[
  {"key":"greeting_sop","label":"Greeting & SOP","weight":15,"description":"Welcome, introduction, hospitality and the MK Jewels opening steps."},
  {"key":"product_knowledge","label":"Product Knowledge","weight":20,"description":"Accurate gold, diamond, purity, certification, making-charge and design facts."},
  {"key":"needs_discovery","label":"Needs Discovery & Listening","weight":15,"description":"Asks about occasion, budget, preferences and listens before recommending."},
  {"key":"objection_handling","label":"Objection Handling","weight":15,"description":"Responds to clear customer resistance. Not applicable when no objection was raised."},
  {"key":"pricing_value","label":"Pricing & Value Communication","weight":10,"description":"Explains price, making charges, exchange and value transparently. A price question is not an objection."},
  {"key":"closing_follow_up","label":"Closing & Follow-up","weight":15,"description":"Moves toward a decision or agrees a concrete next step."},
  {"key":"personalization_empathy","label":"Personalization & Empathy","weight":10,"description":"Adapts to the customer; a different but working style is not a failure."}
 ]'::jsonb
$$;

-- ---------------------------------------------------------------------------
create table recording_sop_versions (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),version integer not null check(version>0),
 status text not null default 'draft' check(status in ('draft','approved','retired')),title text not null check(length(title) between 1 and 200),
 clauses jsonb not null check(recording_valid_sop_clauses(clauses)),content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
 created_by uuid not null references user_profiles(id),created_at timestamptz not null default now(),
 approved_by uuid references user_profiles(id),approved_at timestamptz,
 unique(tenant_id,version),unique(id,tenant_id),check((status='draft')=(approved_by is null)),check((approved_by is null)=(approved_at is null))
);
create table recording_rubric_versions (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),version integer not null check(version>0),
 status text not null default 'draft' check(status in ('draft','active','retired')),name text not null check(length(name) between 1 and 120),
 dimensions jsonb not null check(recording_valid_rubric_dimensions(dimensions)),min_assessed_weight numeric(5,2) not null default 50 check(min_assessed_weight between 1 and 100),
 created_by uuid references user_profiles(id),created_at timestamptz not null default now(),activated_by uuid references user_profiles(id),activated_at timestamptz,
 unique(tenant_id,version),unique(id,tenant_id)
);
create unique index recording_rubric_one_active on recording_rubric_versions(tenant_id) where status='active';

create table recording_transcript_revisions (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),session_id uuid not null references recorder_sessions(id),
 revision integer not null check(revision>0),source text not null check(source in ('machine','manual_correction')),
 base_revision_id uuid references recording_transcript_revisions(id),
 stt_provider text check(length(stt_provider)<=80),stt_model text check(length(stt_model)<=120),diarization_provider text check(length(diarization_provider)<=120),
 created_by uuid references user_profiles(id),reason text check(length(reason) between 1 and 500),content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),unique(session_id,revision),unique(id,session_id),
 check(source='machine' or (created_by is not null and base_revision_id is not null and reason is not null))
);
create table recording_transcript_segments (
 revision_id uuid not null,session_id uuid not null,segment_id uuid not null,ordinal integer not null check(ordinal>=0),
 source_sequence integer not null check(source_sequence between 0 and 7200),source_offset_ms integer not null check(source_offset_ms between 0 and 120000),
 start_ms integer not null check(start_ms between 0 and 14400000),end_ms integer not null check(end_ms>=start_ms and end_ms<=14400000),
 speaker text not null default 'unknown' check(speaker in ('employee','customer','unknown')),speaker_confidence numeric(4,3) check(speaker_confidence between 0 and 1),
 speaker_source text not null default 'none' check(speaker_source in ('diarization','manual','none')),
 language text check(language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
 raw_text text not null check(octet_length(raw_text)<=16384),display_text text check(octet_length(display_text)<=16384),translation_en text check(octet_length(translation_en)<=16384),
 stt_confidence numeric(4,3) check(stt_confidence between 0 and 1),
 primary key(revision_id,segment_id),unique(revision_id,ordinal),
 foreign key(revision_id,session_id) references recording_transcript_revisions(id,session_id),
 -- Never attribute words to a person on a weak guess.
 check(speaker='unknown' or speaker_source='manual' or (speaker_source='diarization' and speaker_confidence>=0.85)),
 check(speaker<>'unknown' or speaker_source<>'diarization' or speaker_confidence is not null)
);
create index recording_segments_session on recording_transcript_segments(session_id,revision_id,start_ms);

create table recording_analysis_jobs (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),session_id uuid not null references recorder_sessions(id),
 transcript_revision_id uuid not null,rubric_version_id uuid not null references recording_rubric_versions(id),sop_version_id uuid references recording_sop_versions(id),
 job_version text not null check(job_version ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
 reason text not null check(reason in ('initial','reprocess','rescore')),requested_by uuid references user_profiles(id),request_note text check(length(request_note)<=500),
 state text not null default 'pending' check(state in ('pending','leased','done','dead')),attempts integer not null default 0 check(attempts between 0 and 20),
 max_attempts integer not null default 5 check(max_attempts between 1 and 20),available_at timestamptz not null default now(),
 worker_id uuid,lease_token uuid,lease_until timestamptz,error_code text check(error_code ~ '^[a-z_]{1,64}$'),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),started_at timestamptz,finished_at timestamptz,
 foreign key(transcript_revision_id,session_id) references recording_transcript_revisions(id,session_id),
 unique nulls not distinct (transcript_revision_id,rubric_version_id,sop_version_id,job_version),
 check((state='leased')=(lease_token is not null and lease_until is not null and worker_id is not null))
);
create index recording_analysis_job_claim on recording_analysis_jobs(state,available_at,created_at);

create table recording_analyses (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),session_id uuid not null references recorder_sessions(id),
 job_id uuid not null unique references recording_analysis_jobs(id),transcript_revision_id uuid not null,
 rubric_version_id uuid not null references recording_rubric_versions(id),sop_version_id uuid references recording_sop_versions(id),job_version text not null,
 analyzer_provider text not null check(length(analyzer_provider) between 1 and 80),analyzer_model text not null check(length(analyzer_model) between 1 and 120),
 prompt_version text not null check(prompt_version ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
 fallback_used boolean not null default false,fallback_reason text check(fallback_reason ~ '^[a-z_]{1,64}$'),
 status text not null check(status in ('scored','needs_review','insufficient_evidence')),status_reasons text[] not null default '{}',
 raw_total numeric(5,2) check(raw_total between 0 and 100),assessed_weight numeric(5,2) not null check(assessed_weight between 0 and 100),
 output jsonb not null check(jsonb_typeof(output)='object'),quality jsonb not null check(jsonb_typeof(quality)='object'),
 supersedes_id uuid references recording_analyses(id),created_at timestamptz not null default now(),
 foreign key(transcript_revision_id,session_id) references recording_transcript_revisions(id,session_id),
 check(fallback_used=(fallback_reason is not null)),check((status='insufficient_evidence')=(raw_total is null))
);
create index recording_analyses_session on recording_analyses(session_id,created_at);
create table recording_score_dimensions (
 analysis_id uuid not null references recording_analyses(id),dimension_key text not null,label text not null,
 configured_weight numeric(5,2) not null,effective_weight numeric(7,4),points numeric(7,4),
 status text not null check(status in ('assessed','not_applicable','insufficient_evidence')),rating integer check(rating between 0 and 10),
 reason text not null check(length(reason) between 1 and 600),evidence jsonb not null default '[]' check(jsonb_typeof(evidence)='array'),
 primary key(analysis_id,dimension_key),check((status='assessed')=(rating is not null)),check(status<>'assessed' or jsonb_array_length(evidence)>0)
);
create table recording_analysis_reviews (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),session_id uuid not null references recorder_sessions(id),
 analysis_id uuid not null references recording_analyses(id),actor_id uuid not null references user_profiles(id),
 action text not null check(action in ('approve','flag','unflag','edit','comment')),note text check(length(note) between 1 and 2000),
 dimension_overrides jsonb check(dimension_overrides is null or jsonb_typeof(dimension_overrides)='array'),
 reviewed_status text check(reviewed_status in ('scored','insufficient_evidence')),reviewed_total numeric(5,2) check(reviewed_total between 0 and 100),
 created_at timestamptz not null default now(),
 check((action='edit')=(dimension_overrides is not null)),check(action not in ('flag','edit','comment') or note is not null)
);
create index recording_reviews_analysis on recording_analysis_reviews(analysis_id,created_at);

-- Immutable history. Only the reviewed version-status columns and the retention
-- path (transaction-local flag set by analysis_reconcile) may change rows.
create function recording_immutable() returns trigger language plpgsql set search_path=public as $$ begin
 if coalesce(current_setting('recording.retention',true),'')='on' then return case when tg_op='DELETE' then old else new end; end if;
 if tg_op='UPDATE' then
  -- Field references are resolved per table, so each branch is separate.
  if tg_table_name='recording_analysis_jobs' then
   if (new.session_id,new.transcript_revision_id,new.rubric_version_id,new.sop_version_id,new.job_version,new.reason)
    is not distinct from (old.session_id,old.transcript_revision_id,old.rubric_version_id,old.sop_version_id,old.job_version,old.reason) then return new; end if;
  elsif tg_table_name='recording_rubric_versions' then
   if (new.dimensions,new.name,new.min_assessed_weight,new.version,new.tenant_id) is not distinct from (old.dimensions,old.name,old.min_assessed_weight,old.version,old.tenant_id) then return new; end if;
  elsif tg_table_name='recording_sop_versions' then
   if (new.clauses,new.title,new.version,new.tenant_id,new.content_sha256) is not distinct from (old.clauses,old.title,old.version,old.tenant_id,old.content_sha256) then return new; end if;
  end if;
 end if;
 raise exception 'recording_history_immutable' using errcode='42501';
end $$;
do $$ declare t text; begin foreach t in array array['recording_sop_versions','recording_rubric_versions','recording_transcript_revisions','recording_transcript_segments','recording_analysis_jobs','recording_analyses','recording_score_dimensions','recording_analysis_reviews'] loop
 execute format('create trigger %I before update or delete on %I for each row execute function recording_immutable()',t||'_immutable',t);
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 execute format('create policy module_accessible on %I as restrictive for select to authenticated using (public.module_accessible(''sales_recording'',false))',t);
end loop; end $$;
-- Reads go through the snapshot RPC; no direct table grants to the browser.

-- Seed MK Sales Score v1 for existing tenants (system-authored, active).
insert into recording_rubric_versions(tenant_id,version,status,name,dimensions,activated_at)
 select id,1,'active','MK Sales Score v1',recording_default_rubric_dimensions(),now() from tenants on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Actor helpers.
create function recording_is_reviewer(s recorder_sessions) returns boolean language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); begin
 return coalesce(a.id is not null and current_profile_is_active() and module_accessible('sales_recording') and a.tenant_id=s.tenant_id and a.branch_id=s.branch_id
  and a.user_role in ('super_admin','admin','manager') and has_permission('recording.review'),false);
end $$;
create function recording_session_for_review(p_session_id uuid) returns recorder_sessions language plpgsql security definer set search_path=public as $$
declare s recorder_sessions; begin
 perform recorder_actor();
 select * into s from recorder_sessions where id=p_session_id for update;
 if s.id is null or not recording_is_reviewer(s) then raise exception 'recording_review_denied' using errcode='42501'; end if;
 if s.expires_at<=now() then raise exception 'recording_retention_expired' using errcode='22023'; end if;
 return s;
end $$;
create function recording_rubric_manager() returns user_profiles language plpgsql security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); begin
 if a.user_role not in ('super_admin','admin') or not has_permission('recording.manage_rubric') then raise exception 'recording_rubric_denied' using errcode='42501'; end if;
 return a;
end $$;

create function recording_active_rubric(p_tenant uuid) returns recording_rubric_versions language plpgsql security definer set search_path=public as $$
declare r recording_rubric_versions; begin
 select * into r from recording_rubric_versions where tenant_id=p_tenant and status='active';
 if r.id is null and not exists(select 1 from recording_rubric_versions where tenant_id=p_tenant) then
  insert into recording_rubric_versions(tenant_id,version,status,name,dimensions,activated_at) values(p_tenant,1,'active','MK Sales Score v1',recording_default_rubric_dimensions(),now()) on conflict do nothing;
  select * into r from recording_rubric_versions where tenant_id=p_tenant and status='active';
 end if;
 return r;
end $$;

create function recording_enqueue_analysis(s recorder_sessions,p_revision uuid,p_rubric uuid,p_sop uuid,p_job_version text,p_reason text,p_actor uuid,p_note text)
returns recording_analysis_jobs language plpgsql security definer set search_path=public as $$
declare j recording_analysis_jobs; begin
 if (select count(*) from recording_analysis_jobs where state in ('pending','leased'))>=5000 then raise exception 'recording_queue_full' using errcode='54000'; end if;
 insert into recording_analysis_jobs(tenant_id,session_id,transcript_revision_id,rubric_version_id,sop_version_id,job_version,reason,requested_by,request_note)
  values(s.tenant_id,s.id,p_revision,p_rubric,p_sop,p_job_version,p_reason,p_actor,p_note) on conflict do nothing returning * into j;
 if j.id is null then
  select * into j from recording_analysis_jobs where transcript_revision_id=p_revision and rubric_version_id=p_rubric and sop_version_id is not distinct from p_sop and job_version=p_job_version;
 end if;
 return j;
end $$;

-- ---------------------------------------------------------------------------
-- Evidence and output validation (worker output is untrusted).
create function recording_evidence_ok(p_revision uuid,p_refs jsonb,p_min integer,p_max integer) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_typeof(p_refs)='array' and jsonb_array_length(p_refs) between p_min and p_max
  and not exists(select 1 from jsonb_array_elements(p_refs) e where coalesce(jsonb_typeof(e)<>'object'
   or exists(select 1 from jsonb_object_keys(e) k where k not in ('segment_id','quote'))
   or jsonb_typeof(e->'segment_id')<>'string' or (e->>'segment_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(e->'quote')<>'string' or length(recording_norm(e->>'quote')) not between 3 and 500
   or not exists(select 1 from recording_transcript_segments g where g.revision_id=p_revision and g.segment_id=(e->>'segment_id')::uuid
    and (position(recording_norm(e->>'quote') in recording_norm(g.raw_text))>0 or position(recording_norm(e->>'quote') in recording_norm(recording_redact(g.raw_text)))>0
     or position(recording_norm(e->>'quote') in recording_norm(g.display_text))>0 or position(recording_norm(e->>'quote') in recording_norm(recording_redact(g.display_text)))>0
     or position(recording_norm(e->>'quote') in recording_norm(g.translation_en))>0 or position(recording_norm(e->>'quote') in recording_norm(recording_redact(g.translation_en)))>0)),true)),false)
$$;
create function recording_keys_ok(p jsonb,p_allowed text[],p_required text[]) returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(p)='object' and not exists(select 1 from jsonb_object_keys(p) k where not k=any(p_allowed)) and p ?& p_required,false)
$$;
create function recording_claims_ok(p_revision uuid,p jsonb,p_min integer,p_max integer) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_typeof(p)='array' and jsonb_array_length(p) between p_min and p_max
  and not exists(select 1 from jsonb_array_elements(p) c where coalesce(not recording_keys_ok(c,array['text','evidence'],array['text','evidence'])
   or jsonb_typeof(c->'text')<>'string' or length(c->>'text') not between 1 and 400 or not recording_evidence_ok(p_revision,c->'evidence',1,5),true)),false)
$$;
create function recording_output_ok(p_revision uuid,o jsonb,p_sop recording_sop_versions) returns boolean language plpgsql stable security definer set search_path=public as $$
declare k text; sig jsonb; begin
 if not recording_keys_ok(o,array['summary','key_points','product_interests','customer_requirements','customer_concerns','competitor_mentions','purchase_blockers','coaching_strengths','coaching_gaps','coaching_interventions','next_best_actions','signals','policy_findings','analyzer_confidence'],
   array['summary','key_points','product_interests','customer_requirements','customer_concerns','competitor_mentions','purchase_blockers','coaching_strengths','coaching_gaps','coaching_interventions','next_best_actions','signals','policy_findings','analyzer_confidence']) then return false; end if;
 if jsonb_typeof(o->'summary')<>'string' or length(o->>'summary') not between 1 and 600 then return false; end if;
 if jsonb_typeof(o->'analyzer_confidence')<>'number' or (o->>'analyzer_confidence')::numeric not between 0 and 1 then return false; end if;
 if not (recording_claims_ok(p_revision,o->'key_points',3,5) and recording_claims_ok(p_revision,o->'product_interests',0,10) and recording_claims_ok(p_revision,o->'customer_concerns',0,10)
  and recording_claims_ok(p_revision,o->'competitor_mentions',0,10) and recording_claims_ok(p_revision,o->'purchase_blockers',0,10)
  and recording_claims_ok(p_revision,o->'coaching_strengths',0,5) and recording_claims_ok(p_revision,o->'coaching_gaps',0,5)) then return false; end if;
 if not recording_keys_ok(o->'customer_requirements',array['budget','occasion','requirements'],array['budget','occasion','requirements'])
  or not recording_claims_ok(p_revision,o->'customer_requirements'->'requirements',0,10)
  or not (jsonb_typeof(o->'customer_requirements'->'budget')='null' or recording_claims_ok(p_revision,jsonb_build_array(o->'customer_requirements'->'budget'),1,1))
  or not (jsonb_typeof(o->'customer_requirements'->'occasion')='null' or recording_claims_ok(p_revision,jsonb_build_array(o->'customer_requirements'->'occasion'),1,1)) then return false; end if;
 if jsonb_typeof(o->'coaching_interventions')<>'array' or jsonb_array_length(o->'coaching_interventions') not between 1 and 3
  or exists(select 1 from jsonb_array_elements(o->'coaching_interventions') x where not recording_keys_ok(x,array['text','reason','evidence'],array['text','reason','evidence'])
   or jsonb_typeof(x->'text')<>'string' or length(x->>'text') not between 1 and 400 or jsonb_typeof(x->'reason')<>'string' or length(x->>'reason') not between 1 and 400
   or not recording_evidence_ok(p_revision,x->'evidence',1,5)) then return false; end if;
 if jsonb_typeof(o->'next_best_actions')<>'array' or jsonb_array_length(o->'next_best_actions')>5
  or exists(select 1 from jsonb_array_elements(o->'next_best_actions') x where not recording_keys_ok(x,array['action','reason','evidence'],array['action','reason','evidence'])
   or jsonb_typeof(x->'action')<>'string' or length(x->>'action') not between 1 and 300 or jsonb_typeof(x->'reason')<>'string' or length(x->>'reason') not between 1 and 400
   or not recording_evidence_ok(p_revision,x->'evidence',1,5)) then return false; end if;
 sig:=o->'signals';
 if not recording_keys_ok(sig,array['objection','price_concern','stock_gap','competitor_mention','customer_questions','conversion_signal','next_step','drop_off','upsell_opportunity','sales_outcome'],
   array['objection','price_concern','stock_gap','competitor_mention','customer_questions','conversion_signal','next_step','drop_off','upsell_opportunity','sales_outcome']) then return false; end if;
 foreach k in array array['objection','price_concern','stock_gap','competitor_mention','customer_questions','conversion_signal','next_step','drop_off','upsell_opportunity'] loop
  if not recording_keys_ok(sig->k,array['detected','confidence','reason','evidence'],array['detected','confidence','reason','evidence'])
   or jsonb_typeof(sig->k->'detected')<>'boolean' or jsonb_typeof(sig->k->'confidence')<>'number' or (sig->k->>'confidence')::numeric not between 0 and 1
   or jsonb_typeof(sig->k->'reason')<>'string' or length(sig->k->>'reason') not between 1 and 300
   or not recording_evidence_ok(p_revision,sig->k->'evidence',case when (sig->k->>'detected')::boolean then 1 else 0 end,5) then return false; end if;
 end loop;
 if not recording_keys_ok(sig->'sales_outcome',array['value','confidence','reason','evidence'],array['value','confidence','reason','evidence'])
  or (sig->'sales_outcome'->>'value') not in ('unknown','enquiry','follow_up','reported_purchase','no_purchase')
  or jsonb_typeof(sig->'sales_outcome'->'confidence')<>'number' or (sig->'sales_outcome'->>'confidence')::numeric not between 0 and 1
  or jsonb_typeof(sig->'sales_outcome'->'reason')<>'string' or length(sig->'sales_outcome'->>'reason') not between 1 and 300
  or not recording_evidence_ok(p_revision,sig->'sales_outcome'->'evidence',case when sig->'sales_outcome'->>'value'='unknown' then 0 else 1 end,5) then return false; end if;
 if jsonb_typeof(o->'policy_findings')<>'array' or jsonb_array_length(o->'policy_findings')>10 then return false; end if;
 if jsonb_array_length(o->'policy_findings')>0 and p_sop.id is null then return false; end if;
 if exists(select 1 from jsonb_array_elements(o->'policy_findings') f where not recording_keys_ok(f,array['severity','clause_id','statement','evidence'],array['severity','clause_id','statement','evidence'])
   or (f->>'severity') not in ('low','medium','high') or jsonb_typeof(f->'statement')<>'string' or length(f->>'statement') not between 1 and 400
   or not exists(select 1 from jsonb_array_elements(p_sop.clauses) c where c->>'clause_id'=f->>'clause_id')
   or not recording_evidence_ok(p_revision,f->'evidence',1,5)
   -- HIGH needs concrete contradictory words from a verified employee speaker.
   or (f->>'severity'='high' and exists(select 1 from jsonb_array_elements(f->'evidence') e where not exists(
     select 1 from recording_transcript_segments g where g.revision_id=p_revision and g.segment_id=(e->>'segment_id')::uuid and g.speaker='employee')))) then return false; end if;
 return true;
end $$;

-- Durable quality facts the status rules read (not model claims).
create function recording_revision_quality(p_revision uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'words',coalesce(sum(array_length(regexp_split_to_array(btrim(raw_text),'\s+'),1)) filter (where btrim(raw_text)<>''),0),
  'spoken_segments',count(*) filter (where btrim(raw_text)<>''),
  'mean_stt_confidence',round(avg(stt_confidence) filter (where btrim(raw_text)<>''),3),
  'unknown_speaker_share',case when coalesce(sum(end_ms-start_ms) filter (where btrim(raw_text)<>''),0)=0 then null
   else round((sum(end_ms-start_ms) filter (where btrim(raw_text)<>'' and speaker='unknown'))::numeric/sum(end_ms-start_ms) filter (where btrim(raw_text)<>''),3) end)
 from recording_transcript_segments where revision_id=p_revision
$$;

-- ---------------------------------------------------------------------------
-- Service boundary for the worker (called only by recorder-ingest with service_role).
create function recording_analysis_ingest(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s recorder_sessions; rj recorder_jobs; c recorder_config; rev recording_transcript_revisions; prev recording_transcript_revisions; j recording_analysis_jobs;
 r recording_rubric_versions; sop recording_sop_versions; an recording_analyses; segs jsonb; hash text; q jsonb; sc jsonb; res jsonb; dims jsonb; d jsonb; rd jsonb;
 st text; reasons text[]; wid uuid; n integer; prior uuid; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'recording_service_only' using errcode='42501'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>4194304 then raise exception 'recording_invalid_payload' using errcode='22023'; end if;

 if p_action='transcript_finalize' then
  select * into s from recorder_sessions where id=(p_payload->>'session_id')::uuid for update;
  if s.id is null or s.device_id::text is distinct from p_payload->>'device_id' or s.employee_id::text is distinct from p_payload->>'employee_id'
   or s.tenant_id::text is distinct from p_payload->>'tenant_id' or s.branch_id::text is distinct from p_payload->>'branch_id' or s.expires_at<=now() then
   raise exception 'recording_scope_denied' using errcode='42501'; end if;
  select * into rj from recorder_jobs where id=(p_payload->>'job_id')::uuid and session_id=s.id and kind='final' and state='leased'
   and worker_id::text=p_payload->>'worker_id' and lease_token::text=p_payload->>'lease_token' and lease_until>clock_timestamp();
  if rj.id is null then raise exception 'recording_job_lease_denied' using errcode='42501'; end if;
  segs:=p_payload->'segments';
  if jsonb_typeof(segs)<>'array' or jsonb_array_length(segs)>20000 then raise exception 'recording_invalid_transcript' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(segs) g where jsonb_typeof(g)<>'object'
   or exists(select 1 from jsonb_object_keys(g) k where k not in ('segment_id','source_sequence','source_offset_ms','start_ms','end_ms','speaker','speaker_confidence','speaker_source','language','raw_text','display_text','translation_en','stt_confidence'))
   or (g->>'source_sequence')::integer not between 0 and coalesce(s.last_sequence,-1)
   or not exists(select 1 from recorder_chunks ch where ch.session_id=s.id and ch.sequence=(g->>'source_sequence')::integer)) then
   raise exception 'recording_invalid_transcript' using errcode='22023'; end if;
  hash:=encode(digest(jsonb_build_object('segments',segs,'stt_provider',p_payload->'stt_provider','stt_model',p_payload->'stt_model','diarization_provider',p_payload->'diarization_provider')::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(s.id::text,7));
  select * into prev from recording_transcript_revisions where session_id=s.id and source='machine' order by revision desc limit 1;
  if prev.id is not null and prev.content_sha256=hash then
   return jsonb_build_object('revision_id',prev.id,'revision',prev.revision,'created',false);
  end if;
  insert into recording_transcript_revisions(tenant_id,session_id,revision,source,base_revision_id,stt_provider,stt_model,diarization_provider,content_sha256)
   values(s.tenant_id,s.id,coalesce((select max(revision) from recording_transcript_revisions where session_id=s.id),0)+1,'machine',prev.id,
    left(p_payload->>'stt_provider',80),left(p_payload->>'stt_model',120),left(p_payload->>'diarization_provider',120),hash) returning * into rev;
  begin
   insert into recording_transcript_segments(revision_id,session_id,segment_id,ordinal,source_sequence,source_offset_ms,start_ms,end_ms,speaker,speaker_confidence,speaker_source,language,raw_text,display_text,translation_en,stt_confidence)
    select rev.id,s.id,(g->>'segment_id')::uuid,(o-1)::integer,(g->>'source_sequence')::integer,coalesce((g->>'source_offset_ms')::integer,0),(g->>'start_ms')::integer,(g->>'end_ms')::integer,
     coalesce(g->>'speaker','unknown'),(g->>'speaker_confidence')::numeric,coalesce(g->>'speaker_source','none'),g->>'language',coalesce(g->>'raw_text',''),g->>'display_text',g->>'translation_en',(g->>'stt_confidence')::numeric
    from jsonb_array_elements(segs) with ordinality x(g,o);
  exception when check_violation or not_null_violation or unique_violation or invalid_text_representation or numeric_value_out_of_range then
   raise exception 'recording_invalid_transcript' using errcode='22023';
  end;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(s.tenant_id,null,'recording_transcript_finalized','sales_recording',s.id,
   jsonb_build_object('revision',rev.revision,'segments',jsonb_array_length(segs),'stt_provider',rev.stt_provider,'stt_model',rev.stt_model));
  select * into c from recorder_config where tenant_id=s.tenant_id;
  if coalesce(c.analysis_enabled,false) then
   r:=recording_active_rubric(s.tenant_id);
   select * into sop from recording_sop_versions where tenant_id=s.tenant_id and status='approved' order by version desc limit 1;
   if r.id is not null then j:=recording_enqueue_analysis(s,rev.id,r.id,sop.id,c.analysis_job_version,case when prev.id is null then 'initial' else 'reprocess' end,null,null); end if;
  end if;
  return jsonb_build_object('revision_id',rev.id,'revision',rev.revision,'created',true,'analysis_job_id',j.id);

 elsif p_action='analysis_claim' then
  wid:=(p_payload->>'worker_id')::uuid;
  if wid is null then raise exception 'recording_invalid_worker' using errcode='22023'; end if;
  select * into j from recording_analysis_jobs q where q.state='pending' and q.available_at<=now()
   and not exists(select 1 from recording_analysis_jobs o where o.session_id=q.session_id and o.state='leased')
   and exists(select 1 from recorder_sessions x where x.id=q.session_id and x.expires_at>now())
   order by q.available_at,q.created_at for update skip locked limit 1;
  if j.id is null then return jsonb_build_object('job',null); end if;
  perform pg_advisory_xact_lock(hashtextextended(j.session_id::text,8));
  if exists(select 1 from recording_analysis_jobs where session_id=j.session_id and state='leased') then return jsonb_build_object('job',null); end if;
  update recording_analysis_jobs set state='leased',worker_id=wid,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,
   started_at=coalesce(started_at,now()),updated_at=now() where id=j.id returning * into j;
  select * into r from recording_rubric_versions where id=j.rubric_version_id;
  select * into sop from recording_sop_versions where id=j.sop_version_id;
  -- Data minimisation: no names, phone numbers or CRM identifiers leave the database.
  return jsonb_build_object('job',jsonb_build_object('id',j.id,'session_id',j.session_id,'lease_token',j.lease_token,'worker_id',j.worker_id,'attempts',j.attempts,
   'job_version',j.job_version,'reason',j.reason,'transcript_revision_id',j.transcript_revision_id,
   'rubric',jsonb_build_object('id',r.id,'version',r.version,'dimensions',r.dimensions,'min_assessed_weight',r.min_assessed_weight),
   'sop',case when sop.id is null then null else jsonb_build_object('id',sop.id,'version',sop.version,'title',sop.title,'clauses',sop.clauses) end,
   'quality',recording_revision_quality(j.transcript_revision_id),
   'segments',coalesce((select jsonb_agg(jsonb_build_object('segment_id',g.segment_id,'ordinal',g.ordinal,'start_ms',g.start_ms,'end_ms',g.end_ms,'speaker',g.speaker,
     'language',g.language,'raw_text',g.raw_text,'display_text',g.display_text,'translation_en',g.translation_en,'stt_confidence',g.stt_confidence) order by g.ordinal)
    from recording_transcript_segments g where g.revision_id=j.transcript_revision_id),'[]'::jsonb)));

 elsif p_action in ('analysis_submit','analysis_fail') then
  select * into j from recording_analysis_jobs where id=(p_payload->>'job_id')::uuid for update;
  if j.id is not null and j.state='done' and p_action='analysis_submit' then
   select id into prior from recording_analyses where job_id=j.id;
   return jsonb_build_object('accepted',false,'analysis_id',prior);  -- lost-ACK replay
  end if;
  if j.id is null or j.state<>'leased' or j.worker_id::text is distinct from p_payload->>'worker_id' or j.lease_token::text is distinct from p_payload->>'lease_token' or j.lease_until<=now() then
   raise exception 'recording_job_lease_denied' using errcode='42501'; end if;
  if p_action='analysis_fail' then
   if coalesce(p_payload->>'error_code','') !~ '^[a-z_]{1,64}$' then raise exception 'recording_invalid_payload' using errcode='22023'; end if;
   update recording_analysis_jobs set state=case when attempts>=max_attempts or (p_payload->>'retryable')='false' then 'dead' else 'pending' end,
    available_at=now()+make_interval(secs=>least(900,10*(2^attempts)::integer)),lease_token=null,lease_until=null,worker_id=null,error_code=p_payload->>'error_code',
    updated_at=now(),finished_at=case when attempts>=max_attempts or (p_payload->>'retryable')='false' then now() end where id=j.id returning * into j;
   return jsonb_build_object('job',jsonb_build_object('id',j.id,'state',j.state,'attempts',j.attempts,'error_code',j.error_code));
  end if;
  res:=p_payload->'result';
  select * into r from recording_rubric_versions where id=j.rubric_version_id;
  select * into sop from recording_sop_versions where id=j.sop_version_id;
  q:=recording_revision_quality(j.transcript_revision_id);
  if not recording_keys_ok(res,array['status_hint','analyzer','output','dimensions'],array['status_hint','analyzer','output','dimensions'])
   or (res->>'status_hint') not in ('scored','insufficient_evidence')
   or not recording_keys_ok(res->'analyzer',array['provider','model','prompt_version','fallback_used','fallback_reason'],array['provider','model','prompt_version','fallback_used','fallback_reason'])
   or jsonb_typeof(res->'analyzer'->'fallback_used')<>'boolean'
   or ((res->'analyzer'->>'fallback_used')::boolean<>(jsonb_typeof(res->'analyzer'->'fallback_reason')='string')) then
   raise exception 'recording_invalid_analysis' using errcode='22023'; end if;
  reasons:='{}';
  if (q->>'words')::integer<25 or (q->>'spoken_segments')::integer<2 then reasons:=reasons||'too_little_speech'::text; end if;
  if res->>'status_hint'='insufficient_evidence' then reasons:=reasons||'analyzer_insufficient'::text; end if;
  if cardinality(reasons)>0 then
   st:='insufficient_evidence'; dims:='[]';
   if jsonb_typeof(res->'output')<>'object' then raise exception 'recording_invalid_analysis' using errcode='22023'; end if;
   if res->'output'<>'{}'::jsonb and not recording_output_ok(j.transcript_revision_id,res->'output',sop) then raise exception 'recording_invalid_analysis' using errcode='22023'; end if;
  else
   if not recording_output_ok(j.transcript_revision_id,res->'output',sop) then raise exception 'recording_invalid_analysis' using errcode='22023'; end if;
   dims:=res->'dimensions';
   if jsonb_typeof(dims)<>'array' or jsonb_array_length(dims)<>jsonb_array_length(r.dimensions)
    or exists(select 1 from jsonb_array_elements(r.dimensions) rd2 where (select count(*) from jsonb_array_elements(dims) x where x->>'key'=rd2->>'key')<>1)
    or exists(select 1 from jsonb_array_elements(dims) x where not recording_keys_ok(x,array['key','status','rating','reason','evidence'],array['key','status','rating','reason','evidence'])
     or (x->>'status') not in ('assessed','not_applicable','insufficient_evidence')
     or (x->>'status'='assessed' and (jsonb_typeof(x->'rating')<>'number' or (x->>'rating')::numeric<>trunc((x->>'rating')::numeric) or (x->>'rating')::numeric not between 0 and 10))
     or (x->>'status'<>'assessed' and jsonb_typeof(x->'rating')<>'null')
     or jsonb_typeof(x->'reason')<>'string' or length(x->>'reason') not between 1 and 600
     or not recording_evidence_ok(j.transcript_revision_id,x->'evidence',case when x->>'status'='assessed' then 1 else 0 end,5)) then
    raise exception 'recording_invalid_analysis' using errcode='22023'; end if;
   sc:=recording_compute_score(dims,r.dimensions,r.min_assessed_weight);
   if sc->>'status'='insufficient_evidence' then st:='insufficient_evidence'; reasons:=reasons||'too_little_assessed_weight'::text;
   else
    if (q->>'mean_stt_confidence')::numeric<0.6 then reasons:=reasons||'low_stt_confidence'::text; end if;
    if (q->>'unknown_speaker_share')::numeric>0.5 then reasons:=reasons||'speaker_unverified'::text; end if;
    if (res->'analyzer'->>'fallback_used')::boolean then reasons:=reasons||'fallback_model'::text; end if;
    if exists(select 1 from jsonb_array_elements(res->'output'->'policy_findings') f where f->>'severity'='high') then reasons:=reasons||'high_policy_finding'::text; end if;
    if (res->'output'->>'analyzer_confidence')::numeric<0.5 then reasons:=reasons||'analyzer_low_confidence'::text; end if;
    st:=case when cardinality(reasons)>0 then 'needs_review' else 'scored' end;
   end if;
  end if;
  if (res->'analyzer'->>'prompt_version') !~ '^[a-z0-9][a-z0-9._-]{0,39}$' or length(coalesce(res->'analyzer'->>'provider','')) not between 1 and 80
   or length(coalesce(res->'analyzer'->>'model','')) not between 1 and 120 or ((res->'analyzer'->>'fallback_used')::boolean and (res->'analyzer'->>'fallback_reason') !~ '^[a-z_]{1,64}$') then
   raise exception 'recording_invalid_analysis' using errcode='22023'; end if;
  select id into prior from recording_analyses where session_id=j.session_id order by created_at desc,id limit 1;
  insert into recording_analyses(tenant_id,session_id,job_id,transcript_revision_id,rubric_version_id,sop_version_id,job_version,analyzer_provider,analyzer_model,prompt_version,
   fallback_used,fallback_reason,status,status_reasons,raw_total,assessed_weight,output,quality,supersedes_id)
  values(j.tenant_id,j.session_id,j.id,j.transcript_revision_id,j.rubric_version_id,j.sop_version_id,j.job_version,res->'analyzer'->>'provider',res->'analyzer'->>'model',res->'analyzer'->>'prompt_version',
   (res->'analyzer'->>'fallback_used')::boolean,res->'analyzer'->>'fallback_reason',st,reasons,case when st<>'insufficient_evidence' then (sc->>'raw_total')::numeric end,
   coalesce((sc->>'assessed_weight')::numeric,0),res->'output',q,prior) returning * into an;
  for rd in select value from jsonb_array_elements(r.dimensions) loop
   select value into d from jsonb_array_elements(dims) where value->>'key'=rd->>'key';
   if d is null then continue; end if;
   insert into recording_score_dimensions(analysis_id,dimension_key,label,configured_weight,effective_weight,points,status,rating,reason,evidence)
    select an.id,rd->>'key',rd->>'label',(rd->>'weight')::numeric,
     case when st<>'insufficient_evidence' then (x->>'effective_weight')::numeric end,case when st<>'insufficient_evidence' then (x->>'points')::numeric end,
     d->>'status',case when d->>'status'='assessed' then (d->>'rating')::integer end,d->>'reason',d->'evidence'
    from jsonb_array_elements(sc->'dimensions') x where x->>'key'=rd->>'key';
  end loop;
  update recording_analysis_jobs set state='done',lease_token=null,lease_until=null,worker_id=null,error_code=null,finished_at=now(),updated_at=now() where id=j.id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(j.tenant_id,null,'recording_analysis_created','sales_recording',j.session_id,
   jsonb_build_object('analysis_id',an.id,'status',st,'status_reasons',reasons,'raw_total',an.raw_total,'rubric_version_id',j.rubric_version_id,'sop_version_id',j.sop_version_id,
    'job_version',j.job_version,'model',an.analyzer_model,'fallback_used',an.fallback_used));
  return jsonb_build_object('accepted',true,'analysis_id',an.id,'status',st,'status_reasons',to_jsonb(reasons),'raw_total',an.raw_total);

 elsif p_action='analysis_reconcile' then
  update recording_analysis_jobs set state=case when attempts>=max_attempts then 'dead' else 'pending' end,lease_token=null,lease_until=null,worker_id=null,
   error_code='worker_lease_expired',available_at=now()+interval '30 seconds',updated_at=now(),finished_at=case when attempts>=max_attempts then now() end
   where state='leased' and lease_until<now();
  get diagnostics n=row_count;
  -- Retention: derived transcript, analysis and review content expires with the recording.
  -- Self references (supersedes, base revision) are removed in the same statement.
  perform set_config('recording.retention','on',true);
  delete from recording_analysis_reviews where session_id in (select id from recorder_sessions where expires_at<=now());
  delete from recording_score_dimensions where analysis_id in (select a2.id from recording_analyses a2 join recorder_sessions x on x.id=a2.session_id where x.expires_at<=now());
  delete from recording_analyses where session_id in (select id from recorder_sessions where expires_at<=now());
  delete from recording_analysis_jobs where session_id in (select id from recorder_sessions where expires_at<=now());
  delete from recording_transcript_segments where session_id in (select id from recorder_sessions where expires_at<=now());
  delete from recording_transcript_revisions where session_id in (select id from recorder_sessions where expires_at<=now());
  perform set_config('recording.retention','off',true);
  return jsonb_build_object('recovered_leases',n);

 elsif p_action='analysis_health' then
  return jsonb_build_object('pending',(select count(*) from recording_analysis_jobs where state='pending'),'leased',(select count(*) from recording_analysis_jobs where state='leased'),
   'dead',(select count(*) from recording_analysis_jobs where state='dead'),'capacity',5000);
 else raise exception 'recording_invalid_action' using errcode='22023'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Authenticated contracts (all audited).
create function recording_analysis_snapshot(p_session_id uuid,p_revision_id uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare s recorder_sessions; reviewer boolean; rev uuid; begin
 perform recorder_actor();
 select * into s from recorder_sessions where id=p_session_id;
 if s.id is null or not recorder_can_read(s.employee_id,s.tenant_id,s.branch_id) then raise exception 'recorder_session_denied' using errcode='42501'; end if;
 reviewer:=recording_is_reviewer(s);
 rev:=coalesce(p_revision_id,(select id from recording_transcript_revisions where session_id=s.id order by revision desc limit 1));
 if p_revision_id is not null and not exists(select 1 from recording_transcript_revisions where id=p_revision_id and session_id=s.id) then raise exception 'recording_revision_not_found' using errcode='22023'; end if;
 return jsonb_build_object('session_id',s.id,'is_reviewer',reviewer,'revision_id',rev,
  'revisions',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'revision',v.revision,'source',v.source,'base_revision_id',v.base_revision_id,'stt_provider',v.stt_provider,
    'stt_model',v.stt_model,'diarization_provider',v.diarization_provider,'created_by',v.created_by,'reason',v.reason,'created_at',v.created_at) order by v.revision)
   from recording_transcript_revisions v where v.session_id=s.id),'[]'::jsonb),
  'segments',coalesce((select jsonb_agg(to_jsonb(g)-'session_id'-'revision_id' order by g.ordinal) from recording_transcript_segments g where g.revision_id=rev),'[]'::jsonb),
  'analyses',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
    select an.id,an.transcript_revision_id,an.rubric_version_id,(select version from recording_rubric_versions where id=an.rubric_version_id) rubric_version,
     an.sop_version_id,(select version from recording_sop_versions where id=an.sop_version_id) sop_version,an.job_version,an.analyzer_provider,an.analyzer_model,an.prompt_version,
     an.fallback_used,an.fallback_reason,an.status,an.status_reasons,an.raw_total,an.assessed_weight,an.output,an.quality,an.supersedes_id,an.created_at,
     (select jsonb_agg(to_jsonb(dm)-'analysis_id' order by dm.dimension_key) from recording_score_dimensions dm where dm.analysis_id=an.id) dimensions,
     case when reviewer then (select jsonb_agg(jsonb_build_object('id',rv.id,'action',rv.action,'note',rv.note,'actor_id',rv.actor_id,'dimension_overrides',rv.dimension_overrides,
      'reviewed_status',rv.reviewed_status,'reviewed_total',rv.reviewed_total,'created_at',rv.created_at) order by rv.created_at) from recording_analysis_reviews rv where rv.analysis_id=an.id) end reviews,
     (select rv.action from recording_analysis_reviews rv where rv.analysis_id=an.id and rv.action<>'comment' order by rv.created_at desc,rv.id desc limit 1) review_state
    from recording_analyses an where an.session_id=s.id) x
   -- The recorded employee sees only manager-approved (or manager-edited) analyses.
   where reviewer or x.review_state in ('approve','edit')),'[]'::jsonb),
  'jobs',case when reviewer then coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'state',j.state,'reason',j.reason,'attempts',j.attempts,'error_code',j.error_code,
    'transcript_revision_id',j.transcript_revision_id,'rubric_version_id',j.rubric_version_id,'sop_version_id',j.sop_version_id,'job_version',j.job_version,
    'created_at',j.created_at,'updated_at',j.updated_at,'started_at',j.started_at,'finished_at',j.finished_at) order by j.created_at) from recording_analysis_jobs j where j.session_id=s.id),'[]'::jsonb) else '[]'::jsonb end);
end $$;

create function recording_correct_transcript(p_session_id uuid,p_base_revision_id uuid,p_changes jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a user_profiles:=current_profile(); s recorder_sessions:=recording_session_for_review(p_session_id); base recording_transcript_revisions; rev recording_transcript_revisions; begin
 select * into base from recording_transcript_revisions where id=p_base_revision_id and session_id=s.id;
 if base.id is null then raise exception 'recording_revision_not_found' using errcode='22023'; end if;
 if base.revision<>(select max(revision) from recording_transcript_revisions where session_id=s.id) then raise exception 'recording_revision_stale' using errcode='40001'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'recording_reason_required' using errcode='22023'; end if;
 if jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes) not between 1 and 500
  or exists(select 1 from jsonb_array_elements(p_changes) ch where not recording_keys_ok(ch,array['segment_id','raw_text','display_text','translation_en','speaker'],array['segment_id'])
   or (select count(*) from jsonb_object_keys(ch))<2
   or not exists(select 1 from recording_transcript_segments g where g.revision_id=base.id and g.segment_id::text=ch->>'segment_id')
   or (ch ? 'speaker' and (ch->>'speaker') not in ('employee','customer','unknown'))
   or (ch ? 'raw_text' and (jsonb_typeof(ch->'raw_text')<>'string' or octet_length(ch->>'raw_text')>16384))
   or (ch ? 'display_text' and jsonb_typeof(ch->'display_text') not in ('string','null'))
   or (ch ? 'translation_en' and jsonb_typeof(ch->'translation_en') not in ('string','null')))
  or (select count(distinct ch->>'segment_id') from jsonb_array_elements(p_changes) ch)<>jsonb_array_length(p_changes) then
  raise exception 'recording_invalid_correction' using errcode='22023'; end if;
 insert into recording_transcript_revisions(tenant_id,session_id,revision,source,base_revision_id,stt_provider,stt_model,diarization_provider,created_by,reason,content_sha256)
  values(s.tenant_id,s.id,base.revision+1,'manual_correction',base.id,base.stt_provider,base.stt_model,base.diarization_provider,a.id,btrim(p_reason),
   encode(digest(jsonb_build_object('base',base.id,'changes',p_changes)::text,'sha256'),'hex')) returning * into rev;
 -- Copy every segment; identity, timestamps and source offsets never change.
 insert into recording_transcript_segments(revision_id,session_id,segment_id,ordinal,source_sequence,source_offset_ms,start_ms,end_ms,speaker,speaker_confidence,speaker_source,language,raw_text,display_text,translation_en,stt_confidence)
 select rev.id,s.id,g.segment_id,g.ordinal,g.source_sequence,g.source_offset_ms,g.start_ms,g.end_ms,
  case when ch ? 'speaker' then ch->>'speaker' else g.speaker end,
  case when ch ? 'speaker' then null else g.speaker_confidence end,
  case when ch ? 'speaker' then case when ch->>'speaker'='unknown' then 'none' else 'manual' end else g.speaker_source end,
  g.language,case when ch ? 'raw_text' then ch->>'raw_text' else g.raw_text end,case when ch ? 'display_text' then ch->>'display_text' else g.display_text end,
  case when ch ? 'translation_en' then ch->>'translation_en' else g.translation_en end,g.stt_confidence
 from recording_transcript_segments g left join lateral (select value ch from jsonb_array_elements(p_changes) where value->>'segment_id'=g.segment_id::text) c on true
 where g.revision_id=base.id;
 -- Audit rows outlive recording retention, so they carry hashes and speakers, never transcript text.
 -- Both revisions stay readable (until retention) for the full before/after.
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(s.tenant_id,a.id,'recording_transcript_corrected','sales_recording',s.id,
  jsonb_build_object('base_revision',base.revision,'segments',(select jsonb_agg(jsonb_build_object('segment_id',g.segment_id,'speaker',g.speaker,
    'raw_text_sha256',encode(digest(g.raw_text,'sha256'),'hex'),'display_text_sha256',encode(digest(coalesce(g.display_text,''),'sha256'),'hex')))
   from recording_transcript_segments g where g.revision_id=base.id and exists(select 1 from jsonb_array_elements(p_changes) ch where ch->>'segment_id'=g.segment_id::text))),
  jsonb_build_object('revision',rev.revision,'reason',rev.reason,'changes',(select jsonb_agg(jsonb_build_object('segment_id',ch->>'segment_id',
    'fields',(select jsonb_agg(k order by k) from jsonb_object_keys(ch) k where k<>'segment_id'),'speaker',ch->'speaker')) from jsonb_array_elements(p_changes) ch)));
 return jsonb_build_object('revision_id',rev.id,'revision',rev.revision);
end $$;

create function recording_request_rescore(p_session_id uuid,p_transcript_revision_id uuid default null,p_rubric_version_id uuid default null,p_sop_version_id uuid default null,p_job_version text default null,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile(); s recorder_sessions:=recording_session_for_review(p_session_id); c recorder_config; r recording_rubric_versions; rev uuid; sop uuid; jv text; j recording_analysis_jobs; existed boolean; begin
 select * into c from recorder_config where tenant_id=s.tenant_id;
 if not coalesce(c.analysis_enabled,false) then raise exception 'recording_analysis_disabled' using errcode='42501'; end if;
 if p_note is not null and length(p_note)>500 then raise exception 'recording_invalid_note' using errcode='22023'; end if;
 rev:=coalesce(p_transcript_revision_id,(select id from recording_transcript_revisions where session_id=s.id order by revision desc limit 1));
 if rev is null or not exists(select 1 from recording_transcript_revisions where id=rev and session_id=s.id) then raise exception 'recording_revision_not_found' using errcode='22023'; end if;
 if p_rubric_version_id is null then r:=recording_active_rubric(s.tenant_id);
 else select * into r from recording_rubric_versions where id=p_rubric_version_id and tenant_id=s.tenant_id and status in ('active','retired'); end if;
 if r.id is null then raise exception 'recording_rubric_not_found' using errcode='22023'; end if;
 sop:=coalesce(p_sop_version_id,(select id from recording_sop_versions where tenant_id=s.tenant_id and status='approved' order by version desc limit 1));
 if p_sop_version_id is not null and not exists(select 1 from recording_sop_versions where id=p_sop_version_id and tenant_id=s.tenant_id and status in ('approved','retired')) then raise exception 'recording_sop_not_found' using errcode='22023'; end if;
 jv:=coalesce(p_job_version,c.analysis_job_version);
 if jv !~ '^[a-z0-9][a-z0-9._-]{0,39}$' then raise exception 'recording_invalid_job_version' using errcode='22023'; end if;
 existed:=exists(select 1 from recording_analysis_jobs where transcript_revision_id=rev and rubric_version_id=r.id and sop_version_id is not distinct from sop and job_version=jv);
 j:=recording_enqueue_analysis(s,rev,r.id,sop,jv,'rescore',a.id,p_note);
 if not existed then
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(s.tenant_id,a.id,'recording_rescore_requested','sales_recording',s.id,
   jsonb_build_object('job_id',j.id,'transcript_revision_id',rev,'rubric_version_id',r.id,'sop_version_id',sop,'job_version',jv,'note',p_note));
 end if;
 return jsonb_build_object('job_id',j.id,'state',j.state,'already_requested',existed);
end $$;

create function recording_request_reprocess(p_session_id uuid,p_note text) returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile(); s recorder_sessions:=recording_session_for_review(p_session_id); rj recorder_jobs; begin
 if p_note is null or length(btrim(p_note)) not between 3 and 500 then raise exception 'recording_reason_required' using errcode='22023'; end if;
 select * into rj from recorder_jobs where session_id=s.id and kind='final' for update;
 if rj.id is null or rj.state not in ('dead','done') or not exists(select 1 from recorder_chunks where session_id=s.id) then raise exception 'recording_reprocess_unavailable' using errcode='22023'; end if;
 update recorder_jobs set state='pending',attempts=0,available_at=now(),error_reason=null,lease_until=null where id=rj.id;
 update recorder_sessions set status='processing',error_reason=null,updated_at=now() where id=s.id;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(s.tenant_id,a.id,'recording_reprocess_requested','sales_recording',s.id,
  jsonb_build_object('previous_state',rj.state,'previous_error',rj.error_reason,'note',btrim(p_note)));
 return jsonb_build_object('session_id',s.id,'status','processing');
end $$;

create function recording_review_analysis(p_analysis_id uuid,p_action text,p_note text default null,p_dimension_overrides jsonb default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile(); an recording_analyses; s recorder_sessions; r recording_rubric_versions; merged jsonb:='[]'::jsonb; d recording_score_dimensions; o jsonb; sc jsonb; rv recording_analysis_reviews; begin
 select * into an from recording_analyses where id=p_analysis_id;
 if an.id is null then raise exception 'recording_review_denied' using errcode='42501'; end if;
 s:=recording_session_for_review(an.session_id);
 if p_action not in ('approve','flag','unflag','edit','comment') then raise exception 'recording_invalid_review' using errcode='22023'; end if;
 if p_note is not null and length(btrim(p_note)) not between 1 and 2000 or (p_action in ('flag','edit','comment') and coalesce(btrim(p_note),'')='') then raise exception 'recording_reason_required' using errcode='22023'; end if;
 if p_action='edit' then
  select * into r from recording_rubric_versions where id=an.rubric_version_id;
  if jsonb_typeof(p_dimension_overrides)<>'array' or jsonb_array_length(p_dimension_overrides) not between 1 and 12
   or exists(select 1 from jsonb_array_elements(p_dimension_overrides) x where not recording_keys_ok(x,array['key','status','rating','reason'],array['key','status','reason'])
    or not exists(select 1 from jsonb_array_elements(r.dimensions) rd where rd->>'key'=x->>'key')
    or (x->>'status') not in ('assessed','not_applicable','insufficient_evidence')
    or (x->>'status'='assessed' and (jsonb_typeof(x->'rating')<>'number' or (x->>'rating')::numeric<>trunc((x->>'rating')::numeric) or (x->>'rating')::numeric not between 0 and 10))
    or (x->>'status'<>'assessed' and coalesce(jsonb_typeof(x->'rating'),'null')<>'null')
    or jsonb_typeof(x->'reason')<>'string' or length(btrim(x->>'reason')) not between 3 and 600)
   or (select count(distinct x->>'key') from jsonb_array_elements(p_dimension_overrides) x)<>jsonb_array_length(p_dimension_overrides) then
   raise exception 'recording_invalid_review' using errcode='22023'; end if;
  for d in select * from recording_score_dimensions where analysis_id=an.id loop
   select value into o from jsonb_array_elements(p_dimension_overrides) where value->>'key'=d.dimension_key;
   merged:=merged||jsonb_build_array(case when o is not null then jsonb_build_object('key',d.dimension_key,'status',o->>'status','rating',o->'rating')
    else jsonb_build_object('key',d.dimension_key,'status',d.status,'rating',d.rating) end);
   o:=null::jsonb;
  end loop;
  -- Insufficient-speech analyses have no machine dimensions: a manager can still score with overrides covering the rubric.
  for o in select value from jsonb_array_elements(r.dimensions) loop
   if not exists(select 1 from jsonb_array_elements(merged) m where m->>'key'=o->>'key') then
    merged:=merged||jsonb_build_array(coalesce((select jsonb_build_object('key',x->>'key','status',x->>'status','rating',x->'rating') from jsonb_array_elements(p_dimension_overrides) x where x->>'key'=o->>'key'),
     jsonb_build_object('key',o->>'key','status','insufficient_evidence','rating',null)));
   end if;
  end loop;
  sc:=recording_compute_score(merged,r.dimensions,r.min_assessed_weight);
 end if;
 insert into recording_analysis_reviews(tenant_id,session_id,analysis_id,actor_id,action,note,dimension_overrides,reviewed_status,reviewed_total)
  values(s.tenant_id,s.id,an.id,a.id,p_action,nullif(btrim(p_note),''),case when p_action='edit' then p_dimension_overrides end,sc->>'status',(sc->>'raw_total')::numeric) returning * into rv;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(s.tenant_id,a.id,'recording_analysis_'||p_action,'sales_recording',s.id,
  jsonb_build_object('analysis_id',an.id,'status',an.status,'raw_total',an.raw_total),
  jsonb_build_object('review_id',rv.id,'note',rv.note,'dimension_overrides',rv.dimension_overrides,'reviewed_status',rv.reviewed_status,'reviewed_total',rv.reviewed_total));
 return jsonb_build_object('review_id',rv.id,'action',rv.action,'reviewed_status',rv.reviewed_status,'reviewed_total',rv.reviewed_total);
end $$;

create function recording_configure_analysis(p_enabled boolean,p_job_version text default 'mk-sales-v1') returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile(); c recorder_config; begin
 if a.id is null or not current_profile_is_active() or not has_permission('developer_mode.manage') then raise exception 'recorder_config_denied' using errcode='42501'; end if;
 if p_enabled is null or p_job_version is null or p_job_version !~ '^[a-z0-9][a-z0-9._-]{0,39}$' then raise exception 'recorder_invalid_config' using errcode='22023'; end if;
 insert into recorder_config(tenant_id,analysis_enabled,analysis_job_version) values(a.tenant_id,p_enabled,p_job_version)
  on conflict(tenant_id) do update set analysis_enabled=excluded.analysis_enabled,analysis_job_version=excluded.analysis_job_version returning * into c;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'recording_analysis_configured','sales_recording',a.tenant_id,
  jsonb_build_object('analysis_enabled',c.analysis_enabled,'analysis_job_version',c.analysis_job_version));
 return jsonb_build_object('analysis_enabled',c.analysis_enabled,'analysis_job_version',c.analysis_job_version);
end $$;

create function recording_create_rubric_version(p_name text,p_dimensions jsonb,p_min_assessed_weight numeric default 50) returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=recording_rubric_manager(); r recording_rubric_versions; begin
 if p_name is null or length(btrim(p_name)) not between 1 and 120 or not recording_valid_rubric_dimensions(p_dimensions) or p_min_assessed_weight is null or p_min_assessed_weight not between 1 and 100 then
  raise exception 'recording_invalid_rubric' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a.tenant_id::text,9));
 insert into recording_rubric_versions(tenant_id,version,name,dimensions,min_assessed_weight,created_by)
  values(a.tenant_id,coalesce((select max(version) from recording_rubric_versions where tenant_id=a.tenant_id),0)+1,btrim(p_name),p_dimensions,p_min_assessed_weight,a.id) returning * into r;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'recording_rubric_created','sales_recording',r.id,to_jsonb(r));
 return to_jsonb(r);
end $$;
create function recording_activate_rubric_version(p_rubric_version_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=recording_rubric_manager(); r recording_rubric_versions; old_id uuid; begin
 perform pg_advisory_xact_lock(hashtextextended(a.tenant_id::text,9));
 select * into r from recording_rubric_versions where id=p_rubric_version_id and tenant_id=a.tenant_id for update;
 if r.id is null or r.status<>'draft' then raise exception 'recording_invalid_rubric' using errcode='22023'; end if;
 update recording_rubric_versions set status='retired' where tenant_id=a.tenant_id and status='active' returning id into old_id;
 update recording_rubric_versions set status='active',activated_by=a.id,activated_at=now() where id=r.id returning * into r;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(a.tenant_id,a.id,'recording_rubric_activated','sales_recording',r.id,
  jsonb_build_object('retired_rubric_version_id',old_id),jsonb_build_object('version',r.version));
 return to_jsonb(r);
end $$;
create function recording_create_sop_version(p_title text,p_clauses jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a user_profiles:=recording_rubric_manager(); v recording_sop_versions; begin
 if p_title is null or length(btrim(p_title)) not between 1 and 200 or not recording_valid_sop_clauses(p_clauses) then raise exception 'recording_invalid_sop' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a.tenant_id::text,10));
 insert into recording_sop_versions(tenant_id,version,title,clauses,content_sha256,created_by)
  values(a.tenant_id,coalesce((select max(version) from recording_sop_versions where tenant_id=a.tenant_id),0)+1,btrim(p_title),p_clauses,encode(digest(p_clauses::text,'sha256'),'hex'),a.id) returning * into v;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'recording_sop_created','sales_recording',v.id,
  jsonb_build_object('version',v.version,'title',v.title,'clauses',jsonb_array_length(v.clauses),'content_sha256',v.content_sha256));
 return jsonb_build_object('id',v.id,'version',v.version,'status',v.status,'content_sha256',v.content_sha256);
end $$;
create function recording_set_sop_status(p_sop_version_id uuid,p_status text) returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=recording_rubric_manager(); v recording_sop_versions; begin
 select * into v from recording_sop_versions where id=p_sop_version_id and tenant_id=a.tenant_id for update;
 if v.id is null or not ((v.status='draft' and p_status='approved') or (v.status='approved' and p_status='retired')) then raise exception 'recording_invalid_sop' using errcode='22023'; end if;
 -- Reviewed means a second person, unless the Super Admin approves.
 if p_status='approved' and v.created_by=a.id and a.user_role<>'super_admin' then raise exception 'recording_sop_needs_second_reviewer' using errcode='42501'; end if;
 update recording_sop_versions set status=p_status,approved_by=coalesce(approved_by,a.id),approved_at=coalesce(approved_at,now()) where id=v.id returning * into v;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'recording_sop_'||p_status,'sales_recording',v.id,jsonb_build_object('version',v.version));
 return jsonb_build_object('id',v.id,'version',v.version,'status',v.status);
end $$;
create function recording_list_versions() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=recorder_actor(); begin
 if not (has_permission('recording.manage_rubric') or (a.user_role in ('super_admin','admin','manager') and has_permission('recording.review'))) then raise exception 'recording_rubric_denied' using errcode='42501'; end if;
 return jsonb_build_object(
  'rubrics',coalesce((select jsonb_agg(jsonb_build_object('id',id,'version',version,'status',status,'name',name,'dimensions',dimensions,'min_assessed_weight',min_assessed_weight,'created_at',created_at,'activated_at',activated_at) order by version)
   from recording_rubric_versions where tenant_id=a.tenant_id),'[]'::jsonb),
  'sops',coalesce((select jsonb_agg(jsonb_build_object('id',id,'version',version,'status',status,'title',title,'clauses',clauses,'content_sha256',content_sha256,'created_by',created_by,'approved_by',approved_by,'approved_at',approved_at) order by version)
   from recording_sop_versions where tenant_id=a.tenant_id),'[]'::jsonb));
end $$;

-- Explicit grants: browser gets audited RPCs, worker gets the service boundary only.
do $$ declare f record; begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'recording\_%' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig); end loop; end $$;
grant execute on function recording_analysis_snapshot(uuid,uuid),recording_correct_transcript(uuid,uuid,jsonb,text),
 recording_request_rescore(uuid,uuid,uuid,uuid,text,text),recording_request_reprocess(uuid,text),recording_review_analysis(uuid,text,text,jsonb),
 recording_configure_analysis(boolean,text),recording_create_rubric_version(text,jsonb,numeric),recording_activate_rubric_version(uuid),
 recording_create_sop_version(text,jsonb),recording_set_sop_status(uuid,text),recording_list_versions() to authenticated;
grant execute on function recording_analysis_ingest(text,jsonb) to service_role;
-- Pure helpers are safe to share with tests and the worker contract checks.
grant execute on function recording_compute_score(jsonb,jsonb,numeric),recording_redact(text),recording_norm(text) to authenticated,service_role;
notify pgrst,'reload schema';
