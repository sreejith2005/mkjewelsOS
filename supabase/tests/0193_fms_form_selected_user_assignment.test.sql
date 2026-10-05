begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(25);

select function_owner_is('public','resolve_fms_stage_assignees',array['uuid','uuid','uuid'],'postgres','assignment resolver is server owned');
select ok(not has_function_privilege('anon','resolve_fms_stage_assignees(uuid,uuid,uuid)','EXECUTE'),'anonymous callers cannot resolve assignment');
select ok(not has_function_privilege('authenticated','resolve_fms_stage_assignees_before_form_user(uuid,uuid,uuid)','EXECUTE'),'clients cannot bypass form assignment precedence');
select ok(not has_function_privilege('authenticated','fms_assignment_user_from_submission(uuid,uuid)','EXECUTE'),'clients cannot forge a form selected user');
select function_owner_is('public','submit_form_and_start_fms_with_audit',array['uuid','jsonb'],'postgres','atomic Forms Library entry point is server owned');
select ok(not has_function_privilege('anon','submit_form_and_start_fms_with_audit(uuid,jsonb)','EXECUTE'),'anonymous callers cannot submit and start a workflow');

create temporary table fms_assignment_fixture(name text primary key,id uuid) on commit drop;
grant select on fms_assignment_fixture to authenticated;
do $$
declare v_tenant uuid; v_branch uuid; v_department uuid; v_auth uuid; v_starter uuid; v_selected uuid;
  v_form uuid; v_flow uuid; v_first uuid; v_next uuid; v_submission uuid; v_instance uuid;
begin
  insert into tenants(name,slug) values('Assignment test tenant','assignment-test-tenant') returning id into v_tenant;
  insert into branches(tenant_id,name,code) values(v_tenant,'Main','ASM') returning id into v_branch;
  insert into departments(tenant_id,branch_id,name,code) values(v_tenant,v_branch,'Sales','ASD') returning id into v_department;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','starter-assignment@test.local','x',now(),now()) returning id into v_auth;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
    values(v_tenant,v_auth,v_branch,v_department,'Starter','ASM-1','starter-assignment@test.local','staff','active','active',true) returning id into v_starter;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','selected-assignment@test.local','x',now(),now()) returning id into v_auth;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
    values(v_tenant,v_auth,v_branch,v_department,'Selected','ASM-2','selected-assignment@test.local','staff','active','active',true) returning id into v_selected;
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by)
    values(v_tenant,'Assignment intake',1,'draft',true,v_starter,v_starter) returning id into v_form;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown)
    values(v_form,'assigned_to','Assigned to','user_dropdown',0,true,true);
  update form_templates set lifecycle='published' where id=v_form;
  insert into fms_flows(tenant_id,family_id,version,name,description,scope_type,status,is_active,created_by,updated_by)
    values(v_tenant,gen_random_uuid(),1,'Assignment flow','FMS selected user test','tenant','draft',true,v_starter,v_starter) returning id into v_flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(v_flow,'start_form','Start form','form',0,true,'{"deadlineEnabled":false,"assignmentFieldKey":"assigned_to"}',v_form) returning id into v_first;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
    values(v_flow,'next','Next step','task',1,true,'{"deadlineEnabled":false}') returning id into v_next;
  update fms_stages set default_next_stage_id=v_next where id=v_first;
  insert into form_submissions(tenant_id,branch_id,department_id,form_template_id,data,submitted_by,status)
    values(v_tenant,v_branch,v_department,v_form,jsonb_build_object('assigned_to',v_selected),v_starter,'submitted') returning id into v_submission;
  insert into fms_instances(tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,priority,context,started_by)
    values(v_tenant,v_branch,v_department,v_flow,(select family_id from fms_flows where id=v_flow),1,'FMS-ASSIGNMENT-TEST','Assignment run','active','medium',jsonb_build_object('form_submission_id',v_submission,'form_template_id',v_form,'_fms_assignment_user_id',v_starter),v_starter) returning id into v_instance;
  insert into fms_assignment_fixture(name,id) values
    ('flow',v_flow),('first',v_first),('next',v_next),('instance',v_instance),('starter',v_starter),('selected',v_selected),('form',v_form),('tenant',v_tenant);
end $$;

select lives_ok($$select assert_fms_flow_publishable((select id from fms_assignment_fixture where name='flow'))$$,'an unnamed later step publishes when a required User question precedes it');
select is((select context->>'_fms_assignment_user_id' from fms_instances where id=(select id from fms_assignment_fixture where name='instance')),(select id::text from fms_assignment_fixture where name='selected'),'starting form answer, not client context, chooses the default');
do $$
declare v_starter_assignment uuid; v_submission uuid; v_flow fms_flows; v_actor user_profiles;
begin
  select * into v_flow from fms_flows where id=(select id from fms_assignment_fixture where name='flow');
  select * into v_actor from user_profiles where id=(select id from fms_assignment_fixture where name='starter');
  insert into fms_starter_assignments(tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,status)
    values(v_flow.tenant_id,v_flow.id,(select id from fms_assignment_fixture where name='first'),
      (select id from fms_assignment_fixture where name='form'),v_actor.id,'pending') returning id into v_starter_assignment;
  insert into form_submissions(tenant_id,branch_id,department_id,form_template_id,linked_module,linked_record_id,data,submitted_by,status)
    values(v_flow.tenant_id,v_actor.branch_id,v_actor.department_id,(select id from fms_assignment_fixture where name='form'),
      'fms_entry',v_starter_assignment,jsonb_build_object('assigned_to',(select id from fms_assignment_fixture where name='selected')),
      v_actor.id,'submitted') returning id into v_submission;
  insert into fms_instances(tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,priority,context,started_by)
    values(v_flow.tenant_id,v_actor.branch_id,v_actor.department_id,v_flow.id,v_flow.family_id,v_flow.version,
      'FMS-ASSIGNMENT-STARTER','Assigned starter run','active','medium',
      jsonb_build_object('form_submission_id',v_submission,'form_template_id',(select id from fms_assignment_fixture where name='form'),
        'starter_assignment_id',v_starter_assignment),v_actor.id);
end $$;
select is((select context->>'_fms_assignment_user_id' from fms_instances where reference_number='FMS-ASSIGNMENT-STARTER'),
  (select id::text from fms_assignment_fixture where name='selected'),'named starter submission also establishes the User answer default');
select is((resolve_fms_stage_assignees((select id from fms_assignment_fixture where name='next'),(select id from fms_assignment_fixture where name='instance'),null))[1],(select id from fms_assignment_fixture where name='selected'),'unnamed later step uses the selected profile ID');
update user_profiles set is_login_enabled=false where id=(select id from fms_assignment_fixture where name='selected');
select throws_ok($$select resolve_fms_stage_assignees((select id from fms_assignment_fixture where name='next'),(select id from fms_assignment_fixture where name='instance'),null)$$,
  '23503','FMS user is not an active login-enabled tenant profile','a deactivated selected user cannot receive a later step');
update user_profiles set is_login_enabled=true where id=(select id from fms_assignment_fixture where name='selected');
update form_submissions set data=jsonb_build_object('assigned_to',gen_random_uuid())
where id=(select (context->>'form_submission_id')::uuid from fms_instances where id=(select id from fms_assignment_fixture where name='instance'));
select throws_ok($$select fms_assignment_user_from_submission((select id from fms_assignment_fixture where name='first'),
  (select (context->>'form_submission_id')::uuid from fms_instances where id=(select id from fms_assignment_fixture where name='instance')))$$,
  '23503','FMS user is not an active login-enabled tenant profile','a foreign or nonexistent profile ID cannot become the form default');

insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order)
values((select id from fms_assignment_fixture where name='next'),'specific_user',(select id from fms_assignment_fixture where name='starter'),0);
select is((resolve_fms_stage_assignees((select id from fms_assignment_fixture where name='next'),(select id from fms_assignment_fixture where name='instance'),null))[1],(select id from fms_assignment_fixture where name='starter'),'step-specific assignee overrides the form default');
delete from fms_stage_assignees where fms_stage_id=(select id from fms_assignment_fixture where name='next');

update fms_stages set step_type='form',form_template_id=(select id from fms_assignment_fixture where name='form'),
  planned_time_rule='{"deadlineEnabled":false,"assignmentFieldKey":"assigned_to"}'::jsonb
where id=(select id from fms_assignment_fixture where name='next');
insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,activated_at)
values((select id from fms_assignment_fixture where name='instance'),(select id from fms_assignment_fixture where name='next'),'in_progress',array[(select id from fms_assignment_fixture where name='selected')],now());
select throws_ok($$update fms_instance_stages set status='completed' where fms_stage_id=(select id from fms_assignment_fixture where name='next')$$,
  '23514','Submit the User assignment form before completing FMS step Next step','a later assignment source cannot be skipped');
insert into form_submissions(tenant_id,branch_id,department_id,form_template_id,linked_module,linked_record_id,data,submitted_by,status)
select (select id from fms_assignment_fixture where name='tenant'),i.branch_id,i.department_id,
  (select id from fms_assignment_fixture where name='form'),'fms_stage',work.id,
  jsonb_build_object('assigned_to',(select id from fms_assignment_fixture where name='starter')),
  (select id from fms_assignment_fixture where name='selected'),'submitted'
from fms_instance_stages work join fms_instances i on i.id=work.fms_instance_id
where work.fms_stage_id=(select id from fms_assignment_fixture where name='next');
select is((select context->>'_fms_assignment_user_id' from fms_instances where id=(select id from fms_assignment_fixture where name='instance')),
  (select id::text from fms_assignment_fixture where name='starter'),'a later linked Form updates the default for following steps');
update fms_instance_stages work set form_submission_id=submission.id from form_submissions submission
where submission.linked_module='fms_stage' and submission.linked_record_id=work.id
  and work.fms_stage_id=(select id from fms_assignment_fixture where name='next');
select lives_ok($$update fms_instance_stages set status='completed' where fms_stage_id=(select id from fms_assignment_fixture where name='next')$$,
  'the later step completes after its assignment form is submitted');
update fms_stages set step_type='task' where id=(select id from fms_assignment_fixture where name='next');
select lives_ok($$select assert_fms_flow_publishable((select id from fms_assignment_fixture where name='flow'))$$,
  'a task step may use its linked Form User question for later assignment');
update fms_stages set planned_time_rule='{"deadlineEnabled":false}'::jsonb where id=(select id from fms_assignment_fixture where name='first');
select lives_ok($$select assert_fms_flow_publishable((select id from fms_assignment_fixture where name='flow'))$$,'unnamed steps publish because the starting form submitter remains the default');
select ok((select count(*) from fms_stage_assignees where fms_stage_id=(select id from fms_assignment_fixture where name='next'))=0,'validation does not synthesize a named stage assignee');
update fms_instances set context=context-'_fms_assignment_user_id' where id=(select id from fms_assignment_fixture where name='instance');
select is((resolve_fms_stage_assignees((select id from fms_assignment_fixture where name='next'),(select id from fms_assignment_fixture where name='instance'),null))[1],(select id from fms_assignment_fixture where name='starter'),'an unassigned later step stays with the starting form submitter');
update form_submissions set data=jsonb_build_object('assigned_to',(select id from fms_assignment_fixture where name='selected'))
where id=(select (context->>'form_submission_id')::uuid from fms_instances where id=(select id from fms_assignment_fixture where name='instance'));
select is(fms_assignment_user_from_submission((select id from fms_assignment_fixture where name='first'),
  (select (context->>'form_submission_id')::uuid from fms_instances where id=(select id from fms_assignment_fixture where name='instance'))),
  (select id from fms_assignment_fixture where name='selected'),'the linked Form User answer works without a second FMS selector');
do $$
declare v_form uuid; v_submission uuid; v_starter user_profiles;
begin
  select * into v_starter from user_profiles where id=(select id from fms_assignment_fixture where name='starter');
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by)
    values(v_starter.tenant_id,'Reviewer only',1,'draft',true,v_starter.id,v_starter.id) returning id into v_form;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,is_required,is_shown)
    values(v_form,'reviewer','Reviewer','user_dropdown',0,true,true);
  update form_templates set lifecycle='published' where id=v_form;
  insert into form_submissions(tenant_id,branch_id,department_id,form_template_id,data,submitted_by,status)
    values(v_starter.tenant_id,v_starter.branch_id,v_starter.department_id,v_form,
      jsonb_build_object('reviewer',(select id from fms_assignment_fixture where name='selected')),v_starter.id,'submitted') returning id into v_submission;
  insert into fms_assignment_fixture(name,id) values('reviewer_form',v_form),('reviewer_submission',v_submission);
end $$;
update fms_stages set form_template_id=(select id from fms_assignment_fixture where name='reviewer_form')
where id=(select id from fms_assignment_fixture where name='first');
select is(fms_assignment_user_from_submission((select id from fms_assignment_fixture where name='first'),
  (select id from fms_assignment_fixture where name='reviewer_submission')),
  null::uuid,'an unrelated User question does not silently assign workflow work');
update fms_stages set form_template_id=(select id from fms_assignment_fixture where name='form')
where id=(select id from fms_assignment_fixture where name='first');

update fms_stages set planned_time_rule='{"deadlineEnabled":false,"assignmentFieldKey":"assigned_to"}'::jsonb
where id=(select id from fms_assignment_fixture where name='first');
update fms_flows set status='published' where id=(select id from fms_assignment_fixture where name='flow');
select set_config('request.jwt.claim.sub',(select auth_user_id::text from user_profiles where id=(select id from fms_assignment_fixture where name='starter')),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok($$select submit_form_and_start_fms_with_audit(
  (select id from fms_assignment_fixture where name='form'),
  jsonb_build_object('assigned_to',(select id from fms_assignment_fixture where name='selected')))$$,
  'one Forms Library RPC saves the form and starts its FMS instance');
reset role;
create temporary table fms_submission_count_before_failure on commit drop as select count(*)::integer as n from form_submissions;
update user_profiles set is_login_enabled=false where id=(select id from fms_assignment_fixture where name='selected');
select set_config('request.jwt.claim.sub',(select auth_user_id::text from user_profiles where id=(select id from fms_assignment_fixture where name='starter')),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok($$select submit_form_and_start_fms_with_audit(
  (select id from fms_assignment_fixture where name='form'),
  jsonb_build_object('assigned_to',(select id from fms_assignment_fixture where name='selected')))$$,
  '23503','FMS user is not an active login-enabled tenant profile','invalid assigned user aborts the combined submission');
reset role;
select is((select count(*)::integer from form_submissions),(select n from fms_submission_count_before_failure),
  'a failed workflow start leaves no orphan form submission');

select * from finish();
rollback;
