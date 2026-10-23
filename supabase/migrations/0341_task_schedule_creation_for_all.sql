-- Create Task is available to every active task author. Template management
-- remains restricted; new named-user schedules use the one-time assignment
-- boundary (permission overrides, scope, activity and protected recipients).
-- Existing signatures, validation, audit and historical work are preserved.
do $migration$
declare body text; changed text;
begin
  body := replace(pg_get_functiondef('public.save_task_template_with_audit(uuid,jsonb)'::regprocedure), E'\r\n', E'\n');
  changed := replace(body,
    $old$or v_actor.user_role not in ('super_admin', 'admin', 'manager') then$old$,
    $new$or ((p_template_id is not null or coalesce(p_payload->>'default_assignee_type','specific_user') <> 'specific_user')
       and v_actor.user_role not in ('super_admin', 'admin', 'manager')) then$new$);
  if changed=body then raise exception '0341: template management guard has drifted'; end if;
  body := changed;
  changed := regexp_replace(body,
    $old$  if p_template_id is null then[[:space:]]+perform assert_task_assignment_rule\(v_assignee_type,v_assignee_user\);$old$,
    $new$  if p_template_id is null then
    perform assert_module_access('checklist_tasks');
    if v_assignee_type='specific_user' then
      perform assert_task_assignment_targets(array[v_assignee_user]);
      -- Personal/department authors cannot manufacture a global template by
      -- omitting the assignee's organization fields. Coordinators and existing
      -- branch/tenant management paths keep their established scope behavior.
      if task_assignment_scope()='department' and not exists (
        select 1 from user_profiles u where u.id=v_assignee_user
          and u.branch_id is not distinct from v_branch
          and u.department_id is not distinct from v_department
      ) then
        raise exception 'Schedule scope must match the selected user' using errcode='42501';
      end if;
    end if;
    perform assert_task_assignment_rule(v_assignee_type,v_assignee_user);$new$);
  if changed=body then raise exception '0341: template creation guard has drifted'; end if;
  execute changed;

  body := replace(pg_get_functiondef('public.save_recurring_todo_template_with_audit(uuid,jsonb)'::regprocedure), E'\r\n', E'\n');
  changed := replace(body,
    $old$or v_actor.user_role not in ('super_admin','admin','manager') then$old$,
    $new$or ((p_template_id is not null or coalesce(p_payload->>'default_assignee_type','specific_user') <> 'specific_user')
    and v_actor.user_role not in ('super_admin','admin','manager')) then$new$);
  if changed=body then raise exception '0341: recurring management guard has drifted'; end if;
  -- Assert the actual Tasks section before validation or writes, even though
  -- the richer recurring save delegates the named-user assignment guard above.
  body := changed;
  changed := replace(body, $old$  if jsonb_typeof(p_payload)$old$,
    $new$  if p_template_id is null then perform assert_module_access('checklist_tasks'); end if;
  if jsonb_typeof(p_payload)$new$);
  if changed=body then raise exception '0341: recurring payload guard has drifted'; end if;
  execute changed;
end
$migration$;

notify pgrst, 'reload schema';
