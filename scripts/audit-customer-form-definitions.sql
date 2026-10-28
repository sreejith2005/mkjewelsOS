-- Configuration only: never read form submissions or customer answers.
begin read only;
select jsonb_build_object(
 'captured_at',statement_timestamp(),
 'templates',(select coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id,'family_id',t.family_id,'name',t.name,'version',t.version,'lifecycle',t.lifecycle,
   'sections',t.sections,'library_visible',t.library_visible,
   'fields',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'key',f.field_key,'label',f.field_name,
     'type',f.field_type,'group',f.group_name,'required',f.is_required,'shown',f.is_shown,
     'editable',f.is_editable,'validation',f.validation,'conditions',f.conditional_logic,
     'rule',f.rule_definition,'branch_logic',f.branch_logic,'option_source',f.option_source,
     'dropdown_master_type',f.dropdown_master_type,'options',f.options,'option_snapshot',f.dropdown_option_snapshot,
     'sort_order',f.sort_order) order by f.sort_order,f.id),'[]'::jsonb)
     from public.form_fields f where f.form_template_id=t.id)
 ) order by t.name,t.version,t.id),'[]'::jsonb) from public.form_templates t),
 'workflows',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'family_id',w.family_id,'name',w.name,
   'version',w.version,'status',w.status,'active',w.is_active,'execution_version',w.execution_version,
   'assignment_version',w.assignment_version,
   'stages',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'key',s.stage_key,'name',s.name,
     'form_template_id',s.form_template_id,'section_key',s.planned_time_rule->>'formSectionKey',
     'step_type',s.step_type,'sort_order',s.sort_order,
     'routes',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.fms_branch_rules r where r.fms_stage_id=s.id)) order by s.sort_order,s.id),'[]'::jsonb)
     from public.fms_stages s where s.fms_flow_id=w.id)
 ) order by w.name,w.version,w.id),'[]'::jsonb) from public.fms_flows w)
) as catalog;
commit;
