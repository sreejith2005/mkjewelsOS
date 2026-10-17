begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local test.fms.with_file='true';
set local test.fms.with_options='true';
set local test.fms.context_hidden_fields='true';
set local test.fms.unmapped_context_file='true';
\ir helpers/fms_visit_assignment_fixture.psql
insert into visit_assignment_fixture select 'work_visit',id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='call');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='b_auth'),true);
create temporary table previous_context(data jsonb);
grant all on previous_context to authenticated;
insert into previous_context select get_fms_work_form_context((select id from visit_assignment_fixture where name='instance'),(select id from visit_assignment_fixture where name='work_visit'));
select is((select data#>>'{forms,0,stageName}' from previous_context),'Initial','initial form context identifies its stage');
select is((select jsonb_array_length(data#>'{forms,0,fields}') from previous_context),5,'all submitted form questions appear without a task-display mapping');
select is((select field->>'value' from previous_context,jsonb_array_elements(data#>'{forms,0,fields}') field where field#>>'{field,key}'='private_notes'),'Do not expose unconfigured fields','assigned successor receives the whole previous form while ordinary form RLS stays unchanged');
select is((select field#>>'{field,options,0,label}' from previous_context,jsonb_array_elements(data#>'{forms,0,fields}') field where field#>>'{field,key}'='historical_choice'),'Original label','previous form uses historical option labels');
select is((select field#>>'{attachment,name}' from previous_context,jsonb_array_elements(data#>'{forms,0,fields}') field where field#>>'{field,key}'='attachment_file'),'Synthetic attachment.pdf','file context exposes a filename instead of a private storage path');
select lives_ok($$select get_fms_work_file_path((select id from visit_assignment_fixture where name='instance'),(select id from visit_assignment_fixture where name='work_visit'),(select id from visit_assignment_fixture where name='attachment'))$$,'assigned successor can open a causal attachment without a display mapping');
reset role;
select ok(can_read_fms_context_upload((select storage_path from form_submission_files where id=(select id from visit_assignment_fixture where name='attachment'))),'Storage recognizes the same unmapped causal attachment');
set local role authenticated;
reset role;
-- A published form may be edited in place. Historical section membership must win.
update form_submissions set template_snapshot=jsonb_set(jsonb_set(template_snapshot,'{template,sections}','[{"key":"historical","name":"Original section"}]'),'{fields}',
  (select jsonb_agg(field||'{"group_name":"historical"}'::jsonb) from jsonb_array_elements(template_snapshot->'fields') field))
where id=(select form_submission_id from fms_instance_stages where id in(select visit_id from fms_context_form_visits((select id from visit_assignment_fixture where name='work_visit'))));
select set_config('jewelos.allow_published_form_edit','on',true);
update form_templates set sections='[{"key":"edited","name":"Edited section"}]' where id=(select id from visit_assignment_fixture where name='form');
set local role authenticated;
select is(jsonb_array_length(get_fms_work_form_context((select id from visit_assignment_fixture where name='instance'),(select id from visit_assignment_fixture where name='work_visit'))#>'{forms,0,fields}'),5,'later section edits cannot hide historical questions');
select lives_ok($$select submit_fms_form_and_progress_with_audit((select id from visit_assignment_fixture where name='form'),jsonb_build_object('next_employee',(select id from visit_assignment_fixture where name='c'),'client_name','Second-stage answer'),'fms_stage',(select id from visit_assignment_fixture where name='work_visit'),gen_random_uuid())$$,'previous employee completes a real stage');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='c_auth'),true);
insert into visit_assignment_fixture select 'next_visit',id from fms_instance_stages where fms_instance_id=(select id from visit_assignment_fixture where name='instance') and fms_stage_id=(select id from visit_assignment_fixture where name='demo');
update previous_context set data=get_fms_work_form_context((select id from visit_assignment_fixture where name='instance'),(select id from visit_assignment_fixture where name='next_visit'),0,1);
select is((select jsonb_array_length(data->'forms') from previous_context),1,'form groups are bounded by pagination');
select is((select data->>'nextCursor' from previous_context),'1','more previous forms have a continuation cursor');
update previous_context set data=get_fms_work_form_context((select id from visit_assignment_fixture where name='instance'),(select id from visit_assignment_fixture where name='next_visit'),1,1);
select is((select data#>>'{forms,0,stageName}' from previous_context),'Call','next page contains the immediately preceding completed stage');
select is((select field->>'value' from previous_context,jsonb_array_elements(data#>'{forms,0,fields}') field where field#>>'{field,key}'='client_name'),'Second-stage answer','next employee sees the preceding employee answers');
select throws_ok($$select get_fms_work_form_context(gen_random_uuid(),(select id from visit_assignment_fixture where name='next_visit'))$$,'42501',null,'forged instance identity is denied');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='e_auth'),true);
select throws_ok($$select get_fms_work_form_context((select id from visit_assignment_fixture where name='instance'),(select id from visit_assignment_fixture where name='next_visit'))$$,'42501',null,'unrelated employee cannot read the prior forms');
reset role;
update user_profiles set is_login_enabled=false where id=(select id from visit_assignment_fixture where name='c');
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='c_auth'),true);
set local role authenticated;
select throws_ok($$select get_fms_work_form_context((select id from visit_assignment_fixture where name='instance'),(select id from visit_assignment_fixture where name='next_visit'))$$,'42501',null,'inactive assigned employee cannot read contextual forms');
reset role;
do $$ declare tenant_id uuid; other_branch uuid; other_department uuid; auth_id uuid:=gen_random_uuid(); begin
  insert into tenants(name,slug) values('Other context tenant','other-fms-context-tenant') returning id into tenant_id;
  insert into branches(tenant_id,name,code) values(tenant_id,'Other branch','CTXO') returning id into other_branch;
  insert into departments(tenant_id,branch_id,name,code) values(tenant_id,other_branch,'Other department','CTXO') returning id into other_department;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values(auth_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-context@test.local','x',now(),now());
  insert into user_profiles(tenant_id,auth_user_id,branch_id,department_id,employee_name,employee_code,email,user_role,working_status,account_status,is_login_enabled)
    values(tenant_id,auth_id,other_branch,other_department,'Other context employee','OTHER-CONTEXT','other-context@test.local','super_admin','active','active',true);
  insert into visit_assignment_fixture values('other_auth',auth_id);
end $$;
select set_config('request.jwt.claim.sub',(select id::text from visit_assignment_fixture where name='other_auth'),true);
set local role authenticated;
select throws_ok($$select get_fms_work_form_context((select id from visit_assignment_fixture where name='instance'),(select id from visit_assignment_fixture where name='next_visit'))$$,'42501',null,'even another tenant administrator cannot read the previous forms');
reset role;
select ok(not has_function_privilege('anon','get_fms_work_form_context(uuid,uuid,integer,integer)','execute'),'anonymous callers cannot read contextual forms');
select ok(not has_function_privilege('service_role','get_fms_work_form_context(uuid,uuid,integer,integer)','execute'),'context endpoint is not a service-role bypass');
select * from finish();
rollback;
