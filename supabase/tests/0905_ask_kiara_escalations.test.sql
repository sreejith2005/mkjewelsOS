begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture (synthetic text only). Tenant A, branches A1 and A2.
-- Reports-to chain: 5 (staff asker, Sales A1) -> 4 (manager) -> 3 (manager) -> 11 (manager,
-- individually denied assistant.answer_escalations).
-- 7 heads the Sales department; 8 manages branch A1; 6 is a manager in A1 outside the chain.
-- 1 Super Admin, 2 Admin (branch A2), 9 staff (Sales A1), 10 HR, 14 staff in A2 with no
-- manager, department head, or branch manager. Tenant B: 13 Super Admin.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('20a00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated', 'esc-' || n || '@example.invalid',
  crypt('local-test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 14) n;

insert into tenants(id, name, slug, timezone) values
  ('20a10000-0000-4000-8000-000000000001', 'ESC fixture A', 'esc-fixture-a', 'Asia/Kolkata'),
  ('20a10000-0000-4000-8000-000000000002', 'ESC fixture B', 'esc-fixture-b', 'Asia/Kolkata');
insert into branches(id, tenant_id, name, code) values
  ('20a20000-0000-4000-8000-000000000001', '20a10000-0000-4000-8000-000000000001', 'ESC branch A1', 'ESC-A1'),
  ('20a20000-0000-4000-8000-000000000002', '20a10000-0000-4000-8000-000000000001', 'ESC branch A2', 'ESC-A2'),
  ('20a20000-0000-4000-8000-000000000003', '20a10000-0000-4000-8000-000000000002', 'ESC branch B', 'ESC-B');
insert into departments(id, tenant_id, branch_id, name, code) values
  ('20a30000-0000-4000-8000-000000000001', '20a10000-0000-4000-8000-000000000001', '20a20000-0000-4000-8000-000000000001', 'Sales', 'ESC-SALES'),
  ('20a30000-0000-4000-8000-000000000002', '20a10000-0000-4000-8000-000000000001', '20a20000-0000-4000-8000-000000000001', 'Operations', 'ESC-OPS'),
  ('20a30000-0000-4000-8000-000000000003', '20a10000-0000-4000-8000-000000000001', '20a20000-0000-4000-8000-000000000002', 'Back Office', 'ESC-BO'),
  ('20a30000-0000-4000-8000-000000000004', '20a10000-0000-4000-8000-000000000002', '20a20000-0000-4000-8000-000000000003', 'Sales', 'ESC-SALES-B');
insert into dropdown_masters(id, tenant_id, master_type, label, value, sort_order, is_active) values
  ('20a40000-0000-4000-8000-000000000001', '20a10000-0000-4000-8000-000000000001', 'designation', 'Store Manager', 'esc_store_manager', 1, true);

insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, designation_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
select ('20a50000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid, ('20a00000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid,
  tt.tenant::uuid, f.branch::uuid, f.dept::uuid, f.designation::uuid,
  f.name, '0000210' || lpad(f.n::text, 3, '0'), 'esc-' || f.n || '@example.invalid', 'ESC-' || f.n, f.role::user_role, 'active', 'active', true, '{}'
from (values
  (1, 'ESC Super Admin', 'super_admin', 'A', '20a20000-0000-4000-8000-000000000001', '20a30000-0000-4000-8000-000000000002', null),
  (2, 'ESC Admin', 'admin', 'A', '20a20000-0000-4000-8000-000000000002', '20a30000-0000-4000-8000-000000000003', null),
  (3, 'ESC Senior Manager', 'manager', 'A', '20a20000-0000-4000-8000-000000000001', '20a30000-0000-4000-8000-000000000002', null),
  (4, 'ESC Direct Manager', 'manager', 'A', '20a20000-0000-4000-8000-000000000001', '20a30000-0000-4000-8000-000000000001', '20a40000-0000-4000-8000-000000000001'),
  (5, 'ESC Asker', 'staff', 'A', '20a20000-0000-4000-8000-000000000001', '20a30000-0000-4000-8000-000000000001', null),
  (6, 'ESC Outside Manager', 'manager', 'A', '20a20000-0000-4000-8000-000000000001', '20a30000-0000-4000-8000-000000000002', null),
  (7, 'ESC Department Head', 'manager', 'A', '20a20000-0000-4000-8000-000000000001', '20a30000-0000-4000-8000-000000000001', null),
  (8, 'ESC Branch Manager', 'manager', 'A', '20a20000-0000-4000-8000-000000000001', '20a30000-0000-4000-8000-000000000002', null),
  (9, 'ESC Other Staff', 'staff', 'A', '20a20000-0000-4000-8000-000000000001', '20a30000-0000-4000-8000-000000000001', null),
  (10, 'ESC HR', 'hr', 'A', '20a20000-0000-4000-8000-000000000001', '20a30000-0000-4000-8000-000000000002', null),
  (11, 'ESC Top Manager', 'manager', 'A', '20a20000-0000-4000-8000-000000000001', '20a30000-0000-4000-8000-000000000002', null),
  (13, 'ESC Other Super Admin', 'super_admin', 'B', '20a20000-0000-4000-8000-000000000003', '20a30000-0000-4000-8000-000000000004', null),
  (14, 'ESC Lone Staff', 'staff', 'A', '20a20000-0000-4000-8000-000000000002', '20a30000-0000-4000-8000-000000000003', null)
) as f(n, name, role, t, branch, dept, designation)
cross join lateral (select case f.t when 'A' then '20a10000-0000-4000-8000-000000000001' else '20a10000-0000-4000-8000-000000000002' end as tenant) tt;
update user_profiles set reports_to_user_id = '20a50000-0000-4000-8000-000000000004' where id = '20a50000-0000-4000-8000-000000000005';
update user_profiles set reports_to_user_id = '20a50000-0000-4000-8000-000000000003' where id = '20a50000-0000-4000-8000-000000000004';
update user_profiles set reports_to_user_id = '20a50000-0000-4000-8000-000000000011' where id = '20a50000-0000-4000-8000-000000000003';
update departments set head_id = '20a50000-0000-4000-8000-000000000007' where id = '20a30000-0000-4000-8000-000000000001';
update branches set manager_id = '20a50000-0000-4000-8000-000000000008' where id = '20a20000-0000-4000-8000-000000000001';
insert into user_permission_overrides(tenant_id, user_profile_id, permission_key, effect)
values ('20a10000-0000-4000-8000-000000000001', '20a50000-0000-4000-8000-000000000011', 'assistant.answer_escalations', 'deny');

create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '20a00000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'), true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;
create function pg_temp.profile(p_n integer) returns uuid language sql immutable as $$
  select ('20a50000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid
$$;
create temp table ids(name text primary key, id uuid);
grant all on ids to authenticated;
-- One answered question with Kiara's offer, as the signed-in user. Returns the answer message id.
create function pg_temp.offered_turn(p_question text, p_reason text default 'no_kb_match') returns uuid language plpgsql as $$
declare v_request uuid := gen_random_uuid(); v_started jsonb;
begin
  v_started := start_kiara_turn(null, v_request, p_question, 'web');
  return complete_kiara_turn(v_request, 'I could not find this in the company SOPs. You can send it to a person.',
    '[{"role":"user","content":"q"},{"role":"assistant","content":"a"}]'::jsonb, 'en', '[]'::jsonb,
    jsonb_build_object('offer_id', gen_random_uuid(), 'reason', p_reason, 'summary_en', 'Synthetic summary: ' || left(p_question, 40)),
    array['search_knowledge_base'], array['knowledge'], false, 'claude-sonnet-5-5', 'end_turn', '{}'::jsonb);
end $$;
create function pg_temp.visible() returns integer language sql as $$ select count(*)::integer from kiara_escalations $$;
grant execute on function pg_temp.as_user(integer), pg_temp.profile(integer), pg_temp.offered_turn(text, text), pg_temp.visible() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'kiara_escalations'::regclass), 'escalations have RLS');
select ok(has_table_privilege('authenticated', 'kiara_escalations', 'SELECT') and not has_table_privilege('authenticated', 'kiara_escalations', 'INSERT')
  and not has_table_privilege('authenticated', 'kiara_escalations', 'UPDATE') and not has_table_privilege('authenticated', 'kiara_escalations', 'DELETE'),
  'clients read escalations through RLS and never write them');
select ok(not has_table_privilege('anon', 'kiara_escalations', 'SELECT') and not has_table_privilege('service_role', 'kiara_escalations', 'SELECT'),
  'anon and service role cannot read escalations');
select ok(not has_function_privilege('authenticated', 'kiara_escalation_answerer(uuid,uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'create_kiara_escalation(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'answer_kiara_escalation_with_audit(uuid,text,boolean,text)', 'EXECUTE'), 'helpers owner-only; RPCs not for anon or service role');
select ok(production_demo_data_retirement_manifest('20a10000-0000-4000-8000-000000000001') -> 'retained_counts' ? 'kiara_escalations', 'escalations are classified and retained');
select ok(pg_get_functiondef('answer_kiara_escalation_with_audit(uuid,text,boolean,text)'::regprocedure) like '%for update%',
  'answering locks the escalation row (first answer wins under concurrency)');

-- ---------------------------------------------------------------------------
-- Creating an escalation (the asker confirms Kiara's offer)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(5);
insert into ids values ('offer1', pg_temp.offered_turn('Synthetic question: may staff bring pets to the showroom?'));
insert into ids select 'plain', complete_kiara_turn(r, 'Plain answer.', '[{"role":"user","content":"q"},{"role":"assistant","content":"a"}]'::jsonb,
  'en', '[]'::jsonb, null, '{}', '{}', false, 'm', 'end_turn', '{}'::jsonb)
  from (select gen_random_uuid() r) x, lateral (select start_kiara_turn(null, x.r, 'Synthetic plain question', 'web')) s;

select throws_ok(format('select create_kiara_escalation(%L)', (select id from ids where name = 'plain')), '22023', 'Kiara did not offer to pass this question on',
  'an answer without an offer cannot be escalated');
select pg_temp.as_user(9);
select throws_ok(format('select create_kiara_escalation(%L)', (select id from ids where name = 'offer1')), '42501', 'Message not found',
  'another employee cannot escalate someone else''s question');
select pg_temp.as_user(5);
insert into ids select 'esc1', (create_kiara_escalation((select id from ids where name = 'offer1')) ->> 'escalation_id')::uuid;
select throws_ok(format('select create_kiara_escalation(%L)', (select id from ids where name = 'offer1')), '23505', 'kiara_escalation_exists',
  'an offer is escalated once');
reset role;
select is((select questions from kiara_daily_usage where user_profile_id = pg_temp.profile(5)), 2, 'escalating used no daily question (two asked, two counted)');
select ok((select escalated from kiara_question_facts f join kiara_escalations e on e.question_message_id = f.message_id where e.id = (select id from ids where name = 'esc1')),
  'the question''s content-free fact is marked escalated');
select is((select array_agg(user_profile_id order by user_profile_id) from notifications where event_type = 'kiara_escalation_open'
    and source_record_id = (select id from ids where name = 'esc1')),
  array[pg_temp.profile(4), pg_temp.profile(7), pg_temp.profile(8)],
  'notified directly: the asker''s manager, department head, and branch manager');
select ok((select bool_and(link_url = '/ask-kiara?tab=questions&escalation=' || source_record_id and channel = 'in_app' and delivered_status = 'delivered'
    and source_module = 'assistant' and not is_read)
  from notifications where event_type = 'kiara_escalation_open' and source_record_id = (select id from ids where name = 'esc1')),
  'answerer notifications use the in-app contract and open the question');
select is((select status from kiara_escalations where id = (select id from ids where name = 'esc1')), 'open', 'the escalation starts open');
select ok((select new_value ? 'recipients_count' and new_value::text not like '%pets%' from audit_logs
  where action = 'assistant_escalation_created' and record_id = (select id from ids where name = 'esc1')), 'creation is audited without the question text');
select ok((select count(*) from tenant_realtime_events where tenant_id = '20a10000-0000-4000-8000-000000000001' and topic = 'assistant') > 0,
  'escalations wake the assistant realtime topic');

-- ---------------------------------------------------------------------------
-- Who sees it: list, badge, and row-level reads
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(1); select is(get_kiara_escalation_badge(), 1, 'super admin: badge 1'); select is(pg_temp.visible(), 1, 'super admin can read it');
select pg_temp.as_user(2); select is(get_kiara_escalation_badge(), 1, 'admin in another branch: badge 1');
select is(jsonb_array_length(list_kiara_escalations('open', 50)), 1, 'admin lists it');
select pg_temp.as_user(4); select is(get_kiara_escalation_badge(), 1, 'direct manager: badge 1');
select is((select item ->> 'asker_name' from jsonb_array_elements(list_kiara_escalations('open', 50)) item), 'ESC Asker', 'the list shows the asker');
select ok((select item ? 'question' and item ? 'department' and item ? 'branch' and not item ? 'conversation_id'
  from jsonb_array_elements(list_kiara_escalations('open', 50)) item), 'the list carries the question, never the conversation');
select pg_temp.as_user(3); select is(get_kiara_escalation_badge(), 1, 'manager two levels up the chain: badge 1');
select pg_temp.as_user(7); select is(get_kiara_escalation_badge(), 1, 'department head: badge 1');
select pg_temp.as_user(8); select is(get_kiara_escalation_badge(), 1, 'branch manager: badge 1');
select pg_temp.as_user(6); select is(get_kiara_escalation_badge(), 0, 'same-branch manager outside the chain: badge 0');
select is(jsonb_array_length(list_kiara_escalations('open', 50)), 0, 'same-branch manager outside the chain lists nothing');
select is(pg_temp.visible(), 0, 'same-branch manager outside the chain cannot read the row');
select throws_ok(format('select answer_kiara_escalation_with_audit(%L, %L, false, null)', (select id from ids where name = 'esc1'), 'x'),
  '42501', 'Question not found', 'same-branch manager outside the chain cannot answer');
select pg_temp.as_user(11); select is(get_kiara_escalation_badge(), 0, 'a manager in the chain without assistant.answer_escalations: badge 0');
select throws_ok($$select list_kiara_escalations('open', 50)$$, '42501', 'Answering questions requires permission', 'and cannot list');
select is(pg_temp.visible(), 0, 'and cannot read the row');
select pg_temp.as_user(9); select is(get_kiara_escalation_badge(), 0, 'staff: badge 0');
select throws_ok($$select list_kiara_escalations('open', 50)$$, '42501', 'Answering questions requires permission', 'staff cannot list questions');
select is(pg_temp.visible(), 0, 'staff cannot read a colleague''s escalation');
select pg_temp.as_user(10); select is(get_kiara_escalation_badge(), 0, 'HR (no permission by default): badge 0');
select pg_temp.as_user(13); select is(get_kiara_escalation_badge(), 0, 'another tenant''s super admin: badge 0');
select is(pg_temp.visible(), 0, 'another tenant cannot read it');
select throws_ok(format('select answer_kiara_escalation_with_audit(%L, %L, false, null)', (select id from ids where name = 'esc1'), 'x'),
  '42501', 'Question not found', 'another tenant cannot answer');
select pg_temp.as_user(5); select is(pg_temp.visible(), 1, 'the asker reads their own escalation');
select is(get_kiara_escalation_badge(), 0, 'the asker has no badge');
select throws_ok(format('select answer_kiara_escalation_with_audit(%L, %L, false, null)', (select id from ids where name = 'esc1'), 'x'),
  '42501', 'Answering questions requires permission', 'the asker cannot answer');
reset role;
set local role service_role;
select throws_ok($$select get_kiara_escalation_badge()$$, '42501', null, 'the service role cannot use escalation RPCs');
reset role;

-- A manager who asks: their own question is never theirs to answer.
set local role authenticated;
select pg_temp.as_user(4);
insert into ids select 'esc_mgr', (create_kiara_escalation(pg_temp.offered_turn('Synthetic manager question about uniform rules')) ->> 'escalation_id')::uuid;
select is(get_kiara_escalation_badge(), 1, 'a manager''s own question does not count in their badge');
select throws_ok(format('select answer_kiara_escalation_with_audit(%L, %L, false, null)', (select id from ids where name = 'esc_mgr'), 'x'),
  '42501', 'Question not found', 'a manager cannot answer their own question');
select pg_temp.as_user(3); select is(get_kiara_escalation_badge(), 2, 'the next manager up sees both questions');

-- ---------------------------------------------------------------------------
-- Answering: first answer wins; derived close; asker sees it
-- ---------------------------------------------------------------------------
reset role;
-- One answerer had already read their notification earlier: that time is kept.
update notifications set is_read = true, read_at = '2026-01-01T00:00:00Z' where event_type = 'kiara_escalation_open'
  and source_record_id = (select id from ids where name = 'esc1') and user_profile_id = pg_temp.profile(8);
set local role authenticated;
select pg_temp.as_user(4);
select throws_ok(format('select answer_kiara_escalation_with_audit(%L, %L, false, null)', (select id from ids where name = 'esc1'), '   '),
  '22023', 'Answers must be 1 to 4,000 characters', 'a blank answer is refused');
select is((answer_kiara_escalation_with_audit((select id from ids where name = 'esc1'),
  'No pets inside the showroom. Synthetic answer zebrafinch.', true, 'Synthetic pets rule') ->> 'status'), 'answered', 'the direct manager answers and saves it to the knowledge base');
select pg_temp.as_user(7);
select throws_ok(format('select answer_kiara_escalation_with_audit(%L, %L, false, null)', (select id from ids where name = 'esc1'), 'Second answer'),
  'P0001', 'kiara_escalation_already_answered', 'a later answerer is told it was already answered');
select is(get_kiara_escalation_badge(), 1, 'the answered question leaves the department head''s badge (the Sales manager''s own question remains)');
reset role;
select is((select array[role, display_text, (escalation_id = (select id from ids where name = 'esc1'))::text] from kiara_messages
  where conversation_id = (select conversation_id from kiara_escalations where id = (select id from ids where name = 'esc1')) order by ordinal desc limit 1),
  array['human_answer', 'No pets inside the showroom. Synthetic answer zebrafinch.', 'true'], 'the answer is appended to the asker''s conversation');
select is((select answered_by_label from kiara_escalations where id = (select id from ids where name = 'esc1')), 'ESC Direct Manager (Store Manager)',
  'the answer records who answered, with their designation');
select is((select count(*)::integer from notifications where event_type = 'kiara_escalation_open' and source_record_id = (select id from ids where name = 'esc1')), 3,
  'answerers'' notifications are kept (history preserved)');
select ok((select bool_and(is_read and read_at is not null) from notifications where event_type = 'kiara_escalation_open'
  and source_record_id = (select id from ids where name = 'esc1')), 'every answerer''s notification is closed by the trigger');
select is((select read_at from notifications where event_type = 'kiara_escalation_open' and source_record_id = (select id from ids where name = 'esc1')
  and user_profile_id = pg_temp.profile(8)), '2026-01-01T00:00:00Z'::timestamptz, 'an earlier read time is not overwritten');
select is((select link_url from notifications where event_type = 'kiara_escalation_answered' and user_profile_id = pg_temp.profile(5)),
  '/ask-kiara?conversation=' || (select conversation_id from kiara_escalations where id = (select id from ids where name = 'esc1')),
  'the asker is notified with a link to the conversation');
select ok((select new_value::text not like '%zebrafinch%' and new_value::text not like '%pets%' from audit_logs
  where action = 'assistant_escalation_answered' and record_id = (select id from ids where name = 'esc1')), 'the answer is audited without its text');

set local role authenticated;
select pg_temp.as_user(5);
select is((select m -> 'escalation' ->> 'status' from jsonb_array_elements(get_my_kiara_conversation(
    (select conversation_id from kiara_escalations where id = (select id from ids where name = 'esc1'))) -> 'messages') m
  where m ->> 'id' = (select id::text from ids where name = 'offer1')), 'answered', 'the asker''s conversation shows the offer as answered');
select is((select m ->> 'answered_by' from jsonb_array_elements(get_my_kiara_conversation(
    (select conversation_id from kiara_escalations where id = (select id from ids where name = 'esc1'))) -> 'messages') m
  where m ->> 'role' = 'human_answer'), 'ESC Direct Manager (Store Manager)', 'and who answered');

-- ---------------------------------------------------------------------------
-- Save to knowledge base: suggested until Super Admin approves
-- ---------------------------------------------------------------------------
reset role;
insert into ids select 'doc', saved_document_id from kiara_escalations where id = (select id from ids where name = 'esc1');
select is((select array[status, source_kind, visibility, array_to_string(department_tags, ',')] from kiara_documents where id = (select id from ids where name = 'doc')),
  array['suggested', 'escalation_answer', 'everyone', 'Sales'], 'the saved answer is a suggested document for the asker''s department, visible to everyone once approved');
set local role authenticated;
select pg_temp.as_user(9);
select is(jsonb_array_length(search_kiara_knowledge('zebrafinch', null, 5) -> 'results'), 0, 'a suggested answer is not searchable');
select pg_temp.as_user(1);
select ok((select bool_or(d ->> 'id' = (select id::text from ids where name = 'doc')) from jsonb_array_elements(list_kiara_documents(null, 'suggested', null)) d),
  'Super Admin sees it under Suggested');
select lives_ok(format('select set_kiara_document_status_with_audit(%L, %L)', (select id from ids where name = 'doc'), 'active'), 'Super Admin approves it');
select pg_temp.as_user(9);
select is((select r ->> 'title' from jsonb_array_elements(search_kiara_knowledge('zebrafinch', null, 5) -> 'results') r), 'Synthetic pets rule',
  'once approved, the answer is found by search');

-- ---------------------------------------------------------------------------
-- Withdraw, and the admin fallback
-- ---------------------------------------------------------------------------
select pg_temp.as_user(5);
insert into ids select 'esc2', (create_kiara_escalation(pg_temp.offered_turn('Synthetic question about festival bonus dates', 'needs_judgment')) ->> 'escalation_id')::uuid;
select pg_temp.as_user(9);
select throws_ok(format('select withdraw_my_kiara_escalation(%L)', (select id from ids where name = 'esc2')), '42501', 'Question not found', 'only the asker can withdraw');
select pg_temp.as_user(5);
select lives_ok(format('select withdraw_my_kiara_escalation(%L)', (select id from ids where name = 'esc2')), 'the asker withdraws an open question');
select lives_ok(format('select withdraw_my_kiara_escalation(%L)', (select id from ids where name = 'esc2')), 'withdrawing twice is a no-op');
select throws_ok(format('select withdraw_my_kiara_escalation(%L)', (select id from ids where name = 'esc1')), 'P0001', 'kiara_escalation_already_answered',
  'an answered question cannot be withdrawn');
select pg_temp.as_user(4);
select throws_ok(format('select answer_kiara_escalation_with_audit(%L, %L, false, null)', (select id from ids where name = 'esc2'), 'Too late'),
  'P0001', 'kiara_escalation_withdrawn', 'a withdrawn question cannot be answered');
reset role;
select ok((select bool_and(is_read) from notifications where event_type = 'kiara_escalation_open' and source_record_id = (select id from ids where name = 'esc2')),
  'withdrawing closes the answerers'' notifications');
select ok(exists (select 1 from audit_logs where action = 'assistant_escalation_withdrawn' and record_id = (select id from ids where name = 'esc2')), 'withdrawal is audited');

set local role authenticated;
select pg_temp.as_user(14);
insert into ids select 'esc3', (create_kiara_escalation(pg_temp.offered_turn('Synthetic question about locker keys')) ->> 'escalation_id')::uuid;
reset role;
select is((select array_agg(user_profile_id order by user_profile_id) from notifications where event_type = 'kiara_escalation_open'
    and source_record_id = (select id from ids where name = 'esc3')), array[pg_temp.profile(1), pg_temp.profile(2)],
  'with no manager, department head, or branch manager, the admins are notified');
set local role authenticated;
select pg_temp.as_user(4); select is(get_kiara_escalation_badge(), 0, 'a manager outside that asker''s chain does not see it');

select * from finish();
rollback;
