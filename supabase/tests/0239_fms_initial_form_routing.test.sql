begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table entry_fixture(name text primary key,id uuid);
grant select,insert,update on entry_fixture to authenticated;
do $$
declare t uuid; b uuid; d uuid; a uuid; u uuid; f uuid; flow uuid; s uuid; follow uuid; finish uuid;
begin
  insert into tenants(name,slug) values('Entry routing test','entry-routing-test') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','ENT') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','ENT') returning id into d;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','entry@test.local','x',now(),now()) returning id into a;
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
    values(t,a,b,d,'Entry employee','ENTRY1','entry@test.local','staff','active',true) returning id into u;
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by)
    values(t,'Instagram Assignee test',1,'draft',true,u,u) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f,'note','Note','text',0);
  update form_templates set lifecycle='published' where id=f;
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by)
    values(t,gen_random_uuid(),1,'Instagram FMS test','tenant','draft',true,u,u) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(flow,'start','Initial form','form',0,true,'{"deadlineEnabled":false}',f) returning id into s;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(flow,'follow','Follow up','form',1,true,'{"deadlineEnabled":false}',f) returning id into follow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
    values(flow,'finish','Finish','task',2,true,'{"deadlineEnabled":false}') returning id into finish;
  update fms_stages set default_next_stage_id=finish where id=follow;
  insert into fms_branch_rules(fms_stage_id,sort_order,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id)
    values(s,0,'form_answer','note','note','equals','continue',follow),(s,1,'outcome',null,'outcome','default',null,finish);
  update fms_flows set status='published' where id=flow;
  insert into entry_fixture values('tenant',t),('user',u),('auth',a),('form',f),('flow',flow),('first',s),('follow',follow),('finish',finish),('branch',b),('department',d);
end $$;
select set_config('request.jwt.claim.sub',(select id::text from entry_fixture where name='auth'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
insert into entry_fixture select 'instance',(submit_form_and_start_fms_with_audit((select id from entry_fixture where name='form'),'{"note":"continue"}')->>'instance_id')::uuid;
select is((select status::text from fms_instances where id=(select id from entry_fixture where name='instance')),'active','Forms Library entry stays active after routed first form');
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from entry_fixture where name='instance') and fms_stage_id=(select id from entry_fixture where name='follow') and status='in_progress'),1,'the selected first-form route creates exactly one next work item');
select is((select count(*)::integer from v_all_tasks where fms_instance_id=(select id from entry_fixture where name='instance') and status='in_progress' and assignee_id=(select id from entry_fixture where name='user')),1,'next work is visible in the submitter task feed without initial assignment');
reset role;
select is((select count(*)::integer from notification_events where event_type='fms_stage_assigned' and source_record_id=(select id from fms_instance_stages where fms_instance_id=(select id from entry_fixture where name='instance') and fms_stage_id=(select id from entry_fixture where name='follow'))),1,'next work queues its existing durable assignment notification');
set local role authenticated;
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from entry_fixture where name='form'),'{"note":"next"}','fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from entry_fixture where name='instance') and fms_stage_id=(select id from entry_fixture where name='follow') and status='in_progress'),gen_random_uuid())$$,'next-stage form submission completes and advances atomically');
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from entry_fixture where name='instance') and fms_stage_id=(select id from entry_fixture where name='finish') and status='in_progress'),1,'following node becomes the next personal task');
insert into entry_fixture select 'fallback_instance',(submit_form_and_start_fms_with_audit((select id from entry_fixture where name='form'),'{"note":"other"}')->>'instance_id')::uuid;
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from entry_fixture where name='fallback_instance') and fms_stage_id=(select id from entry_fixture where name='finish') and status='in_progress'),1,'Otherwise route is evaluated for the initial form');
reset role;
insert into fms_starter_assignments(tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,status)
values((select id from entry_fixture where name='tenant'),(select id from entry_fixture where name='flow'),(select id from entry_fixture where name='first'),(select id from entry_fixture where name='form'),(select id from entry_fixture where name='user'),'pending');
insert into entry_fixture select 'starter',id from fms_starter_assignments where fms_flow_id=(select id from entry_fixture where name='flow');
set local role authenticated;
insert into entry_fixture select 'assigned_instance',(submit_fms_form_and_progress_with_audit((select id from entry_fixture where name='form'),'{"note":"continue"}','fms_entry',(select id from entry_fixture where name='starter'),gen_random_uuid())->>'instance_id')::uuid;
select is((select count(*)::integer from fms_instance_stages where fms_instance_id=(select id from entry_fixture where name='assigned_instance') and fms_stage_id=(select id from entry_fixture where name='follow') and status='in_progress'),1,'exact starter assignments use the same initial form route');
select throws_ok($$select submit_fms_form_and_progress_with_audit((select id from entry_fixture where name='form'),'{"note":"continue"}','fms_entry',(select id from entry_fixture where name='starter'),gen_random_uuid())$$,'42501','FMS starter assignment is not available for this exact form','completed starter cannot be submitted again');
select is((select instance_id from start_fms_from_form_submission_with_audit((select form_submission_id from fms_instance_stages where fms_instance_id=(select id from entry_fixture where name='instance') and fms_stage_id=(select id from entry_fixture where name='first')))),(select id from entry_fixture where name='instance'),'replaying the durable initial submission returns its original workflow');
reset role;
select ok(not has_function_privilege('authenticated','progress_fms_initial_form_internal(uuid)','EXECUTE'),'clients cannot bypass the protected entry contract');
select ok(not has_function_privilege('anon','start_fms_from_form_submission_with_audit(uuid)','EXECUTE'),'anonymous callers cannot start workflows');
select ok(not has_function_privilege('service_role','progress_fms_initial_form_internal(uuid)','EXECUTE'),'service-role clients cannot call internal progression');
-- A workflow explicitly scoped to a different branch cannot silently fall back
-- to an ordinary saved form or authorize a cross-branch start.
insert into branches(tenant_id,name,code) values((select id from entry_fixture where name='tenant'),'Other','OTHER');
update fms_flows set status='draft' where id=(select id from entry_fixture where name='flow');
update fms_flows set scope_type='branch',branch_id=(select id from branches where tenant_id=(select id from entry_fixture where name='tenant') and code='OTHER') where id=(select id from entry_fixture where name='flow');
update fms_flows set status='published' where id=(select id from entry_fixture where name='flow');
set local role authenticated;
select throws_ok($$select submit_form_and_start_fms_with_audit((select id from entry_fixture where name='form'),'{"note":"continue"}')$$,'42501','This workflow is not available in your branch or department.','cross-branch entry is rejected');
reset role;
update fms_flows set status='draft' where id=(select id from entry_fixture where name='flow');
update fms_flows set scope_type='tenant',branch_id=null where id=(select id from entry_fixture where name='flow');
update fms_flows set status='published' where id=(select id from entry_fixture where name='flow');
-- A newer form version must not silently detach the published workflow.
update fms_instances set status='completed',completed_at=now() where fms_flow_id=(select id from entry_fixture where name='flow');
do $$ declare f form_templates; n uuid; begin
  select * into f from form_templates where id=(select id from entry_fixture where name='form');
  update form_templates set lifecycle='archived' where id=f.id;
  insert into form_templates(tenant_id,family_id,name,version,lifecycle,is_active,created_by,updated_by)
  values(f.tenant_id,f.family_id,f.name,2,'draft',true,f.created_by,f.updated_by) returning id into n;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(n,'note','Note','text',0);
  update form_templates set lifecycle='published' where id=n;
  insert into entry_fixture values('new_form',n);
end $$;
set local role authenticated;
select throws_ok($$select submit_form_and_start_fms_with_audit((select id from entry_fixture where name='new_form'),'{"note":"continue"}')$$,'23514','This workflow uses a different version of this form. Open its linked initial form or update and publish the workflow.','a mismatched initial form version gives an actionable error');
select is((select count(*)::integer from form_submissions where form_template_id=(select id from entry_fixture where name='new_form')),0,'a rejected workflow start leaves no orphan submission');
reset role;
select * from finish();
rollback;
