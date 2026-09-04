-- The legacy task creation RPC has a strict payload allowlist. Completion mode
-- is consumed by the wrapper and must not be forwarded into that RPC.
set search_path=public,extensions;

create or replace function public.create_manual_task_with_mode_with_audit(
  p_payload jsonb,p_doer_ids uuid[],p_watcher_ids uuid[],p_checklist jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_task_id uuid; v_mode text:=coalesce(nullif(p_payload->>'task_type',''),'delegation'); v_actor user_profiles; v_legacy_payload jsonb;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid() and account_status='active' and is_login_enabled;
  if v_actor.id is null then raise exception 'Active profile is required' using errcode='42501'; end if;
  if v_mode not in ('delegation','checklist') then raise exception 'Task type is invalid' using errcode='23514'; end if;
  if v_mode='delegation' and jsonb_array_length(coalesce(p_checklist,'[]'::jsonb))>0 then raise exception 'Task cannot contain checklist items' using errcode='23514'; end if;
  if v_mode='checklist' and (jsonb_array_length(coalesce(p_checklist,'[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements(p_checklist) x where nullif(btrim(x->>'item_text'),'') is null)) then raise exception 'Checklist requires at least one item' using errcode='23514'; end if;
  v_legacy_payload := (p_payload - 'task_type') || jsonb_build_object('requires_upload',v_mode='delegation');
  v_task_id:=create_delegation_task_with_audit(v_legacy_payload,p_doer_ids,p_watcher_ids,case when v_mode='checklist' then p_checklist else '[]'::jsonb end);
  update task_instances set task_type=v_mode::task_type,requires_upload=(v_mode='delegation'),updated_by=v_actor.id,updated_at=now() where id=v_task_id and tenant_id=v_actor.tenant_id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'task_completion_mode_set','tasks',v_task_id,jsonb_build_object('task_type',v_mode));
  return v_task_id;
end $$;
revoke all on function public.create_manual_task_with_mode_with_audit(jsonb,uuid[],uuid[],jsonb) from public,anon;
grant execute on function public.create_manual_task_with_mode_with_audit(jsonb,uuid[],uuid[],jsonb) to authenticated;
notify pgrst,'reload schema';
