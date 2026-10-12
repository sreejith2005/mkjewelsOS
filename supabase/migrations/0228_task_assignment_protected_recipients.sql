-- Granting assignment access does not grant authority over management.
set search_path=public,extensions;

create function public.task_assignment_recipient_allowed(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select current_profile_is_active() and exists(
    select 1 from user_profiles u cross join current_profile() a
    left join user_access_profiles access on access.user_profile_id=u.id
    where u.id=p_user_id and u.tenant_id=a.tenant_id and (
      u.id=a.id or a.user_role in ('super_admin','admin') or (
        u.user_role not in ('super_admin','admin','manager')
        and coalesce(access.dashboard_authority,u.user_role) not in ('super_admin','admin','manager')
        and not exists(select 1 from dropdown_masters d where d.id=u.designation_id
          and d.master_type='designation' and (d.tenant_id=u.tenant_id or d.tenant_id is null)
          and (lower(d.label) ~ '(^|[^a-z])(director|owner)([^a-z]|$)'
            or lower(d.value) ~ '(^|[^a-z])(director|owner)([^a-z]|$)'))
      )
    )
  );
$$;
revoke all on function task_assignment_recipient_allowed(uuid) from public,anon,authenticated,service_role;

do $recipients$
declare f text; n text;
begin
  f:=pg_get_functiondef('public.list_task_assignment_users()'::regprocedure);
  n:=replace(f,'and task_assignment_user_in_scope(u.id)',
    'and task_assignment_user_in_scope(u.id) and task_assignment_recipient_allowed(u.id)');
  if n=f then raise exception 'Assignment roster boundary changed'; end if;
  execute n;

  f:=pg_get_functiondef('public.assert_task_assignment_targets(uuid[],uuid[])'::regprocedure);
  n:=replace(f,'  if exists(select 1 from unnest(coalesce(p_doer_ids',
    $guard$  if exists(select 1 from unnest(coalesce(p_doer_ids,'{}')) requested(id)
    where not task_assignment_recipient_allowed(id)) then
    raise exception 'Assigning tasks to management accounts is denied' using errcode='42501';
  end if;
  if exists(select 1 from unnest(coalesce(p_doer_ids$guard$);
  if n=f then raise exception 'Assignment write boundary changed'; end if;
  execute n;

  f:=pg_get_functiondef('public.assert_task_assignment_rule(text,uuid)'::regprocedure);
  n:=replace(f,E'\nend',E'\n  if p_type=''specific_user'' and not task_assignment_recipient_allowed(p_user_id) then\n    raise exception ''Assigning tasks to management accounts is denied'' using errcode=''42501'';\n  end if;\nend');
  if n=f then raise exception 'Assignment rule boundary changed'; end if;
  execute n;

  f:=pg_get_functiondef('public.save_task_template_with_audit(uuid,jsonb)'::regprocedure);
  n:=replace(f,'perform assert_task_assignment_rule(v_assignee_type,v_assignee_user);',
    $guard$perform assert_task_assignment_rule(v_assignee_type,v_assignee_user);
    if v_assignee_type='role' then
      perform assert_task_assignment_rule('specific_user',u.id) from user_profiles u
      where u.tenant_id=v_actor.tenant_id and u.user_role=v_assignee_role
        and u.working_status='active' and (v_branch is null or u.branch_id=v_branch)
        and (v_department is null or u.department_id=v_department);
    end if;$guard$);
  if n=f then raise exception 'Schedule rule boundary changed'; end if;
  execute n;

  f:=pg_get_functiondef('public.run_recurring_todo_template_now_with_audit(uuid,date)'::regprocedure);
  n:=replace(f,'  v_task_id:=create_recurring_todo_instance',
    $guard$  perform assert_task_assignment_rule('specific_user',assigned.id) from unnest(v_assignees) assigned(id);
  v_task_id:=create_recurring_todo_instance$guard$);
  if n=f then raise exception 'Manual recurring boundary changed'; end if;
  execute n;
end $recipients$;
notify pgrst,'reload schema';
