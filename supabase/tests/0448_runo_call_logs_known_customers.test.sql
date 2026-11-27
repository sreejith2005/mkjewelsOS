-- 0448: a Runo call log alone is added only for a number that is already a customer.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(3);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid;
begin
  insert into tenants(name, slug) values ('0446 test', 'customer-0448') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK481') returning id into m;
  insert into fx values ('tenant', t), ('mumbai', m);
end $$;
update customer.source_tables set franchise_code = 'MK481' where source in ('runo', 'runo_live', 'runo_call_log', 'runo_call_log_old');

create function pg_temp.form(p_call text, p_phone text, p_row integer, p_status text default 'Interested', p_product text default 'R101') returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_call, 'sheet_row', p_row, 'payload', jsonb_build_object(
    'callId', p_call, 'Name', 'Asha', 'Last Name', 'Synthetic', 'Mobile Number', p_phone, 'Interaction Date', '27/11/2026 10:00:00',
    'Status', p_status, 'Product Code', p_product, 'Notes', 'Liked the ring', 'Assigned To', 'Caller One')) $$;
create function pg_temp.log(p_call text, p_phone text, p_row integer, p_seconds text default '95') returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_call, 'sheet_row', p_row, 'payload', jsonb_build_object(
    'callId', p_call, 'Name', 'Asha', 'Phone', p_phone, 'Call Start Date', '27/11/2026 09:58:00',
    'Duration (in Sec)', p_seconds, 'Call Type', 'Outgoing', 'Call Tag', 'Connected', 'Caller Name', 'Caller One', 'Process Name', 'Online')) $$;
create function pg_temp.call(p_call text) returns customer.interactions language sql as $$
  select * from customer.interactions where tenant_id = (select id from fx where label = 'tenant') and source = 'runo' and external_ref = p_call $$;

-- K1: a form makes the customer; a later call log of another call to the same number is added as a call.
select customer_ingest_store('runo_live', jsonb_build_array(pg_temp.form('K1', '9820048001', 2)), '{"next_row": 3}');
select customer_ingest_apply('runo_live', 100);
select customer_ingest_store('runo_call_log', jsonb_build_array(pg_temp.log('K2', '9820048001', 2), pg_temp.log('K3', '9820048009', 3)), '{"next_row": 4}');
select customer_ingest_apply('runo_call_log', 100);
select ok((pg_temp.call('K2')).has_call_log and not (pg_temp.call('K2')).has_interaction_form, 'a call log for a known customer is a call');
select is((pg_temp.call('K2')).client_id, (pg_temp.call('K1')).client_id, '... on that customer');
select is((select count(*) from customer.client_phones where phone = customer.normalize_phone('9820048009')), 0::bigint, 'an unknown number makes no customer');

select * from finish();
rollback;
