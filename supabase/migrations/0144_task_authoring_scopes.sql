-- Manual Tasks are available to all active users. The legacy protected RPC
-- remains the transaction/audit owner; this forward correction broadens its
-- authorization only for an actor's own department or Process Coordinators.
set search_path=public,extensions;

do $scope$
declare v_definition text;
begin
  select pg_get_functiondef('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)'::regprocedure)
    into v_definition;
  v_definition := replace(v_definition,$old$or v_actor.user_role not in ('super_admin', 'admin', 'manager') then$old$,$new$or (
      v_actor.user_role not in ('super_admin', 'admin', 'manager')
      and not exists (select 1 from dropdown_masters designation where designation.id = v_actor.designation_id and designation.master_type = 'designation' and designation.is_active and (designation.tenant_id = v_actor.tenant_id or designation.tenant_id is null) and lower(designation.value) = 'process_coordinator')
      and not (coalesce(nullif(p_payload->>'branch_id', '')::uuid, v_actor.branch_id) = v_actor.branch_id and coalesce(nullif(p_payload->>'department_id', '')::uuid, v_actor.department_id) = v_actor.department_id and not exists (select 1 from unnest(coalesce(p_doer_ids, '{}'::uuid[]) || coalesce(p_watcher_ids, '{}'::uuid[])) requested(id) where not exists (select 1 from user_profiles participant where participant.id = requested.id and participant.tenant_id = v_actor.tenant_id and participant.branch_id = v_actor.branch_id and participant.department_id = v_actor.department_id and participant.working_status = 'active')))
    ) then$new$);
  if position('process_coordinator' in v_definition) = 0 then raise exception 'Task authoring authorization contract could not be upgraded'; end if;
  execute v_definition;
end $scope$;

revoke all on function public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb) from public,anon;
grant execute on function public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb) to authenticated;
notify pgrst,'reload schema';
