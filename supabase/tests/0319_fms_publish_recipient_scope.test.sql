begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
reset role;
insert into visit_assignment_fixture values('publication_revision',create_fms_revision_with_audit((select id from visit_assignment_fixture where name='flow')));
update visit_assignment_fixture set id=(select id from visit_assignment_fixture where name='publication_revision') where name='flow';
update visit_assignment_fixture fixture set id=stage.id from fms_stages stage
where stage.fms_flow_id=(select id from visit_assignment_fixture where name='flow') and fixture.name=stage.stage_key;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
insert into user_permission_overrides(tenant_id,user_profile_id,permission_key,effect)
values((select id from visit_assignment_fixture where name='tenant'),(select id from visit_assignment_fixture where name='b'),'tasks.assign_others','deny');
select throws_ok($$select assert_fms_assignment_publishable((select id from visit_assignment_fixture where name='flow'))$$,'42501','Employee is outside your permitted FMS handoff scope','runtime handoff does not grant publication of other fixed owners');
update fms_stage_assignees set user_profile_id=(select id from visit_assignment_fixture where name='b') where fms_stage_id=(select id from visit_assignment_fixture where name='locked');
select lives_ok($$select assert_fms_assignment_publishable((select id from visit_assignment_fixture where name='flow'))$$,'previously allowed self-owned fixed publication stays allowed');
update user_permission_overrides set effect='grant' where user_profile_id=(select id from visit_assignment_fixture where name='b') and permission_key='tasks.assign_others';
update fms_stage_assignees set user_profile_id=(select id from visit_assignment_fixture where name='a') where fms_stage_id=(select id from visit_assignment_fixture where name='locked');
select throws_ok($$select assert_fms_assignment_publishable((select id from visit_assignment_fixture where name='flow'))$$,'42501','Employee is outside your permitted FMS handoff scope','ordinary assignment grant does not authorize publishing a protected management owner');
do $$
declare d uuid;
begin
 insert into departments(tenant_id,branch_id,name,code) values((select id from visit_assignment_fixture where name='tenant'),(select id from visit_assignment_fixture where name='branch'),'Other publishing department','VPD') returning id into d;
 update user_profiles set department_id=d where id=(select id from visit_assignment_fixture where name='d');
end $$;
update fms_stage_assignees set user_profile_id=(select id from visit_assignment_fixture where name='d') where fms_stage_id=(select id from visit_assignment_fixture where name='locked');
select throws_ok($$select assert_fms_assignment_publishable((select id from visit_assignment_fixture where name='flow'))$$,'42501','Employee is outside your permitted FMS handoff scope','publishing an out-of-department fixed owner retains its scope guard');
update fms_stage_assignees set user_profile_id=(select id from visit_assignment_fixture where name='b') where fms_stage_id=(select id from visit_assignment_fixture where name='locked');
update fms_stages set planned_time_rule=jsonb_set(planned_time_rule,'{assignment,fallbackRule}',jsonb_build_object('type','specific_user','userProfileId',(select id from visit_assignment_fixture where name='d'))) where id=(select id from visit_assignment_fixture where name='call');
select throws_ok($$select assert_fms_assignment_publishable((select id from visit_assignment_fixture where name='flow'))$$,'42501','Employee is outside your permitted FMS handoff scope','specific-user fallback publication retains its scope guard');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
select lives_ok($$select assert_fms_assignment_publishable((select id from visit_assignment_fixture where name='flow'))$$,'authorized company administrator retains publication access');
select ok(not has_function_privilege('authenticated','assert_fms_publish_recipient(uuid,uuid,boolean)','EXECUTE'),'publication recipient helper is private to the server');
select ok(not has_function_privilege('anon','assert_fms_publish_recipient(uuid,uuid,boolean)','EXECUTE'),'anonymous caller cannot validate publication directly');
select ok(not has_function_privilege('service_role','assert_fms_publish_recipient(uuid,uuid,boolean)','EXECUTE'),'service role cannot call publication helper directly');
select * from finish();
rollback;
