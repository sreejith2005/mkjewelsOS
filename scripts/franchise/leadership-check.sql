-- Read-only leadership check for migration 0397 (Super Admin / Admin / Director).
-- Prints leadership accounts (staff names only, no customer data), what each
-- Director oversees, and any override that still gives an Admin or Director a
-- capability the owner withdrew. Run by or in front of the owner, for example:
--   supabase.cmd db query --linked -f scripts/franchise/leadership-check.sql
-- Confirm the project ref first. This file contains no writes.
with leaders as (
  select p.id, p.employee_name, p.user_role::text as role, ua.dashboard_authority::text as authority,
         b.name as home_store, d.name as department, dm.label as designation, p.account_status::text as status
  from public.user_profiles p
  left join public.user_access_profiles ua on ua.user_profile_id = p.id
  left join public.branches b on b.id = p.branch_id
  left join public.departments d on d.id = p.department_id
  left join public.dropdown_masters dm on dm.id = p.designation_id
  where p.removed_at is null and coalesce(ua.dashboard_authority, p.user_role) in ('super_admin', 'admin')
)
select 'leader' as kind, l.employee_name as name,
       case when l.authority = 'super_admin' or l.role = 'super_admin' then 'Super Admin'
            when public.org_is_director(l.id) then 'Director' else 'Admin' end as position,
       l.home_store, l.department, l.designation, l.status,
       (select string_agg(coalesce(f.name, gb.name) || case when g.scope_level = 'branch' then ' (store)' else '' end, ', ' order by 1)
        from public.org_scope_grants g
        left join public.franchise_groups f on f.id = g.franchise_group_id
        left join public.branches gb on gb.id = g.branch_id
        where g.user_profile_id = l.id and g.revoked_at is null and g.authority = 'director') as oversees
from leaders l
union all
select 'user override', p.employee_name, o.permission_key, null, null, null, o.effect, null
from public.user_permission_overrides o join public.user_profiles p on p.id = o.user_profile_id
left join public.user_access_profiles ua on ua.user_profile_id = p.id
where o.effect = 'grant' and coalesce(ua.dashboard_authority, p.user_role) = 'admin'
  and o.permission_key in ('fms.manage', 'forms.manage', 'notifications.manage', 'settings.manage_organization',
    'settings.manage_branch', 'recording.manage_rubric', 'tasks.delete', 'users.delete')
union all
select 'designation override', dm.label, o.permission_key, null, null, null, o.effect, null
from public.designation_permission_overrides o join public.dropdown_masters dm on dm.id = o.designation_id
where o.effect = 'grant' and o.permission_key in ('fms.manage', 'forms.manage', 'notifications.manage', 'settings.manage_organization',
    'settings.manage_branch', 'recording.manage_rubric', 'tasks.delete', 'users.delete')
union all
select 'isolation', case when coalesce((select bool_or(enforcement_enabled) from public.tenant_franchise_controls), false) then 'On' else 'Off' end,
       null, null, null, null, null, null
order by 1, 3, 2;
