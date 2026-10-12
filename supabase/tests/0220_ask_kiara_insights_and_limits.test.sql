begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture (synthetic text only). Tenant A (section on): 1 Super Admin, 2 Admin,
-- 3 Manager (5 reports to 3), 4 Manager individually denied assistant.view_insights
-- (6 reports to 4), 5 and 6 staff, 7 staff with no manager, 8 Admin individually
-- who tries to be granted assistant.manage_limits (protected: refused).
-- Tenant B: 9 Super Admin, 10 staff.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('20c00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated', 'ins-' || n || '@example.invalid',
  crypt('local-test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 10) n;

insert into tenants(id, name, slug, timezone) values
  ('20c10000-0000-4000-8000-000000000001', 'INS fixture A', 'ins-fixture-a', 'Asia/Kolkata'),
  ('20c10000-0000-4000-8000-000000000002', 'INS fixture B', 'ins-fixture-b', 'Asia/Kolkata');
insert into branches(id, tenant_id, name, code) values
  ('20c20000-0000-4000-8000-000000000001', '20c10000-0000-4000-8000-000000000001', 'INS branch A1', 'INS-A1'),
  ('20c20000-0000-4000-8000-000000000002', '20c10000-0000-4000-8000-000000000001', 'INS branch A2', 'INS-A2'),
  ('20c20000-0000-4000-8000-000000000003', '20c10000-0000-4000-8000-000000000002', 'INS branch B', 'INS-B');
insert into departments(id, tenant_id, branch_id, name, code) values
  ('20c30000-0000-4000-8000-000000000001', '20c10000-0000-4000-8000-000000000001', '20c20000-0000-4000-8000-000000000001', 'Sales', 'INS-SALES'),
  ('20c30000-0000-4000-8000-000000000002', '20c10000-0000-4000-8000-000000000001', '20c20000-0000-4000-8000-000000000002', 'Drivers', 'INS-DRV'),
  ('20c30000-0000-4000-8000-000000000003', '20c10000-0000-4000-8000-000000000002', '20c20000-0000-4000-8000-000000000003', 'Sales', 'INS-SALES-B');

insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
select ('20c50000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid, ('20c00000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid,
  case f.t when 'A' then '20c10000-0000-4000-8000-000000000001'::uuid else '20c10000-0000-4000-8000-000000000002'::uuid end,
  f.branch::uuid, f.dept::uuid, f.name, '0000220' || lpad(f.n::text, 3, '0'), 'ins-' || f.n || '@example.invalid', 'INS-' || f.n,
  f.role::user_role, 'active', 'active', true, '{}'
from (values
  (1, 'INS Super Admin', 'super_admin', 'A', '20c20000-0000-4000-8000-000000000001', '20c30000-0000-4000-8000-000000000001'),
  (2, 'INS Admin', 'admin', 'A', '20c20000-0000-4000-8000-000000000001', '20c30000-0000-4000-8000-000000000001'),
  (3, 'INS Manager', 'manager', 'A', '20c20000-0000-4000-8000-000000000001', '20c30000-0000-4000-8000-000000000001'),
  (4, 'INS Denied Manager', 'manager', 'A', '20c20000-0000-4000-8000-000000000002', '20c30000-0000-4000-8000-000000000002'),
  (5, 'INS Staff Five', 'staff', 'A', '20c20000-0000-4000-8000-000000000001', '20c30000-0000-4000-8000-000000000001'),
  (6, 'INS Staff Six', 'staff', 'A', '20c20000-0000-4000-8000-000000000002', '20c30000-0000-4000-8000-000000000002'),
  (7, 'INS Staff Seven', 'staff', 'A', '20c20000-0000-4000-8000-000000000001', '20c30000-0000-4000-8000-000000000001'),
  (8, 'INS Granted Admin', 'admin', 'A', '20c20000-0000-4000-8000-000000000001', '20c30000-0000-4000-8000-000000000001'),
  (9, 'INS Other Super Admin', 'super_admin', 'B', '20c20000-0000-4000-8000-000000000003', '20c30000-0000-4000-8000-000000000003'),
  (10, 'INS Other Staff', 'staff', 'B', '20c20000-0000-4000-8000-000000000003', '20c30000-0000-4000-8000-000000000003')
) as f(n, name, role, t, branch, dept);
update user_profiles set reports_to_user_id = '20c50000-0000-4000-8000-000000000003' where id = '20c50000-0000-4000-8000-000000000005';
update user_profiles set reports_to_user_id = '20c50000-0000-4000-8000-000000000004' where id = '20c50000-0000-4000-8000-000000000006';
insert into user_permission_overrides(tenant_id, user_profile_id, permission_key, effect) values
  ('20c10000-0000-4000-8000-000000000001', '20c50000-0000-4000-8000-000000000004', 'assistant.view_insights', 'deny');
-- Both fixture tenants switch the section on (new tenants start with it off).
insert into tenant_section_controls(tenant_id, developer_mode_enabled, section_availability, settings_version)
select id, false, default_section_availability() || '{"ask_kiara": true}', 1 from tenants where id in
  ('20c10000-0000-4000-8000-000000000001', '20c10000-0000-4000-8000-000000000002');

create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '20c00000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'), true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true);
  select set_config('request.jwt.claim.role', 'service_role', true);
$$;
create function pg_temp.profile(p_n integer) returns uuid language sql immutable as $$
  select ('20c50000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid
$$;
-- A stored question with its fact, as if answered `p_days_ago` days ago (written as postgres).
create function pg_temp.question(p_n integer, p_days_ago integer, p_text text) returns uuid language plpgsql as $$
declare v_profile user_profiles; v_conversation uuid; v_message uuid; v_fact uuid; v_at timestamptz := now() - make_interval(days => p_days_ago);
begin
  select * into v_profile from user_profiles where id = pg_temp.profile(p_n);
  insert into kiara_conversations(tenant_id, user_profile_id, title, client, created_at, last_message_at)
  values (v_profile.tenant_id, v_profile.id, left(p_text, 120), 'web', v_at, v_at) returning id into v_conversation;
  insert into kiara_messages(tenant_id, conversation_id, ordinal, role, display_text, request_id, quota_date, created_at)
  values (v_profile.tenant_id, v_conversation, 1, 'user', p_text, gen_random_uuid(), (v_at at time zone 'Asia/Kolkata')::date, v_at)
  returning id into v_message;
  insert into kiara_messages(tenant_id, conversation_id, ordinal, role, display_text, api_content, reply_to_message_id, citations, created_at)
  values (v_profile.tenant_id, v_conversation, 2, 'assistant', 'Synthetic answer', '[{"role":"user","content":"q"},{"role":"assistant","content":"a"}]',
    v_message, '[{"marker":1,"document_id":"00000000-0000-4000-8000-000000000999","title":"Synthetic SOP","chunk_id":"00000000-0000-4000-8000-000000000998"}]', v_at);
  insert into kiara_question_facts(tenant_id, user_profile_id, message_id, asked_at, local_date)
  values (v_profile.tenant_id, v_profile.id, v_message, v_at, (v_at at time zone 'Asia/Kolkata')::date) returning id into v_fact;
  return v_fact;
end $$;
create temp table ids(name text primary key, id uuid, payload jsonb);
grant all on ids to authenticated, service_role;
grant execute on function pg_temp.as_user(integer), pg_temp.as_service(), pg_temp.profile(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shape, grants, and the new-tenant default
-- ---------------------------------------------------------------------------
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('kiara_employee_insights'::regclass, 'kiara_insight_batches'::regclass, 'kiara_insights_job_config'::regclass)),
  'insights, batches and job config have RLS');
select ok(not has_table_privilege('authenticated', 'kiara_employee_insights', 'SELECT') and not has_table_privilege('service_role', 'kiara_employee_insights', 'SELECT')
  and not has_table_privilege('anon', 'kiara_employee_insights', 'SELECT'), 'nobody reads insights rows directly');
select ok(not has_table_privilege('authenticated', 'kiara_insight_batches', 'SELECT') and not has_table_privilege('authenticated', 'kiara_insights_job_config', 'SELECT'),
  'clients cannot read batches or the job config');
select is((production_demo_data_retirement_manifest('20c10000-0000-4000-8000-000000000001')->'retained_counts'->>'kiara_employee_insights')::integer, 0,
  'insights are classified as retained in the retirement manifest');
select is(default_section_availability()->>'ask_kiara', 'false', 'new tenants start with Ask Kiara off');

insert into tenants(id, name, slug, timezone) values ('20c10000-0000-4000-8000-000000000003', 'INS new tenant', 'ins-new-tenant', 'Asia/Kolkata');
insert into branches(id, tenant_id, name, code) values ('20c20000-0000-4000-8000-000000000004', '20c10000-0000-4000-8000-000000000003', 'INS branch N', 'INS-N');
insert into departments(id, tenant_id, branch_id, name, code) values ('20c30000-0000-4000-8000-000000000004', '20c10000-0000-4000-8000-000000000003', '20c20000-0000-4000-8000-000000000004', 'Sales', 'INS-SALES-N');
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('20c00000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'ins-11@example.invalid', crypt('local-test-only', gen_salt('bf')), now(), '{}', '{}', now(), now());
insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
values ('20c50000-0000-4000-8000-000000000011', '20c00000-0000-4000-8000-000000000011', '20c10000-0000-4000-8000-000000000003', '20c20000-0000-4000-8000-000000000004', '20c30000-0000-4000-8000-000000000004', 'INS New Staff',
  '0000220011', 'ins-11@example.invalid', 'INS-11', 'staff', 'active', 'active', true, '{}');
select ok(not exists (select 1 from tenant_section_controls where tenant_id = '20c10000-0000-4000-8000-000000000003'),
  'the new tenant has no stored flags: the default applies');
select pg_temp.as_user(11);
select is(get_section_availability()->'section_availability'->>'ask_kiara', 'false', 'a new tenant sees the section off');
select throws_ok($$select get_my_kiara_quota()$$, '42501', 'This section is currently unavailable', 'a new tenant''s staff cannot use Ask Kiara');
reset role;

-- ---------------------------------------------------------------------------
-- Service-role worker contract
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'claim_kiara_insight_work(uuid,text,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'complete_kiara_insight_batch(uuid,jsonb,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'kiara_insight_inputs(uuid[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'upsert_kiara_insights(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'mark_kiara_insight_batch_submitted(uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'fail_kiara_insight_batch(uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'list_open_kiara_insight_batches()', 'EXECUTE')
  and not has_function_privilege('anon', 'claim_kiara_insight_work(uuid,text,integer,integer)', 'EXECUTE'),
  'API users cannot execute the worker RPCs');
select ok(has_function_privilege('service_role', 'claim_kiara_insight_work(uuid,text,integer,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'upsert_kiara_insights(jsonb)', 'EXECUTE'), 'the service role executes the worker RPCs');
select ok(not has_function_privilege('authenticated', 'purge_kiara_conversations()', 'EXECUTE') and not has_function_privilege('service_role', 'purge_kiara_conversations()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'schedule_kiara_jobs(text)', 'EXECUTE') and not has_function_privilege('service_role', 'schedule_kiara_jobs(text)', 'EXECUTE'),
  'purge and scheduling are owner-only');
-- The function bodies also check the caller (a definer call without the service-role claim).
select pg_temp.as_user(1);
select throws_ok($$select public.kiara_assert_service_role()$$, '42501', 'Service role required', 'an authenticated caller fails the service-role check');
reset role;

insert into ids(name, id) values
  ('f5a', pg_temp.question(5, 1, 'Synthetic: how do I apply for leave?')),
  ('f5b', pg_temp.question(5, 2, 'Synthetic: uniform rules?')),
  ('f6a', pg_temp.question(6, 3, 'Synthetic: fuel slip process?')),
  ('f6old', pg_temp.question(6, 70, 'Synthetic: too old to label'));

select pg_temp.as_service();
set local role service_role;
select lives_ok($$insert into ids(name, payload) values ('claim1', claim_kiara_insight_work(null, 'nightly', 200, 40))$$, 'the service role claims new questions');
reset role;
select is((select jsonb_array_length(payload->'items') from ids where name = 'claim1'), 2, 'two employees have new questions');
select is((select count(*)::integer from jsonb_array_elements((select payload->'items' from ids where name = 'claim1')) i, jsonb_array_elements(i->'questions') q), 3,
  'only the three questions inside the 60-day window are claimed');
select ok((select bool_and(q ? 'text' and not q ? 'answer') from jsonb_array_elements((select payload->'items' from ids where name = 'claim1')) i, jsonb_array_elements(i->'questions') q),
  'claimed items carry the question text only');
select is((select count(*)::integer from kiara_question_facts where labelling_batch_id = (select (payload->>'batch_id')::uuid from ids where name = 'claim1')), 3, 'the facts are claimed by the batch');

select pg_temp.as_service();
set local role service_role;
select is(claim_kiara_insight_work(null, 'nightly', 200, 40), null, 'a second run skips employees without new questions');
select lives_ok($$select mark_kiara_insight_batch_submitted((select (payload->>'batch_id')::uuid from ids where name = 'claim1'), 'msgbatch_test01')$$, 'the batch is marked submitted');
select is(jsonb_array_length(list_open_kiara_insight_batches()), 1, 'one batch is open');
select is((select array_agg(k order by k) from jsonb_array_elements(list_open_kiara_insight_batches()) b, jsonb_object_keys(b->'item_facts') k),
  (select array_agg(x order by x) from unnest(array[pg_temp.profile(5)::text, pg_temp.profile(6)::text]) x), 'the open batch maps each item to its claimed question ids');
select is((select jsonb_array_length(b->'item_facts'->pg_temp.profile(5)::text) from jsonb_array_elements(list_open_kiara_insight_batches()) b), 2,
  'with every claimed question of that employee');
select ok(not (list_open_kiara_insight_batches()::text ilike '%Synthetic:%'), 'the open batch list carries ids only, no question text');
-- Staff 5's item succeeded; staff 6's item failed (not in the results).
select lives_ok($$insert into ids(name, payload) values ('done1', complete_kiara_insight_batch((select (payload->>'batch_id')::uuid from ids where name = 'claim1'),
  jsonb_build_array(jsonb_build_object('user_profile_id', pg_temp.profile(5), 'summary', 'Mostly asks about leave and uniforms.',
    'questions', jsonb_build_array(
      jsonb_build_object('id', (select id from ids where name = 'f5a'), 'category', 'sop', 'sop_level', 'basic', 'topic', 'Leave'),
      jsonb_build_object('id', (select id from ids where name = 'f5b'), 'category', 'sop', 'sop_level', null, 'topic', 'Uniform')))),
  'claude-sonnet-5-5'))$$, 'an ended batch is applied');
select throws_ok($$select complete_kiara_insight_batch(gen_random_uuid(), '[]', null)$$, '22023', 'Batch not found', 'an unknown batch is refused');
reset role;
select is((select (payload->>'labelled')::integer from ids where name = 'done1'), 2, 'two questions were labelled');
select is((select (payload->>'released')::integer from ids where name = 'done1'), 1, 'the failed item''s question is given back');
select is((select sop_level from kiara_question_facts where id = (select id from ids where name = 'f5b')), 'intermediate', 'an SOP label without a level defaults to intermediate');
select is((select summary from kiara_employee_insights where user_profile_id = pg_temp.profile(5)), 'Mostly asks about leave and uniforms.', 'the summary is stored');
select ok((select labelled_at is null and labelling_batch_id is null and label_attempts = 1 from kiara_question_facts where id = (select id from ids where name = 'f6a')),
  'the failed question is unlabelled and free again');

select pg_temp.as_service();
set local role service_role;
select is((complete_kiara_insight_batch((select (payload->>'batch_id')::uuid from ids where name = 'claim1'), '[]', null)->>'already_closed')::boolean, true,
  'completing a closed batch again is a no-op');
select lives_ok($$insert into ids(name, payload) values ('claim2', claim_kiara_insight_work(null, 'nightly', 200, 40))$$, 'the next run claims again');
reset role;
select is((select jsonb_agg(i->>'user_profile_id') from jsonb_array_elements((select payload->'items' from ids where name = 'claim2')) i),
  jsonb_build_array(pg_temp.profile(6)::text), 'a failed batch item is retried on the next run');
select is((select label_attempts from kiara_question_facts where id = (select id from ids where name = 'f6a')), 2::smallint, 'attempts are counted');
select pg_temp.as_service();
set local role service_role;
select is(fail_kiara_insight_batch((select (payload->>'batch_id')::uuid from ids where name = 'claim2'), 'provider down'), 1, 'a failed submission gives the questions back');
select is((select jsonb_array_length(f->'facts') from jsonb_array_elements(kiara_insight_inputs(array[pg_temp.profile(5)])) f), 2, 'the rating inputs hold the labelled facts');
select is((select f->'facts'->0->'documents' from jsonb_array_elements(kiara_insight_inputs(array[pg_temp.profile(5)])) f), '["Synthetic SOP"]'::jsonb,
  'the rating inputs carry the cited SOP titles');
select throws_ok($$select upsert_kiara_insights(jsonb_build_array(jsonb_build_object('user_profile_id', pg_temp.profile(5), 'status', 'rated', 'rating', 3, 'classification', 'veteran')))$$,
  '22023', 'Invalid rating', 'a class that does not match the rating is refused');
select is(upsert_kiara_insights(jsonb_build_array(
  jsonb_build_object('user_profile_id', pg_temp.profile(5), 'period_start', current_date - 59, 'period_end', current_date, 'status', 'rated', 'rating', 2,
    'classification', 'fresher', 'question_count', 12, 'sop_question_count', 10, 'active_days', 5, 'basic_count', 6, 'repeat_count', 2, 'escalated_count', 1,
    'last_active_on', current_date, 'top_topics', jsonb_build_array('Leave'), 'top_documents', jsonb_build_array('Synthetic SOP'), 'top_departments', '[]'::jsonb, 'formula_version', 1),
  jsonb_build_object('user_profile_id', pg_temp.profile(6), 'status', 'insufficient_data', 'rating', null, 'classification', null, 'question_count', 2,
    'sop_question_count', 1, 'active_days', 1, 'basic_count', 0, 'repeat_count', 0, 'escalated_count', 0, 'formula_version', 1),
  jsonb_build_object('user_profile_id', pg_temp.profile(3), 'status', 'rated', 'rating', 4, 'classification', 'veteran', 'question_count', 20,
    'sop_question_count', 9, 'active_days', 6, 'basic_count', 1, 'repeat_count', 0, 'escalated_count', 0, 'formula_version', 1),
  jsonb_build_object('user_profile_id', pg_temp.profile(1), 'status', 'rated', 'rating', 5, 'classification', 'veteran', 'question_count', 30,
    'sop_question_count', 9, 'active_days', 6, 'basic_count', 0, 'repeat_count', 0, 'escalated_count', 0, 'formula_version', 1),
  jsonb_build_object('user_profile_id', pg_temp.profile(10), 'status', 'insufficient_data', 'rating', null, 'classification', null, 'question_count', 1,
    'sop_question_count', 0, 'active_days', 1, 'basic_count', 0, 'repeat_count', 0, 'escalated_count', 0, 'formula_version', 1))), 5, 'ratings are stored');
reset role;
select is((select summary from kiara_employee_insights where user_profile_id = pg_temp.profile(5)), 'Mostly asks about leave and uniforms.', 'a rating update keeps the summary');

-- ---------------------------------------------------------------------------
-- Who sees insights
-- ---------------------------------------------------------------------------
create function pg_temp.insight_ids(p_filters jsonb default '{}') returns uuid[] language sql as $$
  select coalesce(array_agg((r->>'user_profile_id')::uuid order by r->>'user_profile_id'), '{}') from jsonb_array_elements(get_kiara_insights(p_filters)->'rows') r
$$;
grant execute on function pg_temp.insight_ids(jsonb) to authenticated;

select pg_temp.as_user(1);
select is(pg_temp.insight_ids(), array[pg_temp.profile(3), pg_temp.profile(5), pg_temp.profile(6)], 'Super Admin sees the tenant, never their own row or another tenant''s');
select is((get_kiara_insights('{}')->'refresh'->>'allowed')::boolean, true, 'Super Admin may refresh');
select is(pg_temp.insight_ids('{"classification":"fresher"}'), array[pg_temp.profile(5)], 'filter by class');
select is(pg_temp.insight_ids('{"classification":"insufficient_data"}'), array[pg_temp.profile(6)], 'filter "Not enough questions yet"');
select is(pg_temp.insight_ids('{"branch_id":"20c20000-0000-4000-8000-000000000002"}'), array[pg_temp.profile(6)], 'filter by branch');
select is(pg_temp.insight_ids('{"department_id":"20c30000-0000-4000-8000-000000000001"}'), array[pg_temp.profile(3), pg_temp.profile(5)], 'filter by department');
select is((select array_agg(r->>'name') from jsonb_array_elements(get_kiara_insights('{"sort":"activity"}')->'rows') r),
  array['INS Manager', 'INS Staff Five', 'INS Staff Six'], 'sort by activity');
select is((select array_agg(r->>'name') from jsonb_array_elements(get_kiara_insights('{"sort":"rating"}')->'rows') r),
  array['INS Manager', 'INS Staff Five', 'INS Staff Six'], 'sort by rating (no rating last)');
select throws_ok($$select get_kiara_insights('{"user_profile_id":"x"}')$$, '22023', null, 'unknown filters are refused');
select ok(not exists (select 1 from jsonb_array_elements(get_kiara_insights('{}')->'rows') r where r ? 'text' or r ? 'questions'),
  'rows carry labels and counts, never questions');
reset role;
select ok(exists (select 1 from audit_logs where action = 'assistant_insights_viewed' and actor_user_id = pg_temp.profile(1) and new_value ? 'count'
  and not new_value::text ilike '%leave and uniforms%'), 'viewing is audited without content');

select pg_temp.as_user(2);
select is(pg_temp.insight_ids(), array[pg_temp.profile(1), pg_temp.profile(3), pg_temp.profile(5), pg_temp.profile(6)], 'Admin sees the tenant');
select is((get_kiara_insights('{}')->'refresh'->>'allowed')::boolean, false, 'Admin may not refresh');
reset role;
select pg_temp.as_user(3);
select is(pg_temp.insight_ids(), array[pg_temp.profile(5)], 'a manager sees only their reports-to tree, not their own row');
reset role;
select pg_temp.as_user(4);
select throws_ok($$select get_kiara_insights('{}')$$, '42501', 'Viewing insights requires permission', 'a manager denied the permission cannot view');
reset role;
select pg_temp.as_user(5);
select throws_ok($$select get_kiara_insights('{}')$$, '42501', 'Viewing insights requires permission', 'staff cannot view insights (not even their own)');
reset role;
select pg_temp.as_user(9);
select is(pg_temp.insight_ids(), array[pg_temp.profile(10)], 'another tenant''s Super Admin sees only their own tenant');
reset role;

-- ---------------------------------------------------------------------------
-- "Refresh insights now": Super Admin only, once an hour, audited
-- ---------------------------------------------------------------------------
select pg_temp.as_user(2);
select throws_ok($$select request_kiara_insights_refresh()$$, '42501', 'Only Super Admin can refresh insights', 'Admin cannot refresh');
reset role;
select pg_temp.as_user(1);
select throws_ok($$select request_kiara_insights_refresh()$$, 'P0001', 'kiara_insights_not_configured', 'refresh fails closed before the jobs are scheduled');
reset role;
insert into kiara_insights_job_config(function_url) values ('http://127.0.0.1:54321/functions/v1/kiara-insights');
select ok(vault.create_secret('synthetic-test-secret', 'kiara_insights_cron_secret') is not null, 'fixture: the cron secret is in Vault');
select pg_temp.as_user(1);
select lives_ok($$select request_kiara_insights_refresh()$$, 'Super Admin refreshes once');
select throws_ok($$select request_kiara_insights_refresh()$$, 'P0001', 'kiara_insights_refresh_too_soon', 'a second refresh within the hour is refused');
reset role;
select ok(exists (select 1 from audit_logs where action = 'assistant_insights_refresh_requested' and actor_user_id = pg_temp.profile(1)), 'refresh is audited');
select ok(exists (select 1 from net.http_request_queue where convert_from(body, 'utf8')::jsonb->>'mode' = 'refresh'
  and headers->>'x-cron-secret' = 'synthetic-test-secret' and url like '%/functions/v1/kiara-insights'),
  'refresh queues one call to the worker with the cron secret');
update kiara_settings set insights_refresh_requested_at = now() - interval '61 minutes' where tenant_id = '20c10000-0000-4000-8000-000000000001';
select pg_temp.as_user(1);
select lives_ok($$select request_kiara_insights_refresh()$$, 'refresh is allowed again after an hour');
reset role;
select pg_temp.as_user(9);
select lives_ok($$select request_kiara_insights_refresh()$$, 'the limit is per tenant');
reset role;

-- ---------------------------------------------------------------------------
-- Limits: Super Admin only (protected key)
-- ---------------------------------------------------------------------------
select throws_ok($$insert into user_permission_overrides(tenant_id, user_profile_id, permission_key, effect)
  values ('20c10000-0000-4000-8000-000000000001', pg_temp.profile(8), 'assistant.manage_limits', 'grant')$$, null, null,
  'the protected limits key cannot be granted to anyone');
select throws_ok($$insert into role_permissions(tenant_id, user_role, permission_key, is_allowed)
  values ('20c10000-0000-4000-8000-000000000001', 'admin', 'assistant.manage_limits', true)$$, null, null,
  'nor to the admin role');
select pg_temp.as_user(8);
select is(has_permission('assistant.manage_limits'), false, 'an admin does not hold the limits key');
select throws_ok($$select get_kiara_limits()$$, '42501', 'Managing Ask Kiara limits requires permission', 'that admin still cannot open limits');
select throws_ok($$select save_kiara_settings_with_audit(5, 180, 1)$$, '42501', null, 'nor change them');
reset role;
select pg_temp.as_user(2);
select throws_ok($$select list_kiara_usage(null, null)$$, '42501', null, 'admin cannot read usage');
reset role;
select pg_temp.as_user(5);
select throws_ok($$select save_kiara_user_limit_with_audit(pg_temp.profile(5), null, true, false, null)$$, '42501', null, 'staff cannot give themselves unlimited questions');
reset role;

select pg_temp.as_user(1);
select is((get_kiara_limits()->'settings'->>'daily_question_limit')::integer, 10, 'the company limit starts at 10');
select throws_ok($$select save_kiara_settings_with_audit(5, 180, 99)$$, '40001', null, 'a stale version is refused');
select throws_ok($$select save_kiara_settings_with_audit(501, 180, 1)$$, '22023', null, 'the limit is 0 to 500');
select throws_ok($$select save_kiara_settings_with_audit(5, 20, 1)$$, '22023', null, 'retention is 30 to 730 days');
select is((save_kiara_settings_with_audit(2, 90, 1)->>'daily_question_limit')::integer, 2, 'Super Admin sets the company limit to 2');
reset role;
select ok(exists (select 1 from audit_logs where action = 'assistant_settings_saved' and old_value->>'daily_question_limit' = '10' and new_value->>'daily_question_limit' = '2'),
  'the settings change is audited with old and new values');

-- The next question already follows the new limit.
select pg_temp.as_user(7);
select lives_ok($$select start_kiara_turn(null, gen_random_uuid(), 'Synthetic question one', 'web')$$, 'first question');
select lives_ok($$select start_kiara_turn(null, gen_random_uuid(), 'Synthetic question two', 'web')$$, 'second question');
select throws_ok($$select start_kiara_turn(null, gen_random_uuid(), 'Synthetic question three', 'web')$$, 'P0001', 'kiara_daily_limit_reached', 'the third is refused at limit 2');
reset role;

select pg_temp.as_user(1);
select throws_ok($$select save_kiara_user_limit_with_audit(pg_temp.profile(1), 5, false, false, null)$$, '22023', 'Super Admin has no daily limit', 'Super Admin cannot get an exception');
select throws_ok($$select save_kiara_user_limit_with_audit(pg_temp.profile(10), 5, false, false, null)$$, '42501', 'Employee not found', 'another tenant''s employee cannot get an exception');
select throws_ok($$select save_kiara_user_limit_with_audit(pg_temp.profile(7), null, false, false, null)$$, '22023', null, 'a limited exception needs a number');
select lives_ok($$select save_kiara_user_limit_with_audit(pg_temp.profile(7), 3, false, false, 'Synthetic: pilot user')$$, 'a higher personal limit');
reset role;
select pg_temp.as_user(7);
select is((get_my_kiara_quota()->>'limit')::integer, 3, 'the exception applies at once');
select lives_ok($$select start_kiara_turn(null, gen_random_uuid(), 'Synthetic question three again', 'web')$$, 'the third question is now allowed');
reset role;
select pg_temp.as_user(1);
select lives_ok($$select save_kiara_user_limit_with_audit(pg_temp.profile(7), null, true, false, null)$$, 'unlimited');
reset role;
select pg_temp.as_user(7);
select is(get_my_kiara_quota()->'limit', 'null'::jsonb, 'an unlimited exception reports no limit (the chip is hidden)');
reset role;
select pg_temp.as_user(1);
select is(jsonb_array_length(get_kiara_limits()->'exceptions'), 1, 'the exception is listed');
select lives_ok($$select save_kiara_user_limit_with_audit(pg_temp.profile(7), null, false, true, null)$$, 'clear the exception');
reset role;
select pg_temp.as_user(7);
select is((get_my_kiara_quota()->>'limit')::integer, 2, 'cleared: back to the company limit');
reset role;
select is((select count(*)::integer from audit_logs where action = 'assistant_user_limit_saved' and record_id = pg_temp.profile(7)), 3, 'every exception change is audited');

select pg_temp.as_user(1);
select is((list_kiara_usage(null, null)->'totals'->>'total')::integer, 3, 'usage totals today''s questions');
select is((select (p->>'total')::integer from jsonb_array_elements(list_kiara_usage(null, null)->'people') p where p->>'user_profile_id' = pg_temp.profile(7)::text), 3,
  'usage per person');
select throws_ok($$select list_kiara_usage(current_date - 40, current_date)$$, '22023', 'Choose up to 31 days', 'the usage range is bounded');
select is((select count(*)::integer from jsonb_array_elements(search_kiara_limit_people('INS Staff'))), 3, 'people search finds active colleagues in the tenant');
reset role;

-- ---------------------------------------------------------------------------
-- Retention purge: old messages go, facts stay (until 365 days)
-- ---------------------------------------------------------------------------
insert into ids(name, id) values ('old', pg_temp.question(5, 100, 'Synthetic: old question'));
insert into ids(name, id) values ('ancient', pg_temp.question(5, 400, 'Synthetic: very old question'));
insert into ids(name, id) values ('recent', pg_temp.question(5, 10, 'Synthetic: recent question'));
-- Tenant A keeps chats 90 days (set above).
select lives_ok($$insert into ids(name, payload) values ('purge', purge_kiara_conversations())$$, 'the purge runs');
select ok((select message_id is null from kiara_question_facts where id = (select id from ids where name = 'old')), 'an old conversation''s messages are deleted');
select ok(exists (select 1 from kiara_question_facts where id = (select id from ids where name = 'old')), 'its question fact is kept');
select ok(not exists (select 1 from kiara_question_facts where id = (select id from ids where name = 'ancient')), 'facts older than 365 days are deleted');
select ok((select message_id is not null from kiara_question_facts where id = (select id from ids where name = 'recent')), 'recent conversations are kept');
select ok(exists (select 1 from audit_logs where action = 'assistant_retention_purged' and tenant_id = '20c10000-0000-4000-8000-000000000001'
  and (new_value->>'conversations')::integer >= 2), 'the purge is audited per tenant with counts only');
select throws_ok($$select schedule_kiara_jobs('http://127.0.0.1:54321/functions/v1/kiara-insights')$$, '23514', null,
  'scheduling fails closed where pg_cron is not installed');

select * from finish();
rollback;
