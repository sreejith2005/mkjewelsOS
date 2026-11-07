-- Server-side country rule for "+" phone answers (0392). Legacy answers keep the old rule.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(form_phone_answer_valid('+919876543210'), 'India +91 with 10 digits is valid');
select ok(not form_phone_answer_valid('+9198765432'), 'India +91 with 8 digits is refused');
select ok(not form_phone_answer_valid('+9198765432101'), 'India +91 with 11 digits is refused');
select ok(form_phone_answer_valid('+447911123456'), 'a UK number is valid');
select ok(form_phone_answer_valid('+6591234567'), 'a Singapore number is valid');
select ok(not form_phone_answer_valid('+0123456789'), 'a leading 0 after + is refused');
select ok(not form_phone_answer_valid('+1234567'), 'too short an international number is refused');
select ok(form_phone_answer_valid('9876543210'), 'an answer without + keeps the earlier rule');
select ok(form_phone_answer_valid('98765'), 'the length of legacy answers is still checked by the earlier rule, not here');

create temp table fx(kind text primary key, id uuid, auth_id uuid);
do $$
declare t uuid; b uuid; d uuid; aid uuid := gen_random_uuid(); pid uuid; f uuid := gen_random_uuid();
begin
  insert into tenants(name, slug) values ('0392 test', 'phone-0392') returning id into t;
  insert into branches(tenant_id, name, code) values (t, '0392 store', 'P0392') returning id into b;
  insert into departments(tenant_id, branch_id, name, code) values (t, null, 'Ops', 'OPS0392') returning id into d;
  insert into auth.users(id, aud, role, email, encrypted_password, created_at, updated_at)
  values (aid, 'authenticated', 'authenticated', 'ph-filler@example.in', 'x', now(), now());
  insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email, user_role, working_status, account_status, is_login_enabled)
  values (t, aid, b, d, 'PH filler', 'PH-1', 'ph-filler@example.in', 'staff', 'active', 'active', true) returning id into pid;
  insert into fx values ('filler', pid, aid), ('form', f, null);
  insert into form_templates(id, family_id, tenant_id, name, is_active, lifecycle, library_visible, permissions)
  values (f, f, t, 'PH form', true, 'draft', true, '{"roles":["super_admin","admin","manager","crm","staff"]}');
  insert into form_fields(form_template_id, field_key, field_name, field_type, sort_order, is_shown, is_editable, is_required)
  values (f, 'mobile', 'Mobile', 'phone', 0, true, true, false);
  update form_templates set lifecycle = 'published', published_at = now() where id = f;
end $$;
grant select on fx to authenticated;
create function pg_temp.submit(p_phone text) returns text language sql as $$
  select format($q$select submit_form_with_audit(%L, %L::jsonb, null, null)$q$, (select id from fx where kind = 'form'), jsonb_build_object('mobile', p_phone));
$$;
grant execute on function pg_temp.submit(text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', (select auth_id::text from fx where kind = 'filler'), true);
select lives_ok(pg_temp.submit('+919876543210'), 'a full Indian number is saved');
select throws_ok(pg_temp.submit('+9198765432'), '22023', null, 'a short Indian number sent directly to the server is refused');
select lives_ok(pg_temp.submit('+447911123456'), 'an international number is saved');
select lives_ok(pg_temp.submit('9876543210'), 'a number without + is still accepted as before');
reset role;

select * from finish();
rollback;
