-- A daily job can run before an administrator creates or backdates a
-- recurrence for the same Kolkata day. Re-checking idempotently every five
-- minutes fills that current-day gap without duplicating task instances.
do $migration$
declare
  v_job_count integer;
  v_job_id bigint;
  v_schedule text;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron job catalog is absent; recurrence catch-up schedule skipped';
    return;
  end if;

  select count(*)::integer into v_job_count
  from cron.job
  where jobname = 'generate-recurring-tasks-daily';

  if v_job_count = 0 then
    raise notice 'recurrence cron job is absent; catch-up schedule skipped';
    return;
  end if;

  if v_job_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'recurrence catch-up schedule requires exactly one named job';
  end if;

  select jobid, schedule into strict v_job_id, v_schedule
  from cron.job
  where jobname = 'generate-recurring-tasks-daily';

  if v_schedule = '*/5 * * * *' then
    raise notice 'recurrence catch-up schedule is already configured';
    return;
  end if;

  perform cron.alter_job(job_id := v_job_id, schedule := '*/5 * * * *');
end;
$migration$;
