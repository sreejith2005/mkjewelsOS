-- 0457: Data standards reads prepared counts; a new answer counts at once.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

insert into tenants(name, slug) values ('0457 test', 'customer-0457');
create temp table c as select customer.find_or_create_client((select id from tenants where slug = 'customer-0457'), '9820057001', 'Synthetic', 'master_sheet', now()) as id;
create temp table d as select customer.find_or_create_client((select id from tenants where slug = 'customer-0457'), '9820057002', 'Synthetic Two', 'master_sheet', now()) as id;
select customer.set_field_value((select id from c), 'city', 'Ghansoli Node', 'master_sheet', now());
select customer.set_field_value((select id from d), 'city', 'GHANSOLI NODE', 'master_sheet', now());
select customer.set_field_value((select id from d), 'city', 'Ghansoli node', 'runo', now() - interval '1 day');

select is((select customers from customer.std_value_stats where field_key = 'city' and input_key = 'ghansoli node'), 2, 'new answers are counted at once, per customer');
select is((select observations from customer.std_value_stats where field_key = 'city' and input_key = 'ghansoli node'), 3, '... and per answer');
select ok((select examples ? 'Ghansoli Node' from customer.std_value_stats where field_key = 'city' and input_key = 'ghansoli node'), '... with how it was written');

select customer.set_field_value((select id from c), 'city', 'Mumbai', 'software', now());
select customer.refresh_std_stats('city');
select is((select jsonb_array_length(examples) from customer.std_value_stats where field_key = 'city' and input_key = 'ghansoli node'), 3, 'a full count keeps up to three spellings');
select ok((select r.customers from customer.std_ref_counts r join customer.ref_values v on v.id = r.value_id where v.domain = 'place' and v.code = 'mumbai') >= 1,
  'reference values are counted');

select * from finish();
rollback;
