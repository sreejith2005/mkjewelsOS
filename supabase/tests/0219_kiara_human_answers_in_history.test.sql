begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture (synthetic text only). One tenant: 1 staff asker reporting to 2 (manager),
-- 3 another staff member.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('20b00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated', 'kha-' || n || '@example.invalid',
  crypt('local-test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 3) n;
insert into tenants(id, name, slug, timezone) values ('20b10000-0000-4000-8000-000000000001', 'KHA fixture', 'kha-fixture', 'Asia/Kolkata');
-- The fixture tenants have Ask Kiara switched on (new tenants start with it off, 0220).
insert into tenant_section_controls(tenant_id, developer_mode_enabled, section_availability, settings_version)
select id, false, default_section_availability() || '{"ask_kiara": true}', 1 from tenants where id in ('20b10000-0000-4000-8000-000000000001');
insert into branches(id, tenant_id, name, code) values ('20b20000-0000-4000-8000-000000000001', '20b10000-0000-4000-8000-000000000001', 'KHA branch', 'KHA-1');
insert into departments(id, tenant_id, branch_id, name, code)
values ('20b30000-0000-4000-8000-000000000001', '20b10000-0000-4000-8000-000000000001', '20b20000-0000-4000-8000-000000000001', 'Sales', 'KHA-SALES');
insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
select ('20b50000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid, ('20b00000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid,
  '20b10000-0000-4000-8000-000000000001', '20b20000-0000-4000-8000-000000000001', '20b30000-0000-4000-8000-000000000001',
  f.name, '0000220' || lpad(f.n::text, 3, '0'), 'kha-' || f.n || '@example.invalid', 'KHA-' || f.n, f.role::user_role, 'active', 'active', true, '{}'
from (values (1, 'KHA Asker', 'staff'), (2, 'KHA Manager', 'manager'), (3, 'KHA Other Staff', 'staff')) as f(n, name, role);
update user_profiles set reports_to_user_id = '20b50000-0000-4000-8000-000000000002' where id = '20b50000-0000-4000-8000-000000000001';

create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '20b00000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'), true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;
create temp table ids(name text primary key, id uuid);
create temp table started(name text primary key, value jsonb);
grant all on ids, started to authenticated;
grant execute on function pg_temp.as_user(integer) to authenticated;

select ok(not has_function_privilege('anon', 'start_kiara_turn(uuid,uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'start_kiara_turn(uuid,uuid,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'start_kiara_turn(uuid,uuid,text,text)', 'EXECUTE'),
  'start_kiara_turn keeps its grants: authenticated only');

-- The asker's question, Kiara's offer, and the confirmed escalation.
set local role authenticated;
select pg_temp.as_user(1);
insert into ids select 'request1', gen_random_uuid();
insert into started select 'first', start_kiara_turn(null, (select id from ids where name = 'request1'), 'Synthetic question: may staff bring pets?', 'web');
insert into ids select 'conversation', (value ->> 'conversation_id')::uuid from started where name = 'first';
insert into ids select 'offer', complete_kiara_turn((select id from ids where name = 'request1'), 'I could not find this. You can send it to a person.',
  '[{"role":"user","content":[{"type":"text","text":"q1"}]},{"role":"assistant","content":[{"type":"text","text":"a1"}]}]'::jsonb, 'en', '[]'::jsonb,
  jsonb_build_object('offer_id', gen_random_uuid(), 'reason', 'no_kb_match', 'summary_en', 'Synthetic summary: pets in the showroom'),
  array['search_knowledge_base'], array['knowledge'], false, 'claude-sonnet-5-5', 'end_turn', '{}'::jsonb);
insert into ids select 'escalation', (create_kiara_escalation((select id from ids where name = 'offer')) ->> 'escalation_id')::uuid;

select is((select value -> 'human_answers' from started where name = 'first'), '[]'::jsonb, 'a new conversation has no human answers');
insert into ids select 'request2', gen_random_uuid();
insert into started select 'before_answer', start_kiara_turn((select id from ids where name = 'conversation'), (select id from ids where name = 'request2'), 'Synthetic follow-up', 'web');
select is((select value -> 'human_answers' from started where name = 'before_answer'), '[]'::jsonb, 'an open escalation is not an answer');

-- The manager answers.
select pg_temp.as_user(2);
select lives_ok(format('select answer_kiara_escalation_with_audit(%L, %L, false, null)', (select id from ids where name = 'escalation'),
  'Synthetic answer: only guide dogs are allowed.'), 'the manager answers');

-- The asker's next turn carries the answer; the stored history is unchanged.
select pg_temp.as_user(1);
insert into started select 'after_answer', start_kiara_turn((select id from ids where name = 'conversation'), (select id from ids where name = 'request2'), 'Synthetic follow-up', 'web');
select is(jsonb_array_length((select value -> 'human_answers' from started where name = 'after_answer')), 1, 'one human answer is returned');
select is((select value -> 'human_answers' -> 0 ->> 'escalation_id' from started where name = 'after_answer'), (select id::text from ids where name = 'escalation'), 'it names its escalation');
select is((select value -> 'human_answers' -> 0 ->> 'answered_by' from started where name = 'after_answer'), 'KHA Manager (Manager)', 'it names who answered (name and designation or role)');
select is((select value -> 'human_answers' -> 0 ->> 'question' from started where name = 'after_answer'), 'Synthetic summary: pets in the showroom', 'it carries the question summary');
select is((select value -> 'human_answers' -> 0 ->> 'answer' from started where name = 'after_answer'), 'Synthetic answer: only guide dogs are allowed.', 'it carries the answer text');
select ok((select value -> 'human_answers' -> 0 ->> 'answered_at' from started where name = 'after_answer') is not null, 'it carries the answer time');
select is((select value -> 'history' from started where name = 'after_answer'), (select value -> 'history' from started where name = 'before_answer'),
  'history is unchanged by the answer (append-only: answers are not spliced into stored turns)');
select is((select value -> 'history' from started where name = 'after_answer'),
  '[{"role":"user","content":[{"type":"text","text":"q1"}]},{"role":"assistant","content":[{"type":"text","text":"a1"}]}]'::jsonb,
  'history is exactly the stored assistant turns');

-- Other conversations never see it.
insert into started select 'other_conversation', start_kiara_turn(null, gen_random_uuid(), 'Synthetic unrelated question', 'web');
select is((select value -> 'human_answers' from started where name = 'other_conversation'), '[]'::jsonb, 'another conversation of the asker has no human answers');
select pg_temp.as_user(3);
select throws_ok(format('select start_kiara_turn(%L, gen_random_uuid(), %L, %L)', (select id from ids where name = 'conversation'), 'Synthetic', 'web'),
  '42501', 'Conversation not found', 'another user cannot open the conversation to read its answers');

reset role;
select * from finish();
rollback;
