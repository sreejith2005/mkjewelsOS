-- Preserve an empty task category as NULL instead of selecting the tenant's
-- first active category. The public import RPC remains the audited/authenticated
-- wrapper from migration 0105; this updates only its revoked implementation.
set search_path = public, extensions;

do $$
declare
  v_definition text;
  v_old text := $old$and (nullif(btrim(v_row->>'category'),'') is null or lower(dm.label)=lower(btrim(v_row->>'category')) or lower(dm.value)=lower(btrim(v_row->>'category')))$old$;
  v_new text := $new$and nullif(btrim(v_row->>'category'),'') is not null and (lower(dm.label)=lower(btrim(v_row->>'category')) or lower(dm.value)=lower(btrim(v_row->>'category')))$new$;
begin
  v_definition := pg_get_functiondef('public.commit_task_bulk_import_chunk_v0104(uuid,jsonb)'::regprocedure);
  if position(v_old in v_definition) = 0 then
    raise exception 'Expected task import category lookup was not found';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;

revoke all on function public.commit_task_bulk_import_chunk_v0104(uuid,jsonb) from public, anon, authenticated, service_role;
