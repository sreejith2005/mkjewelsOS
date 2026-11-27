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

-- The CRM-started triggers (walk-in, queue, lead events from crm_sync) were removed with the old CRM (0443).

select * from finish();
rollback;
