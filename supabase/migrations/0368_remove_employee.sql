-- A Super Admin can delete any employee, including one with work history.
-- The person is removed: login switched off for good, personal details wiped,
-- and the profile hidden from Users. Tasks, FMS steps, form answers and CRM
-- records they touched stay intact and show "Removed employee", because 120+
-- foreign keys across the schema keep that history valid. The delete-user Edge
-- Function calls this, then locks and scrubs the Supabase Auth login.
set search_path = public, extensions;

alter table user_profiles add column if not exists removed_at timestamptz;
alter table user_profiles add column if not exists removed_by uuid references user_profiles(id);
comment on column user_profiles.removed_at is 'Set when a Super Admin deleted this employee. The row stays only so past work keeps its links; it is hidden from Users.';

create or replace function remove_employee_with_audit(p_profile_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_target user_profiles; v_ref user_profiles; v_new user_profiles;
begin
  v_actor := current_profile();
  if v_actor.id is null or not current_profile_is_active() or not has_permission('users.delete') then
    raise exception 'Only a Super Admin can delete users' using errcode = '42501';
  end if;
  select * into v_target from user_profiles where id = p_profile_id for update;
  if v_target.id is null or v_target.tenant_id <> v_actor.tenant_id then raise exception 'User not found' using errcode = '42501'; end if;
  if v_target.id = v_actor.id then raise exception 'You cannot delete your own account' using errcode = '22023'; end if;
  if v_target.removed_at is not null then return v_target.auth_user_id; end if;

  -- Clear the links other people have to this employee, as the roster leaver path does.
  for v_ref in select * from user_profiles where (reports_to_user_id = v_target.id or buddy_id = v_target.id or secondary_buddy_id = v_target.id) and id <> v_target.id for update loop
    update user_profiles set
      reports_to_user_id = case when reports_to_user_id = v_target.id then null else reports_to_user_id end,
      buddy_id = case when buddy_id = v_target.id then null else buddy_id end,
      secondary_buddy_id = case when secondary_buddy_id = v_target.id then null else secondary_buddy_id end,
      updated_by = v_actor.id, updated_at = now()
    where id = v_ref.id returning * into v_new;
    if v_ref.reports_to_user_id is distinct from v_new.reports_to_user_id then
      insert into user_organization_history(tenant_id,user_profile_id,old_branch_id,new_branch_id,old_department_id,new_department_id,
        old_designation_id,new_designation_id,old_reports_to_user_id,new_reports_to_user_id,changed_by)
      values(v_new.tenant_id,v_new.id,v_ref.branch_id,v_new.branch_id,v_ref.department_id,v_new.department_id,
        v_ref.designation_id,v_new.designation_id,v_ref.reports_to_user_id,v_new.reports_to_user_id,v_actor.id);
    end if;
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(v_ref.tenant_id,v_actor.id,'removed_user_links_cleared','user_management',v_ref.id,
      jsonb_build_object('reports_to_user_id',v_ref.reports_to_user_id,'buddy_id',v_ref.buddy_id,'secondary_buddy_id',v_ref.secondary_buddy_id),
      jsonb_build_object('reports_to_user_id',v_new.reports_to_user_id,'buddy_id',v_new.buddy_id,'secondary_buddy_id',v_new.secondary_buddy_id,'removed_profile_id',v_target.id));
  end loop;
  update branches set manager_id = null where manager_id = v_target.id;
  update departments set head_id = null where head_id = v_target.id;

  update user_profiles set
    employee_name = 'Removed employee', first_name = null, last_name = null,
    email = 'removed-' || id::text || '@removed.invalid', official_email = null, personal_email = null,
    personal_mobile = null, official_mobile = null, username = null,
    reports_to_user_id = null, buddy_id = null, secondary_buddy_id = null,
    account_status = 'left', working_status = 'resigned', is_login_enabled = false,
    removed_at = now(), removed_by = v_actor.id, updated_by = v_actor.id, updated_at = now()
  where id = v_target.id;

  -- The audit row keeps who was removed so the action stays accountable.
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_target.tenant_id,v_actor.id,'user_removed','user_management',v_target.id,
    jsonb_build_object('employee_name',v_target.employee_name,'employee_code',v_target.employee_code,
      'account_status',v_target.account_status,'working_status',v_target.working_status),
    jsonb_build_object('removed',true,'personal_details_wiped',true));
  return v_target.auth_user_id;
end $$;

revoke all on function remove_employee_with_audit(uuid) from public, anon;
grant execute on function remove_employee_with_audit(uuid) to authenticated;
notify pgrst, 'reload schema';
