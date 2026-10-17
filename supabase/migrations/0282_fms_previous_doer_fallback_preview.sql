set search_path=public,extensions;
do $$
declare f text; n text; marker text;
begin
 f:=replace(pg_get_functiondef('resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid,uuid[])'::regprocedure),E'\r','');
 marker:='    chosen:=case fallback->>''type'' when ''specific_user'' then (fallback->>''userProfileId'')::uuid when ''reporter'' then i.started_by when ''previous_step_doer'' then prior.completed_by end;';
 n:=replace(f,marker,$patch$    chosen:=case fallback->>'type' when 'specific_user' then (fallback->>'userProfileId')::uuid when 'reporter' then i.started_by end;
    if fallback->>'type'='previous_step_doer' then
      select work.* into source_work from unnest(coalesce(prior.execution_path,'{}')||coalesce(array[prior.id],'{}')) with ordinality path(id,depth)
        join fms_instance_stages work on work.id=path.id and work.fms_instance_id=i.id
        join fms_stages definition on definition.id=work.fms_stage_id
        where definition.step_type not in ('branch','parallel_start','parallel_join','notification','end') and work.completed_by is not null order by path.depth desc limit 1;
      if p_candidate_stage_id is not null and exists(select 1 from fms_stages human where human.id=prior.fms_stage_id and human.step_type not in ('branch','parallel_start','parallel_join','notification','end')) then
        source_work:=prior; source_work.completed_by:=(current_profile()).id;
      end if;
      chosen:=source_work.completed_by; source_id:=source_work.id;
    end if;$patch$);
 if n=f then raise exception 'Previous doer fallback marker changed'; end if;
 execute n;
end $$;
notify pgrst,'reload schema';
