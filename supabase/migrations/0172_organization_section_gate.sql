-- Keep the organization RPCs behind the same server-side Users section gate
-- that protects the existing user-management contracts. The implementation
-- functions remain owner-only and keep their audited transaction boundary.
set search_path = public, extensions;

alter function save_branch_with_audit(uuid,jsonb) rename to save_branch_with_audit_impl;
alter function save_department_with_audit(uuid,jsonb) rename to save_department_with_audit_impl;
revoke all on function save_branch_with_audit_impl(uuid,jsonb),save_department_with_audit_impl(uuid,jsonb)
  from public,anon,authenticated,service_role;

create function save_branch_with_audit(p_branch_id uuid,p_payload jsonb)
returns branches language plpgsql security definer set search_path = public as $$
begin
  perform assert_module_enabled('users');
  return save_branch_with_audit_impl(p_branch_id,p_payload);
end $$;

create function save_department_with_audit(p_department_id uuid,p_payload jsonb)
returns departments language plpgsql security definer set search_path = public as $$
begin
  perform assert_module_enabled('users');
  return save_department_with_audit_impl(p_department_id,p_payload);
end $$;

revoke all on function save_branch_with_audit(uuid,jsonb),save_department_with_audit(uuid,jsonb) from public,anon,authenticated;
grant execute on function save_branch_with_audit(uuid,jsonb),save_department_with_audit(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
