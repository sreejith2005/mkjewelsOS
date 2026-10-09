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

-- State produced by a completed starter transaction plus a second pending runtime stage.
insert into form_templates(id,tenant_id,name,created_by) values ('6d130000-0000-0000-0000-000000000001','1d130000-0000-0000-0000-000000000001','Synthetic workflow form','4d130000-0000-0000-0000-000000000002');
insert into fms_flows(id,tenant_id,name,created_by) values ('6d130000-0000-0000-0000-000000000002','1d130000-0000-0000-0000-000000000001','Synthetic flow','4d130000-0000-0000-0000-000000000002');
insert into fms_stages(id,fms_flow_id,name,sort_order,form_template_id) values ('6d130000-0000-0000-0000-000000000003','6d130000-0000-0000-0000-000000000002','Starter',0,'6d130000-0000-0000-0000-000000000001'),('6d130000-0000-0000-0000-000000000004','6d130000-0000-0000-0000-000000000002','Review',1,null);
insert into fms_instances(id,tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,started_by) select '6d130000-0000-0000-0000-000000000005','1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001',id,family_id,version,'SYNTHETIC-INSIGHTS','Synthetic instance','4d130000-0000-0000-0000-000000000006' from fms_flows where id='6d130000-0000-0000-0000-000000000002';
insert into fms_instance_stages(id,fms_instance_id,fms_stage_id,status,planned_datetime,actual_datetime) values ('6d130000-0000-0000-0000-000000000006','6d130000-0000-0000-0000-000000000005','6d130000-0000-0000-0000-000000000003','completed',now(),now()),('6d130000-0000-0000-0000-000000000007','6d130000-0000-0000-0000-000000000005','6d130000-0000-0000-0000-000000000004','pending',now()-interval '8 days',null);
insert into fms_starter_assignments(tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,status,completed_at) values ('1d130000-0000-0000-0000-000000000001','6d130000-0000-0000-0000-000000000002','6d130000-0000-0000-0000-000000000003','6d130000-0000-0000-0000-000000000001','4d130000-0000-0000-0000-000000000006','completed',now());
insert into form_submissions(tenant_id,branch_id,department_id,form_template_id,submitted_by,submitted_at,linked_module,linked_record_id) values ('1d130000-0000-0000-0000-000000000001','2d130000-0000-0000-0000-000000000001','3d130000-0000-0000-0000-000000000001','6d130000-0000-0000-0000-000000000001','4d130000-0000-0000-0000-000000000006',now(),'fms_stage','6d130000-0000-0000-0000-000000000006');
select ok(not has_function_privilege('anon','get_management_insights_v1(jsonb)','EXECUTE'),'anonymous cannot execute insights');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000002',true);
select is((get_management_insights_v1('{"preset":"today"}')->>'version')::int,1,'versioned response');
select is((get_management_insight_records_v1('{"preset":"today"}','completed_stages',null,0,25)->>'total')::int,1,'starter transaction counts initial runtime stage once');
select is((get_management_insight_records_v1('{"preset":"today","stage_id":"6d130000-0000-0000-0000-000000000003"}','submitted_forms',null,0,25)->>'total')::int,1,'selected stage retains its durably linked submissions');
select is((get_management_insight_records_v1('{}','open_instances',null,0,25)->>'total')::int,1,'open instances deduplicate runtime stages');
select is((get_management_insight_records_v1('{}','aged_stages',null,0,25)->>'total')::int,1,'aged runtime backlog includes earlier deadlines');
select is((get_management_insight_records_v1('{}','blocked_stages',null,0,25)->>'total')::int,1,'pending overdue runtime stage needs attention');
select is((get_management_insight_records_v1('{"stage_id":"6d130000-0000-0000-0000-000000000003"}','completed_starters',null,0,25)->>'total')::int,1,'stage filter preserves exact starter identity');
select throws_ok($$select get_management_insight_records_v1('{}','open_instances','unsupported',0,25)$$,'22023',null,'instance selector rejects unsupported grouping');
select throws_ok($$select get_management_insights_v1('{"preset":"custom","from":null,"to":null}')$$,'22023',null,'null custom dates rejected');
select is((get_management_insight_records_v1('{"preset":"today"}','due',null,0,25)->>'total')::int,3,'admin due cohort excludes other tenant');
select is((get_management_insight_records_v1('{"preset":"today"}','cohort_completed',null,0,25)->>'total')::int,1,'cohort completions');
select is((get_management_insight_records_v1('{"preset":"today"}','due',null,0,1)->'rows')::jsonb -> 0 ->> 'module','tasks','bounded typed detail');
select throws_ok($$select get_management_insights_v1('{"unknown":true}')$$,'22023',null,'unknown filter rejected');
select throws_ok($$select get_management_insight_records_v1('{}','invented',null,0,25)$$,'22023',null,'unknown metric rejected');
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000003',true);
select throws_ok($$select get_management_insights_v1('{"branch_id":"2d130000-0000-0000-0000-000000000002"}')$$,'42501',null,'manager cannot widen scope');
select is((get_management_insight_records_v1('{"preset":"today"}','due',null,0,25)->>'total')::int,2,'manager branch scope');
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000006',true);
select is((get_management_insight_records_v1('{"preset":"today"}','due',null,0,25)->>'total')::int,2,'ordinary own work');
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000009',true);
select throws_ok($$select get_management_insights_v1('{}')$$,'42501',null,'inactive denied');
reset role;
insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) values ('4d130000-0000-0000-0000-000000000003','1d130000-0000-0000-0000-000000000001','tasks.view','deny');
set local role authenticated;
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000003',true);
select is((get_management_insight_records_v1('{"preset":"today"}','due',null,0,25)->>'total')::int,0,'section denied blocks direct detail API');
select is((get_management_insights_v1('{}')->'moduleStates'->>'tasks')::boolean,false,'denied task module state');
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000002',true);
select is((get_management_insight_records_v1('{"preset":"today","groupBy":"department"}','group_work','3d130000-0000-0000-0000-000000000001',0,25)->>'total')::int,2,'group records reconcile with mixed due and backlog scope');
select is((select (m->>'value')::numeric from jsonb_array_elements(get_management_insights_v1('{"preset":"today"}')->'metrics') m where m->>'key'='task_pending_score'),-66.7::numeric,'negative score convention retained');
select throws_ok($$select get_management_insights_v1('{"branch_id":"2d130000-0000-0000-0000-000000000003"}')$$,'42501',null,'cross tenant scope denied');
select is((select sum((g->>'total')::int) from jsonb_array_elements(get_management_insights_v1('{"preset":"today","groupBy":"employee"}')->'groups')g),4::bigint,'shared work counts once per employee, not as organization tasks');
select is((get_management_insight_records_v1('{"preset":"today"}','required_forms',null,0,25)->>'total')::int,0,'no outstanding required forms without form assignments');
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000004',true);
select throws_ok($$select get_management_insights_v1('{"branch_id":"2d130000-0000-0000-0000-000000000002"}')$$,'42501',null,'HR cannot widen dashboard authority');
select is((get_management_insight_records_v1('{"preset":"today"}','due',null,0,25)->>'total')::int,0,'HR task scope remains own work');
reset role;
update user_profiles set branch_id='2d130000-0000-0000-0000-000000000002',department_id='3d130000-0000-0000-0000-000000000002' where id='4d130000-0000-0000-0000-000000000007';
insert into user_availability(tenant_id,user_profile_id,date,status) values ('1d130000-0000-0000-0000-000000000001','4d130000-0000-0000-0000-000000000006',(now() at time zone 'Asia/Kolkata')::date,'half_day');
insert into leave_requests(tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path,status) values ('1d130000-0000-0000-0000-000000000001','4d130000-0000-0000-0000-000000000006','2d130000-0000-0000-0000-000000000001','casual','2ND HALF','Synthetic', (now() at time zone 'Asia/Kolkata')::date,(now() at time zone 'Asia/Kolkata')::date,(now() at time zone 'Asia/Kolkata')::date+1,'1ST HALF','Inform Adv',0.5,'insights/synthetic','approved');
select ok(not leave_half_day_absent_at('4d130000-0000-0000-0000-000000000006',(((now() at time zone 'Asia/Kolkata')::date::text||' 12:59 Asia/Kolkata')::timestamptz)),'second half available before cutoff');
select ok(leave_half_day_absent_at('4d130000-0000-0000-0000-000000000006',(((now() at time zone 'Asia/Kolkata')::date::text||' 13:00 Asia/Kolkata')::timestamptz)),'second half absent at cutoff');
insert into user_access_profiles(user_profile_id,tenant_id,dashboard_authority) values ('4d130000-0000-0000-0000-000000000002','1d130000-0000-0000-0000-000000000001','manager'),('4d130000-0000-0000-0000-000000000006','1d130000-0000-0000-0000-000000000001','admin');
set local role authenticated;
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000002',true);
select throws_ok($$select get_management_insights_v1('{"branch_id":"2d130000-0000-0000-0000-000000000002"}')$$,'42501',null,'downgraded authority denies widening');
select is((get_management_insight_records_v1('{}','active_people',null,0,25)->>'total')::int,7,'downgraded authority constrains people across branches');
select is((get_management_insights_options_v1('{}')->'employees')::jsonb @> '[{"id":"4d130000-0000-0000-0000-000000000007"}]',false,'downgraded authority constrains employee options');
select is((get_management_insights_options_v1('{}')->'employees')::jsonb @> '[{"id":"4d130000-0000-0000-0000-000000000010"}]',false,'employee options exclude other tenant');
select is((get_management_insight_records_v1('{"preset":"today"}','due',null,0,25)->>'total')::int,2,'downgraded admin uses manager branch');
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000006',true);
select lives_ok($$select get_management_insights_v1('{"branch_id":"2d130000-0000-0000-0000-000000000002"}')$$,'promoted authority permits authorized tenant branch');
select is((get_management_insight_records_v1('{"user_profile_id":"4d130000-0000-0000-0000-000000000006"}','available_people',null,0,25)->>'total')::int,case when (now() at time zone 'Asia/Kolkata')::time>=time '13:00' then 0 else 1 end,'half-day availability uses present half at refresh');
select throws_ok($$select get_management_insight_records_v1('{}','due',null,0,null)$$,'22023',null,'null limit cannot bypass bound');
select throws_ok($$select get_management_insight_records_v1('{}','due',null,null,25)$$,'22023',null,'null offset rejected');
reset role;
update user_profiles set branch_id='2d130000-0000-0000-0000-000000000002',department_id='3d130000-0000-0000-0000-000000000002',working_status='inactive',is_login_enabled=false where id='4d130000-0000-0000-0000-000000000006';
set local role authenticated;
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000002',true);
select is((get_management_insight_records_v1('{}','completed_stages',null,0,25)->>'total')::int,1,'transferred inactive doer retains runtime recorded branch');
select is((get_management_insight_records_v1('{}','completed_starters',null,0,25)->>'total')::int,0,'starter scope explicitly follows current assignee branch');
select * from finish();
rollback;