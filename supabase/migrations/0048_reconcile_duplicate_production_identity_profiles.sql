-- Reconcile the duplicated seed cohorts behind the production identity mix-up.
-- Auth email changes are made by the service-role Admin API first; this RPC
-- atomically aligns profiles, access state, and the audit trail.
set search_path = public, extensions;

create or replace function reconcile_duplicate_production_identity_profiles()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_admin user_profiles;
  v_old_suganiya user_profiles;
  v_old_kumar user_profiles;
  v_suganiya user_profiles;
  v_kumar user_profiles;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;

  select * into v_admin from user_profiles where employee_code = 'MK-0001' and lower(email) = 'admin@mkjewels.local' and user_role = 'super_admin' for update;
  select * into v_old_suganiya from user_profiles where employee_code = 'MK0016' and lower(email) = 'mis@mkjewels.in' and user_role = 'super_admin' for update;
  select * into v_old_kumar from user_profiles where employee_code = 'MK0027' and lower(email) = 'suganiyamkjewels@gmail.com' for update;
  select * into v_suganiya from user_profiles where employee_code = 'MK0055' and lower(email) = 'suganiyaesaivanan01@gmail.com' for update;
  select * into v_kumar from user_profiles where employee_code = 'MK0084' and lower(email) = 'kumarchhablani@gmail.com' for update;

  if v_admin.id is null or v_old_suganiya.id is null or v_old_kumar.id is null or v_suganiya.id is null or v_kumar.id is null
    or v_admin.tenant_id <> v_old_suganiya.tenant_id or v_admin.tenant_id <> v_old_kumar.tenant_id
    or v_admin.tenant_id <> v_suganiya.tenant_id or v_admin.tenant_id <> v_kumar.tenant_id then
    raise exception 'Expected duplicate production profiles are not eligible for reconciliation' using errcode = '23514';
  end if;

  update user_profiles set email='retired-mk0016@mkjewels.invalid', official_email=null, user_role='staff', account_status='inactive', is_login_enabled=false, updated_by=v_admin.id, updated_at=now() where id=v_old_suganiya.id;
  update user_profiles set email='retired-mk0027@mkjewels.invalid', official_email=null, account_status='inactive', is_login_enabled=false, updated_by=v_admin.id, updated_at=now() where id=v_old_kumar.id;
  update user_profiles set email='mis@mkjewels.in', official_email='mis@mkjewels.in', updated_by=v_admin.id, updated_at=now() where id=v_admin.id;
  update user_profiles set email='suganiyamkjewels@gmail.com', official_email='suganiyamkjewels@gmail.com', updated_by=v_admin.id, updated_at=now() where id=v_suganiya.id;
  update user_profiles set email='kumarmkjewels@gmail.com', official_email='kumarmkjewels@gmail.com', updated_by=v_admin.id, updated_at=now() where id=v_kumar.id;

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values
    (v_admin.tenant_id,v_admin.id,'production_duplicate_account_retired','user_management',v_old_suganiya.id,jsonb_build_object('email',v_old_suganiya.email,'user_role',v_old_suganiya.user_role),jsonb_build_object('email','retired-mk0016@mkjewels.invalid','account_status','inactive')),
    (v_admin.tenant_id,v_admin.id,'production_duplicate_account_retired','user_management',v_old_kumar.id,jsonb_build_object('email',v_old_kumar.email,'user_role',v_old_kumar.user_role),jsonb_build_object('email','retired-mk0027@mkjewels.invalid','account_status','inactive')),
    (v_admin.tenant_id,v_admin.id,'production_super_admin_identity_repaired','user_management',v_admin.id,jsonb_build_object('email',v_admin.email),jsonb_build_object('email','mis@mkjewels.in','user_role','super_admin')),
    (v_admin.tenant_id,v_admin.id,'production_employee_login_repaired','user_management',v_suganiya.id,jsonb_build_object('email',v_suganiya.email),jsonb_build_object('email','suganiyamkjewels@gmail.com')),
    (v_admin.tenant_id,v_admin.id,'production_employee_login_repaired','user_management',v_kumar.id,jsonb_build_object('email',v_kumar.email),jsonb_build_object('email','kumarmkjewels@gmail.com'));
end;
$$;

revoke all on function reconcile_duplicate_production_identity_profiles() from public, anon, authenticated;
grant execute on function reconcile_duplicate_production_identity_profiles() to service_role;
notify pgrst, 'reload schema';
