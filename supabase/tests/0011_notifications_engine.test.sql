begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select auth_id,'authenticated','authenticated',email,crypt('synthetic-test-value',gen_salt('bf')),now(),'{}','{}',now(),now() from (values
 ('ab110000-0000-0000-0000-000000000001'::uuid,'notif-admin@example.invalid'),
 ('ab110000-0000-0000-0000-000000000002'::uuid,'notif-manager@example.invalid'),
 ('ab110000-0000-0000-0000-000000000003'::uuid,'notif-staff@example.invalid'),
 ('ab110000-0000-0000-0000-000000000004'::uuid,'notif-doer@example.invalid'),
 ('ab110000-0000-0000-0000-000000000005'::uuid,'notif-inactive@example.invalid'),
 ('ab110000-0000-0000-0000-000000000006'::uuid,'notif-other@example.invalid'),
 ('ab110000-0000-0000-0000-000000000007'::uuid,'notif-super@example.invalid'),
 ('ab110000-0000-0000-0000-000000000008'::uuid,'notif-hr@example.invalid'),
 ('ab110000-0000-0000-0000-000000000009'::uuid,'notif-crm@example.invalid'),
 ('ab110000-0000-0000-0000-000000000010'::uuid,'notif-house@example.invalid')) x(auth_id,email);

insert into tenants(id,name,slug) values
 ('1b110000-0000-0000-0000-000000000001','Notification Tenant A','notification-a'),
 ('1b110000-0000-0000-0000-000000000002','Notification Tenant B','notification-b');
insert into branches(id,tenant_id,name,code) values
 ('2b110000-0000-0000-0000-000000000001','1b110000-0000-0000-0000-000000000001','Notification Branch A','NA'),
 ('2b110000-0000-0000-0000-000000000002','1b110000-0000-0000-0000-000000000002','Notification Branch B','NB');
insert into departments(id,tenant_id,branch_id,name,code) values
 ('3b110000-0000-0000-0000-000000000001','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','Notification Department A','NDA'),
 ('3b110000-0000-0000-0000-000000000002','1b110000-0000-0000-0000-000000000002','2b110000-0000-0000-0000-000000000002','Notification Department B','NDB');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
select pid,aid,tid,bid,did,label,mobile,email,code,role::user_role,status::working_status,enabled from (values
 ('4b110000-0000-0000-0000-000000000001'::uuid,'ab110000-0000-0000-0000-000000000001'::uuid,'1b110000-0000-0000-0000-000000000001'::uuid,'2b110000-0000-0000-0000-000000000001'::uuid,'3b110000-0000-0000-0000-000000000001'::uuid,'Notification Admin','0000000001','notif-admin@example.invalid','NOT-1','admin','active',true),
 ('4b110000-0000-0000-0000-000000000002','ab110000-0000-0000-0000-000000000002','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','Notification Manager','0000000002','notif-manager@example.invalid','NOT-2','manager','active',true),
 ('4b110000-0000-0000-0000-000000000003','ab110000-0000-0000-0000-000000000003','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','Notification Staff','0000000003','notif-staff@example.invalid','NOT-3','staff','active',true),
 ('4b110000-0000-0000-0000-000000000004','ab110000-0000-0000-0000-000000000004','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','Notification Doer','0000000004','notif-doer@example.invalid','NOT-4','doer','active',true),
 ('4b110000-0000-0000-0000-000000000005','ab110000-0000-0000-0000-000000000005','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','Notification Inactive','0000000005','notif-inactive@example.invalid','NOT-5','staff','inactive',false),
 ('4b110000-0000-0000-0000-000000000006','ab110000-0000-0000-0000-000000000006','1b110000-0000-0000-0000-000000000002','2b110000-0000-0000-0000-000000000002','3b110000-0000-0000-0000-000000000002','Other Tenant Staff','0000000006','notif-other@example.invalid','NOT-6','staff','active',true),
 ('4b110000-0000-0000-0000-000000000007','ab110000-0000-0000-0000-000000000007','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','Notification Super','0000000007','notif-super@example.invalid','NOT-7','super_admin','active',true),
 ('4b110000-0000-0000-0000-000000000008','ab110000-0000-0000-0000-000000000008','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','Notification HR','0000000008','notif-hr@example.invalid','NOT-8','hr','active',true),
 ('4b110000-0000-0000-0000-000000000009','ab110000-0000-0000-0000-000000000009','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','Notification CRM','0000000009','notif-crm@example.invalid','NOT-9','crm','active',true),
 ('4b110000-0000-0000-0000-000000000010','ab110000-0000-0000-0000-000000000010','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','Notification House','0000000010','notif-house@example.invalid','NOT-10','housekeeping','active',true)
) x(pid,aid,tid,bid,did,label,mobile,email,code,role,status,enabled);
update branches set manager_id='4b110000-0000-0000-0000-000000000002' where id='2b110000-0000-0000-0000-000000000001';
update departments set head_id='4b110000-0000-0000-0000-000000000002' where id='3b110000-0000-0000-0000-000000000001';

select has_table('public','notification_events','canonical event table exists');
select has_table('public','notification_deliveries','delivery outbox exists');
select has_table('public','notification_provider_configuration','provider availability table exists');
select has_column('public','notification_templates','lifecycle','template lifecycle exists');
select has_column('public','notification_rules','recipient_rules','recipient rules exist');
select has_column('public','notification_rules','channel_templates','channel template mapping exists');
select has_column('public','notification_deliveries','lease_expires_at','delivery lease exists');
select has_column('public','notification_logs','error_category','safe error category exists');
select has_index('public','notifications','idx_notifications_tenant_recipient_unread','unread index is tenant leading');
select has_index('public','notification_deliveries','idx_notification_deliveries_tenant_claim','claim index is tenant leading');
select has_index('public','notification_events','notification_events_tenant_id_idempotency_key_key','event idempotency is unique');

select function_owner_is('public','save_notification_template',array['uuid','text','text','text','text','text','text','boolean'],'postgres','template save owner is postgres');
select function_owner_is('public','claim_notification_deliveries',array['integer','uuid','integer'],'postgres','claim owner is postgres');
select is((select prosecdef from pg_proc where oid='save_notification_rule(uuid,text,text,jsonb,jsonb,jsonb,integer,integer,integer,integer,task_priority,boolean)'::regprocedure),true,'rule save is security definer');
select is((select proconfig from pg_proc where oid='mark_notification_read(uuid,boolean)'::regprocedure),array['search_path=public']::text[],'mark one pins search path');
select ok(has_function_privilege('authenticated','save_notification_template(uuid,text,text,text,text,text,text,boolean)','EXECUTE'),'authenticated may execute template RPC');
select ok(has_function_privilege('authenticated','mark_notification_read(uuid,boolean)','EXECUTE'),'authenticated may execute own-read RPC');
select ok(has_function_privilege('service_role','claim_notification_deliveries(integer,uuid,integer)','EXECUTE'),'service role may claim outbox');
select ok(not has_function_privilege('authenticated','claim_notification_deliveries(integer,uuid,integer)','EXECUTE'),'ordinary users cannot claim outbox');
select ok(not has_function_privilege('authenticated','enqueue_notification_event(uuid,uuid,uuid,text,text,uuid,uuid,jsonb,text,timestamptz)','EXECUTE'),'ordinary users cannot emit events');
select ok(not has_table_privilege('authenticated','notifications','INSERT,UPDATE,DELETE'),'direct inbox writes are denied');
select ok(not has_table_privilege('authenticated','notification_templates','INSERT,UPDATE,DELETE'),'direct template writes are denied');
select ok(not has_table_privilege('authenticated','notification_rules','INSERT,UPDATE,DELETE'),'direct rule writes are denied');
select ok(not has_table_privilege('authenticated','notification_deliveries','SELECT,INSERT,UPDATE,DELETE'),'raw deliveries are backend only');
select ok(not has_table_privilege('authenticated','notification_logs','SELECT,INSERT,UPDATE,DELETE'),'raw attempts are backend only');
select ok(not has_table_privilege('anon','notifications','SELECT,INSERT,UPDATE,DELETE'),'anon has no inbox access');

-- Administrator mutations, ordinary-user denial, validation, and audits.
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000001',true);
select lives_ok($$select save_notification_template(null,'Custom task assigned','task_assigned','in_app','Assigned: {{task_title}}','{{assignee_name}} has a {{priority}} task.', '/tasks/checklist',true)$$,'admin saves allowlisted template');
select throws_ok($$select save_notification_template(null,'Unsafe','task_assigned','in_app','{{client_phone}}','Body','https://external.invalid',true)$$,'22023',null,'unknown variables and external links are rejected');
select lives_ok($$select save_notification_rule(null,'Custom task rule','task_assigned','[{"field":"priority","operator":"equals","value":"high"}]','[{"type":"assigned_users"},{"type":"assigned_users"}]',jsonb_build_object('in_app',(select id from notification_templates where name='Custom task assigned')),5,30,3,5,'high',true)$$,'admin saves validated rule');
select is((select count(*)::int from audit_logs where module in ('notification_templates','notification_rules') and actor_user_id='4b110000-0000-0000-0000-000000000001'),2,'admin template and rule mutations are audited');
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000002',true);
select throws_ok($$select save_notification_template(null,'Denied','system_alert','in_app','Alert','{{alert_message}}',null,true)$$,'42501',null,'manager cannot administer templates');
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000003',true);
select throws_ok($$select save_notification_rule(null,'Denied','system_alert','[]','[{"type":"actor"}]','{}')$$,'42501',null,'ordinary user cannot administer rules');
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000005',true);
select throws_ok($$select mark_all_notifications_read()$$,'42501',null,'inactive profile is denied notification RPCs');
reset role;

-- Inbox ownership and RLS for all active role families.
insert into notifications(id,tenant_id,user_profile_id,event_type,title,message,priority,delivered_status) values
 ('8b110000-0000-0000-0000-000000000001','1b110000-0000-0000-0000-000000000001','4b110000-0000-0000-0000-000000000001','system_alert','Admin','Synthetic','medium','delivered'),
 ('8b110000-0000-0000-0000-000000000002','1b110000-0000-0000-0000-000000000001','4b110000-0000-0000-0000-000000000002','system_alert','Manager','Synthetic','medium','delivered'),
 ('8b110000-0000-0000-0000-000000000003','1b110000-0000-0000-0000-000000000001','4b110000-0000-0000-0000-000000000003','system_alert','Staff','Synthetic','medium','delivered'),
 ('8b110000-0000-0000-0000-000000000004','1b110000-0000-0000-0000-000000000001','4b110000-0000-0000-0000-000000000004','system_alert','Doer','Synthetic','medium','delivered'),
 ('8b110000-0000-0000-0000-000000000005','1b110000-0000-0000-0000-000000000001','4b110000-0000-0000-0000-000000000007','system_alert','Super','Synthetic','medium','delivered'),
 ('8b110000-0000-0000-0000-000000000006','1b110000-0000-0000-0000-000000000001','4b110000-0000-0000-0000-000000000008','system_alert','HR','Synthetic','medium','delivered'),
 ('8b110000-0000-0000-0000-000000000007','1b110000-0000-0000-0000-000000000001','4b110000-0000-0000-0000-000000000009','system_alert','CRM','Synthetic','medium','delivered'),
 ('8b110000-0000-0000-0000-000000000008','1b110000-0000-0000-0000-000000000001','4b110000-0000-0000-0000-000000000010','system_alert','House','Synthetic','medium','delivered'),
 ('8b110000-0000-0000-0000-000000000009','1b110000-0000-0000-0000-000000000002','4b110000-0000-0000-0000-000000000006','system_alert','Other','Synthetic','medium','delivered');

set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000001',true); select is((select count(*)::int from notifications),1,'admin reads only own inbox');
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000002',true); select is((select count(*)::int from notifications),1,'manager reads only own inbox');
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000003',true); select is((select count(*)::int from notifications),1,'staff reads only own inbox');
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000004',true); select is((select count(*)::int from notifications),1,'doer reads only own inbox');
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000007',true); select is((select count(*)::int from notifications),1,'super admin reads only own inbox');
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000008',true); select is((select count(*)::int from notifications),1,'HR reads only own inbox');
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000009',true); select is((select count(*)::int from notifications),1,'CRM reads only own inbox');
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000010',true); select is((select count(*)::int from notifications),1,'housekeeping reads only own inbox');
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000006',true); select is((select count(*)::int from notifications),1,'cross tenant user sees no tenant A inbox row');
select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000003',true);
select lives_ok($$select mark_notification_read('8b110000-0000-0000-0000-000000000003',true)$$,'user marks own notification read');
select throws_ok($$select mark_notification_read('8b110000-0000-0000-0000-000000000002',true)$$,'42501',null,'user cannot mark another inbox row');
select lives_ok($$select mark_notification_read('8b110000-0000-0000-0000-000000000003',false)$$,'user marks own notification unread');
select is(mark_all_notifications_read(),1,'mark all affects only current unread rows');
reset role;

-- Event idempotency, conditions, recipient deduplication, delay and cooldown.
select lives_ok($$select enqueue_notification_event('1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','task_assigned','tasks','9b110000-0000-0000-0000-000000000001',null,'{"actor_name":"System","assignee_name":"Notification Staff","task_title":"Synthetic high task","planned_datetime":"2026-08-10T12:00:00Z","priority":"high","_assigned_user_ids":["4b110000-0000-0000-0000-000000000003"],"_task_creator_id":"4b110000-0000-0000-0000-000000000001","_link_url":"/tasks/checklist"}','task_assigned:synthetic:1',now())$$,'canonical event is accepted');
select lives_ok($$select enqueue_notification_event('1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','task_assigned','tasks','9b110000-0000-0000-0000-000000000001',null,'{"task_title":"Replay"}','task_assigned:synthetic:1',now())$$,'event replay is idempotent');
select is((select count(*)::int from notification_events where idempotency_key='task_assigned:synthetic:1'),1,'event idempotency key prevents duplicates');
select lives_ok($$select process_notification_events(50)$$,'pending events are processed');
select is((select count(*)::int from notification_deliveries d join notification_rules r on r.id=d.rule_id where d.event_id=(select id from notification_events where idempotency_key='task_assigned:synthetic:1') and r.name='Custom task rule'),1,'duplicate recipient rules resolve to one delivery');
select is((select state from notification_deliveries d join notification_rules r on r.id=d.rule_id where d.event_id=(select id from notification_events where idempotency_key='task_assigned:synthetic:1') and r.name='Custom task rule'),'scheduled','configured delay creates scheduled delivery');
select ok((select scheduled_at>e.occurred_at from notification_deliveries d join notification_events e on e.id=d.event_id join notification_rules r on r.id=d.rule_id where e.idempotency_key='task_assigned:synthetic:1' and r.name='Custom task rule'),'scheduled delivery preserves delay');

-- Claiming, concurrent exclusion, lease recovery, success, blocked config,
-- retry/backoff, terminal failure, and privacy-safe attempts.
update notification_deliveries set state='scheduled',scheduled_at=now()+interval '1 day',next_attempt_at=now()+interval '1 day' where state in ('pending','scheduled','retry_wait');
update notification_deliveries set state='pending',scheduled_at=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute' where rule_id=(select id from notification_rules where name='Custom task rule');
select is((select count(*)::int from claim_notification_deliveries(1,'cb110000-0000-0000-0000-000000000001',5)),1,'first worker claims one eligible delivery');
select is((select count(*)::int from claim_notification_deliveries(1,'cb110000-0000-0000-0000-000000000002',5)),0,'second worker cannot concurrently claim leased delivery');
update notification_deliveries set lease_expires_at=now()-interval '1 minute' where worker_id='cb110000-0000-0000-0000-000000000001';
select is((select count(*)::int from claim_notification_deliveries(1,'cb110000-0000-0000-0000-000000000002',5)),1,'expired lease is recoverable');
select lives_ok($$select finish_notification_delivery((select id from notification_deliveries where worker_id='cb110000-0000-0000-0000-000000000002' limit 1),'delivered','jewelos_in_app',null,false)$$,'in-app adapter completion succeeds');
select is((select count(*)::int from notifications where delivery_id is not null),1,'in-app completion creates one inbox row');
update notification_deliveries set state='pending',scheduled_at=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute' where id=(select id from notification_deliveries where state='scheduled' limit 1);
select lives_ok($$select finish_notification_delivery((select id from claim_notification_deliveries(1,'cb110000-0000-0000-0000-000000000003',5) limit 1),'blocked_configuration','email_unavailable','provider_not_configured',false)$$,'unavailable channel outcome is recorded without fake success');
select is((select count(*)::int from notification_deliveries where state='blocked_configuration'),1,'configuration failure is explicit');
select ok(not exists(select 1 from notification_logs where provider_response is not null),'attempt logs contain no raw provider response');
select ok(not exists(select 1 from notification_logs where provider_identifier ~ '@|\+?[0-9]{8,}'),'attempt logs contain no contact identifiers');

-- Create a retry fixture by reusing an eligible delivery and the worker RPC.
update notification_deliveries set state='pending',attempt_count=0,max_attempts=2,next_attempt_at=now()-interval '1 minute',scheduled_at=now()-interval '1 minute' where state='blocked_configuration';
select lives_ok($$select finish_notification_delivery((select id from claim_notification_deliveries(1,'cb110000-0000-0000-0000-000000000004',5) limit 1),'failed','test_adapter','temporary_failure',true)$$,'retryable failure is accepted');
select is((select state from notification_deliveries where error_category='temporary_failure'),'retry_wait','retryable failure enters retry wait');
select ok((select next_attempt_at>updated_at from notification_deliveries where error_category='temporary_failure'),'exponential backoff schedules a future attempt');
update notification_deliveries set next_attempt_at=now()-interval '1 minute' where error_category='temporary_failure';
select lives_ok($$select finish_notification_delivery((select id from claim_notification_deliveries(1,'cb110000-0000-0000-0000-000000000005',5) limit 1),'failed','test_adapter','terminal_failure',true)$$,'final retry is completed');
select is((select state from notification_deliveries where error_category='terminal_failure'),'failed_terminal','max attempts produces terminal failure');

set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','ab110000-0000-0000-0000-000000000001',true);
select lives_ok($$select retry_notification_delivery((select delivery_id from list_notification_delivery_logs('failed_terminal') limit 1))$$,'admin manually retries eligible delivery');
select is((select count(*)::int from audit_logs where action='notification_delivery_manual_retry'),1,'manual retry is audited');
select is((select count(*)::int from get_notification_provider_availability() where channel='in_app' and is_available),1,'in-app provider is available');
select is((select count(*)::int from get_notification_provider_availability() where channel<>'in_app' and not is_available),4,'external providers are explicitly unavailable');
select ok((select bool_and(recipient_label like 'Employee ••••%') from list_notification_delivery_logs()),'admin delivery log recipients are redacted');
reset role;

-- Task assignment/completion integration and overdue idempotency.
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,priority,status,planned_datetime,created_by,source)
values('9b110000-0000-0000-0000-000000000010','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','delegation','Notification integration task','high','pending',now()-interval '1 hour','4b110000-0000-0000-0000-000000000001','manual');
insert into task_assignees(id,task_instance_id,user_profile_id,role_at_task,is_original,is_active) values('9c110000-0000-0000-0000-000000000010','9b110000-0000-0000-0000-000000000010','4b110000-0000-0000-0000-000000000003','doer',true,true);
select is((select count(*)::int from notification_events where source_record_id='9b110000-0000-0000-0000-000000000010' and event_type='task_assigned'),1,'task assignment emits canonical event transactionally');
update task_instances set status='completed',actual_datetime=now(),updated_by='4b110000-0000-0000-0000-000000000003' where id='9b110000-0000-0000-0000-000000000010';
select is((select count(*)::int from notification_events where source_record_id='9b110000-0000-0000-0000-000000000010' and event_type='task_completed'),1,'task completion emits canonical event transactionally');
update task_instances set status='pending',actual_datetime=null where id='9b110000-0000-0000-0000-000000000010';
select lives_ok($$select detect_scheduled_notification_events(100,now())$$,'scheduled detector finds overdue tasks');
select lives_ok($$select detect_scheduled_notification_events(100,now())$$,'scheduled detector replay is safe');
select is((select count(*)::int from notification_events where source_record_id='9b110000-0000-0000-0000-000000000010' and event_type='task_overdue'),1,'overdue task occurrence is idempotent');

-- Forms submission/review integration.
insert into form_templates(id,tenant_id,name,description,version,lifecycle,created_by,is_active,permissions)
values('9d110000-0000-0000-0000-000000000001','1b110000-0000-0000-0000-000000000001','Notification form','Synthetic',1,'published','4b110000-0000-0000-0000-000000000001',true,'{"roles":["staff"]}');
insert into form_submissions(id,tenant_id,branch_id,department_id,form_template_id,data,submitted_by,status)
values('9e110000-0000-0000-0000-000000000001','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','9d110000-0000-0000-0000-000000000001','{}','4b110000-0000-0000-0000-000000000003','submitted');
select is((select count(*)::int from notification_events where source_record_id='9e110000-0000-0000-0000-000000000001' and event_type='form_submitted'),1,'form submission emits canonical event');
update form_submissions set status='approved',reviewed_by='4b110000-0000-0000-0000-000000000001',reviewed_at=now() where id='9e110000-0000-0000-0000-000000000001';
select is((select count(*)::int from notification_events where source_record_id='9e110000-0000-0000-0000-000000000001' and event_type='form_approved'),1,'form review emits canonical event');

-- FMS stage assignment/completion and SLA integration.
insert into fms_flows(id,tenant_id,branch_id,department_id,name,status,is_active,version,created_by,family_id,scope_type)
values('9f110000-0000-0000-0000-000000000001','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','Notification flow','draft',true,1,'4b110000-0000-0000-0000-000000000001','9f110000-0000-0000-0000-000000000010','department');
insert into fms_stages(id,fms_flow_id,stage_key,name,step_type,sort_order,completion_rule) values('9f110000-0000-0000-0000-000000000002','9f110000-0000-0000-0000-000000000001','notify','Notification stage','task',0,'any_doer');
insert into fms_instances(id,tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,priority,started_by)
values('9f110000-0000-0000-0000-000000000003','1b110000-0000-0000-0000-000000000001','2b110000-0000-0000-0000-000000000001','3b110000-0000-0000-0000-000000000001','9f110000-0000-0000-0000-000000000001','9f110000-0000-0000-0000-000000000010',1,'FMS-NOT-1','Notification run','active','high','4b110000-0000-0000-0000-000000000003');
insert into fms_instance_stages(id,fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at)
values('9f110000-0000-0000-0000-000000000004','9f110000-0000-0000-0000-000000000003','9f110000-0000-0000-0000-000000000002','in_progress',array['4b110000-0000-0000-0000-000000000004'::uuid],now()-interval '1 hour',now()-interval '2 hours');
select is((select count(*)::int from notification_events where source_record_id='9f110000-0000-0000-0000-000000000004' and event_type='fms_stage_assigned'),1,'FMS stage activation emits canonical assignment');
select lives_ok($$select detect_scheduled_notification_events(100,now())$$,'scheduled detector finds FMS SLA breach');
select lives_ok($$select detect_scheduled_notification_events(100,now())$$,'FMS SLA detector replay is safe');
select is((select count(*)::int from notification_events where source_record_id='9f110000-0000-0000-0000-000000000004' and event_type='fms_sla_breached'),1,'FMS SLA occurrence is idempotent');
update fms_instance_stages set status='completed',actual_datetime=now(),completed_by='4b110000-0000-0000-0000-000000000004',outcome='done' where id='9f110000-0000-0000-0000-000000000004';
select is((select count(*)::int from notification_events where source_record_id='9f110000-0000-0000-0000-000000000004' and event_type='fms_stage_completed'),1,'FMS stage completion emits canonical event');

select * from finish();
rollback;
