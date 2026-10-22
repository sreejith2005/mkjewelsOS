begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select set_config('test.fms.with_record_default','true',true);
\ir helpers/fms_visit_assignment_fixture.psql
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select lives_ok($$select submit_fms_form_and_progress_with_audit(
 (select id from visit_assignment_fixture where name='form'),
 jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c'),'order_number','ORD-2'),
 'fms_stage',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance')
  and fms_stage_id=(select id from visit_assignment_fixture where name='call')),gen_random_uuid())$$,'create a real causal override source');
reset role;
create temporary table batch_names_fixture(kind text,id uuid);
insert into batch_names_fixture select 'original',id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance')
 and fms_stage_id=(select id from visit_assignment_fixture where name='demo');
with added as (
 insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,visit_number,execution_path,previous_instance_stage_id,execution_scope_id)
 select fms_instance_id,fms_stage_id,'in_progress',assigned_to,visit_number+1,execution_path,previous_instance_stage_id,gen_random_uuid()
 from fms_instance_stages where id=(select id from batch_names_fixture where kind='original') returning id
) insert into batch_names_fixture select 'equivalent',id from added;
with added as (
 insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,visit_number,execution_path,previous_instance_stage_id,execution_scope_id)
 select fms_instance_id,fms_stage_id,'in_progress',assigned_to,visit_number+2,'{}',null,gen_random_uuid()
 from fms_instance_stages where id=(select id from batch_names_fixture where kind='original') returning id
) insert into batch_names_fixture select 'detached',id from added;
with added as (
 insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,visit_number,execution_path,previous_instance_stage_id,execution_scope_id)
 select fms_instance_id,fms_stage_id,'in_progress',assigned_to,visit_number+3,
  array(select entry from unnest(execution_path) with ordinality path(entry,position) order by position desc),
  previous_instance_stage_id,gen_random_uuid()
 from fms_instance_stages where id=(select id from batch_names_fixture where kind='original') returning id
) insert into batch_names_fixture select 'reordered',id from added;
insert into batch_names_fixture select 'submitted',id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance')
 and fms_stage_id=(select id from visit_assignment_fixture where name='call');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='c_auth'),true);
select is(fms_work_record_name((select id from batch_names_fixture where kind='original')),'ORD-2','explicit causal source supplies the override');
select is(fms_work_record_name((select id from batch_names_fixture where kind='detached')),'ORD-1','detached ancestry falls back to the original snapshot');
-- The caller supplies only exact authorized destinations, as the RPCs do.
create temporary table checked_batch as select fixture.kind,fixture.id from batch_names_fixture fixture where can_read_fms_work_context(fixture.id);
select is((select count(*)::integer from checked_batch),4,'unassigned submitted destination is excluded before batching');
select is((select count(*)::integer from fms_work_record_names_authorized(array(select id from checked_batch))),4,'every checked destination retains one result');
select ok(not exists(select 1 from checked_batch checked join fms_work_record_names_authorized(array(select id from checked_batch)) named on named.work_id=checked.id
 where named.record_name is distinct from fms_work_record_name(checked.id)),'batch matches individual resolution for equivalent, detached and reordered destinations');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((select record_name from fms_work_record_names_authorized(array[(select id from batch_names_fixture where kind='submitted')])),
 fms_work_record_name((select id from batch_names_fixture where kind='submitted')),'submitted destination preserves its individual self-exclusion');
-- Same stage/path/previous, but one destination owns the original submission.
-- Without the submission-specific key these would incorrectly share one name.
insert into batch_names_fixture select 'initial_submitted',id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance')
 and fms_stage_id=(select id from visit_assignment_fixture where name='initial');
with added as (
 insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,visit_number,execution_path,previous_instance_stage_id,execution_scope_id)
 select fms_instance_id,fms_stage_id,'in_progress',assigned_to,visit_number+1,execution_path,previous_instance_stage_id,gen_random_uuid()
 from fms_instance_stages where id=(select id from batch_names_fixture where kind='initial_submitted') returning id
) insert into batch_names_fixture select 'initial_clone',id from added;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
select isnt(fms_work_record_name((select id from batch_names_fixture where kind='initial_submitted')),
 fms_work_record_name((select id from batch_names_fixture where kind='initial_clone')),'own submission changes self-exclusion even with identical stage and ancestry');
with checked as materialized (select id from batch_names_fixture where kind in ('initial_submitted','initial_clone') and can_read_fms_work_context(id))
select ok(not exists(select 1 from checked join fms_work_record_names_authorized(array(select id from checked)) named on named.work_id=checked.id
 where named.record_name is distinct from fms_work_record_name(checked.id)),'batch keeps submitted and unsubmitted destinations distinct within the same stage and path');
select * from finish();
rollback;
