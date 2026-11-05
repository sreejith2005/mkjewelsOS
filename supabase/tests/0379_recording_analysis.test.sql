begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Surface and privileges.
select has_table('public','recording_transcript_revisions','transcript revisions exist');
select has_table('public','recording_analyses','analyses exist');
select ok(not has_function_privilege('authenticated','recording_analysis_ingest(text,jsonb)','execute'),'browser cannot call the worker boundary');
select ok(not has_function_privilege('anon','recording_analysis_snapshot(uuid,uuid)','execute'),'anon cannot read analyses');
select ok(has_function_privilege('service_role','recording_analysis_ingest(text,jsonb)','execute'),'worker boundary granted to service role');
select ok(not has_function_privilege('service_role','recording_review_analysis(uuid,text,text,jsonb)','execute'),'service role cannot review as a manager');
select ok(not has_table_privilege('authenticated','recording_analyses','select'),'no direct analysis table reads');
select ok(not has_table_privilege('service_role','recording_transcript_segments','insert'),'no direct transcript writes');
select ok((select relrowsecurity from pg_class where oid='recording_score_dimensions'::regclass),'dimension RLS');
select throws_ok($$select recording_analysis_ingest('analysis_health','{}')$$,'42501','recording_service_only','database owner without service claims denied');
select is((select default_roles from permission_catalog where key='recording.manage_rubric'),'{super_admin,admin}'::user_role[],'rubric management defaults to admins');

-- Score formula parity vectors (mirrored in packages/core/src/salesScore/score.test.ts).
create temporary table rubric_v1 as select recording_default_rubric_dimensions() d;
create function pg_temp.dims(r int[],st text[]) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('key',k,'status',st[i],'rating',case when st[i]='assessed' then to_jsonb(r[i]) else 'null'::jsonb end) order by i)
 from unnest(array['greeting_sop','product_knowledge','needs_discovery','objection_handling','pricing_value','closing_follow_up','personalization_empathy']) with ordinality u(k,i)$$;
select is((recording_compute_score(pg_temp.dims(array[8,7,6,5,9,7,8],array['assessed','assessed','assessed','assessed','assessed','assessed','assessed']),(select d from rubric_v1),50)->>'raw_total')::numeric,70.00,'all assessed: weighted total');
select is((recording_compute_score(pg_temp.dims(array[8,7,6,0,0,7,8],array['assessed','assessed','assessed','not_applicable','insufficient_evidence','assessed','assessed']),(select d from rubric_v1),50)->>'raw_total')::numeric,71.33,'renormalised over assessed weight');
select is((select (x->>'effective_weight')::numeric from jsonb_array_elements(recording_compute_score(pg_temp.dims(array[8,7,6,0,0,7,8],array['assessed','assessed','assessed','not_applicable','insufficient_evidence','assessed','assessed']),(select d from rubric_v1),50)->'dimensions') x where x->>'key'='product_knowledge'),26.6667,'effective weight transparent');
select is((select x->>'effective_weight' from jsonb_array_elements(recording_compute_score(pg_temp.dims(array[8,7,6,0,0,7,8],array['assessed','assessed','assessed','not_applicable','insufficient_evidence','assessed','assessed']),(select d from rubric_v1),50)->'dimensions') x where x->>'key'='objection_handling'),null,'not applicable carries no weight');
select is(recording_compute_score(pg_temp.dims(array[8,0,6,0,0,0,8],array['assessed','insufficient_evidence','assessed','not_applicable','insufficient_evidence','insufficient_evidence','assessed']),(select d from rubric_v1),50)->>'status','insufficient_evidence','under minimum assessed weight: no total');
select is(recording_compute_score(pg_temp.dims(array[8,0,6,0,0,0,8],array['assessed','insufficient_evidence','assessed','not_applicable','insufficient_evidence','insufficient_evidence','assessed']),(select d from rubric_v1),50)->>'raw_total',null,'no guessed total');
select is((recording_compute_score(pg_temp.dims(array[0,0,0,0,0,0,0],array['assessed','assessed','assessed','assessed','assessed','assessed','assessed']),(select d from rubric_v1),50)->>'raw_total')::numeric,0.00,'zero is a real score, not missing');
select is((recording_compute_score(pg_temp.dims(array[10,10,0,0,0,10,0],array['assessed','assessed','insufficient_evidence','not_applicable','not_applicable','assessed','insufficient_evidence']),(select d from rubric_v1),50)->>'raw_total')::numeric,100.00,'exactly minimum weight is scored');

-- Redaction vectors (mirrored in redact.py and redact.ts tests).
select is(recording_redact('call me at 98765 43210 please'),'call me at [PHONE] please','phone redacted');
select is(recording_redact('+91 9876543210'),'[PHONE]','phone with country code');
select is(recording_redact('mail a.b@example.com'),'mail [EMAIL]','email redacted');
select is(recording_redact('upi ravi@okhdfc'),'upi [UPI]','UPI handle redacted');
select is(recording_redact('pan ABCDE1234F'),'pan [PAN]','PAN redacted');
select is(recording_redact('aadhaar 1234 5678 9012'),'aadhaar [AADHAAR]','Aadhaar-like number redacted');
select is(recording_redact('card 4111 1111 1111 1111'),'card [CARD]','card-like number redacted');
select is(recording_redact('22 carat 916 hallmark, price 45000'),'22 carat 916 hallmark, price 45000','ordinary prices and purity untouched');

-- Fixture.
create temporary table rf(name text primary key,id uuid,body jsonb);
grant all on rf to authenticated,service_role;
do $$ declare t uuid; b uuid; b2 uuid; d uuid; a uuid; u uuid; person text; dev uuid:=gen_random_uuid(); s uuid; begin
 insert into tenants(name,slug) values('Analysis fixture','analysis-fixture') returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Store','ANA') returning id into b;
 insert into branches(tenant_id,name,code) values(t,'Other','ANA2') returning id into b2;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','ANA') returning id into d;
 insert into rf values('tenant',t,null),('branch',b,null),('branch2',b2,null);
 foreach person in array array['owner','admin','manager','rep','peer','farmanager'] loop
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-ana@test.local','x',now(),now()) returning id into a;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled,account_status)
   values(t,a,case when person='farmanager' then b2 else b end,d,person,'ANA-'||person,person||'-ana@test.local',
    case person when 'owner' then 'super_admin' when 'admin' then 'admin' when 'manager' then 'manager' when 'farmanager' then 'manager' else 'staff' end::user_role,'active',true,'active') returning id into u;
  insert into rf values(person,u,null),(person||'_auth',a,null);
 end loop;
 insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect)
  select id,t,'module.sales_recording','grant' from rf where name in ('rep','peer');
 insert into recorder_config(tenant_id,enabled,employee_ids,branch_ids) values(t,true,array[(select id from rf where name='rep')],array[b]);
 insert into recorder_devices(id,tenant_id,branch_id,employee_id) values(dev,t,b,(select id from rf where name='rep'));
 insert into recorder_sessions(tenant_id,branch_id,employee_id,device_id,request_id,consent_version,status,next_sequence,last_sequence,capture_ended_at)
  values(t,b,(select id from rf where name='rep'),dev,gen_random_uuid(),'pilot-v1','processing',3,2,now()) returning id into s;
 insert into recorder_chunks select s,g,repeat('a',64),64000,'recordings/'||t||'/'||b||'/'||(select id from rf where name='rep')||'/'||dev||'/'||s||'/'||lpad(g::text,8,'0')||'-'||repeat('a',64)||'.pcm',now() from generate_series(0,2) g;
 insert into recorder_jobs(session_id,kind,state,attempts,worker_id,lease_token,lease_until) values(s,'final','leased',1,gen_random_uuid(),gen_random_uuid(),now()+interval '2 minutes');
 insert into rf values('device',dev,null),('session',s,null);
end $$;
create function pg_temp.rid(n text) returns uuid language sql as $$select id from rf where name=n$$;
create function pg_temp.ract(n text) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(n||'_auth'),'role','authenticated')::text,true),set_config('request.jwt.claim.sub',pg_temp.rid(n||'_auth')::text,true),set_config('request.jwt.claim.role','authenticated',true)$$;
create function pg_temp.rsrv() returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.role','service_role',true)$$;
create function pg_temp.claims() returns jsonb language sql as $$
 select jsonb_build_object('session_id',s.id,'device_id',s.device_id,'employee_id',s.employee_id,'tenant_id',s.tenant_id,'branch_id',s.branch_id,'job_id',j.id,'worker_id',j.worker_id,'lease_token',j.lease_token)
 from recorder_sessions s join recorder_jobs j on j.session_id=s.id and j.kind='final' where s.id=pg_temp.rid('session')$$;
create function pg_temp.seg(id text,seq int,off_ms int,st int,en int,spk text,conf numeric,raw text) returns jsonb language sql as $$
 select jsonb_build_object('segment_id',id,'source_sequence',seq,'source_offset_ms',off_ms,'start_ms',st,'end_ms',en,'speaker',spk,'speaker_confidence',conf,
  'speaker_source',case when spk='unknown' then 'none' else 'diarization' end,'language','hi','raw_text',raw,'display_text',raw,'translation_en',null,'stt_confidence',0.9)$$;
create function pg_temp.segments() returns jsonb language sql as $$ select jsonb_build_array(
 pg_temp.seg('10000000-0000-4000-8000-000000000001',0,0,0,1800,'employee',0.95,'Namaste ji, MK Jewels mein aapka swagat hai. Aaj kis occasion ke liye dekh rahe hain?'),
 pg_temp.seg('10000000-0000-4000-8000-000000000002',1,0,2000,3900,'customer',0.9,'Beti ki shaadi hai, bridal necklace chahiye, budget around 3 lakh.'),
 pg_temp.seg('10000000-0000-4000-8000-000000000003',2,0,4000,4800,'employee',0.92,'Hamare paas 22 carat hallmark wale bridal sets hain, making charges design ke hisaab se 12 se 18 percent hain.'),
 pg_temp.seg('10000000-0000-4000-8000-000000000004',2,800,4800,5100,'unknown',null,'Making charges thoda zyada lag raha hai.'),
 pg_temp.seg('10000000-0000-4000-8000-000000000005',2,1100,5100,5500,'customer',0.88,'Mera number 98765 43210 hai, kal papa ke saath aayenge.'),
 pg_temp.seg('10000000-0000-4000-8000-000000000006',2,1500,5500,6000,'employee',0.93,'Bilkul, main aapke liye designs hold kar deti hoon aur kal call karti hoon.'))$$;
create function pg_temp.ev(n int,q text) returns jsonb language sql as $$select jsonb_build_object('segment_id','10000000-0000-4000-8000-00000000000'||n,'quote',q)$$;
create function pg_temp.no() returns jsonb language sql as $$select jsonb_build_object('detected',false,'confidence',0.8,'reason','Not observed in the conversation.','evidence','[]'::jsonb)$$;
create function pg_temp.output() returns jsonb language sql as $$ select jsonb_build_object(
 'summary','Customer is shopping for a bridal necklace for a daughter''s wedding and will return with family.',
 'key_points',jsonb_build_array(jsonb_build_object('text','Bridal necklace for a wedding','evidence',jsonb_build_array(pg_temp.ev(2,'bridal necklace chahiye'))),
  jsonb_build_object('text','Making charges explained as a range','evidence',jsonb_build_array(pg_temp.ev(3,'making charges design ke hisaab se'))),
  jsonb_build_object('text','Customer will come back tomorrow','evidence',jsonb_build_array(pg_temp.ev(5,'kal papa ke saath aayenge')))),
 'product_interests',jsonb_build_array(jsonb_build_object('text','Bridal necklace','evidence',jsonb_build_array(pg_temp.ev(2,'bridal necklace')))),
 'customer_requirements',jsonb_build_object('budget',jsonb_build_object('text','About 3 lakh','evidence',jsonb_build_array(pg_temp.ev(2,'budget around 3 lakh'))),
  'occasion',jsonb_build_object('text','Daughter''s wedding','evidence',jsonb_build_array(pg_temp.ev(2,'Beti ki shaadi hai'))),'requirements','[]'::jsonb),
 'customer_concerns',jsonb_build_array(jsonb_build_object('text','Making charges may feel high','evidence',jsonb_build_array(pg_temp.ev(4,'making charges thoda zyada')))),
 'competitor_mentions','[]'::jsonb,'purchase_blockers','[]'::jsonb,
 'coaching_strengths',jsonb_build_array(jsonb_build_object('text','Asked about the occasion early','evidence',jsonb_build_array(pg_temp.ev(1,'kis occasion ke liye')))),
 'coaching_gaps','[]'::jsonb,
 'coaching_interventions',jsonb_build_array(jsonb_build_object('text','Explain making charges with the value story before quoting the range','reason','Customer reacted to the making-charge range','evidence',jsonb_build_array(pg_temp.ev(4,'thoda zyada lag raha hai')))),
 'next_best_actions',jsonb_build_array(jsonb_build_object('action','Call tomorrow to confirm the family visit','reason','Visit agreed','evidence',jsonb_build_array(pg_temp.ev(5,'mera number [PHONE] hai')))),
 'signals',jsonb_build_object('objection',pg_temp.no(),'price_concern',jsonb_build_object('detected',true,'confidence',0.6,'reason','Customer said making charges feel high.','evidence',jsonb_build_array(pg_temp.ev(4,'thoda zyada lag raha'))),
  'stock_gap',pg_temp.no(),'competitor_mention',pg_temp.no(),'customer_questions',pg_temp.no(),
  'conversion_signal',jsonb_build_object('detected',true,'confidence',0.7,'reason','Clear need for a bridal set.','evidence',jsonb_build_array(pg_temp.ev(2,'bridal necklace chahiye'))),
  'next_step',jsonb_build_object('detected',true,'confidence',0.9,'reason','Return visit agreed.','evidence',jsonb_build_array(pg_temp.ev(5,'kal papa ke saath aayenge'))),
  'drop_off',pg_temp.no(),'upsell_opportunity',pg_temp.no(),
  'sales_outcome',jsonb_build_object('value','follow_up','confidence',0.8,'reason','Customer returns tomorrow.','evidence',jsonb_build_array(pg_temp.ev(5,'kal papa ke saath aayenge')))),
 'policy_findings','[]'::jsonb,'analyzer_confidence',0.8)$$;
create function pg_temp.dimensions() returns jsonb language sql as $$ select jsonb_build_array(
 jsonb_build_object('key','greeting_sop','status','assessed','rating',8,'reason','Warm MK Jewels welcome.','evidence',jsonb_build_array(pg_temp.ev(1,'MK Jewels mein aapka swagat hai'))),
 jsonb_build_object('key','product_knowledge','status','assessed','rating',7,'reason','Correct purity and hallmark facts.','evidence',jsonb_build_array(pg_temp.ev(3,'22 carat hallmark'))),
 jsonb_build_object('key','needs_discovery','status','assessed','rating',8,'reason','Asked about the occasion.','evidence',jsonb_build_array(pg_temp.ev(1,'kis occasion ke liye'))),
 jsonb_build_object('key','objection_handling','status','not_applicable','rating',null,'reason','No clear objection was raised.','evidence','[]'::jsonb),
 jsonb_build_object('key','pricing_value','status','assessed','rating',7,'reason','Gave the making-charge range.','evidence',jsonb_build_array(pg_temp.ev(3,'12 se 18 percent'))),
 jsonb_build_object('key','closing_follow_up','status','assessed','rating',8,'reason','Held designs and promised a call.','evidence',jsonb_build_array(pg_temp.ev(6,'designs hold kar deti hoon'))),
 jsonb_build_object('key','personalization_empathy','status','insufficient_evidence','rating',null,'reason','Too little to judge.','evidence','[]'::jsonb))$$;
create function pg_temp.analyzer(fallback boolean default false) returns jsonb language sql as $$
 select jsonb_build_object('provider','private-llm','model','fixture-model-1','prompt_version','mk-sales-prompt-v1','fallback_used',fallback,'fallback_reason',case when fallback then 'primary_unavailable' end)$$;
create function pg_temp.job() returns jsonb language sql as $$select body from rf where name='ajob'$$;
create function pg_temp.lease() returns jsonb language sql as $$select jsonb_build_object('job_id',pg_temp.job()->>'id','worker_id',pg_temp.job()->>'worker_id','lease_token',pg_temp.job()->>'lease_token')$$;
create function pg_temp.claim() returns void language sql as $$
 insert into rf(name,body) values('ajob',recording_analysis_ingest('analysis_claim',jsonb_build_object('worker_id',gen_random_uuid()))->'job') on conflict(name) do update set body=excluded.body$$;

-- Transcript finalisation is fenced by the recorder final-job lease.
select pg_temp.rsrv();
select throws_ok($$select recording_analysis_ingest('transcript_finalize',pg_temp.claims()||jsonb_build_object('lease_token',gen_random_uuid(),'segments',pg_temp.segments()))$$,'42501','recording_job_lease_denied','finalise needs the final job lease');
select throws_ok($$select recording_analysis_ingest('transcript_finalize',pg_temp.claims()||jsonb_build_object('employee_id',gen_random_uuid(),'segments',pg_temp.segments()))$$,'42501','recording_scope_denied','finalise scope cannot be changed');
select throws_ok($$select recording_analysis_ingest('transcript_finalize',pg_temp.claims()||jsonb_build_object('segments',jsonb_build_array(pg_temp.seg('10000000-0000-4000-8000-000000000001',0,0,0,1800,'employee',0.5,'weak guess'))))$$,'22023','recording_invalid_transcript','weak speaker guess cannot be stored as employee');
select throws_ok($$select recording_analysis_ingest('transcript_finalize',pg_temp.claims()||jsonb_build_object('segments',jsonb_build_array(pg_temp.seg('10000000-0000-4000-8000-000000000001',9,0,0,1800,'unknown',null,'x'))))$$,'22023','recording_invalid_transcript','source offsets must point at canonical audio');
update recorder_config set analysis_enabled=true where tenant_id=pg_temp.rid('tenant');
insert into rf(name,body) values('fin',recording_analysis_ingest('transcript_finalize',pg_temp.claims()||jsonb_build_object('stt_provider','private-gpu','stt_model','indic-conformer-600m','segments',pg_temp.segments())));
select is((select body->>'revision' from rf where name='fin'),'1','first machine revision');
select is(recording_analysis_ingest('transcript_finalize',pg_temp.claims()||jsonb_build_object('stt_provider','private-gpu','stt_model','indic-conformer-600m','segments',pg_temp.segments()))->>'created','false','identical finalise is idempotent');
select is((select count(*)::integer from recording_analysis_jobs where session_id=pg_temp.rid('session') and reason='initial'),1,'one initial analysis job');
select is((select ordinal from recording_transcript_segments where segment_id='10000000-0000-4000-8000-000000000004'),3,'ordinal follows submitted order');
select is((select source_offset_ms from recording_transcript_segments where segment_id='10000000-0000-4000-8000-000000000005'),1100,'source audio offset kept');

-- Claim: minimal data, pinned versions.
select pg_temp.claim();
select is(jsonb_array_length(pg_temp.job()->'segments'),6,'claim carries the pinned revision');
select ok(not (pg_temp.job() ? 'employee_id') and position('ANA-rep' in pg_temp.job()::text)=0 and position('rep-ana@' in pg_temp.job()::text)=0,'claim carries no employee identity');
select is(jsonb_array_length(pg_temp.job()->'rubric'->'dimensions'),7,'MK Sales Score v1 pinned');
select is(pg_temp.job()->'sop','null'::jsonb,'no approved SOP yet');
select is(recording_analysis_ingest('analysis_claim',jsonb_build_object('worker_id',gen_random_uuid()))->'job','null'::jsonb,'one leased job per session');

-- Untrusted output is validated.
select throws_ok($$select recording_analysis_ingest('analysis_submit',pg_temp.lease()||jsonb_build_object('result',jsonb_build_object('status_hint','scored','analyzer',pg_temp.analyzer(),'output',jsonb_set(pg_temp.output(),'{key_points,0,evidence,0,quote}','"invented words never said"'),'dimensions',pg_temp.dimensions())))$$,'22023','recording_invalid_analysis','quote must appear in the cited segment');
select throws_ok($$select recording_analysis_ingest('analysis_submit',pg_temp.lease()||jsonb_build_object('result',jsonb_build_object('status_hint','scored','analyzer',pg_temp.analyzer(),'output',pg_temp.output()||'{"customer_age":"30-40"}','dimensions',pg_temp.dimensions())))$$,'22023','recording_invalid_analysis','unknown fields such as inferred age rejected');
select throws_ok($$select recording_analysis_ingest('analysis_submit',pg_temp.lease()||jsonb_build_object('result',jsonb_build_object('status_hint','scored','analyzer',pg_temp.analyzer(),'output',jsonb_set(pg_temp.output(),'{signals,drop_off,detected}','true'),'dimensions',pg_temp.dimensions())))$$,'22023','recording_invalid_analysis','detected signal needs evidence');
select throws_ok($$select recording_analysis_ingest('analysis_submit',pg_temp.lease()||jsonb_build_object('result',jsonb_build_object('status_hint','scored','analyzer',pg_temp.analyzer(),'output',pg_temp.output(),'dimensions',jsonb_set(pg_temp.dimensions(),'{6}','{"key":"personalization_empathy","status":"insufficient_evidence","rating":5,"reason":"Guessed","evidence":[]}'))))$$,'22023','recording_invalid_analysis','no rating for unsupported dimension');
select throws_ok($$select recording_analysis_ingest('analysis_submit',pg_temp.lease()||jsonb_build_object('result',jsonb_build_object('status_hint','scored','analyzer',pg_temp.analyzer(),'output',jsonb_set(pg_temp.output(),'{policy_findings}',jsonb_build_array(jsonb_build_object('severity','low','clause_id','MC-1','statement','x','evidence',jsonb_build_array(pg_temp.ev(3,'22 carat hallmark'))))),'dimensions',pg_temp.dimensions())))$$,'22023','recording_invalid_analysis','policy finding needs a pinned SOP');
select is(recording_analysis_ingest('analysis_fail',pg_temp.lease()||'{"error_code":"invalid_model_output","retryable":true}')->'job'->>'state','pending','bounded retry with backoff');
select is((select attempts from recording_analysis_jobs where id=(pg_temp.job()->>'id')::uuid),1,'attempt counted');
select is(recording_analysis_ingest('analysis_claim',jsonb_build_object('worker_id',gen_random_uuid()))->'job','null'::jsonb,'backoff respected');
update recording_analysis_jobs set available_at=now() where id=(pg_temp.job()->>'id')::uuid;
select pg_temp.claim();
insert into rf(name,body) values('a1',recording_analysis_ingest('analysis_submit',pg_temp.lease()||jsonb_build_object('result',jsonb_build_object('status_hint','scored','analyzer',pg_temp.analyzer(),'output',pg_temp.output(),'dimensions',pg_temp.dimensions()))));
select is((select body->>'status' from rf where name='a1'),'scored','grounded analysis scored');
select is((select (body->>'raw_total')::numeric from rf where name='a1'),76.00,'server total over assessed weight 75');
select is((select assessed_weight from recording_analyses where id=(select (body->>'analysis_id')::uuid from rf where name='a1')),75.00,'assessed weight stored');
select is((select rating from recording_score_dimensions where analysis_id=(select (body->>'analysis_id')::uuid from rf where name='a1') and dimension_key='personalization_empathy'),null,'unsupported dimension has no rating');
select is((select effective_weight from recording_score_dimensions where analysis_id=(select (body->>'analysis_id')::uuid from rf where name='a1') and dimension_key='product_knowledge'),26.6667,'effective weight stored');
select is(recording_analysis_ingest('analysis_submit',pg_temp.lease()||jsonb_build_object('result',jsonb_build_object('status_hint','scored','analyzer',pg_temp.analyzer(),'output',pg_temp.output(),'dimensions',pg_temp.dimensions())))->>'analysis_id',
 (select body->>'analysis_id' from rf where name='a1'),'lost-ACK replay returns the same analysis');
select is((select count(*)::integer from audit_logs where record_id=pg_temp.rid('session') and action='recording_analysis_created'),1,'analysis audited once');

-- Visibility: employee sees approved analyses only; other branch and peers denied.
select pg_temp.ract('rep');
select is(jsonb_array_length(recording_analysis_snapshot(pg_temp.rid('session'))->'segments'),6,'employee reads own transcript');
select is(jsonb_array_length(recording_analysis_snapshot(pg_temp.rid('session'))->'analyses'),0,'employee does not see unreviewed analysis');
select is(jsonb_array_length(recording_analysis_snapshot(pg_temp.rid('session'))->'jobs'),0,'employee does not see job internals');
select throws_ok($$select recording_review_analysis((select (body->>'analysis_id')::uuid from rf where name='a1'),'approve')$$,'42501','recording_review_denied','employee cannot approve own analysis');
select throws_ok($$select recording_correct_transcript(pg_temp.rid('session'),(select (body->>'revision_id')::uuid from rf where name='fin'),'[{"segment_id":"10000000-0000-4000-8000-000000000001","speaker":"customer"}]','Wrong speaker')$$,'42501','recording_review_denied','employee cannot rewrite transcript');
select pg_temp.ract('peer');
select throws_ok($$select recording_analysis_snapshot(pg_temp.rid('session'))$$,'42501','recorder_session_denied','peer cannot read colleague');
select pg_temp.ract('farmanager');
select throws_ok($$select recording_analysis_snapshot(pg_temp.rid('session'))$$,'42501',null,'other-branch manager denied');
select pg_temp.ract('manager');
select is(jsonb_array_length(recording_analysis_snapshot(pg_temp.rid('session'))->'analyses'),1,'branch manager sees analysis');
select is((recording_analysis_snapshot(pg_temp.rid('session'))->>'is_reviewer')::boolean,true,'manager is reviewer');

-- Review: append-only, never rewrites the machine result.
select throws_ok($$select recording_review_analysis((select (body->>'analysis_id')::uuid from rf where name='a1'),'flag')$$,'22023','recording_reason_required','flag needs a note');
select recording_review_analysis((select (body->>'analysis_id')::uuid from rf where name='a1'),'approve','Matches the recording');
select is((recording_review_analysis((select (body->>'analysis_id')::uuid from rf where name='a1'),'edit','Personalisation was clear on the recording',
 '[{"key":"personalization_empathy","status":"assessed","rating":9,"reason":"Offered to hold designs for the family"}]')->>'reviewed_total')::numeric,77.65,'edit recomputes a reviewed total server-side');
select is((select raw_total from recording_analyses where id=(select (body->>'analysis_id')::uuid from rf where name='a1')),76.00,'machine total unchanged by review');
select is((select count(*)::integer from recording_analysis_reviews where analysis_id=(select (body->>'analysis_id')::uuid from rf where name='a1')),2,'reviews appended');
select is((select count(*)::integer from audit_logs where record_id=pg_temp.rid('session') and action in ('recording_analysis_approve','recording_analysis_edit')),2,'reviews audited');
select pg_temp.ract('rep');
select is(jsonb_array_length(recording_analysis_snapshot(pg_temp.rid('session'))->'analyses'),1,'employee sees reviewed analysis');
select is(recording_analysis_snapshot(pg_temp.rid('session'))->'analyses'->0->'reviews','null'::jsonb,'employee does not see manager review notes');
reset role;
select set_config('request.jwt.claims','',true);
select throws_ok($$update recording_analyses set raw_total=99 where id=(select (body->>'analysis_id')::uuid from rf where name='a1')$$,'42501','recording_history_immutable','analysis immutable even for the owner role');
select throws_ok($$delete from recording_transcript_segments where segment_id='10000000-0000-4000-8000-000000000001'$$,'42501','recording_history_immutable','original transcript cannot be deleted');

-- Correction: new revision, identity and offsets preserved, original kept, audited.
select pg_temp.ract('manager');
select throws_ok($$select recording_correct_transcript(pg_temp.rid('session'),(select (body->>'revision_id')::uuid from rf where name='fin'),'[{"segment_id":"10000000-0000-4000-8000-000000000004","speaker":"customer"}]',null)$$,'22023','recording_reason_required','correction needs a reason');
insert into rf(name,body) values('fix',recording_correct_transcript(pg_temp.rid('session'),(select (body->>'revision_id')::uuid from rf where name='fin'),
 '[{"segment_id":"10000000-0000-4000-8000-000000000004","speaker":"customer","raw_text":"Making charges thoda zyada lag rahe hain."}]','Customer voice on the recording'));
select is((select body->>'revision' from rf where name='fix'),'2','correction is revision 2');
select is((select speaker||'/'||speaker_source||'/'||start_ms||'/'||source_offset_ms from recording_transcript_segments where revision_id=(select (body->>'revision_id')::uuid from rf where name='fix') and segment_id='10000000-0000-4000-8000-000000000004'),'customer/manual/4800/800','speaker corrected, timestamps and offsets kept');
select is((select raw_text from recording_transcript_segments where revision_id=(select (body->>'revision_id')::uuid from rf where name='fin') and segment_id='10000000-0000-4000-8000-000000000004'),'Making charges thoda zyada lag raha hai.','original revision text preserved');
select is((select count(*)::integer from recording_transcript_segments where revision_id=(select (body->>'revision_id')::uuid from rf where name='fix')),6,'every segment carried forward');
select throws_ok($$select recording_correct_transcript(pg_temp.rid('session'),(select (body->>'revision_id')::uuid from rf where name='fin'),'[{"segment_id":"10000000-0000-4000-8000-000000000001","speaker":"customer"}]','Stale edit')$$,'40001','recording_revision_stale','stale base rejected');
select ok(exists(select 1 from audit_logs where record_id=pg_temp.rid('session') and action='recording_transcript_corrected' and old_value->'segments'->0->>'speaker'='unknown'),'correction audit keeps the original');
select ok(not exists(select 1 from audit_logs where record_id=pg_temp.rid('session') and action='recording_transcript_corrected' and (old_value::text like '%zyada%' or new_value::text like '%zyada%')),'audit carries no transcript text');
select is((select count(*)::integer from recording_analysis_jobs where session_id=pg_temp.rid('session')),1,'correction alone does not rescore');

-- Rescore: explicit, idempotent, previous analysis preserved.
insert into rf(name,body) values('rs',recording_request_rescore(pg_temp.rid('session'),null,null,null,null,'After speaker fix'));
select is((select body->>'already_requested' from rf where name='rs'),'false','rescore enqueued');
select is(recording_request_rescore(pg_temp.rid('session'))->>'job_id',(select body->>'job_id' from rf where name='rs'),'same inputs return the same job');
select pg_temp.rsrv();
select pg_temp.claim();
select is(pg_temp.job()->>'transcript_revision_id',(select body->>'revision_id' from rf where name='fix'),'rescore pins corrected revision');
insert into rf(name,body) values('a2',recording_analysis_ingest('analysis_submit',pg_temp.lease()||jsonb_build_object('result',jsonb_build_object('status_hint','insufficient_evidence','analyzer',pg_temp.analyzer(),'output','{}'::jsonb,'dimensions','[]'::jsonb))));
select is((select body->>'status' from rf where name='a2'),'insufficient_evidence','analyzer can decline to score');
select is((select raw_total from recording_analyses where id=(select (body->>'analysis_id')::uuid from rf where name='a2')),null,'no total when declined');
select is((select supersedes_id from recording_analyses where id=(select (body->>'analysis_id')::uuid from rf where name='a2')),(select (body->>'analysis_id')::uuid from rf where name='a1'),'new analysis links the one it supersedes');
select is((select count(*)::integer from recording_analyses where session_id=pg_temp.rid('session')),2,'previous analysis kept');

-- Fallback model is explicit and forces review.
select pg_temp.ract('manager');
select recording_request_rescore(pg_temp.rid('session'),null,null,null,'mk-sales-v1b','Prompt update');
select pg_temp.rsrv();
select pg_temp.claim();
insert into rf(name,body) values('a3',recording_analysis_ingest('analysis_submit',pg_temp.lease()||jsonb_build_object('result',jsonb_build_object('status_hint','scored','analyzer',pg_temp.analyzer(true),'output',pg_temp.output(),'dimensions',pg_temp.dimensions()))));
select is((select body->>'status' from rf where name='a3'),'needs_review','fallback model forces review');
select ok((select body->'status_reasons' ? 'fallback_model' from rf where name='a3'),'fallback reason recorded');
select is((select fallback_reason from recording_analyses where id=(select (body->>'analysis_id')::uuid from rf where name='a3')),'primary_unavailable','fallback logged, not silent');

-- SOP and rubric versions.
select pg_temp.ract('manager');
select throws_ok($$select recording_create_sop_version('Sales SOP','[{"clause_id":"MC-1","topic":"making_charges","text":"Explain making charges as a percentage of metal value."}]')$$,'42501','recording_rubric_denied','manager cannot author SOP versions');
select pg_temp.ract('admin');
insert into rf(name,body) values('sop',recording_create_sop_version('Sales SOP','[{"clause_id":"MC-1","topic":"making_charges","text":"Making charges are 12 to 18 percent depending on design."},{"clause_id":"HM-1","topic":"certification","text":"All gold is BIS hallmarked."}]'));
select throws_ok($$select recording_set_sop_status((select (body->>'id')::uuid from rf where name='sop'),'approved')$$,'42501','recording_sop_needs_second_reviewer','author cannot approve own SOP');
select pg_temp.ract('owner');
select is(recording_set_sop_status((select (body->>'id')::uuid from rf where name='sop'),'approved')->>'status','approved','second reviewer approves');
reset role;
select set_config('request.jwt.claims','',true);
select throws_ok($$update recording_sop_versions set clauses='[{"clause_id":"X","topic":"other","text":"changed"}]' where id=(select (body->>'id')::uuid from rf where name='sop')$$,'42501','recording_history_immutable','approved SOP text immutable');
select pg_temp.ract('admin');
select throws_ok($$select recording_create_rubric_version('Bad','[{"key":"greeting_sop","label":"Greeting","weight":90}]')$$,'22023','recording_invalid_rubric','weights must total 100');
insert into rf(name,body) values('rub',recording_create_rubric_version('MK Sales Score v2',jsonb_set(jsonb_set(recording_default_rubric_dimensions(),'{0,weight}','10'),'{6,weight}','15')));
select is((select body->>'status' from rf where name='rub'),'draft','new rubric starts as draft');
select is(recording_activate_rubric_version((select (body->>'id')::uuid from rf where name='rub'))->>'status','active','rubric activated');
select is((select status from recording_rubric_versions where tenant_id=pg_temp.rid('tenant') and version=1),'retired','previous rubric retired, not edited');
select is((select count(*)::integer from recording_rubric_versions where tenant_id=pg_temp.rid('tenant') and status='active'),1,'one active rubric');

-- Policy findings cite the pinned SOP; HIGH needs words from a verified employee.
select pg_temp.ract('manager');
insert into rf(name,body) values('rs2',recording_request_rescore(pg_temp.rid('session'),null,null,null,null,'New rubric and SOP'));
select pg_temp.rsrv();
select pg_temp.claim();
select is(pg_temp.job()->'sop'->>'version','1','approved SOP pinned on rescore');
select is(pg_temp.job()->'rubric'->>'version','2','active rubric pinned on rescore');
create function pg_temp.dims2() returns jsonb language sql as $$select jsonb_set(pg_temp.dimensions(),'{6}','{"key":"personalization_empathy","status":"not_applicable","rating":null,"reason":"Not applicable.","evidence":[]}')$$;
select throws_ok($$select recording_analysis_ingest('analysis_submit',pg_temp.lease()||jsonb_build_object('result',jsonb_build_object('status_hint','scored','analyzer',pg_temp.analyzer(),
 'output',jsonb_set(pg_temp.output(),'{policy_findings}',jsonb_build_array(jsonb_build_object('severity','high','clause_id','MC-1','statement','Contradicts the making-charge rule','evidence',jsonb_build_array(pg_temp.ev(4,'making charges thoda zyada'))))),'dimensions',pg_temp.dims2())))$$,
 '22023','recording_invalid_analysis','HIGH rejected when the words are not from a verified employee');
select throws_ok($$select recording_analysis_ingest('analysis_submit',pg_temp.lease()||jsonb_build_object('result',jsonb_build_object('status_hint','scored','analyzer',pg_temp.analyzer(),
 'output',jsonb_set(pg_temp.output(),'{policy_findings}',jsonb_build_array(jsonb_build_object('severity','medium','clause_id','NOPE-9','statement','Unknown clause','evidence',jsonb_build_array(pg_temp.ev(3,'22 carat hallmark'))))),'dimensions',pg_temp.dims2())))$$,
 '22023','recording_invalid_analysis','finding must cite an existing clause');
insert into rf(name,body) values('a4',recording_analysis_ingest('analysis_submit',pg_temp.lease()||jsonb_build_object('result',jsonb_build_object('status_hint','scored','analyzer',pg_temp.analyzer(),
 'output',jsonb_set(pg_temp.output(),'{policy_findings}',jsonb_build_array(jsonb_build_object('severity','high','clause_id','MC-1','statement','Quoted range matches; fixture for HIGH routing','evidence',jsonb_build_array(pg_temp.ev(3,'12 se 18 percent'))))),'dimensions',pg_temp.dims2()))));
select is((select body->>'status' from rf where name='a4'),'needs_review','HIGH finding always routes to review');
select ok((select body->'status_reasons' ? 'high_policy_finding' from rf where name='a4'),'review reason recorded');

-- Reprocess keeps the audio and re-queues transcription.
select pg_temp.ract('manager');
select throws_ok($$select recording_request_reprocess(pg_temp.rid('session'),'Better model')$$,'22023','recording_reprocess_unavailable','cannot reprocess while transcription is leased');
update recorder_jobs set state='dead',lease_until=null,error_reason='processing_failed' where session_id=pg_temp.rid('session') and kind='final';
select is(recording_request_reprocess(pg_temp.rid('session'),'GPU outage last night')->>'status','processing','dead transcription re-queued');
select is((select state||'/'||attempts from recorder_jobs where session_id=pg_temp.rid('session') and kind='final'),'pending/0','fresh attempts');
select ok(exists(select 1 from audit_logs where record_id=pg_temp.rid('session') and action='recording_reprocess_requested'),'reprocess audited');

-- Configuration needs developer authority.
select throws_ok($$select recording_configure_analysis(false)$$,'42501','recorder_config_denied','manager cannot switch analysis');
select pg_temp.ract('owner');
select is(recording_configure_analysis(true)->>'analysis_enabled','true','owner configures analysis');

-- Lease recovery and retention.
select pg_temp.ract('manager');
select recording_request_rescore(pg_temp.rid('session'),null,null,null,'mk-sales-v1c','Lease test');
select pg_temp.rsrv();
select pg_temp.claim();
update recording_analysis_jobs set lease_until=now()-interval '1 second' where id=(pg_temp.job()->>'id')::uuid;
select is((recording_analysis_ingest('analysis_reconcile','{}')->>'recovered_leases')::integer,1,'expired lease recovered');
select is((select state from recording_analysis_jobs where id=(pg_temp.job()->>'id')::uuid),'pending','job back in queue');
update recorder_sessions set expires_at=now()-interval '1 second' where id=pg_temp.rid('session');
select recording_analysis_ingest('analysis_reconcile','{}');
select is((select count(*)::integer from recording_transcript_revisions where session_id=pg_temp.rid('session')),0,'retention removes transcript revisions');
select is((select count(*)::integer from recording_analyses where session_id=pg_temp.rid('session')),0,'retention removes analyses with quotes');
select is((select count(*)::integer from recording_rubric_versions where tenant_id=pg_temp.rid('tenant')),2,'versioned rubrics are kept');

select * from finish();
rollback;
