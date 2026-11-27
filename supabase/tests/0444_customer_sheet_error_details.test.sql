-- 0444: a failed sheet read keeps when it started and when the sheet last read fine.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

do $$
declare t uuid;
begin
  insert into tenants(name, slug) values ('0444 test', 'customer-0444') returning id into t;
  insert into customer.ingest_settings(tenant_id) values (t);
end $$;
select customer_ingest_state('walkin');
update customer.ingest_state set last_run_at = '2026-11-27 08:00+00', last_error = null where source = 'walkin' and tenant_id = customer.ingest_tenant();
select is((select last_ok_at from customer.ingest_state where source = 'walkin' and tenant_id = customer.ingest_tenant()), '2026-11-27 08:00+00'::timestamptz, 'a good read is the last good read');

select customer_ingest_note_error('walkin', 'sheet_not_shared');
select ok((select error_since is not null and last_ok_at = '2026-11-27 08:00+00' from customer.ingest_state where source = 'walkin' and tenant_id = customer.ingest_tenant()), 'a failure records since when, and keeps the last good read');
create temp table since as select error_since from customer.ingest_state where source = 'walkin' and tenant_id = customer.ingest_tenant();
update customer.ingest_state set error_since = error_since - interval '1 hour' where source = 'walkin' and tenant_id = customer.ingest_tenant();
select customer_ingest_note_error('walkin', 'sheet_not_shared');
select ok((select s.error_since - interval '1 hour' = i.error_since from customer.ingest_state i, since s where i.source = 'walkin' and i.tenant_id = customer.ingest_tenant()), 'failing again keeps the first time');

update customer.ingest_state set last_error = null, last_run_at = '2026-11-27 10:00+00' where source = 'walkin' and tenant_id = customer.ingest_tenant();
select ok((select error_since is null and last_ok_at = '2026-11-27 10:00+00' from customer.ingest_state where source = 'walkin' and tenant_id = customer.ingest_tenant()), 'a good read clears the problem');

select customer_ingest_note_error('walkin', 'sheet_tab_not_found:Walk in');
select ok(pg_get_functiondef('public.customer_list_filters(text)'::regprocedure) ~ '''error_since'', i.error_since', 'the Customers page gets the details');
select ok(pg_get_functiondef('public.customer_list_filters(text)'::regprocedure) ~ '''label'', coalesce\(s.label, i.source\)', '... with the sheet name');
select is((select last_error from customer.ingest_state where source = 'walkin' and tenant_id = customer.ingest_tenant()), 'sheet_tab_not_found:Walk in', 'a code may carry the tab name');

-- 12 months of automatic customer history.
insert into audit_logs(tenant_id, action, module, new_value, created_at) values
  ((select id from tenants where slug = 'customer-0444'), 'customer_client_created', 'customer', '{}', now() - interval '13 months'),
  ((select id from tenants where slug = 'customer-0444'), 'customer_client_created', 'customer', '{}', now() - interval '11 months'),
  ((select id from tenants where slug = 'customer-0444'), 'task_created', 'tasks', '{}', now() - interval '13 months');
insert into audit_logs(tenant_id, actor_user_id, action, module, new_value, created_at)
select (select id from tenants where slug = 'customer-0444'), p.id, 'customer_deleted', 'customer', '{}', now() - interval '13 months' from user_profiles p limit 1;
create temp table before_counts as select module, actor_user_id is null as auto, created_at < now() - interval '12 months' as old, count(*) n
  from audit_logs where tenant_id = (select id from tenants where slug = 'customer-0444') group by 1, 2, 3;
select ok(purge_customer_auto_history() >= 1, 'old automatic customer history is removed');
select is((select count(*) from audit_logs where tenant_id = (select id from tenants where slug = 'customer-0444') and module = 'customer' and actor_user_id is null and created_at < now() - interval '12 months'), 0::bigint, '... none older than 12 months is left');
select ok((select count(*) from audit_logs where tenant_id = (select id from tenants where slug = 'customer-0444') and (module = 'tasks' or created_at > now() - interval '12 months' or actor_user_id is not null) and action <> 'customer_auto_history_purged')
   = (select coalesce(sum(n), 0) from before_counts where module = 'tasks' or not old or not auto), 'newer, person-made and other sections'' history is kept');

select * from finish();
rollback;
