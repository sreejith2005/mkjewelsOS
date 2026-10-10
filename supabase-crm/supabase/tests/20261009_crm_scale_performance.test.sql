begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','browse_crm_followups',array['text','jsonb','integer','integer']);
select has_function('public','read_crm_followup_history',array['text','uuid','integer','integer']);
select has_function('public','crm_dashboard_summary',array['timestamp with time zone','timestamp with time zone','date']);
select has_function('public','get_walkin_queue_page',array['uuid','text','uuid','text','integer','integer']);
select has_function('public','browse_crm_records_page',array['jsonb','integer','integer']);
insert into branches(id,name) values('20261009-0001-4000-8000-00000000000a','Scale Home'),('20261009-0001-4000-8000-00000000000b','Scale Other');
insert into users(id,name,email,role,branch_id,active) values
('20261009-0001-4000-8000-000000000001','Scale Staff','scale-staff@example.invalid','salesperson','20261009-0001-4000-8000-00000000000a',true),
('20261009-0001-4000-8000-000000000002','Scale Admin','scale-admin@example.invalid','super_admin',null,true),
('20261009-0001-4000-8000-000000000003','Scale Inactive','scale-inactive@example.invalid','salesperson','20261009-0001-4000-8000-00000000000a',false);
insert into crm_sso_access_grants(jewelos_user_id,work_email,legacy_crm_user_id,crm_auth_user_id,active) select id,email,id,id,true from users where id::text like '20261009-0001-4000-8000-00000000000_';
insert into clients(client_id,primary_name,primary_phone,last_branch_id) values('20261009-0001-4000-8000-000000000010','Scale Client','919900000010','20261009-0001-4000-8000-00000000000a');
insert into crm_allocation(branch_id,crm_name,crm_user_id,active) values('20261009-0001-4000-8000-00000000000a','Scale Staff','20261009-0001-4000-8000-000000000001',true);
\ir fixtures/crm_master_options.sql
-- Bulk queue rows do not add a contact. Avoid recomputing the same client's unchanged
-- projection 1,201 times in the fixture; ordinary source writes are tested below.
alter table not_bought_followups disable trigger zz_client_browse_state;
insert into not_bought_followups(id,client_id,reference_number,status,next_followup_date,entered_by,branch_id,created_at)
select ('20261009-0001-4000-9000-'||lpad(n::text,12,'0'))::uuid,'20261009-0001-4000-8000-000000000010','SCALE-'||n,case when n%3=0 then 'FOLLOW UP DONE' when n%3=1 then 'PENDING' else 'HISTORICAL' end,
case when n%3=0 then null else current_date-1 end,'20261009-0001-4000-8000-000000000001','20261009-0001-4000-8000-00000000000b',now()-n*interval '1 minute' from generate_series(1,1201) n;
alter table not_bought_followups enable trigger zz_client_browse_state;
set local role authenticated;
select set_config('request.jwt.claim.sub','20261009-0001-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is((browse_crm_followups('not_bought','{"tab":"pending"}',0,500)->>'total')::integer,801,'all matching work counted beyond REST cap');
select is(jsonb_array_length(browse_crm_followups('not_bought','{"tab":"pending"}',0,500)->'rows'),50,'server enforces bounded page even with larger requested limit');
select is((browse_crm_followups('not_bought','{}')->'counts'->>'today')::integer,401,'historical is pending but not due today');
select is((browse_crm_followups('not_bought','{}')->'counts'->>'done')::integer,400,'done tab keeps UI status semantics');
select is((browse_crm_followups('not_bought','{"tab":"pending","search":"SCALE-1201"}')->>'total')::integer,1,'search finds records beyond first 1000');
select is((browse_crm_followups('not_bought','{"tab":"pending","branch":"20261009-0001-4000-8000-00000000000a"}')->>'total')::integer,0,'branch filter is applied before counting/paging');
select isnt(browse_crm_followups('not_bought','{"tab":"pending","sort":"newest"}',0,50)->'rows'->0->>'id',browse_crm_followups('not_bought','{"tab":"pending","sort":"newest"}',50,50)->'rows'->0->>'id','next page reaches different records');
select throws_ok($$select browse_crm_followups('bad')$$,'22023','invalid queue kind','invalid kind rejected');
reset role;
insert into not_bought_history(followup_id,status,remark,created_at,updated_by)
select '20261009-0001-4000-9000-000000000001','PENDING','CALL '||n,now()-n*interval '1 second','20261009-0001-4000-8000-000000000001' from generate_series(1,105) n;
set local role authenticated;
select is((read_crm_followup_history('not_bought','20261009-0001-4000-9000-000000000001')->>'total')::integer,105,'history total retains all calls');
select is(jsonb_array_length(read_crm_followup_history('not_bought','20261009-0001-4000-9000-000000000001',0,500)->'rows'),100,'history page is bounded');
select is(jsonb_array_length(read_crm_followup_history('not_bought','20261009-0001-4000-9000-000000000001',100,100)->'rows'),5,'older history remains reachable');
select is((read_crm_followup_history('not_bought','20261009-0001-4000-9000-000000000004')->>'total')::integer,105,'legacy client fallback retained when reference has no history');
select ok((select latest_interaction_at is not null from crm_client_activity_summary where client_id='20261009-0001-4000-8000-000000000010'),'history contact updates projection');
select ok(not exists(
 select 1 from (select client_id,min(occurred_at) as first,max(occurred_at) filter(where is_contact and occurred_at<=statement_timestamp()) as latest from crm_client_activity where client_id='20261009-0001-4000-8000-000000000010' group by client_id) a
 join crm_client_activity_summary s using(client_id) where a.first is distinct from s.first_recorded_at or a.latest is distinct from s.latest_interaction_at),'projected timestamps match visible original evidence');
select is((browse_crm_records_page('{"search":"Scale Client"}')->>'total')::integer,1,'thin browse applies filters before counting');
select is(browse_crm_records_page('{"search":"Scale Client"}')->'rows'->0->>'primary_phone','919900000010','thin page hydrates saved listing fields after selecting IDs');
select throws_ok($$update crm_client_browse_state set latest_interaction_at=now()$$,'42501',null,'clients cannot mutate derived projection directly');
reset role;
-- Test refreshes on a mutable source; immutable follow-up evidence remains intact.
insert into clients(client_id,primary_name,primary_phone) values('20261009-0001-4000-8000-000000000011','Projection Client','919900000011');
insert into crm_contacts(id,client_id,kind,channel,note,actor_id,branch_id,occurred_at,request_key) values(
'20261009-0001-4000-8000-000000000012','20261009-0001-4000-8000-000000000011','CALL','PHONE','Synthetic future contact','20261009-0001-4000-8000-000000000001','20261009-0001-4000-8000-00000000000a',now()+interval '1 day',gen_random_uuid());
set local role authenticated;
select is((select latest_interaction_at from crm_client_activity_summary where client_id='20261009-0001-4000-8000-000000000011'),null::timestamptz,'future dated contact is excluded from latest until eligible');
reset role;
update crm_contacts set occurred_at=now()-interval '1 minute' where id='20261009-0001-4000-8000-000000000012';
-- Simulate the projection at the moment a formerly future contact becomes eligible.
-- The summary must see it even when no new source write refreshes that projection.
update crm_client_browse_state set latest_interaction_at=null,next_future_contact_at=now()-interval '1 minute' where client_id='20261009-0001-4000-8000-000000000011';
set local role authenticated;
select ok((select latest_interaction_at is not null from crm_client_activity_summary where client_id='20261009-0001-4000-8000-000000000011'),'formerly future contact becomes visible without a projection refresh');
reset role;
delete from crm_contacts where id='20261009-0001-4000-8000-000000000012';
set local role authenticated;
select is((select latest_interaction_at from crm_client_activity_summary where client_id='20261009-0001-4000-8000-000000000011'),null::timestamptz,'deleting a mutable source refreshes metadata instead of retaining a stale contact');
reset role;
insert into entry_queue(branch_id,token,client_name,mobile,status,client_id,created_at) values('20261009-0001-4000-8000-00000000000b','SCALE-PRIVATE','Scale Client','919900000010','WAITING','20261009-0001-4000-8000-000000000010','2000-01-01');
insert into entry_queue(branch_id,token,client_name,mobile,status,client_id)
select '20261009-0001-4000-8000-00000000000a','SCALE-PAGE-'||n,'Scale Client','919900000010','pending','20261009-0001-4000-8000-000000000010' from generate_series(1,55)n;
set local role authenticated;
select is((get_walkin_queue_page()->>'total_count')::integer,55,'walk-in queue reports every pending entry');
select is(jsonb_array_length(get_walkin_queue_page()->'items'),50,'walk-in queue page is bounded');
select is(jsonb_array_length(get_walkin_queue_page(p_offset=>50)->'items'),5,'older pending entries stay reachable');
select is((get_walkin_queue_page(p_branch_id=>'20261009-0001-4000-8000-00000000000b')->>'selected_branch_id')::uuid,'20261009-0001-4000-8000-00000000000a'::uuid,'ordinary queue reader cannot select another branch');
select ok((select first_recorded_at>'2000-01-01'::timestamptz from crm_client_activity_summary where client_id='20261009-0001-4000-8000-000000000010'),'branch-private queue does not widen browse metadata');
select set_config('request.jwt.claim.sub','20261009-0001-4000-8000-000000000002',true);
select is((select first_recorded_at from crm_client_activity_summary where client_id='20261009-0001-4000-8000-000000000010'),'2000-01-01'::timestamptz,'admin metadata includes visible queue history');
select set_config('request.jwt.claim.sub','20261009-0001-4000-8000-000000000003',true);
select throws_ok($$select browse_crm_followups('not_bought')$$,'42501','active CRM profile required','inactive queue access denied');
select throws_ok($$select read_crm_followup_history('not_bought','20261009-0001-4000-9000-000000000001')$$,'42501','active CRM profile required','inactive history denied');
select throws_ok($$select crm_dashboard_summary()$$,'42501','active CRM profile required','inactive dashboard denied');
select throws_ok($$select get_walkin_queue_page()$$,'42501','active CRM profile required','inactive walk-in page denied');
select is((browse_crm_records_page('{}')->>'total')::integer,0,'inactive thin client browse denied');
select is((select count(*)::integer from crm_client_browse_state),0,'inactive projection RLS denied');
set local role anon;
select throws_ok($$select browse_crm_followups('not_bought')$$,'42501',null,'anonymous queue RPC denied');
select throws_ok($$select read_crm_followup_history('not_bought','20261009-0001-4000-9000-000000000001')$$,'42501',null,'anonymous history RPC denied');
select throws_ok($$select crm_dashboard_summary()$$,'42501',null,'anonymous dashboard RPC denied');
select throws_ok($$select get_walkin_queue_page()$$,'42501',null,'anonymous walk-in page denied');
select throws_ok($$select browse_crm_records_page('{}')$$,'42501',null,'anonymous thin client browse denied');
select throws_ok($$select * from crm_client_browse_state$$,'42501',null,'anonymous projection denied');
set local role service_role;
select throws_ok($$select browse_crm_followups('not_bought')$$,'42501',null,'service cannot invoke employee queue read');
select * from finish();
rollback;
