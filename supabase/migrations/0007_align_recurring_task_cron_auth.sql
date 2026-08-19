-- Align the production recurrence schedule with the checked-in Edge Function's
-- x-cron-secret contract without reading or materializing the Vault value.
do $migration$
declare
  v_job_count integer;
  v_secret_count integer;
  v_job record;
  v_new_command text;
  v_is_legacy boolean;
  v_is_aligned boolean;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron job catalog is absent; recurrence cron auth alignment skipped';
    return;
  end if;

  select count(*)::integer
  into v_job_count
  from cron.job
  where jobname = 'generate-recurring-tasks-daily';

  if v_job_count = 0 then
    raise notice 'recurrence cron job is absent; auth alignment skipped';
    return;
  end if;

  if v_job_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'recurrence cron auth alignment requires exactly one named job';
  end if;

  select jobid, schedule, command, active
  into strict v_job
  from cron.job
  where jobname = 'generate-recurring-tasks-daily';

  if to_regclass('vault.secrets') is null then
    raise exception using
      errcode = '23514',
      message = 'recurrence cron auth alignment requires the named Vault secret';
  end if;

  select count(*)::integer
  into v_secret_count
  from vault.secrets
  where name = 'recurring_tasks_cron_secret';

  if v_secret_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'recurrence cron auth alignment requires exactly one named Vault secret';
  end if;

  -- Fail closed unless the command is the single expected net.http_post call
  -- and still references the named Vault secret rather than a materialized key.
  if regexp_count(lower(v_job.command), 'net\.http_post') <> 1
    or regexp_count(lower(v_job.command), 'url\s*:=') <> 1
    or regexp_count(lower(v_job.command), 'headers\s*:=') <> 1
    or regexp_count(lower(v_job.command), 'body\s*:=') <> 1
    or regexp_count(lower(v_job.command), 'timeout_milliseconds\s*:=') <> 1
    or regexp_count(lower(v_job.command), 'from\s+vault\.decrypted_secrets') <> 1
    or regexp_count(v_job.command, 'recurring_tasks_cron_secret') <> 1
  then
    raise exception using
      errcode = '23514',
      message = 'recurrence cron command has an unexpected request or Vault-reference shape';
  end if;

  v_is_legacy :=
    regexp_count(lower(v_job.command), 'authorization') = 1
    and regexp_count(lower(v_job.command), 'bearer') = 1
    and regexp_count(lower(v_job.command), 'x-cron-secret') = 0
    and regexp_count(
      v_job.command,
      $pattern$'Authorization'\s*,\s*'Bearer '\s*\|\|\s*$pattern$
    ) = 1;

  v_is_aligned :=
    regexp_count(lower(v_job.command), 'authorization') = 0
    and regexp_count(lower(v_job.command), 'bearer') = 0
    and regexp_count(lower(v_job.command), 'x-cron-secret') = 1
    and regexp_count(v_job.command, $pattern$'x-cron-secret'\s*,$pattern$) = 1;

  if v_is_aligned then
    raise notice 'recurrence cron auth is already aligned';
    return;
  end if;

  if not v_is_legacy then
    raise exception using
      errcode = '23514',
      message = 'recurrence cron command has an unexpected authorization-header shape';
  end if;

  v_new_command := regexp_replace(
    v_job.command,
    $pattern$'Authorization'(\s*,\s*)'Bearer '\s*\|\|\s*$pattern$,
    $replacement$'x-cron-secret'\1$replacement$
  );

  if v_new_command = v_job.command
    or regexp_count(lower(v_new_command), 'authorization') <> 0
    or regexp_count(lower(v_new_command), 'bearer') <> 0
    or regexp_count(lower(v_new_command), 'x-cron-secret') <> 1
    or regexp_count(v_new_command, 'recurring_tasks_cron_secret') <> 1
  then
    raise exception using
      errcode = '23514',
      message = 'recurrence cron auth replacement did not produce the canonical header shape';
  end if;

  -- Passing only job_id and command preserves schedule, database, username,
  -- active state, URL, request body, timeout and every non-auth command byte.
  execute 'select cron.alter_job(job_id := $1, command := $2)'
    using v_job.jobid, v_new_command;

  raise notice 'recurrence cron auth aligned to x-cron-secret';
end;
$migration$;
