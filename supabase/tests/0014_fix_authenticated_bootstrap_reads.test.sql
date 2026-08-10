begin;

select plan(16);

select ok(has_table_privilege('authenticated', 'tenants', 'SELECT'), 'authenticated can read RLS-authorized tenants');
select ok(has_table_privilege('authenticated', 'branches', 'SELECT'), 'authenticated can read RLS-authorized branches');
select ok(has_table_privilege('authenticated', 'departments', 'SELECT'), 'authenticated can read RLS-authorized departments');
select ok(has_table_privilege('authenticated', 'user_profiles', 'SELECT'), 'authenticated can read RLS-authorized profiles');

select ok(not has_table_privilege('authenticated', 'tenants', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'authenticated cannot mutate tenants directly');
select ok(not has_table_privilege('authenticated', 'branches', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'authenticated cannot mutate branches directly');
select ok(not has_table_privilege('authenticated', 'departments', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'authenticated cannot mutate departments directly');
select ok(not has_table_privilege('authenticated', 'user_profiles', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'authenticated cannot mutate profiles directly');

select ok(not has_table_privilege('anon', 'tenants', 'SELECT'), 'anonymous users cannot read tenants');
select ok(not has_table_privilege('anon', 'branches', 'SELECT'), 'anonymous users cannot read branches');
select ok(not has_table_privilege('anon', 'departments', 'SELECT'), 'anonymous users cannot read departments');
select ok(not has_table_privilege('anon', 'user_profiles', 'SELECT'), 'anonymous users cannot read profiles');

select ok(not has_table_privilege('anon', 'tenants', 'INSERT,UPDATE,DELETE'), 'anonymous users cannot mutate tenants');
select ok(not has_table_privilege('anon', 'branches', 'INSERT,UPDATE,DELETE'), 'anonymous users cannot mutate branches');
select ok(not has_table_privilege('anon', 'departments', 'INSERT,UPDATE,DELETE'), 'anonymous users cannot mutate departments');
select ok(not has_table_privilege('anon', 'user_profiles', 'INSERT,UPDATE,DELETE'), 'anonymous users cannot mutate profiles');

select * from finish();
rollback;
