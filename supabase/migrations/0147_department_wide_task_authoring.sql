-- Normal task authors may assign within their department across branches. The
-- protected RPC remains the authority: tenant and department checks continue
-- to constrain both task scope and every selected participant.
set search_path=public,extensions;

do $scope$
declare v_definition text;
begin
  select pg_get_functiondef('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)'::regprocedure)
    into v_definition;
  v_definition := replace(
    v_definition,
    $old$coalesce(nullif(p_payload->>'branch_id', '')::uuid, v_actor.branch_id) = v_actor.branch_id and $old$,
    ''
  );
  v_definition := replace(v_definition, ' and participant.branch_id = v_actor.branch_id', '');
  if position('participant.department_id = v_actor.department_id' in v_definition) = 0
    or position('participant.branch_id = v_actor.branch_id' in v_definition) > 0 then
    raise exception 'Task authoring department scope could not be upgraded';
  end if;
  execute v_definition;
end $scope$;

notify pgrst,'reload schema';
