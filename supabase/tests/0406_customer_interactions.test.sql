-- 0406: interactions, follow-ups, appointments, client counters, timeline.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(27);

create temp table fx(label text primary key, id uuid);
grant select on fx to authenticated, anon;
do $$
declare t uuid; t2 uuid; b uuid; b2 uuid; d uuid; d2 uuid; r record; aid uuid; pid uuid;
begin
  insert into tenants(name, slug) values ('0406 test', 'customer-0406') returning id into t;
  insert into tenants(name, slug) values ('0406 other', 'customer-0406-other') returning id into t2;
  insert into branches(tenant_id, name, code) values (t, '0406 Bandra', 'B0406') returning id into b;
  insert into branches(tenant_id, name, code) values (t2, '0406 Other', 'O0406') returning id into b2;
  insert into departments(tenant_id, branch_id, name, code) values (t, b, 'CRM', 'C0406') returning id into d;
  insert into departments(tenant_id, branch_id, name, code) values (t2, b2, 'CRM', 'C0406O') returning id into d2;
  insert into fx values ('tenant', t), ('branch', b);
  for r in select * from (values ('crm', t, b, d, 'crm'), ('staff', t, b, d, 'staff'), ('other_crm', t2, b2, d2, 'crm')) v(kind, tn, br, dept, role) loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'ci-' || r.kind || '@example.invalid', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
    values (r.tn, aid, r.br, r.dept, 'CI ' || r.kind, 'CI-' || upper(r.kind), 'ci-' || r.kind || '@example.invalid', r.role::user_role, 'active', 'active', true)
    returning id into pid;
    insert into fx values (r.kind, pid), (r.kind || '_auth', aid);
  end loop;
  insert into fx values ('rohan', customer.find_or_create_client(t, '9820001001', 'Rohan Mehta', 'instagram_fms', '2026-11-01 11:00+05:30'));
  insert into fx values ('other', customer.find_or_create_client(t, '9820001002', 'Other Person', 'runo', '2026-11-01 11:00+05:30'));
end $$;
create function pg_temp.id(p text) returns uuid language sql as $$ select id from fx where label = p $$;
create function pg_temp.act_as(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce((select id::text from fx where label = p || '_auth'), ''), true);
$$;
create function pg_temp.row(p_at text, p_channel text, p_direction text, p_purpose text, p_source text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('occurred_at', p_at, 'channel', p_channel, 'direction', p_direction, 'purpose', p_purpose, 'source', p_source) || p_extra;
$$;

-- 1. Instagram DM, then a missed call, then a connected call ----------------------
insert into fx values ('dm', customer.record_interaction(pg_temp.id('rohan'),
  pg_temp.row('2026-11-01 11:00+05:30', 'instagram', 'inbound', 'enquiry', 'instagram_fms', '{"external_ref": "MK-DIM-1015"}')));
select ok((select interaction_code ~ '^MKI-\d+$' from customer.interactions where id = pg_temp.id('dm')), 'an interaction gets its own MKI code');
insert into fx values ('missed', customer.record_interaction(pg_temp.id('rohan'),
  pg_temp.row('2026-11-02 12:00+05:30', 'call', 'outbound', 'enquiry', 'runo',
    jsonb_build_object('external_ref', 'call-1', 'successful', false, 'outcome', 'Not contacted', 'non_contact_reason', 'Not picking', 'staff_user_id', pg_temp.id('crm')))));
select is((select result from customer.interactions where id = pg_temp.id('missed')), 'not_connected', 'a call that did not connect is read as not connected');
select is((select interaction_count || '|' || successful_interaction_count || '|' || (last_contacted_at = '2026-11-01 11:00+05:30') || '|' || (last_attempt_at = '2026-11-02 12:00+05:30')
            from customer.clients where id = pg_temp.id('rohan')), '2|1|true|true',
  'a missed call counts as an attempt but does not move the last-contacted date');
select is(customer.create_follow_up(pg_temp.id('rohan'), 'retry', '2026-11-03 12:00+05:30', pg_temp.id('missed'), pg_temp.id('crm')) is not null, true, 'a missed call can create a retry follow-up');
insert into fx values ('call', customer.record_interaction(pg_temp.id('rohan'),
  pg_temp.row('2026-11-03 16:30+05:30', 'call', 'outbound', 'enquiry', 'runo',
    jsonb_build_object('external_ref', 'call-2', 'outcome', 'Invited to Store', 'result', 'positive', 'staff_user_id', pg_temp.id('crm'), 'parent_interaction_id', pg_temp.id('dm')))));
select is((select interaction_count || '|' || successful_interaction_count || '|' || lifecycle_stage || '|' || (last_contacted_at = '2026-11-03 16:30+05:30')
            from customer.clients where id = pg_temp.id('rohan')), '3|2|engaged|true', 'a connected call updates the counters and the stage');
select is(customer.close_follow_ups(pg_temp.id('rohan'), pg_temp.id('call')), 1, 'the connected call closes the waiting follow-up');
select is((select status || '|' || (closed_by_interaction_id = pg_temp.id('call')) from customer.follow_ups where origin_interaction_id = pg_temp.id('missed')), 'done|true',
  'and the follow-up records which call closed it');
select is(customer.close_follow_ups(pg_temp.id('rohan'), pg_temp.id('missed')), 0, 'a call that did not connect closes nothing');

-- 2. Re-import is safe ---------------------------------------------------------------
select is(customer.record_interaction(pg_temp.id('rohan'),
  pg_temp.row('2026-11-03 16:30+05:30', 'call', 'outbound', 'enquiry', 'runo',
    jsonb_build_object('external_ref', 'call-2', 'outcome', 'Interested', 'result', 'positive', 'staff_user_id', pg_temp.id('crm')))), pg_temp.id('call'),
  'the same source row imported again returns the same interaction');
select is((select count(*)::int || '|' || max(outcome) filter (where id = pg_temp.id('call')) from customer.interactions where client_id = pg_temp.id('rohan')), '3|Interested',
  'no duplicate is created and the changed outcome is saved');
select is((select parent_interaction_id from customer.interactions where id = pg_temp.id('call')), pg_temp.id('dm'), 'a re-import does not erase an existing link');
select throws_ok($$select customer.record_interaction(pg_temp.id('rohan'), '{"channel": "call"}')$$, '22023', null, 'a row without the required fields is refused');
select throws_ok($$select customer.record_interaction(pg_temp.id('rohan'), pg_temp.row('2026-11-03 16:30+05:30', 'fax', 'outbound', 'enquiry', 'runo'))$$, '23514', null,
  'an unknown channel is refused');

-- 3. Appointment, products, walk-in ---------------------------------------------------
insert into fx values ('appt', customer.create_appointment(pg_temp.id('rohan'), 'store', '2026-11-08 17:00+05:30', pg_temp.id('call'), pg_temp.id('branch')));
select is(customer.create_appointment(pg_temp.id('rohan'), 'store', '2026-11-09 17:00+05:30', pg_temp.id('call')), pg_temp.id('appt'),
  'an appointment from the same call is moved, not duplicated');
select is((select appointment_code ~ '^MKA-\d+$' and scheduled_at = '2026-11-09 17:00+05:30' from customer.appointments where id = pg_temp.id('appt')), true, 'it has an MKA code and the new date');
select customer.add_interaction_product(pg_temp.id('call'), 'MK-NK-1015', 'Necklace');
select customer.add_interaction_product(pg_temp.id('call'), 'MK-NK-1015', 'Necklace');
select is((select count(*)::int from customer.interaction_products where interaction_id = pg_temp.id('call')), 1, 'a product is stored once per interaction');
insert into fx values ('visit', customer.record_interaction(pg_temp.id('rohan'),
  pg_temp.row('2026-11-09 17:20+05:30', 'walk_in', 'in_person', 'visit', 'walkin', jsonb_build_object('branch_id', pg_temp.id('branch')))));
select is((select lifecycle_stage || '|' || first_source from customer.clients where id = pg_temp.id('rohan')), 'visited|instagram_fms',
  'after a walk-in the stage is visited and the first source is still Instagram');
select is((select count(*)::int from customer.clients c where c.first_source = 'instagram_fms'
            and exists (select 1 from customer.interactions i where i.client_id = c.id and i.channel = 'walk_in')), 1,
  'the director''s question - Instagram enquiries that walked in - is one query');

-- 4. Old data loaded later ---------------------------------------------------------------
select customer.record_interaction(pg_temp.id('rohan'), pg_temp.row('2025-03-01 10:00+05:30', 'exhibition', 'in_person', 'exhibition', 'exhibition'));
select is((select first_source || '|' || (first_seen_at = '2025-03-01 10:00+05:30') || '|' || (last_contacted_at = '2026-11-09 17:20+05:30') from customer.clients where id = pg_temp.id('rohan')),
  'exhibition|true|true', 'an older interaction loaded later becomes the first source and does not move the last contact');

-- 5. Merge moves the history -----------------------------------------------------------
select customer.record_interaction(pg_temp.id('other'), pg_temp.row('2026-11-10 10:00+05:30', 'call', 'inbound', 'enquiry', 'runo'));
select customer.merge_clients(pg_temp.id('rohan'), pg_temp.id('other'), 'same person', null);
select is((select interaction_count from customer.clients where id = pg_temp.id('rohan')), 6, 'merge moves the other client''s interactions and recounts');
select customer.record_interaction(pg_temp.id('other'), pg_temp.row('2026-11-11 10:00+05:30', 'call', 'inbound', 'enquiry', 'runo'));
select is((select interaction_count from customer.clients where id = pg_temp.id('rohan')), 7,
  'a later row for the merged client lands on the kept client');

-- 6. Who can read -----------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'customer.record_interaction(uuid,jsonb)', 'execute')
       or has_function_privilege('anon', 'public.customer_get_timeline(uuid,integer,timestamptz)', 'execute')
       or has_function_privilege('anon', 'public.customer_calls_by_staff(date)', 'execute'), false,
  'browsers cannot write interactions; anon cannot read');
set local role authenticated;
select pg_temp.act_as('crm');
select is(jsonb_array_length(customer_get_timeline(pg_temp.id('rohan'))), 7, 'a CRM user reads the whole timeline');
select is((customer_get_timeline(pg_temp.id('rohan'), 1, '2026-11-04 00:00+05:30') -> 0 -> 'appointments' -> 0 ->> 'status'), 'booked',
  'each entry shows what it led to, and paging by date works');
select is((select calls || '|' || reached || '|' || not_connected from customer_calls_by_staff('2026-11-02') where staff_user_id = pg_temp.id('crm')), '1|0|1',
  'the live call view counts calls per person for a day');
select pg_temp.act_as('other_crm');
select throws_ok(format('select customer_get_timeline(%L)', pg_temp.id('rohan')), 'P0002', 'Client not found', 'another company cannot read this client');
select pg_temp.act_as('staff');
select throws_ok($$select * from customer_calls_by_staff()$$, '42501', 'Section access denied', 'a user without CRM access is refused');
reset role;

select * from finish();
rollback;
