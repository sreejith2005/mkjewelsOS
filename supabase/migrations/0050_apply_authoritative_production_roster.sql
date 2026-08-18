-- Apply an approved production employee roster transactionally. Supabase Auth
-- emails are synchronized by the service-role Admin API immediately before
-- this function is called.
set search_path = public, extensions;

alter table user_profiles drop constraint if exists user_profiles_official_email_format;
alter table user_profiles add constraint user_profiles_official_email_format
  check (official_email is null or official_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') not valid;

create or replace function apply_authoritative_production_roster(p_roster jsonb, p_retire_profile_ids uuid[] default '{}')
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_actor user_profiles; v_row jsonb; v_target user_profiles; v_old user_profiles;
  v_branch uuid; v_department uuid; v_designation uuid; v_count integer := 0;
  v_email text; v_name text; v_phone text; v_official_phone text;
  v_retire_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if jsonb_typeof(p_roster) <> 'array' or jsonb_array_length(p_roster) = 0 then raise exception 'Roster must be a non-empty array' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_roster) x group by lower(btrim(x->>'work_email')) having count(*) > 1) then raise exception 'Roster contains duplicate work emails' using errcode = '22023'; end if;
  select * into v_actor from user_profiles where lower(email)='mis@mkjewels.in' and user_role='super_admin' and account_status='active' and is_login_enabled for update;
  if v_actor.id is null then raise exception 'Active production Super Admin is required' using errcode = '42501'; end if;

  foreach v_retire_id in array coalesce(p_retire_profile_ids,'{}') loop
    select * into v_old from user_profiles where id=v_retire_id and tenant_id=v_actor.tenant_id for update;
    if v_old.id is null then raise exception 'Retired profile is invalid' using errcode='23503'; end if;
    if v_old.id=v_actor.id then raise exception 'Super Admin cannot be retired' using errcode='23514'; end if;
    update user_profiles set account_status='inactive', is_login_enabled=false, updated_by=v_actor.id, updated_at=now() where id=v_old.id;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'production_duplicate_account_retired','user_management',v_old.id,jsonb_build_object('email',v_old.email,'account_status',v_old.account_status),jsonb_build_object('account_status','inactive'));
  end loop;

  for v_row in select value from jsonb_array_elements(p_roster) loop
    if nullif(v_row->>'profile_id','') is null then raise exception 'profile_id is required' using errcode='22023'; end if;
    v_email:=lower(btrim(v_row->>'work_email')); v_name:=btrim(v_row->>'employee_name'); v_phone:=nullif(btrim(v_row->>'personal_mobile'),''); v_official_phone:=nullif(btrim(v_row->>'official_mobile'),'');
    if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or v_name='' then raise exception 'Roster name or email is invalid' using errcode='22023'; end if;
    if v_phone is not null and v_phone !~ E'^\\+?[0-9][0-9 ()-]{7,19}$' then raise exception 'Personal mobile is invalid for %',v_name using errcode='22023'; end if;
    if v_official_phone is not null and v_official_phone !~ E'^\\+?[0-9][0-9 ()-]{7,19}$' then raise exception 'Official mobile is invalid for %',v_name using errcode='22023'; end if;
    select * into v_old from user_profiles where id=(v_row->>'profile_id')::uuid and tenant_id=v_actor.tenant_id for update;
    if v_old.id is null or v_old.id=any(coalesce(p_retire_profile_ids,'{}')) then raise exception 'Roster profile is invalid or retired' using errcode='23503'; end if;
    select id into v_branch from branches where tenant_id=v_actor.tenant_id and is_active and lower(name)=lower(btrim(v_row->>'branch'));
    select id into v_department from departments where tenant_id=v_actor.tenant_id and is_active and lower(name)=lower(btrim(v_row->>'department')) and (branch_id is null or branch_id=v_branch);
    select id into v_designation from dropdown_masters where is_active and master_type='designation' and lower(label)=lower(btrim(v_row->>'designation')) and (tenant_id=v_actor.tenant_id or tenant_id is null) limit 1;
    if v_branch is null or v_department is null or v_designation is null then raise exception 'Organization mapping is invalid for %',v_name using errcode='23503'; end if;
    update user_profiles set employee_name=v_name, branch_id=v_branch, department_id=v_department, designation_id=v_designation, personal_mobile=v_phone, official_mobile=v_official_phone, email=v_email, official_email=v_email, user_role=case when id=v_actor.id then 'super_admin'::user_role else 'staff'::user_role end, account_status='active', working_status='active', is_login_enabled=true, updated_by=v_actor.id, updated_at=now() where id=v_old.id returning * into v_target;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'production_roster_reconciled','user_management',v_target.id,to_jsonb(v_old),to_jsonb(v_target));
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

revoke all on function apply_authoritative_production_roster(jsonb,uuid[]) from public,anon,authenticated;
grant execute on function apply_authoritative_production_roster(jsonb,uuid[]) to service_role;
notify pgrst,'reload schema';
