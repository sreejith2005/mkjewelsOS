begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(19);

select has_column('public','v_task_feed_scope','task_template_id','feed scope exposes the recurring template link');
select ok(exists(select 1 from unnest(coalesce((select reloptions from pg_class where oid='public.v_task_feed_scope'::regclass),'{}'::text[])) option where option like 'security_invoker=%'),'feed scope remains a security-invoker view');
select ok(not has_function_privilege('anon','public.add_task_comment_with_audit(uuid,text)','EXECUTE'),'anonymous callers cannot add remarks');
select ok(not has_function_privilege('anon','public.list_task_comments(uuid)','EXECUTE'),'anonymous callers cannot list remarks');
select ok(has_function_privilege('authenticated','public.add_task_comment_with_audit(uuid,text)','EXECUTE'),'authenticated callers can use the remark RPC');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('17000000-0000-4000-8000-000000000001','authenticated','authenticated','doer-170@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('17000000-0000-4000-8000-000000000002','authenticated','authenticated','watcher-170@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('17000000-0000-4000-8000-000000000003','authenticated','authenticated','outsider-170@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('17000000-0000-4000-8000-000000000004','authenticated','authenticated','other-tenant-170@example.invalid',crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.tenants(id,name,slug) values
 ('17010000-0000-4000-8000-000000000001','Loop 170 A','loop-170-a'),
 ('17010000-0000-4000-8000-000000000002','Loop 170 B','loop-170-b');
insert into public.branches(id,tenant_id,name,code) values
 ('17020000-0000-4000-8000-000000000001','17010000-0000-4000-8000-000000000001','Branch 170','B170'),
 ('17020000-0000-4000-8000-000000000002','17010000-0000-4000-8000-000000000002','Other Branch 170','O170');
insert into public.departments(id,tenant_id,branch_id,name,code) values
 ('17030000-0000-4000-8000-000000000001','17010000-0000-4000-8000-000000000001','17020000-0000-4000-8000-000000000001','Sales 170','S170'),
 ('17030000-0000-4000-8000-000000000002','17010000-0000-4000-8000-000000000001','17020000-0000-4000-8000-000000000001','Accounts 170','A170'),
 ('17030000-0000-4000-8000-000000000003','17010000-0000-4000-8000-000000000002','17020000-0000-4000-8000-000000000002','Other 170','X170');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled)
values
 ('17040000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','17010000-0000-4000-8000-000000000001','17020000-0000-4000-8000-000000000001','17030000-0000-4000-8000-000000000001','Doer 170','0000001701','doer-170@example.invalid','L170-1','staff','active','active',true),
 ('17040000-0000-4000-8000-000000000002','17000000-0000-4000-8000-000000000002','17010000-0000-4000-8000-000000000001','17020000-0000-4000-8000-000000000001','17030000-0000-4000-8000-000000000002','Watcher 170','0000001702','watcher-170@example.invalid','L170-2','staff','active','active',true),
 ('17040000-0000-4000-8000-000000000003','17000000-0000-4000-8000-000000000003','17010000-0000-4000-8000-000000000001','17020000-0000-4000-8000-000000000001','17030000-0000-4000-8000-000000000001','Outsider 170','0000001703','outsider-170@example.invalid','L170-3','staff','active','active',true),
 ('17040000-0000-4000-8000-000000000004','17000000-0000-4000-8000-000000000004','17010000-0000-4000-8000-000000000002','17020000-0000-4000-8000-000000000002','17030000-0000-4000-8000-000000000003','Other Tenant 170','0000001704','other-tenant-170@example.invalid','L170-4','staff','active','active',true);

-- A manual one-time task planned a week ahead, with a looped-in user from another department.
insert into public.task_instances(id,tenant_id,branch_id,department_id,task_type,title,priority,status,planned_datetime,source,created_by)
values ('17050000-0000-4000-8000-000000000001','17010000-0000-4000-8000-000000000001','17020000-0000-4000-8000-000000000001','17030000-0000-4000-8000-000000000001','delegation','Upcoming 170','medium','pending',now()+interval '7 days','manual','17040000-0000-4000-8000-000000000001');
insert into public.task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
values ('17050000-0000-4000-8000-000000000001','17040000-0000-4000-8000-000000000001','doer',true,true);
insert into public.task_watchers(tenant_id,task_instance_id,user_profile_id,created_by)
values ('17010000-0000-4000-8000-000000000001','17050000-0000-4000-8000-000000000001','17040000-0000-4000-8000-000000000002','17040000-0000-4000-8000-000000000001');

select ok(
  (select branch_id is null and department_id is null from notification_events where idempotency_key like 'task_watcher:assignment:%' and source_record_id='17050000-0000-4000-8000-000000000001'),
  'watcher event is addressed to the named watcher, not the task department');
select ok(
  '17040000-0000-4000-8000-000000000002'::uuid in (select user_profile_id from resolve_notification_recipients((select e from notification_events e where idempotency_key like 'task_watcher:assignment:%' and source_record_id='17050000-0000-4000-8000-000000000001'),'[{"type":"assigned_users"}]'::jsonb)),
  'a staff watcher from another department resolves as a notification recipient');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);

select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000001',true);
select is((select task_template_id from public.v_task_feed_scope where id='17050000-0000-4000-8000-000000000001'),null::uuid,'doer sees the upcoming one-time task in feed scope with no template');

select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000002',true);
select ok(exists(select 1 from public.task_watchers where task_instance_id='17050000-0000-4000-8000-000000000001'),'watcher can read their loop-in row');
select ok(exists(select 1 from public.v_all_tasks where id='17050000-0000-4000-8000-000000000001'),'watcher can hydrate the looped-in task');
select lives_ok($$select public.add_task_comment_with_audit('17050000-0000-4000-8000-000000000001','Please share the price range')$$,'looped-in user can add a remark');
select throws_ok($$select public.add_task_comment_with_audit('17050000-0000-4000-8000-000000000001','   ')$$,'22023',null,'blank remarks are rejected');

select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.add_task_comment_with_audit('17050000-0000-4000-8000-000000000001','Will do')$$,'doer can reply with a remark');
select is((select array_agg(author_name||': '||comment order by comment desc) from public.list_task_comments('17050000-0000-4000-8000-000000000001')),array['Doer 170: Will do','Watcher 170: Please share the price range'],'participants read every remark with author names (one transaction shares created_at)');

select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.add_task_comment_with_audit('17050000-0000-4000-8000-000000000001','Not mine')$$,'42501',null,'an unrelated colleague cannot add a remark');
select throws_ok($$select * from public.list_task_comments('17050000-0000-4000-8000-000000000001')$$,'42501',null,'an unrelated colleague cannot list remarks');
select is((select count(*)::integer from public.task_comments where task_instance_id='17050000-0000-4000-8000-000000000001'),0,'an unrelated colleague cannot read remark rows directly');

select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.add_task_comment_with_audit('17050000-0000-4000-8000-000000000001','Cross tenant')$$,'42501',null,'another tenant cannot add a remark');

reset role;
select is((select count(*)::integer from audit_logs where action='task_comment_added' and record_id='17050000-0000-4000-8000-000000000001'),2,'every remark writes an audit record');

select * from finish();
rollback;
