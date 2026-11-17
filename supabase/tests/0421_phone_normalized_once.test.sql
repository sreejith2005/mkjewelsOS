-- 0421: a phone number is cleaned once, not twice.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0421 test', 'customer-0421') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;

insert into fx values ('a', customer.resolve_client((select id from fx where label = 'tenant'), '0098200123', 'Abroad A', 'repair_fms', now()));
select is((select string_agg(phone, ',') from customer.client_phones where client_id = (select id from fx where label = 'a')), '98200123',
  'a number written with 00 is kept as the international number it is');
insert into fx values ('b', customer.resolve_client((select id from fx where label = 'tenant'), '+44 20712345', 'Abroad B', 'repair_fms', now()));
select is((select string_agg(phone, ',') from customer.client_phones where client_id = (select id from fx where label = 'b')), '4420712345',
  'a number written with + gets no Indian code added');
insert into fx values ('c', customer.resolve_client((select id from fx where label = 'tenant'), 'abc', 'Nobody', 'repair_fms', now(), '0044 2071234567'));
select is((select string_agg(phone, ',') from customer.client_phones where client_id = (select id from fx where label = 'c')), '442071234567',
  'the same for a billing phone');
insert into fx values ('d', customer.resolve_client((select id from fx where label = 'tenant'), '9820021001', 'Local', 'runo', now()));
select is((select string_agg(phone, ',') from customer.client_phones where client_id = (select id from fx where label = 'd')), '919820021001',
  'a local number is unchanged');

select * from finish();
rollback;
