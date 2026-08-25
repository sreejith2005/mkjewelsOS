begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(3);

create function pg_temp.run_migration_0103()
returns void
language plpgsql
as $$
declare v_sql text;
begin
  select string_agg(statement, E';\n' order by ordinal)
  into v_sql
  from supabase_migrations.schema_migrations migration
  cross join lateral unnest(migration.statements) with ordinality as item(statement, ordinal)
  where migration.version = '0103';
  if v_sql is null then raise exception 'migration 0103 is absent from local migration history'; end if;
  execute v_sql;
end;
$$;

create schema cron;
create table cron.job (jobid bigint generated always as identity primary key, jobname text not null, schedule text not null, command text not null, active boolean not null default true);
create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null)
returns void language sql as $$ update cron.job set schedule=coalesce($2,schedule),command=coalesce($3,command),active=coalesce($6,active) where jobid=$1; $$;

insert into cron.job(jobname,schedule,command) values('generate-recurring-tasks-daily','35 18 * * *','select 1');

select lives_ok('select pg_temp.run_migration_0103()', 'recurrence catch-up migration applies to the named job');
select is((select schedule from cron.job where jobname='generate-recurring-tasks-daily'), '*/5 * * * *', 'recurrence worker checks for due schedules every five minutes');
select ok((select active from cron.job where jobname='generate-recurring-tasks-daily'), 'recurrence job remains active');

select * from finish();
rollback;
