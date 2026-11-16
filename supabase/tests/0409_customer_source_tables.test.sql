-- 0409: one table per sheet, full sync (edits anywhere, removed rows), old Runo sheet.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(31);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; b uuid;
begin
  insert into tenants(name, slug) values ('0409 test', 'customer-0409') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into branches(tenant_id, name, code) values (t, 'MK Bandra', 'B0409') returning id into b;
  insert into fx values ('tenant', t);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.r(p_key text, p_row integer, p_payload jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_key, 'sheet_row', p_row, 'payload', p_payload || jsonb_build_object('callId', p_key)) $$;
create function pg_temp.call(p_phone text, p_name text, p_date text, p_status text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('Mobile Number', p_phone, 'Name', p_name, 'Interaction Date', p_date, 'Status', p_status) || p_extra $$;
create function pg_temp.headers(variadic p text[]) returns jsonb language sql as $$ select to_jsonb(p) $$;

-- 1. The sheet's own table ----------------------------------------------------------------
select customer_ingest_store('runo', jsonb_build_array(
  pg_temp.r('c-1', 2, pg_temp.call('9820004001', 'Asha', '01/09/2026 11:00:00', 'Interested', '{"City": "Thane", "Notes": "likes polki"}')),
  pg_temp.r('c-2', 3, pg_temp.call('9820004002', 'Bina', '02/09/2026 11:00:00', 'Not contacted', '{"Non contact reason": "Not picking"}')),
  pg_temp.r('c-3', 4, pg_temp.call('9820004001', 'Asha', '15/10/2026 11:00:00', 'Call Back Later', '{"Hot Followup On": "20/10/2026"}'))),
  jsonb_build_object('next_row', 5, 'headers', pg_temp.headers('callId', 'Interaction Date', 'Mobile Number', 'Name', 'Status', 'Non contact reason', 'City', 'Notes', 'Hot Followup On')));
select is((select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
            where table_schema = 'customer' and table_name = 'sheet_runo_live' and left(column_name, 1) <> '_'),
  'callId,Interaction Date,Mobile Number,Name,Status,Non contact reason,City,Notes,Hot Followup On',
  'the sheet gets its own table with the sheet''s columns, in sheet order');
select is((select count(*)::int || '|' || string_agg("Name" || ':' || _status, ',' order by _sheet_row) from customer.sheet_runo_live), '3|Asha:pending,Bina:pending,Asha:pending',
  'rows land in the sheet''s table first');
select customer_ingest_apply('runo', 100);
select is((select _status || '|' || (_client_id = pg_temp.client('9820004001')) || '|' || (_client_code ~ '^MKC-') || '|' || (_interaction_id is not null) || '|' || "Notes"
            from customer.sheet_runo_live where _row_key = 'c-1'), 'applied|true|true|true|likes polki',
  'after applying, each sheet row shows its status and the master client it belongs to');
select is((select count(*)::int from customer.customer_master where tenant_id = (select id from fx where label = 'tenant')), 2, 'the flat master view lists the clients');
select is((select city || '|' || phone from customer.customer_master where client_id = pg_temp.client('9820004001')), 'Thane|919820004001', 'with their profile columns');

-- 2. A new column, and a removed column -----------------------------------------------------
select customer_ingest_store('runo', jsonb_build_array(
  pg_temp.r('c-4', 5, pg_temp.call('9820004003', 'Chetan', '06/09/2026 11:00:00', 'Interested', '{"Budget": "5 lakh"}'))),
  jsonb_build_object('next_row', 6, 'headers', pg_temp.headers('callId', 'Interaction Date', 'Mobile Number', 'Name', 'Status', 'Non contact reason', 'City', 'Hot Followup On', 'Budget')));
select is((select "Budget" from customer.sheet_runo_live where _row_key = 'c-4'), '5 lakh', 'a new sheet column becomes a new table column');
select is((select string_agg(header, ',' order by header) from customer.source_columns where source = 'runo' and not in_sheet), 'Notes', 'a column removed from the sheet is marked');
select is((select "Notes" from customer.sheet_runo_live where _row_key = 'c-1'), 'likes polki', 'and keeps its old data');
select customer_ingest_apply('runo', 100);

-- 3. An edit to an old row counts as new information -------------------------------------------
select customer_ingest_store('runo', jsonb_build_array(
  pg_temp.r('c-5', 6, pg_temp.call('9820004001', 'Asha', '10/10/2026 11:00:00', 'Interested', '{"City": "Mumbai"}'))), '{"next_row": 7}');
select customer_ingest_apply('runo', 100);
select is((select city from customer.clients where id = pg_temp.client('9820004001')), 'Mumbai', 'a later call sets the city');
update customer.ingest_rows set updated_at = now() - interval '1 minute' where row_key = 'c-1';
select is(customer_ingest_store('runo', jsonb_build_array(
  pg_temp.r('c-1', 2, pg_temp.call('9820004001', 'Asha', '01/09/2026 11:00:00', 'Interested', '{"City": "Pune", "Notes": "likes polki"}'))),
  '{"scan": true, "scan_row": 3}') ->> 'changed', '1', 'an edit to an old row is seen by the full pass');
select customer_ingest_apply('runo', 100);
select is((select city from customer.clients where id = pg_temp.client('9820004001')), 'Pune', 'the edited value wins: it was learned when the edit was made');
select is((select "City" || '|' || _status from customer.sheet_runo_live where _row_key = 'c-1'), 'Pune|applied', 'and the sheet''s table shows the edit');
select is((select count(*)::int from customer.interactions where client_id = pg_temp.client('9820004001')), 3, 'no interaction was duplicated');

-- 4. Rows deleted from the sheet ------------------------------------------------------------------
select customer_ingest_store('runo', (select jsonb_agg(pg_temp.r('f-' || g, 10 + g, pg_temp.call((9820005000 + g)::text, 'Filler ' || g, '01/08/2026 10:00:00', 'Interested'))) from generate_series(1, 60) g), '{"next_row": 80}');
select customer_ingest_apply('runo', 500);
update customer.ingest_rows set received_at = now() - interval '1 hour' where source = 'runo';
update customer.ingest_state set scan_started_at = null where source = 'runo';
-- A pass that saw only one row: 64 of 65 rows look missing. That is a broken sheet, not deletions.
select customer_ingest_store('runo', jsonb_build_array(
  pg_temp.r('c-1', 2, pg_temp.call('9820004001', 'Asha', '01/09/2026 11:00:00', 'Interested', '{"City": "Pune", "Notes": "likes polki"}'))), '{"scan": true, "scan_row": 3}');
select is((customer_ingest_finish_scan('runo') ->> 'blocked'), 'true', 'most of the sheet missing is over the safety limit: nothing is removed');
select is((select count(*)::int || '|' || (select last_error from customer.ingest_state where source = 'runo') from customer.ingest_rows where status = 'removed'),
  '0|too_many_rows_missing:64', 'and the import records why');

-- A full pass in which c-2 and c-3 are gone and the rows below moved up.
select customer_ingest_store('runo', jsonb_build_array(
  pg_temp.r('c-1', 2, pg_temp.call('9820004001', 'Asha', '01/09/2026 11:00:00', 'Interested', '{"City": "Pune", "Notes": "likes polki"}')),
  pg_temp.r('c-4', 3, pg_temp.call('9820004003', 'Chetan', '06/09/2026 11:00:00', 'Interested', '{"Budget": "5 lakh"}')),
  pg_temp.r('c-5', 4, pg_temp.call('9820004001', 'Asha', '10/10/2026 11:00:00', 'Interested', '{"City": "Mumbai"}'))), '{"scan": true, "scan_row": 5}');
select customer_ingest_store('runo', (select jsonb_agg(pg_temp.r('f-' || g, 4 + g, pg_temp.call((9820005000 + g)::text, 'Filler ' || g, '01/08/2026 10:00:00', 'Interested'))) from generate_series(1, 60) g), '{"scan": true, "scan_row": 65}');
select is(customer_ingest_finish_scan('runo')::text, '{"blocked": false, "missing": 2, "removed": 2, "remaining": false}', 'rows gone from the sheet after a full pass are removed');
select is((select string_agg(_row_key || ':' || _status, ',' order by _row_key) from customer.sheet_runo_live where _removed_at is not null), 'c-2:removed,c-3:removed',
  'the sheet''s table marks them removed and keeps them');
select is((select count(*)::int from customer.interactions where client_id = pg_temp.client('9820004001') and archived_at is null), 2, 'the removed call no longer counts for the customer');
select is((select interaction_count from customer.clients where id = pg_temp.client('9820004001')), 2, 'the counters follow');
select is((select string_agg(status, ',') from customer.follow_ups where client_id = pg_temp.client('9820004001')), 'cancelled', 'its pending follow-up is cancelled');
select is((select archived_at is not null and archive_reason = 'removed_from_sheet' from customer.clients where id = pg_temp.client('9820004002')), true,
  'a customer whose only row was deleted is archived, not deleted');
select is((select count(*)::int from customer.customer_master where client_id = pg_temp.client('9820004002')), 0, 'and leaves the master list');
select is((select (scan_started_at is null) || '|' || scan_row || '|' || (last_full_pass_at is not null) || '|' || coalesce(last_error, 'none') from customer.ingest_state where source = 'runo'),
  'true|2|true|none', 'the pass is closed and the next one starts from the top');

-- 5. A deleted row that comes back is restored ---------------------------------------------------------
select customer_ingest_store('runo', jsonb_build_array(
  pg_temp.r('c-2', 70, pg_temp.call('9820004002', 'Bina', '02/09/2026 11:00:00', 'Not contacted', '{"Non contact reason": "Not picking"}'))), '{"next_row": 81}');
select customer_ingest_apply('runo', 100);
select is((select (c.archived_at is null) || '|' || c.interaction_count || '|' || (select _status from customer.sheet_runo_live where _row_key = 'c-2')
            from customer.clients c where c.id = pg_temp.client('9820004002')), 'true|1|applied', 'the customer and the call are restored');

-- 6. The old Runo sheet ----------------------------------------------------------------------------------
select customer_ingest_store('runo_old', jsonb_build_array(
  jsonb_build_object('row_key', 'old-1', 'sheet_row', 2, 'payload', pg_temp.call('9820004001', 'Asha J', '01/02/2026 10:00:00', 'Not Interested', '{"Unique id": "old-1", "Set Follow Up For 3 Months Later": "01/05/2026"}')),
  jsonb_build_object('row_key', 'c-5', 'sheet_row', 3, 'payload', pg_temp.call('9820004001', 'Asha', '10/10/2026 11:00:00', 'Interested', '{"Unique id": "c-5"}')),
  jsonb_build_object('row_key', 'old-2', 'sheet_row', 4, 'payload', pg_temp.call('9820004009', 'Old Only', '01/01/2026 10:00:00', 'Not contacted', '{"Unique id": "old-2", "Non contact reason": "Switched Off", "Non Contact Followup On": "05/01/2026"}'))),
  jsonb_build_object('next_row', 5, 'completed', true, 'headers', pg_temp.headers('Unique id', 'Interaction Date', 'Mobile Number', 'Name', 'Status', 'Non contact reason', 'Non Contact Followup On', 'Set Follow Up For 3 Months Later')));
select is(customer_ingest_apply('runo_old', 100)::text, '{"applied": 3, "pending": 0, "rejected": 0}', 'old-sheet rows are applied by the same importer');
select is((select interaction_count || '|' || primary_name || '|' || first_source from customer.clients where id = pg_temp.client('9820004001')), '3|Asha|runo_old',
  'an existing customer gains the older call; the newest name stays; the first source is the older sheet');
select is((select reject_reason from customer.ingest_rows where source = 'runo_old' and row_key = 'c-5'), 'Same call as the live sheet', 'a call present in both sheets is not imported twice');
select is((select string_agg(f.kind || ':' || to_char(f.due_at at time zone 'Asia/Kolkata', 'DD/MM/YYYY'), ',' order by f.kind) from customer.follow_ups f join customer.interactions i on i.id = f.origin_interaction_id where i.source = 'runo_old'),
  'retry:05/01/2026,three_month:01/05/2026', 'the old sheet''s follow-up columns are read, with their own dates');
select is((select count(*)::int || '|' || (customer_ingest_state('runo_old') ->> 'completed') from customer.sheet_runo_old), '3|true', 'the old sheet has its own table and is marked read to the end');

-- 7. Service only -------------------------------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.customer_ingest_store(text,jsonb,jsonb)', 'execute')
       or has_function_privilege('authenticated', 'public.customer_ingest_finish_scan(text,integer)', 'execute')
       or has_table_privilege('authenticated', 'customer.sheet_runo_live', 'select')
       or has_table_privilege('authenticated', 'customer.customer_master', 'select'), false, 'browsers cannot reach the sheet tables or the import');
select is((select count(*)::int from customer.ingest_rows where status = 'removed'), 1, 'only the row still missing stays removed');

select * from finish();
rollback;
