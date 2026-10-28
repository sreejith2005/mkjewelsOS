begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values
 ('forms.manage','action',null,'{super_admin,admin,manager}',110),('fms.manage','action',null,'{super_admin,admin}',90) on conflict do nothing;
set local test.fms.defer_start='true';
set local test.fms.customer_integration='true';
\ir helpers/fms_visit_assignment_fixture.psql
select save_form_customer_mapping((select id from visit_assignment_fixture where name='form'),'{"schemaVersion":1,"enabled":true,"channel":"INSTAGRAM","identityScope":"synthetic-e2e","fields":[{"fieldKey":"customer_phone","mode":"both","destination":"primary_phone"},{"fieldKey":"instagram_handle","mode":"both","destination":"instagram"},{"fieldKey":"client_name","mode":"both","destination":"primary_name"},{"fieldKey":"budget","mode":"both","destination":"budget"},{"fieldKey":"requirement","mode":"both","destination":"requirement"},{"fieldKey":"contact_status","mode":"history","destination":"contact_outcome","contactConfirmedValues":["contacted"],"contactKind":"CALL","contactChannel":"PHONE"}]}');
create temporary table customer_start_request(request jsonb,fingerprint text,key uuid,result jsonb);
grant all on customer_start_request to authenticated;
insert into customer_start_request(request,key) select jsonb_build_object('kind','starter_form','starterAssignmentId',(select id from visit_assignment_fixture where name='starter'),'formTemplateId',(select id from visit_assignment_fixture where name='form'),
 'answers',jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='b'),'client_name','Synthetic enquiry','customer_phone','9876543210','instagram_handle','synthetic_enquiry','private_notes','Operational only')),gen_random_uuid();
update customer_start_request set fingerprint=preview_fms_work_transition(request)->>'fingerprint';
update customer_start_request set result=transition_fms_work_with_audit(request,key,'[]',fingerprint);
insert into visit_assignment_fixture select 'instance',(result->>'instanceId')::uuid from customer_start_request;
select is((select transition_fms_work_with_audit(request,key,'[]',fingerprint) from customer_start_request),(select result from customer_start_request),'starter retry returns exact original result');
reset role;
set constraints all immediate;
select is((select count(*)::integer from fms_instances where tenant_id=(select id from visit_assignment_fixture where name='tenant')),1,'retry creates one workflow');
select is((select count(*)::integer from form_submissions where tenant_id=(select id from visit_assignment_fixture where name='tenant')),1,'retry creates one original submission');
select is((select count(*)::integer from crm_sync.customer_events where source_type='form.submitted'),1,'starter creates one logical customer event');
select is((select assigned_to from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')),array[(select id from visit_assignment_fixture where name='b')],'existing introduction-call handoff reaches B');
select is((select payload->>'journeyKey' from crm_sync.customer_events where source_type='form.submitted'),(select id::text from visit_assignment_fixture where name='instance'),'deferred capture resolves newly created workflow');
select ok(not exists(select 1 from crm_sync.customer_events e cross join lateral jsonb_array_elements(e.payload->'answers') a where a->>'fieldKey' in ('private_notes','next_employee')),'operational answers do not cross projects');
set constraints all deferred;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
set local role authenticated;
select submit_fms_form_and_progress_with_audit((select id from visit_assignment_fixture where name='form'),jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c'),'client_name','Synthetic enquiry follow-up','budget',100000,'requirement','Synthetic necklace enquiry','contact_status','contacted'),
 'fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')),gen_random_uuid());
reset role;
set constraints all immediate;
select is((select assigned_to from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='demo')),array[(select id from visit_assignment_fixture where name='c')],'existing salesperson handoff reaches C');
select is((select count(*)::integer from crm_sync.customer_events where source_type='form.submitted'),2,'later stage adds a distinct submission event');
select is((select count(distinct payload->>'journeyKey')::integer from crm_sync.customer_events),1,'all contributions retain one workflow identity');
select ok(exists(select 1 from crm_sync.customer_events where source_type='stage.completed' and payload->>'actorId'=(select id::text from visit_assignment_fixture where name='b')),'actual completion actor is recorded independently');
select is((select status::text from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')),'completed','CRM delivery is not required for FMS completion');
select is((select count(*)::integer from crm_sync.customer_workflow_links),0,'undelivered work needs no invented CRM reference');
-- BEGIN standalone acknowledgement assertions
select count(*) from crm_sync_claim_customer_events(1);
select lives_ok($$select crm_sync_finish_customer_event(id,lease_token,'{"outcome":"accepted","client_id":"00000000-0000-0000-0000-000000000001"}',null) from crm_sync.customer_events where lease_token is not null$$,'workflow acknowledgement persists a verified opaque client link');
select is((select count(*)::integer from crm_sync.customer_workflow_links),1,'one workflow gets one customer reference');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
set local role authenticated;
select throws_ok($$select get_fms_customer_link((select id from visit_assignment_fixture where name='instance'))$$,'42501',null,'CRM link cannot expose a restricted workflow to an unrelated employee');
select throws_ok($$select get_fms_assigned_work_context((select id from visit_assignment_fixture where name='instance'),(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')))$$,'42501',null,'direct work RPC cannot bypass the same persisted workflow restriction');
reset role;
-- END standalone acknowledgement assertions

-- Private export extension uses the same requester and source-work authorization.
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values
 ('reports.export','action',null,'{super_admin,admin,manager,staff}',210),
 ('settings.manage_organization','action',null,'{super_admin,admin}',250),
 ('tasks.view_all','action',null,'{super_admin,admin}',251) on conflict do nothing;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
select set_config('request.jwt.claim.role','authenticated',true);
create temporary table customer_export_test(id uuid,layout uuid);
grant all on customer_export_test to authenticated;
set local role authenticated;
select lives_ok($$select customer_export_options((select id from visit_assignment_fixture where name='flow'))$$,'export choices reuse published source definitions');
insert into customer_export_test(layout) select save_customer_export_layout('Synthetic original stage',jsonb_build_object('flowId',(select id from visit_assignment_fixture where name='flow'),'questions',jsonb_build_array(jsonb_build_object('fieldKey','client_name','header','Original customer name'))));
select is(jsonb_array_length(get_customer_export_layouts()),1,'authorized exporter sees versioned layouts');
update customer_export_test set id=(request_customer_export('customer_answers',jsonb_build_object('layoutId',layout),gen_random_uuid())).id;
reset role;
-- The existing queue lease is fixture state; worker lifecycle is covered by its focused suite.
select set_config('request.jwt.claim.role','service_role',true);
update export_logs set status='processing',started_at=now(),claimed_by='20261027-aaaa-4000-8000-000000000001',claim_expires_at=now()+interval '10 minutes' where id=(select id from customer_export_test);
select is(jsonb_array_length(get_report_export_batch((select id from customer_export_test),0,10)->'rows'),2,'private stage export retains both original submissions');
select is((select row->>'q:client_name' from jsonb_array_elements(get_report_export_batch((select id from customer_export_test),0,10)->'rows')row where row->>'actor_id'=(select id::text from visit_assignment_fixture where name='a')),'Synthetic enquiry','stage export uses original answer rather than latest CRM projection');
select is(get_report_export_batch((select id from customer_export_test),0,10)#>>'{columns,6,label}','Original customer name','reviewed stable question layout controls headers');
select is(get_report_export_batch((select id from customer_export_test),0,10)#>>'{rows,0,details,formSnapshot,template,id}',(select id::text from visit_assignment_fixture where name='form'),'stage export retains pinned form snapshot');
select ok(not has_function_privilege('authenticated','get_report_export_batch(uuid,integer,integer)','EXECUTE'),'browser cannot retrieve arbitrary export worker batches');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok($$select save_customer_export_layout('Denied','{}')$$,'42501',null,'ordinary exporter cannot define administrator layouts');
reset role;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
set local role authenticated;
select cancel_fms_instance_with_audit((select id from visit_assignment_fixture where name='instance'),'Synthetic lifecycle check');
reset role;
set constraints all immediate;
select ok(exists(select 1 from crm_sync.customer_events where payload->>'eventId' like 'jewelos.lifecycle.%' and payload#>>'{workflow,action}'='fms_instance_cancel'),'existing audited cancellation creates durable lifecycle evidence');


select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
set local role authenticated;
select is((reconcile_customer_submissions((get_form_customer_mapping((select id from visit_assignment_fixture where name='form'))->>'id')::uuid,(select array_agg(id) from form_submissions),false,null)->>'existing')::integer,2,'historical dry run recognizes already emitted original source identities');
select throws_ok($$select reconcile_customer_submissions((get_form_customer_mapping((select id from visit_assignment_fixture where name='form'))->>'id')::uuid,(select array_agg(id) from form_submissions),true,repeat('0',64))$$,'40001',null,'historical apply refuses an unreviewed or changed source fingerprint');
reset role;


select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
set local role authenticated;
insert into visit_assignment_fixture(name,id) select 'exceptions_export',(request_customer_export('customer_exceptions','{}',gen_random_uuid())).id;
reset role;
update export_logs set status='processing' where id=(select id from visit_assignment_fixture where name='exceptions_export');
select set_config('request.jwt.claim.role','service_role',true);
select is(jsonb_array_length(get_report_export_batch((select id from visit_assignment_fixture where name='exceptions_export'),0,2)->'localRows'),2,'exception export includes bounded source delivery failures without customer answers');
select ok((get_report_export_batch((select id from visit_assignment_fixture where name='exceptions_export'),0,2)->>'localTotal')::integer>=2,'combined exception adapter retains source total');
select ok(not exists(select 1 from jsonb_array_elements(get_report_export_batch((select id from visit_assignment_fixture where name='exceptions_export'),0,2)->'localRows')r where r->'details' ? 'answers'),'source exception export excludes original answer payloads');

select * from finish();
rollback;
