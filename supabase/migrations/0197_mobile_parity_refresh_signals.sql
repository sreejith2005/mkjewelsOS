-- Complete durable invalidation coverage for existing cross-surface workflows.
-- No business payload or additional reader/writer grants. Existing table/RPC
-- authorization and audit transactions remain the source of truth.
set search_path=public,extensions;

create trigger tenant_realtime_leave_requests after insert or update or delete on leave_requests
  for each row execute function emit_realtime_direct_event('organization');
create trigger tenant_realtime_fms_starters after insert or update or delete on fms_starter_assignments
  for each row execute function emit_realtime_direct_event('fms');
create trigger tenant_realtime_exports after insert or update or delete on export_logs
  for each row execute function emit_realtime_direct_event('settings');
create trigger tenant_realtime_notification_templates after insert or update or delete on notification_templates
  for each row execute function emit_realtime_direct_event('settings');
create trigger tenant_realtime_notification_rules after insert or update or delete on notification_rules
  for each row execute function emit_realtime_direct_event('settings');
create trigger tenant_realtime_daily_checklist_definitions after insert or update or delete on designation_daily_checklists
  for each row execute function emit_realtime_direct_event('settings');
create trigger tenant_realtime_daily_checklist_acknowledgements after insert or update or delete on daily_checklist_acknowledgements
  for each row execute function emit_realtime_direct_event('settings');
