begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select has_trigger('public', table_name, trigger_name, table_name || ' publishes durable refresh signals')
from (values
  ('leave_requests','tenant_realtime_leave_requests'),
  ('fms_starter_assignments','tenant_realtime_fms_starters'),
  ('export_logs','tenant_realtime_exports'),
  ('notification_templates','tenant_realtime_notification_templates'),
  ('notification_rules','tenant_realtime_notification_rules'),
  ('designation_daily_checklists','tenant_realtime_daily_checklist_definitions'),
  ('daily_checklist_acknowledgements','tenant_realtime_daily_checklist_acknowledgements')
) expected(table_name,trigger_name);

insert into tenants(id,name,slug) values
('19710000-0000-4000-8000-000000000001','Refresh signals A','refresh-signals-a'),
('19710000-0000-4000-8000-000000000002','Refresh signals B','refresh-signals-b');
insert into branches(id,tenant_id,name,code) values
('19720000-0000-4000-8000-000000000001','19710000-0000-4000-8000-000000000001','Refresh A','RA'),
('19720000-0000-4000-8000-000000000002','19710000-0000-4000-8000-000000000001','Refresh A other','RA2'),
('19720000-0000-4000-8000-000000000003','19710000-0000-4000-8000-000000000002','Refresh B','RB');
insert into departments(id,tenant_id,branch_id,name,code)
select ('19730000-0000-4000-8000-00000000000'||n)::uuid,
  ('19710000-0000-4000-8000-00000000000'||case when n=3 then 2 else 1 end)::uuid,
  ('19720000-0000-4000-8000-00000000000'||n)::uuid,'Refresh department '||n,'RD-'||n from generate_series(1,3) n;
insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
select ('19700000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','refresh-'||n||'@example.invalid','x',now(),now() from generate_series(1,5) n;
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
select ('19740000-0000-4000-8000-00000000000'||n)::uuid,('19700000-0000-4000-8000-00000000000'||n)::uuid,
  ('19710000-0000-4000-8000-00000000000'||case when n=5 then 2 else 1 end)::uuid,
  ('19720000-0000-4000-8000-00000000000'||case when n=5 then 3 when n=2 then 2 else 1 end)::uuid,
  ('19730000-0000-4000-8000-00000000000'||case when n=5 then 3 when n=2 then 2 else 1 end)::uuid,
  'Refresh person '||n,'REFRESH-'||n,'refresh-'||n||'@example.invalid',case when n=4 then 'super_admin' else 'staff' end::user_role,
  'active',(case when n=3 then 'suspended' else 'active' end)::user_account_status,false from generate_series(1,5) n;
update user_profiles set is_login_enabled=true where id <> '19740000-0000-4000-8000-000000000003';

delete from tenant_realtime_events where tenant_id in ('19710000-0000-4000-8000-000000000001','19710000-0000-4000-8000-000000000002');
insert into notification_templates(id,tenant_id,event_type,channel,title_template,body_template)
values('19760000-0000-4000-8000-000000000001','19710000-0000-4000-8000-000000000001','refresh_test','in_app','Test','Test');
select is((select count(*)::integer from tenant_realtime_events where tenant_id='19710000-0000-4000-8000-000000000001' and topic='settings'),1,'insert emits one settings wake-up');
update notification_templates set body_template='Changed' where id='19760000-0000-4000-8000-000000000001';
select is((select count(*)::integer from tenant_realtime_events where tenant_id='19710000-0000-4000-8000-000000000001' and topic='settings'),2,'update emits a settings wake-up');
delete from notification_templates where id='19760000-0000-4000-8000-000000000001';
select is((select count(*)::integer from tenant_realtime_events where tenant_id='19710000-0000-4000-8000-000000000001' and topic='settings'),3,'delete preserves a payload-free wake-up');

insert into leave_requests(id,tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path)
values('19770000-0000-4000-8000-000000000001','19710000-0000-4000-8000-000000000001','19740000-0000-4000-8000-000000000001','19720000-0000-4000-8000-000000000001','casual','FULL DAY','Synthetic test','2026-10-10','2026-10-10','2026-10-11','1ST HALF','Inform Adv',1,'synthetic-refresh-test');
select is((select count(*)::integer from tenant_realtime_events where tenant_id='19710000-0000-4000-8000-000000000001' and topic='organization'),1,'pending leave emits immediately without requiring approval');
update leave_requests set reason='Edited synthetic request' where id='19770000-0000-4000-8000-000000000001';
select is((select count(*)::integer from tenant_realtime_events where tenant_id='19710000-0000-4000-8000-000000000001' and topic='organization'),2,'pending leave edits emit immediately');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19700000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from tenant_realtime_events where tenant_id='19710000-0000-4000-8000-000000000001'),5,'ordinary active users receive own tenant wake-ups');
select ok(not has_function_privilege('authenticated','emit_tenant_realtime_event(uuid,text)','EXECUTE'),'clients cannot forge signals');
select set_config('request.jwt.claim.sub','19700000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from tenant_realtime_events where tenant_id='19710000-0000-4000-8000-000000000001'),5,'other branches receive payload-free tenant wake-ups');
select set_config('request.jwt.claim.sub','19700000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from tenant_realtime_events where tenant_id='19710000-0000-4000-8000-000000000001'),0,'inactive users receive no wake-ups');
select set_config('request.jwt.claim.sub','19700000-0000-4000-8000-000000000004',true);
select is((select count(*)::integer from tenant_realtime_events where tenant_id='19710000-0000-4000-8000-000000000001'),5,'privileged active users receive own tenant wake-ups');
select set_config('request.jwt.claim.sub','19700000-0000-4000-8000-000000000005',true);
select is((select count(*)::integer from tenant_realtime_events where tenant_id='19710000-0000-4000-8000-000000000001'),0,'foreign tenants receive no wake-ups');
reset role;
select table_privs_are('public','tenant_realtime_events','anon',array[]::text[],'unauthenticated clients retain no privileges');
select ok(not has_function_privilege('service_role','emit_tenant_realtime_event(uuid,text)','EXECUTE'),'service role retains no direct emitter grant');
select hasnt_column('public','tenant_realtime_events','payload','signals expose no business or private-file data');
select * from finish();
rollback;
