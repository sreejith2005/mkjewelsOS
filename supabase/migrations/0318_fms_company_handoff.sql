-- FMS ownership transfers are authorized by the exact workflow assignment,
-- not the ordinary Tasks assignment capability, department scope or role list.
-- Recipient activity and tenant checks still apply to selected and covered users.
set search_path=public,extensions;

create or replace function assert_fms_handoff_recipient(p_user_id uuid,p_tenant_id uuid,p_explicit boolean default true)
returns void language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();
begin
  perform assert_direct_assignment_user(p_user_id,p_tenant_id,'FMS');
  if p_explicit and (a.id is null or a.tenant_id<>p_tenant_id or not current_profile_is_active()) then
    raise exception 'Employee is outside your permitted FMS handoff scope' using errcode='42501';
  end if;
end $$;
revoke all on function assert_fms_handoff_recipient(uuid,uuid,boolean) from public,anon,authenticated,service_role;

-- Preserve the existing preview/actor authorization, published destination lock,
-- tenant/activity filters, safe directory fields, search and bounded pagination.
do $$
declare definition text; amended text; task_scope text:='and (u.id=a.id or has_permission(''tasks.assign_others'')) and task_assignment_user_in_scope(u.id) and task_assignment_recipient_allowed(u.id)';
begin
  definition:=pg_get_functiondef('list_fms_handoff_recipients(jsonb,uuid,text,uuid,integer)'::regprocedure);
  amended:=replace(definition,task_scope,'');
  if amended=definition then raise exception 'Review FMS recipient list scope marker'; end if;
  execute amended;
end $$;
notify pgrst,'reload schema';
