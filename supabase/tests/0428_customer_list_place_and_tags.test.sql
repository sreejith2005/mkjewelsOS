-- 0428: the list shows a place and category tags.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

select is(customer.client_place('Pune', 'Bandra, Mumbai 400050', null, null), 'Pune', 'the city first');
select is(customer.client_place(null, 'Flat 4, Patliputra, Anushaktinagar, Mumbai - 400094, Maharashtra, India', 'Maharashtra', 'India'), 'Mumbai',
  'else the last place in the address, without pincode, state or India');
select is(customer.client_place(null, '12/4', 'Gujarat', 'India'), 'Gujarat', 'else the state');
select is(customer.client_place(null, null, null, 'Dubai'), 'Dubai', 'else the country');
select is(customer.client_place(' ', '', null, null), null, 'nothing known is null, not "No city"');

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0428 test', 'customer-0428') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;
select customer_ingest_store('master_sheet', jsonb_build_array(
  jsonb_build_object('row_key', '971501234567', 'sheet_row', 4, 'payload', '{"CONTACT NUMBER": "+971501234567", "CLIENT NAME": "Sara", "BRANCH": "Bandra", "STATUS": "WRONG DATA", "SCRIPT STATUS": "NON-CLIENT - COURIER"}'::jsonb),
  jsonb_build_object('row_key', '9820028001', 'sheet_row', 5, 'payload', '{"CONTACT NUMBER": "9820028001", "CLIENT NAME": "Nikhil", "CITY": "Mumbai"}'::jsonb)),
  '{"next_row": 6}');
select customer_ingest_apply('master_sheet', 100);
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;

select is(customer.client_tags(pg_temp.client('+971501234567')), array['abroad', 'not_customer', 'wrong_data', 'store:Bandra'],
  'tags from the number, SCRIPT STATUS, STATUS and BRANCH');
select is(customer.client_tags(pg_temp.client('9820028001')), '{}'::text[], 'no tags when nothing applies');
update customer.clients set do_not_call = true where id = pg_temp.client('9820028001');
select is(customer.client_tags(pg_temp.client('9820028001')), array['do_not_call'], 'do not call');

-- The list carries both.
select set_config('test.tenant', (select id::text from fx where label = 'tenant'), true);
select is((select r ->> 'place' || '|' || (r -> 'tags')::text from jsonb_array_elements(public.customer_list('{"q": "9820028001"}'::jsonb) -> 'rows') r),
  'Mumbai|["do_not_call"]', 'customer_list rows hold the place and the tags');

select is(public.customer_get_client_page((select client_code from customer.clients where id = pg_temp.client('+971501234567'))) -> 'tags',
  '["abroad", "not_customer", "wrong_data", "store:Bandra"]'::jsonb, 'the customer page carries the tags');

select * from finish();
rollback;
