-- New and edited FMS conditions are driven exclusively by configured Decision Step options.
-- Existing published status-based rules remain readable by the runtime, but authoring no longer creates them.

create or replace function public.is_valid_fms_timing_rule(p_rule jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare v_method text:=coalesce(nullif(p_rule->>'timingMethod',''),'completion_date'); v_number numeric; v_options jsonb; v_key text;
begin
  if jsonb_typeof(p_rule) <> 'object' then return false; end if;
  if coalesce(p_rule->>'decisionMode','normal') not in ('normal','yes_no','decision') then return false; end if;
  if p_rule->>'decisionMode' in ('decision','yes_no') and p_rule ? 'decisionOptions' then
    v_options:=p_rule->'decisionOptions';
    if jsonb_typeof(v_options)<>'array' or jsonb_array_length(v_options)<2 then return false; end if;
    if exists(select 1 from jsonb_array_elements(v_options) item where coalesce(item->>'key','') !~ '^[a-z][a-z0-9_]{0,63}$' or nullif(btrim(item->>'label'),'') is null) then return false; end if;
    if (select count(*) from jsonb_array_elements(v_options) item)<>(select count(distinct item->>'key') from jsonb_array_elements(v_options) item) then return false; end if;
  end if;
  if p_rule ? 'conditional' then
    if jsonb_typeof(p_rule->'conditional')<>'object' or coalesce(p_rule#>>'{conditional,decisionStageKey}','') !~ '^[a-z][a-z0-9_]{0,63}$' then return false; end if;
    v_key:=coalesce(nullif(p_rule#>>'{conditional,decisionOptionKey}',''),nullif(p_rule#>>'{conditional,outcome}',''));
    if v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,63}$' then return false; end if;
  end if;
  if coalesce((p_rule->>'deadlineEnabled')::boolean,true)=false then return true; end if;
  if v_method='completion_date' then return public.is_valid_fms_due_date(p_rule->>'dueDate'); end if;
  if v_method='tat_hours' then v_number:=coalesce(nullif(p_rule->>'tatMinutes','')::numeric,nullif(p_rule->>'tatHours','')::numeric*60); return v_number>0 and v_number<=525600; end if;
  if v_method='days_before_date' then v_number:=(p_rule->>'daysBefore')::numeric; return public.is_valid_fms_due_date(p_rule->>'futureDate') and v_number=trunc(v_number) and v_number between 0 and 3650; end if;
  if v_method='specific_time' then return public.is_valid_fms_due_date(p_rule->>'dueDate') and coalesce(p_rule->>'clockTime','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'; end if;
  return false;
exception when others then return false;
end $$;

alter function public.is_valid_fms_timing_rule(jsonb) owner to postgres;
notify pgrst, 'reload schema';
