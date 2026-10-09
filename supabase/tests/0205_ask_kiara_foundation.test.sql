begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture: two tenants. Tenant A has a Super Admin, an admin, a manager, two
-- staff, an HR user, a disabled staff account, and a staff user with an
-- individual deny of assistant.view. Tenant B has one staff user.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('20500000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated', 'kiara-' || n || '@example.invalid',
  crypt('local-test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 9) n;

insert into tenants(id, name, slug, timezone) values
  ('20510000-0000-4000-8000-000000000001', 'Kiara fixture A', 'kiara-fixture-a', 'Asia/Kolkata'),
  ('20510000-0000-4000-8000-000000000002', 'Kiara fixture B', 'kiara-fixture-b', 'Asia/Kolkata');
insert into branches(id, tenant_id, name, code) values
  ('20520000-0000-4000-8000-000000000001', '20510000-0000-4000-8000-000000000001', 'Kiara branch A', 'KIA-A'),
  ('20520000-0000-4000-8000-000000000002', '20510000-0000-4000-8000-000000000002', 'Kiara branch B', 'KIA-B');
insert into departments(id, tenant_id, branch_id, name, code) values
  ('20530000-0000-4000-8000-000000000001', '20510000-0000-4000-8000-000000000001', '20520000-0000-4000-8000-000000000001', 'Kiara sales', 'KIA-S'),
  ('20530000-0000-4000-8000-000000000002', '20510000-0000-4000-8000-000000000002', '20520000-0000-4000-8000-000000000002', 'Kiara other', 'KIA-O');

insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
select ('20540000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid, ('20500000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid,
  case when f.n = 9 then '20510000-0000-4000-8000-000000000002'::uuid else '20510000-0000-4000-8000-000000000001'::uuid end,
  case when f.n = 9 then '20520000-0000-4000-8000-000000000002'::uuid else '20520000-0000-4000-8000-000000000001'::uuid end,
  case when f.n = 9 then '20530000-0000-4000-8000-000000000002'::uuid else '20530000-0000-4000-8000-000000000001'::uuid end,
  f.name, '0000205' || lpad(f.n::text, 3, '0'), 'kiara-' || f.n || '@example.invalid', 'KIA-' || f.n, f.role::user_role,
  'active', f.status::user_account_status, f.enabled, '{}'
from (values
  (1, 'Kiara Super Admin', 'super_admin', 'active', true),
  (2, 'Kiara Admin', 'admin', 'active', true),
  (3, 'Kiara Manager', 'manager', 'active', true),
  (4, 'Kiara Staff', 'staff', 'active', true),
  (5, 'Kiara Staff Two', 'staff', 'active', true),
  (6, 'Kiara HR', 'hr', 'active', true),
  (7, 'Kiara Disabled', 'staff', 'active', false),
  (8, 'Kiara Denied', 'staff', 'active', true),
  (9, 'Kiara Other Tenant', 'staff', 'active', true)
) as f(n, name, role, status, enabled);
insert into user_permission_overrides(tenant_id, user_profile_id, permission_key, effect)
values ('20510000-0000-4000-8000-000000000001', '20540000-0000-4000-8000-000000000008', 'assistant.view', 'deny');

create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '20500000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'), true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;
create function pg_temp.request(p_n integer) returns uuid language sql immutable as $$
  select ('20560000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
$$;
grant execute on function pg_temp.as_user(integer), pg_temp.request(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalog, section key, defaults
-- ---------------------------------------------------------------------------
select is((select count(*)::integer from permission_catalog where key like 'assistant.%'), 6, 'all six assistant permissions are catalogued');
select is((select array[kind, page_id] from permission_catalog where key = 'assistant.view'), array['module', 'ask_kiara'], 'assistant.view is the ask_kiara section permission');
select is((select default_roles from permission_catalog where key = 'assistant.view'), '{super_admin,admin,manager,hr,crm,staff,doer,housekeeping}'::user_role[], 'every role can use Ask Kiara by default');
select is((select default_roles from permission_catalog where key = 'assistant.voice'), '{super_admin,admin,manager}'::user_role[], 'voice defaults exclude HR (owner decision)');
select is((select default_roles from permission_catalog where key = 'assistant.answer_escalations'), '{super_admin,admin,manager}'::user_role[], 'HR does not answer escalations by default');
select is((select kind from permission_catalog where key = 'assistant.manage_limits'), 'protected', 'limits are Super Admin authority only');
select is((select array_agg(sort_order order by sort_order) from permission_catalog where key like 'assistant.%'), array[310,311,312,313,314,315], 'assistant permissions sort after the existing catalog');
select ok((default_section_availability() ->> 'ask_kiara')::boolean, 'new tenants get the section on by default');
select is(validated_section_availability('{"ask_kiara": false}') ->> 'ask_kiara', 'false', 'section availability accepts the ask_kiara key');
select ok(exists (select 1 from kiara_settings where tenant_id = '20510000-0000-4000-8000-000000000001' and daily_question_limit = 10 and conversation_retention_days = 180), 'new tenants receive default Kiara settings');
select lives_ok($$select production_demo_data_retirement_manifest('20510000-0000-4000-8000-000000000001')$$, 'retirement manifest classifies every Kiara table');
select ok(production_demo_data_retirement_manifest('20510000-0000-4000-8000-000000000001') -> 'retained_counts' ? 'kiara_messages', 'Kiara data is retained, never treated as demo data');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'kiara_messages', 'INSERT') and not has_table_privilege('authenticated', 'kiara_conversations', 'UPDATE')
  and not has_table_privilege('authenticated', 'kiara_daily_usage', 'UPDATE') and not has_table_privilege('authenticated', 'kiara_settings', 'UPDATE'), 'no direct client writes');
select ok(not has_column_privilege('authenticated', 'kiara_messages', 'api_content', 'SELECT'), 'clients cannot select api_content');
select ok(has_column_privilege('authenticated', 'kiara_messages', 'display_text', 'SELECT'), 'clients can select display fields');
select ok(not has_table_privilege('authenticated', 'kiara_question_facts', 'SELECT'), 'question facts have no client grant');
select ok(not has_table_privilege('service_role', 'kiara_messages', 'SELECT') and not has_table_privilege('anon', 'kiara_messages', 'SELECT'), 'service role and anon cannot read messages');
select ok(not has_function_privilege('service_role', 'start_kiara_turn(uuid,uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'complete_kiara_turn(uuid,text,jsonb,text,jsonb,jsonb,text[],text[],boolean,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'get_my_kiara_conversation(uuid)', 'EXECUTE'), 'service role cannot call the user RPCs');
select ok(not has_function_privilege('anon', 'start_kiara_turn(uuid,uuid,text,text)', 'EXECUTE'), 'anon cannot call start_kiara_turn');
select ok(not has_function_privilege('authenticated', 'kiara_quota_for(user_profiles)', 'EXECUTE') and not has_function_privilege('authenticated', 'kiara_history(uuid)', 'EXECUTE'), 'internal helpers stay owner-only');

set local role service_role;
select throws_ok($$select start_kiara_turn(null, '20560000-0000-4000-8000-000000009999', 'hello', 'web')$$, '42501', null, 'service role execution is denied');
reset role;
set local role anon;
select throws_ok($$select get_my_kiara_quota()$$, '42501', null, 'anon execution is denied');
reset role;

-- ---------------------------------------------------------------------------
-- Identity, permission, and section gates
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select start_kiara_turn(null, pg_temp.request(900), 'hello', 'web')$$, '42501', 'Active profile required', 'unauthenticated callers are refused');
select pg_temp.as_user(7);
select throws_ok($$select start_kiara_turn(null, pg_temp.request(901), 'hello', 'web')$$, '42501', 'Active profile required', 'a disabled account is refused');
select pg_temp.as_user(8);
select throws_ok($$select start_kiara_turn(null, pg_temp.request(902), 'hello', 'web')$$, '42501', 'Section access denied', 'an individual deny of assistant.view is refused');
select throws_ok($$select get_my_kiara_quota()$$, '42501', 'Section access denied', 'quota is refused without assistant.view');

-- Input validation.
select pg_temp.as_user(4);
select throws_ok($$select start_kiara_turn(null, pg_temp.request(903), '   ', 'web')$$, '22023', 'Questions must be 1 to 2,000 characters', 'empty questions are rejected');
select throws_ok(format('select start_kiara_turn(null, %L, %L, %L)', pg_temp.request(904), repeat('a', 2001), 'web'), '22023', 'Questions must be 1 to 2,000 characters', 'questions over 2,000 characters are rejected');
select throws_ok($$select start_kiara_turn(null, pg_temp.request(905), 'hello', 'ios')$$, '22023', 'Unknown client', 'unknown clients are rejected');
select throws_ok($$select start_kiara_turn(null, null, 'hello', 'web')$$, '22023', 'A request id is required', 'a request id is required');
select is((select count(*)::integer from kiara_messages), 0, 'rejected calls write nothing');

-- Launch dark: the section off keeps staff out, Super Admin in.
reset role;
insert into tenant_section_controls(tenant_id, developer_mode_enabled, section_availability, settings_version)
values ('20510000-0000-4000-8000-000000000001', false, default_section_availability() || '{"ask_kiara": false}', 1);
set local role authenticated;
select pg_temp.as_user(4);
select throws_ok($$select start_kiara_turn(null, pg_temp.request(906), 'hello', 'web')$$, '42501', 'This section is currently unavailable', 'staff are refused while the section is dark');
select throws_ok($$select list_my_kiara_conversations(30)$$, '42501', 'This section is currently unavailable', 'history is refused while the section is dark');
select pg_temp.as_user(1);
select lives_ok($$select start_kiara_turn(null, pg_temp.request(1), 'Super Admin tests while dark', 'web')$$, 'Super Admin can use the section while it is dark');
reset role;
update tenant_section_controls set section_availability = section_availability || '{"ask_kiara": true}' where tenant_id = '20510000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user(4);
select lives_ok($$select start_kiara_turn(null, pg_temp.request(2), 'What is pending for me today?', 'web')$$, 'staff can ask once the owner switches the section on');
-- Captured as the owner role so later lookups do not depend on the caller's RLS.
reset role;
select set_config('kiara_test.staff_conversation', (select conversation_id::text from kiara_messages where request_id = pg_temp.request(2)), true);
set local role authenticated;

-- ---------------------------------------------------------------------------
-- start_kiara_turn: shape, idempotency, ownership
-- ---------------------------------------------------------------------------
select is((select (start_kiara_turn(null, pg_temp.request(2), 'What is pending for me today?', 'web') ->> 'replayed')::boolean), true, 'a retried request id is replayed');
select is((select questions from kiara_daily_usage where user_profile_id = '20540000-0000-4000-8000-000000000004'), 1, 'a replay is not counted twice');
select is((select count(*)::integer from kiara_messages where request_id = pg_temp.request(2)), 1, 'a replay does not duplicate the question');
select is((start_kiara_turn(null, pg_temp.request(2), 'x', 'web') -> 'context' ->> 'name'), 'Kiara Staff', 'the turn context names the caller');
select is((start_kiara_turn(null, pg_temp.request(2), 'x', 'web') -> 'context' ->> 'timezone'), 'Asia/Kolkata', 'the turn context carries the tenant timezone');
select is((start_kiara_turn(null, pg_temp.request(2), 'x', 'web') -> 'history'), '[]'::jsonb, 'a new conversation has no history');
select pg_temp.as_user(5);
select throws_ok($$select start_kiara_turn(null, pg_temp.request(2), 'hijack', 'web')$$, '22023', 'Request id already used', 'another user cannot reuse a request id');
select throws_ok(format('select start_kiara_turn(%L, %L, %L, %L)', current_setting('kiara_test.staff_conversation')::uuid, pg_temp.request(907), 'into your chat', 'web'),
  '42501', 'Conversation not found', 'a user cannot write into another user''s conversation');
select pg_temp.as_user(9);
select throws_ok(format('select start_kiara_turn(%L, %L, %L, %L)', current_setting('kiara_test.staff_conversation')::uuid, pg_temp.request(908), 'cross tenant', 'web'),
  '42501', 'Conversation not found', 'a cross-tenant conversation is refused');

-- ---------------------------------------------------------------------------
-- complete_kiara_turn: owner only, once, no text in audit
-- ---------------------------------------------------------------------------
select pg_temp.as_user(5);
select throws_ok(format('select complete_kiara_turn(%L, %L, %L::jsonb, null, null, null, null, null, false, %L, %L, null)', pg_temp.request(2), 'answer', '[{"role":"user","content":"q"},{"role":"assistant","content":[{"type":"text","text":"a"}]}]', 'claude-sonnet-5-5', 'end_turn'),
  '42501', 'Question not found', 'only the asker can complete their question');
select pg_temp.as_user(4);
select throws_ok(format('select complete_kiara_turn(%L, %L, %L::jsonb, null, null, null, null, null, false, %L, %L, null)', pg_temp.request(2), 'answer', '[]', 'claude-sonnet-5-5', 'end_turn'),
  '22023', 'Invalid answer content', 'an empty turn is rejected');
select throws_ok(format('select complete_kiara_turn(%L, %L, %L::jsonb, %L, null, null, null, null, false, %L, %L, null)', pg_temp.request(2), 'answer', '[{"role":"user","content":"q"},{"role":"assistant","content":[{"type":"text","text":"a"}]}]', 'fr', 'claude-sonnet-5-5', 'end_turn'),
  '22023', 'Invalid language', 'unknown languages are rejected');
select lives_ok(format('select complete_kiara_turn(%L, %L, %L::jsonb, %L, null, null, %L, %L, false, %L, %L, %L::jsonb)', pg_temp.request(2), 'You have 2 open tasks.',
  '[{"role":"user","content":[{"type":"text","text":"<turn_context>...</turn_context>"},{"type":"text","text":"What is pending for me today?"}]},{"role":"assistant","content":[{"type":"text","text":"You have 2 open tasks."}]}]',
  'en', '{get_my_work_summary}', '{tasks}', 'claude-sonnet-5-5', 'end_turn', '{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":0,"cache_creation_input_tokens":3000,"requests":2}'),
  'the asker completes their question');
select throws_ok(format('select complete_kiara_turn(%L, %L, %L::jsonb, null, null, null, null, null, false, %L, %L, null)', pg_temp.request(2), 'again', '[{"role":"user","content":"q"},{"role":"assistant","content":[{"type":"text","text":"a"}]}]', 'claude-sonnet-5-5', 'end_turn'),
  '22023', 'This question has already been answered', 'a question is completed only once');
select throws_ok($$select start_kiara_turn(null, pg_temp.request(2), 'What is pending for me today?', 'web')$$, 'P0001', 'kiara_request_completed', 'a completed request cannot be replayed');
select is((select tools_used from kiara_messages where role = 'assistant' and reply_to_message_id = (select id from kiara_messages where request_id = pg_temp.request(2))), '{get_my_work_summary}'::text[], 'tool names are stored with the answer');

-- The next question replays the stored turn verbatim.
select is(jsonb_array_length(start_kiara_turn(current_setting('kiara_test.staff_conversation')::uuid, pg_temp.request(3), 'And tomorrow?', 'web') -> 'history'), 2, 'history replays the completed turn');
select is(start_kiara_turn(current_setting('kiara_test.staff_conversation')::uuid, pg_temp.request(3), 'And tomorrow?', 'web') -> 'history' -> 1 -> 'content' -> 0 ->> 'text', 'You have 2 open tasks.', 'history is the stored API content, unchanged');

reset role;
select ok(not exists (select 1 from audit_logs where module = 'assistant' and (coalesce(new_value::text, '') like '%pending for me%' or coalesce(new_value::text, '') like '%open tasks%' or coalesce(old_value::text, '') like '%pending for me%')), 'audit rows never carry question or answer text');
select ok(exists (select 1 from audit_logs where action = 'assistant_question_started' and actor_user_id = '20540000-0000-4000-8000-000000000004'), 'questions are audited when started');
select ok(exists (select 1 from audit_logs where action = 'assistant_question_answered' and new_value -> 'tools_used' ? 'get_my_work_summary' and (new_value ->> 'cache_creation_tokens')::integer = 3000), 'answers are audited with tools and token counts');
select ok(exists (select 1 from kiara_question_facts where user_profile_id = '20540000-0000-4000-8000-000000000004' and data_categories = '{tasks}' and topic is null), 'a content-free question fact is recorded');

-- ---------------------------------------------------------------------------
-- RLS: messages belong to the asker only, including for Super Admin
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(4);
select ok((select count(*) from kiara_messages) >= 2, 'the asker reads their own messages');
select throws_ok($$select api_content from kiara_messages$$, '42501', null, 'the asker cannot select api_content');
select pg_temp.as_user(5);
select is((select count(*)::integer from kiara_messages), 0, 'another staff member reads none of them');
select is((select count(*)::integer from kiara_conversations), 0, 'another staff member sees no conversations');
select pg_temp.as_user(3);
select is((select count(*)::integer from kiara_messages where conversation_id = current_setting('kiara_test.staff_conversation')::uuid), 0, 'a manager cannot read a staff transcript');
select pg_temp.as_user(1);
select is((select count(*)::integer from kiara_messages m join kiara_conversations c on c.id = m.conversation_id where c.user_profile_id <> '20540000-0000-4000-8000-000000000001'), 0, 'Super Admin cannot read anyone else''s transcript');
select throws_ok(format('select get_my_kiara_conversation(%L)', current_setting('kiara_test.staff_conversation')::uuid), '42501', 'Conversation not found', 'Super Admin cannot open another user''s conversation');
select pg_temp.as_user(4);
select is(jsonb_array_length(get_my_kiara_conversation(current_setting('kiara_test.staff_conversation')::uuid) -> 'messages'), 3, 'the asker opens their conversation');
select ok(not (get_my_kiara_conversation(current_setting('kiara_test.staff_conversation')::uuid)::text like '%turn_context%'), 'the conversation view never includes API content');
select is(jsonb_array_length(list_my_kiara_conversations(30)), 1, 'the asker lists their conversation');
select lives_ok(format('select archive_my_kiara_conversation(%L)', current_setting('kiara_test.staff_conversation')::uuid), 'the asker archives their conversation');
select is(jsonb_array_length(list_my_kiara_conversations(30)), 0, 'archived conversations leave the list');
select throws_ok(format('select start_kiara_turn(%L, %L, %L, %L)', current_setting('kiara_test.staff_conversation')::uuid, pg_temp.request(909), 'after archive', 'web'), '42501', 'Conversation not found', 'an archived conversation takes no new questions');

-- ---------------------------------------------------------------------------
-- Daily limit
-- ---------------------------------------------------------------------------
select pg_temp.as_user(5);
select lives_ok(format('select start_kiara_turn(null, %L, %L, %L)', pg_temp.request(100 + n), 'Question ' || n, 'android'), 'question ' || n || ' of 10 is allowed')
from generate_series(1, 10) n;
select is((get_my_kiara_quota() ->> 'used')::integer, 10, 'ten questions are counted');
select is((get_my_kiara_quota() ->> 'limit')::integer, 10, 'the default limit is 10');
select ok((get_my_kiara_quota() ->> 'resets_at')::timestamptz > now(), 'the quota reports when it resets');
select throws_ok($$select start_kiara_turn(null, pg_temp.request(111), 'Question 11', 'web')$$, 'P0001', 'kiara_daily_limit_reached', 'the 11th question is refused');
select is((select count(*)::integer from kiara_messages where request_id = pg_temp.request(111)), 0, 'a refused question is not stored');

-- Refunds: provider failure before any answer gives the question back, once.
select lives_ok(format('select refund_kiara_question(%L)', pg_temp.request(110)), 'an unanswered recent question is refunded');
select lives_ok(format('select refund_kiara_question(%L)', pg_temp.request(110)), 'a repeated refund is a no-op');
select is((get_my_kiara_quota() ->> 'used')::integer, 9, 'the refund restores one question');
select throws_ok(format('select complete_kiara_turn(%L, %L, %L::jsonb, null, null, null, null, null, false, %L, %L, null)', pg_temp.request(110), 'late', '[{"role":"user","content":"q"},{"role":"assistant","content":[{"type":"text","text":"a"}]}]', 'claude-sonnet-5-5', 'end_turn'),
  '22023', 'This question was refunded', 'a refunded question cannot be completed');
select lives_ok($$select start_kiara_turn(null, pg_temp.request(112), 'Question after refund', 'web')$$, 'the refunded slot can be used');
select throws_ok($$select start_kiara_turn(null, pg_temp.request(113), 'One too many', 'web')$$, 'P0001', 'kiara_daily_limit_reached', 'the limit holds after a refund');
select pg_temp.as_user(4);
select throws_ok(format('select refund_kiara_question(%L)', pg_temp.request(2)), '22023', 'This question cannot be refunded', 'an answered question cannot be refunded');
select throws_ok(format('select refund_kiara_question(%L)', pg_temp.request(101)), '42501', 'Question not found', 'only the asker can refund');
reset role;
update kiara_messages set created_at = now() - interval '20 minutes' where request_id = pg_temp.request(3);
set local role authenticated;
select pg_temp.as_user(4);
select throws_ok(format('select refund_kiara_question(%L)', pg_temp.request(3)), '22023', 'This question cannot be refunded', 'a question older than 15 minutes cannot be refunded');

-- Super Admin is unlimited.
select pg_temp.as_user(1);
select lives_ok(format('select start_kiara_turn(null, %L, %L, %L)', pg_temp.request(200 + n), 'Owner question ' || n, 'web'), 'Super Admin question ' || n)
from generate_series(1, 11) n;
select is(get_my_kiara_quota() -> 'limit', 'null'::jsonb, 'Super Admin has no limit');

-- Per-user exceptions: a lower limit, then unlimited.
reset role;
insert into kiara_user_limits(tenant_id, user_profile_id, daily_question_limit, reason)
values ('20510000-0000-4000-8000-000000000001', '20540000-0000-4000-8000-000000000006', 1, 'test');
set local role authenticated;
select pg_temp.as_user(6);
select lives_ok($$select start_kiara_turn(null, pg_temp.request(300), 'HR question 1', 'web')$$, 'a per-user limit of 1 allows one question');
select throws_ok($$select start_kiara_turn(null, pg_temp.request(301), 'HR question 2', 'web')$$, 'P0001', 'kiara_daily_limit_reached', 'a per-user limit is enforced');
reset role;
update kiara_user_limits set daily_question_limit = null where user_profile_id = '20540000-0000-4000-8000-000000000006';
set local role authenticated;
select pg_temp.as_user(6);
select lives_ok($$select start_kiara_turn(null, pg_temp.request(302), 'HR question 3', 'web')$$, 'a null per-user limit means unlimited');
select is(get_my_kiara_quota() -> 'limit', 'null'::jsonb, 'an unlimited exception reports no limit');

-- An org default change takes effect on the next question.
reset role;
update kiara_settings set daily_question_limit = 12 where tenant_id = '20510000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user(5);
select lives_ok($$select start_kiara_turn(null, pg_temp.request(114), 'After the limit was raised', 'web')$$, 'a raised org limit applies immediately');

-- The day boundary follows the tenant timezone, not UTC.
reset role;
update tenants set timezone = 'Pacific/Kiritimati' where id = '20510000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user(5);
select is((select (kiara_quota_for_test.q ->> 'resets_at')::timestamptz) , (((now() at time zone 'Pacific/Kiritimati')::date + 1)::timestamp at time zone 'Pacific/Kiritimati'), 'the reset time is the next tenant-local midnight')
from (select get_my_kiara_quota() as q) kiara_quota_for_test;
reset role;
select ok(exists (select 1 from kiara_daily_usage where user_profile_id = '20540000-0000-4000-8000-000000000005' and local_date = (now() at time zone 'Asia/Kolkata')::date), 'usage was counted on the tenant-local date');
-- Yesterday's full usage never blocks today.
insert into kiara_daily_usage(tenant_id, user_profile_id, local_date, questions)
values ('20510000-0000-4000-8000-000000000001', '20540000-0000-4000-8000-000000000003', (now() at time zone 'Pacific/Kiritimati')::date - 1, 10);
set local role authenticated;
select pg_temp.as_user(3);
select lives_ok($$select start_kiara_turn(null, pg_temp.request(400), 'Manager first question today', 'web')$$, 'yesterday''s usage does not count today');
select is((get_my_kiara_quota() ->> 'used')::integer, 1, 'today''s count starts fresh');

-- ---------------------------------------------------------------------------
-- Conversation cap: 15 questions per conversation
-- ---------------------------------------------------------------------------
reset role;
update tenants set timezone = 'Asia/Kolkata' where id = '20510000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user(1);
select lives_ok(format('select start_kiara_turn(%L, %L, %L, %L)', (select conversation_id from kiara_messages where request_id = pg_temp.request(201)), pg_temp.request(500 + n), 'Follow-up ' || n, 'web'), 'follow-up ' || n)
from generate_series(1, 14) n;
select throws_ok(format('select start_kiara_turn(%L, %L, %L, %L)', (select conversation_id from kiara_messages where request_id = pg_temp.request(201)), pg_temp.request(515), 'Sixteenth', 'web'),
  'P0001', 'kiara_conversation_full', 'a conversation takes at most 15 questions');

-- RLS on usage and limits: own rows, or the protected limits permission.
select pg_temp.as_user(4);
select is((select count(*)::integer from kiara_daily_usage where user_profile_id <> '20540000-0000-4000-8000-000000000004'), 0, 'staff read only their own usage');
select is((select count(*)::integer from kiara_user_limits), 0, 'staff cannot read other users'' exceptions');
select pg_temp.as_user(2);
select is((select count(*)::integer from kiara_user_limits), 0, 'admins cannot read limits (protected permission)');
select pg_temp.as_user(1);
select is((select count(*)::integer from kiara_user_limits where tenant_id = '20510000-0000-4000-8000-000000000001'), 1, 'Super Admin reads the tenant''s exceptions');
select pg_temp.as_user(9);
select is((select count(*)::integer from kiara_settings), 1, 'a user reads only their own tenant''s settings');

select * from finish();
rollback;
