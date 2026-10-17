set search_path=public,extensions;

-- One protected-role predicate is shared by schedule and FMS configuration.
-- A role that has no employees today must not bypass future-recipient rules.
create function assert_task_assignment_role(p_role user_role) returns void
language plpgsql stable security definer set search_path=public as $$
declare actor user_profiles:=current_profile();
begin
  perform assert_task_assignment_rule('role',null);
  if actor.user_role not in ('super_admin','admin') and p_role in ('super_admin','admin','manager') then
    raise exception 'Assigning tasks to management accounts is denied' using errcode='42501';
  end if;
end $$;
do $$
declare f text; n text;
begin
  f:=pg_get_functiondef('save_task_template_with_audit(uuid,jsonb)'::regprocedure);
  n:=replace(f,$old$if v_actor.user_role not in ('super_admin','admin') and v_assignee_role in ('super_admin','admin','manager') then
        raise exception 'Assigning tasks to management accounts is denied' using errcode='42501';
      end if;$old$,'perform assert_task_assignment_role(v_assignee_role);');
  if n=f then raise exception 'Shared protected-role schedule boundary changed'; end if; execute n;
end $$;

alter function assert_fms_assignment_publishable(uuid) rename to assert_fms_assignment_publishable_before_hierarchy;
create function assert_fms_assignment_publishable(p_flow_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare flow fms_flows; stage fms_stages; rule fms_stage_assignees; person uuid;
begin
  perform assert_fms_assignment_publishable_before_hierarchy(p_flow_id);
  select * into flow from fms_flows where id=p_flow_id;
  if flow.assignment_version<>2 then return; end if;
  for stage in select * from fms_stages where fms_flow_id=flow.id and planned_time_rule#>>'{assignment,mode}'='hierarchy' loop
    for rule in select * from fms_stage_assignees where fms_stage_id=stage.id loop
      if rule.assignee_type='role' then
        perform assert_task_assignment_role(rule.role_value);
        for person in select id from user_profiles where tenant_id=flow.tenant_id and user_role=rule.role_value
          and account_status='active' and working_status='active' and is_login_enabled
          and (flow.branch_id is null or branch_id=flow.branch_id) and (flow.department_id is null or department_id=flow.department_id) loop
          perform assert_fms_handoff_recipient(person,flow.tenant_id,true);
        end loop;
      elsif rule.assignee_type in ('manager','department_head') then
        perform assert_task_assignment_role('manager');
        if rule.assignee_type='department_head' then
          for person in select head_id from departments where tenant_id=flow.tenant_id and head_id is not null and (flow.department_id is null or id=flow.department_id) loop
            perform assert_fms_handoff_recipient(person,flow.tenant_id,true);
          end loop;
        end if;
      elsif rule.assignee_type not in ('specific_user') then
        raise exception 'Choose Previous Stage Employee or an explicit fallback for step %',stage.name using errcode='23514';
      end if;
    end loop;
  end loop;
end $$;
revoke all on function assert_task_assignment_role(user_role),assert_fms_assignment_publishable(uuid),assert_fms_assignment_publishable_before_hierarchy(uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
