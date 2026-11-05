begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- CRM Branches in Dropdown Master (0378). Client runs are tested in 0374_fms_start_triggers.test.sql.
insert into tenants(id,name,slug) values('20261104-0378-4000-8000-000000000001','Branch master tenant','branch-master-test');
insert into branches(id,tenant_id,name,code,is_active) values
 ('20261104-0378-4000-8000-0000000000b1','20261104-0378-4000-8000-000000000001','Flagship','FLG',true),
 ('20261104-0378-4000-8000-0000000000b2','20261104-0378-4000-8000-000000000001','Closed store','CLS',false);
insert into dropdown_master_categories(tenant_id,category_key,display_name,is_active) values('20261104-0378-4000-8000-000000000001','crm_branch','CRM Branches',true);
insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active) values
 ('20261104-0378-4000-8000-000000000001','crm_branch','MK Flagship','flg',10,true),
 ('20261104-0378-4000-8000-000000000001','crm_branch','MK Closed','CLS',20,true),
 ('20261104-0378-4000-8000-000000000001','crm_branch','MK Typo','XYZ',30,true);

create function pg_temp.option(p_label text) returns jsonb language sql as $$
  select o from jsonb_array_elements(crm_sync.master_snapshot('20261104-0378-4000-8000-000000000001')->'options') o where o->>'label'=p_label
$$;
select is(pg_temp.option('MK Flagship')->>'value','20261104-0378-4000-8000-0000000000b1','a branch code travels as the stable branch id (codes match without case)');
select is(pg_temp.option('MK Closed')->>'value','unmapped:CLS','an inactive branch is not resolved');
select is(pg_temp.option('MK Typo')->>'value','unmapped:XYZ','an unknown code travels marked unmapped, never as a branch');
select is(pg_temp.option('MK Flagship')->>'master_type','crm_branch','the list keeps its key');
select ok(exists(select 1 from jsonb_array_elements(crm_sync.master_snapshot('20261104-0378-4000-8000-000000000001')->'options') o where o->>'master_type'='crm_branch'),'the list is part of the CRM snapshot');

-- Branch edits refresh CRM through the master outbox.
update crm_sync.outbox set delivered_at=now() where event_type='master.options_changed' and aggregate_id='20261104-0378-4000-8000-000000000001' and delivered_at is null;
update branches set name='Flagship renamed' where id='20261104-0378-4000-8000-0000000000b1';
select is((select count(*)::int from crm_sync.outbox where event_type='master.options_changed' and aggregate_id='20261104-0378-4000-8000-000000000001' and delivered_at is null),1,'renaming a branch queues a CRM refresh');
update crm_sync.outbox set delivered_at=now() where event_type='master.options_changed' and aggregate_id='20261104-0378-4000-8000-000000000001' and delivered_at is null;
update branches set address='New road' where id='20261104-0378-4000-8000-0000000000b1';
select is((select count(*)::int from crm_sync.outbox where event_type='master.options_changed' and aggregate_id='20261104-0378-4000-8000-000000000001' and delivered_at is null),0,'an unrelated branch edit queues nothing');
update branches set is_active=false where id='20261104-0378-4000-8000-0000000000b1';
select is(pg_temp.option('MK Flagship')->>'value','unmapped:flg','a deactivated branch stops resolving');

select ok(not has_function_privilege('authenticated','crm_sync.branch_master_changed()','execute'),'the branch trigger is not callable');

select * from finish();
rollback;
