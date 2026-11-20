-- 0442: the sync function can read every sheet's last read time.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0442 test', 'customer-0442') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
end $$;
select customer_ingest_state('master_sheet');
update customer.ingest_state set last_run_at = '2026-11-20 10:45:00+00' where source = 'master_sheet' and tenant_id = customer.ingest_tenant();

select is((customer_ingest_last_runs() ->> 'master_sheet')::timestamptz, '2026-11-20 10:45:00+00'::timestamptz, 'a sheet''s last read time');
select ok(customer_ingest_last_runs() ? 'software_account_list', 'every sheet is listed');
select ok(not has_function_privilege('authenticated', 'public.customer_ingest_last_runs()', 'execute'), 'not open to signed-in people');
select ok(has_function_privilege('service_role', 'public.customer_ingest_last_runs()', 'execute'), 'open to the sync function');

select * from finish();
rollback;
