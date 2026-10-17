begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(16);

-- Fixture: one tenant, two branches; an admin, a staff doer, and a manager of
-- the other branch. The doer owns one of every kind of work.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('27000000-0000-4000-8000-000000000001','authenticated','authenticated','admin-270@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
('27000000-0000-4000-8000-000000000002','authenticated','authenticated','staff-270@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
('27000000-0000-4000-8000-000000000003','authenticated','authenticated','manager-270@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values
('27010000-0000-4000-8000-000000000001','Work 270','work-270'),
('27010000-0000-4000-8000-000000000002','Foreign 270','foreign-270');
insert into public.branches(id,tenant_id,name,code) values
('27020000-0000-4000-8000-000000000001','27010000-0000-4000-8000-000000000001','Main 270','M270'),
('27020000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000001','Other 270','O270');
insert into public.departments(id,tenant_id,branch_id,name,code) values
('27030000-0000-4000-8000-000000000001','27010000-0000-4000-8000-000000000001','27020000-0000-4000-8000-000000000001','Sales 270','S270'),
('27030000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000001','27020000-0000-4000-8000-000000000002','Other sales 270','X270');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled) values
('27040000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001','27010000-0000-4000-8000-000000000001','27020000-0000-4000-8000-000000000001','27030000-0000-4000-8000-000000000001','Admin 270','0000002701','admin-270@example.invalid','W270-1','admin','active','active',true),
('27040000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000001','27020000-0000-4000-8000-000000000001','27030000-0000-4000-8000-000000000001','Staff 270','0000002702','staff-270@example.invalid','W270-2','staff','active','active',true),
('27040000-0000-4000-8000-000000000003','27000000-0000-4000-8000-000000000003','27010000-0000-4000-8000-000000000001','27020000-0000-4000-8000-000000000002','27030000-0000-4000-8000-000000000002','Manager 270','0000002703','manager-270@example.invalid','W270-3','manager','active','active',true);

-- Tasks-section work: one-time, recurring occurrence, CRM walk-in.
insert into public.task_templates(id,tenant_id,title,task_type,is_active,default_assignee_user_id,created_by)
values('27050000-0000-4000-8000-000000000001','27010000-0000-4000-8000-000000000001','Daily count 270','checklist',false,'27040000-0000-4000-8000-000000000002','27040000-0000-4000-8000-000000000001');
insert into public.task_instances(id,tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,task_template_id,source,created_by) values
('27060000-0000-4000-8000-000000000001','27010000-0000-4000-8000-000000000001','27020000-0000-4000-8000-000000000001','27030000-0000-4000-8000-000000000001','delegation','One-time 270','pending',now(),null,'manual','27040000-0000-4000-8000-000000000001'),
('27060000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000001','27020000-0000-4000-8000-000000000001','27030000-0000-4000-8000-000000000001','checklist','Daily count 270','pending',now(),'27050000-0000-4000-8000-000000000001','manual','27040000-0000-4000-8000-000000000001'),
('27060000-0000-4000-8000-000000000003','27010000-0000-4000-8000-000000000001','27020000-0000-4000-8000-000000000001','27030000-0000-4000-8000-000000000001','delegation','Complete walk-in form - Client 270','pending',now(),null,'crm_walkin','27040000-0000-4000-8000-000000000001');
insert into public.task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
select id,'27040000-0000-4000-8000-000000000002','doer',true,true from public.task_instances where tenant_id='27010000-0000-4000-8000-000000000001';

-- FMS work: an open step dated 40 days ago (outside the default range), a
-- finished step from the same day (must stay hidden), and a pending start form.
insert into public.fms_flows(id,tenant_id,name,status,is_active,created_by)
values('27070000-0000-4000-8000-000000000001','27010000-0000-4000-8000-000000000001','Repair flow 270','draft',true,'27040000-0000-4000-8000-000000000001');
insert into public.fms_stages(id,fms_flow_id,name,sort_order) values
('27080000-0000-4000-8000-000000000001','27070000-0000-4000-8000-000000000001','Inspect piece 270',1),
('27080000-0000-4000-8000-000000000002','27070000-0000-4000-8000-000000000001','Log intake 270',0);
update public.fms_flows set status='published' where id='27070000-0000-4000-8000-000000000001';
insert into public.fms_instances(id,tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,started_by)
select '27090000-0000-4000-8000-000000000001','27010000-0000-4000-8000-000000000001','27020000-0000-4000-8000-000000000001','27030000-0000-4000-8000-000000000001',f.id,f.family_id,f.version,'FMS-270-1','Repair flow 270 run','active','27040000-0000-4000-8000-000000000001'
from public.fms_flows f where f.id='27070000-0000-4000-8000-000000000001';
insert into public.fms_instance_stages(id,fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at,actual_datetime) values
('270a0000-0000-4000-8000-000000000001','27090000-0000-4000-8000-000000000001','27080000-0000-4000-8000-000000000001','pending',array['27040000-0000-4000-8000-000000000002']::uuid[],now()-interval '40 days',now()-interval '40 days',null),
('270a0000-0000-4000-8000-000000000002','27090000-0000-4000-8000-000000000001','27080000-0000-4000-8000-000000000002','completed',array['27040000-0000-4000-8000-000000000002']::uuid[],now()-interval '40 days',now()-interval '40 days',now()-interval '40 days');
insert into public.form_templates(id,tenant_id,name)
values('270b0000-0000-4000-8000-000000000001','27010000-0000-4000-8000-000000000001','Repair intake 270');
insert into public.fms_starter_assignments(id,tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,status,assigned_by)
values('270c0000-0000-4000-8000-000000000001','27010000-0000-4000-8000-000000000001','27070000-0000-4000-8000-000000000001','27080000-0000-4000-8000-000000000002','270b0000-0000-4000-8000-000000000001','27040000-0000-4000-8000-000000000002','pending','27040000-0000-4000-8000-000000000001');

-- A foreign tenant's FMS step for the same flow shape must never appear.
insert into public.fms_flows(id,tenant_id,name,status,is_active,created_by)
values('27070000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000002','Foreign flow 270','draft',true,'27040000-0000-4000-8000-000000000001');
insert into public.fms_stages(id,fms_flow_id,name,sort_order)
values('27080000-0000-4000-8000-000000000003','27070000-0000-4000-8000-000000000002','Foreign step 270',0);
update public.fms_flows set status='published' where id='27070000-0000-4000-8000-000000000002';
insert into public.fms_instances(id,tenant_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,started_by)
select '27090000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000002',f.id,f.family_id,f.version,'FMS-270-F','Foreign run','active','27040000-0000-4000-8000-000000000001'
from public.fms_flows f where f.id='27070000-0000-4000-8000-000000000002';
insert into public.fms_instance_stages(id,fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at)
values('270a0000-0000-4000-8000-000000000003','27090000-0000-4000-8000-000000000002','27080000-0000-4000-8000-000000000003','pending',array['27040000-0000-4000-8000-000000000002']::uuid[],now(),now());

create temp table snap(label text primary key,body jsonb);
grant all on snap to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000001',true);

insert into snap select 'all',get_task_evidence_workspace(jsonb_build_object('user_profile_id','27040000-0000-4000-8000-000000000002','page_size',100));
insert into snap select 'fms',get_task_evidence_workspace(jsonb_build_object('user_profile_id','27040000-0000-4000-8000-000000000002','kind','fms'));

select is((select (body->'kind_counts'->>'fms')::int from snap where label='all'),2,'the open FMS step and the pending start form are both in scope');
select is((select (body->'kind_counts'->>'one_time')::int from snap where label='all'),1,'one-time work is counted on its own');
select is((select (body->'kind_counts'->>'recurring')::int from snap where label='all'),1,'a template occurrence is recurring work');
select is((select (body->'kind_counts'->>'crm')::int from snap where label='all'),1,'a CRM walk-in task is CRM work');
select is((select (body->>'tasks_total')::int from snap where label='all'),5,'the employee list holds every kind of work');
select ok(exists(select 1 from snap, jsonb_array_elements(body->'tasks') r where label='all' and r->>'task_id'='270a0000-0000-4000-8000-000000000001' and r->>'work_kind'='fms_step' and r->>'task_title'='Inspect piece 270' and r->>'work_context'='Repair flow 270 · FMS-270-1' and (r->>'overdue')::boolean),'open FMS work outside the date range stays visible, named by step, flow and reference');
select ok(not exists(select 1 from snap, jsonb_array_elements(body->'tasks') r where label='all' and r->>'task_id'='270a0000-0000-4000-8000-000000000002'),'finished FMS work outside the date range follows the range');
select ok(exists(select 1 from snap, jsonb_array_elements(body->'tasks') r where label='all' and r->>'task_id'='270c0000-0000-4000-8000-000000000001' and r->>'work_kind'='fms_start' and r->>'work_context'='Start form · Repair intake 270'),'a pending FMS start form is listed as start work');
select ok(not exists(select 1 from snap, jsonb_array_elements(body->'tasks') r where label='all' and r->>'task_id'='270a0000-0000-4000-8000-000000000003'),'another tenant''s FMS work is never listed');
select is((select (body->'stats'->>'tasks_total')::int from snap where label='all'),3,'Overview stats still describe Tasks-section work only');
select ok((select bool_and(r->>'task_type'='fms') and count(*)=2 from snap, jsonb_array_elements(body->'tasks') r where label='fms'),'the FMS kind filter returns only FMS rows, all typed fms for bulk delete');
select ok(exists(select 1 from snap, jsonb_array_elements(body->'tasks') r where label='all' and r->>'task_id'='27060000-0000-4000-8000-000000000003' and r->>'work_context'='CRM walk-in'),'CRM work says where it came from');
select throws_ok($$select get_task_evidence_workspace('{"kind":"everything"}')$$,'22023','Task kind is invalid','the kind filter is validated against a fixed list');

select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000003',true);
select is((get_task_evidence_workspace('{"kind":"fms"}')->>'tasks_total')::int,0,'a manager of another branch sees none of this branch''s FMS work');
select throws_ok($$select get_task_evidence_workspace('{"branch_id":"27020000-0000-4000-8000-000000000001"}')$$,'42501','Branch is not authorized','a manager still cannot widen scope');

select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000002',true);
select throws_ok($$select get_task_evidence_workspace('{}')$$,'42501','Task evidence workspace access denied','ordinary staff cannot read the workspace');

select * from finish();
rollback;
