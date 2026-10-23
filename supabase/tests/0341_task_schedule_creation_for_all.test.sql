begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- 1 admin, 2 manager, 3 doer, 4 staff (named verifier), 5 staff (not a verifier),
-- 6 other-tenant admin, 7 inactive admin.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('34100000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','rc-'||n||'@example.invalid',
  crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now() from generate_series(1,7) n;
insert into public.tenants(id,name,slug) values
 ('34110000-0000-4000-8000-000000000001','Recurring consolidation 341','recurring-consolidation-341'),
 ('34110000-0000-4000-8000-000000000002','Other tenant 341','other-tenant-341');
insert into public.branches(id,tenant_id,name,code) values
 ('34120000-0000-4000-8000-000000000001','34110000-0000-4000-8000-000000000001','RC Branch 341','RC341'),
 ('34120000-0000-4000-8000-000000000002','34110000-0000-4000-8000-000000000002','Other Branch 341','OT341');
insert into public.departments(id,tenant_id,branch_id,name,code) values
 ('34130000-0000-4000-8000-000000000001','34110000-0000-4000-8000-000000000001','34120000-0000-4000-8000-000000000001','RC Department 341','RCD341'),
 ('34130000-0000-4000-8000-000000000002','34110000-0000-4000-8000-000000000002','34120000-0000-4000-8000-000000000002','Other Department 341','OTD341');
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,week_off)
select ('34140000-0000-4000-8000-00000000000'||n)::uuid,('34100000-0000-4000-8000-00000000000'||n)::uuid,
  case when n=6 then '34110000-0000-4000-8000-000000000002' else '34110000-0000-4000-8000-000000000001' end::uuid,
  case when n=6 then '34120000-0000-4000-8000-000000000002' else '34120000-0000-4000-8000-000000000001' end::uuid,
  case when n=6 then '34130000-0000-4000-8000-000000000002' else '34130000-0000-4000-8000-000000000001' end::uuid,
  'RC User '||n,'000000341'||n,'rc-'||n||'@example.invalid','RC341-'||n,
  (array['admin','manager','doer','staff','staff','admin','admin'])[n]::user_role,'active',
  (case when n=7 then 'inactive' else 'active' end)::user_account_status,n<>7,'{}'
from generate_series(1,7) n;

create function pg_temp.act(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub','34100000-0000-4000-8000-00000000000'||p_n,true),
         set_config('request.jwt.claim.role','authenticated',true);
  select null::void;
$$;
grant execute on function pg_temp.act(integer) to authenticated;
create temp table saved(name text primary key, id uuid) on commit drop;
grant all on saved to authenticated, service_role;

create function pg_temp.payload(p_n integer, p_kind text default 'daily') returns jsonb
language sql security definer set search_path=public as $$
 select jsonb_build_object('title','Mobile schedule regression','description','Synthetic test only',
 'recurrence_rule',case when p_kind='as_required' then 'FREQ=DAILY;COUNT=1' else 'FREQ=DAILY' end,
 'schedule_kind',p_kind,'starts_on','2030-11-01','planned_time','11:00','due_time','18:00','priority','medium',
 'branch_id',branch_id,'department_id',department_id,'default_assignee_type','specific_user',
 'default_assignee_user_id',id,'default_assignee_role','','task_type','delegation','checklist_items','[]'::jsonb,
 'is_active',true,'verification_required',false,'trigger_label','Per Customer')
 from user_profiles where id=('34140000-0000-4000-8000-00000000000'||p_n)::uuid;
$$;
grant execute on function pg_temp.payload(integer,text) to authenticated,anon,service_role;
set local role authenticated;
select pg_temp.act(5);
select lives_ok($$insert into saved values('self',save_recurring_todo_template_with_audit(null,pg_temp.payload(5)))$$,'ordinary staff creates own recurring schedule');
select lives_ok($$insert into saved values('peer',save_recurring_todo_template_with_audit(null,pg_temp.payload(3)))$$,'ordinary staff schedules eligible colleague');
select lives_ok($$insert into saved values('duty',save_recurring_todo_template_with_audit(null,pg_temp.payload(5,'as_required')))$$,'ordinary staff creates an as-needed duty');
select throws_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(1))$$,'42501',null,'staff cannot target protected management');
select throws_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(6))$$,'23503',null,'staff cannot target another tenant');
select throws_ok($$select save_recurring_todo_template_with_audit((select id from saved where name='self'),pg_temp.payload(5))$$,'42501',null,'creation does not grant template editing');
reset role;
select is((select count(*)::integer from audit_logs where record_id in(select id from saved) and action='recurring_todo_created'),3,'all creations have durable audit entries');
select is((select count(*)::integer from task_instances where task_template_id=(select id from saved where name='duty')),0,'as-needed duty does not create a premature occurrence');
select is((select count(*)::integer from task_instances where task_template_id=(select id from saved where name='self')),1,'calendar schedule persists its first occurrence');
select is((select count(*)::integer from task_assignees a join task_instances i on i.id=a.task_instance_id where i.task_template_id=(select id from saved where name='peer') and a.user_profile_id='34140000-0000-4000-8000-000000000003'),1,'first occurrence keeps the selected assignee');
-- Permission denial still allows self; it denies assigning someone else.
insert into user_permission_overrides(tenant_id,user_profile_id,permission_key,effect,updated_by)
values('34110000-0000-4000-8000-000000000001','34140000-0000-4000-8000-000000000005','tasks.assign_others','deny','34140000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.act(5);
select lives_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(5))$$,'self scheduling works when assign others is denied');
select throws_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(3))$$,'42501',null,'assign others denial applies directly to schedule RPC');
select pg_temp.act(7);
select throws_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(7))$$,'42501',null,'inactive actor cannot create schedules');
select pg_temp.act(1);
select lives_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(3))$$,'existing admin creation is preserved');
select pg_temp.act(2);
select lives_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(3))$$,'existing manager creation is preserved');
reset role;
-- Put a colleague outside the department scope without changing tenant.
insert into departments(id,tenant_id,branch_id,name,code) values('34130000-0000-4000-8000-000000000003','34110000-0000-4000-8000-000000000001','34120000-0000-4000-8000-000000000001','Other department','OTHER341');
update user_profiles set department_id='34130000-0000-4000-8000-000000000003' where id='34140000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.act(3);
select throws_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(4))$$,'42501',null,'out of scope department is denied');
select throws_ok($$select save_task_template_with_audit(null,(pg_temp.payload(4)-array['schedule_kind','starts_on','task_type','due_time','verification_required','trigger_label']))$$,'42501',null,'lower level template RPC cannot bypass scope');
reset role;
set local role anon;
select throws_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(5))$$,'42501',null,'anonymous schedule creation denied');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select throws_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(5))$$,'42501',null,'service role without an actor cannot create employee schedules');
reset role;
-- Every non-management role can create their own schedule through the public RPC.
update user_profiles set user_role='hr' where id='34140000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.act(5);
select lives_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(5))$$,'hr can create their own schedule');
reset role;
update user_profiles set user_role='crm' where id='34140000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.act(5);
select lives_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(5))$$,'crm can create their own schedule');
reset role;
update user_profiles set user_role='doer' where id='34140000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.act(5);
select lives_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(5))$$,'doer can create their own schedule');
reset role;
update user_profiles set user_role='housekeeping' where id='34140000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.act(5);
select lives_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(5))$$,'housekeeping can create their own schedule');
reset role;
insert into user_permission_overrides(tenant_id,user_profile_id,permission_key,effect,updated_by)
values('34110000-0000-4000-8000-000000000001','34140000-0000-4000-8000-000000000005','tasks.view','deny','34140000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.act(5);
select throws_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(5))$$,'42501',null,'denied Tasks access blocks direct schedule creation');
select throws_ok($$select save_task_template_with_audit(null,(pg_temp.payload(5)-array['schedule_kind','starts_on','task_type','due_time','verification_required','trigger_label']))$$,'42501',null,'lower level template RPC also respects denied Tasks access');
reset role;
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(3)||'{"branch_id":"","department_id":""}'::jsonb)$$,'42501',null,'employee cannot manufacture a global schedule');
select throws_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(3)||'{"default_assignee_type":"role","default_assignee_user_id":"","default_assignee_role":"staff"}'::jsonb)$$,'42501',null,'employee cannot manufacture a role-wide schedule');
reset role;
insert into branches(id,tenant_id,name,code) values('34120000-0000-4000-8000-000000000003','34110000-0000-4000-8000-000000000001','Other same tenant branch','RC341B');
update departments set branch_id='34120000-0000-4000-8000-000000000003' where id='34130000-0000-4000-8000-000000000003';
update user_profiles set branch_id='34120000-0000-4000-8000-000000000003' where id='34140000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.act(2);
select throws_ok($$select save_recurring_todo_template_with_audit(null,pg_temp.payload(4))$$,'42501',null,'manager cannot schedule outside their branch');
reset role;
select * from finish();
rollback;
