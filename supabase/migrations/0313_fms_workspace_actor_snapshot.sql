-- Stable actor/module checks are statement-wide, not work-item properties.
-- Snapshot them once while retaining the exact-work authorization predicate.
set search_path=public,extensions;
do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('fms_workspace_rows(jsonb)'::regprocedure);
 amended:=replace(definition,'with actor as (select (current_profile()).*),',
  'with actor as materialized (select profile.*,current_profile_is_active() workspace_actor_active,
   module_accessible(''fms_builder'',false) workspace_fms_enabled from current_profile() profile),');
 amended:=replace(amended,'current_profile_is_active() and module_accessible(''fms_builder'',false)',
  'a.workspace_actor_active and a.workspace_fms_enabled');
 if amended=definition or position('with actor as materialized' in amended)=0
  or position('a.workspace_actor_active and a.workspace_fms_enabled' in amended)=0 then
  raise exception 'Review statement-scoped FMS actor snapshot';
 end if;
 execute amended;
end $$;
notify pgrst,'reload schema';
