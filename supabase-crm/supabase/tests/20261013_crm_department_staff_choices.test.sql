begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into branches(id,name) values('20261013-0000-4000-8000-000000000001','Choice branch'),('20261013-0000-4000-8000-000000000002','Other branch');
insert into users(id,name,email,role,branch_id,active) values
 ('20261013-0000-4000-8000-000000000011','Synthetic sales','choice-sales@example.invalid','salesperson','20261013-0000-4000-8000-000000000001',true),
 ('20261013-0000-4000-8000-000000000012','Synthetic CRM','choice-crm@example.invalid','salesperson','20261013-0000-4000-8000-000000000001',true),
 ('20261013-0000-4000-8000-000000000013','Synthetic other','choice-other@example.invalid','super_admin',null,true),
 ('20261013-0000-4000-8000-000000000014','Inactive seller','choice-inactive@example.invalid','salesperson','20261013-0000-4000-8000-000000000001',false);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id,active)
select id,email,id,id,true from users where id in ('20261013-0000-4000-8000-000000000011','20261013-0000-4000-8000-000000000012','20261013-0000-4000-8000-000000000013','20261013-0000-4000-8000-000000000014');
insert into crm_private.staff_sync_state(jewelos_user_id,snapshot_at,outcome,crm_user_id,selection_department)
select id,now(),'applied',id,case when id in ('20261013-0000-4000-8000-000000000011','20261013-0000-4000-8000-000000000014') then 'sales' when id='20261013-0000-4000-8000-000000000012' then 'crm' else 'other' end
from users where id in ('20261013-0000-4000-8000-000000000011','20261013-0000-4000-8000-000000000012','20261013-0000-4000-8000-000000000013','20261013-0000-4000-8000-000000000014');
\ir fixtures/crm_master_options.psql
set local role authenticated;
select set_config('request.jwt.claim.sub','20261013-0000-4000-8000-000000000012',true);
select set_config('request.jwt.claim.role','authenticated',true);
reset role;
insert into crm_allocation(branch_id,crm_name,crm_user_id,active) values
 ('20261013-0000-4000-8000-000000000001','SYNTHETIC CRM','20261013-0000-4000-8000-000000000012',true),
 ('20261013-0000-4000-8000-000000000001','SYNTHETIC SALES','20261013-0000-4000-8000-000000000011',true);
insert into crm_allocation(branch_id,crm_name,crm_user_id,active) values
 ('20261013-0000-4000-8000-000000000002','SYNTHETIC CRM','20261013-0000-4000-8000-000000000012',true);
set local role authenticated;
select is((select count(*)::int from get_walkin_crm_roster() where branch_id='20261013-0000-4000-8000-000000000002' and crm_user_id='20261013-0000-4000-8000-000000000012'),1,'company-wide CRM team still appears outside its home branch');
select is((select count(*)::int from get_walkin_crm_roster() where branch_id='20261013-0000-4000-8000-000000000001'),1,'CRM choices exclude Sales even if allocation was stale');
select is((get_walkin_queue_page('20261013-0000-4000-8000-000000000001'))->'allocation','[{"crm_name":"SYNTHETIC CRM"}]'::jsonb,'queue reads the same department-filtered roster');
select is((select count(*)::int from get_walkin_salespeople() where branch_id='20261013-0000-4000-8000-000000000001'),1,'only active Sales department staff returned');
select is((select count(*)::int from get_walkin_salespeople() where salesperson_id in ('20261013-0000-4000-8000-000000000012','20261013-0000-4000-8000-000000000013')),0,'CRM and privileged users excluded from Sales choices');
select throws_ok($$select * from submit_walkin_visit('{"branch_id":"20261013-0000-4000-8000-000000000001","salesperson":"Synthetic CRM","salesperson_id":"20261013-0000-4000-8000-000000000012"}'::jsonb)$$,'23514',null,'direct visit API cannot choose a non-Sales employee as salesperson');
select is((select count(*)::int from get_walkin_salespeople() where salesperson_id='20261013-0000-4000-8000-000000000011' and branch_id='20261013-0000-4000-8000-000000000002'),0,'seller cannot appear in unrelated branch');
select throws_ok($$select selection_department from crm_private.staff_sync_state$$,'42501',null,'client cannot read private department sync state');
reset role;
update crm_sso_access_grants set active=false where legacy_crm_user_id='20261013-0000-4000-8000-000000000011';
set local role authenticated;
select is((select count(*)::int from get_walkin_salespeople() where salesperson_id='20261013-0000-4000-8000-000000000011'),0,'revoked CRM access removes salesperson');
select set_config('request.jwt.claim.sub','20261013-0000-4000-8000-000000000014',true);
select throws_ok($$select * from get_walkin_salespeople()$$,'42501',null,'inactive actor denied');
reset role;
select ok(not has_function_privilege('anon','public.get_walkin_salespeople()','execute'),'anonymous staff read denied');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$select crm_apply_staff_snapshot('choice-metadata-test',jsonb_build_object('jewelos_user_id','20261013-0000-4000-8000-000000000099','snapshot_at',now(),'present',false,'eligible',false,'selection_department','sales'))$$,'service sync records department atomically');
reset role;
select is((select selection_department from crm_private.staff_sync_state where jewelos_user_id='20261013-0000-4000-8000-000000000099'),'sales','department stored through real sync RPC');
select * from finish();
rollback;
