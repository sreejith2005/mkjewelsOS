set search_path=public,extensions;
do $$
declare f text; n text; marker text;
begin
 f:=replace(pg_get_functiondef('get_fms_assigned_work_context(uuid,uuid,text,integer)'::regprocedure),E'\r','');
 n:=replace(f,'last_cursor text;', 'last_cursor text; journey_ids uuid[];');
 if n=f then raise exception 'Journey variables changed'; end if; f:=n;
 marker:='  select coalesce(jsonb_agg(to_jsonb(item)';
 n:=replace(f,marker,$patch$  -- execution_path resets on a new pass; previous visit links retain the
  -- actual history. Expand summary ancestry only, never the received answers.
  with recursive ancestry(id) as (
    select unnest(array_remove(coalesce(work.execution_path,'{}')||work.id,null))
    union
    select prior.previous_instance_stage_id from ancestry parent
      join fms_instance_stages prior on prior.id=parent.id and prior.fms_instance_id=i.id
      where prior.previous_instance_stage_id is not null
  ) select array_agg(id) into journey_ids from ancestry where id<>work.id;
$patch$||marker);
 if n=f then raise exception 'Journey ancestry marker changed'; end if; f:=n;
 f:=replace(f,'any(work.execution_path)','any(journey_ids)');
 marker:='options:=case when jsonb_typeof(field->''options'')=''array'' then field->''options'' else ''[]''::jsonb end;';
 n:=replace(f,marker,$patch$options:=case when jsonb_typeof(field->'dropdown_option_snapshot')='array' and jsonb_array_length(field->'dropdown_option_snapshot')>0 then field->'dropdown_option_snapshot'
      when jsonb_typeof(field->'options')='array' then field->'options' else '[]'::jsonb end;$patch$);
 if n=f then raise exception 'Historical option label marker changed'; end if;
 execute n;
end $$;
notify pgrst,'reload schema';
