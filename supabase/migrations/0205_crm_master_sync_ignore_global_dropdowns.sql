-- 0204 enqueued a CRM master sync for every dropdown_masters write, but global
-- dropdown rows (tenant_id null, readable by every tenant since 0002) are not
-- part of any tenant's CRM snapshot, and the outbox aggregate is not null, so any
-- insert/update/delete of a global row failed. Skip null tenants; a row moved
-- between global and a tenant still enqueues the tenant side.
create or replace function crm_sync.master_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op in ('UPDATE','DELETE') and old.tenant_id is not null then perform crm_sync.enqueue_master(old.tenant_id); end if;
 if tg_op in ('INSERT','UPDATE') and new.tenant_id is not null then perform crm_sync.enqueue_master(new.tenant_id); end if;
 return null;
end $$;
revoke all on function crm_sync.master_changed() from public,anon,authenticated,service_role;
