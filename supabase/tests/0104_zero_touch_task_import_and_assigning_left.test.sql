begin;
select plan(30);

select has_column('public','task_instances','assignment_status','task instances expose durable assignment state');
select has_column('public','task_templates','assignment_status','task templates expose durable assignment state');
select has_table('public','task_import_row_registry','cross-file import fingerprints have a tenant registry');
select has_column('public','task_import_row_registry','business_fingerprint','registry stores only a business fingerprint');
select hasnt_column('public','task_import_row_registry','title','registry never stores task titles');
select hasnt_column('public','task_import_row_registry','employee_name','registry never stores employee names');
select hasnt_column('public','task_import_row_registry','email','registry never stores employee emails');
select has_function('public','list_assigning_left_tasks',array[]::text[],'admins can list Assigning Left through a protected RPC');
select has_function('public','assign_imported_task_with_audit',array['text','uuid','uuid'],'Assigning Left uses one audited assignment RPC');
select function_privs_are('public','list_assigning_left_tasks',array[]::text[],'anon',array[]::text[],'anonymous users cannot list Assigning Left');
select function_privs_are('public','assign_imported_task_with_audit',array['text','uuid','uuid'],'authenticated',array['EXECUTE'],'authenticated callers reach server authorization');
select table_privs_are('public','task_import_row_registry','authenticated',array[]::text[],'browser clients cannot read fingerprint registry rows');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('10400000-0000-4000-8000-000000000001','authenticated','authenticated','admin-104@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('10400000-0000-4000-8000-000000000002','authenticated','authenticated','manager-104@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('10400000-0000-4000-8000-000000000003','authenticated','authenticated','doer-104@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values('10410000-0000-4000-8000-000000000001','Import 104','import-104');
insert into public.branches(id,tenant_id,name,code) values('10420000-0000-4000-8000-000000000001','10410000-0000-4000-8000-000000000001','Import Branch 104','I104');
insert into public.departments(id,tenant_id,branch_id,name,code) values('10430000-0000-4000-8000-000000000001','10410000-0000-4000-8000-000000000001','10420000-0000-4000-8000-000000000001','Import Department 104','D104');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,reports_to_user_id)
values
 ('10440000-0000-4000-8000-000000000001','10400000-0000-4000-8000-000000000001','10410000-0000-4000-8000-000000000001','10420000-0000-4000-8000-000000000001','10430000-0000-4000-8000-000000000001','Import Admin 104','0000001041','admin-104@example.invalid','I104-1','admin','active','active',true,null),
 ('10440000-0000-4000-8000-000000000002','10400000-0000-4000-8000-000000000002','10410000-0000-4000-8000-000000000001','10420000-0000-4000-8000-000000000001','10430000-0000-4000-8000-000000000001','Import Manager 104','0000001042','manager-104@example.invalid','I104-2','manager','active','active',true,null),
 ('10440000-0000-4000-8000-000000000003','10400000-0000-4000-8000-000000000003','10410000-0000-4000-8000-000000000001','10420000-0000-4000-8000-000000000001','10430000-0000-4000-8000-000000000001','Import Doer 104','0000001043','doer-104@example.invalid','I104-3','doer','active','active',true,'10440000-0000-4000-8000-000000000002');
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,created_by)
values('10410000-0000-4000-8000-000000000001','task_category','Import Category 104','import_category_104',1,'10440000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','10400000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

select is((public.begin_task_bulk_import(repeat('1',64),'zero-touch.csv',5)->>'outcome'),'in_progress','admin starts a zero-touch batch');
select is(
  (public.commit_task_bulk_import_chunk(
    (select id from public.task_import_batches where tenant_id='10410000-0000-4000-8000-000000000001' and import_hash=repeat('1',64)),
    jsonb_build_array(
      jsonb_build_object('source_row',2,'task_key','name-match','destination','tasks','schedule_kind','one_time','task_type','delegation','core_task_label','','title','Synthetic name match','description','','priority','medium','branch','I104','department','Import Department 104','category','Import Category 104','assignee_email','','assignee_profile_id','','assignee_name','Import Doer 104','verifier_label','','verifier_profile_id','','starts_on','2026-08-27','start_time','09:00','due_time','10:00','planned_at','2026-08-27 09:00','due_at','2026-08-27 10:00','recurrence_rule','','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,'assignment_status','assigning_left','checklist','[]'::jsonb),
      jsonb_build_object('source_row',3,'task_key','blank-recurring','destination','recurring_todo','schedule_kind','daily','task_type','checklist','core_task_label','Synthetic blank','title','Synthetic blank','description','','priority','medium','branch','I104','department','Import Department 104','category','Import Category 104','assignee_email','','assignee_profile_id','','assignee_name','','verifier_label','','verifier_profile_id','','starts_on','2026-08-27','start_time','09:00','due_time','10:00','planned_at','2026-08-27 09:00','due_at','2026-08-27 10:00','recurrence_rule','FREQ=DAILY','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,'assignment_status','assigning_left','checklist',jsonb_build_array(jsonb_build_object('item_text','Synthetic item','required',true))),
      jsonb_build_object('source_row',4,'task_key','manager-verifier','destination','tasks','schedule_kind','one_time','task_type','delegation','core_task_label','','title','Synthetic manager verifier','description','','priority','medium','branch','I104','department','Import Department 104','category','Import Category 104','assignee_email','','assignee_profile_id','','assignee_name','Import Doer 104','verifier_label','Account Manager','verifier_profile_id','','starts_on','2026-08-27','start_time','11:00','due_time','12:00','planned_at','2026-08-27 11:00','due_at','2026-08-27 12:00','recurrence_rule','','requires_upload',false,'verification_required',true,'buddy_assignment_allowed',false,'is_active',true,'assignment_status','assigning_left','checklist','[]'::jsonb),
      jsonb_build_object('source_row',5,'task_key','blank-task','destination','tasks','schedule_kind','one_time','task_type','delegation','core_task_label','','title','Synthetic blank task','description','','priority','medium','branch','I104','department','Import Department 104','category','Import Category 104','assignee_email','','assignee_profile_id','','assignee_name','','verifier_label','','verifier_profile_id','','starts_on','2026-08-27','start_time','13:00','due_time','14:00','planned_at','2026-08-27 13:00','due_at','2026-08-27 14:00','recurrence_rule','','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,'assignment_status','assigning_left','checklist','[]'::jsonb),
      jsonb_build_object('source_row',6,'task_key','assigned-no-verifier','destination','tasks','schedule_kind','one_time','task_type','delegation','core_task_label','','title','Synthetic assigned without verifier','description','','priority','medium','branch','I104','department','Import Department 104','category','Import Category 104','assignee_email','','assignee_profile_id','','assignee_name','Import Admin 104','verifier_label','Unknown verifier','verifier_profile_id','','starts_on','2026-08-27','start_time','15:00','due_time','16:00','planned_at','2026-08-27 15:00','due_at','2026-08-27 16:00','recurrence_rule','','requires_upload',false,'verification_required',true,'buddy_assignment_allowed',false,'is_active',true,'assignment_status','assigning_left','checklist','[]'::jsonb)
    )
  )->>'created')::integer,
  5,
  'written names auto-assign while blank names still import'
);

select ok(exists(
  select 1 from public.task_instances task
  join public.task_assignees assignment on assignment.task_instance_id=task.id and assignment.is_active
  where task.title='Synthetic name match' and task.assignment_status='assigned' and assignment.user_profile_id='10440000-0000-4000-8000-000000000003'
),'one exact written name receives its assignee');
select ok(exists(
  select 1 from public.task_templates
  where title='Synthetic blank' and assignment_status='assigning_left' and default_assignee_user_id is null and not is_active
),'blank recurring work remains inactive in Assigning Left');
select ok(exists(
  select 1 from public.task_instances
  where title='Synthetic manager verifier' and assignment_status='assigned' and verifier_user_profile_id='10440000-0000-4000-8000-000000000002'
),'unmatched verifier label falls back to the assignee reporting manager');
select ok(exists(
  select 1 from public.task_instances task
  join public.task_assignees assignment on assignment.task_instance_id=task.id and assignment.is_active
  where task.title='Synthetic assigned without verifier' and task.assignment_status='assigned' and task.verifier_user_profile_id is null and assignment.user_profile_id='10440000-0000-4000-8000-000000000001'
),'a resolved employee imports even when no verifier can be resolved');
select is(jsonb_array_length(public.list_assigning_left_tasks()),2,'admin sees unresolved task and schedule');

select set_config('request.jwt.claim.sub','10400000-0000-4000-8000-000000000002',true);
select throws_ok('select public.list_assigning_left_tasks()','42501','Assigning Left access denied','manager cannot inspect the admin queue');

select set_config('request.jwt.claim.sub','10400000-0000-4000-8000-000000000001',true);
select is(
  public.assign_imported_task_with_audit('task',(select id from public.task_instances where title='Synthetic blank task'),'10440000-0000-4000-8000-000000000003')->>'assignment_status',
  'assigned',
  'admin assigns a queued one-time task later'
);
select ok(exists(select 1 from public.task_instances task join public.task_assignees assignment on assignment.task_instance_id=task.id and assignment.is_active where task.title='Synthetic blank task' and task.assignment_status='assigned' and assignment.user_profile_id='10440000-0000-4000-8000-000000000003'),'later one-time assignment creates its active assignee');
select is(
  public.assign_imported_task_with_audit('template',(select id from public.task_templates where title='Synthetic blank'),'10440000-0000-4000-8000-000000000003')->>'assignment_status',
  'assigned',
  'admin assigns a queued recurring schedule later'
);
select ok(exists(select 1 from public.task_templates where title='Synthetic blank' and assignment_status='assigned' and default_assignee_user_id='10440000-0000-4000-8000-000000000003' and is_active),'later recurring assignment activates the schedule');
select ok(exists(select 1 from public.audit_logs where action='assigning_left_resolved' and record_id=(select id from public.task_templates where title='Synthetic blank')),'later assignment is audited in the same RPC');

select is((public.begin_task_bulk_import(repeat('2',64),'reordered.csv',1)->>'outcome'),'in_progress','a differently named overlapping file starts separately');
select is(
  (public.commit_task_bulk_import_chunk(
    (select id from public.task_import_batches where tenant_id='10410000-0000-4000-8000-000000000001' and import_hash=repeat('2',64)),
    jsonb_build_array(jsonb_build_object('source_row',22,'task_key','different-key','destination','tasks','schedule_kind','one_time','task_type','delegation','core_task_label','','title','Synthetic name match','description','','priority','medium','branch','I104','department','Import Department 104','category','Import Category 104','assignee_email','','assignee_profile_id','','assignee_name','Import Doer 104','verifier_label','','verifier_profile_id','','starts_on','2026-08-27','start_time','09:00','due_time','10:00','planned_at','2026-08-27 09:00','due_at','2026-08-27 10:00','recurrence_rule','','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',false,'is_active',true,'assignment_status','assigned','checklist','[]'::jsonb))
  )->>'replayed')::integer,
  1,
  'overlapping business content replays across batches despite row and task-key changes'
);
select is((select count(*)::integer from public.task_instances where title='Synthetic name match'),1,'cross-file replay creates no duplicate task');
select is((select outcome from public.task_import_batches where import_hash=repeat('2',64)),'completed','replayed rows count toward batch completion');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='task_import_row_registry' and column_name in ('title','description','employee_name','email','raw_content','payload')),'registry schema remains metadata-only');

select * from finish();
rollback;
