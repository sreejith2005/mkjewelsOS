begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(20);

-- Contract surface
select function_owner_is('public','fms_stage_matched_route',array['uuid','uuid','uuid','text'],'postgres','the route resolver runs as postgres');
select is((select proconfig from pg_proc where oid='fms_stage_matched_route(uuid,uuid,uuid,text)'::regprocedure),array['search_path=public']::text[],'the route resolver pins its search path');
select ok(not has_function_privilege('authenticated','fms_stage_matched_route(uuid,uuid,uuid,text)','EXECUTE'),'clients cannot resolve routes directly');
select ok(has_function_privilege('authenticated','complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)','EXECUTE'),'authenticated users still complete stages');

-- Expected option values, the shape both matching and the publish gate compare against.
select is(fms_route_expected_values('equals','bought'),'["bought"]'::jsonb,'a single-answer route expects exactly one option value');
select is(fms_route_expected_values('in','["bought","interested"]'),'["bought","interested"]'::jsonb,'a multi-answer route expects its stored list');
select is(fms_route_expected_values('in','bought, interested'),'["bought","interested"]'::jsonb,'a legacy comma-separated list is still understood');

-- Multi-select answers arrive as jsonb arrays and must match by membership.
select ok(fms_rule_matches('equals','bought',to_jsonb(array['bought','interested'])),'a selected checkbox option matches an equals route');
select ok(not fms_rule_matches('equals','declined',to_jsonb(array['bought'])),'an unselected option does not match');
select ok(fms_rule_matches('in','["declined","interested"]',to_jsonb(array['bought','interested'])),'an in route matches any selected option');
select ok(fms_rule_matches('not_empty',null,to_jsonb(array['bought'])),'an answered multi-select counts as answered');
select ok(not fms_rule_matches('not_empty',null,'[]'::jsonb),'an empty multi-select counts as unanswered');
-- Scalar answers keep 0010's behaviour exactly.
select ok(fms_rule_matches('equals','wholesale',to_jsonb('wholesale'::text)),'a scalar equals route is unchanged');
select ok(fms_rule_matches('in','["retail","wholesale"]',to_jsonb('retail'::text)),'a scalar in route is unchanged');

-- ---------------------------------------------------------------------------
-- A published flow whose routed step has no fallback, so an unmatched answer
-- must hold the instance instead of quietly completing it.
-- ---------------------------------------------------------------------------
create temporary table hold_fixture(name text primary key, id uuid) on commit drop;
grant select on hold_fixture to authenticated;

do $$
declare
  v_tenant uuid; v_branch uuid; v_dept uuid; v_auth uuid; v_user uuid; v_family uuid;
  v_form uuid; v_flow uuid; v_start uuid; v_purchase uuid; v_product uuid;
begin
  insert into tenants(name,slug) values('Branching tenant','branching-tenant') returning id into v_tenant;
  insert into branches(tenant_id,name,code) values(v_tenant,'Main','BMAIN') returning id into v_branch;
  insert into departments(tenant_id,branch_id,name,code) values(v_tenant,v_branch,'Sales','BSAL') returning id into v_dept;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','branching@test.local','x',now(),now()) returning id into v_auth;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
    values(v_tenant,v_auth,v_branch,v_dept,'Brancher','B-EMP-1','branching@test.local','admin','active',true) returning id into v_user;

  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by)
    values(v_tenant,'Purchase status',1,'draft',true,v_user,v_user) returning id into v_form;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,options)
    values(v_form,'purchased','Did the customer buy jewellery?','select',0,'[{"value":"bought","label":"Bought Jewellery"},{"value":"not_bought","label":"Did Not Buy"}]'::jsonb);
  update form_templates set lifecycle='published' where id=v_form;

  v_family := gen_random_uuid();
  insert into fms_flows(tenant_id,family_id,version,name,description,scope_type,status,is_active,created_by,updated_by)
    values(v_tenant,v_family,1,'Purchase flow','branching proof','tenant','draft',true,v_user,v_user) returning id into v_flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(v_flow,'start_form','Start','form',0,true,'{"deadlineEnabled":false}'::jsonb,v_form) returning id into v_start;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(v_flow,'purchase','Purchase status','task',1,true,'{"deadlineEnabled":false}'::jsonb,v_form) returning id into v_purchase;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
    values(v_flow,'product','Product details','task',2,true,'{"deadlineEnabled":false}'::jsonb) returning id into v_product;
  update fms_stages set default_next_stage_id=v_purchase where id=v_start;
  -- Deliberately no fallback: no default_next_stage_id and no `default` route.
  insert into fms_branch_rules(fms_stage_id,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,label,sort_order)
    values(v_purchase,'form_answer','purchased','purchased','equals','bought',v_product,'Bought Jewellery',0);
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order)
    select id,'specific_user',v_user,0 from fms_stages where fms_flow_id=v_flow;

  insert into hold_fixture(name,id) values
    ('tenant',v_tenant),('branch',v_branch),('dept',v_dept),('auth',v_auth),('user',v_user),
    ('flow',v_flow),('form',v_form),('purchase',v_purchase),('product',v_product);
end $$;

-- The publish gate must reject this flow precisely because nothing covers an
-- answer of "Did Not Buy".
select throws_ok(
  $$select assert_fms_flow_publishable((select id from hold_fixture where name='flow'))$$,
  '23514',
  'A step with conditional routes needs an Otherwise destination for answers that match no route',
  'publishing a routed step without an Otherwise destination is refused');

-- A route matching an option the question no longer offers is refused too.
do $$
begin
  update fms_stages set default_next_stage_id=(select id from hold_fixture where name='product') where id=(select id from hold_fixture where name='purchase');
  update fms_branch_rules set condition_value='interested' where fms_stage_id=(select id from hold_fixture where name='purchase');
end $$;
select throws_ok(
  $$select assert_fms_flow_publishable((select id from hold_fixture where name='flow'))$$,
  '23514',
  'A conditional route matches an answer that the linked question no longer offers',
  'publishing a route that matches a removed option is refused');

-- Restore a valid route, remove the fallback again, publish past the gate, and
-- prove the run-time behaviour of an unmatched answer.
do $$
declare v_instance uuid; v_stage_row uuid; v_submission uuid;
begin
  -- Published stage definitions are immutable, so the flow is put into its final
  -- shape while it is still a draft and only then published.
  update fms_branch_rules set condition_value='bought' where fms_stage_id=(select id from hold_fixture where name='purchase');
  update fms_stages set default_next_stage_id=null where id=(select id from hold_fixture where name='purchase');
  update fms_flows set status='published' where id=(select id from hold_fixture where name='flow');

  insert into fms_instances(tenant_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,branch_id,department_id,started_by,context)
    select (select id from hold_fixture where name='tenant'),(select id from hold_fixture where name='flow'),
           (select family_id from fms_flows where id=(select id from hold_fixture where name='flow')),1,
           'BR-1','Branching hold','active',(select id from hold_fixture where name='branch'),
           (select id from hold_fixture where name='dept'),(select id from hold_fixture where name='user'),'{}'::jsonb
    returning id into v_instance;
  insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to)
    values(v_instance,(select id from hold_fixture where name='purchase'),'in_progress',array[(select id from hold_fixture where name='user')])
    returning id into v_stage_row;
  insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by)
    values((select id from hold_fixture where name='tenant'),v_stage_row,(select id from hold_fixture where name='user'),(select id from hold_fixture where name='user'));
  insert into form_submissions(tenant_id,form_template_id,submitted_by,data,linked_module,linked_record_id)
    values((select id from hold_fixture where name='tenant'),(select id from hold_fixture where name='form'),
           (select id from hold_fixture where name='user'),jsonb_build_object('purchased','not_bought'),'fms_stage',v_stage_row)
    returning id into v_submission;
  update fms_instance_stages set form_submission_id=v_submission where id=v_stage_row;
  insert into hold_fixture(name,id) values('instance',v_instance),('instance_stage',v_stage_row);
end $$;

select set_config('request.jwt.claim.sub',(select id::text from hold_fixture where name='auth'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok(
  $$select complete_fms_stage_with_audit((select id from hold_fixture where name='instance_stage'),null,null,'{}'::jsonb,null)$$,
  'the doer can still complete the step');
reset role;

select is((select status from fms_instances where id=(select id from hold_fixture where name='instance')),'on_hold','an unmatched route holds the instance instead of completing it');
select is((select count(*)::integer from fms_stage_logs where fms_instance_stage_id=(select id from hold_fixture where name='instance_stage') and action='route_unmatched'),1,'the unmatched route is recorded on the stage');
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from hold_fixture where name='instance')),1,'no downstream task is created for a branch that was not taken');

select * from finish();
rollback;
