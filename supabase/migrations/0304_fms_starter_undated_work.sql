-- Starter assignments have a creation timestamp, not a configured deadline.
-- Keep their status/dates consistent across cards, summaries and legacy feeds.
set search_path=public,extensions;
do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('fms_workspace_rows(jsonb)'::regprocedure);
 amended:=replace(definition,'f.version,'''',-1,0,s.created_at,s.status','f.version,'''',-1,0,null::timestamptz,s.status');
 if amended=definition then raise exception 'Review starter summary deadline'; end if; execute amended;
 definition:=pg_get_functiondef('task_workspace_page(jsonb,integer,integer)'::regprocedure);
 amended:=replace(definition,'null::uuid,s.assigned_by,s.created_at,s.created_at,''medium''::task_priority','null::uuid,s.assigned_by,null::timestamptz,s.created_at,''medium''::task_priority');
 if amended=definition then raise exception 'Review starter search deadline'; end if; execute amended;
 definition:=pg_get_viewdef('v_all_tasks'::regclass,true);
 amended:=replace(definition,'starter.created_at AS planned_datetime','NULL::timestamp with time zone AS planned_datetime');
 amended:=replace(amended,'starter.created_at AS effective_due_datetime','NULL::timestamp with time zone AS effective_due_datetime');
 if amended=definition or position('starter.created_at AS planned_datetime' in amended)>0 then raise exception 'Review starter feed deadline'; end if;
 execute 'create or replace view public.v_all_tasks with (security_invoker=true) as '||amended;
end $$;
notify pgrst,'reload schema';
