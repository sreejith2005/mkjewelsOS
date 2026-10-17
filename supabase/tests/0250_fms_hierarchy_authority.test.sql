begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
reset role;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select throws_ok($$select assert_task_assignment_role('manager')$$,'42501','Assigning tasks to management accounts is denied','an assignment grant cannot configure a future protected role');
select lives_ok($$select assert_task_assignment_role('staff')$$,'ordinary employee roles keep their assignment behavior');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
select lives_ok($$select assert_task_assignment_role('manager')$$,'effective administrator authority can configure a protected role');
select ok(not has_function_privilege('authenticated','assert_task_assignment_role(user_role)','execute'),'role authority helper remains private to audited writers');
select * from finish();
rollback;
