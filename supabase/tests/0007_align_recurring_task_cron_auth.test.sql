begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

-- Re-run the exact SQL recorded by the local migration engine. The test
-- container does not mount sibling migration files for psql \ir includes.
create function pg_temp.run_migration_0007()
returns void
language plpgsql
as $$
declare
  v_sql text;
begin
  select string_agg(statement, E';\n' order by ordinal)
  into v_sql
  from supabase_migrations.schema_migrations migration
  cross join lateral unnest(migration.statements) with ordinality as item(statement, ordinal)
  where migration.version = '0007';

  if v_sql is null then
    raise exception 'migration 0007 is absent from local migration history';
  end if;

  execute v_sql;
end;
$$;

-- A clean local Supabase database has Vault but no pg_cron catalog. Re-running
-- the migration must therefore be a safe, explicit no-op.
select ok(to_regclass('cron.job') is null, 'clean local database has no pg_cron job catalog');
select lives_ok('select pg_temp.run_migration_0007()', 'migration safely re-executes when the pg_cron job catalog is absent');

-- Transaction-scoped pg_cron stub matching the documented alter_job API.
create schema cron;
create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text not null,
  schedule text not null,
  command text not null,
  database text not null default current_database(),
  username text not null default current_user,
  active boolean not null default true
);

create function cron.alter_job(
  job_id bigint,
  schedule text default null,
  command text default null,
  database text default null,
  username text default null,
  active boolean default null
)
returns void
language sql
as $$
  update cron.job as job
  set schedule = coalesce($2, job.schedule),
      command = coalesce($3, job.command),
      database = coalesce($4, job.database),
      username = coalesce($5, job.username),
      active = coalesce($6, job.active)
  where job.jobid = $1;
$$;

-- Use Vault's supported API with a runtime-generated synthetic value that is
-- never printed or hardcoded. The final rollback removes the fixture.
create temporary table vault_secret_fixture (
  secret_id uuid,
  synthetic_value text not null
) on commit drop;

insert into vault_secret_fixture(synthetic_value)
values (md5(clock_timestamp()::text || random()::text));

update vault_secret_fixture
set secret_id = vault.create_secret(
  new_secret := synthetic_value,
  new_name := 'recurring_tasks_cron_secret'
);

create temporary table recurrence_cron_expected (
  schedule text not null,
  url_fragment text not null,
  body_fragment text not null,
  timeout_fragment text not null
) on commit drop;

insert into recurrence_cron_expected(schedule, url_fragment, body_fragment, timeout_fragment)
values (
  '35 18 * * *',
  'https://example.invalid/functions/v1/generate-recurring-tasks',
  $body${"date":"2099-12-31"}$body$,
  'timeout_milliseconds := 12345'
);

insert into cron.job(jobname, schedule, command, active)
values (
  'generate-recurring-tasks-daily',
  (select schedule from recurrence_cron_expected),
  $command$
select net.http_post(
  url := 'https://example.invalid/functions/v1/generate-recurring-tasks',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'recurring_tasks_cron_secret'
    )
  ),
  body := '{"date":"2099-12-31"}'::jsonb,
  timeout_milliseconds := 12345
);
$command$,
  true
);

select is((select count(*)::integer from cron.job where jobname = 'generate-recurring-tasks-daily'), 1, 'fixture has exactly one legacy named job');

select lives_ok('select pg_temp.run_migration_0007()', 'legacy Authorization job converts successfully');

select is(regexp_count(lower(command), 'x-cron-secret'), 1, 'legacy job gains exactly one x-cron-secret header')
from cron.job where jobname = 'generate-recurring-tasks-daily';
select is(regexp_count(lower(command), 'authorization'), 0, 'legacy Authorization header is removed')
from cron.job where jobname = 'generate-recurring-tasks-daily';
select is(regexp_count(lower(command), 'bearer'), 0, 'legacy Bearer prefix is removed')
from cron.job where jobname = 'generate-recurring-tasks-daily';
select is(schedule, (select schedule from recurrence_cron_expected), 'schedule is preserved')
from cron.job where jobname = 'generate-recurring-tasks-daily';
select ok(position((select url_fragment from recurrence_cron_expected) in command) > 0, 'request URL is preserved')
from cron.job where jobname = 'generate-recurring-tasks-daily';
select ok(position((select body_fragment from recurrence_cron_expected) in command) > 0, 'request body is preserved')
from cron.job where jobname = 'generate-recurring-tasks-daily';
select ok(position((select timeout_fragment from recurrence_cron_expected) in command) > 0, 'request timeout is preserved')
from cron.job where jobname = 'generate-recurring-tasks-daily';
select is(regexp_count(command, 'recurring_tasks_cron_secret'), 1, 'command retains exactly one named Vault-secret reference')
from cron.job where jobname = 'generate-recurring-tasks-daily';
select is(regexp_count(lower(command), 'from\s+vault\.decrypted_secrets'), 1, 'command resolves the named secret only at request execution')
from cron.job where jobname = 'generate-recurring-tasks-daily';
select ok(position((select synthetic_value from vault_secret_fixture) in command) = 0, 'stored secret value is not copied into the cron command')
from cron.job where jobname = 'generate-recurring-tasks-daily';
select ok(active, 'active state is preserved')
from cron.job where jobname = 'generate-recurring-tasks-daily';

create temporary table aligned_command_snapshot(command_hash text not null) on commit drop;
insert into aligned_command_snapshot
select md5(command) from cron.job where jobname = 'generate-recurring-tasks-daily';

select lives_ok('select pg_temp.run_migration_0007()', 'already aligned job re-executes successfully');

select is(md5(command), (select command_hash from aligned_command_snapshot), 'aligned migration re-execution is idempotent')
from cron.job where jobname = 'generate-recurring-tasks-daily';
select is((select count(*)::integer from cron.job where jobname = 'generate-recurring-tasks-daily'), 1, 'idempotent re-execution does not create another job');

savepoint duplicate_job_case;
insert into cron.job(jobname, schedule, command, active)
select jobname, schedule, command, active
from cron.job
where jobname = 'generate-recurring-tasks-daily';
select throws_ok(
  'select pg_temp.run_migration_0007()',
  '23514',
  'recurrence cron auth alignment requires exactly one named job',
  'duplicate named jobs are rejected closed'
);
rollback to savepoint duplicate_job_case;

savepoint unexpected_shape_case;
update cron.job
set command = replace(command, '''x-cron-secret''', '''unexpected-auth-header''')
where jobname = 'generate-recurring-tasks-daily';
select throws_ok(
  'select pg_temp.run_migration_0007()',
  '23514',
  'recurrence cron command has an unexpected authorization-header shape',
  'unexpected header shape is rejected closed'
);
rollback to savepoint unexpected_shape_case;

savepoint missing_secret_case;
do $$
begin
  perform vault.update_secret(
    secret_id := (select secret_id from vault_secret_fixture),
    new_name := 'recurring_tasks_cron_secret_missing'
  );
end;
$$;
select throws_ok(
  'select pg_temp.run_migration_0007()',
  '23514',
  'recurrence cron auth alignment requires exactly one named Vault secret',
  'existing job conversion requires the named Vault secret'
);
rollback to savepoint missing_secret_case;

delete from cron.job where jobname = 'generate-recurring-tasks-daily';
select is((select count(*)::integer from cron.job), 0, 'no test cron jobs remain after the suite');

select * from finish();
rollback;
