begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(30);

-- Synthetic fixtures only. No production rows or personal information.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('a1170000-0000-0000-0000-000000000001','authenticated','authenticated','p117-admin@example.invalid',
  crypt('synthetic-test-value',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
 ('a1170000-0000-0000-0000-000000000002','authenticated','authenticated','p117-staff@example.invalid',
  crypt('synthetic-test-value',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());
insert into tenants(id,name,slug) values ('11170000-0000-0000-0000-000000000001','Phase 117 Tenant','phase117');
insert into branches(id,tenant_id,name,code) values ('21170000-0000-0000-0000-000000000001','11170000-0000-0000-0000-000000000001','Phase 117 Branch','P117B');
insert into departments(id,tenant_id,branch_id,name,code) values ('31170000-0000-0000-0000-000000000001','11170000-0000-0000-0000-000000000001','21170000-0000-0000-0000-000000000001','Phase 117 Department','P117D');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
values ('41170000-0000-0000-0000-000000000001','a1170000-0000-0000-0000-000000000001','11170000-0000-0000-0000-000000000001','21170000-0000-0000-0000-000000000001','31170000-0000-0000-0000-000000000001','Phase 117 Admin','0001170001','p117-admin@example.invalid','P117-001','admin','active',true),
 ('41170000-0000-0000-0000-000000000002','a1170000-0000-0000-0000-000000000002','11170000-0000-0000-0000-000000000001','21170000-0000-0000-0000-000000000001','31170000-0000-0000-0000-000000000001','Phase 117 Staff','0001170002','p117-staff@example.invalid','P117-002','staff','active',true);

-- A submission outlives the form it was answered on -------------------------
select col_is_null('public','form_submissions','form_template_id','a submission no longer needs a form that still exists');
select has_column('public','form_submissions','template_snapshot','a submission can keep the form it was answered on');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1170000-0000-0000-0000-000000000001',true);

select lives_ok($$select save_form_draft_with_audit(null,
  jsonb_build_object('name','P117 Enquiry','permissions',jsonb_build_object('roles',jsonb_build_array('admin','staff'))),
  jsonb_build_array(
    jsonb_build_object('key','metal','label','Metal','type','select','required',true,
      'options',jsonb_build_array(jsonb_build_object('value','gold','label','Gold'),jsonb_build_object('value','silver','label','Silver'))),
    jsonb_build_object('key','notes','label','Notes','type','text')))$$,
  'an author saves a form');

select lives_ok($$select publish_form_with_audit((select id from form_templates where name='P117 Enquiry'))$$,
  'the author publishes it');
select lives_ok($$select submit_form_with_audit((select id from form_templates where name='P117 Enquiry'),
  jsonb_build_object('metal','gold','notes','Ring resize'))$$, 'somebody fills it in');
select is((select count(*)::integer from form_submissions), 1, 'the form now has the history that used to make it permanent');

-- Work that pointed at the form ---------------------------------------------
reset role;
insert into task_instances(id,tenant_id,branch_id,task_type,title,status,planned_datetime,created_by,requires_form,form_template_id)
values ('51170000-0000-0000-0000-000000000001','11170000-0000-0000-0000-000000000001','21170000-0000-0000-0000-000000000001',
  'delegation','P117 Task','pending',now(),'41170000-0000-0000-0000-000000000001',true,
  (select id from form_templates where name='P117 Enquiry'));
insert into fms_flows(id,tenant_id,name,status,created_by)
values ('61170000-0000-0000-0000-000000000001','11170000-0000-0000-0000-000000000001','P117 Flow','draft','41170000-0000-0000-0000-000000000001');
insert into fms_stages(id,fms_flow_id,stage_key,name,step_type,sort_order,form_template_id)
values ('71170000-0000-0000-0000-000000000001','61170000-0000-0000-0000-000000000001','stage_p117','P117 Stage','form',0,
  (select id from form_templates where name='P117 Enquiry'));
insert into fms_flows(id,tenant_id,name,status,created_by)
values ('61170000-0000-0000-0000-000000000002','11170000-0000-0000-0000-000000000001','P117 Untouched Flow','draft','41170000-0000-0000-0000-000000000001');
insert into fms_stages(id,fms_flow_id,stage_key,name,step_type,sort_order)
values ('71170000-0000-0000-0000-000000000002','61170000-0000-0000-0000-000000000002','stage_p117b','P117 Other Stage','task',0);
update fms_flows set status='published' where id in ('61170000-0000-0000-0000-000000000001','61170000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1170000-0000-0000-0000-000000000001',true);

-- The warning shown before the author confirms ------------------------------
select is(form_deletion_impact((select id from form_templates where name='P117 Enquiry'))->>'submissions', '1',
  'the warning counts the submissions that would be kept');
select is(form_deletion_impact((select id from form_templates where name='P117 Enquiry'))->>'tasks', '1',
  'the warning counts the tasks that would stop asking for the form');
select is(form_deletion_impact((select id from form_templates where name='P117 Enquiry'))->'flows'->0->>'name', 'P117 Flow',
  'the warning names the workflow that would need reconfiguring');
select is(form_deletion_impact((select id from form_templates where name='P117 Enquiry'))->'flows'->0->>'action', 'reverted_to_draft',
  'the warning says the workflow will come off the air as a draft');
select is(form_deletion_impact((select id from form_templates where name='P117 Enquiry'))->'flows'->0->'stages'->>0, 'P117 Stage',
  'the warning names the stage that used the form');

-- Deleting it -----------------------------------------------------------------
select lives_ok($$select delete_form_with_audit((select id from form_templates where name='P117 Enquiry'))$$,
  'a form with submissions, a task and a published workflow stage can still be deleted');
select is((select count(*)::integer from form_templates where name='P117 Enquiry'), 0, 'the form is gone');
select is((select count(*)::integer from form_submissions), 1, 'the submission it collected is not');
select ok((select form_template_id is null from form_submissions limit 1), 'the submission no longer points at a form');
select is((select template_snapshot->'template'->>'name' from form_submissions limit 1), 'P117 Enquiry',
  'the submission remembers which form it answered');
select is((select jsonb_array_length(template_snapshot->'fields') from form_submissions limit 1), 2,
  'the submission remembers the questions, so the answers stay readable');

reset role;
select is((select requires_form from task_instances where id='51170000-0000-0000-0000-000000000001'), false,
  'a task stops demanding a form nobody can fill');
select ok((select form_template_id is null from fms_stages where id='71170000-0000-0000-0000-000000000001'),
  'a published workflow stage releases the form');
select is((select new_value->'impact'->>'submissions' from audit_logs where action='form_deleted' order by created_at desc limit 1), '1',
  'the audit records what the deletion detached');
select is((select status::text from fms_flows where id='61170000-0000-0000-0000-000000000001'), 'draft',
  'the workflow comes off the air and waits as a draft');
select ok((select published_by is null from fms_flows where id='61170000-0000-0000-0000-000000000001'),
  'the workflow no longer claims to be published');
select throws_ok($$select assert_fms_flow_publishable('61170000-0000-0000-0000-000000000001')$$,
  '23514', null, 'the workflow cannot go live again until the stage gets a form');

-- The published-stage exemption is exactly one column wide ------------------
select is((select status::text from fms_flows where id='61170000-0000-0000-0000-000000000002'), 'published',
  'a workflow that never used the form stays on the air');
select throws_ok($$update fms_stages set name='Renamed' where id='71170000-0000-0000-0000-000000000002'$$,
  '23514', null, 'published stage definitions are still otherwise immutable');

-- Authorization is unchanged --------------------------------------------------
insert into form_templates(id,tenant_id,name,lifecycle,created_by)
values ('81170000-0000-0000-0000-000000000001','11170000-0000-0000-0000-000000000001','P117 Second','draft','41170000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1170000-0000-0000-0000-000000000002',true);
select throws_ok($$select delete_form_with_audit('81170000-0000-0000-0000-000000000001')$$,
  '42501', null, 'staff still cannot delete a form');
select throws_ok($$select form_deletion_impact('81170000-0000-0000-0000-000000000001')$$,
  '42501', null, 'staff cannot even ask what deleting a form would cost');
select ok(has_function_privilege('authenticated','form_deletion_impact(uuid)','EXECUTE'),
  'a form author can read the warning');
select ok(not has_function_privilege('anon','form_deletion_impact(uuid)','EXECUTE'),
  'anonymous callers cannot');
select function_owner_is('public','delete_form_with_audit',array['uuid'],'postgres',
  'the deletion RPC is still owned by postgres');

select * from finish();
rollback;
