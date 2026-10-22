begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
reset role;
do $$
declare t uuid; b uuid; d uuid; foreign_t uuid; foreign_b uuid; foreign_d uuid; auth_id uuid:=gen_random_uuid(); u uuid;
begin
 select id into t from visit_assignment_fixture where name='tenant';
 insert into branches(tenant_id,name,code) values(t,'Other branch','VH2') returning id into b;
 insert into departments(tenant_id,branch_id,name,code) values(t,b,'Operations','VH2') returning id into d;
 update user_profiles set branch_id=b,department_id=d,user_role='manager' where id=(select id from visit_assignment_fixture where name='c');
 insert into departments(tenant_id,branch_id,name,code) values(t,(select id from visit_assignment_fixture where name='branch'),'Other department','VH3') returning id into d;
 update user_profiles set department_id=d where id=(select id from visit_assignment_fixture where name='d');
 update user_profiles set is_login_enabled=false where id=(select id from visit_assignment_fixture where name='e');
 insert into user_permission_overrides(tenant_id,user_profile_id,permission_key,effect)
 values(t,(select id from visit_assignment_fixture where name='b'),'tasks.assign_others','deny');
 insert into tenants(name,slug) values('Other handoff tenant','other-handoff-tenant') returning id into foreign_t;
 insert into branches(tenant_id,name,code) values(foreign_t,'Other tenant branch','VHF') returning id into foreign_b;
 insert into departments(tenant_id,branch_id,name,code) values(foreign_t,foreign_b,'Other tenant department','VHF') returning id into foreign_d;
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
 values(auth_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','foreign-handoff@test.local','x',now(),now());
 insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
 values(foreign_t,auth_id,foreign_b,foreign_d,'Foreign employee','VH-FOREIGN','foreign-handoff@test.local','staff','active','active',true) returning id into u;
 insert into visit_assignment_fixture values('foreign_user',u),('foreign_auth',auth_id);
end $$;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
create temporary table handoff_scope_fixture(name text primary key,value jsonb);
grant all on handoff_scope_fixture to authenticated;
insert into handoff_scope_fixture values('request',jsonb_build_object('kind','stage_form',
 'instanceStageId',(select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call')),
 'formTemplateId',(select id from visit_assignment_fixture where name='form'),
 'answers',jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c')),'outcome','','remark','','checklist','{}'::jsonb));
set local role authenticated;
select ok(not has_permission('tasks.assign_others'),'actor has no ordinary task assignment capability');
insert into handoff_scope_fixture values('people',list_fms_handoff_recipients((select value from handoff_scope_fixture where name='request'),(select id from visit_assignment_fixture where name='demo')));
select ok(exists(select 1 from jsonb_array_elements((select value->'people' from handoff_scope_fixture where name='people')) p where p->>'id'=(select id::text from visit_assignment_fixture where name='c')),'picker includes manager from another branch and department');
select ok(exists(select 1 from jsonb_array_elements((select value->'people' from handoff_scope_fixture where name='people')) p where p->>'id'=(select id::text from visit_assignment_fixture where name='d')),'picker includes staff from another department');
select ok(exists(select 1 from jsonb_array_elements((select value->'people' from handoff_scope_fixture where name='people')) p where p->>'id'=(select id::text from visit_assignment_fixture where name='a')),'picker includes company administrator');
select ok(not exists(select 1 from jsonb_array_elements((select value->'people' from handoff_scope_fixture where name='people')) p where p->>'id' in ((select id::text from visit_assignment_fixture where name='e'),(select id::text from visit_assignment_fixture where name='foreign_user'))),'picker excludes disabled and foreign users');
insert into handoff_scope_fixture values('preview',preview_fms_work_transition((select value from handoff_scope_fixture where name='request')));
select is((select value#>>'{destinations,0,selectedUserId}' from handoff_scope_fixture where name='preview'),(select id::text from visit_assignment_fixture where name='c'),'form-selected cross-branch manager resolves in preview');
select is((select value#>>'{destinations,0,issue}' from handoff_scope_fixture where name='preview'),null::text,'company-wide form choice has no scope error');
select is((preview_fms_work_transition((select value from handoff_scope_fixture where name='request'),jsonb_build_array(jsonb_build_object('targetStageId',(select id from visit_assignment_fixture where name='demo'),'userProfileId',(select id from visit_assignment_fixture where name='d'))))#>>'{destinations,0,selectedUserId}'),(select id::text from visit_assignment_fixture where name='d'),'explicit override can select staff in another department');
select is(jsonb_array_length(list_fms_handoff_recipients((select value from handoff_scope_fixture where name='request'),(select id from visit_assignment_fixture where name='demo'),'Employee C')->'people'),1,'company-wide picker search still filters names');
select throws_ok($$select list_fms_handoff_recipients((select value from handoff_scope_fixture where name='request'),(select id from visit_assignment_fixture where name='locked'))$$,'42501','This destination does not allow replacement','picker cannot replace a locked destination');
select throws_ok($$select preview_fms_work_transition((select value from handoff_scope_fixture where name='request'),jsonb_build_array(jsonb_build_object('targetStageId',(select id from visit_assignment_fixture where name='demo'),'userProfileId',(select id from visit_assignment_fixture where name='foreign_user'))))$$,'23503','FMS user is not an active login-enabled tenant profile','forged cross-tenant recipient is denied');
select throws_ok($$select preview_fms_work_transition((select value from handoff_scope_fixture where name='request'),jsonb_build_array(jsonb_build_object('targetStageId',(select id from visit_assignment_fixture where name='demo'),'userProfileId',(select id from visit_assignment_fixture where name='e'))))$$,'23503','FMS user is not an active login-enabled tenant profile','disabled recipient is denied');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='d_auth'),true);
select throws_ok($$select list_fms_handoff_recipients((select value from handoff_scope_fixture where name='request'),(select id from visit_assignment_fixture where name='demo'))$$,'42501','FMS work is not available to your account','an unrelated employee cannot list recipients for another assignment');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='foreign_auth'),true);
select throws_ok($$select preview_fms_work_transition((select value from handoff_scope_fixture where name='request'))$$,'42501','FMS work is not available to your account','foreign actor cannot preview the work');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
select throws_ok($$select list_fms_handoff_recipients((select value from handoff_scope_fixture where name='request'),(select id from visit_assignment_fixture where name='demo'))$$,'42501','An active profile is required to submit workflow work','disabled actor cannot list recipients');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select lives_ok($$select transition_fms_work_with_audit((select value from handoff_scope_fixture where name='request'),gen_random_uuid(),'[]'::jsonb,(select value->>'fingerprint' from handoff_scope_fixture where name='preview'))$$,'form submission and company-wide handoff commit atomically');
reset role;
select is((select assigned_to from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='demo')),array[(select id from visit_assignment_fixture where name='c')],'persisted successor belongs to cross-branch manager');
select is((select count(*)::integer from fms_stage_assignment_decisions where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and selected_user_ids=array[(select id from visit_assignment_fixture where name='c')]),1,'handoff retains its durable ownership decision');
select ok(not task_assignment_user_in_scope((select id from visit_assignment_fixture where name='c')),'ordinary task department scope remains unchanged');
select ok(not task_assignment_recipient_allowed((select id from visit_assignment_fixture where name='a')),'ordinary task management protection remains unchanged');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='c_auth'),true);
update handoff_scope_fixture set value=jsonb_set(value,'{instanceStageId}',to_jsonb((select id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='demo'))::text)) where name='request';
insert into handoff_scope_fixture values('handoffs',jsonb_build_array(jsonb_build_object('targetStageId',(select id from visit_assignment_fixture where name='negotiation'),'userProfileId',(select id from visit_assignment_fixture where name='a'))));
set local role authenticated;
update handoff_scope_fixture set value=preview_fms_work_transition((select value from handoff_scope_fixture where name='request'),(select value from handoff_scope_fixture where name='handoffs')) where name='preview';
select lives_ok($$select transition_fms_work_with_audit((select value from handoff_scope_fixture where name='request'),gen_random_uuid(),(select value from handoff_scope_fixture where name='handoffs'),(select value->>'fingerprint' from handoff_scope_fixture where name='preview'))$$,'explicit manual handoff to company administrator commits');
reset role;
select is((select assigned_to from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='negotiation')),array[(select id from visit_assignment_fixture where name='a')],'manual override persists the administrator as next assignee');
select ok(not has_function_privilege('authenticated','assert_fms_handoff_recipient(uuid,uuid,boolean)','EXECUTE'),'browser cannot call private recipient validator');
select ok(not has_function_privilege('anon','list_fms_handoff_recipients(jsonb,uuid,text,uuid,integer)','EXECUTE'),'anonymous callers cannot list recipients');
select ok(not has_function_privilege('service_role','list_fms_handoff_recipients(jsonb,uuid,text,uuid,integer)','EXECUTE'),'service role cannot use employee recipient endpoint');
select * from finish();
rollback;
