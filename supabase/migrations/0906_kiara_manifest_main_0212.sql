-- Ask Kiara: keep main's retirement-manifest additions (development series, see the plan's
-- "Migration numbering"). Kiara's migrations redefine
-- production_demo_data_retirement_manifest in full and run after every main migration, so
-- main's 0212_fms_loop_execution additions (fms_execution_scopes and its visit tables) are
-- re-applied here with the same guarded text replacement 0212 uses. At the Phase 9 merge
-- this folds into the renumbered series; it is a no-op when the entries are already present.
set search_path = public, extensions;

do $$
declare definition text;
begin
  definition := pg_get_functiondef('production_demo_data_retirement_manifest(uuid)'::regprocedure);
  if position($marker$'fms_execution_scopes'$marker$ in definition) > 0 then return; end if;
  if position($marker$'export_logs','fms_flows'$marker$ in definition) = 0
    or position($marker$'fms_evidence', (select count(*)$marker$ in definition) = 0 then
    raise exception 'Retirement inventory contract changed';
  end if;
  definition := replace(definition, $marker$'export_logs','fms_flows'$marker$, $replacement$'export_logs','fms_execution_scopes','fms_flows'$replacement$);
  definition := replace(definition, $marker$'fms_evidence', (select count(*)$marker$, $replacement$'fms_execution_scopes', (select count(*) from public.fms_execution_scopes where tenant_id=p_tenant_id),
      'fms_join_arrivals', (select count(*) from public.fms_join_arrivals a join public.fms_execution_scopes c on c.id=a.parallel_scope_id where c.tenant_id=p_tenant_id),
      'fms_visit_inputs', (select count(*) from public.fms_visit_inputs a join public.fms_execution_scopes c on c.id=a.parallel_scope_id where c.tenant_id=p_tenant_id),
      'fms_evidence', (select count(*)$replacement$);
  execute definition;
end $$;

revoke all on function public.production_demo_data_retirement_manifest(uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
