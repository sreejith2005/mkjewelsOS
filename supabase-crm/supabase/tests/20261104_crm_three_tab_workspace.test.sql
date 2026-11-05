begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- CRM three-tab workspace (20261104000300): queue branch choices, roster per branch, same-day
-- duplicate guard, follow-up presets, referral identifiers and the operations summary.

insert into branches(id,name,jewelos_branch_id,active) values
('20261104-0300-4000-8000-00000000000a','Queue Branch A','20261104-0300-4000-8000-0000000000aa',true),
('20261104-0300-4000-8000-00000000000b','Queue Branch B','20261104-0300-4000-8000-0000000000bb',true);
insert into users(id,name,email,role,branch_id,active) values
('20261104-0300-4000-8000-000000000001','Queue Admin','queue-admin@example.invalid','super_admin',null,true),
('20261104-0300-4000-8000-000000000002','Queue Seller','queue-seller@example.invalid','salesperson','20261104-0300-4000-8000-00000000000a',true),
('20261104-0300-4000-8000-000000000003','Asha Crm','asha-crm@example.invalid','salesperson','20261104-0300-4000-8000-00000000000a',true),
('20261104-0300-4000-8000-000000000004','Bina Crm','bina-crm@example.invalid','salesperson','20261104-0300-4000-8000-00000000000b',true);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id,active) values
('20261104-0300-4000-8000-0000000000f1','queue-admin@example.invalid','20261104-0300-4000-8000-000000000001','20261104-0300-4000-8000-000000000001',true),
('20261104-0300-4000-8000-0000000000f2','queue-seller@example.invalid','20261104-0300-4000-8000-000000000002','20261104-0300-4000-8000-000000000002',true),
('20261104-0300-4000-8000-0000000000f3','asha-crm@example.invalid','20261104-0300-4000-8000-000000000003',null,true),
('20261104-0300-4000-8000-0000000000f4','bina-crm@example.invalid','20261104-0300-4000-8000-000000000004',null,true);
insert into crm_private.staff_sync_state(jewelos_user_id,snapshot_at,outcome,reason,crm_user_id,selection_department) values
('20261104-0300-4000-8000-0000000000f3',now(),'granted',null,'20261104-0300-4000-8000-000000000003','crm'),
('20261104-0300-4000-8000-0000000000f4',now(),'granted',null,'20261104-0300-4000-8000-000000000004','crm'),
('20261104-0300-4000-8000-0000000000f5',now(),'blocked','unmapped_branch',null,'crm'),
('20261104-0300-4000-8000-0000000000f2',now(),'granted',null,'20261104-0300-4000-8000-000000000002','sales');
\ir fixtures/crm_master_options.psql
-- The CRM department is on every branch roster (20261008000100); Bina is away today in branch A.
insert into crm_allocation(branch_id,crm_name,crm_user_id,active) values
('20261104-0300-4000-8000-00000000000a','ASHA CRM','20261104-0300-4000-8000-000000000003',true),
('20261104-0300-4000-8000-00000000000a','BINA CRM','20261104-0300-4000-8000-000000000004',true),
('20261104-0300-4000-8000-00000000000b','ASHA CRM','20261104-0300-4000-8000-000000000003',true),
('20261104-0300-4000-8000-00000000000b','BINA CRM','20261104-0300-4000-8000-000000000004',true);
insert into crm_daily_availability(branch_id,crm_name,date,is_available) values
('20261104-0300-4000-8000-00000000000a','BINA CRM',(now() at time zone 'Asia/Kolkata')::date,false);

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.role','authenticated',true), set_config('request.jwt.claim.sub',p_user::text,true),
         set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_user)::text,true);
$$;

-- Branch choices before Dropdown Master has a crm_branch list: every active branch, with a warning source.
set local role authenticated;
select pg_temp.as_user('20261104-0300-4000-8000-000000000001');
select is((public.get_walkin_branch_choices())->>'source','crm_branches','without a crm_branch list the CRM branches are used and labelled as such');
select ok(jsonb_array_length((public.get_walkin_branch_choices())->'branches')>=2,'and every active branch is offered');

-- Opening the queue with no branch in the address: the roster of every branch arrives at once.
select ok((public.get_walkin_queue_page(null,null,null,'active',0,50))->'roster_by_branch' ? '20261104-0300-4000-8000-00000000000a','the roster arrives for branch A without ?branch=');
select is((select jsonb_agg(p->>'crm_name' order by p->>'crm_name') from jsonb_array_elements((public.get_walkin_queue_page(null,null,null,'active',0,50))->'roster_by_branch'->'20261104-0300-4000-8000-00000000000b') p),
  '["ASHA CRM", "BINA CRM"]'::jsonb,'every CRM-department person is listed for branch B');
select is((select p->>'available' from jsonb_array_elements((public.get_walkin_queue_page(null,null,null,'active',0,50))->'roster_by_branch'->'20261104-0300-4000-8000-00000000000a') p where p->>'crm_name'='BINA CRM'),
  'false','a person away today stays listed, marked unavailable');
select is(((public.get_walkin_queue_page(null,null,null,'active',0,50))->'roster_health'->>'crm_department_people')::int,3,'managers see how many CRM-department people the sync knows');
select is(((public.get_walkin_queue_page(null,null,null,'active',0,50))->'roster_health'->'not_on_roster'->0->>'reason'),'unmapped_branch','and why one of them is not on the roster');
reset role;

-- Dropdown Master decides the choices: branch A only, renamed; a list entry with no CRM branch is an issue.
insert into crm_private.master_options(tenant_id,option_id,master_type,label,value,sort_order,active) values
('20261008-8888-4000-8000-000000000001',gen_random_uuid(),'crm_branch','MK Flagship','20261104-0300-4000-8000-0000000000aa',10,true),
('20261008-8888-4000-8000-000000000001',gen_random_uuid(),'crm_branch','MK Closed','20261104-0300-4000-8000-0000000000bb',20,false),
('20261008-8888-4000-8000-000000000001',gen_random_uuid(),'crm_branch','MK Future','20261104-0300-4000-8000-0000000000cc',30,true),
('20261008-8888-4000-8000-000000000001',gen_random_uuid(),'crm_branch','MK Typo','unmapped:XYZ',40,true);
set local role authenticated;
select pg_temp.as_user('20261104-0300-4000-8000-000000000001');
select is((public.get_walkin_branch_choices())->>'source','dropdown_master','the crm_branch list decides once it has arrived');
select is((public.get_walkin_branch_choices())->'branches','[{"id": "20261104-0300-4000-8000-00000000000a", "name": "MK Flagship", "jewelos_branch_id": "20261104-0300-4000-8000-0000000000aa"}]'::jsonb,
  'only active list entries are offered, with the Dropdown Master label and the stable CRM branch id');
select is(jsonb_array_length((public.get_walkin_branch_choices())->'issues'),2,'list entries without a CRM branch are reported, not offered');
select is((public.get_walkin_queue_page(null,null,null,'active',0,50))->>'selected_branch_id','20261104-0300-4000-8000-00000000000a','the only choice is selected when none is requested');
select is((public.get_walkin_queue_page('20261104-0300-4000-8000-00000000000b',null,null,'active',0,50))->>'selected_branch_id','20261104-0300-4000-8000-00000000000a','a branch deactivated in Dropdown Master cannot be selected');

-- An ordinary user sees only their own branch, no list issues and no roster health.
select pg_temp.as_user('20261104-0300-4000-8000-000000000002');
select is((select jsonb_agg(b->>'id') from jsonb_array_elements((public.get_walkin_branch_choices())->'branches') b),'["20261104-0300-4000-8000-00000000000a"]'::jsonb,'a salesperson is offered only their own branch');
select is((public.get_walkin_branch_choices())->'issues','[]'::jsonb,'and no list issues');
select ok((public.get_walkin_queue_page(null,null,null,'active',0,50))->'roster_health'='null'::jsonb,'and no roster health');

-- Same-day duplicate guard.
create temp table first_entry as select * from public.register_walkin_entry('Dup Client','+91 9100830001','20261104-0300-4000-8000-00000000000a');
create temp table second_entry as select * from public.register_walkin_entry('Dup Client again','+91 91008 30001','20261104-0300-4000-8000-00000000000a');
select is((select client_type from second_entry),'pending_duplicate','a second registration of the same phone today is reported as a duplicate');
select is((select id from second_entry),(select id from first_entry),'and returns the pending entry instead of a new one');
select is((select count(*)::int from entry_queue where crm_private.phone_key(mobile)=crm_private.phone_key('+91 9100830001')),1,'only one entry exists for that person');
-- Two people who share a phone keep separate entries: the explicit profile action is not swallowed.
reset role;
insert into clients(client_id,primary_name,primary_phone,last_branch_id) values('20261104-0300-4000-8000-000000000150','Shared Phone Sister','+919100830001','20261104-0300-4000-8000-00000000000a');
set local role authenticated;
select pg_temp.as_user('20261104-0300-4000-8000-000000000002');
select isnt((select client_type from create_entry_queue('Shared Phone Sister','+919100830001','20261104-0300-4000-8000-00000000000a',null,'20261104-0300-4000-8000-000000000150')),'pending_duplicate','a different profile on the same phone gets its own entry');
select is((select client_type from create_entry_queue('Dup Client','+919100830001','20261104-0300-4000-8000-00000000000a',null,(select client_id from first_entry))),'pending_duplicate','choosing the same profile again returns its pending entry');
reset role;
select is((select client_name from entry_queue where id=(select id from first_entry)),'Dup Client','the pending entry is not overwritten');
update entry_queue set status='complete' where id=(select id from first_entry);
set local role authenticated;
select pg_temp.as_user('20261104-0300-4000-8000-000000000002');
create temp table third_entry as select * from public.create_entry_queue('Dup Client','+91 9100830001','20261104-0300-4000-8000-00000000000a',null,(select client_id from first_entry));
select isnt((select client_type from third_entry),'pending_duplicate','once the earlier entry is complete, a later visit registers normally');
reset role;
select ok(exists(select 1 from crm_private.audit_logs a where a.action='crm.create_entry_queue_duplicate'),'the returned duplicate is audited');

-- Follow-up presets: overdue, purchase context, referral identifiers.
insert into clients(client_id,primary_name,primary_phone,last_branch_id) values
('20261104-0300-4000-8000-000000000101','Bought Before','+919100830101','20261104-0300-4000-8000-00000000000a'),
('20261104-0300-4000-8000-000000000102','Never Bought','+919100830102','20261104-0300-4000-8000-00000000000a');
insert into client_timeline(id,client_id,event_date,branch_id,salesperson_id,buy_status) values
('20261104-0300-4000-8000-000000000201','20261104-0300-4000-8000-000000000101',now()-interval '40 days','20261104-0300-4000-8000-00000000000a','20261104-0300-4000-8000-000000000002','YES'),
('20261104-0300-4000-8000-000000000202','20261104-0300-4000-8000-000000000101',now()-interval '5 days','20261104-0300-4000-8000-00000000000a','20261104-0300-4000-8000-000000000002','NO'),
('20261104-0300-4000-8000-000000000203','20261104-0300-4000-8000-000000000102',now()-interval '5 days','20261104-0300-4000-8000-00000000000a','20261104-0300-4000-8000-000000000002','NO');
alter table not_bought_followups disable trigger user;
insert into not_bought_followups(id,client_id,status,next_followup_date,entered_by,branch_id,source_timeline_id) values
('20261104-0300-4000-8000-000000000301','20261104-0300-4000-8000-000000000101','PENDING',(now() at time zone 'Asia/Kolkata')::date-2,'20261104-0300-4000-8000-000000000002','20261104-0300-4000-8000-00000000000a','20261104-0300-4000-8000-000000000202'),
('20261104-0300-4000-8000-000000000302','20261104-0300-4000-8000-000000000102','PENDING',(now() at time zone 'Asia/Kolkata')::date,'20261104-0300-4000-8000-000000000002','20261104-0300-4000-8000-00000000000a','20261104-0300-4000-8000-000000000203');
alter table not_bought_followups enable trigger user;
set local role authenticated;
select pg_temp.as_user('20261104-0300-4000-8000-000000000001');
select is(((public.browse_crm_followups('not_bought','{"tab":"overdue","branch":"20261104-0300-4000-8000-00000000000a"}',0,50))->'counts'->>'overdue')::int,1,'overdue counts cases due before today');
select is((select r->>'id' from jsonb_array_elements((public.browse_crm_followups('not_bought','{"tab":"overdue","branch":"20261104-0300-4000-8000-00000000000a"}',0,50))->'rows') r),
  '20261104-0300-4000-8000-000000000301','the overdue tab lists only that case');
select is((select r->'purchase_context'->>'bought_before' from jsonb_array_elements((public.browse_crm_followups('not_bought','{"tab":"pending","branch":"20261104-0300-4000-8000-00000000000a"}',0,50))->'rows') r where r->>'id'='20261104-0300-4000-8000-000000000301'),
  'true','a buyer with a later not-bought visit is marked as bought before');
select is((select r->'purchase_context'->>'bought_before' from jsonb_array_elements((public.browse_crm_followups('not_bought','{"tab":"pending","branch":"20261104-0300-4000-8000-00000000000a"}',0,50))->'rows') r where r->>'id'='20261104-0300-4000-8000-000000000302'),
  'false','a client who never bought is not');
reset role;

insert into referrals(id,salesperson_id,given_by_client_id,referral_name,referral_number,branch_id,relationship)
values('20261104-0300-4000-8000-000000000401','20261104-0300-4000-8000-000000000002','20261104-0300-4000-8000-000000000101','Referred Friend','+919100830401','20261104-0300-4000-8000-00000000000a','SISTER');
insert into referral_calling(referral_id,status) select '20261104-0300-4000-8000-000000000401','PENDING' where not exists(select 1 from referral_calling where referral_id='20261104-0300-4000-8000-000000000401');
set local role authenticated;
select pg_temp.as_user('20261104-0300-4000-8000-000000000001');
select is((select r->'referral_context'->>'relationship' from jsonb_array_elements((public.browse_crm_followups('referral','{"tab":"pending"}',0,50))->'rows') r where r->>'referral_name'='Referred Friend'),
  'SISTER','a referral row carries the recorded relationship');
select ok((select r->'referral_context'->>'given_by_client_code' from jsonb_array_elements((public.browse_crm_followups('referral','{"tab":"pending"}',0,50))->'rows') r where r->>'referral_name'='Referred Friend') like 'MKC-%','and the referrer client code');
select ok((select r->'referral_context'->>'given_by_household_code' from jsonb_array_elements((public.browse_crm_followups('referral','{"tab":"pending"}',0,50))->'rows') r where r->>'referral_name'='Referred Friend') like 'MKF-%','and the referrer household code');

-- Operations summary.
select is(((public.get_crm_operations_summary_v1('20261104-0300-4000-8000-00000000000a',null,null))->>'followups_overdue')::int,1,'the summary counts overdue cases');
select is(((public.get_crm_operations_summary_v1('20261104-0300-4000-8000-00000000000a',null,null))->>'followups_due_now')::int,2,'and cases due now: today or overdue, as the Due today tab shows');
select is(((public.get_crm_operations_summary_v1('20261104-0300-4000-8000-00000000000a',null,null))->>'followups_due_now')::int,
  ((public.browse_crm_followups('not_bought','{"tab":"today","branch":"20261104-0300-4000-8000-00000000000a"}',0,50))->'counts'->>'today')::int,'the dashboard count equals its drill-down count');
select is(((public.get_crm_operations_summary_v1('20261104-0300-4000-8000-00000000000a',null,null))->>'queue_pending')::int,(select count(*)::int from entry_queue where status='pending' and branch_id='20261104-0300-4000-8000-00000000000a'),'and the pending queue');
select throws_ok($$select public.get_crm_operations_summary_v1(null,'2026-01-10','2026-01-01')$$,'22023',null,'an inverted period is refused');
reset role;
set local role anon;
select throws_ok($$select public.get_crm_operations_summary_v1(null,null,null)$$,'42501',null,'anonymous readers are refused');
select throws_ok($$select public.get_walkin_branch_choices()$$,'42501',null,'anonymous readers cannot list branches');
reset role;

select * from finish();
rollback;
