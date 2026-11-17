-- 0414: enquiry FMS tabs (Instagram, Instagram ads, DoubleTick, website chat).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(38);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; u uuid;
begin
  insert into tenants(name, slug) values ('0414 test', 'customer-0414') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into user_profiles(tenant_id, employee_name) values (t, 'Mitu Patel') returning id into u;
  insert into fx values ('tenant', t), ('mitu', u);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;
create function pg_temp.enq(p_ref text, p_source text default 'instagram_fms') returns customer.enquiries language sql as $$
  select * from customer.enquiries where tenant_id = (select id from fx where label = 'tenant') and source = p_source and reference_number = p_ref $$;
-- One sheet row. COMBO is the row key, as in the sheet.
create function pg_temp.r(p_row integer, p_ref text, p_stage text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_key', p_ref || '-' || p_stage, 'sheet_row', p_row, 'payload',
    jsonb_build_object('Timestamp', '05/11/2026 10:15:00', 'REFERENCE NUMBER', p_ref, 'DM RECEIVED DATE', '05/11/2026',
      'ASSIGNED BY', 'MITU PATEL', 'CUSTOMER NAME', 'Asha Mehta', 'INSTAGRAM ID', '@asha.m', 'CUSTOMER CONTACT NUMBER', '9820014001',
      'CITY', 'Thane', 'SOURCE OF THE LEAD', 'DIRECT MESSAGE', 'PRODUCT NUMBER', 'N123456', 'PRICING', '185000',
      'COMBO', p_ref || '-' || p_stage, 'WORK STAGE', p_stage, 'DOER', 'MITU PATEL', 'PLANNED', '05/11/2026 13:15:00', 'FMS', 'INSTAGRAM FMS')
    || p_extra) $$;
create function pg_temp.headers() returns jsonb language sql as $$ select jsonb_build_object('headers', jsonb_build_array(
  'Timestamp', 'REFERENCE NUMBER', 'DM RECEIVED DATE', 'ASSIGNED BY', 'CUSTOMER NAME', 'INSTAGRAM ID', 'CUSTOMER CONTACT NUMBER',
  'PREVIOUS REMARK', 'CITY', 'STATE', 'PIN CODE', 'SOURCE OF THE LEAD', 'PRODUCT NUMBER', 'PRICING', 'COMBO', 'DOER', 'PLANNED',
  'ACTUAL TIME', 'STATUS', 'REMARK', 'WORK STAGE', 'FMS', 'NEW PLANNED', 'FOLLOW UP COUNT')) $$;

-- 1. The sheets are registered and not scheduled -----------------------------------------
select is((select string_agg(source || ':' || importer || ':' || scheduled, ',' order by source) from customer.source_tables where importer in ('runo', 'enquiry_fms')),
  'doubletick_fms:enquiry_fms:false,instagram_ads_fms:enquiry_fms:false,instagram_fms:enquiry_fms:false,runo:runo:true,runo_old:runo:false,website_chat_fms:enquiry_fms:false',
  'the four enquiry tabs are registered; only the live Runo sheet is on the 5-minute job');
select is(customer_ingest_state('instagram_fms') ->> 'scheduled', 'false', 'the import reports whether a sheet is scheduled');

-- 2. One enquiry, three stages ------------------------------------------------------------------
select customer_ingest_store('instagram_fms', jsonb_build_array(
  pg_temp.r(3, 'MK-INS-1001', '2. INTRODUCTION CALL', '{"ACTUAL TIME": "05/11/2026 12:40:00", "STATUS": "YES (INTERESTED)", "REMARK": "wants polki set"}'),
  pg_temp.r(4, 'MK-INS-1001', '3. PROPOSAL PRODUCT DEMONSTRATION', '{"ACTUAL TIME": "07/11/2026 17:00:00", "STATUS": "NOT INTERESTED CLOSE THIS LEAD", "REMARK": "price too high", "PREVIOUS REMARK": "wants polki set"}'),
  pg_temp.r(5, 'MK-INS-1001', '5. CLOSER', '{"ACTUAL TIME": "08/11/2026 10:00:00", "STATUS": "ENQUIRY CLOSE"}')),
  pg_temp.headers() || '{"next_row": 6}');
select is(customer_ingest_apply('instagram_fms', 100) ->> 'applied', '3', 'the rows are applied');

select is((select outcome || '|' || step_count || '|' || current_stage || '|' || channel || '|' || (enquiry_code ~ '^MKE-')
             from pg_temp.enq('MK-INS-1001')), 'lost|3|5. CLOSER|instagram|true',
  'one enquiry per reference number, its steps, and its outcome');
select is((select received_at from pg_temp.enq('MK-INS-1001')), '2026-11-05 10:15:00+05:30'::timestamptz,
  'the enquiry is dated by the form time on the DM day');
select is((select string_agg(i.direction || ':' || i.channel || ':' || coalesce(i.outcome, '') || ':' || i.result, ',' order by i.occurred_at)
             from customer.interactions i where i.client_id = pg_temp.client('9820014001')),
  'inbound:instagram:Enquiry received:neutral,not_recorded:not_recorded:YES (INTERESTED):positive,not_recorded:not_recorded:NOT INTERESTED CLOSE THIS LEAD:negative',
  'the timeline: the message, then each completed stage as the sheet wrote it; the closer is not a contact');
select is((select notes || '|' || staff_user_id::text from customer.interactions where external_ref = 'MK-INS-1001-2. INTRODUCTION CALL'),
  'wants polki set|' || (select id from fx where label = 'mitu'), 'a stage contact carries its remark and the person who did it');
select is((select parent_interaction_id = e.opened_interaction_id and lead_id = e.id from customer.interactions i, pg_temp.enq('MK-INS-1001') e
            where i.external_ref = 'MK-INS-1001-3. PROPOSAL PRODUCT DEMONSTRATION'), true, 'each stage contact links to its enquiry and to the opening message');
select is((select product_code || ':' || interest from customer.interaction_products p join pg_temp.enq('MK-INS-1001') e on p.interaction_id = e.opened_interaction_id),
  'N123456:interested', 'the product asked about is on the opening message');
select is((select city || '|' || lifecycle_stage || '|' || first_source from customer.clients where id = pg_temp.client('9820014001')),
  'Thane|engaged|instagram_fms', 'the customer gets the city, is engaged, and Instagram is the first source');
select is((select value from customer.client_identifiers where client_id = pg_temp.client('9820014001') and id_type = 'instagram'), 'asha.m',
  'the Instagram ID is kept, without the @');
select is((select string_agg(stage_no || ':' || coalesce(previous_remark, '-'), ',' order by stage_no) from customer.enquiry_steps s
            join pg_temp.enq('MK-INS-1001') e on s.enquiry_id = e.id), '2:-,3:wants polki set,5:-', 'every row is kept as a step');
select is((select "REMARK" || '|' || _status || '|' || _client_code from customer.sheet_instagram_fms where _row_key = 'MK-INS-1001-3. PROPOSAL PRODUCT DEMONSTRATION'),
  'price too high|applied|' || (select client_code from customer.clients where id = pg_temp.client('9820014001')),
  'the sheet''s own table has every column and the master client');

-- 3. A stage not done yet, and pooling with other sheets ------------------------------------------
-- The same phone already came in from Runo: same customer.
select customer_ingest_store('runo', jsonb_build_array(jsonb_build_object('row_key', 'call-1', 'sheet_row', 2, 'payload',
  jsonb_build_object('callId', 'call-1', 'Mobile Number', '+91 98200 14002', 'Name', 'Bina Shah', 'Interaction Date', '01/10/2026 11:00:00', 'Status', 'Interested', 'City', 'Mumbai'))),
  '{"next_row": 3}');
select customer_ingest_apply('runo', 100);
select customer_ingest_store('instagram_fms', jsonb_build_array(
  pg_temp.r(6, 'MK-INS-1002', '2. INTRODUCTION CALL', '{"CUSTOMER NAME": "Bina", "CUSTOMER CONTACT NUMBER": "9820014002", "INSTAGRAM ID": "bina_s", "CITY": "Pune", "NEW PLANNED": "18/11/2026 11:00:00", "FOLLOW UP COUNT": "2"}')),
  '{"next_row": 7}');
select customer_ingest_apply('instagram_fms', 100);
select is((select count(*)::int from customer.client_phones where phone = customer.normalize_phone('9820014002')), 1, 'a phone seen in Runo and Instagram is one customer');
select is((select primary_name || '|' || city from customer.clients where id = pg_temp.client('9820014002')), 'Bina|Mumbai',
  'the newest name is the main name; the call''s city outranks the Instagram city');
select is((select outcome || '|' || next_stage || '|' || next_due_at::text || '|' || next_doer_name from pg_temp.enq('MK-INS-1002')),
  'open|2. INTRODUCTION CALL|' || ('2026-11-18 11:00:00+05:30'::timestamptz)::text || '|MITU PATEL', 'a stage not done yet is the next step, due at NEW PLANNED');
select is((select count(*)::int from customer.interactions i join pg_temp.enq('MK-INS-1002') e on i.lead_id = e.id), 1, 'a stage not done yet is not a contact');
select is((select follow_up_count from customer.enquiry_steps s join pg_temp.enq('MK-INS-1002') e on s.enquiry_id = e.id), 2, 'the follow-up count is kept');

-- 4. Rows without a phone -----------------------------------------------------------------------
select customer_ingest_store('instagram_fms', jsonb_build_array(
  pg_temp.r(7, 'MK-INS-1003', '2. INTRODUCTION CALL', '{"CUSTOMER CONTACT NUMBER": "", "INSTAGRAM ID": "Asha.M", "ACTUAL TIME": "46335.5", "STATUS": "BUSY"}'),
  pg_temp.r(8, 'MK-INS-1004', '2. INTRODUCTION CALL', '{"CUSTOMER NAME": "Chetan", "CUSTOMER CONTACT NUMBER": "", "INSTAGRAM ID": "chetan.k"}'),
  pg_temp.r(9, 'MK-INS-1005', '2. INTRODUCTION CALL', '{"CUSTOMER NAME": "Dev", "CUSTOMER CONTACT NUMBER": "", "INSTAGRAM ID": ""}'),
  pg_temp.r(10, 'MK-INS-1006', '2. INTRODUCTION CALL', '{"CUSTOMER NAME": "Esha", "CUSTOMER CONTACT NUMBER": "12345", "INSTAGRAM ID": ""}')),
  '{"next_row": 11}');
select is(customer_ingest_apply('instagram_fms', 100) - 'pending', '{"applied": 4, "rejected": 0}'::jsonb, 'rows without a usable phone are kept too (0416)');
select is((select client_id from pg_temp.enq('MK-INS-1003')), pg_temp.client('9820014001'), 'no phone: matched on the Instagram ID of an earlier row');
select is((select occurred_at || '|' || successful || '|' || result || '|' || non_contact_reason from customer.interactions where external_ref = 'MK-INS-1003-2. INTRODUCTION CALL'),
  ('2026-11-09 12:00:00+05:30'::timestamptz)::text || '|false|not_connected|BUSY', 'a date written as a day number is read; BUSY is not reached');
select is((select primary_name || '|' || (select count(*) from customer.client_phones p where p.client_id = c.id) from customer.clients c join pg_temp.enq('MK-INS-1004') e on e.client_id = c.id),
  'Chetan|0', 'no phone and a new Instagram ID: a customer without a phone, found again by the Instagram ID');
select is((select string_agg(e.reference_number || ':' || coalesce(c.primary_name, '-') || ':' || (select count(*) from customer.client_phones p where p.client_id = c.id), ',' order by e.reference_number)
             from customer.enquiries e join customer.clients c on c.id = e.client_id where e.reference_number in ('MK-INS-1005', 'MK-INS-1006')),
  'MK-INS-1005:Dev:0,MK-INS-1006:Esha:0', 'a row with no phone or an invalid one becomes its own customer, without a phone');

-- 5. A row deleted from the sheet, and back ------------------------------------------------------
select customer.remove_source_row(id) from customer.ingest_rows where row_key = 'MK-INS-1001-3. PROPOSAL PRODUCT DEMONSTRATION';
select is((select outcome || '|' || step_count from pg_temp.enq('MK-INS-1001')), 'closed|2', 'removing a stage row works the enquiry out again');
select is((select archive_reason from customer.interactions where external_ref = 'MK-INS-1001-3. PROPOSAL PRODUCT DEMONSTRATION'), 'removed_from_sheet',
  'its contact leaves the timeline');
select customer.remove_source_row(id) from customer.ingest_rows where row_key = 'MK-INS-1004-2. INTRODUCTION CALL';
select is((select (e.archived_at is not null) || '|' || (c.archived_at is not null) || '|' || (o.archived_at is not null)
             from pg_temp.enq('MK-INS-1004') e join customer.clients c on c.id = e.client_id join customer.interactions o on o.id = e.opened_interaction_id),
  'true|true|true', 'an enquiry with no rows left is archived, with its message and a customer who has nothing else');
select customer_ingest_store('instagram_fms', jsonb_build_array(
  pg_temp.r(4, 'MK-INS-1001', '3. PROPOSAL PRODUCT DEMONSTRATION', '{"ACTUAL TIME": "07/11/2026 17:00:00", "STATUS": "NOT INTERESTED CLOSE THIS LEAD", "REMARK": "price too high", "PREVIOUS REMARK": "wants polki set"}'),
  pg_temp.r(8, 'MK-INS-1004', '2. INTRODUCTION CALL', '{"CUSTOMER NAME": "Chetan", "CUSTOMER CONTACT NUMBER": "", "INSTAGRAM ID": "chetan.k"}')),
  '{"scan": true, "scan_row": 11}');
select customer_ingest_apply('instagram_fms', 100);
select is((select outcome || '|' || step_count from pg_temp.enq('MK-INS-1001')), 'lost|3', 'a row that comes back is restored');
select is((select (e.archived_at is null) and (c.archived_at is null) and (o.archived_at is null)
             from pg_temp.enq('MK-INS-1004') e join customer.clients c on c.id = e.client_id join customer.interactions o on o.id = e.opened_interaction_id),
  true, 'with its enquiry, message and customer');
select is((select count(*)::int from customer.interactions where source = 'instagram_fms' and archived_at is null), 9, 'nothing is duplicated');

-- 6. Won, and an edit that undoes a stage ------------------------------------------------------------
select customer_ingest_store('doubletick_fms', jsonb_build_array(
  pg_temp.r(3, 'MK-DT-2001', '4. NEGOTIATION', '{"CUSTOMER CONTACT NUMBER": "9820014005", "INSTAGRAM ID": "", "ACTUAL TIME": "10/11/2026 16:00:00", "STATUS": "YES, THE CLIENT BOUGHT THE PRODUCT", "ADDRESS": "Juhu"}')),
  pg_temp.headers() || '{"next_row": 4}');
select customer_ingest_apply('doubletick_fms', 100);
select is((select outcome || '|' || channel from pg_temp.enq('MK-DT-2001', 'doubletick_fms')), 'won|whatsapp', 'a bought product wins the enquiry');
select is((select i.purpose || ':' || p.interest from customer.interactions i join customer.interaction_products p on p.interaction_id = i.id
            where i.external_ref = 'MK-DT-2001-4. NEGOTIATION'), 'purchase:bought', 'and marks the product bought on that contact');
select is((select address from customer.clients where id = pg_temp.client('9820014005')), 'Juhu', 'the DoubleTick address is read');
update customer.ingest_rows set updated_at = now() - interval '1 minute' where row_key = 'MK-DT-2001-4. NEGOTIATION';
select customer_ingest_store('doubletick_fms', jsonb_build_array(
  pg_temp.r(3, 'MK-DT-2001', '4. NEGOTIATION', '{"CUSTOMER CONTACT NUMBER": "9820014005", "INSTAGRAM ID": "", "ADDRESS": "Juhu"}')), '{"next_row": 4}');
select customer_ingest_apply('doubletick_fms', 100);
select is((select outcome || '|' || (select archive_reason from customer.interactions where external_ref = 'MK-DT-2001-4. NEGOTIATION') from pg_temp.enq('MK-DT-2001', 'doubletick_fms')),
  'open|step_not_done', 'a stage whose ACTUAL TIME is cleared is no longer a contact');

-- 7. Merge and purge ------------------------------------------------------------------------------------
select customer.merge_clients(pg_temp.client('9820014001'), (select client_id from pg_temp.enq('MK-INS-1004')), 'test', null);
select is((select client_id from pg_temp.enq('MK-INS-1004')), pg_temp.client('9820014001'), 'merging two customers moves the enquiries');
select is((customer.purge_source('doubletick_fms') ->> 'interactions')::int, 2, 'a sheet can be taken back');
select is((select count(*)::int from customer.enquiries where source = 'doubletick_fms'), 0, 'with its enquiries');

-- 8. Access ------------------------------------------------------------------------------------------------
select is(has_table_privilege('authenticated', 'customer.enquiries', 'select') or has_table_privilege('authenticated', 'customer.enquiry_steps', 'select')
          or has_function_privilege('authenticated', 'customer.apply_enquiry_row(uuid)', 'execute'), false, 'browsers cannot reach the enquiry tables or the import');
select is(has_function_privilege('service_role', 'customer.purge_source(text)', 'execute'), false, 'the purge stays out of reach of the API');

select * from finish();
rollback;
