-- 0413: the customer page and the interaction page show every detail.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

create temp table fx(label text primary key, id uuid, code text);
grant select on fx to authenticated, anon;
do $$
declare t uuid; t2 uuid; b uuid; b2 uuid; d uuid; d2 uuid; r record; aid uuid; pid uuid; c uuid;
begin
  insert into tenants(name, slug) values ('0413 test', 'customer-0413') returning id into t;
  insert into tenants(name, slug) values ('0413 other', 'customer-0413-other') returning id into t2;
  insert into customer.ingest_settings(tenant_id) values (t);
  insert into branches(tenant_id, name, code) values (t, 'MK Bandra', 'B0413') returning id into b;
  insert into branches(tenant_id, name, code) values (t2, '0413 Other', 'O0413') returning id into b2;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'CRM', 'C0413') returning id into d;
  insert into departments(tenant_id, branch_id, name, code) values (t2, b2, 'CRM', 'C0413O') returning id into d2;
  for r in select * from (values ('crm', t, b, d, 'crm', 'Priya Nair'), ('staff', t, b, d, 'staff', 'Staff Person'), ('other_crm', t2, b2, d2, 'crm', 'Other Crm')) v(kind, tn, br, dept, role, full_name) loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'cp-' || r.kind || '@example.invalid', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (r.tn, aid, r.br, r.dept, r.full_name, 'CP-' || upper(r.kind), 'cp-' || r.kind || '@example.invalid', r.role::user_role, 'active', 'active', true)
    returning id into pid;
    insert into fx values (r.kind || '_auth', aid, null);
  end loop;

  -- Two live Runo rows for one customer: a missed call, then a connected one with everything filled.
  perform customer_ingest_store('runo', jsonb_build_array(
    jsonb_build_object('row_key', 'p-1', 'sheet_row', 2, 'payload', jsonb_build_object(
      'callId', 'p-1', 'Mobile Number', '9820008001', 'Name', 'Asha', 'Interaction Date', '01/11/2026 10:00:00', 'Status', 'Not contacted',
      'Non contact reason', 'Not picking', 'Assigned To', 'Priya Nair', 'City', 'Thane')),
    jsonb_build_object('row_key', 'p-2', 'sheet_row', 3, 'payload', jsonb_build_object(
      'callId', 'p-2', 'Mobile Number', '9820008001', 'Name', 'Asha', 'Last Name', 'Jain', 'Interaction Date', '02/11/2026 16:30:00', 'Status', 'Invited to Store',
      'Assigned To', 'Priya Nair', 'Attended By', 'Rahul', 'Store', 'MK Bandra', 'Notes', 'Wants a bridal set before December',
      'City', 'Mumbai', 'Gift Given', 'Calendar', 'Product Code', 'MK-NK-1015', 'Product Category', 'Necklace',
      'Hot Followup On', '06/11/2026', 'Interested Now - Set Day Of Visit', '08/11/2026 17:00:00'))),
    '{"headers": ["callId", "Interaction Date", "Mobile Number", "Name", "Last Name", "Status", "Non contact reason", "Assigned To", "Attended By", "Store", "Notes", "City", "Gift Given", "Product Code", "Product Category", "Hot Followup On", "Interested Now - Set Day Of Visit", "Email"], "next_row": 4}');
  perform customer_ingest_apply('runo', 10);
  select cl.id into c from customer.client_phones ph join customer.clients cl on cl.id = ph.client_id where ph.tenant_id = t and ph.phone = '919820008001';
  insert into fx values ('asha', c, (select client_code from customer.clients where id = c));
  insert into fx values ('call', null, (select interaction_code from customer.interactions where external_ref = 'p-2' and tenant_id = t));
  insert into fx values ('missed', null, (select interaction_code from customer.interactions where external_ref = 'p-1' and tenant_id = t));
end $$;
create function pg_temp.code(p text) returns text language sql as $$ select code from fx where label = p $$;
create function pg_temp.act_as(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce((select id::text from fx where label = p || '_auth'), ''), true);
$$;

select is(has_function_privilege('anon', 'public.customer_get_client_page(text)', 'execute')
       or has_function_privilege('anon', 'public.customer_get_interaction_page(text)', 'execute'), false, 'anon cannot open either page');

set local role authenticated;
select pg_temp.act_as('crm');
create temp table pg as select customer_get_client_page(lower(pg_temp.code('asha'))) as c, customer_get_interaction_page(pg_temp.code('call')) as i,
                               customer_get_interaction_page(pg_temp.code('missed')) as m;

-- The customer page
select is(c -> 'client' ->> 'primary_name', 'Asha Jain', 'the page opens by MKC code, in any letter case') from pg;
select is((select string_agg((a ->> 'label') || '=' || (a ->> 'value') || ':' || (a ->> 'is_current'), ', ' order by (a ->> 'label'), (a ->> 'is_current') desc)
             from jsonb_array_elements(c -> 'answers') a where a ->> 'field_key' in ('city', 'gift_given')),
  'City=Mumbai:true, City=Thane:false, Gift Given=Calendar:true', 'every answer is listed with its history, including answers that have no profile column') from pg;
select is((c -> 'answers' -> 0 ->> 'source_label'), 'Runo calling', 'each answer names where it came from') from pg;
select is((select string_agg((f ->> 'kind') || ':' || (f ->> 'status') || ':' || (f ->> 'origin_interaction_code' is not null), ',' order by f ->> 'kind')
             from jsonb_array_elements(c -> 'follow_ups') f), 'hot:pending:true,retry:done:true', 'every follow-up is listed, open and closed, linked to its interaction') from pg;
select is((c -> 'appointments' -> 0 ->> 'type') || '|' || (c -> 'appointments' -> 0 ->> 'branch') || '|' || (c -> 'appointments' -> 0 ->> 'origin_interaction_code' = pg_temp.code('call')),
  'store|MK Bandra|true', 'appointments are listed with branch and the interaction that booked them') from pg;
select is((c -> 'products' -> 0 ->> 'code') || '|' || (c -> 'products' -> 0 ->> 'interaction_code' = pg_temp.code('call')), 'MK-NK-1015|true', 'products link back to the interaction') from pg;
select is((c -> 'sheet_rows' -> 0 ->> 'label') || '|' || (c -> 'sheet_rows' -> 0 ->> 'rows'), 'Runo live interactions|2', 'the page says how many rows each sheet holds for the customer') from pg;

-- The interaction page
select is((i -> 'interaction' ->> 'staff') || '|' || (i -> 'interaction' ->> 'attended_by') || '|' || (i -> 'interaction' ->> 'branch') || '|' || (i -> 'interaction' ->> 'notes'),
  'Priya Nair|Rahul|MK Bandra|Wants a bridal set before December', 'who called, who attended, where, and the remark') from pg;
select is((i -> 'client' ->> 'client_code') = pg_temp.code('asha') and (i -> 'client' ->> 'phone') = '919820008001', true, 'it links back to the customer') from pg;
select is((i -> 'follow_ups_created' -> 0 ->> 'kind') || '|' || (i -> 'follow_ups_closed' -> 0 ->> 'kind') || '|' || (i -> 'appointments_created' -> 0 ->> 'type')
          || '|' || (i -> 'follow_ups_closed' -> 0 ->> 'origin_interaction_code' = pg_temp.code('missed')),
  'hot|retry|store|true', 'what it created and what it closed') from pg;
select is(jsonb_array_length(i -> 'sheet_row' -> 'columns'), 18, 'every column of the sheet is listed, filled or not') from pg;
select is((select string_agg((col ->> 'header') || '=' || coalesce(col ->> 'value', '(empty)'), ', ' order by ord)
             from jsonb_array_elements(i -> 'sheet_row' -> 'columns') with ordinality t(col, ord) where ord in (1, 2, 11, 18)),
  'callId=p-2, Interaction Date=02/11/2026 16:30:00, Notes=Wants a bridal set before December, Email=(empty)', 'in sheet order, with the value exactly as the sheet has it') from pg;
select is((m -> 'interaction' ->> 'result') || '|' || (m -> 'interaction' ->> 'non_contact_reason') || '|' || (m -> 'follow_ups_created' -> 0 ->> 'closed_by_interaction_code' = pg_temp.code('call')),
  'not_connected|Not picking|true', 'a missed call shows its reason and which call later closed its follow-up') from pg;

-- Who can open
select pg_temp.act_as('other_crm');
select throws_ok(format('select customer_get_client_page(%L)', pg_temp.code('asha')), 'P0002', 'Client not found', 'another company cannot open the customer');
select pg_temp.act_as('staff');
select throws_ok(format('select customer_get_interaction_page(%L)', pg_temp.code('call')), '42501', 'Section access denied', 'a user without CRM access cannot open the interaction');
reset role;

select * from finish();
rollback;
