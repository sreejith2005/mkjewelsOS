begin;
select plan(9);
set search_path = public, extensions;

select has_table('public', 'tenant_realtime_events', 'tenant-safe realtime signal table exists');
select has_column('public', 'tenant_realtime_events', 'tenant_id', 'signals are tenant-scoped');
select has_column('public', 'tenant_realtime_events', 'topic', 'signals carry a bounded topic');
select hasnt_column('public', 'tenant_realtime_events', 'payload', 'signals contain no business payload');
select has_function('public', 'emit_tenant_realtime_event', array['uuid', 'text'], 'owner-only signal emitter exists');
select table_privs_are('public', 'tenant_realtime_events', 'anon', array[]::text[], 'anonymous callers have no signal-table privileges');
select table_privs_are('public', 'tenant_realtime_events', 'authenticated', array['SELECT'], 'authenticated listeners can receive RLS-filtered signals');
select function_privs_are('public', 'emit_tenant_realtime_event', array['uuid', 'text'], 'authenticated', array[]::text[], 'browser callers cannot emit signals');
select col_has_check('public', 'tenant_realtime_events', 'topic', 'signal topics are database-validated');

select * from finish();
rollback;
