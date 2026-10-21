begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('29400000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','sd-'||n||'@example.invalid',
  crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now() from generate_series(1,3) n;
insert into public.tenants(id,name,slug) values('29410000-0000-4000-8000-000000000001','Standing duties 294','standing-duties-294');
insert into public.branches(id,tenant_id,name,code) values
 ('29420000-0000-4000-8000-000000000001','29410000-0000-4000-8000-000000000001','SD Branch 294','SD294');
insert into public.departments(id,tenant_id,branch_id,name,code) values
 ('29430000-0000-4000-8000-000000000001','29410000-0000-4000-8000-000000000001','29420000-0000-4000-8000-000000000001','SD Department 294','SDD294');
-- 1 admin, 2 manager (same branch), 3 doer
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,reports_to_user_id)
values
 ('29440000-0000-4000-8000-000000000001','29400000-0000-4000-8000-000000000001','29410000-0000-4000-8000-000000000001','29420000-0000-4000-8000-000000000001','29430000-0000-4000-8000-000000000001','SD Admin 294','0000002941','sd-1@example.invalid','SD294-1','admin','active','active',true,null),
 ('29440000-0000-4000-8000-000000000002','29400000-0000-4000-8000-000000000002','29410000-0000-4000-8000-000000000001','29420000-0000-4000-8000-000000000001','29430000-0000-4000-8000-000000000001','SD Manager 294','0000002942','sd-2@example.invalid','SD294-2','manager','active','active',true,null),
 ('29440000-0000-4000-8000-000000000003','29400000-0000-4000-8000-000000000003','29410000-0000-4000-8000-000000000001','29420000-0000-4000-8000-000000000001','29430000-0000-4000-8000-000000000001','SD Doer 294','0000002943','sd-3@example.invalid','SD294-3','doer','active','active',true,'29440000-0000-4000-8000-000000000002');

-- One assigned "Per Customer" duty whose template priority is medium.
insert into public.task_templates(id,tenant_id,branch_id,department_id,title,task_type,recurrence_rule,planned_time,due_time,priority,
  default_assignee_type,default_assignee_user_id,checklist_items,is_active,schedule_kind,assignment_status,trigger_label,created_by,updated_by)
values('29450000-0000-4000-8000-000000000001','29410000-0000-4000-8000-000000000001','29420000-0000-4000-8000-000000000001',
  '29430000-0000-4000-8000-000000000001','SD duty','delegation','FREQ=DAILY','11:00','23:58','medium','specific_user',
  '29440000-0000-4000-8000-000000000003','[]'::jsonb,false,'as_required','assigned','Per Customer',
  '29440000-0000-4000-8000-000000000001','29440000-0000-4000-8000-000000000001');

create function pg_temp.act(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub','29400000-0000-4000-8000-00000000000'||p_n,true),
         set_config('request.jwt.claim.role','authenticated',true);
  select null::void;
$$;
grant execute on function pg_temp.act(integer) to authenticated;
create temp table started(n integer, id uuid) on commit drop;
grant all on started to authenticated;

set local role authenticated;

-- Employee does the duty whenever they like: low priority, due at the end of today.
select pg_temp.act(3);
select is(public.get_my_on_demand_duties()->'duties'->0->>'open_task_id',null,'no open occurrence before starting');
insert into started values(1,public.start_on_demand_task_with_audit('29450000-0000-4000-8000-000000000001'));
select is(public.get_my_on_demand_duties()->'duties'->0->>'open_task_id',(select id::text from started where n=1),
  'the open occurrence is returned so Start continues it');

-- A manager enforces the duty: high priority, alerted.
select pg_temp.act(2);
insert into started values(2,public.start_on_demand_task_with_audit('29450000-0000-4000-8000-000000000001'));

reset role;
select is((select priority::text from public.task_instances where id=(select id from started where n=1)),'low',
  'a self-started duty is low priority');
select ok((select due_datetime>=least(((now() at time zone 'Asia/Kolkata')::date::text||' 23:59')::timestamp at time zone 'Asia/Kolkata',now()+interval '5 minutes')
  from public.task_instances where id=(select id from started where n=1)),'a self-started duty is due at the end of today');
select is((select priority::text from public.task_instances where id=(select id from started where n=2)),'high',
  'an enforced duty is high priority');
select is((select count(*) from public.notifications n where n.source_record_id=(select id from started where n=1)),0::bigint,
  'a self-started duty raises no alert');
select is((select count(*) from public.notifications n where n.source_record_id=(select id from started where n=2)
  and n.user_profile_id='29440000-0000-4000-8000-000000000003' and n.event_type='task_assigned'),1::bigint,'an enforced duty alerts the employee');
select is((select string_agg(new_value->>'priority',',' order by s.n) from public.audit_logs a join started s on s.id=a.record_id
  where a.action='task_on_demand_started'),'low,high','each start is audited with its priority');

set local role authenticated;
select pg_temp.act(3);
select is(public.get_my_on_demand_duties()->'duties'->0->>'open_task_id',(select id::text from started where n=2),
  'the enforced occurrence is offered first');
select is((public.get_my_on_demand_duties()->'duties'->0->>'open_count')::integer,2,'both open occurrences are counted');
select is((public.get_my_on_demand_duties()->'duties'->0->>'completed_today')::integer,0,'nothing completed yet');

reset role;
update public.task_instances set status='completed',actual_datetime=now(),completed_by='29440000-0000-4000-8000-000000000003'
where id=(select id from started where n=2);
set local role authenticated;
select pg_temp.act(3);
select is((public.get_my_on_demand_duties()->'duties'->0->>'completed_today')::integer,1,'completed today is counted');
select is((public.get_my_on_demand_duties()->'duties'->0->>'open_count')::integer,1,'a completed occurrence is no longer open');
select is((public.get_my_on_demand_duties()->'duties'->0->>'started_today')::integer,2,'started today still counts both');

-- Deadline first, then priority -----------------------------------------------------
reset role;
insert into public.task_instances(id,tenant_id,branch_id,department_id,task_type,title,priority,status,planned_datetime,due_datetime,
  actual_datetime,requires_upload,source,created_by)
select id::uuid,'29410000-0000-4000-8000-000000000001','29420000-0000-4000-8000-000000000001','29430000-0000-4000-8000-000000000001',
  'delegation',title,priority::task_priority,status::task_status,now()-interval '2 days',now()+due,
  case when status='completed' then now() end,true,'manual','29440000-0000-4000-8000-000000000002'
from (values
  -- pending: earliest deadline first; the same deadline puts high before medium
  ('29460000-0000-4000-8000-000000000001','Order294 later high','high','pending',interval '3 hours'),
  ('29460000-0000-4000-8000-000000000003','Order294 later medium','medium','pending',interval '3 hours'),
  ('29460000-0000-4000-8000-000000000002','Order294 soon low','low','pending',interval '1 hour'),
  ('29460000-0000-4000-8000-000000000004','Order294 tomorrow high','high','pending',interval '1 day'),
  -- overdue: the longest overdue first
  ('29460000-0000-4000-8000-000000000005','Order294 overdue recent','high','pending',interval '-1 hour'),
  ('29460000-0000-4000-8000-000000000006','Order294 overdue old','medium','pending',interval '-2 hours'),
  -- completed: newest deadline first
  ('29460000-0000-4000-8000-000000000007','Order294 done old','high','completed',interval '-3 hours'),
  ('29460000-0000-4000-8000-000000000008','Order294 done recent','low','completed',interval '-30 minutes'),
  -- search pair with one deadline; the high one has the larger id
  ('29460000-0000-4000-8000-000000000012','Tie294 high','high','pending',interval '5 days'),
  ('29460000-0000-4000-8000-000000000011','Tie294 medium','medium','pending',interval '5 days')
) x(id,title,priority,status,due);
insert into public.task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
select id,'29440000-0000-4000-8000-000000000001','doer',true,true from public.task_instances
where tenant_id='29410000-0000-4000-8000-000000000001' and (title like 'Order294%' or title like 'Tie294%');

create function pg_temp.page_titles(p_page jsonb) returns text language sql as $$
  select string_agg(t.title,' | ' order by o.position) from jsonb_array_elements_text(p_page->'ids') with ordinality o(id,position)
  join public.task_instances t on t.id=o.id::uuid where t.title like 'Order294%' or t.title like 'Tie294%';
$$;
grant execute on function pg_temp.page_titles(jsonb) to authenticated;

set local role authenticated;
select pg_temp.act(1);
select is(pg_temp.page_titles(public.task_feed_page('mine','pending')),
  'Order294 soon low | Order294 later high | Order294 later medium | Order294 tomorrow high | Tie294 high | Tie294 medium',
  'pending work: earliest deadline first, priority breaks ties');
select is(pg_temp.page_titles(public.task_feed_page('mine','overdue')),'Order294 overdue old | Order294 overdue recent',
  'overdue work: longest overdue first');
select is(pg_temp.page_titles(public.task_feed_page('mine','completed')),'Order294 done recent | Order294 done old',
  'completed work keeps newest first');
select is(pg_temp.page_titles(public.task_workspace_page('{"query":"Tie294"}')),'Tie294 high | Tie294 medium',
  'search by due date breaks ties by priority');
select is(pg_temp.page_titles(public.task_workspace_page('{"query":"Order294 later","sort":"priority"}')),
  'Order294 later high | Order294 later medium','priority sort still leads with priority');
select is(pg_temp.page_titles(public.task_workspace_page('{"query":"Order294","sort":"priority","status":"pending"}')),
  'Order294 later high | Order294 tomorrow high | Order294 later medium | Order294 soon low','priority sort orders by deadline within a priority');

reset role;
select ok(not has_function_privilege('anon','public.start_on_demand_task_with_audit(uuid)','execute'),'anon still cannot start duties');
select ok(not has_function_privilege('anon','public.get_my_on_demand_duties()','execute'),'anon still cannot list duties');
select ok(not has_function_privilege('anon','public.task_workspace_page(jsonb,integer,integer)','execute'),'anon still cannot page tasks');

select * from finish();
rollback;
