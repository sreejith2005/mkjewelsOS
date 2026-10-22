-- Runtime handoffs may select company peers. Preserve the separate, existing
-- authorization contract for publishing fixed owners, hierarchies and fallbacks.
set search_path=public,extensions;
create function assert_fms_publish_recipient(p_user_id uuid,p_tenant_id uuid,p_explicit boolean default true)
returns void language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();
begin
  perform assert_fms_handoff_recipient(p_user_id,p_tenant_id,p_explicit);
  if p_explicit and ((p_user_id<>a.id and not has_permission('tasks.assign_others'))
    or not task_assignment_user_in_scope(p_user_id) or not task_assignment_recipient_allowed(p_user_id)) then
    raise exception 'Employee is outside your permitted FMS handoff scope' using errcode='42501';
  end if;
end $$;
revoke all on function assert_fms_publish_recipient(uuid,uuid,boolean) from public,anon,authenticated,service_role;
do $$
declare signature text; definition text; amended text;
begin
  foreach signature in array array['assert_fms_assignment_publishable_before_hierarchy(uuid)','assert_fms_assignment_publishable(uuid)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    amended:=replace(definition,'assert_fms_handoff_recipient(','assert_fms_publish_recipient(');
    if amended=definition then raise exception 'Review FMS publication recipient boundary: %',signature; end if;
    execute amended;
  end loop;
end $$;
notify pgrst,'reload schema';
