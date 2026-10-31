begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table auto_fixture(name text primary key,id uuid);
grant select,insert,update on auto_fixture to authenticated;

-- Start -> Introduction -> Follow-up 1 -> Follow-up 2 (-> Follow-up 1 again) -> Lead Closed.
-- No step has a deadline or a formDue rule (the production default). Follow-up 2 chose "No due date".
do $$
declare t uuid; b uuid; d uuid; a uuid; u uuid; doer uuid; f uuid; flow uuid; person text;
  s_start uuid; s_intro uuid; s_f1 uuid; s_f2 uuid; s_tat uuid; e_lost uuid;
  assign jsonb:='{"mode":"previous_form","sources":[],"allowHandoff":false,"followFormAssignee":true,"fallbackRule":{"type":"previous_step_doer"}}';
begin
  insert into tenants(name,slug) values('Auto due test','auto-due-test') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','ADU') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','ADU') returning id into d;
  foreach person in array array['doer'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-autodue@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
      values(t,a,b,d,'Auto '||person,'ADU-'||person,person||'-autodue@test.local','staff'::user_role,'active',true) returning id into u;
    insert into auto_fixture values(person,u),(person||'_auth',a);
  end loop;
  select id into doer from auto_fixture where name='doer';
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by) values(t,'Lead update',1,'draft',true,doer,doer) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,conditional_logic) values
    (f,'status','Client status','text',0,null),(f,'customer_name','Customer Name','text',1,null),
    (f,'assigned_to','Assigned To','user_dropdown',2,null),
    (f,'dm_date','DM RECEIVED DATE','date',3,null),
    (f,'appt_date','APPOINTMENT IS SET FOR','date',4,'{"fieldKey":"status","operator":"equals","value":"demo"}'),
    (f,'next_date','NEXT FOLLOW UP DATE','date',5,'{"kind":"any","rules":[{"fieldKey":"status","operator":"equals","value":"follow"},{"fieldKey":"status","operator":"equals","value":"continue"},{"fieldKey":"status","operator":"equals","value":"again"},{"fieldKey":"status","operator":"equals","value":"both"}]}'),
    (f,'next_time','Follow-up Time','text',6,null),
    (f,'callback_date','Call back date','date',7,'{"fieldKey":"status","operator":"equals","value":"both"}');
  update form_templates set lifecycle='published' where id=f;
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version)
    values(t,gen_random_uuid(),1,'Automatic due funnel','tenant','draft',true,doer,doer,2) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'start','Start form','form',0,true,'{"deadlineEnabled":false}',f) returning id into s_start;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'intro','Introduction','task',1,true,jsonb_build_object('deadlineEnabled',false,'timingMethod','completion_date','dueDate','','assignment',assign),f) returning id into s_intro;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'f1','Follow-up 1','task',2,true,jsonb_build_object('deadlineEnabled',false,'timingMethod','completion_date','dueDate','','assignment',assign),f) returning id into s_f1;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'f2','Follow-up 2','task',3,true,jsonb_build_object('deadlineEnabled',false,'autoFormDue',false,'timingMethod','completion_date','dueDate','','assignment',assign),f) returning id into s_f2;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'tat','Quote','task',4,true,jsonb_build_object('deadlineEnabled',true,'timingMethod','tat_hours','tatMinutes',120,'assignment',assign),f) returning id into s_tat;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values
    (flow,'lead_closed','Lead Closed','end',5,true,'{"deadlineEnabled":false,"terminal":{"outcome":"lost"}}') returning id into e_lost;
  insert into fms_branch_rules(fms_stage_id,sort_order,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,label) values
    (s_intro,0,'form_answer','status','status','equals','follow',s_f1,null),(s_intro,1,'form_answer','status','status','equals','both',s_f1,null),
    (s_intro,2,'form_answer','status','status','equals','demo',s_tat,null),(s_intro,3,'form_answer','status','status','equals','lost',e_lost,null),
    (s_f1,0,'form_answer','status','status','equals','continue',s_f2,null),(s_f1,1,'form_answer','status','status','equals','lost',e_lost,null),
    (s_f2,0,'form_answer','status','status','equals','again',s_f1,null),(s_f2,1,'form_answer','status','status','equals','lost',e_lost,null),
    (s_tat,0,'form_answer','status','status','equals','lost',e_lost,null);
  update fms_stages set default_next_stage_id=s_intro where id=s_start;
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) values(s_start,'specific_user',doer,0);
  insert into auto_fixture values('tenant',t),('flow',flow),('form',f),('intro',s_intro),('f1',s_f1),('f2',s_f2),('tat',s_tat);
end $$;

create function pg_temp.fx(p text) returns uuid language sql as $$ select id from auto_fixture where name=p $$;
create function pg_temp.visit(p_instance uuid,p_key text) returns uuid language sql as $$
  select w.id from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=p_instance and s.stage_key=p_key
    and w.status in ('pending','in_progress','in_review','overdue') order by w.visit_number desc limit 1 $$;
create function pg_temp.due(p_instance uuid,p_key text) returns timestamptz language sql as $$
  select w.planned_datetime from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=p_instance and s.stage_key=p_key
    order by w.visit_number desc limit 1 $$;
create function pg_temp.log(p_instance uuid,p_key text) returns jsonb language sql as $$
  select l.details from fms_stage_logs l where l.fms_instance_stage_id=(select w.id from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id
    where w.fms_instance_id=p_instance and s.stage_key=p_key order by w.visit_number desc limit 1) and l.action='due_date_resolved' $$;
create function pg_temp.step(p_instance uuid,p_key text,p_answers jsonb) returns void language sql as $$
  select submit_fms_form_and_progress_with_audit(pg_temp.fx('form'),p_answers,'fms_stage',pg_temp.visit(p_instance,p_key),gen_random_uuid()) $$;
create function pg_temp.start(p_name text,p_dm text) returns uuid language sql as $$
  select (submit_form_and_start_fms_with_audit(pg_temp.fx('form'),jsonb_build_object('status','new','customer_name',p_name,'assigned_to',pg_temp.fx('doer'),'dm_date',p_dm))->>'instance_id')::uuid $$;
grant execute on function pg_temp.fx(text),pg_temp.visit(uuid,text),pg_temp.due(uuid,text),pg_temp.log(uuid,text),pg_temp.step(uuid,text,jsonb),pg_temp.start(text,text) to authenticated;

-- Pure rules ---------------------------------------------------------------------------------
select ok(fms_due_question_name('NEXT FOLLOW UP DATE') and fms_due_question_name('APPOINTMENT IS SET FOR') and fms_due_question_name('Follow-up date')
  and fms_due_question_name('Call back date'),'follow-up, next, appointment and call-back questions are due-date questions');
select ok(not fms_due_question_name('DM RECEIVED DATE') and not fms_due_question_name('Date of birth') and not fms_due_question_name('Last visit date')
  and not fms_due_question_name('Order date'),'received, birth, last-visit and unnamed dates are never due dates');
select ok(fms_auto_form_due_applies('{"deadlineEnabled":false}','task'),'a person step with the deadline off uses the automatic date');
select ok(not fms_auto_form_due_applies('{"deadlineEnabled":false,"autoFormDue":false}','task'),'"No due date" turns the automatic date off');
select ok(not fms_auto_form_due_applies('{"deadlineEnabled":true,"timingMethod":"tat_hours","tatMinutes":60}','task'),'an explicit timing rule keeps priority');
select ok(not fms_auto_form_due_applies('{"deadlineEnabled":false,"formDue":{"sources":[],"onMissing":"none"}}','task'),'an explicit form-answer rule keeps priority');
select ok(not fms_auto_form_due_applies('{"deadlineEnabled":false}','end') and not fms_auto_form_due_applies('{"deadlineEnabled":false}','decision'),'automatic steps and End Nodes never get one');
select lives_ok($$select assert_fms_flow_publishable(pg_temp.fx('flow'))$$,'a workflow with no deadline settings still publishes');
update fms_flows set status='published' where id=pg_temp.fx('flow');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select id::text from auto_fixture where name='doer_auth'),true);

select throws_ok($$select fms_auto_form_due(pg_temp.fx('tenant'),gen_random_uuid(),gen_random_uuid())$$,'42501',null,'the browser cannot call the resolver directly');
select throws_ok($$select fms_due_question_name('x')$$,'42501',null,'the browser cannot call the private name rule');

-- Start form only records the DM received date: Introduction gets no due date.
insert into auto_fixture values('lead_a',pg_temp.start('Rahul Shah','2026-10-01'));
select is(pg_temp.due(pg_temp.fx('lead_a'),'intro'),null,'DM RECEIVED DATE is a past event, so Introduction has no due date');
select is(pg_temp.log(pg_temp.fx('lead_a'),'intro'),null,'no due-date log row when nothing was found');

-- Introduction -> Follow-up 1: the shown NEXT FOLLOW UP DATE; the hidden appointment answer is ignored.
select pg_temp.step(pg_temp.fx('lead_a'),'intro',jsonb_build_object('status','follow','assigned_to',pg_temp.fx('doer'),'next_date','2026-11-05','appt_date','2026-11-20'));
select is(pg_temp.due(pg_temp.fx('lead_a'),'f1'),'2026-11-05 23:59:59.999999 Asia/Kolkata'::timestamptz,'Follow-up 1 is due at the end of the next follow-up date (India time)');
select is(pg_temp.log(pg_temp.fx('lead_a'),'f1')->>'source','form_answer','the visit records that the date came from the form');
select is(pg_temp.log(pg_temp.fx('lead_a'),'f1')->>'dateFieldKey','next_date','the visit records which question set it');
select is(pg_temp.log(pg_temp.fx('lead_a'),'f1')->>'automatic','true','the visit records that no setting was needed');

-- Follow-up 1 -> Follow-up 2: Follow-up 2 chose "No due date".
select pg_temp.step(pg_temp.fx('lead_a'),'f1',jsonb_build_object('status','continue','assigned_to',pg_temp.fx('doer'),'next_date','2026-11-07','next_time','3:30 PM'));
select is(pg_temp.due(pg_temp.fx('lead_a'),'f2'),null,'a step set to "No due date" stays undated');

-- Follow-up 2 -> Follow-up 1 again: date plus the separate time question; past date is overdue at once.
select pg_temp.step(pg_temp.fx('lead_a'),'f2',jsonb_build_object('status','again','assigned_to',pg_temp.fx('doer'),'next_date','2026-01-10','next_time','3:30 PM'));
select is(pg_temp.due(pg_temp.fx('lead_a'),'f1'),'2026-01-10 15:30:00 Asia/Kolkata'::timestamptz,'the second Follow-up 1 visit uses the date and its time question');
select ok((get_fms_task_workspace('{}')->'counts'->>'overdue')::integer>=1,'a past follow-up date shows as overdue at once');
select is((select planned_datetime from fms_instance_stages where fms_instance_id=pg_temp.fx('lead_a') and fms_stage_id=pg_temp.fx('f1') and status='completed'),
  '2026-11-05 23:59:59.999999 Asia/Kolkata'::timestamptz,'the finished visit keeps its own due date');

-- Two different follow-up dates answered: ambiguous, no guess. The same date twice is fine.
insert into auto_fixture values('lead_b',pg_temp.start('Priya Mehta','2026-10-02'));
select pg_temp.step(pg_temp.fx('lead_b'),'intro',jsonb_build_object('status','both','assigned_to',pg_temp.fx('doer'),'next_date','2026-11-05','callback_date','2026-11-06'));
select is(pg_temp.due(pg_temp.fx('lead_b'),'f1'),null,'two different answered due dates are never guessed between');
insert into auto_fixture values('lead_c',pg_temp.start('Anil Rao','2026-10-03'));
select pg_temp.step(pg_temp.fx('lead_c'),'intro',jsonb_build_object('status','both','assigned_to',pg_temp.fx('doer'),'next_date','2026-11-08','callback_date','2026-11-08'));
select is(pg_temp.due(pg_temp.fx('lead_c'),'f1'),'2026-11-08 23:59:59.999999 Asia/Kolkata'::timestamptz,'the same date answered twice is used');

-- An unanswered follow-up date never blocks the submission and never invents a date.
-- (An impossible date such as 2026-02-30 is already refused by the form itself.)
insert into auto_fixture values('lead_d',pg_temp.start('Meera Nair','2026-10-04'));
select lives_ok($$select pg_temp.step(pg_temp.fx('lead_d'),'intro',jsonb_build_object('status','follow','assigned_to',pg_temp.fx('doer')))$$,'an unanswered date does not block the form');
select is(pg_temp.due(pg_temp.fx('lead_d'),'f1'),null,'an unanswered date gives no due date');

-- An explicit TAT step keeps its rule even though the form has an appointment date.
insert into auto_fixture values('lead_e',pg_temp.start('Kiran Das','2026-10-05'));
select pg_temp.step(pg_temp.fx('lead_e'),'intro',jsonb_build_object('status','demo','assigned_to',pg_temp.fx('doer'),'appt_date','2026-12-01'));
select ok(pg_temp.due(pg_temp.fx('lead_e'),'tat') between now()+interval '119 minutes' and now()+interval '121 minutes','the TAT step still uses its 2-hour rule');

select * from finish();
rollback;
