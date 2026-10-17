set search_path=public,extensions;
do $$
declare f text; n text;
begin
 f:=pg_get_functiondef('fms_remap_assignment_routes(uuid,jsonb,uuid)'::regprocedure);
 n:=regexp_replace(f,'\msource_key\M','v_source_key','g');
 if n=f then raise exception 'Assignment route variable marker changed'; end if;
 execute n;
end $$;
notify pgrst,'reload schema';
