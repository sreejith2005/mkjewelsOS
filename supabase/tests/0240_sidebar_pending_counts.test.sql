begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','get_my_sidebar_counts',array[]::text[],'sidebar counts are an authenticated server contract');
select has_function('public','mark_my_leave_updates_read',array['uuid[]','uuid[]'],'Availability can acknowledge only its own leave updates');
select ok(not has_function_privilege('anon','get_my_sidebar_counts()','EXECUTE'),'anonymous cannot call counts');
select ok(not has_function_privilege('service_role','get_my_sidebar_counts()','EXECUTE'),'jobs cannot impersonate personal counts');
select ok(not has_function_privilege('anon','mark_my_leave_updates_read(uuid[],uuid[])','EXECUTE'),'anonymous cannot acknowledge updates');
select ok(not has_function_privilege('anon','get_my_leave_update_ids()','EXECUTE'),'anonymous cannot snapshot leave updates');
select ok(not has_function_privilege('authenticated','notify_leave_status_update()','EXECUTE'),'notification trigger is internal only');
create temp table sidebar_fixture(name text primary key,id uuid);
grant all on sidebar_fixture to authenticated;
do $$
declare t uuid; b uuid; d uuid; u uuid; a uuid; f uuid; flow uuid; stage uuid; i uuid; task uuid; template uuid; foreign_tenant uuid; fb uuid; fd uuid;
begin
  insert into tenants(name,slug) values('Sidebar test','sidebar-237') returning id into t;
  insert into sidebar_fixture values('tenant',t);
  insert into branches(tenant_id,name,code) values(t,'Sidebar branch','SB237') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sidebar department','SD237') returning id into d;
  for n in 1..4 loop
    insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'authenticated','authenticated','sidebar-'||n||'@example.invalid','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,email,employee_code,user_role,working_status,account_status,is_login_enabled)
      values(t,a,b,d,'Sidebar '||n,'sidebar-'||n||'@example.invalid','SB237-'||n,
        case when n=2 then 'admin' when n=3 then 'hr' else 'staff' end::user_role,'active','active',n<>4) returning id into u;
    insert into sidebar_fixture values('auth'||n,a),('user'||n,u);
  end loop;
  insert into tenants(name,slug) values('Sidebar foreign','sidebar-237-foreign') returning id into foreign_tenant;
  insert into branches(tenant_id,name,code) values(foreign_tenant,'Foreign branch','SBF237') returning id into fb;
  insert into departments(tenant_id,branch_id,name,code) values(foreign_tenant,fb,'Foreign department','SDF237') returning id into fd;
  insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
    values(gen_random_uuid(),'authenticated','authenticated','sidebar-foreign@example.invalid','x',now(),now()) returning id into a;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,email,employee_code,user_role,working_status,account_status,is_login_enabled)
    values(foreign_tenant,a,fb,fd,'Sidebar foreign','sidebar-foreign@example.invalid','SB237-FOREIGN','staff','active','active',true) returning id into u;
  insert into sidebar_fixture values('foreign_auth',a),('foreign_user',u);
  select id into u from sidebar_fixture where name='user1';
  insert into user_permission_overrides(tenant_id,user_profile_id,permission_key,effect)
    values(t,u,'recurring_todo.view','grant');
  insert into form_templates(tenant_id,name,created_by) values(t,'Sidebar form',u) returning id into f;
  insert into sidebar_fixture values('form',f);
  insert into task_templates(tenant_id,branch_id,department_id,title,task_type,recurrence_rule,created_by,default_assignee_user_id)
    values(t,b,d,'Sidebar recurrence','checklist','FREQ=DAILY',u,u) returning id into template;
  insert into sidebar_fixture values('template',template);
  for n in 1..123 loop
    insert into task_instances(tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by,requires_form,form_template_id)
      values(t,b,d,'delegation','Sidebar task '||n,'pending',now()+interval '60 days',
        (select id from sidebar_fixture where name='user2'),n=1,case when n=1 then f end) returning id into task;
    insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_active,is_original) values(task,u,'doer',true,true);
    if n=1 then insert into sidebar_fixture values('task',task); end if;
  end loop;
  insert into task_instances(tenant_id,branch_id,department_id,task_template_id,task_type,title,status,planned_datetime,created_by)
    values(t,b,d,template,'checklist','Sidebar recurring task','pending',now()+interval '60 days',u) returning id into task;
  insert into sidebar_fixture values('recurring',task);
  insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_active,is_original) values(task,u,'doer',true,true);
  insert into task_instances(tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by)
    values(t,b,d,'checklist','Other doer','pending',now(),u) returning id into task;
  insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_active,is_original)
    values(task,(select id from sidebar_fixture where name='user2'),'doer',true,true);
  insert into fms_flows(tenant_id,name,created_by) values(t,'Sidebar flow',u) returning id into flow;
  insert into fms_stages(fms_flow_id,name,sort_order,step_type,form_template_id,allow_multiple_doers,completion_rule)
    values(flow,'Sidebar form stage',1,'form',f,true,'all_doers') returning id into stage;
  insert into fms_instances(tenant_id,fms_flow_id,reference_number,title,started_by,status)
    values(t,flow,'SB237','Sidebar runtime',u,'overdue') returning id into i;
  insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime)
    values(i,stage,'in_progress',array[u],null) returning id into task;
  insert into sidebar_fixture values('stage',task);
  insert into fms_starter_assignments(tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,status)
    values(t,flow,stage,f,u,'pending') returning id into task;
  insert into sidebar_fixture values('starter',task);
  insert into leave_requests(tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path)
    values(t,u,b,'casual','FULL DAY','Sidebar leave',current_date,current_date,current_date+1,'1ST HALF','Not inform In Adv',1,
      t||'/'||u||'/tl/'||gen_random_uuid()||'.png') returning id into task;
  insert into sidebar_fixture values('leave',task);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select id::text from sidebar_fixture where name='auth1'),true);
select is((get_my_sidebar_counts()->>'checklist_tasks')::integer,126,'exact personal Tasks count includes recurrence, starter and runtime beyond page/date limits');
select is((get_my_sidebar_counts()->>'delegation_tasks')::integer,123,'one-time subset is personal and unbounded');
select is((get_my_sidebar_counts()->>'recurring_todo')::integer,1,'recurring count uses own pending occurrence');
select is((get_my_sidebar_counts()->>'fms_builder')::integer,2,'deadline-less and overdue FMS count with own starter');
select is((get_my_sidebar_counts()->>'forms_library')::integer,3,'forms counts assignments rather than reusable template');
select is((get_my_sidebar_counts()->>'availability')::integer,0,'pending own application is not unread update or review action');
reset role;
insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,status,completed_at)
  select (select id from sidebar_fixture where name='tenant'),(select id from sidebar_fixture where name='stage'),
    (select id from sidebar_fixture where name='user1'),'completed',now();
insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,status)
  select (select id from sidebar_fixture where name='tenant'),(select id from sidebar_fixture where name='stage'),
    (select id from sidebar_fixture where name='user2'),'assigned';
set local role authenticated;
select is((get_my_sidebar_counts()->>'fms_builder')::integer,1,'completed own contribution does not count while another doer remains pending');
reset role;
update fms_instance_stage_assignees set status='assigned',completed_at=null where fms_instance_stage_id=(select id from sidebar_fixture where name='stage') and user_profile_id=(select id from sidebar_fixture where name='user1');
insert into task_instances(tenant_id,branch_id,department_id,task_type,title,status,planned_datetime,created_by,verifier_user_profile_id,verification_status)
  select tenant_id,branch_id,department_id,'checklist','Sidebar verify only','completed',now(),id,
    (select id from sidebar_fixture where name='user1'),'pending' from user_profiles where id=(select id from sidebar_fixture where name='user2');
set local role authenticated;
select is((get_my_sidebar_counts()->>'checklist_tasks')::integer,127,'personal verifier-only pending action counts once in Tasks');
reset role;
update task_instances set verification_status='verified' where title='Sidebar verify only' and tenant_id=(select id from sidebar_fixture where name='tenant');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from sidebar_fixture where name='auth2'),true);
select is((get_my_sidebar_counts()->>'checklist_tasks')::integer,1,'admin counts own work rather than tenant/created scope');
select set_config('request.jwt.claim.sub',(select id::text from sidebar_fixture where name='auth3'),true);
select is((get_my_sidebar_counts()->>'availability')::integer,1,'leave reviewer sees actionable pending request');
select set_config('request.jwt.claim.sub',(select id::text from sidebar_fixture where name='auth4'),true);
select throws_ok($$select get_my_sidebar_counts()$$,'42501','Sidebar counts access denied','inactive profile cannot inspect counts');
select set_config('request.jwt.claim.sub',(select id::text from sidebar_fixture where name='foreign_auth'),true);
select is(coalesce((get_my_sidebar_counts()->>'checklist_tasks')::integer,0),0,'another tenant cannot see pending assignments');
reset role;
update leave_requests set status='approved',reviewed_at=now(),reviewed_by=(select id from sidebar_fixture where name='user3')
  where id=(select id from sidebar_fixture where name='leave');
select is((select count(*)::integer from notifications where source_record_id=(select id from sidebar_fixture where name='leave') and event_type='leave_status_updated'),1,'status update emits one durable notification');
insert into sidebar_fixture select 'leave_notification',id from notifications where source_record_id=(select id from sidebar_fixture where name='leave') and event_type='leave_status_updated';
select ok(exists(select 1 from audit_logs where record_id=(select id from sidebar_fixture where name='leave') and action='leave_status_notification_created'),'notification creation is audited');
update leave_requests set hr_remark='Same status' where id=(select id from sidebar_fixture where name='leave');
select is((select count(*)::integer from notifications where source_record_id=(select id from sidebar_fixture where name='leave') and event_type='leave_status_updated'),1,'unchanged status does not duplicate notification');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from sidebar_fixture where name='foreign_auth'),true);
select throws_ok($$select mark_notification_read((select id from sidebar_fixture where name='leave_notification'))$$,'42501','Notification is not owned by the current user','cross-tenant read cannot clear another user history');
select is(cardinality(get_my_leave_update_ids()),0,'cross-tenant snapshot exposes no leave update IDs');
select is(mark_my_leave_updates_read(array[(select id from sidebar_fixture where name='leave_notification')],array[(select id from sidebar_fixture where name='leave')]),0,'cross-tenant acknowledgement cannot clear supplied foreign IDs');
select set_config('request.jwt.claim.sub',(select id::text from sidebar_fixture where name='auth1'),true);
select is((get_my_sidebar_counts()->>'availability')::integer,1,'applicant sees unread approval');
select lives_ok($$select mark_notification_read((select id from notifications where event_type='leave_status_updated' and source_record_id=(select id from sidebar_fixture where name='leave')))$$,'existing read RPC clears owned update');
select is((get_my_sidebar_counts()->>'availability')::integer,0,'read approval clears availability count');
select ok(exists(select 1 from notifications where event_type='leave_status_updated' and source_record_id=(select id from sidebar_fixture where name='leave') and is_read and read_at is not null),'notification history retained after read');
reset role;
update notifications set is_read=false,read_at=null where id=(select id from sidebar_fixture where name='leave_notification');
update leave_requests set status='rejected' where id=(select id from sidebar_fixture where name='leave');
update leave_requests set status='approved' where id=(select id from sidebar_fixture where name='leave');
insert into tenant_section_controls(tenant_id,section_availability) values((select id from sidebar_fixture where name='tenant'),'{"notifications":false}')
  on conflict(tenant_id) do update set section_availability=excluded.section_availability;
set local role authenticated;
select is(cardinality(get_my_leave_update_ids()),3,'Availability snapshots its own unread IDs with Notifications disabled');
select is(mark_my_leave_updates_read(array[(select id from sidebar_fixture where name='leave_notification')],'{}'::uuid[]),0,'unrendered leave rows cannot be acknowledged');
select is(mark_my_leave_updates_read(array[(select id from sidebar_fixture where name='leave_notification')],array[(select id from sidebar_fixture where name='leave')]),1,'Availability acknowledges owned leave update with Notifications disabled');
select is(mark_my_leave_updates_read(array[(select id from sidebar_fixture where name='leave_notification')],array[(select id from sidebar_fixture where name='leave')]),0,'acknowledgement is idempotent');
select is((get_my_sidebar_counts()->>'availability')::integer,2,'notifications arriving after the captured snapshot remain unread even when status returns to same value');
select is(mark_my_leave_updates_read(get_my_leave_update_ids(),array[(select id from sidebar_fixture where name='leave')]),2,'a fresh rendered snapshot can acknowledge later transitions');
select is((get_my_sidebar_counts()->>'availability')::integer,0,'Availability count clears through its read contract');
select set_config('request.jwt.claim.sub',(select id::text from sidebar_fixture where name='auth4'),true);
select throws_ok($$select mark_my_leave_updates_read(array[(select id from sidebar_fixture where name='leave_notification')],array[(select id from sidebar_fixture where name='leave')])$$,'42501','Leave update acknowledgement denied','inactive user cannot acknowledge leave updates');
select set_config('request.jwt.claim.sub',(select id::text from sidebar_fixture where name='auth1'),true);
reset role;
select ok(exists(select 1 from audit_logs where actor_user_id=(select id from sidebar_fixture where name='user1') and action='leave_updates_read'),'Availability acknowledgement is audited');
select ok(exists(select 1 from notifications where user_profile_id=(select id from sidebar_fixture where name='user1') and source_module='tasks' and not is_read),'Availability acknowledgement preserves unrelated unread assignments');
insert into user_permission_overrides(tenant_id,user_profile_id,permission_key,effect)
  select (select id from sidebar_fixture where name='tenant'),(select id from sidebar_fixture where name='user1'),key,'deny'
  from permission_catalog where key in ('tasks.view','fms.view','forms.view','availability.view');
set local role authenticated;
select ok(not (get_my_sidebar_counts() ? 'checklist_tasks'),'individual denial hides task count at server');
select ok(not (get_my_sidebar_counts() ? 'forms_library'),'individual denial hides forms count at server');
select throws_ok($$select mark_my_leave_updates_read(array[(select id from sidebar_fixture where name='leave_notification')],array[(select id from sidebar_fixture where name='leave')])$$,'42501','Section access denied','denied Availability cannot acknowledge updates');
reset role;
delete from user_permission_overrides where user_profile_id=(select id from sidebar_fixture where name='user1');
update task_assignees set completed_at=now() where task_instance_id=(select id from sidebar_fixture where name='task');
update fms_starter_assignments set status='completed',completed_at=now() where id=(select id from sidebar_fixture where name='starter');
update fms_instance_stages set status='completed',actual_datetime=now() where id=(select id from sidebar_fixture where name='stage');
set local role authenticated;
select is((get_my_sidebar_counts()->>'checklist_tasks')::integer,123,'completed contribution and completed FMS no longer count');
select is((get_my_sidebar_counts()->>'forms_library')::integer,0,'completed form work no longer counts');
reset role;
insert into tenant_section_controls(tenant_id,section_availability) values((select id from sidebar_fixture where name='tenant'),'{"checklist_tasks":false,"fms_builder":false,"forms_library":false,"availability":false,"notifications":false}')
  on conflict(tenant_id) do update set section_availability=excluded.section_availability;
set local role authenticated;
select ok(not (get_my_sidebar_counts() ? 'checklist_tasks'),'disabled task module emits no count');
select ok(not (get_my_sidebar_counts() ? 'fms_builder'),'disabled workflow module emits no count');
select ok(not (get_my_sidebar_counts() ? 'availability'),'disabled availability emits no count');
select throws_ok($$select mark_my_leave_updates_read(array[(select id from sidebar_fixture where name='leave_notification')],array[(select id from sidebar_fixture where name='leave')])$$,'42501','This section is currently unavailable','disabled Availability cannot acknowledge updates');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select get_my_sidebar_counts()$$,'42501','Sidebar counts access denied','unbound authenticated session is denied');
select * from finish();
rollback;
