begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Synthetic-only identities. Test output contains no row payloads or contact data.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select aid,'authenticated','authenticated',email,crypt('synthetic-test-value',gen_salt('bf')),now(),'{}','{}',now(),now() from (values
 ('ad130000-0000-0000-0000-000000000001'::uuid,'analytics-super@example.invalid'),
 ('ad130000-0000-0000-0000-000000000002'::uuid,'analytics-admin@example.invalid'),
 ('ad130000-0000-0000-0000-000000000003'::uuid,'analytics-manager@example.invalid'),
 ('ad130000-0000-0000-0000-000000000004'::uuid,'analytics-hr@example.invalid'),
 ('ad130000-0000-0000-0000-000000000005'::uuid,'analytics-crm@example.invalid'),
 ('ad130000-0000-0000-0000-000000000006'::uuid,'analytics-staff@example.invalid'),
 ('ad130000-0000-0000-0000-000000000007'::uuid,'analytics-doer@example.invalid'),
 ('ad130000-0000-0000-0000-000000000008'::uuid,'analytics-housekeeping@example.invalid'),
 ('ad130000-0000-0000-0000-000000000009'::uuid,'analytics-inactive@example.invalid'),
 ('ad130000-0000-0000-0000-000000000010'::uuid,'analytics-other@example.invalid')
) x(aid,email);
insert into tenants(id,name,slug,timezone) values
 ('1d130000-0000-0000-0000-000000000001','Synthetic Analytics Tenant A','analytics-test-a','Asia/Kolkata'),
 ('1d130000-0000-0000-0000-000000000002','Synthetic Analytics Tenant B','analytics-test-b','UTC');
insert into branches(id,tenant_id,name,code) values
 ('2d130000-0000-0000-0000-000000000001','1d130000-0000-0000-0000-000000000001','Synthetic Branch A1','DA1'),
 ('2d130000-0000-0000-0000-000000000002','1d130000-0000-0000-0000-000000000001','Synthetic Branch A2','DA2'),
 ('2d130000-0000-0000-0000-000000000003','1d130000-0000-0000-0000-000000000002','Synthetic Branch B','DB1');
insert into departments(id,tenant_id,branch_id,name,code) values
 ('3d130000-0000-0000-0000-000000000001','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','Synthetic Department A1','DDA1'),
 ('3d130000-0000-0000-0000-000000000002','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000002','Synthetic Department A2','DDA2'),
 ('3d130000-0000-0000-0000-000000000003','1d130000-0000-0000-0000-000000000002','2d130000-0000-0000-0000-000000000003','Synthetic Department B','DDB');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
select pid,aid,tid,bid,did,label,mobile,email,code,role::user_role,status::working_status,enabled from (values
 ('4d130000-0000-0000-0000-000000000001'::uuid,'ad130000-0000-0000-0000-000000000001'::uuid,'1d130000-0000-0000-0000-000000000001'::uuid,'2d130000-0000-0000-0000-000000000001'::uuid,'3d130000-0000-0000-0000-000000000001'::uuid,'Synthetic Super','9000000101','analytics-super@example.invalid','AN-1','super_admin','active',true),
 ('4d130000-0000-0000-0000-000000000002','ad130000-0000-0000-0000-000000000002','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','Synthetic Admin','9000000102','analytics-admin@example.invalid','AN-2','admin','active',true),
 ('4d130000-0000-0000-0000-000000000003','ad130000-0000-0000-0000-000000000003','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','Synthetic Manager','9000000103','analytics-manager@example.invalid','AN-3','manager','active',true),
 ('4d130000-0000-0000-0000-000000000004','ad130000-0000-0000-0000-000000000004','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','Synthetic HR','9000000104','analytics-hr@example.invalid','AN-4','hr','active',true),
 ('4d130000-0000-0000-0000-000000000005','ad130000-0000-0000-0000-000000000005','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','Synthetic CRM','9000000105','analytics-crm@example.invalid','AN-5','crm','active',true),
 ('4d130000-0000-0000-0000-000000000006','ad130000-0000-0000-0000-000000000006','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','Synthetic Staff','9000000106','analytics-staff@example.invalid','AN-6','staff','active',true),
 ('4d130000-0000-0000-0000-000000000007','ad130000-0000-0000-0000-000000000007','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','Synthetic Doer','9000000107','analytics-doer@example.invalid','AN-7','doer','active',true),
 ('4d130000-0000-0000-0000-000000000008','ad130000-0000-0000-0000-000000000008','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','Synthetic Housekeeping','9000000108','analytics-housekeeping@example.invalid','AN-8','housekeeping','active',true),
 ('4d130000-0000-0000-0000-000000000009','ad130000-0000-0000-0000-000000000009','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','Synthetic Inactive','9000000109','analytics-inactive@example.invalid','AN-9','admin','inactive',false),
 ('4d130000-0000-0000-0000-000000000010','ad130000-0000-0000-0000-000000000010','1d130000-0000-0000-0000-000000000002','2d130000-0000-0000-0000-000000000003','3d130000-0000-0000-0000-000000000003','Synthetic Other','9000000110','analytics-other@example.invalid','AN-10','admin','active',true)
) x(pid,aid,tid,bid,did,label,mobile,email,code,role,status,enabled);
update branches set manager_id='4d130000-0000-0000-0000-000000000003' where id='2d130000-0000-0000-0000-000000000001';


-- A request-sized workload with assigned work, not application/demo fallback data.
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,priority,status,planned_datetime,created_by,source)
select md5('insights-budget-task-'||n)::uuid,'1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','checklist','Synthetic budget task','medium','pending',now()-interval '1 day','4d130000-0000-0000-0000-000000000002','manual'
from generate_series(1,1000) n;
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
select md5('insights-budget-task-'||n)::uuid,'4d130000-0000-0000-0000-000000000006','doer',true,true from generate_series(1,1000) n;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000002',true);
set local statement_timeout='8s';
select ok(not has_function_privilege('authenticated','public.management_insights_metric_matches_v1(text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,jsonb)','EXECUTE'),'optimized metric predicate remains private');
do $$
declare payload jsonb;
begin
 payload:=get_management_insights_v1('{"version":1,"tab":"overview","preset":"this_month","groupBy":"department"}');
 perform set_config('insights.budget_passed',(payload->>'version'='1')::text,true);
 perform set_config('insights.open_count',(select m->>'value' from jsonb_array_elements(payload->'metrics') m where m->>'key'='open'),true);
exception when query_canceled then
 perform set_config('insights.budget_passed','false',true);
 perform set_config('insights.open_count','-1',true);
end $$;
select is(current_setting('insights.budget_passed'),'true','overview completes within the authenticated eight-second request budget');
select is(current_setting('insights.open_count'),'1000','scale overview retains every authorized open task');
select * from finish();
rollback;
