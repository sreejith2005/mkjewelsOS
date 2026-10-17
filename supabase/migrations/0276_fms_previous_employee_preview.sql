set search_path=public,extensions;
-- The actor completing a human visit is its prospective doer. Its persisted
-- completed_by is filled only by the final transaction, after this preview.
do $$
declare f text; n text; marker text;
begin
 f:=replace(pg_get_functiondef('resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid,uuid[])'::regprocedure),E'\r','');
 marker:='chosen:=source_work.completed_by; source_id:=source_work.id; method:=''previous_stage_employee'';';
 n:=replace(f,marker,$patch$if p_candidate_stage_id is not null and exists(select 1 from fms_stages human where human.id=prior.fms_stage_id and human.step_type not in ('branch','parallel_start','parallel_join','notification','end')) then
        source_work:=prior; source_work.completed_by:=(current_profile()).id;
      end if;
      $patch$||marker);
 if n=f then raise exception 'Previous employee preview marker changed'; end if;
 execute n;
end $$;
notify pgrst,'reload schema';
