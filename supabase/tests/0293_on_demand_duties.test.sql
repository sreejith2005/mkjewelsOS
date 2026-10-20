begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('29300000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','od-'||n||'@example.invalid',
  crypt('local-test-only',gen_salt('bf')),now(),'{}','{}',now(),now() from generate_series(1,6) n;
insert into public.tenants(id,name,slug) values('29310000-0000-4000-8000-000000000001','On demand 293','on-demand-293');
insert into public.branches(id,tenant_id,name,code) values
 ('29320000-0000-4000-8000-000000000001','29310000-0000-4000-8000-000000000001','OD Branch 293','OD293'),
 ('29320000-0000-4000-8000-000000000002','29310000-0000-4000-8000-000000000001','OD Other 293','OD293B');
insert into public.departments(id,tenant_id,branch_id,name,code) values
 ('29330000-0000-4000-8000-000000000001','29310000-0000-4000-8000-000000000001','29320000-0000-4000-8000-000000000001','OD Department 293','ODD293'),
 ('29330000-0000-4000-8000-000000000002','29310000-0000-4000-8000-000000000001','29320000-0000-4000-8000-000000000002','OD Other Department 293','ODD293B');
-- 1 admin, 2 manager (same branch), 3 doer, 4 peer employee, 5 manager (other branch), 6 admin denied assign_others
insert into public.user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,account_status,is_login_enabled,reports_to_user_id)
values
 ('29340000-0000-4000-8000-000000000001','29300000-0000-4000-8000-000000000001','29310000-0000-4000-8000-000000000001','29320000-0000-4000-8000-000000000001','29330000-0000-4000-8000-000000000001','OD Admin 293','0000002931','od-1@example.invalid','OD293-1','admin','active','active',true,null),
 ('29340000-0000-4000-8000-000000000002','29300000-0000-4000-8000-000000000002','29310000-0000-4000-8000-000000000001','29320000-0000-4000-8000-000000000001','29330000-0000-4000-8000-000000000001','OD Manager 293','0000002932','od-2@example.invalid','OD293-2','manager','active','active',true,null),
 ('29340000-0000-4000-8000-000000000003','29300000-0000-4000-8000-000000000003','29310000-0000-4000-8000-000000000001','29320000-0000-4000-8000-000000000001','29330000-0000-4000-8000-000000000001','OD Doer 293','0000002933','od-3@example.invalid','OD293-3','doer','active','active',true,'29340000-0000-4000-8000-000000000002'),
 ('29340000-0000-4000-8000-000000000004','29300000-0000-4000-8000-000000000004','29310000-0000-4000-8000-000000000001','29320000-0000-4000-8000-000000000001','29330000-0000-4000-8000-000000000001','OD Peer 293','0000002934','od-4@example.invalid','OD293-4','doer','active','active',true,'29340000-0000-4000-8000-000000000002'),
 ('29340000-0000-4000-8000-000000000005','29300000-0000-4000-8000-000000000005','29310000-0000-4000-8000-000000000001','29320000-0000-4000-8000-000000000002','29330000-0000-4000-8000-000000000002','OD Far Manager 293','0000002935','od-5@example.invalid','OD293-5','manager','active','active',true,null),
 ('29340000-0000-4000-8000-000000000006','29300000-0000-4000-8000-000000000006','29310000-0000-4000-8000-000000000001','29320000-0000-4000-8000-000000000001','29330000-0000-4000-8000-000000000001','OD Denied Admin 293','0000002936','od-6@example.invalid','OD293-6','admin','active','active',true,null);
insert into public.user_permission_overrides(tenant_id,user_profile_id,permission_key,effect)
values('29310000-0000-4000-8000-000000000001','29340000-0000-4000-8000-000000000006','tasks.assign_others','deny');
insert into public.dropdown_masters(tenant_id,master_type,label,value,sort_order,created_by)
values('29310000-0000-4000-8000-000000000001','task_category','OD Category 293','od_category_293',1,'29340000-0000-4000-8000-000000000001');

-- a: assigned duty, b: daily schedule, c: unassigned duty, d: deleted duty
insert into public.task_templates(id,tenant_id,branch_id,department_id,title,task_type,recurrence_rule,planned_time,due_time,priority,
  default_assignee_type,default_assignee_user_id,checklist_items,is_active,schedule_kind,assignment_status,trigger_label,created_by,updated_by)
select ('2935000'||k||'-0000-4000-8000-000000000001')::uuid,'29310000-0000-4000-8000-000000000001','29320000-0000-4000-8000-000000000001',
  '29330000-0000-4000-8000-000000000001','OD duty '||k,'checklist','FREQ=DAILY','11:00','23:58','medium','specific_user',
  case when k=3 then null else '29340000-0000-4000-8000-000000000003'::uuid end,
  '[{"item_text":"Offer water","is_required":true,"sort_order":1}]'::jsonb,k=2,
  case when k=2 then 'daily' else 'as_required' end,case when k=3 then 'assigning_left' else 'assigned' end,
  case when k=1 then 'Per Customer' else null end,'29340000-0000-4000-8000-000000000001','29340000-0000-4000-8000-000000000001'
from generate_series(1,4) k;
update public.task_templates set deleted_at=now() where id='29350004-0000-4000-8000-000000000001';

create function pg_temp.act(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub','29300000-0000-4000-8000-00000000000'||p_n,true),
         set_config('request.jwt.claim.role','authenticated',true);
  select null::void;
$$;
grant execute on function pg_temp.act(integer) to authenticated;

select ok(not has_function_privilege('anon','public.start_on_demand_task_with_audit(uuid)','execute'),'anon cannot start duties');
select ok(not has_function_privilege('anon','public.get_my_on_demand_duties()','execute'),'anon cannot list duties');

set local role authenticated;

-- Employee sees and starts their own duty
select pg_temp.act(3);
select is(jsonb_array_length(public.get_my_on_demand_duties()->'duties'),1,'employee sees only their live assigned duty');
select is(public.get_my_on_demand_duties()->'duties'->0->>'trigger_label','Per Customer','duty carries the sheet label');
create temp table started(n integer, id uuid) on commit drop;
grant all on started to authenticated;
insert into started values(1,public.start_on_demand_task_with_audit('29350001-0000-4000-8000-000000000001'));
insert into started values(2,public.start_on_demand_task_with_audit('29350001-0000-4000-8000-000000000001'));
select is((public.get_my_on_demand_duties()->'duties'->0->>'started_today')::integer,2,'several occurrences per day are allowed');
select is((public.get_my_on_demand_duties()->'duties'->0->>'open_count')::integer,2,'open occurrences are counted');

-- Other people
select pg_temp.act(4);
select is(jsonb_array_length(public.get_my_on_demand_duties()->'duties'),0,'peer sees no duties of others');
select throws_ok($$select public.start_on_demand_task_with_audit('29350001-0000-4000-8000-000000000001')$$,'42501',null,'peer cannot start another employee duty');
select pg_temp.act(5);
select throws_ok($$select public.start_on_demand_task_with_audit('29350001-0000-4000-8000-000000000001')$$,'42501',null,'manager of another branch is denied');
select pg_temp.act(6);
select throws_ok($$select public.start_on_demand_task_with_audit('29350001-0000-4000-8000-000000000001')$$,'42501',null,'admin denied tasks.assign_others is denied');
select pg_temp.act(2);
insert into started values(3,public.start_on_demand_task_with_audit('29350001-0000-4000-8000-000000000001'));
select throws_ok($$select public.start_on_demand_task_with_audit('29350002-0000-4000-8000-000000000001')$$,'22023',null,'a dated schedule cannot be started on demand');
select throws_ok($$select public.start_on_demand_task_with_audit('29350003-0000-4000-8000-000000000001')$$,'23514',null,'an unassigned duty must be assigned first');
select throws_ok($$select public.start_on_demand_task_with_audit('29350004-0000-4000-8000-000000000001')$$,'42501',null,'a deleted duty is unavailable');
select pg_temp.act(1);
select ok(public.get_task_template_directory('{}'::jsonb)->'templates' @> '[{"id":"29350001-0000-4000-8000-000000000001","trigger_label":"Per Customer"}]','Task Control directory projects the trigger label');

reset role;
select is((select count(*) from public.task_instances where task_template_id='29350001-0000-4000-8000-000000000001' and on_demand
  and scheduled_date=(now() at time zone 'Asia/Kolkata')::date and status='pending'),3::bigint,'three on-demand occurrences exist today');
select ok((select bool_and(i.due_datetime>i.planned_datetime and i.verification_status is not null) from public.task_instances i join started s on s.id=i.id),'occurrences carry a deadline and template requirements');
select is((select count(*) from public.task_checklists c join started s on s.id=c.task_instance_id),3::bigint,'checklist items are copied');
select is((select count(*) from public.task_assignees a join started s on s.id=a.task_instance_id where a.user_profile_id='29340000-0000-4000-8000-000000000003' and a.is_active),3::bigint,'the duty employee is the doer every time');
select is((select count(*) from public.notifications n join started s on s.id=n.source_record_id where s.n in (1,2)),0::bigint,'self-started occurrences raise no alert');
select is((select count(*) from public.notifications n join started s on s.id=n.source_record_id where s.n=3 and n.user_profile_id='29340000-0000-4000-8000-000000000003' and n.event_type='task_assigned'),1::bigint,'manager assignment alerts the employee');
select is((select string_agg(new_value->>'mode',',' order by s.n) from public.audit_logs a join started s on s.id=a.record_id where a.action='task_on_demand_started'),'self,self,assigned','every start is audited with its mode');

-- Scheduled generation still works beside on-demand rows
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select isnt(public.create_recurring_todo_instance('29350001-0000-4000-8000-000000000001',(now() at time zone 'Asia/Kolkata')::date,array['29340000-0000-4000-8000-000000000003'::uuid]),null::uuid,'a scheduled run is not blocked by on-demand rows');
select is(public.create_recurring_todo_instance('29350001-0000-4000-8000-000000000001',(now() at time zone 'Asia/Kolkata')::date,array['29340000-0000-4000-8000-000000000003'::uuid]),null::uuid,'scheduled runs stay one per day');
reset role;

-- Daily cap
insert into public.task_instances(tenant_id,branch_id,department_id,task_template_id,task_type,title,priority,status,planned_datetime,scheduled_date,source,created_by,on_demand)
select tenant_id,branch_id,department_id,id,task_type,title,priority,'pending',now(),(now() at time zone 'Asia/Kolkata')::date,'checklist',created_by,true
from public.task_templates, generate_series(1,47) where id='29350001-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act(3);
select throws_ok($$select public.start_on_demand_task_with_audit('29350001-0000-4000-8000-000000000001')$$,'23514',null,'the daily cap stops floods');
reset role;

-- Import keeps the sheet label and backfills it on replay
create function pg_temp.import_duty(p_file text,p_label text) returns jsonb language plpgsql as $$
declare batch uuid;
begin
  batch:=(public.begin_task_bulk_import(encode(extensions.digest(p_file,'sha256'),'hex'),p_file||'.csv',1)->>'batch_id')::uuid;
  return public.commit_task_bulk_import_chunk(batch,jsonb_build_array(jsonb_build_object(
    'source_row',2,'task_key','od-import','destination','recurring_todo','schedule_kind','as_required',
    'task_type','delegation','core_task_label','','title','OD imported duty','description','',
    'priority','medium','branch','OD293','department','OD Department 293','category','',
    'assignee_email','','assignee_profile_id','','assignee_name','OD Doer 293','verifier_label','','verifier_profile_id','',
    'starts_on','','start_time','11:00','due_time','20:00','planned_at','','due_at','',
    'recurrence_rule','FREQ=DAILY','requires_upload',false,'verification_required',false,'buddy_assignment_allowed',true,
    'is_active',false,'assignment_status','assigning_left','checklist','[]'::jsonb,'trigger_label',p_label)));
end $$;
grant execute on function pg_temp.import_duty(text,text) to authenticated;
set local role authenticated;
select pg_temp.act(1);
select is((pg_temp.import_duty('od-first','Per Not-Bought Customer')->>'created')::integer,1,'import accepts the trigger label');
reset role;
select is((select trigger_label from public.task_templates where title='OD imported duty'),'Per Not-Bought Customer','import stores the trigger label');
update public.task_templates set trigger_label=null where title='OD imported duty';
set local role authenticated;
select pg_temp.act(1);
select is((pg_temp.import_duty('od-second','After Visit')->>'replayed_count')::integer,1,'re-upload replays the existing duty');
reset role;
select is((select trigger_label from public.task_templates where title='OD imported duty'),'After Visit','replay fills a missing label');
select is((select count(*) from public.task_templates where title='OD imported duty'),1::bigint,'replay creates no duplicate');

select * from finish();
rollback;
