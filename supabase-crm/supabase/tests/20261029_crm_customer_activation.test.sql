begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_function_privilege('anon','configure_customer_contributors(uuid,boolean,text)','EXECUTE'),'anonymous cannot change contributor authority');
select ok(not has_function_privilege('authenticated','crm_private.customer_contribution_allowed(uuid,uuid,uuid,uuid)','EXECUTE'),'browser cannot call the contribution check');

insert into branches(id,name,jewelos_branch_id) values
 ('20261029-0000-4000-8000-000000000001','Activation A','20261029-0000-4000-8000-000000000001'),
 ('20261029-0000-4000-8000-000000000002','Activation B','20261029-0000-4000-8000-000000000002');
insert into users(id,name,email,role,branch_id,active) values
 ('20261029-1111-4000-8000-000000000001','Activation salesperson','activation-sales@example.invalid','salesperson','20261029-0000-4000-8000-000000000001',true),
 ('20261029-1111-4000-8000-000000000002','Activation admin','activation-admin@example.invalid','super_admin',null,true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id) select id,email,id,id from users where email like 'activation-%@example.invalid';
-- Two roster members exist only in JewelOS: one active, one who has left.
insert into crm_private.master_members(jewelos_user_id,tenant_id,snapshot_at,active) values
 ('20261029-1111-4000-8000-000000000001','20261029-9999-4000-8000-000000000001',now(),true),
 ('20261029-1111-4000-8000-000000000002','20261029-9999-4000-8000-000000000001',now(),true),
 ('20261029-2222-4000-8000-000000000001','20261029-9999-4000-8000-000000000001',now(),true),
 ('20261029-2222-4000-8000-000000000002','20261029-9999-4000-8000-000000000001',now(),false);
insert into crm_private.customer_sources(tenant_id,enabled,approved_by,approved_at) values('20261029-9999-4000-8000-000000000001',true,'20261029-1111-4000-8000-000000000002',now());
-- An existing store client of branch B.
insert into clients(primary_name,primary_phone,last_branch_id,lifecycle_stage)
values('Activation store client',crm_private.as_phone_input(crm_private.phone_key('9876500001')),'20261029-0000-4000-8000-000000000002','visited');

create temporary table activation_mapping(descriptor jsonb,digest text);
insert into activation_mapping(descriptor) values('{"schemaVersion":1,"sourceProject":"jewelos","tenantId":"20261029-9999-4000-8000-000000000001","templateId":"20261029-3333-4000-8000-000000000001","templateVersion":1,"formName":"Activation enquiry","identityScope":"activation","channel":"INSTAGRAM","fields":[{"fieldKey":"name","label":"Name","type":"text","mode":"both","destination":"primary_name"},{"fieldKey":"phone","label":"Phone","type":"phone","mode":"both","destination":"primary_phone"}]}');
update activation_mapping set digest=encode(digest(descriptor::text,'sha256'),'hex');
select set_config('request.jwt.claim.role','service_role',true);
select is((select crm_register_customer_mapping('20261029-4444-4000-8000-000000000001',descriptor,digest)->>'outcome' from activation_mapping),'mapping_unapproved','registration alone does not approve');
update crm_private.customer_mapping_registry set approved_at=now(),approved_by='20261029-1111-4000-8000-000000000002' where mapping_id='20261029-4444-4000-8000-000000000001';
create function pg_temp.event(p_event text,p_actor uuid,p_phone text,p_journey uuid) returns jsonb language sql as $$
 select jsonb_build_object('schemaVersion',1,'sourceProject','jewelos','eventId',p_event,'eventType','form.submitted',
 'tenantId','20261029-9999-4000-8000-000000000001','branchId','20261029-0000-4000-8000-000000000001','actorId',p_actor,'actorName','Synthetic employee',
 'journeyKey',p_journey,'occurredAt','2026-10-12Z','mappingId','20261029-4444-4000-8000-000000000001','mappingDigest',(select digest from activation_mapping),
 'answers',jsonb_build_array(jsonb_build_object('fieldKey','name','label','Name','type','text','mode','both','destination','primary_name','original','Synthetic person','normalized','Synthetic person'),
  jsonb_build_object('fieldKey','phone','label','Phone','type','phone','mode','both','destination','primary_phone','original',p_phone,'normalized',p_phone)));
$$;

-- Default: the original rules hold.
select is(crm_apply_customer_event('activation.roster',pg_temp.event('activation.roster','20261029-2222-4000-8000-000000000001','9876500002','20261029-5555-4000-8000-000000000001'))->>'reason','actor_or_branch_denied','roster member without CRM login is held by default');
select is(crm_apply_customer_event('activation.cross',pg_temp.event('activation.cross','20261029-1111-4000-8000-000000000001','9876500001','20261029-5555-4000-8000-000000000002'))->>'reason','customer_branch_denied','salesperson cannot append to another branch customer by default');
select is((select count(*)::integer from clients),1,'held events create no customer');

-- Only a CRM super admin can switch contributor authority, with a reason.
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','20261029-1111-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$select configure_customer_contributors('20261029-9999-4000-8000-000000000001',true,'trying')$$,'42501',null,'salesperson cannot grant contributor authority');
select set_config('request.jwt.claim.sub','20261029-1111-4000-8000-000000000002',true);
select throws_ok($$select configure_customer_contributors('20261029-9999-4000-8000-000000000001',true,'  ')$$,'22023',null,'a reason is required');
select throws_ok($$select configure_customer_contributors('20261029-9999-4000-8000-000000000099',true,'unknown source')$$,'23514',null,'an unapproved source cannot get contributors');
select lives_ok($$select configure_customer_contributors('20261029-9999-4000-8000-000000000001',true,'Instagram team has no CRM logins; owner approved 2026-10-29')$$,'super admin enables roster contributors');
select is((select (s->>'roster_contributors')::boolean from jsonb_array_elements(customer_integration_review_queue()->'sources') s),true,'review queue shows the source switch');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select is((select count(*)::integer from crm_private.audit_logs where action='crm.customer_contributors_configured'),1,'switch is audited');

-- The same held events now complete, attributed to the JewelOS employee.
select is(crm_apply_customer_event('activation.roster',pg_temp.event('activation.roster','20261029-2222-4000-8000-000000000001','9876500002','20261029-5555-4000-8000-000000000001'))->>'outcome','accepted','roster contribution is accepted after the switch');
select is((select actor_id is null and source_actor_id='20261029-2222-4000-8000-000000000001' and provenance->>'authority'='roster_contributor' from crm_customer_workflow_events where event_id='activation.roster'),true,'roster contribution keeps the employee and marks its authority');
select is(crm_apply_customer_event('activation.cross',pg_temp.event('activation.cross','20261029-1111-4000-8000-000000000001','9876500001','20261029-5555-4000-8000-000000000002'))->>'outcome','accepted','cross-branch salesperson contribution is accepted');
select is((select count(*)::integer from clients),2,'existing store client was reused, one new lead created');
select is((select c.lifecycle_stage::text from clients c join crm_customer_workflow_events e using(client_id) where e.event_id='activation.cross'),'visited','existing client keeps its classification');
select is((select primary_name from clients c join crm_customer_workflow_events e using(client_id) where e.event_id='activation.cross'),'Activation store client','existing client name is not overwritten');
select is((select provenance->>'authority' from crm_customer_workflow_events where event_id='activation.cross'),'roster_contributor','cross-branch authority is recorded');

-- People who left, unmapped branches and unapproved mappings stay blocked.
select is(crm_apply_customer_event('activation.left',pg_temp.event('activation.left','20261029-2222-4000-8000-000000000002','9876500003','20261029-5555-4000-8000-000000000003'))->>'reason','actor_or_branch_denied','inactive roster member stays blocked');
select is(crm_apply_customer_event('activation.branch',pg_temp.event('activation.branch','20261029-2222-4000-8000-000000000001','9876500004','20261029-5555-4000-8000-000000000004')||'{"branchId":"20261029-0000-4000-8000-000000000099"}')->>'reason','actor_or_branch_denied','unmapped branch stays blocked');
update crm_private.customer_sources set enabled=false;
select is(crm_apply_customer_event('activation.off',pg_temp.event('activation.off','20261029-2222-4000-8000-000000000001','9876500005','20261029-5555-4000-8000-000000000005'))->>'outcome','source_unapproved','disabled source blocks contributors too');
select is((select count(*)::integer from clients),2,'blocked events create no customer');
select * from finish();
rollback;
