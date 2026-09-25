-- Synthetic parity fixture for the ORIGINAL CRM schema (schema public of the throwaway
-- original stack). No customer data: every name is "Parity ..." and every phone is 91000xxxxx.
-- Rows are created through the original RPCs, acting as the synthetic CRM users, so all
-- derived values (client codes, rollups, follow-ups, referrals, edit log) come from the
-- original logic. load-jewelos.mjs then copies these exact rows into JewelOS schema crm.
-- Dates are relative to the run date so the default views (this month, today) are populated.
\set ON_ERROR_STOP on

begin;
-- Synthetic auth users: in the original, the CRM user id is the Auth user id.
insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email, crypt('parity-local-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from (values
  ('c0000000-0000-4000-8000-000000000001', 'parity-admin@example.invalid'),
  ('c0000000-0000-4000-8000-000000000002', 'parity-manager@example.invalid'),
  ('c0000000-0000-4000-8000-000000000003', 'parity-sales@example.invalid'),
  ('c0000000-0000-4000-8000-000000000004', 'parity-sales-bandra@example.invalid')
) as u(id, email);
insert into auth.identities(id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email), 'email', now(), now(), now()
from auth.users where email like 'parity-%@example.invalid';

insert into public.branches(id, name) values
  ('a0000000-0000-4000-8000-00000000000a', 'Andheri Parity'),
  ('a0000000-0000-4000-8000-00000000000b', 'Bandra Parity'),
  ('a0000000-0000-4000-8000-00000000000c', 'Colaba Parity');
insert into public.users(id, name, email, role, branch_id) values
  ('c0000000-0000-4000-8000-000000000001', 'Parity Admin', 'parity-admin@example.invalid', 'super_admin', null),
  ('c0000000-0000-4000-8000-000000000002', 'Parity Manager', 'parity-manager@example.invalid', 'branch_manager', 'a0000000-0000-4000-8000-00000000000a'),
  ('c0000000-0000-4000-8000-000000000003', 'Parity Sales', 'parity-sales@example.invalid', 'salesperson', 'a0000000-0000-4000-8000-00000000000a'),
  ('c0000000-0000-4000-8000-000000000004', 'Parity Sales Bandra', 'parity-sales-bandra@example.invalid', 'salesperson', 'a0000000-0000-4000-8000-00000000000b');
insert into public.crm_allocation(branch_id, crm_name, active, created_at) values
  ('a0000000-0000-4000-8000-00000000000a', 'ANU PARITY', true, now() - interval '30 days'),
  ('a0000000-0000-4000-8000-00000000000a', 'BINA PARITY', true, now() - interval '29 days'),
  ('a0000000-0000-4000-8000-00000000000a', 'CHITRA PARITY', true, now() - interval '28 days'),
  ('a0000000-0000-4000-8000-00000000000a', 'DEEPA PARITY', false, now() - interval '27 days'),
  ('a0000000-0000-4000-8000-00000000000b', 'ESHA PARITY', true, now() - interval '26 days');
insert into public.crm_daily_availability(branch_id, crm_name, date, is_available)
values ('a0000000-0000-4000-8000-00000000000a', 'CHITRA PARITY', (now() at time zone 'Asia/Kolkata')::date, false);

-- Fixture helpers (invoker rights: they run as the acting CRM user). Dropped by the harness.
create schema parity_fixture;
create table parity_fixture.ids(name text primary key, id uuid not null);
grant usage on schema parity_fixture to authenticated;
grant select, insert on parity_fixture.ids to authenticated;

create function parity_fixture.walkin(
  p_key text, p_name text, p_phone text, p_branch uuid, p_days_ago integer, p_status text,
  p_extra jsonb default '{}'::jsonb, p_queue_id uuid default null
) returns uuid language plpgsql as $$
declare queue_row record; visit record; payload jsonb;
begin
  if p_queue_id is null then
    select * into queue_row from public.create_entry_queue(p_name, p_phone, p_branch);
  else
    select p_queue_id as id, null::uuid as client_id into queue_row;
  end if;
  payload := jsonb_build_object(
    'branch_id', p_branch, 'primary_name', p_name, 'primary_phone', p_phone,
    'client_id', coalesce(queue_row.client_id::text, ''), 'entry_queue_id', queue_row.id,
    'event_date', (now() - make_interval(days => p_days_ago))::text,
    'crm_name', 'ANU PARITY', 'gender', 'FEMALE', 'country', 'India', 'state', 'Maharashtra',
    'city', 'Mumbai', 'pincode', '400053', 'address', 'Parity Street ' || p_key, 'community', 'Gujarati',
    'billing_phone', p_phone, 'did_buy', p_status = 'YES', 'occupation', 'BUSINESS OWNER',
    'bridal_or_non_bridal', 'NON BRIDAL', 'communication_preference', 'CALL', 'source_of_lead', 'Walk-in',
    'client_type', 'new', 'seen_categories', jsonb_build_array('Diamond Earring', 'Chain Gold'),
    'bought_categories', case when p_status = 'YES' then jsonb_build_array('Chain Gold') else '[]'::jsonb end,
    'order_categories', '[]'::jsonb, 'product_requirement', 'Parity requirement ' || p_key,
    'remark', 'Parity remark ' || p_key,
    'additional_fields', jsonb_build_object('visit_status', p_status, 'salesperson', 'ANU PARITY'),
    'category_details', jsonb_build_object('seen_count', '2'), 'engagement', '{}'::jsonb, 'companions', '[]'::jsonb, 'documents', '[]'::jsonb
  ) || p_extra;
  select * into visit from public.submit_walkin_visit(payload);
  insert into parity_fixture.ids(name, id) values ('client:' || p_key, visit.client_id) on conflict (name) do nothing;
  insert into parity_fixture.ids(name, id) values ('timeline:' || p_key || ':' || p_days_ago, visit.timeline_id);
  return visit.client_id;
end $$;
grant execute on function parity_fixture.walkin(text, text, text, uuid, integer, text, jsonb, uuid) to authenticated;
commit;

-- ---------------------------------------------------------------------------
-- Salesperson, branch A: walk-ins, follow-ups, referrals, leads, a profile edit
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', false);
do $$
declare today date := (now() at time zone 'Asia/Kolkata')::date; a uuid := 'a0000000-0000-4000-8000-00000000000a'; client uuid; fu uuid; rc uuid; ref record;
begin
  perform parity_fixture.walkin('asha', 'Parity Asha Mehta', '9100000101', a, 2, 'NO',
    jsonb_build_object('not_bought_reasons', jsonb_build_array('Pricing Issue', 'Want to See More Designs'), 'next_visit_date', today::text, 'client_potential_category', 'Warm Lead', 'high_potential_reason', 'Parity wedding season', 'dob', '1990-04-12', 'anniversary', '2015-11-20', 'beverage', 'Tea', 'snack', 'Sandwich'));
  perform parity_fixture.walkin('bhavna', 'Parity Bhavna Rao', '9100000102', a, 0, 'YES', jsonb_build_object('client_potential_category', 'Hot Lead'));
  perform parity_fixture.walkin('chirag', 'Parity Chirag Shah', '9100000103', a, 10, 'NO',
    jsonb_build_object('not_bought_reasons', jsonb_build_array('Time to Think'), 'next_visit_date', (today - 3)::text, 'gender', 'MALE'));
  perform parity_fixture.walkin('deepa', 'Parity Deepa Iyer', '9100000104', a, 1, 'NO',
    jsonb_build_object('not_bought_reasons', jsonb_build_array('Want Ready Piece'), 'next_visit_date', (today + 5)::text));
  perform parity_fixture.walkin('esha', 'Parity Esha Kapoor', '9100000105', a, 15, 'NO',
    jsonb_build_object('not_bought_reasons', jsonb_build_array('Client Will Come With Family'), 'next_visit_date', (today - 8)::text));
  perform parity_fixture.walkin('farhan', 'Parity Farhan Ali', '9100000106', a, 1, 'YES', jsonb_build_object('gender', 'MALE'));
  perform parity_fixture.walkin('gita', 'Parity Gita Nair', '9100000107', a, 20, 'NO',
    jsonb_build_object('not_bought_reasons', jsonb_build_array('Pricing Issue'), 'next_visit_date', (today - 12)::text));
  select id into client from parity_fixture.ids where name = 'client:gita';
  perform parity_fixture.walkin('gita', 'Parity Gita Nair', '9100000107', a, 0, 'YES', jsonb_build_object('client_id', client));

  -- Follow-up states: in process and done.
  select f.id into fu from public.not_bought_followups f join parity_fixture.ids i on i.id = f.client_id and i.name = 'client:deepa';
  perform public.save_not_bought_followup(fu, 'INTERESTED - NEED FOLLOW UP', 'CONNECTED', today + 5, 'Parity call: wants bridal set');
  select f.id into fu from public.not_bought_followups f join parity_fixture.ids i on i.id = f.client_id and i.name = 'client:esha';
  perform public.save_not_bought_followup(fu, 'ALREADY PURCHASED FROM MK JEWELS', 'CONNECTED', null, 'Parity call: purchased');

  -- Pending queue: a new client and an existing client re-queued.
  select * into ref from public.create_entry_queue('Parity Queue New', '9100000201', a);
  insert into parity_fixture.ids(name, id) values ('queue:new', ref.id);
  select id into client from parity_fixture.ids where name = 'client:bhavna';
  select * into ref from public.create_entry_queue('Parity Bhavna Rao', '9100000102', a, null, client);
  insert into parity_fixture.ids(name, id) values ('queue:existing', ref.id);

  -- Referrals: pending, in process, done, converted (number of an existing client).
  select id into client from parity_fixture.ids where name = 'client:bhavna';
  perform public.create_manual_referral(client, 'Parity Ref One', '9100000401', 'ANU PARITY', null, 'Friend', 'Morning');
  select * into ref from public.create_manual_referral(client, 'Parity Ref Two', '9100000402', 'BINA PARITY', null, 'Cousin', 'After 6 PM');
  select rc2.id into rc from public.referral_calling rc2 where rc2.referral_id = ref.id;
  perform public.save_referral_followup(p_referral_calling_id => rc, p_followup_status => 'INTERESTED - NEED FOLLOW UP', p_call_response => 'CONNECTED', p_next_followup_date => today + 2, p_remark => 'Parity referral call', p_entered_by => 'Parity Sales', p_request_key => gen_random_uuid());
  select * into ref from public.create_manual_referral(client, 'Parity Ref Three', '9100000403', 'ANU PARITY', null, 'Neighbour', null);
  select rc2.id into rc from public.referral_calling rc2 where rc2.referral_id = ref.id;
  perform public.save_referral_followup(p_referral_calling_id => rc, p_followup_status => 'NOT INTERESTED', p_call_response => 'CONNECTED', p_next_followup_date => null, p_remark => 'Parity not interested', p_entered_by => 'Parity Sales', p_request_key => gen_random_uuid());
  perform public.create_manual_referral(client, 'Parity Ref Converted', '9100000106', 'ANU PARITY', null, 'Friend', 'Evening');
  perform public.reconcile_referral_calling_conversions();

  -- Leads and a direct profile edit (client_edit_log is written by the original trigger).
  insert into public.leads(phone_number, name, field_values, created_by) values
    ('9100000501', 'Parity Lead One', '{"city":"Pune","state":"Maharashtra","source_of_lead":"Instagram"}', 'c0000000-0000-4000-8000-000000000003'),
    ('9100000502', 'Parity Lead Two', '{"city":"Nashik"}', 'c0000000-0000-4000-8000-000000000003');
  select id into client from parity_fixture.ids where name = 'client:asha';
  update public.clients set city = 'Thane', secondary_phone = '9100000111', instagram_status = 'FOLLOWING' where client_id = client;
end $$;

-- ---------------------------------------------------------------------------
-- Salesperson, branch B
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000004', false);
do $$
declare b uuid := 'a0000000-0000-4000-8000-00000000000b';
begin
  perform parity_fixture.walkin('hema', 'Parity Hema Joshi', '9100000301', b, 1, 'YES', jsonb_build_object('crm_name', 'ESHA PARITY'));
  perform parity_fixture.walkin('irfan', 'Parity Irfan Khan', '9100000302', b, 0, 'NO',
    jsonb_build_object('crm_name', 'ESHA PARITY', 'not_bought_reasons', jsonb_build_array('Pricing Issue'), 'gender', 'MALE'));
end $$;
reset role;

-- Legacy visit statuses that only imported history carries (the walk-in RPC records YES/NO),
-- so every dashboard status group is populated.
update public.client_timeline set buy_status = 'ORDER_PLACED' where id = (select id from parity_fixture.ids where name = 'timeline:farhan:1');
update public.client_timeline set buy_status = 'REPAIR_PICKUP' where id = (select id from parity_fixture.ids where name = 'timeline:hema:1');
