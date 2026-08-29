begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(27);

-- Synthetic fixtures only. No production rows or personal information.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('a1130000-0000-0000-0000-000000000001','authenticated','authenticated','p113-admin@example.invalid',
  crypt('synthetic-test-value',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());
insert into tenants(id,name,slug) values ('11130000-0000-0000-0000-000000000001','Phase 113 Tenant','phase113');
insert into branches(id,tenant_id,name,code) values ('21130000-0000-0000-0000-000000000001','11130000-0000-0000-0000-000000000001','Phase 113 Branch','P113B');
insert into departments(id,tenant_id,branch_id,name,code) values ('31130000-0000-0000-0000-000000000001','11130000-0000-0000-0000-000000000001','21130000-0000-0000-0000-000000000001','Phase 113 Department','P113D');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
values ('41130000-0000-0000-0000-000000000001','a1130000-0000-0000-0000-000000000001','11130000-0000-0000-0000-000000000001','21130000-0000-0000-0000-000000000001','31130000-0000-0000-0000-000000000001','Phase 113 Admin','0001130001','p113-admin@example.invalid','P113-001','admin','active',true);
insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active) values
 ('11130000-0000-0000-0000-000000000001','p113_customer_type','Individual','individual',0,true),
 ('11130000-0000-0000-0000-000000000001','p113_customer_type','Business','business',1,true);

-- Schema and posture -------------------------------------------------------
select has_column('public','form_templates','sections','templates carry ordered sections');
select has_column('public','form_fields','branch_logic','fields carry section branch rules');
select col_is_null('public','form_fields','branch_logic','forms without branching need no backfill');
select function_owner_is('public','create_dropdown_list_with_audit',array['text','jsonb'],'postgres','the Dropdown Master list RPC is owned by postgres');
select ok(has_function_privilege('authenticated','create_dropdown_list_with_audit(text,jsonb)','EXECUTE'),'authenticated form authors may create a Dropdown Master list');
select ok(not has_function_privilege('anon','create_dropdown_list_with_audit(text,jsonb)','EXECUTE'),'anonymous callers cannot create a Dropdown Master list');
select ok(not has_function_privilege('authenticated','form_reachable_sections(uuid,jsonb)','EXECUTE'),'the section walk is an internal helper');

-- Option identity ----------------------------------------------------------
select is(form_option_values('["Walk-in","Referral"]'::jsonb),'["Walk-in", "Referral"]'::jsonb,'legacy string options still yield their values');
select is(form_option_values('[{"value":"individual","label":"Individual"}]'::jsonb),'["individual"]'::jsonb,'identified options yield their stable values');
select is(normalize_form_options('[" Walk-in "]'::jsonb),'[{"value": "Walk-in", "label": "Walk-in"}]'::jsonb,'a legacy option keeps the value it always had');
select throws_ok($$select normalize_form_options('[{"value":"a","label":"A"},{"value":"a","label":"B"}]'::jsonb)$$,'22023',NULL,'duplicate option values are rejected');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1130000-0000-0000-0000-000000000001',true);

-- Authoring a branching form ----------------------------------------------
select lives_ok($$select save_form_draft_with_audit(null,
  jsonb_build_object('name','P113 Customer Onboarding','permissions',jsonb_build_object('roles',jsonb_build_array('admin','staff')),
    'sections', jsonb_build_array(
      jsonb_build_object('key','section_1','title','Customer type'),
      jsonb_build_object('key','individual_details','title','Individual Details','next','__submit__'),
      jsonb_build_object('key','business_details','title','Business Details'))),
  jsonb_build_array(
    jsonb_build_object('key','customer_type','label','Customer type','type','select','sectionKey','section_1','required',true,
      'optionSource', jsonb_build_object('kind','master','masterType','p113_customer_type'),
      'branches', jsonb_build_array(
        jsonb_build_object('operator','equals','value','individual','targetSectionKey','individual_details'),
        jsonb_build_object('operator','equals','value','business','targetSectionKey','business_details'))),
    jsonb_build_object('key','individual_name','label','Name','type','text','sectionKey','individual_details','required',true),
    jsonb_build_object('key','company_name','label','Company Name','type','text','sectionKey','business_details','required',true)))$$,
  'a section-based branching form saves');

select is((select group_name from form_fields where field_key='individual_name'),'individual_details','a field records its section');
select is((select dropdown_master_type from form_fields where field_key='customer_type'),'p113_customer_type','a dropdown question references the master list');
select is((select options from form_fields where field_key='customer_type'),null,'a Dropdown Master question stores no copy of the options');

select throws_ok($$select save_form_draft_with_audit(null,
  jsonb_build_object('name','P113 Backwards','permissions',jsonb_build_object('roles',jsonb_build_array('admin')),
    'sections', jsonb_build_array(jsonb_build_object('key','a','title','A'),jsonb_build_object('key','b','title','B'))),
  jsonb_build_array(jsonb_build_object('key','q','label','Q','type','select','sectionKey','b',
    'options', jsonb_build_array(jsonb_build_object('value','y','label','Yes')),
    'branches', jsonb_build_array(jsonb_build_object('operator','equals','value','y','targetSectionKey','a')))))$$,
  '22023',NULL,'a branch may not point back at an earlier section');

select throws_ok($$select save_form_draft_with_audit(null,
  jsonb_build_object('name','P113 Ghost','permissions',jsonb_build_object('roles',jsonb_build_array('admin')),
    'sections', jsonb_build_array(jsonb_build_object('key','a','title','A'),jsonb_build_object('key','b','title','B'))),
  jsonb_build_array(jsonb_build_object('key','q','label','Q','type','select','sectionKey','a',
    'options', jsonb_build_array(jsonb_build_object('value','y','label','Yes')),
    'branches', jsonb_build_array(jsonb_build_object('operator','equals','value','deleted','targetSectionKey','b')))))$$,
  '22023',NULL,'a branch may not reference an option that does not exist');

select throws_ok($$select save_form_draft_with_audit(null,
  jsonb_build_object('name','P113 Copy','permissions',jsonb_build_object('roles',jsonb_build_array('admin')),
    'sections', jsonb_build_array(jsonb_build_object('key','a','title','A'))),
  jsonb_build_array(jsonb_build_object('key','q','label','Q','type','select','sectionKey','a',
    'optionSource', jsonb_build_object('kind','master','masterType','p113_customer_type'),
    'options', jsonb_build_array(jsonb_build_object('value','individual','label','Individual')))))$$,
  '22023',NULL,'Dropdown Master options may not be copied into the form');

select lives_ok($$select publish_form_with_audit((select id from form_templates where name='P113 Customer Onboarding'))$$,'a branching form publishes');

-- Filling it ---------------------------------------------------------------
select lives_ok($$select submit_form_with_audit(
  (select id from form_templates where name='P113 Customer Onboarding' and lifecycle='published'),
  '{"customer_type":"individual","individual_name":"Synthetic Person"}'::jsonb)$$,
  'the branch that was taken submits without the other branch fields');

select is((select data from form_submissions order by submitted_at desc limit 1),
  '{"customer_type": "individual", "individual_name": "Synthetic Person"}'::jsonb,
  'answers from an unreachable section are not stored');

select lives_ok($$select submit_form_with_audit(
  (select id from form_templates where name='P113 Customer Onboarding' and lifecycle='published'),
  '{"customer_type":"individual","individual_name":"Synthetic Person","company_name":"Ignored"}'::jsonb)$$,
  'a hidden required field never blocks submission');

select throws_ok($$select submit_form_with_audit(
  (select id from form_templates where name='P113 Customer Onboarding' and lifecycle='published'),
  '{"customer_type":"business"}'::jsonb)$$,
  '23514',NULL,'a required field inside the branch that was taken is still enforced');

select throws_ok($$select submit_form_with_audit(
  (select id from form_templates where name='P113 Customer Onboarding' and lifecycle='published'),
  '{"customer_type":"partner"}'::jsonb)$$,
  '22023',NULL,'an answer outside the referenced Dropdown Master list is rejected');

-- Creating a Dropdown Master list from the Form Builder ---------------------
select lives_ok($$select create_dropdown_list_with_audit('p113_lead_source',
  jsonb_build_array(jsonb_build_object('value','instagram','label','Instagram')))$$,
  'a form author can publish a new Dropdown Master list');
select is((select count(*)::int from dropdown_masters where master_type='p113_lead_source'),1,'the new list lands in Dropdown Master');
select throws_ok($$select create_dropdown_list_with_audit('p113_customer_type',
  jsonb_build_array(jsonb_build_object('value','x','label','X')))$$,
  '23505',NULL,'an existing Dropdown Master list is never silently replaced');

select * from finish();
rollback;
