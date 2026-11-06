-- 0388: direct reads of recording rows follow the same active-employment rule as
-- the recording RPCs.
--
-- recorder_actor() (the gate of every recording RPC since 0377) requires
-- working_status = 'active'. The RLS read policies on recorder_sessions and
-- recorder_devices, and through them recorder_segments and recorder_alerts, use
-- recorder_can_read(), which applied only the platform-wide
-- current_profile_is_active() (login on, account active, not resigned). A reviewer
-- of the branch who was 'inactive', 'on_leave' or 'half_day' could therefore read
-- those rows with a direct table select while every recording RPC refused them.
--
-- Every RPC that calls recorder_can_read() has already passed recorder_actor(), so
-- this changes direct reads only. Same signature, owner, grants and search_path.
-- No data is changed and no table, policy or type is added.
create or replace function recorder_can_read(p_employee uuid,p_tenant uuid,p_branch uuid) returns boolean language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); begin
 return coalesce(a.id is not null and current_profile_is_active() and a.working_status='active' and module_accessible('sales_recording') and a.tenant_id=p_tenant and a.branch_id=p_branch and
 (a.id=p_employee or (a.user_role in ('super_admin','admin','manager') and has_permission('recording.review'))),false);
end $$;
