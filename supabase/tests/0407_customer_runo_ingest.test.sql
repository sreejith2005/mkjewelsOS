-- 0407: Runo sheet rows -> clients, interactions, follow-ups, appointments.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(30);

create temp table fx(label text primary key, id uuid);
do $$
declare t uuid; b uuid; d uuid; r record; aid uuid; pid uuid;
begin
  insert into tenants(name, slug) values ('0407 test', 'customer-0407') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into branches(tenant_id, name, code) values (t, 'MK Bandra', 'B0407') returning id into b;
  insert into branches(tenant_id, name, code) values (t, 'Ra Ra Ru', 'R0407');
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'CRM', 'C0407') returning id into d;
  insert into fx values ('tenant', t), ('bandra', b);
  for r in select * from (values ('priya', 'Priya Nair'), ('rahul1', 'Rahul Shah'), ('rahul2', 'Rahul Mehta')) v(kind, full_name) loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'ri-' || r.kind || '@example.invalid', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (t, aid, b, d, r.full_name, 'RI-' || upper(r.kind), 'ri-' || r.kind || '@example.invalid', 'crm', 'active', 'active', true)
    returning id into pid;
    insert into fx values (r.kind, pid);
  end loop;
end $$;
create function pg_temp.id(p text) returns uuid language sql as $$ select id from fx where label = p $$;
create function pg_temp.client(p_phone text) returns uuid language sql as $$
  select client_id from customer.client_phones where tenant_id = pg_temp.id('tenant') and phone = customer.normalize_phone(p_phone) $$;

-- 1. Readers -------------------------------------------------------------------------
select is(customer.parse_sheet_timestamp('01/10/2026 11:41:47'), '2026-10-01 11:41:47+05:30'::timestamptz, 'a sheet date-time is read day first, India time');
select is(customer.parse_sheet_timestamp('5/11/2026'), '2026-11-05 00:00+05:30'::timestamptz, 'a date without a time is midnight');
select is(customer.parse_sheet_timestamp('tomorrow'), null, 'an unreadable date is empty, not an error');
select is(customer.compose_profile_date('12', 'April', '1988') || '|' || customer.compose_profile_date('2', '12', '') || '|' || coalesce(customer.compose_profile_date('31', 'Feb', '1990'), 'null'),
  '1988-04-12|--12-02|null', 'Date / Month / Year make a birthday, with or without the year');

-- 2. Rows arrive --------------------------------------------------------------------------
select is(customer_ingest_sheet_rows('runo', jsonb_build_array(
  jsonb_build_object('row_key', 'c-1', 'sheet_row', 2, 'payload', jsonb_build_object(
    'callId', 'c-1', 'Mobile Number', '9820002001', 'Name', 'Meera', 'Last Name', 'Shah', 'Customer Id', 'RUNO-77',
    'Interaction Date', '02/11/2026 12:00:00', 'Status', 'Not contacted', 'Non contact reason', 'Not picking',
    'Assigned To', 'Priya', 'Store', 'MK Bandra', 'City', '')),
  jsonb_build_object('row_key', 'c-2', 'sheet_row', 3, 'payload', jsonb_build_object(
    'callId', 'c-2', 'Mobile Number', '+91 98200 02001', 'Name', 'Meera', 'Last Name', 'Shah',
    'Interaction Date', '03/11/2026 16:30:00', 'Status', 'Invited to Store', 'Assigned To', 'Priya Nair', 'Attended By', 'Rahul', 'Store', 'Bandra',
    'Interested Now - Set Day Of Visit', '08/11/2026 17:00:00', 'Hot Followup On', '06/11/2026',
    'Product Code', 'MK-NK-1015, MK-ER-2040', 'Product Category', 'Necklace', 'City', 'Mumbai', 'Caste', 'JAIN', 'Snack', 'NA',
    'Email', 'Meera@Example.com', 'Date Of Birth', 'Giving', 'Date', '12', 'Month', 'April', 'Year', '1988', 'Date Of Anniversary', 'Married',
    'Spouse Name', 'Ayush Shah', 'Referrer Name', 'Kiran Rao', 'Referrer Number', '9820002009', 'Billing Phone Number Add +91', '+919820002002')),
  jsonb_build_object('row_key', 'c-3', 'sheet_row', 4, 'payload', jsonb_build_object(
    'callId', 'c-3', 'Mobile Number', '12345', 'Name', 'Bad Phone', 'Interaction Date', '03/11/2026 17:00:00', 'Status', 'Interested')),
  jsonb_build_object('row_key', 'c-4', 'sheet_row', 5, 'payload', jsonb_build_object(
    'callId', 'c-4', 'Mobile Number', '9820002003', 'Name', 'No Date', 'Status', 'Interested')),
  jsonb_build_object('row_key', '', 'sheet_row', 6, 'payload', jsonb_build_object('Name', 'no key'))
), 6) ->> 'new', '4', 'rows are stored unchanged; a row without a key is skipped');
select is(customer_ingest_sheet_rows('runo', jsonb_build_array(
  jsonb_build_object('row_key', 'c-1', 'sheet_row', 2, 'payload', (select payload from customer.ingest_rows where row_key = 'c-1'))), 6)::text,
  '{"new": 0, "changed": 0, "received": 1}', 'the same row read again changes nothing');
select is((customer_ingest_state('runo') ->> 'next_row') || '|' || (customer_ingest_state('runo') ->> 'pending'), '6|4', 'the state remembers where to continue');

-- 3. Apply ------------------------------------------------------------------------------------
select is(customer_ingest_apply('runo', 100)::text, '{"applied": 2, "pending": 0, "rejected": 2}', 'good rows are applied; bad rows are rejected, not lost');
select is((select string_agg(row_key || ':' || reject_reason, ' | ' order by row_key) from customer.ingest_rows where status = 'rejected'),
  'c-3:Not a valid phone number | c-4:Interaction Date is missing or unreadable', 'each rejected row says why');
select is((select count(*)::int from customer.clients where tenant_id = pg_temp.id('tenant') and id = pg_temp.client('9820002001')), 1, 'both calls matched one client by phone');
select is((select interaction_count || '|' || successful_interaction_count || '|' || primary_name || '|' || (last_contacted_at = '2026-11-03 16:30+05:30')
            from customer.clients where id = pg_temp.client('9820002001')), '2|1|Meera Shah|true', 'the client has two interactions, one that reached them');
select is((select result || '|' || successful || '|' || (staff_user_id = pg_temp.id('priya')) || '|' || (branch_id = pg_temp.id('bandra'))
            from customer.interactions where external_ref = 'c-1'), 'not_connected|false|true|true',
  'a missed call: not connected, first name matched to the user, store matched to the branch');
select is((select kind || '|' || status from customer.follow_ups f join customer.interactions i on i.id = f.origin_interaction_id where i.external_ref = 'c-1'),
  'retry|done', 'the missed call made a retry follow-up, and the later connected call closed it');
select is((select string_agg(kind || ':' || status, ',' order by kind) from customer.follow_ups f join customer.interactions i on i.id = f.origin_interaction_id where i.external_ref = 'c-2'),
  'hot:pending', 'Hot Followup On became a hot follow-up');
select is((select type || '|' || status || '|' || (scheduled_at = '2026-11-08 17:00+05:30') || '|' || (branch_id = pg_temp.id('bandra'))
            from customer.appointments where client_id = pg_temp.client('9820002001')), 'store|booked|true|true', 'Set Day Of Visit became a store appointment');
select is((select string_agg(coalesce(product_code, '-') || '/' || coalesce(product_category, '-'), ',' order by product_code)
            from customer.interaction_products p join customer.interactions i on i.id = p.interaction_id where i.external_ref = 'c-2'),
  'MK-ER-2040/Necklace,MK-NK-1015/Necklace', 'two product codes with one category are two products');
select is((select city || '|' || community || '|' || coalesce(snack, 'null') || '|' || email || '|' || dob || '|' || dob_status || '|' || marital_status
            from customer.clients where id = pg_temp.client('9820002001')), 'Mumbai|JAIN|null|meera@example.com|1988-04-12|given|Married',
  'profile answers are filled; NA is ignored; the birthday comes from Date / Month / Year');
select is((select string_agg(phone || ':' || kind, ',' order by phone) from customer.client_phones where client_id = pg_temp.client('9820002001')),
  '919820002001:primary,919820002002:billing', 'the billing number is kept on the same client');
select is((select count(*)::int from customer.clients c where c.household_id = (select household_id from customer.clients where id = pg_temp.client('9820002001'))
            and c.primary_name = 'Ayush Shah'), 1, 'a spouse without a phone is a client in the same family');
select is((select referred_by_client_id from customer.clients where id = pg_temp.client('9820002001')), pg_temp.client('9820002009'), 'the referrer is linked');
select is((select value from customer.client_identifiers where client_id = pg_temp.client('9820002001') and id_type = 'runo_customer_id'), 'RUNO-77', 'the Runo customer id is kept as a lookup');

-- 4. Staff names --------------------------------------------------------------------------------
select is((select string_agg(raw_name || ':' || matched_by, ',' order by raw_name) from customer.staff_aliases where tenant_id = pg_temp.id('tenant')),
  'Priya:first_name,Priya Nair:full_name,Rahul:none', 'unique names match a user; a first name shared by two users is left for a person');
select is((select attended_by_name || '|' || coalesce(attended_by_user_id::text, 'none') from customer.interactions where external_ref = 'c-2'), 'Rahul|none',
  'an unmatched name is kept as written');
select is(customer.set_staff_alias(pg_temp.id('tenant'), 'rahul', pg_temp.id('rahul2')), 1, 'mapping the name once fixes the imported interactions');
select is((select attended_by_user_id from customer.interactions where external_ref = 'c-2'), pg_temp.id('rahul2'), 'the interaction now points at the user');

-- 5. A changed row is applied again, without duplicates ---------------------------------------
select is(customer_ingest_sheet_rows('runo', jsonb_build_array(
  jsonb_build_object('row_key', 'c-2', 'sheet_row', 3, 'payload',
    (select payload || '{"Status": "Not Interested", "Product Code": "MK-NK-1015"}'::jsonb from customer.ingest_rows where row_key = 'c-2'))), 6) ->> 'changed', '1',
  'an edited sheet row is queued again');
select is(customer_ingest_apply('runo', 100) ->> 'applied', '1', 'and applied');
select is((select count(*)::int || '|' || max(outcome) filter (where external_ref = 'c-2') || '|' || max(result) filter (where external_ref = 'c-2')
            from customer.interactions where client_id = pg_temp.client('9820002001')), '2|Not Interested|negative', 'the same interaction is updated; none is added');
select is((select count(*)::int from customer.interaction_products p join customer.interactions i on i.id = p.interaction_id where i.external_ref = 'c-2'), 1,
  'products follow the edited row');

-- 6. Service only ---------------------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.customer_ingest_sheet_rows(text,jsonb,integer)', 'execute')
       or has_function_privilege('authenticated', 'public.customer_ingest_apply(text,integer)', 'execute')
       or has_function_privilege('anon', 'public.customer_ingest_state(text)', 'execute')
       or has_table_privilege('authenticated', 'customer.ingest_rows', 'select'), false,
  'only the service role can import or read raw rows');

select * from finish();
rollback;
