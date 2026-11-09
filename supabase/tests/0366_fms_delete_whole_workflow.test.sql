begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Migration 0397 withdrew fms.manage from Admin by default; this test keeps an Admin as the FMS builder.
update permission_catalog set default_roles = array_append(default_roles, 'admin') where key = 'fms.manage' and not ('admin' = any(default_roles));
create temporary table wf_fixture(name text primary key,id uuid);
grant select,insert,update on wf_fixture to authenticated;

-- One workflow family with three versions (like INSTAGRAM LEADS v1..v16) and an unused one.
do $$
declare t uuid; t2 uuid; b uuid; d uuid; b2 uuid; d2 uuid; a uuid; u uuid; f uuid; person text; fam uuid; spare uuid; flow uuid; s1 uuid; s2 uuid; s3 uuid; v integer;
begin
  insert into tenants(name,slug) values('Workflow delete','workflow-delete') returning id into t;
  insert into tenants(name,slug) values('Workflow other','workflow-other') returning id into t2;
  insert into branches(tenant_id,name,code) values(t,'Main','WFD') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','WFD') returning id into d;
  insert into branches(tenant_id,name,code) values(t2,'Other','WFX') returning id into b2;
  insert into departments(tenant_id,branch_id,name,code) values(t2,b2,'Other','WFX') returning id into d2;
  foreach person in array array['doer','outsider','admin','super'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-wf@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
      values(case when person='outsider' then t2 else t end,a,case when person='outsider' then b2 else b end,case when person='outsider' then d2 else d end,
        'Wf '||person,'WF-'||person,person||'-wf@test.local',
        case person when 'admin' then 'admin' when 'doer' then 'staff' else 'super_admin' end::user_role,'active',true) returning id into u;
    insert into wf_fixture values(person,u),(person||'_auth',a);
  end loop;
  select id into u from wf_fixture where name='doer';
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by) values(t,'Lead form',1,'draft',true,u,u) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f,'status','Status','text',0);
  update form_templates set lifecycle='published' where id=f;
  fam := gen_random_uuid(); spare := gen_random_uuid();
  for v in 1..4 loop
    insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by)
      values(t,case when v=4 then spare else fam end,case when v=4 then 1 else v end,case when v=4 then 'Unused' else 'INSTAGRAM LEADS' end,'tenant','draft',true,u,u) returning id into flow;
    insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'start','Start','form',0,true,'{"deadlineEnabled":false}',f) returning id into s1;
    insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'intro','Introduction','form',1,true,'{"deadlineEnabled":false}',f) returning id into s2;
    insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'f1','Follow-up','form',2,true,'{"deadlineEnabled":false}',f) returning id into s3;
    insert into fms_branch_rules(fms_stage_id,sort_order,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id) values
      (s2,0,'form_answer','status','status','equals','follow_up',s3),(s3,0,'form_answer','status','status','equals','intro',s2);
    update fms_stages set default_next_stage_id=s2 where id=s1;
    insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) select id,'specific_user',u,0 from fms_stages where fms_flow_id=flow;
    if v = 1 then update fms_flows set status='published' where id=flow; elsif v = 2 then update fms_flows set status='archived' where id=flow; end if;
    insert into wf_fixture values('v'||v,flow);
  end loop;
  insert into wf_fixture values('tenant',t),('form',f),('family',fam),('spare',spare);
end $$;

create function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from wf_fixture where name=p $$;
create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',(select id::text from wf_fixture where name=p||'_auth'),true), set_config('request.jwt.claim.role','authenticated',true) $$;
create function pg_temp.start() returns uuid language sql as $$
  select (submit_form_and_start_fms_with_audit(pg_temp.fx('form'),'{"status":"new"}')->>'instance_id')::uuid $$;
grant execute on function pg_temp.fx(text),pg_temp.as_user(text),pg_temp.start() to authenticated;

-- v1 ran once and was archived; v2 is live with one run; v3 is a draft.

select pg_temp.as_user('doer'); set local role authenticated;
insert into wf_fixture select 'run1',pg_temp.start();
reset role;
update fms_flows set status='archived' where id=pg_temp.fx('v1');
update fms_flows set status='published' where id=pg_temp.fx('v2');
select pg_temp.as_user('doer'); set local role authenticated;
insert into wf_fixture select 'run2',pg_temp.start();
reset role;
insert into notifications(tenant_id,user_profile_id,event_type,title,message,source_module,source_record_id)
  select pg_temp.fx('tenant'),pg_temp.fx('doer'),'fms_stage_assigned','Step','Waiting','fms',w.id from fms_instance_stages w where w.fms_instance_id=pg_temp.fx('run2');
select ok((select count(*) from notifications where source_module='fms' and tenant_id=pg_temp.fx('tenant'))>0,'the live run has alerts');

-- 1. An admin archives a workflow with runs, then is told a super admin is needed.
select pg_temp.as_user('admin'); set local role authenticated;
select is(fms_workflow_deletion_impact(pg_temp.fx('family'))->>'action','archive','an admin archives a workflow with runs');
select is(delete_fms_workflow_with_audit(pg_temp.fx('family'))->>'outcome','archived','the admin delete archives every live version');
select is(fms_workflow_deletion_impact(pg_temp.fx('family'))->>'action','denied','an archived workflow with runs is not the admin''s to erase');
select throws_ok($$select delete_fms_workflow_with_audit(pg_temp.fx('family'),'DELETE')$$,'42501',null,'the admin cannot erase it even with DELETE');
reset role;
select is((select count(*)::integer from fms_flows where family_id=pg_temp.fx('family') and status='archived'),3,'all three versions are archived');

-- 2. Other tenants and anonymous callers are refused.
select pg_temp.as_user('outsider'); set local role authenticated;
select throws_ok($$select fms_workflow_deletion_impact(pg_temp.fx('family'))$$,'23514','Workflow not found','another tenant cannot see the workflow');
select throws_ok($$select delete_fms_workflow_with_audit(pg_temp.fx('family'),'DELETE')$$,'23514','Workflow not found','another tenant''s super admin cannot delete it');
reset role;
select ok(not has_function_privilege('anon','delete_fms_workflow_with_audit(uuid,text)','EXECUTE'),'anon cannot delete workflows');
select ok(not has_function_privilege('anon','fms_workflow_deletion_impact(uuid)','EXECUTE'),'anon cannot read the impact');

-- 3. The super admin removes the whole workflow: every version, run and alert.
select pg_temp.as_user('super'); set local role authenticated;
select is(fms_workflow_deletion_impact(pg_temp.fx('family')) - 'handoffsFrom',
  '{"name":"INSTAGRAM LEADS","versions":3,"runs":2,"openRuns":2,"canErase":true,"action":"erase"}'::jsonb,'the warning counts versions, runs and open runs');
select throws_ok($$select delete_fms_workflow_with_audit(pg_temp.fx('family'),null)$$,'22023','Type DELETE to confirm','runs need the typed confirmation');
select is(delete_fms_workflow_with_audit(pg_temp.fx('family'),'DELETE'),'{"outcome":"deleted","versions":3,"runs":2}'::jsonb,'the super admin deletes the workflow');
reset role;
select is((select count(*)::integer from fms_flows where family_id=pg_temp.fx('family')),0,'no version is left, archived or otherwise');
select is((select count(*)::integer from fms_instances where id in (pg_temp.fx('run1'),pg_temp.fx('run2'))),0,'its runs are gone');
select is((select count(*)::integer from notifications where tenant_id=pg_temp.fx('tenant') and source_module='fms'),0,'its alerts are gone');
select is((select count(*)::integer from audit_logs where action='fms_workflow_deleted' and record_id=pg_temp.fx('family')),1,'one audit row records the deletion');
select is((select count(*)::integer from fms_flows where id=pg_temp.fx('v4')),1,'other workflows are untouched');

-- 4. A workflow that never ran is deleted by an admin without typing anything.
select pg_temp.as_user('admin'); set local role authenticated;
select is(fms_workflow_deletion_impact(pg_temp.fx('spare'))->>'action','delete','an unused workflow is simply deleted');
select is(delete_fms_workflow_with_audit(pg_temp.fx('spare'))->>'outcome','deleted','the admin deletes it');
reset role;
select is((select count(*)::integer from fms_flows where family_id=pg_temp.fx('spare')),0,'it is gone');

-- 5. Staff cannot delete workflows.
select pg_temp.as_user('doer'); set local role authenticated;
select throws_ok($$select fms_workflow_deletion_impact(gen_random_uuid())$$,'42501',null,'staff cannot read the impact');
reset role;

select * from finish();
rollback;
