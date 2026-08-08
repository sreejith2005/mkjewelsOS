-- Restrict application function execution to explicit API-role allowlists.

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Remove that
-- owner-wide default, then remove Supabase's schema-specific API-role defaults
-- only for functions subsequently created by postgres in public.
alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

-- Reset every existing postgres-owned public function, including invoker
-- utilities and platform helpers that may exist only on the linked project.
do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
    where n.nspname = 'public'
      and r.rolname = 'postgres'
  loop
    execute format(
      'revoke all privileges on function %s from public, anon, authenticated, service_role',
      v_function.identity
    );
  end loop;
end;
$$;

-- Authenticated helper and policy-function allowlist.
grant execute on function current_profile() to authenticated;
grant execute on function current_role_level() to authenticated;
grant execute on function current_tenant_id() to authenticated;
grant execute on function current_branch_id() to authenticated;
grant execute on function is_super_admin() to authenticated;
grant execute on function current_profile_is_active() to authenticated;
grant execute on function is_task_participant(uuid) to authenticated;
grant execute on function is_task_watcher(uuid) to authenticated;
grant execute on function can_read_task(uuid) to authenticated;
grant execute on function is_fms_instance_participant(uuid) to authenticated;
grant execute on function can_write_task_attachment_object(text) to authenticated;
grant execute on function can_read_task_attachment_object(text) to authenticated;
grant execute on function can_delete_unrecorded_task_attachment_object(text) to authenticated;

-- Authenticated Phase 1 audited RPC allowlist.
grant execute on function update_user_profile_with_audit(uuid, jsonb) to authenticated;
grant execute on function submit_resignation_with_audit(uuid, jsonb, jsonb) to authenticated;
grant execute on function review_resignation_with_audit(uuid, text) to authenticated;
grant execute on function change_dropdown_with_audit(text, uuid, text, text, text, integer, boolean) to authenticated;

-- Authenticated Phase 2 audited RPC allowlist.
grant execute on function save_task_template_with_audit(uuid, jsonb) to authenticated;
grant execute on function create_delegation_task_with_audit(jsonb, uuid[], uuid[], jsonb) to authenticated;
grant execute on function use_task_template_with_audit(uuid, timestamptz) to authenticated;
grant execute on function update_task_with_audit(uuid, text, uuid, boolean, text) to authenticated;
grant execute on function add_task_attachment_with_audit(uuid, text) to authenticated;
grant execute on function delegate_task_with_audit(uuid, uuid, uuid, text) to authenticated;
grant execute on function revise_task_datetime_with_audit(uuid, timestamptz, text) to authenticated;
grant execute on function record_availability_with_audit(uuid, date, availability_status, text) to authenticated;

-- Service-only RPC allowlist.
grant execute on function invite_profile_with_audit(
  uuid, uuid, text, text, uuid, uuid, uuid, text, text, text[], user_role, text, uuid
) to service_role;
grant execute on function create_recurring_task_instance(uuid, date, jsonb) to service_role;

notify pgrst, 'reload schema';
