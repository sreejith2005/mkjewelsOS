begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create temporary table ah(name text primary key,id uuid);
grant all on ah to authenticated;
do $$declare t uuid;b uuid;d uuid;a uuid;u uuid;f uuid;f2 uuid;f3 uuid;begin
 insert into tenants(name,slug) values('Automatic history','automatic-history-376') returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Main','AH6') returning id into b;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','AH6S') returning id into d;
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
 values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','history@test.local','x',now(),now()) returning id into a;
 insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
 values(t,a,b,d,'History staff','AH6','history@test.local','admin','active',true) returning id into u;
 -- A follow-up form with a phone question, a form without one, and a form with its own approved mapping.
 insert into form_templates(tenant_id,name,lifecycle,permissions) values(t,'Follow-up call','published','{"roles":["admin"]}') returning id into f;
 insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown,is_editable)
 values(f,'billing','Billing phone','phone',0,false,true,true),(f,'client_mobile','Mobile','phone',1,true,true,true),(f,'spoke','Did they pick up?','text',2,false,true,true),
       (f,'owner','Assigned to','user_dropdown',3,false,true,true);
 insert into form_templates(tenant_id,name,lifecycle,permissions) values(t,'Shop checklist','published','{"roles":["admin"]}') returning id into f2;
 insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown,is_editable) values(f2,'clean','Counter clean?','text',0,false,true,true);
 insert into form_templates(tenant_id,name,lifecycle,permissions) values(t,'Instagram enquiry','published','{"roles":["admin"]}') returning id into f3;
 insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown,is_editable)
 values(f3,'name','Customer name','text',0,true,true,true),(f3,'phone','Phone','phone',1,false,true,true);
 insert into ah values('tenant',t),('auth',a),('user',u),('form',f),('checklist',f2),('mapped',f3);
end$$;
select set_config('request.jwt.claim.sub',(select id::text from ah where name='auth'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
-- The Instagram form has its own enabled mapping, as Customer Integration saves it.
select lives_ok($$select save_form_customer_mapping((select id from ah where name='mapped'),'{"schemaVersion":1,"enabled":true,"channel":"INSTAGRAM","identityScope":"mk-instagram","fields":[{"fieldKey":"name","mode":"profile","destination":"primary_name"},{"fieldKey":"phone","mode":"profile","destination":"primary_phone"}]}')$$,'an author saves a form''s own mapping');
insert into ah select 'call', submit_form_with_audit((select id from ah where name='form'),'{"billing":"9000000001","client_mobile":"+91 98765 43210","spoke":"Yes, will visit Saturday"}',null,null);
insert into ah select 'check', submit_form_with_audit((select id from ah where name='checklist'),'{"clean":"Yes"}',null,null);
insert into ah select 'insta', submit_form_with_audit((select id from ah where name='mapped'),'{"name":"Asha","phone":"9876543210"}',null,null);
reset role;
set constraints all immediate;

-- The follow-up call goes to CRM with an automatic history mapping.
select is((select count(*)::int from crm_sync.customer_events where source_id=(select id from ah where name='call')),1,'a form with a client phone number sends its answers to the client''s history');
select ok((select descriptor ? 'automatic' and descriptor->>'identityField'='client_mobile' from form_customer_mapping_versions v join crm_sync.customer_events e on e.mapping_id=v.id where e.source_id=(select id from ah where name='call')),'the mapping is automatic and identifies the client by the client''s mobile, not the billing phone');
select is((select jsonb_agg(jsonb_build_array(a->>'fieldKey',a->>'mode',a->>'destination') order by a->>'fieldKey') from crm_sync.customer_events e, jsonb_array_elements(e.payload->'answers') a where e.source_id=(select id from ah where name='call')),
  '[["billing","history","note"],["client_mobile","profile","primary_phone"],["spoke","history","note"]]'::jsonb,'every other answer is history only; people pickers are left out');
select is((select payload->>'formName' from crm_sync.customer_events where source_id=(select id from ah where name='call')),null,'the event carries the usual payload');
select is((select descriptor->>'formName' from form_customer_mapping_versions v join crm_sync.customer_events e on e.mapping_id=v.id where e.source_id=(select id from ah where name='call')),'Follow-up call','CRM sees the form name');

-- Forms without a client phone number send nothing.
select is((select count(*)::int from crm_sync.customer_events where source_id=(select id from ah where name='check')),0,'forms without a client phone number add nothing');
-- A form with its own approved mapping keeps it.
select ok((select not(v.descriptor ? 'automatic') from form_customer_mapping_versions v join crm_sync.submission_mappings s on s.mapping_id=v.id where s.submission_id=(select id from ah where name='insta')),'a form''s own mapping is used, not the automatic one');

-- One automatic mapping per form version, reused.
set local role authenticated;
insert into ah select 'call2', submit_form_with_audit((select id from ah where name='form'),'{"client_mobile":"9876500000","spoke":"No"}',null,null);
reset role;
select is((select count(*)::int from form_customer_mapping_versions where template_id=(select id from ah where name='form') and descriptor ? 'automatic'),1,'the automatic mapping is reused for the same form version');

-- Automatic mappings stay out of the author's screens and are registered for delivery.
set local role authenticated;
select is(get_form_customer_mapping((select id from ah where name='form')),null,'the author sees no mapping of their own on the follow-up form');
select ok(not exists(select 1 from jsonb_array_elements(customer_integration_overview()->'forms') f where f->>'templateId'=(select id::text from ah where name='form')),'Customer Integration does not list automatic forms as configured');
reset role;
select ok(exists(select 1 from crm_sync_claim_customer_mappings(10) c where c.descriptor ? 'automatic'),'the delivery worker registers the automatic mapping with CRM');

-- A skipped event (no registered client with that number) keeps CRM's reason.
update crm_sync.customer_events set next_attempt_at=now()-interval '1 second' where source_id=(select id from ah where name='call');
select is((select crm_sync_finish_customer_event(e.id,e.lease_token,'{"outcome":"rejected","reason":"automatic_no_client"}',null) from crm_sync_claim_customer_events(10) e where e.payload->>'submissionId'=(select id::text from ah where name='call')),'rejected','a skipped event is finished');
select is((select last_error from crm_sync.customer_events where source_id=(select id from ah where name='call')),'automatic_no_client','with CRM''s reason');

select * from finish();
rollback;
