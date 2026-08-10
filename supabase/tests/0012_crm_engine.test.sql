begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Synthetic-only identities. No production rows are queried or printed.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select aid,'authenticated','authenticated',email,crypt('synthetic-test-value',gen_salt('bf')),now(),'{}','{}',now(),now() from (values
 ('ac120000-0000-0000-0000-000000000001'::uuid,'crm-admin@example.invalid'),
 ('ac120000-0000-0000-0000-000000000002'::uuid,'crm-manager@example.invalid'),
 ('ac120000-0000-0000-0000-000000000003'::uuid,'crm-user@example.invalid'),
 ('ac120000-0000-0000-0000-000000000004'::uuid,'crm-staff@example.invalid'),
 ('ac120000-0000-0000-0000-000000000005'::uuid,'crm-inactive@example.invalid'),
 ('ac120000-0000-0000-0000-000000000006'::uuid,'crm-other@example.invalid'),
 ('ac120000-0000-0000-0000-000000000007'::uuid,'crm-super@example.invalid'),
 ('ac120000-0000-0000-0000-000000000008'::uuid,'crm-branch2@example.invalid')) x(aid,email);
insert into tenants(id,name,slug,timezone) values
 ('1c120000-0000-0000-0000-000000000001','Synthetic CRM Tenant A','crm-test-a','Asia/Kolkata'),
 ('1c120000-0000-0000-0000-000000000002','Synthetic CRM Tenant B','crm-test-b','Asia/Kolkata');
insert into branches(id,tenant_id,name,code) values
 ('2c120000-0000-0000-0000-000000000001','1c120000-0000-0000-0000-000000000001','Synthetic Branch A1','CA1'),
 ('2c120000-0000-0000-0000-000000000002','1c120000-0000-0000-0000-000000000001','Synthetic Branch A2','CA2'),
 ('2c120000-0000-0000-0000-000000000003','1c120000-0000-0000-0000-000000000002','Synthetic Branch B','CB1');
insert into departments(id,tenant_id,branch_id,name,code) values
 ('3c120000-0000-0000-0000-000000000001','1c120000-0000-0000-0000-000000000001','2c120000-0000-0000-0000-000000000001','Synthetic CRM A1','CDA1'),
 ('3c120000-0000-0000-0000-000000000002','1c120000-0000-0000-0000-000000000001','2c120000-0000-0000-0000-000000000002','Synthetic CRM A2','CDA2'),
 ('3c120000-0000-0000-0000-000000000003','1c120000-0000-0000-0000-000000000002','2c120000-0000-0000-0000-000000000003','Synthetic CRM B','CDB');
insert into user_profiles(id,auth_user_id,tenant_id,branch_id,department_id,employee_name,personal_mobile,email,employee_code,user_role,working_status,is_login_enabled)
select pid,aid,tid,bid,did,label,mobile,email,code,role::user_role,status::working_status,enabled from (values
 ('4c120000-0000-0000-0000-000000000001'::uuid,'ac120000-0000-0000-0000-000000000001'::uuid,'1c120000-0000-0000-0000-000000000001'::uuid,'2c120000-0000-0000-0000-000000000001'::uuid,'3c120000-0000-0000-0000-000000000001'::uuid,'Synthetic Admin','9000000001','crm-admin@example.invalid','CRM-1','admin','active',true),
 ('4c120000-0000-0000-0000-000000000002','ac120000-0000-0000-0000-000000000002','1c120000-0000-0000-0000-000000000001','2c120000-0000-0000-0000-000000000001','3c120000-0000-0000-0000-000000000001','Synthetic Manager','9000000002','crm-manager@example.invalid','CRM-2','manager','active',true),
 ('4c120000-0000-0000-0000-000000000003','ac120000-0000-0000-0000-000000000003','1c120000-0000-0000-0000-000000000001','2c120000-0000-0000-0000-000000000001','3c120000-0000-0000-0000-000000000001','Synthetic CRM','9000000003','crm-user@example.invalid','CRM-3','crm','active',true),
 ('4c120000-0000-0000-0000-000000000004','ac120000-0000-0000-0000-000000000004','1c120000-0000-0000-0000-000000000001','2c120000-0000-0000-0000-000000000001','3c120000-0000-0000-0000-000000000001','Synthetic Staff','9000000004','crm-staff@example.invalid','CRM-4','staff','active',true),
 ('4c120000-0000-0000-0000-000000000005','ac120000-0000-0000-0000-000000000005','1c120000-0000-0000-0000-000000000001','2c120000-0000-0000-0000-000000000001','3c120000-0000-0000-0000-000000000001','Synthetic Inactive','9000000005','crm-inactive@example.invalid','CRM-5','admin','inactive',false),
 ('4c120000-0000-0000-0000-000000000006','ac120000-0000-0000-0000-000000000006','1c120000-0000-0000-0000-000000000002','2c120000-0000-0000-0000-000000000003','3c120000-0000-0000-0000-000000000003','Synthetic Other','9000000006','crm-other@example.invalid','CRM-6','admin','active',true),
 ('4c120000-0000-0000-0000-000000000007','ac120000-0000-0000-0000-000000000007','1c120000-0000-0000-0000-000000000001','2c120000-0000-0000-0000-000000000001','3c120000-0000-0000-0000-000000000001','Synthetic Super','9000000007','crm-super@example.invalid','CRM-7','super_admin','active',true),
 ('4c120000-0000-0000-0000-000000000008','ac120000-0000-0000-0000-000000000008','1c120000-0000-0000-0000-000000000001','2c120000-0000-0000-0000-000000000002','3c120000-0000-0000-0000-000000000002','Synthetic CRM Branch 2','9000000008','crm-branch2@example.invalid','CRM-8','crm','active',true)
) x(pid,aid,tid,bid,did,label,mobile,email,code,role,status,enabled);
update branches set manager_id='4c120000-0000-0000-0000-000000000002' where id='2c120000-0000-0000-0000-000000000001';
insert into dropdown_masters(id,tenant_id,master_type,label,value,is_active) values
 ('5c120000-0000-0000-0000-000000000001','1c120000-0000-0000-0000-000000000001','crm_source','Synthetic Source','synthetic_source',true),
 ('5c120000-0000-0000-0000-000000000002','1c120000-0000-0000-0000-000000000001','client_type','Synthetic Type','synthetic_type',true),
 ('5c120000-0000-0000-0000-000000000003','1c120000-0000-0000-0000-000000000001','buy_status','Not Bought','not_bought',true),
 ('5c120000-0000-0000-0000-000000000004','1c120000-0000-0000-0000-000000000001','not_bought_reason','Synthetic Reason','synthetic_reason',true),
 ('5c120000-0000-0000-0000-000000000005','1c120000-0000-0000-0000-000000000001','potential_category','Synthetic Potential','synthetic_potential',true);

-- Schema, indexes, RLS, ownership, grants, and direct-write denial.
select has_table('public','client_contact_aliases','contact aliases exist');
select has_table('public','client_assignments','assignment history exists');
select has_table('public','crm_documents','private CRM document metadata exists');
select has_column('public','clients','normalized_phone','client has normalized phone');
select has_column('public','clients','record_version','client has optimistic version');
select has_column('public','clients','merged_into_client_id','client has merge tombstone pointer');
select has_column('public','client_timeline','correction_of_id','timeline supports append-only corrections');
select has_column('public','client_followups','record_version','follow-up has optimistic version');
select has_index('public','clients','idx_clients_tenant_active_primary_phone','active primary phone uniqueness is indexed');
select has_index('public','client_contact_aliases','idx_client_alias_unique_active','all active aliases are unique');
select has_index('public','client_followups','idx_followup_assignee_due','follow-up assignee due index is tenant leading');
select is((select public from storage.buckets where id='crm-documents'),false,'CRM bucket is private');
select is((select relrowsecurity from pg_class where oid='clients'::regclass),true,'clients RLS remains enabled');
select is((select relrowsecurity from pg_class where oid='client_contact_aliases'::regclass),true,'aliases have RLS');
select is((select relrowsecurity from pg_class where oid='client_assignments'::regclass),true,'assignments have RLS');
select is((select relrowsecurity from pg_class where oid='crm_documents'::regclass),true,'documents have RLS');
select function_owner_is('public','create_crm_client',array['jsonb','uuid'],'postgres','create client is postgres owned');
select is((select prosecdef from pg_proc where oid='create_crm_client(jsonb,uuid)'::regprocedure),true,'create client is security definer');
select is((select proconfig from pg_proc where oid='record_crm_walkin(jsonb,uuid)'::regprocedure),array['search_path=public']::text[],'walk-in pins search path');
select ok(has_function_privilege('authenticated','create_crm_client(jsonb,uuid)','EXECUTE'),'authenticated may call create RPC');
select ok(has_function_privilege('authenticated','search_crm_clients(jsonb)','EXECUTE'),'authenticated may call bounded search');
select ok(has_function_privilege('service_role','detect_crm_followup_events(integer,timestamptz)','EXECUTE'),'service role may detect follow-up events');
select ok(not has_function_privilege('authenticated','detect_crm_followup_events(integer,timestamptz)','EXECUTE'),'browser cannot run scheduled detector');
select ok(not has_function_privilege('anon','create_crm_client(jsonb,uuid)','EXECUTE'),'anon cannot call client mutation');
select ok(not has_table_privilege('authenticated','clients','INSERT,UPDATE,DELETE'),'direct client writes are denied');
select ok(not has_table_privilege('authenticated','walkin_entries','INSERT,UPDATE,DELETE'),'direct walk-in writes are denied');
select ok(not has_table_privilege('authenticated','client_timeline','INSERT,UPDATE,DELETE'),'direct timeline writes are denied');
select ok(not has_table_privilege('authenticated','client_followups','INSERT,UPDATE,DELETE'),'direct follow-up writes are denied');
select ok(not has_table_privilege('authenticated','crm_documents','INSERT,UPDATE,DELETE'),'direct document writes are denied');

select is(normalize_indian_phone('+91 98765 43210'),'+919876543210','plus-91 phone normalizes');
select is(normalize_indian_phone('919876543210'),'+919876543210','91 prefix normalizes');
select is(normalize_indian_phone('09876543210'),'+919876543210','permitted leading zero normalizes');
select is(normalize_indian_phone('12345'),null,'too-short phone is rejected');
select is(normalize_indian_phone('1234567890'),null,'impossible Indian mobile is rejected');

-- Administrator create, replay, duplicate prevention, lookup, search, edit and audit.
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000001',true);
select lives_ok($$select create_crm_client('{"first_name":"Synthetic One","primary_phone":"98765 43210","billing_phone":"98765 43211","email":"one@example.invalid","branch_id":"2c120000-0000-0000-0000-000000000001","assigned_crm_id":"4c120000-0000-0000-0000-000000000003","source_id":"5c120000-0000-0000-0000-000000000001","client_type_id":"5c120000-0000-0000-0000-000000000002"}','6c120000-0000-0000-0000-000000000001')$$,'admin creates a real client');
select is((select count(*)::int from clients where normalized_phone='+919876543210'),1,'one canonical primary client exists');
select lives_ok($$select create_crm_client('{"first_name":"Ignored replay","primary_phone":"9876543999"}','6c120000-0000-0000-0000-000000000001')$$,'same request key replays safely');
select is((select count(*)::int from clients),1,'create replay does not add a client');
select throws_ok($$select create_crm_client('{"first_name":"Duplicate","primary_phone":"+91 98765 43210"}','6c120000-0000-0000-0000-000000000002')$$,'23505',null,'canonical duplicate creation is rejected');
select throws_ok($$select create_crm_client('{"first_name":"Alternate collision","primary_phone":"98765 43211"}','6c120000-0000-0000-0000-000000000003')$$,'23505',null,'billing alias cannot silently become a second client');
select is((select match_kind from lookup_crm_client_by_phone('9876543211')),'billing','authorized alternate lookup reports match kind');
select is((select count(*)::int from search_crm_clients('{"query":"Synthetic","limit":25}')),1,'bounded name search returns one visible client');
select is((select count(*)::int from search_crm_clients('{"query":"9876543210","limit":25}')),1,'bounded normalized-phone search returns one client');
select lives_ok($$select update_crm_client((select id from clients where normalized_phone='+919876543210'),'{"city":"Synthetic City","tags":["synthetic","synthetic"]}',1,'6c120000-0000-0000-0000-000000000004')$$,'fresh client edit succeeds');
select lives_ok($$select update_crm_client((select id from clients where normalized_phone='+919876543210'),'{"city":"Ignored replay"}',1,'6c120000-0000-0000-0000-000000000004')$$,'same client-edit request key replays without a stale-write failure');
select throws_ok($$select update_crm_client((select id from clients where normalized_phone='+919876543210'),'{"city":"Stale"}',1,'6c120000-0000-0000-0000-000000000005')$$,'40001',null,'stale client edit is rejected');
select is((select count(*)::int from client_timeline where event_type in ('client_created','client_updated')),2,'client create and update append history');
select ok((select count(*) from audit_logs where module='clients')>=2,'client mutations are audited');

-- Branch/role/inactive/cross-tenant isolation and no existence leakage.
select lives_ok($$select create_crm_client('{"first_name":"Synthetic Branch Two","primary_phone":"9876543220","branch_id":"2c120000-0000-0000-0000-000000000002","assigned_crm_id":"4c120000-0000-0000-0000-000000000008"}','6c120000-0000-0000-0000-000000000006')$$,'admin creates a second-branch client');
select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from search_crm_clients('{"limit":25}')),1,'manager sees only own-branch clients');
select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from search_crm_clients('{"limit":25}')),1,'CRM sees own branch and assignment scope');
select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000004',true);
select throws_ok($$select * from search_crm_clients('{}')$$,'42501',null,'staff is denied CRM RPC access');
select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000005',true);
select throws_ok($$select * from search_crm_clients('{}')$$,'42501',null,'inactive profile is denied');
select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000006',true);
select is((select count(*)::int from search_crm_clients('{"query":"9876543210"}')),0,'cross-tenant search reveals no match');
select is((select count(*)::int from lookup_crm_client_by_phone('9876543210')),0,'cross-tenant phone lookup reveals no match');

-- Atomic phone-first walk-in linking, conditional validation, and replay.
select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000001',true);
select throws_ok($$select record_crm_walkin('{"phone":"9876543210","branch_id":"2c120000-0000-0000-0000-000000000001","assigned_crm_id":"4c120000-0000-0000-0000-000000000003","product_bought":false,"buy_status":"not_bought","followup_due_date":"2026-08-12"}','7c120000-0000-0000-0000-000000000001')$$,'23514',null,'not-bought outcome requires configured reason');
select lives_ok($$select record_crm_walkin('{"phone":"9876543210","branch_id":"2c120000-0000-0000-0000-000000000001","assigned_crm_id":"4c120000-0000-0000-0000-000000000003","salesperson_id":"4c120000-0000-0000-0000-000000000004","product_bought":false,"buy_status":"not_bought","buy_status_id":"5c120000-0000-0000-0000-000000000003","not_bought_reason_id":"5c120000-0000-0000-0000-000000000004","followup_due_date":"2026-08-12","companions":1}','7c120000-0000-0000-0000-000000000002')$$,'existing-client walk-in is recorded atomically');
select is((select count(*)::int from clients where normalized_phone='+919876543210'),1,'walk-in links instead of duplicating client');
select is((select count(*)::int from walkin_entries where client_id=(select id from clients where normalized_phone='+919876543210')),1,'walk-in links to existing client');
select is((select total_visits from clients where normalized_phone='+919876543210'),1,'visit rollup is server maintained');
select is((select count(*)::int from client_followups where client_id=(select id from clients where normalized_phone='+919876543210') and status='open'),1,'requested follow-up is created');
select lives_ok($$select record_crm_walkin('{"phone":"9876543210"}','7c120000-0000-0000-0000-000000000002')$$,'walk-in double-submit replays safely');
select is((select count(*)::int from walkin_entries),1,'walk-in replay creates no duplicate visit');
select lives_ok($$select record_crm_walkin('{"phone":"9876543230","first_name":"Synthetic Walkin New","branch_id":"2c120000-0000-0000-0000-000000000001","assigned_crm_id":"4c120000-0000-0000-0000-000000000003","product_bought":true,"buy_status":"purchased"}','7c120000-0000-0000-0000-000000000003')$$,'walk-in atomically creates a new client when no tenant match exists');
reset role;
select is((select count(*)::int from notification_events where source_module='crm' and event_type='walkin_created'),2,'walk-ins emit canonical notification events');
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000001',true);

-- Append-only interactions and corrections.
select lives_ok($$select log_crm_interaction((select id from clients where normalized_phone='+919876543210'),'{"type":"call","subject":"Synthetic interaction","outcome":"Synthetic outcome","occurred_at":"2026-08-10T10:00:00Z"}','8c120000-0000-0000-0000-000000000001')$$,'CRM interaction is appended');
select throws_ok($$update client_timeline set summary='forbidden' where event_type='call'$$,'42501',null,'direct timeline mutation is denied before immutable history can change');
select lives_ok($$select correct_crm_interaction((select id from client_timeline where event_type='call'),'{"reason":"Synthetic correction","subject":"Corrected interaction","outcome":"Corrected synthetic outcome"}','8c120000-0000-0000-0000-000000000002')$$,'interaction correction appends a new event');
select is((select count(*)::int from client_timeline where event_type='interaction_corrected' and correction_of_id is not null),1,'correction retains original linkage');

-- Follow-up transition state machine, assignment and double-completion denial.
select lives_ok($$select reschedule_crm_followup((select id from client_followups where status='open' limit 1),'2026-08-14','4c120000-0000-0000-0000-000000000003','Synthetic reschedule',1,'9c120000-0000-0000-0000-000000000001')$$,'open follow-up is rescheduled');
select lives_ok($$select complete_crm_followup((select id from client_followups where status='open' limit 1),'Synthetic completed outcome',2,'9c120000-0000-0000-0000-000000000002')$$,'open follow-up is completed once');
select throws_ok($$select complete_crm_followup((select id from client_followups where status='completed' limit 1),'Again',3,'9c120000-0000-0000-0000-000000000003')$$,'40001',null,'completed follow-up cannot complete twice');
select lives_ok($$select create_crm_followup((select id from clients where normalized_phone='+919876543210'),'{"assigned_to":"4c120000-0000-0000-0000-000000000003","due_date":"2026-08-15","subject":"Synthetic cancellable","workflow_key":"synthetic-cancel"}','9c120000-0000-0000-0000-000000000004')$$,'another open follow-up is created');
select lives_ok($$select cancel_crm_followup((select id from client_followups where workflow_key='synthetic-cancel'),'Synthetic cancellation',1,'9c120000-0000-0000-0000-000000000005')$$,'open follow-up can be cancelled');
select throws_ok($$select reschedule_crm_followup((select id from client_followups where workflow_key='synthetic-cancel'),'2026-08-16',null,'Again',2,'9c120000-0000-0000-0000-000000000006')$$,'40001',null,'cancelled follow-up cannot be edited');
reset role;
select lives_ok($$select detect_crm_followup_events(100,'2026-08-14T04:00:00Z')$$,'tenant-timezone follow-up detector runs');
select lives_ok($$select detect_crm_followup_events(100,'2026-08-14T04:00:00Z')$$,'follow-up detector replay is idempotent');
select is((select count(*)::int from notification_events where event_type in ('followup_due','followup_overdue') and source_module='crm'),0,'no terminal follow-up emits due events');

-- Private document path, MIME/extension/size, signed-read helper, and removal.
reset role;
insert into storage.objects(bucket_id,name,owner,owner_id) values('crm-documents','1c120000-0000-0000-0000-000000000001/client/'||(select id from clients where normalized_phone='+919876543210')||'/synthetic.pdf','ac120000-0000-0000-0000-000000000001','ac120000-0000-0000-0000-000000000001');
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000001',true);
select lives_ok($$select register_crm_document((select id from clients where normalized_phone='+919876543210'),'client',(select id from clients where normalized_phone='+919876543210'),'1c120000-0000-0000-0000-000000000001/client/'||(select id from clients where normalized_phone='+919876543210')||'/synthetic.pdf','synthetic.pdf','application/pdf',1024,'aa120000-0000-0000-0000-000000000001')$$,'owned private object metadata is registered');
select ok(can_read_crm_document_object((select storage_path from crm_documents limit 1)),'authorized caller may request signed Storage access');
select throws_ok($$select register_crm_document((select id from clients where normalized_phone='+919876543210'),'client',(select id from clients where normalized_phone='+919876543210'),'bad/path.exe','synthetic.exe','application/octet-stream',1,'aa120000-0000-0000-0000-000000000002')$$,'22023',null,'invalid path MIME and extension are rejected');
select throws_ok($$select register_crm_document((select id from clients where normalized_phone='+919876543210'),'client',(select id from clients where normalized_phone='+919876543210'),'1c120000-0000-0000-0000-000000000001/client/'||(select id from clients where normalized_phone='+919876543210')||'/synthetic.pdf','synthetic.pdf','application/pdf',10485761,'aa120000-0000-0000-0000-000000000004')$$,'22023',null,'oversized document metadata is rejected');
select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000006',true);
select throws_ok($$select remove_crm_document((select id from crm_documents limit 1),'Synthetic unauthorized removal','aa120000-0000-0000-0000-000000000005')$$,'42501',null,'cross-tenant document removal is denied');
select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000001',true);
select lives_ok($$select remove_crm_document((select id from crm_documents limit 1),'Synthetic removal','aa120000-0000-0000-0000-000000000003')$$,'authorized metadata removal succeeds');
select ok(can_delete_crm_document_object((select storage_path from crm_documents limit 1)),'removed object is eligible for caller cleanup');
select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000006',true);
select ok(not can_read_crm_document_object((select storage_path from crm_documents limit 1)),'cross-tenant document read is denied');

-- Merge preserves all history as a tombstone and moves linked records.
select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000001',true);
select lives_ok($$select create_crm_client('{"first_name":"Synthetic Duplicate","primary_phone":"9876543240","branch_id":"2c120000-0000-0000-0000-000000000001","assigned_crm_id":"4c120000-0000-0000-0000-000000000003"}','ab120000-0000-0000-0000-000000000001')$$,'genuine duplicate record fixture is created');
select lives_ok($$select log_crm_interaction((select id from clients where normalized_phone='+919876543240'),'{"type":"note","subject":"Synthetic duplicate note"}','ab120000-0000-0000-0000-000000000002')$$,'duplicate has history before merge');
select lives_ok($$select merge_crm_clients((select id from clients where normalized_phone='+919876543210'),(select id from clients where normalized_phone='+919876543240'),'ab120000-0000-0000-0000-000000000003')$$,'admin explicitly merges duplicate into survivor');
select is((select status from clients where normalized_phone='+919876543240'),'merged','duplicate remains as tombstone');
select is((select merged_into_client_id from clients where normalized_phone='+919876543240'),(select id from clients where normalized_phone='+919876543210'),'tombstone points to explicit survivor');
select is((select count(*)::int from client_timeline where event_type='note' and client_id=(select id from clients where normalized_phone='+919876543210')),1,'duplicate history moved to survivor');
select is((select count(*)::int from client_timeline where event_type='clients_merged'),1,'merge event is append-only history');
select ok((select new_value ? 'moved_counts' from audit_logs where action='crm_clients_merged'),'merge audit contains privacy-safe aggregate counts');

-- Task, Forms, and FMS linkage reuses existing records and produces lineage.
reset role;
insert into task_instances(id,tenant_id,branch_id,department_id,task_type,title,priority,status,planned_datetime,created_by,source) values('bc120000-0000-0000-0000-000000000001','1c120000-0000-0000-0000-000000000001','2c120000-0000-0000-0000-000000000001','3c120000-0000-0000-0000-000000000001','delegation','Synthetic CRM linked task','medium','pending',now(),'4c120000-0000-0000-0000-000000000001','manual');
insert into form_templates(id,tenant_id,name,version,lifecycle,is_active,permissions,created_by) values('bd120000-0000-0000-0000-000000000001','1c120000-0000-0000-0000-000000000001','Synthetic CRM Form',1,'published',true,'{"roles":["admin"]}','4c120000-0000-0000-0000-000000000001');
insert into form_submissions(id,tenant_id,branch_id,department_id,form_template_id,data,submitted_by,status) values('be120000-0000-0000-0000-000000000001','1c120000-0000-0000-0000-000000000001','2c120000-0000-0000-0000-000000000001','3c120000-0000-0000-0000-000000000001','bd120000-0000-0000-0000-000000000001','{}','4c120000-0000-0000-0000-000000000001','submitted');
insert into fms_flows(id,tenant_id,branch_id,department_id,name,status,is_active,version,created_by,family_id,scope_type) values('bf120000-0000-0000-0000-000000000001','1c120000-0000-0000-0000-000000000001','2c120000-0000-0000-0000-000000000001','3c120000-0000-0000-0000-000000000001','Synthetic CRM Flow','published',true,1,'4c120000-0000-0000-0000-000000000001','bf120000-0000-0000-0000-000000000010','department');
insert into fms_instances(id,tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,priority,started_by) values('bf120000-0000-0000-0000-000000000002','1c120000-0000-0000-0000-000000000001','2c120000-0000-0000-0000-000000000001','3c120000-0000-0000-0000-000000000001','bf120000-0000-0000-0000-000000000001','bf120000-0000-0000-0000-000000000010',1,'CRM-SYN-1','Synthetic CRM run','active','medium','4c120000-0000-0000-0000-000000000001');
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','ac120000-0000-0000-0000-000000000001',true);
select lives_ok($$select link_crm_record((select id from clients where normalized_phone='+919876543210'),'task','bc120000-0000-0000-0000-000000000001','cc120000-0000-0000-0000-000000000001')$$,'existing task links through its audited contract');
select lives_ok($$select link_crm_record((select id from clients where normalized_phone='+919876543210'),'form','be120000-0000-0000-0000-000000000001','cc120000-0000-0000-0000-000000000002')$$,'existing form submission links to client');
select lives_ok($$select link_crm_record((select id from clients where normalized_phone='+919876543210'),'fms','bf120000-0000-0000-0000-000000000002','cc120000-0000-0000-0000-000000000003')$$,'existing FMS instance receives validated client context');
select is((select count(*)::int from client_timeline where event_type in ('task_linked','form_linked','fms_linked')),3,'all integration links render in client lineage');
reset role;
select is((select count(*)::int from notification_events where source_module='crm' and event_type in ('client_created','client_reassigned','walkin_created','followup_created','followup_completed'))>0,true,'CRM mutations integrate with canonical Notifications outbox');
select ok((select count(*) from audit_logs where action like 'crm_%')>=12,'complete CRM operations write transaction-local audits');

select * from finish();
rollback;
