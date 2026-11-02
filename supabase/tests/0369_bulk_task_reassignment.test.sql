begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(21);

create temp table ra(name text primary key, id uuid);
grant select on ra to authenticated;
do $$
declare t uuid; b uuid; da uuid; db uuid; a uuid; u uuid; person text; task uuid; i integer;
begin
  insert into tenants(name,slug) values('Reassign','reassign-369') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','RA9') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','RA9S') returning id into da;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Stock','RA9T') returning id into db;
  foreach person in array array['admin','manager','leaver','receiver','colleague'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-ra@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled,week_off)
      values(t,a,b,case when person='receiver' then db else da end,'Ra '||person,'RA-'||person,person||'-ra@test.local',
        case person when 'admin' then 'admin' when 'manager' then 'manager' else 'staff' end::user_role,'active','active',true,'{}') returning id into u;
    insert into ra values(person,u),(person||'_auth',a);
  end loop;
  insert into ra values('tenant',t),('dept_a',da),('dept_b',db);
  -- t1 upcoming, t2 overdue and shared with colleague, t3 completed, t4 receiver is In Loop, t5 not the leaver's.
  for i in 1..5 loop
    insert into task_instances(tenant_id,branch_id,department_id,task_type,title,planned_datetime,due_datetime,status,created_by)
      values(t,b,da,'delegation','Ra task '||i,
        case when i=2 then now()-interval '3 days' else now()+interval '2 days' end,
        case when i=2 then now()-interval '3 days' else now()+interval '2 days' end,
        case when i=3 then 'completed' else 'pending' end::task_status,(select id from ra where name='admin')) returning id into task;
    insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
      values(task,(select id from ra where name=case when i=5 then 'colleague' else 'leaver' end),'doer',true,true);
    if i=2 then insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values(task,(select id from ra where name='colleague'),'doer',true,true); end if;
    if i=4 then insert into task_watchers(tenant_id,task_instance_id,user_profile_id,created_by) values(t,task,(select id from ra where name='receiver'),(select id from ra where name='admin')); end if;
    insert into ra values('t'||i,task);
  end loop;
  insert into task_templates(tenant_id,title,branch_id,department_id,default_assignee_type,default_assignee_user_id,created_by)
    values(t,'Ra daily duty',b,da,'specific_user',(select id from ra where name='leaver'),(select id from ra where name='admin')) returning id into task;
  insert into ra values('template',task);
end $$;
create function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from ra where name=p $$;
create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',(select id::text from ra where name=p||'_auth'),true),
    set_config('request.jwt.claims',json_build_object('role','authenticated','sub',(select id from ra where name=p||'_auth'))::text,true),
    set_config('request.jwt.claim.role','authenticated',true) $$;
grant execute on function pg_temp.fx(text), pg_temp.as_user(text) to authenticated;
create temp table result(r jsonb);
grant all on result to authenticated;

select ok(not has_function_privilege('anon','reassign_task_work_with_audit(uuid,uuid,text,uuid[],uuid[],uuid[])','EXECUTE')
  and not has_function_privilege('authenticated','task_reassignment_actor()','EXECUTE'), 'anonymous callers cannot reassign work');

select pg_temp.as_user('manager'); set local role authenticated;
select throws_ok(format('select task_reassignment_candidates(%L)', pg_temp.fx('leaver')), '42501', 'Only administrators can reassign tasks',
  'a manager without View all tasks cannot list another person''s work');
select throws_ok(format('select reassign_task_work_with_audit(%L,%L,%L,array[%L]::uuid[])', pg_temp.fx('leaver'), pg_temp.fx('receiver'), 'handover', pg_temp.fx('t1')),
  '42501', 'Only administrators can reassign tasks', 'a manager without View all tasks cannot reassign');
reset role;
select pg_temp.as_user('colleague'); set local role authenticated;
select throws_ok(format('select reassign_task_work_with_audit(%L,%L,%L,array[%L]::uuid[])', pg_temp.fx('leaver'), pg_temp.fx('colleague'), 'mine now', pg_temp.fx('t1')),
  '42501', 'Only administrators can reassign tasks', 'an ordinary employee cannot take someone else''s tasks');
reset role;

select pg_temp.as_user('admin'); set local role authenticated;
select is((select jsonb_array_length(task_reassignment_candidates(pg_temp.fx('leaver'))->'tasks')), 3,
  'candidates list every open task of the person, whatever the date (completed excluded)');
select is((select count(*)::integer from jsonb_array_elements(task_reassignment_candidates(pg_temp.fx('leaver'))->'tasks') x where (x->>'overdue')::boolean), 1,
  'overdue tasks are marked');
select is((select jsonb_array_length(task_reassignment_candidates(pg_temp.fx('leaver'))->'schedules')), 1, 'their recurring schedule is listed');
select throws_ok(format('select reassign_task_work_with_audit(%L,%L,%L,array[%L]::uuid[])', pg_temp.fx('leaver'), pg_temp.fx('receiver'), '  ', pg_temp.fx('t1')),
  '22023', 'A reason is required', 'a reason is required');
select throws_ok(format('select reassign_task_work_with_audit(%L,%L,%L,array[%L]::uuid[])', pg_temp.fx('leaver'), pg_temp.fx('leaver'), 'x', pg_temp.fx('t1')),
  '22023', 'Choose a different person to receive the work', 'work cannot be moved to the same person');
select lives_ok(format('insert into result select reassign_task_work_with_audit(%L,%L,%L,array[%L,%L,%L,%L,%L]::uuid[],array[%L]::uuid[],array[%L]::uuid[])',
  pg_temp.fx('leaver'), pg_temp.fx('receiver'), 'Leaver handover', pg_temp.fx('t1'), pg_temp.fx('t2'), pg_temp.fx('t3'), pg_temp.fx('t4'), pg_temp.fx('t5'),
  gen_random_uuid(), pg_temp.fx('template')), 'an administrator reassigns a mixed selection in one call');
reset role;

select is((select jsonb_array_length(r->'moved') from result), 4, 'three open tasks and the schedule moved');
select is((select jsonb_array_length(r->'skipped') from result), 3, 'the completed task, someone else''s task and the missing FMS step are reported, not fatal');
select ok(exists(select 1 from task_assignees where task_instance_id=pg_temp.fx('t1') and user_profile_id=pg_temp.fx('receiver') and is_active)
  and not exists(select 1 from task_assignees where task_instance_id=pg_temp.fx('t1') and user_profile_id=pg_temp.fx('leaver') and is_active),
  'the receiver replaces the leaver as doer');
select is((select department_id from task_instances where id=pg_temp.fx('t1')), pg_temp.fx('dept_b'), 'a task now owned only by the receiver follows their department');
select is((select department_id from task_instances where id=pg_temp.fx('t2')), pg_temp.fx('dept_a'), 'a shared task keeps its department');
select ok(not exists(select 1 from task_watchers where task_instance_id=pg_temp.fx('t4') and user_profile_id=pg_temp.fx('receiver'))
  and exists(select 1 from task_assignees where task_instance_id=pg_temp.fx('t4') and user_profile_id=pg_temp.fx('receiver') and is_active),
  'an In Loop receiver becomes the doer');
select ok(exists(select 1 from task_assignees where task_instance_id=pg_temp.fx('t3') and user_profile_id=pg_temp.fx('leaver') and is_active),
  'completed work is left untouched');
select is((select default_assignee_user_id from task_templates where id=pg_temp.fx('template')), pg_temp.fx('receiver'), 'future recurring tasks go to the receiver');
select is((select count(*)::integer from notifications where user_profile_id=pg_temp.fx('receiver')), 1,
  'the receiver gets one summary notification, not one per task');
select is((select count(*)::integer from audit_logs where action='task_doer_transferred' and actor_user_id=pg_temp.fx('admin') and new_value->>'bulk'='true'), 3,
  'each moved task is audited');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values(pg_temp.fx('t5'),pg_temp.fx('receiver'),'doer',false,true);
select ok((select count(*) from notifications where user_profile_id=pg_temp.fx('receiver')) > 1,
  'ordinary assignments outside a bulk move still notify');

select * from finish();
rollback;
