begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Contract surface: the wrappers run as the caller; only the replay check and link record are privileged.
select is((select prosecdef from pg_proc where oid='public.register_walkin_entry_from_form(uuid,text,text,uuid,jsonb)'::regprocedure), false, 'queue registration from a form runs with the caller''s rights');
select is((select prosecdef from pg_proc where oid='public.save_crm_lead_from_form(uuid,text,text,jsonb,jsonb)'::regprocedure), false, 'lead registration from a form runs with the caller''s rights');
select is((select prosecdef from pg_proc where oid='public.submit_walkin_visit_from_form(uuid,jsonb,jsonb)'::regprocedure), false, 'the walk-in visit from a form runs with the caller''s rights');
select ok(has_function_privilege('authenticated','submit_walkin_visit_from_form(uuid,jsonb,jsonb)','EXECUTE'), 'CRM users can save a walk-in through a linked form');
select ok(not has_function_privilege('anon','submit_walkin_visit_from_form(uuid,jsonb,jsonb)','EXECUTE') and not has_function_privilege('anon','crm_record_form_submission(uuid,text,text,jsonb,jsonb,jsonb,text,uuid,uuid,jsonb)','EXECUTE'), 'anonymous callers cannot save or link');

insert into branches(id,name,jewelos_branch_id) values('20261104-0000-4000-8000-000000000001','Synthetic Walk-in Branch','20261104-0000-4000-8000-0000000000aa');
insert into auth.users(id,email) values ('20261104-1111-4000-8000-000000000001','walkin-staff@example.invalid');
insert into users(id,name,email,role,branch_id,active) values ('20261104-1111-4000-8000-000000000001','WALKIN STAFF','walkin-staff@example.invalid','salesperson','20261104-0000-4000-8000-000000000001',true);
insert into crm_sso_access_grants(jewelos_user_id,legacy_crm_user_id,crm_auth_user_id,work_email,active) select id,id,id,email,true from users where email='walkin-staff@example.invalid';
insert into crm_private.master_members(jewelos_user_id,tenant_id,snapshot_at,active) select id,'20261104-9999-4000-8000-000000000001',now(),true from users where email='walkin-staff@example.invalid';
insert into crm_allocation(branch_id,crm_name,crm_user_id,active) values('20261104-0000-4000-8000-000000000001','WALKIN STAFF','20261104-1111-4000-8000-000000000001',true);

create temp table out(k text primary key, v jsonb);
grant all on out to authenticated;
create function pg_temp.src() returns jsonb language sql immutable as $$
 select jsonb_build_object('formFamilyId','20261104-5555-4000-8000-000000000001','formTemplateId','20261104-5555-4000-8000-000000000002','formVersion',1,'bindingVersionId','20261104-5555-4000-8000-000000000003','answers','{"answers":{"visit_status":"store_visit","custom_interest":"rings"},"display":{"visit_status":"STORE VISIT"}}'::jsonb) $$;
grant execute on function pg_temp.src() to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"20261104-1111-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','20261104-1111-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

-- Queue registration still works through the caller-rights wrapper, and a replay returns the first entry.
insert into out select 'q', register_walkin_entry_from_form('20261104-7777-4000-8000-000000000001','Walkin Form Client','+919100700001','20261104-0000-4000-8000-000000000001',pg_temp.src());
select is((register_walkin_entry_from_form('20261104-7777-4000-8000-000000000001','Walkin Form Client','+919100700001','20261104-0000-4000-8000-000000000001',pg_temp.src()))->>'id', (select v->>'id' from out where k='q'), 'a replayed queue registration returns the first entry');

-- The walk-in visit for that queue entry, through submit_walkin_visit unchanged.
create function pg_temp.visit() returns jsonb language sql stable as $$
 select jsonb_build_object('entry_queue_id',(select v->>'id' from out where k='q'),'client_id',(select v->>'client_id' from out where k='q'),
   'branch_id','20261104-0000-4000-8000-000000000001','primary_name','Walkin Form Client','primary_phone','+919100700001','billing_phone','+919100700001',
   'crm_name','WALKIN STAFF','visit_status','STORE_VISIT','did_buy',false) $$;
grant execute on function pg_temp.visit() to authenticated;
insert into out select 'w', submit_walkin_visit_from_form('20261104-7777-4000-8000-000000000002',pg_temp.visit(),pg_temp.src());
select ok((select v->>'timeline_id' is not null and (v->>'replayed')::boolean = false from out where k='w'), 'the walk-in visit is saved through submit_walkin_visit');
select is((submit_walkin_visit_from_form('20261104-7777-4000-8000-000000000002',pg_temp.visit(),pg_temp.src()))->>'timeline_id', (select v->>'timeline_id' from out where k='w'), 'a replayed walk-in returns the first visit');
select throws_ok($$select submit_walkin_visit_from_form('20261104-7777-4000-8000-000000000002',pg_temp.visit()||'{"remark":"changed"}',pg_temp.src())$$, '23505', null, 'the same key with different answers is refused');
select throws_ok($$select submit_walkin_visit_from_form(gen_random_uuid(),'[]'::jsonb,pg_temp.src())$$, '22023', null, 'the walk-in details must be an object');
insert into out select 'wno', submit_walkin_visit_from_form('20261104-7777-4000-8000-000000000003',
  (pg_temp.visit()-'entry_queue_id')||'{"visit_status":"NO"}'::jsonb,
  jsonb_set(pg_temp.src(),'{answers,answers,visit_status}','"no"'::jsonb));

-- The link helper only accepts a record the same request created: a visit saved in an earlier
-- request (simulated by moving its time back) cannot be linked by hand.
reset role;
update client_timeline set created_at=now()-interval '1 hour' where id=(select (v->>'timeline_id')::uuid from out where k='w');
set local role authenticated;
select throws_ok(format('select crm_record_form_submission(gen_random_uuid(),%L,%L,%L::jsonb,%L::jsonb,%L::jsonb,%L,%L,null,%L::jsonb)',
  'walkin','x',pg_temp.src(),'{}','{}','visit',(select v->>'timeline_id' from out where k='w'),'{}'), '42501', 'Only a record saved by this submission can be linked to it', 'an earlier visit cannot be linked by hand');
reset role;
select is((select count(*)::int from client_timeline where id=(select (v->>'timeline_id')::uuid from out where k='w')), 1, 'one visit for the replayed submission');
select is((select status from entry_queue where id=(select (v->>'id')::uuid from out where k='q')), 'complete', 'the queue entry is completed as with the standard form');
select is((select record_type||':'||purpose from crm_private.form_submission_links where submission_key='20261104-7777-4000-8000-000000000002'), 'visit:walkin', 'the link points at the visit');
select is((select count(*)::int from crm_private.form_submission_links where submission_key in ('20261104-7777-4000-8000-000000000001','20261104-7777-4000-8000-000000000002')), 2, 'each submission is linked once');

set constraints all immediate;
select is((select payload#>>'{answers,visit_status}' from crm_private.submission_outbox where kind='crm.form_submission_saved' and record_id='20261104-7777-4000-8000-000000000002'), 'store_visit', 'walk-in event carries the original stored question value, not the derived purchase boolean');
select is((select payload#>>'{form,purpose}' from crm_private.submission_outbox where kind='crm.form_submission_saved' and record_id='20261104-7777-4000-8000-000000000002'), 'walkin', 'walk-in event identifies its linked form purpose');
select is((select payload#>>'{answers,custom_interest}' from crm_private.submission_outbox where kind='crm.form_submission_saved' and record_id='20261104-7777-4000-8000-000000000001'), 'rings', 'queue answers are flat question keys too');
select ok(not exists(select 1 from crm_private.submission_outbox where kind='crm.form_submission_saved' and (payload->'answers' ? 'display' or payload->'answers' ? 'answers')), 'display labels and nested envelopes do not replace stored answers');
select is((select payload->>'jewelos_branch_id' from crm_private.submission_outbox where kind='crm.form_submission_saved' and record_id='20261104-7777-4000-8000-000000000002'),'20261104-0000-4000-8000-0000000000aa','linked walk-in keeps its branch scope');
select is((select payload->>'staff_jewelos_user_id' from crm_private.submission_outbox where kind='crm.form_submission_saved' and record_id='20261104-7777-4000-8000-000000000002'),'20261104-1111-4000-8000-000000000001','linked walk-in resolves its salesperson');
select is((select payload->>'case_id' from crm_private.submission_outbox where kind='crm.form_submission_saved' and record_id='20261104-7777-4000-8000-000000000003'),
  (select id::text from not_bought_followups where client_id=(select (v->>'client_id')::uuid from out where k='wno') and not public.not_bought_followup_status_is_done(status)),
  'linked walk-in carries its durable Not Bought case');

select * from finish();
rollback;
