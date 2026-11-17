-- 0419: NOT BOUGHT FMS and REFERENCES CALLING FMS.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; u uuid;
begin
  insert into tenants(name, slug) values ('0419 test', 'customer-0419') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into user_profiles(tenant_id, employee_name) values (t, 'Reshma Ali') returning id into u;
  insert into fx values ('tenant', t), ('reshma', u);
end $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = (select id from fx where label = 'tenant') and phone = customer.normalize_phone(p_phone) $$;

-- The walk-in visit the follow-up comes from.
select customer_ingest_store('walkin', jsonb_build_array(jsonb_build_object('row_key', 'MK-NB-1', 'sheet_row', 2, 'payload', jsonb_build_object(
  'TIMESTAMP', '2026-11-01 12:00:00', 'CLIENT VISIT DATE', '2026-11-01', 'CLIENT NAME', 'Asha Mehta', 'CLIENT PHONE', '9820019001',
  'CLIENT BOUGHT ANY PRODUCT?', 'NO', 'REFERENCE NUMBER', 'MK-NB-1')),
  jsonb_build_object('row_key', 'MK-NB-2', 'sheet_row', 3, 'payload', jsonb_build_object(
  'TIMESTAMP', '2026-11-01 13:00:00', 'CLIENT VISIT DATE', '2026-11-01', 'CLIENT NAME', 'Divya', 'CLIENT PHONE', '9820019060',
  'CLIENT BOUGHT ANY PRODUCT?', 'NO', 'REFERENCE NUMBER', 'MK-NB-2'))), '{"next_row": 4}');
select customer_ingest_apply('walkin', 100);

create function pg_temp.nb(p_row integer, p_stage text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row_key', 'MK-NB-1-' || p_stage, 'sheet_row', p_row, 'payload', jsonb_build_object(
    'Timestamp', '01/11/2026 12:30:00', 'REFERENCE NUMBER', 'MK-NB-1', 'BRANCH', 'BANDRA', 'NAME OF THE CRM', 'RESHMA ALI',
    'NAME OF THE CLIENT', 'Asha Mehta', 'PHONE NUMBER OF THE CLIENT', '+919820019001', 'BILLING PHONE NUMBER', '+919820019001',
    'REMARK', 'liked polki', 'NOT BOUGHT REASONS', 'Decision Pending', 'CITY', 'THANE', 'COMBO', 'MK-NB-1-' || p_stage,
    'CRM', 'RESHMA ALI', 'PLANNED', '02/11/2026 12:30:00', 'WORK STAGE', p_stage, 'FMS', 'NOT BOUGHT FMS') || p_extra) $$;
select customer_ingest_store('not_bought_fms', jsonb_build_array(
  pg_temp.nb(3, '2. NOT BOUGHT FOLLOWUP 1', '{"ACTUAL": "02/11/2026 15:00:00", "STATUS": "YES (CLIENT NEED FOLLOW-UP)", "REMARKS": "call after Diwali", "NEXT FOLLOW UP DATE": "10/11/2026 11:00:00"}'),
  pg_temp.nb(4, '3. NOT BOUGHT FOLLOWUP 2', '{"ACTUAL": "10/11/2026 11:30:00", "STATUS": "RINGING / NOT ANSWERED"}'),
  pg_temp.nb(5, '4. NOT BOUGHT FOLLOWUP 3', '{"NEW PLANNED": "12/11/2026 11:00:00"}')),
  '{"headers": ["Timestamp", "REFERENCE NUMBER", "NAME OF THE CLIENT", "PHONE NUMBER OF THE CLIENT", "COMBO", "WORK STAGE", "ACTUAL", "STATUS", "REMARKS"], "next_row": 6}');
select is(customer_ingest_apply('not_bought_fms', 100) - 'pending', '{"applied": 3, "rejected": 0}'::jsonb, 'not-bought rows applied');
select is((select outcome || '|' || step_count || '|' || next_stage || '|' || channel from customer.enquiries where source = 'not_bought_fms' and reference_number = 'MK-NB-1'),
  'open|3|4. NOT BOUGHT FOLLOWUP 3|walk_in', 'one follow-up case per visit reference, with its steps and the step still to do');
select is((select string_agg(i.channel || ':' || i.purpose || ':' || i.outcome || ':' || i.result || ':' || i.successful, ',' order by i.occurred_at)
             from customer.interactions i where i.source = 'not_bought_fms'),
  'not_recorded:not_bought:YES (CLIENT NEED FOLLOW-UP):positive:true,not_recorded:not_bought:RINGING / NOT ANSWERED:not_connected:false',
  'each completed follow-up is a contact, status as written');
select is((select count(*)::int from customer.interactions i join customer.interactions v on v.id = i.parent_interaction_id
            where i.source = 'not_bought_fms' and v.source = 'walkin' and v.external_ref = 'MK-NB-1'), 2, 'linked to the store visit it follows');
select is((select staff_user_id || '|' || notes from customer.interactions where external_ref = 'MK-NB-1-2. NOT BOUGHT FOLLOWUP 1'),
  (select id from fx where label = 'reshma') || '|call after Diwali', 'the CRM who did it and the follow-up remark');
select is((select kind || '|' || due_at::text || '|' || status from customer.follow_ups f join customer.interactions i on i.id = f.origin_interaction_id
            where i.external_ref = 'MK-NB-1-2. NOT BOUGHT FOLLOWUP 1'),
  'not_bought|' || ('2026-11-10 11:00:00+05:30'::timestamptz)::text || '|pending', 'NEXT FOLLOW UP DATE is a not-bought follow-up');
select is((select count(distinct client_id)::int from customer.ingest_rows where row_key like 'MK-NB-1%'), 1, 'the same customer as the visit');
select is((select city from customer.clients where id = pg_temp.client('9820019001')), 'THANE', 'its answers reach the profile');

-- References calling: same person as the REFERRALS tab, even without a valid phone.
select customer_ingest_store('referral', jsonb_build_array(
  jsonb_build_object('row_key', '01/11/2026 13:20:00|98200190|Kavita', 'sheet_row', 2, 'payload', jsonb_build_object(
    'TIMESTAMP', '01/11/2026 13:20:00', 'REFERENCE GIVEN BY CLIENT NAME', 'DIVYA', 'REFERRAL NAME', 'Kavita', 'REFERRAL NUMBER', '98200190'))), '{"next_row": 3}');
select customer_ingest_apply('referral', 100);
select customer_ingest_store('references_calling_fms', jsonb_build_array(
  jsonb_build_object('row_key', '01/11/2026 13:20:00|98200190|Kavita', 'sheet_row', 3, 'payload', jsonb_build_object(
    'TIMESTAMP', '01/11/2026 13:20:00', 'REFERENCE GIVEN BY', 'DIVYA', 'NAME OF THE REFERENCE', 'Kavita', 'NUMBER OF THE REFERENCE', '98200190',
    'LOCATION OF THE REFERENCE', 'BORIVALI', 'CRM', 'SRAVANI MAHARANA', 'CRM NAME', 'RESHMA ALI', 'ACTUAL', '03/11/2026 11:00:00',
    'STATUS', 'YES INTERESTED', 'REMARKS', 'will visit', 'WORK STAGE', '2. FOLLOW UP FOR LEAD')),
  jsonb_build_object('row_key', '01/11/2026 13:21:00|9820019071|Lalit', 'sheet_row', 4, 'payload', jsonb_build_object(
    'TIMESTAMP', '01/11/2026 13:21:00', 'REFERENCE GIVEN BY', 'DIVYA', 'NAME OF THE REFERENCE', 'Lalit', 'NUMBER OF THE REFERENCE', '9820019071',
    'CRM', 'SRAVANI MAHARANA', 'WORK STAGE', '2. FOLLOW UP FOR LEAD'))),
  '{"headers": ["TIMESTAMP", "REFERENCE GIVEN BY", "NAME OF THE REFERENCE", "NUMBER OF THE REFERENCE", "ACTUAL", "STATUS"], "next_row": 5}');
select is(customer_ingest_apply('references_calling_fms', 100) - 'pending', '{"applied": 2, "rejected": 0}'::jsonb, 'reference calls applied');
select is((select count(distinct client_id)::int from customer.ingest_rows where row_key = '01/11/2026 13:20:00|98200190|Kavita'), 1,
  'a person without a valid phone is the same customer in REFERRALS and REFERENCES CALLING');
select is((select i.outcome || '|' || i.result || '|' || i.staff_name || '|' || i.notes || '|' || c.referred_by_client_id::text
             from customer.interactions i join customer.clients c on c.id = i.client_id where i.source = 'references_calling_fms'),
  'YES INTERESTED|positive|RESHMA ALI|will visit|' || pg_temp.client('9820019060'), 'a made call is a contact, by who made it; the giver is linked');
select is((select count(*)::int from customer.interactions i join customer.ingest_rows r on r.client_id = i.client_id
            where r.row_key = '01/11/2026 13:21:00|9820019071|Lalit' and i.source = 'references_calling_fms'), 0, 'a call not made yet is not a contact');
select is((select value from customer.client_field_values v join customer.ingest_rows r on r.client_id = v.client_id
            where r.row_key = '01/11/2026 13:20:00|98200190|Kavita' and r.source = 'references_calling_fms' and v.field_key = 'location'),
  'BORIVALI', 'the reference''s location is kept as written');

select * from finish();
rollback;
