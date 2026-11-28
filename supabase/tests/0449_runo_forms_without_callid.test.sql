-- 0449: a Runo form without a callId is one call in both sheets.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid;
begin
  insert into tenants(name, slug) values ('0446 test', 'customer-0449') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK491') returning id into m;
  insert into fx values ('tenant', t), ('mumbai', m);
end $$;
update customer.source_tables set franchise_code = 'MK491' where source in ('runo', 'runo_live', 'runo_call_log', 'runo_call_log_old');

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

create function pg_temp.nocall(p_row integer, p_phone text, p_date text, p_status text) returns jsonb language sql as $$
  select jsonb_build_object('row_key', 'row:' || p_row, 'sheet_row', p_row, 'payload', (pg_temp.form('x', p_phone, p_row, p_status) ->> 'payload')::jsonb - 'callId'
    || jsonb_build_object('Interaction Date', p_date)) $$;

-- The old sheet: form A on row 3. The live sheet: form B on row 3, and form A on row 9.
select customer_ingest_store('runo', jsonb_build_array(pg_temp.nocall(3, '9820049001', '27/11/2026, 10:00:00', 'Interested')), '{"next_row": 4}');
select customer_ingest_apply('runo', 100);
select customer_ingest_store('runo_live', jsonb_build_array(
  pg_temp.nocall(3, '9820049002', '27/11/2026, 11:00:00', 'Not Interested'),
  pg_temp.nocall(9, '9820049001', '27/11/2026, 10:00:00', 'Interested')), '{"next_row": 10}');
select customer_ingest_apply('runo_live', 100);

select is((select count(*) from customer.interactions i join customer.client_phones ph on ph.client_id = i.client_id
            where ph.phone = customer.normalize_phone('9820049001') and i.source = 'runo'), 1::bigint, 'the same form in both sheets is one call');
select is((select count(*) from customer.interactions i join customer.client_phones ph on ph.client_id = i.client_id
            where ph.phone = customer.normalize_phone('9820049002') and i.source = 'runo'), 1::bigint, 'another form on the same row number is its own call');
select is((select i.outcome from customer.interactions i join customer.client_phones ph on ph.client_id = i.client_id
            where ph.phone = customer.normalize_phone('9820049001') and i.source = 'runo'), 'Interested', '... and does not overwrite the first');
select is((select count(*) from customer.interactions where source = 'runo' and external_ref like 'row:%'
            and tenant_id = (select id from fx where label = 'tenant')), 0::bigint, 'no form is keyed by its row number');

select * from finish();
rollback;
