-- Enforce account deactivation at the database permission boundary. A valid
-- Supabase session is not sufficient when the matching profile is disabled or
-- resigned.

set search_path = public, extensions;

create or replace function current_profile_is_active()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select is_login_enabled is true and working_status <> 'resigned'
    from user_profiles
    where auth_user_id = auth.uid()
    limit 1
  ), false);
$$;

alter policy up_select on user_profiles
  using (
    (select current_profile_is_active())
    and (
      auth_user_id = auth.uid()
      or is_super_admin()
      or (
        tenant_id = current_tenant_id()
        and current_role_level() in ('admin', 'manager', 'hr')
      )
    )
  );

alter policy tenants_select on tenants
  using (
    (select current_profile_is_active())
    and (id = current_tenant_id() or is_super_admin())
  );

alter policy branches_select on branches
  using (
    (select current_profile_is_active())
    and (tenant_id = current_tenant_id() or is_super_admin())
  );

alter policy departments_select on departments
  using (
    (select current_profile_is_active())
    and (tenant_id = current_tenant_id() or is_super_admin())
  );

alter policy resignations_select on resignations
  using (
    (select current_profile_is_active())
    and (
      is_super_admin()
      or (
        tenant_id = current_tenant_id()
        and current_role_level() in ('admin', 'manager', 'hr')
      )
    )
  );

alter policy audit_logs_select on audit_logs
  using (
    (select current_profile_is_active())
    and tenant_id = current_tenant_id()
    and current_role_level() in ('super_admin', 'admin')
  );

alter policy ti_tenant_isolation on task_instances
  using (
    (select current_profile_is_active())
    and (tenant_id = current_tenant_id() or is_super_admin())
  );

alter policy ti_write on task_instances
  with check (
    (select current_profile_is_active())
    and (tenant_id = current_tenant_id() or is_super_admin())
  );

alter policy ti_update on task_instances
  using (
    (select current_profile_is_active())
    and (tenant_id = current_tenant_id() or is_super_admin())
  )
  with check (
    (select current_profile_is_active())
    and (tenant_id = current_tenant_id() or is_super_admin())
  );

alter policy flow_select on fms_flows
  using (
    (select current_profile_is_active())
    and (tenant_id = current_tenant_id() or is_super_admin())
  );

alter policy flow_insert on fms_flows
  with check (
    (select current_profile_is_active())
    and tenant_id = current_tenant_id()
    and current_role_level() in ('super_admin', 'admin')
  );

alter policy flow_update on fms_flows
  using (
    (select current_profile_is_active())
    and (
      is_super_admin()
      or (
        current_role_level() = 'admin'
        and status = 'draft'
        and created_by = current_profile()::text::uuid
      )
    )
  )
  with check (
    (select current_profile_is_active())
    and (
      is_super_admin()
      or (
        current_role_level() = 'admin'
        and status = 'draft'
        and created_by = current_profile()::text::uuid
      )
    )
  );

alter policy flow_delete on fms_flows
  using ((select current_profile_is_active()) and is_super_admin());

alter policy dm_select on dropdown_masters
  using (
    (select current_profile_is_active())
    and (tenant_id = current_tenant_id() or tenant_id is null or is_super_admin())
  );

alter policy clients_select on clients
  using (
    (select current_profile_is_active())
    and (
      is_super_admin()
      or (
        tenant_id = current_tenant_id()
        and (
          current_role_level() in ('super_admin', 'admin', 'manager')
          or branch_id = current_branch_id()
        )
      )
    )
  );
