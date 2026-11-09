begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- ---------------------------------------------------------------------------------------------
-- Fixture: one tenant, two branches. CRM department (all branches), Sales per branch, Accounts.
-- ---------------------------------------------------------------------------------------------
create temporary table cc_fixture(name text primary key,id uuid);
grant select,insert on cc_fixture to authenticated,service_role;
do $$
declare t uuid; t2 uuid; b uuid; b2 uuid; ob uuid; d_crm uuid; d_sales uuid; d_sales2 uuid; d_acct uuid; d_other uuid; a uuid; u uuid; person text;
begin
  insert into tenants(name,slug) values('Client CRM test','client-crm-test') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','CC1') returning id into b;
  insert into branches(tenant_id,name,code) values(t,'Second','CC2') returning id into b2;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'CRM','CRM') returning id into d_crm;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','CCS1') returning id into d_sales;
  insert into departments(tenant_id,branch_id,name,code) values(t,b2,'Sales Department','CCS2') returning id into d_sales2;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Accounts','CCA') returning id into d_acct;
  insert into tenants(name,slug) values('Other jeweller','cc-other') returning id into t2;
  insert into branches(tenant_id,name,code) values(t2,'Other','CCO') returning id into ob;
  insert into departments(tenant_id,branch_id,name,code) values(t2,ob,'CRM','CRMO') returning id into d_other;
  foreach person in array array['crm1','crm2','crm_resigned','sales1','sales2','acct','admin','other_crm'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-cc@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
      values(case when person='other_crm' then t2 else t end,a,
        case person when 'crm2' then b2 when 'sales2' then b2 when 'other_crm' then ob else b end,
        case person when 'crm1' then d_crm when 'crm2' then d_crm when 'crm_resigned' then d_crm when 'sales1' then d_sales
          when 'sales2' then d_sales2 when 'acct' then d_acct when 'other_crm' then d_other else d_acct end,
        'CC '||person,'CC-'||person,person||'-cc@test.local',
        case person when 'admin' then 'super_admin' when 'crm1' then 'crm' when 'crm2' then 'crm' else 'staff' end::user_role,
        (case when person='crm_resigned' then 'resigned' else 'active' end)::working_status,person<>'crm_resigned') returning id into u;
    insert into cc_fixture values(person,u),(person||'_auth',a);
  end loop;
  insert into cc_fixture values('tenant',t),('branch',b),('branch2',b2);
end $$;

create function pg_temp.fx(p text) returns uuid language sql as $$ select id from cc_fixture where name=p $$;
create function pg_temp.act(p_person text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',(select id::text from cc_fixture where name=p_person||'_auth'),true),
         set_config('request.jwt.claim.role','authenticated',true),
         set_config('request.jwt.claims',jsonb_build_object('sub',(select id::text from cc_fixture where name=p_person||'_auth'),'role','authenticated')::text,true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
$$;
-- An automatic walk-in workflow: Call client (task) -> Close (task). The steps' own owner is Accounts.
create function pg_temp.flow(p_name text,p_mode text) returns uuid language plpgsql as $$
declare flow uuid; s1 uuid; s2 uuid; admin uuid:=pg_temp.fx('admin'); rule jsonb:='{"assignment":{"mode":"fixed_employee","sources":[],"allowHandoff":false},"deadlineEnabled":false}';
begin
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version,start_mode,start_trigger)
    values(pg_temp.fx('tenant'),gen_random_uuid(),1,p_name,'tenant','draft',true,admin,admin,2,'automatic',
      ('{"source":{"type":"crm_walkin"},
        "conditions":{"id":"root","kind":"group","combinator":"and","enabled":true,"children":[{"id":"r1","kind":"rule","field":"visit_status","operator":"equals","value":"NO","enabled":true}]},
        "mapping":[],"assignment":{"mode":"'||p_mode||'","onUnresolved":"stage_rules"},"reentry":"one_per_event","onCaseClosed":"record_only"}')::jsonb)
    returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,completion_rule)
    values(flow,'call','Call client','task',0,true,rule,'any_doer') returning id into s1;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
    values(flow,'close','Close','task',1,true,rule) returning id into s2;
  update fms_stages set default_next_stage_id=s2 where id=s1;
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) values(s1,'specific_user',pg_temp.fx('acct'),0),(s2,'specific_user',pg_temp.fx('acct'),0);
  return flow;
end $$;
create function pg_temp.visit(p_staff uuid,p_crm uuid) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('kind','crm.walkin_visit_saved','occurred_at',now(),'record_id',gen_random_uuid(),'client_id',gen_random_uuid(),
    'jewelos_branch_id',pg_temp.fx('branch'),'staff_jewelos_user_id',p_staff,'crm_jewelos_user_id',p_crm,
    'answers',jsonb_build_object('visit_status','NO','client_code','MKC-9','client_name','Synthetic Client')))
$$;
grant execute on function pg_temp.fx(text),pg_temp.visit(uuid,uuid) to authenticated,service_role;

create temporary table cc_flow(name text primary key,id uuid);
grant select on cc_flow to authenticated,service_role;
insert into cc_flow values('crm_flow',pg_temp.flow('CRM follow-up','source_staff'));
select pg_temp.act('admin');
set local role authenticated;
select lives_ok($$select publish_fms_flow_with_audit((select id from cc_flow where name='crm_flow'))$$,'the CRM workflow publishes');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 1. The first task goes to the client's CRM; the salesperson only when no CRM is usable.
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_service();
set local role service_role;
select is(crm_sync_apply_submission_event('crm.sub.cc1',pg_temp.visit(pg_temp.fx('sales1'),pg_temp.fx('crm1')))->>'started','1','a CRM walk-in starts a run');
select is(crm_sync_apply_submission_event('crm.sub.cc2',pg_temp.visit(pg_temp.fx('sales1'),pg_temp.fx('crm_resigned')))->>'started','1','a run with a resigned CRM starts');
select is(crm_sync_apply_submission_event('crm.sub.cc3',pg_temp.visit(pg_temp.fx('sales1'),null))->>'started','1','an older CRM without the CRM field still starts');
select is(crm_sync_apply_submission_event('crm.sub.cc4',pg_temp.visit(pg_temp.fx('sales1'),pg_temp.fx('other_crm')))->>'started','1','a run naming another business''s CRM starts');
reset role;

create temporary table cc_run(name text primary key,instance_id uuid,stage_id uuid);
grant select on cc_run to authenticated;
insert into cc_run
  select e.event_key,s.fms_instance_id,w.id from fms_trigger_events e
  join fms_instance_trigger_sources s on s.event_id=e.id
  join fms_instance_stages w on w.fms_instance_id=s.fms_instance_id
  where e.event_key like 'crm.sub.cc%';
create function pg_temp.assignee(p text) returns uuid language sql as $$
  select (w.assigned_to)[1] from fms_instance_stages w join cc_run r on r.stage_id=w.id where r.name=p $$;

select is(pg_temp.assignee('crm.sub.cc1'),pg_temp.fx('crm1'),'the client''s CRM gets the task, not the salesperson');
select is(pg_temp.assignee('crm.sub.cc2'),pg_temp.fx('sales1'),'a resigned CRM falls back to the salesperson');
select is(pg_temp.assignee('crm.sub.cc3'),pg_temp.fx('sales1'),'no CRM named: the salesperson, as before');
select is(pg_temp.assignee('crm.sub.cc4'),pg_temp.fx('sales1'),'a CRM from another business is never trusted');
select is((select payload->>'crm_profile_id' from fms_trigger_events where event_key='crm.sub.cc4'),null,'a cross-tenant CRM id is not stored');
select is((select started_by from fms_instances i join cc_run r on r.instance_id=i.id where r.name='crm.sub.cc1'),pg_temp.fx('crm1'),'the run is owned by the CRM');

-- The builder test panel previews the same person.
select pg_temp.act('admin');
set local role authenticated;
select is(test_fms_start_trigger((select id from cc_flow where name='crm_flow'),(select start_trigger from fms_flows where id=(select id from cc_flow where name='crm_flow')),
  jsonb_build_object('visit_status','NO','staff_profile_id',pg_temp.fx('sales1'),'crm_profile_id',pg_temp.fx('crm1')))#>>'{assignee,name}','CC crm1','the test panel shows the CRM');
select is(test_fms_start_trigger((select id from cc_flow where name='crm_flow'),(select start_trigger from fms_flows where id=(select id from cc_flow where name='crm_flow')),
  jsonb_build_object('visit_status','NO','staff_profile_id',pg_temp.fx('sales1'),'crm_profile_id',pg_temp.fx('crm_resigned')))#>>'{assignee,name}','CC sales1','the test panel falls back to the salesperson');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 2. Friendly names: the CRM client's name, never the long FMS reference.
-- ---------------------------------------------------------------------------------------------
select is(fms_work_record_name_authorized((select stage_id from cc_run where name='crm.sub.cc1')),'Synthetic Client','a CRM-started task is named after the client');
select ok(fms_work_record_name_authorized((select stage_id from cc_run where name='crm.sub.cc1')) !~ '^FMS-','no reference number as a name');
do $$
declare v_instance uuid; v_stage uuid;
begin
  select r.instance_id,r.stage_id into v_instance,v_stage from cc_run r where r.name='crm.sub.cc3';
  delete from fms_instance_trigger_sources where fms_instance_id=v_instance;
  update fms_instances set title='CRM follow-up' where id=v_instance;
end $$;
select is(fms_work_record_name_authorized((select stage_id from cc_run where name='crm.sub.cc3')),'CRM follow-up — Call client','nothing names it: Workflow — Step');
update fms_instances set title='Ring Mr Rao about the bangles' where id=(select instance_id from cc_run where name='crm.sub.cc3');
select is(fms_work_record_name_authorized((select stage_id from cc_run where name='crm.sub.cc3')),'Ring Mr Rao about the bangles','a written run title names the task');

-- ---------------------------------------------------------------------------------------------
-- 3. Hand over: only the person doing a CRM-started task; only to a CRM or a branch salesperson.
-- ---------------------------------------------------------------------------------------------
create function pg_temp.cc1_stage() returns uuid language sql as $$ select stage_id from cc_run where name='crm.sub.cc1' $$;
grant execute on function pg_temp.cc1_stage() to authenticated;
select pg_temp.act('crm1');
set local role authenticated;
select set_eq($$select id from fms_crm_handover_candidates(pg_temp.cc1_stage())$$,
  array[pg_temp.fx('crm2'),pg_temp.fx('sales1')],'other CRMs (any branch) and this branch''s salespeople; never self, Accounts, another branch''s sales, resigned or another business');
select is((select team from fms_crm_handover_candidates(pg_temp.cc1_stage()) where id=pg_temp.fx('sales1')),'sales','candidates carry their team');
select throws_ok($$select handover_fms_step_with_audit(pg_temp.cc1_stage(),pg_temp.fx('crm2'),'  ')$$,'23514',null,'a reason is required');
select throws_ok($$select handover_fms_step_with_audit(pg_temp.cc1_stage(),pg_temp.fx('acct'),'Busy')$$,'23514',null,'not to Accounts');
select throws_ok($$select handover_fms_step_with_audit(pg_temp.cc1_stage(),pg_temp.fx('sales2'),'Busy')$$,'23514',null,'not to another branch''s salesperson');
select throws_ok($$select handover_fms_step_with_audit(pg_temp.cc1_stage(),pg_temp.fx('other_crm'),'Busy')$$,'23503',null,'not to another business');
select throws_ok($$select handover_fms_step_with_audit(pg_temp.cc1_stage(),pg_temp.fx('crm_resigned'),'Busy')$$,'23503',null,'not to a resigned person');
reset role;

select pg_temp.act('sales1');
set local role authenticated;
select is((select count(*) from fms_crm_handover_candidates(pg_temp.cc1_stage())),0::bigint,'someone who does not have the task sees nobody');
select throws_ok($$select handover_fms_step_with_audit(pg_temp.cc1_stage(),pg_temp.fx('sales1'),'Mine now')$$,'42501',null,'and cannot take it');
reset role;
select pg_temp.act('admin');
set local role authenticated;
select throws_ok($$select handover_fms_step_with_audit(pg_temp.cc1_stage(),pg_temp.fx('crm2'),'Busy')$$,'42501',null,'a super admin uses Reassign, not Hand over');
reset role;
set local role anon;
select throws_ok($$select handover_fms_step_with_audit(pg_temp.cc1_stage(),pg_temp.fx('crm2'),'Busy')$$,'42501',null,'anonymous callers are refused');
reset role;

select pg_temp.act('crm1');
set local role authenticated;
select is(handover_fms_step_with_audit(pg_temp.cc1_stage(),pg_temp.fx('crm2'),'I did not attend this client')->>'assigneeName','CC crm2','the CRM hands the task over');
select throws_ok($$select handover_fms_step_with_audit(pg_temp.cc1_stage(),pg_temp.fx('sales1'),'Again')$$,'42501',null,'after handing over it is no longer theirs');
reset role;
select is((select assigned_to from fms_instance_stages where id=pg_temp.cc1_stage()),array[pg_temp.fx('crm2')],'the task now belongs to the new CRM');
select is((select count(*) from fms_instance_stage_assignees where fms_instance_stage_id=pg_temp.cc1_stage() and is_active and user_profile_id=pg_temp.fx('crm2')),1::bigint,'an active assignment row for the new CRM');
select is((select status from fms_instance_stage_assignees where fms_instance_stage_id=pg_temp.cc1_stage() and user_profile_id=pg_temp.fx('crm1') order by assigned_at desc limit 1),'reassigned','the old assignment is kept as history');
select is((select new_value->>'reason' from audit_logs where action='fms_stage_handed_over' and record_id=pg_temp.cc1_stage()),'I did not attend this client','the hand-over is audited');
select ok(exists(select 1 from notification_events where event_type='fms_stage_assigned' and source_record_id=pg_temp.cc1_stage()
  and payload->'_assigned_user_ids' ? pg_temp.fx('crm2')::text),'the new CRM is notified');
select is((select count(*) from fms_stage_logs where fms_instance_stage_id=pg_temp.cc1_stage() and action='reassigned' and (details->>'handover')::boolean),1::bigint,'the journey shows the hand-over');

-- The new CRM may pass it on to a salesperson of the branch.
select pg_temp.act('crm2');
set local role authenticated;
select lives_ok($$select handover_fms_step_with_audit(pg_temp.cc1_stage(),pg_temp.fx('sales1'),'I am busy with another client')$$,'a CRM can hand over to a branch salesperson');
reset role;

-- Work that was not started by a CRM form cannot be handed over.
update fms_instance_stages set assigned_to=array[pg_temp.fx('crm1')] where id=(select stage_id from cc_run where name='crm.sub.cc3');
select pg_temp.act('crm1');
set local role authenticated;
select is((select count(*) from fms_crm_handover_candidates((select stage_id from cc_run where name='crm.sub.cc3'))),0::bigint,'no hand-over outside CRM-started work');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 4. The CRM roster keeps the same department rule.
-- ---------------------------------------------------------------------------------------------
select is(crm_sync.staff_roster_fields(pg_temp.fx('crm1'))->>'selection_department','crm','CRM department stays on the CRM roster');
select is(crm_sync.staff_roster_fields(pg_temp.fx('sales2'))->>'selection_department','sales','"Sales Department" stays a sales choice');
select is(crm_sync.staff_roster_fields(pg_temp.fx('acct'))->>'selection_department','other','other departments stay out');
select is(crm_department_choice('Customer Relations',null),'crm','named CRM departments count');

-- Internal helpers stay private.
select ok(not has_function_privilege('authenticated','fms_run_display_name(uuid,text)','execute'),'display name helper is private');
select ok(not has_function_privilege('authenticated','crm_department_choice(text,text)','execute'),'department rule is private');

select * from finish();
rollback;
