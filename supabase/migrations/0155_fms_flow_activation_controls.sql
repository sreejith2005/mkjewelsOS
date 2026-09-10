-- Unified FMS console controls: pause/resume a published flow version without
-- archiving it, and restore an archived version back into service. Both are
-- audited and reuse the existing FMS builder authorization check.
set search_path = public, extensions;

create or replace function set_fms_flow_active_with_audit(p_flow_id uuid, p_active boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor user_profiles; v_flow fms_flows;
begin
  select * into v_actor from current_profile();
  if not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode='42501'; end if;
  select * into v_flow from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id for update;
  if v_flow.id is null then raise exception 'Flow not found' using errcode='23514'; end if;
  if v_flow.status<>'published' then raise exception 'Only published flow versions can be paused or resumed' using errcode='23514'; end if;
  if v_flow.is_active is not distinct from p_active then return; end if;
  update fms_flows set is_active=p_active, updated_by=v_actor.id, updated_at=now() where id=p_flow_id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,case when p_active then 'fms_flow_activated' else 'fms_flow_deactivated' end,'fms_flows',p_flow_id,
    jsonb_build_object('is_active',v_flow.is_active),
    jsonb_build_object('is_active',p_active,'reason',left(coalesce(p_reason,''),1000)));
end $$;

create or replace function restore_fms_flow_with_audit(p_flow_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor user_profiles; v_flow fms_flows;
begin
  select * into v_actor from current_profile();
  if not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode='42501'; end if;
  select * into v_flow from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id for update;
  if v_flow.id is null or v_flow.status<>'archived' then raise exception 'Archived flow version not found' using errcode='23514'; end if;
  update fms_flows set status='archived', is_active=false, archived_by=v_actor.id, archived_at=now(), updated_by=v_actor.id, updated_at=now()
  where tenant_id=v_flow.tenant_id and family_id=v_flow.family_id and status='published';
  update fms_flows set status='published', is_active=true, archived_by=null, archived_at=null, published_by=v_actor.id, updated_by=v_actor.id, updated_at=now()
  where id=p_flow_id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'fms_flow_restored','fms_flows',p_flow_id,
    jsonb_build_object('status','archived'),
    jsonb_build_object('status','published','version',v_flow.version,'reason',left(coalesce(p_reason,''),1000)));
end $$;

grant execute on function set_fms_flow_active_with_audit(uuid, boolean, text), restore_fms_flow_with_audit(uuid, text) to authenticated;
