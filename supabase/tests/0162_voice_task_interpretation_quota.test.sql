begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;

select plan(9);

select has_table('public','voice_interpretation_quotas','the voice interpretation quota table exists');
select ok((select relrowsecurity from pg_class where oid='public.voice_interpretation_quotas'::regclass),'row level security is enabled on the quota table');
select table_privs_are('public','voice_interpretation_quotas','anon',array[]::text[],'anon cannot touch the quota table');
select table_privs_are('public','voice_interpretation_quotas','authenticated',array[]::text[],'authenticated cannot touch the quota table');
-- Matches username_login_rate_limits exactly; REFERENCES/TRIGGER/TRUNCATE come
-- from the project's default privileges for service_role, not from this migration.
select table_privs_are('public','voice_interpretation_quotas','service_role',array['SELECT','INSERT','UPDATE','DELETE','REFERENCES','TRIGGER','TRUNCATE'],'only the service role maintains the quota table');
select ok((select count(*) from information_schema.role_table_grants where table_name='voice_interpretation_quotas' and grantee not in ('postgres','service_role')) = 0,'no role beyond the service role holds any grant on the quota table');

select function_privs_are('public','consume_voice_interpretation_quota',array['uuid'],'authenticated',array[]::text[],'authenticated cannot spend quota directly');
select function_privs_are('public','consume_voice_interpretation_quota',array['uuid'],'service_role',array['EXECUTE'],'the edge worker spends quota as the service role');
select ok(position('service_role' in pg_get_functiondef('public.consume_voice_interpretation_quota(uuid)'::regprocedure)) > 0,'the quota function refuses any caller that is not the service role');

select * from finish();
rollback;
