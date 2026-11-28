-- 0456: counted values for Data standards, the client_id index, and a worker that skips a bad answer.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

select ok(exists (select 1 from pg_indexes where schemaname = 'customer' and indexname = 'ingest_rows_client_idx'), 'sheet rows are indexed by customer');

insert into tenants(name, slug) values ('0456 test', 'customer-0456');
insert into customer.ingest_settings(tenant_id) select id from tenants where slug = 'customer-0456';
create temp table c as select customer.find_or_create_client((select id from tenants where slug = 'customer-0456'), '9820056001', 'Synthetic', 'master_sheet', now()) as id;
select customer.set_field_value((select id from c), 'city', 'Vashi Sector 9', 'master_sheet', now());
select customer.refresh_std_stats('city');
select is((select customers from customer.std_value_stats where field_key = 'city' and input_key = 'vashi sector 9'), 1, 'each written value is counted');
select is((select status from customer.std_value_stats where field_key = 'city' and input_key = 'vashi sector 9'), 'unmapped', '... with how it is read');

insert into customer.std_rules (field_key, input_key, outputs, approved_at) values ('city', 'vashi sector 9', '[{"field": "city", "code": "place:navi-mumbai"}]', now());
select ok((select has_rule from customer.std_value_stats where field_key = 'city' and input_key = 'vashi sector 9'), 'a decision takes the value off the review at once');

insert into customer.std_jobs (field_key, input_key, reason) values ('city', 'vashi sector 9', 'test');
select customer.process_std_jobs(100);
select is((select city from customer.clients where id = (select id from c)), 'Navi Mumbai', 'the worker applies the rule');

select * from finish();
rollback;
