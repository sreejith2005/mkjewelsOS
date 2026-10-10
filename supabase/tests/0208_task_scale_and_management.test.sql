begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(77);
select has_function('public','task_feed_page',array['text','text','integer','integer'],'tasks have a bounded server page');
select has_function('public','admin_edit_task_with_audit',array['uuid','jsonb'],'administrators edit through an audited contract');
select has_function('public','admin_delete_task_with_audit',array['uuid','boolean','text'],'administrators delete an occurrence or series');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('20800000-0000-4000-8000-000000000001','authenticated','authenticated','admin-208@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values('20810000-0000-4000-8000-000000000001','Import 208','import-208');
insert into public.branches(id,tenant_id,name,code) values('20820000-0000-4000-8000-000000000001','20810000-0000-4000-8000-000000000001','Import Branch 208','I208');
insert into public.departments(id,tenant_id,branch_id,name,code) values('20830000-0000-4000-8000-000000000001','20810000-0000-4000-8000-000000000001','20820000-0000-4000-8000-000000000001','Import Department 208','D208');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values('20840000-0000-4000-8000-000000000001','20800000-0000-4000-8000-000000000001','20810000-0000-4000-8000-000000000001','20820000-0000-4000-8000-000000000001','20830000-0000-4000-8000-000000000001','Import Admin 208','0000002081','admin-208@example.invalid','I208-1','admin','active','active',true);
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,created_by)
values('20810000-0000-4000-8000-000000000001','task_category','Import Category 208','import_category_208',1,'20840000-0000-4000-8000-000000000001');

create function pg_temp.import_row(p_source_row integer,p_task_key text,p_task_type text,p_destination text,p_schedule_kind text,p_title text) returns jsonb language sql as $$
select jsonb_build_object(
  'source_row',p_source_row,'task_key',p_task_key,'destination',p_destination,'schedule_kind',p_schedule_kind,
  'task_type',p_task_type,'core_task_label','Opening group','title',p_title,'description','Unlock before opening',
  'priority','medium','branch','I208','department','Import Department 208','category','Import Category 208',
  'assignee_email','admin-208@example.invalid','assignee_profile_id','','assignee_name','Import Admin 208',
  'verifier_label','','verifier_profile_id','','starts_on',(now() at time zone 'Asia/Kolkata')::date::text,
  'start_time','09:00','due_time','10:00','planned_at',(now() at time zone 'Asia/Kolkata')::date::text||' 09:00',
  'due_at',(now() at time zone 'Asia/Kolkata')::date::text||' 10:00',
  'recurrence_rule',case when p_schedule_kind='daily' then 'FREQ=DAILY' else null end,
  'requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,
  'assignment_status','assigned','checklist',jsonb_build_array(jsonb_build_object('item_text',p_title,'required',true))
)
$$;
grant execute on function pg_temp.import_row(integer,text,text,text,text,text) to authenticated;


insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('20800000-0000-4000-8000-000000000002','authenticated','authenticated','staff-208@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values('20840000-0000-4000-8000-000000000002','20800000-0000-4000-8000-000000000002','20810000-0000-4000-8000-000000000001','20820000-0000-4000-8000-000000000001','20830000-0000-4000-8000-000000000001','Staff 208','0000002082','staff-208@example.invalid','I208-2','staff','active','active',true);
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by)
select ('20850000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'20810000-0000-4000-8000-000000000001','20820000-0000-4000-8000-000000000001','20830000-0000-4000-8000-000000000001','delegation','Synthetic task '||n,'pending',now()+interval '1 hour','20840000-0000-4000-8000-000000000001' from generate_series(1,123) n;
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
select id,'20840000-0000-4000-8000-000000000002','doer',true,true from task_instances where tenant_id='20810000-0000-4000-8000-000000000001';
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
values('20850000-0000-4000-8000-000000000001','20840000-0000-4000-8000-000000000001','doer',true,true);
insert into public.tenants(id,name,slug) values('20810000-0000-4000-8000-000000000002','Foreign 208','foreign-208');
insert into public.task_instances(id,tenant_id,task_type,title,status,planned_datetime,created_by)
values('20850000-0000-4000-8000-999999999999','20810000-0000-4000-8000-000000000002','delegation','Foreign task','pending',now(),'20840000-0000-4000-8000-000000000001');
create temp table pages(body jsonb);
grant all on pages to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20800000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

select is((task_feed_page('all','pending')->>'total')::integer,123,'all-task count counts tasks, not assignee rows');
select is(jsonb_array_length(task_feed_page('all','pending')->'ids'),50,'first page is bounded');
insert into pages select task_feed_page('all','pending',n,50) from unnest(array[0,50,100]) n;
select is((select count(distinct id)::integer from pages p cross join lateral jsonb_array_elements_text(p.body->'ids') id),123,'all pages contain each task exactly once');
select is((task_feed_page('all','pending')->'counts'->>'pending')::integer,123,'status count is not page length');
select is(jsonb_array_length(task_feed_page('all','pending',150)->'ids'),0,'last page is empty');
select throws_ok($$select task_feed_page('all','pending',0,51)$$,'22023','Invalid task page','oversized requests are rejected');
select lives_ok($$select admin_edit_task_with_audit('20850000-0000-4000-8000-000000000001','{"title":"Corrected task","priority":"high"}')$$,'admin edits another assignee task');
select is((select title from task_instances where id='20850000-0000-4000-8000-000000000001'),'Corrected task','edit is persisted');
select ok(exists(select 1 from audit_logs where record_id='20850000-0000-4000-8000-000000000001' and action='task_admin_edited'),'edit is audited');
select throws_ok($$select admin_edit_task_with_audit('20850000-0000-4000-8000-000000000001','{"status":"completed"}')$$,'22023','Invalid task edit','edit cannot bypass completion');
select lives_ok($$select admin_delete_task_with_audit('20850000-0000-4000-8000-000000000001',false,'Correct import')$$,'admin deletes an occurrence');
select ok(not can_read_task('20850000-0000-4000-8000-000000000001'),'deleted task is unreadable by direct identity');
select throws_ok($$select update_task_with_audit('20850000-0000-4000-8000-000000000001','complete')$$,'22023','Deleted tasks cannot be changed','deleted task cannot be completed through RPC');
select set_config('request.jwt.claim.sub','20800000-0000-4000-8000-000000000002',true);
select throws_ok($$select task_feed_page('all','pending')$$,'42501','All tasks access denied','staff cannot read All Tasks');
select throws_ok($$select admin_delete_task_with_audit('20850000-0000-4000-8000-000000000002',false,'No')$$,'42501','Task administration denied','staff cannot delete');
select throws_ok($$select admin_edit_task_with_audit('20850000-0000-4000-8000-000000000002','{"title":"No"}')$$,'42501','Task administration denied','staff cannot edit');
select is((task_feed_page('delegated','pending')->>'total')::integer,122,'staff retains assigned one-time Delegated semantics');
select set_config('request.jwt.claim.sub','20800000-0000-4000-8000-000000000001',true);
select lives_ok($$select begin_task_bulk_import(repeat('a',64),'proof-208.csv',2)$$,'import starts');
select is((commit_task_bulk_import_chunk((select id from task_import_batches where import_hash=repeat('a',64)),
  jsonb_build_array(pg_temp.import_row(2,'proof-task','delegation','recurring_todo','daily','Upload required'),
    pg_temp.import_row(3,'click-task','checklist','tasks','one_time','Click complete')))->>'created')::integer,2,'mixed import with No evidence creates both rows');
select is((select requires_upload from task_templates where title='Upload required'),true,'imported Task template requires proof');
select is((select requires_upload from task_instances where title='Upload required'),true,'initial occurrence requires proof');
select is((select requires_upload from task_instances where title='Click complete'),false,'imported Checklist remains click completion');
select throws_ok($$select update_task_with_audit((select id from task_instances where title='Upload required'),'complete')$$,'23514','A required upload is missing','import cannot complete without proof');
select lives_ok($$select update_task_with_audit((select id from task_instances where title='Click complete'),'complete')$$,'checklist completes without proof');
select lives_ok($$select admin_delete_task_with_audit((select id from task_instances where title='Upload required'),true,'Wrong schedule')$$,'series deletion succeeds');
select ok(not exists(select 1 from task_templates where title='Upload required'),'series is absent from active template reads');
select ok(not exists(select 1 from task_instances where title='Upload required'),'unfinished series occurrences disappear');
select lives_ok($$select begin_task_bulk_import(repeat('a',64),'proof-208.csv',2)$$,'identical file can start again after deletion');
select is((commit_task_bulk_import_chunk((select id from task_import_batches where import_hash=repeat('a',64)),
  jsonb_build_array(pg_temp.import_row(2,'proof-task','delegation','recurring_todo','daily','Upload required'),
    pg_temp.import_row(3,'click-task','checklist','tasks','one_time','Click complete')))->>'created')::integer,1,'only deleted series is recreated; unrelated row replays');
select is((select count(*)::integer from task_instances where title='Click complete'),1,'re-import does not duplicate unrelated completed checklist');
reset role;
select ok(exists(select 1 from task_import_row_registry where retired_business_fingerprint is not null and tenant_id='20810000-0000-4000-8000-000000000001'),'retired fingerprint history is retained');
select throws_ok($$update task_instances set status='completed',requires_upload=false where title='Upload required' and deleted_at is null$$,'23514','A required upload is missing','direct SQL cannot bypass imported proof');
select throws_ok($$insert into task_instances(tenant_id,branch_id,department_id,task_template_id,task_type,title,status,planned_datetime) select tenant_id,branch_id,department_id,id,'delegation','Resurrection','pending',now() from task_templates where title='Upload required' and deleted_at is not null$$,'22023','Deleted schedules cannot generate tasks','deleted schedule cannot regenerate');
select throws_ok($$update task_templates set is_active=true where title='Upload required' and deleted_at is not null$$,'22023','Deleted schedules cannot be changed','deleted template cannot reactivate');
insert into task_attachments(task_instance_id,file_url,uploaded_by)
select id,tenant_id::text||'/'||id::text||'/proof.pdf','20840000-0000-4000-8000-000000000001' from task_instances where title='Upload required' and deleted_at is null;
set local role authenticated;
select throws_ok($$select update_task_with_audit((select id from task_instances where title='Upload required'),'complete')$$,'23514','A required upload is missing','attachment metadata without its Storage object is not proof');
reset role;
insert into storage.objects(bucket_id,name,metadata)
select 'task-attachments',file_url,'{"mimetype":"application/pdf","size":1024}'::jsonb from task_attachments where task_instance_id in(select id from task_instances where title='Upload required' and deleted_at is null);
set local role authenticated;
select lives_ok($$select update_task_with_audit((select id from task_instances where title='Upload required'),'complete')$$,'real private proof permits completion');
select lives_ok($$select admin_delete_task_with_audit((select id from task_instances where title='Upload required'),true,'Retire corrected series')$$,'series with completed history can be retired');
select is((select status::text from task_instances where title='Upload required'),'completed','series deletion preserves completed work');
select ok(exists(select 1 from task_attachments a join storage.objects o on o.name=a.file_url and o.bucket_id='task-attachments' where a.task_instance_id in(select id from task_instances where title='Upload required')),'series deletion preserves completed private evidence');
reset role;
select is((select count(*)::integer from task_templates where title='Upload required' and deleted_at is not null),2,'both retired schedules are tombstoned');
select ok(exists(select 1 from audit_logs where action='task_admin_deleted' and new_value->>'completed_preserved'='1'),'preserved completion count is audited');
select set_config('request.jwt.claim.sub','20800000-0000-4000-8000-000000000001',true);
update user_profiles set is_login_enabled=false where id='20840000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select admin_delete_task_with_audit('20850000-0000-4000-8000-000000000002',false,'No')$$,'42501','Task administration denied','inactive admin cannot delete');
reset role;
update user_profiles set is_login_enabled=true where id='20840000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select admin_edit_task_with_audit('20850000-0000-4000-8000-999999999999','{"title":"No"}')$$,'42501','Task administration denied','admin cannot edit another tenant');
select throws_ok($$select admin_delete_task_with_audit('20850000-0000-4000-8000-999999999999',false,'No')$$,'42501','Task administration denied','admin cannot delete another tenant');
reset role;
insert into task_watchers(tenant_id,task_instance_id,user_profile_id,created_by)
values('20810000-0000-4000-8000-000000000001','20850000-0000-4000-8000-000000000002','20840000-0000-4000-8000-000000000001','20840000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok($$select admin_edit_task_with_audit('20850000-0000-4000-8000-000000000002','{"title":"Admin can manage watched work"}')$$,'admin management is independent of watcher completion');
select throws_ok($$select update_task_with_audit('20850000-0000-4000-8000-000000000002','complete',p_remark=>'On behalf')$$,'42501','In Loop participants may only view and comment on this task','watcher completion remains read-only');
select lives_ok($$select admin_delete_task_with_audit('20850000-0000-4000-8000-000000000002',false,'Incorrect work')$$,'admin may delete a watched task through audited administration');
reset role;
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by)
select ('20860000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'20810000-0000-4000-8000-000000000001','20820000-0000-4000-8000-000000000001','20830000-0000-4000-8000-000000000001','delegation','Scale task '||n,'pending',now()+interval '1 hour','20840000-0000-4000-8000-000000000001' from generate_series(1,10000) n;
set local role authenticated;
select lives_ok($$select get_dashboard_metrics('{}')$$,'dashboard reads remain executable after tombstones');
select lives_ok($$select get_employee_task_progress('{}')$$,'employee progress reads remain executable');
select lives_ok($$select get_home_summary('{}')$$,'home reads remain executable');
select lives_ok($$select get_recurring_todo_workspace('{}')$$,'recurring workspace reads remain executable');
select lives_ok($$select get_task_evidence_workspace('{}')$$,'evidence workspace reads remain executable');
select lives_ok($$select get_task_template_directory('{}')$$,'template directory reads remain executable');
select lives_ok($$select get_management_insights_options_v1('{}')$$,'management options retain reporting scope');
select ok(not exists(select 1 from task_instances_live where id in('20850000-0000-4000-8000-000000000001','20850000-0000-4000-8000-000000000002')),'live reader view excludes deleted work');
select is((task_feed_page('all','pending')->>'total')::integer,10121,'ten thousand additional tasks have complete counts');
select is(jsonb_array_length(task_feed_page('all','pending')->'ids'),50,'ten thousand tasks still hydrate only fifty');
select ok(not exists(select 1 from jsonb_array_elements_text(task_feed_page('all','pending')->'ids') id where id='20850000-0000-4000-8000-999999999999'),'all-task page excludes another tenant');
select lives_ok($$select save_recurring_todo_template_with_audit(null,jsonb_build_object('title','Editable series','task_type','delegation','schedule_kind','daily','recurrence_rule','FREQ=DAILY','planned_time','09:00','due_time','10:00','priority','medium','default_assignee_type','specific_user','default_assignee_user_id','20840000-0000-4000-8000-000000000001','branch_id','20820000-0000-4000-8000-000000000001','category_id',(select id from dropdown_masters where value='import_category_208'),'is_active',true))$$,'create schedule for occurrence deletion regression');
select lives_ok($$select admin_delete_task_with_audit((select id from task_instances where title='Editable series'),false,'Skip occurrence')$$,'delete one occurrence while preserving schedule');
select lives_ok($$select save_recurring_todo_template_with_audit((select id from task_templates where title='Editable series'),jsonb_build_object('title','Editable series','task_type','delegation','schedule_kind','daily','recurrence_rule','FREQ=DAILY','planned_time','09:00','due_time','10:00','priority','medium','default_assignee_type','specific_user','default_assignee_user_id','20840000-0000-4000-8000-000000000001','branch_id','20820000-0000-4000-8000-000000000001','category_id',(select id from dropdown_masters where value='import_category_208'),'is_active',true))$$,'editing remaining schedule skips deleted occurrence');
select lives_ok($$select import_delegation_tasks_with_audit(jsonb_build_array(jsonb_build_object('title','Legacy imported Task','doer_email','admin-208@example.invalid','due_at',now()::text)),repeat('c',64))$$,'legacy importer creates required-proof Task');
select is((select requires_upload from task_instances where title='Legacy imported Task'),true,'legacy importer persists proof requirement');
select lives_ok($$select admin_delete_task_with_audit((select id from task_instances where title='Legacy imported Task'),false,'Correct legacy file')$$,'legacy imported task can be deleted');
select lives_ok($$select import_delegation_tasks_with_audit(jsonb_build_array(jsonb_build_object('title','Legacy imported Task','doer_email','admin-208@example.invalid','due_at',now()::text)),repeat('c',64))$$,'identical legacy file can create replacement after deletion');
select is((select count(*)::integer from task_instances where title='Legacy imported Task'),1,'legacy re-import creates one live replacement');
select lives_ok($$select import_task_bulk_with_audit(jsonb_build_object('tasks',jsonb_build_array(
jsonb_build_object('title','Canonical one-time Task','task_mode','one_time','doer_emails',jsonb_build_array('admin-208@example.invalid'),'planned_at',(now() at time zone 'Asia/Kolkata')::date::text||'T09:00:00+05:30','branch','I208','category','import_category_208','requires_upload',false),
jsonb_build_object('title','Canonical recurring Task','task_mode','recurring','primary_doer_email','admin-208@example.invalid','recurrence_kind','daily','planned_at',(now() at time zone 'Asia/Kolkata')::date::text||'T09:00:00+05:30','branch','I208','category','import_category_208','requires_upload',false))),repeat('d',64),'canonical.csv')$$,'canonical importer creates one-time and recurring required-proof Tasks');
select is((select count(*)::integer from task_instances where title in('Canonical one-time Task','Canonical recurring Task') and task_type='delegation' and requires_upload),2,'canonical initial occurrences both require proof');
select is((select requires_upload from task_templates where title='Canonical recurring Task'),true,'canonical future schedule also requires proof');
reset role;
insert into fms_flows(id,tenant_id,name,created_by) values('20880000-0000-4000-8000-000000000001','20810000-0000-4000-8000-000000000001','Page workflow','20840000-0000-4000-8000-000000000001');
insert into fms_stages(id,fms_flow_id,name,sort_order) values('20880000-0000-4000-8000-000000000002','20880000-0000-4000-8000-000000000001','Undated',0),('20880000-0000-4000-8000-000000000003','20880000-0000-4000-8000-000000000001','Future',1);
insert into fms_instances(id,tenant_id,branch_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,started_by)
select '20880000-0000-4000-8000-000000000004',tenant_id,'20820000-0000-4000-8000-000000000001',id,family_id,version,'PAGE-WORKFLOW','Page workflow','20840000-0000-4000-8000-000000000002' from fms_flows where id='20880000-0000-4000-8000-000000000001';
insert into fms_instance_stages(id,fms_instance_id,fms_stage_id,status,planned_datetime,assigned_to) values
('20880000-0000-4000-8000-000000000005','20880000-0000-4000-8000-000000000004','20880000-0000-4000-8000-000000000002','pending',null,array['20840000-0000-4000-8000-000000000002'::uuid]),
('20880000-0000-4000-8000-000000000006','20880000-0000-4000-8000-000000000004','20880000-0000-4000-8000-000000000003','pending',now()+interval '30 days',array['20840000-0000-4000-8000-000000000002'::uuid]);
set local role authenticated;
select set_config('request.jwt.claim.sub','20800000-0000-4000-8000-000000000002',true);
select is((task_feed_page('mine','pending')->>'total')::integer,2,'staff My Tasks preserves open FMS regardless of date');
select ok(task_feed_page('mine','pending')->'ids' ? '20880000-0000-4000-8000-000000000005','undated FMS assignment remains visible');
select ok(task_feed_page('mine','pending')->'ids' ? '20880000-0000-4000-8000-000000000006','future FMS assignment remains visible');
reset role;
select function_privs_are('public','task_feed_page',array['text','text','integer','integer'],'anon',array[]::text[],'anon has no page grant');
select function_privs_are('public','admin_delete_task_with_audit',array['uuid','boolean','text'],'service_role',array[]::text[],'service role has no browser deletion grant');

select * from finish();
rollback;
