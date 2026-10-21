-- Keep unfinished parallel visits visible without claiming a terminal instance is actionable.
set search_path=public,extensions;
do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('fms_workspace_rows(jsonb)'::regprocedure);
 amended:=replace(definition,'or i.status=''on_hold''','or i.status in (''on_hold'',''completed'')');
 if amended=definition then raise exception 'Review terminal FMS actionability projection'; end if;
 execute amended;
 definition:=pg_get_functiondef('fms_workspace_validate(jsonb,integer,integer)'::regprocedure);
 amended:=replace(definition,'date_from:=nullif',
 $patch$if exists(select 1 from unnest(array[nullif(p_filter->>'from',''),nullif(p_filter->>'to','')]) value
   where value is not null and value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then raise exception 'Invalid date'; end if;
  date_from:=nullif$patch$);
 if amended=definition then raise exception 'Review strict FMS date validation'; end if;
 execute amended;
end $$;
notify pgrst,'reload schema';
