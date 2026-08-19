-- Preserve the supplied personal contact email separately from the work-email
-- login, then reconcile the approved roster through one audited service RPC.
set search_path = public, extensions;

alter table user_profiles add column if not exists personal_email text;
alter table user_profiles drop constraint if exists user_profiles_personal_email_format;
alter table user_profiles add constraint user_profiles_personal_email_format
  check (personal_email is null or personal_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') not valid;

create or replace function apply_complete_authoritative_roster(p_roster jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare a user_profiles; r jsonb; old user_profiles; v_branch uuid; v_department uuid; v_designation uuid; v_role user_role; v_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if jsonb_typeof(p_roster) <> 'array' or jsonb_array_length(p_roster) = 0 then raise exception 'Roster must be a non-empty array' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_roster) x group by lower(btrim(x->>'profile_id')) having count(*) > 1)
    or exists (select 1 from jsonb_array_elements(p_roster) x group by lower(btrim(x->>'work_email')) having count(*) > 1) then
    raise exception 'Roster contains duplicate profiles or work emails' using errcode = '22023';
  end if;
  select * into a from user_profiles where user_role = 'super_admin' and account_status = 'active' and is_login_enabled for update;
  if a.id is null then raise exception 'Active Super Admin is required' using errcode = '42501'; end if;
  for r in select value from jsonb_array_elements(p_roster) loop
    if nullif(btrim(r->>'profile_id'),'') is null or nullif(btrim(r->>'employee_name'),'') is null or lower(btrim(r->>'work_email')) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception 'Roster identity or work email is invalid' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(r->>'personal_email','')),'') is not null and lower(btrim(r->>'personal_email')) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Personal email is invalid' using errcode = '22023'; end if;
    if jsonb_typeof(coalesce(r->'week_off','[]'::jsonb)) <> 'array' or exists(select 1 from jsonb_array_elements_text(coalesce(r->'week_off','[]'::jsonb)) d where lower(d) not in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')) then raise exception 'Week off is invalid' using errcode = '22023'; end if;
    select * into old from user_profiles where id = (r->>'profile_id')::uuid and tenant_id = a.tenant_id for update;
    if old.id is null then raise exception 'Roster profile is invalid' using errcode = '23503'; end if;
    select id into v_branch from branches where tenant_id = a.tenant_id and is_active and lower(name) = lower(btrim(r->>'branch'));
    select id into v_department from departments where tenant_id = a.tenant_id and is_active and lower(name) = lower(btrim(r->>'department')) and (branch_id is null or branch_id = v_branch);
    select id into v_designation from dropdown_masters where is_active and master_type = 'designation' and lower(label) = lower(btrim(r->>'designation')) and (tenant_id = a.tenant_id or tenant_id is null) limit 1;
    if v_branch is null or v_department is null or v_designation is null then raise exception 'Roster organization mapping is invalid' using errcode = '23503'; end if;
    v_role := case when old.id = a.id then 'super_admin'::user_role when upper(btrim(r->>'access_level')) = 'ADMIN' then 'admin'::user_role else 'staff'::user_role end;
    update user_profiles set employee_name = btrim(r->>'employee_name'), first_name = btrim(r->>'first_name'), last_name = nullif(btrim(coalesce(r->>'last_name','')),''), branch_id = v_branch, department_id = v_department, designation_id = v_designation, personal_mobile = nullif(btrim(coalesce(r->>'personal_mobile','')),''), official_mobile = nullif(btrim(coalesce(r->>'official_mobile','')),''), personal_email = nullif(lower(btrim(coalesce(r->>'personal_email',''))),''), email = lower(btrim(r->>'work_email')), official_email = lower(btrim(r->>'work_email')), week_off = array(select lower(value) from jsonb_array_elements_text(coalesce(r->'week_off','[]'::jsonb))), user_role = v_role, account_status = 'active', working_status = 'active', is_login_enabled = true, updated_by = a.id, updated_at = now() where id = old.id;
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value) values (a.tenant_id, a.id, 'authoritative_roster_reconciled', 'user_management', old.id, to_jsonb(old), (select to_jsonb(p) from user_profiles p where p.id = old.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function apply_complete_authoritative_roster(jsonb) from public, anon, authenticated;
grant execute on function apply_complete_authoritative_roster(jsonb) to service_role;
notify pgrst, 'reload schema';
