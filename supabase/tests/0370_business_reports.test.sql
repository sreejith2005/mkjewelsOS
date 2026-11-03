begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table br_fixture(name text primary key,id uuid);
grant select,insert,update on br_fixture to authenticated;

-- Synthetic company: one branch with an admin, a manager, two staff and an HR user; a
-- second company's staff member must never appear.
do $$
declare t uuid; t2 uuid; b uuid; d uuid; b2 uuid; d2 uuid; a uuid; u uuid; person text; role text;
  f uuid; f2 uuid; fam uuid; ff uuid; flow uuid; s_start uuid; s_intro uuid; s_follow uuid; e_won uuid;
begin
  insert into tenants(name,slug) values('Business reports','business-reports') returning id into t;
  insert into tenants(name,slug) values('Other company','business-reports-other') returning id into t2;
  insert into branches(tenant_id,name,code) values(t,'Main','BRM') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','BRS') returning id into d;
  insert into branches(tenant_id,name,code) values(t2,'Other','BRX') returning id into b2;
  insert into departments(tenant_id,branch_id,name,code) values(t2,b2,'Other','BRX') returning id into d2;
  foreach person in array array['admin','manager','staff','colleague','hr','outsider'] loop
    role:=case person when 'admin' then 'admin' when 'manager' then 'manager' when 'hr' then 'hr' else 'staff' end;
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-br@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
      values(case when person='outsider' then t2 else t end,a,case when person='outsider' then b2 else b end,case when person='outsider' then d2 else d end,
        'BR '||person,'BR-'||person,person||'-br@test.local',role::user_role,'active',true) returning id into u;
    insert into br_fixture values(person,u),(person||'_auth',a);
  end loop;
  select id into u from br_fixture where name='staff';

  -- A standalone enquiry form, version 1, with a choice, a phone, a hidden-unless-rings question and a file.
  fam:=gen_random_uuid();
  insert into form_templates(tenant_id,family_id,name,version,lifecycle,is_active,created_by,updated_by) values(t,fam,'Walk-in enquiry',1,'draft',true,u,u) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,options,conditional_logic) values
    (f,'customer_name','Customer Name','text',0,null,null),
    (f,'customer_number','Customer Number','phone',1,null,null),
    (f,'interest','Requirement','select',2,'[{"value":"rings","label":"Rings"},{"value":"chains","label":"Chains"}]',null),
    (f,'ring_size','Ring size','text',3,null,'{"fieldKey":"interest","operator":"equals","value":"rings"}'),
    (f,'budget','Budget','number',4,null,null),
    (f,'photo','Reference photo','file',5,null,null);
  update form_templates set lifecycle='published' where id=f;
  insert into br_fixture values('form',f),('family',fam);

  -- A one-step form-started FMS with a loop: Introduction -> Follow-up -> Introduction -> Won.
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by) values(t,'Client status',1,'draft',true,u,u) returning id into ff;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(ff,'status','Client status','text',0),(ff,'note','Remark','text',1);
  update form_templates set lifecycle='published' where id=ff;
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by)
    values(t,gen_random_uuid(),1,'Instagram enquiry','tenant','draft',true,u,u) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'start','Start form','form',0,true,'{"deadlineEnabled":false}',ff) returning id into s_start;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'intro','Introduction','form',1,true,'{"deadlineEnabled":false}',ff) returning id into s_intro;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'follow','Follow-up','form',2,true,'{"deadlineEnabled":false}',ff) returning id into s_follow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(flow,'won','Sales Closed','end',3,true,'{"deadlineEnabled":false,"terminal":{"outcome":"won"}}') returning id into e_won;
  insert into fms_branch_rules(fms_stage_id,sort_order,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,label) values
    (s_intro,0,'form_answer','status','status','equals','follow_up',s_follow,'Follow-up'),(s_intro,1,'form_answer','status','status','equals','paid',e_won,'Paid'),
    (s_follow,0,'form_answer','status','status','equals','intro',s_intro,'Back to introduction');
  update fms_stages set default_next_stage_id=s_intro where id=s_start;
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) select id,'specific_user',u,0 from fms_stages where fms_flow_id=flow and step_type<>'end';
  update fms_flows set status='published' where id=flow;
  insert into br_fixture values('tenant',t),('branch',b),('flow',flow),('flow_family',(select family_id from fms_flows where id=flow)),('fms_form',ff);

  -- Regular tasks due yesterday: one done on time, one done late, one still open (overdue).
  insert into task_instances(tenant_id,branch_id,department_id,task_type,title,priority,status,planned_datetime,actual_datetime,created_by,source) values
    (t,b,d,'delegation','BR on-time task','medium','completed',now()-interval '1 day',now()-interval '1 day 1 hour',u,'manual'),
    (t,b,d,'delegation','BR late task','high','completed',now()-interval '1 day',now()-interval '20 hours',u,'manual'),
    (t,b,d,'delegation','BR open task','low','pending',now()-interval '1 day',null,u,'manual'),
    (t,b,d,'delegation','BR old task','low','pending',now()-interval '10 days',null,u,'manual');
  insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active)
    select id,u,'doer',true,true from task_instances where tenant_id=t and title like 'BR %';
end $$;

create function pg_temp.visit(p_instance uuid,p_key text) returns uuid language sql as $$
  select w.id from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=p_instance and s.stage_key=p_key and w.status in ('pending','in_progress','in_review','overdue') order by w.visit_number desc limit 1 $$;
create function pg_temp.step(p_instance uuid,p_key text,p_status text) returns void language sql as $$
  select submit_fms_form_and_progress_with_audit((select id from br_fixture where name='fms_form'),jsonb_build_object('status',p_status,'note','Note at '||p_key),'fms_stage',pg_temp.visit(p_instance,p_key),gen_random_uuid()) $$;
create function pg_temp.as_user(p_name text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',(select id::text from br_fixture where name=p_name||'_auth'),true),set_config('request.jwt.claim.role','authenticated',true) $$;
create function pg_temp.report(p_key text,p_filters jsonb) returns jsonb language sql as $$
  select get_report_data(p_key,jsonb_build_object('from',to_char((now() at time zone 'Asia/Kolkata')::date-30,'YYYY-MM-DD'),'to',to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD'),'page_size',100)||p_filters) $$;
grant execute on function pg_temp.visit(uuid,text),pg_temp.step(uuid,text,text),pg_temp.as_user(text),pg_temp.report(text,jsonb) to authenticated;

-- Submit through the real contracts as the staff member.
select pg_temp.as_user('staff');
set local role authenticated;
select lives_ok($$select submit_form_with_audit((select id from br_fixture where name='form'),'{"customer_name":"Asha Synthetic","customer_number":"9876543210","interest":"chains","ring_size":"stale 12","budget":150000}'::jsonb)$$,
  'a standalone form is submitted through the normal contract');
do $$ declare r uuid; begin
  r:=(submit_form_and_start_fms_with_audit((select id from br_fixture where name='fms_form'),'{"status":"new","note":"Instagram DM"}'::jsonb)->>'instance_id')::uuid;
  insert into br_fixture values('instance',r);
  perform pg_temp.step(r,'intro','follow_up');
  perform pg_temp.step(r,'follow','intro');
  perform pg_temp.step(r,'intro','paid');
end $$;
reset role;

-- An older submission holding an attachment; its storage path must never be exported.
insert into form_submissions(tenant_id,branch_id,department_id,form_template_id,data,submitted_by,submitted_at)
select t.id,b.id,(select department_id from user_profiles where id=s.id),(select id from br_fixture where name='form'),
  '{"customer_name":"Ravi Synthetic","interest":"rings","ring_size":"14","photo":[{"name":"design.jpg","path":"tenant/private/design.jpg"}]}'::jsonb,s.id,now()-interval '2 days'
from (select id from br_fixture where name='tenant') t,(select id from br_fixture where name='branch') b,(select id from br_fixture where name='staff') s;

-- Version 2 of the same form (a revision in the same family) adds a question.
do $$ declare f2 uuid; u uuid:=(select id from br_fixture where name='staff'); begin
  insert into form_templates(tenant_id,family_id,name,version,lifecycle,is_active,created_by,updated_by)
    values((select id from br_fixture where name='tenant'),(select id from br_fixture where name='family'),'Walk-in enquiry',2,'draft',true,u,u) returning id into f2;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,options,conditional_logic)
    select f2,field_key,field_name,field_type,sort_order,options,conditional_logic from form_fields where form_template_id=(select id from br_fixture where name='form');
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f2,'city','City','text',6);
  update form_templates set lifecycle='archived' where id=(select id from br_fixture where name='form');
  update form_templates set lifecycle='published' where id=f2;
  insert into br_fixture values('form_v2',f2);
end $$;
select pg_temp.as_user('staff');
set local role authenticated;
select lives_ok($$select submit_form_with_audit((select id from br_fixture where name='form_v2'),'{"customer_name":"Meena Synthetic","interest":"rings","ring_size":"10","city":"Kochi"}'::jsonb)$$,'a version 2 submission is accepted');
reset role;

-- ---------------------------------------------------------------- All Form Submissions
select pg_temp.as_user('admin');
set local role authenticated;
select is((pg_temp.report('form_answers',jsonb_build_object('form_family_id',(select id from br_fixture where name='family')))->>'total')::int,3,
  'every submission of the chosen form appears, standalone and older versions included');
select ok(exists(select 1 from jsonb_array_elements(pg_temp.report('form_answers','{}')->'rows') r where r->>'form_name'='Client status' and r->>'linked_to' is not null and r->>'stage_name' is not null),
  'FMS form submissions appear with their FMS reference and stage');
select is((select r->>'answers' from jsonb_array_elements(pg_temp.report('form_answers','{}')->'rows') r where r->>'answers' like '%Asha%'),
  'Customer Name: Asha Synthetic | Customer Number: 9876543210 | Requirement: Chains | Budget: 150000',
  'answers use question labels and option labels, and omit a stale answer hidden by its condition');
select is((select r->>'q:ring_size' from jsonb_array_elements(pg_temp.report('form_answers',jsonb_build_object('form_family_id',(select id from br_fixture where name='family')))->'rows') r where r->>'q:customer_name'='Asha Synthetic'),
  null,'a hidden question exports blank in the column view');
select is((select r->>'q:photo' from jsonb_array_elements(pg_temp.report('form_answers',jsonb_build_object('form_family_id',(select id from br_fixture where name='family')))->'rows') r where r->>'q:customer_name'='Ravi Synthetic'),
  'design.jpg','an attachment shows its file name only');
select ok(position('tenant/private' in pg_temp.report('form_answers','{}')::text)=0,'no attachment storage path leaves the database');
select is((select string_agg(c->>'label',',' order by n) from jsonb_array_elements(pg_temp.report('form_answers',jsonb_build_object('form_family_id',(select id from br_fixture where name='family')))->'columns') with ordinality x(c,n) where c->>'key' like 'q:%'),
  'Customer Name,Customer Number,Requirement,Ring size,Budget,Reference photo,City','one stable column per question across versions, newest wording first');
select is((select (c->>'phone')::boolean from jsonb_array_elements(pg_temp.report('form_answers',jsonb_build_object('form_family_id',(select id from br_fixture where name='family')))->'columns') c where c->>'key'='q:customer_number'),
  true,'phone questions are marked so the export keeps them as text');
select is((select r->>'q:city' from jsonb_array_elements(pg_temp.report('form_answers',jsonb_build_object('form_family_id',(select id from br_fixture where name='family')))->'rows') r where r->>'q:customer_name'='Asha Synthetic'),
  null,'a question added in a later version is blank for older submissions');
reset role;

-- Scope: the colleague sees only their own submissions; the other company sees nothing; HR has no form report.
select pg_temp.as_user('colleague');
set local role authenticated;
select is((pg_temp.report('form_answers','{}')->>'total')::int,0,'a staff member does not see a colleague''s form answers');
reset role;
select pg_temp.as_user('outsider');
set local role authenticated;
select is((pg_temp.report('form_answers','{}')->>'total')::int,0,'another company sees no submissions');
reset role;
select pg_temp.as_user('hr');
set local role authenticated;
select throws_ok($$select pg_temp.report('form_answers','{}')$$,'42501','Report access denied','HR cannot open form answers');
reset role;

-- ---------------------------------------------------------------- FMS Workflow Journey
select pg_temp.as_user('manager');
set local role authenticated;
select is((select r->>'status'||'/'||(r->>'final_outcome')||'/'||(r->>'stage_visits') from jsonb_array_elements(pg_temp.report('fms_workflow_summary','{}')->'rows') r),
  'completed/won/4','a completed FMS has one summary row with its outcome and executed visit count');
select is((select string_agg((r->>'stage_name')||'#'||(r->>'visit_number'),',' order by n) from jsonb_array_elements(pg_temp.report('fms_stage_visits','{}')->'rows') with ordinality x(r,n)),
  'Start form#1,Introduction#1,Follow-up#1,Introduction#2','a loop gives a separate stage-visit row per visit, in the order they ran');
select is((select r->>'answers' from jsonb_array_elements(pg_temp.report('fms_stage_visits','{}')->'rows') r where r->>'stage_name'='Follow-up'),
  'Client status: intro | Remark: Note at follow','a stage visit carries the answers submitted at that step');
select is((select r->>'final_outcome' from jsonb_array_elements(pg_temp.report('fms_stage_visits','{}')->'rows') r where r->>'stage_name'='Introduction' and r->>'visit_number'='2'),
  'won','the visit that closed the workflow carries the final outcome');
select is((select (r->>'visits')::int from jsonb_array_elements(pg_temp.report('fms_stage_performance','{}')->'rows') r where r->>'stage_name'='Introduction'),2,'stage performance counts both Introduction visits');
select is((pg_temp.report('fms_workflow_summary','{"status":"won"}')->>'total')::int,1,'the outcome filter selects won workflows');
select is((pg_temp.report('fms_workflow_summary','{"status":"lost"}')->>'total')::int,0,'and excludes others');
reset role;
select pg_temp.as_user('colleague');
set local role authenticated;
select is((pg_temp.report('fms_stage_visits','{}')->>'total')::int,0,'an unassigned staff member sees no stage visits');
reset role;

-- ---------------------------------------------------------------- Tasks and performance
select pg_temp.as_user('manager');
set local role authenticated;
select is((pg_temp.report('work_register','{"work_kind":"task"}')->>'total')::int,4,'the task register lists regular tasks due in the period');
select is((pg_temp.report('work_register','{"work_kind":"task","status":"delayed"}')->'rows'->0->>'title'),'BR late task','the timing filter selects the late completion');
select is((pg_temp.report('work_register','{"work_kind":"fms"}')->>'total')::int,
  (select count(*)::int from fms_instance_stages w join fms_instances i on i.id=w.fms_instance_id
    where i.tenant_id=(select id from br_fixture where name='tenant') and w.planned_datetime is not null
      and (w.planned_datetime at time zone 'Asia/Kolkata')::date between (now() at time zone 'Asia/Kolkata')::date-30 and (now() at time zone 'Asia/Kolkata')::date),
  'FMS steps are due work exactly when their (half-day) deadline falls in the period');
select is((select r->>'assigned'||'/'||(r->>'completed')||'/'||(r->>'overdue')||'/'||(r->>'on_time_completed')||'/'||(r->>'delayed_completed')||'/'||(r->>'completion_rate')
  from jsonb_array_elements(pg_temp.report('employee_task_performance','{"work_kind":"task"}')->'rows') r where r->>'employee_name'='BR staff'),
  '4/2/2/1/1/50.0','employee task counts follow the documented formulas');
-- Reconcile against the source tables directly.
select is((select (r->>'assigned')::int from jsonb_array_elements(pg_temp.report('employee_task_performance','{"work_kind":"task"}')->'rows') r where r->>'employee_name'='BR staff'),
  (select count(*)::int from task_instances ti join task_assignees ta on ta.task_instance_id=ti.id and ta.is_active join br_fixture f on f.name='staff' and f.id=ta.user_profile_id
    where ti.deleted_at is null and ti.status<>'rejected' and coalesce(ti.revised_datetime,ti.planned_datetime)>=((now() at time zone 'Asia/Kolkata')::date-30)::timestamp at time zone 'Asia/Kolkata'),
  'assigned reconciles with the source task records');
select is((pg_temp.report('employee_task_performance',jsonb_build_object('user_profile_id',(select id from br_fixture where name='colleague'),'work_kind','task'))->'rows'->0->>'assigned')::int,0,
  'the employee filter narrows the preview to that employee');
reset role;
select pg_temp.as_user('staff');
set local role authenticated;
select throws_ok($$select pg_temp.report('employee_task_performance','{}')$$,'42501','Report access denied','staff cannot open employee performance');
reset role;

-- ---------------------------------------------------------------- Date range fix and exports
select pg_temp.as_user('manager');
set local role authenticated;
select is((get_report_data('task_operations',jsonb_build_object('from',to_char((now() at time zone 'Asia/Kolkata')::date-30,'YYYY-MM-DD'),'to',to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD')))->>'total')::int,4,
  'an earlier report honours From/To without a preset instead of showing today only');
select lives_ok($$select request_report_export_with_audit('form_answers',jsonb_build_object('from',to_char((now() at time zone 'Asia/Kolkata')::date-30,'YYYY-MM-DD'),'to',to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD'),'form_family_id',(select id from br_fixture where name='family')),gen_random_uuid())$$,
  'a new report can be queued in the existing private export queue');
reset role;
select set_config('request.jwt.claim.sub','',true);
select is((select count(*)::int from export_logs where report_key='form_answers' and user_profile_id=(select id from br_fixture where name='manager')),1,'the export job is recorded for its requester');
select is((report_rows_for_profile((select id from br_fixture where name='manager'),'form_answers',
  jsonb_build_object('from',to_char((now() at time zone 'Asia/Kolkata')::date-30,'YYYY-MM-DD'),'to',to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD')),0,500)->>'total')::int,7,
  'the worker path returns every authorized submission (standalone and FMS), not just one page');
-- The real worker contract: claim the queued job, then read a batch as the service role.
select set_config('request.jwt.claim.role','service_role',true);
create temporary table br_claim as select * from claim_report_exports(5,'00000000-0000-4000-8000-0000000000aa'::uuid,10) where report_key='form_answers';
select is((select count(*)::int from br_claim),1,'the export worker claims the queued form-answer export');
select is((select jsonb_array_length(get_report_export_batch(id,0,500)->'rows') from br_claim),3,'the worker batch holds every submission of the chosen form');
select is((select get_report_export_batch(id,0,500)->'columns'->9->>'label' from br_claim),'Customer Name','the worker batch carries the question headers for the CSV');
select set_config('request.jwt.claim.role','',true);
insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect) select id,(select id from br_fixture where name='tenant'),'reports.export','deny' from br_fixture where name='manager';
select throws_ok($$select report_rows_for_profile((select id from br_fixture where name='manager'),'form_answers','{}'::jsonb,0,500)$$,'42501','Requester no longer authorized',
  'a queued export re-checks the requester''s export permission when it runs');

-- Filter choices are names in scope.
select pg_temp.as_user('admin');
set local role authenticated;
select ok(get_report_filter_options()->'forms' @> jsonb_build_array(jsonb_build_object('id',(select id from br_fixture where name='family'),'name','Walk-in enquiry')),'form choices list form families by name');
select ok(jsonb_array_length(get_report_filter_options((select id from br_fixture where name='flow_family'))->'stages')=3,'stage choices exclude End steps');
reset role;

select * from finish();
rollback;
