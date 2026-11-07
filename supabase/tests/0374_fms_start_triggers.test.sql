begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- ---------------------------------------------------------------------------------------------
-- Evaluator (same cases as packages/core/src/fms/startTrigger.test.ts).
-- ---------------------------------------------------------------------------------------------
select ok(fms_trigger_rule_matches('equals','"NO"','"no"','choice','2026-11-03'),'equals ignores case');
select ok(not fms_trigger_rule_matches('equals','"NO"','"YES"','choice','2026-11-03'),'equals refuses another value');
select ok(not fms_trigger_rule_matches('equals','"NO"',null,'choice','2026-11-03'),'a missing answer never equals');
select ok(fms_trigger_rule_matches('not_equals','"NO"',null,'choice','2026-11-03'),'a missing answer is not equal');
select ok(fms_trigger_rule_matches('is_empty',null,'"  "','text','2026-11-03'),'blank text is empty');
select ok(fms_trigger_rule_matches('is_empty',null,'[]','multi_choice','2026-11-03'),'an empty list is empty');
select ok(fms_trigger_rule_matches('contains','"Price"','["Design","PRICE"]','multi_choice','2026-11-03'),'contains matches a list item');
select ok(fms_trigger_rule_matches('not_contains','"Price"','["Design"]','multi_choice','2026-11-03'),'does not contain');
select ok(fms_trigger_rule_matches('in','["NO","PRICE_CALCULATION"]','"price_calculation"','choice','2026-11-03'),'is one of');
select ok(fms_trigger_rule_matches('greater_than','0','2','number','2026-11-03'),'number greater than');
select ok(fms_trigger_rule_matches('greater_than','0','["a","b"]','number','2026-11-03'),'a list counts as its length');
select ok(not fms_trigger_rule_matches('greater_than','"x"','2','number','2026-11-03'),'a non-number never compares');
select ok(fms_trigger_rule_matches('greater_than_or_equal','"today"','"2026-11-03"','date','2026-11-03'),'date on or after today');
select ok(fms_trigger_rule_matches('less_than','"2026-12-01"','"2026-11-30T10:00:00"','date','2026-11-03'),'date-time compares by date');
select ok(fms_trigger_rule_matches('equals','true','"yes"','boolean','2026-11-03'),'yes is true');
select ok(fms_trigger_rule_matches('equals','"5"','5','number','2026-11-03'),'number equality across text');
select is((fms_trigger_node_eval(
  '{"id":"g","kind":"group","combinator":"and","enabled":true,"children":[
     {"id":"a","kind":"rule","field":"visit_status","operator":"equals","value":"NO","enabled":true},
     {"id":"g2","kind":"group","combinator":"or","enabled":true,"children":[
        {"id":"b","kind":"rule","field":"product_requirement","operator":"not_empty","enabled":true},
        {"id":"c","kind":"rule","field":"seen_count","operator":"greater_than","value":0,"enabled":true}]}]}',
  '{"visit_status":"NO","seen_count":2}','{"visit_status":"choice","seen_count":"number","product_requirement":"text"}','2026-11-03')->>'r'),'true','nested AND/OR matches');
select is((fms_trigger_node_eval(
  '{"id":"g","kind":"group","combinator":"and","enabled":true,"children":[
     {"id":"a","kind":"rule","field":"visit_status","operator":"equals","value":"NO","enabled":true},
     {"id":"g2","kind":"group","combinator":"or","enabled":true,"children":[
        {"id":"b","kind":"rule","field":"product_requirement","operator":"not_empty","enabled":true},
        {"id":"c","kind":"rule","field":"seen_count","operator":"greater_than","value":0,"enabled":true}]}]}',
  '{"visit_status":"NO","seen_count":0}','{"visit_status":"choice","seen_count":"number","product_requirement":"text"}','2026-11-03')->>'r'),'false','nested OR without a match fails the AND');
select is((fms_trigger_node_eval(
  '{"id":"g","kind":"group","combinator":"and","enabled":true,"children":[
     {"id":"a","kind":"rule","field":"visit_status","operator":"equals","value":"NO","enabled":true},
     {"id":"b","kind":"rule","field":"visit_status","operator":"equals","value":"YES","enabled":false},
     {"id":"g2","kind":"group","combinator":"or","enabled":true,"children":[]}]}',
  '{"visit_status":"NO"}','{"visit_status":"choice"}','2026-11-03')->>'r'),'true','disabled rules and empty groups are skipped');
select is(fms_trigger_node_eval('{"id":"g","kind":"group","combinator":"and","enabled":true,"children":[]}','{}','{}','2026-11-03')->'r','null'::jsonb,'nothing enabled decides nothing');

-- ---------------------------------------------------------------------------------------------
-- Fixture: one tenant with a salesperson, a manager and a super admin; a second tenant.
-- ---------------------------------------------------------------------------------------------
create temporary table st_fixture(name text primary key,id uuid);
grant select,insert on st_fixture to authenticated,service_role;
do $$
declare t uuid; t2 uuid; b uuid; b2 uuid; d uuid; d2 uuid; a uuid; u uuid; person text; f uuid;
begin
  insert into tenants(name,slug) values('Trigger test','trigger-test') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Main','TRG') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Sales','TRG') returning id into d;
  insert into tenants(name,slug) values('Other jeweller','other-jeweller') returning id into t2;
  insert into branches(tenant_id,name,code) values(t2,'Other','OTH') returning id into b2;
  insert into departments(tenant_id,branch_id,name,code) values(t2,b2,'Sales','OTH') returning id into d2;
  foreach person in array array['sales','manager','admin','other_admin','resigned'] loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',person||'-st@test.local','x',now(),now()) returning id into a;
    insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,is_login_enabled)
      values(case when person='other_admin' then t2 else t end,a,case when person='other_admin' then b2 else b end,case when person='other_admin' then d2 else d end,
        'ST '||person,'ST-'||person,person||'-st@test.local',
        case person when 'manager' then 'manager' when 'admin' then 'super_admin' when 'other_admin' then 'super_admin' else 'staff' end::user_role,
        (case when person='resigned' then 'resigned' else 'active' end)::working_status,person<>'resigned') returning id into u;
    insert into st_fixture values(person,u),(person||'_auth',a);
  end loop;
  insert into st_fixture values('tenant',t),('tenant2',t2),('branch',b),('dept',d);
  select id into u from st_fixture where name='admin';
  insert into form_templates(tenant_id,name,version,lifecycle,is_active,created_by,updated_by) values(t,'Repair intake',1,'draft',true,u,u) returning id into f;
  insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order,options) values
    (f,'urgency','Urgency','select',0,'[{"value":"high","label":"High"},{"value":"low","label":"Low"}]'),
    (f,'mobile','Mobile','phone',1,'[]'),(f,'note','Note','text',2,'[]');
  update form_templates set lifecycle='published' where id=f;
  insert into st_fixture values('form',f),('form_family',(select family_id from form_templates where id=f));
end $$;

create function pg_temp.fx(p text) returns uuid language sql as $$ select id from st_fixture where name=p $$;
create function pg_temp.act(p_person text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',(select id::text from st_fixture where name=p_person||'_auth'),true),
         set_config('request.jwt.claim.role','authenticated',true),
         set_config('request.jwt.claims',jsonb_build_object('sub',(select id::text from st_fixture where name=p_person||'_auth'),'role','authenticated')::text,true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
$$;
-- A draft: Follow-Up 1 (task) -> Follow-Up 2 (task). Both use a fixed employee (the manager).
create function pg_temp.draft(p_name text,p_mode text,p_trigger jsonb,p_first_type text default 'task') returns uuid language plpgsql as $$
declare flow uuid; s1 uuid; s2 uuid; admin uuid:=pg_temp.fx('admin'); rule jsonb:='{"assignment":{"mode":"fixed_employee","sources":[],"allowHandoff":false},"deadlineEnabled":false}';
begin
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version,start_mode,start_trigger)
    values(pg_temp.fx('tenant'),gen_random_uuid(),1,p_name,'tenant','draft',true,admin,admin,2,p_mode,p_trigger) returning id into flow;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,completion_rule)
    values(flow,'follow_1','Follow-Up 1',p_first_type::fms_step_type,0,true,rule,(case when p_first_type='approval' then 'manager_approval' else 'any_doer' end)::fms_completion_rule) returning id into s1;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
    values(flow,'follow_2','Follow-Up 2','task',1,true,rule) returning id into s2;
  update fms_stages set default_next_stage_id=s2 where id=s1;
  insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,sort_order) values(s1,'specific_user',pg_temp.fx('manager'),0),(s2,'specific_user',pg_temp.fx('manager'),0);
  return flow;
end $$;
create function pg_temp.not_bought(p_extra jsonb default '{}') returns jsonb language sql as $$
  select '{"source":{"type":"crm_walkin"},
    "conditions":{"id":"root","kind":"group","combinator":"and","enabled":true,"children":[{"id":"r1","kind":"rule","field":"visit_status","operator":"equals","value":"NO","enabled":true}]},
    "title":{"field":"client_name"},
    "mapping":[{"key":"client_code","label":"Client code","field":"client_code"},{"key":"requirement","label":"Product requirement","field":"product_requirement","fallback":"Not given"}],
    "assignment":{"mode":"source_staff","onUnresolved":"review"},"dueField":"next_visit_date","reentry":"one_active_per_case","onCaseClosed":"record_only"}'::jsonb||p_extra
$$;
create function pg_temp.visit(p_status text,p_case uuid,p_staff uuid,p_client uuid default '11111111-1111-4111-8111-111111111111') returns jsonb language sql as $$
  select jsonb_build_object('kind','crm.walkin_visit_saved','occurred_at',now(),'record_id',gen_random_uuid(),'client_id',p_client,'case_id',p_case,
    'jewelos_branch_id',pg_temp.fx('branch'),'staff_jewelos_user_id',p_staff,
    'answers',jsonb_build_object('visit_status',p_status,'client_code','MKC-77','client_name','Synthetic Client','product_requirement','Bangles',
      'next_visit_date',to_char((now() at time zone 'Asia/Kolkata')::date+5,'YYYY-MM-DD'),'seen_categories',jsonb_build_array('BANGLES')))
$$;

-- ---------------------------------------------------------------------------------------------
-- Compatibility: existing versions stay form-started; form-mode publishing is unchanged.
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from fms_flows where start_mode<>'form' and tenant_id<>pg_temp.fx('tenant')),0::bigint,'every existing workflow version keeps the form start');
create temporary table st_flow(name text primary key,id uuid);
grant select,insert on st_flow to authenticated,service_role;
insert into st_flow values('form_task_first',pg_temp.draft('Form mode with a task first','form',null));
insert into st_flow values('not_bought',pg_temp.draft('NOT BOUGHT FOLLOW-UP','automatic',pg_temp.not_bought()));
insert into st_flow values('no_rules',pg_temp.draft('No rules','automatic',pg_temp.not_bought('{"conditions":{"id":"root","kind":"group","combinator":"and","enabled":true,"children":[{"id":"r1","kind":"rule","field":"visit_status","operator":"equals","value":"NO","enabled":false}]}}')));
insert into st_flow values('bad_field',pg_temp.draft('Bad field','automatic',pg_temp.not_bought('{"conditions":{"id":"root","kind":"group","combinator":"and","enabled":true,"children":[{"id":"r1","kind":"rule","field":"phone","operator":"equals","value":"1","enabled":true}]}}')));
insert into st_flow values('bad_option',pg_temp.draft('Bad option','automatic',pg_temp.not_bought('{"conditions":{"id":"root","kind":"group","combinator":"and","enabled":true,"children":[{"id":"r1","kind":"rule","field":"visit_status","operator":"equals","value":"MAYBE","enabled":true}]}}')));
insert into st_flow values('bad_operator',pg_temp.draft('Bad operator','automatic',pg_temp.not_bought('{"conditions":{"id":"root","kind":"group","combinator":"and","enabled":true,"children":[{"id":"r1","kind":"rule","field":"seen_count","operator":"contains","value":"1","enabled":true}]}}')));
insert into st_flow values('manual',pg_temp.draft('Manual follow-up','manual',null));
insert into st_flow values('approval_first',pg_temp.draft('Approval first','automatic',pg_temp.not_bought('{"source":{"type":"crm_queue"},"title":{"field":"client_name"},"mapping":[],"dueField":null,"assignment":{"mode":"stage_rules","onUnresolved":"stage_rules"},"conditions":{"id":"root","kind":"group","combinator":"and","enabled":true,"children":[{"id":"r1","kind":"rule","field":"is_new_client","operator":"equals","value":true,"enabled":true}]}}'),'approval'));
insert into st_flow values('form_source',pg_temp.draft('Repair follow-up','automatic',jsonb_build_object('source',jsonb_build_object('type','jewelos_form','formFamilyId',pg_temp.fx('form_family')),
  'conditions','{"id":"root","kind":"group","combinator":"and","enabled":true,"children":[{"id":"r1","kind":"rule","field":"urgency","operator":"equals","value":"high","enabled":true}]}'::jsonb,
  'mapping','[{"key":"note","label":"Note","field":"note"}]'::jsonb,'assignment','{"mode":"source_staff","onUnresolved":"stage_rules"}'::jsonb,
  'reentry','one_per_event','onCaseClosed','record_only')));
insert into st_flow values('bad_mobile_map',pg_temp.draft('Phone mapping','automatic',jsonb_build_object('source',jsonb_build_object('type','jewelos_form','formFamilyId',pg_temp.fx('form_family')),
  'conditions','{"id":"root","kind":"group","combinator":"and","enabled":true,"children":[{"id":"r1","kind":"rule","field":"urgency","operator":"equals","value":"high","enabled":true}]}'::jsonb,
  'mapping','[{"key":"mobile","label":"Mobile","field":"mobile"}]'::jsonb,'assignment','{"mode":"stage_rules","onUnresolved":"stage_rules"}'::jsonb,
  'reentry','one_per_event','onCaseClosed','record_only')));
create function pg_temp.flow(p text) returns uuid language sql as $$ select id from st_flow where name=p $$;
grant execute on function pg_temp.fx(text),pg_temp.flow(text),pg_temp.not_bought(jsonb),pg_temp.visit(text,uuid,uuid,uuid) to authenticated,service_role;

select throws_ok($$update fms_flows set start_trigger=null where id=pg_temp.flow('not_bought')$$,'23514',null,'an automatic version needs its trigger');

select pg_temp.act('admin');
set local role authenticated;
select throws_ok($$select publish_fms_flow_with_audit(pg_temp.flow('form_task_first'))$$,'23514','The first workflow step must be a Form','form mode still requires a starting Form');
select lives_ok($$select publish_fms_flow_with_audit(pg_temp.flow('not_bought'))$$,'an automatic workflow publishes without a starting form');
select throws_ok($$select publish_fms_flow_with_audit(pg_temp.flow('no_rules'))$$,'23514',null,'an automatic workflow needs a switched-on condition');
select throws_ok($$select publish_fms_flow_with_audit(pg_temp.flow('bad_field'))$$,'23514','A start condition uses a field the source no longer has','an unknown field blocks publishing');
select throws_ok($$select publish_fms_flow_with_audit(pg_temp.flow('bad_option'))$$,'23514','A start condition matches an answer the source no longer offers','a removed option blocks publishing');
select throws_ok($$select publish_fms_flow_with_audit(pg_temp.flow('bad_operator'))$$,'23514','A start condition uses a comparison its field does not support','an incompatible operator blocks publishing');
select throws_ok($$select publish_fms_flow_with_audit(pg_temp.flow('bad_mobile_map'))$$,'23514','A copied value uses a field the source does not have','phone questions never travel with a run');
select lives_ok($$select publish_fms_flow_with_audit(pg_temp.flow('manual'))$$,'a manual workflow publishes without a starting form');
select lives_ok($$select publish_fms_flow_with_audit(pg_temp.flow('approval_first'))$$,'an automatic workflow may begin with an Approval');
select lives_ok($$select publish_fms_flow_with_audit(pg_temp.flow('form_source'))$$,'a Forms Library source publishes');
reset role;
select is((select count(*) from fms_starter_assignments where fms_flow_id in (pg_temp.flow('not_bought'),pg_temp.flow('manual'))),0::bigint,'no starting-form assignments for automatic or manual workflows');
select throws_ok($$update fms_flows set start_mode='form',start_trigger=null where id=pg_temp.flow('not_bought')$$,'42501',null,'a published version keeps its start settings');

-- Nobody can start an automatic workflow by hand, through any path.
select pg_temp.act('admin');
set local role authenticated;
select throws_ok($$select * from start_fms_instance_with_audit(pg_temp.flow('not_bought'),'Hand start')$$,'42501',null,'the legacy manual start refuses an automatic workflow');
select throws_ok($$select set_fms_flow_start_with_audit(pg_temp.flow('not_bought'),'form',null)$$,'23514',null,'start settings change only on a draft');
reset role;
select throws_ok($$insert into fms_instances(tenant_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,started_by)
  select tenant_id,id,family_id,version,'FMS-X','x',created_by from fms_flows where id=pg_temp.flow('not_bought')$$,'42501',null,'the start-path guard blocks any other insert');

-- ---------------------------------------------------------------------------------------------
-- CRM walk-in saved with status NO starts one run, assigned to the salesperson.
-- ---------------------------------------------------------------------------------------------
create temporary table st_result(name text primary key,value jsonb);
grant select,insert on st_result to service_role;
select pg_temp.as_service();
set local role service_role;
insert into st_result values('first',crm_sync_apply_submission_event('crm.sub.1',pg_temp.visit('NO','22222222-2222-4222-8222-222222222222',pg_temp.fx('sales'))));
insert into st_result values('replay',crm_sync_apply_submission_event('crm.sub.1',pg_temp.visit('NO','22222222-2222-4222-8222-222222222222',pg_temp.fx('sales'))));
insert into st_result values('repeat_visit',crm_sync_apply_submission_event('crm.sub.2',pg_temp.visit('NO','22222222-2222-4222-8222-222222222222',pg_temp.fx('sales'))));
insert into st_result values('bought',crm_sync_apply_submission_event('crm.sub.3',pg_temp.visit('YES',null,pg_temp.fx('sales'),'33333333-3333-4333-8333-333333333333')));
insert into st_result values('unknown_staff',crm_sync_apply_submission_event('crm.sub.4',pg_temp.visit('NO','44444444-4444-4444-8444-444444444444',pg_temp.fx('other_admin'),'44444444-4444-4444-8444-000000000004')));
insert into st_result values('resigned_staff',crm_sync_apply_submission_event('crm.sub.5',pg_temp.visit('NO','55555555-5555-4555-8555-555555555555',pg_temp.fx('resigned'),'55555555-5555-4555-8555-000000000005')));
insert into st_result values('no_listener',crm_sync_apply_submission_event('crm.sub.6',jsonb_build_object('kind','crm.lead_saved','record_id',gen_random_uuid(),'jewelos_branch_id',pg_temp.fx('branch'),'answers','{"lead_name":"Lead"}'::jsonb)));
reset role;
create temporary table st_event(name text primary key,id uuid);
grant select on st_event to authenticated;
insert into st_event select event_key,id from fms_trigger_events;
create function pg_temp.ev(p text) returns uuid language sql as $$ select id from st_event where name=p $$;
grant execute on function pg_temp.ev(text) to authenticated;
select pg_temp.act('sales');
select throws_ok($$select crm_sync_apply_submission_event('crm.sub.99','{"kind":"crm.walkin_visit_saved"}')$$,'42501',null,'only the service role applies CRM events');

select is((select value->>'started' from st_result where name='first'),'1','status NO starts the Not Bought run');
select is((select value->>'duplicate' from st_result where name='replay'),'true','a replayed delivery is recognized');
select is((select count(*) from fms_instances where fms_flow_id=pg_temp.flow('not_bought')),1::bigint,'one run for the case');
select is((select value->>'duplicate' from st_result where name='repeat_visit'),'1','a later visit for the same open case does not start a second run');
select is((select value->>'not_matched' from st_result where name='bought'),'1','status YES does not match');
select is((select value->>'started' from st_result where name='bought'),'0','status YES starts nothing');
select is((select value->>'review' from st_result where name='unknown_staff'),'1','a salesperson from another business is not trusted');
select is((select value->>'review' from st_result where name='resigned_staff'),'1','a resigned salesperson is not assigned');
select is((select status from fms_trigger_events where event_key='crm.sub.4'),'review','an unresolved assignee keeps the event for review');
select is((select value->>'outcome' from st_result where name='no_listener'),'no_trigger','an event nobody listens to stores nothing');
select is((select count(*) from fms_trigger_events where event_key='crm.sub.6'),0::bigint,'no answers stored without a listener');

select is((select i.title from fms_instances i where i.fms_flow_id=pg_temp.flow('not_bought')),'NOT BOUGHT FOLLOW-UP · Synthetic Client','the title comes from the mapped client name');
select is((select i.context from fms_instances i where i.fms_flow_id=pg_temp.flow('not_bought')),'{"client_code":"MKC-77","requirement":"Bangles"}'::jsonb,'mapped context, nothing else');
select is((select i.related_record_id from fms_instances i where i.fms_flow_id=pg_temp.flow('not_bought')),'11111111-1111-4111-8111-111111111111'::uuid,'the run references the CRM client');
select is((select s.assigned_to from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.fms_flow_id=pg_temp.flow('not_bought')),array[pg_temp.fx('sales')],'Follow-Up 1 goes to the salesperson');
select is((select d.name from fms_instance_stages s join fms_stages d on d.id=s.fms_stage_id join fms_instances i on i.id=s.fms_instance_id where i.fms_flow_id=pg_temp.flow('not_bought')),'Follow-Up 1','the first real step is active');
select is((select s.planned_datetime from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.fms_flow_id=pg_temp.flow('not_bought')),
  ((now() at time zone 'Asia/Kolkata')::date+5+time '21:00') at time zone 'Asia/Kolkata','the deadline is the next visit date, second half');
select is((select assignment_method from fms_stage_assignment_decisions x join fms_instances i on i.id=x.fms_instance_id where i.fms_flow_id=pg_temp.flow('not_bought')),'trigger_source','the assignment records its source');
select is((select count(*) from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.fms_flow_id=pg_temp.flow('not_bought') and s.status='completed'),0::bigint,'no fake completed starting step');
select is((select count(*) from audit_logs where action='fms_instance_started_by_trigger' and new_value->>'flow_id'=pg_temp.flow('not_bought')::text),1::bigint,'the start is audited');

-- Visibility: the salesperson sees the run; the trigger source hides the CRM id from staff.
select pg_temp.act('sales');
set local role authenticated;
select ok(can_read_fms_instance((select id from fms_instances where fms_flow_id=pg_temp.flow('not_bought'))),'the assigned salesperson can read the run');
select is(get_fms_instance_trigger_source((select id from fms_instances where fms_flow_id=pg_temp.flow('not_bought')))->>'sourceType','crm_walkin','the work page knows where the run came from');
select is(jsonb_array_length(get_fms_instance_trigger_source((select id from fms_instances where fms_flow_id=pg_temp.flow('not_bought')))->'values'),2,'mapped values are shown with their labels');
select throws_ok($$select get_fms_trigger_history()$$,'42501',null,'staff cannot open trigger history');
select throws_ok($$select test_fms_start_trigger(pg_temp.flow('not_bought'),pg_temp.not_bought(),'{}')$$,'42501',null,'staff cannot test triggers');
reset role;

-- Monitoring and testing for the administrator; another business sees nothing.
select pg_temp.act('admin');
set local role authenticated;
select ok((get_fms_trigger_history()->'summary'->>'needsAttention')::integer>=2,'history counts events needing attention');
select ok(jsonb_array_length(get_fms_trigger_history('{"outcome":"started"}')->'rows')=1,'history filters by outcome');
select is(test_fms_start_trigger(pg_temp.flow('not_bought'),pg_temp.not_bought(),'{"visit_status":"NO","client_name":"Sample","next_visit_date":"2099-01-01"}')->>'matched','true','the test panel matches sample answers');
select is(test_fms_start_trigger(pg_temp.flow('not_bought'),pg_temp.not_bought(),'{"visit_status":"YES"}')->>'matched','false','the test panel explains a miss');
select is(test_fms_start_trigger(pg_temp.flow('not_bought'),pg_temp.not_bought(),'{"visit_status":"NO"}')#>>'{firstStage,name}','Follow-Up 1','the test panel shows the first step');
select is(jsonb_array_length(inspect_fms_trigger_event(pg_temp.ev('crm.sub.4'))->'evaluations'),1,'an event can be inspected');
reset role;
select is((select count(*) from fms_instances where fms_flow_id=pg_temp.flow('not_bought')),1::bigint,'testing never creates a run');
select pg_temp.act('other_admin');
set local role authenticated;
select is(jsonb_array_length(get_fms_trigger_history()->'rows'),0,'another business sees no trigger history');
select throws_ok($$select inspect_fms_trigger_event(pg_temp.ev('crm.sub.1'))$$,'P0002',null,'another business cannot inspect an event');
reset role;

-- Retry after the roster is fixed: the resigned salesperson is reactivated.
update user_profiles set working_status='active',is_login_enabled=true where id=pg_temp.fx('resigned');
select pg_temp.act('admin');
set local role authenticated;
select is(retry_fms_trigger_event_with_audit(pg_temp.ev('crm.sub.5'))->>'started','1','retry starts the run once the assignee resolves');
select throws_ok($$select retry_fms_trigger_event_with_audit(pg_temp.ev('crm.sub.5'))$$,'23514',null,'a settled event is not retried');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Case closed in the CRM, release and re-entry.
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_service();
set local role service_role;
select is(crm_sync_apply_submission_event('crm.sub.7',jsonb_build_object('kind','crm.not_bought_case_closed','case_id','22222222-2222-4222-8222-222222222222',
  'jewelos_branch_id',pg_temp.fx('branch'),'status','ALREADY PURCHASED FROM MK JEWELS'))->>'recorded','1','a closed case is recorded on the open run');
reset role;
select is((select status::text from fms_instances where fms_flow_id=pg_temp.flow('not_bought') and related_record_id='11111111-1111-4111-8111-111111111111'),'active','record-only never cancels work');
select is((select count(*) from fms_stage_logs where action='crm_case_closed'),1::bigint,'the closure is in the journey');
update fms_instances set status='completed',completed_at=now() where fms_flow_id=pg_temp.flow('not_bought') and related_record_id='11111111-1111-4111-8111-111111111111';
select pg_temp.as_service();
set local role service_role;
select is(crm_sync_apply_submission_event('crm.sub.8',pg_temp.visit('NO','22222222-2222-4222-8222-222222222222',pg_temp.fx('sales')))->>'started','1','a finished run frees the case for the next visit');
reset role;
select is((select count(*) from fms_instances where fms_flow_id=pg_temp.flow('not_bought') and related_record_id='11111111-1111-4111-8111-111111111111'),2::bigint,'history is kept; a new run starts');

-- ---------------------------------------------------------------------------------------------
-- Forms Library source: captured in the submission's transaction; phones are dropped.
-- ---------------------------------------------------------------------------------------------
insert into form_submissions(tenant_id,branch_id,department_id,form_template_id,data,submitted_by,status)
  values(pg_temp.fx('tenant'),pg_temp.fx('branch'),pg_temp.fx('dept'),pg_temp.fx('form'),'{"urgency":"high","mobile":"9999999999","note":"Clasp"}',pg_temp.fx('sales'),'submitted');
insert into form_submissions(tenant_id,branch_id,department_id,form_template_id,data,submitted_by,status)
  values(pg_temp.fx('tenant'),pg_temp.fx('branch'),pg_temp.fx('dept'),pg_temp.fx('form'),'{"urgency":"low"}',pg_temp.fx('sales'),'submitted');
select is((select count(*) from fms_instances where fms_flow_id=pg_temp.flow('form_source')),1::bigint,'a matching form submission starts one run; the other does not');
select is((select context->>'note' from fms_instances where fms_flow_id=pg_temp.flow('form_source')),'Clasp','form answers map into the run');
select ok((select bool_and(not payload ? 'mobile') from fms_trigger_events where source_type='jewelos_form'),'phone answers are never stored');
update form_submissions set status='submitted',updated_at=now() where form_template_id=pg_temp.fx('form');
select is((select count(*) from fms_instances where fms_flow_id=pg_temp.flow('form_source')),1::bigint,'saving the submission again does not start another run');

-- ---------------------------------------------------------------------------------------------
-- Manual start without a form.
-- ---------------------------------------------------------------------------------------------
select pg_temp.act('manager');
set local role authenticated;
select lives_ok($$select * from start_fms_manual_with_audit(pg_temp.flow('manual'),'Call back Mrs. Synthetic','Asked for a design',null,null,null,null,'66666666-6666-4666-8666-666666666666')$$,'a manager starts a manual workflow without a form');
select lives_ok($$select * from start_fms_manual_with_audit(pg_temp.flow('manual'),'Call back Mrs. Synthetic','Asked for a design',null,null,null,null,'66666666-6666-4666-8666-666666666666')$$,'the same start key replays');
select throws_ok($$select * from start_fms_manual_with_audit(pg_temp.flow('not_bought'),'Nope',null,null,null,null,null,gen_random_uuid())$$,'23514',null,'an automatic workflow cannot be started by hand');
reset role;
select is((select count(*) from fms_instances where fms_flow_id=pg_temp.flow('manual')),1::bigint,'one manual run');
select is((select s.assigned_to from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id where i.fms_flow_id=pg_temp.flow('manual')),array[pg_temp.fx('manager')],'the first step follows its own assignment, not the starter');

-- ---------------------------------------------------------------------------------------------
-- CRM client profile: the runs a CRM client's events started (0378), read as the asker.
-- ---------------------------------------------------------------------------------------------
select pg_temp.act('admin');
set local role authenticated;
select ok(jsonb_array_length(get_crm_client_fms_runs('11111111-1111-4111-8111-111111111111'))>=2,'the client profile lists every run its visits started');
select is((select count(*)::int from jsonb_array_elements(get_crm_client_fms_runs('11111111-1111-4111-8111-111111111111')) r where r->>'workflowName'='NOT BOUGHT FOLLOW-UP' and r->>'status'='active' and jsonb_array_length(r->'openSteps')=1),1,
  'the open run shows its current step');
select is((select count(*)::int from jsonb_array_elements(get_crm_client_fms_runs('11111111-1111-4111-8111-111111111111')) r where r->>'status'='completed' and r->'openSteps'='[]'::jsonb),1,'a finished run stays in the history with no open step');
select is(get_crm_client_fms_runs('99999999-9999-4999-8999-999999999999'),'[]'::jsonb,'a client without runs has none');
reset role;
select pg_temp.act('other_admin');
set local role authenticated;
select is(get_crm_client_fms_runs('11111111-1111-4111-8111-111111111111'),'[]'::jsonb,'another tenant sees nothing');
reset role;
reset role;
select pg_temp.act('resigned');
set local role authenticated;
set local role authenticated;
select throws_ok($$select get_crm_client_fms_runs('11111111-1111-4111-8111-111111111111')$$,'42501',null,'an inactive person cannot read runs');
reset role;
select ok(not has_function_privilege('anon','get_crm_client_fms_runs(uuid)','execute'),'anonymous callers cannot read runs');

-- All linked CRM purposes use the same published questions and original option values.
reset role;
create temporary table linked_checks(purpose text,run_count integer,phone_removed boolean,replay_count integer,invalid_outcome text,record_only_kept boolean,cancel_closed boolean);
do $$
declare purpose text; flow uuid; cancel_flow uuid; trigger jsonb; event jsonb; result jsonb; runs integer; private_answer_removed boolean; case_id uuid;
begin
  foreach purpose in array array['walkin','lead','queue'] loop
    trigger:=jsonb_build_object('source',jsonb_build_object('type','crm_linked_form','formFamilyId',pg_temp.fx('form_family'),'formTemplateId',pg_temp.fx('form'),'purpose',purpose),
      'conditions','{"id":"g","kind":"group","combinator":"and","enabled":true,"children":[{"id":"r","kind":"rule","field":"urgency","operator":"equals","value":"high","enabled":true}]}'::jsonb,
      'mapping','[]'::jsonb,'assignment','{"mode":"stage_rules","onUnresolved":"stage_rules"}'::jsonb,'reentry','one_per_event','onCaseClosed','record_only');
    flow:=pg_temp.draft('Linked '||purpose,'automatic',trigger);
    perform pg_temp.act('admin');
    perform public.publish_fms_flow_with_audit(flow);
    if purpose='walkin' then
      cancel_flow:=pg_temp.draft('Linked walk-in cancel','automatic',trigger||'{"onCaseClosed":"cancel_run"}'::jsonb);
      perform public.publish_fms_flow_with_audit(cancel_flow);
    end if;
    perform pg_temp.as_service();
    case_id:=gen_random_uuid();
    event:=jsonb_build_object('kind','crm.form_submission_saved','record_id',gen_random_uuid(),'client_id',gen_random_uuid(),'case_id',case_id,
      'jewelos_branch_id',pg_temp.fx('branch'),'form',trigger->'source','answers','{"urgency":"high","mobile":"9100000000"}'::jsonb);
    -- The transport envelope uses purpose/family/template from the immutable CRM submission.
    result:=public.crm_sync_apply_submission_event('linked-'||purpose,event);
    select count(*)::int into runs from fms_instances where fms_flow_id=flow;
    private_answer_removed:=not exists(select 1 from fms_trigger_events where event_key='linked-'||purpose and payload ? 'mobile');
    perform public.crm_sync_apply_submission_event('linked-'||purpose,event);
    result:=public.crm_sync_apply_submission_event('wrong-template-'||purpose,jsonb_set(event,'{form,formTemplateId}',to_jsonb(gen_random_uuid())));
    if purpose='walkin' then
      perform public.fms_trigger_reconcile_crm_case(pg_temp.fx('tenant'),case_id,'DONE','linked-case-closed');
    end if;
    insert into linked_checks values(purpose,runs,private_answer_removed,(select count(*)::int from fms_instances where fms_flow_id=flow),result->>'outcome',
      (select status='active' from fms_instances where fms_flow_id=flow),
      (select status='cancelled' from fms_instances where fms_flow_id=cancel_flow));
  end loop;
end $$;
select is(run_count,1,purpose||' linked answer starts its workflow') from linked_checks;
select ok(phone_removed,purpose||' phone answer is removed') from linked_checks;
select is(replay_count,1,purpose||' event replay creates no duplicate') from linked_checks;
select is(invalid_outcome,'invalid_form',purpose||' refuses a template outside the source family') from linked_checks;
select ok(record_only_kept,'linked walk-in record-only policy keeps work active when the case closes') from linked_checks where purpose='walkin';
select ok(cancel_closed,'linked walk-in cancel policy cancels work when the case closes') from linked_checks where purpose='walkin';

select * from finish();
rollback;
