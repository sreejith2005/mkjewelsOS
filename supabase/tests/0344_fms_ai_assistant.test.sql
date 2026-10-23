begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/fms_visit_assignment_fixture.psql
reset role;

-- c is a staff author granted fms.manage only; z is a super admin in another tenant.
insert into user_permission_overrides(tenant_id,user_profile_id,permission_key,effect)
values((select id from visit_assignment_fixture where name='tenant'),(select id from visit_assignment_fixture where name='c'),'fms.manage','grant');
do $$
declare t uuid; b uuid; d uuid; a uuid; u uuid;
begin
  insert into tenants(name,slug) values('Other AI tenant','fms-ai-other') returning id into t;
  insert into branches(tenant_id,name,code) values(t,'Other','OT') returning id into b;
  insert into departments(tenant_id,branch_id,name,code) values(t,b,'Other','OT') returning id into d;
  a:=gen_random_uuid();
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values(a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','z-ai@test.local','x',now(),now());
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
    values(t,a,b,d,'Other Admin','OT-Z','z-ai@test.local','super_admin','active','active',true) returning id into u;
  insert into visit_assignment_fixture values('z',u),('z_auth',a),('other_tenant',t);
  insert into fms_ai_settings(tenant_id,debugger_enabled,builder_enabled,run_diagnosis_enabled) values(t,true,true,true);
end $$;
create temporary table ai_ids(name text primary key,id uuid);
grant all on ai_ids to authenticated;
insert into ai_ids values('r1',gen_random_uuid()),('r2',gen_random_uuid()),('r3',gen_random_uuid()),('corr',gen_random_uuid());

select ok(not has_table_privilege('authenticated','fms_ai_settings','select'),'settings are not directly readable');
select ok(not has_table_privilege('authenticated','fms_ai_requests','select'),'usage rows are not directly readable');
select ok(not has_table_privilege('authenticated','fms_diagnostic_events','select'),'diagnostic events are not directly readable');
select ok(not has_table_privilege('authenticated','fms_diagnostic_events','insert'),'diagnostic events cannot be inserted directly');
select ok(not has_function_privilege('anon','get_fms_run_diagnostic_snapshot(uuid)','EXECUTE'),'anonymous callers cannot read run snapshots');
select ok(not has_function_privilege('anon','start_fms_ai_request(uuid,text,boolean)','EXECUTE'),'anonymous callers cannot start assistant requests');
select ok(not has_function_privilege('service_role','get_fms_run_diagnostic_snapshot(uuid)','EXECUTE'),'the service role is not a run snapshot reader');
select ok(not has_function_privilege('service_role','record_fms_diagnostic_event(text,uuid,text,uuid)','EXECUTE'),'the service role cannot write diagnostic events');
select ok(not has_function_privilege('service_role','set_fms_ai_settings_with_audit(boolean,boolean,boolean,integer)','EXECUTE'),'the service role cannot change assistant settings');

-- Super admin a: defaults are all off, and every AI capability refuses until enabled.
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
set local role authenticated;
select is(get_fms_ai_settings()->>'debugger_enabled','false','debugger is off by default');
select is(get_fms_ai_settings()->>'builder_enabled','false','builder is off by default');
select is(get_fms_ai_settings()->>'run_diagnosis_enabled','false','run diagnosis is off by default');
select is(get_fms_ai_settings()->>'can_configure','true','an organization administrator may configure the assistant');
select throws_ok($$select start_fms_ai_request((select id from ai_ids where name='r1'),'debug',false)$$,'42501','fms_ai_disabled','a disabled debugger refuses requests');
select throws_ok($$select get_fms_run_diagnostic_snapshot((select id from visit_assignment_fixture where name='instance'))$$,'42501','fms_ai_disabled','a disabled run diagnosis refuses snapshots');

-- Ordinary staff without fms.manage are refused everywhere.
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select throws_ok($$select get_fms_ai_settings()$$,'42501',null,'staff without fms.manage cannot read assistant settings');
select throws_ok($$select set_fms_ai_settings_with_audit(true,true,true,30)$$,'42501',null,'staff cannot enable the assistant');
select throws_ok($$select start_fms_ai_request(gen_random_uuid(),'debug',false)$$,'42501',null,'staff cannot start an assistant request');
select throws_ok($$select get_fms_run_diagnostic_snapshot((select id from visit_assignment_fixture where name='instance'))$$,'42501',null,'staff cannot read run snapshots even for their own run');

-- A granted fms.manage author still cannot change organization settings.
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='c_auth'),true);
select is(get_fms_ai_settings()->>'can_configure','false','fms.manage alone does not configure the assistant');
select throws_ok($$select set_fms_ai_settings_with_audit(true,true,true,30)$$,'42501',null,'fms.manage alone cannot enable the assistant');

-- The administrator enables debugger and run diagnosis (builder stays off) with a limit of 2.
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
select throws_ok($$select set_fms_ai_settings_with_audit(true,false,true,0)$$,'22023',null,'an out-of-range limit is refused');
select is(set_fms_ai_settings_with_audit(true,false,true,2)->>'debugger_enabled','true','an administrator enables the debugger');
reset role;
select is((select count(*)::integer from audit_logs where action='fms_ai_settings_changed' and tenant_id=(select id from visit_assignment_fixture where name='tenant')),1,'the settings change is audited');
set local role authenticated;
select lives_ok($$select start_fms_ai_request((select id from ai_ids where name='r1'),'debug',false)$$,'an enabled debugger accepts a request');
select throws_ok($$select start_fms_ai_request((select id from ai_ids where name='r1'),'debug',false)$$,'P0001','fms_ai_duplicate_request','the same request id cannot be billed twice');
select throws_ok($$select start_fms_ai_request((select id from ai_ids where name='r2'),'build',false)$$,'42501','fms_ai_disabled','the builder stays disabled independently');
select lives_ok($$select start_fms_ai_request((select id from ai_ids where name='r2'),'debug',true)$$,'run data can be requested when run diagnosis is on');
select throws_ok($$select start_fms_ai_request((select id from ai_ids where name='r3'),'debug',false)$$,'P0001','fms_ai_daily_limit_reached','the per-user daily limit is enforced');
select throws_ok($$select finish_fms_ai_request((select id from ai_ids where name='r1'),'completed','claude-opus-5-5',-1,0,0,0)$$,'22023',null,'negative token counts are refused');
select throws_ok($$select finish_fms_ai_request((select id from ai_ids where name='r1'),'completed','DROP TABLE',1,0,0,0)$$,'22023',null,'a malformed model name is refused');
select lives_ok($$select finish_fms_ai_request((select id from ai_ids where name='r1'),'completed','claude-opus-5-5',1200,300,0,0)$$,'usage metrics are recorded');
reset role;
select is((select status||':'||input_tokens||':'||output_tokens from fms_ai_requests where request_id=(select id from ai_ids where name='r1')),'completed:1200:300','the recorded usage is exactly what was reported');
set local role authenticated;

-- A staff author cannot finish someone else's request.
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='c_auth'),true);
select lives_ok($$select finish_fms_ai_request((select id from ai_ids where name='r2'),'failed',null,0,0,0,0)$$,'finishing another user''s request is a no-op');
reset role;
select is((select status from fms_ai_requests where request_id=(select id from ai_ids where name='r2')),'started','another user''s request is unchanged');
set local role authenticated;

-- fms.manage does not widen run visibility: c is not involved in the run.
select throws_ok($$select get_fms_run_diagnostic_snapshot((select id from visit_assignment_fixture where name='instance'))$$,'42501','FMS run not found in your authorized scope','fms.manage alone does not grant reading another person''s run');

-- b is assigned to the open step and reports a failed transition after its rollback.
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
insert into ai_ids select 'open_stage',s.id from fms_instance_stages s where s.fms_instance_id=(select id from visit_assignment_fixture where name='instance') and (select id from visit_assignment_fixture where name='b')=any(s.assigned_to) and s.status in ('pending','in_progress') limit 1;
select isnt((select id from ai_ids where name='open_stage'),null,'the fixture run has an open step assigned to b');
select throws_ok($$select record_fms_diagnostic_event('fms_stage_transition',(select id from ai_ids where name='open_stage'),'drop table',gen_random_uuid())$$,'22023',null,'a malformed SQLSTATE is refused');
select throws_ok($$select record_fms_diagnostic_event('arbitrary_sql',(select id from ai_ids where name='open_stage'),'42501',gen_random_uuid())$$,'22023',null,'an unknown operation is refused');
select isnt(record_fms_diagnostic_event('fms_stage_transition',(select id from ai_ids where name='open_stage'),'p0001',(select id from ai_ids where name='corr')),null,'a participant records a sanitized failed attempt');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
select throws_ok($$select record_fms_diagnostic_event('fms_stage_transition',(select id from ai_ids where name='open_stage'),'42501',gen_random_uuid())$$,'42501','FMS step not found in your authorized scope','a non-participant cannot write events for another run');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
select is((select count(*)::integer from generate_series(1,40) g where record_fms_diagnostic_event('fms_stage_transition',(select id from ai_ids where name='open_stage'),'P0001',gen_random_uuid()) is not null),29,'events beyond 30 per hour are dropped, never raised');

-- The administrator reads a bounded, redacted snapshot.
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='a_auth'),true);
create temporary table snapshot_result as select get_fms_run_diagnostic_snapshot((select id from visit_assignment_fixture where name='instance')) as data;
select is((select (data->>'schema')::integer from snapshot_result),1,'the snapshot states its contract version');
select is((select data#>>'{instance,id}' from snapshot_result),(select id::text from visit_assignment_fixture where name='instance'),'the snapshot is for the requested run');
select ok((select jsonb_array_length(data->'stages')>0 from snapshot_result),'the snapshot lists the run''s steps');
select ok((select exists(select 1 from jsonb_array_elements(data->'stages') s where s->>'stage_key'='call' and s->'assigned_to' ? (select id::text from visit_assignment_fixture where name='b')) from snapshot_result),'the snapshot shows who holds the step');
select is((select (data#>>'{diagnostic_events,0,sqlstate}') from snapshot_result),'P0001','recorded failed attempts appear, upper-cased');
select ok((select data::text not like '%Synthetic client%' and data::text not like '%Do not expose unconfigured fields%' from snapshot_result),'answers that decide no route or assignment are redacted');
select is((select item->>'value' from snapshot_result,jsonb_array_elements(data->'route_answers') item where item->>'field_key'='next_employee' limit 1),(select id::text from visit_assignment_fixture where name='b'),'the answer that decides the next assignment is included');
select ok((select data->'redacted' ? 'remarks' from snapshot_result),'the snapshot names what it redacted');
select ok((select data->'people' @> jsonb_build_array(jsonb_build_object('id',(select id from visit_assignment_fixture where name='b'),'active',true)) from snapshot_result),'the snapshot reports assignee status');
select ok((select data::text not like '%@test.local%' from snapshot_result),'no email addresses are included');

-- Cross-tenant: another tenant's super admin with everything enabled sees nothing.
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='z_auth'),true);
select throws_ok($$select get_fms_run_diagnostic_snapshot((select id from visit_assignment_fixture where name='instance'))$$,'42501','FMS run not found in your authorized scope','another tenant cannot read this run');
select throws_ok($$select record_fms_diagnostic_event('fms_stage_transition',(select id from ai_ids where name='open_stage'),'P0001',gen_random_uuid())$$,'42501',null,'another tenant cannot write events for this run');
select is(get_fms_ai_settings()->>'used_today','0','usage is counted per tenant and user');

-- Inactive author and disabled section.
reset role;
update user_profiles set account_status='inactive' where id=(select id from visit_assignment_fixture where name='c');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='c_auth'),true);
select throws_ok($$select start_fms_ai_request(gen_random_uuid(),'debug',false)$$,'42501',null,'an inactive author cannot start requests');
reset role;
update user_profiles set account_status='active' where id=(select id from visit_assignment_fixture where name='c');
insert into tenant_section_controls(tenant_id,section_availability) values((select id from visit_assignment_fixture where name='tenant'),'{"fms_builder":false}')
on conflict(tenant_id) do update set section_availability=tenant_section_controls.section_availability||'{"fms_builder":false}';
set local role authenticated;
select throws_ok($$select get_fms_ai_settings()$$,'42501','This section is currently unavailable','a disabled FMS section disables the assistant');
select throws_ok($$select start_fms_ai_request(gen_random_uuid(),'debug',false)$$,'42501','This section is currently unavailable','a disabled FMS section refuses requests');
select * from finish();
rollback;
