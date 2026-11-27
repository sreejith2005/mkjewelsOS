-- 0447: a personal Runo call is not a customer.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid;
begin
  insert into tenants(name, slug) values ('0446 test', 'customer-0447') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK471') returning id into m;
  insert into fx values ('tenant', t), ('mumbai', m);
end $$;
update customer.source_tables set franchise_code = 'MK471' where source in ('runo', 'runo_live', 'runo_call_log', 'runo_call_log_old');

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

create function pg_temp.personal(p_call text, p_phone text, p_row integer) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_call, 'sheet_row', p_row, 'payload', jsonb_build_object(
    'callId', p_call, 'Name', 'Home', 'Phone', p_phone, 'Call Start Date', '27/11/2026, 09:58:00',
    'Duration (in Sec)', '40', 'Call Type', 'incoming', 'Call Tag', 'personal', 'Caller Name', 'Caller One', 'Process Name', 'Default process')) $$;

select customer_ingest_store('runo_call_log_old', jsonb_build_array(pg_temp.personal('P1', '9820047001', 2), pg_temp.personal('P2', '9820047002', 3)), '{"next_row": 4}');
select customer_ingest_apply('runo_call_log_old', 100);
select is((select count(*) from customer.client_phones where phone = customer.normalize_phone('9820047001')), 0::bigint, 'a personal call makes no customer');
select is((select reject_reason from customer.ingest_rows where source = 'runo_call_log_old' and row_key = 'P1'), 'Personal call, not a customer', '... and says why');
select is((select status from customer.ingest_rows where source = 'runo_call_log_old' and row_key = 'P1'), 'applied', '... without counting as rejected');

-- The same callId with an interaction form is a real call: the call log joins it.
select customer_ingest_store('runo', jsonb_build_array(pg_temp.form('P2', '9820047002', 5)), '{"next_row": 6}');
select customer_ingest_apply('runo', 100);
update customer.ingest_rows set fingerprint = 'x', status = 'pending' where source = 'runo_call_log_old' and row_key = 'P2';
select customer_ingest_apply('runo_call_log_old', 100);
select is((pg_temp.call('P2')).call_tag, 'personal', 'a personal-tagged call with a form keeps its call log');

select * from finish();
rollback;
