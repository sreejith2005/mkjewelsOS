begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('crm_sync','master_snapshot',array['uuid'],'CRM masters use JewelOS source snapshots');
select has_function('crm_sync','enqueue_master',array['uuid'],'master changes have a durable outbox');
insert into tenants(id,name,slug) values
 ('20261008-7777-4000-8000-000000000001','Master tenant A','master-test-a'),
 ('20261008-7777-4000-8000-000000000002','Master tenant B','master-test-b');
insert into dropdown_master_categories(tenant_id,category_key,display_name,is_active) values
 ('20261008-7777-4000-8000-000000000001','sugar_option','Sugar',true);
insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active) values
 ('20261008-7777-4000-8000-000000000001','sugar_option','No Sugar','no_sugar',20,true),
 ('20261008-7777-4000-8000-000000000001','sugar_option','Low Sugar','low_sugar',10,true),
 ('20261008-7777-4000-8000-000000000001','unrelated_list','Private internal choice','internal',1,true),
 ('20261008-7777-4000-8000-000000000002','sugar_option','Other tenant sugar','other',1,true);
select is((select count(*)::integer from crm_sync.outbox where event_type='master.options_changed' and aggregate_id='20261008-7777-4000-8000-000000000001' and delivered_at is null),1,'master changes coalesce by tenant');
select is(jsonb_array_length(crm_sync.master_snapshot('20261008-7777-4000-8000-000000000001')->'options'),2,'snapshot excludes other tenants and unrelated masters');
select is(crm_sync.master_snapshot('20261008-7777-4000-8000-000000000001')->'options'->0->>'label','Low Sugar','snapshot preserves explicit master order');
select ok(not (crm_sync.master_snapshot('20261008-7777-4000-8000-000000000001')::text like '%Private internal%'),'unrelated master contents never leave JewelOS');
update dropdown_master_categories set is_active=false where tenant_id='20261008-7777-4000-8000-000000000001' and category_key='sugar_option';
select is(crm_sync.master_snapshot('20261008-7777-4000-8000-000000000001')->'options'->0->>'active','false','category deactivation reaches CRM');
select ok(not has_function_privilege('authenticated','crm_sync.master_snapshot(uuid)','execute'),'browser cannot read private cross-tenant snapshots');
select ok(not has_function_privilege('anon','crm_sync.enqueue_master(uuid)','execute'),'anonymous caller cannot enqueue a sync');
select ok(not has_function_privilege('service_role','crm_sync.master_snapshot(uuid)','execute'),'worker only uses protected claim contract');
create temp table claimed(event_id bigint,event_type text,aggregate_id uuid,snapshot jsonb);
grant all on claimed to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
insert into claimed select * from public.crm_sync_claim_staff_events(200);
select is((select snapshot->>'tenant_id' from claimed where aggregate_id='20261008-7777-4000-8000-000000000001' and event_type='master.options_changed'),'20261008-7777-4000-8000-000000000001','existing worker claims master snapshots');
reset role;
-- A master change during an in-flight delivery must be requeued, not lost.
update dropdown_masters set label='Renamed Sugar' where tenant_id='20261008-7777-4000-8000-000000000001' and value='no_sugar';
set local role service_role;
select is(public.crm_sync_finish_staff_event((select event_id from claimed where aggregate_id='20261008-7777-4000-8000-000000000001' and event_type='master.options_changed'),true,null),'requeued','in-flight master changes survive delivery acknowledgement');
reset role;
select * from finish();
rollback;
