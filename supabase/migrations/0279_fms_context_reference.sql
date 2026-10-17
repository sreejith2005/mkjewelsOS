set search_path=public,extensions;
do $$
declare f text; n text; marker text;
begin
 f:=replace(pg_get_functiondef('get_fms_assigned_work_context(uuid,uuid,text,integer)'::regprocedure),E'\r','');
 marker:='''reference'',i.reference_number,';
 n:=replace(f,marker,marker||E'\n    ''referenceKey'',case when display->>''referenceField'' is not null then (display#>>''{referenceField,sourceStageKey}'')||''.''||(display#>>''{referenceField,fieldKey}'') else null end,');
 if n=f then raise exception 'Context reference projection marker changed'; end if; execute n;
 f:=replace(pg_get_functiondef('assert_fms_assignment_publishable_before_hierarchy(uuid)'::regprocedure),E'\r','');
 -- A previous visit of this same stage is a legitimate causal source in a loop.
 n:=replace(f,'source.id is null or source.id=stage.id or','source.id is null or');
 if n=f then raise exception 'Previous visit display marker changed'; end if; f:=n;
 marker:='      for mapping in select value from jsonb_array_elements(stage.planned_time_rule#>''{taskDisplay,fields}'') loop';
 n:=replace(f,marker,$patch$      if stage.planned_time_rule#>>'{taskDisplay,referenceField}' is not null
        and not exists(select 1 from jsonb_array_elements(stage.planned_time_rule#>'{taskDisplay,fields}') configured
          where configured->>'sourceStageKey'=stage.planned_time_rule#>>'{taskDisplay,referenceField,sourceStageKey}'
            and configured->>'formTemplateId'=stage.planned_time_rule#>>'{taskDisplay,referenceField,formTemplateId}'
            and configured->>'fieldKey'=stage.planned_time_rule#>>'{taskDisplay,referenceField,fieldKey}') then
        raise exception 'Reference question must be one of the configured work-information questions' using errcode='23514';
      end if;
$patch$||marker);
 if n=f then raise exception 'Reference publication marker changed'; end if; execute n;
end $$;
notify pgrst,'reload schema';
