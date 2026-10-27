set search_path=public,extensions;

-- 0349 (2026-10-26 owner request): the FMS runs board names each run (for
-- example the client) instead of repeating the workflow title. Read only.
-- A run's name is the record name of its latest visit, from the existing
-- naming projection. It is returned only for runs the caller started or
-- could read at least one visit of (can_read_fms_work_context); others get no row.

create function get_fms_run_names(p_instance_ids uuid[])
returns table(instance_id uuid,record_name text)
language plpgsql stable security definer set search_path=public as $$
begin
  perform assert_module_enabled('fms_builder');
  if not current_profile_is_active() then raise exception 'An active profile is required' using errcode='42501'; end if;
  if p_instance_ids is null or cardinality(p_instance_ids)>500 then raise exception 'Ask for at most 500 runs at a time' using errcode='22023'; end if;
  return query
    with requested as (select distinct id from unnest(p_instance_ids) id),
    allowed as (
      select i.id from requested r join fms_instances i on i.id=r.id cross join current_profile() actor
      where i.tenant_id=actor.tenant_id and (i.started_by=actor.id
        or exists(select 1 from fms_instance_stages work where work.fms_instance_id=i.id and can_read_fms_work_context(work.id)))
    ),
    latest as (
      select distinct on (work.fms_instance_id) work.fms_instance_id,work.id
      from fms_instance_stages work join allowed on allowed.id=work.fms_instance_id
      order by work.fms_instance_id,work.created_at desc,work.id desc
    )
    select latest.fms_instance_id,fms_work_record_name_authorized(latest.id) from latest;
end $$;

alter function get_fms_run_names(uuid[]) owner to postgres;
revoke all on function get_fms_run_names(uuid[]) from public,anon,authenticated,service_role;
grant execute on function get_fms_run_names(uuid[]) to authenticated;
notify pgrst,'reload schema';
