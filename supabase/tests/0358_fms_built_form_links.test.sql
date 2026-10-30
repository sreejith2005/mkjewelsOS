begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
reset role;

-- The fixture's form is a library form linked to the workflow. A second form is built inside the "call" step.
create temporary table built_fixture(name text primary key,id uuid);
grant all on built_fixture to authenticated;
do $$
declare t uuid:=(select id from visit_assignment_fixture where name='tenant'); u uuid:=(select id from visit_assignment_fixture where name='a'); f uuid; flow uuid; other_t uuid; auth_id uuid:=gen_random_uuid(); b uuid; d uuid;
begin
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by,library_visible)
    values(t,'Call questions',1,'published',true,u,u,false) returning id into f;
  insert into built_fixture values('built',f),('built_family',(select family_id from form_templates where id=f));
  -- A draft workflow whose "Call" step built that form.
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version)
    values(t,gen_random_uuid(),1,'Instagram leads','tenant','draft',true,u,u,2) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(flow,'call','Call','task',0,true,'{"questionnaire":{"origin":"stage"}}',f);
  insert into built_fixture values('flow',flow);
  -- Reusing a family in another workflow must retain exact pairs, not a
  -- Cartesian product of the two workflow names and the two step names.
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version)
    values(t,gen_random_uuid(),1,'Referral leads','tenant','draft',true,u,u,2) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(flow,'review','Review','task',0,true,'{"questionnaire":{"origin":"copied"}}',f);
  insert into built_fixture values('second_flow',flow);
  insert into tenants(name,slug) values('Other built-forms tenant','other-built-forms') returning id into other_t;
  insert into branches(tenant_id,name,code) values(other_t,'Other','OB') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(other_t,b,'Other','OB') returning id into d;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values(auth_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-built@test.local','x',now(),now());
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
    values(other_t,auth_id,b,d,'Other admin','OB-1','other-built@test.local','super_admin','active','active',true);
  insert into built_fixture values('other_auth',auth_id);
end $$;

-- A form author (super admin) sees the FMS-built family with its workflow and step.
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
set local role authenticated;
select is(jsonb_array_length(list_fms_built_forms()),1,'only the form built inside a step is listed');
select is(list_fms_built_forms()->0->>'familyId',(select id::text from built_fixture where name='built_family'),'it is listed by form family');
select is(list_fms_built_forms()->0->'workflows','["Instagram leads","Referral leads"]'::jsonb,'existing workflow names remain sorted and complete');
select is(list_fms_built_forms()->0->'steps','["Call","Review"]'::jsonb,'existing step names remain sorted and complete');
select is(jsonb_array_length(list_fms_built_forms()->0->'links'),2,'a shared form family has exactly its two actual workflow/step links');
select ok(exists(select 1 from jsonb_array_elements(list_fms_built_forms()->0->'links') link
 where link->>'workflowId'=(select id::text from built_fixture where name='flow') and link->>'workflowName'='Instagram leads'
 and link->>'stageId'=(select id::text from fms_stages where fms_flow_id=(select id from built_fixture where name='flow') and stage_key='call') and link->>'stageName'='Call'),
 'Instagram workflow retains its exact Call step id and label');
select ok(exists(select 1 from jsonb_array_elements(list_fms_built_forms()->0->'links') link
 where link->>'workflowId'=(select id::text from built_fixture where name='second_flow') and link->>'workflowName'='Referral leads'
 and link->>'stageId'=(select id::text from fms_stages where fms_flow_id=(select id from built_fixture where name='second_flow') and stage_key='review') and link->>'stageName'='Review'),
 'Referral workflow retains its exact Review step id and label');
select ok(not exists(select 1 from jsonb_array_elements(list_fms_built_forms()->0->'links') link
 where link->>'workflowName'='Instagram leads' and link->>'stageName'='Review' or link->>'workflowName'='Referral leads' and link->>'stageName'='Call'),
 'no nonexistent cross-workflow step pair is invented');
select ok(not exists(select 1 from jsonb_array_elements(list_fms_built_forms()) item where item->>'familyId'=(select family_id::text from form_templates where id=(select id from visit_assignment_fixture where name='form'))),'a library form linked to a step stays a library form');

-- A draft held by a step (not yet in use) also counts.
reset role;
update fms_stages set form_template_id=null,planned_time_rule=planned_time_rule||jsonb_build_object('questionnaire',jsonb_build_object('origin','stage','draftFormId',(select id from built_fixture where name='built')))
  where fms_flow_id=(select id from built_fixture where name='flow') and stage_key='call';
set local role authenticated;
select is(list_fms_built_forms()->0->>'familyId',(select id::text from built_fixture where name='built_family'),'a step draft is FMS-built too');

-- Staff learn which families are FMS-built, without workflow or step names.
reset role;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
set local role authenticated;
select ok(not has_permission('forms.manage'),'the staff member is not a form author');
select is(jsonb_array_length(list_fms_built_forms()),1,'staff see the same classification');
select ok(not (list_fms_built_forms()->0 ? 'workflows') and not (list_fms_built_forms()->0 ? 'steps'),'staff do not receive workflow or step names');
select ok(not (list_fms_built_forms()->0 ? 'links'),'non-authors receive no workflow/step links or identifiers');

-- Another company sees nothing of this one.
reset role;
select set_config('request.jwt.claim.sub',(select id::text from built_fixture where name='other_auth'),true);
set local role authenticated;
select is(list_fms_built_forms(),'[]'::jsonb,'another tenant sees no FMS-built forms from this tenant');

-- Inactive accounts and anonymous callers are refused.
reset role;
update user_profiles set account_status='inactive' where id=(select id from visit_assignment_fixture where name='b');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
set local role authenticated;
select throws_ok($$select list_fms_built_forms()$$,'42501',null,'an inactive account is refused');
reset role;
select ok(not has_function_privilege('anon','list_fms_built_forms()','EXECUTE'),'anonymous callers cannot call it');
select ok(not has_function_privilege('service_role','list_fms_built_forms()','EXECUTE'),'the service role has no grant');
select ok(has_function_privilege('authenticated','list_fms_built_forms()','EXECUTE'),'signed-in users can call it');
select * from finish();
rollback;
