begin;
select plan(24);

-- Contract surface -----------------------------------------------------------

select has_function('public','get_task_template_directory',array['jsonb'],'the Task Templates directory is database-backed');
select has_function('public','set_task_template_schedule_with_audit',array['uuid','date'],'template scheduling has an audited contract');
select has_function('public','delete_task_template_with_audit',array['uuid'],'template deletion has an audited contract');
select function_privs_are('public','get_task_template_directory',array['jsonb'],'anon',array[]::text[],'anonymous callers cannot read the directory');
select function_privs_are('public','get_task_template_directory',array['jsonb'],'authenticated',array['EXECUTE'],'authenticated callers reach server authorization');
select function_privs_are('public','delete_task_template_with_audit',array['uuid'],'anon',array[]::text[],'anonymous callers cannot delete templates');
select function_privs_are('public','set_task_template_schedule_with_audit',array['uuid','date'],'anon',array[]::text[],'anonymous callers cannot reschedule templates');
select is(
  (default_section_availability() ->> 'task_templates')::boolean,
  true,
  'the section maintenance contract knows the Task Templates route'
);
select ok(
  position('v_old.starts_on is null' in pg_get_functiondef('public.set_recurring_todo_template_active_with_audit(uuid,boolean)'::regprocedure)) > 0,
  'a dated schedule cannot be activated without a start date'
);
select ok(
  position('due_time' in pg_get_functiondef('public.save_recurring_todo_template_with_audit(uuid,jsonb)'::regprocedure)) > 0,
  'the recurring save contract persists the separate due time'
);

-- Fixtures -------------------------------------------------------------------

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('10800000-0000-4000-8000-000000000001','authenticated','authenticated','admin-108@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('10800000-0000-4000-8000-000000000002','authenticated','authenticated','doer-108@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values('10810000-0000-4000-8000-000000000001','Templates 108','templates-108');
insert into public.branches(id,tenant_id,name,code) values('10820000-0000-4000-8000-000000000001','10810000-0000-4000-8000-000000000001','Template Branch 108','T108');
insert into public.departments(id,tenant_id,branch_id,name,code) values('10830000-0000-4000-8000-000000000001','10810000-0000-4000-8000-000000000001','10820000-0000-4000-8000-000000000001','Template Department 108','TD108');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values
 ('10840000-0000-4000-8000-000000000001','10800000-0000-4000-8000-000000000001','10810000-0000-4000-8000-000000000001','10820000-0000-4000-8000-000000000001','10830000-0000-4000-8000-000000000001','Template Admin 108','0000001081','admin-108@example.invalid','T108-1','admin','active','active',true),
 ('10840000-0000-4000-8000-000000000002','10800000-0000-4000-8000-000000000002','10810000-0000-4000-8000-000000000001','10820000-0000-4000-8000-000000000001','10830000-0000-4000-8000-000000000001','Template Doer 108','0000001082','doer-108@example.invalid','T108-2','doer','active','active',true);

insert into public.task_templates(id,tenant_id,branch_id,department_id,title,task_type,recurrence_rule,schedule_kind,starts_on,planned_time,due_time,default_assignee_type,default_assignee_user_id,is_active,created_by,updated_by)
values
 ('10850000-0000-4000-8000-000000000001','10810000-0000-4000-8000-000000000001','10820000-0000-4000-8000-000000000001','10830000-0000-4000-8000-000000000001','Count the safe stock','checklist','FREQ=DAILY','daily',current_date,'11:00','20:00','specific_user','10840000-0000-4000-8000-000000000002',true,'10840000-0000-4000-8000-000000000001','10840000-0000-4000-8000-000000000001'),
 ('10850000-0000-4000-8000-000000000002','10810000-0000-4000-8000-000000000001','10820000-0000-4000-8000-000000000001','10830000-0000-4000-8000-000000000001','Undated weekly tally','checklist','FREQ=WEEKLY','weekly',null,'11:00',null,'specific_user','10840000-0000-4000-8000-000000000002',false,'10840000-0000-4000-8000-000000000001','10840000-0000-4000-8000-000000000001');

-- One open occurrence (removable) and one completed occurrence (preserved).
insert into public.task_instances(id,tenant_id,branch_id,department_id,task_template_id,task_type,title,status,planned_datetime,scheduled_date,created_by)
values
 ('10860000-0000-4000-8000-000000000001','10810000-0000-4000-8000-000000000001','10820000-0000-4000-8000-000000000001','10830000-0000-4000-8000-000000000001','10850000-0000-4000-8000-000000000001','checklist','Count the safe stock','pending',now(),current_date,'10840000-0000-4000-8000-000000000001'),
 ('10860000-0000-4000-8000-000000000002','10810000-0000-4000-8000-000000000001','10820000-0000-4000-8000-000000000001','10830000-0000-4000-8000-000000000001','10850000-0000-4000-8000-000000000001','checklist','Count the safe stock','completed',now() - interval '1 day',current_date - 1,'10840000-0000-4000-8000-000000000001');

-- An ordinary employee is refused ---------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','10800000-0000-4000-8000-000000000002',true);
select throws_ok(
  $$select get_task_template_directory('{}'::jsonb)$$,
  '42501',
  'Task template directory access denied',
  'an ordinary employee cannot read every user''s templates'
);
reset role;

-- An administrator sees the whole tenant --------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','10800000-0000-4000-8000-000000000001',true);

select is(
  (select count(*) from jsonb_array_elements(get_task_template_directory('{}'::jsonb)->'templates')),
  2::bigint,
  'an administrator sees every template in the tenant'
);
select is(
  (select entry->>'assignee_name' from jsonb_array_elements(get_task_template_directory('{}'::jsonb)->'templates') as t(entry)
    where entry->>'id'='10850000-0000-4000-8000-000000000001'),
  'Template Doer 108',
  'the directory resolves the template owner'
);
select is(
  (select entry->>'source' from jsonb_array_elements(get_task_template_directory('{}'::jsonb)->'templates') as t(entry)
    where entry->>'id'='10850000-0000-4000-8000-000000000001'),
  'web_app',
  'a template with no import row reports the web app as its source'
);
select is(
  (select entry->>'schedule_status' from jsonb_array_elements(get_task_template_directory('{}'::jsonb)->'templates') as t(entry)
    where entry->>'id'='10850000-0000-4000-8000-000000000002'),
  'needs_start_date',
  'a dated schedule with no start date is reported as needing one'
);
select is(
  (select count(*) from jsonb_array_elements(get_task_template_directory(jsonb_build_object('search','undated'))->'templates')),
  1::bigint,
  'the directory search narrows the result set'
);

-- 0110 removed the two per-row instance counts that could not use an index and
-- that nothing rendered; the directory must stay a single-pass read.
select ok(
  (select not (entry ? 'open_instance_count' or entry ? 'preserved_instance_count')
   from jsonb_array_elements(get_task_template_directory('{}'::jsonb)->'templates') as t(entry)
   where entry->>'id'='10850000-0000-4000-8000-000000000001'),
  'the directory row carries no per-row instance counts'
);
select ok(
  (select count(*) from pg_indexes where schemaname='public'
     and indexname in ('idx_task_instances_template','idx_task_import_items_template','idx_task_import_row_registry_template')) = 3,
  'template lookups are indexed in task_instances and both import tables'
);

select throws_ok(
  $$select set_recurring_todo_template_active_with_audit('10850000-0000-4000-8000-000000000002'::uuid,true)$$,
  '23514',
  'Set the task start date before activating this schedule',
  'activation is refused until a start date exists'
);

select is(
  set_task_template_schedule_with_audit('10850000-0000-4000-8000-000000000002'::uuid,current_date)->>'is_active',
  'true',
  'scheduling a start date puts the template back in service'
);

-- Shifting a whole schedule later must survive task_templates_due_after_start,
-- which compares the stored due time against the incoming start time.
select lives_ok(
  $$select save_recurring_todo_template_with_audit('10850000-0000-4000-8000-000000000001'::uuid, jsonb_build_object(
      'title','Count the safe stock','recurrence_rule','FREQ=DAILY','schedule_kind','daily',
      'starts_on',(now() at time zone 'Asia/Kolkata')::date::text,
      'planned_time','21:00','due_time','22:00','priority','medium',
      'branch_id','10820000-0000-4000-8000-000000000001',
      'department_id','10830000-0000-4000-8000-000000000001',
      'default_assignee_type','specific_user',
      'default_assignee_user_id','10840000-0000-4000-8000-000000000002',
      'default_assignee_role','','task_type','checklist','buddy_assignment_allowed',true,
      'checklist_items','[]'::jsonb,'requires_upload',false,'requires_remark',false,
      'requires_form',false,'form_template_id','','is_active',true,
      'verification_required',false,'followup_enabled',false,'personal_performance_enabled',true))$$,
  'a schedule can be moved to a later start and due time in one save'
);
select is(
  (select planned_time::text||'/'||due_time::text from public.task_templates where id='10850000-0000-4000-8000-000000000001'),
  '21:00:00/22:00:00',
  'the save contract stores the start time and the due time separately'
);

select is(
  delete_task_template_with_audit('10850000-0000-4000-8000-000000000001'::uuid),
  jsonb_build_object('outcome','archived','open_instances_removed',1,'instances_preserved',1,'title','Count the safe stock'),
  'deleting a worked template removes the open occurrence and preserves completed history'
);

reset role;

select is(
  (select count(*) from public.task_instances where task_template_id='10850000-0000-4000-8000-000000000001'),
  1::bigint,
  'only the completed occurrence survives the delete'
);

select * from finish();
rollback;
