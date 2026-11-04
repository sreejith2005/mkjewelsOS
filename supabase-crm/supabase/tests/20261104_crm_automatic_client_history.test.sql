begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into branches(id,name,jewelos_branch_id) values('20261104-0000-4000-8000-0000000000a1','Synthetic History','20261104-0000-4000-8000-0000000000b1');
insert into users(id,name,email,role,branch_id,active) values
 ('20261104-1111-4000-8000-0000000000a1','History CRM','history-crm@example.invalid','salesperson','20261104-0000-4000-8000-0000000000a1',true),
 ('20261104-1111-4000-8000-0000000000a2','History admin','history-admin@example.invalid','super_admin',null,true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id) select id,email,id,id from users where email like 'history-%@example.invalid';
insert into crm_private.master_members(jewelos_user_id,tenant_id,snapshot_at,active) select id,'20261104-9999-4000-8000-0000000000a1',now(),true from users where email like 'history-%@example.invalid';
insert into crm_private.customer_sources values('20261104-9999-4000-8000-0000000000a1',true,'20261104-1111-4000-8000-0000000000a2',now());
insert into clients(client_id,primary_name,primary_phone,primary_phone_country_code,city,last_branch_id,lifecycle_stage)
 values('20261104-2222-4000-8000-0000000000a1','Asha History','9876543210','+91','Kochi','20261104-0000-4000-8000-0000000000a1','visited');

create temporary table m(k text primary key,descriptor jsonb,digest text);
insert into m(k,descriptor) values
 ('auto','{"schemaVersion":1,"sourceProject":"jewelos","tenantId":"20261104-9999-4000-8000-0000000000a1","templateId":"20261104-3333-4000-8000-0000000000a1","templateVersion":1,"formName":"Follow-up call","channel":"JEWELOS_FORM","identityScope":"jewelos-forms","automatic":true,"identityField":"client_mobile","mappingVersion":1,
   "fields":[{"fieldKey":"client_mobile","label":"Mobile","type":"phone","mode":"profile","destination":"primary_phone"},{"fieldKey":"spoke","label":"Did they pick up?","type":"text","mode":"history","destination":"note"},{"fieldKey":"town","label":"City","type":"text","mode":"history","destination":"note"}]}'),
 -- Marked automatic but would change the profile: it must still wait for a CRM super admin.
 ('fake','{"schemaVersion":1,"sourceProject":"jewelos","tenantId":"20261104-9999-4000-8000-0000000000a1","templateId":"20261104-3333-4000-8000-0000000000a2","templateVersion":1,"channel":"JEWELOS_FORM","identityScope":"jewelos-forms","automatic":true,"identityField":"client_mobile",
   "fields":[{"fieldKey":"client_mobile","label":"Mobile","type":"phone","mode":"profile","destination":"primary_phone"},{"fieldKey":"town","label":"City","type":"text","mode":"profile","destination":"city"}]}');
update m set digest=encode(digest(descriptor::text,'sha256'),'hex');
create function pg_temp.event(p_event text,p_phone text,p_mapping uuid default '20261104-4444-4000-8000-0000000000a1',p_key text default 'auto') returns jsonb language sql as $$
 select jsonb_build_object('schemaVersion',1,'sourceProject','jewelos','eventId',p_event,'eventType','form.submitted','submissionId',gen_random_uuid(),
 'tenantId','20261104-9999-4000-8000-0000000000a1','branchId','20261104-0000-4000-8000-0000000000b1','actorId','20261104-1111-4000-8000-0000000000a1',
 'journeyKey',gen_random_uuid(),'occurredAt','2026-11-04Z','mappingId',p_mapping,'mappingDigest',(select digest from m where k=p_key),'actorName','History CRM',
 'answers',jsonb_build_array(
   jsonb_build_object('fieldKey','client_mobile','label','Mobile','type','phone','mode','profile','destination','primary_phone','original',p_phone,'normalized',p_phone),
   jsonb_build_object('fieldKey','spoke','label','Did they pick up?','type','text','mode','history','destination','note','original','Yes, visiting Saturday','normalized','Yes, visiting Saturday'),
   jsonb_build_object('fieldKey','town','label','City','type','text','mode','history','destination','note','original','Thrissur','normalized','Thrissur')));
$$;

select set_config('request.jwt.claim.role','service_role',true);
select is((select crm_register_customer_mapping('20261104-4444-4000-8000-0000000000a1',descriptor,digest)->>'outcome' from m where k='auto'),'accepted','an automatic history mapping is approved when it is registered');
select is((select crm_register_customer_mapping('20261104-4444-4000-8000-0000000000a2',descriptor,digest)->>'outcome' from m where k='fake'),'mapping_unapproved','a mapping that would change the profile still waits for a CRM super admin');

-- A known client's number adds the answers to that client's history, without touching the profile.
create temporary table r(k text primary key,v jsonb);
insert into r select 'known', crm_apply_customer_event('jewelos.form.auto1',pg_temp.event('jewelos.form.auto1','+919876543210'));
select is((select v->>'outcome' from r where k='known'),'accepted','a form with a registered client''s number is accepted');
select is((select v->>'client_id' from r where k='known'),'20261104-2222-4000-8000-0000000000a1','and attached to that client');
select is((select (v->>'created')::boolean from r where k='known'),false,'no client is created');
select is((select jsonb_array_length(answers) from crm_customer_workflow_events where event_id='jewelos.form.auto1'),3,'every answer is in the client''s history');
select is((select city from clients where client_id='20261104-2222-4000-8000-0000000000a1'),'Kochi','the profile is not changed by a history answer');
select is((select count(*)::int from crm_private.customer_attribute_projection where event_id='jewelos.form.auto1'),0,'no profile values are projected from an automatic event');

-- An unknown number is skipped: no client, nothing to review.
insert into r select 'unknown', crm_apply_customer_event('jewelos.form.auto2',pg_temp.event('jewelos.form.auto2','+919000000099'));
select is((select v->>'outcome' from r where k='unknown'),'rejected','a number that belongs to no client is skipped');
select is((select v->>'reason' from r where k='unknown'),'automatic_no_client','with the reason');
select is((select count(*)::int from clients where primary_phone='9000000099'),0,'no client is created from it');
select ok((select review_reason is null and applied_at is not null from crm_private.customer_event_inbox where event_id='jewelos.form.auto2'),'it is not put in the identity review queue');
select is(crm_apply_customer_event('jewelos.form.auto2',(select payload from crm_private.customer_event_inbox where event_id='jewelos.form.auto2'))->>'outcome','rejected','a replay gives the same answer');

-- Another branch's staff cannot write that client: skipped, not reviewed.
insert into r select 'branch', crm_apply_customer_event('jewelos.form.auto3',pg_temp.event('jewelos.form.auto3','+919876543210')||'{"branchId":"20261104-0000-4000-8000-0000000000ff"}');
select is((select v->>'reason' from r where k='branch'),'automatic_actor_or_branch_denied','an event from an unknown branch is skipped with its reason');

-- The approved, non-automatic path is unchanged: an unapproved mapping still waits.
select is(crm_apply_customer_event('jewelos.form.fake1',pg_temp.event('jewelos.form.fake1','+919876543210','20261104-4444-4000-8000-0000000000a2','fake'))->>'outcome','mapping_unapproved','events of a mapping waiting for approval still wait');

select * from finish();
rollback;
