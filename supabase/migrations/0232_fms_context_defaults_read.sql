-- The web and native FMS builders read this configuration. 0115 added RLS but
-- omitted the SELECT grant, so every otherwise authorized builder load failed.
grant select on public.fms_context_assignee_defaults to authenticated;
create policy fms_context_assignee_defaults_module_access
on public.fms_context_assignee_defaults as restrictive for select to authenticated
using ((select public.current_profile_is_active()) and (select public.module_accessible('fms_builder')));
-- No direct INSERT/UPDATE/DELETE grant: mutations remain audited RPCs.
