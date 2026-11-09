-- A Director sees only their own franchises and stores, with or without the
-- company-wide franchise isolation switch (owner report 2026-11-09: a Director
-- in Ahmedabad still saw every Mumbai task, person and dashboard).
--
-- Why: every franchise read rule (0385-0393) first asks org_scope_enforced()
-- and keeps today's company-wide behaviour while isolation is off. 0397 made a
-- Director an Admin with director grants, so with the switch off a Director
-- read like an Admin.
--
-- Fix: org_scope_enforced(tenant) is also true while the signed-in person is a
-- Director of that tenant. Every existing franchise rule (directory, tasks,
-- Task Control, FMS, forms, dashboards, reports, exports, Store Intelligence,
-- Availability, search) therefore applies to Directors at once, through the
-- one helper they all call. Nothing changes for anyone else: Super Admin, Admin,
-- Managers, HR and staff keep today's access until isolation is switched on.
-- Work without a signed-in person (cron, service role) is unaffected.
--
-- The switch itself is read from tenant_franchise_controls directly by the
-- Super Admin franchise tools, which only Super Admin (never a Director) calls.
set search_path = public, extensions;

-- The tenant's switch on its own (for reports and tests).
create function org_isolation_switch_on(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.enforcement_enabled from tenant_franchise_controls c where c.tenant_id = p_tenant_id), false);
$$;

create or replace function org_scope_enforced(p_tenant_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_actor uuid; v_tenant uuid;
begin
  if org_isolation_switch_on(p_tenant_id) then
    return true;
  end if;
  select p.id, p.tenant_id into v_actor, v_tenant from current_profile() p;
  return v_actor is not null and v_tenant = p_tenant_id and org_is_director(v_actor);
end $$;

revoke all on function org_isolation_switch_on(uuid), org_scope_enforced(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
