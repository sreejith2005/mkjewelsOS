begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values('forms.manage','action',null,'{super_admin,admin,manager}',110),('settings.manage_organization','action',null,'{super_admin,admin}',250) on conflict do nothing;

-- Grants: workers only for the service role; status reads only for signed-in staff.
select ok(not has_function_privilege('authenticated','crm_sync_claim_customer_mappings(integer)','EXECUTE'),'browser cannot claim mapping registrations');
select ok(not has_function_privilege('authenticated','crm_sync_record_customer_mapping(uuid,text)','EXECUTE'),'browser cannot record a CRM approval');
select ok(has_function_privilege('service_role','crm_sync_record_customer_mapping(uuid,text)','EXECUTE'),'worker records CRM approval answers');
select ok(not has_function_privilege('anon','get_fms_customer_sync_status(uuid)','EXECUTE'),'anonymous cannot read workflow sync state');
select ok(not has_function_privilege('anon','customer_integration_overview()','EXECUTE'),'anonymous cannot read the integration overview');
select ok(not has_table_privilege('authenticated','crm_sync.customer_mapping_registrations','SELECT'),'browser cannot read raw registrations');

create temporary table activation_fixture(name text primary key,id uuid);
grant all on activation_fixture to authenticated;
do $$declare t uuid;b uuid;d uuid;a uuid;u uuid;f uuid;begin
 insert into tenants(name,slug) values('Synthetic activation','synthetic-activation') returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Synthetic branch','ACT') returning id into b;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Synthetic department','ACT') returning id into d;
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
 values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','activation@test.local','x',now(),now()) returning id into a;
 insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
 values(t,a,b,d,'Synthetic administrator','ACT','activation@test.local','admin','active',true) returning id into u;
 insert into form_templates(tenant_id,name,lifecycle,permissions) values(t,'Synthetic Instagram enquiry','published','{"roles":["admin"]}') returning id into f;
 insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown,is_editable)
 values(f,'name','Customer name','text',0,true,true,true),(f,'instagram','Instagram ID','text',1,false,true,true);
 insert into activation_fixture values('tenant',t),('auth',a),('form',f);
end$$;
select set_config('request.jwt.claim.sub',(select id::text from activation_fixture where name='auth'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select is((select f->>'setup' from jsonb_array_elements(customer_integration_overview()->'forms') f where f->>'templateId'=(select id::text from activation_fixture where name='form')),null,'a form with no mapping and no FMS use is not listed');
select lives_ok($$select save_form_customer_mapping((select id from activation_fixture where name='form'),'{"schemaVersion":1,"enabled":true,"channel":"INSTAGRAM","identityScope":"mk-instagram","fields":[{"fieldKey":"name","mode":"both","destination":"primary_name"},{"fieldKey":"instagram","mode":"both","destination":"instagram"}]}')$$,'author enables a mapping');
select is((select f->>'setup' from jsonb_array_elements(customer_integration_overview()->'forms') f where f->>'templateId'=(select id::text from activation_fixture where name='form')),'awaiting_crm_approval','saved mapping waits for CRM approval');
reset role;

-- Pre-registration: the CRM can approve before any submission exists.
select is((select count(*)::integer from crm_sync_claim_customer_mappings(10)),1,'enabled mapping is offered for registration without an event');
select is((select descriptor->>'formName' from crm_sync_claim_customer_mappings(10)),'Synthetic Instagram enquiry','descriptor names the form for the approver');
select is(crm_sync_record_customer_mapping((select id from form_customer_mapping_versions limit 1),'source_unapproved'),0,'unapproved answer releases nothing');
select is((select count(*)::integer from crm_sync_claim_customer_mappings(10)),0,'unapproved mapping is rechecked later, not every call');
select throws_ok($$select crm_sync_record_customer_mapping((select id from form_customer_mapping_versions limit 1),'approved_by_me')$$,'22023',null,'unknown CRM outcome is refused');

-- A submission delivered before approval is held, then released by the approval.
set local role authenticated;
insert into activation_fixture select 'submission',submit_form_with_audit((select id from activation_fixture where name='form'),'{"name":"Synthetic lead","instagram":"synthetic.lead"}',null,null);
reset role;
set constraints all immediate;
select is((select count(*)::integer from crm_sync_claim_customer_events(10)),1,'submission emits one claimable event');
select is((select crm_sync_finish_customer_event(id,lease_token,'{"outcome":"mapping_unapproved"}',null) from crm_sync.customer_events),'review','approval answer holds the event');
select is((select count(*)::integer from crm_sync_claim_customer_events(10)),0,'held event is not re-sent before approval');
select is((select next_check_at<=now() from crm_sync.customer_mapping_registrations),true,'held event asks the registration to look again');
select is(crm_sync_record_customer_mapping((select id from form_customer_mapping_versions limit 1),'accepted'),1,'CRM approval releases the held event');
select is((select count(*)::integer from audit_logs where action='customer_mapping_crm_status'),2,'each CRM status change is audited');
select is((select review_at is null and attempts=0 and last_error is null from crm_sync.customer_events),true,'released event is fresh again');

-- An identity review is re-offered on its own; the CRM decision completes the link.
select is((select crm_sync_finish_customer_event(id,lease_token,'{"outcome":"review","reason":"ambiguous_phone"}',null) from crm_sync_claim_customer_events(10)),'review','identity review is recorded');
select is((select last_error from crm_sync.customer_events),'ambiguous_phone','review reason is kept as a code');
select is((select next_attempt_at between now()+interval '29 minutes' and now()+interval '31 minutes' from crm_sync.customer_events),true,'identity review is rechecked in 30 minutes');
select is((select count(*)::integer from crm_sync_claim_customer_events(10)),0,'review is not re-sent early');
update crm_sync.customer_events set next_attempt_at=now()-interval '1 second';
select is((select crm_sync_finish_customer_event(id,lease_token,'{"outcome":"accepted","client_id":"00000000-0000-0000-0000-0000000000a1"}',null) from crm_sync_claim_customer_events(10)),'delivered','reviewed event links without a manual JewelOS retry');
select is((select review_at is null and delivered_at is not null from crm_sync.customer_events),true,'link clears the earlier review state');

-- A stage event waiting for its starting form is not retired after ten attempts.
set local role authenticated;
insert into activation_fixture select 'second',submit_form_with_audit((select id from activation_fixture where name='form'),'{"name":"Synthetic second lead"}',null,null);
reset role;
set constraints all immediate;
update crm_sync.customer_events set attempts=11 where source_id=(select id from activation_fixture where name='second');
select is((select crm_sync_finish_customer_event(id,lease_token,null,'dependency_pending') from crm_sync_claim_customer_events(10)),'retry','waiting dependency keeps retrying');
select is((select dead_at is null and next_attempt_at<=now()+interval '30 minutes 1 second' from crm_sync.customer_events where source_id=(select id from activation_fixture where name='second')),true,'dependency backoff is capped at 30 minutes');
update crm_sync.customer_events set next_attempt_at=now()-interval '1 second' where source_id=(select id from activation_fixture where name='second');
select is((select crm_sync_finish_customer_event(id,lease_token,null,'http_503') from crm_sync_claim_customer_events(10)),'dead','ordinary failures still stop after ten attempts');

-- A revised form offers the previous mapping, and the overview says re-approval is needed.
update form_templates set lifecycle='archived',is_active=false where id=(select id from activation_fixture where name='form');
insert into form_templates(tenant_id,family_id,version,name,lifecycle,is_active,permissions)
select tenant_id,family_id,version+1,name,'published',true,permissions from form_templates where id=(select id from activation_fixture where name='form');
insert into activation_fixture select 'revision',id from form_templates where name='Synthetic Instagram enquiry' and version=2;
insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown,is_editable)
select id,'name','Customer name','text',0,true,true,true from activation_fixture where name='revision';
set local role authenticated;
select is(get_form_customer_mapping((select id from activation_fixture where name='revision'))->>'inherited','true','revision offers the previous mapping');
select is(get_form_customer_mapping((select id from activation_fixture where name='revision'))->>'crmStatus',null,'an inherited mapping claims no CRM approval');
select is(get_form_customer_mapping((select id from activation_fixture where name='form'))->>'crmStatus','accepted','saved mapping shows the CRM answer');
select is((select f->>'setup' from jsonb_array_elements(customer_integration_overview()->'forms') f where f->>'familyId'=(select family_id::text from form_templates where id=(select id from activation_fixture where name='form'))),'form_changed','revised live form needs re-approval');
select is((select (f#>>'{delivery,linked}')::integer from jsonb_array_elements(customer_integration_overview()->'forms') f where f->>'familyId'=(select family_id::text from form_templates where id=(select id from activation_fixture where name='form'))),1,'overview counts actual linked deliveries');
select throws_ok($$select get_fms_customer_sync_status(gen_random_uuid())$$,'42501',null,'unknown or unreadable workflow is denied');
reset role;
select * from finish();
rollback;
