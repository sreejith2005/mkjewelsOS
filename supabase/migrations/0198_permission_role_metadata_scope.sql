-- Permission choices belong to JewelOS, even when another schema has a
-- user_role enum. Preserve the existing authorization, tenant scope and grants.
create or replace function public.get_permission_admin_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a user_profiles;
begin
  a := assert_reporting_actor();
  if not has_permission('permissions.manage') then raise exception 'Permission management denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'catalog', (select jsonb_agg(jsonb_build_object('key', c.key, 'kind', c.kind, 'page_id', c.page_id, 'default_roles', to_jsonb(c.default_roles)) order by c.sort_order) from permission_catalog c),
    'roles', to_jsonb(enum_range(null::public.user_role)),
    'role_permissions', coalesce((select jsonb_agg(jsonb_build_object('role', r.user_role, 'key', r.permission_key, 'allowed', r.is_allowed)) from role_permissions r where r.tenant_id = a.tenant_id), '[]'::jsonb),
    'designations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'value', d.value) order by d.sort_order, d.label)
      from dropdown_masters d where d.master_type = 'designation' and d.is_active and (d.tenant_id = a.tenant_id or d.tenant_id is null)), '[]'::jsonb),
    'designation_overrides', coalesce((select jsonb_agg(jsonb_build_object('designation_id', o.designation_id, 'key', o.permission_key, 'effect', o.effect))
      from designation_permission_overrides o where o.tenant_id = a.tenant_id), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'employee_name', p.employee_name, 'employee_code', p.employee_code, 'user_role', p.user_role,
        'designation_id', p.designation_id, 'account_status', p.account_status, 'dashboard_authority', ua.dashboard_authority,
        'override_count', (select count(*) from user_permission_overrides o where o.user_profile_id = p.id)
      ) order by p.employee_name)
      from user_profiles p left join user_access_profiles ua on ua.user_profile_id = p.id
      where p.tenant_id = a.tenant_id), '[]'::jsonb)
  );
end $$;
