begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table due_fixture(name text primary key,id uuid);
grant select,insert,update on due_fixture to authenticated;

-- Funnel: Start -> Introduction -> (Demo) -> Follow-up 1 -> Follow-up 2 -> Follow-up 3 -> Lead Closed.
-- Assignment v2 follows each form's "Assigned To"; deadlines follow each form's date questions.
do $$
declare t uuid; t2 uuid; b uuid; d uuid; b2 uuid; d2 uuid; a uuid; u uuid; doer uuid; f uuid; flow uuid; person text;
  s_start uuid; s_intro uuid; s_demo uuid; s_f1 uuid; s_f2 uuid; s_f3 uuid; e_lost uuid;
  assign jsonb:='{"mode":"previous_form","sources":[],"allowHandoff":false,"followFormAssignee":true,"fallbackRule":{"type":"previous_step_doer"}}';
begin
  insert into tenants(name,slug) values('Due date test','due-date-test') returning id into t;
  insert into tenants(name,slug) values('Due date other','due-date-other') returning id into t2;
  insert into branches(tenant_id,name,code) values(t,'Main','DUE') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','DUE') returning id into d;
  insert into branches(tenant_id,name,code) values(t2,'Other','DUX') returning id into b2;
  insert into departments(tenant_id,branch_id,name,code) values(t2,b2,'Other','DUX') returning id into d2;
  foreach person in array array['doer','riya','manager','outsider'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-due@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
      values(case when person='outsider' then t2 else t end,a,case when person='outsider' then b2 else b end,case when person='outsider' then d2 else d end,
        'Due '||person,'DUE-'||person,person||'-due@test.local',case when person='manager' then 'manager' else 'staff' end::user_role,'active',true) returning id into u;
    insert into due_fixture values(person,u),(person||'_auth',a);
  end loop;
  select id into doer from due_fixture where name='doer';
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by) values(t,'Lead update',1,'draft',true,doer,doer) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,conditional_logic) values
    (f,'status','Client status','text',0,null),(f,'customer_name','Customer Name','text',1,null),
    (f,'assigned_to','Assigned To','user_dropdown',2,null),
    (f,'next_date','Next Follow-up Date','date',3,null),(f,'next_time','Follow-up Time','text',4,null),
    (f,'meet_at','Next Meeting Date and Time','datetime',5,null),
    (f,'alt_date','Demo Date','date',6,'{"fieldKey":"status","operator":"equals","value":"demo_alt"}');
  update form_templates set lifecycle='published' where id=f;
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version)
    values(t,gen_random_uuid(),1,'Instagram Online Sales Funnel','tenant','draft',true,doer,doer,2) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'start','Start form','form',0,true,'{"deadlineEnabled":false}',f) returning id into s_start;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'intro','Introduction','form',1,true,jsonb_build_object('deadlineEnabled',false,'assignment',assign),f) returning id into s_intro;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'demo','Demo','form',2,true,jsonb_build_object('assignment',assign,'timingMethod','completion_date','dueDate','',
      'formDue','{"sources":[{"stageKey":"intro","dateFieldKey":"alt_date"}],"onMissing":"none"}'::jsonb),f) returning id into s_demo;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'f1','Follow-up 1','form',3,true,jsonb_build_object('assignment',assign,'timingMethod','completion_date','dueDate','',
      'formDue','{"sources":[{"stageKey":"intro","dateFieldKey":"next_date","timeFieldKey":"next_time"},{"stageKey":"demo","dateFieldKey":"meet_at"},{"stageKey":"f2","dateFieldKey":"next_date","timeFieldKey":"next_time"}],"onMissing":"require"}'::jsonb),f) returning id into s_f1;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'f2','Follow-up 2','form',4,true,jsonb_build_object('assignment',assign,'timingMethod','tat_hours','tatMinutes',120,
      'formDue','{"sources":[{"stageKey":"f1","dateFieldKey":"next_date"}],"onMissing":"fallback"}'::jsonb),f) returning id into s_f2;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'f3','Follow-up 3','form',5,true,jsonb_build_object('assignment',assign,'timingMethod','completion_date','dueDate','',
      'formDue','{"sources":[{"stageKey":"f2","dateFieldKey":"next_date"}],"defaultTime":"11:00","onMissing":"none"}'::jsonb),f) returning id into s_f3;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values
    (flow,'lead_closed','Lead Closed','end',6,true,'{"deadlineEnabled":false,"terminal":{"outcome":"lost"}}') returning id into e_lost;
  insert into fms_branch_rules(fms_stage_id,sort_order,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,label) values
    (s_intro,0,'form_answer','status','status','equals','demo',s_demo,null),(s_intro,1,'form_answer','status','status','equals','demo_alt',s_demo,null),
    (s_intro,2,'form_answer','status','status','equals','follow',s_f1,null),(s_intro,3,'form_answer','status','status','equals','lost',e_lost,null),
    (s_demo,0,'form_answer','status','status','equals','follow',s_f1,null),
    (s_f1,0,'form_answer','status','status','equals','continue',s_f2,null),(s_f1,1,'form_answer','status','status','equals','lost',e_lost,null),
    (s_f2,0,'form_answer','status','status','equals','continue',s_f3,null),(s_f2,1,'form_answer','status','status','equals','again',s_f1,null),
    (s_f3,0,'form_answer','status','status','equals','lost',e_lost,null);
  update fms_stages set default_next_stage_id=s_intro where id=s_start;
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) values(s_start,'specific_user',doer,0);
  insert into due_fixture select 'family',family_id from fms_flows where id=flow;
  insert into due_fixture values('tenant',t),('flow',flow),('form',f),('intro',s_intro),('demo',s_demo),('f1',s_f1),('f2',s_f2),('f3',s_f3),('lead_closed',e_lost);
end $$;

create function pg_temp.fx(p text) returns uuid language sql as $$ select id from due_fixture where name=p $$;
create function pg_temp.visit(p_instance uuid,p_key text) returns uuid language sql as $$
  select w.id from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=p_instance and s.stage_key=p_key
    and w.status in ('pending','in_progress','in_review','overdue') order by w.visit_number desc limit 1 $$;
create function pg_temp.due(p_instance uuid,p_key text) returns timestamptz language sql as $$
  select w.planned_datetime from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=p_instance and s.stage_key=p_key
    order by w.visit_number desc limit 1 $$;
create function pg_temp.step(p_instance uuid,p_key text,p_answers jsonb) returns void language sql as $$
  select submit_fms_form_and_progress_with_audit(pg_temp.fx('form'),p_answers,'fms_stage',pg_temp.visit(p_instance,p_key),gen_random_uuid()) $$;
create function pg_temp.start(p_name text) returns uuid language sql as $$
  select (submit_form_and_start_fms_with_audit(pg_temp.fx('form'),jsonb_build_object('status','new','customer_name',p_name,'assigned_to',pg_temp.fx('doer')))->>'instance_id')::uuid $$;
create function pg_temp.act(p_person text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',(select id::text from due_fixture where name=p_person||'_auth'),true) $$;
grant execute on function pg_temp.fx(text),pg_temp.visit(uuid,text),pg_temp.due(uuid,text),pg_temp.step(uuid,text,jsonb),pg_temp.start(text),pg_temp.act(text) to authenticated;

-- Publication -------------------------------------------------------------------------------
select lives_ok($$select assert_fms_flow_publishable(pg_temp.fx('flow'))$$,'form-answer deadlines with blank timing fields publish');
update fms_stages set planned_time_rule=jsonb_set(planned_time_rule,'{formDue,sources,0,dateFieldKey}','"status"') where id=pg_temp.fx('f3');
select throws_ok($$select assert_fms_flow_publishable(pg_temp.fx('flow'))$$,'23514','Choose a date question from step Follow-up 2 for the due date of step Follow-up 3','a text question is refused as the due date');
update fms_stages set planned_time_rule=jsonb_set(planned_time_rule,'{formDue,sources,0}','{"stageKey":"f2"}') where id=pg_temp.fx('f3');
select throws_ok($$select assert_fms_flow_publishable(pg_temp.fx('flow'))$$,'23514',null,'a source without an explicit date question is refused (no guessing between date questions)');
update fms_stages set planned_time_rule=jsonb_set(planned_time_rule,'{formDue,sources,0}','{"stageKey":"f2","dateFieldKey":"meet_at","timeFieldKey":"next_time"}') where id=pg_temp.fx('f3');
select throws_ok($$select assert_fms_flow_publishable(pg_temp.fx('flow'))$$,'23514',null,'a separate time question cannot be added to a datetime question');
update fms_stages set planned_time_rule=jsonb_set(planned_time_rule,'{formDue,sources,0}','{"stageKey":"f2","dateFieldKey":"next_date"}') where id=pg_temp.fx('f3');
update fms_stages set planned_time_rule=planned_time_rule||'{"formDue":{"sources":[{"stageKey":"intro","dateFieldKey":"next_date"}],"onMissing":"none"}}' where stage_key='start' and fms_flow_id=pg_temp.fx('flow');
select throws_ok($$select assert_fms_flow_publishable(pg_temp.fx('flow'))$$,'23514',null,'the first step cannot take a due date from an earlier form');
update fms_stages set planned_time_rule=planned_time_rule-'formDue' where stage_key='start' and fms_flow_id=pg_temp.fx('flow');
update fms_stages set planned_time_rule=jsonb_set(planned_time_rule,'{formDue,onMissing}','"guess"') where id=pg_temp.fx('f3');
select throws_ok($$select assert_fms_flow_publishable(pg_temp.fx('flow'))$$,'23514',null,'an unknown missing-answer policy is refused');
update fms_stages set planned_time_rule=jsonb_set(planned_time_rule,'{formDue,onMissing}','"none"') where id=pg_temp.fx('f3');
select lives_ok($$select assert_fms_flow_publishable(pg_temp.fx('flow'))$$,'the repaired workflow publishes');
update fms_flows set status='published' where id=pg_temp.fx('flow');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.act('doer');

-- 1 / 5 / 11: Introduction -> Follow-up 1 takes date + time and the Assigned To employee.
insert into due_fixture values('lead_a',pg_temp.start('Rahul Shah'));
select pg_temp.step(pg_temp.fx('lead_a'),'intro',jsonb_build_object('status','follow','customer_name','Rahul Shah','assigned_to',pg_temp.fx('riya'),'next_date','2026-11-05','next_time','3:30 PM'));
select is(pg_temp.due(pg_temp.fx('lead_a'),'f1'),'2026-11-05 15:30:00 Asia/Kolkata'::timestamptz,'Introduction -> Follow-up 1 is due 5 Nov 2026 3:30 PM India time');
select is((select assigned_to from fms_instance_stages where id=pg_temp.visit(pg_temp.fx('lead_a'),'f1')),array[pg_temp.fx('riya')],'the Assigned To employee receives Follow-up 1 with that deadline');
select is((select details->>'source' from fms_stage_logs where fms_instance_stage_id=pg_temp.visit(pg_temp.fx('lead_a'),'f1') and action='due_date_resolved'),'form_answer','the deadline records that it came from the form answer');
select is((select (details->>'sourceVisitId')::uuid from fms_stage_logs where fms_instance_stage_id=pg_temp.visit(pg_temp.fx('lead_a'),'f1') and action='due_date_resolved'),
  (select id from fms_instance_stages where fms_instance_id=pg_temp.fx('lead_a') and fms_stage_id=pg_temp.fx('intro')),'the deadline records the exact source visit');

-- 16: a retried submission on the finished step creates nothing.
select throws_ok($$select pg_temp.step(pg_temp.fx('lead_a'),'intro','{"status":"follow","next_date":"2026-12-01"}')$$,null,null,'a repeat submission of a finished step is refused');
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=pg_temp.fx('lead_a') and fms_stage_id=pg_temp.fx('f1')),1,'no duplicate Follow-up 1 assignment');

-- 2 / 13: Follow-up 1 -> Follow-up 2 with a date only = end of that day in India.
select pg_temp.act('riya');
select pg_temp.step(pg_temp.fx('lead_a'),'f1',jsonb_build_object('status','continue','assigned_to',pg_temp.fx('riya'),'next_date','2026-11-07'));
select is(pg_temp.due(pg_temp.fx('lead_a'),'f2'),'2026-11-07 23:59:59.999999 Asia/Kolkata'::timestamptz,'a date-only answer is due at the end of that day');

-- 14: Follow-up 2 -> Follow-up 3 uses the configured default time.
select pg_temp.step(pg_temp.fx('lead_a'),'f2',jsonb_build_object('status','continue','assigned_to',pg_temp.fx('riya'),'next_date','2026-11-09'));
select is(pg_temp.due(pg_temp.fx('lead_a'),'f3'),'2026-11-09 11:00:00 Asia/Kolkata'::timestamptz,'a date-only answer uses the configured default time');

-- 17: completed history keeps its deadline.
select is((select planned_datetime from fms_instance_stages where fms_instance_id=pg_temp.fx('lead_a') and fms_stage_id=pg_temp.fx('f1') and status='completed'),
  '2026-11-05 15:30:00 Asia/Kolkata'::timestamptz,'the completed Follow-up 1 keeps its original deadline');

-- 3 / 12: Introduction -> Demo -> Follow-up 1 takes the Demo form's datetime.
select pg_temp.act('doer');
insert into due_fixture values('lead_b',pg_temp.start('Priya Mehta'));
select pg_temp.step(pg_temp.fx('lead_b'),'intro',jsonb_build_object('status','demo','assigned_to',pg_temp.fx('doer'),'next_date','2026-11-30'));
select is(pg_temp.due(pg_temp.fx('lead_b'),'demo'),null,'the Demo date question was hidden by its condition, so Demo has no deadline (policy: no due date)');
select is((select details->>'reason' from fms_stage_logs where fms_instance_stage_id=pg_temp.visit(pg_temp.fx('lead_b'),'demo') and action='due_date_resolved'),'date_not_applicable','the skipped conditional question is recorded as not applicable');
select pg_temp.step(pg_temp.fx('lead_b'),'demo',jsonb_build_object('status','follow','assigned_to',pg_temp.fx('doer'),'meet_at','2026-11-06T10:15','next_date','2026-12-25'));
select is(pg_temp.due(pg_temp.fx('lead_b'),'f1'),'2026-11-06 10:15:00 Asia/Kolkata'::timestamptz,'Demo -> Follow-up 1 is due at the Demo form''s meeting time, not the older Introduction date');

-- 7: a shown conditional date is used.
reset role;
select throws_ok($$set local role authenticated; select fms_form_due_resolution('{}','00000000-0000-4000-8000-000000000001',null,null,'form')$$,'42501',null,'the resolver is not callable from the browser');
select is((fms_form_due_resolution((select planned_time_rule from fms_stages where id=pg_temp.fx('demo')),pg_temp.fx('tenant'),pg_temp.fx('lead_b'),
  (select id from fms_instance_stages where fms_instance_id=pg_temp.fx('lead_b') and fms_stage_id=pg_temp.fx('intro')),'form',pg_temp.fx('intro'),
  '{"status":"demo_alt","alt_date":"2026-11-03"}')->>'dueAt')::timestamptz,'2026-11-03 23:59:59.999999 Asia/Kolkata'::timestamptz,'the conditional date counts when its condition is met');
select is(fms_form_due_resolution((select planned_time_rule from fms_stages where id=pg_temp.fx('demo')),pg_temp.fx('tenant'),pg_temp.fx('lead_b'),
  (select id from fms_instance_stages where fms_instance_id=pg_temp.fx('lead_b') and fms_stage_id=pg_temp.fx('intro')),'form',pg_temp.fx('intro'),
  '{"status":"demo","alt_date":"2026-11-03"}')->>'source','none','a skipped conditional date is never used, even if a value was sent');

set local role authenticated;
-- 9: a required deadline that is missing or malformed blocks the submission, with no downstream work.
insert into due_fixture values('lead_c',pg_temp.start('Amit Jain'));
select throws_ok($$select pg_temp.step(pg_temp.fx('lead_c'),'intro',jsonb_build_object('status','follow','assigned_to',pg_temp.fx('doer')))$$,'23514',
  'Enter a valid "Next Follow-up Date" in the form for step Introduction. The next step takes its due date from it.','a missing required deadline stops the submission');
select throws_ok($$select pg_temp.step(pg_temp.fx('lead_c'),'intro',jsonb_build_object('status','follow','assigned_to',pg_temp.fx('doer'),'next_date','2026-11-05','next_time','25:99'))$$,'23514',null,'a malformed time is refused, not guessed');
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=pg_temp.fx('lead_c') and fms_stage_id=pg_temp.fx('f1')),0,'no partial Follow-up 1 was created');
select isnt(pg_temp.visit(pg_temp.fx('lead_c'),'intro'),null,'Introduction is still open for the employee to correct');

-- 8: a missing optional date uses the configured fallback (TAT 120 minutes).
select pg_temp.step(pg_temp.fx('lead_c'),'intro',jsonb_build_object('status','follow','assigned_to',pg_temp.fx('doer'),'next_date','2026-11-04'));
select pg_temp.step(pg_temp.fx('lead_c'),'f1',jsonb_build_object('status','continue','assigned_to',pg_temp.fx('doer')));
select is(pg_temp.due(pg_temp.fx('lead_c'),'f2'),now()+interval '120 minutes','a missing optional date falls back to the configured TAT');
select is((select details->>'source' from fms_stage_logs where fms_instance_stage_id=pg_temp.visit(pg_temp.fx('lead_c'),'f2') and action='due_date_resolved'),'fallback','the fallback is recorded');

-- 15: a follow-up loop takes the new deadline from the visit that looped back.
insert into due_fixture values('lead_e',pg_temp.start('Neha Patel'));
select pg_temp.step(pg_temp.fx('lead_e'),'intro',jsonb_build_object('status','follow','assigned_to',pg_temp.fx('doer'),'next_date','2026-11-10','next_time','10:00'));
select pg_temp.step(pg_temp.fx('lead_e'),'f1',jsonb_build_object('status','continue','assigned_to',pg_temp.fx('doer'),'next_date','2026-11-12'));
select pg_temp.step(pg_temp.fx('lead_e'),'f2',jsonb_build_object('status','again','assigned_to',pg_temp.fx('doer'),'next_date','2026-11-20','next_time','09:00'));
select is((select visit_number from fms_instance_stages where id=pg_temp.visit(pg_temp.fx('lead_e'),'f1')),2,'the loop opened Follow-up 1 visit 2');
select is(pg_temp.due(pg_temp.fx('lead_e'),'f1'),'2026-11-20 09:00:00 Asia/Kolkata'::timestamptz,'visit 2 is due at the Follow-up 2 answer, not the first Introduction date');

-- 10: a valid past deadline is saved and is overdue at once.
insert into due_fixture values('lead_f',pg_temp.start('Karan Shah'));
select pg_temp.step(pg_temp.fx('lead_f'),'intro',jsonb_build_object('status','follow','assigned_to',pg_temp.fx('doer'),'next_date','2020-01-01','next_time','10:00'));
select is(pg_temp.due(pg_temp.fx('lead_f'),'f1'),'2020-01-01 10:00:00 Asia/Kolkata'::timestamptz,'a past deadline is kept as entered');

-- Due today: a date-only answer for today stays "today" until the day ends.
insert into due_fixture values('lead_g',pg_temp.start('Tina Shah'));
select pg_temp.step(pg_temp.fx('lead_g'),'intro',jsonb_build_object('status','follow','assigned_to',pg_temp.fx('doer'),'next_date',to_char(now() at time zone 'Asia/Kolkata','YYYY-MM-DD')));

-- 18: nobody can reschedule directly; the browser has no update grant on visits.
select throws_ok($$update fms_instance_stages set planned_datetime=now()+interval '30 days' where id=pg_temp.visit(pg_temp.fx('lead_a'),'f3')$$,'42501',null,'an employee cannot rewrite a task deadline directly');

-- Board ----------------------------------------------------------------------------------------
create temporary table board_result(name text primary key,value jsonb);
grant all on board_result to authenticated;
insert into board_result values('landing',get_fms_task_workspace('{}',0,50));
select is((select (f->>'overdue')::integer from board_result,jsonb_array_elements(value->'families') f where name='landing'),1,'the landing page counts the overdue Follow-up 1');
select is((select (f->>'dueToday')::integer from board_result,jsonb_array_elements(value->'families') f where name='landing'),(select count(*)::integer from fms_instance_stages w join fms_instances i on i.id=w.fms_instance_id where i.fms_flow_id=pg_temp.fx('flow') and pg_temp.fx('doer')=any(w.assigned_to) and w.status in ('pending','in_progress','in_review','overdue') and w.planned_datetime>=now() and (w.planned_datetime at time zone 'Asia/Kolkata')::date=(now() at time zone 'Asia/Kolkata')::date),'the landing page counts the work due today (end-of-day date and the 2-hour fallback)');
select is((select (f->>'active')::integer from board_result,jsonb_array_elements(value->'families') f where name='landing'),
  (select count(*)::integer from fms_instance_stages w join fms_instances i on i.id=w.fms_instance_id where i.fms_flow_id=pg_temp.fx('flow') and pg_temp.fx('doer')=any(w.assigned_to) and w.status in ('pending','in_progress','in_review','overdue')),
  'the landing count equals every open assignment of the employee');
insert into board_result values('board',get_fms_task_board(pg_temp.fx('family'),'{}',1));
select is((select value->>'name' from board_result where name='board'),'Instagram Online Sales Funnel','the board names the workflow');
select ok((select bool_and(s->>'stepType' is not null) and count(*) filter(where s->>'name' in ('Introduction','Demo','Follow-up 1','Follow-up 2','Follow-up 3'))=5 from board_result,jsonb_array_elements(value->'stages') s where name='board'),
  'every configured step is a column, with its type, even when empty');
select is((select (s->>'count')::integer from board_result,jsonb_array_elements(value->'stages') s where name='board' and s->>'name'='Follow-up 1'),
  (select count(*)::integer from fms_instance_stages where fms_stage_id=pg_temp.fx('f1') and pg_temp.fx('doer')=any(assigned_to) and status in ('pending','in_progress','in_review','overdue')),
  'the Follow-up 1 header count is exact');
select is((select jsonb_array_length(s->'records') from board_result,jsonb_array_elements(value->'stages') s where name='board' and s->>'name'='Follow-up 1'),1,'only the first page of cards is sent');
select is((select s#>>'{records,0,urgency}' from board_result,jsonb_array_elements(value->'stages') s where name='board' and s->>'name'='Follow-up 1'),'overdue','overdue work is first in its column');
select is((select (s->>'overdue')::integer from board_result,jsonb_array_elements(value->'stages') s where name='board' and s->>'name'='Follow-up 1'),1,'the column header counts overdue work');
select is((select (value#>>'{counts,dueToday}')::integer from board_result where name='board'),(select count(*)::integer from fms_instance_stages w join fms_instances i on i.id=w.fms_instance_id where i.fms_flow_id=pg_temp.fx('flow') and pg_temp.fx('doer')=any(w.assigned_to) and w.status in ('pending','in_progress','in_review','overdue') and w.planned_datetime>=now() and (w.planned_datetime at time zone 'Asia/Kolkata')::date=(now() at time zone 'Asia/Kolkata')::date),'the board counts work due today');
select ok((select count(*)::integer from fms_instance_stages w join fms_instances i on i.id=w.fms_instance_id where i.fms_flow_id=pg_temp.fx('flow') and pg_temp.fx('doer')=any(w.assigned_to) and w.status in ('pending','in_progress','in_review','overdue') and w.planned_datetime>=now() and (w.planned_datetime at time zone 'Asia/Kolkata')::date=(now() at time zone 'Asia/Kolkata')::date)>=1,'at least the end-of-day lead is due today');
select is((select jsonb_array_length(value->'records') from (select get_fms_task_stage_page(pg_temp.fx('family'),pg_temp.fx('flow'),pg_temp.fx('f1'),false,'{}',1,50) value) page),
  (select (s->>'count')::integer-1 from board_result,jsonb_array_elements(value->'stages') s where name='board' and s->>'name'='Follow-up 1'),'the next page returns the rest of the column');
select is((select count(*)::integer from jsonb_array_elements((select get_fms_task_stage_page(pg_temp.fx('family'),pg_temp.fx('flow'),pg_temp.fx('f1'),false,'{"due":"overdue"}',0,50)->'records')) r),1,'the overdue filter keeps only overdue work');
select is((select r->>'name' from jsonb_array_elements((select get_fms_task_stage_page(pg_temp.fx('family'),pg_temp.fx('flow'),pg_temp.fx('f1'),false,'{"due":"overdue"}',0,50)->'records')) r),'Karan Shah','cards carry the authorized customer name');
select ok((select bool_and((r->>'visitNumber')::integer>=1) and count(*)=count(distinct r->>'id') from jsonb_array_elements((select get_fms_task_stage_page(pg_temp.fx('family'),pg_temp.fx('flow'),pg_temp.fx('f1'),false,'{}',0,50)->'records')) r),'each card is one visit: no duplicate cards');
select is((select r->>'visitNumber' from jsonb_array_elements((select get_fms_task_stage_page(pg_temp.fx('family'),pg_temp.fx('flow'),pg_temp.fx('f1'),false,'{"query":"Neha"}',0,50)->'records')) r),'2','search finds the repeat visit, labelled visit 2');
select throws_ok($$select get_fms_task_board(pg_temp.fx('family'),'{"due":"soon"}',20)$$,'22023',null,'unknown board filters are refused');

-- Priority is business data; urgency never rewrites it.
reset role;
update fms_instances set priority='high' where id=pg_temp.fx('lead_g');
set local role authenticated;
select is((select r->>'name' from jsonb_array_elements((select get_fms_task_stage_page(pg_temp.fx('family'),pg_temp.fx('flow'),pg_temp.fx('f1'),false,'{"sort":"priority"}',0,50)->'records')) with ordinality r(r,n) where n=1),'Tina Shah','Highest priority sorting puts the high-priority lead first');
select is((select r->>'name' from jsonb_array_elements((select get_fms_task_stage_page(pg_temp.fx('family'),pg_temp.fx('flow'),pg_temp.fx('f1'),false,'{}',0,50)->'records')) with ordinality r(r,n) where n=1),'Karan Shah','Due soonest keeps overdue work first');
select is((select count(*)::integer from jsonb_array_elements((select get_fms_task_stage_page(pg_temp.fx('family'),pg_temp.fx('flow'),pg_temp.fx('f1'),false,'{"priority":"high"}',0,50)->'records')) r),1,'the priority filter works');
select is((select priority::text from fms_instances where id=pg_temp.fx('lead_f')),'medium','an overdue lead keeps its business priority');

-- Team scope follows the existing work-context rule.
select pg_temp.act('manager');
select is((select (value#>>'{counts,active}')::integer from (select get_fms_task_board(pg_temp.fx('family'),'{"scope":"all"}',20) value) x),
  (select count(*)::integer from fms_instance_stages w join fms_instances i on i.id=w.fms_instance_id where i.fms_flow_id=pg_temp.fx('flow') and cardinality(w.assigned_to)>0 and w.status in ('pending','in_progress','in_review','overdue')),
  'a branch manager sees the whole team''s open work');
select is((select (value#>>'{counts,active}')::integer from (select get_fms_task_board(pg_temp.fx('family'),jsonb_build_object('scope','all','assigneeId',pg_temp.fx('riya')::text),20) value) x),1,'the manager can filter by employee');
select pg_temp.act('riya');
select is((select (value#>>'{counts,active}')::integer from (select get_fms_task_board(pg_temp.fx('family'),'{"scope":"all"}',20) value) x),
  (select (value#>>'{counts,active}')::integer from (select get_fms_task_board(pg_temp.fx('family'),'{}',20) value) x),'an employee asking for the team still sees only their own work');
select pg_temp.act('outsider');
select is((select jsonb_array_length(value->'stages') from (select get_fms_task_board(pg_temp.fx('family'),'{"scope":"all"}',20) value) x),0,'another tenant sees no columns');
select is((select (value#>>'{counts,active}')::integer from (select get_fms_task_board(pg_temp.fx('family'),'{"scope":"all"}',20) value) x),0,'another tenant sees no counts');

-- 12 (End Nodes): closing a lead removes its work from the board.
select pg_temp.act('riya');
select pg_temp.step(pg_temp.fx('lead_a'),'f3',jsonb_build_object('status','lost','assigned_to',pg_temp.fx('riya')));
select is((select status::text from fms_instances where id=pg_temp.fx('lead_a')),'completed','the End Node closed the lead automatically');
select is((select count(*)::integer from jsonb_array_elements((select get_fms_task_board(pg_temp.fx('family'),'{}',50)->'stages')) s,jsonb_array_elements(s->'records') r where r#>>'{target,instanceId}'=pg_temp.fx('lead_a')::text),0,'no card remains for the closed lead');

select * from finish();
rollback;
