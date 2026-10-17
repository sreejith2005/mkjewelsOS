set search_path=public,extensions;
create function get_fms_task_contexts(p_visit_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare work record; result jsonb:='{}'; context jsonb;
begin
  perform assert_module_enabled('fms_builder');
  if not current_profile_is_active() then raise exception 'Active employee required' using errcode='42501'; end if;
  if p_visit_ids is null or cardinality(p_visit_ids)>100 then raise exception 'Request at most 100 workflow work contexts' using errcode='22023'; end if;
  for work in select id,fms_instance_id from fms_instance_stages where id=any(p_visit_ids) and can_read_fms_work_context(id) loop
    context:=get_fms_assigned_work_context(work.fms_instance_id,work.id,null,1);
    -- Cards never need the journey; its separately paginated read belongs to
    -- the full work screen. The same projection controls both surfaces.
    context:=context||jsonb_build_object('journey','[]'::jsonb,'nextCursor',null);
    result:=result||jsonb_build_object(work.id::text,context);
  end loop;
  return result;
end $$;
revoke all on function get_fms_task_contexts(uuid[]) from public,anon,authenticated,service_role;
grant execute on function get_fms_task_contexts(uuid[]) to authenticated;
notify pgrst,'reload schema';
