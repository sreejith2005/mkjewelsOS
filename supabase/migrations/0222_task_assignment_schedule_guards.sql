-- Close alternate human assignment paths without changing scheduled system work.
set search_path=public,extensions;

create function public.assert_task_assignment_rule(p_type text,p_user_id uuid)
returns void language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();
begin
  if a.id is null or not current_profile_is_active() then
    raise exception 'Active task author is required' using errcode='42501';
  end if;
  if not has_permission('tasks.assign_others')
    and (p_type is distinct from 'specific_user' or p_user_id is distinct from a.id) then
    raise exception 'Assigning tasks to other users is denied' using errcode='42501';
  end if;
end $$;

do $schedule$
declare f text; n text;
begin
  f:=pg_get_functiondef('public.save_task_template_with_audit(uuid,jsonb)'::regprocedure);
  f:=replace(f,E'\r\n',E'\n');
  n:=replace(f,E'  if p_template_id is null then\n    insert into task_templates',
    E'  if p_template_id is null then\n    perform assert_task_assignment_rule(v_assignee_type,v_assignee_user);\n    insert into task_templates');
  if n=f then raise exception 'New schedule assignment guard upgrade failed'; end if;
  f:=n;
  n:=replace(f,'    update task_templates set',
    $guard$    if row(v_old.default_assignee_type,v_old.default_assignee_user_id,v_old.default_assignee_role,v_old.branch_id,v_old.department_id)
      is distinct from row(v_assignee_type,v_assignee_user,v_assignee_role,v_branch,v_department)
      or (not v_old.is_active and coalesce((p_payload->>'is_active')::boolean,true)) then
      perform assert_task_assignment_rule(v_assignee_type,v_assignee_user);
    end if;
    update task_templates set$guard$);
  if n=f then raise exception 'Schedule reassignment guard upgrade failed'; end if;
  execute n;
  f:=pg_get_functiondef('public.use_task_template_with_audit(uuid,timestamptz)'::regprocedure);
  f:=replace(f,E'\r\n',E'\n');
  n:=replace(f,E'  loop\n    insert into task_assignees',
    E'  loop\n    perform assert_task_assignment_rule(''specific_user'',v_assignee);\n    insert into task_assignees');
  if n=f then raise exception 'Template use assignment guard upgrade failed'; end if;
  execute n;
end $schedule$;

revoke all on function assert_task_assignment_rule(text,uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
