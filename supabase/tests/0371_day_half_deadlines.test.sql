begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- ---------------------------------------------------------------------------------------------
-- The policy: boundaries, month/year end, and the session timezone never matters.
-- ---------------------------------------------------------------------------------------------
create function pg_temp.dh(p_local text) returns text language sql as $$
  select to_char(day_half_deadline((p_local||' Asia/Kolkata')::timestamptz) at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI')
    ||' '||day_half_of(day_half_deadline((p_local||' Asia/Kolkata')::timestamptz)) $$;
select is(pg_temp.dh('2026-11-03 11:00'),'2026-11-03 21:00 second_half','11:00 -> today 9 PM');
select is(pg_temp.dh('2026-11-03 12:30'),'2026-11-03 21:00 second_half','12:30 -> today 9 PM (owner example)');
select is(pg_temp.dh('2026-11-03 14:59:59.999'),'2026-11-03 21:00 second_half','2:59:59 PM -> today 9 PM');
select is(pg_temp.dh('2026-11-03 15:00'),'2026-11-04 15:00 first_half','3:00 PM exactly -> tomorrow 3 PM');
select is(pg_temp.dh('2026-11-03 16:30'),'2026-11-04 15:00 first_half','4:30 PM -> tomorrow 3 PM');
select is(pg_temp.dh('2026-11-03 17:45'),'2026-11-04 15:00 first_half','5:45 PM -> tomorrow 3 PM (owner example)');
select is(pg_temp.dh('2026-11-03 20:59'),'2026-11-04 15:00 first_half','8:59 PM -> tomorrow 3 PM');
select is(pg_temp.dh('2026-11-03 21:00'),'2026-11-04 15:00 first_half','9:00 PM -> tomorrow 3 PM');
select is(pg_temp.dh('2026-11-03 23:59'),'2026-11-04 15:00 first_half','11:59 PM -> tomorrow 3 PM');
select is(pg_temp.dh('2026-11-04 00:00'),'2026-11-04 21:00 second_half','midnight starts a new day');
select is(pg_temp.dh('2026-11-30 18:00'),'2026-12-01 15:00 first_half','month end rolls into the next month');
select is(pg_temp.dh('2026-12-31 15:00'),'2027-01-01 15:00 first_half','year end rolls into the next year');
select is(pg_temp.dh('2028-02-28 16:00'),'2028-02-29 15:00 first_half','leap day is a normal day');
select is(pg_temp.dh('2026-11-07 16:00'),'2026-11-08 15:00 first_half','weekends are not skipped');
set local timezone='America/New_York';
select is(day_half_deadline('2026-11-03 09:40:00+00'),'2026-11-04 15:00 Asia/Kolkata'::timestamptz,'the session timezone does not change the deadline');
set local timezone='UTC';
select is(day_half_of('2026-11-03 07:30:00+00'),null,'1:00 PM is not a half-day deadline');

-- ---------------------------------------------------------------------------------------------
-- FMS fixture: Start (form) -> Follow-up (auto form date) -> Call (no date question) -> End.
-- ---------------------------------------------------------------------------------------------
create temporary table dh_fixture(name text primary key,id uuid);
grant select,insert on dh_fixture to authenticated;
do $$
declare t uuid; b uuid; d uuid; a uuid; u uuid; f uuid; f2 uuid; flow uuid; s_start uuid; s_follow uuid; s_call uuid; s_review uuid; e_end uuid; person text;
begin
  insert into tenants(name,slug) values('Half day test','half-day-test') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','HDT') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','HDT') returning id into d;
  foreach person in array array['doer','manager'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-hd@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
      values(t,a,b,d,'HD '||person,'HD-'||person,person||'-hd@test.local',case when person='manager' then 'manager' else 'staff' end::user_role,'active',true) returning id into u;
    insert into dh_fixture values(person,u),(person||'_auth',a);
  end loop;
  select id into u from dh_fixture where name='doer';
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by) values(t,'Lead step',1,'draft',true,u,u) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values
    (f,'status','Client status','text',0),(f,'next_date','Next Follow-up Date','date',1),(f,'next_time','Follow-up Time','text',2);
  update form_templates set lifecycle='published' where id=f;
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by) values(t,'Call note',1,'draft',true,u,u) returning id into f2;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f2,'status','Client status','text',0),(f2,'note','Note','text',1);
  update form_templates set lifecycle='published' where id=f2;
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version)
    values(t,gen_random_uuid(),1,'Half day funnel','tenant','draft',true,u,u,2) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'start','Start','form',0,true,'{"deadlineEnabled":false}',f) returning id into s_start;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'follow','Follow-up','form',1,true,'{"assignment":{"mode":"previous_form","sources":[],"allowHandoff":false,"followFormAssignee":true,"fallbackRule":{"type":"previous_step_doer"}},"deadlineEnabled":false}',f) returning id into s_follow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'call','Call','form',2,true,'{"assignment":{"mode":"previous_form","sources":[],"allowHandoff":false,"followFormAssignee":true,"fallbackRule":{"type":"previous_step_doer"}},"deadlineEnabled":false}',f2) returning id into s_call;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'review','Review','form',3,true,'{"assignment":{"mode":"previous_form","sources":[],"allowHandoff":false,"followFormAssignee":true,"fallbackRule":{"type":"previous_step_doer"}},"formDue":{"sources":[{"stageKey":"call","dateFieldKey":"note"}],"onMissing":"require"}}',f2) returning id into s_review;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values
    (flow,'done','Done','end',4,true,'{"deadlineEnabled":false,"terminal":{"outcome":"won"}}') returning id into e_end;
  update fms_stages set default_next_stage_id=s_follow where id=s_start;
  update fms_stages set default_next_stage_id=s_call where id=s_follow;
  insert into fms_branch_rules(fms_stage_id,sort_order,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,label) values
    (s_call,0,'form_answer','status','status','equals','won',e_end,null),(s_call,1,'form_answer','status','status','equals','review',s_review,null);
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order)
    select id,'specific_user',u,0 from fms_stages where fms_flow_id=flow and step_type<>'end';
  update fms_flows set status='published' where id=flow;
  insert into dh_fixture values('tenant',t),('flow',flow),('form',f),('call_form',f2),('follow',s_follow),('call',s_call),('review',s_review),('done',e_end);
end $$;

create function pg_temp.fx(p text) returns uuid language sql as $$ select id from dh_fixture where name=p $$;
create function pg_temp.visit(p_instance uuid,p_key text) returns fms_instance_stages language sql as $$
  select w.* from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=p_instance and s.stage_key=p_key
    order by w.visit_number desc limit 1 $$;
create function pg_temp.act(p_person text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',(select id::text from dh_fixture where name=p_person||'_auth'),true),
         set_config('request.jwt.claim.role','authenticated',true);
  select null::void $$;
grant execute on function pg_temp.fx(text),pg_temp.visit(uuid,text),pg_temp.act(text) to authenticated;

set local role authenticated;
select pg_temp.act('doer');
insert into dh_fixture values('lead_a',(submit_form_and_start_fms_with_audit(pg_temp.fx('form'),'{"status":"new"}'::jsonb)->>'instance_id')::uuid);

-- The form-started first step is completed history: it never receives an artificial deadline.
select is((pg_temp.visit(pg_temp.fx('lead_a'),'start')).planned_datetime,null,'the completed starting step is not given a deadline');
-- No date question answered: Follow-up takes the half-day deadline from this (server) moment.
select is((pg_temp.visit(pg_temp.fx('lead_a'),'follow')).planned_datetime,day_half_deadline(now()),'a step with no usable deadline takes the half-day deadline');
select ok((pg_temp.visit(pg_temp.fx('lead_a'),'follow')).status::text in ('pending','in_progress'),'and is actionable at once (activation is not delayed)');

-- An explicit form date and time is kept exactly (owner example: 8 Nov 7:00 PM).
select lives_ok($$select submit_fms_form_and_progress_with_audit(pg_temp.fx('form'),'{"status":"go","next_date":"2026-11-08","next_time":"7:00 PM"}'::jsonb,
  'fms_stage',(pg_temp.visit(pg_temp.fx('lead_a'),'follow')).id,gen_random_uuid())$$,'Follow-up is submitted');
select is((pg_temp.visit(pg_temp.fx('lead_a'),'call')).planned_datetime,'2026-11-08 19:00 Asia/Kolkata'::timestamptz,'an explicit form deadline wins over the half-day rule');
reset role;
select is((select l.details->>'source' from fms_stage_logs l where l.fms_instance_stage_id=(pg_temp.visit(pg_temp.fx('lead_a'),'call')).id and l.action='due_date_resolved'),
  'form_answer','the explicit date is logged as a form answer');
select is((select l.details->>'source' from fms_stage_logs l where l.fms_instance_stage_id=(pg_temp.visit(pg_temp.fx('lead_a'),'follow')).id and l.action='due_date_resolved'),
  'day_half','the half-day deadline is logged with its source');
select is((select (l.details->>'referenceAt')::timestamptz from fms_stage_logs l where l.fms_instance_stage_id=(pg_temp.visit(pg_temp.fx('lead_a'),'follow')).id and l.action='due_date_resolved'),
  now(),'and the server moment it was calculated from');
set local role authenticated;
select pg_temp.act('doer');

-- onMissing:require still refuses a submission instead of falling back.
select throws_ok($$select submit_fms_form_and_progress_with_audit(pg_temp.fx('call_form'),'{"status":"review","note":"no date here"}'::jsonb,
  'fms_stage',(pg_temp.visit(pg_temp.fx('lead_a'),'call')).id,gen_random_uuid())$$,'23514',null,'a "require" form deadline is still enforced, not replaced');

-- Routing to an End node creates no human work and no deadline.
select lives_ok($$select submit_fms_form_and_progress_with_audit(pg_temp.fx('call_form'),'{"status":"won","note":"closed"}'::jsonb,
  'fms_stage',(pg_temp.visit(pg_temp.fx('lead_a'),'call')).id,gen_random_uuid())$$,'Call routes to the End node');
select is((pg_temp.visit(pg_temp.fx('lead_a'),'done')).planned_datetime,null,'an End node gets no deadline');
select is((pg_temp.visit(pg_temp.fx('lead_a'),'call')).planned_datetime,'2026-11-08 19:00 Asia/Kolkata'::timestamptz,'completed work keeps its deadline');
reset role;

-- Non-person steps never take the fallback; person steps always do when nothing else resolves.
select is(fms_form_due_resolution('{"deadlineEnabled":false}',null,null,null,'end')->>'dueAt',null,'end step: no deadline');
select is(fms_form_due_resolution('{"deadlineEnabled":false}',null,null,null,'branch')->>'dueAt',null,'branch step: no deadline');
select is(fms_form_due_resolution('{"deadlineEnabled":false}',null,null,null,'parallel_join')->>'dueAt',null,'parallel join: no deadline');
select is(fms_form_due_resolution('{"deadlineEnabled":false}',null,null,null,'notification')->>'dueAt',null,'notification step: no deadline');
select is((fms_form_due_resolution('{"deadlineEnabled":false,"autoFormDue":false}',null,null,null,'approval')->>'dueAt')::timestamptz,day_half_deadline(now()),
  'automatic-date opt-out still gets the half-day deadline');
select is((fms_form_due_resolution('{"timingMethod":"tat_hours","tatMinutes":120}',pg_temp.fx('tenant'),null,null,'task')->>'source'),'rule','a configured timing rule keeps precedence');

-- ---------------------------------------------------------------------------------------------
-- Starting-form assignments.
-- ---------------------------------------------------------------------------------------------
insert into fms_starter_assignments(tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,assigned_by,created_at)
  select pg_temp.fx('tenant'),pg_temp.fx('flow'),s.id,pg_temp.fx('form'),pg_temp.fx('manager'),pg_temp.fx('doer'),'2026-11-03 16:30 Asia/Kolkata'
  from fms_stages s where s.fms_flow_id=pg_temp.fx('flow') and s.stage_key='start';
select is((select due_at from fms_starter_assignments where user_profile_id=pg_temp.fx('manager')),'2026-11-04 15:00 Asia/Kolkata'::timestamptz,
  'a starting form assigned at 4:30 PM is due 3 PM the next day');
set local role authenticated;
select pg_temp.act('manager');
reset role;
select is((select due_at from fms_workspace_rows('{}') where starting),'2026-11-04 15:00 Asia/Kolkata'::timestamptz,'the FMS workspace shows the starting-form deadline');
select is((select bucket from fms_workspace_rows('{}') where starting),
  case when '2026-11-04 15:00 Asia/Kolkata'::timestamptz<now() then 'overdue' else 'pending' end,'and shows it overdue once the deadline passes');
update fms_starter_assignments set due_at=now()-interval '1 minute' where user_profile_id=pg_temp.fx('manager');
select is((select bucket from fms_workspace_rows('{}') where starting),'overdue','a passed starting-form deadline is overdue');
update fms_starter_assignments set due_at='2026-11-04 15:00 Asia/Kolkata' where user_profile_id=pg_temp.fx('manager');
set local role authenticated;
select throws_ok($$update fms_starter_assignments set due_at=now() where user_profile_id=pg_temp.fx('manager')$$,'42501',null,'a user cannot change a starting-form deadline');
reset role;

-- ---------------------------------------------------------------------------------------------
-- CRM walk-in tasks.
-- ---------------------------------------------------------------------------------------------
insert into task_instances(tenant_id,task_type,title,priority,planned_datetime,source,created_at,created_by,updated_by)
  values(pg_temp.fx('tenant'),'delegation','HD walk-in A','high','2026-11-03 12:30 Asia/Kolkata','crm_walkin','2026-11-03 12:30 Asia/Kolkata',pg_temp.fx('doer'),pg_temp.fx('doer')),
        (pg_temp.fx('tenant'),'delegation','HD walk-in B','high','2026-11-03 17:45 Asia/Kolkata','crm_walkin','2026-11-03 17:45 Asia/Kolkata',pg_temp.fx('doer'),pg_temp.fx('doer'));
insert into task_instances(tenant_id,task_type,title,priority,planned_datetime,due_datetime,source,created_by,updated_by)
  values(pg_temp.fx('tenant'),'delegation','HD walk-in C','high',now(),'2026-11-10 10:00 Asia/Kolkata','crm_walkin',pg_temp.fx('doer'),pg_temp.fx('doer')),
        (pg_temp.fx('tenant'),'delegation','HD manual','medium','2026-11-03 12:30 Asia/Kolkata',null,'manual',pg_temp.fx('doer'),pg_temp.fx('doer'));
select is((select due_datetime from task_instances where title='HD walk-in A'),'2026-11-03 21:00 Asia/Kolkata'::timestamptz,'walk-in at 12:30 PM is due 9 PM');
select is((select due_datetime from task_instances where title='HD walk-in B'),'2026-11-04 15:00 Asia/Kolkata'::timestamptz,'walk-in at 5:45 PM is due 3 PM tomorrow');
select is((select due_datetime from task_instances where title='HD walk-in C'),'2026-11-10 10:00 Asia/Kolkata'::timestamptz,'an explicit deadline is kept');
select is((select due_datetime from task_instances where title='HD manual'),null,'other task sources are untouched');

-- ---------------------------------------------------------------------------------------------
-- On-demand duty enforced by a manager: no template time -> half-day; template time kept.
-- ---------------------------------------------------------------------------------------------
insert into task_templates(tenant_id,branch_id,department_id,title,task_type,recurrence_rule,planned_time,due_time,priority,default_assignee_type,default_assignee_user_id,
  checklist_items,is_active,schedule_kind,assignment_status,trigger_label,created_by,updated_by)
select pg_temp.fx('tenant'),u.branch_id,u.department_id,x.title,'delegation','FREQ=DAILY',x.p,x.d,'medium','specific_user',u.id,'[]',false,'as_required','assigned','Per Customer',u.id,u.id
from user_profiles u, (values('HD duty no time',null::time,null::time),('HD duty timed','11:00'::time,'23:58'::time)) x(title,p,d) where u.id=pg_temp.fx('doer');
set local role authenticated;
select pg_temp.act('manager');
insert into dh_fixture select 'duty_'||title,start_on_demand_task_with_audit(id) from task_templates where title in ('HD duty no time','HD duty timed');
reset role;
select is((select due_datetime from task_instances where id=pg_temp.fx('duty_HD duty no time')),day_half_deadline(now()),'an enforced duty without a time takes the half-day deadline (not 8 PM)');
select is((select due_datetime from task_instances where id=pg_temp.fx('duty_HD duty timed')),
  case when (((now() at time zone 'Asia/Kolkata')::date+time '23:58') at time zone 'Asia/Kolkata')<now()+interval '30 minutes'
    then greatest(((now() at time zone 'Asia/Kolkata')::date+time '23:59') at time zone 'Asia/Kolkata',now()+interval '5 minutes')
    else ((now() at time zone 'Asia/Kolkata')::date+time '23:58') at time zone 'Asia/Kolkata' end,
  'an enforced duty keeps its template time');

-- ---------------------------------------------------------------------------------------------
-- Reconciliation: owner-only, dry run first, idempotent batches, completed work untouched.
-- ---------------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated','reconcile_day_half_deadlines(boolean,integer,uuid[],uuid[])','execute'),'staff cannot run the reconciliation');
select ok(not has_function_privilege('service_role','reconcile_day_half_deadlines(boolean,integer,uuid[],uuid[])','execute'),'the API service role cannot run it');
select ok(not has_function_privilege('anon','day_half_deadline(timestamptz)','execute'),'anonymous callers cannot use the policy function');

-- Legacy rows from before 0371: an undated open visit, an undated completed visit, an undated starter, an undated walk-in.
-- (lead_a's Follow-up is completed history: undated here, it must stay undated.)
update fms_instance_stages set planned_datetime=null where id=(pg_temp.visit(pg_temp.fx('lead_a'),'follow')).id;
insert into dh_fixture values('lead_b',gen_random_uuid());
do $$ declare i uuid; v uuid; begin
  insert into fms_instances(tenant_id,fms_flow_id,title,priority,status,started_by,branch_id,department_id,context,reference_number)
    select tenant_id,fms_flow_id,'HD legacy','medium','active',started_by,branch_id,department_id,'{}','HD-LEGACY-1' from fms_instances where id=pg_temp.fx('lead_a') returning id into i;
  insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,activated_at)
    values(i,pg_temp.fx('follow'),'pending',array[pg_temp.fx('doer')],'2026-11-02 12:30 Asia/Kolkata') returning id into v;
  update fms_instance_stages set planned_datetime=null where id=v;
  insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,activated_at)
    values(i,pg_temp.fx('call'),'pending',array[pg_temp.fx('doer')],'2026-11-02 17:45 Asia/Kolkata') returning id into v;
  update fms_instance_stages set planned_datetime=null where id=v;
  update dh_fixture set id=i where name='lead_b';
end $$;
update fms_starter_assignments set due_at=null where user_profile_id=pg_temp.fx('manager');
update task_instances set due_datetime=null where title='HD walk-in A';
insert into task_instances(tenant_id,task_type,title,priority,planned_datetime,source,status,actual_datetime,created_by,updated_by)
  values(pg_temp.fx('tenant'),'delegation','HD walk-in done','high','2026-11-01 12:00 Asia/Kolkata','manual','completed','2026-11-01 13:00 Asia/Kolkata',pg_temp.fx('doer'),pg_temp.fx('doer'));
update task_instances set source='crm_walkin' where title='HD walk-in done';

-- Imported-style schedules: two 13:00 / 20:00 (ambiguous), one verified as First Half.
insert into task_templates(tenant_id,title,task_type,recurrence_rule,planned_time,due_time,priority,default_assignee_type,default_assignee_user_id,checklist_items,is_active,schedule_kind,assignment_status,created_by,updated_by)
select pg_temp.fx('tenant'),x.title,'delegation','FREQ=DAILY','11:00',x.d,'medium','specific_user',pg_temp.fx('doer'),'[]',true,'daily','assigned',pg_temp.fx('doer'),pg_temp.fx('doer')
from (values('HD sched 13',time '13:00'),('HD sched 20',time '20:00'),('HD sched verified',time '13:00')) x(title,d);
insert into task_instances(tenant_id,task_template_id,task_type,title,priority,planned_datetime,scheduled_date,status,actual_datetime,source,created_by,updated_by)
select t.tenant_id,t.id,'delegation',t.title||' '||x.n,'medium',(x.day+time '11:00') at time zone 'Asia/Kolkata',x.day,x.status::task_status,x.actual,'checklist',t.created_by,t.created_by
from task_templates t,(values(1,date '2026-11-02','completed','2026-11-02 12:00 Asia/Kolkata'::timestamptz),(2,date '2026-11-03','pending',null),(3,date '2026-11-04','pending',null)) x(n,day,status,actual)
where t.title='HD sched verified';
update task_instances set revised_datetime='2026-11-04 18:00 Asia/Kolkata' where title='HD sched verified 3';
insert into dh_fixture select 'verified',id from task_templates where title='HD sched verified';

create temporary table dh_counts as select
  (select count(*) from audit_logs) audits,
  (select planned_datetime from fms_instance_stages where id=(pg_temp.visit(pg_temp.fx('lead_b'),'follow')).id) follow_due;
select is(reconcile_day_half_deadlines(false,500,array[pg_temp.fx('verified')])->>'mode','dry_run','the default is a dry run');
select is((select count(*) from audit_logs),(select audits from dh_counts),'a dry run writes nothing');
select is((select planned_datetime from fms_instance_stages where id=(pg_temp.visit(pg_temp.fx('lead_b'),'follow')).id),null,'a dry run changes no deadline');
select is(reconcile_day_half_deadlines(false,500,array[pg_temp.fx('verified')])#>>'{remaining,fms_visits_without_deadline,count}','2','the dry run counts undated open FMS work');
select is(reconcile_day_half_deadlines(false,500,array[pg_temp.fx('verified')])#>>'{remaining,verified_schedules,first_half}','1','and the verified First Half schedule');
select is(reconcile_day_half_deadlines(false,500,array[pg_temp.fx('verified')])#>>'{remaining,verified_schedules,open_occurrences}','1',
  'only open, unrevised occurrences would change');
select ok((reconcile_day_half_deadlines(false)#>>'{ambiguous_active_schedules,due_13_00}')::integer>=2,'13:00 schedules without provenance are reported as ambiguous');
select ok((reconcile_day_half_deadlines(false)#>>'{ambiguous_active_schedules,due_20_00}')::integer>=1,'so are 20:00 schedules');
select throws_ok($$select reconcile_day_half_deadlines(true,500,array[pg_temp.fx('verified')],array[pg_temp.fx('verified')])$$,'22023',null,'a schedule cannot be both halves');
select throws_ok($$select reconcile_day_half_deadlines(true,0)$$,'22023',null,'the batch size is bounded');

-- Batch of one per category, then the rest.
select is(reconcile_day_half_deadlines(true,1,array[pg_temp.fx('verified')])#>>'{applied,fms_visits}','1','batches are bounded');
select is(reconcile_day_half_deadlines(true,1,array[pg_temp.fx('verified')])#>>'{applied,fms_visits}','1','the next batch continues');
select is(reconcile_day_half_deadlines(true,500,array[pg_temp.fx('verified')])->'applied',
  '{"fms_visits":0,"starting_forms":0,"crm_walkin_tasks":0,"schedules":0,"schedule_occurrences":0}'::jsonb,'a repeated run changes nothing (idempotent)');
select is((pg_temp.visit(pg_temp.fx('lead_b'),'follow')).planned_datetime,'2026-11-02 21:00 Asia/Kolkata'::timestamptz,
  'open FMS work activated at 12:30 PM is dated 9 PM that day');
select is((pg_temp.visit(pg_temp.fx('lead_b'),'call')).planned_datetime,'2026-11-03 15:00 Asia/Kolkata'::timestamptz,
  'open FMS work activated at 5:45 PM is dated 3 PM the next day');
select is((pg_temp.visit(pg_temp.fx('lead_a'),'follow')).planned_datetime,null,'completed history is never dated by the backfill');
select is((pg_temp.visit(pg_temp.fx('lead_a'),'start')).planned_datetime,null,'nor is the completed starting step');
select is((select due_at from fms_starter_assignments where user_profile_id=pg_temp.fx('manager')),'2026-11-04 15:00 Asia/Kolkata'::timestamptz,'the undated starting form is dated from when it was assigned');
select is((select due_datetime from task_instances where title='HD walk-in A'),'2026-11-03 21:00 Asia/Kolkata'::timestamptz,'the undated walk-in is dated from when it was created');
select is((select due_datetime from task_instances where title='HD walk-in done'),null,'a completed walk-in is not touched');
select is((select due_time from task_templates where id=pg_temp.fx('verified')),'15:00'::time,'the verified schedule is now due at 3 PM');
select is((select due_time from task_templates where title='HD sched 13'),'13:00'::time,'an unverified 13:00 schedule is not changed');
select is((select due_datetime from task_instances where title='HD sched verified 2'),'2026-11-03 15:00 Asia/Kolkata'::timestamptz,'its open occurrence moves to 3 PM');
select is((select due_datetime from task_instances where title='HD sched verified 1'),'2026-11-02 13:00 Asia/Kolkata'::timestamptz,'its completed occurrence keeps its 1 PM history');
select is((select revised_datetime from task_instances where title='HD sched verified 3'),'2026-11-04 18:00 Asia/Kolkata'::timestamptz,'a manually revised deadline is kept');
select is((select count(*)::integer from task_instances where task_template_id=pg_temp.fx('verified')),3,'no task is created or duplicated');
select is((select count(*)::integer from audit_logs where action in ('day_half_deadline_backfilled','day_half_schedule_reconciled')),5,
  'every change is audited once: 2 FMS steps, 1 starting form, 1 walk-in, 1 schedule');
select is((select count(*)::integer from audit_logs where action='day_half_schedule_reconciled' and record_id=pg_temp.fx('verified')),1,'the schedule change is audited once');

select * from finish();
rollback;
