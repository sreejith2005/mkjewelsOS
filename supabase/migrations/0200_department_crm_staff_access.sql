-- Department rules and membership changes affect CRM provisioning as well as menus.
-- Depends on 0199. No CRM customer data or historical identity is changed.
set search_path=public,extensions;

create or replace function crm_sync.user_profiles_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform crm_sync.enqueue_staff(old.id);
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.employee_name, new.email, new.user_role, new.branch_id, new.account_status,
          new.working_status, new.is_login_enabled, new.designation_id, new.department_id, new.tenant_id)
         is not distinct from
         (old.employee_name, old.email, old.user_role, old.branch_id, old.account_status,
          old.working_status, old.is_login_enabled, old.designation_id, old.department_id, old.tenant_id) then
    return null;
  end if;
  perform crm_sync.enqueue_staff(new.id);
  return null;
end
$$;

create or replace function crm_sync.staff_snapshot(p_profile_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_profile user_profiles;
  v_role user_role;
  v_crm_role text;
begin
  select * into v_profile from user_profiles where id = p_profile_id;
  if v_profile.id is null then
    return jsonb_build_object('jewelos_user_id', p_profile_id, 'present', false, 'eligible', false,
      'snapshot_at', clock_timestamp());
  end if;
  select coalesce((select a.dashboard_authority from user_access_profiles a where a.user_profile_id = v_profile.id),
    v_profile.user_role) into v_role;
  v_crm_role := case v_role
    when 'super_admin' then 'super_admin'
    when 'admin' then 'super_admin'
    when 'manager' then 'branch_manager'
    when 'crm' then 'salesperson'
    when 'staff' then 'salesperson'
    else 'salesperson'
  end;
  return jsonb_build_object(
    'jewelos_user_id', v_profile.id,
    'present', true,
    'tenant_id', v_profile.tenant_id,
    'name', btrim(v_profile.employee_name),
    'email', lower(btrim(v_profile.email)),
    'jewelos_role', v_role,
    'crm_role', v_crm_role,
    'jewelos_branch_id', v_profile.branch_id,
    'eligible', coalesce(v_profile.is_login_enabled, false)
      and v_profile.working_status <> 'resigned'
      and v_profile.account_status = 'active'
      and v_crm_role is not null
      and permission_effective_for(v_profile.id, 'crm.view'),
    'snapshot_at', clock_timestamp()
  );
end
$$;


create function crm_sync.department_access_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_old_id uuid; v_new_id uuid; v_old_tenant uuid; v_new_tenant uuid;
begin
  if tg_table_name='department_permission_overrides' then
    if tg_op<>'INSERT' and old.permission_key='crm.view' then v_old_id:=old.department_id; v_old_tenant:=old.tenant_id; end if;
    if tg_op<>'DELETE' and new.permission_key='crm.view' then v_new_id:=new.department_id; v_new_tenant:=new.tenant_id; end if;
  else
    if tg_op='UPDATE' and (new.is_active,new.tenant_id) is not distinct from (old.is_active,old.tenant_id) then return null; end if;
    if tg_op<>'INSERT' then v_old_id:=old.id; v_old_tenant:=old.tenant_id; end if;
    if tg_op<>'DELETE' then v_new_id:=new.id; v_new_tenant:=new.tenant_id; end if;
  end if;
  perform crm_sync.enqueue_staff(p.id) from public.user_profiles p
    where (p.department_id=v_old_id and p.tenant_id=v_old_tenant)
       or (p.department_id=v_new_id and p.tenant_id=v_new_tenant);
  return null;
end $$;
create trigger crm_sync_department_rule_changed after insert or update or delete on public.department_permission_overrides
  for each row execute function crm_sync.department_access_changed();
create trigger crm_sync_department_status_changed after update or delete on public.departments
  for each row execute function crm_sync.department_access_changed();
revoke all on function crm_sync.department_access_changed() from public,anon,authenticated,service_role;

-- The role fallback now admits any ordinary employee granted CRM. Queue existing
-- explicitly granted employees so their CRM identity is updated by the worker.
select crm_sync.enqueue_staff(p.id) from public.user_profiles p
  where p.user_role not in ('super_admin','admin','manager','crm','staff')
    and public.permission_effective_for(p.id,'crm.view');
