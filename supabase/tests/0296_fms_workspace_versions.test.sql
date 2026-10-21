begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
insert into visit_assignment_fixture values('version2',create_fms_revision_with_audit((select id from visit_assignment_fixture where name='flow')));
select lives_ok($$select publish_fms_flow_with_audit((select id from visit_assignment_fixture where name='version2'))$$,'new published version retains existing authoring contract');
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from visit_assignment_fixture where name='form'),
 jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='b'),'client_name','Synthetic client'),
 'fms_entry',(select id from fms_starter_assignments where fms_flow_id=(select id from visit_assignment_fixture where name='version2') and user_profile_id=(select id from visit_assignment_fixture where name='a') and status='pending'),gen_random_uuid())$$,'exact new-version starter creates work');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((get_fms_task_workspace('{}')->>'familyTotal')::integer,1,'versions share one stable family');
select is((get_fms_task_workspace('{}')->'families'->0->>'count')::integer,2,'both pinned versions contribute distinct assignments');
select is((select count(distinct item->>'flowId')::integer from jsonb_array_elements(get_fms_task_stages((select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')))) item where (item->>'count')::integer>0),2,'same-named stages stay distinct across versions');
select is((select sum((item->>'count')::integer)::integer from jsonb_array_elements(get_fms_task_stages((select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')))) item),2,'versioned stage counts reconcile');
select is((select count(*)::integer from jsonb_array_elements(get_fms_task_stages((select family_id from fms_flows where id=(select id from visit_assignment_fixture where name='flow')))) item where (item->>'count')::integer=0),10,'unactivated stages remain zero without fabricated tasks');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
insert into visit_assignment_fixture values('separate_family',create_fms_revision_with_audit((select id from visit_assignment_fixture where name='version2')));
reset role;
update fms_flows set family_id=gen_random_uuid(),version=1 where id=(select id from visit_assignment_fixture where name='separate_family');
set local role authenticated;
select lives_ok($$select publish_fms_flow_with_audit((select id from visit_assignment_fixture where name='separate_family'))$$,'independent same-name family publishes');
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from visit_assignment_fixture where name='form'),
 jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='b'),'client_name','Synthetic client'),
 'fms_entry',(select id from fms_starter_assignments where fms_flow_id=(select id from visit_assignment_fixture where name='separate_family') and user_profile_id=(select id from visit_assignment_fixture where name='a') and status='pending'),gen_random_uuid())$$,'separate family starter creates its own assignment');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((get_fms_task_workspace('{}')->>'familyTotal')::integer,2,'same-name independent families are never merged');
select is((get_fms_task_workspace('{}')->>'total')::integer,3,'family counts include each actual work identity once');
reset role;
select * from finish();
rollback;
