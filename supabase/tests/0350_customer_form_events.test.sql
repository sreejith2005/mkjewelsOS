begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Schema-only validation DB: seed the maintained catalog row, never bypass the resolver.
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values('forms.manage','action',null,'{super_admin,admin,manager}',110) on conflict do nothing;
select has_table('crm_sync','customer_events','customer events are persisted');
select has_table('public','form_customer_mapping_versions','mapping versions are persisted');
select ok(not has_table_privilege('authenticated','crm_sync.customer_events','SELECT'),'browser cannot read raw customer events');
select ok(not has_table_privilege('authenticated','form_customer_mapping_versions','INSERT'),'browser cannot forge mapping versions');
select ok(not has_function_privilege('authenticated','crm_sync_claim_customer_events(integer)','EXECUTE'),'browser cannot claim delivery work');
select ok(not has_function_privilege('anon','save_form_customer_mapping(uuid,jsonb)','EXECUTE'),'anonymous cannot map forms');
select ok(not has_function_privilege('service_role','save_form_customer_mapping(uuid,jsonb)','EXECUTE'),'service role is not an author');
create temporary table customer_fixture(name text primary key,id uuid);
grant all on customer_fixture to authenticated;
do $$declare t uuid;b uuid;d uuid;a uuid;u uuid;f uuid;begin
 insert into tenants(name,slug) values('Synthetic customer integration','synthetic-customer-integration') returning id into t;
 insert into branches(tenant_id,name,code) values(t,'Synthetic branch','CIF') returning id into b;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Synthetic department','CIF') returning id into d;
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
 values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','customer-integration@test.local','x',now(),now()) returning id into a;
 insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
 values(t,a,b,d,'Synthetic author','CIF','customer-integration@test.local','admin','active',true) returning id into u;
 insert into form_templates(tenant_id,name,lifecycle,permissions) values(t,'Synthetic enquiry','published','{"roles":["admin"]}') returning id into f;
 insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown,is_editable)
 values(f,'name','Name','text',0,true,true,true),(f,'phone','Phone','phone',1,false,true,true),(f,'owner','Assigned To','user_dropdown',2,false,true,true);
 insert into customer_fixture values('tenant',t),('branch',b),('auth',a),('actor',u),('form',f);
end$$;
select set_config('request.jwt.claim.sub',(select id::text from customer_fixture where name='auth'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok($$select save_form_customer_mapping((select id from customer_fixture where name='form'),'{"schemaVersion":1,"enabled":true,"channel":"INSTAGRAM","identityScope":"test","fields":[{"fieldKey":"owner","mode":"both","destination":"primary_name"}]}')$$,'22023',null,'employee question cannot become customer identity');
select lives_ok($$select save_form_customer_mapping((select id from customer_fixture where name='form'),'{"schemaVersion":1,"enabled":true,"channel":"INSTAGRAM","identityScope":"test","fields":[{"fieldKey":"name","mode":"both","destination":"primary_name"},{"fieldKey":"phone","mode":"both","destination":"primary_phone"}]}')$$,'authorized author creates mapping');
select is(get_form_customer_mapping((select id from customer_fixture where name='form'))->>'version','1','mapping starts at version one');
select lives_ok($$select save_form_customer_mapping((select id from customer_fixture where name='form'),'{"schemaVersion":1,"enabled":true,"channel":"INSTAGRAM","identityScope":"test","fields":[{"fieldKey":"name","mode":"both","destination":"primary_name"},{"fieldKey":"phone","mode":"both","destination":"primary_phone"}]}')$$,'same mapping save is idempotent');
select is(get_form_customer_mapping((select id from customer_fixture where name='form'))->>'version','1','same descriptor does not allocate another version');
insert into customer_fixture select 'submission',submit_form_with_audit((select id from customer_fixture where name='form'),'{"name":"Synthetic customer","phone":""}',null,null);
reset role;
set constraints all immediate;
select is((select count(*)::integer from crm_sync.customer_events),1,'one successful submission emits one event');
select is((select jsonb_array_length(payload->'answers') from crm_sync.customer_events),1,'blank phone is absent from customer event');
select is((select payload#>>'{answers,0,label}' from crm_sync.customer_events),'Name','original question label is preserved');
select is((select payload->>'submissionId' from crm_sync.customer_events),(select id::text from customer_fixture where name='submission'),'exact source submission identity is preserved');
select throws_ok($$update crm_sync.customer_events set payload='{}'$$,'23514',null,'payload cannot be changed even by maintenance');
select is((select count(*)::integer from crm_sync_claim_customer_events(20)),1,'service claim leases one event');
select is((select count(*)::integer from crm_sync_claim_customer_events(20)),0,'unexpired lease is not claimed twice');
select throws_ok($$select crm_sync_finish_customer_event((select id from crm_sync.customer_events),gen_random_uuid(),'{"outcome":"accepted"}',null)$$,'40001',null,'stale worker cannot acknowledge another lease');
select lives_ok($$select crm_sync_finish_customer_event(id,lease_token,'{"outcome":"accepted","client_id":"00000000-0000-0000-0000-000000000001"}',null) from crm_sync.customer_events$$,'matching lease acknowledges delivery');
select is((select count(*)::integer from crm_sync.customer_events where delivered_at is not null),1,'delivered state is durable');

-- A historical submission predates opt-in; the published form is subsequently edited in place.
insert into form_templates(tenant_id,name,lifecycle,permissions,sections)
select id,'Synthetic historical enquiry','published','{"roles":["admin"]}','[{"key":"first","title":"First","next":"second"},{"key":"second","title":"Second"}]' from customer_fixture where name='tenant';
insert into customer_fixture select 'historical_form',id from form_templates where name='Synthetic historical enquiry';
insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown,is_editable,group_name)
select id,'original_name','Original name','text',0,true,true,true,'second' from customer_fixture where name='historical_form';
set local role authenticated;
insert into customer_fixture select 'historical_submission',submit_form_with_audit((select id from customer_fixture where name='historical_form'),'{"original_name":"Synthetic original answer"}',null,null);
select save_published_form_with_audit((select id from customer_fixture where name='historical_form'),'{"name":"Synthetic edited enquiry","permissions":{"roles":["admin"]},"sections":[{"key":"first","title":"First","next":"__submit__"},{"key":"second","title":"Second"}]}','[{"key":"original_name","label":"Renamed now","type":"text","required":false,"shown":true,"editable":true,"sectionKey":"second"}]');
select save_form_customer_mapping((select id from customer_fixture where name='historical_form'),'{"schemaVersion":1,"enabled":true,"channel":"STORE","identityScope":"historical-test","fields":[{"fieldKey":"original_name","mode":"both","destination":"primary_name"}]}');
select is((reconcile_customer_submissions((get_form_customer_mapping((select id from customer_fixture where name='historical_form'))->>'id')::uuid,array[(select id from customer_fixture where name='historical_submission')],false,null)->>'invalid')::integer,1,'same version with changed definition cannot reinterpret old answers');
select lives_ok($$select save_historical_customer_mapping((select id from customer_fixture where name='historical_submission'),'{"schemaVersion":1,"enabled":true,"channel":"STORE","identityScope":"historical-test","fields":[{"fieldKey":"original_name","mode":"both","destination":"primary_name"}]}')$$,'reviewed historical mapping derives labels from stored original definition');
reset role;
select is((select descriptor#>>'{fields,0,label}' from form_customer_mapping_versions where descriptor ? 'historicalSnapshotDigest'),'Original name','historical descriptor preserves original label');
select is((select descriptor#>>'{fields,0,label}' from form_customer_mapping_versions where id=(get_form_customer_mapping((select id from customer_fixture where name='historical_form'))->>'id')::uuid),'Renamed now','historical mapping never replaces the current live mapping');
insert into customer_fixture select 'historical_mapping',id from form_customer_mapping_versions where descriptor ? 'historicalSnapshotDigest';
set local role authenticated;
select lives_ok($$select reconcile_customer_submissions(id,array[(select id from customer_fixture where name='historical_submission')],true,reconcile_customer_submissions(id,array[(select id from customer_fixture where name='historical_submission')],false,null)->>'sourceDigest') from customer_fixture where name='historical_mapping'$$,'historical apply uses the reviewed original snapshot');
reset role;
select is((select payload#>>'{answers,0,label}' from crm_sync.customer_events where source_id=(select id from customer_fixture where name='historical_submission')),'Original name','backfill uses original section reachability and retains answered original question');


-- Legacy persisted hidden/conditional answers are never promoted; meaningful false/zero survive.
insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown,is_editable,conditional_logic)
select id,v.key,v.label,v.type,v.ord,false,v.shown,true,v.condition from customer_fixture cross join (values
 ('hidden_answer','Hidden answer','text',3,false,null::jsonb),
 ('conditional_answer','Conditional answer','text',4,true,'{"fieldKey":"decision","operator":"equals","value":"show"}'::jsonb),
 ('zero_budget','Budget','number',5,true,null::jsonb),
 ('false_outcome','Outcome','checkbox',6,true,null::jsonb)
) v(key,label,type,ord,shown,condition) where name='form';
set local role authenticated;
select save_form_customer_mapping((select id from customer_fixture where name='form'),'{"schemaVersion":1,"enabled":true,"channel":"INSTAGRAM","identityScope":"test","fields":[{"fieldKey":"name","mode":"both","destination":"primary_name"},{"fieldKey":"hidden_answer","mode":"history","destination":"note"},{"fieldKey":"conditional_answer","mode":"history","destination":"requirement"},{"fieldKey":"zero_budget","mode":"both","destination":"budget"},{"fieldKey":"false_outcome","mode":"history","destination":"outcome"}]}');
reset role;
insert into form_submissions(form_template_id,tenant_id,branch_id,submitted_by,data,status)
select (select id from customer_fixture where name='form'),(select id from customer_fixture where name='tenant'),(select id from customer_fixture where name='branch'),(select id from customer_fixture where name='actor'),'{"name":"Synthetic retained values","hidden_answer":"Old hidden answer","conditional_answer":"Old conditional answer","zero_budget":0,"false_outcome":false}','submitted' returning id;
select is((select jsonb_array_length(e.payload->'answers') from crm_sync.customer_events e join form_submissions s on s.id=e.source_id where s.data->>'name'='Synthetic retained values'),3,'only visible answered fields become mapped evidence');
select ok(not exists(select 1 from crm_sync.customer_events e join form_submissions s on s.id=e.source_id cross join lateral jsonb_array_elements(e.payload->'answers') a where s.data->>'name'='Synthetic retained values' and a->>'fieldKey' in('hidden_answer','conditional_answer')),'hidden and unmet conditional values remain excluded even if legacy data retained them');
select ok(exists(select 1 from crm_sync.customer_events e join form_submissions s on s.id=e.source_id cross join lateral jsonb_array_elements(e.payload->'answers') a where s.data->>'name'='Synthetic retained values' and a->>'fieldKey'='zero_budget' and a->'original'='0'::jsonb),'zero budget is retained as a real original answer');
select ok(exists(select 1 from crm_sync.customer_events e join form_submissions s on s.id=e.source_id cross join lateral jsonb_array_elements(e.payload->'answers') a where s.data->>'name'='Synthetic retained values' and a->>'fieldKey'='false_outcome' and a->'original'='false'::jsonb),'false outcome is retained as a real original answer');


update form_fields set field_name='Changed meaning after mapping review' where form_template_id=(select id from customer_fixture where name='form') and field_key='name';
insert into form_submissions(form_template_id,tenant_id,branch_id,submitted_by,data,status)
select (select id from customer_fixture where name='form'),(select id from customer_fixture where name='tenant'),(select id from customer_fixture where name='branch'),(select id from customer_fixture where name='actor'),'{"name":"Synthetic unreviewed definition"}','submitted';
select is((select count(*)::integer from crm_sync.customer_events e join form_submissions s on s.id=e.source_id where s.data->>'name'='Synthetic unreviewed definition'),0,'changed live definition cannot reuse an approved mapping and reinterpret contact or identity values');
select is((select (m->>'definition_changed')::boolean from jsonb_array_elements(customer_integration_health()->'mappingStatus')m where m->>'id'=(select id::text from customer_fixture where name='form')),true,'integration health identifies a definition that requires renewed mapping review');

select * from finish();
rollback;
