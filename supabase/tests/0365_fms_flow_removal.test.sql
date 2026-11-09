begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Migration 0397 withdrew fms.manage from Admin by default; this test keeps an Admin as the FMS builder.
update permission_catalog set default_roles = array_append(default_roles, 'admin') where key = 'fms.manage' and not ('admin' = any(default_roles));
create temporary table rm_fixture(name text primary key,id uuid);
grant select,insert,update on rm_fixture to authenticated;

-- A looping sales funnel like production's: routes point forwards and backwards.
do $$
declare t uuid; t2 uuid; b uuid; d uuid; b2 uuid; d2 uuid; a uuid; u uuid; f uuid; person text;
  flow uuid; spare uuid; other uuid; s_start uuid; s_intro uuid; s_f1 uuid; s_f2 uuid; e_lost uuid; o1 uuid;
begin
  insert into tenants(name,slug) values('Removal test','removal-test') returning id into t;
  insert into tenants(name,slug) values('Removal other','removal-other') returning id into t2;
  insert into branches(tenant_id,name,code) values(t,'Main','RMV') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','RMV') returning id into d;
  insert into branches(tenant_id,name,code) values(t2,'Other','RMX') returning id into b2;
  insert into departments(tenant_id,branch_id,name,code) values(t2,b2,'Other','RMX') returning id into d2;
  foreach person in array array['doer','outsider','admin','super'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-rm@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
      values(case when person='outsider' then t2 else t end,a,case when person='outsider' then b2 else b end,case when person='outsider' then d2 else d end,
        'Rm '||person,'RM-'||person,person||'-rm@test.local',
        case person when 'admin' then 'admin' when 'super' then 'super_admin' when 'outsider' then 'super_admin' else 'staff' end::user_role,'active',true) returning id into u;
    insert into rm_fixture values(person,u),(person||'_auth',a);
  end loop;
  select id into u from rm_fixture where name='doer';
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by) values(t,'Lead status',1,'draft',true,u,u) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values(f,'status','Lead status','text',0);
  update form_templates set lifecycle='published' where id=f;

  -- Three versions: the looping funnel, an unused copy, and one that hands off to the funnel.
  foreach person in array array['funnel','spare','other'] loop
    insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by)
      values(t,gen_random_uuid(),1,'Instagram '||person,'tenant','draft',true,u,u) returning id into flow;
    insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'start','Start','form',0,true,'{"deadlineEnabled":false}',f) returning id into s_start;
    insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'intro','Introduction','form',1,true,'{"deadlineEnabled":false}',f) returning id into s_intro;
    insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'f1','Follow-up 1','form',2,true,'{"deadlineEnabled":false}',f) returning id into s_f1;
    insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id) values(flow,'f2','Follow-up 2','form',3,true,'{"deadlineEnabled":false}',f) returning id into s_f2;
    insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule) values(flow,'lead_closed','Lead Closed','end',4,true,'{"deadlineEnabled":false,"terminal":{"outcome":"lost","reasonCode":"not_interested"}}') returning id into e_lost;
    insert into fms_branch_rules(fms_stage_id,sort_order,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id) values
      (s_intro,0,'form_answer','status','status','equals','follow_up',s_f1),(s_intro,1,'form_answer','status','status','equals','close',e_lost),
      (s_f1,0,'form_answer','status','status','equals','continue',s_f2),(s_f1,1,'form_answer','status','status','equals','intro',s_intro),
      (s_f1,2,'form_answer','status','status','equals','close',e_lost),
      (s_f2,0,'form_answer','status','status','equals','intro',s_intro),(s_f2,1,'form_answer','status','status','equals','close',e_lost);
    update fms_stages set default_next_stage_id=s_intro where id=s_start;
    insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) select id,'specific_user',u,0 from fms_stages where fms_flow_id=flow and step_type<>'end';
    insert into rm_fixture values(person,flow),(person||'_f1',s_f1);
  end loop;
  insert into rm_fixture values('tenant',t),('form',f);
end $$;

create function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from rm_fixture where name=p $$;
create function pg_temp.visit(p_instance uuid,p_key text) returns uuid language sql as $$
  select w.id from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=p_instance and s.stage_key=p_key and w.status in ('pending','in_progress','in_review','overdue') order by w.visit_number desc limit 1 $$;
create function pg_temp.step(p_instance uuid,p_key text,p_status text) returns void language sql as $$
  select submit_fms_form_and_progress_with_audit(pg_temp.fx('form'),jsonb_build_object('status',p_status),'fms_stage',pg_temp.visit(p_instance,p_key),gen_random_uuid()) $$;
create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',(select id::text from rm_fixture where name=p||'_auth'),true), set_config('request.jwt.claim.role','authenticated',true) $$;
grant execute on function pg_temp.fx(text),pg_temp.visit(uuid,text),pg_temp.step(uuid,text,text),pg_temp.as_user(text) to authenticated;

-- 1. The production bug: a draft whose routes loop back could not be deleted.
select pg_temp.as_user('admin');
set local role authenticated;
select is((fms_flow_deletion_impact(pg_temp.fx('spare'))->>'action'),'delete','an unused draft is deleted permanently');
select lives_ok($$select delete_fms_flow_with_audit(pg_temp.fx('spare'),'cleanup')$$,'a draft with looping routes deletes without a foreign key error');
reset role;
select is((select count(*)::integer from fms_flows where id=pg_temp.fx('spare')),0,'the draft is gone');
select is((select count(*)::integer from fms_stages where fms_flow_id=pg_temp.fx('spare')),0,'its steps are gone');
select is((select count(*)::integer from audit_logs where action='fms_flow_deleted' and record_id=pg_temp.fx('spare')),1,'the deletion is audited');

-- Run the funnel: one run loops Intro -> F1 -> Intro -> F1 -> F2 and stays open, one closes.
update fms_flows set status='published' where id=pg_temp.fx('funnel');
update fms_branch_rules set next_flow_id=pg_temp.fx('funnel') where fms_stage_id=pg_temp.fx('other_f1') and sort_order=2;
select pg_temp.as_user('doer');
set local role authenticated;
insert into rm_fixture select 'open_run',(submit_form_and_start_fms_with_audit(pg_temp.fx('form'),'{"status":"new"}')->>'instance_id')::uuid;
select pg_temp.step(pg_temp.fx('open_run'),'intro','follow_up');
select pg_temp.step(pg_temp.fx('open_run'),'f1','intro');
select pg_temp.step(pg_temp.fx('open_run'),'intro','follow_up');
select pg_temp.step(pg_temp.fx('open_run'),'f1','continue');
insert into rm_fixture select 'closed_run',(submit_form_and_start_fms_with_audit(pg_temp.fx('form'),'{"status":"new"}')->>'instance_id')::uuid;
select pg_temp.step(pg_temp.fx('closed_run'),'intro','close');
reset role;
select is((select count(*)::integer from fms_instances where fms_flow_id=pg_temp.fx('funnel')),2,'the funnel has two runs');
-- The alert the notification worker would deliver for the open step.
insert into notifications(tenant_id,user_profile_id,event_type,title,message,source_module,source_record_id)
  select pg_temp.fx('tenant'),pg_temp.fx('doer'),'fms_stage_assigned','Follow-up 2','Your step is waiting','fms',pg_temp.visit(pg_temp.fx('open_run'),'f2');
select is((select count(*)::integer from notifications where source_module='fms' and source_record_id in (select id from fms_instance_stages where fms_instance_id=pg_temp.fx('open_run')) and not is_read),1,'the open run has an unread alert');

-- 2. An admin archives a version with runs and cannot erase it.
select pg_temp.as_user('admin');
set local role authenticated;
select is((fms_flow_deletion_impact(pg_temp.fx('funnel'))->>'action'),'archive','an admin archives a version with runs');
select lives_ok($$select delete_fms_flow_with_audit(pg_temp.fx('funnel'),null)$$,'the admin archive works');
select is((fms_flow_deletion_impact(pg_temp.fx('funnel'))->>'action'),'denied','an archived version with runs is not the admin''s to erase');
select throws_ok($$select delete_fms_flow_with_audit(pg_temp.fx('funnel'),null)$$,'42501',null,'deleting it again tells the admin a super admin is needed');
select throws_ok($$select erase_fms_flow_with_audit(pg_temp.fx('funnel'),'DELETE')$$,'42501',null,'an admin cannot erase runs');
reset role;
select is((select status::text from fms_flows where id=pg_temp.fx('funnel')),'archived','the funnel is archived');

-- 3. Another tenant's super admin and anonymous callers cannot touch it.
select pg_temp.as_user('outsider');
set local role authenticated;
select throws_ok($$select fms_flow_deletion_impact(pg_temp.fx('funnel'))$$,'42501',null,'another tenant cannot read the impact');
select throws_ok($$select erase_fms_flow_with_audit(pg_temp.fx('funnel'),'DELETE')$$,'42501',null,'another tenant''s super admin cannot erase it');
reset role;
select ok(not has_function_privilege('anon','erase_fms_flow_with_audit(uuid,text)','EXECUTE'),'anon cannot call erase');
select ok(not has_function_privilege('authenticated','remove_fms_flow_rows(uuid)','EXECUTE'),'the removal helper is private');

-- 4. The super admin sees the impact and erases the version with its runs.
select pg_temp.as_user('super');
set local role authenticated;
select is((select (fms_flow_deletion_impact(pg_temp.fx('funnel')) - 'name' - 'version' - 'status')),
  '{"runs":2,"action":"erase","openRuns":1,"canErase":true,"handoffsFrom":["Instagram other"]}'::jsonb,'the warning counts runs, open runs and hand-offs');
select throws_ok($$select erase_fms_flow_with_audit(pg_temp.fx('funnel'),'delete please')$$,'22023','Type DELETE to confirm','erase needs the typed confirmation');
select is((erase_fms_flow_with_audit(pg_temp.fx('funnel'),'DELETE')->>'runs')::integer,2,'the super admin erases the version and both runs');
reset role;
select is((select count(*)::integer from fms_flows where id=pg_temp.fx('funnel')),0,'the version is gone');
select is((select count(*)::integer from fms_instances where id in (pg_temp.fx('open_run'),pg_temp.fx('closed_run'))),0,'its runs are gone');
select is((select count(*)::integer from fms_instance_stages where fms_instance_id in (pg_temp.fx('open_run'),pg_temp.fx('closed_run'))),0,'their steps are gone');
select is((select count(*)::integer from fms_branch_rules where next_flow_id=pg_temp.fx('funnel')),0,'the other workflow no longer hands off to it');
select is((select count(*)::integer from fms_branch_rules r join fms_stages s on s.id=r.fms_stage_id where s.fms_flow_id=pg_temp.fx('other')),7,'the other workflow keeps its own routes');
select is((select count(*)::integer from notifications where tenant_id=pg_temp.fx('tenant') and source_module='fms'),0,'alerts for the erased work are removed (0366)');
select is((select count(*)::integer from form_submissions where tenant_id=pg_temp.fx('tenant')),7,'form answers stay in Forms');
select is((select count(*)::integer from audit_logs where action='fms_flow_erased' and record_id=pg_temp.fx('funnel') and old_value->>'open_runs'='1'),1,'the erase is audited with the open-run count');

-- 5. A never-run published version is deleted permanently, not archived.
update fms_flows set status='published' where id=pg_temp.fx('other');
select pg_temp.as_user('admin');
set local role authenticated;
select is((fms_flow_deletion_impact(pg_temp.fx('other'))->>'action'),'delete','a published version that never ran is deleted');
select lives_ok($$select delete_fms_flow_with_audit(pg_temp.fx('other'),null)$$,'the published unused version deletes');
reset role;
select is((select count(*)::integer from fms_flows where id=pg_temp.fx('other')),0,'it is gone, not archived');

-- 6. The definition guard still protects published steps outside a removal.
insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by)
  select pg_temp.fx('tenant'),gen_random_uuid(),1,'Guarded','tenant','draft',true,pg_temp.fx('admin'),pg_temp.fx('admin');
insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
  select id,'only','Only','task',0,true,'{"deadlineEnabled":false}' from fms_flows where name='Guarded';
update fms_flows set status='published' where name='Guarded';
select throws_ok($$delete from fms_stages where fms_flow_id=(select id from fms_flows where name='Guarded')$$,'23514',null,'published steps stay immutable');
select throws_ok($$delete from fms_flows where name='Guarded'$$,'23514',null,'published flows cannot be deleted directly');

select * from finish();
rollback;
