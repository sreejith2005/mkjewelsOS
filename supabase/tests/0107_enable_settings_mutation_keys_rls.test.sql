begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

select ok((select relrowsecurity from pg_class where oid = 'public.settings_mutation_keys'::regclass), 'settings mutation replay keys have RLS enabled');
select ok(not has_table_privilege('anon', 'settings_mutation_keys', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no replay-key access');
select ok(not has_table_privilege('authenticated', 'settings_mutation_keys', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no replay-key access');
select ok(not has_table_privilege('service_role', 'settings_mutation_keys', 'SELECT,INSERT,UPDATE,DELETE'), 'service role has no replay-key access');

select * from finish();
rollback;
