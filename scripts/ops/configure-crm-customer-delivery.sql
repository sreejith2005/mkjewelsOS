-- JewelOS production-only operational deployment, not a schema migration.
-- Reuses the established staff-sync Vault credential; contains no secret value.
-- Run only after linked-ledger/dry-run checks and receiver/credential verification.
-- The worker claims at most two batches of ten events and uses durable leases.
begin;
do $configure$
declare
  v_job bigint;
begin
  if to_regclass('crm_sync.customer_events') is null then
    raise exception 'Customer event migration is required on the JewelOS project';
  end if;
  if not exists (
    select 1 from cron.job
    where jobname = 'crm-staff-sync-deliver' and active
      and position('https://yimafxhuwgfhvzczqqdd.supabase.co/functions/v1/crm-staff-sync' in command) > 0
      and position('vault.decrypted_secrets' in command) > 0
      and position('crm_staff_sync_cron_secret' in command) > 0
  ) then
    raise exception 'Verify the existing JewelOS production staff-sync scheduler';
  end if;
  if (select count(*) from vault.decrypted_secrets
      where name = 'crm_staff_sync_cron_secret' and length(decrypted_secret) >= 32) <> 1 then
    raise exception 'The existing staff-sync Vault credential is required';
  end if;
  select cron.schedule('crm-customer-sync-deliver', '* * * * *', $job$
    select net.http_post(
      url := 'https://yimafxhuwgfhvzczqqdd.supabase.co/functions/v1/crm-customer-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                          where name = 'crm_staff_sync_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$) into v_job;
  insert into public.audit_logs(action, module, new_value)
  values ('crm_customer_delivery_configured', 'settings', jsonb_build_object(
    'jobId', v_job, 'jobName', 'crm-customer-sync-deliver',
    'schedule', '* * * * *', 'maximumEventsPerRun', 20,
    'authorization', 'owner-authorized two-project integration deployment'));
end
$configure$;
commit;
