begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Synthetic-only identities and work. Assertions compare counts; no payloads are printed.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select aid,'authenticated','authenticated',email,crypt('synthetic-test-value',gen_salt('bf')),now(),'{}','{}',now(),now() from (values
 ('a3820000-0000-0000-0000-000000000001'::uuid,'perf-super@example.invalid'),
 ('a3820000-0000-0000-0000-000000000002'::uuid,'perf-manager@example.invalid'),
 ('a3820000-0000-0000-0000-000000000003'::uuid,'perf-staff-one@example.invalid'),
 ('a3820000-0000-0000-0000-000000000004'::uuid,'perf-staff-two@example.invalid'),
 ('a3820000-0000-0000-0000-000000000005'::uuid,'perf-inactive@example.invalid'),
 ('a3820000-0000-0000-0000-000000000006'::uuid,'perf-other-tenant@example.invalid')
) x(aid,email);
insert into tenants(id,name,slug,timezone) values
 ('13820000-0000-0000-0000-000000000001','Synthetic Performance Tenant','perf-test','Asia/Kolkata'),
 ('13820000-0000-0000-0000-000000000002','Synthetic Other Tenant','perf-other','Asia/Kolkata');
insert into branches(id,tenant_id,name,code) values
 ('23820000-0000-0000-0000-000000000001','13820000-0000-0000-0000-000000000001','Perf Branch One','PB1'),
 ('23820000-0000-0000-0000-000000000002','13820000-0000-0000-0000-000000000001','Perf Branch Two','PB2'),
 ('23820000-0000-0000-0000-000000000003','13820000-0000-0000-0000-000000000002','Other Branch','OB1');
insert into departments(id,tenant_id,branch_id,name,code) values
 ('33820000-0000-0000-0000-000000000001','13820000-0000-0000-0000-000000000001',null,'Perf Sales','PD1'),
 ('33820000-0000-0000-0000-000000000002','13820000-0000-0000-0000-000000000002',null,'Other Sales','OD1');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
select pid,aid,tid,bid,did,label,mobile,email,code,role::user_role,status::working_status,enabled from (values
 ('43820000-0000-0000-0000-000000000001'::uuid,'a3820000-0000-0000-0000-000000000001'::uuid,'13820000-0000-0000-0000-000000000001'::uuid,'23820000-0000-0000-0000-000000000001'::uuid,'33820000-0000-0000-0000-000000000001'::uuid,'Perf Super','9000038201','perf-super@example.invalid','PF-1','super_admin','active',true),
 ('43820000-0000-0000-0000-000000000002','a3820000-0000-0000-0000-000000000002','13820000-0000-0000-0000-000000000001','23820000-0000-0000-0000-000000000001','33820000-0000-0000-0000-000000000001','Perf Manager','9000038202','perf-manager@example.invalid','PF-2','manager','active',true),
 ('43820000-0000-0000-0000-000000000003','a3820000-0000-0000-0000-000000000003','13820000-0000-0000-0000-000000000001','23820000-0000-0000-0000-000000000001','33820000-0000-0000-0000-000000000001','Perf Staff One','9000038203','perf-staff-one@example.invalid','PF-3','staff','active',true),
 ('43820000-0000-0000-0000-000000000004','a3820000-0000-0000-0000-000000000004','13820000-0000-0000-0000-000000000001','23820000-0000-0000-0000-000000000002','33820000-0000-0000-0000-000000000001','Perf Staff Two','9000038204','perf-staff-two@example.invalid','PF-4','staff','active',true),
 ('43820000-0000-0000-0000-000000000005','a3820000-0000-0000-0000-000000000005','13820000-0000-0000-0000-000000000001','23820000-0000-0000-0000-000000000001','33820000-0000-0000-0000-000000000001','Perf Inactive','9000038205','perf-inactive@example.invalid','PF-5','admin','inactive',false),
 ('43820000-0000-0000-0000-000000000006','a3820000-0000-0000-0000-000000000006','13820000-0000-0000-0000-000000000002','23820000-0000-0000-0000-000000000003','33820000-0000-0000-0000-000000000002','Other Staff','9000038206','perf-other-tenant@example.invalid','PF-6','staff','active',true)
) x(pid,aid,tid,bid,did,label,mobile,email,code,role,status,enabled);

-- Period = yesterday .. tomorrow in India time. y = yesterday 00:00 IST.
create temporary table perf_day as select (date_trunc('day',now() at time zone 'Asia/Kolkata')-interval '1 day') at time zone 'Asia/Kolkata' as y;
create temporary table perf_ctx as select jsonb_build_object('from',((select y from perf_day) at time zone 'Asia/Kolkata')::date,
  'to',((select y from perf_day) at time zone 'Asia/Kolkata')::date+2) as c;
grant select on perf_day,perf_ctx to authenticated;

-- Tasks. Staff One (S1) and Staff Two (S2).
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,priority,status,planned_datetime,revised_datetime,actual_datetime,created_by,source,deleted_at)
select tid::uuid,tenant::uuid,'23820000-0000-0000-0000-000000000001','33820000-0000-0000-0000-000000000001','checklist',title,'medium',status::task_status,
  planned,revised,actual,'43820000-0000-0000-0000-000000000001',src,deleted
from (select y from perf_day) d cross join lateral (values
 -- t1 first-half deadline (15:00 IST) completed exactly on the deadline: on time.
 ('53820000-0000-0000-0000-000000000001','13820000-0000-0000-0000-000000000001','t1 on time at 15:00','completed',d.y+interval '15 hours',null::timestamptz,d.y+interval '15 hours','manual',null::timestamptz),
 -- t2 second-half deadline (21:00 IST) completed one minute late.
 ('53820000-0000-0000-0000-000000000002','13820000-0000-0000-0000-000000000001','t2 late after 21:00','completed',d.y+interval '21 hours',null,d.y+interval '21 hours 1 minute','manual',null),
 -- t3 due exactly at the first instant of the period, still open: overdue, inside the cohort.
 ('53820000-0000-0000-0000-000000000003','13820000-0000-0000-0000-000000000001','t3 overdue at period start','pending',d.y,null,null,'manual',null),
 ('53820000-0000-0000-0000-000000000004','13820000-0000-0000-0000-000000000001','t4 pending later','pending',now()+interval '1 hour',null,null,'manual',null),
 ('53820000-0000-0000-0000-000000000005','13820000-0000-0000-0000-000000000001','t5 in progress later','in_progress',now()+interval '2 hours',null,null,'manual',null),
 ('53820000-0000-0000-0000-000000000006','13820000-0000-0000-0000-000000000001','t6 rejected','rejected',d.y+interval '10 hours',null,null,'manual',null),
 -- t7 completed but no completion time was recorded: completed, never on time.
 ('53820000-0000-0000-0000-000000000007','13820000-0000-0000-0000-000000000001','t7 completed without a time','completed',d.y+interval '13 hours',null,null,'manual',null),
 ('53820000-0000-0000-0000-000000000008','13820000-0000-0000-0000-000000000001','t8 shared on time','completed',d.y+interval '12 hours',null,d.y+interval '11 hours','manual',null),
 -- t9 / t15 open and due before the period: current backlog, never in the cohort.
 ('53820000-0000-0000-0000-000000000009','13820000-0000-0000-0000-000000000001','t9 old backlog','pending',d.y-interval '10 days',null,null,'manual',null),
 ('53820000-0000-0000-0000-000000000015','13820000-0000-0000-0000-000000000001','t15 one minute before the period','pending',d.y-interval '1 minute',null,null,'manual',null),
 -- t10 planned long ago, revised into the period: the effective deadline decides.
 ('53820000-0000-0000-0000-000000000010','13820000-0000-0000-0000-000000000001','t10 revised into period','pending',d.y-interval '10 days',now()+interval '3 hours',null,'manual',null),
 ('53820000-0000-0000-0000-000000000011','13820000-0000-0000-0000-000000000001','t11 deleted','pending',d.y+interval '9 hours',null,null,'manual',null),
 ('53820000-0000-0000-0000-000000000014','13820000-0000-0000-0000-000000000001','t14 crm client task','pending',d.y+interval '9 hours',null,null,'crm',null),
 ('53820000-0000-0000-0000-000000000016','13820000-0000-0000-0000-000000000002','t16 other tenant','pending',d.y+interval '9 hours',null,null,'manual',null)
) x(tid,tenant,title,status,planned,revised,actual,src,deleted);
update task_instances set branch_id='23820000-0000-0000-0000-000000000003',department_id='33820000-0000-0000-0000-000000000002' where id='53820000-0000-0000-0000-000000000016';
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values
 ('53820000-0000-0000-0000-000000000001','43820000-0000-0000-0000-000000000003','doer',true,true),
 ('53820000-0000-0000-0000-000000000001','43820000-0000-0000-0000-000000000004','doer',false,false), -- reassigned away: not S2's
 ('53820000-0000-0000-0000-000000000002','43820000-0000-0000-0000-000000000003','doer',true,true),
 ('53820000-0000-0000-0000-000000000003','43820000-0000-0000-0000-000000000003','doer',true,true),
 ('53820000-0000-0000-0000-000000000004','43820000-0000-0000-0000-000000000003','doer',true,true),
 ('53820000-0000-0000-0000-000000000005','43820000-0000-0000-0000-000000000003','doer',true,true),
 ('53820000-0000-0000-0000-000000000006','43820000-0000-0000-0000-000000000003','doer',true,true),
 ('53820000-0000-0000-0000-000000000007','43820000-0000-0000-0000-000000000003','doer',true,true),
 ('53820000-0000-0000-0000-000000000008','43820000-0000-0000-0000-000000000003','doer',true,true),
 ('53820000-0000-0000-0000-000000000008','43820000-0000-0000-0000-000000000004','doer',true,true),
 ('53820000-0000-0000-0000-000000000009','43820000-0000-0000-0000-000000000003','doer',true,true),
 ('53820000-0000-0000-0000-000000000015','43820000-0000-0000-0000-000000000003','doer',true,true),
 ('53820000-0000-0000-0000-000000000010','43820000-0000-0000-0000-000000000003','doer',true,true),
 ('53820000-0000-0000-0000-000000000011','43820000-0000-0000-0000-000000000003','doer',true,true),
 ('53820000-0000-0000-0000-000000000014','43820000-0000-0000-0000-000000000004','doer',true,true),
 ('53820000-0000-0000-0000-000000000016','43820000-0000-0000-0000-000000000006','doer',true,true);

update task_instances set deleted_at=now() where id='53820000-0000-0000-0000-000000000011';

-- FMS: one workflow family with a form step, a task step, a notification and an End node.
insert into fms_flows(id,tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by)
values('63820000-0000-0000-0000-000000000001','13820000-0000-0000-0000-000000000001','63820000-0000-0000-0000-0000000000ff',1,'Perf Order FMS','tenant','draft',true,
  '43820000-0000-0000-0000-000000000001','43820000-0000-0000-0000-000000000001'),
 ('63820000-0000-0000-0000-000000000002','13820000-0000-0000-0000-000000000001','63820000-0000-0000-0000-0000000000fe',1,'Perf Idle FMS','tenant','draft',true,
  '43820000-0000-0000-0000-000000000001','43820000-0000-0000-0000-000000000001');
insert into fms_stages(id,fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values
 ('73820000-0000-0000-0000-000000000001','63820000-0000-0000-0000-000000000001','enquiry','Enquiry form','form',0,true,'{}'),
 ('73820000-0000-0000-0000-000000000002','63820000-0000-0000-0000-000000000001','call','Call customer','task',1,true,'{}'),
 ('73820000-0000-0000-0000-000000000003','63820000-0000-0000-0000-000000000001','notify','Notify','notification',2,true,'{}'),
 ('73820000-0000-0000-0000-000000000004','63820000-0000-0000-0000-000000000001','done','Won','end',3,true,'{}');
update fms_flows set status='published' where id in ('63820000-0000-0000-0000-000000000001','63820000-0000-0000-0000-000000000002');
insert into fms_instances(id,tenant_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,started_by,status,branch_id)
values('83820000-0000-0000-0000-000000000001','13820000-0000-0000-0000-000000000001','63820000-0000-0000-0000-000000000001','63820000-0000-0000-0000-0000000000ff',1,'PERF-1','Synthetic run','43820000-0000-0000-0000-000000000001','active','23820000-0000-0000-0000-000000000001'),
 ('83820000-0000-0000-0000-000000000002','13820000-0000-0000-0000-000000000001','63820000-0000-0000-0000-000000000001','63820000-0000-0000-0000-0000000000ff',1,'PERF-2','Synthetic cancelled run','43820000-0000-0000-0000-000000000001','cancelled','23820000-0000-0000-0000-000000000001'),
 ('83820000-0000-0000-0000-000000000003','13820000-0000-0000-0000-000000000001','63820000-0000-0000-0000-000000000001','63820000-0000-0000-0000-0000000000ff',1,'PERF-3','Synthetic skipped run','43820000-0000-0000-0000-000000000001','active','23820000-0000-0000-0000-000000000001');
alter table fms_instance_stages disable trigger user;
insert into fms_instance_stages(id,fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,actual_datetime,activated_at,visit_number,outcome)
select vid::uuid,iid::uuid,sid::uuid,status::task_status,who,planned,actual,act,vn,outcome from (select y from perf_day) d cross join lateral (values
 -- v1 S1 form step, late by an hour.
 ('93820000-0000-0000-0000-000000000001','83820000-0000-0000-0000-000000000001','73820000-0000-0000-0000-000000000001','completed',array['43820000-0000-0000-0000-000000000003'::uuid],d.y+interval '10 hours',d.y+interval '11 hours',d.y+interval '8 hours',1,null::text),
 -- v2 shared S1+S2 task step, open past its deadline.
 ('93820000-0000-0000-0000-000000000002','83820000-0000-0000-0000-000000000001','73820000-0000-0000-0000-000000000002','pending',array['43820000-0000-0000-0000-000000000003'::uuid,'43820000-0000-0000-0000-000000000004'::uuid],d.y+interval '10 hours',null,d.y+interval '9 hours',1,null),
 -- v3 a visit of the same stage in another run, skipped by a condition.
 ('93820000-0000-0000-0000-000000000003','83820000-0000-0000-0000-000000000003','73820000-0000-0000-0000-000000000002','pending',array['43820000-0000-0000-0000-000000000003'::uuid],d.y+interval '12 hours',null,d.y+interval '11 hours',1,'condition_skipped'),
 -- v4 End node and v6 notification: never work, even with a name on them.
 ('93820000-0000-0000-0000-000000000004','83820000-0000-0000-0000-000000000001','73820000-0000-0000-0000-000000000004','completed',array['43820000-0000-0000-0000-000000000003'::uuid],d.y+interval '12 hours',d.y+interval '12 hours',d.y+interval '12 hours',1,null),
 ('93820000-0000-0000-0000-000000000006','83820000-0000-0000-0000-000000000001','73820000-0000-0000-0000-000000000003','completed',array['43820000-0000-0000-0000-000000000003'::uuid],d.y+interval '12 hours',d.y+interval '12 hours',d.y+interval '12 hours',1,null),
 -- v5 open step of a cancelled run: excluded.
 ('93820000-0000-0000-0000-000000000005','83820000-0000-0000-0000-000000000002','73820000-0000-0000-0000-000000000002','pending',array['43820000-0000-0000-0000-000000000004'::uuid],d.y+interval '10 hours',null,d.y+interval '9 hours',1,null)
) x(vid,iid,sid,status,who,planned,actual,act,vn,outcome);
alter table fms_instance_stages enable trigger user;
insert into form_templates(id,tenant_id,name,version,lifecycle,is_active,created_by,updated_by)
values('a3820000-0000-0000-0000-0000000000f1','13820000-0000-0000-0000-000000000001','Perf start form',1,'published',true,'43820000-0000-0000-0000-000000000001','43820000-0000-0000-0000-000000000001');
insert into fms_starter_assignments(tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,status)
values('13820000-0000-0000-0000-000000000001','63820000-0000-0000-0000-000000000001','73820000-0000-0000-0000-000000000001','a3820000-0000-0000-0000-0000000000f1','43820000-0000-0000-0000-000000000003','pending');

-- ------------------------------------------------------------------ contract and grants
select is((select prosecdef from pg_proc where oid='public.get_task_performance_dashboard_v1(jsonb)'::regprocedure),true,'dashboard performance RPC is security definer');
select ok(not has_function_privilege('anon','get_task_performance_dashboard_v1(jsonb)','EXECUTE'),'anon cannot read performance');
select ok(not has_function_privilege('anon','get_task_performance_records_v1(jsonb,text,text,integer,integer)','EXECUTE'),'anon cannot read performance records');
select ok(not has_function_privilege('authenticated','performance_work_rows_v1(uuid,timestamptz,timestamptz,uuid,uuid,uuid,uuid,text,boolean)','EXECUTE'),'clients cannot call the raw row source');
select ok(not has_function_privilege('authenticated','task_performance_context_v1(jsonb)','EXECUTE'),'clients cannot call the scope helper');
select ok(not has_function_privilege('service_role','performance_work_rows_v1(uuid,timestamptz,timestamptz,uuid,uuid,uuid,uuid,text,boolean)','EXECUTE'),'not even service_role calls the raw row source directly');
select is((select l.lanname||'/'||p.prosecdef::text from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='performance_work_rows_v1(uuid,timestamptz,timestamptz,uuid,uuid,uuid,uuid,text,boolean)'::regprocedure),'sql/false','row source is an inlinable SQL function, reached only through the authorizing readers');
select ok(position('assert_module_access(''dashboard'')' in pg_get_functiondef('public.task_performance_context_v1(jsonb)'::regprocedure))>0,'performance reads keep the Dashboard section gate');
select is((select default_roles::text from permission_catalog where key='dashboard.view_team_performance'),'{super_admin,admin}','team performance defaults to Super Admin and Admin only');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);

-- ------------------------------------------------------------------ Staff One: personal
select set_config('request.jwt.claim.sub','a3820000-0000-0000-0000-000000000003',true);
create temporary table s1 as select get_task_performance_dashboard_v1((select c from perf_ctx)) p;
select is((select (p->'summary'->>'assigned')::int from s1),10,'S1 assigned: tasks and FMS person steps due in the period');
select is((select (p->'summary'->>'on_time')::int from s1),2,'S1 on time (deadline instant counts as on time)');
select is((select (p->'summary'->>'late')::int from s1),2,'S1 late: one task, one FMS step');
select is((select (p->'summary'->>'pending')::int from s1),2,'S1 pending not overdue, including revised-into-period work');
select is((select (p->'summary'->>'in_progress')::int from s1),1,'S1 in progress from the recorded status');
select is((select (p->'summary'->>'overdue')::int from s1),2,'S1 overdue in the cohort');
select is((select (p->'summary'->>'excluded_rejected')::int from s1),1,'S1 rejected task is excluded and reported');
select is((select (p->'summary'->>'excluded_skipped')::int from s1),1,'S1 skipped FMS visit is excluded and reported');
select is((select (p->'summary'->>'completed_untimed')::int+(p->'summary'->>'on_time')::int+(p->'summary'->>'late')::int
  +(p->'summary'->>'pending')::int+(p->'summary'->>'in_progress')::int+(p->'summary'->>'overdue')::int from s1),
  (select (p->'summary'->>'assigned')::int from s1),'buckets reconcile exactly to the total');
select is((select (p->'backlog'->>'overdue_before_period')::int from s1),2,'open work due before the period is backlog, not cohort');
select is((select (p->>'pendingStartForms')::int from s1),1,'standing start forms are reported beside the score');
select is((select jsonb_array_length(p->'employees') from s1),1,'personal scope lists only the caller');
select is((select p->>'canTeam' from s1),'false','staff has no team permission');
select is((select jsonb_array_length(p->'flows') from s1),1,'personal FMS table lists only workflows with own work');
select throws_ok($$select get_task_performance_dashboard_v1((select c from perf_ctx)||'{"scope":"team"}')$$,'42501',null,'staff cannot open the team view');
select throws_ok($$select get_task_performance_dashboard_v1((select c from perf_ctx)||'{"user_profile_id":"43820000-0000-0000-0000-000000000004"}')$$,'42501',null,'staff cannot read a colleague through the user filter');
select throws_ok($$select get_task_performance_records_v1((select c from perf_ctx)||'{"scope":"team"}','overdue')$$,'42501',null,'staff cannot list team records');
select throws_ok($$select get_task_performance_records_v1((select c from perf_ctx),'everything')$$,'22023',null,'unknown record selector is rejected');
-- Count = list for every bucket.
select is((select (get_task_performance_records_v1((select c from perf_ctx),b,null,0,100)->>'total')::int),
  case b when 'assigned' then 10 when 'completed' then 5 when 'remaining' then 5 when 'backlog' then 2 when 'excluded' then 2
    else (select (p->'summary'->>b)::int from s1) end,'S1 '||b||' list total equals its count')
from unnest(array['assigned','completed','on_time','late','completed_untimed','remaining','pending','in_progress','overdue','excluded','backlog']) b;
select ok((select bool_and(r->>'person_id'='43820000-0000-0000-0000-000000000003') from jsonb_array_elements(get_task_performance_records_v1((select c from perf_ctx),'assigned',null,0,100)->'rows') r),'personal records hold only the caller''s work');
select ok((select bool_and(r->>'bucket'='overdue' and (r->>'overdue_minutes')::int>0) from jsonb_array_elements(get_task_performance_records_v1((select c from perf_ctx),'overdue',null,0,100)->'rows') r),'overdue list holds only overdue work with its age');
select ok((select bool_and(r->>'bucket'='late' and (r->>'delay_minutes')::int>=1) from jsonb_array_elements(get_task_performance_records_v1((select c from perf_ctx),'late',null,0,100)->'rows') r),'late list holds only late completions with their delay');
-- Source filter: FMS only.
select is((select (get_task_performance_dashboard_v1((select c from perf_ctx)||'{"kind":"fms"}')->'summary'->>'assigned')::int),2,'FMS source filter keeps only FMS person steps');
select is((select (get_task_performance_dashboard_v1((select c from perf_ctx)||'{"kind":"one_time"}')->'summary'->>'assigned')::int),8,'one-time source filter excludes FMS steps');

-- ------------------------------------------------------------------ Super Admin: company-wide
select set_config('request.jwt.claim.sub','a3820000-0000-0000-0000-000000000001',true);
create temporary table sa as select get_task_performance_dashboard_v1((select c from perf_ctx)||'{"scope":"team"}') p;
select is((select (p->'summary'->>'assigned')::int from sa),13,'company total = S1 10 + S2 3 assignments');
select is((select (p->'summary'->>'work_items')::int from sa),11,'shared work is one work item but one assignment per person');
select is((select (p->'summary'->>'excluded_cancelled_run')::int from sa),1,'open step of a cancelled run is excluded');
select is((select (e->>'assigned')::int from sa,jsonb_array_elements(p->'employees') e where e->>'user_profile_id'='43820000-0000-0000-0000-000000000004'),3,'S2: shared task, CRM walk-in and shared FMS step; reassigned-away task not counted');
select is((select (e->>'on_time')::int from sa,jsonb_array_elements(p->'employees') e where e->>'user_profile_id'='43820000-0000-0000-0000-000000000004'),1,'S2 on time');
select ok((select bool_and(e->>'user_profile_id'<>'43820000-0000-0000-0000-000000000006') from sa,jsonb_array_elements(p->'employees') e),'another tenant''s employee never appears');
select ok((select count(*)>=4 from sa,jsonb_array_elements(p->'employees') e),'every active employee is listed, with or without work');
select is((select (f->>'assigned')::int from sa,jsonb_array_elements(p->'flows') f where f->>'flow_id'='63820000-0000-0000-0000-0000000000ff'),3,'FMS table counts person-step assignments, not runs, End or notification nodes');
select is((select (f->>'visits')::int from sa,jsonb_array_elements(p->'flows') f where f->>'flow_id'='63820000-0000-0000-0000-0000000000ff'),2,'FMS table reports distinct stage visits');
select is((select (f->>'assigned')::int from sa,jsonb_array_elements(p->'flows') f where f->>'flow_id'='63820000-0000-0000-0000-0000000000fe'),0,'configured workflows with no work still appear');
select is((select sum((t->>'due')::int)::int from sa,jsonb_array_elements(p->'trend') t),13,'trend buckets add up to the cohort');
select is((select (get_task_performance_records_v1((select c from perf_ctx)||'{"scope":"team","user_profile_id":"43820000-0000-0000-0000-000000000004"}','overdue')->>'total')::int),2,'employee drilldown: S2 overdue list matches the S2 overdue count');
select is((select (get_task_performance_records_v1((select c from perf_ctx)||'{"scope":"team","flow_id":"63820000-0000-0000-0000-0000000000ff"}','assigned','call',0,25)->>'total')::int),2,'stage drilldown lists the stage''s assignments');
select is((select (s->>'assigned')::int from jsonb_array_elements(get_task_performance_fms_stages_v1((select c from perf_ctx)||'{"scope":"team","flow_id":"63820000-0000-0000-0000-0000000000ff"}')->'stages') s where s->>'stage_key'='call'),2,'stage table agrees with the stage drilldown');
select is((select (s->>'median_hours')::numeric from jsonb_array_elements(get_task_performance_fms_stages_v1((select c from perf_ctx)||'{"scope":"team","flow_id":"63820000-0000-0000-0000-0000000000ff"}')->'stages') s where s->>'stage_key'='enquiry'),3.0,'median completion runs from activation to completion');
select throws_ok($$select get_task_performance_dashboard_v1((select c from perf_ctx)||'{"scope":"team","user_profile_id":"43820000-0000-0000-0000-000000000006"}')$$,'42501',null,'cross-tenant employee filter is denied');
select throws_ok($$select get_task_performance_dashboard_v1('{"from":"2026-01-01","to":"2027-06-01"}')$$,'22023',null,'periods longer than 366 days are rejected');

-- ------------------------------------------------------------------ one contract: Task Control and Reports agree
select is((select jsonb_build_object('assigned',e->'assigned','completed',e->'completed','on_time_completed',e->'on_time_completed','remaining',e->'remaining','overdue',e->'overdue')
  from jsonb_array_elements(get_employee_task_progress((select c from perf_ctx))->'employees') e where e->>'user_profile_id'='43820000-0000-0000-0000-000000000003'),
  '{"assigned":10,"completed":5,"on_time_completed":2,"remaining":5,"overdue":2}'::jsonb,'Task Control progress equals the Dashboard for S1');
select is((select jsonb_build_object('assigned',r->'assigned','completed',r->'completed','on_time_completed',r->'on_time_completed','overdue',r->'overdue')
  from jsonb_array_elements(get_report_data('employee_task_performance',(select c from perf_ctx)||'{"preset":"custom","user_profile_id":"43820000-0000-0000-0000-000000000003"}')->'rows') r),
  '{"assigned":10,"completed":5,"on_time_completed":2,"overdue":2}'::jsonb,'Employee Task Performance report equals the Dashboard for S1');

-- ------------------------------------------------------------------ manager: explicit grant only
select set_config('request.jwt.claim.sub','a3820000-0000-0000-0000-000000000002',true);
select throws_ok($$select get_task_performance_dashboard_v1((select c from perf_ctx)||'{"scope":"team"}')$$,'42501',null,'manager role alone does not grant company-wide performance');
reset role;
insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) values
 ('43820000-0000-0000-0000-000000000002','13820000-0000-0000-0000-000000000001','dashboard.view_team_performance','grant');
set local role authenticated;
select is((select (get_task_performance_dashboard_v1((select c from perf_ctx)||'{"scope":"team"}')->'summary'->>'assigned')::int),13,'granted manager sees every branch');

-- ------------------------------------------------------------------ inactive
select set_config('request.jwt.claim.sub','a3820000-0000-0000-0000-000000000005',true);
select throws_ok($$select get_task_performance_dashboard_v1((select c from perf_ctx))$$,'42501',null,'inactive profile is denied');

select * from finish();
rollback;
