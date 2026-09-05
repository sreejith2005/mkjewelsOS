begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(16);

-- Contract surface
select function_owner_is('public','fms_stage_route_target',array['uuid','uuid','uuid','text'],'postgres','the route resolver runs as postgres');
select is((select proconfig from pg_proc where oid='fms_stage_route_target(uuid,uuid,uuid,text)'::regprocedure),array['search_path=public']::text[],'the route resolver pins its search path');
select ok(not has_function_privilege('authenticated','fms_stage_route_target(uuid,uuid,uuid,text)','EXECUTE'),'clients cannot resolve routes directly');
select ok(not has_function_privilege('service_role','fms_stage_route_target(uuid,uuid,uuid,text)','EXECUTE'),'service role cannot resolve routes directly');
select ok(has_function_privilege('authenticated','complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)','EXECUTE'),'authenticated users still complete stages');
-- 0142 supersedes the resolver with `fms_stage_matched_route`, which returns the
-- winning rule as well as its destination; the routing contract is unchanged.
select ok((select pg_get_functiondef('complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)'::regprocedure) like '%fms_stage_matched_route%'),'stage completion consults the configured routes');
select ok((select pg_get_functiondef('complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid)'::regprocedure) like '%v_next=v_stage.default_next_stage_id%'),'stage completion still falls back to the historical single successor');

-- The shared matcher the resolver uses.
select ok(fms_rule_matches('equals','wholesale',to_jsonb('wholesale'::text)),'an equals route matches the stored option value');
select ok(not fms_rule_matches('equals','wholesale',to_jsonb('retail'::text)),'an equals route ignores a different option value');
select ok(fms_rule_matches('in','["retail","wholesale"]',to_jsonb('retail'::text)),'an in route matches any listed option value');
select ok(fms_rule_matches('default',null,null),'a fallback route always matches');

-- ---------------------------------------------------------------------------
-- Runtime scenario: one step, a linked Form, and one conditional route.
-- Retail must take the legacy single successor; Wholesale must take the route.
-- ---------------------------------------------------------------------------
create temporary table route_fixture(name text primary key, id uuid) on commit drop;
grant select on route_fixture to authenticated;

do $$
declare
  v_tenant uuid; v_branch uuid; v_dept uuid; v_auth uuid; v_user uuid; v_family uuid;
  v_form uuid; v_flow uuid; v_start uuid; v_qualify uuid; v_retail uuid; v_wholesale uuid;
begin
  insert into tenants(name,slug) values('Routing tenant','routing-tenant') returning id into v_tenant;
  insert into branches(tenant_id,name,code) values(v_tenant,'Main','RMAIN') returning id into v_branch;
  insert into departments(tenant_id,branch_id,name,code) values(v_tenant,v_branch,'Sales','RSAL') returning id into v_dept;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','router@test.local','x',now(),now()) returning id into v_auth;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
    values(v_tenant,v_auth,v_branch,v_dept,'Router','R-EMP-1','router@test.local','admin','active',true) returning id into v_user;

  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by)
    values(v_tenant,'Qualification',1,'draft',true,v_user,v_user) returning id into v_form;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,options)
    values(v_form,'customer_type','Customer type','select',0,'[{"value":"retail","label":"Retail"},{"value":"wholesale","label":"Wholesale"}]'::jsonb);
  update form_templates set lifecycle='published' where id=v_form;

  v_family := gen_random_uuid();
  insert into fms_flows(tenant_id,family_id,version,name,description,scope_type,status,is_active,created_by,updated_by)
    values(v_tenant,v_family,1,'Qualify flow','routing proof','tenant','draft',true,v_user,v_user) returning id into v_flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(v_flow,'start_form','Start','form',0,true,'{"deadlineEnabled":false}'::jsonb,v_form) returning id into v_start;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(v_flow,'qualify','Qualify','task',1,true,'{"deadlineEnabled":false}'::jsonb,v_form) returning id into v_qualify;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
    values(v_flow,'retail','Retail desk','task',2,true,'{"deadlineEnabled":false}'::jsonb) returning id into v_retail;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
    values(v_flow,'wholesale','Wholesale desk','task',3,true,'{"deadlineEnabled":false}'::jsonb) returning id into v_wholesale;
  update fms_stages set default_next_stage_id=v_qualify where id=v_start;
  -- The pre-existing single successor stays untouched and becomes the fallback.
  update fms_stages set default_next_stage_id=v_retail where id=v_qualify;
  insert into fms_branch_rules(fms_stage_id,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,label,sort_order)
    values(v_qualify,'form_answer','customer_type','customer_type','equals','wholesale',v_wholesale,'Wholesale',0);
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order)
    select id,'specific_user',v_user,0 from fms_stages where fms_flow_id=v_flow;
  update fms_flows set status='published' where id=v_flow;

  insert into route_fixture(name,id) values
    ('tenant',v_tenant),('branch',v_branch),('dept',v_dept),('auth',v_auth),('user',v_user),
    ('flow',v_flow),('form',v_form),('qualify',v_qualify),('retail',v_retail),('wholesale',v_wholesale);
end $$;

-- Starts one instance sitting on the Qualify stage and answers the linked form.
-- SECURITY DEFINER so the fixture inserts run as the owner; the RPC under test
-- still authorizes the real actor through auth.uid(), which the role does not change.
create or replace function pg_temp.run_qualify(p_answer text) returns uuid language plpgsql security definer as $$
declare v_instance uuid; v_stage_row uuid; v_submission uuid; v_next uuid;
begin
  insert into fms_instances(tenant_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,branch_id,department_id,started_by,context)
    select (select id from route_fixture where name='tenant'),(select id from route_fixture where name='flow'),
           (select family_id from fms_flows where id=(select id from route_fixture where name='flow')),1,
           'RT-'||p_answer,'Routing '||p_answer,'active',(select id from route_fixture where name='branch'),
           (select id from route_fixture where name='dept'),(select id from route_fixture where name='user'),'{}'::jsonb
    returning id into v_instance;
  insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to)
    values(v_instance,(select id from route_fixture where name='qualify'),'in_progress',array[(select id from route_fixture where name='user')])
    returning id into v_stage_row;
  insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by)
    values((select id from route_fixture where name='tenant'),v_stage_row,(select id from route_fixture where name='user'),(select id from route_fixture where name='user'));
  insert into form_submissions(tenant_id,form_template_id,submitted_by,data,linked_module,linked_record_id)
    values((select id from route_fixture where name='tenant'),(select id from route_fixture where name='form'),
           (select id from route_fixture where name='user'),jsonb_build_object('customer_type',p_answer),'fms_stage',v_stage_row)
    returning id into v_submission;
  update fms_instance_stages set form_submission_id=v_submission where id=v_stage_row;

  perform complete_fms_stage_with_audit(v_stage_row,null,null,'{}'::jsonb,null);

  select s.fms_stage_id into v_next from fms_instance_stages s
   where s.fms_instance_id=v_instance and s.id<>v_stage_row order by s.created_at desc limit 1;
  return v_next;
end $$;

grant execute on function pg_temp.run_qualify(text) to authenticated;

-- A stage carrying no rules at all resolves to nothing, so its caller keeps
-- using default_next_stage_id exactly as every published flow already does.
select is(fms_stage_route_target((select s.id from fms_stages s join route_fixture f on f.id=s.fms_flow_id and f.name='flow' where s.stage_key='start_form'),null,null,null),null,'a stage without routes resolves to no route');

-- Establish the actor before dropping to the authenticated role: reading
-- user_profiles as that role is itself governed by RLS.
select set_config('request.jwt.claim.sub',(select id::text from route_fixture where name='auth'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select is(pg_temp.run_qualify('wholesale'),(select id from route_fixture where name='wholesale'),'a wholesale answer takes the conditional route');
select is(pg_temp.run_qualify('retail'),(select id from route_fixture where name='retail'),'a retail answer falls back to the existing single successor');
select is(pg_temp.run_qualify('distributor'),(select id from route_fixture where name='retail'),'an unmatched answer still falls back rather than stranding the instance');
reset role;

-- The routed step remains a normal completed stage; only the successor changed.
select is((select count(*)::integer from fms_stage_logs where action='route_taken'),1,'exactly the routed completion records a route_taken log');

select * from finish();
rollback;
