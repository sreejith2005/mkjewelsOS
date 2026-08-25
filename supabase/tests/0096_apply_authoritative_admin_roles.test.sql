begin;
select plan(2);
select has_function('public', 'apply_authoritative_admin_roles', array['uuid[]'], 'authoritative admin role function exists');
select ok(has_function_privilege('service_role', 'apply_authoritative_admin_roles(uuid[])', 'EXECUTE') and not has_function_privilege('authenticated', 'apply_authoritative_admin_roles(uuid[])', 'EXECUTE'), 'only service role may grant authoritative admin roles');
select * from finish();
rollback;
