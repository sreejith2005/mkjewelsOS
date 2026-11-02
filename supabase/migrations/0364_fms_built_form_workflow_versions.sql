-- Forms Library -> FMS workflow forms listed one section per workflow version,
-- so a workflow edited and republished three times appeared three times with
-- the same forms (owner report 2026-11-02).
--
-- Each workflow/step link now also says which workflow family it belongs to,
-- the version and status of that row, the step order, and whether that row is
-- the workflow's current version (the published one, else the newest). The
-- client groups by workflow family and shows the current version's steps.
--
-- Read-only. Classification, author-only labels, grants and the existing keys
-- (familyId, workflows, steps, links.workflowId/workflowName/stageId/stageName)
-- are unchanged from 0353 + 0362.
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
    ||case when authors then jsonb_build_object('workflows',built.workflows,'steps',built.steps,'links',built.links) else '{}'::jsonb end order by built.family_id),'[]'::jsonb)
  into result
  from (
    select ft.family_id,
      to_jsonb(array_agg(distinct flow.name order by flow.name)) as workflows,
      to_jsonb(array_agg(distinct stage.name order by stage.name)) as steps,
      jsonb_agg(distinct jsonb_build_object('workflowId',flow.id,'workflowName',flow.name,'stageId',stage.id,'stageName',stage.name,
        'workflowFamilyId',flow.family_id,'workflowVersion',flow.version,'workflowStatus',flow.status,
        'stageOrder',stage.sort_order,'isCurrent',flow.id=current_flow.id)) as links
    from fms_stages stage
    join fms_flows flow on flow.id=stage.fms_flow_id and flow.tenant_id=a.tenant_id
    cross join lateral (
      select latest.id from fms_flows latest
      where latest.tenant_id=flow.tenant_id and latest.family_id=flow.family_id
      order by (latest.status='published') desc, latest.version desc
      limit 1
    ) current_flow
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
