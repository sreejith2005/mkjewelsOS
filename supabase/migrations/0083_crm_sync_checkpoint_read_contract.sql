-- Read-only, scoped checkpoint contract for the server-side CRM sync worker.
-- The worker must not query crm_sync_checkpoints directly.

create or replace function public.get_crm_sync_checkpoint(
  p_source_key text,
  p_scope_key text,
  p_worker_assertion jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
  v_source_system_id uuid;
  v_checkpoint jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'CRM sync worker role is required' using errcode = '42501';
  end if;

  select tenant_id, source_system_id
    into v_tenant_id, v_source_system_id
  from public.assert_crm_sync_worker(p_source_key, p_scope_key, p_worker_assertion);

  if v_tenant_id is null or v_source_system_id is null then
    raise exception 'CRM sync worker assertion is invalid' using errcode = '42501';
  end if;

  select checkpoint
    into v_checkpoint
  from public.crm_sync_checkpoints
  where tenant_id = v_tenant_id
    and source_system_id = v_source_system_id
    and scope_key = p_scope_key;

  return jsonb_build_object('checkpoint', v_checkpoint);
end;
$$;

revoke all on function public.get_crm_sync_checkpoint(text, text, jsonb) from public;
grant execute on function public.get_crm_sync_checkpoint(text, text, jsonb) to service_role;
