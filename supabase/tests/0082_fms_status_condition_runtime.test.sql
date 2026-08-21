begin;
select plan(11);

select has_function('public','activate_fms_stage_internal',array['uuid','uuid','uuid','uuid','integer'],'explicit FMS activation runtime exists');
select has_function('public','fms_status_condition_matches',array['text','text','text'],'status comparison helper exists');
select results_eq($$select fms_status_condition_matches('equals','open','OPEN')$$,array[true],'equals is case insensitive');
select results_eq($$select fms_status_condition_matches('not_equals','open','closed')$$,array[true],'not_equals works');
select results_eq($$select fms_status_condition_matches('greater_than','b','c')$$,array[true],'greater_than works');
select results_eq($$select fms_status_condition_matches('less_than','c','b')$$,array[true],'less_than works');
select results_eq($$select fms_status_condition_matches('greater_than_or_equal','b','b')$$,array[true],'greater_than_or_equal works');
select results_eq($$select fms_status_condition_matches('less_than_or_equal','b','b')$$,array[true],'less_than_or_equal works');
select results_eq($$select fms_status_condition_matches('contains','pen','open')$$,array[true],'contains works');
select results_eq($$select fms_status_condition_matches('not_contains','pen','closed')$$,array[true],'not_contains works');
select ok((select pg_get_functiondef('activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer)'::regprocedure) like '%fms_stage_condition_skipped%'),'unmet conditions write an audit log');

select * from finish();
rollback;
