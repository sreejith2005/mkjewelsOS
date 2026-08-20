-- A legacy department can be shared (branch_id NULL). It is safe for a task
-- only when active employees in that department belong to the chosen branch.
do $repair$
declare v_definition text;
begin
  foreach v_definition in array array[
    pg_get_functiondef('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)'::regprocedure),
    pg_get_functiondef('public.save_task_template_with_audit(uuid,jsonb)'::regprocedure)
  ] loop
    v_definition := replace(v_definition, 'and d.branch_id = v_branch', $replacement$and (d.branch_id = v_branch or (
      d.branch_id is null and exists (
        select 1 from user_profiles scoped_profile
        where scoped_profile.tenant_id = v_actor.tenant_id
          and scoped_profile.branch_id = v_branch
          and scoped_profile.department_id = v_department
          and scoped_profile.working_status = 'active'
      )
    ))$replacement$);
    execute v_definition;
  end loop;
end $repair$;

notify pgrst, 'reload schema';
