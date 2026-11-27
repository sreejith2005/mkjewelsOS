-- 0446: one call is one interaction across the Runo sheets; call log and form shown together.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; m uuid;
begin
  insert into tenants(name, slug) values ('0446 test', 'customer-0446') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into franchise_groups (tenant_id, name, code) values (t, 'Mumbai', 'MK461') returning id into m;
  insert into fx values ('tenant', t), ('mumbai', m);
end $$;
update customer.source_tables set franchise_code = 'MK461' where source in ('runo', 'runo_live', 'runo_call_log', 'runo_call_log_old');

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

-- C1: call log first, then the form in the new sheet, then the same form copied into the old sheet.
select customer_ingest_store('runo_call_log', jsonb_build_array(pg_temp.log('C1', '9820046001', 2)), '{"next_row": 3}');
select customer_ingest_apply('runo_call_log', 100);
select ok((pg_temp.call('C1')).has_call_log and not (pg_temp.call('C1')).has_interaction_form, 'a call log alone is a call');
select is((pg_temp.call('C1')).call_duration_seconds, 95, '... with its duration');

select customer_ingest_store('runo_live', jsonb_build_array(pg_temp.form('C1', '9820046001', 2)), '{"next_row": 3}');
select customer_ingest_apply('runo_live', 100);
select customer_ingest_store('runo', jsonb_build_array(pg_temp.form('C1', '9820046001', 7)), '{"next_row": 8}');
select customer_ingest_apply('runo', 100);
select is((select count(*) from customer.interactions where tenant_id = (select id from fx where label = 'tenant') and external_ref = 'C1'), 1::bigint,
  'the call log and both form tabs are one interaction');
select ok((pg_temp.call('C1')).has_call_log and (pg_temp.call('C1')).has_interaction_form, '... shown as call log and interaction form');
select is((pg_temp.call('C1')).outcome, 'Interested', '... with the form''s outcome');
select is((pg_temp.call('C1')).call_tag, 'Connected', '... and the call log''s tag');
select is(jsonb_array_length(customer.interaction_sheets((pg_temp.call('C1')).id)), 3, '... listing the three sheets it is in');
select is((select count(*) from customer.interaction_products where interaction_id = (pg_temp.call('C1')).id), 1::bigint, 'the product is there once');

-- C2: form first, then the call log: the call log never replaces the form's answers.
select customer_ingest_store('runo_live', jsonb_build_array(pg_temp.form('C2', '9820046002', 3, 'Price Enquiry', 'N55')), '{"next_row": 4}');
select customer_ingest_apply('runo_live', 100);
select customer_ingest_store('runo_call_log_old', jsonb_build_array(jsonb_build_object('row_key', 'C2', 'sheet_row', 2, 'payload', jsonb_build_object(
  'callId', 'C2', 'Name', 'Asha', 'Mobile Number', '9820046002', 'Interaction Date', '27/11/2026 11:00:00', 'Status', 'Not Interested', 'CALL STATUS', 'ANSWERED'))),
  '{"next_row": 3}');
select customer_ingest_apply('runo_call_log_old', 100);
select is((pg_temp.call('C2')).outcome, 'Price Enquiry', 'a call log after the form keeps the form''s outcome');
select is((pg_temp.call('C2')).call_status, 'ANSWERED', '... and adds the call status');
select is((select count(*) from customer.interaction_products where interaction_id = (pg_temp.call('C2')).id), 1::bigint, '... and keeps its product');

-- C3: a call log without a phone or name is refused; without a date it is refused.
select customer_ingest_store('runo_call_log', jsonb_build_array(
  jsonb_build_object('row_key', 'C3', 'sheet_row', 4, 'payload', jsonb_build_object('callId', 'C3', 'Call Start Date', '27/11/2026 12:00:00')),
  jsonb_build_object('row_key', 'C4', 'sheet_row', 5, 'payload', jsonb_build_object('callId', 'C4', 'Phone', '9820046004'))), '{"next_row": 6}');
select is((select count(*) from customer.ingest_rows where source = 'runo_call_log' and row_key in ('C3', 'C4') and status = 'rejected')::integer, 0, 'stored, not yet applied');
select customer_ingest_apply('runo_call_log', 100);
select is((select count(*) from customer.ingest_rows where source = 'runo_call_log' and row_key in ('C3', 'C4') and status = 'rejected'), 2::bigint,
  'a call log with no one to link or no time is rejected');

-- Removing C1 from the old sheet keeps the call (it is still in the new sheet and the call log).
select customer.remove_source_row((select id from customer.ingest_rows where source = 'runo' and row_key = 'C1'));
select ok((pg_temp.call('C1')).archived_at is null, 'a call removed from one sheet stays while another sheet has it');
select is(jsonb_array_length(customer.interaction_sheets((pg_temp.call('C1')).id)), 2, '... and no longer lists that sheet');
select customer.remove_source_row((select id from customer.ingest_rows where source = 'runo_call_log' and row_key = 'C1'));
select ok(not (pg_temp.call('C1')).has_call_log and (pg_temp.call('C1')).archived_at is null, 'its call log removed: still the form');

-- The old sheet is a copy now: rows gone from it are kept.
select ok((select keep_rows_gone_from_sheet from customer.source_tables where source = 'runo'), 'the old sheet keeps rows that disappear from it');

select * from finish();
rollback;
