begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(139);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select auth_id,'authenticated','authenticated',email,crypt('synthetic-test-value',gen_salt('bf')),now(),'{}','{}',now(),now() from (values
 ('aa100000-0000-0000-0000-000000000001'::uuid,'fms-admin@example.invalid'),('aa100000-0000-0000-0000-000000000002'::uuid,'fms-manager@example.invalid'),('aa100000-0000-0000-0000-000000000003'::uuid,'fms-staff@example.invalid'),('aa100000-0000-0000-0000-000000000004'::uuid,'fms-doer@example.invalid'),('aa100000-0000-0000-0000-000000000005'::uuid,'fms-hr@example.invalid'),('aa100000-0000-0000-0000-000000000006'::uuid,'fms-house@example.invalid'),('aa100000-0000-0000-0000-000000000007'::uuid,'fms-inactive@example.invalid'),('aa100000-0000-0000-0000-000000000008'::uuid,'fms-other-admin@example.invalid'),('aa100000-0000-0000-0000-000000000009'::uuid,'fms-cross-branch@example.invalid'),('aa100000-0000-0000-0000-000000000010'::uuid,'fms-selected-owner@example.invalid')) x(auth_id,email);
insert into tenants(id,name,slug) values('1a100000-0000-0000-0000-000000000001','FMS Tenant A','fms-a'),('1a100000-0000-0000-0000-000000000002','FMS Tenant B','fms-b');
insert into branches(id,tenant_id,name,code) values('2a100000-0000-0000-0000-000000000001','1a100000-0000-0000-0000-000000000001','FMS Branch A','FA'),('2a100000-0000-0000-0000-000000000002','1a100000-0000-0000-0000-000000000002','FMS Branch B','FB');
insert into branches(id,tenant_id,name,code) values('2a100000-0000-0000-0000-000000000003','1a100000-0000-0000-0000-000000000001','FMS Branch A2','FA2');
insert into departments(id,tenant_id,branch_id,name,code) values('3a100000-0000-0000-0000-000000000001','1a100000-0000-0000-0000-000000000001','2a100000-0000-0000-0000-000000000001','FMS Department A','FDA'),('3a100000-0000-0000-0000-000000000002','1a100000-0000-0000-0000-000000000002','2a100000-0000-0000-0000-000000000002','FMS Department B','FDB');
insert into departments(id,tenant_id,branch_id,name,code) values('3a100000-0000-0000-0000-000000000003','1a100000-0000-0000-0000-000000000001','2a100000-0000-0000-0000-000000000003','FMS Department A2','FDA2');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
select pid,aid,tid,bid,did,label,mobile,email,code,role::user_role,status::working_status,enabled from (values
 ('4a100000-0000-0000-0000-000000000001'::uuid,'aa100000-0000-0000-0000-000000000001'::uuid,'1a100000-0000-0000-0000-000000000001'::uuid,'2a100000-0000-0000-0000-000000000001'::uuid,'3a100000-0000-0000-0000-000000000001'::uuid,'FMS Admin','0000000001','fms-admin@example.invalid','FMS-1','admin','active',true),
 ('4a100000-0000-0000-0000-000000000002','aa100000-0000-0000-0000-000000000002','1a100000-0000-0000-0000-000000000001','2a100000-0000-0000-0000-000000000001','3a100000-0000-0000-0000-000000000001','FMS Manager','0000000002','fms-manager@example.invalid','FMS-2','manager','active',true),
 ('4a100000-0000-0000-0000-000000000003','aa100000-0000-0000-0000-000000000003','1a100000-0000-0000-0000-000000000001','2a100000-0000-0000-0000-000000000001','3a100000-0000-0000-0000-000000000001','FMS Staff','0000000003','fms-staff@example.invalid','FMS-3','staff','active',true),
 ('4a100000-0000-0000-0000-000000000004','aa100000-0000-0000-0000-000000000004','1a100000-0000-0000-0000-000000000001','2a100000-0000-0000-0000-000000000001','3a100000-0000-0000-0000-000000000001','FMS Doer','0000000004','fms-doer@example.invalid','FMS-4','doer','active',true),
 ('4a100000-0000-0000-0000-000000000005','aa100000-0000-0000-0000-000000000005','1a100000-0000-0000-0000-000000000001','2a100000-0000-0000-0000-000000000001','3a100000-0000-0000-0000-000000000001','FMS HR','0000000005','fms-hr@example.invalid','FMS-5','hr','active',true),
 ('4a100000-0000-0000-0000-000000000006','aa100000-0000-0000-0000-000000000006','1a100000-0000-0000-0000-000000000001','2a100000-0000-0000-0000-000000000001','3a100000-0000-0000-0000-000000000001','FMS Housekeeping','0000000006','fms-house@example.invalid','FMS-6','housekeeping','active',true),
 ('4a100000-0000-0000-0000-000000000007','aa100000-0000-0000-0000-000000000007','1a100000-0000-0000-0000-000000000001','2a100000-0000-0000-0000-000000000001','3a100000-0000-0000-0000-000000000001','FMS Inactive','0000000007','fms-inactive@example.invalid','FMS-7','staff','inactive',false),
 ('4a100000-0000-0000-0000-000000000008','aa100000-0000-0000-0000-000000000008','1a100000-0000-0000-0000-000000000002','2a100000-0000-0000-0000-000000000002','3a100000-0000-0000-0000-000000000002','FMS Other Admin','0000000008','fms-other-admin@example.invalid','FMS-8','admin','active',true),
 ('4a100000-0000-0000-0000-000000000009','aa100000-0000-0000-0000-000000000009','1a100000-0000-0000-0000-000000000001','2a100000-0000-0000-0000-000000000003','3a100000-0000-0000-0000-000000000001','FMS Cross Branch','0000000009','fms-cross-branch@example.invalid','FMS-9','staff','active',true),
 ('4a100000-0000-0000-0000-000000000010','aa100000-0000-0000-0000-000000000010','1a100000-0000-0000-0000-000000000001','2a100000-0000-0000-0000-000000000003','3a100000-0000-0000-0000-000000000003','FMS Selected Owner','0000000010','fms-selected-owner@example.invalid','FMS-10','staff','active',true)
) x(pid,aid,tid,bid,did,label,mobile,email,code,role,status,enabled);
update branches set manager_id='4a100000-0000-0000-0000-000000000002' where id='2a100000-0000-0000-0000-000000000001';
update departments set head_id='4a100000-0000-0000-0000-000000000002' where id='3a100000-0000-0000-0000-000000000001';

select has_column('public','fms_flows','family_id','flow family exists');
select has_column('public','fms_flows','scope_type','flow scope exists');
select has_column('public','fms_stages','stage_key','stable stage key exists');
select has_column('public','fms_stages','checklist_definition','checklist definition exists');
select has_column('public','fms_stages','parallel_target_stage_ids','parallel targets exist');
select has_column('public','fms_instances','flow_version','instance pins version');
select has_column('public','fms_instances','department_id','instance department exists');
select has_column('public','fms_instance_stages','branch_rule_id','route history exists');
select has_table('public','fms_instance_stage_assignees','per-actor evidence table exists');
select has_table('public','fms_instance_checklist_items','runtime checklist table exists');
select has_table('public','fms_evidence','evidence metadata exists');
select has_index('public','fms_flows','idx_fms_flows_family_version','family version index exists');
select has_index('public','fms_flows','idx_fms_flows_one_draft','one draft index exists');
select has_index('public','fms_flows','idx_fms_flows_one_published','one published index exists');
select has_index('public','fms_instances','fms_instances_reference_unique','reference uniqueness exists');
select has_index('public','fms_instances','idx_fms_child_once','split child idempotency exists');
select has_index('public','form_submissions','idx_form_submission_one_fms_stage','exact form linkage is unique');
select col_is_fk('public','fms_evidence','fms_instance_stage_id','evidence stage FK exists');
select col_is_fk('public','fms_instance_stage_assignees','user_profile_id','actor user FK exists');
select col_is_fk('public','fms_instance_checklist_items','completed_by','checklist actor FK exists');

select function_owner_is('public','save_fms_flow_draft_with_audit',array['uuid','jsonb','jsonb'],'postgres','save owner is postgres');
select function_owner_is('public','start_fms_instance_with_audit',array['uuid','text','task_priority','jsonb','uuid','uuid','uuid'],'postgres','start owner is postgres');
select function_owner_is('public','complete_fms_stage_with_audit',array['uuid','text','text','jsonb','uuid'],'postgres','complete owner is postgres');
select is((select prosecdef from pg_proc where oid='save_fms_flow_draft_with_audit(uuid,jsonb,jsonb)'::regprocedure),true,'save is security definer');
select is((select prosecdef from pg_proc where oid='start_fms_instance_with_audit(uuid,text,task_priority,jsonb,uuid,uuid,uuid)'::regprocedure),true,'start is security definer');
select is((select proconfig from pg_proc where oid='complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)'::regprocedure),array['search_path=public']::text[],'complete pins search path');
select ok(has_function_privilege('authenticated','save_fms_flow_draft_with_audit(uuid,jsonb,jsonb)','EXECUTE'),'authenticated executes save');
select ok(has_function_privilege('authenticated','create_fms_revision_with_audit(uuid)','EXECUTE'),'authenticated executes revision');
select ok(has_function_privilege('authenticated','publish_fms_flow_with_audit(uuid)','EXECUTE'),'authenticated executes publish');
select ok(has_function_privilege('authenticated','archive_fms_flow_with_audit(uuid,text)','EXECUTE'),'authenticated executes archive');
select ok(has_function_privilege('authenticated','start_fms_instance_with_audit(uuid,text,task_priority,jsonb,uuid,uuid,uuid)','EXECUTE'),'authenticated executes start');
select ok(has_function_privilege('authenticated','complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)','EXECUTE'),'authenticated executes complete');
select ok(has_function_privilege('authenticated','review_fms_stage_with_audit(uuid,text,text,uuid)','EXECUTE'),'authenticated executes review');
select ok(has_function_privilege('authenticated','reassign_fms_stage_with_audit(uuid,uuid,uuid,text)','EXECUTE'),'authenticated executes reassign');
select ok(has_function_privilege('authenticated','escalate_fms_stage_with_audit(uuid,text)','EXECUTE'),'authenticated executes escalate');
select ok(has_function_privilege('authenticated','hold_fms_instance_with_audit(uuid,text)','EXECUTE'),'authenticated executes hold');
select ok(has_function_privilege('authenticated','resume_fms_instance_with_audit(uuid,text)','EXECUTE'),'authenticated executes resume');
select ok(has_function_privilege('authenticated','cancel_fms_instance_with_audit(uuid,text)','EXECUTE'),'authenticated executes cancel');
select ok(not has_function_privilege('anon','start_fms_instance_with_audit(uuid,text,task_priority,jsonb,uuid,uuid,uuid)','EXECUTE'),'anon cannot start');
select ok(not has_function_privilege('service_role','complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)','EXECUTE'),'service role cannot complete');
select ok(not has_function_privilege('authenticated','activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer)','EXECUTE'),'automatic helper is owner only');
select ok(not has_table_privilege('authenticated','fms_flows','INSERT,UPDATE,DELETE'),'direct flow writes denied');
select ok(not has_table_privilege('authenticated','fms_stages','INSERT,UPDATE,DELETE'),'direct stage writes denied');
select ok(not has_table_privilege('authenticated','fms_instances','INSERT,UPDATE,DELETE'),'direct instance writes denied');
select ok(not has_table_privilege('authenticated','fms_instance_stages','INSERT,UPDATE,DELETE'),'direct runtime stage writes denied');
select ok(not has_table_privilege('authenticated','fms_evidence','INSERT,UPDATE,DELETE'),'direct evidence writes denied');
select ok(not has_table_privilege('anon','fms_flows','SELECT,INSERT,UPDATE,DELETE'),'anon has no FMS table access');

insert into form_templates(id,tenant_id,family_id,name,is_active) values ('7a100000-0000-0000-0000-000000000001','1a100000-0000-0000-0000-000000000001','7a100000-0000-0000-0000-000000000001','FMS start form',true);
insert into departments(id,tenant_id,branch_id,name,code) values ('3a100000-0000-0000-0000-000000000010','1a100000-0000-0000-0000-000000000001',null,'Tenant-wide FMS Department','TFD');
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000001',true);
select lives_ok($$select save_fms_flow_draft_with_audit(null,'{"name":"Tenant-wide department scope","scope_type":"department","branch_id":"2a100000-0000-0000-0000-000000000001","department_id":"3a100000-0000-0000-0000-000000000010","trigger_type":"manual"}','[]')$$,'admin saves a branch-context flow using a tenant-wide department');
select is((select department_id from fms_flows where name='Tenant-wide department scope'),'3a100000-0000-0000-0000-000000000010'::uuid,'tenant-wide department scope is persisted');
select lives_ok($$select save_fms_flow_draft_with_audit(null,'{"name":"FMS Runtime","scope_type":"tenant","trigger_type":"manual"}','[{"key":"work","name":"Start form","type":"form","order":0,"required":true,"completionRule":"any_doer","allowMultipleDoers":false,"requiresUpload":false,"requiresRemark":true,"checklist":[{"key":"verified","label":"Verified","required":true,"sortOrder":0}],"formTemplateId":"7a100000-0000-0000-0000-000000000001","assigneeRules":[{"type":"specific_user","userProfileId":"4a100000-0000-0000-0000-000000000003"}],"requiresNextDoerHandoff":false,"canMoveBackward":false,"canReject":false,"canRequestRevision":false,"canEscalate":true,"branchRules":[],"parallelTargetStageKeys":[],"joinRequiredStageKeys":[],"sla":{"dueDate":"2099-12-31"}}]')$$,'admin saves a valid implicit-entry draft');
select is((select count(*)::int from fms_stages where fms_flow_id=(select id from fms_flows where name='FMS Runtime')),1,'draft stores the Form trigger without synthetic boundary nodes');
select lives_ok($$select publish_fms_flow_with_audit((select id from fms_flows where name='FMS Runtime'))$$,'admin publishes valid flow');
select is((select status::text from fms_flows where name='FMS Runtime'),'published','flow is published');
select is((select count(*)::int from audit_logs where module='fms_flows' and record_id=(select id from fms_flows where name='FMS Runtime')),2,'save and publish are audited');
reset role;
insert into fms_flows(id,tenant_id,branch_id,name,status,is_active,created_by,family_id,scope_type)
values('5a100000-0000-0000-0000-000000000060','1a100000-0000-0000-0000-000000000001','2a100000-0000-0000-0000-000000000001','Reusable branch start','draft',true,'4a100000-0000-0000-0000-000000000001','5f100000-0000-0000-0000-000000000060','branch');
insert into fms_stages(id,fms_flow_id,stage_key,name,step_type,sort_order,form_template_id,planned_time_rule)
values('6a100000-0000-0000-0000-000000000060','5a100000-0000-0000-0000-000000000060','start_form','Reusable start form','form',0,'7a100000-0000-0000-0000-000000000001','{"dueDate":"2099-12-31"}');
insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id)
values('6a100000-0000-0000-0000-000000000060','specific_user','4a100000-0000-0000-0000-000000000003');
update fms_flows set status='published',published_by='4a100000-0000-0000-0000-000000000001' where id='5a100000-0000-0000-0000-000000000060';
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000001',true);
select lives_ok($$select start_fms_instance_with_audit('5a100000-0000-0000-0000-000000000060','Selected scope run','medium','{}','2a100000-0000-0000-0000-000000000003','3a100000-0000-0000-0000-000000000003','4a100000-0000-0000-0000-000000000010')$$,'admin starts an old branch-scoped flow in the explicitly selected branch');
select is((select branch_id from fms_instances where title='Selected scope run'),'2a100000-0000-0000-0000-000000000003'::uuid,'the selected branch is stored on the live instance');
select is((select department_id from fms_instances where title='Selected scope run'),'3a100000-0000-0000-0000-000000000003'::uuid,'the selected department is stored on the live instance');
select is((select assigned_to from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Selected scope run'),array['4a100000-0000-0000-0000-000000000010'::uuid],'the selected person owns the first live Form stage');
select is((select count(*)::int from fms_instances where title='Selected scope run'),1,'the starter can read the created live instance through RLS');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000002',true);
select throws_ok($$select start_fms_instance_with_audit('5a100000-0000-0000-0000-000000000060','Manager cross-branch denied','medium','{}','2a100000-0000-0000-0000-000000000003','3a100000-0000-0000-0000-000000000003','4a100000-0000-0000-0000-000000000010')$$,'42501',null,'a manager cannot use the selector to escape the own-branch boundary');
reset role;
update user_profiles set user_role='staff',is_login_enabled=false,account_status='invited' where id='4a100000-0000-0000-0000-000000000006';
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000001',true);
select lives_ok($$select save_fms_flow_draft_with_audit(null,'{"name":"Invited named assignee","scope_type":"tenant","trigger_type":"manual"}','[{"key":"work","name":"Start form","type":"form","order":0,"required":true,"completionRule":"any_doer","allowMultipleDoers":false,"requiresUpload":false,"requiresRemark":false,"checklist":[],"formTemplateId":"7a100000-0000-0000-0000-000000000001","assigneeRules":[{"type":"specific_user","userProfileId":"4a100000-0000-0000-0000-000000000006"}],"requiresNextDoerHandoff":false,"canMoveBackward":false,"canReject":false,"canRequestRevision":false,"canEscalate":false,"branchRules":[],"parallelTargetStageKeys":[],"joinRequiredStageKeys":[],"sla":{"dueDate":"2099-12-31"}}]')$$,'admin saves a workflow using the named invited profile shown by the editor');
select lives_ok($$select publish_fms_flow_with_audit((select id from fms_flows where name='Invited named assignee'))$$,'named invited profile does not make assignment disappear during publish');
select is((select status::text from fms_flows where name='Invited named assignee'),'published','invited named assignment is published durably');
select lives_ok($$select start_fms_instance_with_audit((select id from fms_flows where name='Invited named assignee'),'Invited assignee run','medium','{}')$$,'workflow starts with the named invited profile');
select is((select assigned_to from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Invited assignee run'),array['4a100000-0000-0000-0000-000000000006'::uuid],'the invited profile owns the activated stage');
reset role;
update user_profiles set is_login_enabled=true,account_status='active' where id='4a100000-0000-0000-0000-000000000006';
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000006',true);
select lives_ok($$select submit_form_with_audit('7a100000-0000-0000-0000-000000000001','{}','fms_stage',(select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Invited assignee run')); select complete_fms_stage_with_audit((select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Invited assignee run'),null,null,'{}',null)$$,'the invited assignee completes the stage after login activation');
select is((select status::text from fms_instances where title='Invited assignee run'),'completed','the invited-assignee workflow completes');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000001',true);
select lives_ok($$select save_fms_flow_draft_with_audit(null,'{"name":"Full builder workflow","scope_type":"tenant","trigger_type":"manual"}','[{"key":"start_form","name":"Start form","type":"form","order":0,"required":true,"completionRule":"any_doer","allowMultipleDoers":false,"requiresUpload":false,"requiresRemark":false,"checklist":[],"formTemplateId":"7a100000-0000-0000-0000-000000000001","assigneeRules":[{"type":"specific_user","userProfileId":"4a100000-0000-0000-0000-000000000003"}],"requiresNextDoerHandoff":false,"canMoveBackward":false,"canReject":false,"canRequestRevision":false,"canEscalate":false,"defaultNextStageKey":"finish_task","branchRules":[],"parallelTargetStageKeys":[],"joinRequiredStageKeys":[],"sla":{"dueDate":"2099-12-30"}},{"key":"finish_task","name":"Optional later form","type":"form","order":1,"required":true,"completionRule":"any_doer","allowMultipleDoers":false,"requiresUpload":false,"requiresRemark":false,"checklist":[],"formTemplateId":"7a100000-0000-0000-0000-000000000001","assigneeRules":[{"type":"specific_user","userProfileId":"4a100000-0000-0000-0000-000000000003"}],"requiresNextDoerHandoff":false,"canMoveBackward":false,"canReject":false,"canRequestRevision":false,"canEscalate":false,"branchRules":[],"parallelTargetStageKeys":[],"joinRequiredStageKeys":[],"sla":{"dueDate":"2099-12-31"}}]')$$,'admin saves a later step with an optional linked Form');
select is((select count(*)::int from fms_stage_assignees a join fms_stages s on s.id=a.fms_stage_id join fms_flows f on f.id=s.fms_flow_id where f.name='Full builder workflow' and a.assignee_type='specific_user'),2,'both node assignments are stored');
select lives_ok($$select publish_fms_flow_with_audit((select id from fms_flows where name='Full builder workflow'))$$,'the workflow publishes with an optional later Form');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000003',true);
select lives_ok($$select start_fms_instance_with_audit((select id from fms_flows where name='Full builder workflow'),'Full builder run','medium','{}')$$,'the published workflow starts');
select lives_ok($$select submit_form_with_audit('7a100000-0000-0000-0000-000000000001','{}','fms_stage',(select fis.id from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Full builder run' and fs.stage_key='start_form')); select complete_fms_stage_with_audit((select fis.id from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Full builder run' and fs.stage_key='start_form'),null,null,'{}',null)$$,'the Form start node completes and advances');
select is((select fs.stage_key from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Full builder run' and fis.status='in_progress'),'finish_task','the later step with its optional linked Form activates');
select lives_ok($$select complete_fms_stage_with_audit((select fis.id from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Full builder run' and fs.stage_key='finish_task'),null,null,'{}',null)$$,'the later linked Form does not block completion without a submission');
select is((select status::text from fms_instances where title='Full builder run'),'completed','the leaf task completes the workflow without an End node');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000003',true);
select lives_ok($$select start_fms_instance_with_audit((select id from fms_flows where name='FMS Runtime'),'Synthetic run','medium','{}','2a100000-0000-0000-0000-000000000001','3a100000-0000-0000-0000-000000000001',null)$$,'staff starts permitted flow');
select ok((select reference_number like 'FMS-%' from fms_instances where title='Synthetic run'),'reference is human readable');
select is((select flow_version from fms_instances where title='Synthetic run'),1,'instance pins exact version');
select is((select count(*)::int from fms_instance_stage_assignees a join fms_instance_stages s on s.id=a.fms_instance_stage_id join fms_instances i on i.id=s.fms_instance_id where i.title='Synthetic run'),'1','per actor assignment is recorded');
select is((select count(*)::int from fms_instance_checklist_items c join fms_instance_stages s on s.id=c.fms_instance_stage_id join fms_instances i on i.id=s.fms_instance_id where i.title='Synthetic run'),'1','checklist snapshot is created');
select throws_ok($$select complete_fms_stage_with_audit((select id from fms_instance_stages where status='in_progress'),'done',null,'{}',null)$$,'23514',null,'required remark/checklist block completion');
select lives_ok($$select submit_form_with_audit('7a100000-0000-0000-0000-000000000001','{}','fms_stage',(select id from fms_instance_stages where status='in_progress')); select complete_fms_stage_with_audit((select id from fms_instance_stages where status='in_progress'),'done','Finished','{"verified":true}',null)$$,'staff submits the linked Form and completes the assigned stage');
select is((select status::text from fms_instances where title='Synthetic run'),'completed','the executable leaf completes the instance');
select is((select count(*)::int from fms_stage_logs l join fms_instance_stages s on s.id=l.fms_instance_stage_id join fms_instances i on i.id=s.fms_instance_id where i.title='Synthetic run' and l.action in ('actor_completed','automatic_completed')),1,'actor completion history is retained without a synthetic End event');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000004',true);
select throws_ok($$select start_fms_instance_with_audit((select id from fms_flows where name='FMS Runtime'),'Doer denied')$$,'42501',null,'doer cannot start a flow');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000005',true);
select throws_ok($$select start_fms_instance_with_audit((select id from fms_flows where name='FMS Runtime'),'HR denied')$$,'42501',null,'HR is denied FMS runtime');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000007',true);
select throws_ok($$select start_fms_instance_with_audit((select id from fms_flows where name='FMS Runtime'),'Inactive denied')$$,'42501',null,'inactive profile is denied');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000008',true);
select is((select count(*)::int from fms_flows where name='FMS Runtime'),0,'cross tenant flow is invisible');
reset role;

-- Additional state-machine fixtures: revision/approval, deterministic branch,
-- parallel join, and split lineage. Definitions are inserted as owner setup;
-- every runtime transition below still executes as an authenticated actor.
insert into fms_flows(id,tenant_id,name,status,created_by,family_id,scope_type) values
 ('5a100000-0000-0000-0000-000000000010','1a100000-0000-0000-0000-000000000001','Approval revision fixture','draft','4a100000-0000-0000-0000-000000000001','5f100000-0000-0000-0000-000000000010','tenant'),
 ('5a100000-0000-0000-0000-000000000020','1a100000-0000-0000-0000-000000000001','Branch fixture','draft','4a100000-0000-0000-0000-000000000001','5f100000-0000-0000-0000-000000000020','tenant'),
 ('5a100000-0000-0000-0000-000000000030','1a100000-0000-0000-0000-000000000001','Parallel fixture','draft','4a100000-0000-0000-0000-000000000001','5f100000-0000-0000-0000-000000000030','tenant'),
 ('5a100000-0000-0000-0000-000000000040','1a100000-0000-0000-0000-000000000001','Split child fixture','draft','4a100000-0000-0000-0000-000000000001','5f100000-0000-0000-0000-000000000040','tenant'),
 ('5a100000-0000-0000-0000-000000000050','1a100000-0000-0000-0000-000000000001','Split parent fixture','draft','4a100000-0000-0000-0000-000000000001','5f100000-0000-0000-0000-000000000050','tenant');

insert into fms_stages(id,fms_flow_id,stage_key,name,step_type,sort_order,completion_rule,can_move_backward,can_reject,can_request_revision,can_escalate,parallel_target_stage_ids,join_required_stage_ids,join_rule,split_to_flow_id) values
 ('6a100000-0000-0000-0000-000000000011','5a100000-0000-0000-0000-000000000010','prepare','Prepare','task',0,'any_doer',false,false,false,false,'{}','{}',null,null),
 ('6a100000-0000-0000-0000-000000000012','5a100000-0000-0000-0000-000000000010','approve','Approve','approval',1,'manager_approval',true,true,true,false,'{}','{}',null,null),
 ('6a100000-0000-0000-0000-000000000013','5a100000-0000-0000-0000-000000000010','done','Done','end',2,'any_doer',false,false,false,false,'{}','{}',null,null),
 ('6a100000-0000-0000-0000-000000000021','5a100000-0000-0000-0000-000000000020','route','Route','branch',0,'any_doer',false,false,false,false,'{}','{}',null,null),
 ('6a100000-0000-0000-0000-000000000022','5a100000-0000-0000-0000-000000000020','selected','Selected','task',1,'any_doer',false,false,false,false,'{}','{}',null,null),
 ('6a100000-0000-0000-0000-000000000023','5a100000-0000-0000-0000-000000000020','fallback','Fallback','task',2,'any_doer',false,false,false,false,'{}','{}',null,null),
 ('6a100000-0000-0000-0000-000000000024','5a100000-0000-0000-0000-000000000020','done','Done','end',3,'any_doer',false,false,false,false,'{}','{}',null,null),
 ('6a100000-0000-0000-0000-000000000031','5a100000-0000-0000-0000-000000000030','fanout','Fan out','parallel_start',0,'any_doer',false,false,false,false,array['6a100000-0000-0000-0000-000000000032'::uuid,'6a100000-0000-0000-0000-000000000033'::uuid],'{}',null,null),
 ('6a100000-0000-0000-0000-000000000032','5a100000-0000-0000-0000-000000000030','left','Left','task',1,'any_doer',false,false,false,false,'{}','{}',null,null),
 ('6a100000-0000-0000-0000-000000000033','5a100000-0000-0000-0000-000000000030','right','Right','task',2,'any_doer',false,false,false,false,'{}','{}',null,null),
 ('6a100000-0000-0000-0000-000000000034','5a100000-0000-0000-0000-000000000030','join','Join','parallel_join',3,'any_doer',false,false,false,false,'{}','{}','all',null),
 ('6a100000-0000-0000-0000-000000000035','5a100000-0000-0000-0000-000000000030','done','Done','end',4,'any_doer',false,false,false,false,'{}','{}',null,null),
 ('6a100000-0000-0000-0000-000000000041','5a100000-0000-0000-0000-000000000040','child_work','Child work','task',0,'any_doer',false,false,false,false,'{}','{}',null,null),
 ('6a100000-0000-0000-0000-000000000042','5a100000-0000-0000-0000-000000000040','done','Done','end',1,'any_doer',false,false,false,false,'{}','{}',null,null),
 ('6a100000-0000-0000-0000-000000000051','5a100000-0000-0000-0000-000000000050','parent_work','Parent work','task',0,'any_doer',false,false,false,false,'{}','{}',null,'5a100000-0000-0000-0000-000000000040'),
 ('6a100000-0000-0000-0000-000000000052','5a100000-0000-0000-0000-000000000050','done','Done','end',1,'any_doer',false,false,false,false,'{}','{}',null,null);

update fms_stages set default_next_stage_id='6a100000-0000-0000-0000-000000000012' where id='6a100000-0000-0000-0000-000000000011';
update fms_stages set default_next_stage_id='6a100000-0000-0000-0000-000000000013' where id='6a100000-0000-0000-0000-000000000012';
update fms_stages set default_next_stage_id='6a100000-0000-0000-0000-000000000024' where id in ('6a100000-0000-0000-0000-000000000022','6a100000-0000-0000-0000-000000000023');
update fms_stages set default_next_stage_id='6a100000-0000-0000-0000-000000000034' where id in ('6a100000-0000-0000-0000-000000000032','6a100000-0000-0000-0000-000000000033');
update fms_stages set default_next_stage_id='6a100000-0000-0000-0000-000000000035' where id='6a100000-0000-0000-0000-000000000034';
update fms_stages set default_next_stage_id='6a100000-0000-0000-0000-000000000042' where id='6a100000-0000-0000-0000-000000000041';
update fms_stages set default_next_stage_id='6a100000-0000-0000-0000-000000000052' where id='6a100000-0000-0000-0000-000000000051';

insert into fms_stage_assignees(fms_stage_id,assignee_type,role_value,is_start_stage_entry_user) values
 ('6a100000-0000-0000-0000-000000000011','reporter',null,true),('6a100000-0000-0000-0000-000000000012','manager',null,false),
 ('6a100000-0000-0000-0000-000000000022','reporter',null,false),('6a100000-0000-0000-0000-000000000023','reporter',null,false),
 ('6a100000-0000-0000-0000-000000000032','reporter',null,false),('6a100000-0000-0000-0000-000000000033','reporter',null,false),
 ('6a100000-0000-0000-0000-000000000041','reporter',null,true),('6a100000-0000-0000-0000-000000000051','reporter',null,true);
insert into fms_branch_rules(fms_stage_id,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,sort_order) values
 ('6a100000-0000-0000-0000-000000000021','context','route','route','equals','selected','6a100000-0000-0000-0000-000000000022',0),
 ('6a100000-0000-0000-0000-000000000021','context','route','route','default','','6a100000-0000-0000-0000-000000000023',1);
update fms_flows set status='published',published_by='4a100000-0000-0000-0000-000000000001' where id in ('5a100000-0000-0000-0000-000000000010','5a100000-0000-0000-0000-000000000020','5a100000-0000-0000-0000-000000000030','5a100000-0000-0000-0000-000000000040','5a100000-0000-0000-0000-000000000050');

set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000003',true);
select lives_ok($$select start_fms_instance_with_audit('5a100000-0000-0000-0000-000000000010','Revision run','medium','{}')$$,'staff starts approval fixture');
select lives_ok($$select complete_fms_stage_with_audit((select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Revision run' and s.fms_stage_id='6a100000-0000-0000-0000-000000000011'),'ready',null,'{}',null)$$,'staff advances to approval');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000002',true);
select lives_ok($$select request_fms_revision_with_audit((select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Revision run' and s.fms_stage_id='6a100000-0000-0000-0000-000000000012'),'6a100000-0000-0000-0000-000000000011','Needs revision',null)$$,'manager requests a backward revision');
select is((select count(*)::int from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Revision run' and s.fms_stage_id='6a100000-0000-0000-0000-000000000011'),2,'revision creates immutable runtime history');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000003',true);
select lives_ok($$select complete_fms_stage_with_audit((select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Revision run' and s.fms_stage_id='6a100000-0000-0000-0000-000000000011' and s.status='in_progress'),'reworked',null,'{}',null)$$,'staff completes revised work');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000002',true);
select lives_ok($$select review_fms_stage_with_audit((select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Revision run' and s.fms_stage_id='6a100000-0000-0000-0000-000000000012' and s.status='in_review'),'approved','Approved',null)$$,'manager approves revised work');
select is((select status::text from fms_instances where title='Revision run'),'completed','approval path completes');
select is((select count(*)::int from fms_stage_logs l join fms_instance_stages s on s.id=l.fms_instance_stage_id join fms_instances i on i.id=s.fms_instance_id where i.title='Revision run' and l.action='approved'),1,'approval decision has dedicated history');

select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000003',true);
select lives_ok($$select start_fms_instance_with_audit('5a100000-0000-0000-0000-000000000020','Branch run','medium','{"route":"selected"}')$$,'staff starts branch fixture');
select is((select d.stage_key from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id join fms_stages d on d.id=s.fms_stage_id where i.title='Branch run' and s.status='in_progress'),'selected','branch selects first reviewed matching rule');
select is((select count(*)::int from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Branch run' and s.fms_stage_id='6a100000-0000-0000-0000-000000000023'),0,'default branch is not also activated');

select lives_ok($$select start_fms_instance_with_audit('5a100000-0000-0000-0000-000000000030','Parallel run')$$,'staff starts parallel fixture');
select is((select count(*)::int from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Parallel run' and s.status='in_progress'),2,'parallel start activates both paths');
select lives_ok($$select complete_fms_stage_with_audit((select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Parallel run' and s.fms_stage_id='6a100000-0000-0000-0000-000000000032'),null,null,'{}',null)$$,'first parallel path completes');
select is((select count(*)::int from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Parallel run' and s.fms_stage_id='6a100000-0000-0000-0000-000000000034'),0,'all join waits for remaining path');
select lives_ok($$select complete_fms_stage_with_audit((select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Parallel run' and s.fms_stage_id='6a100000-0000-0000-0000-000000000033'),null,null,'{}',null)$$,'second parallel path completes');
select is((select status::text from fms_instances where title='Parallel run'),'completed','parallel join advances once and completes');
select is((select count(*)::int from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Parallel run' and s.fms_stage_id='6a100000-0000-0000-0000-000000000034'),1,'parallel join activation is idempotent');

select lives_ok($$select start_fms_instance_with_audit('5a100000-0000-0000-0000-000000000050','Split run')$$,'staff starts split parent');
select lives_ok($$select complete_fms_stage_with_audit((select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Split run' and i.parent_instance_id is null and s.fms_stage_id='6a100000-0000-0000-0000-000000000051'),null,null,'{}',null)$$,'parent completion starts child');
select is((select count(*)::int from fms_instances child join fms_instances parent on parent.id=child.parent_instance_id where parent.title='Split run' and child.fms_flow_id='5a100000-0000-0000-0000-000000000040'),1,'split creates exactly one linked child');
select throws_ok($$select complete_fms_stage_with_audit((select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Split run' and i.parent_instance_id is null and s.fms_stage_id='6a100000-0000-0000-0000-000000000051'),null,null,'{}',null)$$,'23514',null,'double transition is rejected');
select is((select count(*)::int from fms_instances child join fms_instances parent on parent.id=child.parent_instance_id where parent.title='Split run' and child.fms_flow_id='5a100000-0000-0000-0000-000000000040'),1,'double transition cannot duplicate split child');

select lives_ok($$select start_fms_instance_with_audit((select id from fms_flows where name='FMS Runtime'),'Managed run','medium','{}')$$,'staff starts managed runtime');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000002',true);
select lives_ok($$select reassign_fms_stage_with_audit((select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Managed run' and s.status='in_progress'),'4a100000-0000-0000-0000-000000000003','4a100000-0000-0000-0000-000000000004','Coverage')$$,'manager reassigns to eligible doer');
select is((select assigned_to from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Managed run' and s.status='in_progress'),array['4a100000-0000-0000-0000-000000000004'::uuid],'reassignment updates runtime assignee');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000004',true);
select lives_ok($$select claim_fms_stage_with_audit((select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Managed run' and s.status='in_progress'))$$,'doer claims reassigned stage');
select lives_ok($$select escalate_fms_stage_with_audit((select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Managed run' and s.status='in_progress'),'SLA risk')$$,'assigned doer escalates stage');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000002',true);
reset role;
select is((select count(*)::int from notification_events where event_type='fms_stage_escalated' and source_record_id=(select s.id from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Managed run' and s.status='in_progress')),1,'escalation creates one canonical notification event');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000002',true);
select lives_ok($$select hold_fms_instance_with_audit((select id from fms_instances where title='Managed run'),'Paused')$$,'manager holds instance');
select is((select status::text from fms_instances where title='Managed run'),'on_hold','hold is persisted');
select lives_ok($$select resume_fms_instance_with_audit((select id from fms_instances where title='Managed run'),'Continue')$$,'manager resumes instance');
select lives_ok($$select cancel_fms_instance_with_audit((select id from fms_instances where title='Managed run'),'Stopped')$$,'manager cancels instance');
select is((select status::text from fms_instances where title='Managed run'),'cancelled','cancel is terminal');
select throws_ok($$select resume_fms_instance_with_audit((select id from fms_instances where title='Managed run'),'Invalid')$$,'23514',null,'cancelled instance cannot resume');
reset role;
update fms_stage_assignees set fallback_user_profile_id='4a100000-0000-0000-0000-000000000009' where fms_stage_id=(select s.id from fms_stages s join fms_flows f on f.id=s.fms_flow_id where f.name='FMS Runtime');
insert into user_availability(tenant_id,user_profile_id,date,status,logged_by) values ('1a100000-0000-0000-0000-000000000001','4a100000-0000-0000-0000-000000000003',(now() at time zone 'Asia/Kolkata')::date,'absent','4a100000-0000-0000-0000-000000000001');
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000003',true);
select lives_ok($$select start_fms_instance_with_audit((select id from fms_flows where name='FMS Runtime'),'Fallback run','medium','{}')$$,'an absent primary automatically falls back to the configured same-department user');
select is((select assigned_to from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.title='Fallback run'),array['4a100000-0000-0000-0000-000000000009'::uuid],'runtime assignment uses the same-department fallback from another branch');
reset role;
-- Build, publish, start, and complete a real Yes/No workflow through both paths.
update user_availability set status='present' where user_profile_id='4a100000-0000-0000-0000-000000000003' and date=(now() at time zone 'Asia/Kolkata')::date;
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000001',true);
select lives_ok($$select save_fms_flow_draft_with_audit(null,'{"name":"Decision workflow","scope_type":"tenant","trigger_type":"manual"}','[{"key":"details","name":"Initial details","type":"form","order":0,"required":true,"completionRule":"any_doer","allowMultipleDoers":false,"requiresUpload":false,"requiresRemark":false,"checklist":[],"formTemplateId":"7a100000-0000-0000-0000-000000000001","assigneeRules":[{"type":"specific_user","userProfileId":"4a100000-0000-0000-0000-000000000003"}],"requiresNextDoerHandoff":false,"canMoveBackward":false,"canReject":false,"canRequestRevision":false,"canEscalate":false,"defaultNextStageKey":"decision","branchRules":[],"parallelTargetStageKeys":[],"joinRequiredStageKeys":[],"sla":{"timingMethod":"completion_date","dueDate":"2099-12-29","decisionMode":"normal"}},{"key":"decision","name":"Approve request","type":"task","order":1,"required":true,"completionRule":"any_doer","allowMultipleDoers":false,"requiresUpload":false,"requiresRemark":false,"checklist":[],"assigneeRules":[{"type":"specific_user","userProfileId":"4a100000-0000-0000-0000-000000000003"}],"requiresNextDoerHandoff":false,"canMoveBackward":false,"canReject":false,"canRequestRevision":false,"canEscalate":false,"defaultNextStageKey":"yes_work","branchRules":[],"parallelTargetStageKeys":[],"joinRequiredStageKeys":[],"sla":{"timingMethod":"tat_hours","tatHours":3,"dueDate":"","decisionMode":"yes_no"}},{"key":"yes_work","name":"Only on Yes","type":"task","order":2,"required":true,"completionRule":"any_doer","allowMultipleDoers":false,"requiresUpload":false,"requiresRemark":false,"checklist":[],"assigneeRules":[{"type":"specific_user","userProfileId":"4a100000-0000-0000-0000-000000000003"}],"requiresNextDoerHandoff":false,"canMoveBackward":false,"canReject":false,"canRequestRevision":false,"canEscalate":false,"branchRules":[],"parallelTargetStageKeys":[],"joinRequiredStageKeys":[],"sla":{"timingMethod":"specific_time","dueDate":"2099-12-31","clockTime":"17:30","decisionMode":"normal","conditional":{"decisionStageKey":"decision","outcome":"yes"}}}]')$$,'admin builds a decision workflow with a conditional Yes step');
select lives_ok($$select publish_fms_flow_with_audit((select id from fms_flows where name='Decision workflow'))$$,'decision workflow publishes');
select set_config('request.jwt.claim.sub','aa100000-0000-0000-0000-000000000003',true);
select lives_ok($$select start_fms_instance_with_audit((select id from fms_flows where name='Decision workflow'),'Decision No run','medium','{}')$$,'decision workflow starts at its initial Form');
select lives_ok($$select submit_form_with_audit('7a100000-0000-0000-0000-000000000001','{}','fms_stage',(select fis.id from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Decision No run' and fs.stage_key='details')); select complete_fms_stage_with_audit((select fis.id from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Decision No run' and fs.stage_key='details'),null,null,'{}',null)$$,'initial Form advances directly to the decision');
select throws_ok($$select complete_fms_stage_with_audit((select fis.id from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Decision No run' and fs.stage_key='decision'),null,null,'{}',null)$$,'23514',null,'decision cannot complete without Yes or No');
select lives_ok($$select complete_fms_stage_with_audit((select fis.id from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Decision No run' and fs.stage_key='decision'),'NO',null,'{}',null)$$,'No decision completes and evaluates the conditional step');
select is((select count(*)::int from fms_stage_logs log join fms_instance_stages fis on fis.id=log.fms_instance_stage_id join fms_instances fi on fi.id=fis.fms_instance_id where fi.title='Decision No run' and log.action='condition_skipped'),1,'No path records the skipped conditional stage');
select is((select status::text from fms_instances where title='Decision No run'),'completed','No path completes without manual work on the skipped step');
select lives_ok($$select start_fms_instance_with_audit((select id from fms_flows where name='Decision workflow'),'Decision Yes run','medium','{}')$$,'the same published decision workflow starts again');
select lives_ok($$select submit_form_with_audit('7a100000-0000-0000-0000-000000000001','{}','fms_stage',(select fis.id from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Decision Yes run' and fs.stage_key='details')); select complete_fms_stage_with_audit((select fis.id from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Decision Yes run' and fs.stage_key='details'),null,null,'{}',null)$$,'second run completes the initial Form');
select lives_ok($$select complete_fms_stage_with_audit((select fis.id from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Decision Yes run' and fs.stage_key='decision'),'yes',null,'{}',null)$$,'Yes decision activates its conditional step');
select is((select fis.status::text from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Decision Yes run' and fs.stage_key='yes_work'),'in_progress','Yes path leaves the conditional work actionable');
select lives_ok($$select complete_fms_stage_with_audit((select fis.id from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id where fi.title='Decision Yes run' and fs.stage_key='yes_work'),null,null,'{}',null)$$,'conditional Yes work completes normally');
select is((select status::text from fms_instances where title='Decision Yes run'),'completed','Yes path completes the live workflow');
reset role;
select * from finish();
rollback;
