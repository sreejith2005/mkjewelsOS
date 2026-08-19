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

insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,priority,status,planned_datetime,actual_datetime,created_by,source) values
 ('5d130000-0000-0000-0000-000000000001','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','checklist','Synthetic open task','high','pending',date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' + interval '12 hours',null,'4d130000-0000-0000-0000-000000000002','manual'),
 ('5d130000-0000-0000-0000-000000000002','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','checklist','Synthetic completed task','medium','completed',date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' + interval '10 hours',date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' + interval '9 hours','4d130000-0000-0000-0000-000000000002','manual'),
 ('5d130000-0000-0000-0000-000000000003','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000002','3d130000-0000-0000-0000-000000000002','checklist','Synthetic other branch task','low','pending',now(),null,'4d130000-0000-0000-0000-000000000002','manual'),
 ('5d130000-0000-0000-0000-000000000004','1d130000-0000-0000-0000-000000000002','2d130000-0000-0000-0000-000000000003','3d130000-0000-0000-0000-000000000003','checklist','Synthetic other tenant task','low','pending',now(),null,'4d130000-0000-0000-0000-000000000010','manual');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values
 ('5d130000-0000-0000-0000-000000000001','4d130000-0000-0000-0000-000000000006','doer',true,true),
 ('5d130000-0000-0000-0000-000000000001','4d130000-0000-0000-0000-000000000005','doer',false,true),
 ('5d130000-0000-0000-0000-000000000002','4d130000-0000-0000-0000-000000000006','doer',true,true),
 ('5d130000-0000-0000-0000-000000000003','4d130000-0000-0000-0000-000000000005','doer',true,true),
 ('5d130000-0000-0000-0000-000000000004','4d130000-0000-0000-0000-000000000010','doer',true,true);
insert into task_checklists(task_instance_id,item_text,is_required,is_completed,sort_order) values
 ('5d130000-0000-0000-0000-000000000001','Synthetic item',true,false,1),
 ('5d130000-0000-0000-0000-000000000002','Synthetic item',true,true,1);

-- Schema, ownership, grants, indexes, private storage, and direct writes.
select has_table('public','user_preferences','tenant-safe user preferences exist');
select has_column('public','export_logs','claim_expires_at','export jobs have lease metadata');
select has_column('public','tenants','settings_version','tenant settings have optimistic version');
select has_column('public','branches','settings_version','branch settings have optimistic version');
select has_index('public','export_logs','idx_export_logs_claim','worker claim pattern is indexed');
select has_index('public','task_instances','idx_task_instances_reporting','task report filters are indexed');
select is((select public from storage.buckets where id='report-exports'),false,'report export bucket is private');
select function_owner_is('public','get_dashboard_metrics',array['jsonb'],'postgres','dashboard RPC is postgres owned');
select is((select prosecdef from pg_proc where oid='get_report_data(text,jsonb)'::regprocedure),true,'report RPC is security definer');
select is((select proconfig from pg_proc where oid='request_report_export_with_audit(text,jsonb,uuid)'::regprocedure),array['search_path=public']::text[],'export request pins search path');
select ok(has_function_privilege('authenticated','get_home_summary(jsonb)','EXECUTE'),'authenticated may call Home');
select ok(has_function_privilege('authenticated','save_user_preferences_with_audit(jsonb)','EXECUTE'),'authenticated may save personal preferences');
select ok(not has_function_privilege('anon','get_dashboard_metrics(jsonb)','EXECUTE'),'anon cannot call dashboard');
select ok(not has_table_privilege('authenticated','user_preferences','INSERT,UPDATE,DELETE'),'direct preference writes are denied');
select ok(not has_table_privilege('authenticated','export_logs','INSERT,UPDATE,DELETE'),'direct export writes are denied');

-- Role catalog separation is exact and sensitive payload fields are absent.
select ok(report_allowed_for_role('crm_clients_ownership','crm'),'CRM role has CRM report');
select ok(not report_allowed_for_role('crm_clients_ownership','hr'),'HR has no CRM report');
select ok(not report_allowed_for_role('crm_clients_ownership','housekeeping'),'housekeeping has no CRM report');
select ok(report_allowed_for_role('people_availability','hr'),'HR has people availability report');
select ok(not report_allowed_for_role('people_availability','crm'),'CRM has no people report');
select ok(report_allowed_for_role('task_operations','doer'),'doer has task operations report');
select ok(report_allowed_for_role('task_operations','staff'),'staff has task operations report');
select ok(report_allowed_for_role('task_operations','housekeeping'),'housekeeping has task operations report');
select ok(report_allowed_for_role('notification_delivery_health','admin'),'admin has notification health report');
select ok(not report_allowed_for_role('notification_delivery_health','manager'),'manager has no provider health report');
select ok(pg_get_functiondef('report_rows_for_profile(uuid,text,jsonb,integer,integer)'::regprocedure) !~ 'primary_phone|personal_mobile|storage_path|answers','sensitive CRM contact, path, and answer columns are absent');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);

-- Active-profile enforcement, role-specific Dashboard, scope, filters, and formulas.
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000009',true);
select throws_ok($$select get_home_summary('{}')$$,'42501',null,'inactive profile is denied Home');
select throws_ok($$select get_dashboard_metrics('{}')$$,'42501',null,'inactive profile is denied Dashboard');

select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000006',true);
select is((get_dashboard_metrics('{"preset":"today"}')->'metrics'->>'tasks_assigned')::int,2,'staff sees exactly own two assigned tasks');
select is((get_dashboard_metrics('{"preset":"today"}')->'metrics'->>'tasks_completed')::int,1,'completed task count is correct');
select is((get_dashboard_metrics('{"preset":"today"}')->'metrics'->>'task_completion_rate')::numeric,50.0,'completion rate formula is correct');
select is((get_dashboard_metrics('{"preset":"today"}')->'metrics'->>'checklist_completion')::numeric,50.0,'checklist rate formula is correct');
select ok(get_dashboard_metrics('{"preset":"today"}')->'metrics'->'people_availability_rate' is null,'staff receives no people aggregate');
select is((get_report_data('task_operations','{"preset":"today","page":1,"page_size":25}')->>'total')::int,2,'staff report is personally scoped');
select throws_ok($$select get_report_data('crm_clients_ownership','{"preset":"today"}')$$,'42501',null,'staff cannot open CRM report');

select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000003',true);
select is((get_report_data('task_operations','{"preset":"today","page":1,"page_size":25}')->>'total')::int,2,'manager is isolated to own branch');
select throws_ok($$select get_report_data('task_operations','{"preset":"today","branch_id":"2d130000-0000-0000-0000-000000000002"}')$$,'42501',null,'manager cannot select another branch');

select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000002',true);
select is((get_report_data('task_operations','{"preset":"today","department_id":"3d130000-0000-0000-0000-000000000001","page":1,"page_size":25}')->>'total')::int,2,'department filter returns only matching tasks');
select is((get_report_data('task_operations','{"preset":"today","branch_id":"2d130000-0000-0000-0000-000000000002","page":1,"page_size":25}')->>'total')::int,1,'admin may use a reporting branch context without mutation');
select is((get_dashboard_metrics('{"preset":"today"}')->'metrics'->>'tasks_assigned')::int,3,'admin dashboard excludes the other tenant');
select ok(get_dashboard_metrics('{"preset":"today"}')->'metrics' ? 'notification_delivery_health','admin receives authorized delivery health');

select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000004',true);
select throws_ok($$select get_report_data('task_operations','{"preset":"today"}')$$,'42501',null,'HR does not gain task operations report access');
select lives_ok($$select get_report_data('people_availability','{"preset":"today"}')$$,'HR can open people availability');
select ok(not (get_dashboard_metrics('{"preset":"today"}')->'metrics' ? 'crm_clients'),'HR dashboard has no CRM measures');
select is((get_dashboard_metrics('{"preset":"today"}')->'metrics'->>'tasks_assigned')::int,0,'HR operational tasks remain personal rather than branch-wide');

select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000005',true);
select lives_ok($$select get_report_data('crm_clients_ownership','{"preset":"today"}')$$,'CRM can open authorized CRM report');
select throws_ok($$select get_report_data('people_availability','{"preset":"today"}')$$,'42501',null,'CRM cannot open people report');
select is((get_report_data('task_operations','{"preset":"today","page":1,"page_size":25}')->>'total')::int,1,'CRM operational task report is personally scoped');

select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000008',true);
select lives_ok($$select get_home_summary('{}')$$,'housekeeping has personal Home');
select throws_ok($$select get_report_data('crm_clients_ownership','{"preset":"today"}')$$,'42501',null,'housekeeping cannot open CRM report');

-- Invalid keys, UUIDs, ranges, timezone, previous period, and zero denominator.
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000002',true);
select throws_ok($$select get_dashboard_metrics('{"unknown":true}')$$,'22023',null,'unknown dashboard filter is rejected');
select throws_ok($$select get_dashboard_metrics('{"preset":"custom","from":"2026-01-01","to":"2027-02-01"}')$$,'22023',null,'oversized date range is rejected');
select throws_ok($$select get_dashboard_metrics('{"preset":"custom","from":"bad","to":"2026-08-10"}')$$,'22023',null,'invalid custom date is rejected');
select throws_ok($$select get_dashboard_metrics('{"preset":"today","branch_id":"not-a-uuid"}')$$,'22023',null,'invalid UUID filter is rejected');
select is(get_dashboard_metrics('{"preset":"today"}')->'context'->>'timezone','Asia/Kolkata','tenant timezone is authoritative');
select is(((get_dashboard_metrics('{"preset":"today"}')->'context'->>'end_at')::timestamptz-(get_dashboard_metrics('{"preset":"today"}')->'context'->>'start_at')::timestamptz),interval '1 day','local range is inclusive start and exclusive next-day end');
select is(get_dashboard_metrics('{"preset":"custom","from":"2000-01-01","to":"2000-01-01"}')->'metrics'->'task_completion_rate','null'::jsonb,'zero denominator returns no data rather than zero percent');
select is((get_dashboard_metrics('{"preset":"today"}')->'previous'->>'tasks_assigned')::int,0,'previous period uses immediately preceding equal duration');

-- Audited preferences and shared settings authorization/concurrency.
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000006',true);
select lives_ok($$select save_user_preferences_with_audit('{"default_landing_page":"dashboard","dashboard_range":"last_7_days","table_density":"compact","timezone_display":"tenant"}')$$,'regular user saves validated preferences');
select throws_ok($$select save_user_preferences_with_audit('{"default_landing_page":"home","unknown":true}')$$,'22023',null,'unknown preference key is rejected');
select throws_ok($$insert into user_preferences(tenant_id,user_profile_id) values('1d130000-0000-0000-0000-000000000001','4d130000-0000-0000-0000-000000000006')$$,'42501',null,'direct preference insert is denied');
select throws_ok($$select save_tenant_settings_with_audit('{"name":"Denied","currency":"INR","timezone":"Asia/Kolkata","export_retention_days":7,"export_max_rows":1000}',1,'6d130000-0000-0000-0000-000000000001')$$,'42501',null,'regular role cannot edit tenant settings');

select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000003',true);
select lives_ok($$select save_branch_settings_with_audit('2d130000-0000-0000-0000-000000000001','{"report_default_department_id":"3d130000-0000-0000-0000-000000000001","export_max_rows":1000}',1,'6d130000-0000-0000-0000-000000000002')$$,'manager edits only own branch defaults');
select throws_ok($$select save_branch_settings_with_audit('2d130000-0000-0000-0000-000000000002','{"report_default_department_id":null,"export_max_rows":1000}',1,'6d130000-0000-0000-0000-000000000003')$$,'42501',null,'manager cannot edit another branch');

select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000002',true);
select lives_ok($$select save_tenant_settings_with_audit('{"name":"Synthetic Analytics Tenant A","currency":"INR","timezone":"Asia/Kolkata","export_retention_days":7,"export_max_rows":5000}',1,'6d130000-0000-0000-0000-000000000004')$$,'admin edits tenant settings with fresh version');
select throws_ok($$select save_tenant_settings_with_audit('{"name":"Stale","currency":"INR","timezone":"Asia/Kolkata","export_retention_days":7,"export_max_rows":5000}',1,'6d130000-0000-0000-0000-000000000005')$$,'40001',null,'stale tenant settings version is rejected');
select ok((select count(*) from audit_logs where module='settings')>=3,'preference and shared settings changes are audited');

-- Export allowlist, idempotency, claims, cancellation, retry, expiry, download, and audit.
select throws_ok($$select request_report_export_with_audit('unknown_report','{"preset":"today"}','7d130000-0000-0000-0000-000000000001')$$,'42501',null,'unknown export report is rejected');
select lives_ok($$select request_report_export_with_audit('task_operations','{"preset":"today"}','7d130000-0000-0000-0000-000000000002')$$,'allowlisted export is queued');
select lives_ok($$select request_report_export_with_audit('task_operations','{"preset":"today"}','7d130000-0000-0000-0000-000000000002')$$,'same export request key replays safely');
reset role;
select is((select count(*)::int from export_logs where request_key='7d130000-0000-0000-0000-000000000002'),1,'export idempotency creates one job');
select is((select count(*)::int from claim_report_exports(5,'8d130000-0000-0000-0000-000000000001',10)),1,'worker claims queued export once');
select is((select count(*)::int from claim_report_exports(5,'8d130000-0000-0000-0000-000000000002',10)),0,'SKIP LOCKED contract prevents double claim');
select lives_ok($$select finish_report_export((select id from export_logs where request_key='7d130000-0000-0000-0000-000000000002'),'8d130000-0000-0000-0000-000000000001','failed',null,null,'synthetic_failure')$$,'worker marks a sanitized failure');
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000002',true);
select lives_ok($$select retry_report_export_with_audit((select id from export_logs where request_key='7d130000-0000-0000-0000-000000000002'),'7d130000-0000-0000-0000-000000000003')$$,'failed export may be retried within limit');
select lives_ok($$select cancel_report_export_with_audit((select id from export_logs where request_key='7d130000-0000-0000-0000-000000000002'),'7d130000-0000-0000-0000-000000000004')$$,'queued retry may be cancelled');
select throws_ok($$select get_report_export_download_url((select id from export_logs where request_key='7d130000-0000-0000-0000-000000000002'))$$,'42501',null,'cancelled export cannot be downloaded');
reset role;
insert into export_logs(tenant_id,user_profile_id,report_key,requester_role,scope_snapshot,filter_snapshot,status,object_path,progress_percent,row_count,completed_at,expires_at,request_key)
values('1d130000-0000-0000-0000-000000000001','4d130000-0000-0000-0000-000000000002','task_operations','admin','{}','{}','completed','1d130000-0000-0000-0000-000000000001/9d130000-0000-0000-0000-000000000001/task_operations-2026-08-10.csv',100,2,now(),now()+interval '1 day','7d130000-0000-0000-0000-000000000005');
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000002',true);
select lives_ok($$select get_report_export_download_url((select id from export_logs where request_key='7d130000-0000-0000-0000-000000000005'))$$,'requester receives reauthorized short-lived download metadata');
select ok(can_read_report_export_object((select object_path from export_logs where request_key='7d130000-0000-0000-0000-000000000005')),'requester may read matching private object');
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000010',true);
select ok(not can_read_report_export_object((select object_path from export_logs where request_key='7d130000-0000-0000-0000-000000000005')),'cross-tenant object read is denied');
select throws_ok($$select get_report_export_download_url((select id from export_logs where request_key='7d130000-0000-0000-0000-000000000005'))$$,'42501',null,'cross-tenant download authorization is denied');
reset role;
update export_logs set expires_at=now()-interval '1 minute' where request_key='7d130000-0000-0000-0000-000000000005';
select is((select count(*)::int from claim_report_export_cleanup(10)),1,'expired completed object is claimed for cleanup');
select ok(mark_report_export_cleaned((select id from export_logs where request_key='7d130000-0000-0000-0000-000000000005')),'cleanup completion clears private object path');
select ok((select count(*) from audit_logs where module='exports' and action in ('report_export_requested','report_export_retried','report_export_cancelled','report_export_download_authorized','report_export_cleaned'))>=5,'export lifecycle creates required audit rows');

select * from finish();
rollback;
