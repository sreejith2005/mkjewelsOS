begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fixture (synthetic text only). Tenant A has two branches. Department names
-- repeat per branch with different spelling ("Sales" in A1, "  sALES " in A2),
-- "Accounts" is tenant-wide (no branch), "Drivers" is in A1.
-- Users in A: 1 Super Admin (Drivers), 2 Admin (Drivers), 3 Manager (Drivers),
-- 4 staff Sales A1, 5 staff Sales A2, 6 staff Drivers, 7 HR (Drivers),
-- 8 staff Accounts, 9 staff Drivers with assistant.manage_knowledge,
-- 10 staff Drivers with manager dashboard authority, 11 staff Drivers with
-- admin dashboard authority, 14 staff Drivers who later moves to a new branch.
-- Tenant B: 12 staff in its own "Sales", 13 Super Admin.
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('20900000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated', 'dt-' || n || '@example.invalid',
  crypt('local-test-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from generate_series(1, 15) n;

insert into tenants(id, name, slug, timezone) values
  ('20910000-0000-4000-8000-000000000001', 'DT fixture A', 'dt-fixture-a', 'Asia/Kolkata'),
  ('20910000-0000-4000-8000-000000000002', 'DT fixture B', 'dt-fixture-b', 'Asia/Kolkata');
insert into branches(id, tenant_id, name, code) values
  ('20920000-0000-4000-8000-000000000001', '20910000-0000-4000-8000-000000000001', 'DT branch A1', 'DT-A1'),
  ('20920000-0000-4000-8000-000000000002', '20910000-0000-4000-8000-000000000001', 'DT branch A2', 'DT-A2'),
  ('20920000-0000-4000-8000-000000000003', '20910000-0000-4000-8000-000000000002', 'DT branch B', 'DT-B');
insert into departments(id, tenant_id, branch_id, name, code) values
  ('20930000-0000-4000-8000-000000000001', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000001', 'Sales', 'DT-SALES-A1'),
  ('20930000-0000-4000-8000-000000000002', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000002', '  sALES ', 'DT-SALES-A2'),
  ('20930000-0000-4000-8000-000000000003', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000001', 'Drivers', 'DT-DRV'),
  ('20930000-0000-4000-8000-000000000004', '20910000-0000-4000-8000-000000000001', null, 'Accounts', 'DT-ACC'),
  ('20930000-0000-4000-8000-000000000005', '20910000-0000-4000-8000-000000000002', '20920000-0000-4000-8000-000000000003', 'Sales', 'DT-SALES-B');

insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, personal_mobile, email, employee_code, user_role, working_status, account_status, is_login_enabled, week_off)
select ('20940000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid, ('20900000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid,
  f.tenant::uuid, f.branch::uuid, f.dept::uuid,
  f.name, '0000209' || lpad(f.n::text, 3, '0'), 'dt-' || f.n || '@example.invalid', 'DT-' || f.n, f.role::user_role,
  'active', 'active', true, '{}'
from (values
  (1, 'DT Super Admin', 'super_admin', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000001', '20930000-0000-4000-8000-000000000003'),
  (2, 'DT Admin', 'admin', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000001', '20930000-0000-4000-8000-000000000003'),
  (3, 'DT Manager', 'manager', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000001', '20930000-0000-4000-8000-000000000003'),
  (4, 'DT Sales A1', 'staff', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000001', '20930000-0000-4000-8000-000000000001'),
  (5, 'DT Sales A2', 'staff', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000002', '20930000-0000-4000-8000-000000000002'),
  (6, 'DT Driver', 'staff', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000001', '20930000-0000-4000-8000-000000000003'),
  (7, 'DT HR', 'hr', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000001', '20930000-0000-4000-8000-000000000003'),
  (8, 'DT Accounts', 'staff', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000002', '20930000-0000-4000-8000-000000000004'),
  (9, 'DT Knowledge Staff', 'staff', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000001', '20930000-0000-4000-8000-000000000003'),
  (10, 'DT Staff Manager Authority', 'staff', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000001', '20930000-0000-4000-8000-000000000003'),
  (11, 'DT Staff Admin Authority', 'staff', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000001', '20930000-0000-4000-8000-000000000003'),
  (12, 'DT Other Sales', 'staff', '20910000-0000-4000-8000-000000000002', '20920000-0000-4000-8000-000000000003', '20930000-0000-4000-8000-000000000005'),
  (13, 'DT Other Super Admin', 'super_admin', '20910000-0000-4000-8000-000000000002', '20920000-0000-4000-8000-000000000003', '20930000-0000-4000-8000-000000000005'),
  (14, 'DT Mover', 'staff', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000001', '20930000-0000-4000-8000-000000000003')
) as f(n, name, role, tenant, branch, dept);
insert into user_access_profiles(user_profile_id, tenant_id, dashboard_authority) values
  ('20940000-0000-4000-8000-000000000010', '20910000-0000-4000-8000-000000000001', 'manager'),
  ('20940000-0000-4000-8000-000000000011', '20910000-0000-4000-8000-000000000001', 'admin');
insert into user_permission_overrides(tenant_id, user_profile_id, permission_key, effect)
values ('20910000-0000-4000-8000-000000000001', '20940000-0000-4000-8000-000000000009', 'assistant.manage_knowledge', 'grant');
create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '20900000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'), true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
$$;
create function pg_temp.chunks(p_text text) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('heading_path', 'Synthetic', 'content', p_text))
$$;
-- Titles the caller finds for a query, in rank order.
create function pg_temp.ranked(p_query text) returns text[] language sql as $$
  select coalesce(array_agg(r ->> 'title' order by o), '{}')
  from jsonb_array_elements(search_kiara_knowledge(p_query, null, 8) -> 'results') with ordinality as x(r, o)
$$;
create function pg_temp.found(p_query text) returns text[] language sql as $$
  select coalesce(array_agg(t order by t), '{}') from unnest(pg_temp.ranked(p_query)) t
$$;
create temp table docs(name text primary key, id uuid, chunk_id uuid);
grant all on docs to authenticated;
-- Titles whose citation excerpt the caller may open (same fixture chunks).
create function pg_temp.excerpts() returns text[] language sql as $$
  select coalesce(array_agg(d.name order by d.name), '{}') from docs d
  where d.name like 'V%' and (get_kiara_knowledge_excerpt(d.chunk_id) ->> 'available')::boolean
$$;
grant execute on function pg_temp.as_user(integer), pg_temp.chunks(text), pg_temp.ranked(text), pg_temp.found(text), pg_temp.excerpts() to authenticated;

-- ---------------------------------------------------------------------------
-- Shape, grants, helpers
-- ---------------------------------------------------------------------------
select has_column('kiara_documents', 'visibility', 'audience is renamed to visibility');
select hasnt_column('kiara_documents', 'audience', 'the old audience column is gone');
select is(kiara_department_key('  Karigar   Designers '), 'karigar designers', 'department keys ignore case and extra spaces');
select is(kiara_department_keys(array['Sales', ' sales ', 'Drivers', '']), array['drivers', 'sales'], 'tag keys are distinct and sorted');
select ok(not has_function_privilege('authenticated', 'kiara_document_visible(text,text,boolean,text,text[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'kiara_kb_clean_tags(user_profiles,text[])', 'EXECUTE'), 'visibility helpers stay owner-only');
select ok(not has_function_privilege('service_role', 'bulk_update_kiara_documents_access_with_audit(uuid[],text,text[],text)', 'EXECUTE')
  and not has_function_privilege('anon', 'get_kiara_knowledge_filters()', 'EXECUTE'), 'anon and service role cannot call the new KB RPCs');

-- ---------------------------------------------------------------------------
-- Tagging rules (Super Admin)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(1);
select throws_ok($$select save_kiara_document_text_with_audit(null, 'Untagged dept doc', null, 'departments', 'Synthetic zircon.', pg_temp.chunks('Synthetic zircon.'), null)$$,
  '22023', 'Choose at least one department for a department-only document', 'a department-only document needs a department');
select throws_ok($$select save_kiara_document_text_with_audit(null, 'Ghost dept', null, 'everyone', 'Synthetic zircon.', pg_temp.chunks('Synthetic zircon.'), array['Astronauts'])$$,
  '22023', 'Unknown department: Astronauts', 'tags must name a department of the tenant');
select throws_ok($$select save_kiara_document_text_with_audit(null, 'Bad vis', null, 'staff_only', 'Synthetic zircon.', pg_temp.chunks('Synthetic zircon.'), null)$$,
  '22023', 'Visibility must be everyone, departments, or managers_and_above', 'an unknown visibility is refused');
select pg_temp.as_user(13);
select throws_ok($$select save_kiara_document_text_with_audit(null, 'B tags A', null, 'everyone', 'Synthetic zircon.', pg_temp.chunks('Synthetic zircon.'), array['Accounts'])$$,
  '22023', 'Unknown department: Accounts', 'another tenant''s department names are unknown');

select pg_temp.as_user(1);
-- The visibility matrix documents. Every one mentions "zircon".
insert into docs(name, id) select 'VE', (save_kiara_document_text_with_audit(null, 'VE everyone sales', null, 'everyone', 'Synthetic zircon everyone.', pg_temp.chunks('Synthetic zircon everyone.'), array['  SALES  ']) ->> 'document_id')::uuid;
insert into docs(name, id) select 'VD', (save_kiara_document_text_with_audit(null, 'VD departments sales', null, 'departments', 'Synthetic zircon sales only.', pg_temp.chunks('Synthetic zircon sales only.'), array['sales']) ->> 'document_id')::uuid;
insert into docs(name, id) select 'VA', (save_kiara_document_text_with_audit(null, 'VA departments accounts', null, 'departments', 'Synthetic zircon accounts only.', pg_temp.chunks('Synthetic zircon accounts only.'), array['accounts']) ->> 'document_id')::uuid;
insert into docs(name, id) select 'VM', (save_kiara_document_text_with_audit(null, 'VM managers', null, 'managers_and_above', 'Synthetic zircon managers.', pg_temp.chunks('Synthetic zircon managers.'), null) ->> 'document_id')::uuid;
insert into docs(name, id) select 'VU', (save_kiara_document_text_with_audit(null, 'VU untagged', null, 'everyone', 'Synthetic zircon untagged.', pg_temp.chunks('Synthetic zircon untagged.'), null) ->> 'document_id')::uuid;
reset role;
update docs set chunk_id = (select c.id from kiara_document_chunks c where c.document_id = docs.id limit 1);
select is((select department_tags from kiara_documents where id = (select id from docs where name = 'VE')), array['Sales'],
  'a tag is stored once, with the tenant''s spelling, whatever case and spacing was typed');
select is((select department_keys from kiara_documents where id = (select id from docs where name = 'VD')), array['sales'], 'the generated key matches Sales in every branch');
select is((select count(*)::integer from audit_logs where module = 'assistant' and action = 'assistant_kb_article_created'
  and record_id in (select id from docs) and new_value ? 'department_tags' and new_value ? 'visibility'), 5, 'creation is audited with visibility and tags');

-- ---------------------------------------------------------------------------
-- Visibility matrix: search and citation excerpts give the same answer
-- ---------------------------------------------------------------------------
set local role authenticated;
create temp table matrix(n integer, who text, expected text[]);
insert into matrix values
  (4, 'staff in Sales (branch A1)', array['VD departments sales', 'VE everyone sales', 'VU untagged']),
  (5, 'staff in Sales (branch A2, other spelling)', array['VD departments sales', 'VE everyone sales', 'VU untagged']),
  (6, 'staff outside Sales (Drivers)', array['VE everyone sales', 'VU untagged']),
  (8, 'staff in Accounts (tenant-wide department)', array['VA departments accounts', 'VE everyone sales', 'VU untagged']),
  (3, 'manager outside the tagged departments', array['VE everyone sales', 'VM managers', 'VU untagged']),
  (10, 'staff with manager dashboard authority', array['VE everyone sales', 'VM managers', 'VU untagged']),
  (7, 'HR (not a manager)', array['VE everyone sales', 'VU untagged']),
  (9, 'staff holding assistant.manage_knowledge', array['VA departments accounts', 'VD departments sales', 'VE everyone sales', 'VU untagged']),
  (2, 'admin', array['VA departments accounts', 'VD departments sales', 'VE everyone sales', 'VM managers', 'VU untagged']),
  (11, 'staff with admin dashboard authority', array['VA departments accounts', 'VD departments sales', 'VE everyone sales', 'VM managers', 'VU untagged']),
  (1, 'super admin', array['VA departments accounts', 'VD departments sales', 'VE everyone sales', 'VM managers', 'VU untagged']),
  (12, 'other tenant staff in a department also named Sales', '{}'),
  (13, 'other tenant super admin', '{}');
grant select on matrix to authenticated;

select pg_temp.as_user(4); select is(pg_temp.found('zircon'), (select expected from matrix where n = 4), 'search: ' || (select who from matrix where n = 4));
select pg_temp.as_user(5); select is(pg_temp.found('zircon'), (select expected from matrix where n = 5), 'search: ' || (select who from matrix where n = 5));
select pg_temp.as_user(6); select is(pg_temp.found('zircon'), (select expected from matrix where n = 6), 'search: ' || (select who from matrix where n = 6));
select pg_temp.as_user(8); select is(pg_temp.found('zircon'), (select expected from matrix where n = 8), 'search: ' || (select who from matrix where n = 8));
select pg_temp.as_user(3); select is(pg_temp.found('zircon'), (select expected from matrix where n = 3), 'search: ' || (select who from matrix where n = 3));
select pg_temp.as_user(10); select is(pg_temp.found('zircon'), (select expected from matrix where n = 10), 'search: ' || (select who from matrix where n = 10));
select pg_temp.as_user(7); select is(pg_temp.found('zircon'), (select expected from matrix where n = 7), 'search: ' || (select who from matrix where n = 7));
select pg_temp.as_user(9); select is(pg_temp.found('zircon'), (select expected from matrix where n = 9), 'search: ' || (select who from matrix where n = 9));
select pg_temp.as_user(2); select is(pg_temp.found('zircon'), (select expected from matrix where n = 2), 'search: ' || (select who from matrix where n = 2));
select pg_temp.as_user(11); select is(pg_temp.found('zircon'), (select expected from matrix where n = 11), 'search: ' || (select who from matrix where n = 11));
select pg_temp.as_user(1); select is(pg_temp.found('zircon'), (select expected from matrix where n = 1), 'search: ' || (select who from matrix where n = 1));
select pg_temp.as_user(12); select is(pg_temp.found('zircon'), (select expected from matrix where n = 12), 'search: ' || (select who from matrix where n = 12));
select pg_temp.as_user(13); select is(pg_temp.found('zircon'), (select expected from matrix where n = 13), 'search: ' || (select who from matrix where n = 13));

-- Excerpts: the same people, by document code (VA, VD, VE, VM, VU).
select pg_temp.as_user(4); select is(pg_temp.excerpts(), array['VD', 'VE', 'VU'], 'excerpt: staff in Sales');
select pg_temp.as_user(5); select is(pg_temp.excerpts(), array['VD', 'VE', 'VU'], 'excerpt: staff in Sales in the other branch');
select pg_temp.as_user(6); select is(pg_temp.excerpts(), array['VE', 'VU'], 'excerpt: staff outside Sales cannot open a Sales-only citation');
select pg_temp.as_user(8); select is(pg_temp.excerpts(), array['VA', 'VE', 'VU'], 'excerpt: Accounts staff');
select pg_temp.as_user(3); select is(pg_temp.excerpts(), array['VE', 'VM', 'VU'], 'excerpt: manager');
select pg_temp.as_user(10); select is(pg_temp.excerpts(), array['VE', 'VM', 'VU'], 'excerpt: manager dashboard authority');
select pg_temp.as_user(7); select is(pg_temp.excerpts(), array['VE', 'VU'], 'excerpt: HR');
select pg_temp.as_user(9); select is(pg_temp.excerpts(), array['VA', 'VD', 'VE', 'VU'], 'excerpt: knowledge manager');
select pg_temp.as_user(2); select is(pg_temp.excerpts(), array['VA', 'VD', 'VE', 'VM', 'VU'], 'excerpt: admin');
select pg_temp.as_user(11); select is(pg_temp.excerpts(), array['VA', 'VD', 'VE', 'VM', 'VU'], 'excerpt: admin dashboard authority');
select pg_temp.as_user(1); select is(pg_temp.excerpts(), array['VA', 'VD', 'VE', 'VM', 'VU'], 'excerpt: super admin');
select pg_temp.as_user(12); select is(pg_temp.excerpts(), '{}'::text[], 'excerpt: other tenant staff');
select pg_temp.as_user(13); select is(pg_temp.excerpts(), '{}'::text[], 'excerpt: other tenant super admin');

-- A branch added later: its "Sales" department is covered by the same tag.
reset role;
insert into branches(id, tenant_id, name, code) values ('20920000-0000-4000-8000-000000000004', '20910000-0000-4000-8000-000000000001', 'DT branch A3', 'DT-A3');
insert into departments(id, tenant_id, branch_id, name, code) values
  ('20930000-0000-4000-8000-000000000006', '20910000-0000-4000-8000-000000000001', '20920000-0000-4000-8000-000000000004', 'SALES', 'DT-SALES-A3');
update user_profiles set branch_id = '20920000-0000-4000-8000-000000000004', department_id = '20930000-0000-4000-8000-000000000006'
where id = '20940000-0000-4000-8000-000000000014';
set local role authenticated;
select pg_temp.as_user(14);
select is(pg_temp.found('zircon'), array['VD departments sales', 'VE everyone sales', 'VU untagged'], 'a Sales department in a branch added later sees Sales-only documents');

-- ---------------------------------------------------------------------------
-- Ranking: own department wins only among comparably relevant hits
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
-- Two equally relevant documents, one for Sales and one for Drivers.
insert into docs(name, id) select 'R-sales', (save_kiara_document_text_with_audit(null, 'Opal care for counters', null, 'everyone', 'Opal cleaning steps for the opal tray.', pg_temp.chunks('Opal cleaning steps for the opal tray.'), array['Sales']) ->> 'document_id')::uuid;
insert into docs(name, id) select 'R-drivers', (save_kiara_document_text_with_audit(null, 'Opal care for vans', null, 'everyone', 'Opal cleaning steps for the opal tray.', pg_temp.chunks('Opal cleaning steps for the opal tray.'), array['Drivers']) ->> 'document_id')::uuid;
-- A clearly relevant untagged document and a Drivers document that barely mentions the topic.
insert into docs(name, id) select 'R-relevant', (save_kiara_document_text_with_audit(null, 'Topaz handling', null, 'everyone', 'Topaz handling: store each topaz in a soft pouch. Topaz scratches easily, so check every topaz before display.', pg_temp.chunks('Topaz handling: store each topaz in a soft pouch. Topaz scratches easily, so check every topaz before display.'), null) ->> 'document_id')::uuid;
insert into docs(name, id) select 'R-weak', (save_kiara_document_text_with_audit(null, 'Van loading checklist', null, 'everyone',
  'Load the van from the back. Keep the route sheet in the cabin. Lock the doors at every stop. Check the tyres each morning. Fuel up before the first delivery. A topaz box goes on the top shelf. Return the keys to the store manager.',
  pg_temp.chunks('Load the van from the back. Keep the route sheet in the cabin. Lock the doors at every stop. Check the tyres each morning. Fuel up before the first delivery. A topaz box goes on the top shelf. Return the keys to the store manager.'), array['Drivers']) ->> 'document_id')::uuid;

select pg_temp.as_user(4);
select is((pg_temp.ranked('opal cleaning'))[1], 'Opal care for counters', 'a Sales asker gets the Sales document first between equally relevant hits');
select ok((select (r ->> 'own_department')::boolean from jsonb_array_elements(search_kiara_knowledge('opal cleaning', null, 8) -> 'results') r where r ->> 'title' = 'Opal care for counters'),
  'results mark the asker''s own-department documents');
select pg_temp.as_user(6);
select is((pg_temp.ranked('opal cleaning'))[1], 'Opal care for vans', 'a driver gets the Drivers document first between equally relevant hits');
select is(pg_temp.ranked('topaz handling'), array['Topaz handling', 'Van loading checklist'],
  'a barely matching own-department document is never lifted above a clearly relevant one');
select ok(not (select bool_or((r ->> 'own_department')::boolean) from jsonb_array_elements(search_kiara_knowledge('zircon', null, 8) -> 'results') r
  where r ->> 'title' = 'VU untagged'), 'untagged documents are never boosted');
select ok((select bool_and(jsonb_typeof(r -> 'departments') = 'array') from jsonb_array_elements(search_kiara_knowledge('zircon', null, 8) -> 'results') r),
  'each result lists its department tags');

-- ---------------------------------------------------------------------------
-- Details, bulk edit, list filter, filter data
-- ---------------------------------------------------------------------------
select pg_temp.as_user(4);
select throws_ok(format('select bulk_update_kiara_documents_access_with_audit(array[%L]::uuid[], %L, null, %L)', (select id from docs where name = 'VU'), 'departments', 'replace'),
  '42501', 'Knowledge base management requires permission', 'staff cannot bulk edit');
select throws_ok(format('select update_kiara_document_details_with_audit(%L, %L, null, %L, null)', (select id from docs where name = 'VU'), 'x', 'everyone'),
  '42501', 'Knowledge base management requires permission', 'staff cannot edit details');

select pg_temp.as_user(1);
select lives_ok(format('select update_kiara_document_details_with_audit(%L, %L, null, %L, null)', (select id from docs where name = 'VE'), 'VE everyone sales', 'everyone'),
  'details can be saved without touching tags');
select is((select department_tags from kiara_documents where id = (select id from docs where name = 'VE')), array['Sales'], 'null tags keep the current tags');

-- A department-only result without tags fails the whole selection (nothing changes).
select throws_ok(format('select bulk_update_kiara_documents_access_with_audit(array[%L, %L]::uuid[], %L, null, %L)',
    (select id from docs where name = 'VU'), (select id from docs where name = 'VE'), 'departments', 'replace'),
  '22023', null, 'bulk edit refuses to leave a department-only document without departments');
select is((select visibility from kiara_documents where id = (select id from docs where name = 'VE')), 'everyone', 'a refused bulk edit changes nothing');
select is(bulk_update_kiara_documents_access_with_audit(array[(select id from docs where name = 'VU'), (select id from docs where name = 'VE')], null, array['Drivers'], 'add'),
  '{"selected": 2, "changed": 2}'::jsonb, 'bulk add tags');
select is((select department_tags from kiara_documents where id = (select id from docs where name = 'VE')), array['Drivers', 'Sales'], 'add keeps existing tags');
select throws_ok(format('select bulk_update_kiara_documents_access_with_audit(array[%L]::uuid[], %L, array[%L], %L)',
    (select id from docs where name = 'VU'), 'departments', 'Drivers', 'remove'),
  '22023', null, 'removing the last department of a department-only document is refused');
select is(bulk_update_kiara_documents_access_with_audit(array[(select id from docs where name = 'VU'), (select id from docs where name = 'VE')], 'departments', array['Sales'], 'replace'),
  '{"selected": 2, "changed": 2}'::jsonb, 'bulk set visibility and replace tags in one action');
select is((select array_agg(visibility || ':' || array_to_string(department_tags, ',') order by title) from kiara_documents
  where id in (select id from docs where name in ('VU', 'VE'))), array['departments:Sales', 'departments:Sales'], 'both documents changed');
select is((select count(*)::integer from audit_logs where action = 'assistant_kb_bulk_access_updated' and module = 'assistant'), 2, 'one audit row per bulk action');
select is((select jsonb_array_length(new_value -> 'changes') from audit_logs where action = 'assistant_kb_bulk_access_updated' order by created_at desc, id desc limit 1),
  2, 'the bulk audit row keeps every document''s previous values');
select is(bulk_update_kiara_documents_access_with_audit(array[(select id from docs where name = 'VU')], 'departments', array['Sales'], 'replace'),
  '{"selected": 1, "changed": 0}'::jsonb, 'an unchanged document is not rewritten');
select throws_ok(format('select bulk_update_kiara_documents_access_with_audit(array[%L]::uuid[], %L, null, %L)', gen_random_uuid(), 'everyone', 'replace'),
  '42501', 'A selected document was not found or was deleted', 'unknown documents are refused');
select pg_temp.as_user(13);
select throws_ok(format('select bulk_update_kiara_documents_access_with_audit(array[%L]::uuid[], %L, null, %L)', (select id from docs where name = 'VU'), 'everyone', 'replace'),
  '42501', 'A selected document was not found or was deleted', 'another tenant''s Super Admin cannot bulk edit');

select pg_temp.as_user(1);
select is((select count(*)::integer from jsonb_array_elements(list_kiara_documents(null, null, '  SALES ')) d where d ->> 'title' like 'V%'), 3,
  'the department filter matches by name, any case');
select ok((select bool_and(d -> 'department_tags' @> '["Sales"]') from jsonb_array_elements(list_kiara_documents(null, null, 'sales')) d), 'filtered documents all carry the tag');
select is((select d ->> 'branches' from jsonb_array_elements(get_kiara_knowledge_filters() -> 'departments') d where d ->> 'key' = 'sales'), '3',
  'the picker lists Sales once, covering its three branches');
select ok((get_kiara_knowledge_filters() -> 'status_counts') ? 'active', 'filter data has status counts');

select * from finish();
rollback;
