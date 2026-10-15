-- Ask Kiara, Phase 6 fix (0227): schedule_kiara_jobs() (0220) looked up pg_cron's schema
-- from pg_extension. On Supabase the extension is registered in pg_catalog while its
-- functions (cron.schedule) live in schema cron, so the call failed on the hosted
-- project and no job was created. Same signature, grants and behaviour otherwise.
set search_path = public, extensions;

create or replace function schedule_kiara_jobs(p_function_url text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_secrets integer;
  v_command text;
  v_cron name;
begin
  -- pg_cron's functions live next to its cron.job table (schema cron). On Supabase the
  -- extension itself is registered in pg_catalog, so pg_extension.extnamespace is not it.
  -- Looked up at run time: pg_cron exists on the hosted project, not on local stacks.
  select n.nspname into v_cron from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.oid = to_regclass('cron.job');
  if v_cron is null then raise exception 'pg_cron is not installed' using errcode = '23514'; end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then raise exception 'pg_net is not installed' using errcode = '23514'; end if;
  if to_regclass('vault.secrets') is null then raise exception 'Vault is not available' using errcode = '23514'; end if;
  execute $q$select count(*)::integer from vault.secrets where name = 'kiara_insights_cron_secret'$q$ into v_secrets;
  if v_secrets <> 1 then
    raise exception 'Ask Kiara jobs need exactly one Vault secret named kiara_insights_cron_secret' using errcode = '23514';
  end if;
  insert into kiara_insights_job_config(singleton, function_url, updated_at) values (true, p_function_url, now())
  on conflict (singleton) do update set function_url = excluded.function_url, updated_at = now();

  v_command := 'select net.http_post(url := %L, headers := jsonb_build_object(''Content-Type'', ''application/json'', '
    || '''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''kiara_insights_cron_secret'')), '
    || 'body := %L::jsonb, timeout_milliseconds := 60000);';
  execute format('select %I.schedule($1, $2, $3)', v_cron) using 'kiara-insights-nightly', '0 21 * * *', format(v_command, p_function_url, '{"mode":"nightly"}');
  execute format('select %I.schedule($1, $2, $3)', v_cron) using 'kiara-insights-collect', '*/10 * * * *', format(v_command, p_function_url, '{"mode":"collect"}');
  execute format('select %I.schedule($1, $2, $3)', v_cron) using 'kiara-retention-purge', '30 21 * * *', 'select public.purge_kiara_conversations();';
  return jsonb_build_object('scheduled', jsonb_build_array('kiara-insights-nightly', 'kiara-insights-collect', 'kiara-retention-purge'));
end $$;

alter function schedule_kiara_jobs(text) owner to postgres;
revoke all on function schedule_kiara_jobs(text) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
