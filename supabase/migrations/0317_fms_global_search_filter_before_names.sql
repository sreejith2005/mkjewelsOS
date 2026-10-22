-- Apply ordinary membership/date/priority/requirement filters before projecting
-- historical names. Status remains after search so cross-status counts retain
-- their established meaning. Broad membership survives an unavailable name.
set search_path=public,extensions;
do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('task_workspace_page(jsonb,integer,integer)'::regprocedure);
 amended:=regexp_replace(definition,
  'with authorized_name_work as materialized \([\s\S]*?\), ordinary as \(',
  'with ordinary as (');
 amended:=replace(amended,'(select record_name from record_names where work_id=s.id)','null::text');
 amended:=replace(amended,'), filtered as materialized (','), filtered_before_name as materialized (');
 amended:=replace(amended,'and (q='''' or strpos(lower(searchable),lower(q))>0)','');
 amended:=replace(amended,'), numbered as (', $patch$), authorized_name_work as materialized (
  select work.id from filtered_before_name candidate join fms_instance_stages work on work.id=candidate.id
  where q<>'' and fms_module_enabled and candidate.kind='fms' and can_read_fms_work_context(work.id)
 ), record_names as materialized (
  select * from fms_work_record_names_authorized(array(select id from authorized_name_work))
 ), filtered as materialized (
  select candidate.* from filtered_before_name candidate left join record_names on record_names.work_id=candidate.id
  where q='' or strpos(lower(concat_ws(' ',candidate.searchable,record_names.record_name)),lower(q))>0
 ), numbered as ($patch$);
 if amended=definition or position('with ordinary as (' in amended)=0
  or position('from filtered_before_name candidate join' in amended)=0
  or position('from filtered_before_name candidate left join' in amended)=0
  or position('and (q='''' or strpos(lower(searchable)' in amended)>0 then
  raise exception 'Review filtered authorized FMS naming input';
 end if;
 execute amended;
end $$;
notify pgrst,'reload schema';
