set search_path=public,extensions;

-- 0348 (2026-10-26 owner request)
-- A step that receives its employee from the previous form ("Assigned To from
-- the previous form") always lets the completing employee keep the suggested
-- employee or choose another eligible one. Since 2026-10-17 (0288) that rule was
-- saved with allowHandoff=false, so a form without an employee question could
-- only continue with the same person. Fixed-employee steps stay locked, and
-- every replacement is still checked by assert_fms_handoff_recipient.
--
-- One predicate replaces the inline allowHandoff checks in the runtime
-- functions. Authoring/publish checks are unchanged. Each body is amended from
-- pg_get_functiondef and must contain the expected number of checks.

create function fms_assignment_allows_handoff(p_config jsonb)
returns boolean language sql immutable set search_path=public as $$
  select coalesce(p_config->>'mode','')<>'fixed_employee'
    and (coalesce((p_config->>'allowHandoff')::boolean,false) or coalesce((p_config->>'followFormAssignee')::boolean,false))
$$;
alter function fms_assignment_allows_handoff(jsonb) owner to postgres;
revoke all on function fms_assignment_allows_handoff(jsonb) from public,anon,authenticated,service_role;

do $$
declare
  item record; definition text; amended text; found integer;
begin
  for item in select * from (values
    ('fms_assignment_destination(uuid,uuid,jsonb,text)', 'coalesce((config->>''allowHandoff'')::boolean,false)', 'fms_assignment_allows_handoff(config)', 1),
    ('fms_initial_assignment_preview(uuid,uuid,jsonb,uuid)', 'coalesce((config->>''allowHandoff'')::boolean,false)', 'fms_assignment_allows_handoff(config)', 2),
    ('resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid,uuid[],text)', 'coalesce((c->>''allowHandoff'')::boolean,false)', 'fms_assignment_allows_handoff(c)', 1),
    ('preview_fms_work_transition_before_start(jsonb)', 'coalesce((target.planned_time_rule#>>''{assignment,allowHandoff}'')::boolean,false)', 'fms_assignment_allows_handoff(target.planned_time_rule->''assignment'')', 1),
    ('apply_fms_initial_handoffs(uuid,uuid,jsonb)', 'coalesce((target.planned_time_rule#>>''{assignment,allowHandoff}'')::boolean,false)', 'fms_assignment_allows_handoff(target.planned_time_rule->''assignment'')', 1)
  ) as patch(signature, old_text, new_text, expected) loop
    definition:=replace(pg_get_functiondef(item.signature::regprocedure),E'\r','');
    found:=(length(definition)-length(replace(definition,item.old_text,'')))/length(item.old_text);
    if found<>item.expected then raise exception '0348: expected % handoff checks in %, found %',item.expected,item.signature,found; end if;
    amended:=replace(definition,item.old_text,item.new_text);
    execute amended;
  end loop;
end $$;
