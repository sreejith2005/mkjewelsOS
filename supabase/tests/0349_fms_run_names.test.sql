begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local test.fms.assigned_to_label='true';
\ir helpers/fms_visit_assignment_fixture.psql
-- The fixture started one run as A (Super Admin); its next step is assigned to B.
reset role;
select ok((select count(*) from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and (select id from visit_assignment_fixture where name='b')=any(assigned_to))>0,'fixture: B has a step of the run');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((select count(*)::integer from get_fms_run_names(array[(select id from visit_assignment_fixture where name='instance')])),1,'the employee working on the run gets its name');
select ok((select record_name from get_fms_run_names(array[(select id from visit_assignment_fixture where name='instance')])) is not null,'the name is filled in');
select ok((select record_name from get_fms_run_names(array[(select id from visit_assignment_fixture where name='instance')]))<>(select title from fms_instances where id=(select id from visit_assignment_fixture where name='instance')),'the name is not the repeated workflow title');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
select is((select count(*)::integer from get_fms_run_names(array[(select id from visit_assignment_fixture where name='instance')])),0,'a colleague with no part in the run gets nothing');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
select is((select count(*)::integer from get_fms_run_names(array[(select id from visit_assignment_fixture where name='instance'),gen_random_uuid()])),1,'the starter gets the name; unknown ids are ignored');
select throws_ok($$select * from get_fms_run_names(array(select gen_random_uuid() from generate_series(1,501)))$$,'22023',null,'more than 500 ids are refused');
reset role;
select is(has_function_privilege('authenticated','get_fms_run_names(uuid[])','EXECUTE'),true,'signed-in employees can call it');
select is(has_function_privilege('anon','get_fms_run_names(uuid[])','EXECUTE'),false,'anonymous callers cannot');
select is(has_function_privilege('service_role','get_fms_run_names(uuid[])','EXECUTE'),false,'service role has no grant');
select * from finish();
rollback;
