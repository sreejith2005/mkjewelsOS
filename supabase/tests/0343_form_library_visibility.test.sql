begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table visibility_fixture(name text primary key,id uuid);
grant all on visibility_fixture to authenticated;
do $$
declare t uuid; b uuid; d uuid; a uuid; u uuid; f uuid; flow uuid; s uuid; follow uuid; finish uuid; role_name text;
begin
  insert into tenants(name,slug) values('Form visibility test','form-visibility-test') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','VIS') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','VIS') returning id into d;
  insert into visibility_fixture values('tenant',t),('branch',b),('department',d);
  foreach role_name in array array['admin','manager','staff','other'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',role_name||'-visibility@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
    values(t,a,b,d,role_name,role_name||'-VIS',role_name||'-visibility@test.local',case when role_name in ('admin','manager') then role_name::user_role else 'staff'::user_role end,'active',true) returning id into u;
    insert into visibility_fixture values(role_name,u),(role_name||'_auth',a);
  end loop;
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,permissions,created_by,updated_by)
    values(t,'Instagram Assignee visibility',1,'draft',true,'{"roles":["staff"]}',u,u) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f,'note','Note','text',0);
  update form_templates set lifecycle='published',published_at=now() where id=f;
  insert into visibility_fixture values('entry_form',f);
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,permissions,created_by,updated_by)
    values(t,'Work and Upload visibility',1,'draft',true,'{"roles":["staff"]}',u,u) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f,'note','Note','text',0);
  update form_templates set lifecycle='published',published_at=now() where id=f;
  insert into visibility_fixture values('work_form',f);
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by)
    values(t,gen_random_uuid(),1,'Visibility workflow','tenant','draft',true,u,u) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(flow,'start','Initial form','form',0,true,'{"deadlineEnabled":false}',(select id from visibility_fixture where name='entry_form')) returning id into s;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(flow,'work','Work and Upload','form',1,true,'{"deadlineEnabled":false}',f) returning id into follow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
    values(flow,'finish','Finish','task',2,true,'{"deadlineEnabled":false}') returning id into finish;
  update fms_stages set default_next_stage_id=follow where id=s;
  update fms_stages set default_next_stage_id=finish where id=follow;
  update fms_flows set status='published' where id=flow;
  insert into visibility_fixture values('flow',flow),('first',s),('follow',follow),('finish',finish);
end $$;

select ok((select bool_and(library_visible) from form_templates where tenant_id=(select id from visibility_fixture where name='tenant')),'existing and new forms default to visible');
select set_config('request.jwt.claim.sub',(select id::text from visibility_fixture where name='admin_auth'),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok($$select set_form_library_visibility_with_audit((select id from visibility_fixture where name='work_form'),false)$$,'author hides a published form');
select is((select library_visible from form_templates where id=(select id from visibility_fixture where name='work_form')),false,'hidden form remains readable to authors');
select throws_ok($$select set_form_library_visibility_with_audit((select id from visibility_fixture where name='work_form'),null)$$,'22023',null,'null visibility is rejected');
insert into visibility_fixture select 'revision',create_form_revision_with_audit((select id from visibility_fixture where name='work_form'));
insert into visibility_fixture select 'duplicate',duplicate_form_with_audit((select id from visibility_fixture where name='work_form'),'Hidden duplicate');
select is((select library_visible from form_templates where id=(select id from visibility_fixture where name='revision')),false,'revision inherits hidden visibility');
select is((select library_visible from form_templates where id=(select id from visibility_fixture where name='duplicate')),false,'duplicate inherits hidden visibility');
reset role;
select is((select count(*)::int from audit_logs where record_id=(select id from visibility_fixture where name='work_form') and action='form_library_visibility_changed' and old_value->>'library_visible'='true' and new_value->>'library_visible'='false'),1,'visibility change is audited with old and new values');
select throws_ok($$update form_templates set name='Unauthorized definition edit' where id=(select id from visibility_fixture where name='work_form')$$,'55000',null,'metadata support does not weaken published definition immutability');
select ok(not has_table_privilege('authenticated','form_templates','UPDATE'),'browser cannot change visibility directly on table');
insert into tenants(name,slug) values('Other visibility tenant','other-visibility-tenant');
insert into form_templates(tenant_id,name) select id,'Cross-tenant form' from tenants where slug='other-visibility-tenant';
insert into visibility_fixture select 'cross_form',id from form_templates where name='Cross-tenant form' and tenant_id=(select id from tenants where slug='other-visibility-tenant');
set local role authenticated;
select throws_ok($$select set_form_library_visibility_with_audit((select id from visibility_fixture where name='cross_form'),false)$$,'42501',null,'author cannot change another tenant form');
select is((select count(*)::int from form_templates where id=(select id from visibility_fixture where name='cross_form')),0,'author cannot fetch another tenant form');
reset role;
select set_config('request.jwt.claim.sub',(select id::text from visibility_fixture where name='manager_auth'),true);
set local role authenticated;
select is((select count(*)::int from form_templates where id=(select id from visibility_fixture where name='work_form')),1,'manager author sees hidden staff-only form for management');
select is(can_open_form_from_library((select id from visibility_fixture where name='work_form')),false,'author permission does not bypass existing form fill role eligibility');
select throws_ok($$select submit_form_with_audit((select id from visibility_fixture where name='work_form'),'{"note":"author role bypass"}')$$,'42501',null,'manager cannot independently fill staff-only hidden form');
reset role;

select set_config('request.jwt.claim.sub',(select id::text from visibility_fixture where name='staff_auth'),true);
set local role authenticated;
select is((select count(*)::int from form_templates where id=(select id from visibility_fixture where name='work_form')),0,'unassigned staff cannot fetch hidden form directly');
select throws_ok($$select set_form_library_visibility_with_audit((select id from visibility_fixture where name='work_form'),true)$$,'42501',null,'staff cannot change visibility through RPC');
select throws_ok($$select submit_form_with_audit((select id from visibility_fixture where name='work_form'),'{"note":"bypass"}')$$,'42501',null,'staff cannot submit a hidden form independently');
insert into visibility_fixture select 'instance',(submit_form_and_start_fms_with_audit((select id from visibility_fixture where name='entry_form'),'{"note":"start"}')->>'instance_id')::uuid;
select is((select count(*)::int from form_templates where id=(select id from visibility_fixture where name='work_form')),1,'assigned employee can read hidden work form');
select is(can_open_form_from_library((select id from visibility_fixture where name='work_form')),false,'assignment does not confer library eligibility');
select is((select count(*)::int from v_all_tasks where fms_instance_id=(select id from visibility_fixture where name='instance') and status='in_progress'),1,'hidden next-stage form still appears in Tasks');
select throws_ok($$select submit_form_with_audit((select id from visibility_fixture where name='work_form'),'{"note":"bypass"}')$$,'42501',null,'assignment read access cannot bypass independent-submit restriction');
select throws_ok($$select submit_form_and_start_fms_idempotent((select id from visibility_fixture where name='work_form'),'{"note":"bypass"}',gen_random_uuid())$$,'42501',null,'library workflow entry cannot bypass hidden visibility');
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from visibility_fixture where name='work_form'),'{"note":"done"}','fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from visibility_fixture where name='instance') and fms_stage_id=(select id from visibility_fixture where name='follow') and status='in_progress'),gen_random_uuid())$$,'hidden assigned form submits and progresses atomically');
select is((select count(*)::int from fms_instance_stages where fms_instance_id=(select id from visibility_fixture where name='instance') and fms_stage_id=(select id from visibility_fixture where name='finish') and status='in_progress'),1,'workflow continues to next step');
select is((select count(*)::int from form_submissions where form_template_id=(select id from visibility_fixture where name='work_form')),1,'hidden form submission history remains readable');
select throws_ok($$select submit_form_with_audit((select id from visibility_fixture where name='work_form'),'{"note":"history bypass"}')$$,'42501',null,'history read access cannot bypass independent-submit restriction');
reset role;

-- Ordinary task completion retains its existing exact-form contract.
insert into task_instances(tenant_id,branch_id,department_id,task_type,title,planned_datetime,requires_form,form_template_id,created_by)
values((select id from visibility_fixture where name='tenant'),(select id from visibility_fixture where name='branch'),(select id from visibility_fixture where name='department'),'checklist','Hidden required form task',now(),true,(select id from visibility_fixture where name='work_form'),(select id from visibility_fixture where name='admin'));
insert into visibility_fixture select 'task',id from task_instances where title='Hidden required form task' and tenant_id=(select id from visibility_fixture where name='tenant');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_active)
values((select id from visibility_fixture where name='task'),(select id from visibility_fixture where name='staff'),'doer',true);
set local role authenticated;
select lives_ok($$select submit_form_with_audit((select id from visibility_fixture where name='work_form'),'{"note":"task answer"}','checklist_task',(select id from visibility_fixture where name='task'))$$,'hidden ordinary task form still submits through exact task');
reset role;

-- Exact starter assignments retain access too.
insert into fms_starter_assignments(tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,status)
values((select id from visibility_fixture where name='tenant'),(select id from visibility_fixture where name='flow'),(select id from visibility_fixture where name='first'),(select id from visibility_fixture where name='entry_form'),(select id from visibility_fixture where name='staff'),'pending');
insert into visibility_fixture select 'starter',id from fms_starter_assignments where fms_flow_id=(select id from visibility_fixture where name='flow');
update form_templates set library_visible=false where id=(select id from visibility_fixture where name='entry_form');
set local role authenticated;
select throws_ok($$select preview_fms_work_transition(jsonb_build_object('kind','flow_form','flowId',(select id from visibility_fixture where name='flow'),'formTemplateId',(select id from visibility_fixture where name='entry_form'),'answers','{"note":"bypass"}'::jsonb))$$,'42501',null,'direct workflow preview cannot bypass hidden library visibility');
select lives_ok($$select preview_fms_work_transition(jsonb_build_object('kind','starter_form','starterAssignmentId',(select id from visibility_fixture where name='starter'),'formTemplateId',(select id from visibility_fixture where name='entry_form'),'answers','{"note":"assigned start"}'::jsonb))$$,'confirmed assigned-work preview accepts hidden exact starter');
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from visibility_fixture where name='entry_form'),'{"note":"assigned start"}','fms_entry',(select id from visibility_fixture where name='starter'),gen_random_uuid())$$,'hidden exact starter can still start workflow');
reset role;

select set_config('request.jwt.claim.sub',(select id::text from visibility_fixture where name='other_auth'),true);
set local role authenticated;
select is((select count(*)::int from form_templates where id=(select id from visibility_fixture where name='work_form')),0,'other employee cannot read assigned hidden form');
reset role;
insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect)
values((select id from visibility_fixture where name='other'),(select id from visibility_fixture where name='tenant'),'forms.manage','grant');
set local role authenticated;
select is((select count(*)::int from form_templates where id=(select id from visibility_fixture where name='work_form')),1,'delegated form author can manage hidden forms');
select lives_ok($$select set_form_library_visibility_with_audit((select id from visibility_fixture where name='work_form'),true)$$,'delegated forms.manage grants visibility control');
reset role;
update user_permission_overrides set effect='deny' where user_profile_id=(select id from visibility_fixture where name='other') and permission_key='forms.manage';
set local role authenticated;
select throws_ok($$select set_form_library_visibility_with_audit((select id from visibility_fixture where name='work_form'),false)$$,'42501',null,'explicit author permission denial is enforced');
reset role;
update user_profiles set is_login_enabled=false where id=(select id from visibility_fixture where name='admin');
select set_config('request.jwt.claim.sub',(select id::text from visibility_fixture where name='admin_auth'),true);
set local role authenticated;
select throws_ok($$select set_form_library_visibility_with_audit((select id from visibility_fixture where name='work_form'),true)$$,'42501',null,'inactive author is denied');
reset role;
select ok(not has_function_privilege('anon','set_form_library_visibility_with_audit(uuid,boolean)','EXECUTE'),'anonymous visibility writes denied');
select ok(not has_function_privilege('service_role','set_form_library_visibility_with_audit(uuid,boolean)','EXECUTE'),'service role cannot impersonate an author');
select * from finish();
rollback;
