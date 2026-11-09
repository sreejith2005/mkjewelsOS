-- Delete client queue entries (owner request 2026-11-09).
--
-- Before: walk-ins and client registrations made for a demo stayed in CLIENT QUEUE for good.
-- No screen could remove them, while the API still let any branch staff member DELETE a queue
-- row directly (policy branch_staff_entry_queue + table grant), with no audit and without
-- closing the JewelOS "Complete walk-in form" task the entry had created.
--
-- After:
--   * delete_queue_entries(ids, reason): CRM Super Admin only; up to 200 entries at once, from
--     any tab (Active queue or Recently submitted). Each removed entry is written to
--     crm_private.audit_logs (token, name, branch, status, client, time and the reason) in the
--     same transaction.
--   * Removing an entry removes only the queue row and its unfinished walk-in form draft
--     (walkin_visit_drafts cascade). Clients, saved visits, leads, follow-ups and documents are
--     kept: a client is removed from the Client Database with Archive client.
--   * Each removed entry queues one walk-in sync event; JewelOS receives "entry gone" and closes
--     the entry's open "Complete walk-in form" task (crm_sync, JewelOS 0211), so no open task
--     is left for a deleted entry.
--   * Browsers can no longer DELETE queue rows directly. Server jobs are unaffected.

create function public.delete_queue_entries(p_entry_ids uuid[], p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := left(coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Deleted from the client queue'), 500);
  v_ids uuid[];
  v_entry public.entry_queue;
  v_deleted uuid[] := '{}'::uuid[];
begin
  if not public.is_super_admin() then
    raise exception 'Only a CRM Super Admin can delete queue entries' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct id), '{}') into v_ids from unnest(coalesce(p_entry_ids, '{}')) id where id is not null;
  if cardinality(v_ids) = 0 or cardinality(v_ids) > 200 then
    raise exception 'Choose 1 to 200 queue entries' using errcode = '22023';
  end if;
  for v_entry in select * from public.entry_queue where id = any(v_ids) order by created_at, id for update loop
    delete from public.entry_queue where id = v_entry.id;
    -- The trigger only sees inserts and updates: tell JewelOS the entry is gone.
    insert into crm_private.sync_outbox (event_type, aggregate_id)
    values ('walkin.changed', v_entry.id)
    on conflict (event_type, aggregate_id) where delivered_at is null and dead_at is null
    do update set changed_at = clock_timestamp(), next_attempt_at = least(crm_private.sync_outbox.next_attempt_at, now());
    perform crm_private.write_audit_log('crm.delete_queue_entry', v_entry.id, jsonb_build_object(
      'token', v_entry.token, 'client_name', v_entry.client_name, 'branch_id', v_entry.branch_id,
      'status', v_entry.status, 'client_id', v_entry.client_id, 'assigned_crm_name', v_entry.assigned_crm_name,
      'created_at', v_entry.created_at, 'reason', v_reason));
    v_deleted := v_deleted || v_entry.id;
  end loop;
  return jsonb_build_object('deleted', cardinality(v_deleted), 'ids', to_jsonb(v_deleted),
    'not_found', cardinality(v_ids) - cardinality(v_deleted));
end $$;
revoke all on function public.delete_queue_entries(uuid[], text) from public, anon;
grant execute on function public.delete_queue_entries(uuid[], text) to authenticated;

revoke delete on table public.entry_queue from authenticated, anon;

notify pgrst, 'reload schema';
