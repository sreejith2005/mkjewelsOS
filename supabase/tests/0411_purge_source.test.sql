-- 0411: an import can be taken back without touching other sources.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0411 test', 'customer-0411') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into fx values ('tenant', t);
end $$;

-- Live: a missed call (makes a retry follow-up) for A with city Mumbai.
select customer_ingest_store('runo', jsonb_build_array(jsonb_build_object('row_key', 'live-1', 'sheet_row', 2, 'payload', jsonb_build_object(
  'callId', 'live-1', 'Mobile Number', '9820006001', 'Name', 'Asha', 'Interaction Date', '01/09/2026 10:00:00', 'Status', 'Not contacted',
  'Non contact reason', 'Not picking', 'City', 'Mumbai'))), '{"headers": ["callId", "Mobile Number", "Name", "Interaction Date", "Status", "Non contact reason", "City"], "next_row": 3}');
select customer_ingest_apply('runo', 10);
-- Old sheet: a later connected call for A (closes the live follow-up, sets Pune and a snack, makes a hot follow-up),
-- and a call for B, who exists only in the old sheet.
select customer_ingest_store('runo_old', jsonb_build_array(
  jsonb_build_object('row_key', 'u1', 'sheet_row', 2, 'payload', jsonb_build_object(
    'Unique id', 'u1', 'Mobile Number', '9820006001', 'Name', 'Asha Jain', 'Interaction Date', '02/09/2026, 10:00:00', 'Status', 'Interested',
    'City', 'Pune', 'Snack', 'Sandwich', 'Hot Followup On', '05/09/2026', 'Product Code', 'MK-1')),
  jsonb_build_object('row_key', 'u2', 'sheet_row', 3, 'payload', jsonb_build_object(
    'Unique id', 'u2', 'Mobile Number', '9820006002', 'Name', 'Bina', 'Interaction Date', '03/07/2025, 10:00:00', 'Status', 'Interested', 'City', 'Thane'))),
  '{"headers": ["Unique id", "Mobile Number", "Name", "Interaction Date", "Status", "City", "Snack", "Hot Followup On", "Product Code"], "next_row": 4, "completed": true}');
select customer_ingest_apply('runo_old', 10);

create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;

select is((select city || '|' || snack || '|' || interaction_count from customer.clients where id = pg_temp.client('9820006001')), 'Pune|Sandwich|2',
  'before: the old sheet changed the customer');
select is((select status from customer.follow_ups where kind = 'retry' and client_id = pg_temp.client('9820006001')), 'done', 'before: it closed the live follow-up');

select is((customer.purge_source('runo_old') ->> 'interactions'), '2', 'purge reports what it removed');

select is((select count(*)::int from customer.interactions where source = 'runo_old'), 0, 'the old sheet''s interactions are gone');
select is((select count(*)::int from customer.client_field_values where source = 'runo_old')
        + (select count(*)::int from customer.ingest_rows where source = 'runo_old')
        + (select count(*)::int from customer.sheet_runo_old)
        + (select count(*)::int from customer.follow_ups where kind = 'hot'), 0, 'so are its answers, stored rows, table rows and the follow-up it made');
select is((select city || '|' || coalesce(snack, 'null') || '|' || interaction_count || '|' || successful_interaction_count
            from customer.clients where id = pg_temp.client('9820006001')), 'Mumbai|null|1|0',
  'the customer is back to what the live sheet says');
select is((select status || '|' || (closed_by_interaction_id is null) from customer.follow_ups where kind = 'retry' and client_id = pg_temp.client('9820006001')),
  'pending|true', 'the live follow-up it had closed is pending again');
select is((select count(*)::int from customer.interactions where source = 'runo'), 1, 'the live interaction is untouched');
select is((select (pg_temp.client('9820006002') is not null) and interaction_count = 0 and city is null from customer.clients where id = pg_temp.client('9820006002')), true,
  'a client known only from the old sheet stays, empty, for the next import to fill');
select is((select next_row || '|' || (completed_at is null) from customer.ingest_state where source = 'runo_old'), '2|true', 'the sheet will be read again from the top');
select is(has_function_privilege('service_role', 'customer.purge_source(text)', 'execute')
       or has_function_privilege('authenticated', 'customer.purge_source(text)', 'execute'), false, 'no API role can purge');

-- The correct import afterwards rebuilds it.
select customer_ingest_store('runo_old', jsonb_build_array(jsonb_build_object('row_key', 'u1|02/09/2026, 10:00:00', 'sheet_row', 2, 'payload', jsonb_build_object(
  'Unique id', 'u1', 'Mobile Number', '9820006001', 'Name', 'Asha Jain', 'Interaction Date', '02/09/2026, 10:00:00', 'Status', 'Interested', 'City', 'Pune'))),
  '{"headers": ["Unique id", "Mobile Number", "Name", "Interaction Date", "Status", "City"], "next_row": 3}');
select customer_ingest_apply('runo_old', 10);
select is((select city || '|' || interaction_count || '|' || (select status from customer.follow_ups where kind = 'retry' and client_id = c.id)
            from customer.clients c where id = pg_temp.client('9820006001')), 'Pune|2|done', 'importing again restores the customer');

select * from finish();
rollback;
