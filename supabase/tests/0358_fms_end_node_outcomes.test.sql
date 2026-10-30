begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table end_fixture(name text primary key,id uuid);
grant select,insert,update on end_fixture to authenticated;

-- The Instagram sales funnel: one shared Lead Closed End Node receives routes from every step.
do $$
declare t uuid; t2 uuid; b uuid; d uuid; b2 uuid; d2 uuid; a uuid; u uuid; f uuid; flow uuid; person text; k text;
  s_start uuid; s_intro uuid; s_demo uuid; s_f1 uuid; s_f2 uuid; s_f3 uuid; s_neg uuid; s_order uuid; e_won uuid; e_lost uuid; e_dnc uuid;
begin
  insert into tenants(name,slug) values('End node test','end-node-test') returning id into t;
  insert into tenants(name,slug) values('End node other','end-node-other') returning id into t2;
  insert into branches(tenant_id,name,code) values(t,'Main','END') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','END') returning id into d;
  insert into branches(tenant_id,name,code) values(t2,'Other','ENX') returning id into b2;
  insert into departments(tenant_id,branch_id,name,code) values(t2,b2,'Other','ENX') returning id into d2;
  foreach person in array array['doer','outsider','admin'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-end@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
      values(case when person='outsider' then t2 else t end,a,case when person='outsider' then b2 else b end,case when person='outsider' then d2 else d end,
        'End '||person,'END-'||person,person||'-end@test.local',case when person='admin' then 'admin' else 'staff' end::user_role,'active',true) returning id into u;
    insert into end_fixture values(person,u),(person||'_auth',a);
  end loop;
  select id into u from end_fixture where name='doer';
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
  insert into end_fixture values('tenant',t),('flow',flow),('form',f),('lead_closed',e_lost),('sales_closed',e_won),('dnc',e_dnc),('order',s_order),('intro',s_intro);
end $$;

create function pg_temp.visit(p_instance uuid,p_key text) returns uuid language sql as $$
  select w.id from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=p_instance and s.stage_key=p_key and w.status in ('pending','in_progress','in_review','overdue') order by w.visit_number desc limit 1 $$;
create function pg_temp.step(p_instance uuid,p_key text,p_status text) returns void language sql as $$
  select submit_fms_form_and_progress_with_audit((select id from end_fixture where name='form'),jsonb_build_object('status',p_status,'note','Remark at '||p_key),'fms_stage',pg_temp.visit(p_instance,p_key),gen_random_uuid()) $$;
create function pg_temp.start(p_status text) returns uuid language sql as $$
  select (submit_form_and_start_fms_with_audit((select id from end_fixture where name='form'),jsonb_build_object('status',p_status))->>'instance_id')::uuid $$;
create function pg_temp.outcome(p_instance uuid) returns text language sql as $$ select outcome||':'||end_stage_key from fms_instance_outcomes where fms_instance_id=p_instance $$;
grant execute on function pg_temp.visit(uuid,text),pg_temp.step(uuid,text,text),pg_temp.start(text),pg_temp.outcome(uuid) to authenticated;

-- Publication: End Nodes are valid again; invalid End Nodes are refused.
select lives_ok($$select assert_fms_flow_publishable((select id from end_fixture where name='flow'))$$,'a workflow with three End Nodes, one shared by every step, is publishable');
update fms_stages set default_next_stage_id=(select id from end_fixture where name='intro') where id=(select id from end_fixture where name='lead_closed');
select throws_ok($$select assert_fms_flow_publishable((select id from end_fixture where name='flow'))$$,'23514','An End Node finishes the workflow, so it cannot lead to another step','an End Node with an outgoing connection is refused');
update fms_stages set default_next_stage_id=null where id=(select id from end_fixture where name='lead_closed');
insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) values((select id from end_fixture where name='lead_closed'),'specific_user',(select id from end_fixture where name='doer'),0);
select throws_ok($$select assert_fms_flow_publishable((select id from end_fixture where name='flow'))$$,'23514',null,'an End Node with an assignee is refused');
delete from fms_stage_assignees where fms_stage_id=(select id from end_fixture where name='lead_closed');
update fms_stages set form_template_id=(select id from end_fixture where name='form') where id=(select id from end_fixture where name='lead_closed');
select throws_ok($$select assert_fms_flow_publishable((select id from end_fixture where name='flow'))$$,'23514',null,'an End Node with a form is refused');
update fms_stages set form_template_id=null,planned_time_rule='{"deadlineEnabled":false,"terminal":{"outcome":"sold"}}' where id=(select id from end_fixture where name='lead_closed');
select throws_ok($$select assert_fms_flow_publishable((select id from end_fixture where name='flow'))$$,'23514','Every End Node needs an End type: won, lost, do_not_contact or other','an unknown outcome code is refused');
update fms_stages set planned_time_rule='{"deadlineEnabled":false,"terminal":{"outcome":"lost","reasonCode":"not_interested"}}' where id=(select id from end_fixture where name='lead_closed');
select lives_ok($$select assert_fms_flow_publishable((select id from end_fixture where name='flow'))$$,'the repaired End Node publishes');
update fms_flows set status='published' where id=(select id from end_fixture where name='flow');

select set_config('request.jwt.claim.sub',(select id::text from end_fixture where name='doer_auth'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

-- Example A: Introduction -> Lead Closed, with no Lead Closed task.
insert into end_fixture select 'a',pg_temp.start('new');
select pg_temp.step((select id from end_fixture where name='a'),'intro','NOT INTERESTED CLOSE THIS LEAD');
select is((select status::text from fms_instances where id=(select id from end_fixture where name='a')),'completed','Example A: the workflow ends at once');
select is(pg_temp.outcome((select id from end_fixture where name='a')),'lost:lead_closed','Example A: the lost outcome at Lead Closed is recorded');
select is((select count(*)::integer from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=(select id from end_fixture where name='a') and s.step_type='end' and (w.status<>'completed' or cardinality(w.assigned_to)>0)),0,'Example A: the End Node visit is completed and assigned to nobody');
select is((select count(*)::integer from fms_instance_stage_assignees x join fms_instance_stages w on w.id=x.fms_instance_stage_id join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=(select id from end_fixture where name='a') and s.step_type='end'),0,'Example A: no employee assignment exists for the End Node');
select is((select remark from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=(select id from end_fixture where name='a') and s.stage_key='intro'),null,'Example A: the form route needs no completion remark');
select is((select data->>'note' from form_submissions fs join fms_instance_stages w on w.form_submission_id=fs.id join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=(select id from end_fixture where name='a') and s.stage_key='intro'),'Remark at intro','Example A: the Introduction answers stay in history');
reset role;
select is((select source_question_key||'='||(source_value#>>'{}')||'|'||route_label from fms_instance_outcomes where fms_instance_id=(select id from end_fixture where name='a')),'status=NOT INTERESTED CLOSE THIS LEAD|Not interested','Example A: provenance names the question, the saved answer and the route');
select is((select reason_code from fms_instance_outcomes where fms_instance_id=(select id from end_fixture where name='a')),'not_interested','Example A: the closure reason code is copied');
select is((select count(*)::integer from notifications n where n.tenant_id=(select id from end_fixture where name='tenant') and n.source_record_id in (select w.id from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=(select id from end_fixture where name='a') and s.step_type='end')),0,'Example A: the End Node sends no notification of its own');
select is((select count(*)::integer from notification_events e where e.source_record_id in (select w.id from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=(select id from end_fixture where name='a') and s.step_type='end')),0,'Example A: no stage event is queued for the End Node');
select is((select count(*)::integer from audit_logs where action='fms_instance_terminal_outcome' and record_id=(select id from end_fixture where name='a')),1,'Example A: one audit record for the closure');
set local role authenticated;

-- Example B: Demo -> Lead Closed; Example D: the sale; Example E: do not contact.
insert into end_fixture select 'b',pg_temp.start('new');
select pg_temp.step((select id from end_fixture where name='b'),'intro','interested');
select pg_temp.step((select id from end_fixture where name='b'),'demo','NOT INTERESTED CLOSE THIS LEAD');
select is(pg_temp.outcome((select id from end_fixture where name='b')),'lost:lead_closed','Example B: Demo routes to the same Lead Closed');
insert into end_fixture select 'won',pg_temp.start('new');
select pg_temp.step((select id from end_fixture where name='won'),'intro','interested');
select pg_temp.step((select id from end_fixture where name='won'),'demo','negotiation');
select pg_temp.step((select id from end_fixture where name='won'),'negotiation','order');
select pg_temp.step((select id from end_fixture where name='won'),'order','pending');
select is((select status::text from fms_instances where id=(select id from end_fixture where name='won')),'active','Example D: a pending payment is not a sale');
select pg_temp.step((select id from end_fixture where name='won'),'negotiation','order');
select pg_temp.step((select id from end_fixture where name='won'),'order','paid');
select is(pg_temp.outcome((select id from end_fixture where name='won')),'won:sales_closed','Example D: payment received closes as won');
select is((select max(visit_number) from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=(select id from end_fixture where name='won') and s.stage_key='order'),2,'Example D: the repeated Order step keeps its visit number');
insert into end_fixture select 'dnc_run',pg_temp.start('new');
select pg_temp.step((select id from end_fixture where name='dnc_run'),'intro','dnc');
select is(pg_temp.outcome((select id from end_fixture where name='dnc_run')),'do_not_contact:dnc','Example E: the contact restriction is a distinct outcome');
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from end_fixture where name='dnc_run') and status in ('pending','in_progress','in_review','overdue')),0,'Example E: nothing is left to do');
insert into end_fixture select 'initial',pg_temp.start('dnc');
select is(pg_temp.outcome((select id from end_fixture where name='initial')),'do_not_contact:dnc','the starting form can route straight to an End Node');

-- Example C and the loop: Intro -> F1 -> F2 -> F3 -> Intro -> F1 -> Lead Closed.
insert into end_fixture select 'c',pg_temp.start('new');
select pg_temp.step((select id from end_fixture where name='c'),'intro','follow_up');
select pg_temp.step((select id from end_fixture where name='c'),'f1','continue');
select pg_temp.step((select id from end_fixture where name='c'),'f2','continue');
select pg_temp.step((select id from end_fixture where name='c'),'f3','intro');
select pg_temp.step((select id from end_fixture where name='c'),'intro','follow_up');
select pg_temp.step((select id from end_fixture where name='c'),'f1','NOT INTERESTED CLOSE THIS LEAD');
select is(pg_temp.outcome((select id from end_fixture where name='c')),'lost:lead_closed','Example C: F1 routes to Lead Closed after a loop');
select is((select string_agg(s.stage_key||'#'||w.visit_number,',' order by s.stage_key,w.visit_number) from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=(select id from end_fixture where name='c')),
  'f1#1,f1#2,f2#1,f3#1,intro#1,intro#2,lead_closed#1,start#1','Example C: only executed steps exist, with their visit numbers');
-- F2, F3 and Negotiation reach Lead Closed too.
insert into end_fixture select 'f2',pg_temp.start('new');
select pg_temp.step((select id from end_fixture where name='f2'),'intro','follow_up');
select pg_temp.step((select id from end_fixture where name='f2'),'f1','continue');
select pg_temp.step((select id from end_fixture where name='f2'),'f2','NOT INTERESTED CLOSE THIS LEAD');
select is(pg_temp.outcome((select id from end_fixture where name='f2')),'lost:lead_closed','F2 routes to Lead Closed');
insert into end_fixture select 'f3',pg_temp.start('new');
select pg_temp.step((select id from end_fixture where name='f3'),'intro','follow_up');
select pg_temp.step((select id from end_fixture where name='f3'),'f1','continue');
select pg_temp.step((select id from end_fixture where name='f3'),'f2','continue');
select pg_temp.step((select id from end_fixture where name='f3'),'f3','NOT INTERESTED CLOSE THIS LEAD');
select is(pg_temp.outcome((select id from end_fixture where name='f3')),'lost:lead_closed','F3 routes to Lead Closed');
insert into end_fixture select 'neg',pg_temp.start('new');
select pg_temp.step((select id from end_fixture where name='neg'),'intro','interested');
select pg_temp.step((select id from end_fixture where name='neg'),'demo','negotiation');
select pg_temp.step((select id from end_fixture where name='neg'),'negotiation','NOT INTERESTED CLOSE THIS LEAD');
select is(pg_temp.outcome((select id from end_fixture where name='neg')),'lost:lead_closed','Negotiation routes to Lead Closed');

-- Retries and late submissions cannot close twice or reopen work.
select throws_ok($$select submit_fms_form_and_progress_with_audit((select id from end_fixture where name='form'),'{"status":"paid"}','fms_stage',(select w.id from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=(select id from end_fixture where name='won') and s.stage_key='order' order by w.visit_number desc limit 1),gen_random_uuid())$$,null,null,'a repeated submission on a finished instance is refused');
select is((select count(*)::integer from fms_instance_outcomes where fms_instance_id=(select id from end_fixture where name='won')),1,'the retry adds no second outcome');

-- The work preview names the End Node instead of asking who receives it.
insert into end_fixture select 'preview',pg_temp.start('new');
select is((select jsonb_array_length(p->'destinations')||'|'||(p#>>'{terminal,stageName}')||'|'||(p#>>'{terminal,outcome}') from (select preview_fms_work_transition(jsonb_build_object('kind','stage_form','instanceStageId',pg_temp.visit((select id from end_fixture where name='preview'),'intro'),'formTemplateId',(select id from end_fixture where name='form'),'answers',jsonb_build_object('status','NOT INTERESTED CLOSE THIS LEAD'),'outcome','','remark','','checklist','{}'::jsonb),'[]'::jsonb) p) x),
  '0|Lead Closed|lost','the preview shows no handoff destination, only the End Node');
select is((select jsonb_array_length(p->'destinations')||'|'||coalesce(p->>'terminal','none') from (select preview_fms_work_transition(jsonb_build_object('kind','stage_form','instanceStageId',pg_temp.visit((select id from end_fixture where name='preview'),'intro'),'formTemplateId',(select id from end_fixture where name='form'),'answers',jsonb_build_object('status','interested'),'outcome','','remark','','checklist','{}'::jsonb),'[]'::jsonb) p) x),
  '1|none','a normal human handoff is unchanged');
insert into end_fixture select 'preview_visit',pg_temp.visit((select id from end_fixture where name='preview'),'intro');
create temporary table end_result(value jsonb);
grant insert,select on end_result to authenticated;
insert into end_result select transition_fms_work_with_audit(r,gen_random_uuid(),'[]'::jsonb,preview_fms_work_transition(r,'[]'::jsonb)->>'fingerprint')
  from (select jsonb_build_object('kind','stage_form','instanceStageId',(select id from end_fixture where name='preview_visit'),'formTemplateId',(select id from end_fixture where name='form'),'answers',jsonb_build_object('status','NOT INTERESTED CLOSE THIS LEAD'),'outcome','','remark','','checklist','{}'::jsonb) r) x;
select is((select value->>'state'||'|'||(value#>>'{terminal,stageName}')||'|'||jsonb_array_length(value->'destinations') from end_result),'workflow_completed|Lead Closed|0','the confirmed result reports the End Node and no next work');

-- The employee's task lists no longer show finished work as open.
reset role;
select is((select count(*)::integer from fms_workspace_rows('{}') r where r.instance_id in (select id from end_fixture where name in ('a','b','c','won','dnc_run')) and r.bucket<>'completed'),0,'closed instances leave no open or waiting work');
-- Cross-tenant users never read outcomes.
select set_config('request.jwt.claim.sub',(select id::text from end_fixture where name='outsider_auth'),true);
set local role authenticated;
select is((select count(*)::integer from fms_instance_outcomes),0,'another tenant reads no outcomes');
reset role;
select throws_ok($$update fms_instance_outcomes set outcome='won' where fms_instance_id=(select id from end_fixture where name='a')$$,'42501',null,'an outcome is immutable');
select is(has_table_privilege('authenticated','fms_instance_outcomes','INSERT'),false,'browsers cannot write outcomes');
select is(has_function_privilege('authenticated','fms_finalize_terminal_internal(uuid,uuid,uuid)','EXECUTE'),false,'browsers cannot finalize an instance');

-- Parallel work: one branch reaches an End Node; the other branch's open work stops, kept as history.
do $$
declare flow uuid; s uuid; split uuid; pa uuid; pb uuid; e uuid; u uuid:=(select id from end_fixture where name='doer'); f uuid; t uuid:=(select id from end_fixture where name='tenant');
begin
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by) values(t,'Parallel note',1,'draft',true,u,u) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f,'status','Status','text',0);
  update form_templates set lifecycle='published' where id=f;
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by) values(t,gen_random_uuid(),1,'Parallel close','tenant','draft',true,u,u) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'start','Start','form',0,true,'{"deadlineEnabled":false}',f) returning id into s;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(flow,'split','Split','parallel_start',1,true,'{}') returning id into split;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'pa','Branch A','form',2,true,'{"deadlineEnabled":false}',f) returning id into pa;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'pb','Branch B','form',3,true,'{"deadlineEnabled":false}',f) returning id into pb;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(flow,'closed','Closed','end',4,true,'{"terminal":{"outcome":"other"}}') returning id into e;
  update fms_stages set default_next_stage_id=split where id=s;
  update fms_stages set parallel_target_stage_ids=array[pa,pb] where id=split;
  update fms_stages set default_next_stage_id=e where id=pa;
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) select id,'specific_user',u,0 from fms_stages where fms_flow_id=flow and step_type in ('form');
  perform assert_fms_flow_publishable(flow);
  update fms_flows set status='published' where id=flow;
  insert into end_fixture values('parallel_flow',flow),('pform',f);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from end_fixture where name='doer_auth'),true);
insert into end_fixture select 'p',(submit_form_and_start_fms_with_audit((select id from end_fixture where name='pform'),'{"status":"go"}')->>'instance_id')::uuid;
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from end_fixture where name='p') and status='in_progress'),2,'both parallel branches are open');
select submit_fms_form_and_progress_with_audit((select id from end_fixture where name='pform'),'{"status":"done"}','fms_stage',pg_temp.visit((select id from end_fixture where name='p'),'pa'),gen_random_uuid());
reset role;
select is(pg_temp.outcome((select id from end_fixture where name='p')),'other:closed','one branch reaching the End Node closes the whole instance');
select is((select status::text||'|'||outcome from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=(select id from end_fixture where name='p') and s.stage_key='pb'),'blocked|workflow_closed','the sibling step is stopped, not completed, and kept');
select is((select details->>'status' from fms_stage_logs l join fms_instance_stages w on w.id=l.fms_instance_stage_id join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=(select id from end_fixture where name='p') and s.stage_key='pb' and l.action='stopped_by_end_node'),'in_progress','the stopped step records the status it had');
select is((select count(*)::integer from fms_instance_stage_assignees x join fms_instance_stages w on w.id=x.fms_instance_stage_id where w.fms_instance_id=(select id from end_fixture where name='p') and x.is_active and w.status<>'completed'),0,'the stopped step has no active assignee');
select is((select stopped_visit_count from fms_instance_outcomes where fms_instance_id=(select id from end_fixture where name='p')),1,'the outcome counts the stopped work');

-- Cancellation stays separate from a lost sale.
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from end_fixture where name='doer_auth'),true);
insert into end_fixture select 'cancel',pg_temp.start('new');
reset role;
select set_config('request.jwt.claim.sub',(select id::text from end_fixture where name='admin_auth'),true);
set local role authenticated;
select cancel_fms_instance_with_audit((select id from end_fixture where name='cancel'),'Duplicate lead');
reset role;
select is((select status::text from fms_instances where id=(select id from end_fixture where name='cancel'))||'|'||coalesce(pg_temp.outcome((select id from end_fixture where name='cancel')),'none'),'cancelled|none','cancelling records no business outcome');

select * from finish();
rollback;
