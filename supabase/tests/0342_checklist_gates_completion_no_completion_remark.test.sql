begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(17);

-- Every completion path runs the checklist gate, and no remark refusal survives.
select ok(position('complete_task_checklist_items' in pg_get_functiondef('public.update_task_with_audit(uuid,text,uuid,boolean,text)'::regprocedure)) > 0,'Complete runs the checklist gate');
select ok(position('complete_task_checklist_items' in pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure)) > 0,'upload-and-complete runs the checklist gate');
select ok(position('complete_task_checklist_items' in pg_get_functiondef('public.complete_recurring_task_with_image_with_audit(uuid,text)'::regprocedure)) > 0,'recurring image completion runs the checklist gate');
select ok(position('update_task_with_audit' in pg_get_functiondef('public.complete_task_from_required_form_submission()'::regprocedure)) > 0,'required-form completion goes through the gated Complete');
select ok(position('then complete with a remark' in pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure)) = 0
  and position('then complete with a remark' in pg_get_functiondef('public.complete_recurring_task_with_image_with_audit(uuid,text)'::regprocedure)) = 0,'upload completion no longer demands a remark');
select function_privs_are('public','complete_task_checklist_items',array['uuid','uuid'],'authenticated',array[]::text[],'browsers cannot call the gate helper directly');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('34200000-0000-4000-8000-000000000001','authenticated','authenticated','doer-342@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('34200000-0000-4000-8000-000000000002','authenticated','authenticated','manager-342@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values ('34210000-0000-4000-8000-000000000001','Checklist 342','checklist-342');
insert into public.branches(id,tenant_id,name,code) values ('34220000-0000-4000-8000-000000000001','34210000-0000-4000-8000-000000000001','Branch 342','B342');
insert into public.departments(id,tenant_id,branch_id,name,code) values ('34230000-0000-4000-8000-000000000001','34210000-0000-4000-8000-000000000001','34220000-0000-4000-8000-000000000001','Ops 342','O342');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values
 ('34240000-0000-4000-8000-000000000001','34200000-0000-4000-8000-000000000001','34210000-0000-4000-8000-000000000001','34220000-0000-4000-8000-000000000001','34230000-0000-4000-8000-000000000001','Doer 342','0000003421','doer-342@example.invalid','C342-1','staff','active','active',true),
 ('34240000-0000-4000-8000-000000000002','34200000-0000-4000-8000-000000000002','34210000-0000-4000-8000-000000000001','34220000-0000-4000-8000-000000000001','34230000-0000-4000-8000-000000000001','Manager 342','0000003422','manager-342@example.invalid','C342-2','manager','active','active',true);
insert into public.task_instances(id,tenant_id,branch_id,department_id,task_type,title,priority,status,planned_datetime,source,requires_remark,created_by)
values
 ('34250000-0000-4000-8000-000000000001','34210000-0000-4000-8000-000000000001','34220000-0000-4000-8000-000000000001','34230000-0000-4000-8000-000000000001','checklist','Open the store 342','medium','pending',now()+interval '1 day','manual',false,'34240000-0000-4000-8000-000000000002'),
 ('34250000-0000-4000-8000-000000000002','34210000-0000-4000-8000-000000000001','34220000-0000-4000-8000-000000000001','34230000-0000-4000-8000-000000000001','delegation','Remark flag 342','medium','pending',now()+interval '1 day','manual',true,'34240000-0000-4000-8000-000000000002'),
 ('34250000-0000-4000-8000-000000000003','34210000-0000-4000-8000-000000000001','34220000-0000-4000-8000-000000000001','34230000-0000-4000-8000-000000000001','delegation','On behalf 342','medium','pending',now()+interval '1 day','manual',false,'34240000-0000-4000-8000-000000000002');
insert into public.task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
select id,'34240000-0000-4000-8000-000000000001','doer',true,true from public.task_instances where id::text like '34250000%';
insert into public.task_checklists(id,task_instance_id,item_text,sort_order,is_required,is_completed)
values
 ('34260000-0000-4000-8000-000000000001','34250000-0000-4000-8000-000000000001','Switch on both LED screens',0,true,false),
 ('34260000-0000-4000-8000-000000000002','34250000-0000-4000-8000-000000000001','Wipe the glass',1,false,false);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','34200000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.update_task_with_audit('34250000-0000-4000-8000-000000000001','complete')$$,'23514','Tick every required checklist item before completing this task','an unticked required item refuses completion');
select is((select status::text from public.task_instances where id='34250000-0000-4000-8000-000000000001'),'pending','the refused task stays open');
select lives_ok($$select public.update_task_with_audit('34250000-0000-4000-8000-000000000001','checklist','34260000-0000-4000-8000-000000000001',true)$$,'the doer ticks the required item');
select lives_ok($$select public.update_task_with_audit('34250000-0000-4000-8000-000000000001','complete')$$,'with every required item ticked the task completes without a remark');
select is((select status::text from public.task_instances where id='34250000-0000-4000-8000-000000000001'),'completed','the checklist task is completed');
select is((select is_completed from public.task_checklists where id='34260000-0000-4000-8000-000000000002'),false,'an optional item the doer did not tick is not ticked for them');
select lives_ok($$select public.update_task_with_audit('34250000-0000-4000-8000-000000000002','complete')$$,'a requires_remark task completes without a remark');
select is((select completion_remark from public.task_instances where id='34250000-0000-4000-8000-000000000002'),null,'no remark is stored when none is given');

select set_config('request.jwt.claim.sub','34200000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.update_task_with_audit('34250000-0000-4000-8000-000000000003','complete')$$,'a manager completes on behalf without a remark');
select is((select completion_mode::text from public.task_instances where id='34250000-0000-4000-8000-000000000003'),'on_behalf','the on-behalf completion is still recorded as such');
reset role;
select ok(exists(select 1 from public.audit_logs where record_id='34250000-0000-4000-8000-000000000003' and action='task_complete_on_behalf'),'the on-behalf completion is audited');
select * from finish();
rollback;
