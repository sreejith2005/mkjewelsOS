-- 0195: CRM walk-in -> JewelOS task. Service-role only; registered creates one task for the
-- resolved salesperson (else a manager, flagged; else none); completed closes it; idempotent
-- and ordered; assignment alert and audit; no client phone in the task. Synthetic fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(not has_function_privilege('authenticated', 'public.crm_sync_apply_walkin(text,jsonb)', 'execute'), 'staff cannot apply walk-in events');
select ok(not has_function_privilege('anon', 'public.crm_sync_apply_walkin(text,jsonb)', 'execute'), 'anon cannot apply walk-in events');
select ok(has_function_privilege('service_role', 'public.crm_sync_apply_walkin(text,jsonb)', 'execute'), 'the receiver can apply walk-in events');
select ok(not has_table_privilege('service_role', 'crm_sync.inbox', 'select'), 'the inbox is internal');

create temporary table walkin_fixture(name text primary key, id uuid) on commit drop;
grant select on walkin_fixture to service_role, authenticated;
do $$
declare v_tenant uuid; v_branch uuid; v_department uuid; v_auth uuid; v_id uuid; v_person record;
begin
  insert into tenants(name, slug) values ('Walk-in task tenant', 'crm-walkin-task-tenant') returning id into v_tenant;
  insert into branches(tenant_id, name, code) values (v_tenant, 'Walk-in Main', 'WKM') returning id into v_branch;
  insert into departments(tenant_id, branch_id, name, code) values (v_tenant, v_branch, 'Sales', 'WKD') returning id into v_department;
  for v_person in select * from (values ('sales', 'crm', 'active'), ('manager', 'manager', 'active'), ('gone', 'crm', 'inactive')) as p(name, role, status) loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'walkin-' || v_person.name || '@test.local', 'x', now(), now())
    returning id into v_auth;
    insert into user_profiles(tenant_id, auth_user_id, branch_id, department_id, employee_name, employee_code, email,
      user_role, working_status, account_status, is_login_enabled)
    values (v_tenant, v_auth, v_branch, v_department, 'Walk-in ' || v_person.name, 'WKN-' || v_person.name, 'walkin-' || v_person.name || '@test.local',
      v_person.role::user_role, 'active', v_person.status::user_account_status, true) returning id into v_id;
    insert into walkin_fixture values (v_person.name, v_id);
  end loop;
  insert into walkin_fixture values ('branch', v_branch);
end $$;

create function pg_temp.snap(p_queue text, p_assignee text, p_completed boolean, p_at text, p_managers text[] default '{}') returns jsonb language sql as $$
  select jsonb_build_object('queue_id', '20261008-0000-4000-8000-0000000000' || p_queue, 'present', true, 'token', '1005-ABCDE',
    'status', case when p_completed then 'complete' else 'pending' end, 'completed', p_completed,
    'client_code', 'MKC-901', 'client_name', 'Synthetic Walk-in Client',
    'jewelos_branch_id', (select id from walkin_fixture where name = 'branch'),
    'assignee_jewelos_user_id', (select id from walkin_fixture where name = p_assignee),
    'manager_jewelos_user_ids', coalesce((select jsonb_agg(f.id) from walkin_fixture f where f.name = any (p_managers)), '[]'::jsonb),
    'snapshot_at', p_at);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create function pg_temp.task_for(p_queue text) returns task_instances language sql security definer as $$
  select * from task_instances where source = 'crm_walkin' and source_ref_id = ('20261008-0000-4000-8000-0000000000' || p_queue)::uuid;
$$;
grant execute on function pg_temp.snap(text, text, boolean, text, text[]), pg_temp.as_service(), pg_temp.task_for(text) to service_role;

-- ---------------------------------------------------------------------------
-- Registered -> task for the salesperson
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
select is(public.crm_sync_apply_walkin('crm.walkin.1.1', pg_temp.snap('01', 'sales', false, '2026-10-05T10:00:00Z')) ->> 'outcome', 'created',
  'a registered walk-in creates a task');
select is(public.crm_sync_apply_walkin('crm.walkin.1.1', pg_temp.snap('01', 'sales', false, '2026-10-05T10:00:00Z')) ->> 'duplicate', 'true',
  'a redelivered event is applied once');
select is(public.crm_sync_apply_walkin('crm.walkin.1.2', pg_temp.snap('01', 'sales', false, '2026-10-05T10:01:00Z')) ->> 'outcome', 'already_created',
  'a later snapshot of the same entry does not create a second task');
reset role;
select is((select count(*)::int from task_instances where source = 'crm_walkin' and source_ref_id = '20261008-0000-4000-8000-000000000001'), 1, 'one task per queue entry');
select is((pg_temp.task_for('01')).title, 'Complete walk-in form - Synthetic Walk-in Client (MKC-901)', 'the task title names the client and MKC');
select is((pg_temp.task_for('01')).status::text, 'pending', 'the task is open');
select is((select user_profile_id from task_assignees where task_instance_id = (pg_temp.task_for('01')).id and is_active),
  (select id from walkin_fixture where name = 'sales'), 'assigned to the resolved salesperson');
select is((pg_temp.task_for('01')).branch_id, (select id from walkin_fixture where name = 'branch'), 'in the mapped JewelOS branch');
select ok(exists (select 1 from notifications n where n.user_profile_id = (select id from walkin_fixture where name = 'sales')
  and n.source_record_id = (pg_temp.task_for('01')).id), 'the salesperson gets the usual assignment alert');
select is((select count(*)::int from audit_logs where action = 'crm_walkin_task_created' and record_id = (pg_temp.task_for('01')).id), 1, 'creation is audited');
select ok((pg_temp.task_for('01')).description !~ '[0-9]{10}', 'the task carries no phone number');

-- ---------------------------------------------------------------------------
-- Completed -> task closed; ordering
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
select is(public.crm_sync_apply_walkin('crm.walkin.1.3', pg_temp.snap('01', 'sales', true, '2026-10-05T10:30:00Z')) ->> 'outcome', 'completed',
  'submitting the walk-in form closes the task');
select is(public.crm_sync_apply_walkin('crm.walkin.1.4', pg_temp.snap('01', 'sales', false, '2026-10-05T10:20:00Z')) ->> 'outcome', 'stale',
  'an older snapshot arriving late changes nothing');
select is(public.crm_sync_apply_walkin('crm.walkin.1.5', pg_temp.snap('01', 'sales', true, '2026-10-05T10:40:00Z')) ->> 'outcome', 'already_closed',
  'closing twice is harmless');
reset role;
select is((pg_temp.task_for('01')).status::text, 'completed', 'the task is completed');
select ok((select completed_at is not null from task_assignees where task_instance_id = (pg_temp.task_for('01')).id), 'the assignee is marked done');
select is((select count(*)::int from audit_logs where action = 'crm_walkin_task_completed' and record_id = (pg_temp.task_for('01')).id), 1, 'closing is audited once');

-- ---------------------------------------------------------------------------
-- Fallbacks
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
select is(public.crm_sync_apply_walkin('crm.walkin.2.1', pg_temp.snap('02', 'gone', false, '2026-10-05T11:00:00Z', array['manager'])) ->> 'outcome', 'created_for_manager',
  'an unresolvable salesperson sends the task to the branch manager');
select is(public.crm_sync_apply_walkin('crm.walkin.3.1', pg_temp.snap('03', 'nobody', false, '2026-10-05T11:00:00Z')) ->> 'outcome', 'unassigned',
  'with nobody to assign, no task is created and the outcome is recorded');
select is(public.crm_sync_apply_walkin('crm.walkin.4.1', pg_temp.snap('04', 'sales', true, '2026-10-05T11:00:00Z')) ->> 'outcome', 'no_task',
  'a completion without a task (an older queue entry) is a no-op');
select throws_ok($$select public.crm_sync_apply_walkin('bad id', '{}'::jsonb)$$, '22023', null, 'a malformed event is refused');
reset role;
select is((select user_profile_id from task_assignees where task_instance_id = (pg_temp.task_for('02')).id),
  (select id from walkin_fixture where name = 'manager'), 'the manager is the doer');
select ok((pg_temp.task_for('02')).description like '%assigned to the branch manager%', 'the task says why');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.crm_sync_apply_walkin('crm.walkin.9.1', '{}'::jsonb)$$, '42501', null, 'a signed-in user cannot call it');
reset role;

select * from finish();
rollback;
