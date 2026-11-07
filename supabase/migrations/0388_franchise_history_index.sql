-- Organisation history (Users > Franchises) timed out on production: audit_logs
-- holds over a million rows and franchise events are rare, so reading the
-- newest 50 of them walked almost the whole tenant index. This partial index
-- holds only those events, so get_franchise_audit_history reads them directly.
-- The predicate matches the action list in get_franchise_audit_history (0386).
--
-- Production applied this with CREATE INDEX CONCURRENTLY (same name), so the
-- statement below is a no-op there; local and new databases build it here.
create index if not exists audit_logs_franchise_history_idx
  on public.audit_logs (tenant_id, created_at desc)
  where action in ('franchise_group_saved', 'branch_franchise_assigned', 'org_scope_granted',
    'org_scope_revoked', 'employee_franchise_transferred', 'franchise_enforcement_changed', 'cross_location_task_assigned',
    'cross_location_recipient_selected', 'definition_owner_franchise_set');
