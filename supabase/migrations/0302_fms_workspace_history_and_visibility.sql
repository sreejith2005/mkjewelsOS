-- Complete-history and conditional-answer parity for the employee read model.
set search_path=public,extensions;
do $$
declare definition text; amended text;
begin
 definition:=pg_get_functiondef('fms_workspace_rows(jsonb)'::regprocedure);
 amended:=replace(definition,'w.status=''in_review'' and d.step_type<>''approval''','w.status=''in_review'' and (d.step_type<>''approval'' or not has_permission(''tasks.manage_team''))');
 if amended=definition then raise exception 'Review FMS waiting authority projection'; end if; execute amended;
 definition:=pg_get_functiondef('task_workspace_page(jsonb,integer,integer)'::regprocedure);
 amended:=replace(definition,'where bucket in (''pending'',''overdue''))) and (case section_filter',
  'where (bucket=''completed'' and status_filter=''completed'' or bucket in (''pending'',''overdue'') and status_filter<>''completed'' or mode=''explore'' and status_filter=''all''))) and (case section_filter');
 amended:=replace(amended,'mode=''explore'' or section_filter=''all'' or','mode=''explore'' or section_filter=''all'' or section_filter=''fms'' and status_filter=''completed'' or');
 if amended=definition then raise exception 'Review FMS history membership'; end if; execute amended;
 -- Legacy custom templates may use only the same visible causal fields as
 -- previous-answer context, matched to the exact historical submission.
 definition:=pg_get_functiondef('fms_work_record_name(uuid)'::regprocedure);
 amended:=replace(definition,'for template_field in select * from jsonb_array_elements(context->''receivedFields'') loop',
 $patch$for template_field in
   select safe.field from jsonb_array_elements(context->'receivedFields') configured
   join lateral (select field from fms_context_form_visits(w.id) causal
    cross join lateral jsonb_array_elements(fms_context_form_fields(causal.visit_id)) visible(field)
    where field->>'submissionId'=configured->>'submissionId' and field#>>'{field,key}'=configured#>>'{field,key}'
    limit 1) safe on true loop$patch$);
 if amended=definition then raise exception 'Review legacy template visibility intersection'; end if; execute amended;
end $$;
notify pgrst,'reload schema';
