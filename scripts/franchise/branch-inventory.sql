-- Read-only branch inventory for the franchise mapping (migration 0385).
-- Prints organisation rows and counts only: no customer data, no personal data.
-- Run by or in front of the owner (production playbook), for example:
--   supabase.cmd db query --linked -f scripts/franchise/branch-inventory.sql
-- Confirm the project ref first. This file contains no writes.
select b.code,
       b.name,
       b.city,
       b.state,
       b.is_active,
       b.location_kind,
       f.name as franchise,
       (select count(*) from public.user_profiles u where u.branch_id = b.id and u.account_status = 'active' and u.removed_at is null) as active_employees,
       (select count(*) from public.departments d where d.branch_id = b.id and d.is_active) as branch_departments,
       (select count(*) from public.task_instances t where t.branch_id = b.id) as tasks,
       (select count(*) from public.fms_instances i where i.branch_id = b.id) as fms_runs,
       (select count(*) from public.form_submissions s where s.branch_id = b.id) as form_submissions,
       (b.manager_id is not null) as has_manager
from public.branches b
left join public.franchise_groups f on f.id = b.franchise_group_id
order by b.is_active desc, b.city nulls last, b.name;
