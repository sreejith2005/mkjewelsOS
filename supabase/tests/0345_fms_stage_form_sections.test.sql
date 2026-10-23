begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Synthetic jewellery sales pipeline: one Form with four sections, reused by
-- separate FMS stages that each link a different section.
create temporary table section_fixture(name text primary key,id uuid);
grant all on section_fixture to authenticated;
do $$
declare t uuid; b uuid; d uuid; a uuid; u uuid; enquiry uuid; sales uuid; flow uuid; person text; stage_id uuid;
  yes_no jsonb:='[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]';
begin
  insert into tenants(name,slug) values('Section fixture','fms-form-sections') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','FS') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','FS') returning id into d;
  foreach person in array array['a','b','c'] loop
    a:=gen_random_uuid();
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-section@test.local','x',now(),now());
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
      values(t,a,b,d,'Employee '||upper(person),'FS-'||left(t::text,8)||'-'||person,person||'-section@test.local',case when person='a' then 'super_admin'::user_role else 'staff'::user_role end,'active','active',true) returning id into u;
    insert into section_fixture values(person,u),(person||'_auth',a);
  end loop;
  select id into u from section_fixture where name='a';

  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by)
    values(t,'Enquiry',1,'draft',true,u,u) returning id into enquiry;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown)
    values(enquiry,'client_name','Client name','text',0,true,true);
  update form_templates set lifecycle='published' where id=enquiry;

  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by,sections)
    values(t,'Jewellery Sales Pipeline',1,'draft',true,u,u,
      '[{"key":"intro","title":"Introduction Call"},{"key":"demo","title":"Product Demonstration"},{"key":"negotiation","title":"Negotiation"},{"key":"closing","title":"Closing"}]')
    returning id into sales;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown,group_name,options,conditional_logic) values
    (sales,'client_connected','Client Connected?','select',0,true,true,'intro',yes_no,null),
    (sales,'client_interested','Client Interested?','select',1,true,true,'intro',yes_no,null),
    (sales,'client_budget','Client Budget','number',2,false,true,'intro',null,null),
    (sales,'product_shown','Product Shown?','select',3,true,true,'demo',yes_no,null),
    (sales,'price_accepted','Price Accepted?','select',4,true,true,'demo',yes_no,null),
    (sales,'offer_accepted','Final Offer Accepted?','select',5,true,true,'negotiation',yes_no,null),
    (sales,'discount_note','Discount requested','text',6,true,true,'negotiation',null,'{"fieldKey":"offer_accepted","operator":"equals","value":"no"}'),
    (sales,'order_confirmed','Order Confirmed?','select',7,true,true,'closing',yes_no,null),
    (sales,'follow_up_detail','Follow-up detail','text',8,false,true,'closing',null,'{"fieldKey":"client_interested","operator":"equals","value":"no"}');
  update form_templates set lifecycle='published' where id=sales;

  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version)
    values(t,gen_random_uuid(),1,'Jewellery sales','tenant','draft',true,u,u,1) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values
    (flow,'initial','Enquiry','form',0,true,'{"deadlineEnabled":false}',enquiry),
    (flow,'intro','Introduction Call','task',1,true,'{"deadlineEnabled":false,"completionFormRequired":true,"formSectionKey":"intro"}',sales),
    (flow,'demo','Product Demonstration','task',2,true,'{"deadlineEnabled":false,"completionFormRequired":true,"formSectionKey":"demo"}',sales),
    (flow,'negotiation','Negotiation','task',3,true,'{"deadlineEnabled":false,"completionFormRequired":true,"formSectionKey":"negotiation"}',sales),
    (flow,'followup','Follow-up','task',4,true,'{"deadlineEnabled":false}',null);
  for stage_id in select id from fms_stages where fms_flow_id=flow loop
    insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order)
      values(stage_id,'specific_user',case when (select stage_key from fms_stages where id=stage_id)='initial' then u else (select id from section_fixture where name='b') end,0);
  end loop;
  update fms_stages s set default_next_stage_id=n.id from fms_stages n where s.fms_flow_id=flow and n.fms_flow_id=flow and (s.stage_key,n.stage_key) in (('initial','intro'),('demo','negotiation'),('followup','intro'),('intro','followup'));
  insert into fms_branch_rules(fms_stage_id,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,label,sort_order)
    select s.id,'form_answer','client_interested','client_interested','equals','yes',n.id,'Interested',0
    from fms_stages s join fms_stages n on n.fms_flow_id=s.fms_flow_id and n.stage_key='demo' where s.fms_flow_id=flow and s.stage_key='intro';
  insert into section_fixture values('tenant',t),('enquiry',enquiry),('sales',sales),('flow',flow);
  insert into section_fixture select stage_key,id from fms_stages where fms_flow_id=flow;
end $$;

create temporary table section_run(name text primary key,value jsonb);
grant all on section_run to authenticated;
create or replace function pg_temp.work_request(p_stage text,p_answers jsonb) returns jsonb language sql as $$
  select jsonb_build_object('kind','stage_form','instanceStageId',(select id from fms_instance_stages where fms_instance_id=(select id from section_fixture where name='instance') and fms_stage_id=(select id from section_fixture where name=p_stage) and status in ('pending','in_progress','in_review','overdue') order by created_at desc limit 1),
    'formTemplateId',(select id from section_fixture where name='sales'),'answers',p_answers,'outcome','','remark','','checklist','{}'::jsonb)
$$;
create or replace function pg_temp.transition(p_request jsonb) returns jsonb language plpgsql as $$
begin return transition_fms_work_with_audit(p_request,gen_random_uuid(),'[]',preview_fms_work_transition(p_request)->>'fingerprint'); end $$;
grant execute on function pg_temp.work_request(text,jsonb),pg_temp.transition(jsonb) to authenticated;

select set_config('request.jwt.claim.sub',(select id::text from section_fixture where name='a_auth'),true);
set local role authenticated;
select lives_ok($$select publish_fms_flow_with_audit((select id from section_fixture where name='flow'))$$,'a workflow whose stages each link one section of a shared Form publishes');
insert into section_fixture select 'instance',(submit_fms_form_and_progress_with_audit((select id from section_fixture where name='enquiry'),'{"client_name":"Synthetic client"}',
  'fms_entry',(select id from fms_starter_assignments where fms_flow_id=(select id from section_fixture where name='flow') and user_profile_id=(select id from section_fixture where name='a')),gen_random_uuid())->>'instance_id')::uuid;
reset role;
select ok((select id from section_fixture where name='instance') is not null,'the whole-form starting Form still starts the workflow');

-- An unrelated employee cannot see or submit the section.
select set_config('request.jwt.claim.sub',(select id::text from section_fixture where name='c_auth'),true);
set local role authenticated;
select throws_ok($$select preview_fms_work_transition(pg_temp.work_request('intro','{"client_connected":"yes","client_interested":"no"}'))$$,'42501',null,'an employee not assigned to the section cannot submit it');
reset role;

select set_config('request.jwt.claim.sub',(select id::text from section_fixture where name='b_auth'),true);
set local role authenticated;
select lives_ok($$select preview_fms_work_transition(pg_temp.work_request('intro','{"client_connected":"yes","client_interested":"no"}'))$$,
  'the Introduction Call section is accepted without answers to unrelated required sections');
select throws_ok($$select preview_fms_work_transition(pg_temp.work_request('intro','{"client_connected":"yes"}'))$$,'23514','Required visible field client_interested is missing',
  'required questions inside the selected section are still enforced');
select throws_ok($$select preview_fms_work_transition(pg_temp.work_request('intro','{"client_connected":"yes","client_interested":"no","product_shown":"yes"}'))$$,'22023',
  'Answers include a question outside this FMS step''s form section','a forged answer to another section is rejected by preview');
select throws_ok($$select pg_temp.transition(pg_temp.work_request('intro','{"client_connected":"yes","client_interested":"no","product_shown":"yes"}'))$$,'22023',
  null,'a forged answer to another section is rejected by the confirmed transition');
select throws_ok($$select submit_form_with_audit((select id from section_fixture where name='sales'),'{"client_connected":"yes","client_interested":"no","price_accepted":"yes"}','fms_stage',(pg_temp.work_request('intro','{}')->>'instanceStageId')::uuid)$$,'22023',
  null,'calling the Forms submission directly cannot bypass the section scope');
select throws_ok($$select preview_fms_work_transition(pg_temp.work_request('intro','{"client_connected":"maybe","client_interested":"no"}'))$$,'22023',null,'option validation still applies inside the section');

-- Not interested takes the Otherwise path to Follow-up.
insert into section_run values('no',pg_temp.transition(pg_temp.work_request('intro','{"client_connected":"yes","client_interested":"no"}')));
reset role;
select is((select value->>'state' from section_run where name='no'),'successors_activated','the section submission progresses the workflow in one transaction');
select is((select value#>>'{destinations,0,stageName}' from section_run where name='no'),'Follow-up','an unmatched answer follows the configured fallback');
select is((select data from form_submissions where id=(select (value->>'submissionId')::uuid from section_run where name='no')),'{"client_connected":"yes","client_interested":"no"}'::jsonb,
  'only the section answers are stored; nothing is invented for other sections');

-- Follow-up loops back to a fresh Introduction Call visit.
select set_config('request.jwt.claim.sub',(select id::text from section_fixture where name='b_auth'),true);
set local role authenticated;
insert into section_run values('followup',pg_temp.transition(jsonb_build_object('kind','complete','instanceStageId',(select id from fms_instance_stages where fms_instance_id=(select id from section_fixture where name='instance') and fms_stage_id=(select id from section_fixture where name='followup') and status in ('pending','in_progress')),'outcome','','remark','','checklist','{}'::jsonb)));
reset role;
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from section_fixture where name='instance') and fms_stage_id=(select id from section_fixture where name='intro')),2,'the backward route creates a second Introduction Call visit');
select ok((select form_submission_id is null from fms_instance_stages where fms_instance_id=(select id from section_fixture where name='instance') and fms_stage_id=(select id from section_fixture where name='intro') and status in ('pending','in_progress')),'the fresh visit does not reuse the earlier answers');

select set_config('request.jwt.claim.sub',(select id::text from section_fixture where name='b_auth'),true);
set local role authenticated;
insert into section_run values('yes',pg_temp.transition(pg_temp.work_request('intro','{"client_connected":"yes","client_interested":"yes","client_budget":250000}')));
select is((select value#>>'{destinations,0,stageName}' from section_run where name='yes'),'Product Demonstration','Interested routes to Product Demonstration');
select lives_ok($$select preview_fms_work_transition(pg_temp.work_request('demo','{"product_shown":"yes","price_accepted":"yes"}'))$$,'the next stage accepts its own section of the same Form');
select throws_ok($$select preview_fms_work_transition(pg_temp.work_request('demo','{"client_connected":"yes","client_interested":"yes","product_shown":"yes","price_accepted":"yes"}'))$$,'22023',null,
  'the demonstration stage cannot re-answer the introduction section');
insert into section_run values('demo',pg_temp.transition(pg_temp.work_request('demo','{"product_shown":"yes","price_accepted":"yes"}')));
select throws_ok($$select preview_fms_work_transition(pg_temp.work_request('negotiation','{"offer_accepted":"no"}'))$$,'23514','Required visible field discount_note is missing',
  'a conditional question inside the section keeps its requirement');
select lives_ok($$select preview_fms_work_transition(pg_temp.work_request('negotiation','{"offer_accepted":"yes"}'))$$,'a hidden conditional question inside the section is not demanded');
reset role;

-- Standalone Forms Library submissions still validate the whole Form.
select set_config('request.jwt.claim.sub',(select id::text from section_fixture where name='a_auth'),true);
set local role authenticated;
select throws_ok($$select submit_form_with_audit((select id from section_fixture where name='sales'),'{"client_connected":"yes","client_interested":"yes"}',null,null)$$,'23514',null,
  'a standalone submission of the same Form still requires every reached section');
reset role;

-- Publication guards.
create or replace function pg_temp.draft_with(p_stage text,p_rule jsonb) returns uuid language plpgsql as $$
declare flow uuid; source uuid:=(select id from section_fixture where name='flow');
begin
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version)
    select tenant_id,gen_random_uuid(),1,'Guard '||p_stage,'tenant','draft',true,created_by,created_by,1 from fms_flows where id=source returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    select flow,stage_key,name,step_type,sort_order,is_required,case when stage_key=p_stage then planned_time_rule||p_rule else planned_time_rule end,form_template_id from fms_stages where fms_flow_id=source;
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order)
    select n.id,a.assignee_type,a.user_profile_id,a.sort_order from fms_stage_assignees a join fms_stages o on o.id=a.fms_stage_id join fms_stages n on n.fms_flow_id=flow and n.stage_key=o.stage_key where o.fms_flow_id=source;
  update fms_stages n set default_next_stage_id=(select nn.id from fms_stages o join fms_stages od on od.id=o.default_next_stage_id join fms_stages nn on nn.fms_flow_id=flow and nn.stage_key=od.stage_key where o.fms_flow_id=source and o.stage_key=n.stage_key) where n.fms_flow_id=flow;
  insert into fms_branch_rules(fms_stage_id,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,label,sort_order)
    select n.id,r.source_type,r.source_key,r.condition_field,r.condition_operator,r.condition_value,(select id from fms_stages where fms_flow_id=flow and stage_key='demo'),r.label,r.sort_order
    from fms_branch_rules r join fms_stages o on o.id=r.fms_stage_id join fms_stages n on n.fms_flow_id=flow and n.stage_key=o.stage_key where o.fms_flow_id=source;
  return flow;
end $$;
select lives_ok($$select pg_temp.draft_with('intro','{}')$$,'guard drafts can be prepared');
select lives_ok(format('select assert_fms_flow_publishable(%L)',pg_temp.draft_with('intro','{}')),'an unchanged copy of the valid workflow is publishable');
select throws_ok(format('select assert_fms_flow_publishable(%L)',pg_temp.draft_with('initial','{"formSectionKey":"intro"}')),'23514','The starting Form of a workflow always uses the entire Form','the starting Form cannot be section scoped');
select throws_ok(format('select assert_fms_flow_publishable(%L)',pg_temp.draft_with('intro','{"formSectionKey":"retired"}')),'23514',null,'a section missing from the pinned Form version blocks publishing');
select throws_ok(format('select assert_fms_flow_publishable(%L)',pg_temp.draft_with('intro','{"formSectionKey":"demo"}')),'23514','Step "Introduction Call" routes on a question outside its form section','a route on a question outside the section blocks publishing');
select throws_ok(format('select assert_fms_flow_publishable(%L)',pg_temp.draft_with('negotiation','{"formSectionKey":"closing"}')),'23514',null,'a section whose question depends on another section blocks publishing');
select throws_ok(format('select assert_fms_flow_publishable(%L)',pg_temp.draft_with('demo','{"taskDisplay":{"fields":[{"sourceStageKey":"intro","fieldKey":"product_shown"}]}}')),'23514',
  'A step reads a question from "Introduction Call" that its form section does not ask','a later step cannot read a question its source section never asks');

-- Historical stages without a section keep whole-form behaviour, and the private checker is not callable.
select ok(not has_function_privilege('authenticated','assert_fms_form_sections_publishable(uuid)','execute'),'the publication checker is private');
select ok(not has_function_privilege('anon','fms_validate_candidate_form(uuid,jsonb,text,uuid)','execute'),'the validator stays private');
select * from finish();
rollback;
