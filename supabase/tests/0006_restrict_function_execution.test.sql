begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

-- The linked project has this postgres-owned platform helper, while a fresh
-- local Supabase stack does not. Create it transactionally to reproduce the
-- linked 31-function/28-SECURITY-DEFINER matrix and exercise future defaults.
create function rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  null;
end;
$$;

-- Future postgres-owned public functions receive no API-role execution.
select ok(not exists (
  select 1
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  where p.oid = 'rls_auto_enable()'::regprocedure
    and acl.grantee = 0
    and acl.privilege_type = 'EXECUTE'
), 'future postgres-owned public functions do not grant EXECUTE to PUBLIC');
select ok(not has_function_privilege('anon', 'rls_auto_enable()', 'EXECUTE'), 'future public functions do not default-grant anon');
select ok(not has_function_privilege('authenticated', 'rls_auto_enable()', 'EXECUTE'), 'future public functions do not default-grant authenticated');
select ok(not has_function_privilege('service_role', 'rls_auto_enable()', 'EXECUTE'), 'future public functions do not default-grant service_role');

-- Current application-function matrix, including the linked-only helper above.
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
), 31, 'exactly 31 postgres-owned public application functions exist');
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres' and p.prosecdef
), 28, 'exactly 28 public application functions are SECURITY DEFINER');
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
    and has_function_privilege('anon', p.oid, 'EXECUTE')
), 0, 'anon can execute exactly zero public application functions');
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
), 25, 'authenticated can execute exactly 25 public application functions');
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
), 2, 'service_role can execute exactly two public application functions');
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
    and has_function_privilege('postgres', p.oid, 'EXECUTE')
), 31, 'postgres retains owner execution on every public application function');

-- Exact authenticated allowlist: 25 expected functions and no extras.
select ok(has_function_privilege('authenticated', 'current_profile()', 'EXECUTE'), 'authenticated executes current_profile');
select ok(has_function_privilege('authenticated', 'current_role_level()', 'EXECUTE'), 'authenticated executes current_role_level');
select ok(has_function_privilege('authenticated', 'current_tenant_id()', 'EXECUTE'), 'authenticated executes current_tenant_id');
select ok(has_function_privilege('authenticated', 'current_branch_id()', 'EXECUTE'), 'authenticated executes current_branch_id');
select ok(has_function_privilege('authenticated', 'is_super_admin()', 'EXECUTE'), 'authenticated executes is_super_admin');
select ok(has_function_privilege('authenticated', 'current_profile_is_active()', 'EXECUTE'), 'authenticated executes current_profile_is_active');
select ok(has_function_privilege('authenticated', 'is_task_participant(uuid)', 'EXECUTE'), 'authenticated executes is_task_participant');
select ok(has_function_privilege('authenticated', 'is_task_watcher(uuid)', 'EXECUTE'), 'authenticated executes is_task_watcher');
select ok(has_function_privilege('authenticated', 'can_read_task(uuid)', 'EXECUTE'), 'authenticated executes can_read_task');
select ok(has_function_privilege('authenticated', 'is_fms_instance_participant(uuid)', 'EXECUTE'), 'authenticated executes is_fms_instance_participant');
select ok(has_function_privilege('authenticated', 'can_write_task_attachment_object(text)', 'EXECUTE'), 'authenticated executes can_write_task_attachment_object');
select ok(has_function_privilege('authenticated', 'can_read_task_attachment_object(text)', 'EXECUTE'), 'authenticated executes can_read_task_attachment_object');
select ok(has_function_privilege('authenticated', 'can_delete_unrecorded_task_attachment_object(text)', 'EXECUTE'), 'authenticated executes can_delete_unrecorded_task_attachment_object');
select ok(has_function_privilege('authenticated', 'update_user_profile_with_audit(uuid,jsonb)', 'EXECUTE'), 'authenticated executes update_user_profile_with_audit');
select ok(has_function_privilege('authenticated', 'submit_resignation_with_audit(uuid,jsonb,jsonb)', 'EXECUTE'), 'authenticated executes submit_resignation_with_audit');
select ok(has_function_privilege('authenticated', 'review_resignation_with_audit(uuid,text)', 'EXECUTE'), 'authenticated executes review_resignation_with_audit');
select ok(has_function_privilege('authenticated', 'change_dropdown_with_audit(text,uuid,text,text,text,integer,boolean)', 'EXECUTE'), 'authenticated executes change_dropdown_with_audit');
select ok(has_function_privilege('authenticated', 'save_task_template_with_audit(uuid,jsonb)', 'EXECUTE'), 'authenticated executes save_task_template_with_audit');
select ok(has_function_privilege('authenticated', 'create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)', 'EXECUTE'), 'authenticated executes create_delegation_task_with_audit');
select ok(has_function_privilege('authenticated', 'use_task_template_with_audit(uuid,timestamptz)', 'EXECUTE'), 'authenticated executes use_task_template_with_audit');
select ok(has_function_privilege('authenticated', 'update_task_with_audit(uuid,text,uuid,boolean,text)', 'EXECUTE'), 'authenticated executes update_task_with_audit');
select ok(has_function_privilege('authenticated', 'add_task_attachment_with_audit(uuid,text)', 'EXECUTE'), 'authenticated executes add_task_attachment_with_audit');
select ok(has_function_privilege('authenticated', 'delegate_task_with_audit(uuid,uuid,uuid,text)', 'EXECUTE'), 'authenticated executes delegate_task_with_audit');
select ok(has_function_privilege('authenticated', 'revise_task_datetime_with_audit(uuid,timestamptz,text)', 'EXECUTE'), 'authenticated executes revise_task_datetime_with_audit');
select ok(has_function_privilege('authenticated', 'record_availability_with_audit(uuid,date,availability_status,text)', 'EXECUTE'), 'authenticated executes record_availability_with_audit');

select is((
  with expected(identity) as (
    select unnest(array[
      'current_profile()', 'current_role_level()', 'current_tenant_id()', 'current_branch_id()',
      'is_super_admin()', 'current_profile_is_active()', 'is_task_participant(uuid)',
      'is_task_watcher(uuid)', 'can_read_task(uuid)', 'is_fms_instance_participant(uuid)',
      'can_write_task_attachment_object(text)', 'can_read_task_attachment_object(text)',
      'can_delete_unrecorded_task_attachment_object(text)',
      'update_user_profile_with_audit(uuid,jsonb)',
      'submit_resignation_with_audit(uuid,jsonb,jsonb)', 'review_resignation_with_audit(uuid,text)',
      'change_dropdown_with_audit(text,uuid,text,text,text,integer,boolean)',
      'save_task_template_with_audit(uuid,jsonb)',
      'create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)',
      'use_task_template_with_audit(uuid,timestamp with time zone)',
      'update_task_with_audit(uuid,text,uuid,boolean,text)',
      'add_task_attachment_with_audit(uuid,text)', 'delegate_task_with_audit(uuid,uuid,uuid,text)',
      'revise_task_datetime_with_audit(uuid,timestamp with time zone,text)',
      'record_availability_with_audit(uuid,date,availability_status,text)'
    ]::text[])
  )
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and p.oid::regprocedure::text not in (select identity from expected)
), 0, 'authenticated has no function outside its exact allowlist');

-- Exact service-role allowlist and preservation of recurrence table reads.
select ok(has_function_privilege('service_role', 'invite_profile_with_audit(uuid,uuid,text,text,uuid,uuid,uuid,text,text,text[],user_role,text,uuid)', 'EXECUTE'), 'service_role executes invite_profile_with_audit');
select ok(has_function_privilege('service_role', 'create_recurring_task_instance(uuid,date,jsonb)', 'EXECUTE'), 'service_role executes create_recurring_task_instance');
select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and r.rolname = 'postgres'
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
    and p.oid::regprocedure::text not in (
      'invite_profile_with_audit(uuid,uuid,text,text,uuid,uuid,uuid,text,text,text[],user_role,text,uuid)',
      'create_recurring_task_instance(uuid,date,jsonb)'
    )
), 0, 'service_role has no function outside its exact allowlist');
select ok(has_table_privilege('service_role', 'task_templates', 'SELECT'), 'service_role retains task_templates SELECT');
select ok(has_table_privilege('service_role', 'user_profiles', 'SELECT'), 'service_role retains user_profiles SELECT');
select ok(has_table_privilege('service_role', 'user_availability', 'SELECT'), 'service_role retains user_availability SELECT');

-- Cross-allowlist and owner-only privilege negatives.
select ok(not has_function_privilege('authenticated', 'invite_profile_with_audit(uuid,uuid,text,text,uuid,uuid,uuid,text,text,text[],user_role,text,uuid)', 'EXECUTE'), 'authenticated cannot execute invite_profile_with_audit');
select ok(not has_function_privilege('authenticated', 'create_recurring_task_instance(uuid,date,jsonb)', 'EXECUTE'), 'authenticated cannot execute create_recurring_task_instance');
select ok(not has_function_privilege('service_role', 'save_task_template_with_audit(uuid,jsonb)', 'EXECUTE'), 'service_role cannot execute authenticated task RPCs');
select ok(not has_function_privilege('anon', 'current_profile()', 'EXECUTE'), 'anon cannot execute current_profile');
select ok(not has_function_privilege('anon', 'save_task_template_with_audit(uuid,jsonb)', 'EXECUTE'), 'anon cannot execute authenticated task RPCs');
select ok(not has_function_privilege('anon', 'create_recurring_task_instance(uuid,date,jsonb)', 'EXECUTE'), 'anon cannot execute recurrence RPC');

select ok(not has_function_privilege('anon', 'rls_auto_enable()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'rls_auto_enable()', 'EXECUTE')
  and not has_function_privilege('service_role', 'rls_auto_enable()', 'EXECUTE'), 'rls_auto_enable remains owner-only');
select ok(not has_function_privilege('anon', 'normalize_task_checklist(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'normalize_task_checklist(jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'normalize_task_checklist(jsonb)', 'EXECUTE'), 'normalize_task_checklist remains owner-only');
select ok(not has_function_privilege('anon', 'is_supported_task_rrule(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'is_supported_task_rrule(text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'is_supported_task_rrule(text)', 'EXECUTE'), 'is_supported_task_rrule remains owner-only');
select ok(not has_function_privilege('anon', 'is_user_available_for_task(uuid,date)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'is_user_available_for_task(uuid,date)', 'EXECUTE')
  and not has_function_privilege('service_role', 'is_user_available_for_task(uuid,date)', 'EXECUTE'), 'is_user_available_for_task remains owner-only');

-- Permission-denied execution proves Postgres enforces the negative matrix.
set local role anon;
select throws_ok(
  $$select create_recurring_task_instance(null::uuid, current_date, '[]'::jsonb)$$,
  '42501', null, 'anon execution of recurrence RPC is denied'
);
select throws_ok(
  $$select save_task_template_with_audit(null::uuid, '{}'::jsonb)$$,
  '42501', null, 'anon execution of authenticated task RPC is denied'
);
select throws_ok(
  $$select current_profile()$$,
  '42501', null, 'anon execution of policy helpers is denied'
);
reset role;

set local role authenticated;
select throws_ok(
  $$select create_recurring_task_instance(null::uuid, current_date, '[]'::jsonb)$$,
  '42501', null, 'authenticated execution of recurrence RPC is denied'
);
select throws_ok(
  $$select invite_profile_with_audit(null::uuid, null::uuid, '', '', null::uuid, null::uuid, null::uuid, '', '', '{}'::text[], null::user_role, '', null::uuid)$$,
  '42501', null, 'authenticated execution of invitation RPC is denied'
);
reset role;

set local role service_role;
select throws_ok(
  $$select save_task_template_with_audit(null::uuid, '{}'::jsonb)$$,
  '42501', null, 'service_role execution of authenticated task RPC is denied'
);
reset role;

select * from finish();
rollback;
