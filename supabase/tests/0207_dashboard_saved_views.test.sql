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

select ok(not has_table_privilege('authenticated','dashboard_saved_views','INSERT,UPDATE,DELETE'),'direct writes denied');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000002',true);
select lives_ok($$select save_dashboard_view_with_audit(null,'My overview','{"version":1,"filter":{},"sections":["attention","comparison"]}',null)$$,'owner saves validated config');
select is((select count(*)::int from dashboard_saved_views),1,'owner reads own view');
select throws_ok($$select save_dashboard_view_with_audit((select id from dashboard_saved_views limit 1),'My overview','{"version":1,"filter":{},"sections":[]}',0)$$,'40001',null,'stale writes denied');
select throws_ok($$select save_dashboard_view_with_audit(null,'Bad','{"version":1,"filter":{"password":"bad"},"sections":[]}',null)$$,'22023',null,'private and unknown fields denied');
select set_config('test.saved_view_id',(select id::text from dashboard_saved_views limit 1),true);
select throws_ok($$select save_dashboard_view_with_audit(null,'Bad null','{"version":null,"filter":{},"sections":[]}',null)$$,'22023',null,'null configuration version denied');
select throws_ok($$select save_dashboard_view_with_audit(null,'Bad sections','{"version":1,"filter":{},"sections":["attention","attention"]}',null)$$,'22023',null,'duplicate sections denied');
select set_config('request.jwt.claim.sub','ad130000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from dashboard_saved_views),0,'other user cannot read view');
select throws_ok($$select delete_dashboard_view_with_audit(current_setting('test.saved_view_id')::uuid,1)$$,'42501',null,'other user cannot delete view');
select lives_ok($$select save_dashboard_view_with_audit(p_name=>'My overview',p_config=>'{"version":1,"filter":{},"sections":[]}')$$,'same view name isolated per owner and optional defaults work');
do $$begin for i in 1..19 loop perform save_dashboard_view_with_audit(p_name=>'Quota '||i,p_config=>'{"version":1,"filter":{},"sections":[]}');end loop;end$$;
select throws_ok($$select save_dashboard_view_with_audit(p_name=>'Quota overflow',p_config=>'{"version":1,"filter":{},"sections":[]}')$$,'22023',null,'owner quota cannot be exceeded');
reset role;
insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) values ('4d130000-0000-0000-0000-000000000003','1d130000-0000-0000-0000-000000000001','dashboard.view','deny');
set local role authenticated;
select is((select count(*)::int from dashboard_saved_views),0,'dashboard denial blocks direct saved view SELECT');
select throws_ok($$select save_dashboard_view_with_audit(p_name=>'Denied',p_config=>'{"version":1,"filter":{},"sections":[]}')$$,'42501',null,'dashboard denial blocks audited save');
reset role;
select is((production_demo_data_retirement_manifest('1d130000-0000-0000-0000-000000000001')->'retained_counts'->>'dashboard_saved_views')::int,21,'retirement gate classifies saved layouts as retained');
select * from finish();
rollback;