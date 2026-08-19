-- Add delete_fms_flow_with_audit RPC
set search_path = public, extensions;

create or replace function delete_fms_flow_with_audit(p_flow_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_flow fms_flows;
begin
  select * into v_actor from current_profile();
  if not can_manage_fms_flow(p_flow_id) then
    raise exception 'FMS builder access denied' using errcode='42501';
  end if;
  
  select * into v_flow from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id for update;
  if v_flow.id is null then
    raise exception 'Flow not found' using errcode='23514';
  end if;
  
  if v_flow.status = 'draft' then
    -- Hard delete drafts
    delete from fms_flows where id = p_flow_id;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(v_actor.tenant_id,v_actor.id,'fms_flow_deleted','fms_flows',p_flow_id,jsonb_build_object('status',v_flow.status),jsonb_build_object('reason',left(coalesce(p_reason, 'Deleted draft'), 1000)));
  else
    -- Soft delete / archive published flows
    update fms_flows set status='archived', is_active=false, archived_by=v_actor.id, archived_at=now(), updated_by=v_actor.id, updated_at=now() where id=p_flow_id;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(v_actor.tenant_id,v_actor.id,'fms_flow_archived','fms_flows',p_flow_id,jsonb_build_object('status',v_flow.status),jsonb_build_object('reason',left(coalesce(p_reason, 'Deleted published flow'), 1000)));
  end if;
end $$;

grant execute on function delete_fms_flow_with_audit(uuid, text) to authenticated;
