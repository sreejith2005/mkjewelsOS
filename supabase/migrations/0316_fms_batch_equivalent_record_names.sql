-- Naming is a read projection, not a record store. Reuse it only for destinations
-- with identical inputs under one actor/statement. Submitted destinations stay
-- distinct because excluding the destination itself can affect legacy context.
set search_path=public,extensions;
create function fms_work_record_names_authorized(p_work_ids uuid[])
returns table(work_id uuid,record_name text)
language sql stable security definer set search_path=public as $$
 with keys as materialized (
  select work.id,jsonb_build_array(work.fms_instance_id,work.fms_stage_id,
   work.execution_path,work.previous_instance_stage_id,
   case when work.form_submission_id is not null then work.id end) naming_key
  from fms_instance_stages work where work.id=any(p_work_ids)
 ), representatives as materialized (
  select naming_key,(array_agg(id order by id))[1] representative from keys group by naming_key
 ), names as materialized (
  select naming_key,fms_work_record_name_authorized(representative) name from representatives
 ) select keys.id,names.name from keys join names using(naming_key);
$$;
revoke all on function fms_work_record_names_authorized(uuid[]) from public,anon,authenticated,service_role;

do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('fms_workspace_rows(jsonb)'::regprocedure);
 amended:=replace(definition,'select * from work where',', selected as materialized (select * from work where');
 amended:=replace(amended,'and case when btrim(coalesce(p_filter->>''query'',''''))='''' then true else',
 $patch$), record_names as materialized (
  select * from fms_work_record_names_authorized(array(select id from selected
   where not starting and btrim(coalesce(p_filter->>'query',''))<>''))
 ) select selected.* from selected left join record_names on record_names.work_id=selected.id
 where case when btrim(coalesce(p_filter->>'query',''))='' then true else$patch$);
 amended:=replace(amended,'fms_work_record_name_authorized(id)','record_names.record_name');
 if amended=definition or position('selected as materialized' in amended)=0
  or position('where case when btrim' in amended)=0 then raise exception 'Review batched checked FMS search'; end if;
 execute amended;

 definition:=pg_get_functiondef('get_fms_task_stage_page(uuid,uuid,uuid,boolean,jsonb,integer,integer)'::regprocedure);
 amended:=replace(definition,'page as(select * from eligible','page as materialized(select * from eligible');
 amended:=replace(amended, 'select jsonb_build_object(''total''',
  ', record_names as materialized (select * from fms_work_record_names_authorized(array(select id from page where not starting)))
 select jsonb_build_object(''total''');
 amended:=replace(amended,'fms_work_record_name_authorized(id)','record_names.record_name');
 amended:=replace(amended,'into result from page;',
  'into result from page left join record_names on record_names.work_id=page.id;');
 if amended=definition or position('page as materialized' in amended)=0
  or position('from page left join record_names' in amended)=0 then raise exception 'Review batched checked FMS page'; end if;
 execute amended;

 definition:=pg_get_functiondef('task_workspace_page(jsonb,integer,integer)'::regprocedure);
 amended:=replace(definition,'with ordinary as (', $patch$with authorized_name_work as materialized (
  select work.id from fms_instance_stages work join fms_instances instance on instance.id=work.fms_instance_id
  where q<>'' and fms_module_enabled and kind_filter in ('all','fms') and section_filter in ('any','fms','all')
   and instance.tenant_id=a.tenant_id and can_read_fms_work_context(work.id)
 ), record_names as materialized (
  select * from fms_work_record_names_authorized(array(select id from authorized_name_work))
 ), ordinary as ($patch$);
 amended:=replace(amended,'case when q<>'''' then fms_work_record_name(s.id) end',
  '(select record_name from record_names where work_id=s.id)');
 if amended=definition or position('authorized_name_work as materialized' in amended)=0
  or position('(select record_name from record_names where work_id=s.id)' in amended)=0 then
  raise exception 'Review batched global FMS naming'; end if;
 execute amended;
end $$;
notify pgrst,'reload schema';
