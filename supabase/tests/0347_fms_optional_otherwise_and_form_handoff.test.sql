begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table optional_fixture(name text primary key,id uuid);
grant select,insert,update on optional_fixture to authenticated;
do $$
declare t uuid; b uuid; d uuid; a uuid; u uuid; u2 uuid; u3 uuid; f uuid; g uuid; h uuid; flow uuid; s uuid; follow uuid; finish uuid; person text;
begin
  insert into tenants(name,slug) values('Optional otherwise test','optional-otherwise-test') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','OPT') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','OPT') returning id into d;
  foreach person in array array['doer','sales','closer'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-opt@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
      values(t,a,b,d,'Optional '||person,'OPT-'||person,person||'-opt@test.local','staff','active',true) returning id into u;
    insert into optional_fixture values(person,u),(person||'_auth',a);
  end loop;
  select id into u from optional_fixture where name='doer';
  select id into u2 from optional_fixture where name='sales';
  select id into u3 from optional_fixture where name='closer';
  select id into a from optional_fixture where name='doer_auth';

  -- Routing: the start form and the follow-up both route without an Otherwise destination.
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by)
    values(t,'Lead note',1,'draft',true,u,u) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f,'note','Note','text',0);
  update form_templates set lifecycle='published' where id=f;
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by)
    values(t,gen_random_uuid(),1,'Optional otherwise flow','tenant','draft',true,u,u) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(flow,'start','Initial form','form',0,true,'{"deadlineEnabled":false}',f) returning id into s;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(flow,'follow','Follow up','form',1,true,'{"deadlineEnabled":false}',f) returning id into follow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
    values(flow,'finish','Finish','task',2,true,'{"deadlineEnabled":false}') returning id into finish;
  insert into fms_branch_rules(fms_stage_id,sort_order,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id)
    values(s,0,'form_answer','note','note','equals','continue',follow),(follow,0,'form_answer','note','note','equals','more',finish);
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) select id,'specific_user',u,0 from fms_stages where fms_flow_id=flow;

  -- Handoff: one form with two sections, each with its own employee question.
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by,sections)
    values(t,'Follow-ups',1,'draft',true,u,u,'[{"key":"f2","title":"Follow up 2"},{"key":"f3","title":"Follow up 3"}]') returning id into g;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown,group_name)
    values(g,'salesperson','Salesperson','user_dropdown',0,false,true,'f2'),(g,'closer','Closer','user_dropdown',1,false,true,'f3');
  update form_templates set lifecycle='published' where id=g;
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by)
    values(t,'Named handoff',1,'draft',true,u,u) returning id into h;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown)
    values(h,'sales','Salesperson','user_dropdown',0,false,true),(h,'assigned_to','Assigned To','user_dropdown',1,true,true);
  update form_templates set lifecycle='published' where id=h;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(flow,'chain_f2','Follow up 2','task',3,true,'{"deadlineEnabled":false,"formSectionKey":"f2"}',g),
          (flow,'chain_whole','Whole form','task',4,true,'{"deadlineEnabled":false}',g),
          (flow,'chain_named','Named','task',5,true,'{"deadlineEnabled":false}',h);
  insert into optional_fixture values('tenant',t),('flow',flow),('form',f),('first',s),('follow',follow),('finish',finish);
end $$;

-- Assigned To from the previous form.
select is(fms_form_chain_choice((select id from fms_stages where stage_key='chain_f2' and fms_flow_id=(select id from optional_fixture where name='flow')),jsonb_build_object('salesperson',(select id from optional_fixture where name='sales')),array[(select id from optional_fixture where name='doer')])#>>'{selectedUserIds,0}',
  (select id::text from optional_fixture where name='sales'),'the only employee question in the step section hands the work over, whatever it is called');
select is(fms_form_chain_choice((select id from fms_stages where stage_key='chain_f2' and fms_flow_id=(select id from optional_fixture where name='flow')),'{}',array[(select id from optional_fixture where name='doer')])#>>'{selectedUserIds,0}',
  (select id::text from optional_fixture where name='doer'),'left blank, the previous employee keeps the work');
select is(fms_form_chain_choice((select id from fms_stages where stage_key='chain_whole' and fms_flow_id=(select id from optional_fixture where name='flow')),jsonb_build_object('salesperson',(select id from optional_fixture where name='sales')),array[(select id from optional_fixture where name='doer')])#>>'{selectedUserIds,0}',
  (select id::text from optional_fixture where name='doer'),'two unnamed employee questions are ambiguous, so the previous employee keeps the work');
select is(fms_form_chain_choice((select id from fms_stages where stage_key='chain_named' and fms_flow_id=(select id from optional_fixture where name='flow')),jsonb_build_object('sales',(select id from optional_fixture where name='sales'),'assigned_to',(select id from optional_fixture where name='closer')),array[(select id from optional_fixture where name='doer')])#>>'{selectedUserIds,0}',
  (select id::text from optional_fixture where name='closer'),'a question named Assigned To still wins');
select throws_ok($$select fms_form_chain_choice((select id from fms_stages where stage_key='chain_named' and fms_flow_id=(select id from optional_fixture where name='flow')),jsonb_build_object('sales',(select id from optional_fixture where name='sales')),array[(select id from optional_fixture where name='doer')])$$,'23514',null,'an unanswered Assigned To question still cannot silently keep the owner');

-- Run time: an unmatched answer without Otherwise completes the workflow.
delete from fms_stages where stage_key in ('chain_f2','chain_whole','chain_named') and fms_flow_id=(select id from optional_fixture where name='flow');
-- Publication no longer requires an Otherwise destination.
select lives_ok($$select assert_fms_flow_publishable_before_assignment((select id from optional_fixture where name='flow'))$$,'routed steps without Otherwise pass the publish checks');
select ok(position('Otherwise destination' in pg_get_functiondef('assert_fms_flow_publishable_before_assignment(uuid)'::regprocedure))=0,'the Otherwise publish rule is gone');

update fms_flows set status='published' where id=(select id from optional_fixture where name='flow');
select set_config('request.jwt.claim.sub',(select id::text from optional_fixture where name='doer_auth'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
insert into optional_fixture select 'unmatched_start',(submit_form_and_start_fms_with_audit((select id from optional_fixture where name='form'),'{"note":"stop"}')->>'instance_id')::uuid;
select is((select status::text from fms_instances where id=(select id from optional_fixture where name='unmatched_start')),'completed','an unmatched first form without Otherwise completes the workflow');
insert into optional_fixture select 'run',(submit_form_and_start_fms_with_audit((select id from optional_fixture where name='form'),'{"note":"continue"}')->>'instance_id')::uuid;
select is((select status::text from fms_instances where id=(select id from optional_fixture where name='run')),'active','a matched first form still continues');
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from optional_fixture where name='form'),'{"note":"done"}','fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from optional_fixture where name='run') and fms_stage_id=(select id from optional_fixture where name='follow') and status='in_progress'),gen_random_uuid())$$,'a follow-up whose answer matches no route can be completed');
reset role;
select is((select status::text from fms_instances where id=(select id from optional_fixture where name='run')),'completed','an unmatched follow-up without Otherwise completes the workflow instead of holding it');
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from optional_fixture where name='run') and fms_stage_id=(select id from optional_fixture where name='finish')),0,'no step is created for a route that was not taken');
select is((select count(*)::integer from fms_stage_logs log join fms_instance_stages work on work.id=log.fms_instance_stage_id where work.fms_instance_id=(select id from optional_fixture where name='run') and log.action='route_unmatched'),1,'the unmatched route is recorded on the step');
select is((select count(*)::integer from notifications where tenant_id=(select id from optional_fixture where name='tenant') and title='Workflow needs attention'),0,'no "needs attention" alert is sent for an optional Otherwise');
select is(has_function_privilege('authenticated','fms_form_chain_choice(uuid,jsonb,uuid[])','EXECUTE'),false,'form-chain helper keeps no authenticated grant');
select * from finish();
rollback;
