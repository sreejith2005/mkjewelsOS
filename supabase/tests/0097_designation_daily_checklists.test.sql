begin;
select plan(4);
set search_path = public, extensions;

select has_table('public', 'designation_daily_checklists', 'daily checklist configuration table exists');
select has_table('public', 'daily_checklist_acknowledgements', 'daily acknowledgement table exists');
select has_function('public', 'get_my_daily_checklist_status', array[]::text[], 'status RPC exists');
select has_function('public', 'acknowledge_daily_checklist_with_audit', array['uuid', 'integer', 'uuid[]'], 'acknowledgement RPC exists');

select * from finish();
rollback;
