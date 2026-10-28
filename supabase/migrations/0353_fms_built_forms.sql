-- Forms Library separates forms made in the library from questions built inside
-- FMS workflow steps (owner request 2026-10-28).
--
-- A form family is "built in FMS" when an FMS step created it: the step's
-- planned_time_rule.questionnaire.origin is 'stage' (made in that step) or
-- 'copied' (a step copied from another workflow), and the step pins one of the
-- family's versions or holds one as its unpublished draft. Library forms that a
-- step merely links stay library forms.
--
-- Read-only. Every active Forms Library user learns which of their tenant's form
-- families are FMS-built (ids only); workflow and step names are added for form
-- authors, who manage those forms.
set search_path=public,extensions;

create or replace function list_fms_built_forms()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); authors boolean; result jsonb;
begin
  perform assert_module_enabled('forms_library');
  if a.id is null or not current_profile_is_active() then
    raise exception 'An active profile is required' using errcode='42501';
  end if;
  authors:=has_permission('forms.manage');
  select coalesce(jsonb_agg(jsonb_build_object('familyId',built.family_id)
    ||case when authors then jsonb_build_object('workflows',built.workflows,'steps',built.steps) else '{}'::jsonb end order by built.family_id),'[]'::jsonb)
  into result
  from (
    select ft.family_id,
      to_jsonb(array_agg(distinct flow.name order by flow.name)) as workflows,
      to_jsonb(array_agg(distinct stage.name order by stage.name)) as steps
    from fms_stages stage
    join fms_flows flow on flow.id=stage.fms_flow_id and flow.tenant_id=a.tenant_id
    join form_templates ft on ft.tenant_id=a.tenant_id
      and (ft.id=stage.form_template_id
        or ft.id::text=nullif(stage.planned_time_rule#>>'{questionnaire,draftFormId}',''))
    where stage.planned_time_rule#>>'{questionnaire,origin}' in ('stage','copied')
    group by ft.family_id
  ) built;
  return result;
end $$;

revoke all on function list_fms_built_forms() from public,anon,authenticated,service_role;
grant execute on function list_fms_built_forms() to authenticated;
notify pgrst,'reload schema';
