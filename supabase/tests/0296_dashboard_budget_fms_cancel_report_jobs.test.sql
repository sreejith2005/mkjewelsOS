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



-- 1. Dashboard: one row build per request, same results, within the request budget.
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,priority,status,planned_datetime,created_by,source)
select md5('insights-0296-task-'||n)::uuid,'1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','checklist','Synthetic 0296 task','medium','pending',now()-interval '1 day','4d130000-0000-0000-0000-000000000002','manual'
from generate_series(1,1000) n;
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
select md5('insights-0296-task-'||n)::uuid,'4d130000-0000-0000-0000-000000000006','doer',true,true from generate_series(1,1000) n;

-- FMS start-form fixture.
insert into form_templates(id,tenant_id,name,lifecycle,created_by)
values ('8d130000-0000-0000-0000-000000000001','1d130000-0000-0000-0000-000000000001','Synthetic 0296 Start','draft','4d130000-0000-0000-0000-000000000002');
insert into fms_flows(id,tenant_id,name,status,created_by)
values ('6d130000-0000-0000-0000-000000000001','1d130000-0000-0000-0000-000000000001','Synthetic 0296 Flow','draft','4d130000-0000-0000-0000-000000000002');
insert into fms_stages(id,fms_flow_id,stage_key,name,step_type,sort_order,form_template_id)
values ('7d130000-0000-0000-0000-000000000001','6d130000-0000-0000-0000-000000000001','stage_0296','Synthetic Start Stage','form',0,'8d130000-0000-0000-0000-000000000001');
update fms_flows set status='published' where id='6d130000-0000-0000-0000-000000000001';
insert into fms_starter_assignments(id,tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,status) values
 ('9d130000-0000-0000-0000-000000000001','1d130000-0000-0000-0000-000000000001','6d130000-0000-0000-0000-000000000001','7d130000-0000-0000-0000-000000000001','8d130000-0000-0000-0000-000000000001','4d130000-0000-0000-0000-000000000006','pending'),
 ('9d130000-0000-0000-0000-000000000002','1d130000-0000-0000-0000-000000000001','6d130000-0000-0000-0000-000000000001','7d130000-0000-0000-0000-000000000001','8d130000-0000-0000-0000-000000000001','4d130000-0000-0000-0000-000000000007','completed');
insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url,channel,delivered_status,source_module,source_record_id)
values ('1d130000-0000-0000-0000-000000000001','4d130000-0000-0000-0000-000000000006','fms_starter_assigned','Synthetic','Synthetic','/tasks/fms','in_app','delivered','fms','9d130000-0000-0000-0000-000000000001');

select ok(not has_function_privilege('authenticated','public.management_insights_rows_array_v1(jsonb)','EXECUTE'),'row array helper is private');
select ok(not has_function_privilege('authenticated','public.management_insights_group_rows_from_v1(jsonb,management_insight_row_v1[])','EXECUTE'),'group helper is private');
select ok(not has_function_privilege('authenticated','public.schedule_report_export_jobs(text)','EXECUTE'),'report job scheduler is operator-only');
select ok(not has_function_privilege('anon','public.cancel_fms_starter_assignment_with_audit(uuid,text)','EXECUTE'),'anon cannot cancel start forms');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000001',true);
set local statement_timeout='8s';
do $$
declare payload jsonb; detail jsonb; dept jsonb;
begin
 payload:=get_management_insights_v1('{"version":1,"tab":"tasks","preset":"this_month","groupBy":"department"}');
 perform set_config('t.open',(select m->>'value' from jsonb_array_elements(payload->'metrics') m where m->>'key'='open'),true);
 select g into dept from jsonb_array_elements(payload->'groups') g where g->>'id'='3d130000-0000-0000-0000-000000000001';
 perform set_config('t.group_open',coalesce(dept->>'open','-1'),true);
 perform set_config('t.missing',payload->>'missingDeadline',true);
 detail:=get_management_insight_records_v1('{"version":1,"tab":"tasks","preset":"this_month","groupBy":"department"}','group_work','3d130000-0000-0000-0000-000000000001',0,25);
 perform set_config('t.group_detail',detail->>'total',true);
 detail:=get_management_insight_records_v1('{"version":1,"tab":"tasks","preset":"this_month","groupBy":"department"}','open',null,0,25);
 perform set_config('t.open_detail',detail->>'total',true);
exception when query_canceled then perform set_config('t.open','timeout',true);
end $$;
select is(current_setting('t.open'),'1000','super admin overview counts every open task within the budget');
select is(current_setting('t.group_open'),'1000','department comparison keeps the same grouping');
select is(current_setting('t.group_detail'),'1000','group drill-down returns the grouped records');
select is(current_setting('t.open_detail'),'1000','metric drill-down matches the summary');

-- missingDeadline must equal the row source's own count (computed here outside the RPC).
reset role;
select is(current_setting('t.missing'),(select count(*)::text from management_insights_rows_v1(management_insights_context_v1('{"version":1,"tab":"tasks","preset":"this_month","groupBy":"department"}')) r where r.module in ('tasks','workflows') and r.due is null and r.status not in ('completed','rejected','cancelled')),'missing-deadline count is computed from the same rows');
set local role authenticated;
-- Denied: a tenant-B admin sees none of tenant A.
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000010',true);
select is((select m->>'value' from jsonb_array_elements(get_management_insights_v1('{"version":1,"tab":"tasks","preset":"this_month","groupBy":"department"}')->'metrics') m where m->>'key'='open'),'0','another tenant sees no rows');

-- 2. Start-form cancellation.
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000006',true);
select throws_ok($$select cancel_fms_starter_assignment_with_audit('9d130000-0000-0000-0000-000000000001','Synthetic reason')$$,'42501',null,'staff cannot cancel a start form');
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000010',true);
select throws_ok($$select cancel_fms_starter_assignment_with_audit('9d130000-0000-0000-0000-000000000001','Synthetic reason')$$,'42501',null,'another tenant cannot cancel it');
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000002',true);
select throws_ok($$select cancel_fms_starter_assignment_with_audit('9d130000-0000-0000-0000-000000000001','  ')$$,'22023',null,'a reason is required');
select throws_ok($$select cancel_fms_starter_assignment_with_audit('9d130000-0000-0000-0000-000000000002','Synthetic reason')$$,'23514',null,'completed start forms stay completed');
select lives_ok($$select cancel_fms_starter_assignment_with_audit('9d130000-0000-0000-0000-000000000001','Synthetic reason')$$,'an admin cancels a pending start form');
reset role;
select is((select status from fms_starter_assignments where id='9d130000-0000-0000-0000-000000000001'),'cancelled','the assignment is kept as cancelled');
select ok((select is_read and read_at is not null from notifications where source_record_id='9d130000-0000-0000-0000-000000000001'),'its alert is closed, not deleted');
select is((select count(*)::int from audit_logs where action='fms_starter_assignment_cancelled' and record_id='9d130000-0000-0000-0000-000000000001'),1,'the cancellation is audited');
select lives_ok($$select queue_fms_starter_assignments('6d130000-0000-0000-0000-000000000001','4d130000-0000-0000-0000-000000000002')$$,'re-queueing the flow is safe');
select is((select status from fms_starter_assignments where id='9d130000-0000-0000-0000-000000000001'),'cancelled','re-queueing does not resurrect the cancelled start form');

-- 3. Scheduler guard: a foreign URL (or a stack without pg_cron) is rejected.
select throws_ok($$select schedule_report_export_jobs('https://evil.example/functions/v1/other')$$,null,null,'scheduler rejects a foreign worker URL or missing platform');
select * from finish();
rollback;
