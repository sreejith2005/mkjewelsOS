-- Original CRM port: JewelOS audit rows for the direct table writes the original UI makes.
--
-- The original CRM UI writes some tables directly through PostgREST under RLS instead of
-- through an RPC: clients (profile edit), crm_daily_availability (roster availability),
-- leads (lead capture; the Runo push updates it), lead_call_history (post-call inbox).
-- The lookup tables are writable directly by a CRM super admin. Mutating CRM RPCs already
-- write their own crm.<function> row through crm_private.write_audit_log (0182); these
-- writes did not. RLS and the UI contract are unchanged.
--
-- Audited: a row-level INSERT/UPDATE/DELETE executed as role authenticated by the statement
-- itself (trigger depth 1), outside a PostgREST RPC call. Writes made inside an RPC
-- (request.path /rpc/...) or by another trigger function belong to that RPC's or
-- statement's audit. A foreign-key cascade of a direct delete (lead -> lead_call_history)
-- runs at depth 1 as the caller and is recorded as its own delete row.
-- The row records the entity, the operation and the changed column names only; customer
-- values are never copied into the audit metadata.

create function crm_private.audit_direct_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_columns text[];
begin
  if current_user <> 'authenticated'
    or pg_trigger_depth() > 1
    or coalesce(current_setting('request.path', true), '') like '/rpc/%' then
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    v_columns := '{}';
  elsif tg_op = 'UPDATE' then
    v_row := to_jsonb(new);
    v_old := to_jsonb(old);
    select coalesce(array_agg(changed.key order by changed.key), '{}') into v_columns
    from jsonb_each(v_row) as changed
    where changed.value is distinct from v_old -> changed.key;
  else
    v_row := to_jsonb(new);
    select coalesce(array_agg(assigned.key order by assigned.key), '{}') into v_columns
    from jsonb_each(v_row) as assigned
    where assigned.value <> 'null'::jsonb;
  end if;

  perform crm_private.write_audit_log(
    'crm.' || tg_table_name || '_' || lower(tg_op),
    (v_row ->> tg_argv[0])::uuid,
    jsonb_build_object(
      'entity', tg_table_name,
      'operation', lower(tg_op),
      'changed_columns', to_jsonb(v_columns)
    )
  );
  return null;
end
$$;

revoke all on function crm_private.audit_direct_write() from public, anon;

create trigger crm_direct_write_audit after insert or update or delete on crm.clients
  for each row execute function crm_private.audit_direct_write('client_id');
create trigger crm_direct_write_audit after insert or update or delete on crm.crm_daily_availability
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.leads
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.lead_call_history
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.lookup_beverages
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.lookup_cities
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.lookup_communities
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.lookup_gifts
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.lookup_not_bought_reasons
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.lookup_pincodes
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.lookup_product_categories
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.lookup_relations
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.lookup_snacks
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.lookup_source_of_leads
  for each row execute function crm_private.audit_direct_write('id');
create trigger crm_direct_write_audit after insert or update or delete on crm.lookup_sugar_options
  for each row execute function crm_private.audit_direct_write('id');
