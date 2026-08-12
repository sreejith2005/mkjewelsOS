begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(125);

-- Synthetic fixtures only. No production rows or personal information.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select auth_id,'authenticated','authenticated',email,crypt('synthetic-test-value',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
from (values
 ('a9000000-0000-0000-0000-000000000001'::uuid,'p4-super-a@example.invalid'),
 ('a9000000-0000-0000-0000-000000000002'::uuid,'p4-admin-a@example.invalid'),
 ('a9000000-0000-0000-0000-000000000003'::uuid,'p4-manager-a1@example.invalid'),
 ('a9000000-0000-0000-0000-000000000004'::uuid,'p4-manager-a2@example.invalid'),
 ('a9000000-0000-0000-0000-000000000005'::uuid,'p4-staff-a1@example.invalid'),
 ('a9000000-0000-0000-0000-000000000006'::uuid,'p4-doer-a1@example.invalid'),
 ('a9000000-0000-0000-0000-000000000007'::uuid,'p4-house-a1@example.invalid'),
 ('a9000000-0000-0000-0000-000000000008'::uuid,'p4-inactive@example.invalid'),
 ('a9000000-0000-0000-0000-000000000009'::uuid,'p4-admin-b@example.invalid')
) fixture(auth_id,email);

insert into tenants(id,name,slug) values
 ('19000000-0000-0000-0000-000000000001','Phase 4 Tenant A','phase4-a'),
 ('19000000-0000-0000-0000-000000000002','Phase 4 Tenant B','phase4-b');
insert into branches(id,tenant_id,name,code) values
 ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','Phase 4 Branch A1','P4A1'),
 ('29000000-0000-0000-0000-000000000002','19000000-0000-0000-0000-000000000001','Phase 4 Branch A2','P4A2'),
 ('29000000-0000-0000-0000-000000000003','19000000-0000-0000-0000-000000000002','Phase 4 Branch B1','P4B1');
insert into departments(id,tenant_id,branch_id,name,code) values
 ('39000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','Phase 4 Department A1','P4A1D'),
 ('39000000-0000-0000-0000-000000000002','19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000002','Phase 4 Department A2','P4A2D'),
 ('39000000-0000-0000-0000-000000000003','19000000-0000-0000-0000-000000000002','29000000-0000-0000-0000-000000000003','Phase 4 Department B1','P4B1D');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
select profile_id,auth_id,tenant_id,branch_id,department_id,label,mobile,email,code,role::user_role,status::working_status,login_enabled
from (values
 ('49000000-0000-0000-0000-000000000001'::uuid,'a9000000-0000-0000-0000-000000000001'::uuid,'19000000-0000-0000-0000-000000000001'::uuid,'29000000-0000-0000-0000-000000000001'::uuid,'39000000-0000-0000-0000-000000000001'::uuid,'Phase 4 Super A','0000000001','p4-super-a@example.invalid','P4-001','super_admin','active',true),
 ('49000000-0000-0000-0000-000000000002','a9000000-0000-0000-0000-000000000002','19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','Phase 4 Admin A','0000000002','p4-admin-a@example.invalid','P4-002','admin','active',true),
 ('49000000-0000-0000-0000-000000000003','a9000000-0000-0000-0000-000000000003','19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','Phase 4 Manager A1','0000000003','p4-manager-a1@example.invalid','P4-003','manager','active',true),
 ('49000000-0000-0000-0000-000000000004','a9000000-0000-0000-0000-000000000004','19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000002','39000000-0000-0000-0000-000000000002','Phase 4 Manager A2','0000000004','p4-manager-a2@example.invalid','P4-004','manager','active',true),
 ('49000000-0000-0000-0000-000000000005','a9000000-0000-0000-0000-000000000005','19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','Phase 4 Staff A1','0000000005','p4-staff-a1@example.invalid','P4-005','staff','active',true),
 ('49000000-0000-0000-0000-000000000006','a9000000-0000-0000-0000-000000000006','19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','Phase 4 Doer A1','0000000006','p4-doer-a1@example.invalid','P4-006','doer','active',true),
 ('49000000-0000-0000-0000-000000000007','a9000000-0000-0000-0000-000000000007','19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','Phase 4 Housekeeping A1','0000000007','p4-house-a1@example.invalid','P4-007','housekeeping','active',true),
 ('49000000-0000-0000-0000-000000000008','a9000000-0000-0000-0000-000000000008','19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','Phase 4 Inactive','0000000008','p4-inactive@example.invalid','P4-008','admin','inactive',false),
 ('49000000-0000-0000-0000-000000000009','a9000000-0000-0000-0000-000000000009','19000000-0000-0000-0000-000000000002','29000000-0000-0000-0000-000000000003','39000000-0000-0000-0000-000000000003','Phase 4 Admin B','0000000009','p4-admin-b@example.invalid','P4-009','admin','active',true)
) fixture(profile_id,auth_id,tenant_id,branch_id,department_id,label,mobile,email,code,role,status,login_enabled);

-- Schema, constraints, indexes, ownership, security-definer posture and exact grants.
select has_type('public','form_template_lifecycle','form lifecycle enum exists');
select has_type('public','form_submission_status','submission status enum exists');
select has_column('public','form_templates','family_id','templates have family id');
select has_column('public','form_templates','lifecycle','templates have lifecycle');
select has_column('public','form_templates','published_by','templates have publish actor');
select has_column('public','form_templates','archived_at','templates have archive timestamp');
select has_column('public','form_fields','field_key','fields have stable keys');
select has_column('public','form_fields','validation','fields have structured validation');
select has_column('public','form_submissions','status','submissions have review status');
select has_column('public','form_submissions','reviewed_by','submissions have reviewer');
select has_index('public','form_templates','idx_form_templates_family_version','family/version index exists');
select has_index('public','form_templates','idx_form_templates_one_draft','single-draft partial index exists');
select has_index('public','form_templates','idx_form_templates_one_published','single-published partial index exists');
select has_index('public','form_fields','idx_form_fields_template_sort','field policy/order index exists');
select has_index('public','form_submissions','idx_form_submissions_review_queue','review policy index exists');
select col_is_fk('public','form_templates','branch_id','template branch is a foreign key');
select col_is_fk('public','form_templates','department_id','template department is a foreign key');
select col_is_fk('public','form_submissions','reviewed_by','submission reviewer is a foreign key');

select function_owner_is('public','save_form_draft_with_audit',array['uuid','jsonb','jsonb'],'postgres','save RPC owner is postgres');
select function_owner_is('public','submit_form_with_audit',array['uuid','jsonb','text','uuid'],'postgres','submit RPC owner is postgres');
select is((select prosecdef from pg_proc where oid='save_form_draft_with_audit(uuid,jsonb,jsonb)'::regprocedure),true,'save RPC is security definer');
select is((select prosecdef from pg_proc where oid='submit_form_with_audit(uuid,jsonb,text,uuid)'::regprocedure),true,'submit RPC is security definer');
select is((select proconfig from pg_proc where oid='submit_form_with_audit(uuid,jsonb,text,uuid)'::regprocedure),array['search_path=public']::text[],'submit RPC pins search_path');
select is((select proconfig from pg_proc where oid='review_form_submission_with_audit(uuid,text,text)'::regprocedure),array['search_path=public']::text[],'review RPC pins search_path');

select ok(has_function_privilege('authenticated','save_form_draft_with_audit(uuid,jsonb,jsonb)','EXECUTE'),'authenticated can execute save RPC');
select ok(has_function_privilege('authenticated','create_form_revision_with_audit(uuid,jsonb)','EXECUTE'),'authenticated can execute revision RPC');
select ok(has_function_privilege('authenticated','publish_form_with_audit(uuid)','EXECUTE'),'authenticated can execute publish RPC');
select ok(has_function_privilege('authenticated','archive_form_with_audit(uuid)','EXECUTE'),'authenticated can execute archive RPC');
select ok(has_function_privilege('authenticated','submit_form_with_audit(uuid,jsonb,text,uuid)','EXECUTE'),'authenticated can execute submit RPC');
select ok(has_function_privilege('authenticated','review_form_submission_with_audit(uuid,text,text)','EXECUTE'),'authenticated can execute review RPC');
select ok(not has_function_privilege('anon','submit_form_with_audit(uuid,jsonb,text,uuid)','EXECUTE'),'anon cannot execute submit RPC');
select ok(not has_function_privilege('service_role','submit_form_with_audit(uuid,jsonb,text,uuid)','EXECUTE'),'service role cannot execute submit RPC');
select ok(not has_function_privilege('public','submit_form_with_audit(uuid,jsonb,text,uuid)','EXECUTE'),'PUBLIC cannot execute submit RPC');
select ok(not has_function_privilege('authenticated','normalize_form_fields(jsonb)','EXECUTE'),'authenticated cannot execute owner helper');
select ok(not has_table_privilege('authenticated','form_templates','INSERT,UPDATE,DELETE'),'authenticated cannot directly mutate templates');
select ok(not has_table_privilege('authenticated','form_fields','INSERT,UPDATE,DELETE'),'authenticated cannot directly mutate fields');
select ok(not has_table_privilege('authenticated','form_submissions','INSERT,UPDATE,DELETE'),'authenticated cannot directly mutate submissions');
select ok(not has_table_privilege('anon','form_templates','SELECT,INSERT,UPDATE,DELETE'),'anon has no template privileges');

-- Authoring matrix, validation, draft persistence and audit transactionality.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000002',true);
select lives_ok($$select save_form_draft_with_audit(null,
  '{"name":"Phase 4 Comprehensive","branch_id":"29000000-0000-0000-0000-000000000001","department_id":"39000000-0000-0000-0000-000000000001","permissions":{"roles":["manager","staff"]}}',
  '[
   {"key":"short_text","label":"Short text","type":"text","required":true,"validation":{"minLength":1,"maxLength":50}},
   {"key":"long_text","label":"Long text","type":"textarea"},
   {"key":"number_value","label":"Number","type":"number","validation":{"min":0,"max":100}},
   {"key":"currency_value","label":"Currency","type":"currency","validation":{"min":0}},
   {"key":"email_value","label":"Email","type":"email"},
   {"key":"phone_value","label":"Phone","type":"phone"},
   {"key":"date_value","label":"Date","type":"date"},
   {"key":"datetime_value","label":"Datetime","type":"datetime"},
   {"key":"select_value","label":"Select","type":"select","options":[" Show ","Hide"]},
   {"key":"multi_value","label":"Multi","type":"multiselect","options":["A","B"]},
   {"key":"radio_value","label":"Radio","type":"radio","options":["R1","R2"]},
   {"key":"confirmed","label":"Confirmed","type":"checkbox","required":true},
   {"key":"rating_value","label":"Rating","type":"rating"},
   {"key":"section","label":"Section","type":"section_header"},
   {"key":"divider","label":"Divider","type":"divider"},
   {"key":"user_value","label":"User","type":"user_dropdown"},
   {"key":"branch_value","label":"Branch","type":"branch_dropdown"},
   {"key":"department_value","label":"Department","type":"department_dropdown"},
   {"key":"conditional_value","label":"Conditional","type":"text","required":true,"condition":{"fieldKey":"select_value","operator":"equals","value":"Show"}}
  ]'::jsonb)$$,'admin creates a fully typed tenant-wide draft');
reset role;

select is((select lifecycle::text from form_templates where name='Phase 4 Comprehensive'),'draft','new form is a draft');
select is((select count(*)::int from form_fields where form_template_id=(select id from form_templates where name='Phase 4 Comprehensive')),19,'all supported fields are stored');
select is((select min(sort_order)::int from form_fields where form_template_id=(select id from form_templates where name='Phase 4 Comprehensive')),0,'field ordering starts at zero');
select is((select max(sort_order)::int from form_fields where form_template_id=(select id from form_templates where name='Phase 4 Comprehensive')),18,'field ordering is contiguous');
select is((select options from form_fields where form_template_id=(select id from form_templates where name='Phase 4 Comprehensive') and field_key='select_value'),'["Show", "Hide"]'::jsonb,'options are stored in canonical trimmed form');
select is((select count(*)::int from audit_logs where action='form_draft_created' and record_id=(select id from form_templates where name='Phase 4 Comprehensive')),1,'draft creation is audited transactionally');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000003',true);
select lives_ok($$select save_form_draft_with_audit(null,'{"name":"Manager Tenant Form","permissions":{"roles":["manager"]}}','[{"key":"answer","label":"Answer","type":"text"}]')$$,'manager creates tenant-wide draft');
select lives_ok($$select save_form_draft_with_audit(null,'{"name":"Manager Legacy Scope Ignored","branch_id":"29000000-0000-0000-0000-000000000002"}','[{"key":"answer","label":"Answer","type":"text"}]')$$,'legacy branch scope is ignored for a tenant-wide form');
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000005',true);
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Staff Denied"}','[]')$$,'42501',null,'staff cannot author forms');
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000008',true);
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Inactive Denied"}','[]')$$,'42501',null,'inactive profile cannot author forms');
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000002',true);
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Unknown","unknown":true}','[]')$$,'22023',null,'unknown draft payload keys are rejected');
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Bad Fields"}','[{"key":"same","label":"One","type":"text"},{"key":"same","label":"Two","type":"text"}]')$$,'22023',null,'duplicate field keys are rejected');
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Forward Dependency"}','[{"key":"first","label":"First","type":"text","condition":{"fieldKey":"later","operator":"equals","value":"x"}},{"key":"later","label":"Later","type":"text"}]')$$,'22023',null,'missing and forward dependencies are rejected');
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Bad Options"}','[{"key":"choice","label":"Choice","type":"select","options":["A","A"]}]')$$,'22023',null,'duplicate options are rejected');
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Canonical Duplicate Options"}','[{"key":"choice","label":"Choice","type":"select","options":["Option"," Option "]}]')$$,'22023',null,'options duplicated after trimming are rejected');
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Too Many Options"}',jsonb_build_array(jsonb_build_object('key','choice','label','Choice','type','select','options',(select jsonb_agg(n::text) from generate_series(1,101) n))))$$,'22023',null,'more than 100 options are rejected');
select throws_ok($$select save_form_draft_with_audit(null,'{"name":"Too Many Fields"}',(select jsonb_agg(jsonb_build_object('key','field_'||n,'label','Field '||n,'type','text')) from generate_series(1,101) n))$$,'22023',null,'more than 100 fields are rejected');
reset role;

-- Publish, immutable versions, deferred files, revisions, archival and audits.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000002',true);
select lives_ok($$select publish_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive'))$$,'admin publishes valid draft');
select is((select lifecycle::text from form_templates where name='Phase 4 Comprehensive'),'published','published lifecycle is stored');
select ok((select published_by is not null and published_at is not null from form_templates where name='Phase 4 Comprehensive'),'publishing actor and timestamp are derived');
select is((select count(*)::int from audit_logs where action='form_published' and record_id=(select id from form_templates where name='Phase 4 Comprehensive')),1,'publishing is audited');
select throws_ok($$update form_templates set name='Mutated' where name='Phase 4 Comprehensive'$$,'42501',null,'authenticated cannot mutate a published template directly');
select lives_ok($$select save_form_draft_with_audit(null,'{"name":"Deferred File","branch_id":"29000000-0000-0000-0000-000000000001"}','[{"key":"upload","label":"Upload","type":"file"}]')$$,'file field may be saved in a draft');
select throws_ok($$select publish_form_with_audit((select id from form_templates where name='Deferred File'))$$,'0A000',null,'publishing a file field fails clearly');
select lives_ok($$select create_form_revision_with_audit((select id from form_templates where name='Phase 4 Comprehensive'),'{}')$$,'published form creates a revision');
select is((select max(version)::int from form_templates where family_id=(select family_id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published')),2,'revision increments family version');
select throws_ok($$select create_form_revision_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{}')$$,'23505',null,'only one family draft is allowed');
select lives_ok($$select publish_form_with_audit((select id from form_templates where family_id=(select family_id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published') and lifecycle='draft'))$$,'publishing revision supersedes prior version');
reset role;
select is((select count(*)::int from form_templates where family_id=(select family_id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published') and lifecycle='published'),1,'family has one published version');
select is((select count(*)::int from form_templates where family_id=(select family_id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published') and lifecycle='archived'),1,'prior published version is archived');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000002',true);
select lives_ok($$select archive_form_with_audit((select id from form_templates where name='Manager Tenant Form'))$$,'admin archives a draft');
reset role;
select is((select lifecycle::text from form_templates where name='Manager Tenant Form'),'archived','archive lifecycle is stored');

-- Re-publish a fresh comprehensive form for submission checks (the family v2 is current).
-- Valid answers cover every answer-bearing Phase 4A type and hidden-answer stripping.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000005',true);
select lives_ok($$select submit_form_with_audit(
 (select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),
 '{"short_text":"ok","long_text":"notes","number_value":0,"currency_value":125.50,"email_value":"synthetic@example.invalid","phone_value":"+91 99999 99999","date_value":"2026-08-08","datetime_value":"2026-08-08T12:30:00+05:30","select_value":"Hide","multi_value":["A","B"],"radio_value":"R1","confirmed":true,"rating_value":5,"user_value":"49000000-0000-0000-0000-000000000005","branch_value":"29000000-0000-0000-0000-000000000001","department_value":"39000000-0000-0000-0000-000000000001","conditional_value":"must be stripped"}'::jsonb
 )$$,'staff submits all supported answer types');
reset role;
select is((select data->>'number_value' from form_submissions where submitted_by='49000000-0000-0000-0000-000000000005'),'0','numeric zero is retained');
select ok(not (select data ? 'conditional_value' from form_submissions where submitted_by='49000000-0000-0000-0000-000000000005'),'hidden answer is stripped consistently');
select is((select count(*)::int from audit_logs where action='form_submitted' and record_id=(select id from form_submissions where submitted_by='49000000-0000-0000-0000-000000000005')),1,'submission is audited transactionally');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000002',true);
select lives_ok($$select save_form_draft_with_audit(null,
  '{"name":"Required String Contract","branch_id":"29000000-0000-0000-0000-000000000001","department_id":"39000000-0000-0000-0000-000000000001"}',
  '[
   {"key":"text_value","label":"Text","type":"text","required":true},
   {"key":"email_value","label":"Email","type":"email","required":true},
   {"key":"phone_value","label":"Phone","type":"phone","required":true},
   {"key":"select_value","label":"Select","type":"select","required":true,"options":["Option"]},
   {"key":"date_value","label":"Date","type":"date","required":true},
   {"key":"datetime_value","label":"Datetime","type":"datetime","required":true},
   {"key":"user_value","label":"User","type":"user_dropdown","required":true},
   {"key":"branch_value","label":"Branch","type":"branch_dropdown","required":true},
   {"key":"department_value","label":"Department","type":"department_dropdown","required":true}
  ]'::jsonb)$$,'required string contract draft is valid');
select lives_ok($$select publish_form_with_audit((select id from form_templates where name='Required String Contract'))$$,'required string contract publishes');
select throws_ok(
  format(
    'select submit_form_with_audit(%L,%L::jsonb)',
    (select id from form_templates where name='Required String Contract' and lifecycle='published'),
    jsonb_build_object(
      'text_value','ok','email_value','synthetic@example.invalid','phone_value','+91 99999 99999','select_value','Option',
      'date_value','2024-02-29','datetime_value','2024-02-29T12:30:00Z','user_value','49000000-0000-0000-0000-000000000002',
      'branch_value','29000000-0000-0000-0000-000000000001','department_value','39000000-0000-0000-0000-000000000001'
    ) || jsonb_build_object(required_key,'   ')
  ),
  '23514',null,format('required %s rejects whitespace-only input',required_key)
)
from unnest(array['text_value','email_value','phone_value','select_value','date_value','datetime_value','user_value','branch_value','department_value']) required_key;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000005',true);
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"unknown":"x"}')$$,'22023',null,'unknown answer keys are rejected');
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"ok","select_value":"Bad","confirmed":true}')$$,'22023',null,'invalid options are rejected');
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"ok","select_value":"Hide","confirmed":false}')$$,'23514',null,'required checkbox must be true');
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"ok","select_value":" Show ","confirmed":true}')$$,'23514',null,'conditions use the earlier whitespace-normalized answer');
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"ok","number_value":"1","select_value":"Hide","confirmed":true}')$$,'22023',null,'numeric string shape is rejected');
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"ok","email_value":"bad","select_value":"Hide","confirmed":true}')$$,'22023',null,'invalid email is rejected');
select lives_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"leap","date_value":"2024-02-29","select_value":"Hide","confirmed":true}')$$,'valid leap-year calendar date is accepted');
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"ok","date_value":"2026-02-29","select_value":"Hide","confirmed":true}')$$,'22023',null,'non-leap February 29 is rejected');
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"ok","date_value":"2026-02-30","select_value":"Hide","confirmed":true}')$$,'22023',null,'impossible calendar date is rejected');
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),jsonb_build_object('short_text',repeat('x',70000),'select_value','Hide','confirmed',true))$$,'22023',null,'oversized answer payload is rejected');
reset role;

-- Task-linked authorization: exact version/module/tenant and active doer only.
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,planned_datetime,requires_form,form_template_id,created_by)
values
 ('59000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','checklist','Phase 4 Exact Task',now(),true,(select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'49000000-0000-0000-0000-000000000002'),
 ('59000000-0000-0000-0000-000000000002','19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','checklist','Phase 4 Arbitrary Task',now(),false,null,'49000000-0000-0000-0000-000000000002');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_active)
values('59000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000006','doer',true);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000006',true);
select is((select count(*)::int from form_templates where name='Phase 4 Comprehensive'),1,'doer reads exact form required by active task');
select lives_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"task","select_value":"Hide","confirmed":true}','checklist_task','59000000-0000-0000-0000-000000000001')$$,'active doer submits exact task form');
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"task","select_value":"Hide","confirmed":true}','delegation_task','59000000-0000-0000-0000-000000000001')$$,'42501',null,'wrong task module is denied');
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"task","select_value":"Hide","confirmed":true}','checklist_task','59000000-0000-0000-0000-000000000002')$$,'42501',null,'arbitrary task link is denied');
reset role;
update task_instances set status='completed' where id='59000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000006',true);
select is((select count(*)::int from form_templates where name='Phase 4 Comprehensive'),1,'completed task keeps historical access to its exact form version');
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"late","select_value":"Hide","confirmed":true}','checklist_task','59000000-0000-0000-0000-000000000001')$$,'23514',null,'completed task rejects a new linked submission');
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000007',true);
select is((select count(*)::int from form_templates where name='Phase 4 Comprehensive'),0,'housekeeping has no general Forms Library access');
select throws_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='published'),'{"short_text":"task","select_value":"Hide","confirmed":true}','checklist_task','59000000-0000-0000-0000-000000000001')$$,'42501',null,'nonparticipant housekeeping cannot submit task form');
reset role;
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_active)
values('59000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000007','doer',true);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000007',true);
select is((select count(*)::int from form_templates where name='Phase 4 Comprehensive'),1,'active housekeeping participant reads only the exact required form');
select is((select count(*)::int from form_submissions where linked_record_id='59000000-0000-0000-0000-000000000001'),1,'active task participant reads submissions attached to the task');
reset role;
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,planned_datetime,requires_form,form_template_id,created_by)
values('59000000-0000-0000-0000-000000000003','19000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','checklist','Phase 4 Historical Task',now(),true,
  (select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='archived'),'49000000-0000-0000-0000-000000000002');
insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_active)
values('59000000-0000-0000-0000-000000000003','49000000-0000-0000-0000-000000000006','doer',true);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000006',true);
select is((select count(*)::int from form_templates where name='Phase 4 Comprehensive' and lifecycle='archived'),1,'task participant reads the exact superseded version pinned by an existing task');
select lives_ok($$select submit_form_with_audit((select id from form_templates where name='Phase 4 Comprehensive' and lifecycle='archived'),'{"short_text":"historical task","select_value":"Hide","confirmed":true}','checklist_task','59000000-0000-0000-0000-000000000003')$$,'existing task remains submittable against its originally published version');
reset role;

-- Submission reads and review authorization.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from form_submissions where submitted_by='49000000-0000-0000-0000-000000000005' and data->>'short_text'='ok'),1,'submission owner reads own submission');
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from form_submissions where submitted_by='49000000-0000-0000-0000-000000000005'),0,'other-branch manager cannot read submission');
select throws_ok($$select review_form_submission_with_audit((select id from form_submissions where submitted_by='49000000-0000-0000-0000-000000000005' and data->>'short_text'='ok'),'approved','denied')$$,'42501',null,'other-branch manager cannot review submission');
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000003',true);
select lives_ok($$select review_form_submission_with_audit((select id from form_submissions where submitted_by='49000000-0000-0000-0000-000000000005' and data->>'short_text'='ok'),'approved','synthetic approved')$$,'own-branch manager reviews submission');
select throws_ok($$select review_form_submission_with_audit((select id from form_submissions where submitted_by='49000000-0000-0000-0000-000000000005' and data->>'short_text'='ok'),'rejected','second decision')$$,'42501',null,'reviewed submission cannot be silently moved again');
reset role;
select is((select status::text from form_submissions where submitted_by='49000000-0000-0000-0000-000000000005' and data->>'short_text'='ok'),'approved','review decision is stored');
select is((select count(*)::int from audit_logs where action='form_submission_approved' and record_id=(select id from form_submissions where submitted_by='49000000-0000-0000-0000-000000000005' and data->>'short_text'='ok')),1,'review is audited transactionally');

-- Cross-tenant and anonymous denial plus prior migration regressions.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000009',true);
select is((select count(*)::int from form_templates where name='Phase 4 Comprehensive'),0,'cross-tenant templates are hidden');
select is((select count(*)::int from form_submissions),0,'cross-tenant submissions are hidden');
reset role;
insert into form_templates(id,tenant_id,family_id,name,is_active) values
 ('69000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000002','69000000-0000-0000-0000-000000000001','Phase 4 Tenant B Form',true);
insert into form_fields(form_template_id,field_key,field_name,field_type,sort_order) values
 ('69000000-0000-0000-0000-000000000001','answer','Answer','text',0);
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,planned_datetime,requires_form,form_template_id,created_by) values
 ('69000000-0000-0000-0000-000000000002','19000000-0000-0000-0000-000000000002','29000000-0000-0000-0000-000000000003','39000000-0000-0000-0000-000000000003','checklist','Phase 4 Tenant B Task',now(),true,'69000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000009');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a9000000-0000-0000-0000-000000000006',true);
select throws_ok($$select submit_form_with_audit('69000000-0000-0000-0000-000000000001','{"answer":"x"}','checklist_task','69000000-0000-0000-0000-000000000002')$$,'42501',null,'cross-tenant task and form link is denied');
reset role;
set local role anon;
select throws_ok($$select * from form_templates$$,'42501',null,'anon cannot read forms');
select throws_ok($$select submit_form_with_audit(null,'{}')$$,'42501',null,'anon cannot execute submission RPC');
reset role;

select ok((select relrowsecurity from pg_class where oid='public.form_fields'::regclass),'migration 0008 form_fields RLS remains enabled');
select ok(not has_function_privilege('public','normalize_task_checklist(jsonb)','EXECUTE'),'migration 0006 owner-only helper remains denied to PUBLIC');
select ok(has_function_privilege('authenticated','update_task_with_audit(uuid,text,uuid,boolean,text)','EXECUTE'),'migration 0006 task RPC grant remains');
select ok(to_regclass('public.idx_form_submissions_task_completion') is not null,'migration 0005 exact task completion index remains');
select ok((select pg_get_functiondef('update_task_with_audit(uuid,text,uuid,boolean,text)'::regprocedure) like '%fs.form_template_id = v_old.form_template_id%'),'migration 0005 exact linked-form completion check remains');

select * from finish();
rollback;
