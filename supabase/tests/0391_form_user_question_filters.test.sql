-- Filters on a Users question (0391): saved settings are validated, and a
-- submitted person who does not match is refused by the server.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temp table fx(kind text primary key, id uuid, auth_id uuid);
create temp table fx_rec(label text primary key, id uuid);
do $$
declare t uuid; b uuid; b2 uuid; sales uuid; crm uuid; r record; aid uuid; pid uuid; f uuid; desig uuid;
begin
  insert into tenants(name, slug) values ('0391 test', 'user-filter-0391') returning id into t;
  insert into branches(tenant_id, name, code) values (t, '0391 Bandra', 'B0391') returning id into b;
  insert into branches(tenant_id, name, code) values (t, '0391 Andheri', 'A0391') returning id into b2;
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'Sales', 'SALES0391') returning id into sales;
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'CRM', 'CRM0391') returning id into crm;
  insert into dropdown_masters(tenant_id, master_type, label, value, is_active) values (t, 'designation', 'Senior Sales', 'senior_sales_0391', true) returning id into desig;
  insert into fx_rec values ('tenant', t), ('sales', sales), ('crm', crm), ('bandra', b), ('andheri', b2), ('senior', desig);
  for r in select * from (values ('filler','staff', 'sales', 'b'), ('sales_bandra','staff','sales','b'), ('sales_andheri','staff','sales','a'),
      ('crm_bandra','crm','crm','b'), ('manager','manager','sales','b')) v(kind, role, dept, br) loop
    aid := gen_random_uuid();
    insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
    values (aid, 'authenticated', 'authenticated', 'uf-' || r.kind || '@example.in', 'x', now(), now());
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled, designation_id)
    values (t, aid, case when r.br = 'b' then b else b2 end, case when r.dept = 'sales' then sales else crm end,
      'UF ' || r.kind, 'UF-' || upper(r.kind), 'uf-' || r.kind || '@example.in', r.role::user_role, 'active', 'active', true,
      case when r.kind = 'sales_andheri' then desig end)
    returning id into pid;
    insert into fx values (r.kind, pid, aid);
  end loop;
  -- A published form: one question limited to Sales, one to Sales at Bandra or a Senior Sales designation, one unfiltered.
  f := gen_random_uuid();
  insert into form_templates(id, family_id, tenant_id, name, is_active, lifecycle, library_visible, permissions)
  values (f, f, t, 'UF handoff', true, 'draft', true, '{"roles":["super_admin","admin","manager","crm","staff"]}');
  insert into form_fields(form_template_id, field_key, field_name, field_type, sort_order, is_shown, is_editable, is_required, validation) values
    (f, 'salesperson', 'Salesperson', 'user_dropdown', 0, true, true, false,
      jsonb_build_object('userFilter', jsonb_build_object('match', 'all', 'rules', jsonb_build_array(
        jsonb_build_object('attribute', 'department', 'operator', 'equals', 'values', jsonb_build_array(sales::text)),
        jsonb_build_object('attribute', 'role', 'operator', 'not_in', 'values', '["manager","admin"]'::jsonb))))),
    (f, 'either', 'Bandra sales or senior', 'user_dropdown', 1, true, true, false,
      jsonb_build_object('userFilter', jsonb_build_object('match', 'any', 'rules', jsonb_build_array(
        jsonb_build_object('attribute', 'store', 'operator', 'equals', 'values', jsonb_build_array(b::text)),
        jsonb_build_object('attribute', 'designation', 'operator', 'in', 'values', jsonb_build_array(desig::text)))))),
    (f, 'anyone', 'Anyone', 'user_dropdown', 2, true, true, false, '{}');
  update form_templates set lifecycle = 'published', published_at = now() where id = f;
  insert into fx_rec values ('form', f);
end $$;
grant select on fx, fx_rec to authenticated;
create function pg_temp.p(k text) returns uuid language sql stable as $$ select id from fx where kind = k $$;
create function pg_temp.r(k text) returns uuid language sql stable as $$ select id from fx_rec where label = k $$;
create function pg_temp.login(k text) returns void language sql as $$
  select set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', (select auth_id::text from fx where kind = k), true);
$$;
create function pg_temp.submit(answers jsonb) returns text language sql as $$
  select format($q$select submit_form_with_audit(%L, %L::jsonb, null, null)$q$, (select id from fx_rec where label = 'form'), answers);
$$;
grant execute on function pg_temp.p(text), pg_temp.r(text), pg_temp.login(text), pg_temp.submit(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The rule itself
-- ---------------------------------------------------------------------------
select ok(form_user_matches_filter(null, pg_temp.p('crm_bandra')), 'no filter allows everyone');
select ok(form_user_matches_filter(jsonb_build_object('rules', jsonb_build_array(jsonb_build_object('attribute','department','operator','in','values',jsonb_build_array(pg_temp.r('sales')::text)))), pg_temp.p('sales_bandra')),
  'Department is Sales matches a Sales employee');
select ok(not form_user_matches_filter(jsonb_build_object('rules', jsonb_build_array(jsonb_build_object('attribute','department','operator','in','values',jsonb_build_array(pg_temp.r('sales')::text)))), pg_temp.p('crm_bandra')),
  'and not a CRM employee');
select ok(not form_user_matches_filter(jsonb_build_object('match','all','rules', jsonb_build_array(
    jsonb_build_object('attribute','role','operator','equals','values','["staff"]'::jsonb),
    jsonb_build_object('attribute','designation','operator','equals','values',jsonb_build_array(pg_temp.r('senior')::text)))), pg_temp.p('sales_bandra')),
  'an equals rule on an empty value fails an all-rules filter');
select ok(form_user_matches_filter('{"rules":[{"attribute":"name","operator":"contains","values":["andheri"]}]}', pg_temp.p('sales_andheri')), 'Name contains is case-insensitive');
select ok(form_user_matches_filter('{"rules":[{"attribute":"designation","operator":"is_empty","values":[]}]}', pg_temp.p('sales_bandra')), 'Designation is empty');
select ok(not form_user_matches_filter('{"rules":[{"attribute":"designation","operator":"is_empty","values":[]}]}', pg_temp.p('sales_andheri')), 'Designation is not empty when set');

-- ---------------------------------------------------------------------------
-- Saving: validated, Users questions only, round-trips through the normaliser
-- ---------------------------------------------------------------------------
select is(normalize_form_fields(jsonb_build_array(jsonb_build_object('key','pick','label','Pick','type','user_dropdown',
    'validation', jsonb_build_object('width','half','userFilter', jsonb_build_object('rules', jsonb_build_array(
      jsonb_build_object('attribute','role','operator','equals','values','["staff"]'::jsonb))))))) -> 0 -> 'validation',
  '{"width":"half","userFilter":{"match":"all","rules":[{"attribute":"role","operator":"equals","values":["staff"]}]}}'::jsonb,
  'the filter is kept with other settings and normalised');
select throws_ok($$select normalize_form_fields('[{"key":"t","label":"T","type":"text","validation":{"userFilter":{"rules":[{"attribute":"role","operator":"equals","values":["staff"]}]}}}]')$$,
  '22023', null, 'only a Users question can filter people');
select throws_ok($$select normalize_form_fields('[{"key":"p","label":"P","type":"user_dropdown","validation":{"userFilter":{"rules":[{"attribute":"salary","operator":"equals","values":["1"]}]}}}]')$$,
  '22023', null, 'unknown fields are refused (no free column names)');
select throws_ok($$select normalize_form_fields('[{"key":"p","label":"P","type":"user_dropdown","validation":{"userFilter":{"rules":[{"attribute":"department","operator":"equals","values":["1 or 1=1"]}]}}}]')$$,
  '22023', null, 'identifier values must be identifiers');
select throws_ok($$select normalize_form_fields('[{"key":"p","label":"P","type":"user_dropdown","validation":{"userFilter":{"rules":[{"attribute":"department","operator":"contains","values":["x"]}]}}}]')$$,
  '22023', null, 'contains is for names only');
select throws_ok($$select normalize_form_fields('[{"key":"p","label":"P","type":"user_dropdown","validation":{"userFilter":{"rules":[{"attribute":"role","operator":"in","values":[]}]}}}]')$$,
  '22023', null, 'a rule needs a value');
select ok(not has_function_privilege('authenticated', 'form_user_matches_filter(jsonb,uuid)', 'EXECUTE'), 'browsers cannot probe employee details through the matcher');

-- ---------------------------------------------------------------------------
-- Submitting: the server refuses a person outside the question's filter
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('filler');
select lives_ok(pg_temp.submit(jsonb_build_object('salesperson', pg_temp.p('sales_bandra'))), 'a Sales employee is accepted');
select throws_ok(pg_temp.submit(jsonb_build_object('salesperson', pg_temp.p('crm_bandra'))), '23514', null, 'a CRM employee sent in a crafted request is refused');
select throws_ok(pg_temp.submit(jsonb_build_object('salesperson', pg_temp.p('manager'))), '23514', null, 'all rules must match (manager role excluded)');
select lives_ok(pg_temp.submit(jsonb_build_object('either', pg_temp.p('sales_andheri'))), 'any rule: the Senior Sales designation matches');
select lives_ok(pg_temp.submit(jsonb_build_object('either', pg_temp.p('crm_bandra'))), 'any rule: the Bandra store matches');
select lives_ok(pg_temp.submit(jsonb_build_object('anyone', pg_temp.p('crm_bandra'))), 'an unfiltered Users question is unchanged');
select ok((select count(*) from v_task_users where designation_id = pg_temp.r('senior')) = 1, 'the people list carries designation');
reset role;

select * from finish();
rollback;
