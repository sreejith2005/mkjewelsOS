-- Assigned work retains its pinned definition when a flow version is archived
-- or the employee belongs to another branch. Existing row policies still guard
-- the assignment/instance; this adds definition reads, never authoring rights.
set search_path=public,extensions;
create policy fms_flow_assigned_work_select on public.fms_flows
for select to authenticated using (
  (select public.current_profile_is_active())
  and tenant_id=(select public.current_tenant_id())
  and (select public.module_accessible('fms',false))
  and (
    exists(select 1 from public.fms_instances i where i.fms_flow_id=fms_flows.id)
    or exists(select 1 from public.fms_starter_assignments a
      where a.fms_flow_id=fms_flows.id and a.status='pending'
        and a.user_profile_id=(select (public.current_profile()).id))
  )
);

-- The invoker view emits no row for an empty assigned_to array. Do not count
-- those placeholders, or a starter hidden by its own assignment SELECT policy.
do $migration$
declare original text; amended text;
begin
  original:=pg_get_functiondef('public.task_feed_page(text,text,integer,integer)'::regprocedure);
  amended:=replace(original,
    'where i.tenant_id=v_actor.tenant_id and public.module_accessible(''fms'',false)',
    'where i.tenant_id=v_actor.tenant_id and cardinality(s.assigned_to)>0 and public.module_accessible(''fms'',false)');
  amended:=replace(amended,
    '(v_admin or s.user_profile_id=v_actor.id or s.assigned_by=v_actor.id)',
    '(v_admin or s.user_profile_id=v_actor.id)');
  if amended=original or position('cardinality(s.assigned_to)>0' in amended)=0
    or position('or s.assigned_by=v_actor.id' in amended)>0 then
    raise exception 'Review task page visibility migration against current definition';
  end if;
  execute amended;
end;
$migration$;
