begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('23500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'edit-235-'||n||'@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now() from generate_series(1,4) n;
insert into tenants(id,name,slug) values
 ('23510000-0000-4000-8000-000000000001','Edit 235','edit-235'),
 ('23510000-0000-4000-8000-000000000002','Foreign 235','foreign-235');
insert into branches(id,tenant_id,name,code) values
 ('23520000-0000-4000-8000-000000000001','23510000-0000-4000-8000-000000000001','Edit Branch','E235'),
 ('23520000-0000-4000-8000-000000000002','23510000-0000-4000-8000-000000000001','Other Branch','O235'),
 ('23520000-0000-4000-8000-000000000003','23510000-0000-4000-8000-000000000002','Foreign Branch','F235');
insert into departments(id,tenant_id,branch_id,name,code) values
 ('23530000-0000-4000-8000-000000000001','23510000-0000-4000-8000-000000000001','23520000-0000-4000-8000-000000000001','Edit Department','D235'),
 ('23530000-0000-4000-8000-000000000002','23510000-0000-4000-8000-000000000001','23520000-0000-4000-8000-000000000002','Other Department','O235');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
select ('23540000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('23500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '23510000-0000-4000-8000-000000000001',
 case when n=3 then '23520000-0000-4000-8000-000000000002' else '23520000-0000-4000-8000-000000000001' end::uuid,
 case when n=3 then '23530000-0000-4000-8000-000000000002' else '23530000-0000-4000-8000-000000000001' end::uuid,
 'Editor '||n,'000000235'||n,'edit-235-'||n||'@example.invalid','E235-'||n,
 case when n=1 then 'admin' when n=4 then 'manager' else 'staff' end::user_role,'active','active',true from generate_series(1,4) n;
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,due_datetime,requires_upload,created_by)
select ('23550000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'23510000-0000-4000-8000-000000000001',
 '23520000-0000-4000-8000-000000000001','23530000-0000-4000-8000-000000000001','delegation','Edit task '||n,'pending',
 now()+interval '1 hour',now()+interval '2 hours',true,'23540000-0000-4000-8000-000000000001' from generate_series(1,3) n;
insert into task_instances(id,tenant_id,task_type,title,planned_datetime,created_by) values
 ('23550000-0000-4000-8000-000000000004','23510000-0000-4000-8000-000000000002','delegation','Foreign',now(),'23540000-0000-4000-8000-000000000001'),
 ('23550000-0000-4000-8000-000000000005','23510000-0000-4000-8000-000000000001','fms','Protected workflow',now(),'23540000-0000-4000-8000-000000000001');
update task_instances set source='bulk_import' where id='23550000-0000-4000-8000-000000000002';
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_active)
select ('23550000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'23540000-0000-4000-8000-000000000002','doer',true from generate_series(1,3) n;
insert into task_watchers(tenant_id,task_instance_id,user_profile_id,created_by) values
 ('23510000-0000-4000-8000-000000000001','23550000-0000-4000-8000-000000000001','23540000-0000-4000-8000-000000000001','23540000-0000-4000-8000-000000000001');
insert into task_checklists(id,task_instance_id,item_text,is_completed,completed_by,completed_at) values
 ('23560000-0000-4000-8000-000000000001','23550000-0000-4000-8000-000000000001','Finished item',true,'23540000-0000-4000-8000-000000000002',now()),
 ('23560000-0000-4000-8000-000000000002','23550000-0000-4000-8000-000000000001','Remove me',false,null,null),
 ('23560000-0000-4000-8000-000000000003','23550000-0000-4000-8000-000000000003','Foreign item',false,null,null);
select has_column('public','task_checklists','deleted_at','removed checklist items have durable history');
-- Test the override trigger itself as table owner with an authenticated admin JWT,
-- before any audited RPC has set the authoring GUC in this transaction.
select set_config('request.jwt.claim.sub','23500000-0000-4000-8000-000000000001',true);
select throws_ok($$update task_instances set upload_requirement_overridden=true where id='23550000-0000-4000-8000-000000000003'$$,'42501','Task administration denied','unset authoring context cannot forge an override even for an admin');
set local role authenticated;
select set_config('request.jwt.claim.sub','23500000-0000-4000-8000-000000000001',true);
select lives_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000001',
 '{"task_type":"checklist","requires_upload":false,"requires_remark":true,"buddy_assignment_allowed":true,"core_task_label":"Opening",
   "verification_required":true,"verifier_user_profile_id":"23540000-0000-4000-8000-000000000003",
   "doer_ids":["23540000-0000-4000-8000-000000000003"],"watcher_ids":["23540000-0000-4000-8000-000000000001"],
   "checklist":[{"id":"23560000-0000-4000-8000-000000000001","item_text":"Renamed finished item","is_required":false},{"item_text":"New item","is_required":true}]}')$$,
 'admin can edit watched work without becoming its doer');
select is((select task_type::text from task_instances where id='23550000-0000-4000-8000-000000000001'),'checklist','type conversion persists');
select ok((select not requires_upload and requires_remark and buddy_assignment_allowed and core_task_label='Opening' and verification_status='pending' from task_instances where id='23550000-0000-4000-8000-000000000001'),'all requirements persist');
select is((select completed_by from task_checklists where id='23560000-0000-4000-8000-000000000001'),'23540000-0000-4000-8000-000000000002'::uuid,'existing checklist completion actor retained');
select ok((select is_completed and completed_at is not null and item_text='Renamed finished item' from task_checklists where id='23560000-0000-4000-8000-000000000001'),'rename keeps checklist progress');
select is((select count(*)::integer from task_checklists where task_instance_id='23550000-0000-4000-8000-000000000001'),2,'archived items are absent from normal client reads');
select ok((select not is_active from task_assignees where task_instance_id='23550000-0000-4000-8000-000000000001' and user_profile_id='23540000-0000-4000-8000-000000000002'),'old assignment retained inactive');
select ok(exists(select 1 from task_assignees where task_instance_id='23550000-0000-4000-8000-000000000001' and user_profile_id='23540000-0000-4000-8000-000000000003' and is_active),'new doer assigned');
select ok(exists(select 1 from audit_logs where record_id='23550000-0000-4000-8000-000000000001' and action='task_admin_edited' and old_value ? 'checklist' and new_value ? 'assignees'),'child state recorded in same audit');
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000001','{"status":"completed"}')$$,'22023','Invalid task edit','editing cannot bypass completion');
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000001','{"requires_upload":"false"}')$$,'22023','Invalid task edit','string booleans rejected');
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000001','{"requires_form":true,"form_template_id":null}')$$,'22023','Select a published required form','required form cannot be missing');
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000001','{"verification_required":true,"verifier_user_profile_id":null}')$$,'22023','Select an active verifier','verifier required');
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000001','{"branch_id":"23520000-0000-4000-8000-000000000003"}')$$,'42501','Task reference is outside your scope','cross tenant reference denied');
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000001','{"department_id":"23530000-0000-4000-8000-000000000002"}')$$,'22023','Department must belong to the selected branch','branch department mismatch denied');
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000001','{"checklist":[{"id":"23560000-0000-4000-8000-000000000003","item_text":"Steal","is_required":true}]}')$$,'22023','Checklist item is not editable on this task','other task checklist id denied');
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000001','{"checklist":[{"item_text":"Bad","is_required":true,"is_completed":true}]}')$$,'22023','Invalid checklist edit','checklist progress cannot be forged');
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000001','{"doer_ids":["23540000-0000-4000-8000-000000000003"],"watcher_ids":["23540000-0000-4000-8000-000000000003"]}')$$,'22023','A doer cannot also be In Loop','conflicting participants denied');
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000004','{"title":"No"}')$$,'42501','Task administration denied','cross tenant task denied');
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000005','{"task_type":"delegation"}')$$,'22023','FMS work must be edited through its workflow','workflow type cannot be changed');
select lives_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000002','{"requires_upload":false}')$$,'explicit upload override supported for imported tasks');
select ok((select not requires_upload from task_instances where id='23550000-0000-4000-8000-000000000002'),'import trigger does not restore explicitly disabled upload');
select lives_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000003','{"title":"Compatibility edit","priority":"low"}')$$,'older partial edit payloads remain supported');
select set_config('request.jwt.claim.sub','23500000-0000-4000-8000-000000000002',true);
select throws_ok($$update task_instances set upload_requirement_overridden=true,requires_upload=false where id='23550000-0000-4000-8000-000000000003'$$,'42501',null,'direct SQL cannot forge an upload override');
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000002','{"requires_upload":false}')$$,'42501','Task administration denied','ordinary doer cannot edit requirements through API');
select lives_ok($$select update_task_with_audit('23550000-0000-4000-8000-000000000002','complete')$$,'doer can complete imported task after upload requirement removed');
select throws_ok($$select update_task_with_audit('23550000-0000-4000-8000-000000000003','complete')$$,'23514','A required upload is missing','unchanged task still enforces upload');
select set_config('request.jwt.claim.sub','23500000-0000-4000-8000-000000000001',true);
-- The task's required checklist item is open, so the 0342 gate may refuse first; either refusal keeps it open.
select throws_ok($$select update_task_with_audit('23550000-0000-4000-8000-000000000001','complete',p_remark=>'Not a doer')$$,null,null,'admin watcher still cannot complete');
select isnt((select status::text from task_instances where id='23550000-0000-4000-8000-000000000001'),'completed','the watcher attempt leaves the task open');
reset role;
select ok((select deleted_at is not null and not is_completed from task_checklists where id='23560000-0000-4000-8000-000000000002'),'removed checklist data retained in database');
select set_config('request.jwt.claim.sub','',true);
insert into task_templates(id,tenant_id,branch_id,department_id,title,task_type,recurrence_rule,planned_time,default_assignee_type,default_assignee_user_id,created_by)
values('23570000-0000-4000-8000-000000000001','23510000-0000-4000-8000-000000000001','23520000-0000-4000-8000-000000000001','23530000-0000-4000-8000-000000000001',
 'Edit series','checklist','RRULE:FREQ=DAILY','09:00','specific_user','23540000-0000-4000-8000-000000000003','23540000-0000-4000-8000-000000000001');
update task_instances set task_template_id='23570000-0000-4000-8000-000000000001' where id='23550000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','23500000-0000-4000-8000-000000000001',true);
select is((select jsonb_array_length(value->'checklist') from jsonb_array_elements(get_recurring_todo_workspace()->'instances') where value->>'id'='23550000-0000-4000-8000-000000000001'),2,'recurring workspace excludes archived checklist items');
select lives_ok($$select save_form_draft_with_audit(null,'{"name":"Edit completion 235"}','[{"key":"answer","label":"Answer","type":"text","required":true}]')$$,'create real task completion form');
select lives_ok($$select publish_form_with_audit((select id from form_templates where name='Edit completion 235'))$$,'publish task form');
select lives_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000003',jsonb_build_object('requires_form',true,'form_template_id',(select id from form_templates where name='Edit completion 235'),'requires_remark',true))$$,'enable upload plus form plus remark');
select set_config('request.jwt.claim.sub','23500000-0000-4000-8000-000000000002',true);
select throws_ok($$select submit_task_form_with_audit('23550000-0000-4000-8000-000000000003',(select id from form_templates where name='Edit completion 235'),'{"answer":"Done"}','Completed safely')$$,'23514','A required upload is missing','form cannot bypass upload requirement');
select is((select count(*)::integer from form_submissions where linked_record_id='23550000-0000-4000-8000-000000000003'),0,'failed completion rolls back form submission');
reset role;
insert into storage.objects(bucket_id,name,metadata) values('task-attachments',
 '23510000-0000-4000-8000-000000000001/23550000-0000-4000-8000-000000000003/evidence.pdf',
 '{"mimetype":"application/pdf","size":20}');
insert into task_attachments(task_instance_id,file_url,uploaded_by)
values('23550000-0000-4000-8000-000000000003','23510000-0000-4000-8000-000000000001/23550000-0000-4000-8000-000000000003/evidence.pdf','23540000-0000-4000-8000-000000000002');
update task_instances set task_template_id='23570000-0000-4000-8000-000000000001' where id='23550000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','23500000-0000-4000-8000-000000000002',true);
select throws_ok($$select complete_recurring_task_with_image_with_audit('23550000-0000-4000-8000-000000000003','evidence')$$,'23514','Complete the required form after uploading evidence','direct recurring image completion cannot bypass a required form');
select throws_ok($$select complete_uploaded_task_with_audit('23550000-0000-4000-8000-000000000003','evidence')$$,'23514','The required task form submission is missing','direct upload completion cannot bypass a required form');
-- 0342: the form path is refused while a required checklist item is unticked, and rolls back.
select throws_ok($$select submit_task_form_with_audit('23550000-0000-4000-8000-000000000003',(select id from form_templates where name='Edit completion 235'),'{"answer":"Done"}')$$,'23514','Tick every required checklist item before completing this task','form cannot bypass the checklist');
select is((select count(*)::integer from form_submissions where linked_record_id='23550000-0000-4000-8000-000000000003'),0,'checklist refusal rolls back the form submission');
select lives_ok($$select update_task_with_audit('23550000-0000-4000-8000-000000000003','checklist','23560000-0000-4000-8000-000000000003',true)$$,'doer ticks the required item');
select lives_ok($$select submit_task_form_with_audit('23550000-0000-4000-8000-000000000003',(select id from form_templates where name='Edit completion 235'),'{"answer":"Done"}','Completed safely')$$,'submission and completion succeed together with all requirements');
select ok((select status='completed' and completion_remark='Completed safely' and completed_by='23540000-0000-4000-8000-000000000002' and actual_datetime is not null from task_instances where id='23550000-0000-4000-8000-000000000003'),'atomic form completion records actor and remark');
select is((select count(*)::integer from form_submissions where linked_record_id='23550000-0000-4000-8000-000000000003'),1,'exactly one successful submission retained');
select set_config('request.jwt.claim.sub','23500000-0000-4000-8000-000000000001',true);
select lives_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000003','{"task_type":"checklist","title":"Edited completed history","doer_ids":["23540000-0000-4000-8000-000000000003"]}')$$,'completed task details can be edited without reopening');
select ok((select status='completed' and completion_remark='Completed safely' and completed_by='23540000-0000-4000-8000-000000000002' from task_instances where id='23550000-0000-4000-8000-000000000003'),'completed history survives type and assignee edits');
reset role;
select ok((select task_form_submission_module_matches(t,'delegation_task') from task_instances t where id='23550000-0000-4000-8000-000000000003'),'audited type conversion retains prior form proof');
select ok((select not task_form_submission_module_matches(t,'checklist_task') from task_instances t where id='23550000-0000-4000-8000-000000000002'),'wrong module still rejected without type conversion');
select set_config('request.jwt.claim.sub','',true);
update user_profiles set buddy_id='23540000-0000-4000-8000-000000000004' where id='23540000-0000-4000-8000-000000000002';
insert into user_availability(tenant_id,user_profile_id,date,status,reason,logged_by)
values('23510000-0000-4000-8000-000000000001','23540000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Kolkata')::date,'absent','full edit coverage fixture','23540000-0000-4000-8000-000000000001');
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,planned_datetime,due_datetime,requires_upload,created_by)
values('23550000-0000-4000-8000-000000000006','23510000-0000-4000-8000-000000000001','23520000-0000-4000-8000-000000000001','23530000-0000-4000-8000-000000000001',
 'delegation','Coverage edit',((now() at time zone 'Asia/Kolkata')::date::text||' 12:00 Asia/Kolkata')::timestamptz,((now() at time zone 'Asia/Kolkata')::date::text||' 13:00 Asia/Kolkata')::timestamptz,false,'23540000-0000-4000-8000-000000000001');
insert into task_watchers(tenant_id,task_instance_id,user_profile_id,created_by)
values('23510000-0000-4000-8000-000000000001','23550000-0000-4000-8000-000000000006','23540000-0000-4000-8000-000000000001','23540000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','23500000-0000-4000-8000-000000000001',true);
select lives_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000006','{"doer_ids":["23540000-0000-4000-8000-000000000002"]}')$$,'admin watcher can edit an absent doer with coverage');
select ok((select coverage_status='covered' from task_instances where id='23550000-0000-4000-8000-000000000006'),'coverage resolution persists in audited edit');
select ok(exists(select 1 from task_assignees where task_instance_id='23550000-0000-4000-8000-000000000006' and user_profile_id='23540000-0000-4000-8000-000000000004' and is_active),'active buddy receives work');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','23500000-0000-4000-8000-000000000004',true);
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000003','{"doer_ids":["23540000-0000-4000-8000-000000000003"]}')$$,'42501','Task administration denied','manager cannot use task administration to assign across branches');
reset role;
update user_profiles set is_login_enabled=false where id='23540000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','23500000-0000-4000-8000-000000000001',true);
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000003','{"title":"No"}')$$,'42501',null,'inactive actor denied');
reset role;
set local role anon;
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000003','{"title":"No"}')$$,'42501',null,'anonymous execution denied');
reset role;
set local role service_role;
select throws_ok($$select admin_edit_task_with_audit('23550000-0000-4000-8000-000000000003','{"title":"No"}')$$,'42501',null,'service role cannot use human edit RPC');
reset role;
select * from finish();
rollback;
