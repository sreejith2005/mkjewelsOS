begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);
select has_function('public','get_walkin_queue_snapshot',array['uuid','text','uuid'],'queue snapshot exists');
select has_function('public','register_walkin_entry',array['text','text','uuid'],'registration returns a committed row');
insert into public.branches(id,name) values
 ('20261008-0000-4000-8000-000000000001','Synthetic performance branch'),
 ('20261008-0000-4000-8000-000000000002','Synthetic other branch');
insert into auth.users(id,email) values
 ('20261008-0000-4000-8000-000000000003','perf-staff@example.test'),
 ('20261008-0000-4000-8000-000000000004','perf-admin@example.test'),
 ('20261008-0000-4000-8000-000000000005','perf-inactive@example.test');
insert into public.users(id,name,email,role,branch_id,active) values
 ('20261008-0000-4000-8000-000000000003','PERF STAFF','perf-staff@example.test','salesperson','20261008-0000-4000-8000-000000000001',true),
 ('20261008-0000-4000-8000-000000000004','PERF ADMIN','perf-admin@example.test','super_admin',null,true),
 ('20261008-0000-4000-8000-000000000005','PERF INACTIVE','perf-inactive@example.test','salesperson','20261008-0000-4000-8000-000000000001',false);
insert into public.crm_sso_access_grants(jewelos_user_id,legacy_crm_user_id,crm_auth_user_id,work_email,active) select id,id,id,email,true from public.users where id in ('20261008-0000-4000-8000-000000000003','20261008-0000-4000-8000-000000000004','20261008-0000-4000-8000-000000000005');
insert into public.crm_allocation(branch_id,crm_name,crm_user_id,active) values ('20261008-0000-4000-8000-000000000001','PERF STAFF','20261008-0000-4000-8000-000000000003',true);
create temp table saved as select null::uuid as id,null::text as client_code where false;
grant all on saved to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20261008-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.path','/rpc/register_walkin_entry',true);
insert into saved select id,client_code from public.register_walkin_entry('Synthetic saved client','+919100800001','20261008-0000-4000-8000-000000000001');
select is((select count(*)::int from saved),1,'ordinary branch staff receives committed row');
select is((select client_code like 'MKC-%' from saved),true,'client code returned without a second client lookup');
select is((public.get_walkin_queue_snapshot()->>'selected_branch_id'),'20261008-0000-4000-8000-000000000001','ordinary user uses own branch');
select is((public.get_walkin_queue_snapshot('20261008-0000-4000-8000-000000000002')->>'selected_branch_id'),'20261008-0000-4000-8000-000000000001','URL cannot choose another branch for staff');
select is(jsonb_array_length(public.get_walkin_queue_snapshot()->'items'),1,'saved row immediately visible');
select is((public.get_walkin_queue_snapshot()->'items'->0->>'id'),(select id::text from saved),'snapshot returns the durable queue id');
select is((select branch_id::text from public.register_walkin_entry('Scoped','+919100800002','20261008-0000-4000-8000-000000000002')),'20261008-0000-4000-8000-000000000001','cross branch parameter cannot write outside own branch');
reset role;
select is((select count(*)::int from crm_private.audit_logs where action='crm.create_entry_queue' and record_id=(select id from saved)),1,'original registration audit retained exactly once');
select is((select count(*)::int from crm_private.sync_outbox where aggregate_id=(select id from saved)),1,'walk-in task outbox retained');
-- A large completed history must not hide an older pending entry.
insert into public.entry_queue(token,client_name,mobile,branch_id,status,created_at)
select 'PERF-'||i,'Synthetic history','919100800099','20261008-0000-4000-8000-000000000001','complete',now()+i*interval '1 second' from generate_series(1,1005) i;
set local role authenticated;
select is(jsonb_array_length(public.get_walkin_queue_snapshot()->'items'),1002,'all pending plus bounded recent history');
select is((select count(*)::int from jsonb_array_elements(public.get_walkin_queue_snapshot()->'items') q where q->>'status'='pending'),2,'outstanding work survives the historical row cap');
select set_config('request.jwt.claim.sub','20261008-0000-4000-8000-000000000004',true);
select is(public.get_walkin_queue_snapshot()->>'selected_branch_id',null::text,'admin still explicitly chooses a branch');
select is(jsonb_array_length(public.get_walkin_queue_snapshot('20261008-0000-4000-8000-000000000001')->'items'),1002,'admin can read selected branch');
select set_config('request.jwt.claim.sub','20261008-0000-4000-8000-000000000005',true);
select throws_ok($$select public.get_walkin_queue_snapshot()$$,'42501',null,'inactive profile denied');
select throws_ok($$select * from public.register_walkin_entry('Denied','+919100800003',null)$$,'42501',null,'inactive registration denied');
reset role;
select ok(not has_function_privilege('anon','public.get_walkin_queue_snapshot(uuid,text,uuid)','EXECUTE'),'anonymous direct snapshot RPC denied');
select ok(not has_function_privilege('anon','public.register_walkin_entry(text,text,uuid)','EXECUTE'),'anonymous direct registration RPC denied');
select ok(not has_function_privilege('service_role','public.get_walkin_queue_snapshot(uuid,text,uuid)','EXECUTE'),'service role not granted employee UI RPC');
select ok(not has_function_privilege('service_role','public.register_walkin_entry(text,text,uuid)','EXECUTE'),'service role uses its existing sync contracts');
select ok((select not prosecdef from pg_proc where oid='public.get_walkin_queue_snapshot(uuid,text,uuid)'::regprocedure),'snapshot cannot bypass RLS');
select * from finish();
rollback;
