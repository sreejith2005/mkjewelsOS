-- 0410: old Runo rows are one per call; the overlap with the live sheet is
-- recognised by phone and time, not by id.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0410 test', 'customer-0410') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
end $$;

-- A live call, then the old sheet: the same call again, and two more calls that share one id.
select customer_ingest_store('runo', jsonb_build_array(jsonb_build_object('row_key', 'live-1', 'sheet_row', 2, 'payload', jsonb_build_object(
  'callId', 'live-1', 'Mobile Number', '9820005001', 'Name', 'Meera', 'Interaction Date', '16/08/2026 11:52:43', 'Status', 'Interested'))),
  '{"headers": ["callId", "Mobile Number", "Name", "Interaction Date", "Status"], "next_row": 3}');
select customer_ingest_apply('runo', 10);
select customer_ingest_store('runo_old', jsonb_build_array(
  jsonb_build_object('row_key', 'u1|16/08/2026, 11:52:43', 'sheet_row', 2, 'payload', jsonb_build_object(
    'Unique id', 'u1', 'Mobile Number', '+91 98200 05001', 'Name', 'Meera', 'Interaction Date', '16/08/2026, 11:52:43', 'Status', 'Interested')),
  jsonb_build_object('row_key', 'u1|16/07/2025, 11:52:43', 'sheet_row', 3, 'payload', jsonb_build_object(
    'Unique id', 'u1', 'Mobile Number', '9820005001', 'Name', 'Meera', 'Interaction Date', '16/07/2025, 11:52:43', 'Status', 'Not contacted')),
  jsonb_build_object('row_key', 'u1|18/07/2025, 10:00:00', 'sheet_row', 4, 'payload', jsonb_build_object(
    'Unique id', 'u1', 'Mobile Number', '9820005001', 'Name', 'Meera', 'Interaction Date', '18/07/2025, 10:00:00', 'Status', 'Interested')),
  jsonb_build_object('row_key', 'live-1|17/08/2026, 09:00:00', 'sheet_row', 5, 'payload', jsonb_build_object(
    'Unique id', 'live-1', 'Mobile Number', '9820005002', 'Name', 'Other', 'Interaction Date', '17/08/2026, 09:00:00', 'Status', 'Interested'))),
  '{"headers": ["Unique id", "Mobile Number", "Name", "Interaction Date", "Status"], "next_row": 6}');
select is(customer_ingest_apply('runo_old', 10)::jsonb ->> 'applied', '4', 'all four old rows are applied');

select is((select reject_reason from customer.ingest_rows where source = 'runo_old' and row_key = 'u1|16/08/2026, 11:52:43'), 'Same call as the live sheet',
  'the same phone at the same second is the call already imported from the live sheet');
select is((select count(*)::int from customer.interactions where source = 'runo_old'), 3, 'the other three old rows are three interactions');
select is((select count(*)::int from customer.interactions i join customer.client_phones p on p.client_id = i.client_id
            where p.phone = '919820005001' and i.source = 'runo_old'), 2, 'two calls that share one id are two interactions');
select is((select count(*)::int from customer.interactions i join customer.client_phones p on p.client_id = i.client_id
            where p.phone = '919820005002'), 1, 'an old id that equals a live call id is still its own call for another phone');
select is((select interaction_count from customer.clients c join customer.client_phones p on p.client_id = c.id where p.phone = '919820005001'), 3,
  'the customer has the live call and the two older ones');

select * from finish();
rollback;
