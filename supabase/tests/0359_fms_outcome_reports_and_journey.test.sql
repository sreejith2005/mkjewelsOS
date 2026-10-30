begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table rep_fixture(name text primary key,id uuid);
grant select,insert,update on rep_fixture to authenticated;

-- The Instagram sales funnel: one shared Lead Closed End Node receives routes from every step.
do $$
declare t uuid; t2 uuid; b uuid; d uuid; b2 uuid; d2 uuid; a uuid; u uuid; f uuid; flow uuid; person text; k text;
  s_start uuid; s_intro uuid; s_demo uuid; s_f1 uuid; s_f2 uuid; s_f3 uuid; s_neg uuid; s_order uuid; e_won uuid; e_lost uuid; e_dnc uuid;
begin
  insert into tenants(name,slug) values('Report test','report-test') returning id into t;
  insert into tenants(name,slug) values('Report other','report-other') returning id into t2;
  insert into branches(tenant_id,name,code) values(t,'Main','END') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','END') returning id into d;
  insert into branches(tenant_id,name,code) values(t2,'Other','ENX') returning id into b2;
  insert into departments(tenant_id,branch_id,name,code) values(t2,b2,'Other','ENX') returning id into d2;
  foreach person in array array['doer','outsider','admin'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-rep@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
      values(case when person='outsider' then t2 else t end,a,case when person='outsider' then b2 else b end,case when person='outsider' then d2 else d end,
        'End '||person,'REP-'||person,person||'-rep@test.local',case when person='admin' then 'admin' else 'staff' end::user_role,'active',true) returning id into u;
    insert into rep_fixture values(person,u),(person||'_auth',a);
  end loop;
  select id into u from rep_fixture where name='doer';
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by) values(t,'Client status',1,'draft',true,u,u) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f,'status','Client status','text',0),(f,'note','Remark','text',1);
  update form_templates set lifecycle='published' where id=f;
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by)
    values(t,gen_random_uuid(),1,'Instagram sales funnel','tenant','draft',true,u,u) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'start','Start form','form',0,true,'{"deadlineEnabled":false}',f) returning id into s_start;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'intro','Introduction','form',1,true,'{"deadlineEnabled":false}',f) returning id into s_intro;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'demo','Demo','form',2,true,'{"deadlineEnabled":false}',f) returning id into s_demo;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'f1','Follow-up 1','form',3,true,'{"deadlineEnabled":false}',f) returning id into s_f1;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'f2','Follow-up 2','form',4,true,'{"deadlineEnabled":false}',f) returning id into s_f2;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'f3','Follow-up 3','form',5,true,'{"deadlineEnabled":false}',f) returning id into s_f3;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'negotiation','Negotiation','form',6,true,'{"deadlineEnabled":false}',f) returning id into s_neg;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'order','Order & Payment','form',7,true,'{"deadlineEnabled":false}',f) returning id into s_order;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(flow,'sales_closed','Sales Closed','end',8,true,'{"deadlineEnabled":false,"terminal":{"outcome":"won"}}') returning id into e_won;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(flow,'lead_closed','Lead Closed','end',9,true,'{"deadlineEnabled":false,"terminal":{"outcome":"lost","reasonCode":"not_interested"}}') returning id into e_lost;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(flow,'dnc','Do Not Contact','end',10,true,'{"deadlineEnabled":false,"terminal":{"outcome":"do_not_contact"}}') returning id into e_dnc;
  insert into fms_branch_rules(fms_stage_id,sort_order,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,label) values
    (s_start,0,'form_answer','status','status','equals','dnc',e_dnc,'Asked not to be contacted'),
    (s_intro,0,'form_answer','status','status','equals','interested',s_demo,'Interested'),(s_intro,1,'form_answer','status','status','equals','follow_up',s_f1,'Follow-up'),
    (s_intro,2,'form_answer','status','status','equals','NOT INTERESTED CLOSE THIS LEAD',e_lost,'Not interested'),(s_intro,3,'form_answer','status','status','equals','dnc',e_dnc,'Do not contact'),
    (s_demo,0,'form_answer','status','status','equals','negotiation',s_neg,null),(s_demo,1,'form_answer','status','status','equals','order',s_order,null),
    (s_demo,2,'form_answer','status','status','equals','follow_up',s_f1,null),(s_demo,3,'form_answer','status','status','equals','NOT INTERESTED CLOSE THIS LEAD',e_lost,'Not interested'),
    (s_f1,0,'form_answer','status','status','equals','continue',s_f2,null),(s_f1,1,'form_answer','status','status','equals','demo',s_demo,null),(s_f1,2,'form_answer','status','status','equals','NOT INTERESTED CLOSE THIS LEAD',e_lost,null),
    (s_f2,0,'form_answer','status','status','equals','continue',s_f3,null),(s_f2,1,'form_answer','status','status','equals','NOT INTERESTED CLOSE THIS LEAD',e_lost,null),
    (s_f3,0,'form_answer','status','status','equals','intro',s_intro,null),(s_f3,1,'form_answer','status','status','equals','NOT INTERESTED CLOSE THIS LEAD',e_lost,null),
    (s_neg,0,'form_answer','status','status','equals','order',s_order,null),(s_neg,1,'form_answer','status','status','equals','follow_up',s_f1,null),(s_neg,2,'form_answer','status','status','equals','NOT INTERESTED CLOSE THIS LEAD',e_lost,null),
    (s_order,0,'form_answer','status','status','equals','paid',e_won,'Payment received'),(s_order,1,'form_answer','status','status','equals','pending',s_neg,null),(s_order,2,'form_answer','status','status','equals','NOT INTERESTED CLOSE THIS LEAD',e_lost,null);
  update fms_stages set default_next_stage_id=s_intro where id=s_start;
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) select id,'specific_user',u,0 from fms_stages where fms_flow_id=flow and step_type<>'end';
  insert into rep_fixture values('tenant',t),('flow',flow),('form',f),('lead_closed',e_lost),('sales_closed',e_won),('dnc',e_dnc),('order',s_order),('intro',s_intro);
end $$;

create function pg_temp.visit(p_instance uuid,p_key text) returns uuid language sql as $$
  select w.id from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=p_instance and s.stage_key=p_key and w.status in ('pending','in_progress','in_review','overdue') order by w.visit_number desc limit 1 $$;
create function pg_temp.step(p_instance uuid,p_key text,p_status text) returns void language sql as $$
  select submit_fms_form_and_progress_with_audit((select id from rep_fixture where name='form'),jsonb_build_object('status',p_status,'note','Remark at '||p_key),'fms_stage',pg_temp.visit(p_instance,p_key),gen_random_uuid()) $$;
create function pg_temp.start(p_status text) returns uuid language sql as $$
  select (submit_form_and_start_fms_with_audit((select id from rep_fixture where name='form'),jsonb_build_object('status',p_status))->>'instance_id')::uuid $$;
create function pg_temp.outcome(p_instance uuid) returns text language sql as $$ select outcome||':'||end_stage_key from fms_instance_outcomes where fms_instance_id=p_instance $$;
grant execute on function pg_temp.visit(uuid,text),pg_temp.step(uuid,text,text),pg_temp.start(text),pg_temp.outcome(uuid) to authenticated;


update fms_flows set status='published' where id=(select id from rep_fixture where name='flow');
select set_config('request.jwt.claim.sub',(select id::text from rep_fixture where name='doer_auth'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
-- 100 leads: 30 won, 20 lost (5 of them after a repeated follow-up), 10 do not contact, 40 running.
do $$
declare n integer; r uuid;
begin
  for n in 1..100 loop
    r:=pg_temp.start('new');
    insert into rep_fixture values('lead_'||n,r);
    if n<=30 then perform pg_temp.step(r,'intro','interested'); perform pg_temp.step(r,'demo','order'); perform pg_temp.step(r,'order','paid');
    elsif n<=45 then perform pg_temp.step(r,'intro','NOT INTERESTED CLOSE THIS LEAD');
    elsif n<=50 then perform pg_temp.step(r,'intro','follow_up'); perform pg_temp.step(r,'f1','demo'); perform pg_temp.step(r,'demo','follow_up'); perform pg_temp.step(r,'f1','NOT INTERESTED CLOSE THIS LEAD');
    elsif n<=60 then perform pg_temp.step(r,'intro','dnc');
    end if;
  end loop;
end $$;
create temporary table rep(value jsonb);
grant select,insert,delete on rep to authenticated;
insert into rep select get_fms_flow_report((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),'{}');
select is((select format('%s/%s/%s/%s/%s/%s/%s',value->>'started',value->>'running',value->>'won',value->>'lost',value->>'doNotContact',value->>'completed',value->>'conversionPercent') from rep),'100/40/30/20/10/60/30.0','KPIs: 100 started, 40 running, 30 won, 20 lost, 10 do not contact, 60 completed, 30% conversion');
select is((select string_agg((e->>'stageKey')||'='||(e->>'instances'),',' order by e->>'stageKey') from rep,jsonb_array_elements(value->'endNodes') e),'dnc=10,lead_closed=20,sales_closed=30','each End Node counts its unique instances');
select is((select string_agg((e->>'stageKey')||'='||(e->>'instances')||'/'||(e->>'visits'),',' order by e->>'stageKey') from rep,jsonb_array_elements(value->'stages') e where e->>'stageKey' in ('intro','demo','f1','order','lead_closed')),
  'demo=35/35,f1=5/10,intro=100/100,lead_closed=20/20,order=30/30','stage reach counts unique leads; a repeated follow-up adds a visit, not a lead');
select is((select sum((e->>'instances')::integer)::integer from rep,jsonb_array_elements(value->'endNodes') e),(select count(*)::integer from fms_instance_outcomes where fms_flow_id=(select id from rep_fixture where name='flow')),'End Node totals equal the distinct finalized instances');
delete from rep;
insert into rep select get_fms_flow_report((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),'{"outcome":"lost"}');
select is((select value->>'started' from rep),'20','the outcome filter narrows the cohort');
delete from rep;
insert into rep select get_fms_flow_report((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),jsonb_build_object('flowId',gen_random_uuid()::text));
select is((select value->>'started' from rep),'0','another version filter excludes these instances');
reset role;
update fms_instances set started_at=now()-interval '40 days' where id in (select id from rep_fixture where name in ('lead_91','lead_92','lead_93','lead_94','lead_95'));
set local role authenticated;
delete from rep;
insert into rep select get_fms_flow_report((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),jsonb_build_object('from',to_char((now() at time zone 'Asia/Kolkata')::date-7,'YYYY-MM-DD'),'to',to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD')));
select is((select (value->>'started')||'/'||(value->>'running')||'/'||(value#>>'{completedInPeriod,completed}') from rep),'95/35/60','the period is a start cohort; completed-in-period is reported separately');
select throws_ok($q$select get_fms_flow_report((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),'{"from":"2026-10-30","to":"2026-10-01"}')$q$,'22023',null,'a reversed period is refused');
select throws_ok($q$select get_fms_flow_report((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),'{"evil":"1"}')$q$,'22023',null,'unknown filters are refused');

-- Library cards.
select is((select format('%s/%s/%s/%s/%s',c->>'running',c->>'won',c->>'lost',c->>'doNotContact',c->>'mine') from jsonb_array_elements(get_fms_library_outcomes()) c where c->>'familyId'=(select family_id::text from fms_flows where id=(select id from rep_fixture where name='flow'))),'40/30/20/10/40','library counts come from the same records');

-- The record list: paged, filtered, searchable.
select is((get_fms_flow_records((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),'{}',0,25)->>'total'),'100','every visible instance is listed');
select is(jsonb_array_length(get_fms_flow_records((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),'{}',0,25)->'records'),25,'a page holds 25 records');
select is((get_fms_flow_records((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),'{"status":"won"}',0,25)->>'total'),'30','status filter: won');
select is((get_fms_flow_records((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),'{"status":"running","stageKey":"intro"}',0,25)->>'total'),'40','stage filter: running leads at Introduction');
select is((get_fms_flow_records((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),jsonb_build_object('query',(select reference_number from fms_instances where id=(select id from rep_fixture where name='lead_7'))),0,25)->>'total'),'1','search by reference');
select is((select r#>>'{current,0,stageName}' from jsonb_array_elements(get_fms_flow_records((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),'{"status":"running"}',0,1)->'records') r),'Introduction','a running record names its current step');
select is((select (r->>'endStageName')||'|'||(r->>'outcome')||'|'||jsonb_array_length(r->'current') from jsonb_array_elements(get_fms_flow_records((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),'{"status":"lost"}',0,1)->'records') r),'Lead Closed|lost|0','a closed record shows its ending and no open work');
select throws_ok($q$select get_fms_flow_records((select family_id from fms_flows where id=(select id from rep_fixture where name='flow')),'{}',0,500)$q$,'22023',null,'oversized pages are refused');

-- The journey of a looping lost lead, from persisted visits.
select is((select string_agg((v->>'stageKey')||'#'||(v->>'visitNumber'),',' order by n) from jsonb_array_elements(get_fms_instance_journey((select id from rep_fixture where name='lead_46'))->'visits') with ordinality x(v,n)),
  'start#1,intro#1,f1#1,demo#1,f1#2,lead_closed#1','the journey lists the executed visits in order with visit numbers');
select is((select (j#>>'{outcome,stageName}')||'|'||(j#>>'{outcome,outcome}')||'|'||(j#>>'{outcome,sourceStageName}')||'|'||(j#>>'{outcome,sourceQuestion}')||'|'||(j#>>'{outcome,sourceValue}') from (select get_fms_instance_journey((select id from rep_fixture where name='lead_46')) j) x),
  'Lead Closed|lost|Follow-up 1|Client status|NOT INTERESTED CLOSE THIS LEAD','the journey explains why it ended');
select is((select v#>>'{answers,0,value}' from jsonb_array_elements(get_fms_instance_journey((select id from rep_fixture where name='lead_46'))->'visits') v where v->>'stageKey'='intro'),'follow_up','the saved routing answer is shown on its step');
select is((select count(*)::integer from jsonb_array_elements(get_fms_instance_journey((select id from rep_fixture where name='lead_46'))->'visits') v, jsonb_array_elements(v->'answers') a where a->>'label'='Remark'),0,'answers that do not decide a route stay private');

-- Another tenant sees nothing.
reset role;
insert into rep_fixture select 'family',family_id from fms_flows where id=(select id from rep_fixture where name='flow');
select set_config('request.jwt.claim.sub',(select id::text from rep_fixture where name='outsider_auth'),true);
set local role authenticated;
select is((select value->>'started' from (select get_fms_flow_report((select id from rep_fixture where name='family'),'{}') value) x),'0','another tenant counts nothing');
select is(jsonb_array_length(get_fms_library_outcomes()),0,'another tenant gets no library counts');
select throws_ok($q$select get_fms_instance_journey((select id from rep_fixture where name='lead_1'))$q$,'42501',null,'another tenant cannot open a journey');
reset role;
select is(has_function_privilege('anon','get_fms_flow_report(uuid,jsonb)','EXECUTE'),false,'anonymous callers cannot read reports');
select is(has_function_privilege('authenticated','fms_report_instances(uuid,jsonb)','EXECUTE'),false,'the report helper is private');
select * from finish();
rollback;
