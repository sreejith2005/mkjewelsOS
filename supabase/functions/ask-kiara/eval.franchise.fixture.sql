-- Ask Kiara franchise-isolation eval fixture. LOCAL STACKS ONLY: synthetic data for
-- eval.local.ts (KIARA_EVAL=1, KIARA_EVAL_ONLY=fr-). Apply AFTER integration.fixture.sql
-- and eval.fixture.sql, through `docker exec -i <db container> psql -U postgres`; never run
-- it against a hosted project. Every name below is invented.
--
-- It turns franchise isolation ON for the "Kiara integration" tenant, so run the other
-- eval cases first (or on a fresh reset):
--   - franchise "KIT Mumbai": every existing Kiara branch (including "Kiara Bandra",
--     where Meera Manager, Sunil Sales, Dev Driver and KIT Owner work);
--   - franchise "KIT Ahmedabad": a new branch "Kiara Ahmedabad" with Asha Ahmedabad
--     (staff, kiara-it-14) and Ravi Regional (admin with a Regional Admin grant on
--     Ahmedabad, kiara-it-15), plus one Ahmedabad task;
--   - the coverage registry confirmed and isolation switched on directly (the API switch
--     needs Super Admin and a reason; this is a local fixture).
-- Re-running is a no-op once Asha exists.
do $$
declare
  t uuid := (select id from tenants where name = 'Kiara integration');
  mum uuid; ahd uuid; branch_a uuid := '20790000-0000-4000-8000-0000000000a1';
  sales_a uuid := '20790000-0000-4000-8000-0000000000a2';
  asha uuid := '20750000-0000-4000-8000-000000000014'; ravi uuid := '20750000-0000-4000-8000-000000000015';
  meera uuid := '20750000-0000-4000-8000-000000000009';
begin
  if t is null then raise exception 'Apply integration.fixture.sql and eval.fixture.sql first'; end if;
  if exists (select 1 from user_profiles where id = asha) then return; end if;

  insert into franchise_groups(tenant_id, name, code, city) values (t, 'KIT Mumbai', 'KIT-MUM', 'Mumbai') returning id into mum;
  insert into franchise_groups(tenant_id, name, code, city) values (t, 'KIT Ahmedabad', 'KIT-AHD', 'Ahmedabad') returning id into ahd;
  perform set_config('jewelos.franchise_assignment', 'on', true);
  update branches set franchise_group_id = mum where tenant_id = t and franchise_group_id is null;
  perform set_config('jewelos.franchise_assignment', '', true);
  perform set_config('jewelos.new_branch_franchise_group_id', ahd::text, true);
  insert into branches(id, tenant_id, name, code) values (branch_a, t, 'Kiara Ahmedabad', 'KIT-AHD1');
  perform set_config('jewelos.new_branch_franchise_group_id', '', true);
  insert into departments(id, tenant_id, branch_id, name, code) values (sales_a, t, branch_a, 'Kiara Sales AHD', 'KIT-SAHD');

  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  select '00000000-0000-0000-0000-000000000000', ('20730000-0000-4000-8000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
    'kiara-it-' || n || '@example.invalid', crypt('kiara-local-test-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', ''
  from unnest(array['14', '15']) n;
  insert into auth.identities(id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
  from auth.users u where u.email in ('kiara-it-14@example.invalid', 'kiara-it-15@example.invalid');

  insert into user_profiles(id, auth_user_id, tenant_id, branch_id, department_id, employee_name, email, employee_code, user_role,
    working_status, account_status, is_login_enabled, week_off) values
    (asha, '20730000-0000-4000-8000-000000000014', t, branch_a, sales_a, 'Asha Ahmedabad', 'kiara-it-14@example.invalid', 'KIT-14', 'staff', 'active', 'active', true, '{}'),
    (ravi, '20730000-0000-4000-8000-000000000015', t, branch_a, sales_a, 'Ravi Regional', 'kiara-it-15@example.invalid', 'KIT-15', 'admin', 'active', 'active', true, '{}');
  insert into org_scope_grants(tenant_id, user_profile_id, authority, scope_level, franchise_group_id, reason)
  values (t, ravi, 'regional_admin', 'franchise', ahd, 'Kiara franchise eval');
  insert into kiara_user_limits(tenant_id, user_profile_id, daily_question_limit) values (t, asha, null), (t, ravi, null)
  on conflict do nothing;

  insert into task_instances(id, tenant_id, branch_id, department_id, task_type, title, priority, status, planned_datetime, created_by) values
    ('20780000-0000-4000-8000-000000000041', t, branch_a, sales_a, 'checklist', 'Polish the Ahmedabad display', 'medium', 'pending', now() + interval '2 hours', ravi);
  insert into task_assignees(task_instance_id, user_profile_id) values ('20780000-0000-4000-8000-000000000041', asha);

  update franchise_scope_modules set status = 'enforced', pending_reason = null where status = 'pending';
  insert into tenant_franchise_controls(tenant_id, enforcement_enabled, change_reason) values (t, true, 'Kiara franchise eval')
  on conflict (tenant_id) do update set enforcement_enabled = true;
  perform meera;
end $$;
