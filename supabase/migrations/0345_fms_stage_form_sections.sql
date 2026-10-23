-- An FMS stage may link one Section of its Form instead of the whole Form.
--
-- Persistence: the stage keeps the selection in its existing stage configuration
-- (`fms_stages.planned_time_rule->>'formSectionKey'`, the `sla.formSectionKey` of
-- the builder contract). Draft save, revision copy and duplicate already carry
-- that document verbatim, and the "stage used by existing work cannot be
-- redefined" guard already covers it, so published versions and running
-- instances keep their historical behaviour. An absent key means Entire Form.
--
-- Runtime: `fms_validate_candidate_form` is the single trusted validator behind
-- both the handoff preview and the final `submit_form_with_audit` call. For an
-- `fms_stage` submission on a sectioned stage it now validates only that section
-- and rejects answers to questions outside it. Standalone, starter and task
-- submissions are unchanged and still validate the complete Form.
set search_path=public,extensions;

do $$
declare definition text; amended text;
begin
  definition:=replace(pg_get_functiondef('fms_validate_candidate_form(uuid,jsonb,text,uuid)'::regprocedure),E'\r','');

  amended:=replace(definition,'  v_file_ids uuid[] := ''{}'';','  v_file_ids uuid[] := ''{}'';
  v_section_key text;');
  if amended=definition then raise exception 'Review FMS form validator declarations'; end if;
  definition:=amended;

  amended:=replace(definition,'      raise exception ''This FMS stage already has a submitted form output'' using errcode=''23514'';
    end if;','      raise exception ''This FMS stage already has a submitted form output'' using errcode=''23514'';
    end if;
    -- The stage, not the caller, decides which section is answered.
    v_section_key := nullif(btrim(coalesce(v_stage.planned_time_rule->>''formSectionKey'','''')),'''');
    if v_section_key is not null then
      if jsonb_typeof(v_template.sections) is distinct from ''array''
         or not exists(select 1 from jsonb_array_elements(v_template.sections) section where section->>''key''=v_section_key) then
        raise exception ''This FMS step uses a form section that is not in the linked form version'' using errcode=''23514'';
      end if;
      if exists(
        select 1 from jsonb_object_keys(p_answers) answer_key
        join form_fields ff on ff.form_template_id=v_template.id and ff.field_key=answer_key
        where form_field_section_key(ff.group_name,v_template.sections) is distinct from v_section_key
      ) then
        raise exception ''Answers include a question outside this FMS step''''s form section'' using errcode=''22023'';
      end if;
    end if;');
  if amended=definition then raise exception 'Review FMS stage form guard marker'; end if;
  definition:=amended;

  amended:=replace(definition,'  v_reachable := form_reachable_sections(v_template.id, p_answers);',
    '  v_reachable := case when v_section_key is not null then array[v_section_key] else form_reachable_sections(v_template.id, p_answers) end;');
  if amended=definition then raise exception 'Review form reachability marker'; end if;

  execute amended;
end $$;

-- Publication repeats the builder's section checks so a forged draft cannot ship
-- a sectioned stage that could never be answered or routed.
create or replace function assert_fms_form_sections_publishable(p_flow_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare stage_row record; section_title text; first_stage uuid;
begin
  select id into first_stage from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1;
  for stage_row in
    select s.*, nullif(btrim(coalesce(s.planned_time_rule->>'formSectionKey','')),'') as section_key, f.sections as form_sections
    from fms_stages s left join form_templates f on f.id=s.form_template_id
    where s.fms_flow_id=p_flow_id and nullif(btrim(coalesce(s.planned_time_rule->>'formSectionKey','')),'') is not null
  loop
    if stage_row.id=first_stage then
      raise exception 'The starting Form of a workflow always uses the entire Form' using errcode='23514';
    end if;
    if stage_row.form_template_id is null then
      raise exception 'Step "%" selects a form section but links no Form',stage_row.name using errcode='23514';
    end if;
    select section->>'title' into section_title
      from jsonb_array_elements(case when jsonb_typeof(stage_row.form_sections)='array' then stage_row.form_sections else '[]'::jsonb end) section
      where section->>'key'=stage_row.section_key;
    if section_title is null then
      raise exception 'Step "%" uses a form section that is no longer in the linked Form version',stage_row.name using errcode='23514';
    end if;
    if not exists(select 1 from form_fields ff where ff.form_template_id=stage_row.form_template_id
        and ff.field_type not in ('section_header','divider')
        and form_field_section_key(ff.group_name,stage_row.form_sections)=stage_row.section_key) then
      raise exception 'Step "%" uses form section "%", which has no questions',stage_row.name,section_title using errcode='23514';
    end if;
    if exists(
      select 1 from form_fields ff
      cross join lateral jsonb_path_query(coalesce(ff.conditional_logic,'null'::jsonb)||'[]'::jsonb||coalesce(ff.rule_definition,'null'::jsonb),'strict $.**.fieldKey') dependency(key)
      join form_fields source on source.form_template_id=ff.form_template_id and source.field_key=dependency.key#>>'{}'
      where ff.form_template_id=stage_row.form_template_id
        and form_field_section_key(ff.group_name,stage_row.form_sections)=stage_row.section_key
        and form_field_section_key(source.group_name,stage_row.form_sections) is distinct from stage_row.section_key
    ) then
      raise exception 'Step "%" uses form section "%", where a question depends on an answer in another section',stage_row.name,section_title using errcode='23514';
    end if;
    if exists(
      select 1 from fms_branch_rules r
      join form_fields ff on ff.form_template_id=stage_row.form_template_id and ff.field_key=r.source_key
      where r.fms_stage_id=stage_row.id and r.source_type='form_answer' and r.condition_operator<>'default'
        and form_field_section_key(ff.group_name,stage_row.form_sections) is distinct from stage_row.section_key
    ) then
      raise exception 'Step "%" routes on a question outside its form section',stage_row.name using errcode='23514';
    end if;
    -- Later steps may read this step's answers (owner, record name, work details);
    -- each such question must be one this section actually asks.
    if exists(
      select 1 from fms_stages reader
      cross join lateral (
        select value from jsonb_array_elements(case when jsonb_typeof(reader.planned_time_rule#>'{assignment,sources}')='array' then reader.planned_time_rule#>'{assignment,sources}' else '[]'::jsonb end)
        union all select value from jsonb_array_elements(case when jsonb_typeof(reader.planned_time_rule#>'{taskDisplay,fields}')='array' then reader.planned_time_rule#>'{taskDisplay,fields}' else '[]'::jsonb end)
        union all select reader.planned_time_rule#>'{taskDisplay,recordNaming,source}' where jsonb_typeof(reader.planned_time_rule#>'{taskDisplay,recordNaming,source}')='object'
        union all select reader.planned_time_rule#>'{taskDisplay,referenceField}' where jsonb_typeof(reader.planned_time_rule#>'{taskDisplay,referenceField}')='object'
      ) source(value)
      join form_fields ff on ff.form_template_id=stage_row.form_template_id and ff.field_key=source.value->>'fieldKey'
      where reader.fms_flow_id=p_flow_id and source.value->>'sourceStageKey'=stage_row.stage_key
        and form_field_section_key(ff.group_name,stage_row.form_sections) is distinct from stage_row.section_key
    ) or exists(
      select 1 from form_fields ff where ff.form_template_id=stage_row.form_template_id
        and ff.field_key=stage_row.planned_time_rule->>'assignmentFieldKey'
        and form_field_section_key(ff.group_name,stage_row.form_sections) is distinct from stage_row.section_key
    ) then
      raise exception 'A step reads a question from "%" that its form section does not ask',stage_row.name using errcode='23514';
    end if;
  end loop;
end $$;

create or replace function assert_fms_flow_publishable(p_flow_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform assert_fms_flow_publishable_before_assignment(p_flow_id);
  perform assert_fms_assignment_publishable(p_flow_id);
  perform assert_fms_form_sections_publishable(p_flow_id);
end $$;

alter function assert_fms_form_sections_publishable(uuid) owner to postgres;
alter function assert_fms_flow_publishable(uuid) owner to postgres;
revoke all on function assert_fms_form_sections_publishable(uuid) from public,anon,authenticated,service_role;
revoke all on function fms_validate_candidate_form(uuid,jsonb,text,uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
