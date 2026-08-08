begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(245);

-- Fixed synthetic identities and records only. No production data is queried.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select auth_id, 'authenticated', 'authenticated', email,
  crypt('synthetic-test-value', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (values
  ('aa000000-0000-0000-0000-000000000001'::uuid, 'super-a@example.invalid'),
  ('aa000000-0000-0000-0000-000000000002'::uuid, 'admin-a@example.invalid'),
  ('aa000000-0000-0000-0000-000000000003'::uuid, 'manager-a1@example.invalid'),
  ('aa000000-0000-0000-0000-000000000004'::uuid, 'hr-a1@example.invalid'),
  ('aa000000-0000-0000-0000-000000000005'::uuid, 'crm-a1@example.invalid'),
  ('aa000000-0000-0000-0000-000000000006'::uuid, 'staff-a1@example.invalid'),
  ('aa000000-0000-0000-0000-000000000007'::uuid, 'doer-a1@example.invalid'),
  ('aa000000-0000-0000-0000-000000000008'::uuid, 'housekeeping-a1@example.invalid'),
  ('aa000000-0000-0000-0000-000000000009'::uuid, 'manager-a2@example.invalid'),
  ('aa000000-0000-0000-0000-000000000010'::uuid, 'staff-a2@example.invalid'),
  ('aa000000-0000-0000-0000-000000000011'::uuid, 'inactive-admin@example.invalid'),
  ('aa000000-0000-0000-0000-000000000012'::uuid, 'admin-b@example.invalid'),
  ('aa000000-0000-0000-0000-000000000013'::uuid, 'super-b@example.invalid')
) fixture(auth_id, email);

insert into tenants(id, name, slug) values
  ('11000000-0000-0000-0000-000000000001', 'Synthetic Tenant A', 'phase3a-a'),
  ('11000000-0000-0000-0000-000000000002', 'Synthetic Tenant B', 'phase3a-b');
insert into branches(id, tenant_id, name, code) values
  ('22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic Branch A1','A1'),
  ('22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','Synthetic Branch A2','A2'),
  ('22000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000002','Synthetic Branch B1','B1');
insert into departments(id, tenant_id, branch_id, name, code) values
  ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','Synthetic Department A1','A1D'),
  ('33000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','Synthetic Department A2','A2D'),
  ('33000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000003','Synthetic Department B1','B1D');

insert into user_profiles(
  id, auth_user_id, tenant_id, branch_id, department_id, employee_name,
  personal_mobile, email, employee_code, user_role, working_status, is_login_enabled
)
select profile_id, auth_id, tenant_id, branch_id, department_id, label,
  mobile, email, code, role::user_role, status::working_status, login_enabled
from (values
  ('44000000-0000-0000-0000-000000000001'::uuid,'aa000000-0000-0000-0000-000000000001'::uuid,'11000000-0000-0000-0000-000000000001'::uuid,'22000000-0000-0000-0000-000000000001'::uuid,'33000000-0000-0000-0000-000000000001'::uuid,'Synthetic Super A','0000000001','super-a@example.invalid','S3A-001','super_admin','active',true),
  ('44000000-0000-0000-0000-000000000002','aa000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic Admin A','0000000002','admin-a@example.invalid','S3A-002','admin','active',true),
  ('44000000-0000-0000-0000-000000000003','aa000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic Manager A1','0000000003','manager-a1@example.invalid','S3A-003','manager','active',true),
  ('44000000-0000-0000-0000-000000000004','aa000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic HR A1','0000000004','hr-a1@example.invalid','S3A-004','hr','active',true),
  ('44000000-0000-0000-0000-000000000005','aa000000-0000-0000-0000-000000000005','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic CRM A1','0000000005','crm-a1@example.invalid','S3A-005','crm','active',true),
  ('44000000-0000-0000-0000-000000000006','aa000000-0000-0000-0000-000000000006','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic Staff A1','0000000006','staff-a1@example.invalid','S3A-006','staff','active',true),
  ('44000000-0000-0000-0000-000000000007','aa000000-0000-0000-0000-000000000007','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic Doer A1','0000000007','doer-a1@example.invalid','S3A-007','doer','active',true),
  ('44000000-0000-0000-0000-000000000008','aa000000-0000-0000-0000-000000000008','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic Housekeeping A1','0000000008','housekeeping-a1@example.invalid','S3A-008','housekeeping','active',true),
  ('44000000-0000-0000-0000-000000000009','aa000000-0000-0000-0000-000000000009','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','Synthetic Manager A2','0000000009','manager-a2@example.invalid','S3A-009','manager','active',true),
  ('44000000-0000-0000-0000-000000000010','aa000000-0000-0000-0000-000000000010','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','Synthetic Staff A2','0000000010','staff-a2@example.invalid','S3A-010','staff','active',true),
  ('44000000-0000-0000-0000-000000000011','aa000000-0000-0000-0000-000000000011','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic Inactive Admin','0000000011','inactive-admin@example.invalid','S3A-011','admin','inactive',false),
  ('44000000-0000-0000-0000-000000000012','aa000000-0000-0000-0000-000000000012','11000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000003','33000000-0000-0000-0000-000000000003','Synthetic Admin B','0000000012','admin-b@example.invalid','S3B-012','admin','active',true),
  ('44000000-0000-0000-0000-000000000013','aa000000-0000-0000-0000-000000000013','11000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000003','33000000-0000-0000-0000-000000000003','Synthetic Super B','0000000013','super-b@example.invalid','S3B-013','super_admin','active',true)
) fixture(profile_id,auth_id,tenant_id,branch_id,department_id,label,mobile,email,code,role,status,login_enabled);

-- Forms fixtures.
insert into form_templates(id,tenant_id,name,is_active) values
  ('55000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic Active Form A',true),
  ('55000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','Synthetic Inactive Form A',false),
  ('55000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000002','Synthetic Active Form B',true);
insert into form_fields(id,form_template_id,field_name,field_type,sort_order) values
  ('56000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001','synthetic_a','text',0),
  ('56000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000002','synthetic_inactive','text',0),
  ('56000000-0000-0000-0000-000000000003','55000000-0000-0000-0000-000000000003','synthetic_b','text',0);
insert into form_links(id,form_template_id,linked_module,linked_reference_id) values
  ('57000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001','dashboard_button',null),
  ('57000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000003','dashboard_button',null),
  ('57000000-0000-0000-0000-000000000003','55000000-0000-0000-0000-000000000002','task',null);

-- FMS configuration and history fixtures.
insert into fms_flows(id,tenant_id,branch_id,name,created_by) values
  ('61000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',null,'Synthetic Global A','44000000-0000-0000-0000-000000000002'),
  ('61000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','Synthetic Branch A1','44000000-0000-0000-0000-000000000002'),
  ('61000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','Synthetic Branch A2','44000000-0000-0000-0000-000000000002'),
  ('61000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000003','Synthetic Branch B1','44000000-0000-0000-0000-000000000012');
insert into fms_stages(id,fms_flow_id,name,sort_order) values
  ('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','Global A Stage 1',0),
  ('62000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000001','Global A Stage 2',1),
  ('62000000-0000-0000-0000-000000000003','61000000-0000-0000-0000-000000000002','A1 Stage 1',0),
  ('62000000-0000-0000-0000-000000000004','61000000-0000-0000-0000-000000000002','A1 Stage 2',1),
  ('62000000-0000-0000-0000-000000000005','61000000-0000-0000-0000-000000000003','A2 Stage 1',0),
  ('62000000-0000-0000-0000-000000000006','61000000-0000-0000-0000-000000000004','B1 Stage 1',0);
insert into fms_stage_assignees(id,fms_stage_id,assignee_type,user_profile_id,role_value) values
  ('63000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000003','role',null,'staff'),
  ('63000000-0000-0000-0000-000000000002','62000000-0000-0000-0000-000000000005','role',null,'staff'),
  ('63000000-0000-0000-0000-000000000003','62000000-0000-0000-0000-000000000001','specific_user','44000000-0000-0000-0000-000000000006',null),
  ('63000000-0000-0000-0000-000000000004','62000000-0000-0000-0000-000000000001','specific_user','44000000-0000-0000-0000-000000000010',null),
  ('63000000-0000-0000-0000-000000000005','62000000-0000-0000-0000-000000000001','specific_user','44000000-0000-0000-0000-000000000012',null),
  ('63000000-0000-0000-0000-000000000006','62000000-0000-0000-0000-000000000003','role','44000000-0000-0000-0000-000000000006','staff'),
  ('63000000-0000-0000-0000-000000000007','62000000-0000-0000-0000-000000000003','specific_user',null,null);
insert into fms_branch_rules(id,fms_stage_id,condition_field,condition_operator,condition_value,next_stage_id,next_flow_id,sort_order) values
  ('64000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000003','outcome','=','ok','62000000-0000-0000-0000-000000000004',null,0),
  ('64000000-0000-0000-0000-000000000002','62000000-0000-0000-0000-000000000003','outcome','=','global',null,'61000000-0000-0000-0000-000000000001',1),
  ('64000000-0000-0000-0000-000000000003','62000000-0000-0000-0000-000000000001','outcome','=','own',null,'61000000-0000-0000-0000-000000000002',0),
  ('64000000-0000-0000-0000-000000000004','62000000-0000-0000-0000-000000000001','outcome','=','other',null,'61000000-0000-0000-0000-000000000003',1),
  ('64000000-0000-0000-0000-000000000005','62000000-0000-0000-0000-000000000001','outcome','=','global',null,'61000000-0000-0000-0000-000000000001',2),
  ('64000000-0000-0000-0000-000000000006','62000000-0000-0000-0000-000000000003','outcome','=','bad-stage','62000000-0000-0000-0000-000000000005',null,3),
  ('64000000-0000-0000-0000-000000000007','62000000-0000-0000-0000-000000000003','outcome','=','cross-tenant',null,'61000000-0000-0000-0000-000000000004',4),
  ('64000000-0000-0000-0000-000000000008','62000000-0000-0000-0000-000000000003','outcome','=','ambiguous','62000000-0000-0000-0000-000000000004','61000000-0000-0000-0000-000000000001',5),
  ('64000000-0000-0000-0000-000000000009','62000000-0000-0000-0000-000000000003','outcome','=','targetless',null,null,6);

insert into fms_instances(id,tenant_id,branch_id,fms_flow_id,reference_number,title,started_by) values
  ('65000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','SYN-A1','Synthetic Instance A1','44000000-0000-0000-0000-000000000002'),
  ('65000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000003','SYN-A2','Synthetic Instance A2','44000000-0000-0000-0000-000000000002'),
  ('65000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000003','61000000-0000-0000-0000-000000000004','SYN-B1','Synthetic Instance B1','44000000-0000-0000-0000-000000000012');
insert into fms_instance_stages(id,fms_instance_id,fms_stage_id,assigned_to) values
  ('66000000-0000-0000-0000-000000000001','65000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000003',array['44000000-0000-0000-0000-000000000005'::uuid,'44000000-0000-0000-0000-000000000006'::uuid,'44000000-0000-0000-0000-000000000007'::uuid]),
  ('66000000-0000-0000-0000-000000000002','65000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000004',array['44000000-0000-0000-0000-000000000010'::uuid]),
  ('66000000-0000-0000-0000-000000000003','65000000-0000-0000-0000-000000000002','62000000-0000-0000-0000-000000000005',array['44000000-0000-0000-0000-000000000010'::uuid]),
  ('66000000-0000-0000-0000-000000000004','65000000-0000-0000-0000-000000000003','62000000-0000-0000-0000-000000000006',array['44000000-0000-0000-0000-000000000012'::uuid]);
insert into fms_stage_logs(id,fms_instance_stage_id,action) values
  ('67000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','synthetic_a1_stage1'),
  ('67000000-0000-0000-0000-000000000002','66000000-0000-0000-0000-000000000002','synthetic_a1_stage2'),
  ('67000000-0000-0000-0000-000000000003','66000000-0000-0000-0000-000000000003','synthetic_a2'),
  ('67000000-0000-0000-0000-000000000004','66000000-0000-0000-0000-000000000004','synthetic_b1');

-- CRM, notification, report and export fixtures.
insert into clients(id,tenant_id,branch_id,phone) values
  ('71000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','SYNTHETIC-A1'),
  ('71000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','SYNTHETIC-A2'),
  ('71000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000003','SYNTHETIC-B1');
insert into walkin_entries(id,tenant_id,branch_id,client_id,visit_date) values
  ('72000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','2099-01-01'),
  ('72000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','2099-01-02'),
  ('72000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','2099-01-03'),
  ('72000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000003','2099-01-04'),
  ('72000000-0000-0000-0000-000000000005','11000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000003','2099-01-05');
insert into walkin_uploads(id,walkin_entry_id,file_url) values
  ('73000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','synthetic/a1'),
  ('73000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000002','synthetic/a2'),
  ('73000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000005','synthetic/b1'),
  ('73000000-0000-0000-0000-000000000004','72000000-0000-0000-0000-000000000004','synthetic/malformed');
insert into client_timeline(id,client_id,event_type,summary) values
  ('74000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','synthetic','Synthetic A1'),
  ('74000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002','synthetic','Synthetic A2'),
  ('74000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000003','synthetic','Synthetic B1');
insert into client_followups(id,client_id,due_date,notes) values
  ('75000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','2099-02-01','Synthetic A1'),
  ('75000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002','2099-02-02','Synthetic A2'),
  ('75000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000003','2099-02-03','Synthetic B1');

insert into notification_templates(id,tenant_id,event_type,channel,title_template,body_template) values
  ('81000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','synthetic','in_app','Synthetic A','Synthetic A'),
  ('81000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000002','synthetic','in_app','Synthetic B','Synthetic B'),
  ('81000000-0000-0000-0000-000000000003',null,'synthetic','in_app','Synthetic Global','Synthetic Global');
insert into notification_rules(id,tenant_id,event_type,template_id) values
  ('82000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','synthetic','81000000-0000-0000-0000-000000000001'),
  ('82000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','synthetic',null),
  ('82000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','synthetic','81000000-0000-0000-0000-000000000002'),
  ('82000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000002','synthetic','81000000-0000-0000-0000-000000000002'),
  ('82000000-0000-0000-0000-000000000005',null,'synthetic',null);
insert into notifications(id,tenant_id,user_profile_id,event_type,title,message) values
  ('83000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','44000000-0000-0000-0000-000000000007','synthetic','Synthetic','Synthetic');
insert into notification_logs(id,notification_id,channel,status,provider_response) values
  ('84000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000001','in_app','synthetic','{"synthetic":true}');

insert into performance_snapshots(id,tenant_id,branch_id,user_profile_id,period_start,period_end)
select ('90000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  case when n <= 10 then '11000000-0000-0000-0000-000000000001'::uuid else '11000000-0000-0000-0000-000000000002'::uuid end,
  case when n = 10 then '22000000-0000-0000-0000-000000000002'::uuid when n <= 10 then '22000000-0000-0000-0000-000000000001'::uuid else '22000000-0000-0000-0000-000000000003'::uuid end,
  ('44000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,'2099-01-01'::date,'2099-01-31'::date
from generate_series(1,10) n
union all select '90000000-0000-0000-0000-000000000012','11000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000003','44000000-0000-0000-0000-000000000012','2099-01-01'::date,'2099-01-31'::date;
insert into export_logs(id,tenant_id,user_profile_id,export_type)
select ('91000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  '11000000-0000-0000-0000-000000000001'::uuid,
  ('44000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,'synthetic'
from generate_series(1,10) n
union all select '91000000-0000-0000-0000-000000000012','11000000-0000-0000-0000-000000000002','44000000-0000-0000-0000-000000000012','synthetic';

-- 14 RLS assertions.
select ok(c.relrowsecurity, format('RLS is enabled on %s', t.table_name))
from unnest(array['client_followups','client_timeline','export_logs','fms_branch_rules','fms_stage_assignees','fms_stage_logs','form_fields','form_links','notification_logs','notification_rules','notification_templates','performance_snapshots','walkin_entries','walkin_uploads']) t(table_name)
join pg_class c on c.oid = format('public.%I',t.table_name)::regclass;

-- 71 table-privilege assertions: full deny matrix plus exact read allowlist.
select ok(not exists (
  select 1
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r',c.relowner))) acl
  where c.oid = format('public.%I',table_name)::regclass
    and acl.grantee = 0
),format('PUBLIC has no privileges on %s',table_name))
from unnest(array['client_followups','client_timeline','export_logs','fms_branch_rules','fms_stage_assignees','fms_stage_logs','form_fields','form_links','notification_logs','notification_rules','notification_templates','performance_snapshots','walkin_entries','walkin_uploads']) t(table_name);
select ok(not has_table_privilege('anon',format('public.%I',table_name),'SELECT,INSERT,UPDATE,DELETE'),format('anon has no browser privileges on %s',table_name))
from unnest(array['client_followups','client_timeline','export_logs','fms_branch_rules','fms_stage_assignees','fms_stage_logs','form_fields','form_links','notification_logs','notification_rules','notification_templates','performance_snapshots','walkin_entries','walkin_uploads']) t(table_name);
select ok(not has_table_privilege('service_role',format('public.%I',table_name),'SELECT,INSERT,UPDATE,DELETE'),format('service_role has no direct privileges on %s',table_name))
from unnest(array['client_followups','client_timeline','export_logs','fms_branch_rules','fms_stage_assignees','fms_stage_logs','form_fields','form_links','notification_logs','notification_rules','notification_templates','performance_snapshots','walkin_entries','walkin_uploads']) t(table_name);
select ok(not has_table_privilege('authenticated',format('public.%I',table_name),'INSERT,UPDATE,DELETE'),format('authenticated has no mutations on %s',table_name))
from unnest(array['client_followups','client_timeline','export_logs','fms_branch_rules','fms_stage_assignees','fms_stage_logs','form_fields','form_links','notification_logs','notification_rules','notification_templates','performance_snapshots','walkin_entries','walkin_uploads']) t(table_name);
select ok(has_table_privilege('authenticated',format('public.%I',table_name),'SELECT'),format('authenticated has approved SELECT on %s',table_name))
from unnest(array['form_templates','form_fields','form_links','fms_stage_assignees','fms_branch_rules','fms_stage_logs','walkin_entries','walkin_uploads','client_timeline','client_followups','notification_templates','notification_rules','performance_snapshots','export_logs']) t(table_name);
select ok(not has_table_privilege('authenticated','public.notification_logs','SELECT'),'authenticated has no notification_logs SELECT');

-- The hardened parent table follows the same explicit deny posture.
select ok(not exists (
  select 1
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r',c.relowner))) acl
  where c.oid = 'public.form_templates'::regclass and acl.grantee = 0
), 'PUBLIC has no privileges on form_templates');
select ok(not has_table_privilege('anon','public.form_templates','SELECT,INSERT,UPDATE,DELETE'),'anon has no browser privileges on form_templates');
select ok(not has_table_privilege('service_role','public.form_templates','SELECT,INSERT,UPDATE,DELETE'),'service_role has no direct privileges on form_templates');
select ok(not has_table_privilege('authenticated','public.form_templates','INSERT,UPDATE,DELETE'),'authenticated has no form_templates mutations');

-- 21 required indexes, with exact definitions supplied by migration 0008.
select ok(to_regclass('public.'||index_name) is not null,format('required index %s exists',index_name))
from unnest(array[
  'idx_form_fields_template_sort','idx_form_links_template_module_reference',
  'idx_fms_stage_assignees_stage','idx_fms_stage_assignees_user',
  'idx_fms_branch_rules_stage_sort','idx_fms_branch_rules_next_stage','idx_fms_branch_rules_next_flow',
  'idx_fms_stage_logs_instance_stage_created','idx_walkin_entries_tenant_branch_visit',
  'idx_walkin_entries_client','idx_walkin_uploads_entry','idx_client_timeline_client_created',
  'idx_client_followups_client_created','idx_client_followups_assigned_to',
  'idx_notification_templates_tenant_event_channel_active','idx_notification_rules_tenant_event_active',
  'idx_notification_rules_template','idx_notification_logs_notification',
  'idx_performance_snapshots_tenant_user_period','idx_performance_snapshots_tenant_branch_period',
  'idx_export_logs_tenant_user_created'
]) t(index_name);

-- Inactive admin: every SELECT-enabled Phase 3A surface and form_templates is empty.
set local role authenticated;
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000011',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is((select count(*)::int from form_templates),0,'inactive profile sees no form_templates');
select is((select count(*)::int from form_fields),0,'inactive profile sees no form_fields');
select is((select count(*)::int from form_links),0,'inactive profile sees no form_links');
select is((select count(*)::int from fms_stage_assignees),0,'inactive profile sees no fms_stage_assignees');
select is((select count(*)::int from fms_branch_rules),0,'inactive profile sees no fms_branch_rules');
select is((select count(*)::int from fms_stage_logs),0,'inactive profile sees no fms_stage_logs');
select is((select count(*)::int from walkin_entries),0,'inactive profile sees no walkin_entries');
select is((select count(*)::int from walkin_uploads),0,'inactive profile sees no walkin_uploads');
select is((select count(*)::int from client_timeline),0,'inactive profile sees no client_timeline');
select is((select count(*)::int from client_followups),0,'inactive profile sees no client_followups');
select is((select count(*)::int from notification_templates),0,'inactive profile sees no notification_templates');
select is((select count(*)::int from notification_rules),0,'inactive profile sees no notification_rules');
select is((select count(*)::int from performance_snapshots),0,'inactive profile sees no performance_snapshots');
select is((select count(*)::int from export_logs),0,'inactive profile sees no export_logs');
reset role;

-- Explicit Forms Library coverage for all eight production roles.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from form_templates),1,'super_admin reads only own active Forms Library template');
select is((select count(*)::int from form_fields)+(select count(*)::int from form_links),2,'super_admin reads matching active form children');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from form_templates),1,'admin reads Forms Library');
select is((select count(*)::int from form_fields)+(select count(*)::int from form_links),2,'admin reads matching active form children');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from form_templates),1,'manager reads Forms Library');
select is((select count(*)::int from form_fields)+(select count(*)::int from form_links),2,'manager reads matching active form children');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from form_templates),0,'hr is denied Forms Library');
select is((select count(*)::int from form_fields)+(select count(*)::int from form_links),0,'hr is denied form children');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from form_templates),1,'crm reads Forms Library');
select is((select count(*)::int from form_fields)+(select count(*)::int from form_links),2,'crm reads matching active form children');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000006',true);
select is((select count(*)::int from form_templates),1,'staff reads Forms Library');
select is((select count(*)::int from form_fields)+(select count(*)::int from form_links),2,'staff reads matching active form children');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000007',true);
select is((select count(*)::int from form_templates),0,'doer is denied Forms Library');
select is((select count(*)::int from form_fields)+(select count(*)::int from form_links),0,'doer receives no linked-runtime form-child exception');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000008',true);
select is((select count(*)::int from form_templates),0,'housekeeping is denied Forms Library');
select is((select count(*)::int from form_fields)+(select count(*)::int from form_links),0,'housekeeping is denied form children');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from form_fields),1,'inactive and foreign form fields are hidden');
select is((select count(*)::int from form_links),1,'foreign form links and linked-runtime exceptions are hidden');
reset role;

-- Tenant isolation for all 14 authenticated-readable tables, for both elevated roles.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000002',true);
select ok((select count(*) from form_templates)>0 and not exists(select 1 from form_templates where tenant_id='11000000-0000-0000-0000-000000000002'),'admin form_templates are tenant isolated');
select ok((select count(*) from form_fields)>0 and not exists(select 1 from form_fields where id='56000000-0000-0000-0000-000000000003'),'admin form_fields are tenant isolated');
select ok((select count(*) from form_links)>0 and not exists(select 1 from form_links where id='57000000-0000-0000-0000-000000000002'),'admin form_links are tenant isolated');
select ok((select count(*) from fms_stage_assignees)>0 and not exists(select 1 from fms_stage_assignees where id='63000000-0000-0000-0000-000000000005'),'admin fms_stage_assignees are tenant isolated');
select ok((select count(*) from fms_branch_rules)>0 and not exists(select 1 from fms_branch_rules where id='64000000-0000-0000-0000-000000000007'),'admin fms_branch_rules are tenant isolated');
select ok((select count(*) from fms_stage_logs)>0 and not exists(select 1 from fms_stage_logs where id='67000000-0000-0000-0000-000000000004'),'admin fms_stage_logs are tenant isolated');
select ok((select count(*) from walkin_entries)>0 and not exists(select 1 from walkin_entries where id='72000000-0000-0000-0000-000000000005'),'admin walkin_entries are tenant isolated');
select ok((select count(*) from walkin_uploads)>0 and not exists(select 1 from walkin_uploads where id='73000000-0000-0000-0000-000000000003'),'admin walkin_uploads are tenant isolated');
select ok((select count(*) from client_timeline)>0 and not exists(select 1 from client_timeline where id='74000000-0000-0000-0000-000000000003'),'admin client_timeline is tenant isolated');
select ok((select count(*) from client_followups)>0 and not exists(select 1 from client_followups where id='75000000-0000-0000-0000-000000000003'),'admin client_followups are tenant isolated');
select ok((select count(*) from notification_templates)>0 and not exists(select 1 from notification_templates where tenant_id is distinct from '11000000-0000-0000-0000-000000000001'),'admin notification_templates are tenant isolated and null-hidden');
select ok((select count(*) from notification_rules)>0 and not exists(select 1 from notification_rules where tenant_id is distinct from '11000000-0000-0000-0000-000000000001'),'admin notification_rules are tenant isolated and null-hidden');
select ok((select count(*) from performance_snapshots)>0 and not exists(select 1 from performance_snapshots where tenant_id='11000000-0000-0000-0000-000000000002'),'admin performance_snapshots are tenant isolated');
select ok((select count(*) from export_logs)>0 and not exists(select 1 from export_logs where tenant_id='11000000-0000-0000-0000-000000000002'),'admin export_logs are tenant isolated');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000001',true);
select ok((select count(*) from form_templates)>0 and not exists(select 1 from form_templates where tenant_id='11000000-0000-0000-0000-000000000002'),'super_admin form_templates are tenant isolated');
select ok((select count(*) from form_fields)>0 and not exists(select 1 from form_fields where id='56000000-0000-0000-0000-000000000003'),'super_admin form_fields are tenant isolated');
select ok((select count(*) from form_links)>0 and not exists(select 1 from form_links where id='57000000-0000-0000-0000-000000000002'),'super_admin form_links are tenant isolated');
select ok((select count(*) from fms_stage_assignees)>0 and not exists(select 1 from fms_stage_assignees where id='63000000-0000-0000-0000-000000000005'),'super_admin fms_stage_assignees are tenant isolated');
select ok((select count(*) from fms_branch_rules)>0 and not exists(select 1 from fms_branch_rules where id='64000000-0000-0000-0000-000000000007'),'super_admin fms_branch_rules are tenant isolated');
select ok((select count(*) from fms_stage_logs)>0 and not exists(select 1 from fms_stage_logs where id='67000000-0000-0000-0000-000000000004'),'super_admin fms_stage_logs are tenant isolated');
select ok((select count(*) from walkin_entries)>0 and not exists(select 1 from walkin_entries where id='72000000-0000-0000-0000-000000000005'),'super_admin walkin_entries are tenant isolated');
select ok((select count(*) from walkin_uploads)>0 and not exists(select 1 from walkin_uploads where id='73000000-0000-0000-0000-000000000003'),'super_admin walkin_uploads are tenant isolated');
select ok((select count(*) from client_timeline)>0 and not exists(select 1 from client_timeline where id='74000000-0000-0000-0000-000000000003'),'super_admin client_timeline is tenant isolated');
select ok((select count(*) from client_followups)>0 and not exists(select 1 from client_followups where id='75000000-0000-0000-0000-000000000003'),'super_admin client_followups are tenant isolated');
select ok((select count(*) from notification_templates)>0 and not exists(select 1 from notification_templates where tenant_id is distinct from '11000000-0000-0000-0000-000000000001'),'super_admin notification_templates are tenant isolated and null-hidden');
select ok((select count(*) from notification_rules)>0 and not exists(select 1 from notification_rules where tenant_id is distinct from '11000000-0000-0000-0000-000000000001'),'super_admin notification_rules are tenant isolated and null-hidden');
select ok((select count(*) from performance_snapshots)>0 and not exists(select 1 from performance_snapshots where tenant_id='11000000-0000-0000-0000-000000000002'),'super_admin performance_snapshots are tenant isolated');
select ok((select count(*) from export_logs)>0 and not exists(select 1 from export_logs where tenant_id='11000000-0000-0000-0000-000000000002'),'super_admin export_logs are tenant isolated');
reset role;

-- CRM branch semantics, including visit-branch authorization and malformed tenant links.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from walkin_entries where id in ('72000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000003')),2,'manager sees own-visit-branch walk-ins even when client branch differs');
select is((select count(*)::int from walkin_entries where id='72000000-0000-0000-0000-000000000002'),0,'manager cannot see another visit branch');
select is((select count(*)::int from walkin_entries where id='72000000-0000-0000-0000-000000000004'),0,'manager cannot see cross-tenant client relationship');
select is((select count(*)::int from walkin_uploads where id='73000000-0000-0000-0000-000000000001'),1,'manager sees upload inherited from own visit branch');
select is((select count(*)::int from walkin_uploads where id='73000000-0000-0000-0000-000000000002'),0,'manager cannot see upload from another visit branch');
select is((select count(*)::int from walkin_uploads where id='73000000-0000-0000-0000-000000000004'),0,'manager cannot see upload through a cross-tenant client relationship');
select is((select count(*)::int from client_timeline),1,'manager sees own-client-branch timeline only');
select is((select count(*)::int from client_followups),1,'manager sees own-client-branch followups only');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from walkin_entries where id in ('72000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000003')),2,'crm sees own-visit-branch walk-ins');
select is((select count(*)::int from walkin_entries where id='72000000-0000-0000-0000-000000000002'),0,'crm cannot see another visit branch');
select is((select count(*)::int from walkin_uploads where id='73000000-0000-0000-0000-000000000001'),1,'crm sees upload inherited from own visit branch');
select is((select count(*)::int from walkin_uploads where id='73000000-0000-0000-0000-000000000002'),0,'crm cannot see upload from another visit branch');
select is((select count(*)::int from walkin_uploads where id='73000000-0000-0000-0000-000000000004'),0,'crm cannot see upload through a cross-tenant client relationship');
select is((select count(*)::int from client_timeline),1,'crm sees own-client-branch timeline only');
select is((select count(*)::int from client_followups),1,'crm sees own-client-branch followups only');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from walkin_entries)+(select count(*)::int from walkin_uploads)+(select count(*)::int from client_timeline)+(select count(*)::int from client_followups),0,'hr is denied CRM tables');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000006',true);
select is((select count(*)::int from walkin_entries)+(select count(*)::int from walkin_uploads)+(select count(*)::int from client_timeline)+(select count(*)::int from client_followups),0,'staff is denied CRM tables');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000007',true);
select is((select count(*)::int from walkin_entries)+(select count(*)::int from walkin_uploads)+(select count(*)::int from client_timeline)+(select count(*)::int from client_followups),0,'doer is denied CRM tables');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000008',true);
select is((select count(*)::int from walkin_entries)+(select count(*)::int from walkin_uploads)+(select count(*)::int from client_timeline)+(select count(*)::int from client_followups),0,'housekeeping is denied CRM tables');
reset role;

-- FMS configuration fail-closed cases.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from fms_stage_assignees where id='63000000-0000-0000-0000-000000000001'),1,'manager sees own-branch assignee rule');
select is((select count(*)::int from fms_stage_assignees where id='63000000-0000-0000-0000-000000000002'),0,'manager cannot see another-branch assignee rule');
select is((select count(*)::int from fms_stage_assignees where id='63000000-0000-0000-0000-000000000003'),1,'manager sees own-branch user on global flow');
select is((select count(*)::int from fms_stage_assignees where id='63000000-0000-0000-0000-000000000004'),0,'manager cannot see another-branch user identifier on global flow');
select is((select count(*)::int from fms_stage_assignees where id in ('63000000-0000-0000-0000-000000000005','63000000-0000-0000-0000-000000000006','63000000-0000-0000-0000-000000000007')),0,'cross-tenant and malformed assignee relationships fail closed');
select is((select count(*)::int from fms_branch_rules where id='64000000-0000-0000-0000-000000000003'),1,'manager sees global source targeting own branch');
select is((select count(*)::int from fms_branch_rules where id='64000000-0000-0000-0000-000000000004'),0,'manager cannot see global source targeting another branch');
select is((select count(*)::int from fms_branch_rules where id='64000000-0000-0000-0000-000000000005'),1,'manager sees global source targeting global flow');
select is((select count(*)::int from fms_branch_rules where id in ('64000000-0000-0000-0000-000000000006','64000000-0000-0000-0000-000000000007','64000000-0000-0000-0000-000000000008','64000000-0000-0000-0000-000000000009')),0,'invalid stage, tenant, ambiguous, and targetless rules fail closed');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from fms_stage_assignees where id='63000000-0000-0000-0000-000000000004'),1,'admin sees valid same-tenant global-flow specific user');
reset role;

-- FMS history stays branch- and exact-stage-assignment scoped.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from fms_stage_logs),3,'admin sees own-tenant FMS logs only');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from fms_stage_logs),2,'manager sees own-branch FMS logs only');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from fms_stage_logs),1,'crm sees only assigned instance-stage logs');
select is((select count(*)::int from fms_stage_logs where id='67000000-0000-0000-0000-000000000002'),0,'crm assignment to one stage does not expose another stage in the instance');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000006',true);
select is((select count(*)::int from fms_stage_logs),1,'staff sees only assigned instance-stage logs');
select is((select count(*)::int from fms_stage_logs where id='67000000-0000-0000-0000-000000000002'),0,'staff assignment to one stage does not expose another stage in the instance');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000007',true);
select is((select count(*)::int from fms_stage_logs),1,'doer sees only assigned instance-stage logs');
select is((select count(*)::int from fms_stage_logs where id='67000000-0000-0000-0000-000000000002'),0,'doer assignment to one stage does not expose another stage in the instance');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from fms_stage_logs),0,'hr is denied FMS logs');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000008',true);
select is((select count(*)::int from fms_stage_logs),0,'housekeeping is denied FMS logs');
reset role;

-- Notifications: admin definitions only; delivery logs and provider response inaccessible.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from notification_templates),1,'admin sees own non-null notification template only');
select is((select count(*)::int from notification_rules),2,'admin sees valid template and nullable-template rules only');
select is((select count(*)::int from notification_rules where id='82000000-0000-0000-0000-000000000003'),0,'admin cannot see rule with cross-tenant template relationship');
select is((select count(*)::int from notification_rules where id='82000000-0000-0000-0000-000000000005'),0,'admin cannot see null-tenant notification rule');
select throws_ok($$select provider_response from notification_logs$$,'42501',null,'authenticated admin cannot read notification_logs provider_response');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from notification_templates),1,'super_admin sees own non-null definitions only');
select is((select count(*)::int from notification_rules),2,'super_admin sees only valid own-tenant notification rules');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from notification_templates)+(select count(*)::int from notification_rules),0,'manager is denied notification definitions');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from notification_templates)+(select count(*)::int from notification_rules),0,'hr is denied notification definitions');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from notification_templates)+(select count(*)::int from notification_rules),0,'crm is denied notification definitions');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000006',true);
select is((select count(*)::int from notification_templates)+(select count(*)::int from notification_rules),0,'staff is denied notification definitions');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000007',true);
select is((select count(*)::int from notification_templates)+(select count(*)::int from notification_rules),0,'doer notification recipient cannot read definitions');
select throws_ok($$select * from notification_logs$$,'42501',null,'notification recipient cannot SELECT delivery logs');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000008',true);
select is((select count(*)::int from notification_templates)+(select count(*)::int from notification_rules),0,'housekeeping is denied notification definitions');
reset role;

-- Every active production role sees its own report/export and no implicit peers.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000001',true);
select ok(exists(select 1 from performance_snapshots where user_profile_id='44000000-0000-0000-0000-000000000001'),'super_admin sees own snapshot');
select ok(exists(select 1 from export_logs where user_profile_id='44000000-0000-0000-0000-000000000001'),'super_admin sees own export');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000002',true);
select ok(exists(select 1 from performance_snapshots where user_profile_id='44000000-0000-0000-0000-000000000002'),'admin sees own snapshot');
select ok(exists(select 1 from export_logs where user_profile_id='44000000-0000-0000-0000-000000000002'),'admin sees own export');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000003',true);
select ok(exists(select 1 from performance_snapshots where user_profile_id='44000000-0000-0000-0000-000000000003'),'manager sees own snapshot');
select ok(exists(select 1 from export_logs where user_profile_id='44000000-0000-0000-0000-000000000003'),'manager sees own export');
select ok(exists(select 1 from performance_snapshots where user_profile_id='44000000-0000-0000-0000-000000000006'),'manager sees peer snapshot in own branch');
select is((select count(*)::int from performance_snapshots where branch_id='22000000-0000-0000-0000-000000000002'),0,'manager cannot see another-branch snapshots');
select is((select count(*)::int from export_logs),1,'manager cannot see peer export rows');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from performance_snapshots),1,'hr sees only own snapshot');
select is((select count(*)::int from export_logs),1,'hr sees only own export');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from performance_snapshots),1,'crm sees only own snapshot');
select is((select count(*)::int from export_logs),1,'crm sees only own export');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000006',true);
select is((select count(*)::int from performance_snapshots),1,'staff sees only own snapshot');
select is((select count(*)::int from export_logs),1,'staff sees only own export');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000007',true);
select is((select count(*)::int from performance_snapshots),1,'doer sees only own snapshot');
select is((select count(*)::int from export_logs),1,'doer sees only own export');
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000008',true);
select is((select count(*)::int from performance_snapshots),1,'housekeeping sees only own snapshot');
select is((select count(*)::int from export_logs),1,'housekeeping sees only own export');
reset role;

-- Representative runtime DML denials complement the complete privilege matrix.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000002',true);
select throws_ok($$insert into form_fields(form_template_id,field_name,field_type) values ('55000000-0000-0000-0000-000000000001','denied','text')$$,'42501',null,'authenticated INSERT is denied at runtime');
select throws_ok($$update notification_templates set is_active=false where id='81000000-0000-0000-0000-000000000001'$$,'42501',null,'authenticated UPDATE is denied at runtime');
select throws_ok($$delete from export_logs where id='91000000-0000-0000-0000-000000000002'$$,'42501',null,'authenticated DELETE is denied at runtime');
reset role;

select * from finish();
rollback;
