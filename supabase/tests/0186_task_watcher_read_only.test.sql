begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(12);
select ok(position('''/tasks/in-loop''' in pg_get_functiondef('public.emit_task_watcher_notification_event()'::regprocedure)) > 0,'new watcher notifications open the In Loop tab');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('18600000-0000-4000-8000-000000000001','authenticated','authenticated','doer-186@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('18600000-0000-4000-8000-000000000002','authenticated','authenticated','watcher-186@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('18600000-0000-4000-8000-000000000003','authenticated','authenticated','outsider-186@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values ('18610000-0000-4000-8000-000000000001','Loop 186','loop-186');
insert into public.branches(id,tenant_id,name,code) values ('18620000-0000-4000-8000-000000000001','18610000-0000-4000-8000-000000000001','Branch 186','B186');
insert into public.departments(id,tenant_id,branch_id,name,code) values ('18630000-0000-4000-8000-000000000001','18610000-0000-4000-8000-000000000001','18620000-0000-4000-8000-000000000001','Sales 186','S186');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values
 ('18640000-0000-4000-8000-000000000001','18600000-0000-4000-8000-000000000001','18610000-0000-4000-8000-000000000001','18620000-0000-4000-8000-000000000001','18630000-0000-4000-8000-000000000001','Doer 186','0000001861','doer-186@example.invalid','L186-1','staff','active','active',true),
 ('18640000-0000-4000-8000-000000000002','18600000-0000-4000-8000-000000000002','18610000-0000-4000-8000-000000000001','18620000-0000-4000-8000-000000000001','18630000-0000-4000-8000-000000000001','Watcher 186','0000001862','watcher-186@example.invalid','L186-2','manager','active','active',true),
 ('18640000-0000-4000-8000-000000000003','18600000-0000-4000-8000-000000000003','18610000-0000-4000-8000-000000000001','18620000-0000-4000-8000-000000000001','18630000-0000-4000-8000-000000000001','Outsider 186','0000001863','outsider-186@example.invalid','L186-3','staff','active','active',true);
insert into public.task_instances(id,tenant_id,branch_id,department_id,task_type,title,priority,status,planned_datetime,source,created_by)
values ('18650000-0000-4000-8000-000000000001','18610000-0000-4000-8000-000000000001','18620000-0000-4000-8000-000000000001','18630000-0000-4000-8000-000000000001','delegation','Looped work 186','medium','pending',now()+interval '1 day','manual','18640000-0000-4000-8000-000000000001');
insert into public.task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
values ('18650000-0000-4000-8000-000000000001','18640000-0000-4000-8000-000000000001','doer',true,true);
insert into public.task_watchers(tenant_id,task_instance_id,user_profile_id,created_by)
values ('18610000-0000-4000-8000-000000000001','18650000-0000-4000-8000-000000000001','18640000-0000-4000-8000-000000000002','18640000-0000-4000-8000-000000000001');
insert into public.task_checklists(id,task_instance_id,item_text,sort_order,is_required,is_completed)
values ('18660000-0000-4000-8000-000000000001','18650000-0000-4000-8000-000000000001','Check 186',0,true,false);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','18600000-0000-4000-8000-000000000002',true);
select ok(public.is_task_watcher('18650000-0000-4000-8000-000000000001'),'manager is a named watcher');
select ok(public.can_read_task('18650000-0000-4000-8000-000000000001'),'manager watcher can read');
select lives_ok($$select public.add_task_comment_with_audit('18650000-0000-4000-8000-000000000001','Please update me')$$,'manager watcher may comment');
select throws_ok($$select public.update_task_with_audit('18650000-0000-4000-8000-000000000001','complete',p_remark=>'on behalf')$$,'42501',null,'manager watcher cannot complete through RPC');
select throws_ok($$select public.update_task_with_audit('18650000-0000-4000-8000-000000000001','checklist','18660000-0000-4000-8000-000000000001',true)$$,'42501',null,'manager watcher cannot edit checklist through RPC');
select throws_ok($$select public.revise_task_datetime_with_audit('18650000-0000-4000-8000-000000000001',now()+interval '2 days','change')$$,'42501',null,'manager watcher cannot revise date');
select ok(not public.can_write_task_attachment_object('18610000-0000-4000-8000-000000000001/18650000-0000-4000-8000-000000000001/evidence.pdf'),'manager watcher cannot upload evidence');
select set_config('request.jwt.claim.sub','18600000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.add_task_comment_with_audit('18650000-0000-4000-8000-000000000001','not allowed')$$,'42501',null,'unrelated user cannot comment');
select set_config('request.jwt.claim.sub','18600000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.update_task_with_audit('18650000-0000-4000-8000-000000000001','checklist','18660000-0000-4000-8000-000000000001',true)$$,'doer may edit checklist');
select lives_ok($$select public.update_task_with_audit('18650000-0000-4000-8000-000000000001','complete')$$,'doer may complete');
select is((select status::text from public.task_instances where id='18650000-0000-4000-8000-000000000001'),'completed','task completes only through doer');
select * from finish();
rollback;
