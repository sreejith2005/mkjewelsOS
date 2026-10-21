set search_path=public,extensions;
do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('fms_work_record_name(uuid)'::regprocedure);
 amended:=replace(definition,'fields jsonb; field jsonb; selected text;','fields jsonb; selected text;');
 if amended=definition then raise exception 'Review record template variable correction'; end if; execute amended;
 definition:=pg_get_functiondef('get_fms_task_stages(uuid,jsonb)'::regprocedure);
 amended:=replace(definition,'perform fms_workspace_validate(p_filter,0,50);','perform fms_workspace_validate(p_filter,0,50); if p_family_id is null then raise exception ''A workflow family is required'' using errcode=''22023''; end if;');
 if amended=definition then raise exception 'Review required workflow selector'; end if; execute amended;
 definition:=pg_get_functiondef('get_fms_task_stage_page(uuid,uuid,uuid,boolean,jsonb,integer,integer)'::regprocedure);
 amended:=replace(definition,'if p_starting is null then','if p_starting is null or p_family_id is null or p_flow_id is null or p_stage_id is null then');
 if amended=definition then raise exception 'Review required stage selector'; end if; execute amended;
end $$;
notify pgrst,'reload schema';
