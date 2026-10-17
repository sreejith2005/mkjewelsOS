set search_path=public,extensions;
-- Carry each queued route's cohort and collapse an inner join to its parent,
-- matching the existing persisted activator without creating preview visits.
do $$
declare f text; n text;
begin
 f:=replace(pg_get_functiondef('fms_transition_plan_for_context(fms_instances,fms_instance_stages,jsonb,text)'::regprocedure),E'\r','');
 n:=replace(f,'needed integer; arrived integer;', 'current_scope uuid; current_branch uuid; needed integer; arrived integer;');
 if n=f then raise exception 'Nested preview variable marker changed'; end if; f:=n;
 n:=replace(f,'  queue:=case',E'  current_scope:=source.parallel_scope_id; current_branch:=source.parallel_branch_id;\n  queue:=case');
 if n=f then raise exception 'Nested preview initial marker changed'; end if; f:=n;
 f:=replace(f,'''path'',to_jsonb(','''scope'',current_scope,''branch'',current_branch,''path'',to_jsonb(');
 n:=replace(f,'    path_ids:=array(',E'    current_scope:=nullif(item->>''scope'','''')::uuid; current_branch:=nullif(item->>''branch'','''')::uuid;\n    path_ids:=array(');
 if n=f then raise exception 'Nested preview queue marker changed'; end if; f:=n;
 f:=replace(f,'id=source.parallel_scope_id','id=current_scope');
 f:=replace(f,'union select source.parallel_branch_id','union select current_branch');
 n:=replace(f,'        ) ordered;',E'        ) ordered;\n        current_scope:=cohort.parent_scope_id; current_branch:=cohort.parent_branch_id;');
 if n=f then raise exception 'Nested preview parent marker changed'; end if;
 execute n;
end $$;
notify pgrst,'reload schema';
