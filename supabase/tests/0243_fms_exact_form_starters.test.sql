begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','submit_form_and_start_fms_idempotent',array['uuid','jsonb','uuid','uuid'],'Forms Library has a durable exact-flow boundary');
select has_function('public','get_fms_work_mutation_result',array['uuid'],'lost responses can be recovered without storing answers');
\ir helpers/fms_visit_assignment_fixture.psql
reset role;
create temporary table exact_starter_fixture(name text primary key,value jsonb);
grant all on exact_starter_fixture to authenticated;
do $$
declare f uuid; first_id uuid; next_id uuid; form_id uuid:=(select id from visit_assignment_fixture where name='form');
begin
  insert into fms_flows(tenant_id,family_id,version,name,scope_type,status,is_active,created_by,updated_by,assignment_version)
    select tenant_id,gen_random_uuid(),1,'Other enquiry','tenant','draft',true,created_by,updated_by,2 from fms_flows where id=(select id from visit_assignment_fixture where name='flow') returning id into f;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule,form_template_id)
    values(f,'initial','Initial','form',0,true,'{"deadlineEnabled":false}',form_id) returning id into first_id;
  insert into fms_stages(fms_flow_id,stage_key,name,step_type,sort_order,is_required,planned_time_rule)
    values(f,'finish','Other work','task',1,true,jsonb_build_object('deadlineEnabled',false,'assignment',jsonb_build_object('mode','previous_form','allowHandoff',true,'sources',jsonb_build_array(jsonb_build_object('sourceStageKey','initial','formTemplateId',form_id,'fieldKey','next_employee'))))) returning id into next_id;
  update fms_stages set default_next_stage_id=next_id where id=first_id;
  insert into exact_starter_fixture values('flow',to_jsonb(f)),('key',to_jsonb(gen_random_uuid()));
end $$;
set local role authenticated;
select lives_ok($$select publish_fms_flow_with_audit((select (value#>>'{}')::uuid from exact_starter_fixture where name='flow'))$$,'two workflows can share one exact published initial form');
select throws_ok($$select submit_form_and_start_fms_idempotent((select id from visit_assignment_fixture where name='form'),jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='b')),gen_random_uuid(),null)$$,'23514','This form is linked to more than one active workflow. Keep one workflow active for this form.','generic submission cannot guess between two workflows');
insert into exact_starter_fixture values('result',submit_form_and_start_fms_idempotent((select id from visit_assignment_fixture where name='form'),jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='b')),(select (value#>>'{}')::uuid from exact_starter_fixture where name='key'),(select (value#>>'{}')::uuid from exact_starter_fixture where name='flow')));
select is((select fms_flow_id from fms_instances where id=(select (value->>'instance_id')::uuid from exact_starter_fixture where name='result')),(select (value#>>'{}')::uuid from exact_starter_fixture where name='flow'),'the exact selected workflow starts');
select is(submit_form_and_start_fms_idempotent((select id from visit_assignment_fixture where name='form'),jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='b')),(select (value#>>'{}')::uuid from exact_starter_fixture where name='key'),(select (value#>>'{}')::uuid from exact_starter_fixture where name='flow')),(select value from exact_starter_fixture where name='result'),'replayed standalone request returns the original instance');
select is(get_fms_work_mutation_result((select (value#>>'{}')::uuid from exact_starter_fixture where name='key')),(select value from exact_starter_fixture where name='result'),'caller recovers a lost result using only its request key');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
select is(get_fms_work_mutation_result((select (value#>>'{}')::uuid from exact_starter_fixture where name='key')),null::jsonb,'another employee cannot recover someone else''s submission');
reset role;
select ok(not has_function_privilege('anon','submit_form_and_start_fms_idempotent(uuid,jsonb,uuid,uuid)','EXECUTE'),'anonymous callers cannot use the exact starter boundary');
select * from finish();
rollback;
