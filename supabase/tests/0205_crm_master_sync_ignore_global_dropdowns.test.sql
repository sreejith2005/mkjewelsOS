begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into tenants(id,name,slug) values ('20261009-0205-4000-8000-000000000001','Global master tenant','global-master-test');
delete from crm_sync.outbox where event_type='master.options_changed' and aggregate_id='20261009-0205-4000-8000-000000000001';
create function pg_temp.open_master_events() returns integer language sql as $$
 select count(*)::integer from crm_sync.outbox where event_type='master.options_changed' and delivered_at is null and dead_at is null
$$;
create temp table baseline as select pg_temp.open_master_events() n;

select lives_ok($$insert into dropdown_masters(id,tenant_id,master_type,label,value,sort_order,is_active)
 values('20261009-0205-4000-8000-000000000101',null,'gender','Global gender','global_gender',1,true)$$,'a global dropdown insert succeeds');
select lives_ok($$update dropdown_masters set label='Global gender renamed' where id='20261009-0205-4000-8000-000000000101'$$,'a global dropdown update succeeds');
select is(pg_temp.open_master_events(),(select n from baseline),'global dropdown writes enqueue no CRM master event');

update dropdown_masters set tenant_id='20261009-0205-4000-8000-000000000001' where id='20261009-0205-4000-8000-000000000101';
select is((select count(*)::integer from crm_sync.outbox where event_type='master.options_changed' and aggregate_id='20261009-0205-4000-8000-000000000001' and delivered_at is null),1,
 'moving a global row into a tenant enqueues that tenant');
delete from crm_sync.outbox where event_type='master.options_changed' and aggregate_id='20261009-0205-4000-8000-000000000001';
update dropdown_masters set tenant_id=null where id='20261009-0205-4000-8000-000000000101';
select is((select count(*)::integer from crm_sync.outbox where event_type='master.options_changed' and aggregate_id='20261009-0205-4000-8000-000000000001' and delivered_at is null),1,
 'moving a tenant row to global enqueues the tenant it left');

select lives_ok($$delete from dropdown_masters where id='20261009-0205-4000-8000-000000000101'$$,'a global dropdown delete succeeds');
select ok(not has_function_privilege('authenticated','crm_sync.master_changed()','execute'),'the trigger function stays private');

select * from finish();
rollback;
