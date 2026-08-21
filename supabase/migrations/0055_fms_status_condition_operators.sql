-- Status conditions use the same explicitly whitelisted operators in the UI,
-- core validation, and runtime.  The comparison is case-insensitive text so a
-- crafted client payload cannot introduce arbitrary predicates.
create or replace function is_valid_fms_timing_rule(p_rule jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare v_method text:=coalesce(nullif(p_rule->>'timingMethod',''),'completion_date'); v_number numeric; v_condition jsonb:=p_rule->'conditional';
begin
  if coalesce(p_rule->>'decisionMode','normal') not in ('normal','yes_no') then return false; end if;
  if v_condition is not null and (
    jsonb_typeof(v_condition)<>'object' or (
      coalesce(v_condition->>'field','')='status'
      and coalesce(v_condition->>'operator','') in ('equals','not_equals','greater_than','less_than','greater_than_or_equal','less_than_or_equal','contains','not_contains')
      and nullif(btrim(v_condition->>'value'),'') is not null
    ) is not true and (
      coalesce(v_condition->>'decisionStageKey','') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(v_condition->>'outcome','') not in ('yes','no')
    )
  ) then return false; end if;
  if v_method='completion_date' then return is_valid_fms_due_date(p_rule->>'dueDate'); end if;
  if v_method='tat_hours' then v_number:=(p_rule->>'tatHours')::numeric; return v_number>0 and v_number<=8760; end if;
  if v_method='days_before_date' then v_number:=(p_rule->>'daysBefore')::numeric; return is_valid_fms_due_date(p_rule->>'futureDate') and v_number=trunc(v_number) and v_number between 0 and 3650; end if;
  if v_method='specific_time' then return is_valid_fms_due_date(p_rule->>'dueDate') and coalesce(p_rule->>'clockTime','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'; end if;
  return false;
exception when others then return false;
end $$;

/* Superseded by the deterministic forward repair in 0082; see 0054. */
/* do $$
declare v_definition text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.activate_fms_stage_internal(uuid,uuid,uuid,uuid,integer)'::regprocedure) into v_definition;
  v_old := $old$
 if v_stage.planned_time_rule#>>'{conditional,field}'='status' then
   v_condition_expected:=lower(v_stage.planned_time_rule#>>'{conditional,value}');
   v_condition_actual:=lower(v_instance.context->>'status');
   if coalesce(v_condition_actual,'')<>v_condition_expected then$old$;
  v_new := $new$
 if v_stage.planned_time_rule#>>'{conditional,field}'='status' then
   v_condition_expected:=lower(v_stage.planned_time_rule#>>'{conditional,value}');
   v_condition_actual:=lower(v_instance.context->>'status');
   if not case v_stage.planned_time_rule#>>'{conditional,operator}'
     when 'equals' then coalesce(v_condition_actual,'')=v_condition_expected
     when 'not_equals' then coalesce(v_condition_actual,'')<>v_condition_expected
     when 'greater_than' then coalesce(v_condition_actual,'')>v_condition_expected
     when 'less_than' then coalesce(v_condition_actual,'')<v_condition_expected
     when 'greater_than_or_equal' then coalesce(v_condition_actual,'')>=v_condition_expected
     when 'less_than_or_equal' then coalesce(v_condition_actual,'')<=v_condition_expected
     when 'contains' then position(v_condition_expected in coalesce(v_condition_actual,''))>0
     when 'not_contains' then position(v_condition_expected in coalesce(v_condition_actual,''))=0
     else false end then$new$;
  if position(v_old in v_definition)=0 then raise exception 'FMS status-condition runtime patch could not locate the existing status block'; end if;
  execute replace(v_definition,v_old,v_new);
end $$;
*/

notify pgrst, 'reload schema';
