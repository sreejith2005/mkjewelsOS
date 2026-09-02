begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

-- Synthetic fixtures only. No production rows or personal information.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select auth_id,'authenticated','authenticated',email,crypt('synthetic-test-value',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
from (values
 ('a1250000-0000-0000-0000-000000000001'::uuid,'p125-admin@example.invalid'),
 ('a1250000-0000-0000-0000-000000000002'::uuid,'p125-staff@example.invalid')
) fixture(auth_id,email);

insert into tenants(id,name,slug) values ('11250000-0000-0000-0000-000000000001','Checkbox Tenant','checkbox-tenant');
insert into branches(id,tenant_id,name,code) values ('21250000-0000-0000-0000-000000000001','11250000-0000-0000-0000-000000000001','Checkbox Branch','CB1');
insert into departments(id,tenant_id,branch_id,name,code) values ('31250000-0000-0000-0000-000000000001','11250000-0000-0000-0000-000000000001','21250000-0000-0000-0000-000000000001','Checkbox Dept','CD1');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
values
 ('41250000-0000-0000-0000-000000000001','a1250000-0000-0000-0000-000000000001','11250000-0000-0000-0000-000000000001','21250000-0000-0000-0000-000000000001','31250000-0000-0000-0000-000000000001','Checkbox Admin','9100000101','p125-admin@example.invalid','CB-1','admin','active',true),
 ('41250000-0000-0000-0000-000000000002','a1250000-0000-0000-0000-000000000002','11250000-0000-0000-0000-000000000001','21250000-0000-0000-0000-000000000001','31250000-0000-0000-0000-000000000001','Checkbox Staff','9100000102','p125-staff@example.invalid','CB-2','staff','active',true);

select is(
  normalize_form_fields('[{"key":"services","label":"Services","type":"checkbox","options":[{"value":"repair","label":"Repair"}]}]'::jsonb)->0->'options'->0->>'value',
  'repair', 'normalization accepts stable Checkbox options');
select is(
  normalize_form_fields('[{"key":"confirm","label":"Confirm","type":"checkbox"}]'::jsonb)->0->'options',
  null::jsonb, 'normalization retains an optionless legacy Checkbox');
select function_owner_is('public','submit_form_locked_with_audit',array['uuid','jsonb','text','uuid'],'postgres','submission implementation remains owned by postgres');
select ok(not has_function_privilege('authenticated','submit_form_locked_with_audit(uuid,jsonb,text,uuid)','EXECUTE'),'locked submission implementation remains private');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1250000-0000-0000-0000-000000000001',true);
select lives_ok($$select save_form_draft_with_audit(null,'{"name":"Checkbox Contract","permissions":{"roles":["staff"]}}',
  '[{"key":"services","label":"Services","type":"checkbox","required":true,"options":[{"value":"repair","label":"Repair"},{"value":"inspection","label":"Inspection"}]},{"key":"confirm","label":"Confirm","type":"checkbox","required":true}]'::jsonb)$$,
  'admin saves option-backed and legacy Checkbox fields together');
select lives_ok($$select publish_form_with_audit((select id from form_templates where name='Checkbox Contract' and lifecycle='draft'))$$,
  'Checkbox form publishes through the existing audited lifecycle');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1250000-0000-0000-0000-000000000002',true);
select lives_ok(format('select submit_form_with_audit(%L,%L::jsonb)',
  (select id from form_templates where name='Checkbox Contract' and lifecycle='published'),
  jsonb_build_object('services',jsonb_build_array('repair','inspection'),'confirm',true)),
  'staff submits multiple configured Checkbox answers plus a legacy boolean');
reset role;

select is((select data->'services' from form_submissions where submitted_by='41250000-0000-0000-0000-000000000002'),
  jsonb_build_array('repair','inspection'), 'submission stores the stable selected option values');
select is((select count(*)::int from audit_logs where action='form_submitted' and actor_user_id='41250000-0000-0000-0000-000000000002'),
  1, 'the existing submission audit write is preserved');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1250000-0000-0000-0000-000000000002',true);
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',
  (select id from form_templates where name='Checkbox Contract' and lifecycle='published'),
  jsonb_build_object('services',jsonb_build_array('unknown'),'confirm',true)),
  '22023',null,'an unknown Checkbox option is rejected');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',
  (select id from form_templates where name='Checkbox Contract' and lifecycle='published'),
  jsonb_build_object('services',jsonb_build_array('repair','repair'),'confirm',true)),
  '22023',null,'duplicate Checkbox selections are rejected');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',
  (select id from form_templates where name='Checkbox Contract' and lifecycle='published'),
  jsonb_build_object('services','repair','confirm',true)),
  '22023',null,'an option-backed Checkbox rejects a scalar answer');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',
  (select id from form_templates where name='Checkbox Contract' and lifecycle='published'),
  jsonb_build_object('services',jsonb_build_array(),'confirm',true)),
  '23514',null,'a required option-backed Checkbox rejects an empty array');
select throws_ok(format('select submit_form_with_audit(%L,%L::jsonb)',
  (select id from form_templates where name='Checkbox Contract' and lifecycle='published'),
  jsonb_build_object('services',jsonb_build_array('repair'),'confirm',false)),
  '23514',null,'a required legacy Checkbox still requires true');
reset role;

select is((select option_source from form_fields where form_template_id=(select id from form_templates where name='Checkbox Contract' and lifecycle='published') and field_key='services'),
  'manual', 'option-backed Checkbox persistence uses the existing manual option source');

select * from finish();
rollback;
