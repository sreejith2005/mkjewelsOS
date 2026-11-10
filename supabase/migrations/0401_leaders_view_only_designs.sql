-- 0401: Leaders see every workflow and form design, read-only (owner 2026-11-10).
--
-- Owner: Admins, Directors and Managers can open every FMS workflow and every form,
-- click into each step or question and see its full configuration, but cannot
-- edit, drag, publish or delete anything. They also open Dropdown Master and the
-- organization settings read-only. Managers stop authoring forms by default.
--
-- * New capabilities (role defaults Super Admin, Admin, Manager; a Director is an Admin):
--     fms.view_designs            open any workflow read-only (steps, routes, assignees)
--     forms.view_designs          open any form read-only, drafts and archived included
--     settings.view_organization  see the organization settings read-only
-- * forms.manage defaults to Super Admin only; the Manager role grant is removed
--   (audited). Individual user overrides stay Super Admin's explicit choice.
-- * dropdowns.view (the Dropdown Master page) defaults to Super Admin, Admin and
--   Manager. Changing values still needs dropdowns.manage (Super Admin).
-- * fms_my_flow_access() reports 'view' on every workflow the person can see when
--   they hold fms.view_designs, so the existing per-workflow View path (0390: RLS
--   reads, builder in view-only mode) serves leaders. An explicit grant wins.
--   'view' never passes can_edit_fms_flow / can_publish_fms_flow.
-- * can_access_form_template() also lets forms.view_designs read drafts and
--   archived versions inside the person's franchise scope (org_definition_visible),
--   exactly where forms.manage could. No write path checks the new keys.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Capabilities
-- ---------------------------------------------------------------------------
-- permission-catalog:begin
insert into permission_catalog(key, kind, page_id, default_roles, sort_order) values
('fms.view_designs', 'action', null, '{super_admin,admin,manager}', 95),
('forms.view_designs', 'action', null, '{super_admin,admin,manager}', 115),
('settings.view_organization', 'action', null, '{super_admin,admin,manager}', 255);
insert into permission_catalog(key, kind, page_id, default_roles, sort_order) values
('forms.manage', 'action', null, '{super_admin}', 110),
('dropdowns.view', 'module', 'dropdown_master', '{super_admin,admin,manager}', 220)
on conflict (key) do update set default_roles = excluded.default_roles;
-- permission-catalog:end

-- A role-level grant would keep form authoring for every Manager; remove it (audited).
with removed as (
  delete from role_permissions r
  where r.user_role = 'manager' and r.is_allowed and r.permission_key = 'forms.manage'
  returning r.*
)
insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
select tenant_id, null, 'role_permission_reset', 'permissions', null, to_jsonb(removed),
  jsonb_build_object('reason', 'Migration 0401: Managers view forms but do not author them')
from removed;

-- ---------------------------------------------------------------------------
-- 2. Workflows: leaders get View on every workflow they can see
-- ---------------------------------------------------------------------------
create or replace function fms_my_flow_access(p_family_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select g.access_level
     from fms_flow_access_grants g
     where g.family_id = p_family_id
       and g.revoked_at is null
       and g.user_profile_id = (select (current_profile()).id)
       and g.tenant_id = (select current_tenant_id())
       and (select current_profile_is_active())
       and has_permission('fms.view')
     limit 1),
    (select 'view'::text
     where (select current_profile_is_active()) and has_permission('fms.view') and has_permission('fms.view_designs')
       and exists (select 1 from fms_flows f
                   where f.family_id = p_family_id and f.tenant_id = (select current_tenant_id())
                     and org_definition_visible(f.branch_id, f.owner_franchise_group_id))));
$$;

create or replace function list_my_fms_flow_access()
returns table (family_id uuid, access_level text)
language sql stable security definer set search_path = public as $$
  with grants as (
    select g.family_id, g.access_level from fms_flow_access_grants g
    where g.user_profile_id = (select (current_profile()).id) and g.revoked_at is null
      and g.tenant_id = (select current_tenant_id()) and (select current_profile_is_active()) and has_permission('fms.view')
  )
  select family_id, access_level from grants
  union all
  select distinct f.family_id, 'view'::text from fms_flows f
  where (select current_profile_is_active()) and has_permission('fms.view') and has_permission('fms.view_designs')
    and f.tenant_id = (select current_tenant_id())
    and org_definition_visible(f.branch_id, f.owner_franchise_group_id)
    and not exists (select 1 from grants g where g.family_id = f.family_id);
$$;

-- The 0390 View policies on assignees and routes checked only the workflow's
-- tenant. Now that every leader holds View, they also apply the integrity rules
-- of the main policies: a named assignee must belong to the workflow's tenant,
-- and a route must point at exactly one step of the same workflow or one
-- workflow of the same tenant. Malformed or cross-tenant rows stay hidden.
-- Whether a profile belongs to a tenant, read without the caller's directory visibility
-- (a viewer must see a step's named assignee even if that person is outside their own
-- directory scope). Answers only for the caller's own tenant.
create function fms_profile_in_tenant(p_profile_id uuid, p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_tenant_id = current_tenant_id()
    and exists (select 1 from user_profiles u where u.id = p_profile_id and u.tenant_id = p_tenant_id);
$$;
revoke all on function fms_profile_in_tenant(uuid, uuid) from public, anon;
grant execute on function fms_profile_in_tenant(uuid, uuid) to authenticated;

drop policy fms_stage_assignees_granted_select on fms_stage_assignees;
create policy fms_stage_assignees_granted_select on fms_stage_assignees for select to authenticated using (
  exists (select 1 from fms_stages s join fms_flows f on f.id = s.fms_flow_id
          where s.id = fms_stage_assignees.fms_stage_id and f.tenant_id = (select current_tenant_id())
            and fms_my_flow_access(f.family_id) is not null
            and ((fms_stage_assignees.assignee_type = 'specific_user' and fms_stage_assignees.user_profile_id is not null
                  and fms_profile_in_tenant(fms_stage_assignees.user_profile_id, f.tenant_id))
              or (fms_stage_assignees.assignee_type <> 'specific_user' and fms_stage_assignees.user_profile_id is null)))
);
drop policy fms_branch_rules_granted_select on fms_branch_rules;
create policy fms_branch_rules_granted_select on fms_branch_rules for select to authenticated using (
  ((fms_branch_rules.next_stage_id is not null)::int + (fms_branch_rules.next_flow_id is not null)::int) = 1
  and exists (select 1 from fms_stages s join fms_flows f on f.id = s.fms_flow_id
          where s.id = fms_branch_rules.fms_stage_id and f.tenant_id = (select current_tenant_id())
            and fms_my_flow_access(f.family_id) is not null
            and ((fms_branch_rules.next_stage_id is not null
                  and exists (select 1 from fms_stages t where t.id = fms_branch_rules.next_stage_id and t.fms_flow_id = f.id))
              or (fms_branch_rules.next_flow_id is not null
                  and exists (select 1 from fms_flows t where t.id = fms_branch_rules.next_flow_id and t.tenant_id = f.tenant_id))))
);

-- ---------------------------------------------------------------------------
-- 3. Forms: forms.view_designs reads what forms.manage reads
--    (the body is patched in place; later migrations rewrote it the same way)
-- ---------------------------------------------------------------------------
do $$
declare v_body text; v_new text;
begin
  select replace(pg_get_functiondef('public.can_access_form_template(uuid)'::regprocedure), E'\r\n', E'\n') into v_body;
  v_new := v_body;
  v_new := replace(v_new,
    $o$((has_permission('forms.manage') or can_open_form_from_library(ft.id)) and org_definition_visible(ft.branch_id, ft.owner_franchise_group_id))$o$,
    $n$((has_permission('forms.manage') or has_permission('forms.view_designs') or can_open_form_from_library(ft.id)) and org_definition_visible(ft.branch_id, ft.owner_franchise_group_id))$n$);
  v_new := replace(v_new,
    $o$(ft.lifecycle='draft' and has_permission('forms.manage') and org_definition_visible(ft.branch_id, ft.owner_franchise_group_id))$o$,
    $n$(ft.lifecycle='draft' and (has_permission('forms.manage') or has_permission('forms.view_designs')) and org_definition_visible(ft.branch_id, ft.owner_franchise_group_id))$n$);
  v_new := replace(v_new,
    $o$(ft.lifecycle='archived' and can_manage_form_template(ft.id))$o$,
    $n$(ft.lifecycle='archived' and (can_manage_form_template(ft.id) or (has_permission('forms.view_designs') and org_definition_visible(ft.branch_id, ft.owner_franchise_group_id))))$n$);
  -- Each of the three rules must have been found exactly once.
  if position('forms.view_designs' in v_body) > 0
     or (length(v_new) - length(replace(v_new, 'forms.view_designs', ''))) / length('forms.view_designs') <> 3 then
    raise exception '0401: can_access_form_template did not match the expected text';
  end if;
  execute v_new;
end $$;

notify pgrst, 'reload schema';
