begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','crm_apply_master_snapshot',array['text','jsonb'],'service-only master projection exists');
select has_function('public','get_crm_master_options',array[]::text[],'caller-scoped master lookup exists');
insert into branches(id,name) values('20261008-4444-4000-8000-000000000001','Master branch');
insert into users(id,name,email,role,branch_id,active) values
('20261008-4444-4000-8000-000000000002','Master staff','master@example.invalid','salesperson','20261008-4444-4000-8000-000000000001',true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id)
values('20261008-4444-4000-8000-000000000003','master@example.invalid','20261008-4444-4000-8000-000000000002','20261008-4444-4000-8000-000000000002');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($sql$select crm_apply_master_snapshot('master.test.1',jsonb_build_object(
 'tenant_id','20261008-4444-4000-8000-000000000004','snapshot_at',now()-interval '1 hour',
 'members',jsonb_build_array('20261008-4444-4000-8000-000000000003'),
 'options',jsonb_build_array(
 jsonb_build_object('id','20261008-4444-4000-8000-000000000005','master_type','sugar_option','label','No Sugar','value','no_sugar','sort_order',10,'active',true),
 jsonb_build_object('id','20261008-4444-4000-8000-000000000006','master_type','sugar_option','label','Old Sugar','value','old_sugar','sort_order',20,'active',false))))$sql$,'service sync applies master options');
select is(crm_apply_master_snapshot('master.test.1','{"members":[],"options":[],"tenant_id":"20261008-4444-4000-8000-000000000004","snapshot_at":"2026-01-01Z"}')->>'duplicate','true','repeated event does not rewrite options');
select is(crm_apply_master_snapshot('master.test.older','{"members":[],"options":[],"tenant_id":"20261008-4444-4000-8000-000000000004","snapshot_at":"2026-01-01Z"}')->>'outcome','stale','older snapshot cannot erase master values');
select throws_ok($sql$select crm_apply_master_snapshot('master.test.invalid',jsonb_set('{"members":[],"options":[{"master_type":"sugar_option","label":"No Sugar"}],"tenant_id":"20261008-4444-4000-8000-000000000004","snapshot_at":"2026-10-08T01:00:00Z"}'::jsonb,'{snapshot_at}',to_jsonb(now())))$sql$,'22023',null,'malformed snapshot rejected');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"20261008-4444-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','20261008-4444-4000-8000-000000000002',true);
set local role authenticated;
select is(get_crm_master_options()->'lookup_sugar_options','["NO SUGAR"]'::jsonb,'Sugar comes from active JewelOS master options');
select throws_ok($$select crm_apply_master_snapshot('client.bypass','{}')$$,'42501',null,'ordinary caller cannot apply master projections');
reset role;
insert into lead_form_fields(field_key,label,field_type,display_order,option_source) values('sugar','Sugar','dropdown',1,'lookup_sugar_options');
set local role authenticated;
select lives_ok($$select save_crm_lead('9199000991','Master lead','{"sugar":"NO SUGAR"}')$$,'lead accepts active master option');
select throws_ok($$select save_crm_lead('9199000992','Invalid choice','{"sugar":"Old Sugar"}')$$,'22023',null,'new lead cannot select inactive master value');
select throws_ok($$insert into leads(phone_number,name,created_by) values('9199000993','Bypass','20261008-4444-4000-8000-000000000002')$$,'42501',null,'direct API cannot bypass required lead validation');
select throws_ok($$update clients set sugar='OLD SUGAR' where primary_name='Master lead'$$,'22023',null,'profile API cannot select inactive master value');
select lives_ok($$update clients set address='Updated synthetic address' where primary_name='Master lead'$$,'unchanged saved choices survive unrelated profile edits');
reset role;
insert into lead_form_fields(id,field_key,label,field_type,display_order,is_mandatory) values
 ('20261008-4444-4000-8000-000000000010','status','Status','dropdown',2,false),
 ('20261008-4444-4000-8000-000000000011','source_of_lead','Source','text',3,true);
insert into lead_form_field_options(field_id,option_value,display_order,triggers_field_key) values
 ('20261008-4444-4000-8000-000000000010','LEAD',1,'source_of_lead');
insert into crm_private.master_options(tenant_id,option_id,master_type,label,value,sort_order,active) values
 ('20261008-4444-4000-8000-000000000004','20261008-4444-4000-8000-000000000012','lead_status','Prospect','lead',1,true);
set local role authenticated;
select is((select triggers_field_key from get_crm_lead_option_routes() where option_value='PROSPECT'),'source_of_lead','master rename preserves stable conditional route');
select ok(exists(select 1 from jsonb_array_elements(get_walkin_queue_snapshot()->'options') o where o->>'option_value'='PROSPECT' and o->>'triggers_field_key'='source_of_lead'),'opening registration route keeps renamed master conditionals');
select throws_ok($$select save_crm_lead('9199000994','Renamed route','{"status":"PROSPECT"}')$$,'22023',null,'renamed conditional question is required at the server');
select lives_ok($$select save_crm_lead('9199000994','Renamed route','{"status":"PROSPECT","source_of_lead":"Synthetic source"}')$$,'renamed conditional route saves its complete answers');
reset role;
update users set active=false where id='20261008-4444-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select get_crm_master_options()$$,'42501',null,'inactive caller cannot read master options');
reset role;
set local role anon;
select throws_ok($$select get_crm_master_options()$$,'42501',null,'anonymous master read denied');
reset role;
-- Tenant transfer/removal must keep a per-member timestamp tombstone.
update users set active=true where id='20261008-4444-4000-8000-000000000002';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($sql$select crm_apply_master_snapshot('master.test.transfer',jsonb_build_object('tenant_id','20261008-4444-4000-8000-000000000020','snapshot_at',now()-interval '30 minutes','members',jsonb_build_array('20261008-4444-4000-8000-000000000003'),'options','[]'::jsonb))$sql$,'newer tenant membership replaces earlier tenant');
select lives_ok($sql$select crm_apply_master_snapshot('master.test.remove',jsonb_build_object('tenant_id','20261008-4444-4000-8000-000000000020','snapshot_at',now()-interval '10 minutes','members','[]'::jsonb,'options','[]'::jsonb))$sql$,'member removal preserves ordering watermark');
select lives_ok($sql$select crm_apply_master_snapshot('master.test.delayed',jsonb_build_object('tenant_id','20261008-4444-4000-8000-000000000004','snapshot_at',now()-interval '50 minutes','members',jsonb_build_array('20261008-4444-4000-8000-000000000003'),'options','[]'::jsonb))$sql$,'delayed old tenant snapshot is safely processed');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"20261008-4444-4000-8000-000000000002"}',true);
set local role authenticated;
select throws_ok($$select get_crm_master_options()$$,'55000',null,'delayed snapshot cannot restore an old tenant membership');
reset role;
select * from finish();
rollback;
